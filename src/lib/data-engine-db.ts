/**
 * Data Engine Database Client
 * ============================
 * Multi-database architecture:
 * - data_engine.db: Live stock/crypto/gold/silver prices + historical (egksco_price_history)
 * - stocks.db: Synced stocks with last_update
 * - auth.db: User preferences (country, favorite_market)
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import { existsSync } from 'fs';

// ===========================================================================
// DATABASE CONNECTIONS
// ===========================================================================

let _dataEngineDb: Database.Database | null = null;
let _stocksDb: Database.Database | null = null;

/**
 * Get data_engine.db connection (live prices)
 */
export function getDataEngineDb(): Database.Database {
  if (_dataEngineDb) {
    try { _dataEngineDb.prepare('SELECT 1').get(); return _dataEngineDb; }
    catch { try { _dataEngineDb.close(); } catch { /* ignore - safe-by-design */ } _dataEngineDb = null; }
  }
  const dbPath = path.join(process.cwd(), 'db', 'data_engine.db');
  if (!existsSync(dbPath)) {
    throw new Error(`Data Engine DB not found at ${dbPath}`);
  }
  // Read-write so the WAL journal (maintained by the Python service) can be reconciled.
  // Readonly mode fails with "file is not a database" when Python has uncommitted WAL pages.
  const busyTimeout = 10000;
  try {
    _dataEngineDb = new Database(dbPath, { timeout: busyTimeout });
    _dataEngineDb.pragma(`busy_timeout = ${busyTimeout}`);
  } catch (e) {
    _dataEngineDb = new Database(dbPath, { readonly: true, timeout: busyTimeout });
    _dataEngineDb.pragma(`busy_timeout = ${busyTimeout}`);
  }
  console.log('[data-engine-db] Loaded data_engine.db (read-write for WAL reconcile)');
  return _dataEngineDb;
}

/**
 * Get price_history.db connection (historical data)
 * 
 * NOTE: price_history.db was removed. Now reads from data_engine.db.egksco_price_history.
 * Returns the same connection as getDataEngineDb() for backward compatibility.
 */
export function getPriceHistoryDb(): Database.Database {
  // Backward-compatible: route to data_engine.db connection
  return getDataEngineDb();
}

/**
 * Get stocks.db connection (synced stocks with last_update)
 */
export function getStocksDb(): Database.Database {
  if (_stocksDb) {
    try { _stocksDb.prepare('SELECT 1').get(); return _stocksDb; }
    catch { try { _stocksDb.close(); } catch { /* ignore - safe-by-design */ } _stocksDb = null; }
  }
  const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
  if (!existsSync(dbPath)) {
    throw new Error(`Stocks DB not found at ${dbPath}`);
  }
  // Read-write so WAL (maintained by Python service) reconciles; readonly fails with NOTADB.
  const busyTimeout = 10000;
  try {
    _stocksDb = new Database(dbPath, { timeout: busyTimeout });
    _stocksDb.pragma(`busy_timeout = ${busyTimeout}`);
  } catch (e) {
    _stocksDb = new Database(dbPath, { readonly: true, timeout: busyTimeout });
    _stocksDb.pragma(`busy_timeout = ${busyTimeout}`);
  }
  console.log('[data-engine-db] Loaded stocks.db (read-write for WAL reconcile)');
  return _stocksDb;
}

// ===========================================================================
// CACHING
// ===========================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const _cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 60_000; // 1 minute

function getCached<T>(key: string): T | null {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data as T;
  }
  return null;
}

function setCache<T>(key: string, data: T): void {
  _cache.set(key, { data, timestamp: Date.now() });
}

// ===========================================================================
// TYPES
// ===========================================================================

export interface DataEngineStock {
  id: number;
  symbol: string;
  name: string | null;
  price: number | null;
  change_percent: number | null;
  volume: string | null;
  market_cap: string | null;
  market: string;
  created_at: string | null;
}

