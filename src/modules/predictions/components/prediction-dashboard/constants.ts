/**
 * prediction-dashboard/constants.ts
 * =================================
 * Config + UI theme constants for PredictionTrackingDashboard.
 *
 * Originally inlined at lines 161-366 of PredictionTrackingDashboard.tsx
 * (~205 LOC). Pure data module — no React, no JSX, no runtime side-effects.
 *
 * Contents:
 *  - PERSONA_CONFIG     — per-persona (gambler/balanced/conservative) emoji +
 *    Arabic label + horizon + tailwind colors. icon field is `typeof Flame`
 *    (a lucide-react type reference) so this file can stay `.ts`.
 *  - OUTCOME_CONFIG     — per-outcome (WIN/LOSS/EXPIRED/PENDING) label +
 *    badge classes + accent color + icon type reference.
 *  - TRAILING_PROFIT_CONFIG — "💰 خرج بربح" badge metadata (FIX-5B).
 *  - LIVE_OUTCOME_CONFIG — dashed-border "معاينة" badge metadata (RL-FIX-6).
 *  - DAYS_OPTIONS       — timeframe selector pills.
 *  - QUALITY_MODE_OPTIONS — top_picks vs all (RL-FIX-13).
 *  - CONFIDENCE_OPTIONS — confidence threshold selector (50/60/70/80).
 */

import { Clock, Clock3, Flame, Scale, Shield, TrendingDown, Trophy } from 'lucide-react';
import type { DaysWindow, OutcomeKey, PersonaKey, QualityMode } from './types';

export const PERSONA_CONFIG: Record<PersonaKey, {
 id: PersonaKey;
 emoji: string;
 nameAr: string;
 horizonAr: string;
 color: string;
 badgeBg: string;
 border: string;
 glow: string;
 icon: typeof Flame;
}> = {
 gambler: {
 id: 'gambler',
 emoji: '🔥',
 nameAr: 'المضارب', // UNIFIED-BALANCED-ONLY: معطل
 horizonAr: 'صفقات خاطفة (1-5 أيام)',
 color: 'text-warning ',
 badgeBg: 'bg-warning/10 text-warning border-orange-500/20',
 border: 'border-orange-500/30 hover:border-orange-500/60',
 glow: 'shadow-orange-500/10',
 icon: Flame,
 },
 balanced: {
 id: 'balanced',
 emoji: '⚖️',
 nameAr: 'المتوازن',
 horizonAr: 'صفقات متوسطة (2-6 أسابيع)',
 color: 'text-whale ',
 badgeBg: 'bg-whale/10 text-whale border-whale/20',
 border: 'border-whale/20 hover:border-whale/20',
 glow: 'shadow-teal-500/10',
 icon: Scale,
 },
 conservative: {
 id: 'conservative',
 emoji: '🛡️',
 nameAr: 'المستثمر',
 horizonAr: 'صفقات استثمارية (6-12 شهر)',
 color: 'text-profit ',
 badgeBg: 'bg-profit/10 text-profit border-profit/20',
 border: 'border-profit/20 hover:border-profit/20',
 glow: 'shadow-emerald-500/10',
 icon: Shield,
 },
};

export const OUTCOME_CONFIG: Record<OutcomeKey, {
 label: string;
 badge: string;
 icon: typeof Trophy;
 accentColor: string;
}> = {
 WIN: {
 label: 'هدف محقق 🎯',
 badge: 'bg-profit/15 text-profit border-profit/20',
 icon: Trophy,
 accentColor: 'text-profit',
 },
 LOSS: {
 label: 'وقف خسارة 🛑',
 badge: 'bg-loss/15 text-loss border-loss/20',
 icon: TrendingDown,
 accentColor: 'text-loss',
 },
 EXPIRED: {
 label: 'انتهى الأفق الزمني ⏰', // UNIFY-FIX v2: أوضح من "منتهية"
 badge: 'bg-muted text-muted-foreground border-border',
 icon: Clock,
 accentColor: 'text-muted-foreground',
 },
 PENDING: {
 label: 'جاري التداول ⏳',
 badge: 'bg-warning/15 text-warning border-warning/20',
 icon: Clock3,
 accentColor: 'text-warning',
 },
};

// FIX-5B: TRAILING_PROFIT badge — "💰 خرج بربح" بـ لون زمردي مميز عن WIN العادي.
// ده بيـ trigger لما exit_type === 'trailing_profit' (السهم وصل لـ ربح جزئي ثم
// ارتد فـ exit قبل الهدف الكامل — جني أرباح). الـ outcome الرسمي بـ يفضل WIN
// لكن الـ badge بـ يـ differentiعلشان المالك يفرّق بين "هدف محقق" و"جني أرباح".
export const TRAILING_PROFIT_CONFIG = {
 label: 'خرج بربح 💰',
 badge: 'bg-whale/20 text-whale border-whale/20 font-bold',
 accentColor: 'text-whale ',
};

// RL-FIX-6: LIVE outcome preview badges — visually distinct from official OUTCOME_CONFIG
// (dashed border + "معاينة" tag) so users see live price-action state of pending trades.
export const LIVE_OUTCOME_CONFIG: Record<'WIN' | 'LOSS' | 'PENDING', { label: string; badge: string }> = {
 WIN: {
 label: 'ربح متوقع (معاينة)',
 badge: 'bg-profit/10 text-profit border border-dashed border-profit/20',
 },
 LOSS: {
 label: 'خسارة متوقعة (معاينة)',
 badge: 'bg-loss/10 text-loss border border-dashed border-loss/20',
 },
 PENDING: {
 label: 'بانتظار الهدف',
 badge: 'bg-warning/10 text-warning border border-dashed border-warning/20',
 },
};

export const DAYS_OPTIONS: Array<{ value: DaysWindow; label: string }> = [
 { value: 1, label: 'اليوم' },
 { value: 2, label: 'أمس' },
 { value: 7, label: '7 أيام' },
 { value: 14, label: '14 يوم' },
 { value: 30, label: '30 يوم' },
 { value: 60, label: '60 يوم' },
 { value: 90, label: '0.25 سنة (90d)' },
 { value: 180, label: '0.5 سنة (6m)' },
 // RL-FIX-7: YTD — من أول السنة (1 يناير للسنة الحالية)
 { value: 999, label: 'من أول السنة (YTD)' },
 { value: 365, label: 'سنة كاملة (1y)' },
 { value: 0, label: 'كل الأوقات' },
];

// RL-FIX-13: Quality filter — نفس مفهوم ExecutiveReportView
// يفلتر التوقعات الضعيفة من كل الإحصائيات (KPI cards + persona cards + chart + table)
export const QUALITY_MODE_OPTIONS: Array<{ value: QualityMode; label: string; desc: string; emoji: string }> = [
 { value: 'top_picks', label: 'أفضل التوقعات', desc: 'أقصى 5 توقعات/يوم لكل شخصية (الثقة ≥ الحد)', emoji: '⭐' },
 { value: 'all', label: 'كل التوقعات', desc: 'بدون فلترة (للتحليل الشامل)', emoji: '📊' },
];

export const CONFIDENCE_OPTIONS: Array<{ value: number; label: string }> = [
 { value: 50, label: '50+ (متوسط)' },
 { value: 60, label: '60+ (جيد)' },
 { value: 70, label: '70+ (قوي)' },
 { value: 80, label: '80+ (قوي جداً)' },
];
