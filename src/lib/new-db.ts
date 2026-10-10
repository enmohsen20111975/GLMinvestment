/**
 * Database Wrapper for New Database Structure
 * =============================================
 * 
 * القواعد الجديدة:
 * - stocks.db: كل الأسهم (مصرية + عربية) + العملات الرقمية + الذهب + العملات
 * - price_history.db: الأسعار التاريخية
 * - predictions.db: التوقعات والتحليلات
 * - learned.db: الدروس المستفادة
 * - auth.db: المستخدمين (Prisma) - تم ترحيل custom.db
 *
 * ملاحظة: custom.db تم حذفها - كل بيانات المستخدمين في auth.db عبر Prisma
 */

import { createDatabase, initialize, isInitialized, type SqliteDatabase } from '@/lib/sqlite-wrapper';
import * as path from 'path';
import { existsSync } from 'fs';

// ===========================================================================
// FIX-P3-P5-P6 (Group P5 — Fix 6 / Group P6 — Fix 9): Market normalization
// ===========================================================================
//
// The platform stores market identifiers inconsistently across its DBs:
//
//   - stocks.db / predictions.db / auth.db  → English codes (EGX, TADAWUL, ...)
//   - data_engine.db.stocks.market          → Arabic names (مصر, السعودية, ...)
//   - The frontend also accepts legacy aliases (KSA → TADAWUL, ...)
//
// Before comparing or binding market values into SQL queries we MUST
// normalize them through `normalizeMarket()` so an EGX request from the
// UI matches both `market = 'EGX'` (stocks.db) AND `market = 'مصر'`
// (data_engine.db). This file owns the English-code-side normalization.
// The Arabic-side mapping lives in `src/lib/egx-db.ts` (FRONTEND_TO_ARABIC_MARKET).
//
// `normalizeMarket()` is idempotent: passing an already-normalized code
// returns it unchanged. It also guards against path traversal by stripping
// any character that isn't a letter / digit / underscore / hyphen.
// ===========================================================================

/**
 * Arabic market name → English market code lookup.
 *
 * Keys are intentionally the bare Arabic country names that appear in
 * data_engine.db.stocks.market — including the leading "ال" definite
 * article ("السعودية", "الكويت", "الإمارات", "البحرين").
 */
const ARABIC_TO_ENGLISH_MARKET: Record<string, string> = {
  'مصر': 'EGX',
  'السعودية': 'TADAWUL',
  'سعودية': 'TADAWUL',
  'الكويت': 'KSE',
  'كويت': 'KSE',
  'قطر': 'QSE',
  'الإمارات': 'DFM',
  'امارات': 'DFM',
  'الإمارات العربية المتحدة': 'DFM',
  'البحرين': 'BSE',
  'بحرين': 'BSE',
  'عمان': 'MSM',
  'قطر للذهب': 'QSE',
};

/**
 * Legacy aliases that should collapse to the canonical code.
 * e.g. `KSA` is the legacy frontend alias for the Saudi exchange — the
 * canonical ISO code is `TADAWUL`.
 */
const LEGACY_ALIASES: Record<string, string> = {
  'KSA': 'TADAWUL',
  'SA': 'TADAWUL',
  'SAU': 'TADAWUL',
  'EG': 'EGX',
  'EGY': 'EGX',
  'KW': 'KSE',
  'KUW': 'KSE',
  'QA': 'QSE',
  'AE': 'DFM',
  'UAE': 'DFM',
  'BH': 'BSE',
};

/**
 * Normalize a market identifier to a canonical English code (uppercase,
 * alphanumeric, no whitespace).
 *
 * Accepts any of:
 *   - English codes:        'EGX', 'egx', 'TADAWUL', 'tadawul'
 *   - Legacy aliases:       'KSA', 'EG', 'KW', 'QA'
 *   - Arabic country names: 'مصر', 'السعودية', 'الكويت', 'قطر'
 *
 * Returns the canonical code (e.g. 'EGX', 'TADAWUL'). Falls back to the
 * uppercased input (with non-alphanumerics stripped) when the input is
 * not a known alias — so unknown markets still flow through as a stable,
 * filesystem-safe string.
 *
 * Idempotent: `normalizeMarket(normalizeMarket(x)) === normalizeMarket(x)`.
 */
