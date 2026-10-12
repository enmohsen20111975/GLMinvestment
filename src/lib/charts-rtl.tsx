/**
 * charts-rtl.tsx — RTL-aware helpers for Recharts (PKG1 — Bilingual 100%)
 * ========================================================================
 * The scoping report found 26 Recharts files with ZERO RTL support.
 * Recharts (v2) doesn't honor `dir` on the container, so axis order,
 * tooltip position, and legend alignment need manual handling.
 *
 * This module provides:
 *   - `chartDirection()` — reads the current locale dir.
 *   - `rtlAxisProps()` — props that flip XAxis order for RTL.
 *   - `rtlYAxisProps()` — props that move YAxis to the right in RTL.
 *   - `rtlTooltipProps()` — props that anchor the tooltip correctly.
 *   - `ChartCard` — a wrapper that applies dir + consistent styling.
 *
 * Usage:
 *   import { rtlAxisProps, ChartCard } from '@/lib/charts-rtl';
 *   <ChartCard title={t('reports.winRate')}>
 *     <BarChart data={...}>
 *       <XAxis dataKey="label" {...rtlAxisProps()} />
 *       <YAxis {...rtlYAxisProps()} />
 *     </BarChart>
 *   </ChartCard>
 */

'use client';

import React from 'react';
import { useLocale } from '@/lib/i18n-context';

/** Returns 'rtl' | 'ltr' based on the active locale. */
export function useDirection(): 'rtl' | 'ltr' {
  const { locale } = useLocale();
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Props to apply to a Recharts <XAxis> for RTL support.
 * - `reversed` flips the category order so the latest value is on the RIGHT
 *   in RTL (Arabic readers expect time to flow right→left).
 * - `orientation="top"` is optional — uncomment to move axis to top in RTL.
 */
export function useRtlXAxisProps() {
  const dir = useDirection();
  return {
    reversed: dir === 'rtl',
    // In RTL, having the axis on top is a common convention.
    orientation: dir === 'rtl' ? ('top' as const) : ('bottom' as const),
  };
}

/**
 * Props to apply to a Recharts <YAxis> for RTL support.
 * Moves the YAxis to the RIGHT side in RTL (Arabic convention).
 */
export function useRtlYAxisProps() {
  const dir = useDirection();
  return {
    orientation: dir === 'rtl' ? ('right' as const) : ('left' as const),
  };
}

/**
 * Props for a Recharts <Tooltip> that respects direction.
 */
export function useRtlTooltipProps() {
  const dir = useDirection();
  return {
    // Recharts Tooltip doesn't have a direct dir prop, but offset direction
    // can be influenced. Wrapper style handles text alignment.
    wrapperStyle: { direction: dir as 'rtl' | 'ltr', textAlign: dir === 'rtl' ? 'right' : 'left' },
    contentStyle: { direction: dir as 'rtl' | 'ltr' },
  };
}

/**
 * ChartCard — a consistent wrapper for all charts that:
 *   - applies the correct `dir`
 *   - provides consistent padding + border
 *   - accepts a localized title
 */
export function ChartCard({
  title,
  subtitle,
  children,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const dir = useDirection();
  return (
    <div
      dir={dir}
      className={`rounded-lg border border-border bg-card p-4 ${className}`}
    >
      {title && (
        <div className="mb-3">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      )}
      <div style={{ direction: dir }}>{children}</div>
    </div>
  );
}

/**
 * Localizes a Recharts tick formatter based on locale.
 * Pass to `<XAxis tickFormatter={...} />`.
 */
export function useLocalizedTickFormatter(
  formatter: (value: any, locale: 'ar' | 'en') => string
) {
  const { locale } = useLocale();
  return (value: any) => formatter(value, locale);
}
