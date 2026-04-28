'use client';

import React from 'react';
import {
  BarChart3,
  TrendingUp,
  TrendingDown,
  Minus,
  CircleDot,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function MarketSummary() {
  const { marketOverview } = useAppStore();

  if (!marketOverview) return null;

  const { summary, market_status } = marketOverview;

  const stats = [
    {
      label: 'إجمالي الأسهم',
      value: summary.total_stocks,
      icon: BarChart3,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    },
    {
      label: 'المرتفعة',
      value: summary.gainers,
      icon: TrendingUp,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
    },
    {
      label: 'المنخفضة',
      value: summary.losers,
      icon: TrendingDown,
      color: 'text-red-600 dark:text-red-400',
      bg: 'bg-red-50 dark:bg-red-950/40',
    },
    {
      label: 'السوق',
      value: market_status.is_open ? 'مفتوح' : 'مغلق',
      icon: CircleDot,
      color: market_status.is_open
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-amber-600 dark:text-amber-400',
      bg: market_status.is_open
        ? 'bg-emerald-50 dark:bg-emerald-950/40'
        : 'bg-amber-50 dark:bg-amber-950/40',
      badge: market_status.is_open ? (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          متداول
        </span>
      ) : (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          متوقف
        </span>
      ),
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
                  {stat.label === 'المرتفعة' && (
                    <div className="mt-1.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                      <span className="w-1 h-1 rounded-full bg-emerald-500" />
                      {summary.unchanged} بدون تغيير
                    </div>
                  )}
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
