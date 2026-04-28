/**
 * Precomputed Data Cache System
 * نظام البيانات المحسوبة مسبقاً
 *
 * يحسب ويخزن البيانات كل 30 دقيقة لتقليل حمل السيرفر
 * ويسرع استجابة الرسوم البيانية
 */

import { createDatabase, isInitialized, type SqliteDatabase } from '@/lib/sqlite-wrapper';
import * as path from 'path';

// ==================== TYPES ====================

export interface CacheEntry<T> {
  data: T;
  computed_at: string;
  expires_at: string;
  is_stale: boolean;
}

export interface PrecomputedStockData {
  ticker: string;
  name: string;
  name_ar: string;
  sector: string;
  current_price: number;
  previous_close: number;
  price_change: number;
  price_change_percent: number;
  volume: number;
  value_traded: number;
  market_cap: number;
  pe_ratio: number;
  pb_ratio: number;
  roe: number;
  eps: number;

  // Pre-calculated technical indicators
  sma_20: number;
  sma_50: number;
  sma_200: number;
  ema_12: number;
  ema_26: number;
  rsi_14: number;
  macd: number;
  macd_signal: number;
  macd_histogram: number;
  bollinger_upper: number;
  bollinger_middle: number;
  bollinger_lower: number;
  atr_14: number;

  // Pre-calculated support/resistance
  support_1: number;
  support_2: number;
  resistance_1: number;
  resistance_2: number;
  pivot_point: number;

  // Pre-calculated trend
  trend_direction: 'bullish' | 'bearish' | 'neutral';
  trend_strength: number;

  // Chart data summary (last 365 days compressed)
  price_summary_365d: PriceSummaryPoint[];
  volume_summary_365d: VolumeSummaryPoint[];
}

export interface PriceSummaryPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ma20?: number;
  ma50?: number;
}

export interface VolumeSummaryPoint {
  date: string;
  volume: number;
}

export interface PrecomputedMarketData {
  egx30_value: number;
  egx30_change: number;
  egx30_change_percent: number;
  egx70_value: number;
  egx70_change: number;
  egx70_change_percent: number;
  egx100_value: number;
  egx100_change: number;
  egx100_change_percent: number;

  market_breadth: {
    gainers: number;
    losers: number;
    unchanged: number;
    advance_decline_ratio: number;
  };

  total_volume: number;
  total_value: number;
  total_market_cap: number;

  top_gainers: Array<{ ticker: string; name: string; change: number }>;
  top_losers: Array<{ ticker: string; name: string; change: number }>;
  most_active: Array<{ ticker: string; name: string; volume: number }>;

  market_sentiment: 'bullish' | 'bearish' | 'neutral';
  volatility_index: number;
}

export interface PrecomputedGoldData {
  karat: string;
  price_per_gram: number;
  change: number;
  change_percent: number;
  price_history_30d: Array<{ date: string; price: number }>;
  support: number;
  resistance: number;
  trend: 'up' | 'down' | 'neutral';
}

export interface PrecomputedCurrencyData {
  code: string;
  name: string;
  rate: number;
  change: number;
  change_percent: number;
  rate_history_30d: Array<{ date: string; rate: number }>;
}

export interface CacheStatus {
  last_update: string | null;
  next_update: string | null;
  is_updating: boolean;
  stocks_cached: number;
  market_cached: boolean;
  gold_cached: boolean;
  currency_cached: boolean;
  cache_age_minutes: number;
}

// ==================== CONSTANTS ====================

const CACHE_UPDATE_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const CACHE_TABLE_NAME = 'precomputed_cache';
const HEAVY_DB_PATH = path.join(process.cwd(), 'db', 'egx_investment.db');
const LIGHT_DB_PATH = path.join(process.cwd(), 'db', 'custom.db');

// ==================== DATABASE ACCESS ====================

