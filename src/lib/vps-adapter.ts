/**
 * vps-adapter.ts — VPS Data Adapter for EGX investment platform.
 *
 * Fetches live stock data from a remote Python FastAPI service running on the VPS
 * that wraps egxpy and TradingView data. This module is a standalone, zero-dependency
 * adapter that the Next.js backend uses as the **primary** data source, with the local
 * SQLite database as fallback.
 *
 * IMPORTANT: This module is server-side only. Never import it on the client side.
 */

// ---------------------------------------------------------------------------
// Types — VPS API response interfaces
// ---------------------------------------------------------------------------

/** Base envelope that every VPS response wraps in. */
export interface VpsBaseResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  cached?: boolean;
  source?: string;
  fetched_at?: string;
}

/** Individual stock quote from /api/stocks/{ticker} or /api/stocks/quotes */
export interface VpsStockQuote {
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
  value?: number;
  market_cap?: number;
  pe_ratio?: number;
  pb_ratio?: number;
  eps?: number;
  last_updated?: string;
}

/** Historical price point from /api/stocks/{ticker}/history */
export interface VpsHistoryPoint {
  date: string;       // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjusted_close?: number;
}

/** Market overview item from /api/market/overview */
export interface VpsMarketOverview {
  stocks?: VpsStockQuote[];
  quotes?: VpsStockQuote[];  // VPS returns 'quotes' not 'stocks'
  market_stats?: {
    gainers?: number;
    losers?: number;
    unchanged?: number;
    total_volume?: number;
    total_value?: number;
  };
  indices?: Array<{
    symbol: string;
    name?: string;
    value: number;
    change: number;
    change_percent: number;
  }>;
  last_updated?: string;
}

/** Premium analysis composite from /api/premium/{ticker} */
export interface VpsPremiumAnalysis {
  ticker: string;
  fundamentals?: VpsFundamentals;
  financials?: VpsFinancials;
  valuation?: Record<string, unknown>;
  dividends?: Record<string, unknown>;
  analyst_targets?: Record<string, unknown>;
  earnings?: Record<string, unknown>;
}

/** Fundamentals from /api/fundamentals/{ticker} */
export interface VpsFundamentals {
  ticker: string;
  market_cap?: number;
  pe_ratio?: number;
  pb_ratio?: number;
  ps_ratio?: number;
  ev_to_ebitda?: number;
  dividend_yield?: number;
  roe?: number;
  roa?: number;
  debt_to_equity?: number;
  current_ratio?: number;
  eps?: number;
  book_value_per_share?: number;
  shares_outstanding?: number;
  sector?: string;
  industry?: string;
  last_updated?: string;
}

/** Financials (income statement, balance sheet, cash flow) from /api/financials/{ticker} */
export interface VpsFinancials {
  ticker: string;
  income_statement?: Array<{
    year?: string;
    revenue?: number;
    net_income?: number;
    gross_profit?: number;
    operating_income?: number;
    eps?: number;
  }>;
  balance_sheet?: Array<{
    year?: string;
    total_assets?: number;
    total_liabilities?: number;
    total_equity?: number;
    cash?: number;
    debt?: number;
  }>;
  cash_flow?: Array<{
    year?: string;
    operating_cf?: number;
    investing_cf?: number;
    financing_cf?: number;
    free_cash_flow?: number;
  }>;
  last_updated?: string;
}

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

/**
 * Returns the VPS service URL from the environment variable.
 * Supports both EGXPY_SERVICE_URL and EGX_VPS_API_URL for backward compatibility.
 * Returns an empty string if not configured (caller should fall back).
 */
export function getVpsServiceUrl(): string {
  return process.env.EGX_VPS_API_URL || process.env.EGXPY_SERVICE_URL || '';
}

// ---------------------------------------------------------------------------
// Generic fetch wrapper with timeout and error handling
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 5_000;
const BATCH_TIMEOUT_MS = 30_000; // Increased from 10s to 30s for TradingView requests
const HEALTH_TIMEOUT_MS = 3_000;

