/**
 * GET /api/radar/personalized
 * =============================
 * Personalized radar — returns radar picks filtered & ranked by the user's
 * profile (sectors, price range, risk profile, watchlist).
 *
 * Requires authentication (getSessionUserId). Returns 401 if unauthenticated.
 *
 * Flow:
 *   1. Build user profile from trade history + portfolio + watchlist
 *      (src/lib/personalized-radar.ts → buildUserProfile).
 *   2. Fetch current radar picks from the cached maker_radar_*.json file
 *      (via @/modules/radar/lib/radar-cache readRadarCache — instant <50ms).
 *   3. For each pick:
 *      - Exclude if the user already holds it (portfolio_items / portfolio_assets)
 *      - Exclude if outside the user's preferred price range
 *      - Boost score for stocks in user's preferred sectors (+10)
 *      - Boost score for stocks in user's preferred price range (+5)
 *      - Adjust position size based on risk profile
 *   4. Returns:
 *      {
 *        success: true,
 *        profile: { preferredSectors, riskProfile, avgHoldingDays, ... },
 *        personalized_picks: [
 *          { ticker, path, score, personalization_reason, ... }
 *        ],
 *        excluded: [
 *          { ticker, reason: "already in portfolio" | "out of price range" }
 *        ]
 *      }
 *
 * Empty state:
 *   - If the user has no trade history (new user), `profile` is null and
 *     `personalized_picks` is the raw radar picks without personalization.
 *     The UI is responsible for showing the "ابدأ التداول" CTA.
 */

import { NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import { readRadarCache } from '@/modules/radar/lib/radar-cache';
import { buildUserProfile, type UserProfile } from '@/modules/personalized/lib/personalized-radar';
import { existsSync } from 'fs';
import path from 'path';
import Database from 'better-sqlite3';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 15;

const PROJECT_ROOT = process.cwd();

// ─── Constants ─────────────────────────────────────────────────────────────

const SECTOR_BONUS = 10;
const PRICE_MATCH_BONUS = 5;
const TOP_SECTORS_COUNT = 3;

// Risk profile multipliers for position sizing
const RISK_PROFILE_MULTIPLIER: Record<string, number> = {
  conservative: 0.7,
  balanced: 1.0,
  aggressive: 1.2,
};

// ─── Helpers ──────────────────────────────────────────────────────────────

function safeNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Sector lookup from stocks.db (cached per request via Map)
const _sectorCache = new Map<string, string | null>();

function lookupSector(ticker: string): string | null {
  if (!ticker) return null;
  const upper = ticker.toUpperCase();
  if (_sectorCache.has(upper)) return _sectorCache.get(upper)!;

  let sector: string | null = null;
  try {
    const stocksDbPath = path.join(PROJECT_ROOT, 'db', 'stocks.db');
    if (existsSync(stocksDbPath)) {
      const db = new Database(stocksDbPath, { readonly: true, fileMustExist: true });
      try {
        const row = db.prepare(
          'SELECT sector FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1'
        ).get(upper) as { sector?: string } | undefined;
        sector = row?.sector ?? null;
      } finally {
        db.close();
      }
    }
  } catch {
    // ignore
  }
  _sectorCache.set(upper, sector);
  return sector;
}

// ─── Fetch user's held tickers (to exclude) ─────────────────────────────────

async function fetchHeldTickers(userId: string): Promise<Set<string>> {
  const held = new Set<string>();

  // portfolio_items via Prisma (auth.db)
  try {
    const { authDb } = await import('@/lib/db-auth');
    const items = await authDb.portfolioItem.findMany({
      where: { user_id: userId, asset_type: 'stock' },
      select: { symbol: true },
    });
    for (const i of items) {
      if (i.symbol) held.add(i.symbol.toUpperCase());
    }
  } catch (e) {
    console.warn('[radar/personalized] portfolio_items fetch failed:', e);
  }

  // portfolio_assets via better-sqlite3 (auth.db)
  try {
    const authDbPath = path.join(PROJECT_ROOT, 'db', 'auth.db');
    if (existsSync(authDbPath)) {
      const db = new Database(authDbPath, { readonly: true, fileMustExist: true });
      try {
        const tables = db.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_assets'"
        ).all() as { name: string }[];
        if (tables.length > 0) {
          const rows = db.prepare(
            'SELECT stock_ticker FROM portfolio_assets WHERE user_id = ? AND type = ? AND stock_ticker IS NOT NULL'
          ).all(userId, 'stock') as { stock_ticker?: string }[];
          for (const r of rows) {
            if (r.stock_ticker) held.add(r.stock_ticker.toUpperCase());
          }
        }
      } finally {
        db.close();
      }
    }
  } catch (e) {
    console.warn('[radar/personalized] portfolio_assets fetch failed:', e);
  }

  return held;
}

// ─── Pick normalization ─────────────────────────────────────────────────────

interface RadarPick {
  ticker: string;
  current_price?: number;
  path?: string;
  position_size?: number;
  roc_10d?: number | null;
  reason?: string;
  [key: string]: unknown;
}

interface PersonalizedPick extends RadarPick {
  base_score: number;
  personalized_score: number;
  sector: string | null;
  personalization_reasons: string[];
  adjusted_position_size: number;
}

interface ExcludedPick {
  ticker: string;
  reason: string;
  detail: string;
}