function getWriteDb(): SqliteDatabase {
  if (!isInitialized()) {
    throw new Error('sql.js is not initialized');
  }
  return createDatabase(HEAVY_DB_PATH);
}

function getReadDb(): SqliteDatabase {
  if (!isInitialized()) {
    throw new Error('sql.js is not initialized');
  }
  return createDatabase(HEAVY_DB_PATH, { readonly: true });
}

function getLightDb(): SqliteDatabase {
  if (!isInitialized()) {
    throw new Error('sql.js is not initialized');
  }
  return createDatabase(LIGHT_DB_PATH, { readonly: true });
}

// ==================== CACHE INITIALIZATION ====================

let _isUpdating = false;
let _lastUpdateTime: Date | null = null;
let _nextUpdateTime: Date | null = null;

export function initializePrecomputedCache(): void {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    // Create cache table
    db.run(`
      CREATE TABLE IF NOT EXISTS ${CACHE_TABLE_NAME} (
        cache_key TEXT PRIMARY KEY,
        cache_type TEXT NOT NULL,
        data TEXT NOT NULL,
        computed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        is_stale INTEGER DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Create indexes
    db.run(`CREATE INDEX IF NOT EXISTS idx_cache_type ON ${CACHE_TABLE_NAME}(cache_type)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_expires ON ${CACHE_TABLE_NAME}(expires_at)`);

    // Create cache status table
    db.run(`
      CREATE TABLE IF NOT EXISTS cache_status (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_update TEXT,
        next_update TEXT,
        is_updating INTEGER DEFAULT 0,
        stocks_cached INTEGER DEFAULT 0,
        market_cached INTEGER DEFAULT 0,
        gold_cached INTEGER DEFAULT 0,
        currency_cached INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // Insert default status if not exists
    db.run(`
      INSERT OR IGNORE INTO cache_status (id, last_update, next_update)
      VALUES (1, NULL, datetime('now', '+30 minutes'))
    `);

    console.log('[PrecomputedCache] Cache tables initialized');
  } finally {
    db.close();
  }
}

// ==================== CACHE OPERATIONS ====================

export function getCachedData<T>(cacheKey: string): CacheEntry<T> | null {
  const db = getReadDb();
  try {
    const row = db.prepare(`
      SELECT data, computed_at, expires_at, is_stale
      FROM ${CACHE_TABLE_NAME}
      WHERE cache_key = ?
    `).get(cacheKey) as Record<string, unknown> | undefined;

    if (!row) return null;

    const expiresAt = new Date(row.expires_at as string);
    const isStale = expiresAt < new Date();

    return {
      data: JSON.parse(row.data as string) as T,
      computed_at: row.computed_at as string,
      expires_at: row.expires_at as string,
      is_stale: isStale || Boolean(row.is_stale),
    };
  } finally {
    db.close();
  }
}

export function setCachedData<T>(
  cacheKey: string,
  cacheType: string,
  data: T,
  ttlMinutes: number = 30
): void {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

    db.prepare(`
      INSERT OR REPLACE INTO ${CACHE_TABLE_NAME}
      (cache_key, cache_type, data, computed_at, expires_at, is_stale, updated_at)
      VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
    `).run(
      cacheKey,
      cacheType,
      JSON.stringify(data),
      now.toISOString(),
      expiresAt.toISOString()
    );
  } finally {
    db.close();
  }
}

export function invalidateCache(cacheKey: string): void {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');
    db.prepare(`DELETE FROM ${CACHE_TABLE_NAME} WHERE cache_key = ?`).run(cacheKey);
  } finally {
    db.close();
  }
}

export function invalidateCacheByType(cacheType: string): void {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');
    db.prepare(`DELETE FROM ${CACHE_TABLE_NAME} WHERE cache_type = ?`).run(cacheType);
  } finally {
    db.close();
  }
}

export function clearAllCache(): number {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');
    const result = db.prepare(`DELETE FROM ${CACHE_TABLE_NAME}`).run();
    return result.changes;
  } finally {
    db.close();
  }
}

