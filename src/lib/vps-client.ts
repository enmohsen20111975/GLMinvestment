/**
 * VPS API Client
 * ===============
 *
 * عميل API للتواصل مع سيرفر VPS
 * يستخدم للحصول على البيانات الثقيلة (الأسعار، المؤشرات، التوقعات)
 *
 * الاستخدام:
 * - VPS API هو الأولوية (أسرع، بيانات محدثة)
 * - Local DB هو fallback (إذا VPS غير متاح)
 */

import { enrichStockData, enrichStocksData } from './stock-names';
import { cache as centralCache } from '@/lib/cache-manager';
// FIX-WAVE-3-HIGH / AUDIT-DEEP-4 #15 (Rule 58): structured logger replaces console.error
import { logger } from '@/lib/logger';

// VPS Configuration
// VPS_API_URL should point to the Python Engine (port 8010) for real-time data
// Can be:
//   - External URL (e.g., https://api.example.com) - for remote Python backend
//   - http://127.0.0.1:8010 - when Python backend runs on same server as Next.js
//   - Empty or 'local' - use local DB only (no Python backend)
const rawVpsUrl = (process.env.VPS_API_URL || '').trim();
const VPS_API_URL = rawVpsUrl && rawVpsUrl !== 'local' ? rawVpsUrl : '';
const VPS_API_KEY = process.env.VPS_API_KEY || '';
const VPS_TIMEOUT = 15000; // 15 seconds

// Cache for VPS responses
interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

const _vpsCache = new Map<string, CacheEntry<unknown>>();
const VPS_CACHE_TTL = 30000; // 30 seconds

function getCached<T>(key: string): T | null {
  const entry = _vpsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp < VPS_CACHE_TTL) {
    return entry.data as T;
  }
  return null;
}

function setCache<T>(key: string, data: T): void {
  _vpsCache.set(key, { data, timestamp: Date.now() });
}

// VPS Health Status
let _vpsHealthy = false;
let _lastHealthCheck = 0;
let _lastFailureTime = 0;
const HEALTH_CHECK_INTERVAL = 60000; // 1 minute
const FAILURE_COOLDOWN = 30000; // 30 seconds cooldown after failure

export function isVpsHealthy(): boolean {
  // If we had a recent failure, wait for cooldown
  if (_lastFailureTime > 0 && Date.now() - _lastFailureTime < FAILURE_COOLDOWN) {
    return false;
  }
  return _vpsHealthy;
}

/**
 * Check if we should try VPS (even if not confirmed healthy)
 * Returns true if:
 * - VPS URL is configured (not empty, not pointing to ourselves)
 * - VPS is healthy, OR
 * - We haven't checked VPS yet (first request), OR
 * - Enough time has passed since last failure
 */
export function shouldTryVps(): boolean {
  // If no VPS URL configured, don't try
  if (!VPS_API_URL) return false;

  // If healthy, definitely try
  if (_vpsHealthy) return true;

  // If we had a failure, check cooldown
  if (_lastFailureTime > 0) {
    return Date.now() - _lastFailureTime >= FAILURE_COOLDOWN;
  }

  // Haven't tried yet - go ahead
  return true;
}

export function getVpsStatus(): { healthy: boolean; lastCheck: Date | null } {
  return {
    healthy: _vpsHealthy,
    lastCheck: _lastHealthCheck > 0 ? new Date(_lastHealthCheck) : null,
  };
}

/**
 * Make HTTP request to VPS API
 */
