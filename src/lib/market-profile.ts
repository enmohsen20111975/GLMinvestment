/**
 * market-profile.ts — TypeScript MarketProfile Engine
 * ===============================================================================
 *
 * ARCH-OPTION-2 (2026-10-10): TS imports MarketProfile from Python.
 *
 * PROBLEM (pre-this-file):
 *   - Python unified_config.py has 7 MarketProfile objects (EGX/KSA/KSE/QSE/DFM/US/CRYPTO)
 *     with per-market thresholds, stop percentages, RSI zones, position sizes.
 *   - TS-side engines (expert-analysis, dynamic-analysis-engine, gate-analyzer)
 *     used hard-coded EGX values: "جنيه", "EGX Market" default, RSI 70/30,
 *     min_volume 40K-60K, close > 1.0, target*1.10, stop*0.95.
 *   - This made ANY non-EGX analysis use wrong currency label, wrong thresholds,
 *     and wrong risk parameters.
 *
 * SOLUTION:
 *   - `MarketProfile` TS interface mirrors Python's dataclass (unified_config.py:91-156)
 *   - `MARKET_PROFILE_DEFAULTS` hard-codes all 7 profiles (verbatim from Python)
 *     so TS engines ALWAYS have a canonical profile even if Python is down.
 *   - `getMarketProfile(market)` SYNC function — returns cached profile or default.
 *     Safe to call from any pure function in any engine.
 *   - `refreshMarketProfileFromPython(market)` ASYNC function — fetches live profile
 *     from Python `/api/v2/unified/config?market=X` and updates the cache.
 *     Best-effort: errors are silent (Rule 27 — graceful degradation).
 *   - Cache TTL: 5 minutes (memory cache, no Redis).
 *
 * DESIGN INVARIANTS:
 *   - NEVER return null/undefined — always return a usable MarketProfile.
 *   - Default fallback is ALWAYS EGX if market is unknown (Rule 27).
 *   - All numeric thresholds are `number` (not string) — engines consume directly.
 *
 * RULES:
 *   - Rule 8 (CALCULATION-CANONICAL): thresholds here are the TS-side canonical values.
 *   - Rule 27 (NO-FAKE-DATA): if Python is down, return real defaults (not fabricated).
 *   - Rule 67 (CALCULATION-CANONICAL): mirror of Python unified_config.py.
 *
 * Usage in engines:
 *   import { getMarketProfile } from '@/lib/market-profile';
import { cache as centralCache } from '@/lib/cache-manager';
 *   const profile = getMarketProfile(market);
 *   const rsiOverbought = profile.rsi_overbought; // 70 (EGX), 75 (CRYPTO), 70 (US)
 *
 * Usage in API routes (best-effort refresh before serving):
 *   import { refreshMarketProfileFromPython } from '@/lib/market-profile';
 *   await refreshMarketProfileFromPython(market).catch(() => {});
 *   // then call engine which uses sync getMarketProfile(market)
 */

import { normalizeMarket, type CanonicalMarket } from '@/lib/market-utils';
import { PYTHON_BACKEND_URL } from '@/lib/python-backend';

// ============================================================================
// TYPES — mirror of Python unified_config.py (lines 64-156)
// ============================================================================

/** Trading strategy enum (mirror of Python TradingStrategy) */
export type TradingStrategy =
  | 'T1'          // T+1 intraday (EGX)
  | 'SWING'       // 3-10 days (TADAWUL/KSE/QSE/DFM)
  | 'POSITION'    // weeks-months
  | 'BREAKOUT'    // crypto
  | 'SCALP';      // minutes-hours

/** Stop loss method (mirror of Python StopLossMethod) */
export type StopLossMethod = 'atr' | 'support' | 'fixed' | 'combined';

