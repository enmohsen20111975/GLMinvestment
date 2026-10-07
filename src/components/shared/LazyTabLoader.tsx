'use client';

/**
 * LazyTabLoader — Reusable loading skeleton for lazy-loaded tabs (Phase 3)
 * =======================================================================
 *
 * المشكلة (قبل Phase 3):
 *   لما المستخدم يفتح تبويب تقيل (زي AdminView أو MaestroCommandCenter)،
 *   next/dynamic بتحمّل الـ chunk في الخلفية، بس مفيش أي feedback مرئي →
 *   المستخدم بيشوف شاشة بيضا فاضية لـ 500ms-2s.
 *
 * الحل:
 *   Skeleton فيه spinner + رسالة "بيتحمّل التبويب..." بالعربي.
 *   بيتستخدم في `next/dynamic({ loading: () => <LazyTabLoader /> })`.
 *
 * Usage:
 *   const HeavyComp = dynamic(() => import('./Heavy'), {
 *     ssr: false,
 *     loading: () => <LazyTabLoader label="لوحة الأدمن" />,
 *   });
 *
 * Author: دليل الاستثمار (Phase 3 — Arteries Cleanup & Fast Boot)
 */

import React from 'react';
import { Loader2 } from 'lucide-react';

interface LazyTabLoaderProps {
  /** اسم التبويب اللي بيتحمّل (للـ accessibility + الـ context) */
  label?: string;
  /** ارتفاع الـ container (default: h-96) */
  height?: string;
  /** فئة إضافية للـ wrapper */
  className?: string;
}

export function LazyTabLoader({
  label = 'التبويب',
  height = 'h-96',
  className = '',
}: LazyTabLoaderProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center ${height} ${className}`}
      role="status"
      aria-live="polite"
      aria-label={`بيتحمّل ${label}`}
      dir="rtl"
    >
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mb-3" />
      <p className="text-sm text-muted-foreground">
        بيتحمّل {label}...
      </p>
      <span className="sr-only">جارٍ تحميل {label}</span>
    </div>
  );
}

/**
 * Lightweight inline loader — for smaller lazy-loaded widgets (no full-height block).
 */
export function LazyInlineLoader({ label = 'العنصر' }: { label?: string }) {
  return (
    <div
      className="flex items-center justify-center py-4"
      role="status"
      aria-live="polite"
      dir="rtl"
    >
      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground ml-2" />
      <span className="text-xs text-muted-foreground">بيتحمّل {label}...</span>
    </div>
  );
}

export default LazyTabLoader;