async function vpsFetch<T>(endpoint: string, options: RequestInit = {}): Promise<{
  success: boolean;
  data?: T;
  error?: string;
  status?: number;
}> {
  const url = `${VPS_API_URL}${endpoint}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), VPS_TIMEOUT);

    const headers: Record<string, string> = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    if (VPS_API_KEY) {
      headers['X-API-Key'] = VPS_API_KEY;
    }

    const response = await fetch(url, {
      ...options,
      headers,
      signal: controller.signal,
      cache: 'no-store',
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      logger.warn('vps fetch non-ok', { endpoint, status: response.status, bodyPreview: errorText.slice(0, 200) });
      return {
        success: false,
        status: response.status,
        error: `VPS returned ${response.status}`,
      };
    }

    const data = await response.json();

    // Update health status on successful request
    _vpsHealthy = true;
    _lastHealthCheck = Date.now();

    return {
      success: true,
      data: data as T,
      status: response.status,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn('vps fetch error', { endpoint, err: errorMessage });

    // Mark VPS as unhealthy on connection errors
    if (errorMessage.includes('abort') || errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('ECONNREFUSED')) {
      _vpsHealthy = false;
      _lastFailureTime = Date.now();
    }

    return {
      success: false,
      error: 'internal_error',
    };
  }
}

// =============================================================================
// VPS API METHODS
// =============================================================================

export interface VpsHealthResponse {
  status: string;
  timestamp: string;
  version: string;
  data_sources: {
    tradingview: boolean;
    numpy: boolean;
    pandas: boolean;
  };
  database: string;
  port: number;
  stats: {
    stocks_count: number;
    history_count: number;
    intraday_count: number;
    predictions_count: number;
  };
}

/**
 * Check VPS health status
 */
export async function checkVpsHealth(): Promise<{
  healthy: boolean;
  data?: VpsHealthResponse;
  error?: string;
}> {
  const result = await vpsFetch<VpsHealthResponse>('/health');

  if (result.success && result.data) {
    _vpsHealthy = result.data.status === 'ok' || result.data.status === 'healthy';
    _lastHealthCheck = Date.now();
    return { healthy: _vpsHealthy, data: result.data };
  }

  return { healthy: false, error: result.error };
}

export interface VpsStock {
  id: number;
  ticker?: string;
  symbol?: string;  // VPS uses 'symbol' in stocks table
  name?: string;
  name_ar?: string;
  sector?: string;
  industry?: string;
  exchange?: string;
  current_price?: number;
  previous_close?: number;
  open_price?: number;
  high_price?: number;
  low_price?: number;
  volume?: number;
  change_amount?: number;
  change_percent?: number;
  market_cap?: number;
  pe_ratio?: number;
  pb_ratio?: number;
  eps?: number;
  dividend_yield?: number;
  roe?: number;
  roa?: number;
  debt_to_equity?: number;
  current_ratio?: number;
  book_value_per_share?: number;
  ma_50?: number;
  ma_200?: number;
  rsi?: number;
  support_level?: number;
  resistance_level?: number;
  egx30_member?: number;
  egx70_member?: number;
  egx100_member?: number;
  is_active?: number;
  is_halal?: number;
  last_update?: string;
  last_updated?: string;  // VPS uses 'last_updated'
  source?: string;
  [key: string]: unknown;
}

export interface VpsStocksResponse {
  success: boolean;
  count: number;
  data: VpsStock[];
  timestamp: string;
}

/**
 * Get stocks from VPS
 */
export async function getVpsStocks(options?: {
  limit?: number;
  search?: string;
}): Promise<VpsStocksResponse | null> {
  const cacheKey = `vps_stocks:${JSON.stringify(options)}`;
  const cached = getCached<VpsStocksResponse>(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.search) params.set('search', options.search);

  const query = params.toString() ? `?${params.toString()}` : '';
  const result = await vpsFetch<VpsStocksResponse>(`/api/stocks${query}`);

  if (result.success && result.data) {
    // The VPS returns { count, data: [...] } format
    const stocksArray = (result.data as VpsStocksResponse).data || result.data;
    
    // Enrich stocks with names from local mapping (VPS returns name: null)
    const enrichedStocks = enrichStocksData(stocksArray as VpsStock[]);
    
    const enrichedResponse: VpsStocksResponse = {
      success: true,
      count: (result.data as VpsStocksResponse).count || enrichedStocks.length,
      data: enrichedStocks,
      timestamp: (result.data as VpsStocksResponse).timestamp || new Date().toISOString()
    };
    
    setCache(cacheKey, enrichedResponse);
    return enrichedResponse;
  }

  return null;
}

/**
 * Get single stock from VPS
 * VPS endpoint: /api/stocks/{symbol} returns { success: true, data: {...} }
 */
export async function getVpsStock(ticker: string): Promise<{
  success: boolean;
  data?: VpsStock & {
    indicators?: VpsIndicators;
    prediction?: VpsPrediction;
  };
  error?: string;
} | null> {
  const upperTicker = ticker.toUpperCase();
  const cacheKey = `vps_stock:${upperTicker}`;
  const cached = getCached<{ success: boolean; data?: VpsStock }>(cacheKey);
  if (cached) return cached as { success: boolean; data?: VpsStock };

  // Try the single stock endpoint first (returns full data including indicators)
  const singleResult = await vpsFetch<{ success: boolean; data: VpsStock }>(`/api/stocks/${upperTicker}`);

  if (singleResult.success && singleResult.data && singleResult.data) {
    const stockData = singleResult.data.data || singleResult.data;
    
    if (stockData && (stockData.ticker || stockData.symbol)) {
      // Normalize: ensure ticker field exists (VPS returns 'symbol')
      if (!stockData.ticker && stockData.symbol) {
        stockData.ticker = stockData.symbol;
      }
      // Enrich with stock names from local mapping
      const enrichedStock = enrichStockData(stockData as VpsStock);
      setCache(cacheKey, { success: true, data: enrichedStock });
      return { success: true, data: enrichedStock };
    }
  }

  // Fallback: use search endpoint (returns limited data)
  const result = await vpsFetch<{ success: boolean; count: number; data: VpsStock[] }>(`/api/stocks?search=${upperTicker}`);

  if (result.success && result.data && result.data.data && result.data.data.length > 0) {
    // Find exact match (search might return partial matches)
    const stockData = result.data.data.find((s: VpsStock) => 
      (s.symbol && s.symbol.toUpperCase() === upperTicker) ||
      (s.ticker && s.ticker.toUpperCase() === upperTicker)
    ) || result.data.data[0];

    if (stockData) {
      // Normalize: ensure ticker field exists (VPS returns 'symbol')
      if (!stockData.ticker && stockData.symbol) {
        stockData.ticker = stockData.symbol;
      }
      // Enrich with stock names from local mapping
      const enrichedStock = enrichStockData(stockData as VpsStock);
      setCache(cacheKey, { success: true, data: enrichedStock });
      return { success: true, data: enrichedStock };
    }
  }

  // Final fallback: fetch all stocks and find the one we need
  const allStocksResult = await getVpsStocks();
  if (allStocksResult && allStocksResult.success && allStocksResult.data) {
    const stock = allStocksResult.data.find((s: VpsStock) => 
      (s.symbol && s.symbol.toUpperCase() === upperTicker) ||
      (s.ticker && s.ticker.toUpperCase() === upperTicker)
    );
    
    if (stock) {
      // Normalize ticker field
      if (!stock.ticker && stock.symbol) {
        stock.ticker = stock.symbol;
      }
      // Enrich with stock names from local mapping
      const enrichedStock = enrichStockData(stock);
      setCache(cacheKey, { success: true, data: enrichedStock });
      return { success: true, data: enrichedStock };
    }
  }

  return null;
}

export interface VpsHistoryRecord {
  date: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  adjusted_close?: number;
}

export interface VpsHistoryResponse {
  success: boolean;
  data?: {
    ticker: string;
    count: number;
    history: VpsHistoryRecord[];
  };
  error?: string;
}

/**
 * Get stock price history from VPS
 */
export async function getVpsHistory(ticker: string, days: number = 365): Promise<VpsHistoryResponse | null> {
  const cacheKey = `vps_history:${ticker.toUpperCase()}:${days}`;
  const cached = getCached<VpsHistoryResponse>(cacheKey);
  if (cached) return cached;

  const result = await vpsFetch<VpsHistoryResponse>(`/api/history/${ticker.toUpperCase()}?days=${days}`);

  if (result.success && result.data) {
    setCache(cacheKey, result.data);
    return result.data;
  }

  return null;
}

export interface VpsIndicators {
  ticker: string;
  rsi?: number;
  rsi_signal?: string;
  macd?: number;
  macd_signal?: number;
  macd_histogram?: number;
  macd_trend?: string;
  sma_20?: number;
  sma_50?: number;
  ema_20?: number;
  bollinger_upper?: number;
  bollinger_middle?: number;
  bollinger_lower?: number;
  overall_signal?: string;
  signal_strength?: number;
  calculated_at?: string;
  indicators?: {
    rsi?: { value?: number; signal?: string };
    macd?: { macd?: number; signal?: number; histogram?: number; trend?: string };
    sma_20?: number;
    sma_50?: number;
    ema_20?: number;
    bollinger?: { upper?: number; middle?: number; lower?: number; current?: number };
    overall_signal?: string;
    signal_strength?: number;
    buy_signals?: number;
    sell_signals?: number;
    total_signals?: number;
  };
  current_price?: number;
}

/**
 * Get technical indicators from VPS
 */
export async function getVpsIndicators(ticker: string): Promise<{
  success: boolean;
  data?: VpsIndicators;
  cached?: boolean;
  error?: string;
} | null> {
  const cacheKey = `vps_indicators:${ticker.toUpperCase()}`;
  const cached = getCached<{ success: boolean; data?: VpsIndicators }>(cacheKey);
  if (cached) return { ...cached, cached: true } as { success: boolean; data?: VpsIndicators; cached: boolean };

  const result = await vpsFetch<{ success: boolean; data?: VpsIndicators }>(`/api/indicators/${ticker.toUpperCase()}`);

  if (result.success && result.data) {
    setCache(cacheKey, result.data);
    return { ...result.data, cached: false };
  }

  return null;
}

export interface VpsPrediction {
  ticker: string;
  prediction_date?: string;
  predicted_price?: number;
  current_price?: number;
  confidence?: number;
  trend?: string;
  model_type?: string;
  status?: string;
  days_ahead?: number;
  trend_strength?: number;
}

/**
 * Get price prediction from VPS
 */
export async function getVpsPrediction(ticker: string, days: number = 7): Promise<{
  success: boolean;
  data?: {
    ticker: string;
    current_price: number;
    prediction: VpsPrediction;
    model: string;
  };
  error?: string;
} | null> {
  const cacheKey = `vps_prediction:${ticker.toUpperCase()}:${days}`;
  const cached = getCached<{ success: boolean; data?: { ticker: string; current_price: number; prediction: VpsPrediction; model: string } }>(cacheKey);
  if (cached) return cached;

  const result = await vpsFetch<{ success: boolean; data?: { ticker: string; current_price: number; prediction: VpsPrediction; model: string } }>(`/api/predict/${ticker.toUpperCase()}?days=${days}`);

  if (result.success && result.data) {
    setCache(cacheKey, result.data);
    return result.data;
  }

  return null;
}

export interface VpsMarketOverview {
  success: boolean;
  timestamp: string;
  stats: {
    total: number;
    gainers: number;
    losers: number;
  };
  gainers: Array<{
    symbol: string;
    current_price?: number;
    previous_close?: number;
    change_percent?: number;
    volume?: number;
  }>;
  losers: Array<{
    symbol: string;
    current_price?: number;
    previous_close?: number;
    change_percent?: number;
    volume?: number;
  }>;
  most_active: Array<{
    symbol: string;
    current_price?: number;
    previous_close?: number;
    volume?: number;
  }>;
}

/**
 * Get market overview from VPS
 * VPS endpoint: /api/market/overview returns { success, timestamp, stats, gainers, losers, most_active }
 */
export async function getVpsMarketOverview(): Promise<VpsMarketOverview | null> {
  const cacheKey = 'vps_market_overview';
  const cached = getCached<VpsMarketOverview>(cacheKey);
  if (cached) return cached;

  const result = await vpsFetch<VpsMarketOverview>('/api/market/overview');

  if (result.success && result.data) {
    // Enrich market overview with stock names
    const enriched = {
      ...result.data,
      gainers: result.data.gainers.map(g => ({
        ...g,
        name: g.name || enrichStockData({ symbol: g.symbol } as VpsStock).name
      })),
      losers: result.data.losers.map(l => ({
        ...l,
        name: l.name || enrichStockData({ symbol: l.symbol } as VpsStock).name
      })),
      most_active: result.data.most_active.map(m => ({
        ...m,
        name: m.name || enrichStockData({ symbol: m.symbol } as VpsStock).name
      }))
    };
    setCache(cacheKey, enriched);
    return enriched;
  }

  return null;
}

/**
 * Trigger TradingView sync on VPS
 */
export async function syncVpsTradingView(symbols?: string[]): Promise<{
  success: boolean;
  synced?: number;
  errors?: number;
  failed_symbols?: string[];
  error?: string;
}> {
  const result = await vpsFetch<{
    success: boolean;
    synced?: number;
    errors?: number;
    failed_symbols?: string[];
  }>('/api/sync', {
    method: 'POST',
    body: JSON.stringify({ symbols }),
  });

  return result.success && result.data ? result.data : { success: false, error: result.error };
}

// =============================================================================
// HYBRID DATA FETCHER (VPS First, Local Fallback)
// =============================================================================

/**
 * Hybrid data fetcher configuration
 */
export interface HybridConfig {
  useVps: boolean;          // Whether to try VPS first
  fallbackToLocal: boolean; // Whether to fallback to local DB
  cacheTtl?: number;        // Custom cache TTL
}

const DEFAULT_HYBRID_CONFIG: HybridConfig = {
  useVps: true,
  fallbackToLocal: true,
};

/**
 * Clear VPS cache
 */
export function clearVpsCache(): void {
  _vpsCache.clear();
}

/**
 * Get VPS API URL
 */
export function getVpsApiUrl(): string {
  return VPS_API_URL;
}

/**
 * Get all stocks from VPS (alias for getVpsStocks)
 */
export async function getVpsAllStocks(): Promise<VpsStocksResponse | null> {
  return getVpsStocks();
}

// Export default object
export default {
  isVpsHealthy,
  shouldTryVps,
  getVpsStatus,
  checkVpsHealth,
  getVpsStocks,
  getVpsAllStocks,
  getVpsStock,
  getVpsHistory,
  getVpsIndicators,
  getVpsPrediction,
  getVpsMarketOverview,
  syncVpsTradingView,
  clearVpsCache,
  getVpsApiUrl,
};
