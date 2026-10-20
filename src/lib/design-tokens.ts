/**
 * Design Tokens — BLUEPRINT-UNIFIED-SCREENS (Phase 1)
 * ====================================================================
 * Single source of truth for semantic constants.
 * RESTRUCT DESIGN-SYSTEM-1 (planning) → implementation Phase 1.
 *
 * Rule: any component that needs a semantic color/spacing/radius/shadow
 * imports from here (or uses the Tailwind token). NO hardcoded hex / direct palette.
 *
 * الـ Tailwind tokens (text-success, bg-warning, إلخ) متوصلة في tailwind.config.ts
 * من الـ CSS vars في globals.css. الملف ده بيوفر constants للـ JS logic (tone mapping, إلخ).
 */

// ============================================================================
// Semantic Tones — خريطة الـ semantic concepts → Tailwind token names
// ============================================================================
// بتـستخدم في: SignalBadge (kind→tone), FlowPhaseTag (phase→tone), StatCard (tone prop), إلخ.
// الـ values دي Tailwind class fragments (مش CSS vars) — بـ تتـ concatenate مع bg-/text-.

export const SEMANTIC_TONES = {
  /** ربح / صعود / شراء / إيجابي */
  positive: 'success',
  /** خسارة / هبوط / بيع / سلبي */
  negative: 'danger',
  /** تحذير / وقف / انتظار */
  warning: 'warning',
  /** سيولة مؤسسية / حيتان */
  whale: 'whale',
  /** محايد / ثانوي */
  neutral: 'muted',
  /** معلومات / أساسي */
  info: 'primary',
} as const;

export type SemanticTone = keyof typeof SEMANTIC_TONES;

// ============================================================================
// Radius scale — للاستخدام في components (مش Tailwind classes مباشرة)
// ============================================================================

export const RADIUS = {
  sm: 'rounded-md',
  md: 'rounded-lg',
  lg: 'rounded-xl',
  xl: 'rounded-2xl',
  pill: 'rounded-full',
} as const;

// ============================================================================
// Spacing scale — gap بين العناصر
// ============================================================================

export const SPACING = {
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-3',
  lg: 'gap-4',
  xl: 'gap-6',
} as const;

// ============================================================================
// Typography scale — أحجام النصوص للـ labels + values
// ============================================================================

export const TYPOGRAPHY = {
  label: {
    sm: 'text-xs font-medium',
    md: 'text-sm font-medium',
    lg: 'text-base font-medium',
  },
  value: {
    sm: 'text-sm font-bold',
    md: 'text-lg font-bold',
    lg: 'text-2xl font-bold',
    xl: 'text-3xl font-bold',
  },
} as const;

// ============================================================================
// Tone → Tailwind class maps (للاستخدام المباشر في components)
// ============================================================================

/** خلفية ناعمة (soft) — bg-tone/10 + text-tone */
export const TONE_SOFT: Record<string, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/10 text-danger',
  profit: 'bg-profit/10 text-profit',
  loss: 'bg-loss/10 text-loss',
  whale: 'bg-whale/10 text-whale',
  muted: 'bg-muted text-muted-foreground',
  primary: 'bg-primary/10 text-primary',
};

/** خلفية صلبة (solid) — bg-tone + text-tone-foreground */
export const TONE_SOLID: Record<string, string> = {
  success: 'bg-profit/10 text-profit border border-profit/20',
  warning: 'bg-warning/10 text-warning border border-warning/20',
  danger: 'bg-danger text-danger-foreground',
  profit: 'bg-profit/10 text-profit border border-profit/20',
  loss: 'bg-loss/10 text-loss border border-loss/20',
  whale: 'bg-whale text-whale-foreground',
  muted: 'bg-muted text-muted-foreground',
  primary: 'bg-primary text-primary-foreground',
};

/** نص فقط (text color) — text-tone */
export const TONE_TEXT: Record<string, string> = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  profit: 'text-profit',
  loss: 'text-loss',
  whale: 'text-whale',
  muted: 'text-muted-foreground',
  primary: 'text-primary',
};

// ============================================================================
// Migration mapping — للـ codemod (Phase 5)
// ============================================================================
// خريطة الـ direct palette → semantic token. بتـ تستخدم في الـ migration الآلي.

