'use client';

/**
 * SeverityBadge — P0-COMPONENT-UNIFICATION (Phase 1.8)
 * ====================================================================
 * بادج موحّد لـ severity levels (للـ alerts + notifications).
 * ----------------------------------------------------------------------------
 * قبل كده: كان فيه 5+ inline `severityColors` maps في:
 *   - alerts/AlertsCenterView.tsx (3 inline AlertCards)
 *   - alerts/SmartAlertsPanel.tsx (2 copies)
 *
 * كل واحد بـ يـعرّف severityColors: Record<string, string> بنفس pattern
 * بس بـ classes مختلفة (مـمكن فيه bugs). الـ SeverityBadge بـ يحل ده.
 * ====================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';

export type SeverityLevel = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface SeverityBadgeProps {
  /** الـ severity level. */
  level: SeverityLevel | string;
  /** Arabic label override. */
  labelAr?: string | null;
  /** حجم البادج. */
  size?: 'sm' | 'md' | 'lg';
  /** variant: soft | solid. default: soft. */
  variant?: 'soft' | 'solid';
  /** Show the icon. */
  showIcon?: boolean;
  className?: string;
}

interface SeverityStyle {
  emoji: string;
  tone: 'loss' | 'warning' | 'info' | 'muted' | 'profit';
  labelAr: string;
}

const SEVERITY_STYLES: Record<SeverityLevel, SeverityStyle> = {
  critical: {
    emoji: '🔴',
    tone: 'loss',
    labelAr: 'حرج',
  },
  high: {
    emoji: '🟠',
    tone: 'warning',
    labelAr: 'مرتفع',
  },
  medium: {
    emoji: '🟡',
    tone: 'warning',
    labelAr: 'متوسط',
  },
  low: {
    emoji: '🔵',
    tone: 'info',
    labelAr: 'منخفض',
  },
  info: {
    emoji: 'ℹ️',
    tone: 'info',
    labelAr: 'معلومة',
  },
};

const TONE_SOFT: Record<SeverityStyle['tone'], string> = {
  loss: 'bg-loss/15 text-loss border-loss/40',
  warning: 'bg-warning/15 text-warning border-warning/40',
  info: 'bg-info/15 text-info border-info/40',
  muted: 'bg-muted text-muted-foreground border-border',
  profit: 'bg-profit/15 text-profit border-profit/40',
};

const TONE_SOLID: Record<SeverityStyle['tone'], string> = {
  loss: 'bg-loss text-loss-foreground border-loss',
  warning: 'bg-warning text-warning-foreground border-warning',
  info: 'bg-info text-info-foreground border-info',
  muted: 'bg-muted text-muted-foreground border-border',
  profit: 'bg-profit text-profit-foreground border-profit',
};

const SIZE_CLASS = {
  sm: 'text-[10px] px-2 py-0.5 gap-1',
  md: 'text-xs px-2.5 py-1 gap-1.5',
  lg: 'text-sm px-3 py-1.5 gap-2',
} as const;

const FALLBACK_STYLE: SeverityStyle = {
  emoji: '•',
  tone: 'muted',
  labelAr: 'غير محدد',
};

/**
 * @example
 * <SeverityBadge level="critical" />
 * <SeverityBadge level="high" labelAr="خطر" />
 */
export function SeverityBadge({
  level,
  labelAr,
  size = 'sm',
  variant = 'soft',
  showIcon = true,
  className,
}: SeverityBadgeProps) {
  const key = String(level || '').toLowerCase().trim() as SeverityLevel;
  const style = SEVERITY_STYLES[key] || FALLBACK_STYLE;
  const label = labelAr && typeof labelAr === 'string' && labelAr.trim().length > 0
    ? labelAr
    : style.labelAr;
  const toneClass = variant === 'soft' ? TONE_SOFT[style.tone] : TONE_SOLID[style.tone];

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
 * Helper: get the severity badge class (for migration of inline ternary chains).
 */
export function getSeverityBadgeClass(
  level: SeverityLevel | string,
  variant: 'soft' | 'solid' = 'soft'
): string {
  const key = String(level || '').toLowerCase().trim() as SeverityLevel;
  const style = SEVERITY_STYLES[key] || FALLBACK_STYLE;
  return variant === 'soft' ? TONE_SOFT[style.tone] : TONE_SOLID[style.tone];
}

export default SeverityBadge;
