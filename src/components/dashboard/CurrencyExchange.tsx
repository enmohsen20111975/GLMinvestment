'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { ArrowLeftRight, TrendingUp, TrendingDown, Minus, Star, RefreshCw, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn, safeNum } from '@/lib/utils';

interface CurrencyEntry {
  code: string;
  name_ar: string;
  buy_rate: number;
  sell_rate: number;
  change: number | null;
  last_updated: string;
}

interface CurrencyApiResponse {
  success: boolean;
  source: string;
  fetched_at: string;
  currencies: CurrencyEntry[];
  central_bank_rate: number;
}

const CURRENCY_FLAGS: Record<string, string> = {
  USD: '🇺🇸',
  EUR: '🇪🇺',
  GBP: '🇬🇧',
  SAR: '🇸🇦',
  AED: '🇦🇪',
  KWD: '🇰🇼',
};

function CurrencySkeleton() {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-1 px-3 pt-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded-md" />
          <Skeleton className="h-4 w-24" />
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        <div className="flex items-center gap-1 px-2 pb-2 border-b border-border">
          <Skeleton className="h-3 w-16 flex-1" />
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-3 w-14" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-1 px-2 py-1.5 rounded-lg">
            <div className="flex-1 flex items-center gap-1.5">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-12" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function formatRate(num: number): string {
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CurrencyExchange() {
  const [data, setData] = useState<CurrencyApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const res = await fetch('/api/market/currency', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch');
      const json = await res.json();
      setData(json);
      setError(false);
      setLastRefresh(new Date());
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

  // Auto-refresh every 5 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData();
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  if (loading) return <CurrencySkeleton />;

  return (
    <Card className="border-0 shadow-sm h-full">
      <CardHeader className="pb-1 px-3 pt-3">
        <div className="absolute inset-x-0 top-0 h-12 rounded-t-xl bg-gradient-to-l from-teal-400/15 via-cyan-300/10 to-teal-500/15 dark:from-teal-600/15 dark:via-cyan-500/8 dark:to-teal-700/15" style={{ zIndex: 0 }} />
        <CardTitle className="text-sm font-bold flex items-center gap-2 relative" dir="rtl">
          <div className="w-6 h-6 rounded-md bg-teal-100 dark:bg-teal-900/50 flex items-center justify-center">
            <ArrowLeftRight className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
          </div>
          أسعار الصرف
          <Badge variant="secondary" className="text-[10px] bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 px-1.5 py-0">
            مقابل الجنيه
          </Badge>
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="mr-auto p-1 rounded-md hover:bg-muted/80 transition-colors disabled:opacity-50"
            title="تحديث"
          >
            <RefreshCw className={cn('w-3 h-3 text-muted-foreground', refreshing && 'animate-spin')} />
          </button>
        </CardTitle>
      </CardHeader>

      <CardContent className="p-3 pt-1" dir="rtl">
        {error || !data?.currencies ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <ArrowLeftRight className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-xs">لا توجد بيانات متاحة</p>
          </div>
        ) : (
          <div>
            {/* Table header */}
            <div className="flex items-center gap-1 px-2 pb-1.5 mb-1 border-b border-border text-[10px] text-muted-foreground font-medium">
              <span className="flex-1">العملة</span>
              <span className="w-14 text-center">الشراء</span>
              <span className="w-14 text-center">البيع</span>
              <span className="w-10 text-center">التغير</span>
            </div>

            {/* Central bank rate */}
            {data.central_bank_rate > 0 && (
              <div className="px-2 py-1.5 mb-1">
                <span className="text-[10px] text-muted-foreground">
                  سعر البنك المركزي: <strong className="text-foreground tabular-nums" dir="ltr">{formatRate(data.central_bank_rate)}</strong> ج.م
                </span>
              </div>
            )}

            {/* Currency rows */}
            <div className="max-h-48 overflow-y-auto custom-scrollbar">
              {data.currencies.map((currency) => {
                const isMajor = currency.code === 'USD';
                const hasRates = currency.buy_rate > 0 || currency.sell_rate > 0;
                const spread = hasRates && currency.buy_rate > 0 && currency.sell_rate > 0
                  ? currency.sell_rate - currency.buy_rate
                  : 0;

                return (
                  <div
                    key={currency.code}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1.5 rounded-lg transition-colors hover:bg-muted/50',
                      isMajor && 'bg-teal-50/60 dark:bg-teal-950/20'
                    )}
                  >
                    {/* Currency info */}
                    <div className="flex-1 flex items-center gap-1.5 min-w-0">
                      <span className="text-sm flex-shrink-0" role="img" aria-label={currency.code}>
                        {CURRENCY_FLAGS[currency.code] || '💱'}
                      </span>
                      <span className="text-[11px] font-semibold text-foreground truncate">
                        {currency.code}
                      </span>
                      {isMajor && (
                        <Star className="w-2.5 h-2.5 text-teal-500 dark:text-teal-400 flex-shrink-0 fill-teal-500 dark:fill-teal-400" />
                      )}
                    </div>

                    {/* Buy rate */}
                    <span className="w-14 text-[11px] font-medium tabular-nums text-foreground text-center" dir="ltr">
                      {hasRates ? formatRate(currency.buy_rate) : '--'}
                    </span>

                    {/* Sell rate */}
                    <span className="w-14 text-[11px] font-medium tabular-nums text-foreground text-center" dir="ltr">
                      {hasRates ? formatRate(currency.sell_rate) : '--'}
                    </span>

                    {/* Change */}
                    <span
                      className={cn(
                        'w-10 text-[10px] font-bold tabular-nums text-center flex items-center justify-center gap-0.5',
                        currency.change === null || Math.abs(currency.change) < 0.01
                          ? 'text-muted-foreground'
                          : currency.change > 0
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-red-600 dark:text-red-400'
                      )}
                    >
                      {currency.change === null || Math.abs(currency.change) < 0.01 ? (
                        <Minus className="w-2.5 h-2.5" />
                      ) : currency.change > 0 ? (
                        <>
                          <TrendingUp className="w-2.5 h-2.5" />
                          +{safeNum(currency.change).toFixed(2)}
                        </>
                      ) : (
                        <>
                          <TrendingDown className="w-2.5 h-2.5" />
                          {safeNum(currency.change).toFixed(2)}
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Legend + Last updated */}
            <div className="flex items-center justify-between pt-1.5 mt-1 border-t border-border">
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                  <Star className="w-2 h-2 text-teal-500 fill-teal-500" />
                  الأهم
                </span>
                {data.currencies.some(c => c.buy_rate > 0 && c.sell_rate > 0) && (
                  <span className="text-[10px] text-muted-foreground">
                    الفرق: <strong className="text-foreground" dir="ltr">
                      {formatRate(data.currencies.find(c => c.code === 'USD')?.sell_rate 
                        ? (data.currencies.find(c => c.code === 'USD')!.sell_rate - data.currencies.find(c => c.code === 'USD')!.buy_rate) 
                        : 0)} قرش
                    </strong>
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <Clock className="w-2.5 h-2.5" />
                <span>
                  {lastRefresh
                    ? lastRefresh.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
                    : (data.fetched_at ? new Date(data.fetched_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '--')}
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