/**
 * Make a typed GET request to the VPS service.
 * Never throws — returns null on any failure.
 */
async function vpsFetch<T>(
  path: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<VpsBaseResponse<T> | null> {
  const baseUrl = getVpsServiceUrl();
  if (!baseUrl) {
    console.warn('[VPS Adapter] EGXPY_SERVICE_URL is not configured');
    return null;
  }

  const url = `${baseUrl}${path}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      console.error(
        `[VPS Adapter] HTTP ${response.status} from ${url}`
      );
      return null;
    }

    const json = await response.json();

    // Handle both wrapped and unwrapped responses
    // VPS may return { success: true, data: {...} } or just {...} directly
    if (json.success === true && json.data) {
      // Wrapped response
      return json as VpsBaseResponse<T>;
    } else if (json.error) {
      // Error response
      console.error(`[VPS Adapter] API error: ${json.error} (url: ${url})`);
      return null;
    } else {
      // Unwrapped response - wrap it ourselves
      return {
        success: true,
        data: json as T,
        source: 'vps',
        fetched_at: new Date().toISOString(),
      };
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn(`[VPS Adapter] Timeout (${timeoutMs}ms) for ${url}`);
    } else {
      console.error(`[VPS Adapter] Fetch error for ${url}:`, err);
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Public API — Health check
// ---------------------------------------------------------------------------

/**
 * Quick health check to determine if the VPS service is reachable.
 * Uses a 3-second timeout for a fast check.
 */
export async function isVpsAvailable(): Promise<boolean> {
  const result = await vpsFetch<unknown>('/health', HEALTH_TIMEOUT_MS);
  return result !== null;
}

// ---------------------------------------------------------------------------
// Public API — Stock quote
// ---------------------------------------------------------------------------

/**
 * Fetch a single stock quote by ticker.
 * Uses the VPS endpoint: GET /api/stock/{symbol}
 * Returns the quote data (with cached/source metadata) or null on failure.
 */
export async function fetchStockQuote(
  ticker: string
): Promise<VpsBaseResponse<VpsStockQuote> | null> {
  return vpsFetch<VpsStockQuote>(
    `/api/stock/${encodeURIComponent(ticker.toUpperCase())}`
  );
}

// ---------------------------------------------------------------------------
// Public API — Stock history
// ---------------------------------------------------------------------------

/**
 * Fetch historical price data for a single stock.
 * Uses the VPS endpoint: GET /api/history/{symbol}?period=1y
 * `days` defaults to 30 if not specified (converted to period parameter).
 */
export async function fetchStockHistory(
  ticker: string,
  days: number = 30
): Promise<VpsBaseResponse<VpsHistoryPoint[]> | null> {
  // Convert days to period string for yfinance-style API
  const period = days <= 7 ? '1wk' : days <= 30 ? '1mo' : days <= 90 ? '3mo' : '1y';
  return vpsFetch<VpsHistoryPoint[]>(
    `/api/history/${encodeURIComponent(ticker.toUpperCase())}?period=${period}`
  );
}

// ---------------------------------------------------------------------------
// Public API — Batch quotes
// ---------------------------------------------------------------------------

/**
 * Fetch quotes for multiple tickers at once.
 * Uses the VPS endpoint: GET /api/stocks/all to get all stocks,
 * then filters by the requested tickers.
 * Alternatively uses /api/search for individual lookups.
 */
export async function fetchBatchQuotes(
  tickers: string[]
): Promise<VpsBaseResponse<VpsStockQuote[]> | null> {
  if (tickers.length === 0) return null;

  // For small batches, use search endpoint
  if (tickers.length <= 5) {
    const results: VpsStockQuote[] = [];
    for (const ticker of tickers) {
      const result = await vpsFetch<{ symbol: string; current_price: number; change_amount?: number; change_percent?: number; volume?: number }[]>(
        `/api/search?q=${encodeURIComponent(ticker.toUpperCase())}`,
        DEFAULT_TIMEOUT_MS
      );
      if (result?.data?.[0]) {
        const stock = result.data[0];
        results.push({
          ticker: stock.symbol,
          current_price: stock.current_price,
          change: stock.change_amount ?? 0,
          change_percent: stock.change_percent ?? 0,
          volume: stock.volume ?? 0,
        });
      }
    }
    if (results.length === 0) return null;
    return {
      success: true,
      data: results,
      source: 'vps-search',
      fetched_at: new Date().toISOString(),
    };
  }

  // For larger batches, get all stocks and filter
  const result = await vpsFetch<{ data: Array<{
    symbol: string;
    current_price: number;
    change_amount?: number;
    change_percent?: number;
    volume?: number;
    open_price?: number;
    high_price?: number;
    low_price?: number;
    previous_close?: number;
  }> }>(
    '/api/stocks/all',
    BATCH_TIMEOUT_MS
  );

  if (!result?.data?.data) return null;

  const tickerSet = new Set(tickers.map(t => t.toUpperCase()));
  const filtered = result.data.data
    .filter(s => tickerSet.has(s.symbol.toUpperCase()))
    .map(s => ({
      ticker: s.symbol,
      current_price: s.current_price,
      change: s.change_amount ?? 0,
      change_percent: s.change_percent ?? 0,
      volume: s.volume ?? 0,
      open: s.open_price,
      high: s.high_price,
      low: s.low_price,
      previous_close: s.previous_close,
    }));

  return {
    success: true,
    data: filtered,
    source: 'vps-all',
    fetched_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public API — Market overview
// ---------------------------------------------------------------------------

/**
 * Fetch a market-wide overview including all stocks, indices, and market stats.
 * Uses VPS endpoints: /api/stocks/all, /api/indices, /api/reports/daily
 */
export async function fetchMarketOverview(
  tickers?: string[]
): Promise<VpsBaseResponse<VpsMarketOverview> | null> {
  // Fetch all data in parallel
  const [stocksResult, indicesResult, reportResult] = await Promise.all([
    vpsFetch<{ data: Array<{
      symbol: string;
      current_price: number;
      change_amount?: number;
      change_percent?: number;
      volume?: number;
    }> }>('/api/stocks/all', BATCH_TIMEOUT_MS),
    vpsFetch<{ data: Array<{
      symbol: string;
      name?: string;
      current_value?: number;
      change_amount?: number;
      change_percent?: number;
    }> }>('/api/indices', DEFAULT_TIMEOUT_MS),
    vpsFetch<{ data: {
      market_summary?: {
        total_stocks?: number;
        gainers?: number;
        losers?: number;
        average_change?: number;
      };
    } }>('/api/reports/daily', DEFAULT_TIMEOUT_MS),
  ]);

  // Check if we got any data
  if (!stocksResult?.data?.data) return null;

  // Build quotes from stocks
  let stocks = stocksResult.data.data.map(s => ({
    ticker: s.symbol,
    current_price: s.current_price,
    change: s.change_amount ?? 0,
    change_percent: s.change_percent ?? 0,
    volume: s.volume ?? 0,
  }));

  // Filter by tickers if provided
  if (tickers && tickers.length > 0) {
    const tickerSet = new Set(tickers.map(t => t.toUpperCase()));
    stocks = stocks.filter(s => tickerSet.has(s.ticker.toUpperCase()));
  }

  // Build indices
  const indices = indicesResult?.data?.data?.map(i => ({
    symbol: i.symbol,
    name: i.name,
    value: i.current_value ?? 0,
    change: i.change_amount ?? 0,
    change_percent: i.change_percent ?? 0,
  })) ?? [];

  // Build market stats
  const marketStats = reportResult?.data?.data?.market_summary ?? {
    gainers: 0,
    losers: 0,
    unchanged: 0,
  };

  return {
    success: true,
    data: {
      quotes: stocks,
      indices,
      market_stats: {
        gainers: marketStats.gainers,
        losers: marketStats.losers,
        unchanged: (marketStats.total_stocks ?? stocks.length) - (marketStats.gainers ?? 0) - (marketStats.losers ?? 0),
      },
      last_updated: new Date().toISOString(),
    },
    source: 'vps-overview',
    fetched_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Public API — Premium analysis
// ---------------------------------------------------------------------------

/**
 * Fetch comprehensive premium analytics (fundamentals, financials, valuation,
 * dividends, analyst targets, earnings) for a single stock.
 */
export async function fetchPremiumAnalysis(
  ticker: string
): Promise<VpsBaseResponse<VpsPremiumAnalysis> | null> {
  return vpsFetch<VpsPremiumAnalysis>(
    `/api/premium/${encodeURIComponent(ticker.toUpperCase())}`,
    8_000 // slightly longer timeout for premium data
  );
}

// ---------------------------------------------------------------------------
// Public API — Fundamentals only
// ---------------------------------------------------------------------------

/**
 * Fetch fundamental analysis data for a single stock.
 */
export async function fetchFundamentals(
  ticker: string
): Promise<VpsBaseResponse<VpsFundamentals> | null> {
  return vpsFetch<VpsFundamentals>(
    `/api/fundamentals/${encodeURIComponent(ticker.toUpperCase())}`
  );
}

// ---------------------------------------------------------------------------
// Public API — Financials only
// ---------------------------------------------------------------------------

/**
 * Fetch financial statements (income, balance sheet, cash flow) for a stock.
 */
export async function fetchFinancials(
  ticker: string
): Promise<VpsBaseResponse<VpsFinancials> | null> {
  return vpsFetch<VpsFinancials>(
    `/api/financials/${encodeURIComponent(ticker.toUpperCase())}`
  );
}

// ---------------------------------------------------------------------------
// Convenience: Convert VPS quote to the LiveStock format used by sync-live
// ---------------------------------------------------------------------------

export interface LiveStock {
  ticker: string;
  name_ar: string;
  current_price: number;
  change: number;
  change_percent: number;
  volume: number;
  last_updated: string;
}

/**
 * Convert a VpsStockQuote[] array into the LiveStock[] format
 * expected by the existing sync-live route.
 */
export function vpsQuotesToLiveStocks(quotes: VpsStockQuote[]): LiveStock[] {
  const now = new Date().toISOString();
  return quotes
    .filter((q) => q.ticker && q.current_price > 0)
    .map((q) => ({
      ticker: q.ticker.toUpperCase(),
      name_ar: q.name_ar || q.name || q.ticker,
      current_price: q.current_price,
      change: q.change ?? q.price_change ?? 0,
      change_percent: q.change_percent ?? q.price_change_percent ?? 0,
      volume: q.volume ?? 0,
      last_updated: q.last_updated || q.last_update || now,
    }));
}

// ---------------------------------------------------------------------------
// Public API — Technical analysis
// ---------------------------------------------------------------------------

/** Technical indicators from /api/technical/{ticker} */
export interface VpsTechnicalAnalysis {
  ticker: string;
  rsi?: number;
  macd?: { macd_line: number; signal: number; histogram: number };
  bollinger_bands?: { upper: number; middle: number; lower: number; width: number };
  atr?: number;
  sma_50?: number;
  sma_200?: number;
  trend?: string;
  rsi_signal?: string;
  data_points?: number;
  source?: string;
}

/**
 * Fetch technical indicators (RSI, MACD, Bollinger Bands, ATR, SMA) for a stock.
 * Uses VPS endpoint: GET /api/indicators/{symbol}
 */
export async function fetchTechnicalAnalysis(
  ticker: string
): Promise<VpsBaseResponse<VpsTechnicalAnalysis> | null> {
  return vpsFetch<VpsTechnicalAnalysis>(
    `/api/indicators/${encodeURIComponent(ticker.toUpperCase())}`,
    15_000 // longer timeout for calculations
  );
}

// ---------------------------------------------------------------------------
// Public API — Bulk data sync to VPS
// ---------------------------------------------------------------------------

/** Stats from /api/data/stats */
export interface VpsDataStats {
  timestamp: string;
  database: { path: string; size_bytes?: number };
  stocks: { active: number; inactive: number; total: number };
  data_points: {
    price_history: number;
    dividends: number;
    predictions: number;
    recommendations: number;
  };
  date_range: { earliest?: string; latest?: string };
  sectors: Record<string, number>;
  sector_count: number;
  cache: { entries: number; ttl_seconds: number };
}

/**
 * Fetch VPS database statistics.
 */
export async function fetchDataStats(): Promise<VpsBaseResponse<VpsDataStats> | null> {
  return vpsFetch<VpsDataStats>('/api/data/stats', 5_000);
}

/**
 * Push bulk data to the VPS for local storage.
 * This allows the Next.js app to sync its DB data to the VPS.
 */
export async function pushBulkDataToVps(payload: {
  stocks?: Array<Record<string, unknown>>;
  price_history?: Array<Record<string, unknown>>;
  dividends?: Array<Record<string, unknown>>;
}): Promise<{ success: boolean; stats?: Record<string, number>; error?: string }> {
  const baseUrl = getVpsServiceUrl();
  if (!baseUrl) {
    return { success: false, error: 'EGXPY_SERVICE_URL is not configured' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add sync secret if configured
    const syncSecret = process.env.EGXPY_SYNC_SECRET;
    if (syncSecret) {
      headers['EGXPY_SYNC_SECRET'] = syncSecret;
    }

    const response = await fetch(`${baseUrl}/api/sync/bulk-data`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const json = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      return { success: false, error: String(json.detail || json.error || response.statusText) };
    }

    return { success: true, stats: json.stats as Record<string, number> };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Public API — All stocks listing
// ---------------------------------------------------------------------------

/**
 * Fetch list of all active stocks from VPS DB.
 * Uses VPS endpoint: GET /api/stocks/all
 * Note: VPS returns all stocks at once, client-side pagination is applied.
 */
export async function fetchAllStocks(
  page = 1,
  pageSize = 100,
  _sector?: string,
  search?: string
): Promise<VpsBaseResponse<{
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  data: VpsStockQuote[];
}> | null> {
  // Use search endpoint if search term provided
  if (search) {
    const searchResult = await vpsFetch<{ results: Array<{
      symbol: string;
      current_price: number;
      change_percent?: number;
      name?: string;
    }> }>(
      `/api/search?q=${encodeURIComponent(search)}`,
      DEFAULT_TIMEOUT_MS
    );

    if (!searchResult?.data?.results) return null;

    const results = searchResult.data.results.map(s => ({
      ticker: s.symbol,
      current_price: s.current_price,
      change_percent: s.change_percent ?? 0,
      volume: 0,
    }));

    return {
      success: true,
      data: {
        total: results.length,
        page: 1,
        page_size: results.length,
        total_pages: 1,
        data: results,
      },
      source: 'vps-search',
      fetched_at: new Date().toISOString(),
    };
  }

  // Get all stocks from VPS
  const result = await vpsFetch<{
    count: number;
    data: Array<{
      symbol: string;
      current_price: number;
      change_amount?: number;
      change_percent?: number;
      volume?: number;
      name?: string;
    }>;
    total_in_database: number;
  }>('/api/stocks/all', BATCH_TIMEOUT_MS);

  if (!result?.data?.data) return null;

  const allStocks: VpsStockQuote[] = result.data.data.map(s => ({
    ticker: s.symbol,
    name: s.name,
    current_price: s.current_price,
    change: s.change_amount ?? 0,
    change_percent: s.change_percent ?? 0,
    volume: s.volume ?? 0,
  }));

  const total = allStocks.length;
  const totalPages = Math.ceil(total / pageSize);
  const startIndex = (page - 1) * pageSize;
  const paginatedData = allStocks.slice(startIndex, startIndex + pageSize);

  return {
    success: true,
    data: {
      total,
      page,
      page_size: pageSize,
      total_pages: totalPages,
      data: paginatedData,
    },
    source: 'vps-all',
    fetched_at: new Date().toISOString(),
  };
}
