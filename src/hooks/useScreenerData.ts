'use client';

/**
 * hooks/useScreenerData.ts
 * ============================================================================
 * F-Strangler-Screener: Strangler Pattern extraction from
 * StockScreenerAdvanced.tsx (was 2,723 LOC).
 * ----------------------------------------------------------------------------
 * قبل كده: الـ component كان فيه 2 manual `useEffect + fetch + setLoading +
 * setError` blocks — واحد في `AdvancedFiltersTab` (screener + radar parallel
 * fetch + merge logic) وواحد في `TopPerformersTab`. كل واحد بـ يعمل نفس الشيء
 * بس بـ bugs مختلفة: مفيش caching، مفيش retry على 502/503/504، مفيش paywall
 * event dispatch على 402/403، loading/error triples في كل مكان.
 *
 * دلوقتي: الـ data logic كله here. الـ components بقت render-only.
 *
 *   // Tab 1 (AdvancedFiltersTab):
 *   const { results, sectors, summary, loading, error, quietSignals, refetch }
 *     = useScreenerData(filters);
 *
 *   // Tab 2 (TopPerformersTab):
 *   const { topPerformers, topLoading, topError, refetch }
 *     = useTopPerformersData(params);
 *
 * الـ hook بيستخدم useApiQuery (TanStack Query + canonical apiGet) لـ 3 fetches:
 *   1. /api/screener/advanced?...   — main screener results (merged with radar)
 *   2. /api/maker-radar?...          — quiet signals (liquidity radar data)
 *   3. /api/stocks/top-performers?... — top performers tab
 *
 * Radar merge: original `fetchScreener` built a `radarMap` from 4 lists
 * (quiet_list / pre_surge_list / explosive_list / early_break_list) and merged
 * radar fields into each stock. الـ merge logic دي preserved here verbatim —
 * `results` returned by `useScreenerData` is already merged.
 *
 * Toast behaviour preserved in the consumer via useEffect watching `error`.
 * ============================================================================
 */

import { useMemo } from 'react';
import { useApiQuery } from '@/hooks/use-api-query';

// ============================================================
// Types (mirror the API responses — copied from StockScreenerAdvanced.tsx)
// ============================================================

export interface ScreenerStock {
  ticker: string;
  name: string;
  name_ar: string;
  market: string;
  sector: string;
  industry: string;
  current_price: number;
  change_percent: number;
  volume: number;
  market_cap: number;
  pe_ratio: number | null;
  pb_ratio: number | null;
  eps: number | null;
  roe: number | null;
  roa: number | null;
  debt_to_equity: number | null;
  dividend_yield: number | null;
  profit_margin: number | null;
  ma_50: number | null;
  ma_200: number | null;
  rsi: number | null;
  trend: string | null;
  signal: number | null;
  beta: number | null;
  high_52w: number | null;
  low_52w: number | null;
  avg_volume: number;
  turnover_egp: number;
  value_traded: number;
  is_egx30: boolean;
  is_egx70: boolean;
  is_egx100: boolean;
  free_float_percentage: number | null;
  dps_ttm: number | null;
  book_value_per_share: number | null;
  support: number | null;
  resistance: number | null;
  volume_surge: boolean;
  above_ma_50: boolean;
  above_ma_200: boolean;
  distance_from_52w_high: number | null;
  distance_from_52w_low: number | null;
  stock_state: string;
  stock_state_ar: string;
  stock_state_reason: string;
  momentum_score: number;
  // ── Liquidity radar fields (linked from /api/maker-radar) ──
  maker_activity?: string | null;
  buy_pct?: number | null;
  net_flow_egp?: number | null;
  accumulation?: string | null;
  life_cycle?: string | null;
  expected?: string | null;
  path?: string | null;
  position_size?: number | null;
  volume_ratio_10d_vs_20d?: number | null;
}

export interface ScreenerResponse {
  success: boolean;
  stocks: ScreenerStock[];
  total: number;
  sectors: string[];
  summary?: {
    total: number;
    advancers: number;
    decliners: number;
    unchanged: number;
    avg_change: number;
    total_turnover: number;
    volume_surge_count: number;
  };
  filters?: Record<string, unknown>;
  error?: string;
}

// ─── Top Performers types ────────────────────────────────────────────────────

export interface TopPerformerStock {
  ticker: string;
  name: string;
  name_ar: string | null;
  sector: string | null;
  market: string;
  start_price: number;
  end_price: number;
  change_pct: number;
  period_days: number;
  start_date: string;
  end_date: string;
  start_volume: number;
  end_volume: number;
}

export interface TopPerformersResponse {
  success: boolean;
  period: string;
  direction: string;
  market: string;
  start_date: string;
  end_date: string;
  results: TopPerformerStock[];
  summary: {
    total_stocks: number;
    gainers: number;
    losers: number;
    avg_change: number;
    best_performer: TopPerformerStock | null;
    worst_performer: TopPerformerStock | null;
  };
  error?: string;
  hint?: string;
}

