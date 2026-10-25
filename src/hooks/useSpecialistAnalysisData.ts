'use client';

/**
 * hooks/useSpecialistAnalysisData.ts
 * ============================================================================
 * F-Strangler-Specialist: Strangler Pattern extraction from SpecialistAnalysisView
 * ----------------------------------------------------------------------------
 * قبل كده: SpecialistAnalysisView.tsx (2,916 LOC) كان فيه 12 useState + 1
 * useCallback (fetchAnalysis, 121 LOC) + Promise.allSettled لـ 5 fetches inline
 * في الـ component. الـ render logic اختلط بـ data-fetching logic.
 *
 * دلوقتي: الـ data logic كله here. الـ component بقا render-only:
 *   const {
 *     radarData, footprint, predictions, sharia, unified,
 *     flow, explosive, comprehensive, stockMeta, // orphans — always null (PHASE-0)
 *     loading, error, refetch,
 *   } = useSpecialistAnalysisData(ticker, currentMarket);
 *
 * الـ hook بيستخدم useApiQuery (TanStack Query + canonical apiGet) لـ 5 calls:
 *   1. GET /api/maker-radar/stock?ticker=X&market=Y    ← PRIMARY (must succeed)
 *   2. GET /api/flow/X                                   ← footprint (remapped)
 *   3. GET /api/predictions?ticker=X&limit=10&market=Y  ← predictions.db
 *   4. GET /api/sharia?symbol=X                          ← sharia compliance
 *   5. GET /api/stocks/X/unified?market=Y               ← canonical signals
 *
 * كل query مستـقل (Promise.allSettled semantics — أي واحد يـ settle لحاله).
 * بس PRIMARY لازم يـ succeed — otherwise الـ hook بيرجّع error و الـ component
 * بـ يـ show الـ error card بدل الـ 16-section report.
 *
 * Mapping logic preserved (PHASE4-APIS):
 *   - /api/flow/[ticker] → FootprintData shape:
 *       flow.buy_pressure → buy_volume
 *       flow.sell_pressure → sell_volume
 *       flow.net_flow → delta_volume
 *       (poc/vah/val/levels → null/[] — لا fabrication, Rule 27)
 *
 * Orphan states (PHASE-0 removed their fetches, Rule 73):
 *   - flow / explosive / comprehensive / stockMeta — always null. الـ component
 *     بيـمرّرهم لـ FlowExplosiveSection / ComprehensiveAnalysisSection /
 *     StockIcon fallback — كلهم بـ يـ show empty state لما null. مفيش
 *     render logic محتاج يتغير.
 * ============================================================================
 */

import { useCallback, useMemo } from 'react';
import { useApiQuery } from '@/hooks/use-api-query';

// ============================================================
// Types — owned by the hook (component imports them via `export type`)
// ============================================================

/** 60-field stock_info from /api/maker-radar/stock (Rule 67 — all optional). */
export interface StockInfo {
  ticker?: string;
  name?: string;
  name_ar?: string;
  sector?: string;
  industry?: string;
  market?: string;
  exchange?: string;
  currency?: string;
  current_price?: number;
  change?: number;
  change_percent?: number;
  change_value?: number;
  close?: number;
  open_price?: number;
  high_price?: number;
  low_price?: number;
  previous_close?: number;
  volume?: number;
  turnover_egp?: number;
  value_traded?: number;
  avg_volume?: number;
  market_cap?: number;
  pe_ratio?: number;
  pb_ratio?: number;
  ps_ratio?: number;
  eps?: number;
  roe?: number;
  roa?: number;
  debt_to_equity?: number;
  current_ratio?: number;
  book_value_per_share?: number;
  dividend_yield?: number;
  dps_ttm?: number;
  profit_margin?: number;
  free_float_percentage?: number;
  free_float_shares?: number;
  beta?: number;
  high_52w?: number;
  low_52w?: number;
  ma_50?: number;
  ma_200?: number;
  rsi?: number;
  support?: number;
  resistance?: number;
  signal?: number | string;
  smc_signal?: number | string;
  trend?: string;
  fundamental_score?: number;
  smc_score?: number;
  is_egx30?: number | boolean;
  is_egx70?: number | boolean;
  is_egx100?: number | boolean;
  is_egx?: number | boolean;
  is_suspended?: number | boolean;
  is_active?: number | boolean;
  [k: string]: unknown;
}

