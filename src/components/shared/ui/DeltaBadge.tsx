'use client';

/**
 * DeltaBadge — BLUEPRINT Phase 5 (Live Screens)
 * ====================================================================
 * بادج بـ يعرض التغير في القيمة (+/-) مع لون + سهم.
 * بتـستخدم design tokens (profit/loss) — ممنوع direct palette.
 *
 * Rule 20: مفيش logic حسابي — الـ delta بيوصل جاهز.
 * Rule 27: مفيش أرقام وهمية.
 *
 * Usage:
 * <DeltaBadge delta={2.5} format="percent" /> → +2.50% (green ▲)
 * <DeltaBadge delta={-1.3} format="value" /> → -1.30 (red ▼)
 */
import React, { memo } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface DeltaBadgeProps {
 /** الفرق (current - previous). */
 delta: number | null | undefined;
 /** 'percent' (يضيف %) | 'value' (رقم صرف) | 'flow' (M/K format). */
 format?: 'percent' | 'value' | 'flow';
 /** حجم البادج. */
 size?: 'sm' | 'md';
 className?: string;
}

function formatDelta(delta: number, format: DeltaBadgeProps['format']): string {
 const sign = delta > 0 ? '+' : '';
 if (format === 'percent') return `${sign}${delta.toFixed(2)}%`;
 if (format === 'flow') {
 const abs = Math.abs(delta);
 if (abs >= 1_000_000) return `${sign}${(delta / 1_000_000).toFixed(1)}M`;
 if (abs >= 1_000) return `${sign}${(delta / 1_000).toFixed(1)}K`;
 return `${sign}${delta.toFixed(0)}`;
 }
 return `${sign}${delta.toFixed(2)}`;
}

export const DeltaBadge = memo(function DeltaBadge({
 delta,
 format = 'percent',
 size = 'sm',
 className,
}: DeltaBadgeProps) {
 if (delta == null || !Number.isFinite(delta) || delta === 0) {
 return null; // مفيش تغير → مفيش بادج
 }

 const isUp = delta > 0;
 const Icon = isUp ? TrendingUp : TrendingDown;
 const text = formatDelta(delta, format);

 const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5 gap-0.5' : 'text-xs px-2 py-1 gap-1';

 return (
 <span
 className={cn(
 'inline-flex items-center rounded-full font-bold tabular-nums',
 sizeClass,
 isUp ? 'bg-profit/10 text-profit' : 'bg-loss/10 text-loss',
 className
 )}
 dir="rtl"
 >
 <Icon className={size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'} />
 <span>{text}</span>
 </span>
 );
});
