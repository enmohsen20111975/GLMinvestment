/**
 * personalized-radar.ts — User profile + personalized radar logic
 * ============================================================================
 *
 * Builds a user profile from:
 * 1. Portfolio holdings — `db/auth.db.portfolio_items` (Prisma)
 * + `db/auth.db.portfolio_assets` (better-sqlite3 readonly)
 * 2. Watchlist — `db/auth.db.watchlist` (Prisma)
 * 3. Trade history — `db/predictions.db.predictions` (better-sqlite3 readonly)
 * (matched against the user's preferred tickers — the
 * predictions table itself is system-wide, not user-scoped,
 * but we use it to compute the win rate / holding period
 * of the tickers the user prefers.)
 * 4. Tracked stocks — `db/maker_radar_tracking.json` (global; included
 * as a "tracked" signal — not user-scoped, so we
 * surface them as a global context list, not as the
 * user's own picks.)
 *
 * Profile includes:
 * - Preferred sectors (ranked)
 * - Preferred tickers (most traded / held / watched)
 * - Risk profile (conservative / balanced / aggressive — based on avg position size)
 * - Average holding period (short <7d / medium 7-30d / long >30d)
 * - Preferred price range (low <10 / mid 10-100 / high >100)
 * - Preferred markets (EGX / US / CRYPTO / etc.)
 * - Total trades
 * - Win rate (from predictions table filtered to user's preferred tickers)
 *
 * Privacy:
 * - Only the authenticated user's OWN data is read (filtered by user_id).
 * - The predictions table has no user_id column, so we only join it with the
 * user's preferred tickers — never read another user's portfolio.
 *
 * Robustness:
 * - All DB reads are wrapped in try/catch — if a DB is missing, we skip it
 * and continue with whatever data is available.
 * - If no profile data is available at all (new user), `buildUserProfile`
 * returns `null`, which the API/UI surface uses as a "show CTA" signal.
 * ============================================================================
 */

import { authDb } from '@/lib/db-auth';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
// (ALPHA-DAL-WAVE1 — owner directive 2026-10-27):
// «استبدل استدعاءات predictions.db المباشرة بالدالة المعيارية + استخدم openDb من الـ DAL».
// Database type used for typing only; openDb is the gatekeeper (no new Database()).
import { openDb } from '@/lib/db-manager';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface UserProfile {
 userId: string;
 preferredSectors: Array<{ sector: string; count: number; pct: number }>;
 preferredTickers: Array<{ ticker: string; count: number; lastTraded: string }>;
 riskProfile: 'conservative' | 'balanced' | 'aggressive';
 averageHoldingDays: number;
 holdingPeriodCategory: 'short' | 'medium' | 'long';
 preferredPriceRange: 'low' | 'mid' | 'high';
 preferredMarkets: Array<{ market: string; count: number }>;
 totalTrades: number;
 winRate: number;
 profileComputedAt: string;
}