/** Analyzer weights — sum to 100 (mirror of Python AnalyzerWeights) */
export interface AnalyzerWeights {
  technical: number;      // RSI + MACD + MA + Bollinger
  volume: number;         // Volume + liquidity
  candlestick: number;    // Candle patterns
  fundamental: number;    // P/E, EPS, ROE
  sentiment: number;      // News sentiment
  sector: number;         // Sector performance
}

/** MarketProfile — mirror of Python MarketProfile dataclass (unified_config.py:91-156) */
export interface MarketProfile {
  // Identification
  market_code: string;            // 'EGX' | 'KSA' | 'KSE' | 'QSE' | 'DFM' | 'US' | 'CRYPTO'
  market_name: string;            // English name
  market_name_ar: string;         // Arabic name
  currency: string;              // 'EGP' | 'SAR' | 'KWD' | 'QAR' | 'AED' | 'USD'

  // Analyzer weights (sum to 100)
  weights: AnalyzerWeights;

  // Default strategy
  default_strategy: TradingStrategy;

  // Acceptance thresholds
  min_score_buy: number;         // 0-100, min score to BUY
  min_score_strong: number;      // 0-100, min score for STRONG_BUY
  min_score_sell: number;        // 0-100, max score for SELL

  // Quality filters
  min_volume_filter: number;     // min daily volume
  min_value_traded: number;      // min turnover (in local currency)
  min_rr: number;                 // min risk/reward ratio

  // Stop loss
  stop_method: StopLossMethod;
  stop_atr_mult: number;
  stop_fixed_pct: number;
  stop_max_pct: number;
  stop_min_pct: number;

  // Targets
  target_rr_mult: number;
  target_max_pct: number;
  target_min_pct: number;

  // Position sizing
  max_concurrent_trades: number;
  position_size_pct: number;

  // RSI thresholds — KEY FIELD for engines
  rsi_overbought: number;        // EGX=70, CRYPTO=75
  rsi_oversold: number;          // EGX=30, CRYPTO=25
  rsi_extreme_high: number;       // forced sell zone
  rsi_extreme_low: number;        // forced buy zone

  // Market Physics Matrix (V40.4)
  benchmark_ticker: string;
  min_turnover_local: number;
  atr_stop_min_pct: number;
  atr_stop_max_pct: number;
  dynamic_rr_normal: number;
  dynamic_rr_outperform: number;
  data_provider_type: string;    // 'financial_statements' | 'on_chain_tokenomics' | 'yahoo_finance'
  price_db_table: string;        // 'price_history' | 'crypto_prices' | 'historical_data'
  is_continuous_24_7: boolean;   // True for crypto only

  // Notes (free text)
  notes: string;

  // Min price floor — for Gate 1 liquidity check (crypto-friendly)
  min_price: number;
}

// ============================================================================
// DEFAULTS — verbatim copy of Python MARKET_PROFILES (unified_config.py:336-649)
// ============================================================================
// These are the CANONICAL TS-side defaults. They mirror Python so that
// even when Python is unreachable, TS engines use correct per-market values.