/** Daily OHLCV row — 30 days from /api/maker-radar/stock. */
export interface PriceRow {
  date?: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  turnover?: number;
}

/** Radar-derived stats (ROC + 20-day range + averages). */
export interface RadarStats {
  lastClose?: number;
  changePct?: number;
  roc10d?: number;
  avgVolume20?: number;
  avgTurnover20?: number;
  max20?: number;
  min20?: number;
  range20Pct?: number;
  dataPoints?: number;
  [k: string]: unknown;
}

/** PRIMARY API response (/api/maker-radar/stock?ticker=X&market=Y). */
export interface MakerRadarStock {
  success: boolean;
  ticker?: string;
  stock_info?: StockInfo | null;
  prices?: PriceRow[];
  stats?: RadarStats;
  tracking?: Record<string, unknown> | null;
  prediction?: Record<string, unknown> | null;
  db_source?: string;
  error?: string;
}

/** Footprint bin level (POC / value area). */
export interface FootprintLevel {
  price_low: number;
  price_high: number;
  price_mid: number;
  volume: number;
  buy_volume: number;
  sell_volume: number;
  delta: number;
  volume_pct: number;
  is_poc: boolean;
  is_value_area: boolean;
}

/** Footprint data shape — what the LiquidityFootprintSection consumes. */
export interface FootprintData {
  success: boolean;
  ticker?: string;
  days?: number;
  bin_count?: number;
  price_min?: number;
  price_max?: number;
  poc_price?: number;
  poc_volume?: number;
  vah_price?: number;
  val_price?: number;
  value_area_volume_pct?: number;
  total_volume?: number;
  buy_volume?: number;
  sell_volume?: number;
  delta_volume?: number;
  buy_sell_ratio?: number;
  levels?: FootprintLevel[];
  computed_at?: string;
  error?: string;
}

/** Predictions.db row (TERTIARY source). */
export interface PredictionRow {
  id?: number;
  ticker?: string;
  signal?: string;
  signal_type?: string;
  prediction_date?: string;
  entry_price?: number;
  target_price?: number;
  stop_loss?: number;
  master_score?: number;
  technical_score?: number;
  fundamental_score?: number;
  confidence?: number;
  persona?: string;
  market?: string;
  outcome_date?: string | null;
  exit_price?: number | null;
  actual_return?: number | null;
  hit_target?: number | boolean;
  hit_stop?: number | boolean;
  is_correct?: number | boolean | null;
  holding_days?: number;
  status?: string;
  risk_reward?: number;
  risk_reward_ratio?: number;
  created_at?: string;
  analysis_json?: string;
}

/** /api/predictions response. */
export interface PredictionsResponse {
  success: boolean;
  authenticated?: boolean;
  limited?: boolean;
  ticker?: string;
  data?: PredictionRow[];
  stats?: {
    total: number;
    closedCount?: number;
    hits?: number;
    accuracy?: number | null;
    avgScore?: number;
  };
  source?: string;
  error?: string;
}

/** /api/flow/[ticker] response (PHASE4-APIS — remapped to FootprintData). */
export interface FlowData {
  success: boolean;
  ticker?: string;
  flow?: {
    flow_score?: number;
    label?: string;
    color?: string;
    macro_flow?: string;
    sector_flow?: string;
    stock_flow?: string;
    cross_validation?: string;
    buy_pressure?: number;
    sell_pressure?: number;
    net_flow?: number;
    [k: string]: unknown;
  } | null;
  data?: Record<string, unknown> | null;
  source?: string;
  message?: string;
  error?: string;
}

