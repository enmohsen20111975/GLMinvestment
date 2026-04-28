/**
 * data-adapter.ts — Multi-Source Data Adapter Layer
 * طبقة المحول متعدد المصادر لبيانات البورصة المصرية (EGX)
 *
 * This is the MOST CRITICAL file for fixing the data pipeline.
 * It implements a multi-source data fetching system with automatic fallback.
 *
 * Priority order (ترتيب الأولوية):
 *   1. Twelve Data API   — Primary (800 req/day free tier, supports EGX)
 *   2. Alpha Vantage API — Backup  (25 req/day free tier)
 *   3. Mubasher scraping — Existing fallback (z-ai-web-dev-sdk page_reader)
 *   4. Web Search        — Last resort (z-ai-web-dev-sdk web_search)
 *
 * All data is validated through data-validator.ts before being returned.
 * Includes in-memory caching with 5-minute TTL and rate limiting.
 *
 * SERVER-SIDE ONLY — uses fetch, z-ai-web-dev-sdk, and direct DB access.
 */

import { validateStockData, isDataFresh, type StockDataPoint } from './data-validator';
import { fetchFromMubasher, fetchFromWebSearch } from './egx-data-sources';
import { getWritableDatabase, upsertPriceHistory, parseNumber } from './data-sync';
import ZAI from 'z-ai-web-dev-sdk';

// ---------------------------------------------------------------------------
// Unified Data Types — أنواع البيانات الموحدة
// ---------------------------------------------------------------------------

/**
 * Historical price data point (OHLCV).
 * نقطة بيانات سعرية تاريخية (افتتاح، أعلى، أدنى، إغلاق، حجم)
 */
