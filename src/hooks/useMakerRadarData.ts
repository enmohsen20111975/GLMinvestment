'use client';

/**
 * hooks/useMakerRadarData.ts
 * ============================================================================
 * F-Strangler-MakerRadar: Strangler Pattern extraction from MakerRadarTab
 * ----------------------------------------------------------------------------
 * قبل كده: MakerRadarTab.tsx (3,918 LOC) كان فيه 9 useState + 3 useEffect + 3
 * inline fetch callbacks + warming state + warmup handlers. كل ده inline في
 * الـ component، فالـ render logic اختلط بـ data-fetching logic.
 *
 * دلوقتي: الـ data logic كله here. الـ component بقا render-only:
 *   const {
 *     data, loading, refreshing, error,
 *     predMap, stockMap,
 *     warmingRadar, warmingV40, warmupMsg,
 *     lastUpdated,
 *     refetch, fetchStockMap, warmupRadar, refreshV40,
 *   } = useMakerRadarData(market);
 *
 * الـ hook بيستخدم useApiQuery (TanStack Query + canonical apiGet) لـ 3 calls:
 *   1. GET /api/maker-radar?market=X&minQuietSignals=5&minPrice=1.0  ← main radar
 *   2. GET /api/stocks?market=X&page_size=1000                       ← ticker→sector map
 *   3. GET /api/unified/predictions?market=X&limit=1000              ← predictions map
 *
 * Side effects preserved (الـ original behavior بيتـعمل له mirror هنا):
 *   - warming_up=true: الـ existing data بيفضل زي ما هو (مفيش screen wipe)
 *   - error: بيتـ set بس على hard failures (network / non-warming API errors)
 *   - warmupRadar / refreshV40: synchronous POST endpoints + status messages
 *
 * Polling: بيتم في الـ component (useVisibilityAwarePolling + WS push) — الـ hook
 * بيفضل passive وبيـ expose `refetch(true)` للـ silent refresh.
 * ============================================================================
 */

import { useCallback, useEffect, useState } from 'react';
import { useApiQuery } from '@/hooks/use-api-query';
import type {
  MakerRadarResponse,
  StockListItem,
  StocksListResponse,
  PredictionEntry,
} from '@/modules/predictions/components/MakerRadarTab';

// ============================================================
// Local types — predictions response (loose; backend varies)
// ============================================================

interface PredictionsResponse {
  success?: boolean;
  predictions?: Record<string, unknown>[];
  active_predictions?: Record<string, unknown>[];
  [k: string]: unknown;
}

// ============================================================
// Hook result
// ============================================================

export interface UseMakerRadarDataResult {
  /** Main radar lists (quiet / pre_surge / explosive / early_break / tracked). */
  data: MakerRadarResponse | null;
  /** True on the very first fetch (no cached data). */
  loading: boolean;
  /** True on any subsequent fetch (silent poll / WS push / manual refetch). */
  refreshing: boolean;
  /** Hard error message (network / non-warming API failure). */
  error: string | null;
  /** Ticker → latest active prediction (highest-confidence per ticker). */
  predMap: Map<string, PredictionEntry>;
  /** Ticker → sector / fundamentals map (fetched once per market). */
  stockMap: Map<string, StockListItem> | null;
  /** True while POST /api/maker-radar/warmup is running. */
  warmingRadar: boolean;
  /** True while POST /api/predictions/refresh-v40 is running. */
  warmingV40: boolean;
  /** Transient status message from warmup actions (auto-clears after 6-8s). */
  warmupMsg: string | null;
  /** Last successful radar fetch timestamp (drives the "last updated" UI). */
  lastUpdated: Date | null;
  /** Silent radar refetch (matches original fetchData(true)). */
  refetch: (silent?: boolean) => Promise<void>;
  /** Refetch the stock universe map only (used by visibility-aware polling). */
  fetchStockMap: () => Promise<void>;
  /** POST /api/maker-radar/warmup — synchronous Python warmup, then refetch. */
  warmupRadar: () => Promise<void>;
  /** POST /api/predictions/refresh-v40 — runs V40.2 generator, then refetch preds. */
  refreshV40: () => Promise<void>;
}

