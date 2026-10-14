/**
 * multi-source-adapter.ts — Comprehensive Multi-Source Data Adapter
 * محول البيانات متعدد المصادر
 *
 * Data sources with free tiers (updated rate limits):
 *   1. VPS (existing) - PRIMARY for EGX stocks (unlimited)
 *   2. Twelve Data - Secondary for EGX stocks (800/day free)
 *   3. EODHD (eodhd.com) - Backup for stocks (20/day free)
 *   4. FCSAPI (fcsapi.com) - Primary for forex, gold (100/month free)
 *   5. Marketstack (marketstack.com) - Backup for stocks (100/month free)
 *   6. Alpha Vantage - Backup (25/day free)
 *   7. Yahoo Finance - DISABLED (user reports fake data)
 *
 * Features:
 *   - Automatic failover between sources
 *   - Rate limiting and quota management
 *   - In-memory caching with configurable TTL
 *   - Source health tracking
 *   - Smart distribution across sources to stay within free limits
 *
 * SERVER-SIDE ONLY — Never import on client side.
 */

// FIX-WAVE-3-HIGH / AUDIT-DEEP-4 #15 (Rule 58): structured logger replaces console.log/error
import { logger } from '@/lib/logger';
import { cache as centralCache } from '@/lib/cache-manager';

// ---------------------------------------------------------------------------
// Configuration & API Keys
// ---------------------------------------------------------------------------

const API_KEYS = {
  // Primary data sources
  VPS_URL: process.env.EGX_VPS_API_URL || process.env.PYTHON_API_URL || 'http://127.0.0.1:8010',
  
  // Secondary sources (ordered by free tier generosity)
  TWELVE_DATA: process.env.TWELVE_DATA_API_KEY || '',
  EODHD: process.env.EODHD_API_KEY || '',
  ALPHA_VANTAGE: process.env.ALPHA_VANTAGE_API_KEY || '',
  
  // For gold/currency (limited monthly quota - use sparingly!)
  FCSAPI: process.env.FCSAPI_API_KEY || '',
  MARKETSTACK: process.env.MARKETSTACK_API_KEY || '',
};

// API Base URLs
const API_URLS = {
  VPS: API_KEYS.VPS_URL,
  TWELVE_DATA: 'https://api.twelvedata.com',
  EODHD: 'https://eodhistoricaldata.com/api',
  ALPHA_VANTAGE: 'https://www.alphavantage.co',
  FCSAPI: 'https://fcsapi.com/api-v3',
  MARKETSTACK: 'http://api.marketstack.com/v1',
};

// Rate Limits (based on actual free tier limits - see PROJECT_MEMORY.md)
// IMPORTANT: FCSAPI and Marketstack are MONTHLY limits!
const RATE_LIMITS = {
  // Daily limits
  TWELVE_DATA: { daily: 800, label: 'Twelve Data' },
  EODHD: { daily: 20, label: 'EODHD' },
  ALPHA_VANTAGE: { daily: 25, label: 'Alpha Vantage' },
  
  // Monthly limits (divided by 30 to get daily equivalent)
  FCSAPI: { monthly: 100, daily: Math.ceil(100 / 30), label: 'FCSAPI' },
  MARKETSTACK: { monthly: 100, daily: Math.ceil(100 / 30), label: 'Marketstack' },
};

// Priority order for stock quotes (based on reliability and rate limits)
const STOCK_SOURCE_PRIORITY = ['VPS', 'TWELVE_DATA', 'EODHD', 'MARKETSTACK', 'ALPHA_VANTAGE'] as const;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StockQuote {
  ticker: string;
  name?: string;
  name_ar?: string;
  current_price: number;
  change: number;
  change_percent: number;
  open?: number;
  high?: number;
  low?: number;
  previous_close?: number;
  volume: number;
  market_cap?: number;
  pe_ratio?: number;
  sector?: string;
  source: string;
  fetched_at: string;
}

export interface GoldPrice {
  karat: string;
  name_ar: string;
  price_per_gram: number;
  change: number | null;
  currency: string;
  source: string;
  fetched_at: string;
}

export interface CurrencyRate {
  from: string;
  to: string;
  rate: number;
  change: number | null;
  name_ar?: string;
  source: string;
  fetched_at: string;
  // Optional fields read by /api/market/sync writer when present on the
  // API response (e.g. FCSAPI/exchangerate host). When undefined, the sync
  // writer falls back to `${from}/${to}` for code and to `rate` for buy/sell.
  code?: string;
  buy_rate?: number;
  sell_rate?: number;
  is_major?: boolean;
}