export interface HistoricalPrice {
  date: string;   // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Standardized stock data returned by all sources.
 * بيانات السهم الموحدة التي ترجعها جميع المصادر
 */
export interface UnifiedStockData {
  ticker: string;
  current_price: number;
  open_price: number;
  high_price: number;
  low_price: number;
  close_price: number;
  volume: number;
  change: number;
  change_percent: number;
  previous_close: number;
  source: string;
  fetched_at: string;
  historical?: HistoricalPrice[];
}

// ---------------------------------------------------------------------------
// In-Memory Cache — ذاكرة تخزين مؤقتة داخلية
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (5 دقائق)

const stockCache = new Map<string, CacheEntry<UnifiedStockData>>();
const historicalCache = new Map<string, CacheEntry<HistoricalPrice[]>>();

function getCachedStock(ticker: string): UnifiedStockData | null {
  const key = ticker.toUpperCase();
  const entry = stockCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  // Remove stale entries
  if (entry) stockCache.delete(key);
  return null;
}

function setCachedStock(ticker: string, data: UnifiedStockData): void {
  const key = ticker.toUpperCase();
  stockCache.set(key, { data, timestamp: Date.now() });
}

function getCachedHistorical(ticker: string): HistoricalPrice[] | null {
  const key = `hist_${ticker.toUpperCase()}`;
  const entry = historicalCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  if (entry) historicalCache.delete(key);
  return null;
}

function setCachedHistorical(ticker: string, data: HistoricalPrice[]): void {
  const key = `hist_${ticker.toUpperCase()}`;
  historicalCache.set(key, { data, timestamp: Date.now() });
}

/**
 * Clear all cached data (useful for admin refresh operations).
 * مسح جميع البيانات المخزنة مؤقتاً
 */
export function clearDataCache(): void {
  stockCache.clear();
  historicalCache.clear();
  console.log('[DataAdapter] Cache cleared');
}

// ---------------------------------------------------------------------------
// Rate Limiting — التحكم في معدل الطلبات
// ---------------------------------------------------------------------------

interface RateLimiter {
  timestamps: number[];
  maxPerDay: number;
  label: string;
}

const rateLimiters: Record<string, RateLimiter> = {
  twelveData: { timestamps: [], maxPerDay: 800, label: 'Twelve Data' },
  alphaVantage: { timestamps: [], maxPerDay: 25, label: 'Alpha Vantage' },
};

/**
 * Check if we can make a request to a rate-limited API.
 * Returns the wait time in ms, or 0 if OK.
 * التحقق مما إذا كان بإمكاننا إجراء طلب لـ API محدود المعدل
 */
function checkApiRateLimit(source: string): number {
  const limiter = rateLimiters[source];
  if (!limiter) return 0;

  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  // Clean old timestamps (تنظيف الطوابع الزمنية القديمة)
  limiter.timestamps = limiter.timestamps.filter(ts => ts > oneDayAgo);

  if (limiter.timestamps.length >= limiter.maxPerDay) {
    const oldestInWindow = limiter.timestamps[0];
    const waitMs = oldestInWindow + 24 * 60 * 60 * 1000 - now + 1000;
    console.warn(
      `[DataAdapter] ${limiter.label} rate limit reached (${limiter.timestamps.length}/${limiter.maxPerDay}). ` +
      `Wait ${Math.round(waitMs / 60000)} min.`
    );
    return Math.max(waitMs, 0);
  }

  return 0;
}

/**
 * Record a request timestamp for rate limiting.
 * تسجيل طابع زمني للطلب للتحكم في المعدل
 */
function recordApiRequest(source: string): void {
  const limiter = rateLimiters[source];
  if (limiter) {
    limiter.timestamps.push(Date.now());
  }
}

/**
 * Sleep utility (أداة انتظار)
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Data Source Health Tracking — تتبع حالة المصادر
// ---------------------------------------------------------------------------

const sourceHealth: Record<string, { available: boolean; lastCheck: number; lastError?: string; successCount: number; failCount: number }> = {
  twelveData: { available: true, lastCheck: 0, successCount: 0, failCount: 0 },
  alphaVantage: { available: true, lastCheck: 0, successCount: 0, failCount: 0 },
  mubasher: { available: true, lastCheck: 0, successCount: 0, failCount: 0 },
  webSearch: { available: true, lastCheck: 0, successCount: 0, failCount: 0 },
};

function markSourceSuccess(source: string): void {
  if (sourceHealth[source]) {
    sourceHealth[source].available = true;
    sourceHealth[source].lastCheck = Date.now();
    sourceHealth[source].successCount++;
  }
}

function markSourceFailure(source: string, error?: string): void {
  if (sourceHealth[source]) {
    sourceHealth[source].lastCheck = Date.now();
    sourceHealth[source].lastError = error;
    sourceHealth[source].failCount++;
    // Mark as unavailable after 3 consecutive failures (وضع علامة "غير متاح" بعد 3 إخفاقات متتالية)
    if (sourceHealth[source].failCount >= 3 && sourceHealth[source].successCount === 0) {
      sourceHealth[source].available = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Source 1: Twelve Data API — المصدر الأول: Twelve Data
// ---------------------------------------------------------------------------

const TWELVE_DATA_BASE = 'https://api.twelvedata.com';

/**
 * Fetch latest quote from Twelve Data API.
 * جلب أحدث بيانات من Twelve Data
 */
async function fetchFromTwelveDataQuote(ticker: string): Promise<UnifiedStockData | null> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) {
    console.log('[DataAdapter] Twelve Data API key not configured, skipping');
    markSourceFailure('twelveData', 'API key not configured');
    return null;
  }

  // Rate limit check (التحقق من معدل الطلبات)
  const waitMs = checkApiRateLimit('twelveData');
  if (waitMs > 0) return null;

  const normalizedTicker = ticker.toUpperCase();

  // Try different EGX ticker formats (تجربة صيغ مختلفة لرمز EGX)
  const tickerFormats = [
    { symbol: normalizedTicker, exchange: 'EGX' },
    { symbol: `${normalizedTicker}.EGX`, exchange: '' },
  ];

  for (const format of tickerFormats) {
    try {
      const params = new URLSearchParams({
        symbol: format.symbol,
        apikey: apiKey,
      });
      if (format.exchange) params.set('exchange', format.exchange);

      const url = `${TWELVE_DATA_BASE}/quote?${params.toString()}`;
      console.log(`[DataAdapter] Twelve Data quote request: ${format.symbol}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      recordApiRequest('twelveData');

      if (!response.ok) {
        console.warn(`[DataAdapter] Twelve Data HTTP ${response.status} for ${ticker}`);
        markSourceFailure('twelveData', `HTTP ${response.status}`);
        continue;
      }

      const json = await response.json() as Record<string, unknown>;
      const status = String(json.status || '');

      if (status === 'error') {
        const errorMsg = String(json.message || 'Unknown Twelve Data error');
        console.warn(`[DataAdapter] Twelve Data error for ${ticker}: ${errorMsg}`);
        markSourceFailure('twelveData', errorMsg);
        continue;
      }

      // Parse Twelve Data response (تحليل استجابة Twelve Data)
      const data = parseTwelveDataQuote(json, ticker);
      if (data) {
        markSourceSuccess('twelveData');
        console.log(`[DataAdapter] ✓ Twelve Data success for ${ticker}: ${data.current_price}`);
        return data;
      }
    } catch (err) {
      recordApiRequest('twelveData');
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[DataAdapter] Twelve Data fetch error for ${ticker}: ${errorMsg}`);
      markSourceFailure('twelveData', errorMsg);
      // Small delay before retry with different format
      await sleep(500);
    }
  }

  return null;
}

/**
 * Parse Twelve Data quote response into unified format.
 * تحويل استجابة Twelve Data إلى الصيغة الموحدة
 */
