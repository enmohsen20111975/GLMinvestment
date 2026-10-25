/**
 * specialist/primitives.tsx — Reusable visual primitives for SpecialistAnalysisView.
 * =====================================================================
 * F-Phase3-Split-Specialist: extracted from SpecialistAnalysisView.tsx (lines 156–292).
 * - MetricRow: label + value row (used by LiquidityFootprintSection, etc.)
 * - PriceTile: square tile with label/value/optional sub-text (used by many sections)
 * - SectionCard: titled card with accent-color icon header (the universal container)
 * - SkeletonCard: shimmer placeholder for loading state
 * - EmptyState: dashed-box "لا توجد بيانات" message
 * - StockIcon: image-or-gradient-circle fallback for stock ticker icons
 *
 * Rule 30 — emerald (positive) / amber (warning) / red (negative) / slate (neutral).
 * Background: white (light) / slate-950 (dark). NO indigo/blue primary.
 */
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

// ============================================================================
// MetricRow — label/value row (used by LiquidityFootprintSection)
// ============================================================================

export function MetricRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs sm:text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-bold ${valueClass ?? ''}`}>{value}</span>
    </div>
  );
}

// ============================================================================
// PriceTile — square tile with label/value/optional sub-text
// ============================================================================

export function PriceTile({
  label,
  value,
  color,
  sub,
}: {
  label: string;
  value: string;
  color?: string;
  sub?: string;
}) {
  return (
    <div className="text-center p-2.5 bg-slate-50/60 rounded-lg border border-border">
      <p className="text-xs sm:text-xs text-muted-foreground">{label}</p>
      <p className={`text-sm sm:text-base font-bold mt-1 ${color ?? 'text-muted-foreground dark:text-slate-200'}`}>
        {value}
      </p>
      {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

// ============================================================================
// SectionCard — the universal titled card container
// ============================================================================

export function SectionCard({
  icon,
  title,
  description,
  accent,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description?: string;
  accent: 'emerald' | 'amber' | 'red' | 'slate';
  children: React.ReactNode;
}) {
  const accentMap = {
    emerald: 'text-profit bg-profit/10 border-profit/20',
    amber: 'text-warning bg-warning/10 border-warning/20',
    red: 'text-loss bg-loss/10 border-loss/20',
    slate: 'text-muted-foreground bg-slate-50/60 border-border',
  } as const;
  return (
    <Card className="bg-white border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
          <span className={`inline-flex items-center justify-center w-8 h-8 rounded-md border ${accentMap[accent]}`}>
            {icon}
          </span>
          {title}
        </CardTitle>
        {description && <CardDescription className="text-xs sm:text-sm">{description}</CardDescription>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ============================================================================
// SkeletonCard — shimmer placeholder for loading state
// ============================================================================

export function SkeletonCard() {
  return (
    <Card className="bg-white border-border">
      <CardContent className="pt-6">
        <div className="space-y-3">
          <div className="h-4 w-1/3 bg-muted dark:bg-slate-700 rounded shimmer" />
          <div className="h-8 w-2/3 bg-muted dark:bg-slate-700 rounded shimmer" />
          <div className="h-3 w-1/2 bg-muted dark:bg-slate-700 rounded shimmer" />
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// EmptyState — dashed-box "لا توجد بيانات" message
// ============================================================================

export function EmptyState({ msg }: { msg: string }) {
  return (
    <div className="p-3 bg-slate-50/40 rounded-lg border border-dashed border-border text-center">
      <p className="text-xs text-muted-foreground italic">{msg}</p>
    </div>
  );
}

// ============================================================================
// StockIcon — image with colored-circle fallback (per owner: «حتى الايقونة مش موجودة»)
// ============================================================================

export function StockIcon({
  symbol,
  iconUrl,
  size = 'md',
}: {
  symbol: string;
  iconUrl?: string | null;
  size?: 'sm' | 'md' | 'lg';
}) {
  const sizeMap = {
    sm: 'w-9 h-9 text-sm',
    md: 'w-11 h-11 sm:w-12 sm:h-12 text-base',
    lg: 'w-16 h-16 sm:w-20 sm:h-20 text-xl',
  };
  const cls = sizeMap[size];
  const initials = (symbol || '?').slice(0, 2).toUpperCase();

  // Stable color derived from the ticker — same ticker → same color.
  const palette = [
    'from-profit to-profit',
    'from-warning to-warning',
    'from-loss to-loss',
    'from-whale to-whale',
    'from-orange-500 to-orange-700',
    'from-lime-500 to-lime-700',
  ];
  const colorIdx = (symbol || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % palette.length;
  const gradient = palette[colorIdx];

  if (iconUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={iconUrl}
        alt={symbol}
        className={`${cls} rounded-xl object-cover border-2 border-border shadow-sm bg-white`}
        crossOrigin="anonymous"
        referrerPolicy="no-referrer"
        onError={(e) => {
          // Hide broken image so the fallback below shows instead.
          (e.currentTarget as HTMLImageElement).style.display = 'none';
        }}
      />
    );
  }

  return (
    <div
      className={`${cls} rounded-xl ${gradient} flex items-center justify-center text-foreground font-bold border-2 border-white/20 shadow-sm`}
      aria-label={`${symbol} icon`}
    >
      {initials}
    </div>
  );
}