export interface HistoricalPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SourceHealth {
  source: string;
  available: boolean;
  lastCheck: string;
  successCount: number;
  failCount: number;
  lastError?: string;
  rateLimitRemaining: number;
}

// ---------------------------------------------------------------------------
// In-Memory Cache
// ---------------------------------------------------------------------------

// P2-ARCH-A1 FIX (2026-10-14): Consolidated into cache-manager.ts (SSOT).
// Previous: local Map cache with manual TTL checking.
// Now: uses central cache-manager with LRU eviction + per-entry TTL.
// Note: 'source' field is dropped (not needed for caching semantics).

const MSA_NS = 'msa:';
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const STOCK_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes for stocks
const GOLD_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes for gold
const CURRENCY_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes for currency

function getCached<T>(key: string, ttlMs: number = DEFAULT_CACHE_TTL_MS): T | null {
  // central cache-manager handles TTL internally via set(key, value, ttlMs)
  return centralCache.get<T>(MSA_NS + key) ?? null;
}

function setCache<T>(key: string, data: T, source: string, ttlMs: number = DEFAULT_CACHE_TTL_MS): void {
  centralCache.set(MSA_NS + key, data, ttlMs);
}

export function clearCache(): void {
  centralCache.clear();
  console.log('[MultiSourceAdapter] Cache cleared (via central cache-manager)');
}

// ---------------------------------------------------------------------------
// Rate Limiting
// ---------------------------------------------------------------------------

interface RateLimitState {
  timestamps: number[];
  dailyLimit: number;
}

const rateLimitState: Record<string, RateLimitState> = {
  TWELVE_DATA: { timestamps: [], dailyLimit: RATE_LIMITS.TWELVE_DATA.daily },
  EODHD: { timestamps: [], dailyLimit: RATE_LIMITS.EODHD.daily },
  ALPHA_VANTAGE: { timestamps: [], dailyLimit: RATE_LIMITS.ALPHA_VANTAGE.daily },
  FCSAPI: { timestamps: [], dailyLimit: RATE_LIMITS.FCSAPI.daily },
  MARKETSTACK: { timestamps: [], dailyLimit: RATE_LIMITS.MARKETSTACK.daily },
};

function checkRateLimit(source: string): { allowed: boolean; remaining: number; waitMs: number } {
  const state = rateLimitState[source];
  if (!state) return { allowed: true, remaining: Infinity, waitMs: 0 };

  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  // Clean old timestamps
  state.timestamps = state.timestamps.filter(ts => ts > oneDayAgo);

  const remaining = Math.max(0, state.dailyLimit - state.timestamps.length);

  if (state.timestamps.length >= state.dailyLimit) {
    const oldest = state.timestamps[0];
    const waitMs = oldest + 24 * 60 * 60 * 1000 - now + 1000;
    return { allowed: false, remaining: 0, waitMs: Math.max(waitMs, 0) };
  }

  return { allowed: true, remaining, waitMs: 0 };
}

function recordRequest(source: string): void {
  const state = rateLimitState[source];
  if (state) {
    state.timestamps.push(Date.now());
  }
}

// ---------------------------------------------------------------------------
// Source Health Tracking
// ---------------------------------------------------------------------------

const sourceHealth: Record<string, { available: boolean; lastCheck: number; successCount: number; failCount: number; lastError?: string }> = {
  VPS: { available: true, lastCheck: 0, successCount: 0, failCount: 0 },
  TWELVE_DATA: { available: true, lastCheck: 0, successCount: 0, failCount: 0 },
  EODHD: { available: true, lastCheck: 0, successCount: 0, failCount: 0 },
  ALPHA_VANTAGE: { available: true, lastCheck: 0, successCount: 0, failCount: 0 },
  FCSAPI: { available: true, lastCheck: 0, successCount: 0, failCount: 0 },
  MARKETSTACK: { available: true, lastCheck: 0, successCount: 0, failCount: 0 },
};

function markSuccess(source: string): void {
  const health = sourceHealth[source];
  if (health) {
    health.available = true;
    health.lastCheck = Date.now();
    health.successCount++;
    health.lastError = undefined;
  }
}

