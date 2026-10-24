'use client';

/**
 * hooks/useAcademyData.ts
 * ============================================================================
 * F-Strangler-AcademyView: Strangler Pattern extraction from
 * AcademyView.tsx (was 2,483 LOC).
 * ----------------------------------------------------------------------------
 * قبل كده: الـ component كان فيه 3 manual `useEffect + fetch + setLoading +
 * setError` blocks:
 *   - `AdvancedLessonsTab`:
 *       1) `/api/ads/educational-lessons` (lessons list — 12 institutional
 *          lessons, on mount) + retry-on-error button.
 *       2) `/api/ads/educational-lessons?id=X` (lazy full-content fetch
 *          per active lesson, with in-memory `fullCache` state).
 *   - `LiveMarketScanner` (Trading Floor Section 1):
 *       3) `/api/stocks?page_size=500` (top tickers by activity,
 *          60-second polling + manual refresh button + FALLBACK_STOCKS
 *          graceful-degrade on failure/empty).
 * كل واحد بـ يعمل نفس الشيء بس بـ bugs مختلفة: مفيش caching، مفيش retry على
 * transient failures، مفيش paywall event dispatch على 402/403، loading/error
 * triples في كل مكان.
 *
 * دلوقتي: الـ data logic كله here. الـ components بقت render-only.
 *
 *   // Tab: AdvancedLessonsTab (advanced lessons):
 *   const { lessons, loading, error, refetch, loadingFull, loadFull, getFull }
 *     = useAcademyLessonsData();
 *
 *   // Section: LiveMarketScanner (trading floor):
 *   const { stocks, loading, refreshing, error, lastUpdated, refetch }
 *     = useAcademyStocksData();
 *
 * الـ hooks بتستخدم useApiQuery (TanStack Query v5 + canonical apiGet) لـ
 * الـ 3 fetches. الـ full-content lazy fetch بيستخدم `queryClient.fetchQuery`
 * مباشرة (imperative trigger من زر "عرض المحتوى الكامل") بـ `staleTime: Infinity`
 * لـ cache دائم لكل lesson.
 *
 * Behaviour preservation:
 *   - lessons list: `loading = isLoading || (manualRefresh && isFetching)`
 *     (matches original `setLoading(true)` in retry handler).
 *   - error cleared to null during refetch (matches original `setError(null)`
 *     in retry handler).
 *   - stocks polling: `refetchInterval: 60_000` (matches original
 *     `setInterval(() => fetchStocks(true), 60_000)`).
 *   - stocks manual refresh: `manualRefresh` flag preserves original
 *     `setLoading(true)` on click (otherwise `isLoading` would be false
 *     because data already exists from initial fetch).
 *   - FALLBACK_STOCKS: shown on error OR on empty success (matches original
 *     behaviour exactly — empty success doesn't show error banner).
 * ============================================================================
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery } from '@/hooks/use-api-query';
import { apiGet, type ApiResponse } from '@/lib/api-client';

// ============================================================
// Types (mirror the API responses — moved from AcademyView.tsx)
// ============================================================

export interface AdvancedLessonSection {
  heading: string;
  content: string;
}

export interface AdvancedLesson {
  id: string;
  filename: string;
  title: string;
  emoji: string;
  level: string;
  duration: string;
  tagline: string;
  sections: AdvancedLessonSection[];
  keyPoints: string[];
  fullContent?: string;
}

/** /api/ads/educational-lessons response body shape. */
export interface EducationalLessonsResponse {
  success: boolean;
  lessons: AdvancedLesson[];
  error?: string;
}

export interface FloorStock {
  ticker: string;
  name?: string;
  name_ar?: string;
  current_price: number;
  change_percent: number;
  volume: number;
  sector?: string;
}

/** /api/stocks?page_size=500 response body shape. */
export interface StocksListResponse {
  success: boolean;
  stocks: Record<string, unknown>[];
  total?: number;
  error?: string;
}

// ============================================================
// Helpers (moved from AcademyView.tsx — pure data normalization)
// ============================================================

