'use client';

import React, { useMemo } from 'react';
import {
  Calendar,
  TrendingUp,
  Target,
  Clock,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useApiQuery } from '@/hooks/use-api-query';
import { WidgetCard } from '@/components/shared/WidgetCard';
import { WidgetStat, WidgetStatGrid } from '@/components/shared/WidgetStat';

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

interface SeasonalityResponse {
 signals?: Array<Record<string, unknown>>;
}

// Safe number helper
const safeNum = (val: unknown, fallback: number = 0): number => {
 const n = Number(val);
 return Number.isFinite(n) ? n : fallback;
};

export function SeasonalitySignalsWidget() {
 // F2.2: useApiQuery replaces manual fetch + useState.
 const { data: rawData, isLoading: loading, isFetching: refreshing, refetch } = useApiQuery<SeasonalityResponse>('/api/seasonality-signals', {
   queryOptions: { refetchOnWindowFocus: false },
 });

 // Derive signals + summary from cached query data (memoized — no recomputation on re-render).
 const { signals, summary } = useMemo(() => {
   const rawSignals = rawData?.signals;
   if (!rawSignals || !Array.isArray(rawSignals) || rawSignals.length === 0) {
     return { signals: [] as SeasonalitySignal[], summary: null };
   }
   const widgetSignals: SeasonalitySignal[] = rawSignals
     .filter((item): item is Record<string, unknown> => item != null && !!item.ticker)
     .slice(0, 6)
     .map((item) => ({
       ticker: String(item.ticker || ''),
       name_ar: String(item.name_ar || ''),
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

   return {
     signals: widgetSignals,
     summary: { buy_signals: buySignals, sell_signals: sellSignals, avg_win_rate: avgWinRate },
   };
 }, [rawData]);

 const handleRefresh = () => { void refetch(); };

 const currentMonth = new Date().toLocaleDateString('ar-EG', { month: 'long' });

 return (
 <WidgetCard
 title="إشارات الموسمية (EGX)"
 icon={Calendar}
 iconColor="text-foreground"
 iconBg="bg-gradient-to-br from-whale to-cyan-500"
 loading={loading}
 skeletonRows={2}
 skeletonHeight="h-12"
 onRefresh={handleRefresh}
 refreshing={refreshing}
 className="border-border/60"
 headerClassName="pb-3"
 >
 {/* Current Month */}
 <div className="flex items-center justify-between p-2 rounded-lg bg-muted/50 border border-border/50">
 <div className="flex items-center gap-2">
 <Calendar className="w-3.5 h-3.5 text-primary" />
 <span className="text-xs font-medium">شهر {currentMonth}</span>
 </div>
 </div>

 {signals.length === 0 ? (
 <div className="text-center py-4 text-muted-foreground text-xs">
 <Calendar className="w-6 h-6 mx-auto mb-1 opacity-50" />
 لا توجد إشارات لهذا الشهر
 </div>
 ) : (
 <>
 {/* Summary */}
 {summary && (
 <WidgetStatGrid cols={3}>
 <WidgetStat label="شراء" value={summary.buy_signals} valueClass="text-profit" />
 <WidgetStat label="بيع" value={summary.sell_signals} valueClass="text-loss" />
 <WidgetStat label="نجاح" value={`${(summary.avg_win_rate ?? 0).toFixed(0)}%`} />
 </WidgetStatGrid>
 )}

 {/* Signals */}
 <div className="space-y-2 max-h-40 overflow-y-auto">
 {signals.slice(0, 4).map((s) => (
 <div
 key={s.ticker}
 className={cn(
 'p-2 rounded-lg border transition-all',
 s.signal === 'BUY' || s.signal === 'STRONG_BUY' ? 'bg-profit/20 border-profit ' :
 s.signal === 'SELL' ? 'bg-loss/20 border-loss ' :
 'bg-warning/20 border-warning '
 )}
 >
 <div className="flex items-center justify-between mb-1">
 <div className="flex items-center gap-1.5">
 <span className="font-bold text-xs">{s.ticker}</span>
 {s.name_ar && <span className="text-xs text-muted-foreground">{s.name_ar}</span>}
 </div>
 <Badge className={cn(
 'text-xs',
 s.signal === 'BUY' || s.signal === 'STRONG_BUY' ? 'bg-profit text-white' :
 s.signal === 'SELL' ? 'bg-loss text-white' :
 'bg-warning text-white'
 )}>
 {s.signal === 'BUY' || s.signal === 'STRONG_BUY' ? 'شراء' : s.signal === 'SELL' ? 'بيع' : 'انتظار'}
 </Badge>
 </div>
 <div className="flex items-center gap-3 text-xs text-muted-foreground">
 <span className="flex items-center gap-0.5">
 <Target className="w-2.5 h-2.5" />
 {(s.win_rate ?? 0).toFixed(0)}%
 </span>
 <span className="flex items-center gap-0.5">
 <TrendingUp className="w-2.5 h-2.5" />
 {(s.avg_return ?? 0) > 0 ? '+' : ''}{(s.avg_return ?? 0).toFixed(1)}%
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
 <span className="text-xs text-muted-foreground">
 الإشارات تاريخية وعدد الصفقات غير متاح إلا عبر walk-forward test حقيقي
 </span>
 </div>
 </>
 )}

 <p className="text-[8px] text-muted-foreground text-center">
 ⚠️ إشارات تاريخية - الأداء السابق لا يضمن المستقبلي
 </p>
 </WidgetCard>
 );
}