function markFailure(source: string, error?: string): void {
  const health = sourceHealth[source];
  if (health) {
    health.lastCheck = Date.now();
    health.failCount++;
    health.lastError = error;
    // Mark unavailable after 5 consecutive failures
    if (health.failCount >= 5) {
      health.available = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Generic Fetch Helper
// ---------------------------------------------------------------------------

async function fetchWithTimeout<T>(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 8000
): Promise<{ data: T | null; error?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Accept': 'application/json',
        ...options.headers,
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      return { data: null, error: `HTTP ${response.status}: ${errorText.slice(0, 200)}` };
    }

    const json = await response.json();
    return { data: json as T };
  } catch (err) {
    clearTimeout(timeout);
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (errorMsg.includes('abort')) {
      return { data: null, error: `Timeout after ${timeoutMs}ms` };
    }
    return { data: null, error: errorMsg };
  }
}

// ---------------------------------------------------------------------------
// VPS Client (Primary for EGX) - Most Reliable
// ---------------------------------------------------------------------------

async function fetchVpsQuote(ticker: string): Promise<StockQuote | null> {
  const url = `${API_KEYS.VPS_URL}/api/stock/${encodeURIComponent(ticker.toUpperCase())}`;

  console.log(`[VPS] Fetching quote for ${ticker}`);

  const { data, error } = await fetchWithTimeout<VpsStockResponse>(url, {}, 8000);

  if (error || !data || !data.success) {
    console.warn(`[VPS] Error for ${ticker}:`, error);
    markFailure('VPS', error);
    return null;
  }

  const stock = data.data || data;
  if (!stock || !stock.current_price) {
    markFailure('VPS', 'No data');
    return null;
  }

  markSuccess('VPS');

  return {
    ticker: ticker.toUpperCase(),
    name: stock.name,
    name_ar: stock.name_ar,
    current_price: stock.current_price || stock.price,
    change: stock.change || stock.change_amount || 0,
    change_percent: stock.change_percent || 0,
    open: stock.open || stock.open_price,
    high: stock.high || stock.high_price,
    low: stock.low || stock.low_price,
    previous_close: stock.previous_close,
    volume: stock.volume || 0,
    source: 'vps',
    fetched_at: new Date().toISOString(),
  };
}

async function fetchVpsAllStocks(): Promise<StockQuote[]> {
  const url = `${API_KEYS.VPS_URL}/api/stocks`;

  console.log(`[VPS] Fetching all stocks`);

  const { data, error } = await fetchWithTimeout<VpsAllStocksResponse>(url, {}, 15000);

  if (error || !data || !data.success) {
    console.warn(`[VPS] Error fetching all stocks:`, error);
    markFailure('VPS', error);
    return [];
  }

  const stocks = data.data || [];
  if (!Array.isArray(stocks)) {
    markFailure('VPS', 'Invalid data format');
    return [];
  }

  markSuccess('VPS');

  return stocks.map(s => ({
    ticker: s.symbol,
    current_price: s.current_price || s.price,
    change: s.change || s.change_amount || 0,
    change_percent: s.change_percent || 0,
    open: s.open || s.open_price,
    high: s.high || s.high_price,
    low: s.low || s.low_price,
    previous_close: s.previous_close,
    volume: s.volume || 0,
    source: 'vps',
    fetched_at: new Date().toISOString(),
  }));
}

interface VpsStockResponse {
  success: boolean;
  data?: {
    symbol?: string;
    name?: string;
    name_ar?: string;
    current_price?: number;
    price?: number;
    change?: number;
    change_amount?: number;
    change_percent?: number;
    open?: number;
    open_price?: number;
    high?: number;
    high_price?: number;
    low?: number;
    low_price?: number;
    previous_close?: number;
    volume?: number;
  };
}

interface VpsAllStocksResponse {
  success: boolean;
  count?: number;
  data?: Array<{
    symbol: string;
    price?: number;
    current_price?: number;
    change?: number;
    change_amount?: number;
    change_percent?: number;
    open?: number;
    open_price?: number;
    high?: number;
    high_price?: number;
    low?: number;
    low_price?: number;
    previous_close?: number;
    volume?: number;
  }>;
}

// ---------------------------------------------------------------------------
// EODHD API Client (Backup)
// ---------------------------------------------------------------------------

async function fetchEodhdQuote(ticker: string): Promise<StockQuote | null> {
  const rateCheck = checkRateLimit('EODHD');
  if (!rateCheck.allowed) {
    console.log(`[EODHD] Rate limit reached`);
    return null;
  }

  const symbol = `${ticker.toUpperCase()}.EGX`;
  const url = `${API_URLS.EODHD}/real-time/${symbol}?api_token=${API_KEYS.EODHD}&fmt=json`;

  console.log(`[EODHD] Fetching quote for ${symbol}`);
  recordRequest('EODHD');

  const { data, error } = await fetchWithTimeout<EodhdQuoteResponse>(url, {}, 8000);

  if (error || !data) {
    console.warn(`[EODHD] Error for ${ticker}:`, error);
    markFailure('EODHD', error);
    return null;
  }

  // EODHD returns "NA" for fields when market is closed or no data
  const close = parseEodhdNumber(data.close);
  if (close <= 0) {
    console.warn(`[EODHD] No valid price for ${ticker}`);
    markFailure('EODHD', 'No valid price');
    return null;
  }

  markSuccess('EODHD');

  const prevClose = parseEodhdNumber(data.previousClose) || close;
  const change = close - prevClose;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

  return {
    ticker: ticker.toUpperCase(),
    current_price: close,
    change: round3(change),
    change_percent: round2(changePercent),
    open: parseEodhdNumber(data.open) || undefined,
    high: parseEodhdNumber(data.high) || undefined,
    low: parseEodhdNumber(data.low) || undefined,
    previous_close: prevClose,
    volume: parseEodhdNumber(data.volume) || 0,
    source: 'eodhd',
    fetched_at: new Date().toISOString(),
  };
}

function parseEodhdNumber(value: string | number | undefined): number {
  if (value === undefined || value === null || value === 'NA') return 0;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  return isNaN(num) ? 0 : num;
}

interface EodhdQuoteResponse {
  code?: string;
  close: string | number;
  high?: string | number;
  low?: string | number;
  open?: string | number;
  volume?: string | number;
  previousClose?: string | number;
  timestamp?: number;
}

// ---------------------------------------------------------------------------
// FCSAPI Client (Forex, Gold, Commodities)
// ---------------------------------------------------------------------------

async function fetchFcsapiGold(): Promise<GoldPrice[]> {
  const rateCheck = checkRateLimit('FCSAPI');
  if (!rateCheck.allowed) {
    console.log(`[FCSAPI] Rate limit reached`);
    return [];
  }

  // FCSAPI forex endpoint for XAU/USD (Gold)
  const url = `${API_URLS.FCSAPI}/forex/latest?symbol=XAU/USD&access_key=${API_KEYS.FCSAPI}`;

  console.log(`[FCSAPI] Fetching gold prices`);
  recordRequest('FCSAPI');

  const { data, error } = await fetchWithTimeout<FcsapiForexResponse>(url, {}, 10000);

  if (error || !data || !data.response) {
    console.warn(`[FCSAPI] Error:`, error || data?.msg);
    markFailure('FCSAPI', error || data?.msg);
    return [];
  }

  markSuccess('FCSAPI');

  const prices: GoldPrice[] = [];
  const now = new Date().toISOString();

  for (const item of data.response) {
    if (item.s === 'XAU/USD') {
      // Convert USD/oz to EGP/gram (approximate)
      const usdPerOunce = item.c; // Current price
      const usdToEgpRate = 50; // Approximate USD to EGP rate
      const ouncesToGrams = 31.1035;

      const egpPerGram24 = (usdPerOunce / ouncesToGrams) * usdToEgpRate;
      const change = item.ch || 0;

      // Calculate different karats
      prices.push(
        { karat: '24', name_ar: 'عيار 24', price_per_gram: round2(egpPerGram24), change: round2(change), currency: 'EGP', source: 'fcsapi', fetched_at: now },
        { karat: '22', name_ar: 'عيار 22', price_per_gram: round2(egpPerGram24 * 0.9167), change: round2(change * 0.9167), currency: 'EGP', source: 'fcsapi', fetched_at: now },
        { karat: '21', name_ar: 'عيار 21', price_per_gram: round2(egpPerGram24 * 0.875), change: round2(change * 0.875), currency: 'EGP', source: 'fcsapi', fetched_at: now },
        { karat: '18', name_ar: 'عيار 18', price_per_gram: round2(egpPerGram24 * 0.75), change: round2(change * 0.75), currency: 'EGP', source: 'fcsapi', fetched_at: now },
        { karat: 'ounce', name_ar: 'الأونصة', price_per_gram: round2(usdPerOunce * usdToEgpRate), change: round2(change * usdToEgpRate), currency: 'EGP', source: 'fcsapi', fetched_at: now },
      );
    }
  }

  return prices;
}

interface FcsapiForexResponse {
  status?: boolean;
  code?: number;
  msg?: string;
  response?: Array<{
    id?: string;
    s: string; // symbol
    c: number; // current price
    h?: number; // high
    l?: number; // low
    o?: number; // open
    ch?: number; // change
    chp?: number; // change percent
  }>;
}

async function fetchFcsapiCurrency(pairs: string[]): Promise<CurrencyRate[]> {
  const rateCheck = checkRateLimit('FCSAPI');
  if (!rateCheck.allowed) return [];

  // FCSAPI uses symbol parameter, not id
  const symbols = pairs.join(',');
  const url = `${API_URLS.FCSAPI}/forex/latest?symbol=${symbols}&access_key=${API_KEYS.FCSAPI}`;

  console.log(`[FCSAPI] Fetching currency rates`);
  recordRequest('FCSAPI');

  const { data, error } = await fetchWithTimeout<FcsapiForexResponse>(url, {}, 10000);

  if (error || !data || !data.response) {
    console.warn(`[FCSAPI] Currency error:`, error || data?.msg);
    markFailure('FCSAPI', error || data?.msg);
    return [];
  }

  markSuccess('FCSAPI');

  const rates: CurrencyRate[] = [];
  const now = new Date().toISOString();

  for (const item of data.response) {
    const [from, to] = item.s.split('/');
    rates.push({
      from,
      to,
      rate: item.c,
      change: item.ch || null,
      name_ar: getCurrencyNameAr(from),
      source: 'fcsapi',
      fetched_at: now,
    });
  }

  return rates;
}

function getCurrencyNameAr(code: string): string {
  const names: Record<string, string> = {
    USD: 'دولار أمريكي',
    EUR: 'يورو',
    GBP: 'جنيه إسترليني',
    SAR: 'ريال سعودي',
    AED: 'درهم إماراتي',
    KWD: 'دينار كويتي',
    EGP: 'جنيه مصري',
    JPY: 'ين ياباني',
    CHF: 'فرنك سويسري',
    CNY: 'يوان صيني',
  };
  return names[code] || code;
}

// ---------------------------------------------------------------------------
// Twelve Data API Client (Secondary - 800/day free!)
// ---------------------------------------------------------------------------

async function fetchTwelveDataQuote(ticker: string): Promise<StockQuote | null> {
  const rateCheck = checkRateLimit('TWELVE_DATA');
  if (!rateCheck.allowed) {
    console.log(`[TwelveData] Rate limit reached`);
    return null;
  }

  const symbol = `${ticker.toUpperCase()}.EGX`;
  const url = `${API_URLS.TWELVE_DATA}/quote?symbol=${symbol}&apikey=${API_KEYS.TWELVE_DATA}`;

  console.log(`[TwelveData] Fetching quote for ${symbol}`);
  recordRequest('TWELVE_DATA');

  const { data, error } = await fetchWithTimeout<TwelveDataQuoteResponse>(url, {}, 8000);

  if (error || !data || data.status === 'error') {
    console.warn(`[TwelveData] Error for ${ticker}:`, error || data?.message);
    markFailure('TWELVE_DATA', error || data?.message);
    return null;
  }

  const close = parseFloat(data.close);
  if (isNaN(close) || close <= 0) {
    console.warn(`[TwelveData] No valid price for ${ticker}`);
    markFailure('TWELVE_DATA', 'No valid price');
    return null;
  }

  markSuccess('TWELVE_DATA');

  const prevClose = parseFloat(data.previous_close) || close;
  const change = close - prevClose;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

  return {
    ticker: ticker.toUpperCase(),
    name: data.name,
    current_price: close,
    change: round3(change),
    change_percent: round2(changePercent),
    open: parseFloat(data.open) || undefined,
    high: parseFloat(data.high) || undefined,
    low: parseFloat(data.low) || undefined,
    previous_close: prevClose,
    volume: parseInt(data.volume) || 0,
    source: 'twelvedata',
    fetched_at: new Date().toISOString(),
  };
}

interface TwelveDataQuoteResponse {
  symbol?: string;
  name?: string;
  close: string;
  open?: string;
  high?: string;
  low?: string;
  volume?: string;
  previous_close?: string;
  change?: string;
  percent_change?: string;
  status?: string;
  message?: string;
}

// ---------------------------------------------------------------------------
// Alpha Vantage API Client (Backup - 25/day free)
// ---------------------------------------------------------------------------

async function fetchAlphaVantageQuote(ticker: string): Promise<StockQuote | null> {
  const rateCheck = checkRateLimit('ALPHA_VANTAGE');
  if (!rateCheck.allowed) {
    console.log(`[AlphaVantage] Rate limit reached`);
    return null;
  }

  // Alpha Vantage uses .CAIRO exchange code for EGX
  const symbol = ticker.toUpperCase();
  const url = `${API_URLS.ALPHA_VANTAGE}/query?function=GLOBAL_QUOTE&symbol=${symbol}.CAIRO&apikey=${API_KEYS.ALPHA_VANTAGE}`;

  console.log(`[AlphaVantage] Fetching quote for ${symbol}`);
  recordRequest('ALPHA_VANTAGE');

  const { data, error } = await fetchWithTimeout<AlphaVantageQuoteResponse>(url, {}, 10000);

  if (error || !data || !data['Global Quote']) {
    console.warn(`[AlphaVantage] Error for ${ticker}:`, error);
    markFailure('ALPHA_VANTAGE', error);
    return null;
  }

  const quote = data['Global Quote'];
  const close = parseFloat(quote['08. previous close'] || quote['05. price'] || '0');
  if (isNaN(close) || close <= 0) {
    console.warn(`[AlphaVantage] No valid price for ${ticker}`);
    markFailure('ALPHA_VANTAGE', 'No valid price');
    return null;
  }

  markSuccess('ALPHA_VANTAGE');

  const price = parseFloat(quote['05. price']) || close;
  const change = parseFloat(quote['09. change']) || 0;
  const changePercent = parseFloat(quote['10. change percent']?.replace('%', '') || '0') || 0;

  return {
    ticker: ticker.toUpperCase(),
    current_price: price,
    change: round3(change),
    change_percent: round2(changePercent),
    open: parseFloat(quote['02. open']) || undefined,
    high: parseFloat(quote['03. high']) || undefined,
    low: parseFloat(quote['04. low']) || undefined,
    previous_close: close,
    volume: parseInt(quote['06. volume']) || 0,
    source: 'alphavantage',
    fetched_at: new Date().toISOString(),
  };
}

interface AlphaVantageQuoteResponse {
  'Global Quote'?: {
    '01. symbol': string;
    '02. open': string;
    '03. high': string;
    '04. low': string;
    '05. price': string;
    '06. volume': string;
    '08. previous close': string;
    '09. change': string;
    '10. change percent': string;
  };
  Note?: string; // Rate limit message
  'Error Message'?: string;
}

// ---------------------------------------------------------------------------
// Marketstack API Client (Backup)
// ---------------------------------------------------------------------------

async function fetchMarketstackQuote(ticker: string): Promise<StockQuote | null> {
  const rateCheck = checkRateLimit('MARKETSTACK');
  if (!rateCheck.allowed) {
    console.log(`[Marketstack] Rate limit reached`);
    return null;
  }

  const symbol = `${ticker.toUpperCase()}.XEGX`;
  const url = `${API_URLS.MARKETSTACK}/eod/latest?access_key=${API_KEYS.MARKETSTACK}&symbols=${symbol}`;

  console.log(`[Marketstack] Fetching quote for ${symbol}`);
  recordRequest('MARKETSTACK');

  const { data, error } = await fetchWithTimeout<MarketstackEodResponse>(url, {}, 8000);

  if (error || !data || !data.data || data.data.length === 0) {
    logger.warn('marketstack fetch error', { ticker, err: error instanceof Error ? error.message : String(error) });
    markFailure('MARKETSTACK', error);
    return null;
  }

  markSuccess('MARKETSTACK');

  const latest = data.data[0];
  const prevClose = latest.open || latest.close;
  const change = latest.close - prevClose;
  const changePercent = prevClose > 0 ? (change / prevClose) * 100 : 0;

  return {
    ticker: ticker.toUpperCase(),
    current_price: latest.close,
    change: round3(change),
    change_percent: round2(changePercent),
    open: latest.open,
    high: latest.high,
    low: latest.low,
    previous_close: prevClose,
    volume: latest.volume || 0,
    source: 'marketstack',
    fetched_at: new Date().toISOString(),
  };
}

interface MarketstackEodResponse {
  pagination?: { limit: number; offset: number; count: number; total: number };
  data: Array<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    symbol: string;
    exchange: string;
    date: string;
  }>;
}