/** Normalizes an unknown stock row into a typed FloorStock (best-effort). */
function normalizeStock(raw: Record<string, unknown>): FloorStock {
  return {
    ticker: String(raw.ticker ?? raw.symbol ?? ''),
    name: raw.name ? String(raw.name) : undefined,
    name_ar: raw.name_ar ? String(raw.name_ar) : undefined,
    current_price: Number(raw.current_price ?? raw.close ?? raw.last_price ?? 0) || 0,
    change_percent: Number(raw.change_percent ?? raw.price_change ?? 0) || 0,
    volume: Number(raw.volume_int ?? raw.volume ?? 0) || 0,
    sector: raw.sector ? String(raw.sector) : undefined,
  };
}

/**
 * Static demo list — shown only if /api/stocks is unreachable or returns empty
 * (graceful degrade for offline / backend-down states).
 */
export const FALLBACK_STOCKS: FloorStock[] = [
  { ticker: 'COMI', name_ar: 'المصرية للاتصالات', current_price: 28.45, change_percent: 2.14, volume: 4_820_000 },
  { ticker: 'HRHO', name_ar: 'أوراسكوم للمقاولات', current_price: 412.6, change_percent: -1.2, volume: 1_240_000 },
  { ticker: 'EFGR', name_ar: 'البنك الأهلي المصري', current_price: 68.3, change_percent: 0.85, volume: 3_410_000 },
  { ticker: 'SWDY', name_ar: 'سويدى إلكتريك', current_price: 22.9, change_percent: -0.45, volume: 2_180_000 },
  { ticker: 'EKHO', name_ar: 'القاهرة للدواجن', current_price: 19.75, change_percent: 4.32, volume: 1_980_000 },
  { ticker: 'AUTO', name_ar: 'غبور أوتو', current_price: 7.42, change_percent: 0.0, volume: 5_120_000 },
  { ticker: 'TMGH', name_ar: 'طلعت مصطفى', current_price: 11.6, change_percent: 1.92, volume: 2_870_000 },
  { ticker: 'ORAS', name_ar: 'أوراسكوم للتنمية', current_price: 245.8, change_percent: -2.71, volume: 980_000 },
  { ticker: 'EAST', name_ar: 'الشرقية للدخان', current_price: 18.04, change_percent: 0.62, volume: 1_540_000 },
  { ticker: 'ABUK', name_ar: 'أبو قريم للأسمدة', current_price: 32.18, change_percent: 1.33, volume: 2_290_000 },
  { ticker: 'FWRY', name_ar: 'فوري', current_price: 4.71, change_percent: -0.85, volume: 3_960_000 },
  { ticker: 'MTIE', name_ar: 'موبكو', current_price: 211.4, change_percent: 3.45, volume: 1_120_000 },
  { ticker: 'EGCH', name_ar: 'مصر للأسمنت', current_price: 14.82, change_percent: 0.27, volume: 1_760_000 },
  { ticker: 'PHDC', name_ar: 'بريماء للصناعات الدوائية', current_price: 13.95, change_percent: -1.6, volume: 1_430_000 },
  { ticker: 'DCRC', name_ar: 'دلتا للسكر', current_price: 36.55, change_percent: 2.08, volume: 1_260_000 },
  { ticker: 'CNEG', name_ar: 'القاهرة للإسكان والتعمير', current_price: 9.18, change_percent: -0.32, volume: 2_040_000 },
  { ticker: 'ISPH', name_ar: 'المصرية للأدوية', current_price: 8.95, change_percent: 1.21, volume: 1_690_000 },
  { ticker: 'CCPA', name_ar: 'القاهرة للخدمات', current_price: 11.42, change_percent: 0.0, volume: 1_380_000 },
];

// ============================================================
// Constants (Arabic error strings — preserved verbatim from original)
// ============================================================

const STOCKS_FALLBACK_ERROR = 'تعذّر الاتصال بـ /api/stocks — يتم عرض بيانات تجريبية للعرض التوضيحي.';
const LESSONS_FETCH_ERROR = 'فشل تحميل الدروس المتقدمة';
const LESSONS_RETRY_ERROR = 'فشل تحميل الدروس';
const NETWORK_ERROR = 'خطأ في الشبكة';

// ============================================================
// Hook 1: useAcademyLessonsData (Advanced Lessons Tab)
// ============================================================

