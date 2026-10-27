'use client';

/**
 * RelativeVolumeBadge.tsx — شارة الحجم النسبي غير الطبيعي.
 *
 * (ALPHA-SCANNER-LIVE, Task 5 — owner directive 2026-10-27):
 * «عندما relative_volume > 1.2 اعرض شارة الحجم النسبي».
 *
 * مصادر القيمة (بالأولوية):
 *   1. relative_volume_10d — الحجم النسبي الرسمي من TradingView Scanner
 *      (يملأه برافو في stocks.db بعد دمج bravo/scanner-live).
 *   2. volume_ratio_10d_vs_20d — حقل maker-radar الموجود بالفعل (نسبة 10ي/20ي).
 *   3. volume_surge (boolean) — لو true بس بدون قيمة عددية، اعرض الشارة بدون رقم.
 *
 * Rule 20 (financial-calc-backend-only): لا نحسب أي نسبة هنا — فقط نعرض ما
 * يصلنا من الـ backend. لو كل المصادر null/undefined → لا نعرض شيئًا (no fabrication).
 *
 * Rule 27: لا fabrication — القيمة المعروضة دائمًا traces back to a backend field.
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface RelativeVolumeBadgeProps {
  /** الحجم النسبي الرسمي من TradingView Scanner (الأولوية 1). */
  relativeVolume10d?: number | null;
  /** نسبة 10ي/20ي من maker-radar (الأولوية 2). */
  volumeRatio10dVs20d?: number | null;
  /** علم volume_surge من الـ backend (الأولوية 3 — بدون رقم). */
  volumeSurge?: boolean | null;
  /** الحد الذي تعتبر فوقه القيمة «غير طبيعية». افتراضي 1.2 per owner directive. */
  threshold?: number;
  /** حجم الشارة. */
  size?: 'sm' | 'md';
  /** classes إضافية. */
  className?: string;
  /** عرض الرقم أم لا (لو false → يعرض النص فقط). */
  showValue?: boolean;
}

/**
 * يستخرج قيمة الحجم النسبي من المصادر المتاحة.
 * يرجع null لو مفيش قيمة عددية متاحة.
 */
export function resolveRelativeVolume(
  relVol10d?: number | null,
  volRatio?: number | null,
): number | null {
  if (relVol10d != null && !Number.isNaN(relVol10d) && relVol10d > 0) return relVol10d;
  if (volRatio != null && !Number.isNaN(volRatio) && volRatio > 0) return volRatio;
  return null;
}

export function RelativeVolumeBadge({
  relativeVolume10d,
  volumeRatio10dVs20d,
  volumeSurge,
  threshold = 1.2,
  size = 'sm',
  className,
  showValue = true,
}: RelativeVolumeBadgeProps) {
  const value = resolveRelativeVolume(relativeVolume10d, volumeRatio10dVs20d);

  // القيمة العددية موجودة → قرر بناءً عليها.
  if (value != null) {
    if (value <= threshold) return null; // طبيعي → لا شارة.
    const intensity = value >= 2 ? 'high' : 'med'; // ≥2x = شديد، 1.2–2x = متوسط.
    return (
      <Badge
        variant="outline"
        className={cn(
          'gap-1 font-mono font-semibold whitespace-nowrap border-warning/30 bg-warning/10 text-warning',
          size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5',
          intensity === 'high' && 'border-loss/40 bg-loss/10 text-loss',
          className,
        )}
        title={`الحجم النسبي ${value.toFixed(2)}x — أعلى من المعدل الطبيعي (${threshold}x)`}
      >
        <Activity className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        {showValue ? `${value.toFixed(2)}x` : 'حجم مرتفع'}
      </Badge>
    );
  }

  // مفيش قيمة عددية → اعتمد على علم volume_surge لو موجود.
  if (volumeSurge) {
    return (
      <Badge
        variant="outline"
        className={cn(
          'gap-1 whitespace-nowrap border-warning/30 bg-warning/10 text-warning',
          size === 'sm' ? 'text-[10px] px-1.5 py-0' : 'text-xs px-2 py-0.5',
          className,
        )}
        title="حجم تداول غير طبيعي (إشارة من الـ backend)"
      >
        <Activity className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
        حجم مرتفع
      </Badge>
    );
  }

  // مفيش أي إشارة → لا تعرض شيئًا (no fabrication).
  return null;
}

export default RelativeVolumeBadge;