// ---------------------------------------------------------------------------
// Main API Functions with Fallback
// ---------------------------------------------------------------------------

/**
 * Fetch stock quote with automatic fallback between sources.
 * Priority: VPS (unlimited) → Twelve Data (800/day) → EODHD (20/day) → Marketstack (100/month) → Alpha Vantage (25/day)
 */
export async function fetchStockQuote(ticker: string): Promise<StockQuote | null> {
  const cacheKey = `stock:${ticker.toUpperCase()}`;
  const cached = getCached<StockQuote>(cacheKey, STOCK_CACHE_TTL_MS);
  if (cached) {
    console.log(`[MultiSourceAdapter] Cache hit for ${ticker}`);
    return cached;
  }

  console.log(`[MultiSourceAdapter] Fetching quote for ${ticker}...`);

  // Source 1: VPS (Primary - unlimited, most reliable for EGX)
  if (sourceHealth.VPS.available) {
    const quote = await fetchVpsQuote(ticker);
    if (quote) {
      setCache(cacheKey, quote, 'vps');
      return quote;
    }
  }

  await sleep(200);

  // Source 2: Twelve Data (800/day - generous free tier)
  if (sourceHealth.TWELVE_DATA.available) {
    const quote = await fetchTwelveDataQuote(ticker);
    if (quote) {
      setCache(cacheKey, quote, 'twelvedata');
      return quote;
    }
  }

  await sleep(200);

  // Source 3: EODHD (20/day - limited)
  if (sourceHealth.EODHD.available) {
    const quote = await fetchEodhdQuote(ticker);
    if (quote) {
      setCache(cacheKey, quote, 'eodhd');
      return quote;
    }
  }

  await sleep(200);

  // Source 4: Marketstack (100/month - very limited)
  if (sourceHealth.MARKETSTACK.available) {
    const quote = await fetchMarketstackQuote(ticker);
    if (quote) {
      setCache(cacheKey, quote, 'marketstack');
      return quote;
    }
  }

  await sleep(200);

  // Source 5: Alpha Vantage (25/day - very limited)
  if (sourceHealth.ALPHA_VANTAGE.available) {
    const quote = await fetchAlphaVantageQuote(ticker);
    if (quote) {
      setCache(cacheKey, quote, 'alphavantage');
      return quote;
    }
  }

  logger.warn('multi-source all sources failed for ticker', { ticker });
  return null;
}