export interface UseAcademyLessonsDataResult {
  /** Parsed lessons array from /api/ads/educational-lessons (empty until first success). */
  lessons: AdvancedLesson[];
  /** True during first fetch AND every manual retry (matches original setLoading(true) in retry). */
  loading: boolean;
  /** API/network error message, or null on success. Cleared to null during refetch. */
  error: string | null;
  /** Triggers a refetch of the lessons list (used by retry button). */
  refetch: () => void;
  /** Currently-loading lesson id for full-content fetch, or null. */
  loadingFull: string | null;
  /**
   * Imperative lazy fetch of a lesson's full content. Returns the fullContent
   * string on success (cached via TanStack Query, `staleTime: Infinity`), or
   * null on failure. The caller is responsible for setShowFull(true) on
   * non-null return (matches original `loadFull` semantics).
   */
  loadFull: (id: string) => Promise<string | null>;
  /** Read the cached fullContent for a lesson id (undefined if not yet fetched). */
  getFull: (id: string) => string | undefined;
}

/**
 * بـ يجيب advanced lessons list بـ useApiQuery + بـ يـ exposure `loadFull(id)`
 * imperative lazy-fetch for full lesson content (cached via queryClient.fetchQuery).
 *
 * Behaviour mirrors the original `AdvancedLessonsTab`:
 *   - `loading = isLoading || (manualRefresh && isFetching)` — preserves
 *     original `setLoading(true)` on retry click.
 *   - `error` cleared to null during refetch (matches original `setError(null)`).
 */
export function useAcademyLessonsData(): UseAcademyLessonsDataResult {
  const qc = useQueryClient();
  const [manualRefresh, setManualRefresh] = useState(false);
  const [loadingFull, setLoadingFull] = useState<string | null>(null);

  const lessonsQ = useApiQuery<EducationalLessonsResponse>('/api/ads/educational-lessons', {
    queryOptions: { staleTime: 0, refetchOnWindowFocus: false },
  });

  // Clear `manualRefresh` flag when the fetch settles (success or failure).
  useEffect(() => {
    if (!lessonsQ.isFetching && manualRefresh) setManualRefresh(false);
  }, [lessonsQ.isFetching, manualRefresh]);

  const lessons = useMemo<AdvancedLesson[]>(() => {
    const r = lessonsQ.data?.data;
    if (r?.success && Array.isArray(r.lessons) && r.lessons.length > 0) {
      return r.lessons as AdvancedLesson[];
    }
    return [];
  }, [lessonsQ.data]);

  const error = useMemo<string | null>(() => {
    // Clear error during refetch (matches original `setError(null)` in retry handler)
    if (lessonsQ.isFetching) return null;
    if (lessonsQ.error) {
      return lessonsQ.error instanceof Error ? lessonsQ.error.message : NETWORK_ERROR;
    }
    const r = lessonsQ.data?.data;
    if (r && !r.success) return r.error || LESSONS_FETCH_ERROR;
    return null;
  }, [lessonsQ.data, lessonsQ.error, lessonsQ.isFetching]);

  const loadFull = useCallback(
    async (id: string): Promise<string | null> => {
      const cacheKey = ['academy-lesson-full', id] as const;
      // Short-circuit if we already have it cached (matches original `if (fullCache[id])`)
      const cached = qc.getQueryData<ApiResponse<EducationalLessonsResponse>>(cacheKey);
      if (cached?.data?.lessons?.[0]?.fullContent) {
        return cached.data.lessons[0].fullContent;
      }
      setLoadingFull(id);
      try {
        const res = await qc.fetchQuery({
          queryKey: cacheKey,
          queryFn: () =>
            apiGet<EducationalLessonsResponse>(
              `/api/ads/educational-lessons?id=${encodeURIComponent(id)}`,
            ),
          staleTime: Infinity,
        });
        return res?.data?.lessons?.[0]?.fullContent ?? null;
      } catch {
        /* swallow — preview sections already visible */
        return null;
      } finally {
        setLoadingFull(null);
      }
    },
    [qc],
  );

  const getFull = useCallback(
    (id: string): string | undefined => {
      const cached = qc.getQueryData<ApiResponse<EducationalLessonsResponse>>([
        'academy-lesson-full',
        id,
      ]);
      return cached?.data?.lessons?.[0]?.fullContent;
    },
    [qc],
  );

  return {
    lessons,
    // isLoading covers initial fetch; manualRefresh covers retry click after
    // a successful fetch (when `isLoading` would be false because data exists).
    loading: lessonsQ.isLoading || (manualRefresh && lessonsQ.isFetching),
    error,
    refetch: () => {
      setManualRefresh(true);
      void lessonsQ.refetch();
    },
    loadingFull,
    loadFull,
    getFull,
  };
}

