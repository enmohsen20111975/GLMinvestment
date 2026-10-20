'use client';

/**
 * StatusBadge — P0-COMPONENT-UNIFICATION (Phase 1.3)
 * ====================================================================
 * بادج موحّد لعرض status الرسمية (TARGET_HIT / STOPPED / EXPIRED / …).
 * ----------------------------------------------------------------------------
 * قبل كده: كان فيه 22 inline ternary chain بـ نفس الـ bug المشهور:
 *
 *   const statusColor =
 *     p.status === 'TARGET_HIT'
 *       ? 'bg-success text-success /40 border-success'  // ← bug! space before /
 *       : p.status === 'STOPPED'
 *       ? 'bg-loss text-loss /40 border-loss'
 *       : 'bg-warning text-warning /40 border-warning';
 *
 * نفس الـ bug اتكرر في:
 *   - PredictionsTab.tsx (PreviousPredictionsArchive)
 *   - PersonaTab.tsx (Testing Candidates section + previous archive)
 *   - EidPredictionsWidget
 *   - MarketStatusTab
 *   - CanonicalWhoIsBuyingBanner
 *
 * ده بـ يـحل الـ 22 مكان + 3 re-implementations of getStatusBadge().
 *
 * Status taxonomy (دستور §606-641) — 5 official values:
 *   - TARGET_HIT      → اتحقّق الهدف
 *   - TRAILING_PROFIT → ربح لحظي + trailing stop
 *   - STOPPED         → ضرب وقف الخسارة
 *   - EXPIRED         → انتهى الوقت
 *   - PENDING         → لسه معلّق
 * ====================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';

export interface StatusBadgeProps {
  /** الـ status string (TARGET_HIT / STOPPED / …). */
  status: string | null | undefined;
  /** Arabic label override (لو موجود من الـ backend). */
  statusAr?: string | null;
  /** حجم البادج. */
  size?: 'sm' | 'md' | 'lg';
  /** variant: soft (default) | solid. */
  variant?: 'soft' | 'solid';
  /** Show the icon. */
  showIcon?: boolean;
  className?: string;
}

// ============================================================
// Canonical STATUS_STYLES map
// ============================================================

type Tone = 'profit' | 'success' | 'loss' | 'muted' | 'warning';

interface StatusStyle {
  emoji: string;
  tone: Tone;
  labelAr: string;
}

/**
 * Canonical status → style map. Single source of truth.
 * لو الـ status مش معروف → بيرجّع fallback (muted tone).
 */
const STATUS_STYLES: Record<string, StatusStyle> = {
  TARGET_HIT: {
    emoji: '✅',
    tone: 'success',
    labelAr: 'تحقّق الهدف',
  },
  TRAILING_PROFIT: {
    emoji: '📈',
    tone: 'profit',
    labelAr: 'ربح لحظي',
  },
  STOPPED: {
    emoji: '🛑',
    tone: 'loss',
    labelAr: 'ضرب وقف الخسارة',
  },
  EXPIRED: {
    emoji: '⌛',
    tone: 'muted',
    labelAr: 'انتهى الوقت',
  },
  PENDING: {
    emoji: '⏳',
    tone: 'warning',
    labelAr: 'معلّق',
  },
  ACTIVE: {
    emoji: '🟢',
    tone: 'profit',
    labelAr: 'نشط',
  },
  WAITING: {
    emoji: '⏸️',
    tone: 'warning',
    labelAr: 'في انتظار',
  },
};

const FALLBACK_STYLE: StatusStyle = {
  emoji: '•',
  tone: 'muted',
  labelAr: 'غير محدد',
};

const TONE_SOFT: Record<Tone, string> = {
  profit: 'bg-profit/15 text-profit border-profit/40',
  success: 'bg-success/15 text-success border-success/40',
  loss: 'bg-loss/15 text-loss border-loss/40',
  muted: 'bg-muted text-muted-foreground border-border',
  warning: 'bg-warning/15 text-warning border-warning/40',
};

const TONE_SOLID: Record<Tone, string> = {
  profit: 'bg-profit text-profit-foreground border-profit',
  success: 'bg-success text-success-foreground border-success',
  loss: 'bg-loss text-loss-foreground border-loss',
  muted: 'bg-muted text-muted-foreground border-border',
  warning: 'bg-warning text-warning-foreground border-warning',
};

const SIZE_CLASS = {
  sm: 'text-[10px] px-2 py-0.5 gap-1',
  md: 'text-xs px-2.5 py-1 gap-1.5',
  lg: 'text-sm px-3 py-1.5 gap-2',
} as const;

// ============================================================
// Component
// ============================================================

/**
 * @example
 * // Basic
 * <StatusBadge status="TARGET_HIT" />
 * // → ✅ تحقّق الهدف (success tone)
 *
 * @example
 * // With Arabic label from backend
 * <StatusBadge status={p.status} statusAr={p.status_ar} />
 *
 * @example
 * // Solid variant
 * <StatusBadge status="STOPPED" variant="solid" />
 */
export function StatusBadge({
  status,
  statusAr,
  size = 'sm',
  variant = 'soft',
  showIcon = true,
  className,
}: StatusBadgeProps) {
  const key = (status || '').toString().toUpperCase().trim();
  const style = STATUS_STYLES[key] || FALLBACK_STYLE;
  const label = statusAr && typeof statusAr === 'string' && statusAr.trim().length > 0
    ? statusAr
    : style.labelAr;
  const toneClass = variant === 'soft' ? TONE_SOFT[style.tone] : TONE_SOLID[style.tone];

  if (!status) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border font-semibold',
          SIZE_CLASS[size],
          TONE_SOFT.muted,
          className
        )}
        dir="rtl"
      >
        —
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-semibold',
        SIZE_CLASS[size],
        toneClass,
        className
      )}
      dir="rtl"
    >
      {showIcon && <span aria-hidden>{style.emoji}</span>}
      <span>{label}</span>
    </span>
  );
}

/**
 * Helper function for cases where you just need the className string
 * (for migration of inline ternary chains). Phase 2 codemod بـ يستخدمها.
 *
 * @example
 * <Badge className={cn('border', getStatusBadgeClass(p.status))}>
 *   {p.status_ar || p.status}
 * </Badge>
 */
export function getStatusBadgeClass(
  status: string | null | undefined,
  variant: 'soft' | 'solid' = 'soft'
): string {
  const key = (status || '').toString().toUpperCase().trim();
  const style = STATUS_STYLES[key] || FALLBACK_STYLE;
  return variant === 'soft' ? TONE_SOFT[style.tone] : TONE_SOLID[style.tone];
}

/**
 * Helper for getting the Arabic label only (no className).
 *
 * @example
 * const label = getStatusLabelAr(p.status, p.status_ar);
 */
export function getStatusLabelAr(
  status: string | null | undefined,
  statusAr?: string | null
): string {
  if (statusAr && typeof statusAr === 'string' && statusAr.trim().length > 0) {
    return statusAr;
  }
  const key = (status || '').toString().toUpperCase().trim();
  return (STATUS_STYLES[key] || FALLBACK_STYLE).labelAr;
}

export default StatusBadge;
