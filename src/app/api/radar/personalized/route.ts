import { NextRequest, NextResponse } from 'next/server';
import { getSessionUserId } from '@/lib/auth-helper';
import Database from 'better-sqlite3';
import { readRadarCache } from '@/modules/radar/lib/radar-cache';
import path from 'path';

export const dynamic = 'force-dynamic';

// ============================================================================
// Personalized Radar API
// ============================================================================
// Builds a per-user profile from portfolio_assets (sectors, price range,
// risk profile, preferred tickers) and re-ranks the global maker-radar picks
// by personalization score (sector match + price-range match).
//
// Contract (aligned with PersonalizedRadarTab.tsx interface):
//   profile: {
//     userId, preferredSectors, preferredTickers, preferredMarkets,
//     riskProfile, averageHoldingDays, holdingPeriodCategory,
//     preferredPriceRange, totalTrades, winRate, profileComputedAt,
//     hasTradeHistory   ← NEW: true only if a real trade history source exists
//   }
//   personalized_picks: [{
//     ticker, path, current_price, sector,
//     base_score, personalized_score,
//     adjusted_position_size, position_size,
//     personalization_reasons: string[]
//   }]
//   excluded: [{ ticker, reason, detail }]
// ============================================================================

interface PreferredSector { sector: string; count: number; pct: number; }
interface PreferredTicker { ticker: string; count: number; lastTraded: string; }
interface PreferredMarket { market: string; count: number; }

interface PortfolioRow {
  ticker: string | null;
  sector: string | null;
  current_price: number | null;
  quantity: number | null;
  avg_buy_price: number | null;
  market: string | null;
  added_at: string | null;
}

// Path-nominal base scores (used when signal_count is missing on a pick).
const PATH_BASE_SCORE: Record<string, number> = {
  A_pre_surge: 90,
  B_quiet_accumulation_strong: 75,
  C_quiet_accumulation_weak: 60,
  D_explosive_surge: 85,
  E_early_break: 80,
};

const PRICE_RANGE_BOUNDARIES = { low: 10, mid: 100 } as const;

function classifyPriceRange(avgPrice: number): 'low' | 'mid' | 'high' {
  if (avgPrice < PRICE_RANGE_BOUNDARIES.low) return 'low';
  if (avgPrice <= PRICE_RANGE_BOUNDARIES.mid) return 'mid';
  return 'high';
}

function classifyHoldingPeriod(days: number): 'short' | 'medium' | 'long' {
  if (days < 7) return 'short';
  if (days <= 30) return 'medium';
  return 'long';
}

function classifyRiskProfile(stockCount: number): 'conservative' | 'balanced' | 'aggressive' {
  if (stockCount <= 1) return 'aggressive'; // concentrated → high risk appetite
  if (stockCount <= 5) return 'balanced';
  return 'conservative';
}

function computeAverageHoldingDays(rows: PortfolioRow[]): number {
  // Use added_at timestamps from portfolio_assets; compute avg days since purchase.
  const now = Date.now();
  let totalDays = 0;
  let n = 0;
  for (const r of rows) {
    if (!r.added_at) continue;
    const t = Date.parse(r.added_at);
    if (!Number.isFinite(t)) continue;
    const days = Math.max(0, (now - t) / 86_400_000);
    totalDays += days;
    n += 1;
  }
  return n > 0 ? Math.round(totalDays / n) : 0;
}

function openStocksDb(): Database.Database | null {
  const stocksDbPath = path.join(process.cwd(), 'db', 'stocks.db');
  try {
    return new Database(stocksDbPath, { readonly: true });
  } catch {
    return null;
  }
}

interface RadarStockLike {
  ticker?: string;
  path?: string;
  current_price?: number;
  signal_count?: number;
  [k: string]: unknown;
}

