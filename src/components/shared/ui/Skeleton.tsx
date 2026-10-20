'use client';

/**
 * SkeletonRow + TabSkeleton — P0-COMPONENT-UNIFICATION (Phase 1.5)
 * ====================================================================
 * Skeleton components موحّدة لـ loading states.
 * ----------------------------------------------------------------------------
 * قبل كده: كان فيه 328+ inline `<Skeleton>` blocks في 79+ file. كل Tab
 * كان بـ يكتب skeleton يدوي زي:
 *   {loading && (
 *     <div className="space-y-2">
 *       <Skeleton className="h-4 w-full" />
 *       <Skeleton className="h-4 w-3/4" />
 *     </div>
 *   )}
 *
 * الـ components دي بـ تحل الـ problem ده.
 *
 * exports:
 *   - SkeletonRow: صف skeleton (للـ rows في جدول أو list).
 *   - TabSkeleton: skeleton كامل لـ tab (متعدد الـ rows).
 *   - TableSkeleton: skeleton على شكل جدول (with header + rows).
 *   - CardSkeleton: skeleton على شكل card (للـ cards).
 * ====================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

// ============================================================
// SkeletonRow
// ============================================================

export interface SkeletonRowProps {
  /** عدد الأعمدة في الصف. default: 3. */
  columns?: number;
  /** حجم كل خلية. default: 'md'. */
  cellSize?: 'sm' | 'md' | 'lg';
  className?: string;
}

const CELL_HEIGHT: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'h-3',
  md: 'h-4',
  lg: 'h-5',
};

/**
 * صف skeleton واحد — بـ يستخدم في:
 * - مكان row في جدول (waiting for data).
 * - مكان item في list.
 *
 * @example
 * {isLoading && <SkeletonRow columns={4} />}
 */
export function SkeletonRow({
  columns = 3,
  cellSize = 'md',
  className,
}: SkeletonRowProps) {
  return (
    <div
      className={cn('flex items-center gap-3 py-2', className)}
      role="status"
      aria-label="جاري التحميل"
    >
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn(CELL_HEIGHT[cellSize], 'flex-1')}
        />
      ))}
    </div>
  );
}

// ============================================================
// TabSkeleton
// ============================================================

export interface TabSkeletonProps {
  /** عدد الـ rows. default: 5. */
  rows?: number;
  /** عدد الأعمدة في كل row. default: 3. */
  columns?: number;
  /** Show a title skeleton above the rows. default: true. */
  showTitle?: boolean;
  className?: string;
}

/**
 * Skeleton كامل لـ tab — متعدد الـ rows + title (optional).
 *
 * @example
 * {isLoading && <TabSkeleton rows={5} columns={4} />}
 */
export function TabSkeleton({
  rows = 5,
  columns = 3,
  showTitle = true,
  className,
}: TabSkeletonProps) {
  return (
    <div className={cn('space-y-3 p-4', className)} role="status" aria-label="جاري تحميل التبويب">
      {showTitle && <Skeleton className="h-6 w-48" />}
      <div className="space-y-2">
        {Array.from({ length: rows }).map((_, i) => (
          <SkeletonRow key={i} columns={columns} />
        ))}
      </div>
    </div>
  );
}

// ============================================================
// TableSkeleton
// ============================================================

export interface TableSkeletonProps {
  /** عدد الـ rows. default: 5. */
  rows?: number;
  /** عدد الأعمدة. default: 4. */
  columns?: number;
  className?: string;
}

/**
 * Skeleton على شكل جدول — header + rows.
 *
 * @example
 * {isLoading && <TableSkeleton rows={5} columns={4} />}
 */
export function TableSkeleton({
  rows = 5,
  columns = 4,
  className,
}: TableSkeletonProps) {
  return (
    <div className={cn('rounded-md border border-border', className)} role="status" aria-label="جاري تحميل الجدول">
      {/* Header */}
      <div className="flex items-center gap-3 p-2 border-b border-border bg-muted/30">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} columns={columns} className="border-b border-border/50 last:border-b-0" />
      ))}
    </div>
  );
}

// ============================================================
// CardSkeleton
// ============================================================

export interface CardSkeletonProps {
  /** Show a title skeleton. default: true. */
  showTitle?: boolean;
  /** Show a badge skeleton on the right side of the title. default: true. */
  showBadge?: boolean;
  /** عدد الـ lines في الـ body. default: 3. */
  bodyLines?: number;
  className?: string;
}

/**
 * Skeleton على شكل card — لـ loading state of individual cards.
 *
 * @example
 * {isLoading && <CardSkeleton bodyLines={3} />}
 */
export function CardSkeleton({
  showTitle = true,
  showBadge = true,
  bodyLines = 3,
  className,
}: CardSkeletonProps) {
  return (
    <div
      className={cn('rounded-lg border border-border bg-card p-4 space-y-3', className)}
      role="status"
      aria-label="جاري تحميل البطاقة"
    >
      {showTitle && (
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-32" />
          {showBadge && <Skeleton className="h-5 w-12 rounded-full" />}
        </div>
      )}
      <div className="space-y-2">
        {Array.from({ length: bodyLines }).map((_, i) => (
          <Skeleton
            key={i}
            className={cn('h-3', i === bodyLines - 1 ? 'w-2/3' : 'w-full')}
          />
        ))}
      </div>
    </div>
  );
}

export { SkeletonRow as default };