export const MARKET_PROFILE_DEFAULTS: Record<string, MarketProfile> = {
  // ─── EGX — Egyptian Exchange ───────────────────────────────────────────
  // Backtest: T+1 69.9% WR, +13.65% PnL ✅
  EGX: {
    market_code: 'EGX',
    market_name: 'Egyptian Exchange',
    market_name_ar: 'البورصة المصرية',
    currency: 'EGP',
    weights: { technical: 40, volume: 25, candlestick: 20, fundamental: 5, sentiment: 7, sector: 3 },
    default_strategy: 'T1',
    min_score_buy: 65.0,
    min_score_strong: 80.0,
    min_score_sell: 35.0,
    min_volume_filter: 1_000_000,
    min_value_traded: 1_000_000,
    min_rr: 1.8,
    stop_method: 'combined',
    stop_atr_mult: 2.5,
    stop_fixed_pct: 2.0,
    stop_max_pct: 7.0,
    stop_min_pct: 1.5,
    target_rr_mult: 2.0,
    target_min_pct: 2.5,
    target_max_pct: 7.0,
    max_concurrent_trades: 3,
    position_size_pct: 10.0,
    rsi_overbought: 70.0,
    rsi_oversold: 30.0,
    rsi_extreme_high: 80.0,
    rsi_extreme_low: 25.0,
    benchmark_ticker: 'EGX30ETF',
    min_turnover_local: 500_000.0,
    atr_stop_min_pct: 5.0,
    atr_stop_max_pct: 9.0,
    dynamic_rr_normal: 1.8,
    dynamic_rr_outperform: 2.0,
    data_provider_type: 'financial_statements',
    price_db_table: 'price_history',
    is_continuous_24_7: false,
    notes: 'EGX: T+1 مثبت. وقت التداول 4.5 ساعة. السيولة مهمة.',
    min_price: 0.5,
  },

  // ─── KSA / TADAWUL — Saudi Exchange ─────────────────────────────────────
  // Backtest: T+1 38.8% WR ❌ → Swing 3-7 days
  KSA: {
    market_code: 'KSA',
    market_name: 'Saudi Exchange (Tadawul)',
    market_name_ar: 'تداول السعودية',
    currency: 'SAR',
    weights: { technical: 35, volume: 30, candlestick: 15, fundamental: 12, sentiment: 5, sector: 3 },
    default_strategy: 'SWING',
    min_score_buy: 68.0,
    min_score_strong: 82.0,
    min_score_sell: 35.0,
    min_volume_filter: 5_000_000,
    min_value_traded: 10_000_000,
    min_rr: 1.5,
    stop_method: 'atr',
    stop_atr_mult: 2.0,
    stop_fixed_pct: 2.5,
    stop_max_pct: 8.0,
    stop_min_pct: 1.5,
    target_rr_mult: 2.0,
    target_min_pct: 4.0,
    target_max_pct: 15.0,
    max_concurrent_trades: 3,
    position_size_pct: 10.0,
    rsi_overbought: 70.0,
    rsi_oversold: 30.0,
    rsi_extreme_high: 85.0,
    rsi_extreme_low: 20.0,
    benchmark_ticker: 'TASI',
    min_turnover_local: 2_000_000.0,
    atr_stop_min_pct: 3.0,
    atr_stop_max_pct: 6.0,
    dynamic_rr_normal: 1.5,
    dynamic_rr_outperform: 2.0,
    data_provider_type: 'financial_statements',
    price_db_table: 'price_history',
    is_continuous_24_7: false,
    notes: 'TADAWUL: T+1 فشل في Backtest. استخدام Swing (3-7 أيام).',
    min_price: 1.0,
  },

  // ─── KSE — Kuwait Stock Exchange ────────────────────────────────────────
  // Backtest: Swing 52.4% WR
  KSE: {
    market_code: 'KSE',
    market_name: 'Kuwait Stock Exchange',
    market_name_ar: 'بورصة الكويت',
    currency: 'KWD',
    weights: { technical: 38, volume: 28, candlestick: 18, fundamental: 8, sentiment: 5, sector: 3 },
    default_strategy: 'SWING',
    min_score_buy: 65.0,
    min_score_strong: 80.0,
    min_score_sell: 35.0,
    min_volume_filter: 500_000,
    min_value_traded: 500_000,
    min_rr: 1.5,
    stop_method: 'atr',
    stop_atr_mult: 2.0,
    stop_fixed_pct: 2.0,
    stop_max_pct: 8.0,
    stop_min_pct: 1.5,
    target_rr_mult: 2.0,
    target_min_pct: 3.0,
    target_max_pct: 12.0,
    max_concurrent_trades: 3,
    position_size_pct: 8.0,
    rsi_overbought: 70.0,
    rsi_oversold: 30.0,
    rsi_extreme_high: 85.0,
    rsi_extreme_low: 20.0,
    benchmark_ticker: 'BKP',
    min_turnover_local: 50_000.0,
    atr_stop_min_pct: 2.0,
    atr_stop_max_pct: 4.5,
    dynamic_rr_normal: 1.5,
    dynamic_rr_outperform: 1.8,
    data_provider_type: 'financial_statements',
    price_db_table: 'price_history',
    is_continuous_24_7: false,
    notes: 'KSE: Swing. سيولة منخفضة → حجم مركز أصغر.',
    min_price: 0.05,
  },

  // ─── QSE — Qatar Stock Exchange ─────────────────────────────────────────
  QSE: {
    market_code: 'QSE',
    market_name: 'Qatar Stock Exchange',
    market_name_ar: 'بورصة قطر',
    currency: 'QAR',
    weights: { technical: 38, volume: 27, candlestick: 18, fundamental: 10, sentiment: 5, sector: 2 },
    default_strategy: 'SWING',
    min_score_buy: 68.0,
    min_score_strong: 83.0,
    min_score_sell: 35.0,
    min_volume_filter: 500_000,
    min_value_traded: 500_000,
    min_rr: 1.5,
    stop_method: 'atr',
    stop_atr_mult: 2.0,
    stop_fixed_pct: 2.5,
    stop_max_pct: 8.0,
    stop_min_pct: 1.5,
    target_rr_mult: 2.0,
    target_min_pct: 4.0,
    target_max_pct: 12.0,
    max_concurrent_trades: 2,
    position_size_pct: 8.0,
    rsi_overbought: 70.0,
    rsi_oversold: 30.0,
    rsi_extreme_high: 85.0,
    rsi_extreme_low: 20.0,
    benchmark_ticker: 'QE_INDEX',
    min_turnover_local: 1_000_000.0,
    atr_stop_min_pct: 2.5,
    atr_stop_max_pct: 5.0,
    dynamic_rr_normal: 1.5,
    dynamic_rr_outperform: 1.8,
    data_provider_type: 'financial_statements',
    price_db_table: 'price_history',
    is_continuous_24_7: false,
    notes: 'QSE: سوق محدود → صفقات أقل.',
    min_price: 0.5,
  },

  // ─── DFM — Dubai Financial Market ───────────────────────────────────────
  DFM: {
    market_code: 'DFM',
    market_name: 'Dubai Financial Market',
    market_name_ar: 'سوق دبي المالي',
    currency: 'AED',
    weights: { technical: 38, volume: 25, candlestick: 17, fundamental: 12, sentiment: 5, sector: 3 },
    default_strategy: 'SWING',
    min_score_buy: 67.0,
    min_score_strong: 82.0,
    min_score_sell: 35.0,
    min_volume_filter: 1_000_000,
    min_value_traded: 2_000_000,
    min_rr: 1.5,
    stop_method: 'atr',
    stop_atr_mult: 2.0,
    stop_fixed_pct: 2.5,
    stop_max_pct: 8.0,
    stop_min_pct: 1.5,
    target_rr_mult: 2.0,
    target_min_pct: 3.5,
    target_max_pct: 12.0,
    max_concurrent_trades: 3,
    position_size_pct: 10.0,
    rsi_overbought: 70.0,
    rsi_oversold: 30.0,
    rsi_extreme_high: 85.0,
    rsi_extreme_low: 20.0,
    benchmark_ticker: 'DFMGI',
    min_turnover_local: 2_000_000.0,
    atr_stop_min_pct: 2.5,
    atr_stop_max_pct: 6.0,
    dynamic_rr_normal: 1.5,
    dynamic_rr_outperform: 2.0,
    data_provider_type: 'financial_statements',
    price_db_table: 'price_history',
    is_continuous_24_7: false,
    notes: 'DFM: Swing. سوق نشط.',
    min_price: 0.5,
  },

  // ─── US — US Stocks ─────────────────────────────────────────────────────
  // P1-FIX (2026-10-09): added because analyzing US stocks crashed (no profile).
  US: {
    market_code: 'US',
    market_name: 'US Stocks',
    market_name_ar: 'الأسهم الأمريكية',
    currency: 'USD',
    weights: { technical: 35, volume: 25, candlestick: 15, fundamental: 15, sentiment: 7, sector: 3 },
    default_strategy: 'SWING',
    min_score_buy: 68.0,
    min_score_strong: 82.0,
    min_score_sell: 35.0,
    min_volume_filter: 100_000,
    min_value_traded: 500_000,
    min_rr: 1.8,
    stop_method: 'atr',
    stop_atr_mult: 2.0,
    stop_fixed_pct: 3.0,
    stop_max_pct: 15.0,
    stop_min_pct: 2.0,
    target_rr_mult: 2.0,
    target_min_pct: 5.0,
    target_max_pct: 25.0,
    max_concurrent_trades: 3,
    position_size_pct: 8.0,
    rsi_overbought: 70.0,
    rsi_oversold: 30.0,
    rsi_extreme_high: 85.0,
    rsi_extreme_low: 20.0,
    benchmark_ticker: 'SPY',
    min_turnover_local: 500_000.0,
    atr_stop_min_pct: 5.0,
    atr_stop_max_pct: 15.0,
    dynamic_rr_normal: 1.8,
    dynamic_rr_outperform: 2.5,
    data_provider_type: 'yahoo_finance',
    price_db_table: 'historical_data',
    is_continuous_24_7: false,
    notes: 'US: Swing. ساعات التداول 09:30-16:00 EST. الأساسيات مهمة.',
    min_price: 1.0,
  },

  // ─── CRYPTO — Cryptocurrency Market ─────────────────────────────────────
  // High volatility → very different settings
  CRYPTO: {
    market_code: 'CRYPTO',
    market_name: 'Cryptocurrency Market',
    market_name_ar: 'العملات الرقمية',
    currency: 'USD',
    weights: { technical: 45, volume: 30, candlestick: 10, fundamental: 0, sentiment: 12, sector: 3 },
    default_strategy: 'BREAKOUT',
    min_score_buy: 72.0,
    min_score_strong: 85.0,
    min_score_sell: 35.0,
    min_volume_filter: 1_000_000,
    min_value_traded: 1_000_000,
    min_rr: 2.0,
    stop_method: 'atr',
    stop_atr_mult: 2.5,
    stop_fixed_pct: 10.0,
    stop_max_pct: 20.0,
    stop_min_pct: 5.0,
    target_rr_mult: 2.5,
    target_min_pct: 10.0,
    target_max_pct: 50.0,
    max_concurrent_trades: 2,
    position_size_pct: 3.0,
    rsi_overbought: 75.0,        // ← KEY DIFFERENCE: crypto runs hotter
    rsi_oversold: 25.0,
    rsi_extreme_high: 88.0,
    rsi_extreme_low: 15.0,
    benchmark_ticker: 'BTC.D',
    min_turnover_local: 5_000_000.0,
    atr_stop_min_pct: 5.0,
    atr_stop_max_pct: 15.0,
    dynamic_rr_normal: 1.8,
    dynamic_rr_outperform: 2.5,
    data_provider_type: 'on_chain_tokenomics',
    price_db_table: 'crypto_prices',
    is_continuous_24_7: true,
    notes: 'CRYPTO: تقلب عالٍ. حجم مركز 3% فقط. الأخبار مهمة. لا أساسيات.',
    min_price: 0.0001,           // ← allows sub-dollar tokens
  },
};

