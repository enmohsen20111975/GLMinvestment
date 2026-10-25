'use client';

/**
 * FlowPhaseTag — BLUEPRINT-UNIFIED-SCREENS (Phase 1, Component 4/8)
 * ====================================================================
 * يحول أكواد الباك إند المعقدة (زي `B_quiet_accumulation_strong`) إلى
 * لغة بورصة عربية أنيقة.
 *
 * مثال:
 * B_quiet_accumulation_strong → "تجميع هادئ مؤسسي" (whale tone)
 * whale_inflow → "تدفق سيولة ذكية" (profit tone)
 * distribution → "تصريف وحذر" (loss tone)
 *
 * Rule 27: مفيش أرقام وهمية.
 * Rule 30: Emerald + Amber + Cyan (ممنوع أزرق).
 */
import React from 'react';
import { cn } from '@/lib/utils';

export interface FlowPhaseTagProps {
 /** كود المرحلة من الباك إند. */
 phase?: string | null;
 size?: 'sm' | 'md' | 'lg';
 className?: string;
}

/** خريطة أكواد المراحل → عناوين عربية أنيقة + tone. */
const PHASE_MAP: Record<string, { label: string; tone: 'whale' | 'profit' | 'loss' | 'warning' | 'muted' }> = {
 // Accumulation — تجميع (whale/profit tones)
 'b_quiet_accumulation_strong': { label: 'تجميع هادئ مؤسسي', tone: 'whale' },
 'b_quiet_accumulation': { label: 'تجميع هادئ', tone: 'whale' },
 'quiet_accumulation': { label: 'تجميع هادئ', tone: 'whale' },
 'accumulation': { label: 'تجميع', tone: 'profit' },
 'accumulation_strong': { label: 'تجميع قوي', tone: 'profit' },
 // Whale inflow — تدفق سيولة ذكية (profit tone)
 'whale_inflow': { label: 'تدفق سيولة ذكية', tone: 'profit' },
 'whale_inflow_strong': { label: 'تدفق سيولة ذكية قوي', tone: 'profit' },
 'smart_inflow': { label: 'تدفق ذكي', tone: 'profit' },
 // Distribution — تصريف (loss tone)
 'distribution': { label: 'تصريف وحذر', tone: 'loss' },
 'distribution_strong': { label: 'تصريف قوي', tone: 'loss' },
 'smart_distribution': { label: 'تصريف ذكي', tone: 'loss' },
 // Absorption — امتصاص (whale tone)
 'absorption': { label: 'امتصاص عروض بيعية', tone: 'whale' },
 'absorption_strong': { label: 'امتصاص قوي', tone: 'whale' },
 // Mixed / neutral
 'neutral': { label: 'محايد', tone: 'muted' },
 'mixed': { label: 'مختلط', tone: 'warning' },
 'churning': { label: 'دوران سيولة', tone: 'warning' },
 // Canonical Stock States (Phase 5 — unified taxonomy)
 'ACCUMULATION': { label: 'تجميع محتمل', tone: 'whale' },
 'UPTREND': { label: 'اتجاه صاعد', tone: 'profit' },
 'CORRECTION_HEALTHY': { label: 'تصحيح صحي', tone: 'warning' },
 'DISTRIBUTION': { label: 'توزيع محتمل', tone: 'loss' },
 'DOWNTREND': { label: 'اتجاه هابط', tone: 'loss' },
 'RECOVERY': { label: 'تعافٍ محتمل', tone: 'profit' },
 'STATE_UNCONFIRMED': { label: 'حالة غير محسومة', tone: 'muted' },
 'DATA_STALE': { label: 'بيانات قديمة', tone: 'muted' },
 'DATA_INCOMPLETE': { label: 'بيانات ناقصة', tone: 'muted' },
 // Legacy maker_radar paths (A/B/C/D/E)
 'A_pre_surge': { label: 'ما قبل القفزة', tone: 'whale' },
 'B_quiet_accumulation_strong': { label: 'تجميع هادئ قوي', tone: 'whale' },
 'C_quiet_accumulation_weak': { label: 'تجميع هادئ ضعيف', tone: 'whale' },
 'D_explosive_surge': { label: 'انفجار سيولي', tone: 'profit' },
 'E_early_break': { label: 'اختراق مبكر', tone: 'profit' },
 // entry_gate phases
 'DOWNTREND': { label: 'اتجاه هابط', tone: 'loss' },
 'PULLBACK': { label: 'ارتداد', tone: 'warning' },
 'UPTREND': { label: 'اتجاه صاعد', tone: 'profit' },
 'BULLISH_RECOVERY': { label: 'تعافٍ صعودي', tone: 'profit' },
 'TRANSITIONAL': { label: 'انتقالي', tone: 'muted' },
};

const TONE_CLASS: Record<string, string> = {
 whale: 'bg-whale/10 text-whale',
 profit: 'bg-profit/10 text-profit',
 loss: 'bg-loss/10 text-loss',
 warning: 'bg-warning/15 text-warning',
 muted: 'bg-muted text-muted-foreground',
};

const SIZE_CLASS = {
 sm: 'text-xs px-2 py-0.5 gap-1',
 md: 'text-xs px-2.5 py-1 gap-1',
 lg: 'text-sm px-3 py-1.5 gap-1.5',
} as const;

export function FlowPhaseTag({ phase, size = 'md', className }: FlowPhaseTagProps) {
 if (!phase) {
 return (
 <span
 className={cn(
 'inline-flex items-center rounded-full font-semibold',
 SIZE_CLASS[size],
 TONE_CLASS.muted,
 className
 )}
 dir="rtl"
 >
 —
 </span>
 );
 }

 // normalize: lowercase + replace spaces/dashes with underscores
 const key = String(phase).toLowerCase().trim().replace(/[\s-]+/g, '_');
 const info = PHASE_MAP[key];

 if (!info) {
 // unknown phase — show raw code with muted tone (not a crash, graceful)
 return (
 <span
 className={cn(
 'inline-flex items-center rounded-full font-semibold',
 SIZE_CLASS[size],
 TONE_CLASS.muted,
 className
 )}
 dir="rtl"
 title={`كود غير معروف: ${phase}`}
 >
 {phase}
 </span>
 );
 }

 return (
 <span
 className={cn(
 'inline-flex items-center rounded-full font-semibold',
 SIZE_CLASS[size],
 TONE_CLASS[info.tone],
 className
 )}
 dir="rtl"
 >
 {info.label}
 </span>
 );
}