/**
 * Fetch all stocks from VPS (most efficient for bulk data).
 */
export async function fetchAllStocks(): Promise<StockQuote[]> {
  const cacheKey = 'stocks:all';
  const cached = getCached<StockQuote[]>(cacheKey, STOCK_CACHE_TTL_MS);
  if (cached && cached.length > 0) {
    logger.debug('multi-source cache hit for all stocks', { count: cached.length });
    return cached;
  }

  logger.debug('multi-source fetching all stocks');

  // VPS is the best source for all EGX stocks
  if (sourceHealth.VPS.available) {
    const stocks = await fetchVpsAllStocks();
    if (stocks.length > 0) {
      setCache(cacheKey, stocks, 'vps');
      return stocks;
    }
  }

  logger.warn('multi-source failed to fetch all stocks');
  return [];
}

/**
 * Fetch historical price data.
 * Currently returns empty array - would need EODHD paid plan for full history.
 */
export async function fetchHistoricalPrices(_ticker: string, _days: number = 30): Promise<HistoricalPrice[]> {
  // Historical data requires paid API plans
  // For now, return empty array
  logger.debug('multi-source historical data requires paid API plans');
  return [];
}

/**
 * Fetch gold prices from FCSAPI.
 */
export async function fetchGoldPrices(): Promise<GoldPrice[]> {
  const cacheKey = 'gold:prices';
  const cached = getCached<GoldPrice[]>(cacheKey, GOLD_CACHE_TTL_MS);
  if (cached && cached.length > 0) {
    return cached;
  }

  console.log(`[MultiSourceAdapter] Fetching gold prices...`);

  if (sourceHealth.FCSAPI.available) {
    const prices = await fetchFcsapiGold();
    if (prices.length > 0) {
      setCache(cacheKey, prices, 'fcsapi');
      return prices;
    }
  }

  // ❌ NO DEFAULT DATA - Return empty array instead of fake prices
  logger.warn('multi-source failed to fetch gold prices from all sources');
  return [];
}

