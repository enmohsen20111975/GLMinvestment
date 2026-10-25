/**
 * executive-report/constants.ts
 * ============================
 * Static configuration + UI option arrays + accent color maps for the
 * ExecutiveReportView family.
 *
 * Extracted from the original `ExecutiveReportView.tsx` (2,087 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 *
 * Nothing here is computed at runtime — pure data, safe to share across the
 * container + every sub-component.
 */

import type {
  FilterOutcome,
  FilterPersona,
  FilterSignal,
  QualityMode,
  ReportTimeframe,
} from './types';

export const TIMEFRAME_OPTIONS: Array<{ value: ReportTimeframe; label: string; badge: string }> = [
  { value: 1, label: 'اليوم', badge: '1d' },
  { value: 2, label: 'أمس', badge: '2d' },
  { value: 7, label: '7 أيام', badge: '7d' },
  { value: 14, label: '14 يوم', badge: '14d' },
  { value: 30, label: '30 يوم', badge: '30d' },
  { value: 60, label: '60 يوم', badge: '60d' },
  { value: 90, label: '0.25 سنة (ربع سنوي)', badge: '0.25y' },
  { value: 180, label: '0.5 سنة (نصف سنوي)', badge: '0.5y' },
  // RL-FIX-7: YTD — من أول السنة (1 يناير للسنة الحالية)
  { value: 999, label: 'من أول السنة', badge: 'YTD' },
  { value: 365, label: 'سنة كاملة (1y)', badge: '1y' },
  { value: 0, label: 'كافة الأوقات', badge: 'All' },
];

// RL-FIX-7: خيارات فلتر الشخصية
export const PERSONA_FILTER_OPTIONS: Array<{ value: FilterPersona; label: string; emoji?: string }> = [
  { value: 'all', label: 'الكل' },
  // { value: 'gambler', label: 'المضارب', emoji: '🔥' }, // معطل
  { value: 'balanced', label: 'المتوازن', emoji: '⚖️' },
  { value: 'conservative', label: 'المستثمر', emoji: '🛡️' },
];

// RL-FIX-7: خيارات فلتر النتيجة
export const OUTCOME_FILTER_OPTIONS: Array<{ value: FilterOutcome; label: string; color: string }> = [
  { value: 'ALL', label: 'الكل', color: 'text-foreground' },
  { value: 'WIN', label: 'رابحة', color: 'text-profit' },
  { value: 'LOSS', label: 'خاسرة', color: 'text-loss' },
  { value: 'PENDING', label: 'معلقة', color: 'text-warning' },
  { value: 'EXPIRED', label: 'منتهية', color: 'text-muted-foreground' },
];

// RL-FIX-7: خيارات فلتر الإشارة
export const SIGNAL_FILTER_OPTIONS: Array<{ value: FilterSignal; label: string }> = [
  { value: 'all', label: 'كل الإشارات' },
  { value: 'BUY', label: 'شراء' },
  { value: 'SELL', label: 'بيع' },
];

// RL-FIX-10: وضع الجودة
export const QUALITY_MODE_OPTIONS: Array<{
  value: QualityMode;
  label: string;
  desc: string;
  emoji: string;
}> = [
  { value: 'top_picks', label: 'أفضل التوقعات', desc: 'أقصى 5 توقعات/يوم لكل شخصية', emoji: '⭐' },
  { value: 'all', label: 'كل التوقعات', desc: 'بدون فلترة (للتحليل الشامل)', emoji: '📊' },
];

// RL-FIX-10: خيارات الحد الأدنى للثقة (master_score)
export const CONFIDENCE_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 50, label: '50+ (متوسط)' },
  { value: 60, label: '60+ (جيد)' },
  { value: 70, label: '70+ (قوي)' },
  { value: 80, label: '80+ (قوي جداً)' },
];

// ── Accent color maps for the KPI / MissedOpp cards ──

export const KPI_ACCENTS: Record<string, { ring: string; bar: string; value: string; glow: string }> = {
  emerald: { ring: 'border-profit/20', bar: 'bg-profit', value: 'text-profit', glow: 'bg-profit/10' },
  amber: { ring: 'border-warning/20', bar: 'bg-warning', value: 'text-warning', glow: 'bg-warning/10' },
  rose: { ring: 'border-loss/20', bar: 'bg-loss', value: 'text-loss', glow: 'bg-loss/10' },
};

export const MISSED_OPP_ACCENTS: Record<string, { ring: string; bar: string; value: string }> = {
  amber: { ring: 'border-warning/20', bar: 'bg-warning', value: 'text-warning' },
  rose: { ring: 'border-loss/20', bar: 'bg-loss', value: 'text-loss' },
  emerald: { ring: 'border-profit/20', bar: 'bg-profit', value: 'text-profit' },
  teal: { ring: 'border-whale/20', bar: 'bg-whale', value: 'text-whale' },
};

// RL-FIX-10: default confidence threshold (top_picks mode default)
export const DEFAULT_MIN_CONFIDENCE = 70;
