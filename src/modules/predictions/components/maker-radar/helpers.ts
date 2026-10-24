// ============================================================================
// helpers.ts — formatting, colors, signal resolution, path metadata
// ============================================================================
// Pure helper functions + display constants shared across the maker-radar/
// folder. NO React components here (pathMeta uses JSX icons but is just a
// static lookup table — kept here so all sub-components agree on styling).
// Extracted from the original MakerRadarTab.tsx (F-Phase3-Split).
// ============================================================================

import React from 'react';
import { Rocket, Eye, Flame, Zap } from 'lucide-react';
import type { RadarPath, RadarStock, AccentKey, PathDescription } from './types';

// ============================================================================
// Formatting helpers
// ============================================================================
export const fmtNum = (n: number | null | undefined, digits = 2): string => {
 if (n == null || isNaN(n as number)) return '-';
 const num = Number(n);
 return num.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
};

export const fmtMoney = (n: number | null | undefined): string => {
 if (n == null || isNaN(n as number)) return '-';
 const num = Number(n);
 if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
 if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
 if (num >= 1_000) return `${(num / 1_000).toFixed(0)}K`;
 return (num ?? 0).toFixed(0);
};

export const fmtPct = (n: number | null | undefined, withSign = true): string => {
 if (n == null || isNaN(n as number)) return '-';
 const num = Number(n);
 const sign = withSign && num > 0 ? '+' : '';
 return `${sign}${(num ?? 0).toFixed(1)}%`;
};

export const pnlColorClass = (pnl: number | null | undefined): string => {
 if (pnl == null || pnl === 0) return 'text-muted-foreground';
 return pnl > 0
 ? 'text-profit '
 : 'text-loss ';
};

// ============================================================================
// Static lookup tables
// ============================================================================
export const bucketLabel: Record<string, string> = {
 low_price: 'رخيص',
 mid_price: 'وسط',
 high_price: 'غالي',
};

// pathMeta holds styling/icon metadata only — Arabic labels come from i18n
// via t(`predictions.makerRadar.paths.${path}.label`) at render time.
// NOTE: uses React.createElement (not JSX) so this file can stay .ts (no JSX
// parser required) — keeps the helpers module importable from non-tsx files.
const h = React.createElement;
export const pathMeta: Record<RadarPath, { short: string; accent: AccentKey; icon: React.ReactNode }> = {
 A_pre_surge: {
 short: 'Pre-Surge',
 accent: 'purple',
 icon: h(Rocket, { className: 'h-4 w-4' }),
 },
 B_quiet_accumulation_strong: {
 short: 'Microscope',
 accent: 'amber',
 icon: h(Eye, { className: 'h-4 w-4' }),
 },
 C_quiet_accumulation_weak: {
 short: 'Weak',
 accent: 'amber',
 icon: h(Eye, { className: 'h-4 w-4' }),
 },
 D_explosive_surge: {
 short: 'Explosive',
 accent: 'rose',
 icon: h(Flame, { className: 'h-4 w-4' }),
 },
 E_early_break: {
 short: 'Breakout',
 accent: 'emerald',
 icon: h(Zap, { className: 'h-4 w-4' }),
 },
};

export const accentClasses: Record<AccentKey, {
 card: string;
 headerBg: string;
 iconColor: string;
 badge: string;
 border: string;
 softBg: string;
}> = {
 amber: {
 card: 'border-warning/20',
 headerBg: 'bg-warning/10 /20',
 iconColor: 'text-warning ',
 badge: 'bg-warning/10 text-warning dark:text-warning border border-warning/20 border-warning/20 ',
 border: 'border-warning/20',
 softBg: 'bg-warning/10 /10',
 },
 rose: {
 card: 'border-loss/20',
 headerBg: 'bg-loss/10 /20',
 iconColor: 'text-loss ',
 badge: 'bg-loss/10 text-loss border border-loss/20 border-loss/20 ',
 border: 'border-loss/20',
 softBg: 'bg-loss/10 /10',
 },
 emerald: {
 card: 'border-profit/20',
 headerBg: 'bg-profit/10 /20',
 iconColor: 'text-profit ',
 badge: 'bg-profit/10 text-profit border border-profit/20 border-profit/20 ',
 border: 'border-profit/20',
 softBg: 'bg-profit/10 /10',
 },
 purple: {
 card: 'border-purple-200 dark:border-purple-900/40',
 headerBg: 'bg-primary/10 /20',
 iconColor: 'text-primary ',
 badge: 'bg-primary text-primary border-purple-200 /60 dark:border-purple-800',
 border: 'border-purple-300 dark:border-purple-800/50',
 softBg: 'bg-primary/10 /10',
 },
};