export function normalizeMarket(market: unknown): string {
  if (market === null || market === undefined) return 'EGX';
  // Treat numbers / objects defensively — coerce to string then trim.
  const raw = String(market).trim();
  if (!raw) return 'EGX';

  // 1. Arabic name → English code.
  if (ARABIC_TO_ENGLISH_MARKET[raw]) {
    return ARABIC_TO_ENGLISH_MARKET[raw];
  }

  // 2. Uppercase + strip non-alphanumerics for English code matching.
  const upper = raw.toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (!upper) return 'EGX';

  // 3. Legacy alias → canonical code.
  if (LEGACY_ALIASES[upper]) {
    return LEGACY_ALIASES[upper];
  }

  // 4. Already-canonical English code (EGX, TADAWUL, KSE, QSE, DFM, BSE, MSM,
  //    CRYPTO, GOLD, FOREX, ALL, ...). Return as-is.
  return upper;
}

// ===========================================================================
// LAZY INITIALIZATION
// ===========================================================================

let _ensurePromise: Promise<void> | null = null;

export async function ensureInitialized(): Promise<void> {
  if (isInitialized()) return;
  
  if (_ensurePromise) {
    try {
      await _ensurePromise;
      return;
    } catch { // silent fallback (safe-by-design)
      _ensurePromise = null;
    }
  }
  
  _ensurePromise = initialize().catch((err) => {
    _ensurePromise = null;
    throw err;
  });
  
  return _ensurePromise;
}

// ===========================================================================
// DATABASE PATHS
// ===========================================================================

const DB_DIR = path.join(process.cwd(), 'db');

export const DB_PATHS = {
  stocks: path.join(DB_DIR, 'stocks.db'),
  price_history: path.join(DB_DIR, 'price_history.db'),
  predictions: path.join(DB_DIR, 'predictions.db'),
  learned: path.join(DB_DIR, 'learned.db'),
  auth: path.join(DB_DIR, 'auth.db'), // Prisma - للمستخدمين
};

// DEPRECATED: custom.db has been removed
// Use auth.db via Prisma for user data

// ===========================================================================
// DATABASE SINGLETONS
// ===========================================================================

let _stocksDb: SqliteDatabase | null = null;
let _priceHistoryDb: SqliteDatabase | null = null;
let _predictionsDb: SqliteDatabase | null = null;
let _learnedDb: SqliteDatabase | null = null;

// Fallback to legacy databases if new ones don't exist
let _useLegacy = false;

function getDb(dbPath: string, singleton: { current: SqliteDatabase | null }, readonly: boolean = true): SqliteDatabase {
  if (singleton.current) return singleton.current;
  
  if (!isInitialized()) {
    throw new Error('sql.js not initialized. Call await ensureInitialized() first.');
  }
  
  // Check if new database exists, otherwise fallback to legacy
  if (!existsSync(dbPath) && dbPath === DB_PATHS.stocks) {
    // Fallback to legacy databases
    _useLegacy = true;
    console.log('[new-db] New databases not found, using legacy databases');
  }
  
  singleton.current = createDatabase(dbPath, { readonly });
  singleton.current.pragma('foreign_keys = ON');
  
  return singleton.current;
}

// ===========================================================================
// PUBLIC API
// ===========================================================================

/**
 * Get stocks database (مصرية + عربية + عملات رقمية)
 */
export function getStocksDb(): SqliteDatabase {
  return getDb(DB_PATHS.stocks, { current: _stocksDb });
}

/**
 * Get price history database
 */
export function getPriceHistoryDb(): SqliteDatabase {
  return getDb(DB_PATHS.price_history, { current: _priceHistoryDb });
}

