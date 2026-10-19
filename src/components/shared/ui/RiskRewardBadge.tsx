'use client';

/**
 * RiskRewardBadge — BLUEPRINT-UNIFIED-SCREENS (Phase 1, Component 3/8)
 * ====================================================================
 * يعرض نسبة العائد للمخاطرة (R/R) بصيغة "2.4:1".
 *
 * دستوريًا (Rule 18): لو R/R < 1.8 → يظهر بلون أحمر تحذيري.
 * لو R/R >= 1.8 → يظهر بلون أخضر (مطابق لمعايير الجودة).
 *
 * Rule 20: مفيش حسابي — الـ ratio بيوصل جاهز من الباك إند.
 * Rule 27: مفيش أرقام وهمية.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export interface RiskRewardBadgeProps {
 /** نسبة R/R (مثلاً 2.4 يعني 2.4:1). لو null/undefined → "—". */
 rr?: number | null;
 /** الحد الأدنى الدستوري (default: 1.8 per Rule 18). */
 floor?: number;
 size?: 'sm' | 'md' | 'lg';
 className?: string;
}

const SIZE_CLASS = {
 sm: 'text-xs px-2 py-0.5 gap-1',
 md: 'text-xs px-2.5 py-1 gap-1.5',
 lg: 'text-sm px-3 py-1.5 gap-1.5',
} as const;

export function RiskRewardBadge({
 rr,
 floor = 1.8,
 size = 'md',
 className,
}: RiskRewardBadgeProps) {
 const hasValue = typeof rr === 'number' && Number.isFinite(rr) && rr > 0;
 const isCompliant = hasValue && rr! >= floor;

 const toneClass = !hasValue
 ? 'bg-muted text-muted-foreground'
 : isCompliant
 ? 'bg-profit/10 text-profit'
 : 'bg-loss/10 text-loss';

 const Icon = !hasValue ? null : isCompliant ? CheckCircle2 : AlertTriangle;

 return (
 <span
 className={cn(
 'inline-flex items-center rounded-full font-semibold tabular-nums',
 SIZE_CLASS[size],
 toneClass,
 className
 )}
 dir="rtl"
 title={isCompliant ? 'مطابق لمعايير الجودة' : `تحت الحد الأدنى (${floor}:1)`}
 >
 {Icon && <Icon className="size-3.5" />}
 <span>
 {hasValue ? `${rr!.toFixed(1)}:1` : '—'}
 </span>
 </span>
 );
}