export const PALETTE_MIGRATION: Record<string, string> = {
  // emerald → profit (brand) أو success (semantic)
  'text-emerald-600': 'text-profit',
  'text-emerald-700': 'text-profit',
  'text-emerald-500': 'text-profit',
  'dark:text-emerald-400': '', // auto via token
  'bg-emerald-500': 'bg-profit',
  'bg-emerald-600': 'bg-profit',
  // green → success
  'text-green-600': 'text-success',
  'text-green-700': 'text-success',
  'bg-green-100': 'bg-success/10',
  // red → danger/loss
  'text-red-500': 'text-danger',
  'text-red-600': 'text-danger',
  'bg-red-500': 'bg-danger',
  'bg-red-600': 'bg-danger',
  // rose → loss
  'text-rose-500': 'text-loss',
  'text-rose-600': 'text-loss',
  'bg-rose-500': 'bg-loss',
  // amber → warning
  'text-amber-500': 'text-warning',
  'text-amber-600': 'text-warning',
  'bg-amber-500': 'bg-warning',
  'bg-amber-600': 'bg-warning',
  // teal → whale
  'text-teal-500': 'text-whale',
  'text-teal-600': 'text-whale',
  'bg-teal-500': 'bg-whale',
  // blue → primary ( لو مش محتاج info tone)
  'text-blue-600': 'text-primary',
  'bg-blue-500': 'bg-primary',
};

// ============================================================================
// 🎨 MASTER BADGE TOKENS (Per Mohsen's directive 2026-10-20 — Design System)
// ============================================================================
// النظام الموحد للبادجات — Single Source of Truth.
// ممنوع أي مكون يكتب ألوان ad-hoc. كل بادج بـ يـستورد من هنا.
//
// القاعدة الذهبية: text + bg من نفس العائلة بس بـ درجات مختلفة عشان
// الضمان readability في Light + Dark mode (no text-loss on bg-loss!).
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// (A) إشارات التداول (Trading Signals) — للـ SignalBadge / StatusBadge
// ────────────────────────────────────────────────────────────────────────────

export interface BadgeStyle {
  bg: string;
  text: string;
  border: string;
  icon: string;
  labelAr?: string;
}

export const SIGNAL_BADGE_STYLES: Record<string, BadgeStyle> = {
  // ─── شراء ───
  STRONG_BUY: {
    bg: 'bg-profit/10',
    text: 'text-profit',
    border: 'border-profit/20',
    icon: '🟢',
    labelAr: 'شراء قوي',
  },
  BUY: {
    bg: 'bg-profit/10',
    text: 'text-profit',
    border: 'border-profit/20',
    icon: '🟢',
    labelAr: 'شراء',
  },
  ACCUMULATE: {
    bg: 'bg-whale/10',
    text: 'text-whale',
    border: 'border-whale/20',
    icon: '🐋',
    labelAr: 'تجميع',
  },
  WHALE_RADAR_BUY: {
    bg: 'bg-whale/10',
    text: 'text-whale',
    border: 'border-whale/20',
    icon: '🐋',
    labelAr: 'شراء رادار حيتان',
  },
  // ─── محايد ───
  HOLD: {
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    border: 'border-border',
    icon: '⏸️',
    labelAr: 'احتفاظ',
  },
  WAIT: {
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    border: 'border-border',
    icon: '⏸️',
    labelAr: 'انتظار',
  },
  // ─── تحذير ───
  REDUCE: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
    icon: '⚠️',
    labelAr: 'تخفيض',
  },
  // ─── بيع ───
  SELL: {
    bg: 'bg-loss/10',
    text: 'text-loss',
    border: 'border-loss/20',
    icon: '🔴',
    labelAr: 'بيع',
  },
  STRONG_SELL: {
    bg: 'bg-loss/10',
    text: 'text-loss',
    border: 'border-loss/20',
    icon: '🔴',
    labelAr: 'بيع قوي',
  },
  AVOID: {
    bg: 'bg-loss/10',
    text: 'text-loss',
    border: 'border-loss/20',
    icon: '🔴',
    labelAr: 'تجنّب',
  },
};

// ────────────────────────────────────────────────────────────────────────────
// (B) حالات الصفقات (Prediction & Trade Statuses) — للـ StatusBadge
// ────────────────────────────────────────────────────────────────────────────

export const STATUS_BADGE_STYLES: Record<string, BadgeStyle> = {
  TARGET_HIT: {
    bg: 'bg-profit/10',
    text: 'text-profit',
    border: 'border-profit/20',
    icon: '✅',
    labelAr: 'تم الهدف',
  },
  TRAILING_PROFIT: {
    bg: 'bg-whale/10',
    text: 'text-whale',
    border: 'border-whale/20',
    icon: '💰',
    labelAr: 'ربح محقق',
  },
  STOPPED: {
    bg: 'bg-loss/10',
    text: 'text-loss',
    border: 'border-loss/20',
    icon: '🛑',
    labelAr: 'وقف خسارة',
  },
  EXPIRED: {
    bg: 'bg-muted',
    text: 'text-muted-foreground',
    border: 'border-border',
    icon: '⌛',
    labelAr: 'منتهية',
  },
  PENDING: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
    icon: '⏳',
    labelAr: 'نشطة',
  },
  ACTIVE: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
    icon: '🟢',
    labelAr: 'نشط',
  },
  WAITING: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
    icon: '⏸️',
    labelAr: 'في انتظار',
  },
};