export async function GET(req: NextRequest) {
  try {
    const { userId } = await getSessionUserId();
    if (!userId) {
      return NextResponse.json(
        { success: false, error: 'auth_required' },
        { status: 401 },
      );
    }

    // ─── Build user profile from portfolio_assets ────────────────────────
    const db = openStocksDb();
    let preferredSectors: PreferredSector[] = [];
    let preferredMarkets: PreferredMarket[] = [];
    let preferredTickers: PreferredTicker[] = [];
    let preferredPriceRange: 'low' | 'mid' | 'high' = 'mid';
    let riskProfile: 'conservative' | 'balanced' | 'aggressive' = 'balanced';
    let averageHoldingDays = 0;
    let holdingPeriodCategory: 'short' | 'medium' | 'long' = 'medium';
    let portfolioRows: PortfolioRow[] = [];

    if (db) {
      try {
        portfolioRows = db.prepare(
          `SELECT
             pa.stock_ticker AS ticker,
             s.sector          AS sector,
             s.current_price   AS current_price,
             pa.quantity       AS quantity,
             pa.avg_buy_price  AS avg_buy_price,
             pa.market         AS market,
             pa.added_at       AS added_at
           FROM portfolio_assets pa
           LEFT JOIN stocks s ON pa.stock_ticker = s.ticker COLLATE NOCASE
           WHERE pa.user_id = ? AND pa.stock_ticker IS NOT NULL AND pa.stock_ticker != ''`,
        ).all(userId) as PortfolioRow[];
      } catch {
        // portfolio_assets table missing or join failed — fall through with empty profile.
        portfolioRows = [];
      }
    }

    const stockCount = portfolioRows.length;

    if (stockCount > 0) {
      // Sectors
      const sectorCount: Record<string, number> = {};
      for (const r of portfolioRows) {
        if (!r.sector) continue;
        sectorCount[r.sector] = (sectorCount[r.sector] ?? 0) + 1;
      }
      preferredSectors = Object.entries(sectorCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([sector, count]) => ({
          sector,
          count,
          pct: Math.round((count / stockCount) * 100),
        }));

      // Markets
      const marketCount: Record<string, number> = {};
      for (const r of portfolioRows) {
        const m = (r.market || 'EGX').toUpperCase();
        marketCount[m] = (marketCount[m] ?? 0) + 1;
      }
      preferredMarkets = Object.entries(marketCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([market, count]) => ({ market, count }));

      // Tickers (top by trade value = quantity * avg_buy_price)
      const tickerAgg: Record<string, { count: number; value: number; lastTraded: string }> = {};
      for (const r of portfolioRows) {
        if (!r.ticker) continue;
        const qty = r.quantity ?? 0;
        const px = r.avg_buy_price ?? 0;
        const value = qty * px;
        const tk = r.ticker.toUpperCase();
        if (!tickerAgg[tk]) tickerAgg[tk] = { count: 0, value: 0, lastTraded: '' };
        tickerAgg[tk].count += 1;
        tickerAgg[tk].value += value;
        if (r.added_at && r.added_at > tickerAgg[tk].lastTraded) {
          tickerAgg[tk].lastTraded = r.added_at;
        }
      }
      preferredTickers = Object.entries(tickerAgg)
        .sort((a, b) => b[1].value - a[1].value)
        .slice(0, 8)
        .map(([ticker, agg]) => ({
          ticker,
          count: agg.count,
          lastTraded: agg.lastTraded,
        }));

      // Price range — average current_price across holdings
      const prices = portfolioRows
        .map(r => r.current_price)
        .filter((p): p is number => typeof p === 'number' && p > 0);
      if (prices.length > 0) {
        const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
        preferredPriceRange = classifyPriceRange(avg);
      }

      riskProfile = classifyRiskProfile(stockCount);
      averageHoldingDays = computeAverageHoldingDays(portfolioRows);
      holdingPeriodCategory = classifyHoldingPeriod(averageHoldingDays);
    }

    if (db) db.close();

    // If portfolio is empty → return profile:null so the UI shows the
    // "ابدأ التداول" empty-state CTA (matches PersonalizedRadarTab.tsx:255).
    if (stockCount === 0) {
      return NextResponse.json({
        success: true,
        authenticated: true,
        profile: null,
        personalized_picks: [],
        excluded: [],
        radar_status: 'ready',
        served_at: new Date().toISOString(),
      });
    }

    // ─── Read radar cache + re-rank picks by personalization score ───────
    const market = (req.nextUrl.searchParams.get('market') || 'EGX').toUpperCase();
    const cacheEntry = readRadarCache(market);

    const portfolioTickers = new Set(
      portfolioRows
        .map(r => (r.ticker || '').toUpperCase())
        .filter(Boolean),
    );
    const preferredSectorSet = new Set(preferredSectors.map(s => s.sector));

    // Base position size by risk profile
    const BASE_POSITION_PCT = riskProfile === 'aggressive' ? 8 : riskProfile === 'conservative' ? 3 : 5;

    let personalizedPicks: any[] = [];
    let excluded: any[] = [];
    let radarCacheFile: string | undefined;
    let totalPicksInCache = 0;
    let radarStatus: 'ready' | 'warming_up' = 'ready';

    if (cacheEntry) {
      radarCacheFile = cacheEntry.filePath;
      const allPicks: RadarStockLike[] = [
        ...(cacheEntry.data?.pre_surge_list || []),
        ...(cacheEntry.data?.quiet_list || []),
        ...(cacheEntry.data?.explosive_list || []),
        ...(cacheEntry.data?.early_break_list || []),
      ];
      totalPicksInCache = allPicks.length;

      // Lookup sectors per ticker (one batched query).
      const tickerToSector = new Map<string, string | null>();
      if (allPicks.length > 0) {
        const db2 = openStocksDb();
        if (db2) {
          try {
            const uniqueTickers = Array.from(new Set(
              allPicks.map(p => (p.ticker || '').toUpperCase()).filter(Boolean),
            ));
            const placeholders = uniqueTickers.map(() => '?').join(',');
            const rows = db2.prepare(
              `SELECT ticker, sector FROM stocks WHERE ticker IN (${placeholders}) COLLATE NOCASE`,
            ).all(...uniqueTickers) as { ticker: string; sector: string | null }[];
            for (const r of rows) {
              tickerToSector.set(r.ticker.toUpperCase(), r.sector || null);
            }
          } catch {
            // ignore — sectors will be null, picks still ranked by base score
          }
          db2.close();
        }
      }

      for (const p of allPicks) {
        const ticker = (p.ticker || '').toUpperCase();
        const pickSector = tickerToSector.get(ticker) ?? null;

        // Skip stocks already in the user's portfolio (they'd be duplicate noise).
        if (portfolioTickers.has(ticker)) {
          excluded.push({
            ticker,
            reason: 'already_in_portfolio',
            detail: 'موجود في محفظتك بالفعل',
          });
          continue;
        }

        const baseScore = PATH_BASE_SCORE[p.path || ''] ?? 70;
        const reasons: string[] = [];
        let bonus = 0;

        if (pickSector && preferredSectorSet.has(pickSector)) {
          bonus += 10;
          reasons.push(`يطابق قطاعك المفضّل: ${pickSector}`);
        }

        const px = typeof p.current_price === 'number' ? p.current_price : 0;
        if (px > 0) {
          const pickRange = classifyPriceRange(px);
          if (pickRange === preferredPriceRange) {
            bonus += 5;
            reasons.push('في نطاق سعرك المفضّل');
          }
        }

        // Always include at least one reason (the radar path) so the tooltip is informative.
        if (reasons.length === 0) {
          reasons.push('فرصة من رادار الميكرز');
        }

        personalizedPicks.push({
          ticker,
          path: p.path,
          current_price: px,
          sector: pickSector,
          base_score: baseScore,
          personalized_score: baseScore + bonus,
          adjusted_position_size: BASE_POSITION_PCT,
          position_size: BASE_POSITION_PCT,
          personalization_reasons: reasons,
        });
      }

      // Rank by personalized_score (desc) and keep the top 5.
      personalizedPicks.sort((a, b) => b.personalized_score - a.personalized_score);
      personalizedPicks = personalizedPicks.slice(0, 5);
    } else {
      radarStatus = 'warming_up';
    }

    return NextResponse.json({
      success: true,
      authenticated: true,
      profile: {
        userId,
        preferredSectors,
        preferredTickers,
        preferredMarkets,
        riskProfile,
        averageHoldingDays,
        holdingPeriodCategory,
        preferredPriceRange,
        totalTrades: 0, // No per-user trade history table exists yet.
        winRate: 0,     // Will display "—" via hasTradeHistory flag in UI.
        profileComputedAt: new Date().toISOString(),
        hasTradeHistory: false, // ← UI uses this to hide the fake-looking 0s.
      },
      personalized_picks: personalizedPicks,
      excluded,
      radar_status: radarStatus,
      radar_cache_file: radarCacheFile,
      total_picks_in_cache: totalPicksInCache,
      served_at: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('[radar:personalized]', error);
    return NextResponse.json(
      { success: false, error: 'internal_error' },
      { status: 500 },
    );
  }
}
