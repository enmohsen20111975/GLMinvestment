/**
 * hooks/use-api-query.ts
 * ============================================================================
 * P0-COMPONENT-UNIFICATION (Phase 0.9): useApiQuery — TanStack Query wrapper
 * around the canonical `apiGet` from `@/lib/api-client`.
 * ----------------------------------------------------------------------------
 * قبل كده: كان فيه 268 manual `useEffect + fetch + setLoading + setError`
 * pattern في 98 file. كل واحد بـ يعمل نفس الشيء بس بـ bugs مختلفة:
 *   - مفيش caching (كل ما تفتح tab بـ يعمل fetch جديد)
 *   - مفيش retry على transient failures (502/503/504)
 *   - مفيش paywall event dispatch على 402/403
 *   - مفيش background refetch
 *   - loading/error/data triples في كل مكان
 *
 * الـ hook ده بـ يـدمج الـ 268 patterns في مـكوّن واحد. كل اللي محتاج المستخدم:
 *   const { data, isLoading, error } = useApiQuery('/api/stocks', { params: { market } });
 *
 * Migration (Phase 2 codemod): كل `useEffect + fetch` pattern بـ يـتعمل بـ:
 *   - import { useApiQuery } from '@/hooks/use-api-query'
 *   - const { data } = useApiQuery('/api/foo');
 * ============================================================================
 */

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { apiGet, type ApiResponse } from '@/lib/api-client';

// ============================================================
// Types
// ============================================================

export interface UseApiQueryOptions<TData, TError = unknown> {
  /** Query params — بـ تـتحول لـ URLSearchParams */
  params?: Record<string, string | number | boolean | null | undefined>;
  /** TanStack Query options (staleTime, refetchInterval, enabled, …) */
  queryOptions?: Omit<UseQueryOptions<ApiResponse<TData>, TError>, 'queryKey' | 'queryFn'>;
  /** Extra fetch options (headers, signal, timeoutMs, …) */
  fetchOptions?: RequestInit & { timeoutMs?: number };
}

// ============================================================
// useApiQuery hook
// ============================================================

/**
 * بياخد data من `/api/*` endpoint بـ استخدام TanStack Query + canonical apiGet.
 *
 * @param path - الـ API path (مثلاً '/api/stocks' or '/api/stocks/COMI')
 * @param options - { params, queryOptions, fetchOptions }
 *
 * @example
 * // Basic
 * const { data: stocks, isLoading } = useApiQuery<Stock[]>('/api/stocks');
 *
 * // With params (bـ تـحول لـ ?market=EGX&limit=50)
 * const { data } = useApiQuery('/api/stocks', { params: { market: 'EGX', limit: 50 } });
 *
 * // With polling (every 5s — مثل live data)
 * const { data } = useApiQuery('/api/market-pulse', {
 *   queryOptions: { refetchInterval: 5_000 }
 * });
 *
 * // Conditional (ما تعملش query لو مش متـفعل)
 * const { data } = useApiQuery('/api/secret', {
 *   queryOptions: { enabled: userIsLoggedIn }
 * });
 *
 * @returns TanStack Query result (data, isLoading, error, refetch, …)
 *   - data: الـ payload unpacked من ApiResponse<T>.data
 *   - isLoading: true في الـ fetch الأول بس (مش في الـ refetch)
 *   - error: الـ error message لو الـ fetch فشل
 */
export function useApiQuery<TData, TError = unknown>(
  path: string,
  options: UseApiQueryOptions<TData, TError> = {}
) {
  const { params, queryOptions, fetchOptions } = options;

  // بناء الـ full URL مع params
  const fullUrl = buildUrlWithParams(path, params);

  return useQuery<ApiResponse<TData>, TError>({
    queryKey: [fullUrl, fetchOptions],
    queryFn: () => apiGet<TData>(fullUrl, fetchOptions),
    ...queryOptions,
  });
}

// ============================================================
// Helpers
// ============================================================

/**
 * بـ يـبني URL مع query params. بـ يـتـخطى الـ null/undefined values.
 *
 * @example
 * buildUrlWithParams('/api/stocks', { market: 'EGX', limit: 50 })
 *   // → '/api/stocks?market=EGX&limit=50'
 *
 * buildUrlWithParams('/api/foo', { a: null, b: undefined, c: 'x' })
 *   // → '/api/foo?c=x'
 */
function buildUrlWithParams(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>
): string {
  if (!params) return path;
  const url = new URL(path, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) continue;
    url.searchParams.set(key, String(value));
  }
  // نـرجّع path + search فقط (مش full URL)
  return url.pathname + url.search;
}

// ============================================================
// Convenience hooks for common patterns
// ============================================================

/**
 * useApiQuery بس بـ refetch interval (للـ polling/live data).
 *
 * @example
 * const { data: liveData } = useLiveApiQuery('/api/market-pulse', 5000);
 */
export function useLiveApiQuery<TData, TError = unknown>(
  path: string,
  intervalMs: number = 5_000,
  options: UseApiQueryOptions<TData, TError> = {}
) {
  return useApiQuery<TData, TError>(path, {
    ...options,
    queryOptions: {
      ...options.queryOptions,
      refetchInterval: intervalMs,
    },
  });
}

/**
 * useApiQuery بس بـ enabled flag (للـ conditional fetching).
 *
 * @example
 * const { data } = useConditionalApiQuery('/api/portfolio', isLoggedIn);
 */
export function useConditionalApiQuery<TData, TError = unknown>(
  path: string,
  enabled: boolean,
  options: UseApiQueryOptions<TData, TError> = {}
) {
  return useApiQuery<TData, TError>(path, {
    ...options,
    queryOptions: {
      ...options.queryOptions,
      enabled,
    },
  });
}