export interface DataEngineCrypto {
  id: number;
  timestamp: string;
  rank: number | null;
  symbol: string;
  name: string;
  price_usd: number | null;
  price_change_24h: number | null;
  price_change_7d: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
  total_volume: number | null;
  circulating_supply: number | null;
}

export interface DataEngineGoldPrice {
  id: number;
  timestamp: string;
  country: string;
  currency: string;
  karat: string;
  price_per_gram: number | null;
  price_per_ounce: number | null;
}

export interface DataEngineSilverPrice {
  id: number;
  timestamp: string;
  country: string;
  currency: string;
  price_per_gram: number | null;
  price_per_ounce: number | null;
}

export interface DataEngineExchangeRate {
  id: number;
  timestamp: string;
  currency: string;
  rate_to_usd: number | null;
}

export interface PriceHistoryRecord {
  id: number;
  ticker: string;
  name: string | null;
  category: string | null;
  date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  market: string | null;
}

export interface MarketStats {
  total: number;
  rising: number;
  falling: number;
  unchanged: number;
}

// ===========================================================================
// MARKET CODE MAPPING
// ===========================================================================

/**
 * Map English market codes to Arabic market names used in database
 */
const MARKET_CODE_TO_ARABIC: Record<string, string> = {
  'EGX': 'مصر',
  'TADAWUL': 'السعودية',
  'KSA': 'السعودية',
  'KSE': 'الكويت',
  'QSE': 'قطر',
  'DFM': 'الإمارات',
  'ADX': 'الإمارات',
  'BSE': 'البحرين',
};

const ARABIC_TO_MARKET_CODE: Record<string, string> = {
  'مصر': 'EGX',
  'السعودية': 'TADAWUL',
  'الكويت': 'KSE',
  'قطر': 'QSE',
  'الإمارات': 'DFM',
  'البحرين': 'BSE',
};

/**
 * Convert market code to Arabic market name for database queries
 */
export function marketCodeToArabic(code: string): string {
  return MARKET_CODE_TO_ARABIC[code.toUpperCase()] || code;
}

/**
 * Convert Arabic market name to market code
 */
export function arabicToMarketCode(arabic: string): string {
  return ARABIC_TO_MARKET_CODE[arabic] || arabic;
}

// ===========================================================================
// STOCK QUERIES
// ===========================================================================

/**
 * Get market statistics (optionally filtered by market)
 */
export function getMarketStats(market?: string): MarketStats {
  const cacheKey = `market_stats:${market || 'all'}`;
  const cached = getCached<MarketStats>(cacheKey);
  if (cached) return cached;

  const db = getDataEngineDb();
  const marketName = market ? marketCodeToArabic(market) : null;

  try {
    let total = 0;
    let rising = 0;
    let falling = 0;
    let unchanged = 0;

    if (marketName) {
      total = (db.prepare('SELECT COUNT(*) as count FROM stocks WHERE market = ?').get(marketName) as { count: number })?.count || 0;
      rising = (db.prepare('SELECT COUNT(*) as count FROM stocks WHERE change_percent > 0 AND market = ?').get(marketName) as { count: number })?.count || 0;
      falling = (db.prepare('SELECT COUNT(*) as count FROM stocks WHERE change_percent < 0 AND market = ?').get(marketName) as { count: number })?.count || 0;
      unchanged = (db.prepare('SELECT COUNT(*) as count FROM stocks WHERE (change_percent = 0 OR change_percent IS NULL) AND market = ?').get(marketName) as { count: number })?.count || 0;
    } else {
      total = (db.prepare('SELECT COUNT(*) as count FROM stocks').get() as { count: number })?.count || 0;
      rising = (db.prepare('SELECT COUNT(*) as count FROM stocks WHERE change_percent > 0').get() as { count: number })?.count || 0;
      falling = (db.prepare('SELECT COUNT(*) as count FROM stocks WHERE change_percent < 0').get() as { count: number })?.count || 0;
      unchanged = (db.prepare('SELECT COUNT(*) as count FROM stocks WHERE change_percent = 0 OR change_percent IS NULL').get() as { count: number })?.count || 0;
    }

    const result = { total, rising, falling, unchanged };
    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.warn('[data-engine-db] getMarketStats error:', err);
    return { total: 0, rising: 0, falling: 0, unchanged: 0 };
  }
}