/** /api/explosive/[ticker] response (orphan — PHASE-0 removed; kept for type compat). */
export interface ExplosiveData {
  success: boolean;
  ticker?: string;
  explosive?: {
    explosive_score?: number;
    label?: string;
    pattern?: string;
    color?: string;
    action?: string;
    stop_loss?: number;
    target?: number;
    volume_ratio?: number;
    range_10d_pct?: number;
    excluded?: boolean;
    [k: string]: unknown;
  } | null;
  data?: Record<string, unknown> | null;
  source?: string;
  message?: string;
  error?: string;
}

/** /api/stocks/X/comprehensive response (orphan — PHASE-0 removed; kept for type compat). */
export interface ComprehensiveData {
  success: boolean;
  ticker: string;
  market: string;
  timestamp: string;
  basic?: Record<string, unknown>;
  price?: Record<string, unknown>;
  keyMetrics?: Record<string, unknown>;
  technical?: Record<string, unknown>;
  priceHistory?: Array<Record<string, unknown>>;
  maestro?: Record<string, unknown>;
  hunter?: Record<string, unknown>;
  board?: Record<string, unknown>;
  news?: Array<Record<string, unknown>>;
  predictions?: Array<Record<string, unknown>>;
  professional?: Record<string, unknown>;
  errors: string[];
  elapsed_ms: number;
}

/** /api/sharia response. */
export interface ShariaResponse {
  success: boolean;
  symbol?: string;
  metric?: Record<string, unknown>;
  sources?: Array<Record<string, unknown>>;
  purification_rates?: Array<Record<string, unknown>>;
  price?: Record<string, unknown> | null;
  generated_at?: string;
  error?: string;
}

/** /api/stocks/[ticker] response (orphan — PHASE-0 removed; kept for type compat). */
export interface SingleStockData {
  success?: boolean;
  ticker?: string;
  name?: string;
  name_ar?: string;
  icon_url?: string;
  logo_url?: string;
  image?: string;
  sector?: string;
  industry?: string;
  market?: string;
  [k: string]: unknown;
}