function flattenRadarPicks(cacheData: {
  under_microscope?: RadarPick[];
  quiet_list?: RadarPick[];
  pre_surge_list?: RadarPick[];
  explosive_list?: RadarPick[];
  early_break_list?: RadarPick[];
}): RadarPick[] {
  const seen = new Set<string>();
  const picks: RadarPick[] = [];
  const add = (arr?: RadarPick[]) => {
    if (!Array.isArray(arr)) return;
    for (const p of arr) {
      if (!p?.ticker) continue;
      const upper = p.ticker.toUpperCase();
      if (seen.has(upper)) continue;
      seen.add(upper);
      picks.push(p);
    }
  };
  // Highest-priority first
  add(cacheData.pre_surge_list);
  add(cacheData.quiet_list);
  add(cacheData.early_break_list);
  add(cacheData.explosive_list);
  add(cacheData.under_microscope);
  return picks;
}

// ─── Main handler ──────────────────────────────────────────────────────────

export async function GET() {
  // 1) Auth check
  const { userId } = await getSessionUserId();
  if (!userId) {
    return NextResponse.json(
      {
        success: false,
        authenticated: false,
        error: 'Authentication required. Please sign in to see your personalized radar.',
      },
      { status: 401 }
    );
  }

  // 2) Build user profile (may be null for new users)
  let profile: UserProfile | null = null;
  try {
    profile = await buildUserProfile(userId);
  } catch (e) {
    console.error('[radar/personalized] buildUserProfile error:', e);
    // Continue with null profile — we'll return raw picks
  }

  // 3) Fetch held tickers (so we can exclude them)
  const heldTickers = await fetchHeldTickers(userId);

  // 4) Read radar cache
  const cache = readRadarCache();
  if (!cache?.data) {
    // No radar cache available — return empty picks with profile
    return NextResponse.json({
      success: true,
      authenticated: true,
      profile,
      personalized_picks: [],
      excluded: [],
      radar_status: 'warming_up',
      message: 'الرادار بيتسخن — حاول تاني خلال دقيقة',
      served_at: new Date().toISOString(),
    });
  }

  const rawPicks = flattenRadarPicks(cache.data);

  // 5) Personalize: filter + score
  const preferredSectors = profile?.preferredSectors?.slice(0, TOP_SECTORS_COUNT).map((s) => s.sector) ?? [];
  const preferredPriceRange = profile?.preferredPriceRange;
  const riskProfile = profile?.riskProfile ?? 'balanced';
  const riskMultiplier = RISK_PROFILE_MULTIPLIER[riskProfile] ?? 1.0;

  // Compute the price range filter bounds (only if we have a profile)
  let priceMin = 0;
  let priceMax = Infinity;
  if (preferredPriceRange === 'low') { priceMin = 0; priceMax = 10; }
  else if (preferredPriceRange === 'mid') { priceMin = 10; priceMax = 100; }
  else if (preferredPriceRange === 'high') { priceMin = 100; priceMax = Infinity; }

  const personalized: PersonalizedPick[] = [];
  const excluded: ExcludedPick[] = [];

  for (const pick of rawPicks) {
    const ticker = pick.ticker.toUpperCase();

    // ── Exclusion 1: already held ───────────────────────────────────────
    if (heldTickers.has(ticker)) {
      excluded.push({
        ticker,
        reason: 'already_in_portfolio',
        detail: 'موجود في محفظتك',
      });
      continue;
    }

    const currentPrice = safeNum(pick.current_price) ?? 0;

    // ── Exclusion 2: out of preferred price range ───────────────────────
    // Only enforce if we have a profile (otherwise keep all picks)
    if (profile && preferredPriceRange && currentPrice > 0) {
      if (currentPrice < priceMin || currentPrice > priceMax) {
        excluded.push({
          ticker,
          reason: 'out_of_price_range',
          detail: `خارج نطاق سعرك المفضل (${preferredPriceRange})`,
        });
        continue;
      }
    }

    // ── Score the pick ───────────────────────────────────────────────────
    const baseScore = safeNum(pick.position_size) ?? 50;
    let personalizedScore = baseScore;
    const reasons: string[] = [];

    // Sector bonus
    const sector = lookupSector(ticker);
    if (sector && preferredSectors.includes(sector)) {
      personalizedScore += SECTOR_BONUS;
      reasons.push(`قطاعك المفضل (${sector})`);
    }

    // Price match bonus
    if (profile && preferredPriceRange && currentPrice > 0 &&
        currentPrice >= priceMin && currentPrice <= priceMax) {
      personalizedScore += PRICE_MATCH_BONUS;
      reasons.push(`في نطاق سعرك المفضل (${preferredPriceRange})`);
    }

    // Risk profile note (not a bonus, but informative)
    if (riskProfile === 'aggressive') {
      reasons.push('يتناسب مع ملف مخاطرك (هجومي)');
    } else if (riskProfile === 'conservative') {
      reasons.push('يتناسب مع ملف مخاطرك (تحفظي)');
    } else if (profile) {
      reasons.push('يتناسب مع ملف مخاطرك (متوازن)');
    }

    // Adjust position size based on risk profile
    const adjustedPositionSize = Math.round(baseScore * riskMultiplier);

    personalized.push({
      ...pick,
      ticker,
      base_score: baseScore,
      personalized_score: personalizedScore,
      sector,
      personalization_reasons: reasons,
      adjusted_position_size: adjustedPositionSize,
    });
  }

  // Sort by personalized score descending
  personalized.sort((a, b) => b.personalized_score - a.personalized_score);

  // Limit to top 20 picks (after sort)
  const topPicks = personalized.slice(0, 20);

  return NextResponse.json({
    success: true,
    authenticated: true,
    profile,
    personalized_picks: topPicks,
    excluded,
    radar_status: 'ready',
    radar_generated_at: cache.data?.generated_at || null,
    radar_cache_file: path.basename(cache.filePath),
    total_picks_in_cache: rawPicks.length,
    served_at: new Date().toISOString(),
  });
}
