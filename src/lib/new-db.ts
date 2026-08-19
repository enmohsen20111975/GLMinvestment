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
// LAZY INITIALIZATION
// ===========================================================================

let _ensurePromise: Promise<void> | null = null;

export async function ensureInitialized(): Promise<void> {
  if (isInitialized()) return;
  
  if (_ensurePromise) {
    try {
      await _ensurePromise;
      return;
    } catch {
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
 */
export function getStocksByMarket(market: string): Record<string, unknown>[] {
  const db = getStocksDb();
  
  try {
    return db.prepare(`
      SELECT * FROM stocks 
      WHERE market = ? AND is_active = 1
      ORDER BY ticker
    `).all(market) as Record<string, unknown>[];
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
 */
export function getMarketOverviewStatsNew(): Record<string, unknown> {
  const db = getStocksDb();
  
  try {
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
      WHERE is_active = 1
    `).get() as Record<string, unknown>;
    
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

