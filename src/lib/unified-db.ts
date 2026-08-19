/**
 * Unified Database Client
 * 
 * This module provides access to:
 * - unified_stocks.db: All Arab stocks (EGX, KSA, DFM, KSE, QSE, BSE)
 * - crypto.db: Cryptocurrency data
 */

import { createDatabase, initialize, isInitialized, type SqliteDatabase } from '@/lib/sqlite-wrapper';
import * as path from 'path';
import { existsSync } from 'fs';
import { getLiveEgyptGoldPrices } from '@/lib/data-engine-db';

// ===========================================================================
// INITIALIZATION
// ===========================================================================

let _ensurePromise: Promise<void> | null = null;

export async function ensureUnifiedDbInitialized(): Promise<void> {
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
// CACHING
// ===========================================================================

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const _cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 30_000;

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
// UNIFIED STOCKS DATABASE
// ===========================================================================

let _stocksDb: SqliteDatabase | null = null;
let _stocksDbFailed = false;

export function getUnifiedStocksDb(): SqliteDatabase {
  if (_stocksDb) return _stocksDb;
  
  if (_stocksDbFailed) {
    throw new Error('Unified stocks DB unavailable');
  }
  
  if (!isInitialized()) {
    throw new Error('sql.js not initialized. Call await ensureUnifiedDbInitialized() first.');
  }
  
  // Use stocks.db (contains 1,298 stocks with real data)
  const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
  
  if (!existsSync(dbPath)) {
    _stocksDbFailed = true;
    throw new Error(`Unified stocks DB not found at ${dbPath}`);
  }
  
  try {
    _stocksDb = createDatabase(dbPath, { readonly: true });
    _stocksDb.pragma('foreign_keys = ON');
    console.log('[unified-db] Loaded unified_stocks.db');
    return _stocksDb;
  } catch (err) {
    _stocksDbFailed = true;
    throw err;
  }
}

// ===========================================================================
// CRYPTO DATABASE
// ===========================================================================

let _cryptoDb: SqliteDatabase | null = null;
let _cryptoDbFailed = false;

export function getCryptoDb(): SqliteDatabase {
  if (_cryptoDb) return _cryptoDb;
  
  if (_cryptoDbFailed) {
    throw new Error('Crypto DB unavailable');
  }
  
  if (!isInitialized()) {
    throw new Error('sql.js not initialized. Call await ensureUnifiedDbInitialized() first.');
  }
  
  const dbPath = path.join(process.cwd(), 'db', 'crypto.db');
  
  if (!existsSync(dbPath)) {
    _cryptoDbFailed = true;
    throw new Error(`Crypto DB not found at ${dbPath}`);
  }
  
  try {
    _cryptoDb = createDatabase(dbPath, { readonly: true });
    _cryptoDb.pragma('foreign_keys = ON');
    console.log('[unified-db] Loaded crypto.db');
    return _cryptoDb;
  } catch (err) {
    _cryptoDbFailed = true;
    throw err;
  }
}

// ===========================================================================
// TYPES
// ===========================================================================

export type Exchange = 'EGX' | 'TADAWUL' | 'DFM' | 'KSE' | 'QSE' | 'BSE';

export interface UnifiedStock {
  id: number;
  ticker: string;
  name: string | null;
  name_ar: string | null;
  exchange: Exchange;
  country: string | null;
  sector: string | null;
  industry: string | null;
  current_price: number | null;
  previous_close: number | null;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  volume: number | null;
  market_cap: number | null;
  pe_ratio: number | null;
  pb_ratio: number | null;
  ps_ratio: number | null;
  ev_to_ebitda: number | null;
  dividend_yield: number | null;
  eps: number | null;
  roe: number | null;
  roa: number | null;
  debt_to_equity: number | null;
  current_ratio: number | null;
  book_value_per_share: number | null;
  shares_outstanding: number | null;
  beta: number | null;
  rsi: number | null;
  ma_50: number | null;
  ma_200: number | null;
  support_level: number | null;
  resistance_level: number | null;
  is_halal: number;
  compliance_status: string | null;
  compliance_note: string | null;
  egx30_member: number;
  egx70_member: number;
  egx100_member: number;
  is_active: number;
  icon_url: string | null;
  last_update: string | null;
  created_at: string | null;
  price_change: number | null;
  change_percent: number | null;
  // Calculated fields
  price_change_calc?: number;
  value_traded?: number;
}

export interface CryptoCoin {
  id: number;
  coin_id: string;
  symbol: string;
  name: string | null;
  current_price: number | null;
  price_change_24h: number | null;
  price_change_percent_24h: number | null;
  high_24h: number | null;
  low_24h: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
  total_volume: number | null;
  circulating_supply: number | null;
  total_supply: number | null;
  max_supply: number | null;
  ath: number | null;
  ath_change_percent: number | null;
  atl: number | null;
  atl_change_percent: number | null;
  image_url: string | null;
  last_update: string | null;
  created_at: string | null;
}

export interface StockFilters {
  query?: string;
  exchange?: Exchange | 'ALL';
  sector?: string;
  is_active?: boolean;
  page?: number;
  page_size?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

// ===========================================================================
// STOCK QUERIES
// ===========================================================================

function toPlainRow(row: Record<string, unknown>): Record<string, unknown> {
  const plain: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value instanceof Buffer) {
      plain[key] = value.toString('utf-8');
    } else if (value instanceof Uint8Array) {
      plain[key] = Buffer.from(value).toString('utf-8');
    } else {
      plain[key] = value;
    }
  }
  return plain;
}

