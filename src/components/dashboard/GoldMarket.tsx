'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Coins, TrendingUp, TrendingDown, Minus, RefreshCw, Clock, ChevronDown, ChevronUp, Package } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { cn, safeNum } from '@/lib/utils';

interface KaratPrice {
  key: string;
  name_ar: string;
  price_per_gram: number;
  change: number | null;
  currency: string;
}

interface OuncePrice {
  price: number;
  change: number | null;
  currency: string;
  name_ar: string;
}

interface SilverPrice {
  price_per_gram: number;
  change: number | null;
  currency: string;
  name_ar: string;
}

interface BullionItem {
  key: string;
  name_ar: string;
  price: number;
  change: number | null;
}

interface GoldPrices {
  karats: KaratPrice[];
  ounce: OuncePrice | null;
  silver: SilverPrice | null;
  silver_ounce: OuncePrice | null;
  bullion: BullionItem[];
}

interface GoldApiResponse {
  success: boolean;
  source: string;
  fetched_at: string;
  prices: GoldPrices;
  last_updated: string;
}

type TabType = 'gold' | 'silver' | 'bullion';

function GoldSkeleton() {
  return (
    <Card className="border-0 shadow-sm">
      <CardHeader className="pb-1 px-3 pt-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-5 w-5 rounded-md" />
          <Skeleton className="h-4 w-24" />
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="rounded-lg bg-muted/50 p-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="h-4 w-4 rounded-full" />
              <Skeleton className="h-3.5 w-16" />
            </div>
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
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

// Karat color mapping
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

export function GoldMarket() {
  const [data, setData] = useState<GoldApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('gold');
  const [showChart, setShowChart] = useState(false);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const res = await fetch('/api/market/gold', { cache: 'no-store' });
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

  if (loading) return <GoldSkeleton />;

  return (
    <Card className="border-0 shadow-sm h-full">
      <CardHeader className="pb-1 px-3 pt-3">
        <div className={cn(
          'absolute inset-x-0 top-0 h-12 rounded-t-xl',
          activeTab === 'gold'
            ? 'bg-gradient-to-l from-amber-400/20 via-yellow-300/15 to-amber-500/20 dark:from-amber-600/20 dark:via-yellow-500/10 dark:to-amber-700/20'
            : activeTab === 'silver'
              ? 'bg-gradient-to-l from-slate-300/20 via-slate-200/15 to-slate-400/20 dark:from-slate-500/20 dark:via-slate-400/10 dark:to-slate-600/20'
              : 'bg-gradient-to-l from-orange-400/20 via-amber-300/15 to-orange-500/20 dark:from-orange-600/20 dark:via-amber-500/10 dark:to-orange-700/20'
        )} style={{ zIndex: 0 }} />
        <CardTitle className="text-sm font-bold flex items-center gap-2 relative" dir="rtl">
          <div className={cn(
            'w-6 h-6 rounded-md flex items-center justify-center',
            activeTab === 'gold'
              ? 'bg-amber-100 dark:bg-amber-900/50'
              : activeTab === 'silver'
                ? 'bg-slate-100 dark:bg-slate-800/50'
                : 'bg-orange-100 dark:bg-orange-900/50'
          )}>
            {activeTab === 'bullion' ? (
              <Package className={cn(
                'w-3.5 h-3.5',
                activeTab === 'bullion' ? 'text-orange-600 dark:text-orange-400' : ''
              )} />
            ) : (
              <Coins className={cn(
                'w-3.5 h-3.5',
                activeTab === 'gold' ? 'text-amber-600 dark:text-amber-400' : 'text-slate-500 dark:text-slate-400'
              )} />
            )}
          </div>
          {activeTab === 'gold' ? 'أسعار الذهب' : activeTab === 'silver' ? 'أسعار الفضة' : 'السبائك'}
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="mr-auto p-1 rounded-md hover:bg-muted/80 transition-colors disabled:opacity-50"
            title="تحديث"
          >
            <RefreshCw className={cn('w-3 h-3 text-muted-foreground', refreshing && 'animate-spin')} />
          </button>
        </CardTitle>

        {/* Tabs */}
        <div className="flex gap-1 mt-1 relative" dir="rtl">
          <button
            onClick={() => setActiveTab('gold')}
            className={cn(
              'px-3 py-1 rounded-md text-[11px] font-semibold transition-all',
              activeTab === 'gold'
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 shadow-sm'
                : 'text-muted-foreground hover:bg-muted/50'
            )}
          >
            الذهب
          </button>
          <button
            onClick={() => setActiveTab('silver')}
            className={cn(
              'px-3 py-1 rounded-md text-[11px] font-semibold transition-all',
              activeTab === 'silver'
                ? 'bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300 shadow-sm'
                : 'text-muted-foreground hover:bg-muted/50'
            )}
          >
            الفضة
          </button>
          <button
            onClick={() => setActiveTab('bullion')}
            className={cn(
              'px-3 py-1 rounded-md text-[11px] font-semibold transition-all',
              activeTab === 'bullion'
                ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 shadow-sm'
                : 'text-muted-foreground hover:bg-muted/50'
            )}
          >
            السبائك
          </button>
        </div>
      </CardHeader>

      <CardContent className="p-3 pt-1" dir="rtl">
        {error || !data?.prices ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Coins className="w-8 h-8 mb-2 opacity-30" />
            <p className="text-xs">لا توجد بيانات متاحة</p>
          </div>
        ) : activeTab === 'gold' ? (
          <div className="space-y-1.5">
            {/* Gold Karat prices grid */}
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {(data.prices.karats || []).map((karat) => (
                <div
                  key={karat.key}
                  className="rounded-lg bg-muted/50 p-2 flex flex-col items-center gap-1 hover:bg-muted/80 transition-colors"
                >
                  <div className="flex items-center gap-1">
                    <div className={cn('w-2 h-2 rounded-full', KARAT_COLORS[karat.key] || 'bg-amber-500')} />
                    <span className="text-[11px] font-semibold text-foreground">{karat.name_ar}</span>
                  </div>
                  <p className="text-sm font-bold text-foreground tabular-nums" dir="ltr">
                    {formatNumber(karat.price_per_gram)}
                  </p>
                  <ChangeIndicator change={karat.change} />
                </div>
              ))}
            </div>

            {/* Gold Ounce price */}
            {data.prices.ounce && data.prices.ounce.price > 0 && (
              <div className="rounded-lg border border-amber-200/50 dark:border-amber-800/30 bg-amber-50/50 dark:bg-amber-950/20 p-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="w-3 h-3 rounded-full bg-gradient-to-br from-amber-400 to-yellow-300 dark:from-amber-500 dark:to-amber-400" />
                  <span className="text-[11px] text-muted-foreground font-medium">
                    الأونصة ({data.prices.ounce.currency})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-foreground tabular-nums" dir="ltr">
                    {formatNumber(data.prices.ounce.price)}
                  </span>
                  <ChangeIndicator change={data.prices.ounce.change} />
                </div>
              </div>
            )}

            {/* Last updated */}
            <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground pt-0.5">
              <Clock className="w-2.5 h-2.5" />
              <span>{lastRefresh
                ? lastRefresh.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
                : (data?.fetched_at ? new Date(data.fetched_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '--')}
              </span>
            </div>
          </div>
        ) : activeTab === 'silver' ? (
          /* Silver Tab */
          <div className="space-y-1.5">
            {data.prices.silver && data.prices.silver.price_per_gram > 0 && (
              <div className="rounded-lg border border-slate-200/50 dark:border-slate-700/30 bg-slate-50/50 dark:bg-slate-900/20 p-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-gradient-to-br from-slate-400 to-slate-300 dark:from-slate-500 dark:to-slate-400" />
                    <span className="text-[11px] font-semibold text-foreground">
                      فضة (جرام)
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground tabular-nums" dir="ltr">
                      {formatNumber(data.prices.silver.price_per_gram)}
                    </span>
                    <ChangeIndicator change={data.prices.silver.change} />
                  </div>
                </div>
                <p className="text-[9px] text-muted-foreground mt-0.5">ج.م / جرام</p>
              </div>
            )}

            {data.prices.silver_ounce && data.prices.silver_ounce.price > 0 && (
              <div className="rounded-lg border border-slate-200/50 dark:border-slate-700/30 bg-slate-50/50 dark:bg-slate-900/20 p-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-full bg-gradient-to-br from-slate-400 to-slate-300 dark:from-slate-500 dark:to-slate-400" />
                    <span className="text-[11px] font-semibold text-foreground">
                      أونصة فضة
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-foreground tabular-nums" dir="ltr">
                      {formatNumber(data.prices.silver_ounce.price)}
                    </span>
                    <ChangeIndicator change={data.prices.silver_ounce.change} />
                  </div>
                </div>
                <p className="text-[9px] text-muted-foreground mt-0.5">
                  {data.prices.silver_ounce.currency} / أونصة
                </p>
              </div>
            )}

            {/* Last updated */}
            <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground pt-0.5">
              <Clock className="w-2.5 h-2.5" />
              <span>{lastRefresh
                ? lastRefresh.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
                : (data?.fetched_at ? new Date(data.fetched_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '--')}
              </span>
            </div>
          </div>
        ) : (
          /* Bullion Tab */
          <div className="space-y-1.5">
            {data.prices.bullion && data.prices.bullion.length > 0 ? (
              <>
                <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-1.5">
                  {data.prices.bullion.map((item) => (
                    <div
                      key={item.key}
                      className="rounded-lg border border-orange-200/30 dark:border-orange-800/20 bg-orange-50/40 dark:bg-orange-950/10 p-2.5 flex items-center justify-between hover:bg-orange-50/70 dark:hover:bg-orange-950/20 transition-colors"
                    >
                      <div className="flex items-center gap-1.5">
                        <Package className="w-3 h-3 text-orange-500 dark:text-orange-400" />
                        <span className="text-[11px] font-semibold text-foreground">{item.name_ar}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-foreground tabular-nums" dir="ltr">
                          {formatNumber(item.price)}
                        </span>
                        <ChangeIndicator change={item.change} />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-[9px] text-muted-foreground text-center">
                  * الأسعار تقريبية تشمل قيمة الصياغة (عيار 24)
                </p>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
                <Package className="w-6 h-6 mb-1 opacity-30" />
                <p className="text-xs">لا توجد بيانات سبائك</p>
              </div>
            )}

            {/* Last updated */}
            <div className="flex items-center justify-center gap-1 text-[10px] text-muted-foreground pt-0.5">
              <Clock className="w-2.5 h-2.5" />
              <span>{lastRefresh
                ? lastRefresh.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })
                : (data?.fetched_at ? new Date(data.fetched_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }) : '--')}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
