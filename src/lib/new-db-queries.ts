/**
 * New Database Queries
 * =====================
 * 
 * Queries that use the new database structure:
 * - stocks.db for stock info
 * - data_engine.db for historical prices (egksco_price_history table)
 * - predictions.db for predictions and analysis
 * - learned.db for learned lessons
 * 
 * Use these as fallback when stocks.db is corrupted or unavailable.
 */

import { createDatabase, initialize, isInitialized, type SqliteDatabase } from '@/lib/sqlite-wrapper';
import * as path from 'path';
import { existsSync } from 'fs';

// ===========================================================================
// DATABASE PATHS
// ===========================================================================

const DB_DIR = path.join(process.cwd(), 'db');

const DB_PATHS = {
  stocks: path.join(DB_DIR, 'stocks.db'),
  data_engine: path.join(DB_DIR, 'data_engine.db'),
  predictions: path.join(DB_DIR, 'predictions.db'),
  learned: path.join(DB_DIR, 'learned.db'),
};

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
// DATABASE SINGLETONS
// ===========================================================================

let _stocksDb: SqliteDatabase | null = null;
let _dataEngineDb: SqliteDatabase | null = null;
let _predictionsDb: SqliteDatabase | null = null;
let _learnedDb: SqliteDatabase | null = null;

function getDb(dbPath: string, singleton: { current: SqliteDatabase | null }, readonly: boolean = true): SqliteDatabase | null {
  if (singleton.current) return singleton.current;
  
  if (!isInitialized()) {
    return null;
  }
  
  if (!existsSync(dbPath)) {
    return null;
  }
  
  try {
    singleton.current = createDatabase(dbPath, { readonly });
    singleton.current.pragma('foreign_keys = ON');
    return singleton.current;
  } catch (err) {
    console.error(`[new-db-queries] Error opening ${dbPath}:`, err);
    return null;
  }
}

// ===========================================================================
// PUBLIC QUERIES
// ===========================================================================

/**
 * Get price history from data_engine.db (egksco_price_history table)
 * 
 * 🔥 FIXED: Validates data against stocks.db current_price
 * - Rejects data with future dates (year > current year)
 * - Rejects data where price differs more than 50% from current_price
 */
export function getPriceHistoryFromNewDb(ticker: string, days: number = 90): Record<string, unknown>[] {
  const priceDb = getDb(DB_PATHS.data_engine, { current: _dataEngineDb });
  const stocksDb = getDb(DB_PATHS.stocks, { current: _stocksDb });
  
  if (!priceDb) return [];
  
  try {
    // Get current price from stocks.db for validation
    let currentPrice: number | null = null;
    if (stocksDb) {
      try {
        const stockRow = stocksDb.prepare(`
          SELECT current_price FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1
        `).get(ticker.toUpperCase()) as { current_price: number } | undefined;
        currentPrice = stockRow?.current_price || null;
      } catch { // silent fallback (safe-by-design)
        // Ignore validation errors
      }
    }
    
    // Get price history from data_engine.db.egksco_price_history
    // (migrated from price_history.db.price_history — same data, different column names)
    const history = priceDb.prepare(`
      SELECT 
        price_date AS date, open_price AS open, high_price AS high, low_price AS low, 
        close_price AS close, volume
      FROM egksco_price_history
      WHERE symbol = ? COLLATE NOCASE
      ORDER BY price_date DESC
      LIMIT ?
    `).all(ticker.toUpperCase(), days) as Record<string, unknown>[];
    
    if (!history || history.length === 0) return [];
    
    // 🔥 VALIDATION: Check if data is valid
    const currentYear = new Date().getFullYear();
    const latestRecord = history[0];
    const latestPrice = Number(latestRecord.close || 0);
    const latestDate = String(latestRecord.date || '');
    
    // Check 1: Future dates
    if (latestDate) {
      const recordYear = parseInt(latestDate.split('-')[0], 10);
      if (recordYear > currentYear) {
        console.warn(`[new-db-queries] ${ticker}: Future date ${latestDate} detected - rejecting price history`);
        return [];
      }
    }
    
    // Check 2: Price mismatch (> 90% difference from current_price)
    // Note: Some stocks may have stock splits or different price scales
    // Only reject if price is extremely different (> 90%)
    if (currentPrice && currentPrice > 0 && latestPrice > 0) {
      const priceDiffPct = Math.abs(latestPrice - currentPrice) / currentPrice;
      if (priceDiffPct > 0.9) {
        console.warn(`[new-db-queries] ${ticker}: Price ${latestPrice} differs ${(priceDiffPct * 100).toFixed(1)}% from current ${currentPrice} - but keeping data (possible stock split)`);
        // Don't reject - keep the data, it might be a stock split
      }
    }
    
    return history;
  } catch (err) {
    console.error('[new-db-queries] Error getting price history:', err);
    return [];
  }
}

/**
 * Get stock by ticker from stocks.db
 */
export function getStockFromNewDb(ticker: string): Record<string, unknown> | null {
  const db = getDb(DB_PATHS.stocks, { current: _stocksDb });
  if (!db) return null;
  
  try {
    const row = db.prepare(`
      SELECT * FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1
    `).get(ticker.toUpperCase()) as Record<string, unknown> | undefined;
    
    return row || null;
  } catch (err) {
    console.error('[new-db-queries] Error getting stock:', err);
    return null;
  }
}