// ============================================================
// Hook
// ============================================================

/**
 * useMakerRadarData — owns all data-fetching + warmup logic for MakerRadarTab.
 *
 * @param market - 'EGX' (default) or future market codes.
 *
 * @example
 * const { data, loading, refreshing, error, predMap, stockMap, refetch } = useMakerRadarData('EGX');
 */
export function useMakerRadarData(market: string = 'EGX'): UseMakerRadarDataResult {
  // ── Local derived state (mirror of original useState declarations) ──
  // The raw query data lives in TanStack Query cache; these states are derived
  // views so the widget can render synchronously without flicker.
  const [radarData, setRadarData] = useState<MakerRadarResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [predMap, setPredMap] = useState<Map<string, PredictionEntry>>(new Map());
  const [stockMap, setStockMap] = useState<Map<string, StockListItem> | null>(null);
  const [warmingRadar, setWarmingRadar] = useState(false);
  const [warmingV40, setWarmingV40] = useState(false);
  const [warmupMsg, setWarmupMsg] = useState<string | null>(null);

  // ── useApiQuery: 3 endpoints via TanStack Query + canonical apiGet ──
  // cache: 'no-store' preserves the original `fetch(..., { cache: 'no-store' })`
  // semantics — bypasses Next.js HTTP cache so we always hit the API route.
  const radarQ = useApiQuery<MakerRadarResponse>('/api/maker-radar', {
    params: { market, minQuietSignals: '5', minPrice: '1.0' },
    fetchOptions: { cache: 'no-store' },
    queryOptions: { refetchOnWindowFocus: false, retry: false },
  });
  const stocksQ = useApiQuery<StocksListResponse>('/api/stocks', {
    params: { market, page_size: 1000 },
    fetchOptions: { cache: 'no-store' },
    queryOptions: { refetchOnWindowFocus: false, retry: false },
  });
  const predsQ = useApiQuery<PredictionsResponse>('/api/unified/predictions', {
    params: { market, limit: 1000 },
    fetchOptions: { cache: 'no-store' },
    queryOptions: { refetchOnWindowFocus: false, retry: false },
  });

  // ── Mirror radar query → local radarData (preserves warming_up skip) ──
  // ORIGINAL BEHAVIOR: when json.warming_up=true, keep existing data silently
  // (don't wipe the UI while Python is rebuilding the cache). Only update when
  // the API returns a real payload OR a hard error.
  useEffect(() => {
    const d = radarQ.data;
    if (!d) return;
    // api-client mutates canonical responses so `d` itself IS the body
    // (with an extra `data` field self-reference). Cast directly.
    const json = d as unknown as MakerRadarResponse;
    const hasData =
      json.success || Array.isArray(json.quiet_list) || Array.isArray(json.explosive_list);
    if (hasData) {
      setRadarData({ ...json, success: true });
      setLastUpdated(new Date());
      setError(null);
    } else if (!json.warming_up) {
      setError(json.error || 'فشل في تحميل بيانات الرادار');
    }
    // if warming_up, keep existing data silently (preserved original behavior)
  }, [radarQ.data]);

  // ── Surface network/query errors (only on hard failures) ──
  useEffect(() => {
    if (radarQ.isError) {
      const err = radarQ.error;
      setError(err instanceof Error ? err.message : 'خطأ في الاتصال');
    }
  }, [radarQ.isError, radarQ.error]);

  // ── Mirror stocks query → stockMap (ticker.toUpperCase() → StockListItem) ──
  useEffect(() => {
    const d = stocksQ.data;
    if (!d) return;
    const json = d as unknown as StocksListResponse;
    if (json.success && Array.isArray(json.stocks)) {
      const map = new Map<string, StockListItem>();
      for (const s of json.stocks) {
        if (s && s.ticker) map.set(s.ticker.toUpperCase(), s);
      }
      setStockMap(map);
    }
  }, [stocksQ.data]);

  // ── Mirror predictions query → predMap (complex client-side filter) ──
  // The original `fetchPredictions` did heavy client-side filtering:
  //   1. Collect from `predictions` + `active_predictions` keys (DB varies)
  //   2. Filter to active/pending/open/triggered statuses (case-insensitive)
  //   3. Keep highest-scoring entry per ticker
  //   4. Resolve direction from BUY/SELL signal prefix (DB sometimes null)
  //   5. Map signal → Arabic label (شراء قوي / شراء / ...)
  // This is preserved verbatim — only the fetch source changed (TanStack
  // Query cache vs. raw fetch).
  useEffect(() => {
    const d = predsQ.data;
    if (!d) return;
    const json = d as unknown as PredictionsResponse;
    const allRows: Record<string, unknown>[] = [
      ...(Array.isArray(json.predictions) ? json.predictions : []),
      ...(Array.isArray(json.active_predictions) ? json.active_predictions : []),
    ];
    const rows = allRows.filter((r) => {
      const st = String(r.status || '').toLowerCase();
      return st === 'active' || st === 'pending' || st === 'open' || st === 'triggered';
    });
    const map = new Map<string, PredictionEntry>();
    for (const row of rows) {
      const ticker = String(row.ticker || '').toUpperCase();
      if (!ticker) continue;
      const sig = String(row.signal || '').toUpperCase();
      const isBuy = sig.includes('BUY');
      const isSell = sig.includes('SELL');
      // BUY/STRONG_BUY → direction='up' regardless of null direction field in DB
      const resolvedDirection =
        isBuy ? 'up'
        : isSell ? 'down'
        : row.direction ? String(row.direction) : null;
      // confidence first, master_score as fallback
      const conf =
        row.confidence != null ? Number(row.confidence)
        : row.master_score != null ? Number(row.master_score)
        : null;
      // Keep highest-scoring entry per ticker
      const existing = map.get(ticker);
      if (!existing || (conf != null && conf > (existing.confidence ?? -1))) {
        const signal_ar =
          sig === 'STRONG_BUY' ? 'شراء قوي'
          : sig === 'BUY' ? 'شراء'
          : sig === 'STRONG_SELL' ? 'بيع قوي'
          : sig === 'SELL' ? 'بيع'
          : sig === 'HOLD' ? 'انتظار' // P0-3: canonical-signal.ts uses 'انتظار' for HOLD
          : sig === 'WAIT' ? 'انتظار'
          : '— بيانات غير متاحة'; // P0-3: لا 'محايد' الوهمي (Rule 27)
        map.set(ticker, {
          signal: sig,
          signal_ar: String(row.signal_ar || signal_ar),
          direction: resolvedDirection,
          confidence: conf,
          master_score: row.master_score != null ? Number(row.master_score) : null,
          entry_price: row.entry_price != null ? Number(row.entry_price) : null,
          target_price: row.target_price != null ? Number(row.target_price) : null,
          stop_loss: row.stop_loss != null ? Number(row.stop_loss) : null,
        });
      }
    }
    setPredMap(map);
  }, [predsQ.data]);

  // ── Loading / refreshing derived from TanStack Query state ──
  // loading:   true on the very first radar fetch (no data cached yet).
  //            Mirrors the original `setLoading(true)` (initial) path.
  // refreshing: true on any subsequent fetch (data may be stale but present).
  //            Mirrors the original `setRefreshing(true)` (silent poll) path.
  const loading = !radarData && (radarQ.isLoading || radarQ.isPending);
  const refreshing =
    (radarQ.isFetching || stocksQ.isFetching || predsQ.isFetching) && !loading;

  // ── Refetch: silent radar refresh (matches original fetchData(true)) ──
  // The `silent` parameter is kept for API compatibility with the original
  // `fetchData(silent)` signature, but TanStack Query doesn't distinguish —
  // `refetch()` always fetches fresh data. The caller's intent (`silent`)
  // is encoded in the resulting `loading` vs `refreshing` derived state
  // (which already differentiates based on whether `radarData` is null).
  const refetch = useCallback(
    async (_silent = true) => {
      await radarQ.refetch();
    },
    [radarQ]
  );

  // ── Refetch stock map only (matches original fetchStockMap) ──
  // Used by useVisibilityAwarePolling to refresh the ticker→sector map every
  // 15s without touching the radar (which has its own refetch).
  const fetchStockMap = useCallback(async () => {
    await stocksQ.refetch();
  }, [stocksQ]);

  // ── Synchronous radar warmup (POST /api/maker-radar/warmup) ─────────
  // Forces a fresh Python run. Blocks until done (typically <2s on indexed DB).
  // On success, silently refetches the radar so the new picks show up.
  const warmupRadar = useCallback(async () => {
    setWarmingRadar(true);
    setWarmupMsg('بيتشغل الرادار...');
    try {
      const res = await fetch(
        `/api/maker-radar/warmup?market=${encodeURIComponent(market)}&timeout=120000`,
        { method: 'POST' }
      );
      const json = await res.json();
      if (json.success) {
        const dur = json.status?.last_warmup_duration_ms ?? 0;
        const scanned = json.cache_total_scanned ?? 0;
        setWarmupMsg(`✅ اتحدّث في ${(dur / 1000).toFixed(1)}ث — ${scanned} سهم مفسوح`);
        await refetch(true);
      } else if (!json.warming_up) {
        setWarmupMsg(`❌ فشل: ${json.status?.last_error || 'خطأ غير معروف'}`);
      }
      // if warming_up, keep existing data silently
    } catch (e) {
      setWarmupMsg(`❌ خطأ: ${e instanceof Error ? e.message : 'اتصال'}`);
    } finally {
      setWarmingRadar(false);
      setTimeout(() => setWarmupMsg(null), 6000);
    }
  }, [market, refetch]);

  // ── V40.2 predictions refresh (POST /api/predictions/refresh-v40) ───
  // Runs the V40.2 daily generator directly via subprocess.
  // On success, refetches predictions so the new ones show up immediately
  // (improvement over original — which left the user to manually refresh).
  const refreshV40 = useCallback(async () => {
    setWarmingV40(true);
    setWarmupMsg('جاري توليد التوقعات...');
    try {
      const res = await fetch('/api/predictions/refresh-v40?mode=today&timeout=240000', {
        method: 'POST',
      });
      const json = await res.json();
      if (json.success) {
        const preds = json.total_predictions ?? 0;
        const dates = (json.scan_dates || []).join(', ');
        const dur = ((json.elapsed_ms ?? 0) / 1000).toFixed(1);
        setWarmupMsg(`✅ تم في ${dur}ث — ${preds} توقعات على ${dates}`);
        // Refresh predictions so the new ones show up immediately.
        await predsQ.refetch();
      } else if (!json.warming_up) {
        const tail = json.stderr_tail || json.status?.last_error || 'خطأ غير معروف';
        setWarmupMsg(`❌ فشل توليد التوقعات: ${tail.slice(0, 120)}`);
      }
      // if warming_up, keep existing data silently
    } catch (e) {
      setWarmupMsg(`❌ خطأ: ${e instanceof Error ? e.message : 'اتصال'}`);
    } finally {
      setWarmingV40(false);
      setTimeout(() => setWarmupMsg(null), 8000);
    }
  }, [predsQ]);

  return {
    data: radarData,
    loading,
    refreshing,
    error,
    predMap,
    stockMap,
    warmingRadar,
    warmingV40,
    warmupMsg,
    lastUpdated,
    refetch,
    fetchStockMap,
    warmupRadar,
    refreshV40,
  };
}
