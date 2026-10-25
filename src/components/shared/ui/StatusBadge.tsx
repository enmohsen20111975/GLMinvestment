'use client';

/**
 * StatusBadge — Unified Financial Design System Badge Engine
 * ====================================================================
 * Per Mohsen's directive 2026-10-20 — النظام الموحد للبادجات.
 *
 * الـ component ده هو المسؤول الوحيد عن:
 *   1. حساب الـ contrast (text + bg من درجات مختلفة من نفس العائلة).
 *   2. ضمان readability في Light + Dark mode.
 *   3. استيراد الـ colors من design-tokens.ts (لا ألوان ad-hoc).
 *
 * ممنوع أي مكون يكتب statusColor / sigColor محلي — استخدم StatusBadge.
 *
 * Props:
 *   - status: TARGET_HIT | TRAILING_PROFIT | STOPPED | EXPIRED | PENDING | ...
 *   - signal: BUY | STRONG_BUY | SELL | STRONG_SELL | HOLD | ACCUMULATE | WHALE_RADAR_BUY | ...
 *   - label: نص مخصص (يـoverride الـ labelAr الافتراضي)
 *   - showIcon: show the emoji icon (default: true)
 *   - size: 'sm' | 'md' | 'lg'
 *   - className: extra classes
 *
 * لو status موجود → بـ يستخدم STATUS_BADGE_STYLES
 * لو signal موجود (وبس) → بـ يستخدم SIGNAL_BADGE_STYLES
 * لو الاتنين موجودين → priority للـ status (لأنه الأحداث)
 * ====================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';
import {
  SIGNAL_BADGE_STYLES,
  STATUS_BADGE_STYLES,
  getSignalBadgeStyle,
  getStatusBadgeStyle,
  NEUTRAL_BADGE,
  type BadgeStyle,
} from '@/lib/design-tokens';

export interface StatusBadgeProps {
  /** حالة الصفقة (priority على signal لو موجود). */
  status?: string | null;
  /** إشارة التداول (يـستخدم لو status مش موجود). */
  signal?: string | null;
  /** نص مخصص (يـoverride الـ labelAr الافتراضي). */
  label?: string | null;
  /** Arabic label override (لو موجود من الـ backend). */
  labelAr?: string | null;
  /** عرض الأيقونة (default: true). */
  showIcon?: boolean;
  /** حجم البادج. default: sm. */
  size?: 'sm' | 'md' | 'lg';
  /** className إضافي. */
  className?: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Size classes
// ────────────────────────────────────────────────────────────────────────────

const SIZE_CLASS = {
  sm: 'text-[10px] px-2 py-0.5 gap-1',
  md: 'text-xs px-2.5 py-1 gap-1.5',
  lg: 'text-sm px-3 py-1.5 gap-2',
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────────────

export function StatusBadge({
  status,
  signal,
  label,
  labelAr,
  showIcon = true,
  size = 'sm',
  className,
}: StatusBadgeProps) {
  // (1) Determine which style to use — status takes priority over signal
  let style: BadgeStyle;
  let resolvedLabel: string;

  if (status) {
    style = getStatusBadgeStyle(status);
    resolvedLabel = label || labelAr || style.labelAr || String(status);
  } else if (signal) {
    style = getSignalBadgeStyle(signal);
    resolvedLabel = label || labelAr || style.labelAr || String(signal);
  } else {
    // Neither status nor signal — show neutral "—" badge
    style = NEUTRAL_BADGE;
    resolvedLabel = '—';
  }

  // (2) Empty state — if both null/undefined, show dash
  if (!status && !signal) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full border font-semibold',
          SIZE_CLASS[size],
          style.bg,
          style.text,
          style.border,
          className
        )}
        dir="rtl"
      >
        —
      </span>
    );
  }

  // (3) Render the badge with high-contrast styling
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-semibold',
        SIZE_CLASS[size],
        style.bg,
        style.text,
        style.border,
        className
      )}
      dir="rtl"
    >
      {showIcon && <span aria-hidden>{style.icon}</span>}
      <span>{resolvedLabel}</span>
    </span>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Helper exports (for migration of inline ternary chains)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Helper: get the badge className string for a status.
 * For migration of inline ternary chains in components that use <Badge>.
 *
 * @example
 * <Badge className={cn('border', getStatusBadgeClass(p.status))}>
 *   {p.status_ar || p.status}
 * </Badge>
 */
export function getStatusBadgeClass(
  status: string | null | undefined
): string {
  const style = getStatusBadgeStyle(status);
  return cn(style.bg, style.text, style.border);
}

/**
 * Helper: get the badge className string for a signal.
 */
export function getSignalBadgeClass(
  signal: string | null | undefined
): string {
  const style = getSignalBadgeStyle(signal);
  return cn(style.bg, style.text, style.border);
}

/**
 * Helper: get the Arabic label for a status (no className).
 */
export function getStatusLabelAr(
  status: string | null | undefined,
  statusAr?: string | null
): string {
  if (statusAr && typeof statusAr === 'string' && statusAr.trim().length > 0) {
    return statusAr;
  }
  return getStatusBadgeStyle(status).labelAr || (status ? String(status) : '—');
}

/**
 * Helper: get the Arabic label for a signal (no className).
 */
export function getSignalLabelAr(
  signal: string | null | undefined,
  signalAr?: string | null
): string {
  if (signalAr && typeof signalAr === 'string' && signalAr.trim().length > 0) {
    return signalAr;
  }
  return getSignalBadgeStyle(signal).labelAr || (signal ? String(signal) : '—');
}

// Re-export the style maps for components that need direct access
export {
  SIGNAL_BADGE_STYLES,
  STATUS_BADGE_STYLES,
  NEUTRAL_BADGE,
  getSignalBadgeStyle,
  getStatusBadgeStyle,
};

export default StatusBadge;