export interface PersonalizedRadarFilters {
 sectors?: string[]; // only show stocks in these sectors
 excludeTickers?: string[]; // don't show stocks the user already holds
 priceRange?: { min: number; max: number };
 market?: string;
 riskProfile?: 'conservative' | 'balanced' | 'aggressive';
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PROJECT_ROOT = process.cwd();

// Risk profile thresholds (avg position size in user's primary currency)
// These are conservative defaults — they can be tuned later with real data.
const RISK_PROFILE_THRESHOLDS = {
 conservative: 1000, // avg position < 1,000 → conservative
 balanced: 10000, // avg position 1,000–10,000 → balanced
 // avg position > 10,000 → aggressive
};

// Price range thresholds
const PRICE_RANGE_THRESHOLDS = {
 low: 10, // < 10 → low
 mid: 100, // 10–100 → mid
 // > 100 → high
};

// Holding period thresholds (days)
const HOLDING_PERIOD_THRESHOLDS = {
 short: 7, // < 7 days → short
 medium: 30, // 7–30 days → medium
 // > 30 days → long
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function safeNum(v: unknown): number | null {
 if (v == null) return null;
 const n = Number(v);
 return Number.isFinite(n) ? n : null;
}

function classifyRiskProfile(avgPositionSize: number | null): 'conservative' | 'balanced' | 'aggressive' {
 if (avgPositionSize == null || avgPositionSize <= 0) return 'balanced';
 if (avgPositionSize < RISK_PROFILE_THRESHOLDS.conservative) return 'conservative';
 if (avgPositionSize < RISK_PROFILE_THRESHOLDS.balanced) return 'balanced';
 return 'aggressive';
}

function classifyPriceRange(avgPrice: number | null): 'low' | 'mid' | 'high' {
 if (avgPrice == null || avgPrice <= 0) return 'mid';
 if (avgPrice < PRICE_RANGE_THRESHOLDS.low) return 'low';
 if (avgPrice < PRICE_RANGE_THRESHOLDS.mid) return 'mid';
 return 'high';
}

function classifyHoldingPeriod(avgDays: number | null): 'short' | 'medium' | 'long' {
 if (avgDays == null || avgDays <= 0) return 'medium';
 if (avgDays < HOLDING_PERIOD_THRESHOLDS.short) return 'short';
 if (avgDays < HOLDING_PERIOD_THRESHOLDS.medium) return 'medium';
 return 'long';
}

function priceRangeToRange(range: 'low' | 'mid' | 'high'): { min: number; max: number } {
 switch (range) {
 case 'low': return { min: 0, max: PRICE_RANGE_THRESHOLDS.low };
 case 'mid': return { min: PRICE_RANGE_THRESHOLDS.low, max: PRICE_RANGE_THRESHOLDS.mid };
 case 'high': return { min: PRICE_RANGE_THRESHOLDS.mid, max: 100000 };
 }
}

// ─── Sector lookup ──────────────────────────────────────────────────────────
// Reads the stocks.db to resolve a ticker → sector. Cached per request.

const _sectorCache = new Map<string, string | null>();

function lookupSector(ticker: string): string | null {
 if (!ticker) return null;
 const upper = ticker.toUpperCase();
 if (_sectorCache.has(upper)) return _sectorCache.get(upper)!;

 let sector: string | null = null;
 try {
 const stocksDbPath = path.join(PROJECT_ROOT, 'db', 'stocks.db');
 if (existsSync(stocksDbPath)) {
 // (ALPHA-DAL-WAVE1): استخدم openDb من الـ DAL — ممنوع new Database().
 const db = openDb('stocks.db');
 if (db) {
 try {
 const row = db.prepare(
 'SELECT sector FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1'
 ).get(upper) as { sector?: string } | undefined;
 sector = row?.sector ?? null;
 } finally {
 db.close();
 }
 }
 }
 } catch (e) {
 console.warn('[personalized-radar] lookupSector failed for', upper, e);
 }

 _sectorCache.set(upper, sector);
 return sector;
}

// ─── Portfolio reads (Prisma) ───────────────────────────────────────────────

interface PortfolioItemRow {
 symbol: string | null;
 asset_type: string;
 purchase_price: number | null;
 shares: number | null;
 currency: string;
 created_at: Date;
}

interface WatchlistRow {
 ticker: string;
 market: string;
 created_at: Date;
}

async function fetchPortfolioItems(userId: string): Promise<PortfolioItemRow[]> {
 try {
 const items = await authDb.portfolioItem.findMany({
 where: { user_id: userId },
 select: {
 symbol: true,
 asset_type: true,
 purchase_price: true,
 shares: true,
 currency: true,
 created_at: true,
 },
 });
 return items.map((i) => ({
 symbol: i.symbol,
 asset_type: i.asset_type,
 purchase_price: i.purchase_price,
 shares: i.shares,
 currency: i.currency,
 created_at: i.created_at,
 }));
 } catch (e) {
 console.warn('[personalized-radar] portfolio_items read failed:', e);
 return [];
 }
}

async function fetchWatchlist(userId: string): Promise<WatchlistRow[]> {
 try {
 const items = await authDb.watchlist.findMany({
 where: { user_id: userId },
 select: { ticker: true, market: true, created_at: true },
 });
 return items.map((i) => ({
 ticker: i.ticker,
 market: i.market,
 created_at: i.created_at,
 }));
 } catch (e) {
 console.warn('[personalized-radar] watchlist read failed:', e);
 return [];
 }
}

// ─── Portfolio reads (better-sqlite3 readonly for portfolio_assets) ─────────

interface PortfolioAssetRow {
 type: string;
 name: string;
 stock_ticker: string | null;
 quantity: number | null;
 avg_buy_price: number | null;
 total_invested: number;
 current_value: number;
 added_at: string | null;
 updated_at: string | null;
}

function fetchPortfolioAssets(userId: string): PortfolioAssetRow[] {
 try {
 const authDbPath = path.join(PROJECT_ROOT, 'db', 'auth.db');
 if (!existsSync(authDbPath)) return [];
 // (ALPHA-DAL-WAVE1): استخدم openDb من الـ DAL — ممنوع new Database().
 const db = openDb('auth.db');
 if (!db) return [];
 try {
 // Check if portfolio_assets table exists
 const tables = db.prepare(
 "SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_assets'"
 ).all() as { name: string }[];
 if (tables.length === 0) return [];

 const rows = db.prepare(
 'SELECT type, name, stock_ticker, quantity, avg_buy_price, total_invested, current_value, added_at, updated_at FROM portfolio_assets WHERE user_id = ?'
 ).all(userId) as PortfolioAssetRow[];
 return rows;
 } finally {
 db.close();
 }
 } catch (e) {
 console.warn('[personalized-radar] portfolio_assets read failed:', e);
 return [];
 }
}

// ─── Predictions read (better-sqlite3 readonly) ─────────────────────────────
// Used to compute win rate + avg holding period for the user's preferred tickers.

interface PredictionRow {
 ticker: string;
 signal_type: string;
 prediction_date: string;
 entry_price: number;
 outcome_date: string | null;
 exit_price: number | null;
 actual_return: number | null;
 hit_target: number;
 hit_stop: number;
 holding_days: number;
 market: string | null;
}

function fetchPredictionsForTickers(tickers: string[]): PredictionRow[] {
 if (tickers.length === 0) return [];

 // Try predictions.db first, then predictions.db.original as fallback
 const candidates = [
 { path: path.join(PROJECT_ROOT, 'db', 'predictions.db'), source: 'predictions_db' },
 { path: path.join(PROJECT_ROOT, 'db', 'predictions.db.original'), source: 'predictions_db_original' },
 ];

 for (const c of candidates) {
 if (!existsSync(c.path)) continue;
 try {
 // (ALPHA-DAL-WAVE1): استخدم openDb من الـ DAL — ممنوع new Database().
 const db = openDb(c.path.endsWith('predictions.db.original') ? 'predictions.db.original' : 'predictions.db');
 if (!db) continue;
 try {
 const tables = db.prepare(
 "SELECT name FROM sqlite_master WHERE type='table' AND name='predictions'"
 ).all() as { name: string }[];
 if (tables.length === 0) {
 db.close();
 continue;
 }

 const placeholders = tickers.map(() => '?').join(', ');
 const upperTickers = tickers.map((t) => t.toUpperCase());

 const rows = db.prepare(
 `SELECT ticker, signal_type, prediction_date, entry_price,
 outcome_date, exit_price, actual_return,
 hit_target, hit_stop, holding_days, market
 FROM predictions
 WHERE UPPER(ticker) IN (${placeholders})`
 ).all(...upperTickers) as PredictionRow[];
 return rows;
 } finally {
 db.close();
 }
 } catch (e) {
 console.warn('[personalized-radar] predictions read failed for', c.path, e);
 }
 }
 return [];
}

// ─── Maker radar tracking.json read (global — not user-scoped) ───────────────

interface TrackedStock {
 ticker: string;
 entryDate: string;
 entryPrice: number;
 addedAt: string;
}

function fetchTrackedStocks(): TrackedStock[] {
 try {
 const trackingPath = path.join(PROJECT_ROOT, 'db', 'maker_radar_tracking.json');
 if (!existsSync(trackingPath)) return [];
 const raw = readFileSync(trackingPath, 'utf-8');
 const parsed = JSON.parse(raw) as Record<string, TrackedStock>;
 return Object.values(parsed || {});
 } catch (e) {
 console.warn('[personalized-radar] maker_radar_tracking.json read failed:', e);
 return [];
 }
}

// ─── Aggregation helpers ─────────────────────────────────────────────────────

function rankSectors(
 counts: Record<string, number>,
): Array<{ sector: string; count: number; pct: number }> {
 const total = Object.values(counts).reduce((a, b) => a + b, 0);
 return Object.entries(counts)
 .map(([sector, count]) => ({
 sector,
 count,
 pct: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
 }))
 .sort((a, b) => b.count - a.count);
}

function rankTickers(
 counts: Record<string, { count: number; lastTraded: string }>,
): Array<{ ticker: string; count: number; lastTraded: string }> {
 return Object.entries(counts)
 .map(([ticker, v]) => ({ ticker, count: v.count, lastTraded: v.lastTraded }))
 .sort((a, b) => b.count - a.count);
}

function rankMarkets(counts: Record<string, number>): Array<{ market: string; count: number }> {
 return Object.entries(counts)
 .map(([market, count]) => ({ market, count }))
 .sort((a, b) => b.count - a.count);
}

// ─── Main: buildUserProfile ────────────────────────────────────────────────

export async function buildUserProfile(userId: string): Promise<UserProfile | null> {
 if (!userId) return null;

 // 1. Fetch portfolio_items + portfolio_assets + watchlist (user-scoped)
 const [portfolioItems, watchlist] = await Promise.all([
 fetchPortfolioItems(userId),
 fetchWatchlist(userId),
 ]);
 const portfolioAssets = fetchPortfolioAssets(userId);
 const trackedStocks = fetchTrackedStocks();

 // ── Aggregate preferred tickers (count holdings + watchlist entries) ──
 const tickerCounts: Record<string, { count: number; lastTraded: string }> = {};
 const sectorCounts: Record<string, number> = {};
 const marketCounts: Record<string, number> = {};
 const entryPrices: number[] = [];
 const positionSizes: number[] = [];

 const bumpTicker = (ticker: string, lastTraded: string) => {
 if (!ticker) return;
 const upper = ticker.toUpperCase();
 if (!tickerCounts[upper]) {
 tickerCounts[upper] = { count: 0, lastTraded };
 }
 tickerCounts[upper].count += 1;
 if (lastTraded > tickerCounts[upper].lastTraded) {
 tickerCounts[upper].lastTraded = lastTraded;
 }
 };

 const bumpSector = (sector: string | null) => {
 if (!sector) return;
 const normalized = sector.trim();
 if (!normalized) return;
 sectorCounts[normalized] = (sectorCounts[normalized] || 0) + 1;
 };

 const bumpMarket = (market: string | null | undefined) => {
 if (!market) return;
 const upper = market.toUpperCase();
 marketCounts[upper] = (marketCounts[upper] || 0) + 1;
 };

 // ── portfolio_items (Prisma) ─────────────────────────────────────────
 for (const item of portfolioItems) {
 if (item.asset_type !== 'stock' || !item.symbol) continue;
 const lastTraded = item.created_at instanceof Date
 ? item.created_at.toISOString()
 : String(item.created_at || new Date().toISOString());
 bumpTicker(item.symbol, lastTraded);

 const sector = lookupSector(item.symbol);
 bumpSector(sector);

 const price = safeNum(item.purchase_price);
 if (price != null && price > 0) entryPrices.push(price);

 // Position size = purchase_price * shares (rough estimate)
 const qty = safeNum(item.shares);
 if (price != null && qty != null && qty > 0) {
 positionSizes.push(price * qty);
 }
 }

 // ── portfolio_assets (better-sqlite3) ─────────────────────────────────
 for (const asset of portfolioAssets) {
 if (asset.type !== 'stock' || !asset.stock_ticker) continue;
 const lastTraded = asset.added_at || asset.updated_at || new Date().toISOString();
 bumpTicker(asset.stock_ticker, lastTraded);

 const sector = lookupSector(asset.stock_ticker);
 bumpSector(sector);

 const avgBuy = safeNum(asset.avg_buy_price);
 if (avgBuy != null && avgBuy > 0) entryPrices.push(avgBuy);

 const invested = safeNum(asset.total_invested);
 if (invested != null && invested > 0) {
 positionSizes.push(invested);
 }
 }

 // ── watchlist ─────────────────────────────────────────────────────────
 for (const w of watchlist) {
 const lastTraded = w.created_at instanceof Date
 ? w.created_at.toISOString()
 : String(w.created_at || new Date().toISOString());
 bumpTicker(w.ticker, lastTraded);
 bumpMarket(w.market);

 const sector = lookupSector(w.ticker);
 bumpSector(sector);
 }

 // ── tracked stocks (global — not user-scoped) ─────────────────────────
 // We only include them as additional "preferred tickers" context for
 // the user. The tracking file is global, so we surface them as
 // low-weight preferences (count=1 each, lastTraded=addedAt).
 for (const t of trackedStocks) {
 if (!tickerCounts[t.ticker]) {
 bumpTicker(t.ticker, t.addedAt || new Date().toISOString());
 }
 }

 // ── Determine if we have ANY user data at all ─────────────────────────
 const totalTrades =
 portfolioItems.filter((i) => i.asset_type === 'stock').length +
 portfolioAssets.filter((a) => a.type === 'stock').length +
 watchlist.length;

 if (totalTrades === 0) {
 // New user — return null so the UI shows the CTA
 return null;
 }

 // ── Compute aggregates ────────────────────────────────────────────────
 const preferredTickers = rankTickers(tickerCounts);
 const preferredSectors = rankSectors(sectorCounts);
 const preferredMarkets = rankMarkets(marketCounts);

 // Avg position size → risk profile
 const avgPositionSize = positionSizes.length > 0
 ? positionSizes.reduce((a, b) => a + b, 0) / positionSizes.length
 : null;
 const riskProfile = classifyRiskProfile(avgPositionSize);

 // Avg entry price → preferred price range
 const avgEntryPrice = entryPrices.length > 0
 ? entryPrices.reduce((a, b) => a + b, 0) / entryPrices.length
 : null;
 const preferredPriceRange = classifyPriceRange(avgEntryPrice);

 // ── Win rate + holding period from predictions (filtered to user's tickers) ──
 const userTickers = preferredTickers.map((t) => t.ticker);
 const predictionRows = fetchPredictionsForTickers(userTickers);

 let wins = 0;
 let verified = 0;
 const holdingDays: number[] = [];

 for (const row of predictionRows) {
 const isVerified = !!row.outcome_date ||
 safeNum(row.hit_target) === 1 ||
 safeNum(row.hit_stop) === 1;
 if (!isVerified) continue;

 verified += 1;
 const actualReturn = safeNum(row.actual_return);
 const hitTarget = safeNum(row.hit_target) === 1;
 const entryPrice = safeNum(row.entry_price);
 const exitPrice = safeNum(row.exit_price);
 const priceGain = entryPrice != null && exitPrice != null
 ? ((exitPrice - entryPrice) / entryPrice) * 100
 : null;

 let isWin = false;
 if (hitTarget) isWin = true;
 else if (actualReturn != null) isWin = actualReturn > 0;
 else if (priceGain != null) isWin = priceGain > 0;

 if (isWin) wins += 1;

 const hd = safeNum(row.holding_days);
 if (hd != null && hd > 0) holdingDays.push(hd);
 }

 const winRate = verified > 0 ? Math.round((wins / verified) * 1000) / 10 : 0;
 const averageHoldingDays = holdingDays.length > 0
 ? Math.round((holdingDays.reduce((a, b) => a + b, 0) / holdingDays.length) * 10) / 10
 : 0;
 const holdingPeriodCategory = classifyHoldingPeriod(averageHoldingDays || null);

 return {
 userId,
 preferredSectors,
 preferredTickers,
 riskProfile,
 averageHoldingDays,
 holdingPeriodCategory,
 preferredPriceRange,
 preferredMarkets,
 totalTrades,
 winRate,
 profileComputedAt: new Date().toISOString(),
 };
}

// ─── Personalized filters ───────────────────────────────────────────────────

export async function getPersonalizedFilters(
 userId: string,
): Promise<PersonalizedRadarFilters> {
 const profile = await buildUserProfile(userId);
 if (!profile) return {};

 return {
 sectors: profile.preferredSectors.slice(0, 3).map((s) => s.sector),
 priceRange: priceRangeToRange(profile.preferredPriceRange),
 riskProfile: profile.riskProfile,
 };
}

// ─── Exported helpers (used by the API route) ───────────────────────────────

export { priceRangeToRange, classifyRiskProfile, classifyPriceRange, classifyHoldingPeriod };
