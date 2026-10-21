'use client';

/**
 * TrendIndicator — Unified trend arrow + color
 * ====================================================================
 * Per ALPHA Mission Directive 2026-10-20.
 *
 * Shows a directional arrow (▲/▼/▬) with appropriate color based on the
 * value being positive, negative, or zero. Uses CSS variable tokens
 * (text-profit / text-loss / text-muted-foreground) — no raw colors.
 *
 * Dumb component: receives value via props, does NO calculations.
 *
 * @example
 * <TrendIndicator value={2.5} format="percent" />   // ▲ +2.50% (green)
 * <TrendIndicator value={-1.3} format="value" />    // ▼ -1.30 (red)
 * <TrendIndicator value={0} />                       // ▬ 0.00 (muted)
 * <TrendIndicator value={null} />                    // — (muted)
 * ====================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface TrendIndicatorProps {
  /** The numeric value (positive = up, negative = down, zero = flat). */
  value: number | null | undefined;
  /** Display format: 'percent' adds %, 'value' is plain. default: percent. */
  format?: 'percent' | 'value';
  /** Number of decimal places. default: 2. */
  digits?: number;
  /** Show the arrow icon. default: true. */
  showArrow?: boolean;
  /** Show + sign for positive values. default: true. */
  showSign?: boolean;
  /** Size: 'xs' | 'sm' | 'md'. default: 'sm'. */
  size?: 'xs' | 'sm' | 'md';
  /** Extra className. */
  className?: string;
}

const SIZE_CLASS = {
  xs: 'text-[10px] gap-0.5',
  sm: 'text-xs gap-1',
  md: 'text-sm gap-1.5',
} as const;

export function TrendIndicator({
  value,
  format = 'percent',
  digits = 2,
  showArrow = true,
  showSign = true,
  size = 'sm',
  className,
}: TrendIndicatorProps) {
  // Null/undefined/NaN → dash
  if (value === null || value === undefined || Number.isNaN(value)) {
    return (
      <span className={cn('inline-flex items-center text-muted-foreground tabular-nums', SIZE_CLASS[size], className)} dir="ltr">
        —
      </span>
    );
  }

  // Zero → flat/muted
  if (value === 0) {
    return (
      <span className={cn('inline-flex items-center text-muted-foreground tabular-nums', SIZE_CLASS[size], className)} dir="ltr">
        {showArrow && <span>▬</span>}
        <span>0{format === 'percent' ? '.00%' : '.0'}</span>
      </span>
    );
  }

  const isPositive = value > 0;
  const decimals = digits;
  const absValue = Math.abs(value).toFixed(decimals);
  const sign = isPositive ? (showSign ? '+' : '') : '-';
  const suffix = format === 'percent' ? '%' : '';
  const colorClass = isPositive ? 'text-profit' : 'text-loss';

  return (
    <span
      className={cn('inline-flex items-center tabular-nums font-medium', SIZE_CLASS[size], colorClass, className)}
      dir="ltr"
    >
      {showArrow && (
        <span>{isPositive ? '▲' : '▼'}</span>
      )}
      <span>{sign}{absValue}{suffix}</span>
    </span>
  );
}

export default TrendIndicator;
