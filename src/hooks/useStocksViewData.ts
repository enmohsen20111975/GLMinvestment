'use client';

/**
 * hooks/useStocksViewData.ts
 * ============================================================================
 * F-Strangler-StocksView: Strangler Pattern extraction from
 * StocksView.tsx (was 2,316 LOC).
 * ----------------------------------------------------------------------------
 * قبل كده: الـ component كان فيه 1 inline `useEffect + fetch + setState` block
 * بـ يجيب preset data (top gainers / top losers / most active):
 *
 *   useEffect(() => {
 *     if (selectedPreset === 'all') {
 *       setPresetData([]); setPresetScanDate(null); return;
 *     }
 *     setPresetLoading(true);
 *     const qs = new URLSearchParams({ preset, period, limit: '50' });
 *     if (currentMarket) qs.set('market', currentMarket);
 *     fetch(`/api/stocks/presets?${qs.toString()}`)
 *       .then(r => r.json())
 *       .then(data => { ...setPresetData / setPresetScanDate... })
 *       .catch(() => { setPresetData([]); setPresetScanDate(null); })
 *       .finally(() => setPresetLoading(false));
 *   }, [selectedPreset, presetPeriod, currentMarket]);
 *
 * + 3 useState مرتبطة بـ fetch الـ preset:
 *   - presetData: Array<Record<string, unknown>>
 *   - presetLoading: boolean
 *   - presetScanDate: string | null
 *
 * دلوقتي: الـ preset fetch logic كله here. الـ component بقا render-only:
 *
 *   const { presetData, presetLoading, presetScanDate }
 *     = useStocksViewData({ selectedPreset, presetPeriod, currentMarket });
 *
 * الـ hook بيستخدم useApiQuery (TanStack Query v5 + canonical apiGet) لـ fetch
 * `/api/stocks/presets`. الـ selectedPreset + presetPeriod بـ يـفضلو UI state
 * في الـ component (بيـتحكموا عن طريق Select onChange + quick-filter buttons).
 *
 * Behaviour preservation:
 *   - `enabled: selectedPreset !== 'all'` — matches original early-return on
 *     'all' (sets presetData=[] + presetScanDate=null, no fetch fires).
 *   - `presetLoading = enabled && isFetching` — matches original
 *     `setPresetLoading(true)` BEFORE every fetch (initial + on period/preset
 *     change). TanStack's `isLoading` would be false on subsequent fetches
 *     (since data exists from previous fetch), so we use `isFetching` to
 *     preserve the original "loading=true during fetch" semantics.
 *   - On API/network error: presetData=[] + presetScanDate=null (matches
 *     original `.catch(() => { setPresetData([]); setPresetScanDate(null); })`).
 *   - On success but success:false: same fallback (matches original `else`
 *     branch inside `.then`).
 *   - `refetchPresets` exposed for manual refresh if needed later (currently
 *     unused by component — preset refetch happens implicitly via queryKey
 *     change when selectedPreset/presetPeriod/currentMarket changes).
 *
 * NOTE على scope الـ Strangler pass ده:
 *   الـ StocksView.tsx الـ 2,316 LOC بـ يستخدم Zustand store (`useAppStore`)
 *   لـ loadStocks / loadCryptoList / refreshLivePrices — دي store actions بـ
 *   تـtrigger fetches from داخل الـ store (مش inline fetch في الـ component).
 *   الـ polling useEffects الـ بـ triggerها (lines 944-959) بـ تـفضل في
 *   الـ component لأنها بـ تـorchestrate store state (مش component-owned
 *   data-fetching). الـ extraction ده بـ يـ focus على الـ inline fetch الوحيد
 *   في الـ file (preset data). باقي useState في الـ component كلها UI state
 *   (search / filters / page / sectors) — مش data-fetching.
 * ============================================================================
 */

import { useMemo } from 'react';
import { useApiQuery } from '@/hooks/use-api-query';

// ============================================================
// Types — API response shapes (mirror the API JSON exactly)
// ============================================================

/**
 * `/api/stocks/presets?preset=X&period=Y&limit=50&market=Z` response body.
 * Proxied via Next.js route to Python backend (EGXPY_SERVICE_URL).
 *
 * Shape (from Python `/api/stocks/presets`):
 *   {
 *     success: boolean,
 *     results?: Array<Record<string, unknown>>,   ← preset rows
 *     scan_date?: string | null,                  ← ISO timestamp of last scan
 *     error?: string,
 *   }
 *
 * Note: apiFetch treats this as canonical (top-level `success` boolean) and
 * self-references the body as `data` (see api-client.ts L152-158). So the
 * raw fields (success, results, scan_date) are accessible via both the
 * top-level response AND `response.data`.
 */
