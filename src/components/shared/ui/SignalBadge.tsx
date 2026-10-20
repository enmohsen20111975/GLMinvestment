'use client';

/**
 * SignalBadge — P0-COMPONENT-UNIFICATION (Phase 1.1, refactored)
 * ====================================================================
 * بادج موحّد ومحترم بدون نصوص إنجليزية غريبة.
 * يدعم: BUY / SELL / HOLD / WAIT / STRONG_BUY / STRONG_SELL / AVOID.
 *
 * P0-COMPONENT-UNIFICATION: الـ component ده دلوقتي بـ يستورد الـ canonical
 * signal styles من `modules/market-analysis/lib/signals.ts` (Phase 0) بدل
 * ما يكون عنده SIGNAL_MAP محلي. ده بـ يـضمن إن لو الـ signal styles اتـغيرت
 * في مكان واحد، الـ SignalBadge بـ يـتحدث اتوماتيكياً.
 *
 * Rule 27: مفيش أرقام وهمية.
 * Rule 30: Emerald + Amber + Rose (ممنوع أزرق).
 *
 * لو الـ signal غير معروف → بادج رمادي "محايد".
 * لو strength موجود → عرضه جنب الـ label.
 */
import React from 'react';
import { cn } from '@/lib/utils';
import {
  detectSignalKind,
  getSignalStyle,
  signalLabelAr,
} from '@/modules/market-analysis/lib/signals';

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
  /** Arabic label override (لو موجود من الـ backend). */
  signalAr?: string | null;
  className?: string;
}

/**
 * Internal tone map (for solid variant). The canonical SIGNAL_STYLES in
 * lib/signals.ts uses /10 opacity backgrounds (soft). For solid variant
 * we need full backgrounds — defined here locally since they're a UI-only
 * concern, not a data concern.
 */
const TONE_SOLID: Record<'profit' | 'loss' | 'warning' | 'muted', string> = {
  profit: 'bg-profit text-profit-foreground',
  loss: 'bg-loss text-loss-foreground',
  warning: 'bg-warning text-warning-foreground',
  muted: 'bg-muted text-muted-foreground',
};

/**
 * Maps SignalKind (canonical lowercase) → tone for solid variant.
 */
function kindToTone(
  kind: 'strong_buy' | 'buy' | 'hold' | 'sell'
): 'profit' | 'loss' | 'warning' | 'muted' {
  if (kind === 'strong_buy' || kind === 'buy') return 'profit';
  if (kind === 'sell') return 'loss';
  if (kind === 'hold') return 'warning';
  return 'muted';
}

const SIZE_CLASS = {
  sm: 'text-xs px-2 py-0.5 gap-1',
  md: 'text-xs px-2.5 py-1 gap-1',
  lg: 'text-sm px-3 py-1.5 gap-1.5',
} as const;

export function SignalBadge({
  signal,
  strength,
  size = 'md',
  variant = 'soft',
  signalAr,
  className,
}: SignalBadgeProps) {
  if (!signal) {
    return (
      <span
        className={cn(
          'inline-flex items-center rounded-full font-semibold',
          SIZE_CLASS[size],
          variant === 'soft'
            ? 'bg-muted text-muted-foreground'
            : TONE_SOLID.muted,
          className
        )}
        dir="rtl"
      >
        —
      </span>
    );
  }

  // Use canonical helpers from lib/signals.ts (Phase 0)
  const kind = detectSignalKind(signal);
  const style = getSignalStyle(signal);
  const label = signalLabelAr(signal, signalAr);
  const hasStrength =
    typeof strength === 'number' && Number.isFinite(strength) && strength > 0;

  // For soft variant: use canonical style (bg + text + border)
  // For solid variant: use TONE_SOLID with full background
  const toneClass =
    variant === 'soft'
      ? cn(style.bg, style.text)
      : TONE_SOLID[kindToTone(kind)];

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
      <span>{label}</span>
      {hasStrength && (
        <span className="opacity-70 tabular-nums">{Math.round(strength!)}%</span>
      )}
    </span>
  );
}
