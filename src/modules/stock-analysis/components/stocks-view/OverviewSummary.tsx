/**
 * stocks-view/OverviewSummary.tsx
 * ============================================================================
 * F-Phase3-Split-StocksView: Overview summary bar (total / gainers / losers /
 * unchanged / avgChange).
 *
 * UI-STABILITY fix (2026-09-28): wrapped in React.memo so it doesn't re-render
 * when parent state changes that don't affect its props.
 * ============================================================================
 */

import { memo } from 'react';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn, safeNum } from '@/lib/utils';
import type { OverviewSummaryProps } from './types';

export const OverviewSummary = memo(function OverviewSummary({
  total,
  gainers,
  losers,
  unchanged,
  avgChange,
}: OverviewSummaryProps) {
  return (
    <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
      <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">الإجمالي</span>
        <span className="text-sm font-bold">{total}</span>
      </div>
      <div className="flex items-center gap-1.5 bg-profit/10 rounded-lg px-3 py-1.5">
        <TrendingUp className="w-3.5 h-3.5 text-profit " />
        <span className="text-xs font-medium text-profit ">المرتفعة</span>
        <span className="text-sm font-bold text-profit ">{gainers}</span>
      </div>
      <div className="flex items-center gap-1.5 bg-loss/10 rounded-lg px-3 py-1.5">
        <TrendingDown className="w-3.5 h-3.5 text-loss " />
        <span className="text-xs font-medium text-loss ">المنخفضة</span>
        <span className="text-sm font-bold text-loss ">{losers}</span>
      </div>
      <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
        <Minus className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">الثابتة</span>
        <span className="text-sm font-bold">{unchanged}</span>
      </div>
      <div className="flex items-center gap-1.5 bg-muted/60 rounded-lg px-3 py-1.5">
        <span className="text-xs font-medium text-muted-foreground">متوسط التغير</span>
        <span
          className={cn(
            'text-sm font-bold tabular-nums',
            avgChange > 0
              ? 'text-profit '
              : avgChange < 0
                ? 'text-loss '
                : 'text-muted-foreground'
          )}
        >
          {avgChange >= 0 ? '+' : ''}
          {safeNum(avgChange).toFixed(2)}%
        </span>
      </div>
    </div>
  );
});
