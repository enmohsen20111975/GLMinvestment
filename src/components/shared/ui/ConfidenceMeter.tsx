'use client';

/**
 * ConfidenceMeter — P0-COMPONENT-UNIFICATION (Phase 1.9)
 * ====================================================================
 * شريط أفقي بـ يعرض قيمة الـ confidence (0-100) بـ لون متناسب.
 * ----------------------------------------------------------------------------
 * قبل كده: كان فيه 3+ inline confidence bar implementations في:
 *   - PredictionCard (inline bar)
 *   - ExpertIntelligencePanel (different colors)
 *   - AIAnalysisWidget (different layout)
 *
 * الـ ConfidenceMeter بـ يـوحّدهم.
 * ====================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface ConfidenceMeterProps {
  /** القيمة (0-100). لو null/undefined → بـ يعرض "—". */
  value: number | null | undefined;
  /** حجم الـ meter. default: 'sm'. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  /** Show the numeric value next to the bar. default: true. */
  showValue?: boolean;
  /** Show the label "ثقة:" next to the bar. default: true. */
  showLabel?: boolean;
  className?: string;
}

const HEIGHT_CLASS = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2',
  lg: 'h-2.5',
} as const;

const TEXT_SIZE = {
  xs: 'text-[10px]',
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
} as const;

/**
 * Color based on value:
 * - >= 75 → profit (high confidence)
 * - 50-74 → warning (medium)
 * - < 50 → muted (low)
 */
function getBarColor(value: number): string {
  if (value >= 75) return 'bg-profit';
  if (value >= 50) return 'bg-warning';
  return 'bg-muted-foreground/50';
}

function getTextColor(value: number): string {
  if (value >= 75) return 'text-profit';
  if (value >= 50) return 'text-warning';
  return 'text-muted-foreground';
}

/**
 * @example
 * <ConfidenceMeter value={85} />            // → high green bar 85%
 * <ConfidenceMeter value={45} />            // → low muted bar 45%
 * <ConfidenceMeter value={null} />          // → "—"
 * <ConfidenceMeter value={85} showLabel={false} />
 */
export function ConfidenceMeter({
  value,
  size = 'sm',
  showValue = true,
  showLabel = true,
  className,
}: ConfidenceMeterProps) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return (
      <span className={cn('inline-flex items-center gap-2 text-muted-foreground', TEXT_SIZE[size], className)} dir="rtl">
        {showLabel && <span>الثقة:</span>}
        <span>—</span>
      </span>
    );
  }

  // Clamp 0-100
  const clampedValue = Math.max(0, Math.min(100, value));
  const barColor = getBarColor(clampedValue);
  const textColor = getTextColor(clampedValue);

  return (
    <div
      className={cn('inline-flex items-center gap-2', TEXT_SIZE[size], className)}
      dir="rtl"
    >
      {showLabel && <span className="text-muted-foreground">الثقة:</span>}
      <div className={cn('relative w-16 rounded-full bg-muted overflow-hidden', HEIGHT_CLASS[size])}>
        <div
          className={cn('absolute inset-y-0 right-0 rounded-full transition-all', barColor)}
          style={{ width: `${clampedValue}%` }}
          role="progressbar"
          aria-valuenow={clampedValue}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      {showValue && (
        <span className={cn('tabular-nums font-medium', textColor)}>
          {Math.round(clampedValue)}%
        </span>
      )}
    </div>
  );
}

export default ConfidenceMeter;