// ────────────────────────────────────────────────────────────────────────────
// (C) حالات الجاهزية (Incubator / Readiness) — للـ IncubatorSection
// ────────────────────────────────────────────────────────────────────────────

export const READINESS_BADGE_STYLES: Record<string, BadgeStyle> = {
  HEATING_UP: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
    icon: '🌡️',
    labelAr: 'تسخين',
  },
  APPROACHING_TRIGGER: {
    bg: 'bg-profit/10',
    text: 'text-profit',
    border: 'border-profit/20',
    icon: '🔥',
    labelAr: 'على وشك',
  },
  COMPLETE: {
    bg: 'bg-profit/10',
    text: 'text-profit',
    border: 'border-profit/20',
    icon: '✅',
    labelAr: 'مكتمل',
  },
};

// ────────────────────────────────────────────────────────────────────────────
// (D) حالات المراقبة (Stale / Mismatch) — للـ PersonaTab archive
// ────────────────────────────────────────────────────────────────────────────

export const ARCHIVE_BADGE_STYLES: Record<string, BadgeStyle> = {
  STALE: {
    bg: 'bg-warning/10',
    text: 'text-warning',
    border: 'border-warning/20',
    icon: '⚠️',
    labelAr: 'قديمة',
  },
  MISMATCH: {
    bg: 'bg-loss/10',
    text: 'text-loss',
    border: 'border-loss/20',
    icon: '🔴',
    labelAr: 'منتهية',
  },
};

// ============================================================================
// Helper: get badge style by signal or status (with fallback)
// ============================================================================

/** بيرجّع الـ BadgeStyle للـ signal المحدد (fallback → muted neutral). */
export function getSignalBadgeStyle(signal: string | null | undefined): BadgeStyle {
  if (!signal) return NEUTRAL_BADGE;
  const key = String(signal).toUpperCase().trim();
  return SIGNAL_BADGE_STYLES[key] || NEUTRAL_BADGE;
}

/** بيرجّع الـ BadgeStyle للـ status المحدد (fallback → neutral). */
export function getStatusBadgeStyle(status: string | null | undefined): BadgeStyle {
  if (!status) return NEUTRAL_BADGE;
  const key = String(status).toUpperCase().trim();
  return STATUS_BADGE_STYLES[key] || NEUTRAL_BADGE;
}

/** Neutral fallback — للـ signals/statuses مش المتعرفة. */
export const NEUTRAL_BADGE: BadgeStyle = {
  bg: 'bg-muted',
  text: 'text-muted-foreground',
  border: 'border-border',
  icon: '•',
  labelAr: 'غير محدد',
};

// ============================================================================
// 🎯 FinancialTone + resolveFinancialTone (Per Mohsen's directive)
// ============================================================================
// The 5 canonical financial tones. All badge components resolve to one of
// these. Each maps to a CSS variable in globals.css — change the variable
// once → the whole platform changes automatically.
// ============================================================================

export type FinancialTone = 'profit' | 'loss' | 'warning' | 'whale' | 'neutral';

/**
 * بيرجّع الـ FinancialTone المناسب لأي status / signal / type string.
 * - 'profit'  → TARGET_HIT, BUY, STRONG_BUY, WHALE_RADAR_BUY, PROFIT, TP1, TP2
 * - 'loss'    → STOPPED, SELL, STRONG_SELL, LOSS, DANGER, AVOID
 * - 'warning' → PENDING, WARNING, REDUCE, WAITING, STALKING, INCUBATOR
 * - 'whale'   → WHALE, WHALE_RADAR, INSTITUTIONAL, SMART_MONEY, ACCUMULATE
 * - 'neutral' → EXPIRED, CASH, HOLD, anything else
 *
 * @example
 * resolveFinancialTone('TARGET_HIT')  // → 'profit'
 * resolveFinancialTone('STOPPED')     // → 'loss'
 * resolveFinancialTone('PENDING')     // → 'warning'
 */
export function resolveFinancialTone(statusOrType: string): FinancialTone {
  const s = (statusOrType || '').toUpperCase().trim();
  if (['TARGET_HIT', 'TP1', 'TP2', 'TRAILING_PROFIT', 'BUY', 'STRONG_BUY', 'PROFIT', 'WHALE_RADAR_BUY'].includes(s)) return 'profit';
  if (['STOPPED', 'STOP_LOSS', 'SL', 'SELL', 'STRONG_SELL', 'LOSS', 'DANGER', 'AVOID'].includes(s)) return 'loss';
  if (['PENDING', 'WARNING', 'STALKING', 'INCUBATOR', 'CAUTION', 'REDUCE', 'WAITING'].includes(s)) return 'warning';
  if (['WHALE', 'WHALE_RADAR', 'INSTITUTIONAL', 'SMART_MONEY', 'ACCUMULATE'].includes(s)) return 'whale';
  return 'neutral';
}
