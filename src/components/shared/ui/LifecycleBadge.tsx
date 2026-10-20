'use client';

/**
 * LifecycleBadge — P0-COMPONENT-UNIFICATION (Phase 1.2)
 * ====================================================================
 * بادج موحّد لعرض lifecycle_status (proven / testing / closed).
 * ----------------------------------------------------------------------------
 * قبل كده: كل مكان كان بـ يعمل inline ternary chain:
 *   {getLifecycle(p) === 'testing' && <Badge className="bg-warning/15 text-warning border-warning/40 ...">🟡 تحت الاختبار</Badge>}
 *   {getLifecycle(p) === 'closed' && <Badge className="bg-muted ...">🔴 منتهية</Badge>}
 *
 * فيه 22 مكان فيه bug مشهور (trailing spaces في `'bg-warning/40 '`) — نفس
 * نوع الباج اللي اتصصلح في helpers.ts. الـ component ده بـ يحل كل ده.
 *
 * بيـستورد من `modules/market-analysis/lib/lifecycle.ts` (Phase 0).
 * ====================================================================
 */

import React from 'react';
import { cn } from '@/lib/utils';
import {
  getLifecycle,
  LIFECYCLE_LABELS_AR,
  type LifecyclePhase,
  type HasLifecycle,
} from '@/modules/market-analysis/lib/lifecycle';

export interface LifecycleBadgeProps {
  /** الكائن اللي فيه lifecycle_status + status fields. */
  item: HasLifecycle;
  /** حجم البادج. */
  size?: 'sm' | 'md' | 'lg';
  /** variant: soft (خلفية ناعمة) | solid (لون كامل). default: soft. */
  variant?: 'soft' | 'solid';
  /** Show the icon. default: true. */
  showIcon?: boolean;
  className?: string;
}

// ============================================================
// Internal map: phase → { emoji, tone, label }
// ============================================================

interface PhaseStyle {
  emoji: string;
  tone: 'profit' | 'warning' | 'muted';
  label: string;
}

const PHASE_STYLES: Record<LifecyclePhase, PhaseStyle> = {
  proven: {
    emoji: '🟢',
    tone: 'profit',
    label: LIFECYCLE_LABELS_AR.proven,
  },
  testing: {
    emoji: '🔍',
    tone: 'warning',
    label: LIFECYCLE_LABELS_AR.testing,
  },
  closed: {
    emoji: '🔴',
    tone: 'muted',
    label: LIFECYCLE_LABELS_AR.closed,
  },
};

const TONE_SOFT: Record<PhaseStyle['tone'], string> = {
  profit: 'bg-profit/15 text-profit border-profit/40',
  warning: 'bg-warning/15 text-warning border-warning/40',
  muted: 'bg-muted text-muted-foreground border-border',
};

const TONE_SOLID: Record<PhaseStyle['tone'], string> = {
  profit: 'bg-profit text-profit-foreground border-profit',
  warning: 'bg-warning text-warning-foreground border-warning',
  muted: 'bg-muted text-muted-foreground border-border',
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
 * // Prediction object
 * <LifecycleBadge item={prediction} />
 *
 * @example
 * // With explicit size
 * <LifecycleBadge item={p} size="sm" />
 *
 * @example
 * // Solid variant (for emphasized display)
 * <LifecycleBadge item={p} variant="solid" />
 */
export function LifecycleBadge({
  item,
  size = 'sm',
  variant = 'soft',
  showIcon = true,
  className,
}: LifecycleBadgeProps) {
  const phase = getLifecycle(item);
  const style = PHASE_STYLES[phase];
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
      title={phase === 'testing' ? 'فرصة جديدة بتتـvalidate قبل الترقية لـ proven' : undefined}
    >
      {showIcon && <span aria-hidden>{style.emoji}</span>}
      <span>{style.label}</span>
    </span>
  );
}

export default LifecycleBadge;