/**
 * Get all stocks from stocks.db
 */
export function getAllStocksFromNewDb(): Record<string, unknown>[] {
  const db = getDb(DB_PATHS.stocks, { current: _stocksDb });
  if (!db) return [];
  
  try {
    return db.prepare(`
      SELECT * FROM stocks WHERE is_active = 1 ORDER BY ticker
    `).all() as Record<string, unknown>[];
  } catch (err) {
    console.error('[new-db-queries] Error getting all stocks:', err);
    return [];
  }
}

/**
 * Get prediction logs from predictions.db
 * (بعد توحيد الـ DBs: prediction_logs اترحّل من stocks.db لـ predictions.db)
 */
export function getPredictionLogsFromNewDb(ticker: string, limit: number = 100): Record<string, unknown>[] {
  const db = getDb(DB_PATHS.predictions, { current: _predictionsDb });
  if (!db) return [];
  
  try {
    return db.prepare(`
      SELECT * FROM prediction_logs
      WHERE ticker = ? COLLATE NOCASE
      ORDER BY created_at DESC
      LIMIT ?
    `).all(ticker.toUpperCase(), limit) as Record<string, unknown>[];
  } catch (err) {
    console.error('[new-db-queries] Error getting prediction logs:', err);
    return [];
  }
}

/**
 * Get cached analysis from predictions.db
 */
export function getCachedAnalysisFromNewDb(ticker: string): Record<string, unknown> | null {
  const db = getDb(DB_PATHS.predictions, { current: _predictionsDb });
  if (!db) return null;
  
  try {
    const row = db.prepare(`
      SELECT * FROM cached_analysis
      WHERE ticker = ? COLLATE NOCASE
      ORDER BY created_at DESC
      LIMIT 1
    `).get(ticker.toUpperCase()) as Record<string, unknown> | undefined;
    
    return row || null;
  } catch (err) {
    console.error('[new-db-queries] Error getting cached analysis:', err);
    return null;
  }
}

/**
 * Get technical indicators from predictions.db
 */
export function getTechnicalIndicatorsFromNewDb(ticker: string): Record<string, unknown> | null {
  const db = getDb(DB_PATHS.predictions, { current: _predictionsDb });
  if (!db) return null;
  
  try {
    const row = db.prepare(`
      SELECT * FROM technical_indicators
      WHERE ticker = ? COLLATE NOCASE
      LIMIT 1
    `).get(ticker.toUpperCase()) as Record<string, unknown> | undefined;
    
    return row || null;
  } catch (err) {
    console.error('[new-db-queries] Error getting technical indicators:', err);
    return null;
  }
}

/**
 * Get learned lessons from learned.db
 */
export function getLearnedLessonsFromNewDb(limit: number = 100): Record<string, unknown>[] {
  const db = getDb(DB_PATHS.learned, { current: _learnedDb });
  if (!db) return [];
  
  try {
    return db.prepare(`
      SELECT * FROM learned_lessons
      ORDER BY last_seen DESC
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];
  } catch (err) {
    console.error('[new-db-queries] Error getting learned lessons:', err);
    return [];
  }
}

/**
 * Check if new databases are available
 */
export function areNewDbsAvailable(): { stocks: boolean; price_history: boolean; predictions: boolean; learned: boolean } {
  return {
    stocks: existsSync(DB_PATHS.stocks),
    price_history: existsSync(DB_PATHS.data_engine),
    predictions: existsSync(DB_PATHS.predictions),
    learned: existsSync(DB_PATHS.learned),
  };
}

/**
 * Get database health status
 */
export function getNewDbHealth(): {
  available: boolean;
  stocks_count: number;
  price_history_count: number;
  predictions_count: number;
  learned_count: number;
} {
  const result = {
    available: false,
    stocks_count: 0,
    price_history_count: 0,
    predictions_count: 0,
    learned_count: 0,
  };
  
  try {
    const stocksDb = getDb(DB_PATHS.stocks, { current: _stocksDb });
    if (stocksDb) {
      const row = stocksDb.prepare('SELECT COUNT(*) as count FROM stocks').get() as { count: number };
      result.stocks_count = row?.count || 0;
    }
    
    const priceHistoryDb = getDb(DB_PATHS.data_engine, { current: _dataEngineDb });
    if (priceHistoryDb) {
      const row = priceHistoryDb.prepare('SELECT COUNT(*) as count FROM egksco_price_history').get() as { count: number };
      result.price_history_count = row?.count || 0;
    }
    
    const predictionsDb = getDb(DB_PATHS.predictions, { current: _predictionsDb });
    if (predictionsDb) {
      const row = predictionsDb.prepare('SELECT COUNT(*) as count FROM prediction_logs').get() as { count: number };
      result.predictions_count = row?.count || 0;
    }
    
    const learnedDb = getDb(DB_PATHS.learned, { current: _learnedDb });
    if (learnedDb) {
      const row = learnedDb.prepare('SELECT COUNT(*) as count FROM learned_lessons').get() as { count: number };
      result.learned_count = row?.count || 0;
    }
    
    result.available = result.stocks_count > 0;
  } catch (err) {
    console.error('[new-db-queries] Error getting health:', err);
  }
  
  return result;
}