/**
 * Get stocks by market
 */
export function getStocksByMarket(market: string, limit: number = 50): DataEngineStock[] {
  const cacheKey = `stocks_market:${market}:${limit}`;
  const cached = getCached<DataEngineStock[]>(cacheKey);
  if (cached) return cached;

  const db = getDataEngineDb();
  const marketName = marketCodeToArabic(market);

  try {
    const stocks = db.prepare(`
      SELECT * FROM stocks
      WHERE market = ?
      ORDER BY volume DESC
      LIMIT ?
    `).all(marketName, limit) as DataEngineStock[];
    
    setCache(cacheKey, stocks);
    return stocks;
  } catch (err) {
    console.warn('[data-engine-db] getStocksByMarket error:', err);
    return [];
  }
}

/**
 * Get all stocks with pagination
 */
export function getAllStocks(page: number = 1, pageSize: number = 50, market?: string): {
  data: DataEngineStock[];
  total: number;
  page: number;
  total_pages: number;
} {
  const cacheKey = `all_stocks:${page}:${pageSize}:${market || 'all'}`;
  const cached = getCached<{ data: DataEngineStock[]; total: number; page: number; total_pages: number }>(cacheKey);
  if (cached) return cached;

  const db = getDataEngineDb();
  const offset = (page - 1) * pageSize;
  const marketName = market ? marketCodeToArabic(market) : null;

  try {
    let total = 0;
    let stocks: DataEngineStock[] = [];

    if (marketName) {
      total = (db.prepare('SELECT COUNT(*) as count FROM stocks WHERE market = ?').get(marketName) as { count: number })?.count || 0;
      stocks = db.prepare('SELECT * FROM stocks WHERE market = ? ORDER BY volume DESC LIMIT ? OFFSET ?').all(marketName, pageSize, offset) as DataEngineStock[];
    } else {
      total = (db.prepare('SELECT COUNT(*) as count FROM stocks').get() as { count: number })?.count || 0;
      stocks = db.prepare('SELECT * FROM stocks ORDER BY volume DESC LIMIT ? OFFSET ?').all(pageSize, offset) as DataEngineStock[];
    }

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const result = { data: stocks, total, page, total_pages: totalPages };
    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.warn('[data-engine-db] getAllStocks error:', err);
    return { data: [], total: 0, page, total_pages: 0 };
  }
}

/**
 * Get stock by symbol
 */
export function getStockBySymbol(symbol: string): DataEngineStock | null {
  const db = getDataEngineDb();

  try {
    return db.prepare('SELECT * FROM stocks WHERE symbol = ? COLLATE NOCASE LIMIT 1').get(symbol) as DataEngineStock | null;
  } catch (err) {
    console.warn('[data-engine-db] getStockBySymbol error:', err);
    return null;
  }
}

/**
 * Get top movers
 */
export function getTopMovers(market?: string, limit: number = 10): {
  gainers: DataEngineStock[];
  losers: DataEngineStock[];
} {
  const cacheKey = `top_movers:${market || 'all'}:${limit}`;
  const cached = getCached<{ gainers: DataEngineStock[]; losers: DataEngineStock[] }>(cacheKey);
  if (cached) return cached;

  const db = getDataEngineDb();
  const marketName = market ? marketCodeToArabic(market) : null;

  try {
    let stocks: DataEngineStock[] = [];
    
    if (marketName) {
      stocks = db.prepare('SELECT * FROM stocks WHERE change_percent IS NOT NULL AND market = ?').all(marketName) as DataEngineStock[];
    } else {
      stocks = db.prepare('SELECT * FROM stocks WHERE change_percent IS NOT NULL').all() as DataEngineStock[];
    }

    const gainers = stocks
      .filter(s => (s.change_percent || 0) > 0)
      .sort((a, b) => (b.change_percent || 0) - (a.change_percent || 0))
      .slice(0, limit);

    const losers = stocks
      .filter(s => (s.change_percent || 0) < 0)
      .sort((a, b) => (a.change_percent || 0) - (b.change_percent || 0))
      .slice(0, limit);

    const result = { gainers, losers };
    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.warn('[data-engine-db] getTopMovers error:', err);
    return { gainers: [], losers: [] };
  }
}

