'use client';

/**
 * NumText — مكون موحد للأرقام في واجهة RTL
 * ====================================================================
 * بدل ما تكتب 421 مرة:
 *   <span className="tabular-nums" dir="ltr">{value.toFixed(2)}</span>
 *
 * دلوقتي:
 *   <NumText value={value} decimals={2} />
 *
 * يستخدم في 94 ملف → توفير ~421 سطر تكرار.
 * + بيتكفل بـ tabular-nums + dir=ltr + null safety.
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface NumTextProps {
  value: number | null | undefined;
  decimals?: number;
  suffix?: string;
  prefix?: string;
  colorize?: boolean; // أخضر لو موجب، أحمر لو سالب
  className?: string;
}

export function NumText({
  value,
  decimals = 2,
  suffix,
  prefix,
  colorize = false,
  className,
}: NumTextProps) {
  if (value == null || isNaN(value)) {
    return <span className={cn('tabular-nums text-muted-foreground', className)} dir="ltr">—</span>;
  }

  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  const colorClass = colorize
    ? value >= 0
      ? 'text-profit'
      : 'text-loss'
    : '';

  return (
    <span
      className={cn('tabular-nums font-semibold', colorClass, className)}
      dir="ltr"
    >
      {prefix}{formatted}{suffix}
    </span>
  );
}

export default NumText;
