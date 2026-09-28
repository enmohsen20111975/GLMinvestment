'use client';

import React from 'react';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function MarketSummary() {
  const { marketOverview } = useAppStore();

  if (!marketOverview) return null;

  const { summary } = marketOverview;

  if (!summary) return null;

  const stats = [
    {
      label: 'إجمالي الأسهم',
      value: summary.total_stocks ?? 0,
      icon: BarChart3,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    },
    {
      label: 'المرتفعة',
      value: summary.gainers ?? 0,
      icon: TrendingUp,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    },
    {
      label: 'المنخفضة',
      value: summary.losers ?? 0,
      icon: TrendingDown,
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-50 dark:bg-red-950/40',
    },
    {
      label: 'بدون تغيير',
      value: summary.unchanged ?? 0,
      icon: Minus,
      color: 'text-slate-600 dark:text-slate-400',
      bg: 'bg-slate-50 dark:bg-slate-950/40',
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" dir="rtl">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <Card key={stat.label} className="overflow-hidden border-0 shadow-sm">
            <CardContent className="p-2.5">
              <div className="flex items-start justify-between gap-1.5">
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-medium text-muted-foreground mb-0.5 truncate">
                    {stat.label}
                  </p>
                  <p className={cn('text-lg font-bold tabular-nums', stat.color)}>
                    {stat.value}
                  </p>
                  {stat.badge && <div className="mt-1.5">{stat.badge}</div>}
                </div>
                <div className={cn('flex-shrink-0 p-1.5 rounded-md', stat.bg)}>
                  <Icon className={cn('w-3.5 h-3.5', stat.color)} />
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