// ===========================================================================
// GOLD QUERIES
// ===========================================================================

/**
 * Get latest gold prices
 */
export function getLatestGoldPrices(): DataEngineGoldPrice[] {
  const cacheKey = 'gold_prices_latest';
  const cached = getCached<DataEngineGoldPrice[]>(cacheKey);
  if (cached) return cached;

  const db = getDataEngineDb();

  try {
    const prices = db.prepare(`
      SELECT * FROM gold_prices
      WHERE timestamp = (SELECT MAX(timestamp) FROM gold_prices)
      ORDER BY country, karat
    `).all() as DataEngineGoldPrice[];
    
    setCache(cacheKey, prices);
    return prices;
  } catch (err) {
    console.warn('[data-engine-db] getLatestGoldPrices error:', err);
    return [];
  }
}

/**
 * Get gold prices by country
 */
export function getGoldPricesByCountry(country: string): DataEngineGoldPrice[] {
  const cacheKey = `gold_prices_country:${country}`;
  const cached = getCached<DataEngineGoldPrice[]>(cacheKey);
  if (cached) return cached;

  const db = getDataEngineDb();

  try {
    const prices = db.prepare(`
      SELECT * FROM gold_prices
      WHERE country = ?
      ORDER BY timestamp DESC, karat
      LIMIT 20
    `).all(country) as DataEngineGoldPrice[];
    
    setCache(cacheKey, prices);
    return prices;
  } catch (err) {
    console.warn('[data-engine-db] getGoldPricesByCountry error:', err);
    return [];
  }
}

// ===========================================================================
// EGYPT GOLD PRICES — CANONICAL SOURCE (v3.65.1+)
// ===========================================================================
// This is the SINGLE canonical way to read Egypt gold prices (24k/21k/18k).
// data_engine.db.gold_prices is written live by metals_forex_fetcher.py every
// 5 minutes. The old `stocks.db.gold_prices` (3 stale rows from 2026-06-03)
// is being DROPPED — see Documentation/DB_CLEANUP_PLAN_v3.65.1.md P0-2.
//
// Migration replaces 6 stale readers + 1 writer that were querying
// stocks.db.gold_prices (which had ~16% stale prices vs live data_engine.db).
// ===========================================================================

export interface EgyptGoldPrices {
  '24k': number;
  '21k': number;
  '18k': number;
  timestamp?: string | null;
  source?: 'gold_prices' | 'gold_prices_clean';
}

/** Egypt country aliases used across the data_engine.db scrapers. */
const _EGYPT_COUNTRIES = "('EG', 'Egypt', 'EGY', 'مصر')";

/**
 * Parse karat rows into the {24k, 21k, 18k} triple.
 * Accepts karat strings in multiple formats:
 *   - Numeric: "24", "24k", "999"
 *   - Arabic: "عيار 24", "عيار 21", "عيار 18"
 *   - Mixed: "24K", "21 k", etc.
 * Falls back to proportional math if any karat is missing.
 *
 * Note: data_engine.db.gold_prices (written by metals_forex_fetcher.py) uses
 * Arabic "عيار N" format. The old stocks.db.gold_prices used numeric "N".
 */
