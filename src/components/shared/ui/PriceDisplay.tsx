'use client';

/**
 * PriceDisplay — BLUEPRINT-UNIFIED-SCREENS (Phase 1, Component 1/8)
 * ====================================================================
 * يعرض السعر بدقة متناهية، ونسبة التغير ملونة مع سهم صعود/هبوط،
 * بدون أي وميض أو تكسير تخطيط.
 *
 * Rule 20: مفيش logic حسابي في client — التغيير بيتحسب من change% اللي بيوصل جاهز.
 * Rule 27: مفيش أرقام وهمية — لو price = null → "—".
 * Rule 30: Emerald + Amber + Cyan (ممنوع أزرق/indigo).
 *
 * Design tokens: text-profit / text-loss (semantic tokens من BLUEPRINT).
 */
import React from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface PriceDisplayProps {
 /** السعر اللحظي (لو null/undefined → عرض "—"). */
 price: number | null | undefined;
 /** نسبة التغير (مثلاً +2.5 أو -1.3). لو null → ملوش سهم. */
 change?: number | null;
 /** العملة (EGP, USD, SAR). default: EGP. */
 currency?: string;
 /** حجم العرض. */
 size?: 'sm' | 'md' | 'lg';
 /** عرض العملة بجانب السعر (default: true). */
 showCurrency?: boolean;
 /** عرض سهم الاتجاه (default: true). */
 showArrow?: boolean;
 /** محاذاة (default: inline). */
 align?: 'inline' | 'start' | 'end';
 className?: string;
}

const SIZE_MAP = {
 sm: { price: 'text-sm font-bold', change: 'text-xs font-semibold' },
 md: { price: 'text-base font-bold', change: 'text-sm font-semibold' },
 lg: { price: 'text-xl font-extrabold', change: 'text-sm font-semibold' },
} as const;

/** خريطة العملات للرموز العربية/اللاتينية. */
const CURRENCY_SYMBOL: Record<string, string> = {
 EGP: 'ج.م',
 USD: '$',
 SAR: 'ر.س',
 AED: 'د.إ',
 KWD: 'د.ك',
 QAR: 'ر.ق',
};

export function PriceDisplay({
 price,
 change,
 currency = 'EGP',
 size = 'md',
 showCurrency = true,
 showArrow = true,
 align = 'inline',
 className,
}: PriceDisplayProps) {
 const sizes = SIZE_MAP[size];
 const hasPrice = typeof price === 'number' && Number.isFinite(price);
 const hasChange = typeof change === 'number' && Number.isFinite(change);
 const isUp = hasChange && change > 0;
 const isDown = hasChange && change < 0;
 const isFlat = hasChange && change === 0;

 const changeColor = isUp
 ? 'text-profit'
 : isDown
 ? 'text-loss'
 : 'text-muted-foreground';

 const ArrowIcon = isUp ? TrendingUp : isDown ? TrendingDown : Minus;
 const symbol = CURRENCY_SYMBOL[currency] || currency;

 return (
 <span
 className={cn(
 'inline-flex items-baseline gap-1.5 tabular-nums',
 align === 'start' && 'justify-start',
 align === 'end' && 'justify-end',
 className
 )}
 dir="rtl"
 >
 {/* السعر + العملة */}
 <span className={cn(sizes.price, 'text-foreground')}>
 {hasPrice ? price!.toLocaleString('en-US', {
 minimumFractionDigits: 2,
 maximumFractionDigits: 2,
 }) : '—'}
 </span>
 {showCurrency && hasPrice && (
 <span className="text-xs font-medium text-muted-foreground">{symbol}</span>
 )}

 {/* نسبة التغير + السهم */}
 {hasChange && (
 <span
 className={cn(
 'inline-flex items-center gap-0.5',
 sizes.change,
 changeColor
 )}
 >
 {showArrow && <ArrowIcon className="size-3.5" />}
 <span>
 {change > 0 ? '+' : ''}
 {change!.toFixed(2)}%
 </span>
 </span>
 )}
 </span>
 );
}
