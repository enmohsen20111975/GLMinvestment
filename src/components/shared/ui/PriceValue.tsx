'use client';

/**
 * PriceValue — مكون موحد لعرض السعر + العملة
 * ====================================================================
 * بدل ما تكتب 308 مرة:
 *   <span className="font-bold tabular-nums" dir="ltr">
 *     {value.toFixed(2)} ج.م
 *   </span>
 *
 * دلوقتي:
 *   <PriceValue value={price} currency="EGP" />
 *
 * يستخدم في 96 ملف → توفير ~308 سطر تكرار.
 * + بيتكفل بـ: tabular-nums + dir=ltr + currency suffix + null safety.
 */

import React from 'react';
import { cn } from '@/lib/utils';

const CURRENCY_SUFFIX: Record<string, string> = {
  EGP: 'ج.م',
  SAR: 'ر.س',
  KWD: 'د.ك',
  QAR: 'ر.ق',
  USD: '$',
  USDT: '$',
};

export interface PriceValueProps {
  value: number | null | undefined;
  currency?: string;
  decimals?: number;
  bold?: boolean;
  className?: string;
}

export function PriceValue({
  value,
  currency = 'EGP',
  decimals = 2,
  bold = true,
  className,
}: PriceValueProps) {
  if (value == null || isNaN(value)) {
    return <span className={cn('tabular-nums text-muted-foreground', className)} dir="ltr">—</span>;
  }

  const suffix = CURRENCY_SUFFIX[currency] || '';
  const isPrefix = currency === 'USD' || currency === 'USDT';
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });

  return (
    <span
      className={cn('tabular-nums', bold && 'font-bold', className)}
      dir="ltr"
    >
      {isPrefix ? `${suffix}${formatted}` : `${formatted} ${suffix}`}
    </span>
  );
}

export default PriceValue;