function _parseEgyptGoldRows(
  rows: { karat: string; price_per_gram: number | null }[],
): EgyptGoldPrices | null {
  let p24 = 0, p21 = 0, p18 = 0;
  for (const r of rows) {
    const raw = String(r.karat ?? '');
    // Extract the first 2-3 digit number from the karat string.
    // Handles "24", "24k", "999", "عيار 24", "21 k", etc.
    const match = raw.match(/(\d{2,3})/);
    if (!match) continue;
    const k = parseInt(match[1], 10);
    const p = Number(r.price_per_gram) || 0;
    // Map: 24 or 999 (purity) → 24k; 21 or 875 → 21k; 18 or 750 → 18k
    if ((k === 24 || k === 999) && p > 0) p24 = p;
    else if ((k === 21 || k === 875) && p > 0) p21 = p;
    else if ((k === 18 || k === 750) && p > 0) p18 = p;
  }
  if (p24 > 0 || p21 > 0) {
    return {
      '24k': p24 || p21 / 0.875,
      '21k': p21 || p24 * 0.875,
      '18k': p18 || (p21 ? p21 * (18 / 21) : p24 * 0.75),
    };
  }
  return null;
}

/**
 * Get latest Egypt gold prices (24k, 21k, 18k) from data_engine.db.
 *
 * Strategy:
 * 1. Try `gold_prices` (live multicountry, written every 5 min by metals_forex_fetcher).
 *    Filter Egypt rows at the latest timestamp.
 * 2. Fallback: `gold_prices_clean` (Egypt-only deduped time series).
 *
 * Returns null if both fail — caller should use its own hardcoded fallback.
 *
 * @param ttlSeconds override cache TTL (default 60s)
 */
export function getLiveEgyptGoldPrices(ttlSeconds?: number): EgyptGoldPrices | null {
  const cacheKey = 'gold_prices_egypt_live';
  const cached = getCached<EgyptGoldPrices | null>(cacheKey);
  if (cached !== null) return cached;

  const db = getDataEngineDb();

  try {
    // Step 1: gold_prices (live, multicountry)
    const latestTs = db.prepare(
      `SELECT MAX(timestamp) AS ts FROM gold_prices WHERE country IN ${_EGYPT_COUNTRIES}`,
    ).get() as { ts: string | null } | undefined;

    if (latestTs?.ts) {
      const rows = db.prepare(
        `SELECT karat, price_per_gram FROM gold_prices
         WHERE country IN ${_EGYPT_COUNTRIES} AND timestamp = ?`,
      ).all(latestTs.ts) as { karat: string; price_per_gram: number | null }[];

      const result = _parseEgyptGoldRows(rows);
      if (result) {
        result.timestamp = latestTs.ts;
        result.source = 'gold_prices';
        setCache(cacheKey, result);
        return result;
      }
    }

    // Step 2: gold_prices_clean (Egypt-only deduped)
    const latestCleanTs = db.prepare(
      `SELECT MAX(timestamp) AS ts FROM gold_prices_clean WHERE country IN ${_EGYPT_COUNTRIES}`,
    ).get() as { ts: string | null } | undefined;

    if (latestCleanTs?.ts) {
      const rows = db.prepare(
        `SELECT karat, price_per_gram FROM gold_prices_clean
         WHERE country IN ${_EGYPT_COUNTRIES} AND timestamp = ?`,
      ).all(latestCleanTs.ts) as { karat: string; price_per_gram: number | null }[];

      const result = _parseEgyptGoldRows(rows);
      if (result) {
        result.timestamp = latestCleanTs.ts;
        result.source = 'gold_prices_clean';
        setCache(cacheKey, result);
        return result;
      }
    }

    console.warn('[data-engine-db] getLiveEgyptGoldPrices: no Egypt rows in data_engine.db');
    return null;
  } catch (err) {
    console.warn('[data-engine-db] getLiveEgyptGoldPrices error:', err);
    return null;
  }
}

// ===========================================================================
// SILVER QUERIES
// ===========================================================================

/**
 * Get latest silver prices
 */
export function getLatestSilverPrices(): DataEngineSilverPrice[] {
  const cacheKey = 'silver_prices_latest';
  const cached = getCached<DataEngineSilverPrice[]>(cacheKey);
  if (cached) return cached;

  const db = getDataEngineDb();

  try {
    const prices = db.prepare(`
      SELECT * FROM silver_prices
      WHERE timestamp = (SELECT MAX(timestamp) FROM silver_prices)
      ORDER BY country
    `).all() as DataEngineSilverPrice[];
    
    setCache(cacheKey, prices);
    return prices;
  } catch (err) {
    console.warn('[data-engine-db] getLatestSilverPrices error:', err);
    return [];
  }
}