/** /api/stocks/X/unified response — canonical accumulation + money_flow labels. */
export interface UnifiedResponse {
  success?: boolean;
  canonical?: {
    accumulation?: string | null;
    money_flow?: string | null;
    signal_ar?: string | null;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

// ============================================================
// Internal: /api/flow/[ticker] response shape (before remap)
// ============================================================

interface FlowApiResponse {
  success?: boolean;
  ticker?: string;
  flow?: {
    ticker?: string;
    buy_pressure?: number;
    sell_pressure?: number;
    net_flow?: number;
    volume?: number;
    [k: string]: unknown;
  } | null;
  [k: string]: unknown;
}

// ============================================================
// Hook result
// ============================================================

export interface UseSpecialistAnalysisDataResult {
  /** PRIMARY — must succeed; otherwise the component shows the error card. */
  radarData: MakerRadarStock | null;
  /** SECONDARY — remapped from /api/flow/[ticker] → FootprintData. */
  footprint: FootprintData | null;
  /** TERTIARY — predictions.db direct. */
  predictions: PredictionsResponse | null;
  /** Sharia compliance (best-effort). */
  sharia: ShariaResponse | null;
  /** Canonical signals from /api/stocks/X/unified (best-effort). */
  unified: UnifiedResponse | null;
  /** Orphan — always null (PHASE-0 removed the fetch; preserved for render compat). */
  flow: FlowData | null;
  /** Orphan — always null (PHASE-0 removed the fetch; preserved for render compat). */
  explosive: ExplosiveData | null;
  /** Orphan — always null (PHASE-0 removed the fetch; preserved for render compat). */
  comprehensive: ComprehensiveData | null;
  /** Orphan — always null (PHASE-0 removed the fetch; preserved for render compat). */
  stockMeta: SingleStockData | null;
  /** True while ANY of the 5 queries is fetching (mirrors original setLoading). */
  loading: boolean;
  /** Error message from PRIMARY (radar) fetch. Null when healthy. */
  error: string | null;
  /** Re-fetch all 5 queries in parallel (used by the "تحليل" button). */
  refetch: () => Promise<void>;
}

// ============================================================
// Hook
// ============================================================

/**
 * useSpecialistAnalysisData — owns all data-fetching logic for SpecialistAnalysisView.
 *
 * @param ticker - stock symbol (uppercase). Empty string → no fetch, all data null.
 * @param market - 'EGX' / 'US' / 'SA' (forwarded as `?market=` to filter cross-market dupes).
 *
 * @example
 * const { radarData, footprint, predictions, sharia, unified, loading, error, refetch } =
 *   useSpecialistAnalysisData(ticker, currentMarket);
 */
export function useSpecialistAnalysisData(
  ticker: string,
  market: string
): UseSpecialistAnalysisDataResult {
  const enc = encodeURIComponent(ticker);
  const enabled = !!ticker;

  // ── 5 parallel queries — each settles independently (Promise.allSettled semantics) ──
  // cache: 'no-store' preserves the original `fetch(..., { cache: 'no-store' })`
  // semantics — bypasses Next.js HTTP cache so we always hit the API route.
  // retry: false — Promise.allSettled never retries; the hook surfaces errors
  // via the `error` field instead.
  const radarQ = useApiQuery<MakerRadarStock>('/api/maker-radar/stock', {
    params: { ticker, market },
    fetchOptions: { cache: 'no-store' },
    queryOptions: { enabled, refetchOnWindowFocus: false, retry: false },
  });
  const flowQ = useApiQuery<FlowApiResponse>(`/api/flow/${enc}`, {
    fetchOptions: { cache: 'no-store' },
    queryOptions: { enabled, refetchOnWindowFocus: false, retry: false },
  });
  const predQ = useApiQuery<PredictionsResponse>('/api/predictions', {
    params: { ticker, limit: 10, market },
    fetchOptions: { cache: 'no-store' },
    queryOptions: { enabled, refetchOnWindowFocus: false, retry: false },
  });
  const shariaQ = useApiQuery<ShariaResponse>('/api/sharia', {
    params: { symbol: ticker },
    fetchOptions: { cache: 'no-store' },
    queryOptions: { enabled, refetchOnWindowFocus: false, retry: false },
  });
  const unifiedQ = useApiQuery<UnifiedResponse>(`/api/stocks/${enc}/unified`, {
    params: { market },
    fetchOptions: { cache: 'no-store' },
    queryOptions: { enabled, refetchOnWindowFocus: false, retry: false },
  });

  // ── PRIMARY: radar — must succeed; otherwise the component shows the error card ──
  // Mirrors the original `if (radarRes.status !== 'fulfilled') throw …` and
  // `if (!radarJson.success || !radarJson.stock_info) throw …` branches.
  const radarData = useMemo<MakerRadarStock | null>(() => {
    if (!enabled) return null;
    const d = radarQ.data as unknown as MakerRadarStock | undefined;
    if (!d) return null;
    return d;
  }, [enabled, radarQ.data]);

  // ── Error from PRIMARY (network failure OR !success OR missing stock_info) ──
  const error = useMemo<string | null>(() => {
    if (!enabled) return null;
    if (radarQ.isError) {
      return 'فشل الاتصال بـ maker-radar/stock API (PRIMARY source)';
    }
    const json = radarQ.data as unknown as MakerRadarStock | undefined;
    if (radarQ.isSuccess && json && (!json.success || !json.stock_info)) {
      return json.error
        ? `فشل تحميل بيانات السهم: ${json.error}`
        : 'لا توجد بيانات لهذا السهم في stocks.db';
    }
    return null;
  }, [enabled, radarQ.isError, radarQ.isSuccess, radarQ.data]);

  // ── SECONDARY: footprint (remapped from /api/flow/[ticker]) ──
  // PHASE4-APIS — map flow.buy_pressure → buy_volume, flow.sell_pressure →
  // sell_volume, flow.net_flow → delta_volume. Volume-profile fields
  // (poc/vah/val/levels) not available from money-flow API → null/[]
  // (no fabrication, Rule 27).
  const footprint = useMemo<FootprintData | null>(() => {
    if (!enabled) return null;
    const d = flowQ.data as unknown as FlowApiResponse | undefined;
    if (!d?.success || !d?.flow) return null;
    const f = d.flow;
    const buyVol = Number(f.buy_pressure ?? 0);
    const sellVol = Number(f.sell_pressure ?? 0);
    return {
      success: true,
      ticker: f.ticker ?? d.ticker ?? ticker,
      poc_price: undefined,
      vah_price: undefined,
      val_price: undefined,
      buy_volume: buyVol,
      sell_volume: sellVol,
      delta_volume: Number(f.net_flow ?? (buyVol - sellVol)),
      buy_sell_ratio: sellVol > 0 ? buyVol / sellVol : 0,
      total_volume: Number(f.volume ?? 0),
      value_area_volume_pct: undefined,
      levels: [],
      computed_at: new Date().toISOString(),
    } as FootprintData;
  }, [enabled, flowQ.data, ticker]);

  // ── TERTIARY: predictions ──
  const predictions = useMemo<PredictionsResponse | null>(() => {
    if (!enabled) return null;
    const d = predQ.data as unknown as PredictionsResponse | undefined;
    return d ?? null;
  }, [enabled, predQ.data]);

  // ── Sharia ──
  const sharia = useMemo<ShariaResponse | null>(() => {
    if (!enabled) return null;
    const d = shariaQ.data as unknown as ShariaResponse | undefined;
    return d ?? null;
  }, [enabled, shariaQ.data]);

  // ── Unified — best-effort (only set if success=true, matches original) ──
  const unified = useMemo<UnifiedResponse | null>(() => {
    if (!enabled) return null;
    const d = unifiedQ.data as unknown as UnifiedResponse | undefined;
    if (!d?.success) return null;
    return d;
  }, [enabled, unifiedQ.data]);

  // ── Loading: true while ANY of the 5 queries is fetching (mirrors original) ──
  // Original: setLoading(true) at fetchAnalysis start, setLoading(false) in
  // finally (after Promise.allSettled completes). Loading is true for the
  // full duration — we mirror that by checking isFetching on all 5 queries.
  const loading =
    enabled &&
    (radarQ.isFetching ||
      flowQ.isFetching ||
      predQ.isFetching ||
      shariaQ.isFetching ||
      unifiedQ.isFetching);

  // ── Refetch: re-run all 5 queries in parallel (used by the "تحليل" button) ──
  // Promise.allSettled preserves the original semantics — each refetch settles
  // independently; we don't fail-fast if one rejects.
  const refetch = useCallback(async () => {
    await Promise.allSettled([
      radarQ.refetch(),
      flowQ.refetch(),
      predQ.refetch(),
      shariaQ.refetch(),
      unifiedQ.refetch(),
    ]);
  }, [radarQ, flowQ, predQ, shariaQ, unifiedQ]);

  // ── Orphans — always null (PHASE-0 removed their fetches; Rule 73) ──
  // Preserved as null constants so the component's render logic doesn't
  // need to change (FlowExplosiveSection / ComprehensiveAnalysisSection /
  // StockIcon fallback all gracefully handle null).
  const flow: FlowData | null = null;
  const explosive: ExplosiveData | null = null;
  const comprehensive: ComprehensiveData | null = null;
  const stockMeta: SingleStockData | null = null;

  return {
    radarData,
    footprint,
    predictions,
    sharia,
    unified,
    flow,
    explosive,
    comprehensive,
    stockMeta,
    loading,
    error,
    refetch,
  };
}
