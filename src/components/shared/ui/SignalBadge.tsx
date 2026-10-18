'use client';

/**
 * SignalBadge — BLUEPRINT-UNIFIED-SCREENS (Phase 1, Component 2/8)
 * ====================================================================
 * بادج موحد ومحترم بدون نصوص إنجليزية غريبة.
 * يدعم: BUY / SELL / HOLD / WAIT / STRONG_BUY / STRONG_SELL / AVOID.
 *
 * Rule 27: مفيش أرقام وهمية.
 * Rule 30: Emerald + Amber + Rose (ممنوع أزرق).
 *
 * لو الـ signal غير معروف → بادج رمادي "محايد".
 * لو strength موجود → عرضه جنب الـ label.
 */
import React from 'react';
import { cn } from '@/lib/utils';

export type SignalKind =
  | 'BUY'
  | 'SELL'
  | 'HOLD'
  | 'WAIT'
  | 'STRONG_BUY'
  | 'STRONG_SELL'
  | 'AVOID'
  | string;

export interface SignalBadgeProps {
  signal: SignalKind | null | undefined;
  /** قوة الإشارة (0-100). لو null → ملوش عرض. */
  strength?: number | null;
  /** حجم البادج. */
  size?: 'sm' | 'md' | 'lg';
  /** variant: solid (لون كامل) | soft (خلفية ناعمة). default: soft. */
  variant?: 'solid' | 'soft';
  className?: string;
}

/** خريطة الإشارات → (label عربي + tone + emoji). */
const SIGNAL_MAP: Record<string, { label: string; tone: 'profit' | 'loss' | 'warning' | 'muted'; emoji?: string }> = {
  BUY: { label: 'شراء', tone: 'profit', emoji: '🟢' },
  STRONG_BUY: { label: 'شراء قوي', tone: 'profit', emoji: '🟢' },
  SELL: { label: 'بيع', tone: 'loss', emoji: '🔴' },
  STRONG_SELL: { label: 'بيع قوي', tone: 'loss', emoji: '🔴' },
  HOLD: { label: 'احتفاظ', tone: 'warning', emoji: '🟡' },
  WAIT: { label: 'انتظار', tone: 'warning', emoji: '🟡' },
  AVOID: { label: 'تجنّب', tone: 'loss', emoji: '⚠️' },
};

const TONE_SOFT: Record<string, string> = {
  profit: 'bg-profit/10 text-profit',
  loss: 'bg-loss/10 text-loss',
  warning: 'bg-warning/15 text-warning',
  muted: 'bg-muted text-muted-foreground',
};

const TONE_SOLID: Record<string, string> = {
  profit: 'bg-profit text-profit-foreground',
  loss: 'bg-loss text-loss-foreground',
  warning: 'bg-warning text-warning-foreground',
  muted: 'bg-muted text-muted-foreground',
};

const SIZE_CLASS = {
  sm: 'text-[11px] px-2 py-0.5 gap-1',
  md: 'text-xs px-2.5 py-1 gap-1',
  lg: 'text-sm px-3 py-1.5 gap-1.5',
} as const;

export function SignalBadge({
  signal,
  strength,
  size = 'md',
  variant = 'soft',
  className,
}: SignalBadgeProps) {
  if (!signal) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full font-semibold',
          SIZE_CLASS[size],
          variant === 'soft' ? TONE_SOFT.muted : TONE_SOLID.muted,
          className
        )}
        dir="rtl"
      >
        —
      </span>
    );
  }

  const key = String(signal).toUpperCase().trim();
  const info = SIGNAL_MAP[key] || { label: String(signal), tone: 'muted' as const };
  const toneClass = variant === 'soft' ? TONE_SOFT[info.tone] : TONE_SOLID[info.tone];
  const hasStrength = typeof strength === 'number' && Number.isFinite(strength) && strength > 0;

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-semibold',
        SIZE_CLASS[size],
        toneClass,
        className
      )}
      dir="rtl"
    >
      {info.emoji && <span className="leading-none">{info.emoji}</span>}
      <span>{info.label}</span>
      {hasStrength && (
        <span className="opacity-70 tabular-nums">{Math.round(strength!)}%</span>
      )}
    </span>
  );
}