/**
 * Get all stocks with optional filtering
 */
export function getStocks(options?: StockFilters): PaginatedResult<UnifiedStock> {
  const cacheKey = `stocks:${JSON.stringify(options)}`;
  const cached = getCached<PaginatedResult<UnifiedStock>>(cacheKey);
  if (cached) return cached;
  
  const db = getUnifiedStocksDb();
  
  const query = options?.query?.trim();
  const exchange = options?.exchange;
  const sector = options?.sector?.trim();
  const isActive = options?.is_active ?? true;
  const page = Math.max(1, options?.page ?? 1);
  const pageSize = Math.min(500, Math.max(1, options?.page_size ?? 50));
  const offset = (page - 1) * pageSize;
  
  const whereClauses: string[] = [];
  const params: unknown[] = [];
  
  whereClauses.push('is_active = ?');
  params.push(isActive ? 1 : 0);
  
  if (query) {
    whereClauses.push('(ticker LIKE ? OR name LIKE ? OR name_ar LIKE ?)');
    const term = `%${query}%`;
    params.push(term, term, term);
  }
  
  if (exchange && exchange !== 'ALL') {
    whereClauses.push('market = ?');  // Use 'market' column
    params.push(exchange);
  }
  
  if (sector) {
    whereClauses.push('sector = ?');
    params.push(sector);
  }
  
  const whereSQL = whereClauses.join(' AND ');
  
  try {
    const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM stocks WHERE ${whereSQL}`).get(...params) as { cnt: number };
    const total = countRow?.cnt ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    
    const rows = db.prepare(`SELECT * FROM stocks WHERE ${whereSQL} ORDER BY volume DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset) as Record<string, unknown>[];
    
    const stocks: UnifiedStock[] = rows.map(toPlainRow).map((stock) => {
      const prev = Number(stock.previous_close) || 0;
      const curr = Number(stock.current_price) || 0;
      const vol = Number(stock.volume) || 0;
      
      return {
        ...stock as unknown as UnifiedStock,
        price_change_calc: prev > 0 ? ((curr - prev) / prev) * 100 : 0,
        value_traded: curr * vol,
      };
    });
    
    const result = { data: stocks, total, page, page_size: pageSize, total_pages: totalPages };
    setCache(cacheKey, result);
    return result;
  } catch (err) {
    console.warn('[unified-db] getStocks error:', err);
    return { data: [], total: 0, page, page_size: pageSize, total_pages: 0 };
  }
}

/**
 * Get a single stock by ticker
 */
export function getStockByTicker(ticker: string): UnifiedStock | null {
  const db = getUnifiedStocksDb();
  const row = db.prepare('SELECT * FROM stocks WHERE ticker = ? COLLATE NOCASE LIMIT 1').get(ticker) as Record<string, unknown> | undefined;
  
  if (!row) return null;
  
  const stock = toPlainRow(row) as unknown as UnifiedStock;
  const prev = Number(stock.previous_close) || 0;
  const curr = Number(stock.current_price) || 0;
  const vol = Number(stock.volume) || 0;
  
  return {
    ...stock,
    price_change_calc: prev > 0 ? ((curr - prev) / prev) * 100 : 0,
    value_traded: curr * vol,
  };
}

/**
 * Get stocks by exchange
 */