export interface PresetsResponse {
  success: boolean;
  results?: Array<Record<string, unknown>>;
  scan_date?: string | null;
  error?: string;
}

// ============================================================
// Hook options + return type
// ============================================================

export interface UseStocksViewDataOptions {
  /** Currently-selected preset key ('all' disables fetch; otherwise 'top_gainers' | 'top_losers' | 'most_active' | …). */
  selectedPreset: string;
  /** Preset period ('1d' | '1w' | '1m' | …). */
  presetPeriod: string;
  /** Current market filter (EGX | TADAWUL | KSE | QSE | US | CRYPTO). Empty string skips the `market` query param. */
  currentMarket: string;
}

export interface UseStocksViewDataResult {
  /** Preset rows from /api/stocks/presets (empty array if preset='all' or fetch failed or success:false). */
  presetData: Array<Record<string, unknown>>;
  /** True during every fetch (initial + on preset/period/market change). False when preset='all'. */
  presetLoading: boolean;
  /** ISO timestamp of last preset scan (null if preset='all' or fetch failed or success:false). */
  presetScanDate: string | null;
  /** Imperative refetch (currently unused by component — queryKey change auto-refetches). */
  refetchPresets: () => void;
}

// ============================================================
// Hook: useStocksViewData
// ============================================================

/**
 * بـ يجيب preset data من `/api/stocks/presets` بـ useApiQuery (TanStack Query
 * v5 + canonical apiGet). الـ fetch بـ يـتفعل بس لما `selectedPreset !== 'all'`.
 *
 * Behaviour mirrors the original StocksView preset fetch (lines 972-1006 of
 * the pre-refactor file):
 *   - selectedPreset === 'all' → presetData=[], presetScanDate=null, no fetch.
 *   - Otherwise → fetch with `?preset=X&period=Y&limit=50&market=Z`.
 *   - On success (data.success) → presetData=data.results || [], presetScanDate=data.scan_date || null.
 *   - On failure (network error OR success:false) → presetData=[], presetScanDate=null.
 *   - presetLoading=true during fetch (covers initial + every refetch from param change).
 *
 * @example
 * const { presetData, presetLoading, presetScanDate }
 *   = useStocksViewData({ selectedPreset, presetPeriod, currentMarket });
 */
export function useStocksViewData({
  selectedPreset,
  presetPeriod,
  currentMarket,
}: UseStocksViewDataOptions): UseStocksViewDataResult {
  const enabled = selectedPreset !== 'all';

  const query = useApiQuery<PresetsResponse>('/api/stocks/presets', {
    params: {
      preset: selectedPreset,
      period: presetPeriod,
      limit: 50,
      // Empty string → undefined → skipped by buildUrlWithParams (matches
      // original `if (currentMarket) qs.set('market', currentMarket);`).
      market: currentMarket || undefined,
    },
    fetchOptions: { cache: 'no-store' as RequestCache },
    queryOptions: {
      // Disable fetch entirely when preset === 'all' (matches original early-return).
      enabled,
      // Always refetch on param change (staleTime:0 → cache stale immediately).
      staleTime: 0,
      // No polling — original was a one-shot fetch per param-change.
      refetchOnWindowFocus: false,
    },
  });

  // Extract presetData + presetScanDate from the response.
  // - When !enabled: empty/null (matches original early-return on preset='all').
  // - On error: empty/null (matches original .catch fallback).
  // - On success but success:false: empty/null (matches original `else` branch).
  // - On success: results/scan_date from response body.
  const { presetData, presetScanDate } = useMemo<{
    presetData: Array<Record<string, unknown>>;
    presetScanDate: string | null;
  }>(() => {
    if (!enabled) return { presetData: [], presetScanDate: null };
    if (query.error) return { presetData: [], presetScanDate: null };
    const r = query.data?.data;
    if (!r || !r.success) return { presetData: [], presetScanDate: null };
    return {
      presetData: Array.isArray(r.results) ? r.results : [],
      presetScanDate: r.scan_date ?? null,
    };
  }, [enabled, query.data, query.error]);

  // presetLoading: true during every fetch (initial + refetch from param change).
  // Original: setPresetLoading(true) BEFORE every fetch → matches isFetching
  // (NOT isLoading, which is false on subsequent fetches after first success).
  const presetLoading = enabled && query.isFetching;

  return {
    presetData,
    presetLoading,
    presetScanDate,
    refetchPresets: () => {
      void query.refetch();
    },
  };
}
