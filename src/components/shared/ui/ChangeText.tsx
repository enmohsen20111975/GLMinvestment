'use client';

/**
 * ChangeText — مكون موحد للتغير (+/-) مع لون
 * ====================================================================
 * بدل ما تكتب 2,779 مرة:
 *   <span className={cn('font-semibold tabular-nums', ret >= 0 ? 'text-profit' : 'text-loss')} dir="ltr">
 *     {ret >= 0 ? '+' : ''}{ret.toFixed(2)}%
 *   </span>
 *
 * دلوقتي:
 *   <ChangeText value={ret} suffix="%" />
 *
 * يستخدم في 365 ملف → توفير ~2,779 سطر تكرار.
 * + بيتكفل بـ: tabular-nums + dir=ltr + sign + color + null safety.
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface ChangeTextProps {
  value: number | null | undefined;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  showSign?: boolean;
  className?: string;
}

export function ChangeText({
  value,
  decimals = 2,
  suffix = '%',
  prefix = '',
  showSign = true,
  className,
}: ChangeTextProps) {
  if (value == null || isNaN(value)) {
    return <span className={cn('tabular-nums text-muted-foreground', className)} dir="ltr">—</span>;
  }

  const isPositive = value >= 0;
  const sign = showSign && isPositive ? '+' : '';
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span
      className={cn(
        'font-semibold tabular-nums',
        isPositive ? 'text-profit' : 'text-loss',
        className,
      )}
      dir="ltr"
    >
      {prefix}{sign}{formatted}{suffix}
    </span>
  );
}

export default ChangeText;