// ─── Quiet signals (maker-radar) types ───────────────────────────────────────

/** Single radar item — fields are all optional because the API may omit them. */
export interface QuietSignalsItem {
  ticker?: string;
  maker_activity?: string;
  buy_pct?: number;
  net_flow_egp?: number;
  accumulation?: string;
  life_cycle?: string;
  expected?: string;
  path?: string;
  position_size?: number;
  volume_ratio_10d_vs_20d?: number;
  [k: string]: unknown;
}

/** /api/maker-radar response shape — 4 lists of tickers by radar bucket. */
export interface QuietSignalsResponse {
  quiet_list?: QuietSignalsItem[];
  pre_surge_list?: QuietSignalsItem[];
  explosive_list?: QuietSignalsItem[];
  early_break_list?: QuietSignalsItem[];
  [k: string]: unknown;
}

// ============================================================
// Hook 1: useScreenerData (Tab 1 — Advanced Filters + Radar)
// ============================================================

export interface ScreenerFilters {
  market: string;
  sector: string;
  sort: string;
  order: 'asc' | 'desc';
  limit: number;
  minPrice?: string;
  maxPrice?: string;
  minVolume?: string;
  minTurnover?: string;
  trend?: string;
  aboveMa?: string;
  rsi?: string;
  volumeSurge?: boolean;
  near52wHigh?: boolean;
  near52wLow?: boolean;
  minPe?: string;
  maxPe?: string;
  minRoe?: string;
  minDividendYield?: string;
  minMarketCap?: string;
  maxMarketCap?: string;
  stockState?: string;
}

export interface UseScreenerDataResult {
  /** Screener stocks merged with radar liquidity fields. */
  results: ScreenerStock[];
  sectors: string[];
  summary: ScreenerResponse['summary'] | null;
  /** True during first fetch AND every refetch (preserves original behaviour). */
  loading: boolean;
  error: string | null;
  /** Raw /api/maker-radar response (for any consumer that wants the lists directly). */
  quietSignals: QuietSignalsResponse | null;
  refetch: () => void;
}

/**
 * بـ يجيب screener results + maker-radar quiet signals بـ استخدام useApiQuery
 * وبيعمل radar merge inline (نفس الـ logic اللي كان في `fetchScreener`).
 */