export function getStocksByExchange(exchange: Exchange, limit: number = 50): UnifiedStock[] {
  const cacheKey = `stocks_by_exchange:${exchange}:${limit}`;
  const cached = getCached<UnifiedStock[]>(cacheKey);
  if (cached) return cached;
  
  const db = getUnifiedStocksDb();
  const rows = db.prepare('SELECT * FROM stocks WHERE market = ? AND is_active = 1 ORDER BY volume DESC LIMIT ?').all(exchange, limit) as Record<string, unknown>[];
  
  const stocks: UnifiedStock[] = rows.map(toPlainRow).map((stock) => {
    const prev = Number(stock.previous_close) || 0;
    const curr = Number(stock.current_price) || 0;
    const vol = Number(stock.volume) || 0;
    
    return {
      ...stock as unknown as UnifiedStock,
      price_change_calc: prev > 0 ? ((curr - prev) / prev) * 100 : 0,
      value_traded: curr * vol,
    };
  });
  
  setCache(cacheKey, stocks);
  return stocks;
}

/**
 * Get exchange statistics
 */
export function getExchangeStats(): { exchange: string; count: number; country: string }[] {
  const cacheKey = 'exchange_stats';
  const cached = getCached<{ exchange: string; count: number; country: string }[]>(cacheKey);
  if (cached) return cached;
  
  const db = getUnifiedStocksDb();
  // Use 'market' column instead of 'exchange' (stocks.db schema)
  const rows = db.prepare(`
    SELECT market as exchange, COUNT(*) as count, 
           CASE market 
             WHEN 'EGX' THEN 'مصر'
             WHEN 'TADAWUL' THEN 'السعودية'
             WHEN 'DFM' THEN 'الإمارات'
             WHEN 'KSE' THEN 'الكويت'
             WHEN 'QSE' THEN 'قطر'
             WHEN 'BSE' THEN 'البحرين'
             WHEN 'CRYPTO' THEN 'كريبتو'
             ELSE 'غير محدد'
           END as country
    FROM stocks 
    WHERE is_active = 1 
    GROUP BY market 
    ORDER BY count DESC
  `).all() as { exchange: string; count: number; country: string }[];
  
  setCache(cacheKey, rows);
  return rows;
}

/**
 * Get top movers across all exchanges
 */
export function getUnifiedTopMovers(exchange?: Exchange, limit: number = 10): {
  gainers: UnifiedStock[];
  losers: UnifiedStock[];
  most_active: UnifiedStock[];
} {
  const cacheKey = `unified_top_movers:${exchange || 'all'}:${limit}`;
  const cached = getCached<{ gainers: UnifiedStock[]; losers: UnifiedStock[]; most_active: UnifiedStock[] }>(cacheKey);
  if (cached) return cached;
  
  const db = getUnifiedStocksDb();
  
  let query = 'SELECT * FROM stocks WHERE is_active = 1';
  const params: unknown[] = [];
  
  if (exchange) {
    query += ' AND market = ?';  // Use 'market' column
    params.push(exchange);
  }
  
  const rows = db.prepare(query).all(...params) as Record<string, unknown>[];
  
  const enriched: UnifiedStock[] = rows.map(toPlainRow).map((stock) => {
    const prev = Number(stock.previous_close) || 0;
    const curr = Number(stock.current_price) || 0;
    const vol = Number(stock.volume) || 0;
    const change = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
    
    return {
      ...stock as unknown as UnifiedStock,
      price_change_calc: change,
      value_traded: curr * vol,
    };
  });
  
  const gainers = enriched
    .filter(s => (s.price_change_calc || 0) > 0)
    .sort((a, b) => (b.price_change_calc || 0) - (a.price_change_calc || 0))
    .slice(0, limit);
  
  const losers = enriched
    .filter(s => (s.price_change_calc || 0) < 0)
    .sort((a, b) => (a.price_change_calc || 0) - (b.price_change_calc || 0))
    .slice(0, limit);
  
  const most_active = enriched
    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
    .slice(0, limit);
  
  const result = { gainers, losers, most_active };
  setCache(cacheKey, result);
  return result;
}

// ===========================================================================
// CRYPTO QUERIES
// ===========================================================================

/**
 * Get all crypto coins
 */
export function getCryptoCoins(limit: number = 50, offset: number = 0): CryptoCoin[] {
  const cacheKey = `crypto_coins:${limit}:${offset}`;
  const cached = getCached<CryptoCoin[]>(cacheKey);
  if (cached) return cached;
  
  const db = getCryptoDb();
  const rows = db.prepare('SELECT * FROM crypto_coins ORDER BY market_cap_rank ASC LIMIT ? OFFSET ?').all(limit, offset) as Record<string, unknown>[];
  
  const coins = rows.map(toPlainRow) as unknown as CryptoCoin[];
  setCache(cacheKey, coins);
  return coins;
}

/**
 * Get a single crypto coin by ID or symbol
 */
