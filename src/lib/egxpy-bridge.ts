/**
 * egxpy-bridge.ts — Data fetching for EGX stocks
 *
 * This module fetches live EGX stock data using:
 * 1. VPS API Service (PRIMARY - for Hostinger deployment)
 * 2. Python tradingview-ta fallback (for local development)
 *
 * Architecture:
 *   Production (Hostinger): Next.js → VPS API → TradingView
 *   Local Development:     Next.js → Python tv_fetcher.py → TradingView
 *
 * IMPORTANT: Server-side only. Never import on the client.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execFileAsync = promisify(execFile);

// VPS API Configuration
const VPS_API_URL = process.env.EGX_VPS_API_URL || process.env.EGXPY_SERVICE_URL || '';
const VPS_API_TIMEOUT = 30_000; // 30 seconds

// Path to the tv_fetcher.py script (fallback for local dev)
const TV_FETCHER_PATH = path.join(process.cwd(), 'scripts', 'tv_fetcher.py');

// ---- Cache ----

const CACHE_TTL_MS = 180_000; // 3 minutes
const cache = new Map<string, { ts: number; data: unknown }>();

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) return entry.data as T;
  cache.delete(key);
  return null;
}

function setCache(key: string, data: unknown) {
  cache.set(key, { ts: Date.now(), data });
  // Prune old entries periodically
  if (cache.size > 300) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > CACHE_TTL_MS * 2) cache.delete(k);
    }
  }
}

function clearCache(pattern?: string) {
  if (!pattern) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.includes(pattern)) cache.delete(key);
  }
}

// ---- VPS API Client ----

interface VpsApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  count?: number;
  timestamp?: string;
}

/**
 * Check if VPS API is configured and available
 */
