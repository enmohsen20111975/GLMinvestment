/**
 * sharia-view/ShariaStockRowCard.tsx
 * =================================
 * Stock row card — per-stock Sharia status display.
 *
 * Extracted from ShariaView.tsx (1,478 LOC) in Task F-Phase3-FinalPush.
 * Renders symbol + status badge + consensus tag + purification-rate tile.
 */

import React from 'react';
import { Award } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import {
  STATUS_BADGE_CLASS,
  STATUS_EMOJI,
  STATUS_LABELS_AR,
  type ShariaRow,
} from './types';
import { deriveOverallStatus, formatPct, IslamicPattern } from './helpers';

export interface StockCardProps {
  row: ShariaRow;
  onOpenDetail: (symbol: string) => void;
}

export function ShariaStockRowCard({ row, onOpenDetail }: StockCardProps) {
  const status = deriveOverallStatus(row);
  const compliantCount = Number(row.compliant_sources_count ?? 0);
  const activeCount = Number(row.active_sources_count ?? 0);
  const purificationRate = row.purification_rate ?? row.sp_haram_earning_pct ?? null;

  return (
    <Card
      className="relative overflow-hidden border border-border hover:border-profit dark:hover:border-profit transition-colors cursor-pointer group"
      onClick={() => onOpenDetail(row.symbol)}
    >
      <IslamicPattern />
      <CardContent className="relative p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-profit text-base">
                {row.symbol}
              </span>
              <span className={cn('text-xs px-1.5 py-0.5 rounded-full border', STATUS_BADGE_CLASS[status])}>
                {STATUS_EMOJI[status]} {STATUS_LABELS_AR[status]}
              </span>
              {row.is_halal_consensus === 1 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full border border-warning bg-warning/10 text-warning dark:text-warning border border-warning/20 ">
                  <Award className="w-2.5 h-2.5 inline ml-0.5" />
                  إجماع
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground truncate mt-1">
              {row.name_ar || '—'}
            </p>
            {row.category_ar && (
              <p className="text-xs text-muted-foreground/70 mt-0.5">
                {row.category_ar}
              </p>
            )}
          </div>

          <div className="text-left flex-shrink-0 space-y-1">
            <div className="text-xs text-muted-foreground">نسبة التطهير (S&P)</div>
            <div className="text-sm font-bold tabular-nums text-warning " dir="ltr">
              {formatPct(purificationRate)}
            </div>
            <div className="text-xs text-muted-foreground">
              {compliantCount}/{activeCount || 8} مصدر
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
