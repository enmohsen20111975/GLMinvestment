'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Coins, TrendingUp, TrendingDown, Minus, RefreshCw, Clock, ChevronDown, ChevronUp, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn, safeNum } from '@/lib/utils';

interface GoldApiResponse {
  success: boolean;
  source: string;
  fetched_at: string;
  prices: {
    karats: Array<{ key: string; name_ar: string; price_per_gram: number; change: number | null; currency: string }>;
    ounce: { price: number; change: number | null; currency: string; name_ar: string } | null;
    silver: { price_per_gram: number; change: number | null; currency: string; name_ar: string } | null;
    silver_ounce: { price: number; change: number | null; currency: string; name_ar: string } | null;
    bullion: Array<{ key: string; name_ar: string; price: number; change: number | null }>;
  };
  last_updated: string;
}

function ChangeIndicator({ change }: { change: number | null }) {
  if (change === null || Math.abs(change) < 0.01) {
    return (
      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
        <Minus className="w-2.5 h-2.5" />
        0.00
      </span>
    );
  }

  const isPositive = change > 0;

  return (
    <span
      className={cn(
        'text-[10px] font-bold tabular-nums flex items-center gap-0.5',
        isPositive
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-red-600 dark:text-red-400'
      )}
    >
      {isPositive ? (
        <TrendingUp className="w-2.5 h-2.5" />
      ) : (
        <TrendingDown className="w-2.5 h-2.5" />
      )}
      {isPositive ? '+' : ''}{safeNum(change).toFixed(2)}
    </span>
  );
}

function formatNumber(num: number): string {
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const KARAT_COLORS: Record<string, string> = {
  '24': 'bg-amber-400 dark:bg-amber-500',
  '22': 'bg-amber-400/80 dark:bg-amber-500/80',
  '21': 'bg-amber-500 dark:bg-amber-600',
  '18': 'bg-amber-600 dark:bg-amber-700',
  '16': 'bg-amber-700 dark:bg-amber-800',
  '14': 'bg-amber-800 dark:bg-amber-900',
  '12': 'bg-yellow-700 dark:bg-yellow-800',
  '10': 'bg-yellow-800 dark:bg-yellow-900',
  '8': 'bg-yellow-900 dark:bg-yellow-950',
};

export function GoldMarketCompact() {
  const [data, setData] = useState<GoldApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [isOpen, setIsOpen] = useState(true);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const res = await fetch('/api/market/gold', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!mounted) return;
      await fetchData();
    })();
    return () => { mounted = false; };
  }, [fetchData]);

  if (loading) {
    return (
      <Card className="border-0 shadow-sm">
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded-md" />
            <Skeleton className="h-4 w-32" />
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="rounded-lg bg-muted/50 p-2">
                <Skeleton className="h-3 w-10 mb-1" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error || !data?.prices) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
            <Coins className="w-6 h-6 mb-2 opacity-30" />
            <p className="text-xs">لا توجد بيانات ذهب متاحة</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { karats, ounce, silver, silver_ounce } = data.prices;

  return (
    <Card className="border-0 shadow-sm">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CardHeader className="pb-2 px-4 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2" dir="rtl">
              <div className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/50 flex items-center justify-center">
                <Coins className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              </div>
              <CardTitle className="text-sm font-bold">أسعار الذهب والفضة</CardTitle>
              {data.last_updated && (
                <span className="text-[10px] text-muted-foreground hidden sm:flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  {new Date(data.last_updated).toLocaleDateString('ar-EG')}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fetchData(true)}
                disabled={refreshing}
                className="p-1.5 rounded-md hover:bg-muted/80 transition-colors disabled:opacity-50"
                title="تحديث"
              >
                <RefreshCw className={cn('w-3.5 h-3.5 text-muted-foreground', refreshing && 'animate-spin')} />
              </button>
              <CollapsibleTrigger asChild>
                <button className="p-1.5 rounded-md hover:bg-muted/80 transition-colors">
                  {isOpen ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  )}
                </button>
              </CollapsibleTrigger>
            </div>
          </div>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="px-4 pb-4" dir="rtl">
            {/* Gold Karats Grid */}
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2 mb-3">
              {karats.map((karat) => (
                <div
                  key={karat.key}
                  className="rounded-lg bg-muted/50 p-2 flex flex-col items-center gap-1 hover:bg-muted/80 transition-colors"
                >
                  <div className="flex items-center gap-1">
                    <div className={cn('w-2 h-2 rounded-full', KARAT_COLORS[karat.key] || 'bg-amber-500')} />
                    <span className="text-[10px] font-semibold text-foreground">{karat.name_ar}</span>
                  </div>
                  <p className="text-xs font-bold text-foreground tabular-nums" dir="ltr">
                    {formatNumber(karat.price_per_gram)}
                  </p>
                  <ChangeIndicator change={karat.change} />
                </div>
              ))}
            </div>

            {/* Ounce + Silver Row */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* Gold Ounce */}
              {ounce && ounce.price > 0 && (
                <div className="rounded-lg border border-amber-200/50 dark:border-amber-800/30 bg-amber-50/50 dark:bg-amber-950/20 p-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-gradient-to-br from-amber-400 to-yellow-300 dark:from-amber-500 dark:to-amber-400" />
                    <span className="text-[11px] text-muted-foreground font-medium">
                      أونصة ذهب ({ounce.currency})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground tabular-nums" dir="ltr">
                      {formatNumber(ounce.price)}
                    </span>
                    <ChangeIndicator change={ounce.change} />
                  </div>
                </div>
              )}

              {/* Silver (gram) */}
              {silver && silver.price_per_gram > 0 && (
                <div className="rounded-lg border border-slate-200/50 dark:border-slate-700/30 bg-slate-50/50 dark:bg-slate-900/20 p-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-gradient-to-br from-slate-400 to-slate-300 dark:from-slate-500 dark:to-slate-400" />
                    <span className="text-[11px] font-semibold text-foreground">
                      فضة (جرام)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground tabular-nums" dir="ltr">
                      {formatNumber(silver.price_per_gram)}
                    </span>
                    <ChangeIndicator change={silver.change} />
                  </div>
                </div>
              )}

              {/* Silver Ounce */}
              {silver_ounce && silver_ounce.price > 0 && (
                <div className="rounded-lg border border-slate-200/50 dark:border-slate-700/30 bg-slate-50/50 dark:bg-slate-900/20 p-2.5 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-gradient-to-br from-slate-400 to-slate-300 dark:from-slate-500 dark:to-slate-400" />
                    <span className="text-[11px] text-muted-foreground font-medium">
                      أونصة فضة ({silver_ounce.currency})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground tabular-nums" dir="ltr">
                      {formatNumber(silver_ounce.price)}
                    </span>
                    <ChangeIndicator change={silver_ounce.change} />
                  </div>
                </div>
              )}
            </div>

            {/* Source note */}
            <p className="text-[9px] text-muted-foreground text-center mt-2">
              * الأسعار تقريبية للاطلاع العام وليست توصيات استثمارية
            </p>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