// ============================================================
// Hook 2: useAcademyStocksData (Live Market Scanner — Trading Floor)
// ============================================================

export interface UseAcademyStocksDataResult {
  /** Normalized + sorted stocks (FALLBACK_STOCKS on error/empty). */
  stocks: FloorStock[];
  /** True during first fetch AND every manual refresh (matches original setLoading(true) on `fetchStocks()`). */
  loading: boolean;
  /** True during every fetch including 60s polling (matches original `setRefreshing(true)`). */
  refreshing: boolean;
  /** Error message when fetch failed (with FALLBACK_STOCKS shown), or null. */
  error: string | null;
  /** Last successful or failed fetch timestamp (matches original `setLastUpdated`). */
  lastUpdated: Date | null;
  /** Triggers a manual refetch (used by refresh button). */
  refetch: () => void;
}

/**
 * بـ يجيب /api/stocks?page_size=500 بـ useApiQuery مع 60-second polling +
 * graceful-degrade إلى FALLBACK_STOCKS على الـ failure/empty.
 *
 * Behaviour mirrors the original `LiveMarketScanner.fetchStocks`:
 *   - polling via `refetchInterval: 60_000` (matches `setInterval(fetchStocks(true), 60_000)`).
 *   - manual refresh preserves `loading=true` via `manualRefresh` flag (matches
 *     original `fetchStocks()` default `silent=false` which sets loading=true).
 *   - FALLBACK_STOCKS shown on network error, API error (success:false), OR
 *     empty success (no error banner in the empty case — matches original).
 */
export function useAcademyStocksData(): UseAcademyStocksDataResult {
  const [manualRefresh, setManualRefresh] = useState(false);
  const stocksQ = useApiQuery<StocksListResponse>('/api/stocks', {
    params: { page_size: 500 },
    fetchOptions: { cache: 'no-store' as RequestCache },
    queryOptions: {
      staleTime: 0,
      refetchInterval: 60_000,
      refetchOnWindowFocus: false,
    },
  });

  // Clear `manualRefresh` flag when the fetch settles.
  useEffect(() => {
    if (!stocksQ.isFetching && manualRefresh) setManualRefresh(false);
  }, [stocksQ.isFetching, manualRefresh]);

  const { stocks, error, lastUpdated } = useMemo<{
    stocks: FloorStock[];
    error: string | null;
    lastUpdated: Date | null;
  }>(() => {
    const now = new Date();
    // Network / query error → fallback
    if (stocksQ.error) {
      return { stocks: FALLBACK_STOCKS, error: STOCKS_FALLBACK_ERROR, lastUpdated: now };
    }
    const r = stocksQ.data?.data;
    // API-level error (success: false) → fallback
    if (r && !r.success) {
      return { stocks: FALLBACK_STOCKS, error: STOCKS_FALLBACK_ERROR, lastUpdated: now };
    }
    // Successful response — normalize + filter + sort (verbatim from original fetchStocks)
    const list = Array.isArray(r?.stocks) ? r.stocks : [];
    const normalized = list
      .map((row) => normalizeStock(row as Record<string, unknown>))
      .filter((s) => s.ticker && s.volume > 0)
      .sort((a, b) => b.volume - a.volume);
    if (normalized.length === 0) {
      // Empty success → fallback demo data, NO error banner (matches original)
      return { stocks: FALLBACK_STOCKS, error: null, lastUpdated: now };
    }
    return { stocks: normalized, error: null, lastUpdated: now };
  }, [stocksQ.data, stocksQ.error]);

  return {
    stocks,
    // isLoading covers initial fetch; manualRefresh covers refresh click
    loading: stocksQ.isLoading || (manualRefresh && stocksQ.isFetching),
    refreshing: stocksQ.isFetching,
    error,
    lastUpdated,
    refetch: () => {
      setManualRefresh(true);
      void stocksQ.refetch();
    },
  };
}