// Translate signal strings (e.g. "1.volume_high_recurring(4/3)") to short Arabic labels
export const SIGNAL_AR: Record<string, string> = {
 volume_high_recurring: 'حجم متكرر',
 buy_pressure: 'ضغط شرائي',
 compressed: 'ضغط نطاق',
 volume_not_low: 'حجم صحي',
 not_explosive: 'غير منفجر',
 no_distribution: 'لا توزيع',
 volume_gradient: 'تصاعد حجم',
 range_compressed: 'نطاق مضغوط',
 near_ma10: 'قرب MA10',
 buy_days: 'أيام شراء',
};

export const shortSignal = (s: string): string => {
 // 1.volume_high_recurring(4/3) → "حجم متكرر (4/3)"
 const m = s.match(/^\d+\.([a-z_]+)\(([^)]+)\)$/i);
 if (m) {
 const key = m[1];
 const detail = m[2];
 return `${SIGNAL_AR[key] || key} (${detail})`;
 }
 return s;
};

// ============================================================================
// RADAR-QUICK-WINS (Priority 1): Smart Entry Card — Path descriptions
// Each radar path is given a short, plain-Arabic explanation + emoji so the
// user instantly understands what the path means without reading a manual.
// ============================================================================
// PATH_DESC holds emoji + tier only — Arabic text comes from i18n via
// t(`predictions.makerRadar.paths.${path}.descShort`) and
// t(`predictions.makerRadar.paths.${path}.descLong`) at render time.
export const PATH_DESC: Record<RadarPath, PathDescription> = {
 A_pre_surge: {
 emoji: '',
 tier: 'top',
 },
 B_quiet_accumulation_strong: {
 emoji: '🎯',
 tier: 'high',
 },
 C_quiet_accumulation_weak: {
 emoji: '🔍',
 tier: 'monitor',
 },
 D_explosive_surge: {
 emoji: '🔥',
 tier: 'mid',
 },
 E_early_break: {
 emoji: '⚡',
 tier: 'high',
 },
};

/**
 * Resolve a RadarStock's signal_count from whichever details block is populated.
 * Returns null when neither quiet_details nor pre_surge_details are present
 * (e.g. for explosive / early_break paths where signal_count isn't tracked).
 */
export function resolveSignalCount(stock?: RadarStock | null): number | null {
 if (!stock) return null;
 if (stock.pre_surge_details?.signal_count != null) {
 return stock.pre_surge_details.signal_count;
 }
 if (stock.quiet_details?.signal_count != null) {
 return stock.quiet_details.signal_count;
 }
 return null;
}

/**
 * Resolve the maximum signal count for a given path (pre_surge uses 4 signals,
 * quiet_accumulation uses 6, others have no fixed maximum).
 */
export function resolveMaxSignals(path?: RadarPath | null): number | null {
 if (!path) return null;
 if (path === 'A_pre_surge') return 4;
 if (path === 'B_quiet_accumulation_strong' || path === 'C_quiet_accumulation_weak') return 6;
 return null;
}

// ============================================================================
// P0-3 FIX (RADAR-AUDIT-UI, 2026-10-07): PROOF_METRICS كانت قيم ثابتة static
// تُعرَض كأنها live (precision=24.20%، recall=21.08%، avg_rr=0.014). هذا fabrication
// مخالف لـ Rule 27 (NO-FAKE-DATA). القيم الحقيقية متاحة عبر /api/radar/accuracy.
// تم تعطيل عرض القيم الثابتة + استبدالها بـ placeholder يحيل للـ API الكنسي.
// ============================================================================
export const PROOF_METRICS_DEPRECATED = true; // flag: الواجهة تستخدم هذا لعرض placeholder