export function getCryptoCoin(idOrSymbol: string): CryptoCoin | null {
  const db = getCryptoDb();
  const row = db.prepare('SELECT * FROM crypto_coins WHERE coin_id = ? OR symbol = ? COLLATE NOCASE LIMIT 1').get(idOrSymbol, idOrSymbol) as Record<string, unknown> | undefined;
  
  if (!row) return null;
  return toPlainRow(row) as unknown as CryptoCoin;
}

/**
 * Get top crypto gainers/losers
 */
export function getCryptoMovers(limit: number = 10): {
  gainers: CryptoCoin[];
  losers: CryptoCoin[];
} {
  const cacheKey = `crypto_movers:${limit}`;
  const cached = getCached<{ gainers: CryptoCoin[]; losers: CryptoCoin[] }>(cacheKey);
  if (cached) return cached;
  
  const db = getCryptoDb();
  const rows = db.prepare('SELECT * FROM crypto_coins ORDER BY market_cap_rank ASC LIMIT 50').all() as Record<string, unknown>[];
  
  const coins = rows.map(toPlainRow) as unknown as CryptoCoin[];
  
  const gainers = coins
    .filter(c => (c.price_change_percent_24h || 0) > 0)
    .sort((a, b) => (b.price_change_percent_24h || 0) - (a.price_change_percent_24h || 0))
    .slice(0, limit);
  
  const losers = coins
    .filter(c => (c.price_change_percent_24h || 0) < 0)
    .sort((a, b) => (a.price_change_percent_24h || 0) - (b.price_change_percent_24h || 0))
    .slice(0, limit);
  
  const result = { gainers, losers };
  setCache(cacheKey, result);
  return result;
}

// ===========================================================================
// MARKET DATA
// ===========================================================================

export interface MarketIndex {
  symbol: string;
  name: string | null;
  name_ar: string | null;
  current_value: number | null;
  previous_close: number | null;
  change: number | null;
  change_percent: number | null;
  last_update: string | null;
}

export interface CurrencyRate {
  code: string;
  name_ar: string | null;
  buy_rate: number | null;
  sell_rate: number | null;
  change: number | null;
  updated_at: string | null;
}

export interface GoldPrice {
  karat: string;
  name_ar: string | null;
  price_per_gram: number | null;
  change: number | null;
  updated_at: string | null;
}

export function getMarketIndices(): MarketIndex[] {
  const cacheKey = 'market_indices';
  const cached = getCached<MarketIndex[]>(cacheKey);
  if (cached) return cached;
  
  const db = getUnifiedStocksDb();
  const rows = db.prepare('SELECT * FROM market_indices').all() as Record<string, unknown>[];
  const result = rows.map(toPlainRow) as unknown as MarketIndex[];
  setCache(cacheKey, result);
  return result;
}

export function getCurrencyRates(): CurrencyRate[] {
  const cacheKey = 'currency_rates';
  const cached = getCached<CurrencyRate[]>(cacheKey);
  if (cached) return cached;
  
  const db = getUnifiedStocksDb();
  const rows = db.prepare('SELECT * FROM currency_rates').all() as Record<string, unknown>[];
  const result = rows.map(toPlainRow) as unknown as CurrencyRate[];
  setCache(cacheKey, result);
  return result;
}

export function getGoldPrices(): GoldPrice[] {
  const cacheKey = 'gold_prices';
  const cached = getCached<GoldPrice[]>(cacheKey);
  if (cached) return cached;

  // v3.65.1: canonical source = data_engine.db.gold_prices (live, 77K+ rows, 5-min cycle).
  // OLD: SELECT * FROM stocks.db.gold_prices — was reading 3 stale rows from 2026-06-03.
  // See Documentation/DB_CLEANUP_PLAN_v3.65.1.md P0-2.
  const live = getLiveEgyptGoldPrices();
  if (!live) {
    return [];
  }
  const result: GoldPrice[] = [
    { karat: '24', name_ar: 'عيار 24', price_per_gram: live['24k'], change: null, updated_at: live.timestamp ?? null },
    { karat: '21', name_ar: 'عيار 21', price_per_gram: live['21k'], change: null, updated_at: live.timestamp ?? null },
    { karat: '18', name_ar: 'عيار 18', price_per_gram: live['18k'], change: null, updated_at: live.timestamp ?? null },
  ];
  setCache(cacheKey, result);
  return result;
}

// ===========================================================================
// RESET FUNCTIONS
// ===========================================================================

export function resetUnifiedDbState(): void {
  _stocksDb = null;
  _stocksDbFailed = false;
  _cryptoDb = null;
  _cryptoDbFailed = false;
  _cache.clear();
  console.log('[unified-db] State reset');
}
