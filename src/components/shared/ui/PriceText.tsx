'use client';

/**
 * PriceText — P0-COMPONENT-UNIFICATION (Phase 1.7)
 * ====================================================================
 * نص سعر بـ صيغة موحّدة — بيـستورد canonical `formatPrice` من `lib/format.ts`.
 * ----------------------------------------------------------------------------
 * قبل كده: كان فيه 286+ inline `.toFixed()` calls + 19+ re-declared
 * `fmtPrice`/`formatPrice` helpers. الـ PriceText بـ يـدمج كل ده.
 *
 * بيـستورد canonical formatter من `lib/format.ts` (موجود أصلاً بس 0 imports!).
 * الـ canonical formatPrice(n, market) بيرجّع السعر + العملة بـ صيغة صح:
 *   - EGX: "125.50 ج.م"
 *   - TADAWUL: "125.50 ر.س"
 *   - KSE: "125.50 د.ك"
 *   - QSE: "125.50 ر.ق"
 *   - CRYPTO: "$125.50"
 *
 * Note: PriceDisplay.tsx موجود كـ component أوسع (price + change + arrow).
 * PriceText ده أبسط — بس price + currency بـ canonical formatter.
 * ====================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { formatPrice } from '@/lib/format';

/**
 * Supported markets for price formatting. Matches the union in lib/format.ts
 * (the canonical formatter). We use the string union directly instead of
 * importing MarketType from lib/store.ts because formatPrice expects
 * this specific union, and not all MarketType values may be supported.
 */
type PriceMarket = 'EGX' | 'CRYPTO' | 'TADAWUL' | 'KSE' | 'QSE';

export interface PriceTextProps {
  /** السعر. لو null/undefined/NaN → بـ يعرض "—". */
  value: number | null | undefined;
  /** السوق — بـ يحدد العملة. default: 'EGX'. */
  market?: PriceMarket;
  /** حجم النص. default: 'md'. */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /** font weight. default: 'normal'. */
  weight?: 'normal' | 'medium' | 'semibold' | 'bold';
  /** لون النص. default: 'default'. */
  tone?: 'default' | 'profit' | 'loss' | 'muted';
  className?: string;
}

const SIZE_CLASS = {
  xs: 'text-xs',
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-xl',
} as const;

const WEIGHT_CLASS = {
  normal: 'font-normal',
  medium: 'font-medium',
  semibold: 'font-semibold',
  bold: 'font-bold',
} as const;

const TONE_CLASS = {
  default: 'text-foreground',
  profit: 'text-profit',
  loss: 'text-loss',
  muted: 'text-muted-foreground',
} as const;

/**
 * @example
 * <PriceText value={125.5} />                     // → "125.50 ج.م"
 * <PriceText value={125.5} market="TADAWUL" />     // → "125.50 ر.س"
 * <PriceText value={0.0001234} market="CRYPTO" /> // → "$0.000123"
 * <PriceText value={null} />                       // → "—"
 * <PriceText value={125.5} size="xl" weight="bold" />
 * <PriceText value={125.5} tone="profit" />
 */
export function PriceText({
  value,
  market = 'EGX',
  size = 'md',
  weight = 'normal',
  tone = 'default',
  className,
}: PriceTextProps) {
  const formatted = formatPrice(value, market);

  return (
    <span
      className={cn(
        SIZE_CLASS[size],
        WEIGHT_CLASS[weight],
        TONE_CLASS[tone],
        'tabular-nums',
        className
      )}
      dir="rtl"
    >
      {formatted}
    </span>
  );
}

export default PriceText;