/**
 * Fetch currency exchange rates from FCSAPI.
 */
export async function fetchCurrencyRates(pairs?: string[]): Promise<CurrencyRate[]> {
  const defaultPairs = pairs || ['USD/EGP', 'EUR/EGP', 'GBP/EGP', 'SAR/EGP', 'AED/EGP'];
  const cacheKey = `currency:${defaultPairs.join(',')}`;
  const cached = getCached<CurrencyRate[]>(cacheKey, CURRENCY_CACHE_TTL_MS);
  if (cached && cached.length > 0) {
    return cached;
  }

  logger.debug('multi-source fetching currency rates');

  if (sourceHealth.FCSAPI.available) {
    const rates = await fetchFcsapiCurrency(defaultPairs);
    if (rates.length > 0) {
      setCache(cacheKey, rates, 'fcsapi');
      return rates;
    }
  }

  // ❌ NO DEFAULT DATA - Return empty array instead of fake rates
  logger.warn('multi-source failed to fetch currency rates from all sources');
  return [];
}

/**
 * Batch fetch multiple stock quotes.
 */
export async function batchFetchStockQuotes(tickers: string[]): Promise<Map<string, StockQuote>> {
  const results = new Map<string, StockQuote>();

  // For efficiency, fetch all stocks from VPS and filter
  const allStocks = await fetchAllStocks();
  const tickerSet = new Set(tickers.map(t => t.toUpperCase()));

  for (const stock of allStocks) {
    if (tickerSet.has(stock.ticker.toUpperCase())) {
      results.set(stock.ticker, stock);
    }
  }

  console.log(`[MultiSourceAdapter] Batch fetch complete: ${results.size}/${tickers.length} found`);
  return results;
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ❌ REMOVED DEFAULT GOLD PRICES - No fake data allowed!
// function getDefaultGoldPrices() - DELETED

// ❌ REMOVED DEFAULT CURRENCY RATES - No fake data allowed!
// function getDefaultCurrencyRates() - DELETED

// ---------------------------------------------------------------------------
// Health & Status API
// ---------------------------------------------------------------------------

export function getSourceHealth(): SourceHealth[] {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  return Object.entries(sourceHealth).map(([source, health]) => {
    const state = rateLimitState[source];
    const remaining = state
      ? Math.max(0, state.dailyLimit - state.timestamps.filter(t => t > oneDayAgo).length)
      : Infinity;

    return {
      source,
      available: health.available,
      lastCheck: health.lastCheck > 0 ? new Date(health.lastCheck).toISOString() : 'never',
      successCount: health.successCount,
      failCount: health.failCount,
      lastError: health.lastError,
      rateLimitRemaining: remaining,
    };
  });
}

export function resetSourceHealth(): void {
  for (const key of Object.keys(sourceHealth)) {
    sourceHealth[key] = { available: true, lastCheck: 0, successCount: 0, failCount: 0 };
  }
  console.log('[MultiSourceAdapter] Source health reset');
}

// ---------------------------------------------------------------------------
// Export API Keys for Admin Dashboard
// ---------------------------------------------------------------------------

export function getConfiguredApiKeys(): { source: string; configured: boolean; dailyLimit: number | string }[] {
  return [
    { source: 'VPS', configured: !!API_KEYS.VPS_URL, dailyLimit: 'Unlimited' },
    { source: 'Twelve Data', configured: !!API_KEYS.TWELVE_DATA, dailyLimit: RATE_LIMITS.TWELVE_DATA.daily },
    { source: 'EODHD', configured: !!API_KEYS.EODHD, dailyLimit: RATE_LIMITS.EODHD.daily },
    { source: 'Alpha Vantage', configured: !!API_KEYS.ALPHA_VANTAGE, dailyLimit: RATE_LIMITS.ALPHA_VANTAGE.daily },
    { source: 'FCSAPI', configured: !!API_KEYS.FCSAPI, dailyLimit: `${RATE_LIMITS.FCSAPI.monthly}/month` },
    { source: 'Marketstack', configured: !!API_KEYS.MARKETSTACK, dailyLimit: `${RATE_LIMITS.MARKETSTACK.monthly}/month` },
  ];
}
