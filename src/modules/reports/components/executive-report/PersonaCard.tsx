/**
 * executive-report/PersonaCard.tsx
 * ================================
 * Persona strategy card (gambler / balanced / conservative). Used 3× in the
 * persona breakdown grid. Internally renders <StatRow /> children.
 *
 * Extracted from the original `ExecutiveReportView.tsx` (2,087 LOC) as part of
 * Task F-Phase3-Split-Reports+Edu (Rule 73 — Phase 3 strangler-fig split).
 */

import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { PersonaStats } from './types';

export interface PersonaCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  accentRing: string;
  accentBar: string;
  stats: PersonaStats;
  winRateColor: string;
}

export function PersonaCard({
  icon,
  title,
  subtitle,
  description,
  accentRing,
  accentBar,
  stats,
  winRateColor,
}: PersonaCardProps) {
  return (
    <div className={cn('relative bg-card p-6 rounded-2xl border space-y-4 overflow-hidden', accentRing)}>
      <div className={cn('absolute top-0 right-0 w-1.5 h-full', accentBar)} />

      {/* Header */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {icon}
            <span className="font-black text-lg text-foreground">{title}</span>
          </div>
          <Badge variant="outline" className="text-xs text-foreground border-white/20 bg-white/5 whitespace-nowrap">
            {subtitle}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground mt-1.5">{description}</p>
      </div>

      {/* Big win rate */}
      <div className="py-3 border-y border-white/10 text-center">
        <p className="text-xs text-muted-foreground font-bold mb-1">نسبة النجاح</p>
        <p className={cn('text-3xl font-black leading-none', winRateColor)}>
          {(stats.winRate ?? 0).toFixed(1)}%
        </p>
      </div>

      {/* Stats grid — unified, clean */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <StatRow
          label="معامل الربحية"
          value={stats.profitFactor >= 999 ? '∞' : (stats.profitFactor ?? 0).toFixed(2)}
          valueClass="text-warning"
        />
        <StatRow
          label="متوسط الربح"
          value={`+${(stats.avgWinPct ?? 0).toFixed(1)}%`}
          valueClass="text-profit"
        />
        <StatRow label="رابحة" value={`${stats.wins}`} valueClass="text-profit" />
        <StatRow label="خاسرة" value={`${stats.losses}`} valueClass="text-loss" />
      </div>
    </div>
  );
}

function StatRow({
  label,
  value,
  valueClass,
}: {
  label: string;
  value: string;
  valueClass: string;
}) {
  return (
    <div className="bg-muted px-3 py-2 rounded-lg border border-white/5">
      <p className="text-xs text-muted-foreground leading-tight">{label}</p>
      <p className={cn('font-black text-base mt-0.5', valueClass)}>{value}</p>
    </div>
  );
}