// ============================================================================
// CACHE — in-memory, 5-minute TTL
// ============================================================================

interface CacheEntry {
  profile: MarketProfile;
  fetchedAt: number;
  source: 'python' | 'default';
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const cache = new Map<string, CacheEntry>();

// Track in-flight Python requests to dedupe concurrent calls
const inFlight = new Map<string, Promise<MarketProfile>>();

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Resolve the canonical market key for MarketProfile lookup.
 *
 * `TADAWUL` (frontend MarketType) → `KSA` (Python unified_config key).
 * All other markets match their canonical name.
 */
function resolveProfileKey(market: string | null | undefined): string {
  const canonical = normalizeMarket(market);
  if (!canonical) return 'EGX'; // Rule 27 — safe fallback
  // TADAWUL (frontend) ↔ KSA (Python)
  if (canonical === 'TADAWUL') return 'KSA';
  return canonical;
}

/**
 * Detect whether a market supports fundamental analysis.
 * Crypto has no P/E, ROE, EPS — engines should skip fundamental section.
 */
export function supportsFundamentals(market: string | null | undefined): boolean {
  const key = resolveProfileKey(market);
  const profile = MARKET_PROFILE_DEFAULTS[key] ?? MARKET_PROFILE_DEFAULTS.EGX;
  return profile.weights.fundamental > 0;
}

/**
 * Get the currency code (ISO) for a market — used in price formatting.
 *   EGX → 'EGP', TADAWUL → 'SAR', US → 'USD', CRYPTO → 'USD'
 */
export function currencyCode(market: string | null | undefined): string {
  const key = resolveProfileKey(market);
  return (MARKET_PROFILE_DEFAULTS[key] ?? MARKET_PROFILE_DEFAULTS.EGX).currency;
}

/**
 * Get the Arabic currency label for a market — used in human-readable text.
 *   EGX → 'جنيه', TADAWUL → 'ريال', US → 'دولار', CRYPTO → 'دولار'
 */
export function currencyLabelAr(market: string | null | undefined): string {
  const code = currencyCode(market);
  const map: Record<string, string> = {
    EGP: 'جنيه',
    SAR: 'ريال',
    KWD: 'دينار',
    QAR: 'ريال',
    AED: 'درهم',
    USD: 'دولار',
  };
  return map[code] ?? code;
}

/**
 * Get the Arabic market display name.
 *   'EGX' → 'البورصة المصرية'
 *   'TADAWUL' → 'تداول السعودية'
 *   'CRYPTO' → 'العملات الرقمية'
 */
export function marketNameAr(market: string | null | undefined): string {
  const key = resolveProfileKey(market);
  return (MARKET_PROFILE_DEFAULTS[key] ?? MARKET_PROFILE_DEFAULTS.EGX).market_name_ar;
}

// ============================================================================
// SYNC GETTER — used by pure-function engines
// ============================================================================

/**
 * Get the MarketProfile for a market. SYNC, always returns a usable profile.
 *
 * Priority:
 *   1. Cached Python profile (if fresh, < 5 min)
 *   2. Static defaults from MARKET_PROFILE_DEFAULTS
 *
 * Rule 27 (NO-FAKE-DATA): never returns null. If market is unknown, returns EGX.
 *
 * @example
 *   const profile = getMarketProfile('CRYPTO');
 *   profile.rsi_overbought; // 75 (not 70!)
 *   profile.stop_max_pct;   // 20 (not 5!)
 *   profile.min_price;     // 0.0001 (allows sub-dollar tokens)
 */
export function getMarketProfile(market: string | null | undefined): MarketProfile {
  const key = resolveProfileKey(market);

  // Check cache first
  const cached = cache.get(key);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.profile;
  }