// ===========================================================================
// EXCHANGE RATES QUERIES
// ===========================================================================

/**
 * Get latest exchange rates
 */
export function getLatestExchangeRates(): DataEngineExchangeRate[] {
  const cacheKey = 'exchange_rates_latest';
  const cached = getCached<DataEngineExchangeRate[]>(cacheKey);
  if (cached) return cached;

  const db = getDataEngineDb();

  try {
    const rates = db.prepare(`
      SELECT * FROM exchange_rates
      WHERE timestamp = (SELECT MAX(timestamp) FROM exchange_rates)
      ORDER BY currency
    `).all() as DataEngineExchangeRate[];
    
    setCache(cacheKey, rates);
    return rates;
  } catch (err) {
    console.warn('[data-engine-db] getLatestExchangeRates error:', err);
    return [];
  }
}

// ===========================================================================
// CRYPTO QUERIES
// ===========================================================================

/**
 * Get latest crypto prices
 */
export function getLatestCryptoPrices(limit: number = 50): DataEngineCrypto[] {
  const cacheKey = `crypto_prices_latest:${limit}`;
  const cached = getCached<DataEngineCrypto[]>(cacheKey);
  if (cached) return cached;

  const db = getDataEngineDb();

  try {
    const prices = db.prepare(`
      SELECT * FROM crypto_prices
      WHERE timestamp = (SELECT MAX(timestamp) FROM crypto_prices)
      ORDER BY rank ASC
      LIMIT ?
    `).all(limit) as DataEngineCrypto[];
    
    setCache(cacheKey, prices);
    return prices;
  } catch (err) {
    console.warn('[data-engine-db] getLatestCryptoPrices error:', err);
    return [];
  }
}

/**
 * Get crypto by symbol
 */
export function getCryptoBySymbol(symbol: string): DataEngineCrypto | null {
  const db = getDataEngineDb();

  try {
    return db.prepare(`
      SELECT * FROM crypto_prices
      WHERE symbol = ? COLLATE NOCASE
      ORDER BY timestamp DESC
      LIMIT 1
    `).get(symbol) as DataEngineCrypto | null;
  } catch (err) {
    console.warn('[data-engine-db] getCryptoBySymbol error:', err);
    return null;
  }
}

// ===========================================================================
// HISTORICAL QUERIES (from data_engine.db.egksco_price_history — migrated from price_history.db)
// ===========================================================================

/**
 * Get historical data for a symbol from data_engine.db.egksco_price_history
 */
export function getHistoricalData(symbol: string, limit: number = 100): PriceHistoryRecord[] {
  const cacheKey = `historical:${symbol}:${limit}`;
  const cached = getCached<PriceHistoryRecord[]>(cacheKey);
  if (cached) return cached;

  const db = getPriceHistoryDb();

  try {
    const data = db.prepare(`
      SELECT 
        id, 
        symbol AS ticker, 
        NULL AS name, 
        NULL AS category, 
        price_date AS date, 
        open_price AS open, 
        high_price AS high, 
        low_price AS low, 
        close_price AS close, 
        volume, 
        NULL AS market
      FROM egksco_price_history
      WHERE symbol = ?
      ORDER BY price_date DESC
      LIMIT ?
    `).all(symbol, limit) as PriceHistoryRecord[];
    
    setCache(cacheKey, data);
    return data;
  } catch (err) {
    console.warn('[data-engine-db] getHistoricalData error:', err);
    return [];
  }
}

/**
 * Get historical data by market
 * 
 * NOTE: egksco_price_history doesn't have a 'market' column.
 * This function returns empty array (legacy — callers should use getHistoricalData per ticker).
 */