export async function isVpsApiAvailable(): Promise<boolean> {
  if (!VPS_API_URL) return false;

  try {
    const response = await fetch(`${VPS_API_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    const data = await response.json();
    return data.status === 'healthy';
  } catch {
    return false;
  }
}

/**
 * Make a request to the VPS API
 */
async function vpsApiGet<T>(endpoint: string, params?: Record<string, string>): Promise<T | null> {
  if (!VPS_API_URL) return null;

  const url = new URL(`${VPS_API_URL}${endpoint}`);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(VPS_API_TIMEOUT),
    });

    if (!response.ok) {
      console.warn(`[vps-api] ${endpoint} returned ${response.status}`);
      return null;
    }

    const result: VpsApiResponse<T> = await response.json();
    if (!result.success) {
      console.warn(`[vps-api] ${endpoint} error:`, result.error);
      return null;
    }

    return result.data ?? (result as unknown as T);
  } catch (err: any) {
    console.error(`[vps-api] ${endpoint} failed:`, err.message);
    return null;
  }
}

// ---- Python Execution (Fallback) ----

interface PythonResult {
  success: boolean;
  data?: any;
  error?: string;
  source?: string;
  cached?: boolean;
}

/**
 * Run the tv_fetcher.py script with arguments (local fallback)
 */
async function runTvFetcher(args: string[], timeoutMs = 30_000): Promise<string> {
  const { stdout, stderr } = await execFileAsync('python3', [TV_FETCHER_PATH, ...args], {
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
    },
  });
  if (stderr && !stderr.includes('nologin') && !stderr.includes('FutureWarning') && !stderr.includes('warning')) {
    console.warn('[tv-bridge] Python stderr:', stderr.slice(0, 200));
  }
  return stdout;
}

async function runTvFetcherJSON<T = unknown>(args: string[], timeoutMs = 30_000): Promise<T> {
  const stdout = await runTvFetcher(args, timeoutMs);
  return JSON.parse(stdout) as T;
}

// ---- Data Types ----

export interface EgxpyQuote {
  ticker: string;
  exchange: string;
  current_price: number;
  previous_close: number;
  open_price: number;
  high_price: number;
  low_price: number;
  volume: number;
  price_change: number;
  price_change_percent: number;
  last_update: string;
  source: string;
}

export interface EgxpyHistoryPoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface EgxpyHistoryResult {
  rows: EgxpyHistoryPoint[];
  summary: {
    points: number;
    change: number;
    change_percent: number;
    from: string;
    to: string;
  };
}

// ---- Public API ----

/**
 * Check if data fetching is available (VPS API or Python)
 */
export async function isEgxpyAvailable(): Promise<boolean> {
  // Try VPS API first
  if (await isVpsApiAvailable()) return true;

  // Fall back to Python check
  try {
    const result = await runTvFetcher(['quote', 'COMI'], 10_000);
    const data = JSON.parse(result);
    return data.success === true;
  } catch {
    return false;
  }
}

/**
 * Fetch a single stock quote by ticker.
 * Tries VPS API first, falls back to Python.
 * Returns null on any failure (never throws).
 */
export async function fetchQuote(ticker: string): Promise<EgxpyQuote | null> {
  const symbol = ticker.toUpperCase().trim();
  const cacheKey = `quote:${symbol}`;

  const cached = getCached<EgxpyQuote>(cacheKey);
  if (cached) return cached;

  // Try VPS API first
  if (VPS_API_URL) {
    try {
      const data = await vpsApiGet<any>(`/api/stock/${symbol}`);
      if (data) {
        const quote: EgxpyQuote = {
          ticker: symbol,
          exchange: 'EGX',
          current_price: data.price,
          previous_close: data.open || data.price - data.change,
          open_price: data.open || data.price,
          high_price: data.high || data.price,
          low_price: data.low || data.price,
          volume: data.volume || 0,
          price_change: data.change || 0,
          price_change_percent: data.change_percent || 0,
          last_update: data.timestamp || new Date().toISOString(),
          source: 'vps-api'
        };
        setCache(cacheKey, quote);
        return quote;
      }
    } catch (err: any) {
      console.warn(`[tv-bridge] VPS API failed for ${symbol}:`, err.message);
    }
  }

  // Fall back to Python
  try {
    const result = await runTvFetcherJSON<any>(['quote', symbol], 20_000);
    if (result.error || !result.success) {
      console.warn(`[tv-bridge] No data for ${symbol}:`, result.error);
      return null;
    }
    setCache(cacheKey, result);
    return result as EgxpyQuote;
  } catch (err: any) {
    console.error(`[tv-bridge] fetchQuote(${symbol}) failed:`, err.message);
    return null;
  }
}

/**
 * Fetch historical OHLCV data for a stock.
 * Returns null on any failure.
 */
export async function fetchHistory(ticker: string, days: number = 30): Promise<EgxpyHistoryResult | null> {
  const symbol = ticker.toUpperCase().trim();
  const cacheKey = `history:${symbol}:${days}`;

  const cached = getCached<EgxpyHistoryResult>(cacheKey);
  if (cached) return cached;

  // Note: History not yet implemented in VPS API or tv_fetcher.py
  // Return empty result for now
  console.warn(`[tv-bridge] fetchHistory(${symbol}) not yet implemented`);
  return {
    rows: [],
    summary: { points: 0, change: 0, change_percent: 0, from: '', to: '' }
  };
}

/**
 * Fetch quotes for multiple tickers at once.
 * Tries VPS API first, falls back to Python.
 * Returns array of quotes (empty array on failure).
 */
export async function fetchBatchQuotes(tickers: string[]): Promise<EgxpyQuote[]> {
  if (tickers.length === 0) return [];

  const symbols = tickers.map(t => t.toUpperCase().trim());
  const cacheKey = `batch:${symbols.slice(0, 10).join(',')}:${symbols.length}`;

  const cached = getCached<EgxpyQuote[]>(cacheKey);
  if (cached) return cached;

  // Try VPS API first
  if (VPS_API_URL) {
    try {
      const data = await vpsApiGet<any[]>('/api/stocks');
      if (data && Array.isArray(data)) {
        const quotes: EgxpyQuote[] = data
          .filter((item: any) => symbols.includes(item.symbol?.toUpperCase()))
          .map((item: any) => ({
            ticker: item.symbol.toUpperCase(),
            exchange: 'EGX',
            current_price: item.price,
            previous_close: item.open || item.price - item.change,
            open_price: item.open || item.price,
            high_price: item.high || item.price,
            low_price: item.low || item.price,
            volume: item.volume || 0,
            price_change: item.change || 0,
            price_change_percent: item.change_percent || 0,
            last_update: item.timestamp || new Date().toISOString(),
            source: 'vps-api'
          }));
        setCache(cacheKey, quotes);
        return quotes;
      }
    } catch (err: any) {
      console.warn('[tv-bridge] VPS API batch failed:', err.message);
    }
  }

  // Fall back to Python
  try {
    const timeout = Math.max(30_000, symbols.length * 2000);
    const result = await runTvFetcherJSON<{ results: EgxpyQuote[]; errors: any[] }>(
      ['batch', symbols.join(',')],
      timeout
    );
    if (result.errors?.length) {
      console.warn(`[tv-bridge] Batch errors:`, result.errors.map(e => e.ticker).join(', '));
    }
    setCache(cacheKey, result.results);
    return result.results;
  } catch (err: any) {
    console.error(`[tv-bridge] fetchBatchQuotes failed:`, err.message);
    return [];
  }
}

/**
 * Fetch all stocks from VPS API
 */
export async function fetchAllStocks(): Promise<EgxpyQuote[]> {
  const cacheKey = 'all_stocks';

  const cached = getCached<EgxpyQuote[]>(cacheKey);
  if (cached) return cached;

  // Try VPS API
  if (VPS_API_URL) {
    try {
      const data = await vpsApiGet<any[]>('/api/stocks');
      if (data && Array.isArray(data)) {
        const quotes: EgxpyQuote[] = data.map((item: any) => ({
          ticker: item.symbol.toUpperCase(),
          exchange: 'EGX',
          current_price: item.price,
          previous_close: item.open || item.price - item.change,
          open_price: item.open || item.price,
          high_price: item.high || item.price,
          low_price: item.low || item.price,
          volume: item.volume || 0,
          price_change: item.change || 0,
          price_change_percent: item.change_percent || 0,
          last_update: item.timestamp || new Date().toISOString(),
          source: 'vps-api'
        }));
        setCache(cacheKey, quotes);
        return quotes;
      }
    } catch (err: any) {
      console.warn('[tv-bridge] VPS API fetchAllStocks failed:', err.message);
    }
  }

  // Fall back to getting tickers from DB and fetching via Python
  const tickers = await fetchAllActiveTickers();
  return fetchBatchQuotes(tickers);
}

/**
 * Fetch indices data from VPS API
 */
export async function fetchIndices(): Promise<EgxpyQuote[]> {
  const cacheKey = 'indices';

  const cached = getCached<EgxpyQuote[]>(cacheKey);
  if (cached) return cached;

  // Try VPS API
  if (VPS_API_URL) {
    try {
      const data = await vpsApiGet<any[]>('/api/indices');
      if (data && Array.isArray(data)) {
        const quotes: EgxpyQuote[] = data.map((item: any) => ({
          ticker: item.original_symbol || item.symbol.toUpperCase(),
          exchange: 'EGX',
          current_price: item.price,
          previous_close: item.open || item.price - item.change,
          open_price: item.open || item.price,
          high_price: item.high || item.price,
          low_price: item.low || item.price,
          volume: item.volume || 0,
          price_change: item.change || 0,
          price_change_percent: item.change_percent || 0,
          last_update: item.timestamp || new Date().toISOString(),
          source: 'vps-api'
        }));
        setCache(cacheKey, quotes);
        return quotes;
      }
    } catch (err: any) {
      console.warn('[tv-bridge] VPS API fetchIndices failed:', err.message);
    }
  }

  return [];
}

/**
 * Fetch gold prices from VPS API
 */
export async function fetchGoldPrices(): Promise<EgxpyQuote[]> {
  const cacheKey = 'gold';

  const cached = getCached<EgxpyQuote[]>(cacheKey);
  if (cached) return cached;

  // Try VPS API
  if (VPS_API_URL) {
    try {
      const data = await vpsApiGet<any[]>('/api/gold');
      if (data && Array.isArray(data)) {
        const quotes: EgxpyQuote[] = data.map((item: any) => ({
          ticker: item.original_symbol || item.symbol.toUpperCase(),
          exchange: item.exchange || 'TVC',
          current_price: item.price,
          previous_close: item.open || item.price - item.change,
          open_price: item.open || item.price,
          high_price: item.high || item.price,
          low_price: item.low || item.price,
          volume: item.volume || 0,
          price_change: item.change || 0,
          price_change_percent: item.change_percent || 0,
          last_update: item.timestamp || new Date().toISOString(),
          source: 'vps-api'
        }));
        setCache(cacheKey, quotes);
        return quotes;
      }
    } catch (err: any) {
      console.warn('[tv-bridge] VPS API fetchGoldPrices failed:', err.message);
    }
  }

  return [];
}

/**
 * Fetch stock record from local SQLite database.
 * Returns null on any failure.
 */
export async function fetchDbStock(ticker: string): Promise<any | null> {
  // Not implemented - use the light DB directly
  return null;
}

/**
 * Get all active tickers from the local database.
 */
export async function fetchAllActiveTickers(): Promise<string[]> {
  const cached = getCached<string[]>('all_tickers');
  if (cached) return cached;

  try {
    // Get tickers from the light DB - ensure initialized first
    const { getLightDb, ensureInitialized } = await import('./egx-db');
    await ensureInitialized();
    const db = getLightDb();
    const rows = db.prepare('SELECT ticker FROM stocks WHERE is_active = 1 ORDER BY ticker').all() as Array<{ ticker: string }>;
    const tickers = rows.map(r => r.ticker.toUpperCase());
    setCache('all_tickers', tickers);
    return tickers;
  } catch (err) {
    console.error('[tv-bridge] fetchAllActiveTickers error:', err);
    return [];
  }
}

/**
 * Convert EgxpyQuote to LiveStock format (compatible with existing sync-live route)
 */
export function egxpyQuoteToLiveStock(quote: EgxpyQuote) {
  return {
    ticker: quote.ticker.toUpperCase(),
    current_price: quote.current_price,
    change: quote.price_change ?? 0,
    change_percent: quote.price_change_percent ?? 0,
    volume: quote.volume ?? 0,
    open: quote.open_price,
    high: quote.high_price,
    low: quote.low_price,
    previous_close: quote.previous_close,
    last_updated: quote.last_update || new Date().toISOString(),
    source: quote.source || 'egxpy',
  };
}

export { clearCache, VPS_API_URL };