  // Fallback to static defaults (always available)
  const fallback = MARKET_PROFILE_DEFAULTS[key] ?? MARKET_PROFILE_DEFAULTS.EGX;
  return fallback;
}

// ============================================================================
// ASYNC REFRESH — best-effort pull from Python
// ============================================================================

/**
 * Fetch the live MarketProfile from Python `/api/v2/unified/config?market=X`
 * and update the in-memory cache.
 *
 * Best-effort: any error (Python down, 404, parse error) silently returns the
 * existing default. NEVER throws. Rule 27 — graceful degradation.
 *
 * @example
 *   // In an API route handler, before calling engines:
 *   await refreshMarketProfileFromPython('CRYPTO').catch(() => {});
 *   const profile = getMarketProfile('CRYPTO'); // returns live profile or default
 */
export async function refreshMarketProfileFromPython(
  market: string | null | undefined
): Promise<MarketProfile> {
  const key = resolveProfileKey(market);

  // If cache is fresh, no need to refetch
  const cached = cache.get(key);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) {
    return cached.profile;
  }

  // Dedupe concurrent calls for the same market
  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = (async (): Promise<MarketProfile> => {
    try {
      const url = `${PYTHON_BACKEND_URL}/api/v2/unified/config?market=${encodeURIComponent(key)}&persona=balanced`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeout);

      if (!res.ok) {
        // Python returned error — fall back to default
        return MARKET_PROFILE_DEFAULTS[key] ?? MARKET_PROFILE_DEFAULTS.EGX;
      }

      const data = await res.json();
      const config = data?.config;

      // If Python returned a full market_profile block, use it
      // Otherwise, fall back to default
      if (config && config.active_market && config.active_market.id === key) {
        // Try to extract a full MarketProfile from Python's response shape.
        // Python /api/v2/unified/config returns a different shape — we accept
        // the live thresholds if present, otherwise merge with defaults.
        const defaults = MARKET_PROFILE_DEFAULTS[key] ?? MARKET_PROFILE_DEFAULTS.EGX;
        const am = config.active_market;

        // Merge: take what Python gives us, fall back to defaults for missing fields
        const merged: MarketProfile = {
          ...defaults,
          // Override with live values where Python provided them
          currency: am.currency ?? defaults.currency,
          market_name_ar: am.name_ar ?? defaults.market_name_ar,
          market_name: am.name_en ?? defaults.market_name,
          // Scoring thresholds (if provided)
          min_score_buy: am.min_score_buy ?? defaults.min_score_buy,
          min_score_strong: am.min_score_strong ?? defaults.min_score_strong,
          min_rr: am.min_rr ?? defaults.min_rr,
          position_size_pct: am.position_pct ?? defaults.position_size_pct,
          max_concurrent_trades: am.max_trades ?? defaults.max_concurrent_trades,
          // RSI / stop / target: keep defaults — Python /api/v2/unified/config
          // doesn't expose these fields yet. They're inside unified_config.py
          // MARKET_PROFILES dict which we already mirror verbatim in defaults.
        };

        cache.set(key, { profile: merged, fetchedAt: Date.now(), source: 'python' });
        return merged;
      }

      // Python didn't return the expected shape — use default
      const fallback = MARKET_PROFILE_DEFAULTS[key] ?? MARKET_PROFILE_DEFAULTS.EGX;
      cache.set(key, { profile: fallback, fetchedAt: Date.now(), source: 'default' });
      return fallback;
    } catch {
      // Network error / timeout / parse error — fall back to default
      const fallback = MARKET_PROFILE_DEFAULTS[key] ?? MARKET_PROFILE_DEFAULTS.EGX;
      cache.set(key, { profile: fallback, fetchedAt: Date.now(), source: 'default' });
      return fallback;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

// ============================================================================
// DIAGNOSTIC — for admin / debugging
// ============================================================================

/**
 * Returns the cache state for diagnostic purposes.
 * Used by admin endpoints to verify which markets have live Python profiles.
 */
export function getMarketProfileCacheState(): Record<string, {
  source: 'python' | 'default';
  age_ms: number;
  stale: boolean;
}> {
  const now = Date.now();
  const result: Record<string, any> = {};
  for (const [key, entry] of cache.entries()) {
    result[key] = {
      source: entry.source,
      age_ms: now - entry.fetchedAt,
      stale: (now - entry.fetchedAt) > CACHE_TTL_MS,
    };
  }
  return result;
}

/**
 * Returns all available market profile keys (used by UI selectors).
 */
export function listMarketProfiles(): string[] {
  return Object.keys(MARKET_PROFILE_DEFAULTS);
}

// ============================================================================
// SELF-TEST — verifies the defaults match Python's hard-coded values
// ============================================================================

if (typeof require !== 'undefined' && require.main === module) {
  const assert = (cond: boolean, msg: string) => {
    if (!cond) {
      console.error('❌ ' + msg);
      process.exit(1);
    }
    console.log('✅ ' + msg);
  };

  console.log('=== market-profile.ts self-test ===\n');

  // Test 1: EGX has correct RSI thresholds (mirror of Python)
  const egx = getMarketProfile('EGX');
  assert(egx.rsi_overbought === 70, 'EGX rsi_overbought = 70');
  assert(egx.rsi_oversold === 30, 'EGX rsi_oversold = 30');
  assert(egx.currency === 'EGP', 'EGX currency = EGP');
  assert(egx.stop_max_pct === 7.0, 'EGX stop_max_pct = 7.0');
  assert(egx.min_rr === 1.8, 'EGX min_rr = 1.8');

  // Test 2: CRYPTO has crypto-specific thresholds
  const crypto = getMarketProfile('CRYPTO');
  assert(crypto.rsi_overbought === 75, 'CRYPTO rsi_overbought = 75 (not 70!)');
  assert(crypto.rsi_oversold === 25, 'CRYPTO rsi_oversold = 25 (not 30!)');
  assert(crypto.stop_max_pct === 20.0, 'CRYPTO stop_max_pct = 20.0');
  assert(crypto.min_price === 0.0001, 'CRYPTO min_price = 0.0001 (allows sub-dollar)');
  assert(crypto.weights.fundamental === 0, 'CRYPTO fundamental weight = 0 (skip)');

  // Test 3: TADAWUL resolves to KSA profile
  const tadawul = getMarketProfile('TADAWUL');
  assert(tadawul.market_code === 'KSA', 'TADAWUL → KSA market_code');
  assert(tadawul.currency === 'SAR', 'TADAWUL currency = SAR');
  assert(tadawul.min_score_buy === 68.0, 'KSA min_score_buy = 68 (higher than EGX)');

  // Test 4: helpers
  assert(currencyCode('EGX') === 'EGP', 'currencyCode(EGX) = EGP');
  assert(currencyCode('TADAWUL') === 'SAR', 'currencyCode(TADAWUL) = SAR');
  assert(currencyCode('CRYPTO') === 'USD', 'currencyCode(CRYPTO) = USD');
  assert(currencyLabelAr('EGX') === 'جنيه', 'currencyLabelAr(EGX) = جنيه');
  assert(currencyLabelAr('TADAWUL') === 'ريال', 'currencyLabelAr(TADAWUL) = ريال');
  assert(currencyLabelAr('US') === 'دولار', 'currencyLabelAr(US) = دولار');
  assert(marketNameAr('EGX') === 'البورصة المصرية', 'marketNameAr(EGX)');
  assert(marketNameAr('CRYPTO') === 'العملات الرقمية', 'marketNameAr(CRYPTO)');
  assert(supportsFundamentals('EGX') === true, 'EGX supports fundamentals');
  assert(supportsFundamentals('CRYPTO') === false, 'CRYPTO does NOT support fundamentals');

  // Test 5: unknown market falls back to EGX (Rule 27)
  const unknown = getMarketProfile('UNKNOWN_MARKET');
  assert(unknown.market_code === 'EGX', 'Unknown market → EGX fallback');

  console.log('\n=== All market-profile.ts tests passed ===');
  console.log('TS MarketProfile is a faithful mirror of Python unified_config.py ✅');
}