/**
 * Get predictions database
 */
export function getPredictionsDb(): SqliteDatabase {
  return getDb(DB_PATHS.predictions, { current: _predictionsDb });
}

/**
 * Get learned lessons database
 */
export function getLearnedDb(): SqliteDatabase {
  return getDb(DB_PATHS.learned, { current: _learnedDb });
}

/**
 * @deprecated custom.db has been removed. Use Prisma with auth.db for user data.
 * This function throws an error to indicate the migration requirement.
 */
export function getCustomDb(): SqliteDatabase {
  throw new Error('custom.db has been removed. Use Prisma with auth.db for user data (User, Portfolio, Watchlist, etc.)');
}

// ===========================================================================
// CONVENIENCE FUNCTIONS
// ===========================================================================

/**
 * Get all stocks (EGX + Arab + Crypto)
 */
export function getAllStocksNew(): Record<string, unknown>[] {
  const db = getStocksDb();
  
  try {
    return db.prepare(`
      SELECT 
        id, ticker, name, name_ar, market, sector, industry,
        current_price, previous_close, open_price, high_price, low_price,
        change_percent, volume, market_cap,
        pe_ratio, pb_ratio, eps, roe, roa,
        is_halal, is_active, is_crypto,
        is_egx30, is_egx70, is_egx100,
        last_update
      FROM stocks
      WHERE is_active = 1
      ORDER BY market, ticker
    `).all() as Record<string, unknown>[];
  } catch (err) {
    console.error('[new-db] Error getting stocks:', err);
    return [];
  }
}

/**
 * Get stocks by market
 *
 * FIX-P3-P5-P6 (Group P6 — Fix 9): the `market` argument is normalized via
 * `normalizeMarket()` before being bound into the SQL — so callers can pass
 * either an English code (EGX, TADAWUL), a legacy alias (KSA), or an Arabic
 * name (مصر, السعودية) and the query will still match rows that store the
 * canonical English code.
 */
export function getStocksByMarket(market: string): Record<string, unknown>[] {
  const db = getStocksDb();
  const normalized = normalizeMarket(market);

  try {
    return db.prepare(`
      SELECT * FROM stocks
      WHERE UPPER(market) = ? AND is_active = 1
      ORDER BY ticker
    `).all(normalized.toUpperCase()) as Record<string, unknown>[];
  } catch (err) {
    console.error('[new-db] Error getting stocks by market:', err);
    return [];
  }
}

/**
 * Get stock by ticker
 */
export function getStockByTickerNew(ticker: string): Record<string, unknown> | null {
  const db = getStocksDb();
  
  try {
    const row = db.prepare(`
      SELECT * FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1
    `).get(ticker) as Record<string, unknown> | undefined;
    
    return row || null;
  } catch (err) {
    console.error('[new-db] Error getting stock by ticker:', err);
    return null;
  }
}

/**
 * Get price history for a stock
 */
export function getPriceHistory(ticker: string, limit: number = 365): Record<string, unknown>[] {
  const db = getPriceHistoryDb();
  
  try {
    return db.prepare(`
      SELECT 
        date, open_price, high_price, low_price, close_price, volume
      FROM price_history
      WHERE ticker = ?
      ORDER BY date DESC
      LIMIT ?
    `).all(ticker, limit) as Record<string, unknown>[];
  } catch (err) {
    console.error('[new-db] Error getting price history:', err);
    return [];
  }
}

/**
 * Get predictions
 */
