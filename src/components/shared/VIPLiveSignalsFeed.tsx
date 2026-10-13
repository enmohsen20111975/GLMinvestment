'use client';

/**
 * VIP Live Signals Feed — كروت تداول احترافية صالحة للشراء الآن
 * ==================================================================
 * T-ALPHA-A15: يستهلك من /api/v2/commercial-feed (Single Commercial Feed).
 * لا يقرأ من PersonaTab أو الجداول القديمة — مصدر موحد فقط.
 *
 * Rule 27: لا بيانات وهمية — إذا الـ API فارغ، اعرض رسالة واضحة.
 * Rule 4: لا حساب مالي — كل الأرقام من الـ API.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TimeHorizonBadge } from '@/components/shared/TimeHorizonBadge';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import {
  Zap, Target, ShieldAlert, TrendingUp, TrendingDown,
  ArrowRight, Loader2, RefreshCw, Activity,
} from 'lucide-react';

interface LiveSignal {
  ticker: string;
  name_ar: string | null;
  sector: string | null;
  market: string;
  signal: string;
  signal_ar: string;
  entry_price: number | null;
  target_price: number | null;
  target_price_2: number | null;
  stop_loss: number | null;
  risk_reward: number | null;
  confidence: number | null;
  master_score: number | null;
  persona: string | null;
  prediction_date: string | null;
  current_price: number | null;
  upside_pct: number | null;
  downside_pct: number | null;
}

interface FeedResponse {
  success: boolean;
  market: string;
  active_live_signals: LiveSignal[];
  audited_performance: unknown[];
  stats: {
    live_count: number;
    audited_count: number;
    win_rate: number | null;
    avg_return: number | null;
  };
  error?: string;
  message?: string;
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(2);
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(1)}%`;
}

function fmtRR(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n)) || Number(n) <= 0) return '—';
  return `1:${Number(n).toFixed(1)}`;
}

export function VIPLiveSignalsFeed({ market }: { market: string }) {
  const [data, setData] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const setSelectedTicker = useAppStore((s) => s.setSelectedTicker);
  const setCurrentView = useAppStore((s) => s.setCurrentView);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/v2/commercial-feed?market=${encodeURIComponent(market)}`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        setError('تعذّر جلب الصفقات الحية');
        setData(null);
        return;
      }
      const json: FeedResponse = await res.json();
      if (!json.success) {
        setError(json.message || 'تعذّر جلب الصفقات الحية');
        setData(null);
        return;
      }
      setData(json);
    } catch {
      setError('تعذّر الاتصال بالخادم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleOpenStock = (ticker: string) => {
    setSelectedTicker(ticker);
    setCurrentView('stock-detail');
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-40 w-full rounded-xl" />
        ))}
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-amber-200 dark:border-amber-800/50">
        <CardContent className="p-6 text-center space-y-3">
          <Activity className="w-8 h-8 text-amber-500 mx-auto" />
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">{error || 'لا توجد بيانات'}</p>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  const signals = data.active_live_signals;

  if (signals.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-2">
          <Zap className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm font-semibold text-muted-foreground">
            لا توجد صفقات حية صالحة للشراء الآن
          </p>
          <p className="text-xs text-muted-foreground">
            المحرك يفحص السوق باستمرار — ستظهر الفرص المؤكدة هنا فور توليدها
          </p>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5 mt-2">
            <RefreshCw className="w-3.5 h-3.5" />
            تحديث
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header strip */}
      <div className="flex items-center justify-between px-1" dir="rtl">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-emerald-500" />
          <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">
            الصفقات الحية ({signals.length})
          </span>
          {data.stats.win_rate != null && (
            <Badge variant="outline" className="text-[9px]">
              معدل النجاح: {data.stats.win_rate}%
            </Badge>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={fetchData} className="h-7 px-2">
          <RefreshCw className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* VIP Trading Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {signals.map((sig) => {
          const isStrongBuy = sig.signal?.toUpperCase() === 'STRONG_BUY';
          const rr = Number(sig.risk_reward) || 0;
          const isGoodRR = rr >= 2.0;
          const confidence = Number(sig.confidence) || 0;
          const isHighConfidence = confidence >= 65;

          return (
            <Card
              key={sig.ticker + sig.prediction_date}
              className={cn(
                'border-r-4 overflow-hidden transition-all hover:shadow-lg cursor-pointer',
                isStrongBuy ? 'border-r-emerald-500' : 'border-r-amber-400',
              )}
              onClick={() => handleOpenStock(sig.ticker)}
            >
              <CardContent className="p-3 space-y-2.5">
                {/* Row 1: Ticker + Name + Signal Badge */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-sm">{sig.ticker}</span>
                      {sig.market && sig.market !== 'EGX' && (
                        <span className="text-[9px] text-muted-foreground">{sig.market}</span>
                      )}
                    </div>
                    {sig.name_ar && (
                      <div className="text-[11px] text-muted-foreground truncate" title={sig.name_ar}>
                        {sig.name_ar}
                      </div>
                    )}
                    {sig.sector && (
                      <div className="text-[9px] text-muted-foreground/70 truncate">{sig.sector}</div>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge
                      className={cn(
                        'text-[10px] font-bold',
                        isStrongBuy
                          ? 'bg-emerald-500 text-white'
                          : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
                      )}
                    >
                      {sig.signal_ar || sig.signal || '—'}
                    </Badge>
                    {sig.persona && <TimeHorizonBadge persona={sig.persona} size="sm" />}
                  </div>
                </div>

                {/* Row 2: Entry / Target / Stop grid */}
                <div className="grid grid-cols-3 gap-2">
                  {/* Entry */}
                  <div className="rounded-md bg-muted/40 p-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5">
                      <ArrowRight className="w-2.5 h-2.5" /> دخول
                    </div>
                    <div className="font-mono font-bold text-xs">{fmtPrice(sig.entry_price)}</div>
                  </div>
                  {/* Target */}
                  <div className="rounded-md bg-emerald-500/5 border border-emerald-500/20 p-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5">
                      <Target className="w-2.5 h-2.5" /> هدف
                    </div>
                    <div className="font-mono font-bold text-xs text-emerald-600 dark:text-emerald-400">
                      {fmtPrice(sig.target_price)}
                    </div>
                    {sig.upside_pct != null && (
                      <div className="text-[8px] text-emerald-500 font-semibold">{fmtPct(sig.upside_pct)}</div>
                    )}
                  </div>
                  {/* Stop */}
                  <div className="rounded-md bg-red-500/5 border border-red-500/20 p-1.5 text-center">
                    <div className="text-[9px] text-muted-foreground flex items-center justify-center gap-0.5">
                      <ShieldAlert className="w-2.5 h-2.5" /> وقف
                    </div>
                    <div className="font-mono font-bold text-xs text-red-600 dark:text-red-400">
                      {fmtPrice(sig.stop_loss)}
                    </div>
                    {sig.downside_pct != null && (
                      <div className="text-[8px] text-red-500 font-semibold">{fmtPct(sig.downside_pct)}</div>
                    )}
                  </div>
                </div>

                {/* Row 3: R:R + Confidence bar */}
                <div className="flex items-center justify-between gap-2">
                  {/* R:R */}
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] text-muted-foreground">R:R</span>
                    <span
                      className={cn(
                        'font-mono font-bold text-xs',
                        isGoodRR ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400',
                      )}
                    >
                      {fmtRR(sig.risk_reward)}
                    </span>
                    {isGoodRR && (
                      <span className="text-[8px] text-emerald-500">✓</span>
                    )}
                  </div>
                  {/* Confidence */}
                  <div className="flex items-center gap-1.5 flex-1 max-w-[120px]">
                    <span className="text-[9px] text-muted-foreground whitespace-nowrap">ثقة</span>
                    <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          isHighConfidence ? 'bg-emerald-500' : 'bg-amber-500',
                        )}
                        style={{ width: `${Math.min(confidence, 100)}%` }}
                      />
                    </div>
                    <span className="text-[9px] font-bold tabular-nums">
                      {confidence > 0 ? `${Math.round(confidence)}%` : '—'}
                    </span>
                  </div>
                </div>

                {/* Row 4: Target 2 + Current Price + Date */}
                <div className="flex items-center justify-between text-[9px] text-muted-foreground pt-1 border-t border-border/30">
                  <span>
                    {sig.target_price_2 != null && sig.target_price_2 > 0 ? (
                      <>هدف 2: <span className="font-mono font-semibold text-emerald-600 dark:text-emerald-400">{fmtPrice(sig.target_price_2)}</span></>
                    ) : (
                      <span>—</span>
                    )}
                  </span>
                  {sig.current_price != null && sig.current_price > 0 && (
                    <span>سعر السوق: <span className="font-mono font-semibold">{fmtPrice(sig.current_price)}</span></span>
                  )}
                  {sig.prediction_date && (
                    <span className="text-muted-foreground/60">{sig.prediction_date}</span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