export function getHistoricalByMarket(market: string, limit: number = 100): PriceHistoryRecord[] {
  const cacheKey = `historical_market:${market}:${limit}`;
  const cached = getCached<PriceHistoryRecord[]>(cacheKey);
  if (cached) return cached;

  // egksco_price_history has no 'market' column — return empty
  console.warn('[data-engine-db] getHistoricalByMarket: egksco_price_history has no market column — returning empty');
  return [];
}

/**
 * Get available date range for a symbol
 */
export function getHistoricalDateRange(symbol: string): { minDate: string; maxDate: string; count: number } {
  const db = getPriceHistoryDb();

  try {
    const result = db.prepare(`
      SELECT 
        MIN(price_date) as minDate, 
        MAX(price_date) as maxDate, 
        COUNT(*) as count 
      FROM egksco_price_history 
      WHERE symbol = ?
    `).get(symbol) as { minDate: string; maxDate: string; count: number };
    
    return result || { minDate: '', maxDate: '', count: 0 };
  } catch (err) {
    console.warn('[data-engine-db] getHistoricalDateRange error:', err);
    return { minDate: '', maxDate: '', count: 0 };
  }
}

// ===========================================================================
// LAST UPDATE TIME
// ===========================================================================

/**
 * Get last update time from stocks table
 * IMPORTANT: Reads from stocks.db (synced data) not data_engine.db
 * stocks.db has 'last_update' column that is updated during sync
 */
export function getLastStocksUpdateTime(): string | null {
  // First try stocks.db (has last_update column from sync)
  try {
    const stocksDb = getStocksDb();
    const result = stocksDb.prepare(`
      SELECT MAX(last_update) as last_update FROM stocks WHERE last_update IS NOT NULL
    `).get() as { last_update: string | null };
    
    if (result?.last_update) {
      return result.last_update;
    }
  } catch (err) {
    console.warn('[data-engine-db] getLastStocksUpdateTime from stocks.db error:', err);
  }
  
  // Fallback to data_engine.db created_at (less reliable - creation time, not update time)
  try {
    const db = getDataEngineDb();
    const result = db.prepare(`
      SELECT MAX(created_at) as last_update FROM stocks WHERE created_at IS NOT NULL
    `).get() as { last_update: string | null };
    
    return result?.last_update || null;
  } catch (err) {
    console.warn('[data-engine-db] getLastStocksUpdateTime from data_engine.db error:', err);
    return null;
  }
}

/**
 * Get last update time from crypto_prices table
 */
export function getLastCryptoUpdateTime(): string | null {
  const db = getDataEngineDb();
  
  try {
    const result = db.prepare(`
      SELECT MAX(timestamp) as last_update FROM crypto_prices
    `).get() as { last_update: string | null };
    
    return result?.last_update || null;
  } catch (err) {
    console.warn('[data-engine-db] getLastCryptoUpdateTime error:', err);
    return null;
  }
}

/**
 * Get last update time from gold_prices table
 */
export function getLastGoldUpdateTime(): string | null {
  const db = getDataEngineDb();
  
  try {
    const result = db.prepare(`
      SELECT MAX(timestamp) as last_update FROM gold_prices
    `).get() as { last_update: string | null };
    
    return result?.last_update || null;
  } catch (err) {
    console.warn('[data-engine-db] getLastGoldUpdateTime error:', err);
    return null;
  }
}

/**
 * Get last update time from silver_prices table
 */
export function getLastSilverUpdateTime(): string | null {
  const db = getDataEngineDb();
  
  try {
    const result = db.prepare(`
      SELECT MAX(timestamp) as last_update FROM silver_prices
    `).get() as { last_update: string | null };
    
    return result?.last_update || null;
  } catch (err) {
    console.warn('[data-engine-db] getLastSilverUpdateTime error:', err);
    return null;
  }
}

/**
 * Get last update time from exchange_rates table
 */
