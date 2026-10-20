/**
 * hooks/use-pagination.ts
 * ============================================================================
 * P0-COMPONENT-UNIFICATION (Phase 0.10): usePagination — pagination state
 * + helper for client-side pagination of arrays.
 * ----------------------------------------------------------------------------
 * قبل كده: كان فيه 7+ inline pagination patterns (زي اللي في PersonaTab +
 * HistoricalTradesTable + LiquidityRadarView + …). كل واحد بـ يعمل:
 *   const [page, setPage] = useState(0);
 *   const pageSize = 5;
 *   const totalPages = Math.ceil(items.length / pageSize);
 *   const pageItems = items.slice(page * pageSize, (page + 1) * pageSize);
 *
 * الـ hook ده بـ يـدمج كل الـ patterns دي في واحد. كمان بـ يـ reset
 * الـ page لـ 0 لو الـ items قلّت (عشان ما يـوقعش في state غير صالح).
 * ============================================================================
 */

import { useState, useMemo, useEffect, useCallback } from 'react';

export interface UsePaginationOptions {
  /** عدد العناصر في الصفحة الواحدة (default: 10). */
  pageSize?: number;
  /** Initial page (0-indexed). default: 0. */
  initialPage?: number;
}

export interface UsePaginationResult<T> {
  /** الصفحة الحالية (0-indexed). */
  page: number;
  /** عدد الصفحات الكلي. */
  totalPages: number;
  /** العناصر في الصفحة الحالية بس (slice). */
  pageItems: T[];
  /** الصفحة الأولى (0). */
  goToFirst: () => void;
  /** الصفحة الأخيرة (totalPages - 1). */
  goToLast: () => void;
  /** الصفحة التالية (لو موجودة). */
  goNext: () => void;
  /** الصفحة السابقة (لو موجودة). */
  goPrev: () => void;
  /** بياخد لـ page معين (لو صح). */
  goToPage: (page: number) => void;
  /** بـ reset لـ page 0. */
  reset: () => void;
  /** هل نحن في الصفحة الأولى؟ */
  isFirst: boolean;
  /** هل نحن في الصفحة الأخيرة؟ */
  isLast: boolean;
  /** عدد العناصر الكلي. */
  totalItems: number;
}

/**
 * بـ يـدار pagination state لأي array.
 *
 * @example
 * const items = [1, 2, 3, 4, 5, 6, 7];
 * const { pageItems, page, totalPages, goNext, goPrev } = usePagination(items, { pageSize: 3 });
 * // pageItems = [1, 2, 3], page = 0, totalPages = 3
 * goNext();
 * // pageItems = [4, 5, 6], page = 1
 */
export function usePagination<T>(
  items: readonly T[],
  options: UsePaginationOptions = {}
): UsePaginationResult<T> {
  const { pageSize = 10, initialPage = 0 } = options;

  const [page, setPage] = useState(initialPage);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(items.length / pageSize)),
    [items.length, pageSize]
  );

  // Reset page to 0 if items shrank (لو الـ filter عمل أقل من الحالي)
  useEffect(() => {
    if (page >= totalPages) {
      setPage(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages]);

  const pageItems = useMemo(() => {
    const start = page * pageSize;
    const end = start + pageSize;
    return items.slice(start, end);
  }, [items, page, pageSize]);

  const goToFirst = useCallback(() => setPage(0), []);
  const goToLast = useCallback(() => setPage(totalPages - 1), [totalPages]);
  const goNext = useCallback(() => {
    setPage(p => Math.min(p + 1, totalPages - 1));
  }, [totalPages]);
  const goPrev = useCallback(() => {
    setPage(p => Math.max(p - 1, 0));
  }, []);
  const goToPage = useCallback((next: number) => {
    setPage(Math.max(0, Math.min(next, totalPages - 1)));
  }, [totalPages]);
  const reset = useCallback(() => setPage(0), []);

  return {
    page,
    totalPages,
    pageItems,
    goToFirst,
    goToLast,
    goNext,
    goPrev,
    goToPage,
    reset,
    isFirst: page === 0,
    isLast: page >= totalPages - 1,
    totalItems: items.length,
  };
}
