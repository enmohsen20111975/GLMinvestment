'use client';

import React from 'react';
import { useAppStore } from '@/lib/store';
import { WidgetStat, WidgetStatGrid } from '@/components/shared/WidgetStat';

export function MarketSummary() {
  const { marketOverview } = useAppStore();

  if (!marketOverview) return null;

  const { summary } = marketOverview;

  if (!summary) return null;

  return (
    <WidgetStatGrid cols={4}>
      <WidgetStat
        label="إجمالي الأسهم"
        value={summary.total_stocks ?? 0}
        valueClass="text-profit"
      />
      <WidgetStat
        label="المرتفعة"
        value={summary.gainers ?? 0}
        valueClass="text-profit"
      />
      <WidgetStat
        label="المنخفضة"
        value={summary.losers ?? 0}
        valueClass="text-loss"
      />
      <WidgetStat
        label="بدون تغيير"
        value={summary.unchanged ?? 0}
        valueClass="text-muted-foreground"
      />
    </WidgetStatGrid>
  );
}