export function getPredictions(market?: string, limit: number = 100): Record<string, unknown>[] {
  const db = getPredictionsDb();
  
  try {
    if (market) {
      return db.prepare(`
        SELECT * FROM predictions
        WHERE market = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(market, limit) as Record<string, unknown>[];
    }
    
    return db.prepare(`
      SELECT * FROM predictions
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
  } catch (err) {
    console.error('[new-db] Error getting predictions:', err);
    return [];
  }
}

/**
 * Get learned lessons
 */
export function getLearnedLessons(limit: number = 100): Record<string, unknown>[] {
  const db = getLearnedDb();
  
  try {
    return db.prepare(`
      SELECT * FROM learned_lessons
      ORDER BY created_at DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
  } catch (err) {
    console.error('[new-db] Error getting learned lessons:', err);
    return [];
  }
}

/**
 * Get market overview stats
 *
 * FIX-P3-P5-P6 (Group P6 — Fix 9): accepts an optional `market` filter.
 * When provided, stats are computed for THAT market only (after
 * normalization). When omitted, stats are computed across all markets.
 */
export function getMarketOverviewStatsNew(market?: string): Record<string, unknown> {
  const db = getStocksDb();

  try {
    const normalized = market ? normalizeMarket(market).toUpperCase() : null;
    const whereClause = normalized
      ? `WHERE is_active = 1 AND UPPER(market) = ?`
      : `WHERE is_active = 1`;
    const params: string[] = normalized ? [normalized] : [];
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total_stocks,
        COUNT(DISTINCT market) as total_markets,
        SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) as gainers,
        SUM(CASE WHEN change_percent < 0 THEN 1 ELSE 0 END) as losers,
        SUM(CASE WHEN change_percent = 0 THEN 1 ELSE 0 END) as unchanged,
        SUM(volume) as total_volume,
        SUM(market_cap) as total_market_cap
      FROM stocks
      ${whereClause}
    `).get(...params) as Record<string, unknown>;

    return stats || {
      total_stocks: 0,
      total_markets: 0,
      gainers: 0,
      losers: 0,
      unchanged: 0,
      total_volume: 0,
      total_market_cap: 0,
    };
  } catch (err) {
    console.error('[new-db] Error getting market overview stats:', err);
    return {
      total_stocks: 0,
      total_markets: 0,
      gainers: 0,
      losers: 0,
      unchanged: 0,
      total_volume: 0,
      total_market_cap: 0,
    };
  }
}

/**
 * Get top movers (gainers, losers, most active)
 */
export function getTopMoversNew(limit: number = 10): {
  gainers: Record<string, unknown>[];
  losers: Record<string, unknown>[];
  most_active: Record<string, unknown>[];
} {
  const db = getStocksDb();
  
  try {
    const stocks = db.prepare(`
      SELECT * FROM stocks WHERE is_active = 1 AND is_crypto = 0
    `).all() as Record<string, unknown>[];
    
    // Sort by change percent
    const sorted = stocks.sort((a, b) => {
      const changeA = Number(a.change_percent) || 0;
      const changeB = Number(b.change_percent) || 0;
      return changeB - changeA;
    });
    
    const gainers = sorted.filter(s => (Number(s.change_percent) || 0) > 0).slice(0, limit);
    const losers = sorted.filter(s => (Number(s.change_percent) || 0) < 0).reverse().slice(0, limit);
    const mostActive = [...stocks].sort((a, b) => (Number(b.volume) || 0) - (Number(a.volume) || 0)).slice(0, limit);
    
    return { gainers, losers, most_active: mostActive };
  } catch (err) {
    console.error('[new-db] Error getting top movers:', err);
    return { gainers: [], losers: [], most_active: [] };
  }
}

// ===========================================================================
// RESET FUNCTIONS
// ===========================================================================

export function resetAllDbs(): void {
  _stocksDb = null;
  _priceHistoryDb = null;
  _predictionsDb = null;
  _learnedDb = null;
  console.log('[new-db] All database connections reset');
}

export function isUsingLegacy(): boolean {
  return _useLegacy;
}
/**
 * Database Wrapper for New Database Structure
 * =============================================
 * 
 * القواعد الجديدة:
 * - stocks.db: كل الأسهم (مصرية + عربية) + العملات الرقمية + الذهب + العملات
 * - price_history.db: الأسعار التاريخية
 * - predictions.db: التوقعات والتحليلات
 * - learned.db: الدروس المستفادة
 * - custom.db: المستخدمين (زي هي)
 */

