'use client';

/**
 * FinancialBadge — The Central Unified Badge Component
 * ====================================================================
 * Per Mohsen's directive 2026-10-20 — ALPHA-DESIGN-SYSTEM-DIRECTIVE.
 *
 * This is the SINGLE badge component for the entire platform.
 * All other badge components (StatusBadge, SignalBadge, etc.) should
 * delegate to this one.
 *
 * Features:
 * - Auto-resolves the tone from a status/signal string
 * - Supports manual tone override
 * - Uses CSS variable tokens (profit/loss/warning/whale/neutral)
 *   — change globals.css → whole platform changes
 * - No dark: overrides (CSS vars handle dark mode)
 * - Pulse dot for active/live signals
 * - Custom icon support
 *
 * المحظورات (per owner directive):
 * 1. No hardcoded colors (no emerald/rose/amber/cyan/slate).
 * 2. No dark: overrides.
 * 3. No contrast bugs (bg-profit/10 text-profit is fine — CSS var
 *    resolves to different shades in light/dark).
 * ====================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { resolveFinancialTone, type FinancialTone } from '@/lib/design-tokens';

// ============================================================================
// Types
// ============================================================================

export interface FinancialBadgeProps {
  /** Status/signal string — auto-resolves to a FinancialTone. */
  status?: string;
  /** Manual tone override (takes priority over status). */
  tone?: FinancialTone;
  /** Custom label text (overrides the auto-generated Arabic label). */
  label?: string;
  /** Badge size. default: 'sm'. */
  size?: 'xs' | 'sm' | 'md';
  /** Show a pulsing dot (for active/live signals). */
  pulse?: boolean;
  /** Custom icon (emoji string or React node). */
  icon?: string;
  /** Extra className. */
  className?: string;
}

// ============================================================================
// Tone → CSS variable class maps (NO raw colors!)
// ============================================================================

const TONE_CLASSES: Record<FinancialTone, string> = {
  profit: 'bg-profit/10 text-profit border-profit/20',
  loss: 'bg-loss/10 text-loss border-loss/20',
  warning: 'bg-warning/10 text-warning border-warning/20',
  whale: 'bg-whale/10 text-whale border-whale/20',
  neutral: 'bg-muted text-muted-foreground border-border',
};

const SIZE_CLASSES = {
  xs: 'text-[10px] px-1.5 py-0.5 rounded',
  sm: 'text-xs px-2 py-0.5 rounded-md',
  md: 'text-sm px-2.5 py-1 rounded-md',
} as const;

// ============================================================================
// Status → Arabic label map (for auto-labeling)
// ============================================================================

const STATUS_LABELS_AR: Record<string, string> = {
  // Trade statuses
  TARGET_HIT: 'تم الهدف',
  TRAILING_PROFIT: 'ربح محقق',
  STOPPED: 'وقف خسارة',
  EXPIRED: 'منتهية',
  PENDING: 'نشطة',
  ACTIVE: 'نشط',
  // Trading signals
  BUY: 'شراء',
  STRONG_BUY: 'شراء قوي',
  SELL: 'بيع',
  STRONG_SELL: 'بيع قوي',
  HOLD: 'احتفاظ',
  ACCUMULATE: 'تجميع',
  WHALE_RADAR_BUY: 'شراء رادار حيتان',
  REDUCE: 'تخفيض',
  AVOID: 'تجنّب',
  WAITING: 'في انتظار',
};

// ============================================================================
// Component
// ============================================================================

/**
 * @example
 * // Auto-resolve from status
 * <FinancialBadge status="TARGET_HIT" />
 * // → ✅ "تم الهدف" with profit (green) tone
 *
 * @example
 * // Manual tone + custom label
 * <FinancialBadge tone="whale" label="🐋 تجميع هادئ" size="xs" />
 *
 * @example
 * // Pulsing dot for active signals
 * <FinancialBadge status="PENDING" pulse />
 *
 * @example
 * // Custom icon
 * <FinancialBadge status="BUY" icon="🟢" />
 */
export function FinancialBadge({
  status,
  tone,
  label,
  size = 'sm',
  pulse = false,
  icon,
  className,
}: FinancialBadgeProps) {
  // (1) Resolve the tone — manual override takes priority
  const resolvedTone: FinancialTone = tone || (status ? resolveFinancialTone(status) : 'neutral');

  // (2) Resolve the label — custom label > auto Arabic label > raw status
  const text = label
    || (status ? (STATUS_LABELS_AR[status.toUpperCase()] || status) : '');

  // (3) Empty state — no status + no tone + no label → show "—"
  if (!status && !tone && !label) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 border font-medium',
          TONE_CLASSES.neutral,
          SIZE_CLASSES[size],
          className,
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
        'inline-flex items-center gap-1 border font-medium',
        TONE_CLASSES[resolvedTone],
        SIZE_CLASSES[size],
        className,
      )}
      dir="rtl"
    >
      {pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {icon && <span aria-hidden>{icon}</span>}
      {text}
    </span>
  );
}

export default FinancialBadge;
