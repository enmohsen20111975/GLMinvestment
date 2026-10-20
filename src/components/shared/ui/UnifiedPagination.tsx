'use client';

/**
 * UnifiedPagination — P0-COMPONENT-UNIFICATION (Phase 1.4)
 * ====================================================================
 * مكوّن pagination موحّد بـ RTL + أزرار السابق/التالي + page counter.
 * ----------------------------------------------------------------------------
 * قبل كده: كان فيه 7+ inline pagination patterns في:
 *   - PersonaTab.tsx (شخصية table pagination)
 *   - HistoricalTradesTable.tsx
 *   - LiquidityRadarView.tsx:587-605
 *   - Shared/LiquidityRadarView + باقي الـ tabs
 *
 * كل واحد بـ يعمل نفس الـ logic بس بـ styles مختلفة. الـ component ده
 * بـ يـوحّدهم + بـ يستخدم `usePagination` hook من Phase 0.
 * ====================================================================
 */

import React from 'react';
import { ArrowRight, ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export interface UnifiedPaginationProps {
  /** الصفحة الحالية (0-indexed). */
  page: number;
  /** عدد الصفحات الكلي. */
  totalPages: number;
  /** بـ ينادي لما الصفحة تتـغير. */
  onChange: (page: number) => void;
  /** حجم الأزرار. default: sm. */
  size?: 'sm' | 'md' | 'lg';
  /** variant: compact (أزرار + counter) | full (with first/last). default: compact. */
  variant?: 'compact' | 'full';
  /** عرض الـ counter "1 / 5". default: true. */
  showCounter?: boolean;
  /** Disable BOTH buttons (e.g., during async loading). default: false. */
  disabled?: boolean;
  className?: string;
}

const SIZE_BUTTON: Record<'sm' | 'md' | 'lg', 'sm' | 'default' | 'lg'> = {
  sm: 'sm',
  md: 'default',
  lg: 'lg',
};

/**
 * @example
 * // Basic
 * <UnifiedPagination page={0} totalPages={5} onChange={setPage} />
 *
 * @example
 * // With usePagination hook
 * const { page, totalPages, goNext, goPrev } = usePagination(items, { pageSize: 10 });
 * <UnifiedPagination page={page} totalPages={totalPages} onChange={(p) => goToPage(p)} />
 *
 * @example
 * // Full variant with first/last
 * <UnifiedPagination page={page} totalPages={totalPages} onChange={setPage} variant="full" />
 */
export function UnifiedPagination({
  page,
  totalPages,
  onChange,
  size = 'sm',
  variant = 'compact',
  showCounter = true,
  disabled = false,
  className,
}: UnifiedPaginationProps) {
  // لو فيه صفحة واحدة بس، ما نعرضش الـ pagination
  if (totalPages <= 1) return null;

  const isFirst = page <= 0;
  const isLast = page >= totalPages - 1;
  const buttonSize = SIZE_BUTTON[size];

  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 py-2',
        className
      )}
      dir="rtl"
      role="navigation"
      aria-label="ترقيم الصفحات"
    >
      {/* First button (full variant only) */}
      {variant === 'full' && (
        <Button
          variant="outline"
          size={buttonSize}
          disabled={isFirst || disabled}
          onClick={() => onChange(0)}
          aria-label="الصفحة الأولى"
        >
          <ArrowRight className="h-4 w-4" />
          <ArrowRight className="h-4 w-4 -mr-2" />
        </Button>
      )}

      {/* Previous (RTL: ArrowRight = "back" visually) */}
      <Button
        variant="outline"
        size={buttonSize}
        disabled={isFirst || disabled}
        onClick={() => onChange(Math.max(0, page - 1))}
        aria-label="السابق"
        className="gap-1"
      >
        <ArrowRight className="h-4 w-4" />
        السابق
      </Button>

      {/* Counter */}
      {showCounter && (
        <span className="text-xs text-muted-foreground tabular-nums px-2">
          {page + 1} / {totalPages}
        </span>
      )}

      {/* Next (RTL: ArrowLeft = "forward" visually) */}
      <Button
        variant="outline"
        size={buttonSize}
        disabled={isLast || disabled}
        onClick={() => onChange(Math.min(totalPages - 1, page + 1))}
        aria-label="التالي"
        className="gap-1"
      >
        التالي
        <ArrowLeft className="h-4 w-4" />
      </Button>

      {/* Last button (full variant only) */}
      {variant === 'full' && (
        <Button
          variant="outline"
          size={buttonSize}
          disabled={isLast || disabled}
          onClick={() => onChange(totalPages - 1)}
          aria-label="الصفحة الأخيرة"
        >
          <ArrowLeft className="h-4 w-4" />
          <ArrowLeft className="h-4 w-4 -mr-2" />
        </Button>
      )}
    </div>
  );
}

export default UnifiedPagination;
