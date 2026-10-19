'use client';

/**
 * DualTrackPredictionsView — شاشة التوقعات المزدوجة
 * ================================================
 * المرحلة 5 من نظام التوقعات المزدوج (DUAL-TRACK-PHASE-5)
 *
 * تعرض:
 *  - إحصائيات combined_efficiency (win_rate لكل مسار)
 *  - tabs: 📊 تحليل كامل | 💧 تحليل سيولة | الكل
 *  - قائمة التوقعات مع track_label + threshold للسوق
 *  - زر تشغيل الـ backtest (admin)
 *
 * Endpoints المستخدمة:
 *  /api/predictions/dual-track/stats    — إحصائيات
 *  /api/predictions/dual-track/list     — قائمة التوقعات
 *  /api/predictions/dual-track/threshold — حساب الـ threshold
 *  /api/predictions/dual-track/backtest — تشغيل الـ backtest
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, Droplets, BarChart3, Activity,
  RefreshCw, Target, Zap, Eye, AlertTriangle, CheckCircle2,
  Loader2, Brain, ArrowUpCircle, ArrowDownCircle, Layers,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import { StockPublisher, type StockPublishData } from '@/modules/publishing/components/StockPublisher';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';

interface TrackStats {
  track: string;
  total: number;
  resolved: number;
  wins: number;
  losses: number;
  expired: number;
  hit_rate: number;
  avg_return: number;
  weight: number;
}

interface Prediction {
  id: number;
  ticker: string;
  signal: string;
  signal_type: string;
  track: string;
  track_label: string;
  prediction_date: string;
  entry_price: number;
  target_price: number;
  target_price_2?: number;
  stop_loss: number;
  status: string;
  actual_return: number | null;
  hit_target: number;
  hit_stop: number;
  confidence: number;
  risk_reward: number;
  market: string;
}

interface Threshold {
  market: string;
  threshold_date: string;
  threshold_value: number;
  sample_size: number;
  fallback_used: number | boolean;
}

interface StatsResponse {
  success: boolean;
  dual_track: {
    track_a: TrackStats;
    track_b: TrackStats;
    combined_efficiency: number;
    formula: string;
  };
  by_market: any[];
  top_tickers: any[];
  dynamic_thresholds: Threshold[];
  backtest_results: any[];
}

// ── UnifiedTable columns for top tickers (Rule 52) ──
const topTickerColumns: Column<Record<string, unknown>>[] = [
  {
    key: 'ticker',
    header: 'السهم',
    align: 'right',
    sortable: true,
    render: (t) => <span className="text-xs font-bold">{String(t.ticker ?? '')}</span>,
  },
  {
    key: 'market',
    header: 'السوق',
    align: 'center',
    sortable: true,
    render: (t) => <span className="text-xs text-center inline-block w-full">{String(t.market ?? '')}</span>,
  },
  {
    key: 'total',
    header: 'إجمالي',
    align: 'center',
    sortable: true,
    render: (t) => <span className="text-xs text-center inline-block w-full">{String(t.total ?? 0)}</span>,
  },
  {
    key: 'wins',
    header: 'نجاحات',
    align: 'center',
    sortable: true,
    render: (t) => (
      <span className="text-xs text-center text-profit inline-block w-full">{String(t.wins ?? 0)}</span>
    ),
  },
  {
    key: 'hit_rate',
    header: '%',
    align: 'center',
    sortable: true,
    render: (t) => (
      <span className="text-xs text-center font-semibold inline-block w-full">{t.hit_rate}%</span>
    ),
  },
  {
    key: 'avg_return',
    header: 'متوسط العائد',
    align: 'center',
    sortable: true,
    render: (t) => {
      const avgReturn = Number(t.avg_return ?? 0);
      return (
        <span
          className={cn(
            'text-xs text-center font-medium inline-block w-full',
            avgReturn >= 0 ? 'text-profit' : 'text-loss',
          )}
        >
          {avgReturn >= 0 ? '+' : ''}{avgReturn}%
        </span>
      );
    },
  },
];

export function DualTrackPredictionsView() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [trackFilter, setTrackFilter] = useState<'all' | 'full_analysis' | 'liquidity'>('all');
  const [loading, setLoading] = useState(true);
  const [loadingPreds, setLoadingPreds] = useState(false);
  const [backtestLoading, setBacktestLoading] = useState(false);
  const [backtestResult, setBacktestResult] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/predictions/dual-track/stats', { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (data.success) setStats(data);
      }
    } catch (e) {
      console.error('[DualTrack] stats error:', e);
    }
  }, []);

  const fetchPredictions = useCallback(async (track: string) => {
    setLoadingPreds(true);
    try {
      const res = await fetch(
        `/api/predictions/dual-track/list?market=${encodeURIComponent(useAppStore.getState().currentMarket)}&track=${track}&limit=5`,
        { cache: 'no-store' }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setPredictions(data.predictions || []);
        }
      }
    } catch (e) {
      console.error('[DualTrack] list error:', e);
    } finally {
      setLoadingPreds(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      await Promise.all([fetchStats(), fetchPredictions('all')]);
      setLoading(false);
    })();
  }, [fetchStats, fetchPredictions]);

  const onTabChange = (value: string) => {
    const track = value as 'all' | 'full_analysis' | 'liquidity';
    setTrackFilter(track);
    fetchPredictions(track);
  };

  const onRecalcThreshold = async () => {
    try {
      await fetch('/api/predictions/dual-track/threshold', { method: 'POST' });
      await fetchStats();
    } catch (e) {
      console.error('[DualTrack] threshold error:', e);
    }
  };

  const onRunBacktest = async () => {
    setBacktestLoading(true);
    setBacktestResult(null);
    try {
      const res = await fetch(
        '/api/predictions/dual-track/backtest?execute=1&days=90',
        { method: 'POST' }
      );
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          const results = data.results || [];
          const summary = results.map((r: any) =>
            `${r.market}: ${r.hit_rate || 0}% (${r.total_signals || 0} signals, ${r.qualified ? '✅' : '❌'})`
          ).join(' | ');
          setBacktestResult(summary || 'لا توجد بيانات متاحة');
          await fetchStats();
        }
      }
    } catch (e) {
      setBacktestResult(`Error: ${(e as Error).message}`);
    } finally {
      setBacktestLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20" dir="rtl">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-500" />
        <span className="mr-2 text-sm text-muted-foreground">جاري تحليل التوقعات المزدوجة...</span>
      </div>
    );
  }

  const dt = stats?.dual_track;
  const trackA = dt?.track_a;
  const trackB = dt?.track_b;
  const combined = dt?.combined_efficiency ?? 0;
  const thresholds = stats?.dynamic_thresholds || [];
  const topTickers = stats?.top_tickers || [];

  return (
    <div className="space-y-4 p-3 md:p-4 pb-20" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-cyan-500" />
            نظام التوقعات المزدوج
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            المسار A: تحليل كامل متوازن · المسار B: سيولة مؤسسية استثنائية
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRecalcThreshold}
            disabled={backtestLoading}
          >
            <RefreshCw className="w-3.5 h-3.5 ml-1" />
            إعادة حساب الـ Threshold
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={onRunBacktest}
            disabled={backtestLoading}
          >
            {backtestLoading ? (
              <Loader2 className="w-3.5 h-3.5 ml-1 animate-spin" />
            ) : (
              <Activity className="w-3.5 h-3.5 ml-1" />
            )}
            تشغيل Backtest
          </Button>
        </div>
      </div>

      {backtestResult && (
        <Card className="bg-cyan-500/5 border-cyan-500/20">
          <CardContent className="p-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-cyan-500 mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="text-xs font-semibold text-cyan-700 dark:text-cyan-300 mb-1">
                  نتيجة الـ Backtest
                </p>
                <p className="text-xs text-muted-foreground">{backtestResult}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Combined Efficiency Hero */}
      <Card className="bg-cyan-500/5 border-cyan-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="w-4 h-4" />
            الكفاءة المجمّعة للمنصة
          </CardTitle>
          <CardDescription className="text-xs">
            {dt?.formula || '(win_rate_A × 0.4) + (win_rate_B × 0.6)'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <div className="text-3xl font-bold text-cyan-600 dark:text-cyan-400">
              {(combined ?? 0).toFixed(1)}%
            </div>
            <div className="flex-1">
              <Progress value={combined} className="h-2" />
              <p className="text-xs text-muted-foreground mt-1">
                {combined >= 65 ? '✅ مؤهلة للمسار B' : '⚠️ أقل من الهدف (65%)'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Track Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TrackCard
          track={trackA}
          label="المسار A — 📊 تحليل كامل"
          color="cyan"
          icon={BarChart3}
        />
        <TrackCard
          track={trackB}
          label="المسار B — 💧 تحليل سيولة"
          color="purple"
          icon={Droplets}
        />
      </div>

      {/* Dynamic Thresholds */}
      {thresholds.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="w-4 h-4 text-warning" />
              الـ Dynamic Threshold لكل سوق (percentile_75)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {thresholds.map((t) => (
                <div key={t.market} className="p-3 rounded-lg border bg-muted/30">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold">{t.market}</span>
                    {t.fallback_used ? (
                      <Badge variant="outline" className="text-warning text-[10px]">
                        fallback
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-profit text-[10px]">
                        live
                      </Badge>
                    )}
                  </div>
                  <div className="text-lg font-bold">
                    {Number(t.threshold_value).toLocaleString()}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {t.threshold_date} · sample={t.sample_size}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Top Tickers */}
      {topTickers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <ArrowUpCircle className="w-4 h-4 text-profit" />
              أعلى الأسهم أداءً (آخر 30 يوم)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UnifiedTable<Record<string, unknown>>
              columns={topTickerColumns}
              data={topTickers.slice(0, 8) as unknown as Record<string, unknown>[]}
              keyField="ticker"
              dense
              emptyTextAr="لا توجد أسهم مميزة"
            />
          </CardContent>
        </Card>
      )}

      {/* Predictions Tabs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="w-4 h-4 text-cyan-500" />
            التوقعات الحالية
          </CardTitle>
          <CardDescription className="text-xs">
            توقعات المسار A (تحليل كامل) و B (سيولة) — آخر 30 يوم
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={trackFilter} onValueChange={onTabChange}>
            <TabsList className="grid w-full grid-cols-3 h-auto">
              <TabsTrigger value="all" className="text-[10px] sm:text-xs px-1 sm:px-3 py-1.5">
                <Eye className="w-3 h-3 ml-1" />
                <span className="hidden sm:inline">الكل</span>
                <span className="sm:hidden">الكل</span>
              </TabsTrigger>
              <TabsTrigger value="full_analysis" className="text-[10px] sm:text-xs px-1 sm:px-3 py-1.5">
                <BarChart3 className="w-3 h-3 ml-1" />
                <span className="hidden sm:inline">تحليل كامل</span>
                <span className="sm:hidden">📊 كامل</span>
              </TabsTrigger>
              <TabsTrigger value="liquidity" className="text-[10px] sm:text-xs px-1 sm:px-3 py-1.5">
                <Droplets className="w-3 h-3 ml-1" />
                <span className="hidden sm:inline">سيولة</span>
                <span className="sm:hidden">💧 سيولة</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value={trackFilter} className="mt-3">
              {loadingPreds ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-cyan-500" />
                </div>
              ) : predictions.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  لا توجد توقعات {trackFilter !== 'all' && `في المسار "${trackFilter}"`}
                  <br />
                  <span className="text-[10px]">
                    (شغّل الـ Generator من VPS لإنتاج توقعات المسار B)
                  </span>
                </div>
              ) : (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {predictions.map((p) => (
                    <PredictionRow key={p.id} pred={p} />
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Disclaimer */}
      <Card className="bg-warning/5 border-warning/20">
        <CardContent className="p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-warning mt-0.5 shrink-0" />
            <p className="text-[10px] text-muted-foreground">
              ⚠️ التوقعات آلية مبنية على بيانات تاريخية. ليست نصيحة استثمارية مرخصة.
              استشر مستشاراً مالياً مرخّصاً قبل أي قرار. المنصة tracking only ولا تنفّذ أوامر بيع/شراء.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function TrackCard({
  track, label, color, icon: Icon,
}: {
  track?: TrackStats;
  label: string;
  color: 'cyan' | 'purple';
  icon: React.ElementType;
}) {
  if (!track) {
    return (
      <Card className="opacity-60">
        <CardContent className="p-3">
          <div className="text-xs text-muted-foreground">{label} — لا توجد بيانات</div>
        </CardContent>
      </Card>
    );
  }

  const colorClasses = {
    cyan: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/5 border-cyan-500/20',
    purple: 'text-primary dark:text-primary bg-primary/5 border-purple-500/20',
  };

  return (
    <Card className={cn('border', colorClasses[color])}>
      <CardHeader className="pb-2">
        <CardTitle className="text-xs flex items-center gap-1.5">
          <Icon className="w-3.5 h-3.5" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-lg font-bold">{(track.hit_rate ?? 0).toFixed(1)}%</div>
            <div className="text-[10px] text-muted-foreground">hit_rate</div>
          </div>
          <div>
            <div className="text-lg font-bold">{track.total}</div>
            <div className="text-[10px] text-muted-foreground">إجمالي</div>
          </div>
          <div>
            <div className="text-lg font-bold text-profit">{track.wins}</div>
            <div className="text-[10px] text-muted-foreground">نجاحات</div>
          </div>
        </div>
        <Separator className="my-2" />
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground">
            وزن: {track.weight * 100}%
          </span>
          <span className={track.avg_return >= 0 ? 'text-profit' : 'text-loss'}>
            متوسط العائد: {track.avg_return >= 0 ? '+' : ''}{track.avg_return}%
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function PredictionRow({ pred }: { pred: Prediction }) {
  const isLiquidity = pred.track === 'liquidity';
  const isWin = pred.status === 'TARGET_HIT' || pred.status === 'closed_win';
  const isLoss = pred.status === 'closed_stop' || pred.status === 'STOPPED';
  const isActive = pred.status === 'active' || pred.status === 'ACTIVE';

  return (
    <div
      className={cn(
        'flex items-center justify-between p-2.5 rounded-lg border text-xs',
        isLiquidity
          ? 'bg-primary/5 border-purple-500/20'
          : 'bg-cyan-500/5 border-cyan-500/20',
        isWin && 'ring-1 ring-profit/30',
        isLoss && 'ring-1 ring-loss/30',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn(
          'text-[10px] font-medium px-1.5 py-0.5 rounded',
          isLiquidity ? 'bg-primary/20 text-primary' : 'bg-cyan-500/20 text-cyan-700'
        )}>
          {pred.track_label}
        </span>
        <span className="font-bold">{pred.ticker}</span>
        <span className="text-muted-foreground truncate hidden sm:inline">{pred.signal_type}</span>
        <StockPublisher
          data={{
            ticker: pred.ticker,
            currentPrice: Number(pred.entry_price ?? 0),
            entryPrice: Number(pred.entry_price ?? 0) || undefined,
            targetPrice1: Number(pred.target_price ?? 0) || undefined,
            targetPrice2: Number(pred.target_price_2 ?? 0) || undefined,
            stopLoss: Number(pred.stop_loss ?? 0) || undefined,
            riskReward: Number(pred.risk_reward ?? 0) || undefined,
            confidence: Number(pred.confidence ?? 0) || undefined,
            market: (pred.market as StockPublishData['market']) || 'EGX',
            recommendation:
              pred.signal === 'BUY' ? 'BUY' :
              pred.signal === 'SELL' ? 'SELL' : 'HOLD',
          }}
          variant="icon"
          size="sm"
        />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <div className="text-left hidden md:block">
          <div className="text-[10px] text-muted-foreground">entry → target</div>
          <div className="font-medium">
            {pred.entry_price} → {pred.target_price}
          </div>
        </div>
        <div className="text-left">
          <div className="text-[10px] text-muted-foreground">return</div>
          <div className={cn(
            'font-bold',
            pred.actual_return === null
              ? 'text-muted-foreground'
              : pred.actual_return >= 0
                ? 'text-profit'
                : 'text-loss'
          )}>
            {pred.actual_return === null ? '—' : `${pred.actual_return >= 0 ? '+' : ''}${pred.actual_return}%`}
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'text-[10px]',
            isWin && 'border-profit/40 text-profit',
            isLoss && 'border-loss/40 text-loss',
            isActive && 'border-warning/40 text-warning',
          )}
        >
          {isActive ? '🟡 نشط' : isWin ? '✅ نجاح' : isLoss ? '❌ خسارة' : pred.status}
        </Badge>
      </div>
    </div>
  );
}
