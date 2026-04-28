'use client';

import React from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent } from '@/components/ui/card';
import { cn, safeNum } from '@/lib/utils';
import type { MarketIndex } from '@/types';

function IndexSymbolBadge({ symbol }: { symbol: string }) {
  const match = symbol.match(/(\d+)/);
  const number = match ? match[1] : '';
  const prefix = symbol.replace(/\d/g, '');

  return (
    <div className="absolute -left-2 -bottom-1 text-7xl font-black opacity-[0.04] leading-none select-none pointer-events-none">
      <span className="text-8xl">{number}</span>
    </div>
  );
}

function IndexCard({ index }: { index: MarketIndex }) {
  const isPositive = index.change >= 0;

  // Color coding per index
  const colorMap: Record<string, { accent: string; ring: string; text: string }> = {
    EGX30: { accent: 'bg-emerald-500', ring: 'ring-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400' },
    EGX70: { accent: 'bg-amber-500', ring: 'ring-amber-500/20', text: 'text-amber-600 dark:text-amber-400' },
    EGX100: { accent: 'bg-teal-500', ring: 'ring-teal-500/20', text: 'text-teal-600 dark:text-teal-400' },
    EGX33: { accent: 'bg-rose-500', ring: 'ring-rose-500/20', text: 'text-rose-600 dark:text-rose-400' },
  };
  const colors = colorMap[index.symbol] || colorMap.EGX30;

  return (
    <Card className="relative overflow-hidden border-0 shadow-sm hover:shadow-md transition-shadow duration-200 group">
      <IndexSymbolBadge symbol={index.symbol} />
      <CardContent className="p-2.5 relative z-10">
        {/* Index identifier pill */}
        <div className="flex items-center justify-between mb-1.5">
          <span className={cn(
            'inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide',
            colors.ring,
            isPositive
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
              : 'bg-red-50 text-red-700 dark:bg-red-950/60 dark:text-red-300'
          )}>
            {index.symbol}
          </span>
          {isPositive ? (
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
          ) : (
            <TrendingDown className="w-3.5 h-3.5 text-red-500" />
          )}
        </div>

        {/* Index Arabic name */}
        <p className="text-[10px] font-medium text-muted-foreground mb-0.5 truncate">
          {index.name_ar}
        </p>

        {/* Current value */}
        <p className="text-base font-bold tabular-nums text-foreground mb-1">
          {index.value.toLocaleString('ar-EG', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </p>

        {/* Change row */}
        <div className="flex items-center gap-1.5">
          <span className={cn(
            'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums',
            isPositive
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
              : 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
          )}>
            {isPositive ? '+' : ''}
            {safeNum(index.change_percent).toFixed(2)}%
          </span>
          <span className={cn(
            'text-[11px] font-medium tabular-nums',
            isPositive
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
          )}>
            {isPositive ? '+' : ''}
            {safeNum(index.change).toFixed(2)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export function IndexCards() {
  const { marketOverview } = useAppStore();

  if (!marketOverview) return null;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2" dir="rtl">
      {marketOverview.indices.map((index) => (
        <IndexCard key={index.symbol} index={index} />
      ))}
    </div>
  );
}
