'use client';

/**
 * ChangePill — P0-COMPONENT-UNIFICATION (Phase 1.7)
 * ====================================================================
 * بادج بـ يعرض تغير (+/-) مع لون + سهم.
 * ----------------------------------------------------------------------------
 * قبل كده: كان فيه pattern متكرر في كل مكان:
 *   <span className={cn('inline-flex items-center gap-1',
 *     ret >= 0 ? 'text-success' : 'text-loss')}>
 *     {ret >= 0 ? '+' : ''}{Number(ret).toFixed(1)}%
 *   </span>
 *
 * ده pattern متكرر في 286+ inline `.toFixed()` calls. الـ ChangePill بـ يـدمجه.
 * بـ يستخدم design tokens (text-profit / text-loss) — ممنوع direct palette.
 *
 * Note: DeltaBadge.tsx موجود للـ delta specifically (مع pill shape). ده
 * ChangePill محايد — inline text بـ سهم بس. ممكن نـدمجهم بعدين.
 * ====================================================================
 */

import React from 'react';
import { ArrowUp, ArrowDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface ChangePillProps {
  /** القيمة العددية (مـمكن سالبة أو موجبة). */
  value: number | null | undefined;
  /** الصيغة: 'percent' (إضافة %) أو 'value' (بدون). default: percent. */
  format?: 'percent' | 'value';
  /** عدد الـ decimal places. default: 2 (percent) / 1 (value). */
  digits?: number;
  /** حجم البادج. default: 'sm'. */
  size?: 'xs' | 'sm' | 'md';
  /** Show the arrow icon. default: true. */
  showIcon?: boolean;
  /** عرض علامة + لـ القيم الموجبة. default: true. */
  showSign?: boolean;
  className?: string;
}

const SIZE_CLASS = {
  xs: 'text-[10px] gap-0.5',
  sm: 'text-xs gap-1',
  md: 'text-sm gap-1.5',
} as const;

/**
 * @example
 * <ChangePill value={2.5} format="percent" />   // → ▲ +2.50% (green)
 * <ChangePill value={-1.3} format="value" />    // → ▼ -1.30 (red)
 * <ChangePill value={0} />                       // → - 0.00% (muted)
 * <ChangePill value={null} />                    // → —
 */
export function ChangePill({
  value,
  format = 'percent',
  digits,
  showIcon = true,
  showSign = true,
  size = 'sm',
  className,
}: ChangePillProps) {
  // null/undefined → "—"
  if (value === null || value === undefined || Number.isNaN(value)) {
    return (
      <span className={cn('inline-flex items-center text-muted-foreground', SIZE_CLASS[size], className)} dir="rtl">
        —
      </span>
    );
  }

  // Zero → muted
  if (value === 0) {
    return (
      <span className={cn('inline-flex items-center text-muted-foreground tabular-nums', SIZE_CLASS[size], className)} dir="rtl">
        {showIcon && <Minus className="h-3 w-3" aria-hidden />}
        <span>0{format === 'percent' ? '.00%' : '.0'}</span>
      </span>
    );
  }

  const isPositive = value > 0;
  const decimals = digits ?? (format === 'percent' ? 2 : 1);
  const formattedValue = Math.abs(value).toFixed(decimals);
  const sign = isPositive ? (showSign ? '+' : '') : '-';
  const suffix = format === 'percent' ? '%' : '';

  return (
    <span
      className={cn(
        'inline-flex items-center tabular-nums font-medium',
        SIZE_CLASS[size],
        isPositive ? 'text-profit' : 'text-loss',
        className
      )}
      dir="rtl"
    >
      {showIcon && (
        isPositive
          ? <ArrowUp className="h-3 w-3" aria-hidden />
          : <ArrowDown className="h-3 w-3" aria-hidden />
      )}
      <span>{sign}{formattedValue}{suffix}</span>
    </span>
  );
}

export default ChangePill;
