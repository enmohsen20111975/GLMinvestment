'use client';

import React, { useState, useEffect } from 'react';
import {
  Calendar,
  TrendingUp,
  RefreshCw,
  Target,
  Clock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface SeasonalitySignal {
  ticker: string;
  name_ar: string;
  signal: 'BUY' | 'SELL' | 'HOLD' | 'STRONG_BUY';
  win_rate: number;
  avg_return: number;
  historical_trades: number;
}

interface SeasonalitySummary {
  buy_signals: number;
  sell_signals: number;
  avg_win_rate: number;
}

// Safe number helper
const safeNum = (val: unknown, fallback: number = 0): number => {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
};

export function SeasonalitySignalsWidget() {
  const [signals, setSignals] = useState<SeasonalitySignal[]>([]);
  const [summary, setSummary] = useState<SeasonalitySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      // Use local seasonality-signals API which uses the recommendation engine
      const res = await fetch('/api/seasonality-signals');
      if (res.ok) {
        const data = await res.json();

        if (data.signals && Array.isArray(data.signals) && data.signals.length > 0) {
          // Transform to widget format - filter out items without ticker.
          // ممنوع توليد عدد صفقات عشوائي — نستخدم فقط ما يأتي من الـ API الحقيقي.
          const widgetSignals: SeasonalitySignal[] = data.signals
            .filter((item: any): item is Record<string, unknown> => item != null && item.ticker)
            .slice(0, 6)
            .map((item: any) => ({
              ticker: item.ticker || '',
              name_ar: item.name_ar || '',
              signal: item.signal === 'STRONG_BUY' ? 'STRONG_BUY' :
                      item.signal === 'BUY' ? 'BUY' :
                      item.signal === 'SELL' || item.signal === 'REDUCE' ? 'SELL' : 'HOLD',
              win_rate: safeNum(item.confidence, 0),
              avg_return: safeNum(item.position_pct, 0),
              historical_trades: Number.isFinite(Number(item.historical_trades)) ? Number(item.historical_trades) : 0,
            }));

          const buySignals = widgetSignals.filter(s => s.signal === 'BUY' || s.signal === 'STRONG_BUY').length;
          const sellSignals = widgetSignals.filter(s => s.signal === 'SELL').length;
          const avgWinRate = widgetSignals.length > 0
            ? widgetSignals.reduce((acc, s) => acc + s.win_rate, 0) / widgetSignals.length
            : 0;

          setSignals(widgetSignals);
          setSummary({
            buy_signals: buySignals,
            sell_signals: sellSignals,
            avg_win_rate: avgWinRate,
          });
        } else {
          setSignals([]);
          setSummary(null);
        }
      }
    } catch (e) {
      console.error('Error fetching seasonality:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const currentMonth = new Date().toLocaleDateString('ar-EG', { month: 'long' });

  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center">
              <Calendar className="w-4 h-4 text-white" />
            </div>
            إشارات الموسمية (EGX)
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => fetchData(true)}
            disabled={refreshing}
          >
            <RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Current Month */}
        <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50 border border-border/50">
          <div className="flex items-center gap-2">
            <Calendar className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] font-medium">شهر {currentMonth}</span>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : signals.length === 0 ? (
          <div className="text-center py-4 text-muted-foreground text-xs">
            <Calendar className="w-6 h-6 mx-auto mb-1 opacity-50" />
            لا توجد إشارات لهذا الشهر
          </div>
        ) : (
          <>
            {/* Summary */}
            {summary && (
              <div className="grid grid-cols-3 gap-2 p-2 rounded-lg bg-muted/30">
                <div className="text-center">
                  <span className="block text-sm font-bold text-emerald-600">{summary.buy_signals}</span>
                  <span className="text-[9px] text-muted-foreground">شراء</span>
                </div>
                <div className="text-center">
                  <span className="block text-sm font-bold text-red-600">{summary.sell_signals}</span>
                  <span className="text-[9px] text-muted-foreground">بيع</span>
                </div>
                <div className="text-center">
                  <span className="block text-sm font-bold">{summary.avg_win_rate.toFixed(0)}%</span>
                  <span className="text-[9px] text-muted-foreground">نجاح</span>
                </div>
              </div>
            )}

            {/* Signals */}
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {signals.slice(0, 4).map((s) => (
                <div
                  key={s.ticker}
                  className={cn(
                    'p-2 rounded-lg border transition-all',
                    s.signal === 'BUY' || s.signal === 'STRONG_BUY' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800' :
                    s.signal === 'SELL' ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' :
                    'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-xs">{s.ticker}</span>
                      {s.name_ar && <span className="text-[9px] text-muted-foreground">{s.name_ar}</span>}
                    </div>
                    <Badge className={cn(
                      'text-[9px]',
                      s.signal === 'BUY' || s.signal === 'STRONG_BUY' ? 'bg-emerald-600 text-white' :
                      s.signal === 'SELL' ? 'bg-red-600 text-white' :
                      'bg-amber-600 text-white'
                    )}>
                      {s.signal === 'BUY' || s.signal === 'STRONG_BUY' ? 'شراء' : s.signal === 'SELL' ? 'بيع' : 'انتظار'}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
                    <span className="flex items-center gap-0.5">
                      <Target className="w-2.5 h-2.5" />
                      {s.win_rate.toFixed(0)}%
                    </span>
                    <span className="flex items-center gap-0.5">
                      <TrendingUp className="w-2.5 h-2.5" />
                      {s.avg_return > 0 ? '+' : ''}{s.avg_return.toFixed(1)}%
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Clock className="w-2.5 h-2.5" />
                      {s.historical_trades > 0 ? `${s.historical_trades} صفقة` : '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Disclaimer */}
            <div className="p-1.5 rounded bg-muted/30 border border-border/50">
              <span className="text-[9px] text-muted-foreground">
                الإشارات تاريخية وعدد الصفقات غير متاح إلا عبر walk-forward test حقيقي
              </span>
            </div>
          </>
        )}

        <p className="text-[8px] text-muted-foreground text-center">
          ⚠️ إشارات تاريخية - الأداء السابق لا يضمن المستقبلي
        </p>
      </CardContent>
    </Card>
  );
}