export function useScreenerData(filters: ScreenerFilters): UseScreenerDataResult {
  // Build screener params (only include non-default values — same as original)
  const screenerParams = useMemo<Record<string, string | number | boolean | null | undefined>>(() => {
    const p: Record<string, string | number | boolean | null | undefined> = {
      market: filters.market,
      sort: filters.sort,
      order: filters.order,
      limit: filters.limit,
    };
    if (filters.sector !== 'ALL') p.sector = filters.sector;
    if (filters.minPrice) p.min_price = filters.minPrice;
    if (filters.maxPrice) p.max_price = filters.maxPrice;
    if (filters.minVolume) p.min_volume = filters.minVolume;
    if (filters.minTurnover) p.min_turnover = filters.minTurnover;
    if (filters.trend && filters.trend !== 'all') p.trend = filters.trend;
    if (filters.aboveMa && filters.aboveMa !== 'all') p.above_ma = filters.aboveMa;
    if (filters.rsi === 'oversold') p.rsi_oversold = '1';
    if (filters.rsi === 'overbought') p.rsi_overbought = '1';
    if (filters.volumeSurge) p.volume_surge = '1';
    if (filters.near52wHigh) p.near_52w_high = '1';
    if (filters.near52wLow) p.near_52w_low = '1';
    if (filters.minPe) p.min_pe = filters.minPe;
    if (filters.maxPe) p.max_pe = filters.maxPe;
    if (filters.minRoe) p.min_roe = filters.minRoe;
    if (filters.minDividendYield) p.min_dividend_yield = filters.minDividendYield;
    if (filters.minMarketCap) p.min_market_cap = filters.minMarketCap;
    if (filters.maxMarketCap) p.max_market_cap = filters.maxMarketCap;
    if (filters.stockState && filters.stockState !== 'ALL') p.stock_state = filters.stockState;
    return p;
  }, [
    filters.market, filters.sector, filters.sort, filters.order, filters.limit,
    filters.minPrice, filters.maxPrice, filters.minVolume, filters.minTurnover,
    filters.trend, filters.aboveMa, filters.rsi, filters.volumeSurge,
    filters.near52wHigh, filters.near52wLow,
    filters.minPe, filters.maxPe, filters.minRoe, filters.minDividendYield,
    filters.minMarketCap, filters.maxMarketCap, filters.stockState,
  ]);

  // Fetch 1: /api/screener/advanced — main results
  const screenerQuery = useApiQuery<ScreenerResponse>('/api/screener/advanced', {
    params: screenerParams,
    queryOptions: { staleTime: 0, refetchOnWindowFocus: false },
  });

  // Fetch 2: /api/maker-radar — quiet signals (parallel; optional — fail silently)
  const radarQuery = useApiQuery<QuietSignalsResponse>('/api/maker-radar', {
    params: {
      market: filters.market,
      minQuietSignals: 5,
      minPrice: 1.0,
    },
    queryOptions: { staleTime: 0, refetchOnWindowFocus: false, retry: false },
  });

  // Build ticker → radar lookup map (linking data, not new code — verbatim from original)
  const radarMap = useMemo<Map<string, QuietSignalsItem>>(() => {
    const map = new Map<string, QuietSignalsItem>();
    const radarJson = radarQuery.data?.data;
    if (!radarJson) return map;
    const lists = [
      ...(radarJson.quiet_list || []),
      ...(radarJson.pre_surge_list || []),
      ...(radarJson.explosive_list || []),
      ...(radarJson.early_break_list || []),
    ];
    for (const item of lists) {
      if (item?.ticker) map.set(String(item.ticker).toUpperCase(), item);
    }
    return map;
  }, [radarQuery.data]);

  // Merge radar fields into each screener stock + derive error/loading
  const { results, sectors, summary, screenerError } = useMemo(() => {
    const raw = screenerQuery.data?.data;
    if (!raw) {
      return {
        results: [] as ScreenerStock[],
        sectors: [] as string[],
        summary: null as ScreenerResponse['summary'] | null,
        screenerError: null as string | null,
      };
    }
    if (!raw.success) {
      return {
        results: [] as ScreenerStock[],
        sectors: [] as string[],
        summary: null,
        screenerError: raw.error || null,
      };
    }
    // Merge radar fields into each stock (linking)
    const mergedStocks = (raw.stocks || []).map((s) => {
      const r = radarMap.get(s.ticker.toUpperCase());
      if (!r) return s;
      return {
        ...s,
        maker_activity: (r.maker_activity as string) ?? null,
        buy_pct: (r.buy_pct as number) ?? null,
        net_flow_egp: (r.net_flow_egp as number) ?? null,
        accumulation: (r.accumulation as string) ?? null,
        life_cycle: (r.life_cycle as string) ?? null,
        expected: (r.expected as string) ?? null,
        path: (r.path as string) ?? null,
        position_size: (r.position_size as number) ?? null,
        volume_ratio_10d_vs_20d: (r.volume_ratio_10d_vs_20d as number) ?? null,
      };
    });
    return {
      results: mergedStocks,
      sectors: raw.sectors || [],
      summary: raw.summary || null,
      screenerError: null as string | null,
    };
  }, [screenerQuery.data, radarMap]);

  // Derive final error message (network/abort error takes precedence over API error)
  const queryError = screenerQuery.error;
  const error: string | null = queryError
    ? (queryError instanceof Error ? queryError.message : 'خطأ غير معروف')
    : screenerError;

  return {
    results,
    sectors,
    summary,
    // isFetching (not isLoading) so refetches triggered by filter changes
    // also flip loading=true — matches original `setLoading(true)` in fetchScreener.
    loading: screenerQuery.isFetching,
    error,
    quietSignals: radarQuery.data?.data ?? null,
    refetch: () => {
      screenerQuery.refetch();
      radarQuery.refetch();
    },
  };
}

// ============================================================
// Hook 2: useTopPerformersData (Tab 2 — Top Performers)
// ============================================================

export interface TopPerformersParams {
  period: string;
  direction: string;
  market: string;
  limit: number;
}

export interface UseTopPerformersDataResult {
  topPerformers: TopPerformersResponse | null;
  topLoading: boolean;
  topError: string | null;
  refetch: () => void;
}

/**
 * بـ يجيب /api/stocks/top-performers بـ استخدام useApiQuery. الـ hook بـ
 * يـرجّع الـ full TopPerformersResponse object (matching original `data` state).
 */
export function useTopPerformersData(params: TopPerformersParams): UseTopPerformersDataResult {
  const query = useApiQuery<TopPerformersResponse>('/api/stocks/top-performers', {
    params: {
      period: params.period,
      direction: params.direction,
      market: params.market,
      limit: params.limit,
    },
    queryOptions: { staleTime: 0, refetchOnWindowFocus: false },
  });

  const raw = query.data?.data;

  let topPerformers: TopPerformersResponse | null = null;
  let apiError: string | null = null;

  if (raw) {
    if (raw.success) {
      topPerformers = raw;
    } else {
      apiError = raw.error || raw.hint || null;
    }
  }

  // Network/abort error takes precedence
  if (query.error) {
    apiError = query.error instanceof Error ? query.error.message : 'خطأ اتصال';
  }

  return {
    topPerformers,
    topLoading: query.isFetching,
    topError: apiError,
    refetch: () => query.refetch(),
  };
}