function parseTwelveDataQuote(json: Record<string, unknown>, ticker: string): UnifiedStockData | null {
  const close = parseNum(json.close || json.current_price || json.last_price);
  const open = parseNum(json.open || json.open_price);
  const high = parseNum(json.high || json.day_high || json.high_price);
  const low = parseNum(json.low || json.day_low || json.low_price);
  const volume = Math.round(parseNum(json.volume || json.vol));
  const prevClose = parseNum(json.previous_close || json.prev_close);
  const change = parseNum(json.change || json.change_amount || json.price_change);
  const changePct = parseNum(json.percent_change || json.change_percent || json.change_percentage);

  if (close <= 0) return null;

  // Calculate change if not provided (حساب التغير إذا لم يتم توفيره)
  let calculatedChange = change;
  let calculatedChangePct = changePct;
  if (prevClose > 0) {
    if (calculatedChange === 0) calculatedChange = close - prevClose;
    if (calculatedChangePct === 0) calculatedChangePct = (calculatedChange / prevClose) * 100;
  }

  // Validate with data-validator (التحقق من البيانات)
  const dataPoint: StockDataPoint = {
    ticker: ticker.toUpperCase(),
    current_price: close,
    previous_close: prevClose > 0 ? prevClose : undefined,
    open_price: open > 0 ? open : close,
    high_price: high > 0 ? high : close,
    low_price: low > 0 ? low : close,
    volume,
  };

  const validation = validateStockData(dataPoint, 'twelve-data');
  if (!validation.valid) {
    console.warn(`[DataAdapter] Twelve Data validation failed for ${ticker}:`, validation.issues);
    return null;
  }

  return {
    ticker: ticker.toUpperCase(),
    current_price: round3(close),
    open_price: round3(open > 0 ? open : close),
    high_price: round3(high > 0 ? high : close),
    low_price: round3(low > 0 ? low : close),
    close_price: round3(close),
    volume,
    change: round3(calculatedChange),
    change_percent: round2(calculatedChangePct),
    previous_close: round3(prevClose > 0 ? prevClose : close - calculatedChange),
    source: 'twelve-data',
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Fetch historical OHLCV from Twelve Data API.
 * جلب بيانات OHLCV التاريخية من Twelve Data
 */
async function fetchFromTwelveDataHistorical(
  ticker: string,
  outputSize: number = 250
): Promise<HistoricalPrice[]> {
  const apiKey = process.env.TWELVE_DATA_API_KEY;
  if (!apiKey) return [];

  const waitMs = checkApiRateLimit('twelveData');
  if (waitMs > 0) return [];

  const normalizedTicker = ticker.toUpperCase();
  const tickerFormats = [
    { symbol: normalizedTicker, exchange: 'EGX' },
    { symbol: `${normalizedTicker}.EGX`, exchange: '' },
  ];

  for (const format of tickerFormats) {
    try {
      const params = new URLSearchParams({
        symbol: format.symbol,
        interval: '1day',
        outputsize: String(outputSize),
        apikey: apiKey,
      });
      if (format.exchange) params.set('exchange', format.exchange);

      const url = `${TWELVE_DATA_BASE}/time_series?${params.toString()}`;
      console.log(`[DataAdapter] Twelve Data historical request: ${format.symbol}`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);

      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      recordApiRequest('twelveData');

      if (!response.ok) continue;

      const json = await response.json() as Record<string, unknown>;

      if (json.status === 'error') {
        console.warn(`[DataAdapter] Twelve Data historical error for ${ticker}:`, json.message);
        continue;
      }

      // Parse values array (تحليل مصفوفة القيم)
      const values = json.values as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(values) || values.length === 0) continue;

      const history: HistoricalPrice[] = values
        .map(v => {
          const date = String(v.datetime || v.date || '').split(' ')[0]; // Remove time component
          const o = parseNum(v.open);
          const h = parseNum(v.high);
          const l = parseNum(v.low);
          const c = parseNum(v.close);
          const vol = Math.round(parseNum(v.volume));

          if (c <= 0 || !date) return null;
          return {
            date,
            open: round3(o > 0 ? o : c),
            high: round3(h > 0 ? h : c),
            low: round3(l > 0 ? l : c),
            close: round3(c),
            volume: vol,
          };
        })
        .filter((p): p is HistoricalPrice => p !== null)
        .reverse(); // Oldest first

      if (history.length > 0) {
        markSourceSuccess('twelveData');
        console.log(`[DataAdapter] ✓ Twelve Data historical: ${history.length} records for ${ticker}`);
        return history;
      }
    } catch (err) {
      recordApiRequest('twelveData');
      console.warn(`[DataAdapter] Twelve Data historical error for ${ticker}:`, err);
      await sleep(500);
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Source 2: Alpha Vantage API — المصدر الثاني: Alpha Vantage
// ---------------------------------------------------------------------------

const ALPHA_VANTAGE_BASE = 'https://www.alphavantage.co/query';

/**
 * Fetch stock data from Alpha Vantage API.
 * جلب بيانات السهم من Alpha Vantage
 */
async function fetchFromAlphaVantage(ticker: string): Promise<UnifiedStockData | null> {
  const apiKey = process.env.ALPHA_VANTAGE_API_KEY;
  if (!apiKey) {
    console.log('[DataAdapter] Alpha Vantage API key not configured, skipping');
    markSourceFailure('alphaVantage', 'API key not configured');
    return null;
  }

  const waitMs = checkApiRateLimit('alphaVantage');
  if (waitMs > 0) return null;

  const normalizedTicker = `${ticker.toUpperCase()}.EGX`;

  try {
    const params = new URLSearchParams({
      function: 'TIME_SERIES_DAILY',
      symbol: normalizedTicker,
      outputsize: 'compact', // Latest 100 data points
      apikey: apiKey,
    });

    const url = `${ALPHA_VANTAGE_BASE}?${params.toString()}`;
    console.log(`[DataAdapter] Alpha Vantage request: ${normalizedTicker}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    recordApiRequest('alphaVantage');

    if (!response.ok) {
      console.warn(`[DataAdapter] Alpha Vantage HTTP ${response.status} for ${ticker}`);
      markSourceFailure('alphaVantage', `HTTP ${response.status}`);
      return null;
    }

    const json = await response.json() as Record<string, unknown>;

    // Check for API errors (التحقق من أخطاء API)
    if (json['Error Message']) {
      console.warn(`[DataAdapter] Alpha Vantage error: ${json['Error Message']}`);
      markSourceFailure('alphaVantage', String(json['Error Message']));
      return null;
    }
    if (json['Note']) {
      // Rate limit notice (إشعار حد المعدل)
      console.warn(`[DataAdapter] Alpha Vantage rate limit: ${json['Note']}`);
      markSourceFailure('alphaVantage', String(json['Note']));
      return null;
    }

    // Parse "Time Series (Daily)" object (تحليل كائن السلاسل الزمنية)
    const timeSeriesKey = 'Time Series (Daily)';
    const timeSeries = json[timeSeriesKey] as Record<string, Record<string, string>> | undefined;

    if (!timeSeries || typeof timeSeries !== 'object') {
      console.warn(`[DataAdapter] Alpha Vantage: No time series data for ${ticker}`);
      markSourceFailure('alphaVantage', 'No time series data');
      return null;
    }

    // Sort dates descending to get latest first
    const sortedDates = Object.keys(timeSeries).sort((a, b) => b.localeCompare(a));
    if (sortedDates.length === 0) return null;

    // Latest data point
    const latestDate = sortedDates[0];
    const latest = timeSeries[latestDate];

    const close = parseNum(latest?.['4. close']);
    const open = parseNum(latest?.['1. open']);
    const high = parseNum(latest?.['2. high']);
    const low = parseNum(latest?.['3. low']);
    const volume = Math.round(parseNum(latest?.['5. volume']));

    // Previous close from second latest point
    let prevClose = 0;
    if (sortedDates.length > 1) {
      const prevDate = sortedDates[1];
      const prevData = timeSeries[prevDate];
      prevClose = parseNum(prevData?.['4. close']);
    }

    if (close <= 0) return null;

    // Calculate change (حساب التغير)
    const change = prevClose > 0 ? close - prevClose : 0;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    // Validate (التحقق)
    const dataPoint: StockDataPoint = {
      ticker: ticker.toUpperCase(),
      current_price: close,
      previous_close: prevClose > 0 ? prevClose : undefined,
      open_price: open > 0 ? open : close,
      high_price: high > 0 ? high : close,
      low_price: low > 0 ? low : close,
      volume,
    };

    const validation = validateStockData(dataPoint, 'alpha-vantage');
    if (!validation.valid) {
      console.warn(`[DataAdapter] Alpha Vantage validation failed for ${ticker}:`, validation.issues);
      return null;
    }

    markSourceSuccess('alphaVantage');
    console.log(`[DataAdapter] ✓ Alpha Vantage success for ${ticker}: ${close}`);

    // Build historical from the full time series (بناء البيانات التاريخية)
    const historical: HistoricalPrice[] = sortedDates
      .reverse() // Chronological order (ترتيب زمني)
      .map(dateStr => {
        const entry = timeSeries[dateStr];
        const c = parseNum(entry?.['4. close']);
        if (c <= 0) return null;
        return {
          date: dateStr,
          open: round3(parseNum(entry?.['1. open']) || c),
          high: round3(parseNum(entry?.['2. high']) || c),
          low: round3(parseNum(entry?.['3. low']) || c),
          close: round3(c),
          volume: Math.round(parseNum(entry?.['5. volume'])),
        };
      })
      .filter((p): p is HistoricalPrice => p !== null);

    return {
      ticker: ticker.toUpperCase(),
      current_price: round3(close),
      open_price: round3(open > 0 ? open : close),
      high_price: round3(high > 0 ? high : close),
      low_price: round3(low > 0 ? low : close),
      close_price: round3(close),
      volume,
      change: round3(change),
      change_percent: round2(changePct),
      previous_close: round3(prevClose > 0 ? prevClose : close - change),
      source: 'alpha-vantage',
      fetched_at: new Date().toISOString(),
      historical,
    };
  } catch (err) {
    recordApiRequest('alphaVantage');
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[DataAdapter] Alpha Vantage error for ${ticker}: ${errorMsg}`);
    markSourceFailure('alphaVantage', errorMsg);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Source 3: Mubasher (reuses egx-data-sources) — المصدر الثالث: مباشر
// ---------------------------------------------------------------------------

/**
 * Fetch from Mubasher and convert to unified format.
 * جلب البيانات من مباشر وتحويلها إلى الصيغة الموحدة
 */
async function fetchFromMubasherUnified(ticker: string): Promise<UnifiedStockData | null> {
  try {
    console.log(`[DataAdapter] Trying Mubasher for ${ticker}...`);
    const result = await fetchFromMubasher(ticker);

    if (!result.data || !result.validation.valid) {
      console.warn(`[DataAdapter] Mubasher failed for ${ticker}:`, result.validation.issues);
      markSourceFailure('mubasher', result.validation.issues.join(', '));
      return null;
    }

    const d = result.data;

    markSourceSuccess('mubasher');
    console.log(`[DataAdapter] ✓ Mubasher success for ${ticker}: ${d.current_price}`);

    return {
      ticker: d.ticker.toUpperCase(),
      current_price: round3(d.current_price),
      open_price: round3(d.open_price || d.current_price),
      high_price: round3(d.high_price || d.current_price),
      low_price: round3(d.low_price || d.current_price),
      close_price: round3(d.current_price),
      volume: d.volume || 0,
      change: round3(d.change || 0),
      change_percent: round2(d.change_percent || 0),
      previous_close: round3(d.previous_close || 0),
      source: 'mubasher',
      fetched_at: new Date().toISOString(),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[DataAdapter] Mubasher error for ${ticker}: ${errorMsg}`);
    markSourceFailure('mubasher', errorMsg);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Source 4: Web Search (last resort) — المصدر الرابع: البحث على الإنترنت
// ---------------------------------------------------------------------------

/**
 * Fetch via web search and convert to unified format.
 * جلب البيانات عبر البحث على الإنترنت وتحويلها
 */
async function fetchFromWebSearchUnified(ticker: string): Promise<UnifiedStockData | null> {
  try {
    console.log(`[DataAdapter] Trying web search for ${ticker} (last resort)...`);
    const result = await fetchFromWebSearch(ticker);

    if (!result.data || !result.validation.valid) {
      console.warn(`[DataAdapter] Web search failed for ${ticker}:`, result.validation.issues);
      markSourceFailure('webSearch', result.validation.issues.join(', '));
      return null;
    }

    const d = result.data;
    const prevClose = d.previous_close || 0;
    const change = prevClose > 0 ? d.current_price - prevClose : 0;
    const changePct = prevClose > 0 ? (change / prevClose) * 100 : 0;

    markSourceSuccess('webSearch');
    console.log(`[DataAdapter] ✓ Web search success for ${ticker}: ${d.current_price}`);

    return {
      ticker: d.ticker.toUpperCase(),
      current_price: round3(d.current_price),
      open_price: round3(d.open_price || d.current_price),
      high_price: round3(d.high_price || d.current_price),
      low_price: round3(d.low_price || d.current_price),
      close_price: round3(d.current_price),
      volume: d.volume || 0,
      change: round3(change),
      change_percent: round2(changePct),
      previous_close: round3(prevClose),
      source: 'web-search',
      fetched_at: new Date().toISOString(),
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.warn(`[DataAdapter] Web search error for ${ticker}: ${errorMsg}`);
    markSourceFailure('webSearch', errorMsg);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main Fallback Chain — سلسلة الاحتياطي الرئيسية
// ---------------------------------------------------------------------------

/**
 * Fetch latest stock data using the fallback chain.
 * جلب أحدث بيانات السهم باستخدام سلسلة الاحتياطي
 *
 * Priority: Twelve Data → Alpha Vantage → Mubasher → Web Search
 */
export async function fetchStockData(ticker: string): Promise<UnifiedStockData | null> {
  const normalizedTicker = ticker.toUpperCase();

  // Check cache first (التحقق من الذاكرة المؤقتة أولاً)
  const cached = getCachedStock(normalizedTicker);
  if (cached) {
    console.log(`[DataAdapter] Cache hit for ${normalizedTicker} (${cached.source})`);
    return cached;
  }

  console.log(`[DataAdapter] Fetching data for ${normalizedTicker} via fallback chain...`);

  // Source 1: Twelve Data API
  let data = await fetchFromTwelveDataQuote(normalizedTicker);
  if (data) {
    setCachedStock(normalizedTicker, data);
    return data;
  }

  // Brief pause between sources (انتظار قصير بين المصادر)
  await sleep(1000);

  // Source 2: Alpha Vantage API
  data = await fetchFromAlphaVantage(normalizedTicker);
  if (data) {
    setCachedStock(normalizedTicker, data);
    return data;
  }

  // Brief pause before scraping sources
  await sleep(1000);

  // Source 3: Mubasher scraping
  data = await fetchFromMubasherUnified(normalizedTicker);
  if (data) {
    setCachedStock(normalizedTicker, data);
    return data;
  }

  // Brief pause before last resort
  await sleep(500);

  // Source 4: Web search (last resort)
  data = await fetchFromWebSearchUnified(normalizedTicker);
  if (data) {
    setCachedStock(normalizedTicker, data);
    return data;
  }

  console.error(`[DataAdapter] ✗ All sources failed for ${normalizedTicker}`);
  return null;
}

// ---------------------------------------------------------------------------
// Historical Data Fetching — جلب البيانات التاريخية
// ---------------------------------------------------------------------------

/**
 * Fetch historical OHLCV data with fallback.
 * جلب بيانات OHLCV التاريخية مع الاحتياطي
 *
 * Tries Twelve Data first, then Alpha Vantage, then web-based sources.
 */
export async function fetchHistoricalData(
  ticker: string,
  days: number = 250
): Promise<HistoricalPrice[]> {
  const normalizedTicker = ticker.toUpperCase();

  // Check cache first
  const cached = getCachedHistorical(normalizedTicker);
  if (cached && cached.length > 0) {
    console.log(`[DataAdapter] Historical cache hit for ${normalizedTicker}: ${cached.length} records`);
    return cached.slice(-days); // Return only requested days
  }

  console.log(`[DataAdapter] Fetching historical data for ${normalizedTicker} (${days} days)...`);

  // Source 1: Twelve Data time series
  const twelveDataHistory = await fetchFromTwelveDataHistorical(normalizedTicker, days);
  if (twelveDataHistory.length > 0) {
    setCachedHistorical(normalizedTicker, twelveDataHistory);
    return twelveDataHistory.slice(-days);
  }

  await sleep(1000);

  // Source 2: Alpha Vantage (includes historical in its response)
  try {
    const alphaData = await fetchFromAlphaVantage(normalizedTicker);
    if (alphaData?.historical && alphaData.historical.length > 0) {
      setCachedHistorical(normalizedTicker, alphaData.historical);
      return alphaData.historical.slice(-days);
    }
  } catch {
    // Continue to next source
  }

  await sleep(1000);

  // Source 3: Mubasher / web-based historical extraction
  try {
    const zai = await ZAI.create();
    const searchQueries = [
      `${normalizedTicker} EGX stock price history chart`,
      `سعر سهم ${normalizedTicker} تاريخي بورصة مصر`,
    ];

    for (const query of searchQueries) {
      try {
        const searchResults = await zai.functions.invoke('web_search', {
          query,
          num: 3,
        }) as Array<{ url: string }>;

        if (Array.isArray(searchResults) && searchResults.length > 0) {
          for (const r of searchResults.slice(0, 2)) {
            try {
              const pageResult = await zai.functions.invoke('page_reader', {
                url: r.url,
              }) as unknown as Record<string, unknown>;
              const pageData = pageResult?.data as Record<string, unknown> | undefined;
              const html = String(pageData?.html || pageData?.content || pageResult?.html || '');

              if (html) {
                // Try to extract historical price data from tables / JSON
                const extracted = extractHistoricalFromHtml(html, normalizedTicker);
                if (extracted.length > 5) { // Minimum 5 data points to be useful
                  markSourceSuccess('webSearch');
                  setCachedHistorical(normalizedTicker, extracted);
                  return extracted.slice(-days);
                }
              }
            } catch {
              // Page read failed, continue
            }
          }
        }
      } catch {
        // Search failed, continue
      }
    }
  } catch (err) {
    console.warn(`[DataAdapter] Web-based historical fetch failed for ${normalizedTicker}:`, err);
  }

  console.warn(`[DataAdapter] No historical data found for ${normalizedTicker} from any source`);
  return [];
}

/**
 * Extract historical price data from HTML content.
 * استخراج البيانات السعرية التاريخية من محتوى HTML
 */
function extractHistoricalFromHtml(html: string, ticker: string): HistoricalPrice[] {
  const prices: HistoricalPrice[] = [];

  // Try JSON-embedded data patterns (أنماط البيانات المضمنة في JSON)
  const jsonPatterns = [
    /"historicalData"\s*:\s*(\[[\s\S]*?\])/,
    /"priceHistory"\s*:\s*(\[[\s\S]*?\])/,
    /"historical"\s*:\s*(\[[\s\S]*?\])/,
    /"chartData"\s*:\s*(\[[\s\S]*?\])/,
    /"timeSeries"\s*:\s*(\[[\s\S]*?\])/,
  ];

  for (const pattern of jsonPatterns) {
    const match = html.match(pattern);
    if (match) {
      try {
        const arr = JSON.parse(match[1]) as Array<Record<string, unknown>>;
        for (const item of arr) {
          const date = String(item.date || item.time || item.timestamp || item.x || '').split(' ')[0];
          if (!date || !date.match(/^\d{4}-\d{2}-\d{2}$/)) continue;

          const close = parseNum(item.close || item.price || item.y || item.value);
          if (close <= 0) continue;

          prices.push({
            date,
            open: round3(parseNum(item.open) || close),
            high: round3(parseNum(item.high) || close),
            low: round3(parseNum(item.low) || close),
            close: round3(close),
            volume: Math.round(parseNum(item.volume || item.vol)),
          });
        }
        if (prices.length > 0) return prices;
      } catch {
        // JSON parse failed
      }
    }
  }

  return prices;
}

// ---------------------------------------------------------------------------
// Batch Fetching — الجلب الدفعي
// ---------------------------------------------------------------------------

/**
 * Batch fetch multiple tickers with rate limiting and progress reporting.
 * جلب دفعي لعدة رموز مع التحكم في المعدل وتقارير التقدم
 *
 * @param tickers - Array of ticker symbols
 * @param options.maxConcurrent - Max concurrent requests (default: 2)
 * @param options.onProgress - Progress callback (completed, total)
 * @returns Map of ticker → UnifiedStockData
 */
export async function batchFetchStockData(
  tickers: string[],
  options?: {
    maxConcurrent?: number;
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<Map<string, UnifiedStockData>> {
  const results = new Map<string, UnifiedStockData>();
  const maxConcurrent = Math.min(options?.maxConcurrent || 2, 5); // Cap at 5 (حد أقصى 5)
  const uniqueTickers = Array.from(new Set(tickers.map(t => t.toUpperCase())));
  const total = uniqueTickers.length;

  console.log(`[DataAdapter] Batch fetch starting for ${total} tickers (concurrency: ${maxConcurrent})...`);

  // Process in chunks based on concurrency (معالجة في مجموعات)
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueTickers.length; i += maxConcurrent) {
    chunks.push(uniqueTickers.slice(i, i + maxConcurrent));
  }

  let completed = 0;

  for (const chunk of chunks) {
    // Process chunk concurrently
    const promises = chunk.map(async (ticker) => {
      try {
        const data = await fetchStockData(ticker);
        if (data) {
          results.set(ticker, data);
        }
      } catch (err) {
        console.warn(`[DataAdapter] Batch fetch error for ${ticker}:`, err);
      }

      completed++;
      if (options?.onProgress) {
        options.onProgress(completed, total);
      }
    });

    // Wait for all in chunk to complete
    await Promise.allSettled(promises);

    // Delay between chunks to respect rate limits (تأخير بين المجموعات)
    if (chunks.indexOf(chunk) < chunks.length - 1) {
      await sleep(2000);
    }
  }

  const successCount = results.size;
  console.log(`[DataAdapter] Batch fetch complete: ${successCount}/${total} successful`);

  return results;
}

// ---------------------------------------------------------------------------
// Data Source Status — حالة مصادر البيانات
// ---------------------------------------------------------------------------

/**
 * Get the health status of all data sources.
 * الحصول على حالة صحة جميع مصادر البيانات
 */
export function getDataSourceStatus(): {
  twelveData: boolean;
  alphaVantage: boolean;
  mubasher: boolean;
  webSearch: boolean;
} {
  return {
    twelveData: sourceHealth.twelveData?.available ?? !!(process.env.TWELVE_DATA_API_KEY),
    alphaVantage: sourceHealth.alphaVantage?.available ?? !!(process.env.ALPHA_VANTAGE_API_KEY),
    mubasher: sourceHealth.mubasher?.available ?? true,
    webSearch: sourceHealth.webSearch?.available ?? true,
  };
}

/**
 * Get detailed source health information for admin dashboard.
 * الحصول على معلومات صحية مفصلة للمصادر
 */
export function getDetailedSourceHealth(): Array<{
  source: string;
  available: boolean;
  lastCheck: string;
  lastError?: string;
  successCount: number;
  failCount: number;
  rateLimitRemaining?: number;
}> {
  const now = Date.now();
  const oneDayAgo = now - 24 * 60 * 60 * 1000;

  return Object.entries(sourceHealth).map(([key, health]) => ({
    source: key,
    available: health.available,
    lastCheck: health.lastCheck > 0
      ? new Date(health.lastCheck).toISOString()
      : 'never',
    lastError: health.lastError,
    successCount: health.successCount,
    failCount: health.failCount,
    rateLimitRemaining: rateLimiters[key]
      ? Math.max(0, rateLimiters[key].maxPerDay - rateLimiters[key].timestamps.filter(t => t > oneDayAgo).length)
      : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Refresh & Write to Database — تحديث وكتابة في قاعدة البيانات
// ---------------------------------------------------------------------------

/**
 * Refresh stock data and write to the database.
 * تحديث بيانات السهم وكتابتها في قاعدة البيانات
 *
 * Fetches fresh data via the fallback chain, then updates:
 *   - stocks table (current prices)
 *   - stock_price_history table (daily OHLCV)
 *
 * @param ticker - Stock ticker symbol
 * @param stockId - Database stock ID for price history
 * @returns Success/failure status with source info
 */
export async function refreshStockData(
  ticker: string,
  stockId: number
): Promise<{ success: boolean; source: string; error?: string }> {
  const normalizedTicker = ticker.toUpperCase();

  try {
    console.log(`[DataAdapter] Refreshing ${normalizedTicker} (stockId: ${stockId})...`);

    // Fetch fresh data (bypass cache by clearing first)
    stockCache.delete(normalizedTicker);
    historicalCache.delete(normalizedTicker);

    const data = await fetchStockData(normalizedTicker);
    if (!data) {
      return {
        success: false,
        source: 'none',
        error: `All data sources failed for ${normalizedTicker}`,
      };
    }

    // Write to database (الكتابة في قاعدة البيانات)
    try {
      const db = getWritableDatabase();

      // Update stocks table — current price data (تحديث جدول الأسهم)
      db.prepare(`
        UPDATE stocks
        SET current_price = ?,
            open_price = ?,
            high_price = ?,
            low_price = ?,
            volume = ?,
            previous_close = ?,
            last_update = ?
        WHERE ticker = ? COLLATE NOCASE
      `).run(
        data.current_price,
        data.open_price,
        data.high_price,
        data.low_price,
        data.volume,
        data.previous_close,
        data.fetched_at,
        normalizedTicker,
      );

      console.log(`[DataAdapter] ✓ Updated stocks table for ${normalizedTicker}`);
    } catch (dbErr) {
      console.warn(`[DataAdapter] DB update warning for ${normalizedTicker}:`, dbErr);
      // Non-fatal: data is still valid even if DB write fails
    }

    // Fetch and write historical data if we have a stock ID (كتابة البيانات التاريخية)
    if (stockId > 0) {
      try {
        const historical = await fetchHistoricalData(normalizedTicker, 30);
        if (historical.length > 0) {
          const db = getWritableDatabase();

          for (const point of historical) {
            upsertPriceHistory(db, stockId, point.date, {
              open_price: point.open,
              high_price: point.high,
              low_price: point.low,
              close_price: point.close,
              volume: point.volume,
            });
          }

          console.log(`[DataAdapter] ✓ Wrote ${historical.length} historical records for ${normalizedTicker}`);
        }
      } catch (histErr) {
        console.warn(`[DataAdapter] Historical write warning for ${normalizedTicker}:`, histErr);
      }
    }

    return {
      success: true,
      source: data.source,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[DataAdapter] Refresh error for ${normalizedTicker}:`, errorMsg);
    return {
      success: false,
      source: 'error',
      error: errorMsg,
    };
  }
}

// ---------------------------------------------------------------------------
// EGX Market Utilities — أدوات سوق البورصة المصرية
// ---------------------------------------------------------------------------

/**
 * Check if the EGX market is currently open (Sun-Thu, 10:00-14:30 Cairo).
 * التحقق مما إذا كانت بورصة مصر مفتوحة حالياً
 */
export function isEgxMarketOpen(): boolean {
  const now = new Date();
  const cairoTz = 'Africa/Cairo';

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: cairoTz,
    weekday: 'short',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  });

  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find(p => p.type === type)?.value || '';

  const weekday = get('weekday');
  const hour = parseInt(get('hour'), 10);
  const minute = parseInt(get('minute'), 10);
  const currentMinutes = hour * 60 + minute;

  // EGX trading: Sunday-Thursday, 10:00-14:30 Cairo time
  // تداول البورصة المصرية: الأحد-الخميس، 10:00-14:30 بتوقيت القاهرة
  const isTradingDay = weekday !== 'Fri' && weekday !== 'Sat';
  return isTradingDay && currentMinutes >= 600 && currentMinutes < 870;
}

/**
 * Get the last EGX trading day as YYYY-MM-DD.
 * الحصول على آخر يوم تداول في البورصة المصرية
 */
export function getLastEgxTradingDay(): string {
  const now = new Date();
  const cairoFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Cairo',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = cairoFormatter.formatToParts(now);
  const weekday = parts.find(p => p.type === 'weekday')?.value || '';
  const month = parts.find(p => p.type === 'month')?.value || '';
  const day = parts.find(p => p.type === 'day')?.value || '';
  const year = parts.find(p => p.type === 'year')?.value || '';

  let date = new Date(`${year}-${month}-${day}`);

  // Adjust for weekends (EGX is Sun-Thu) (تعديل لعطلة نهاية الأسبوع)
  if (weekday === 'Sat') date.setDate(date.getDate() - 1); // Friday
  if (weekday === 'Fri') date.setDate(date.getDate() - 1); // Thursday
  // Sunday before 10:00 Cairo → last Thursday
  if (weekday === 'Sun') {
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '0', 10);
    if (hour < 10) date.setDate(date.getDate() - 3);
  }

  return date.toISOString().split('T')[0];
}

// ---------------------------------------------------------------------------
// Helper Utilities — أدوات مساعدة
// ---------------------------------------------------------------------------

/**
 * Parse a numeric value from various input types.
 * تحليل قيمة رقمية من أنواع مدخلات مختلفة
 */
function parseNum(val: unknown): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/,/g, '').trim();
    const parsed = parseFloat(cleaned);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

/**
 * Round to 3 decimal places (EGX prices use 3 decimal places).
 * التقريب إلى 3 أرقام عشرية
 */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Round to 2 decimal places (for percentages).
 * التقريب إلى رقمين عشريين
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Initialization & Diagnostics — التهيئة والتشخيص
// ---------------------------------------------------------------------------

/**
 * Log data adapter initialization status.
 * تسجيل حالة تهيئة محول البيانات
 */
export function logAdapterStatus(): void {
  const twelveDataKey = !!process.env.TWELVE_DATA_API_KEY;
  const alphaVantageKey = !!process.env.ALPHA_VANTAGE_API_KEY;
  const cacheSize = stockCache.size + historicalCache.size;

  console.log(`
[DataAdapter] ═══════════════════════════════════════════
[DataAdapter] Status Report — تقرير الحالة
[DataAdapter] ───────────────────────────────────────────
[DataAdapter] Twelve Data API:      ${twelveDataKey ? '✓ Configured' : '✗ No API Key'}
[DataAdapter] Alpha Vantage API:    ${alphaVantageKey ? '✓ Configured' : '✗ No API Key'}
[DataAdapter] Mubasher Scraping:    ✓ Available
[DataAdapter] Web Search Fallback:  ✓ Available
[DataAdapter] Cache Entries:        ${cacheSize}
[DataAdapter] Cache TTL:            ${CACHE_TTL_MS / 1000}s
[DataAdapter] EGX Market Open:      ${isEgxMarketOpen() ? 'Yes / نعم' : 'No / لا'}
[DataAdapter] ═══════════════════════════════════════════
  `);
}

// Log status on module load (تسجيل الحالة عند تحميل الوحدة)
if (typeof window === 'undefined') {
  // Server-side only (الخادم فقط)
  logAdapterStatus();
}
