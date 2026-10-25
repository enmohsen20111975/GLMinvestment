/**
 * executive-report/KpiCard.tsx
 * ============================
 * One unified hero KPI card. Used 5× in the ExecutiveReportView KPI row.
 *
 * Extracted from the original `ExecutiveReportView.tsx` (2,087 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 */

import * as React from 'react';
import { cn } from '@/lib/utils';
import { KPI_ACCENTS } from './constants';

export interface KpiCardProps {
  label: string;
  value: string;
  valueSuffix?: string;
  subtext: string;
  accent: 'emerald' | 'amber' | 'rose';
  isSplit?: boolean;
  icon?: React.ReactNode;
}

export function KpiCard({
  label,
  value,
  valueSuffix,
  subtext,
  accent,
  isSplit = false,
  icon,
}: KpiCardProps) {
  const a = KPI_ACCENTS[accent];
  return (
    <div
      className={cn(
        'relative bg-card p-5 rounded-2xl border overflow-hidden flex flex-col justify-between min-h-[140px]',
        a.ring,
      )}
    >
      <div className={cn('absolute top-0 right-0 w-1.5 h-full', a.bar)} />
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-foreground font-bold leading-snug">{label}</p>
        {icon && <span className={cn('flex-shrink-0', a.value)}>{icon}</span>}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5 flex-wrap">
        <span className={cn('text-3xl sm:text-4xl font-black leading-none', a.value)}>
          {value}
        </span>
        {valueSuffix && (
          <span className="text-base font-bold text-muted-foreground">{valueSuffix}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{subtext}</p>
    </div>
  );
}