export function getLastForexUpdateTime(): string | null {
  const db = getDataEngineDb();
  
  try {
    const result = db.prepare(`
      SELECT MAX(timestamp) as last_update FROM exchange_rates
    `).get() as { last_update: string | null };
    
    return result?.last_update || null;
  } catch (err) {
    console.warn('[data-engine-db] getLastForexUpdateTime error:', err);
    return null;
  }
}

/**
 * Get all last update times
 */
export function getAllLastUpdateTimes() {
  return {
    stocks: getLastStocksUpdateTime(),
    crypto: getLastCryptoUpdateTime(),
    gold: getLastGoldUpdateTime(),
    silver: getLastSilverUpdateTime(),
    forex: getLastForexUpdateTime(),
  };
}

// ===========================================================================
// MARKET BREAKDOWN
// ===========================================================================

export interface MarketBreakdown {
  market: string;
  market_code: string;
  market_name: string;
  country: string;
  flag: string;
  count: number;
  rising: number;
  falling: number;
}

/**
 * Get market breakdown
 */
export function getMarketBreakdown(): MarketBreakdown[] {
  const cacheKey = 'market_breakdown';
  const cached = getCached<MarketBreakdown[]>(cacheKey);
  if (cached) return cached;

  const db = getDataEngineDb();

  const marketInfo: Record<string, { code: string; name: string; country: string; flag: string }> = {
    'مصر': { code: 'EGX', name: 'البورصة المصرية', country: 'مصر', flag: '🇪🇬' },
    'السعودية': { code: 'TADAWUL', name: 'تداول السعودية', country: 'السعودية', flag: '🇸🇦' },
    'الكويت': { code: 'KSE', name: 'بورصة الكويت', country: 'الكويت', flag: '🇰🇼' },
    'قطر': { code: 'QSE', name: 'بورصة قطر', country: 'قطر', flag: '🇶🇦' },
  };

  try {
    const rows = db.prepare(`
      SELECT
        market,
        COUNT(*) as count,
        SUM(CASE WHEN change_percent > 0 THEN 1 ELSE 0 END) as rising,
        SUM(CASE WHEN change_percent < 0 THEN 1 ELSE 0 END) as falling
      FROM stocks
      GROUP BY market
      ORDER BY count DESC
    `).all() as { market: string; count: number; rising: number; falling: number }[];

    const result: MarketBreakdown[] = rows.map(row => {
      const info = marketInfo[row.market] || { code: row.market, name: row.market, country: row.market, flag: '🌐' };
      return {
        market: row.market,
        market_code: info.code,
        market_name: info.name,
        country: info.country,
        flag: info.flag,
        count: row.count,
        rising: row.rising || 0,
        falling: row.falling || 0,
      };
    });

    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.warn('[data-engine-db] getMarketBreakdown error:', err);
    return [];
  }
}

// ===========================================================================
// USER MARKET PREFERENCE
// ===========================================================================

/**
 * Get user's favorite market from auth.db
 */
export async function getUserFavoriteMarket(userId: string): Promise<string> {
  const { authDb } = await import('./db-auth');
  
  try {
    const user = await authDb.user.findUnique({
      where: { id: userId },
      select: { favorite_market: true, country: true }
    });
    
    return user?.favorite_market || 'EGX';
  } catch (err) {
    console.warn('[data-engine-db] getUserFavoriteMarket error:', err);
    return 'EGX';
  }
}

// ===========================================================================
// INITIALIZATION (for backward compatibility)
// ===========================================================================

export async function ensureDataEngineDbInitialized(): Promise<void> {
  // Pre-initialize connections
  getDataEngineDb();
  // getPriceHistoryDb() now returns the same connection as getDataEngineDb()
  // No need to separately initialize it.
}

// ===========================================================================
// RESET
// ===========================================================================

export function resetDataEngineDbState(): void {
  if (_dataEngineDb) { _dataEngineDb.close(); _dataEngineDb = null; }
  if (_stocksDb) { _stocksDb.close(); _stocksDb = null; }
  // _priceHistoryDb removed — now uses _dataEngineDb connection
  _cache.clear();
  console.log('[data-engine-db] State reset');
}