// ==================== TECHNICAL CALCULATIONS ====================

function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}

function calculateRSI(prices: number[], period: number = 14): number | null {
  if (prices.length < period + 1) return null;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) - change) / period;
    }
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } | null {
  if (prices.length < 26) return null;

  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);

  if (!ema12 || !ema26) return null;

  const macdLine: number[] = [];
  for (let i = 26; i <= prices.length; i++) {
    const e12 = calculateEMA(prices.slice(0, i), 12);
    const e26 = calculateEMA(prices.slice(0, i), 26);
    if (e12 && e26) macdLine.push(e12 - e26);
  }

  if (macdLine.length < 9) return { macd: ema12 - ema26, signal: ema12 - ema26, histogram: 0 };

  const signal = calculateEMA(macdLine, 9);
  const macd = macdLine[macdLine.length - 1];

  return {
    macd: macd,
    signal: signal || macd,
    histogram: macd - (signal || macd),
  };
}

function calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2): {
  upper: number;
  middle: number;
  lower: number;
} | null {
  if (prices.length < period) return null;

  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;

  const squaredDiffs = slice.map(p => Math.pow(p - middle, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(variance);

  return {
    upper: middle + stdDev * std,
    middle,
    lower: middle - stdDev * std,
  };
}

function calculateATR(
  highs: number[],
  lows: number[],
  closes: number[],
  period: number = 14
): number | null {
  if (highs.length < period + 1) return null;

  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }

  return trueRanges.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateSupportResistance(
  highs: number[],
  lows: number[],
  closes: number[]
): { support1: number; support2: number; resistance1: number; resistance2: number; pivot: number } {
  const high = Math.max(...highs.slice(-20));
  const low = Math.min(...lows.slice(-20));
  const close = closes[closes.length - 1];

  const pivot = (high + low + close) / 3;
  const support1 = 2 * pivot - high;
  const support2 = pivot - (high - low);
  const resistance1 = 2 * pivot - low;
  const resistance2 = pivot + (high - low);

  return { support1, support2, resistance1, resistance2, pivot };
}

function determineTrend(prices: number[], sma20: number | null, sma50: number | null): {
  direction: 'bullish' | 'bearish' | 'neutral';
  strength: number;
} {
  if (prices.length < 50 || !sma20 || !sma50) {
    return { direction: 'neutral', strength: 0 };
  }

  const currentPrice = prices[prices.length - 1];
  const priceVsSma20 = (currentPrice - sma20) / sma20;
  const priceVsSma50 = (currentPrice - sma50) / sma50;
  const smaDiff = (sma20 - sma50) / sma50;

  let direction: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let strength = 0;

  if (sma20 > sma50 && currentPrice > sma20) {
    direction = 'bullish';
    strength = Math.min(100, (smaDiff * 1000 + priceVsSma20 * 100 + priceVsSma50 * 50));
  } else if (sma20 < sma50 && currentPrice < sma20) {
    direction = 'bearish';
    strength = Math.min(100, Math.abs(smaDiff * 1000 + priceVsSma20 * 100 + priceVsSma50 * 50));
  }

  return { direction, strength: Math.round(strength) };
}

// ==================== PRECOMPUTE FUNCTIONS ====================

async function precomputeStockData(db: SqliteDatabase): Promise<number> {
  console.log('[PrecomputedCache] Computing stock data...');

  const lightDb = getLightDb();

  const stocks = lightDb.prepare(`
    SELECT id, ticker, name, name_ar, sector, current_price, previous_close,
           volume, market_cap, pe_ratio, pb_ratio, roe, eps
    FROM stocks WHERE is_active = 1
  `).all() as Array<Record<string, unknown>>;

  lightDb.close();

  let computed = 0;

  for (const stock of stocks) {
    try {
      const stockId = stock.id as number;
      const ticker = stock.ticker as string;

      // Get price history
      const history = db.prepare(`
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM stock_price_history
        WHERE stock_id = ?
        ORDER BY date ASC
        LIMIT 365
      `).all(stockId) as Array<{
        date: string;
        open_price: number;
        high_price: number;
        low_price: number;
        close_price: number;
        volume: number;
      }>;

      if (history.length < 20) continue;

      const closes = history.map(h => h.close_price);
      const highs = history.map(h => h.high_price);
      const lows = history.map(h => h.low_price);

      // Calculate technical indicators
      const sma20 = calculateSMA(closes, 20);
      const sma50 = calculateSMA(closes, 50);
      const sma200 = calculateSMA(closes, 200);
      const ema12 = calculateEMA(closes, 12);
      const ema26 = calculateEMA(closes, 26);
      const rsi14 = calculateRSI(closes, 14);
      const macd = calculateMACD(closes);
      const bollinger = calculateBollingerBands(closes);
      const atr = calculateATR(highs, lows, closes, 14);
      const supportResistance = calculateSupportResistance(highs, lows, closes);
      const trend = determineTrend(closes, sma20, sma50);

      const currentPrice = Number(stock.current_price) || closes[closes.length - 1];
      const previousClose = Number(stock.previous_close) || closes[closes.length - 2] || currentPrice;
      const priceChange = currentPrice - previousClose;
      const priceChangePercent = previousClose > 0 ? (priceChange / previousClose) * 100 : 0;

      // Create price summary (last 365 days)
      const priceSummary = history.slice(-365).map(h => ({
        date: h.date,
        open: h.open_price,
        high: h.high_price,
        low: h.low_price,
        close: h.close_price,
      }));

      const volumeSummary = history.slice(-365).map(h => ({
        date: h.date,
        volume: h.volume,
      }));

      const precomputedData: PrecomputedStockData = {
        ticker,
        name: stock.name as string,
        name_ar: stock.name_ar as string,
        sector: stock.sector as string,
        current_price: currentPrice,
        previous_close: previousClose,
        price_change: priceChange,
        price_change_percent: priceChangePercent,
        volume: Number(stock.volume) || 0,
        value_traded: currentPrice * (Number(stock.volume) || 0),
        market_cap: Number(stock.market_cap) || 0,
        pe_ratio: Number(stock.pe_ratio) || 0,
        pb_ratio: Number(stock.pb_ratio) || 0,
        roe: Number(stock.roe) || 0,
        eps: Number(stock.eps) || 0,

        sma_20: sma20 || 0,
        sma_50: sma50 || 0,
        sma_200: sma200 || 0,
        ema_12: ema12 || 0,
        ema_26: ema26 || 0,
        rsi_14: rsi14 || 50,
        macd: macd?.macd || 0,
        macd_signal: macd?.signal || 0,
        macd_histogram: macd?.histogram || 0,
        bollinger_upper: bollinger?.upper || 0,
        bollinger_middle: bollinger?.middle || 0,
        bollinger_lower: bollinger?.lower || 0,
        atr_14: atr || 0,

        support_1: supportResistance.support1,
        support_2: supportResistance.support2,
        resistance_1: supportResistance.resistance1,
        resistance_2: supportResistance.resistance2,
        pivot_point: supportResistance.pivot,

        trend_direction: trend.direction,
        trend_strength: trend.strength,

        price_summary_365d: priceSummary,
        volume_summary_365d: volumeSummary,
      };

      setCachedData(`stock:${ticker}`, 'stock', precomputedData, 30);
      computed++;
    } catch (err) {
      console.error(`[PrecomputedCache] Error computing stock ${stock.ticker}:`, err);
    }
  }

  return computed;
}

async function precomputeMarketData(): Promise<void> {
  console.log('[PrecomputedCache] Computing market data...');

  const lightDb = getLightDb();

  try {
    // Get market indices
    const indices = lightDb.prepare(`
      SELECT symbol, current_value, previous_close, change, change_percent
      FROM market_indices
    `).all() as Array<Record<string, unknown>>;

    // Get market breadth
    const stocks = lightDb.prepare(`
      SELECT ticker, name, current_price, previous_close, volume, market_cap
      FROM stocks WHERE is_active = 1 AND previous_close > 0
    `).all() as Array<Record<string, unknown>>;

    let gainers = 0;
    let losers = 0;
    let unchanged = 0;
    let totalVolume = 0;
    let totalMarketCap = 0;

    const stockChanges: Array<{ ticker: string; name: string; change: number; volume: number }> = [];

    for (const stock of stocks) {
      const prev = Number(stock.previous_close) || 0;
      const curr = Number(stock.current_price) || 0;
      const change = prev > 0 ? ((curr - prev) / prev) * 100 : 0;

      if (change > 0) gainers++;
      else if (change < 0) losers++;
      else unchanged++;

      totalVolume += Number(stock.volume) || 0;
      totalMarketCap += Number(stock.market_cap) || 0;

      stockChanges.push({
        ticker: stock.ticker as string,
        name: stock.name as string,
        change,
        volume: Number(stock.volume) || 0,
      });
    }

    const topGainers = stockChanges
      .filter(s => s.change > 0)
      .sort((a, b) => b.change - a.change)
      .slice(0, 10);

    const topLosers = stockChanges
      .filter(s => s.change < 0)
      .sort((a, b) => a.change - b.change)
      .slice(0, 10);

    const mostActive = stockChanges
      .sort((a, b) => b.volume - a.volume)
      .slice(0, 10);

    const egx30 = indices.find(i => i.symbol === 'EGX30');
    const egx70 = indices.find(i => i.symbol === 'EGX70');
    const egx100 = indices.find(i => i.symbol === 'EGX100');

    const advanceDeclineRatio = losers > 0 ? gainers / losers : gainers;

    let sentiment: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    if (advanceDeclineRatio > 1.5) sentiment = 'bullish';
    else if (advanceDeclineRatio < 0.67) sentiment = 'bearish';

    const marketData: PrecomputedMarketData = {
      egx30_value: Number(egx30?.current_value) || 0,
      egx30_change: Number(egx30?.change) || 0,
      egx30_change_percent: Number(egx30?.change_percent) || 0,
      egx70_value: Number(egx70?.current_value) || 0,
      egx70_change: Number(egx70?.change) || 0,
      egx70_change_percent: Number(egx70?.change_percent) || 0,
      egx100_value: Number(egx100?.current_value) || 0,
      egx100_change: Number(egx100?.change) || 0,
      egx100_change_percent: Number(egx100?.change_percent) || 0,

      market_breadth: {
        gainers,
        losers,
        unchanged,
        advance_decline_ratio: Math.round(advanceDeclineRatio * 100) / 100,
      },

      total_volume: totalVolume,
      total_value: totalMarketCap,
      total_market_cap: totalMarketCap,

      top_gainers: topGainers.map(s => ({ ticker: s.ticker, name: s.name, change: s.change })),
      top_losers: topLosers.map(s => ({ ticker: s.ticker, name: s.name, change: s.change })),
      most_active: mostActive.map(s => ({ ticker: s.ticker, name: s.name, volume: s.volume })),

      market_sentiment: sentiment,
      volatility_index: 0,
    };

    setCachedData('market:overview', 'market', marketData, 30);
  } finally {
    lightDb.close();
  }
}

async function precomputeGoldData(): Promise<void> {
  console.log('[PrecomputedCache] Computing gold data...');

  const lightDb = getLightDb();

  try {
    const goldPrices = lightDb.prepare(`
      SELECT karat, price_per_gram, change
      FROM gold_prices
      WHERE karat NOT LIKE 'silver%'
    `).all() as Array<{ karat: string; price_per_gram: number; change: number }>;

    const heavyDb = getReadDb();
    try {
      for (const gold of goldPrices) {
        const history = heavyDb.prepare(`
          SELECT recorded_at, price_per_gram
          FROM gold_price_history
          WHERE karat = ?
          ORDER BY recorded_at DESC
          LIMIT 30
        `).all(gold.karat) as Array<{ recorded_at: string; price_per_gram: number }>;

        const priceHistory = history.reverse().map(h => ({
          date: h.recorded_at,
          price: h.price_per_gram,
        }));

        const prices = priceHistory.map(p => p.price);
        const change = gold.change || (prices.length > 1 ? prices[prices.length - 1] - prices[prices.length - 2] : 0);
        const changePercent = prices.length > 1 && prices[prices.length - 2] > 0
          ? (change / prices[prices.length - 2]) * 100
          : 0;

        const high = prices.length > 0 ? Math.max(...prices) : gold.price_per_gram;
        const low = prices.length > 0 ? Math.min(...prices) : gold.price_per_gram;

        const goldData: PrecomputedGoldData = {
          karat: gold.karat,
          price_per_gram: gold.price_per_gram,
          change,
          change_percent: changePercent,
          price_history_30d: priceHistory,
          support: low,
          resistance: high,
          trend: change > 0 ? 'up' : change < 0 ? 'down' : 'neutral',
        };

        setCachedData(`gold:${gold.karat}`, 'gold', goldData, 30);
      }
    } finally {
      heavyDb.close();
    }
  } finally {
    lightDb.close();
  }
}

async function precomputeCurrencyData(): Promise<void> {
  console.log('[PrecomputedCache] Computing currency data...');

  const lightDb = getLightDb();

  try {
    const currencies = lightDb.prepare(`
      SELECT code, name, rate
      FROM currency_rates
    `).all() as Array<{ code: string; name: string; rate: number }>;

    for (const currency of currencies) {
      const currencyData: PrecomputedCurrencyData = {
        code: currency.code,
        name: currency.name,
        rate: currency.rate,
        change: 0,
        change_percent: 0,
        rate_history_30d: [],
      };

      setCachedData(`currency:${currency.code}`, 'currency', currencyData, 30);
    }
  } finally {
    lightDb.close();
  }
}

// ==================== MAIN UPDATE FUNCTION ====================

export async function updateAllCache(): Promise<{
  success: boolean;
  stocks_cached: number;
  market_cached: boolean;
  gold_cached: boolean;
  currency_cached: boolean;
  duration_ms: number;
  error?: string;
}> {
  if (_isUpdating) {
    console.log('[PrecomputedCache] Update already in progress, skipping');
    return {
      success: false,
      stocks_cached: 0,
      market_cached: false,
      gold_cached: false,
      currency_cached: false,
      duration_ms: 0,
      error: 'Update already in progress',
    };
  }

  _isUpdating = true;
  const startTime = Date.now();

  try {
    // Initialize cache tables
    initializePrecomputedCache();

    const heavyDb = getWriteDb();
    try {
      // Precompute all data
      const stocksCached = await precomputeStockData(heavyDb);
      await precomputeMarketData();
      await precomputeGoldData();
      await precomputeCurrencyData();

      const duration = Date.now() - startTime;
      _lastUpdateTime = new Date();
      _nextUpdateTime = new Date(Date.now() + CACHE_UPDATE_INTERVAL_MS);

      // Update status
      heavyDb.pragma('journal_mode = WAL');
      heavyDb.prepare(`
        UPDATE cache_status SET
          last_update = ?,
          next_update = ?,
          is_updating = 0,
          stocks_cached = ?,
          market_cached = 1,
          gold_cached = 1,
          currency_cached = 1,
          updated_at = datetime('now')
        WHERE id = 1
      `).run(
        _lastUpdateTime.toISOString(),
        _nextUpdateTime.toISOString(),
        stocksCached
      );

      console.log(`[PrecomputedCache] Cache update complete in ${duration}ms. Stocks cached: ${stocksCached}`);

      return {
        success: true,
        stocks_cached: stocksCached,
        market_cached: true,
        gold_cached: true,
        currency_cached: true,
        duration_ms: duration,
      };
    } finally {
      heavyDb.close();
    }
  } catch (error) {
    console.error('[PrecomputedCache] Error updating cache:', error);
    return {
      success: false,
      stocks_cached: 0,
      market_cached: false,
      gold_cached: false,
      currency_cached: false,
      duration_ms: Date.now() - startTime,
      error: String(error),
    };
  } finally {
    _isUpdating = false;
  }
}

// ==================== GETTERS ====================

export function getPrecomputedStock(ticker: string): PrecomputedStockData | null {
  const entry = getCachedData<PrecomputedStockData>(`stock:${ticker}`);
  return entry?.data || null;
}

export function getPrecomputedMarket(): PrecomputedMarketData | null {
  const entry = getCachedData<PrecomputedMarketData>('market:overview');
  return entry?.data || null;
}

export function getPrecomputedGold(karat: string): PrecomputedGoldData | null {
  const entry = getCachedData<PrecomputedGoldData>(`gold:${karat}`);
  return entry?.data || null;
}

export function getPrecomputedCurrency(code: string): PrecomputedCurrencyData | null {
  const entry = getCachedData<PrecomputedCurrencyData>(`currency:${code}`);
  return entry?.data || null;
}

export function getCacheStatus(): CacheStatus {
  const db = getReadDb();
  try {
    const status = db.prepare(`
      SELECT last_update, next_update, is_updating, stocks_cached, market_cached, gold_cached, currency_cached
      FROM cache_status WHERE id = 1
    `).get() as Record<string, unknown> | undefined;

    if (!status) {
      return {
        last_update: null,
        next_update: null,
        is_updating: _isUpdating,
        stocks_cached: 0,
        market_cached: false,
        gold_cached: false,
        currency_cached: false,
        cache_age_minutes: 0,
      };
    }

    let cacheAgeMinutes = 0;
    if (status.last_update) {
      const lastUpdate = new Date(status.last_update as string);
      cacheAgeMinutes = Math.floor((Date.now() - lastUpdate.getTime()) / 60000);
    }

    return {
      last_update: status.last_update as string | null,
      next_update: status.next_update as string | null,
      is_updating: Boolean(status.is_updating) || _isUpdating,
      stocks_cached: status.stocks_cached as number,
      market_cached: Boolean(status.market_cached),
      gold_cached: Boolean(status.gold_cached),
      currency_cached: Boolean(status.currency_cached),
      cache_age_minutes: cacheAgeMinutes,
    };
  } finally {
    db.close();
  }
}

export function getAllCachedStocks(): PrecomputedStockData[] {
  const db = getReadDb();
  try {
    const rows = db.prepare(`
      SELECT data FROM ${CACHE_TABLE_NAME}
      WHERE cache_type = 'stock'
    `).all() as Array<{ data: string }>;

    return rows.map(row => JSON.parse(row.data) as PrecomputedStockData);
  } finally {
    db.close();
  }
}

export function getTopGainers(limit: number = 10): PrecomputedStockData[] {
  const all = getAllCachedStocks();
  return all
    .filter(s => s.price_change_percent > 0)
    .sort((a, b) => b.price_change_percent - a.price_change_percent)
    .slice(0, limit);
}

export function getTopLosers(limit: number = 10): PrecomputedStockData[] {
  const all = getAllCachedStocks();
  return all
    .filter(s => s.price_change_percent < 0)
    .sort((a, b) => a.price_change_percent - b.price_change_percent)
    .slice(0, limit);
}

export function getMostActive(limit: number = 10): PrecomputedStockData[] {
  const all = getAllCachedStocks();
  return all
    .sort((a, b) => b.volume - a.volume)
    .slice(0, limit);
}
