'use client';

// ============================================================================
// SignalStrengthMeter — شريط قوة الإشارة
// ============================================================================
// RADAR-QUICK-WINS (Priority 2): Visual meter for radar signal strength.
// Converts the existing `signal_count` (0–6) into a 5-star trust meter + a
// progress bar + a numeric label, so the user can read trust at a glance.
//
// Mapping (signal_count / maxSignals → 5 stars):
//   6/6 → ⭐⭐⭐⭐⭐  (highest trust)
//   5/6 → ⭐⭐⭐⭐☆
//   4/6 → ⭐⭐⭐☆☆
//   3/6 → ⭐⭐☆☆☆
//   2/6 → ⭐☆☆☆☆  (too early — for monitoring)
//   1/6 → ⭐☆☆☆☆
//   0/6 → ☆☆☆☆☆
//
// Usage:
//   <SignalStrengthMeter signalCount={4} />
//   <SignalStrengthMeter signalCount={6} size="sm" showBar={false} />
// ============================================================================

import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SignalStrengthMeterProps {
  /** Number of signals met (0–maxSignals). */
  signalCount: number;
  /** Maximum possible signals. Default 6 (matches quiet_accumulation). */
  maxSignals?: number;
  /** Show the 5-star row. Default true. */
  showStars?: boolean;
  /** Show the horizontal progress bar. Default true. */
  showBar?: boolean;
  /** Visual size preset. */
  size?: 'sm' | 'md' | 'lg';
  /** Optional extra className on the root wrapper. */
  className?: string;
}

const SIZE_PRESET: Record<
  NonNullable<SignalStrengthMeterProps['size']>,
  { star: string; barHeight: string; label: string; gap: string }
> = {
  sm: { star: 'h-3 w-3', barHeight: 'h-1.5', label: 'text-[10px]', gap: 'gap-1' },
  md: { star: 'h-3.5 w-3.5', barHeight: 'h-2', label: 'text-[11px]', gap: 'gap-1.5' },
  lg: { star: 'h-5 w-5', barHeight: 'h-2.5', label: 'text-xs', gap: 'gap-2' },
};

/**
 * Map a 0..maxSignals count to a 0..5 star rating.
 * Uses ceiling so even a single met signal shows at least 1 star (early
 * visibility), and full marks require meeting every signal.
 */
export function signalsToStars(
  signalCount: number,
  maxSignals: number = 6,
): number {
  if (maxSignals <= 0) return 0;
  const clamped = Math.max(0, Math.min(signalCount, maxSignals));
  return Math.ceil((clamped / maxSignals) * 5);
}

/**
 * Color accent for the meter based on star rating.
 * Returns a tailwind-friendly pair (bar + star color class).
 *   5★ → emerald (highest trust)
 *   4★ → teal
 *   3★ → amber
 *   2★ → orange
 *   0–1★ → rose (too early)
 */
export function signalAccent(stars: number): {
  bar: string;
  star: string;
  label: string;
} {
  if (stars >= 5) {
    return {
      bar: 'bg-emerald-500',
      star: 'fill-emerald-500 text-emerald-500',
      label: 'text-emerald-600 dark:text-emerald-400',
    };
  }
  if (stars === 4) {
    return {
      bar: 'bg-teal-500',
      star: 'fill-teal-500 text-teal-500',
      label: 'text-teal-600 dark:text-teal-400',
    };
  }
  if (stars === 3) {
    return {
      bar: 'bg-amber-500',
      star: 'fill-amber-500 text-amber-500',
      label: 'text-amber-600 dark:text-amber-400',
    };
  }
  if (stars === 2) {
    return {
      bar: 'bg-orange-500',
      star: 'fill-orange-400 text-orange-400',
      label: 'text-orange-600 dark:text-orange-400',
    };
  }
  return {
    bar: 'bg-rose-400',
    star: 'fill-rose-300 text-rose-300',
    label: 'text-rose-500 dark:text-rose-400',
  };
}

/**
 * Short human-readable Arabic hint for the rating (used as title/aria-label).
 */
export function signalHintAr(stars: number): string {
  switch (stars) {
    case 5:
      return 'ثقة قصوى — كل الإشارات اتأكدت';
    case 4:
      return 'ثقة عالية — أغلب الإشارات اتأكدت';
    case 3:
      return 'ثقة متوسطة — في إشارات لسه محتاجة تأكيد';
    case 2:
      return 'ثقة منخفضة — للمتابعة والمراقبة فقط';
    default:
      return 'إشارات مبكرة جداً — انتظر تأكيد إضافي';
  }
}

export function SignalStrengthMeter({
  signalCount,
  maxSignals = 6,
  showStars = true,
  showBar = true,
  size = 'md',
  className,
}: SignalStrengthMeterProps) {
  const stars = signalsToStars(signalCount, maxSignals);
  const accent = signalAccent(stars);
  const preset = SIZE_PRESET[size];
  const hint = signalHintAr(stars);
  const pct = Math.max(0, Math.min(100, (signalCount / maxSignals) * 100));

  return (
    <div
      className={cn('flex items-center', preset.gap, className)}
      role="meter"
      aria-valuenow={signalCount}
      aria-valuemin={0}
      aria-valuemax={maxSignals}
      aria-label={`قوة الإشارة ${signalCount} من ${maxSignals}: ${hint}`}
      title={hint}
    >
      {showStars && (
        <div className="flex items-center" aria-hidden="true">
          {Array.from({ length: 5 }).map((_, i) => (
            <Star
              key={i}
              className={cn(
                preset.star,
                i < stars
                  ? accent.star
                  : 'fill-transparent text-muted-foreground/40',
              )}
            />
          ))}
        </div>
      )}

      {showBar && (
        <div
          className={cn(
            'relative flex-1 overflow-hidden rounded-full bg-muted',
            preset.barHeight,
          )}
          style={{ minWidth: 48 }}
        >
          <div
            className={cn('h-full rounded-full transition-all', accent.bar)}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      <span className={cn('font-mono font-semibold tabular-nums', preset.label, accent.label)}>
        {signalCount}/{maxSignals}
      </span>
    </div>
  );
}

export default SignalStrengthMeter;
