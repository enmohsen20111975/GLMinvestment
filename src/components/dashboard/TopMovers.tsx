'use client';

import React from 'react';
import { TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn, safeNum } from '@/lib/utils';
import type { StockMini } from '@/types';

function MoverItem({ stock, type }: { stock: StockMini; type: 'gainer' | 'loser' }) {
  const isGainer = type === 'gainer';
  const changeValue = stock.price_change ?? 0;

  return (
    <div
      className={cn(
        'flex items-center gap-2 px-2.5 py-2 rounded-lg transition-colors duration-150',
        isGainer
          ? 'hover:bg-emerald-50/60 dark:hover:bg-emerald-950/20'
          : 'hover:bg-red-50/60 dark:hover:bg-red-950/20'
      )}
    >
      {/* Icon */}
      <div
        className={cn(
          'flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center',
          isGainer
            ? 'bg-emerald-100 dark:bg-emerald-900/40'
            : 'bg-red-100 dark:bg-red-900/40'
        )}
      >
        {isGainer ? (
          <ArrowUpRight className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
        ) : (
          <ArrowDownRight className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
        )}
      </div>

      {/* Ticker & Name */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-foreground tabular-nums">
            {stock.ticker}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
          {stock.name_ar}
        </p>
      </div>

      {/* Price & Change */}
      <div className="flex-shrink-0 text-left" dir="ltr">
        <p className="text-xs font-semibold text-foreground tabular-nums">
          {safeNum(stock.current_price).toFixed(2)}
        </p>
        <p
          className={cn(
            'text-[10px] font-bold tabular-nums flex items-center gap-0.5 justify-end',
            isGainer
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-red-600 dark:text-red-400'
          )}
        >
          {isGainer ? (
            <TrendingUp className="w-3 h-3" />
          ) : (
            <TrendingDown className="w-3 h-3" />
          )}
          {changeValue >= 0 ? '+' : ''}
          {safeNum(changeValue).toFixed(2)}%
        </p>
      </div>
    </div>
  );
}

function MoverList({ stocks, type }: { stocks: StockMini[]; type: 'gainer' | 'loser' }) {
  if (stocks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
        <p className="text-sm">لا توجد بيانات</p>
      </div>
    );
  }

  return (
    <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-0.5">
      {stocks.map((stock) => (
        <MoverItem key={stock.ticker} stock={stock} type={type} />
      ))}
    </div>
  );
}

export function TopMovers() {
  const { marketOverview } = useAppStore();

  if (!marketOverview) return null;

  const { top_gainers, top_losers } = marketOverview;

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-1 px-3 pt-2.5">
        <CardTitle className="text-xs font-bold" dir="rtl">
          الأكثر تحركاً
        </CardTitle>
      </CardHeader>
      <CardContent className="px-2 pb-2.5">
        <Tabs defaultValue="gainers" dir="rtl">
          <TabsList className="w-full mb-1.5">
            <TabsTrigger
              value="gainers"
              className="flex-1 gap-1.5 data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-700 dark:data-[state=active]:bg-emerald-900/40 dark:data-[state=active]:text-emerald-300"
            >
              <TrendingUp className="w-3.5 h-3.5" />
              المرتفعة
            </TabsTrigger>
            <TabsTrigger
              value="losers"
              className="flex-1 gap-1.5 data-[state=active]:bg-red-100 data-[state=active]:text-red-700 dark:data-[state=active]:bg-red-900/40 dark:data-[state=active]:text-red-300"
            >
              <TrendingDown className="w-3.5 h-3.5" />
              المنخفضة
            </TabsTrigger>
          </TabsList>

          <TabsContent value="gainers" className="mt-0">
            <MoverList stocks={top_gainers} type="gainer" />
          </TabsContent>
          <TabsContent value="losers" className="mt-0">
            <MoverList stocks={top_losers} type="loser" />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
