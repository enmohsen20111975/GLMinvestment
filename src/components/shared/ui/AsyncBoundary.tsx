'use client';

/**
 * AsyncBoundary — P0-COMPONENT-UNIFICATION (Phase 1.6)
 * ====================================================================
 * مكوّن loading + error + empty state في واحد. بـ يحل الـ problem اللي
 * كل Tab كان بـ يعمله يدوياً:
 * ----------------------------------------------------------------------------
 *   {isLoading && <Skeleton ... />}
 *   {error && <p>مفيش بيانات</p>}
 *   {data && data.length === 0 && <EmptyState ... />}
 *   {data && data.length > 0 && <Content data={data} />}
 *
 * ده pattern متكرر في 268+ مكان. الـ AsyncBoundary بـ يـدمجه في:
 *   <AsyncBoundary status={query.status} data={query.data}>
 *     {data => <Content data={data} />}
 *   </AsyncBoundary>
 *
 * كمان بـ يستخدم UnifiedEmptyState (موجود بس 1 file بـ يستخدمه!).
 * ====================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { UnifiedEmptyState } from '@/components/shared/ui/UnifiedEmptyState';
import { TabSkeleton } from './Skeleton';

// ============================================================
// Types
// ============================================================

export interface AsyncBoundaryProps<T> {
  /** الـ status: 'loading' | 'error' | 'success' | 'idle'. */
  status: 'loading' | 'error' | 'success' | 'idle';
  /** الـ data (مـمكن تكون null/undefined لو لسه loading أو فيه error). */
  data: T | null | undefined;
  /** الـ error message. */
  error?: string | null;
  /** يـتـستدعى لو status === 'success' + data موجود + (لو array, length > 0). */
  children: (data: T) => React.ReactNode;
  /** empty state configuration. */
  emptyState?: {
    title?: string;
    description?: string;
    actionLabel?: string;
    onAction?: () => void;
  };
  /** Loading skeleton rows. default: 5. */
  skeletonRows?: number;
  /** Loading skeleton columns. default: 3. */
  skeletonColumns?: number;
  /** Retry handler (للـ error state). */
  onRetry?: () => void;
  /** Custom className. */
  className?: string;
}

// ============================================================
// Component
// ============================================================

/**
 * بـ يـعرض: loading skeleton / error state / empty state / children(data)
 * بناءً على الـ status + data.
 *
 * @example
 * // TanStack Query integration
 * const { data, status, error, refetch } = useApiQuery('/api/stocks');
 * <AsyncBoundary
 *   status={status === 'pending' ? 'loading' : status === 'error' ? 'error' : 'success'}
 *   data={data?.data}
 *   error={error ? String(error) : null}
 *   onRetry={refetch}
 *   emptyState={{ title: 'مفيش أسهم', description: 'حاول لاحقاً' }}
 * >
 *   {stocks => <StocksTable stocks={stocks} />}
 * </AsyncBoundary>
 *
 * @example
 * // With array data (auto-detect empty)
 * <AsyncBoundary status="success" data={predictions}>
 *   {preds => preds.map(p => <PredictionCard key={p.id} {...p} />)}
 * </AsyncBoundary>
 */
export function AsyncBoundary<T>({
  status,
  data,
  error,
  children,
  emptyState,
  skeletonRows = 5,
  skeletonColumns = 3,
  onRetry,
  className,
}: AsyncBoundaryProps<T>) {
  // (1) Loading state
  if (status === 'loading' || status === 'idle') {
    return (
      <div className={className}>
        <TabSkeleton rows={skeletonRows} columns={skeletonColumns} />
      </div>
    );
  }

  // (2) Error state
  if (status === 'error' || error) {
    return (
      <UnifiedEmptyState
        variant="error"
        title="فشل تحميل البيانات"
        description={error || 'حاول مرة تانية'}
        actionLabel={onRetry ? 'إعادة المحاولة' : undefined}
        onAction={onRetry}
      />
    );
  }

  // (3) Empty state (لو الـ data هو empty array)
  if (data == null) {
    return (
      <UnifiedEmptyState
        variant="empty"
        title={emptyState?.title}
        description={emptyState?.description}
        actionLabel={emptyState?.actionLabel}
        onAction={emptyState?.onAction}
      />
    );
  }

  // Array empty check (لو الـ data array فارغ)
  if (Array.isArray(data) && data.length === 0) {
    return (
      <UnifiedEmptyState
        variant="empty"
        title={emptyState?.title}
        description={emptyState?.description}
        actionLabel={emptyState?.actionLabel}
        onAction={emptyState?.onAction}
      />
    );
  }

  // (4) Success — render children with data
  return <>{children(data)}</>;
}

export default AsyncBoundary;
