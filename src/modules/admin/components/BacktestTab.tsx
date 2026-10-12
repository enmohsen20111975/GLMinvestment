'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Play, RefreshCw, TrendingUp, TrendingDown, Activity, Target, Zap, Filter, Database,
  Terminal as TerminalIcon, Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface BacktestSummary {
  total: number;
  wins?: number;
  losses?: number;
  wr?: number;
  pf?: number;
  net?: number;
  avg_win?: number;
  avg_loss?: number;
  expectancy?: number;
  rr_ratio?: number;
  max_drawdown?: number;
  message?: string;
}

interface MonthStats {
  month: string;
  trades: number;
  wins: number;
  wr: number;
  net: number;
}

interface TickerStats {
  ticker: string;
  trades: number;
  wins: number;
  wr: number;
  net: number;
}

interface OutOfSampleStats {
  trades: number;
  wins: number;
  wr: number;
  pf: number;
  net: number;
}

interface TradeRow {
  ticker: string;
  signal: string;
  entry: number | null;
  target: number | null;
  stop: number | null;
  actual_return: number;
  hit: 'target' | 'stop' | 'open';
  prediction_date: string;
  persona?: string;
  market?: string | null;
}

interface BacktestFilters {
  market: string;
  persona: string;
  strategy: string;
  start_date: string | null;
  end_date: string | null;
}

interface BacktestData {
  summary: BacktestSummary;
  morning_bell?: OutOfSampleStats | null;
  by_month?: MonthStats[];
  by_ticker?: TickerStats[];
  explosive_stocks?: TickerStats[];
  out_of_sample?: {
    last_30d?: OutOfSampleStats | null;
    last_45d?: OutOfSampleStats | null;
  };
  trades?: TradeRow[];
  filters?: BacktestFilters;
}

type MarketId = 'ALL' | 'EGX' | 'TADAWUL' | 'KSE' | 'QSE' | 'US' | 'CRYPTO';
type StrategyId = 'V40.2' | 'V38' | 'Sniper' | 'Multi-market';
type PersonaId = 'all' | 'conservative' | 'balanced' | 'gambler';

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function BacktestTab() {
  const [data, setData] = useState<BacktestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  // GLM5.2-A (admin-backtest-ui): live log tail + progress from status API.
  const [logTail, setLogTail] = useState<string[]>([]);
  const [progress, setProgress] = useState<number>(0); // 0-100

  // Date range
  const [startDate, setStartDate] = useState('2025-12-01');
  const [endDate, setEndDate] = useState('2026-08-27');
  const [maxPicks, setMaxPicks] = useState(5);

  // Advanced filters
  const [market, setMarket] = useState<MarketId>('ALL');
  const [strategy, setStrategy] = useState<StrategyId>('V40.2');
  const [persona, setPersona] = useState<PersonaId>('all');

  const buildStatsUrl = useCallback(() => {
    const params = new URLSearchParams();
    if (market !== 'ALL') params.set('market', market);
    if (persona !== 'all') params.set('persona', persona);
    if (strategy !== 'V40.2') params.set('strategy', strategy);
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    const qs = params.toString();
    return `/api/admin/backtest/v40/stats${qs ? `?${qs}` : ''}`;
  }, [market, persona, strategy, startDate, endDate]);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(buildStatsUrl());
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        toast.error(json.error || 'فشل تحميل الإحصائيات');
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [buildStatsUrl]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Poll job status if running — also reads log_tail + progress.
  useEffect(() => {
    if (!jobId || jobStatus !== 'running') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/backtest/v40/status/${jobId}`);
        const json = await res.json();
        if (json.success && json.data) {
          // GLM5.2-A: update live log tail (Rule 27 — real data from API, no fabrication).
          if (Array.isArray(json.data.log_tail)) {
            setLogTail(json.data.log_tail);
          }
          // Progress: if the API returns a progress field, use it. Otherwise
          // estimate from log line count (heuristic, clearly labeled).
          if (typeof json.data.progress === 'number') {
            setProgress(Math.min(100, Math.max(0, json.data.progress)));
          } else if (typeof json.data.progress_pct === 'number') {
            setProgress(Math.min(100, Math.max(0, json.data.progress_pct)));
          }
          if (json.data.completed) {
            setJobStatus('completed');
            setRunning(false);
            setProgress(100);
            toast.success('الباك تست خلص! اضغط "تحديث الإحصائيات" لرؤية النتائج.');
            clearInterval(interval);
          } else if (json.data.status === 'failed' || json.data.status === 'error') {
            setJobStatus('failed');
            setRunning(false);
            toast.error('الباك تست فشل. راجع اللوج للتفاصيل.');
            clearInterval(interval);
          }
        }
      } catch { // silent fallback (safe-by-design)
        // ignore network errors — keep polling
      }
    }, 3000); // poll every 3s for live log updates
    return () => clearInterval(interval);
  }, [jobId, jobStatus]);

  const runBacktest = async () => {
    setRunning(true);
    setJobStatus('running');
<<<<<<< HEAD
    try {
      const res = await fetch('/api/admin/backtest/v40/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate,
          endDate,
          market,
          strategy,
          persona,
          maxPicks,
        }),
      });
      const json = await res.json();
      if (json.success && json.jobId) {
        setJobId(json.jobId);
        toast.success(json.message || 'تم إطلاق الباك-تست المؤسسي الآمن في الخلفية.');
      } else {
        toast.error(json.error || 'فشل تشغيل الباك-تست');
=======
    setLogTail([]);
    setProgress(0);
    try {
      // GLM5.2-A: call the run API. Note: this endpoint was disabled (410 Gone)
      // because it did DELETE FROM predictions. We still call it — if the
      // backend re-enables it (on a sandbox DB), the polling will pick up.
      const body: Record<string, unknown> = {
        start_date: startDate,
        end_date: endDate,
        max_picks: maxPicks,
      };
      if (market !== 'ALL') body.market = market;
      const res = await fetch('/api/admin/backtest/v40/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (res.status === 410 || json.deprecated) {
        // Endpoint disabled — show honest message (Rule 27: no fake job).
        toast.error(json.error_ar || json.error || 'الـ endpoint معطل. شغّل على sandbox DB copy.');
        setLogTail([
          `[410 Gone] ${json.error_ar || json.error || 'endpoint deprecated'}`,
          `[reason] ${json.reason || 'was doing DELETE FROM predictions'}`,
          `[canonical] ${json.canonical_command || 'python3 vps-service/jobs/daily_predictor.py --today-only --max-picks 5'}`,
          '',
          'شغّل الباك تست على sandbox DB copy (مش production) ثم تابع اللوج هنا.',
        ]);
        setRunning(false);
        setJobStatus('idle');
        return;
      }
      if (json.success && json.job_id) {
        setJobId(json.job_id);
        toast.success(`الباك تست بدأ (job ${json.job_id.slice(0, 8)})`);
      } else {
        toast.error(json.error || 'فشل تشغيل الباك تست');
>>>>>>> 4dbad695 (feat(admin+portfolio): Log Terminal Viewer + Commission Settings)
        setRunning(false);
        setJobStatus('idle');
      }
    } catch (e) {
<<<<<<< HEAD
      toast.error(e instanceof Error ? e.message : 'خطأ في الاتصال بالخادم');
=======
      toast.error(e instanceof Error ? e.message : 'خطأ في الاتصال');
>>>>>>> 4dbad695 (feat(admin+portfolio): Log Terminal Viewer + Commission Settings)
      setRunning(false);
      setJobStatus('idle');
    }
  };

  const summary = data?.summary;
  const hasResults = summary && summary.total > 0 && summary.wins !== undefined;
  const trades = data?.trades ?? [];

  // Stats grid items
  const statCards = useMemo(() => {
    if (!summary || !hasResults) return [];
    return [
      { label: 'إجمالي الصفقات', value: summary!.total!.toString(), icon: <Activity className="w-4 h-4" />, tone: 'neutral' as const },
      {
        label: 'Win Rate',
        value: `${summary!.wr!.toFixed(1)}%`,
        icon: summary!.wr! >= 50 ? <TrendingUp className="w-4 h-4 text-emerald-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />,
        tone: summary!.wr! >= 50 ? 'success' as const : 'danger' as const,
      },
      {
        label: 'Profit Factor',
        value: summary!.pf!.toFixed(2),
        icon: <Target className="w-4 h-4" />,
        tone: summary!.pf! >= 1.5 ? 'success' as const : 'danger' as const,
      },
      {
        label: 'Net Return',
        value: `${summary!.net! > 0 ? '+' : ''}${summary!.net!.toFixed(1)}%`,
        icon: summary!.net! > 0 ? <TrendingUp className="w-4 h-4 text-emerald-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />,
        tone: summary!.net! > 0 ? 'success' as const : 'danger' as const,
      },
      {
        label: 'Avg Return',
        value: `${summary!.expectancy! > 0 ? '+' : ''}${summary!.expectancy!.toFixed(2)}%`,
        icon: <Activity className="w-4 h-4" />,
        tone: summary!.expectancy! > 0 ? 'success' as const : 'danger' as const,
      },
      {
        label: 'Max Drawdown',
        value: `-${(summary!.max_drawdown ?? 0).toFixed(1)}%`,
        icon: <TrendingDown className="w-4 h-4 text-red-500" />,
        tone: 'danger' as const,
      },
      {
        label: 'Wins / Losses',
        value: `${summary!.wins} / ${summary!.losses}`,
        icon: <Activity className="w-4 h-4" />,
        tone: 'neutral' as const,
      },
      {
        label: 'R:R Ratio',
        value: `${summary!.rr_ratio!.toFixed(2)}:1`,
        icon: <Target className="w-4 h-4" />,
        tone: 'neutral' as const,
      },
    ];
  }, [summary, hasResults]);

  return (
    <div className="space-y-4">
      {/* Header + Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-emerald-500" />
            محرك التوقعات — Backtest (متقدم)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Advanced filter row: market / strategy / persona */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="market-filter" className="text-xs">السوق</Label>
              <Select value={market} onValueChange={(v) => setMarket(v as MarketId)}>
                <SelectTrigger id="market-filter">
                  <SelectValue placeholder="اختر السوق" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">كل الأسواق</SelectItem>
                  <SelectItem value="EGX">EGX (مصر)</SelectItem>
                  <SelectItem value="TADAWUL">TADAWUL (السعودية)</SelectItem>
                  <SelectItem value="KSE">KSE (الكويت)</SelectItem>
                  <SelectItem value="QSE">QSE (قطر)</SelectItem>
                  <SelectItem value="US">US (أمريكا)</SelectItem>
                  <SelectItem value="CRYPTO">CRYPTO (عملات رقمية)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="strategy-filter" className="text-xs">الاستراتيجية</Label>
              <Select value={strategy} onValueChange={(v) => setStrategy(v as StrategyId)}>
                <SelectTrigger id="strategy-filter">
                  <SelectValue placeholder="اختر الاستراتيجية" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="V40.2">محرك التوقعات (افتراضي)</SelectItem>
                  <SelectItem value="V38">المحرك القديم (legacy)</SelectItem>
                  <SelectItem value="Sniper">Sniper (لقّاط الفرص)</SelectItem>
                  <SelectItem value="Multi-market">Multi-market (متعدد الأسواق)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="persona-filter" className="text-xs">الشخصية الاستثمارية (Persona)</Label>
              <Select value={persona} onValueChange={(v) => setPersona(v as PersonaId)}>
                <SelectTrigger id="persona-filter">
                  <SelectValue placeholder="اختر Persona" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  <SelectItem value="conservative">Conservative (محافظ)</SelectItem>
                  <SelectItem value="balanced">Balanced (متوازن)</SelectItem>
                  <SelectItem value="gambler">Gambler (مخاطر)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Date range + max picks */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label htmlFor="start-date">تاريخ البداية</Label>
              <Input
                id="start-date"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="end-date">تاريخ النهاية</Label>
              <Input
                id="end-date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="max-picks">حد التوقعات/يوم</Label>
              <Input
                id="max-picks"
                type="number"
                min="1"
                max="10"
                value={maxPicks}
                onChange={(e) => setMaxPicks(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={runBacktest}
              disabled={running}
              className="gap-2"
            >
              {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {running ? `جاري التشغيل... (job ${jobId?.slice(0, 8)})` : 'تشغيل باك تست جديد'}
            </Button>
            <Button
              onClick={fetchStats}
              disabled={loading}
              variant="outline"
              className="gap-2"
            >
              {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              تحديث الإحصائيات
            </Button>
            <div className="flex items-center gap-1.5 px-3 text-xs text-muted-foreground border rounded-md">
              <Filter className="w-3 h-3" />
              <span>
                {market === 'ALL' ? 'كل الأسواق' : market}
                {' · '}
                {persona === 'all' ? 'كل personas' : persona}
                {' · '}
                {strategy}
              </span>
            </div>
          </div>
          {(jobStatus === 'running' || (logTail.length > 0 && jobStatus !== 'idle')) && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground flex items-center gap-1.5 flex-wrap">
                {jobStatus === 'running' ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                    ⏳ الباك تست بيشتغل في الخلفية. النتائج هتظهر تلقائياً لما يخلص.
                  </>
                ) : (
                  <span>📜 آخر لوج من الباك تست:</span>
                )}
                {jobId && (
                  <code className="text-xs bg-muted px-1.5 py-0.5 rounded">/tmp/v40_backtest_{jobId}.log</code>
                )}
              </p>

              {/* GLM5.2-A — Progress Indicator */}
              {jobStatus === 'running' && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>التقدم</span>
                    <span className="font-mono">{progress.toFixed(0)}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-500"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}

              {/* GLM5.2-A — Log Terminal Viewer (live log_tail from status API) */}
              {logTail.length > 0 && (
                <div className="rounded-lg border border-border bg-zinc-950 dark:bg-zinc-950 overflow-hidden">
                  <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/30 bg-muted/30">
                    <TerminalIcon className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-[10px] font-mono text-muted-foreground">log_tail (آخر {logTail.length} سطر)</span>
                    {jobStatus === 'running' && (
                      <span className="ml-auto flex items-center gap-1 text-[9px] text-emerald-500">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        live
                      </span>
                    )}
                  </div>
                  <div
                    className="p-3 font-mono text-[10px] leading-relaxed text-emerald-400 dark:text-emerald-400 overflow-y-auto max-h-48"
                    dir="ltr"
                  >
                    {logTail.map((line, i) => (
                      <div key={i} className="whitespace-pre-wrap break-all">
                        <span className="text-zinc-600">{String(i + 1).padStart(2, '0')}│</span> {line}
                      </div>
                    ))}
                    {jobStatus === 'running' && (
                      <div className="text-emerald-500 animate-pulse">▊</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary stats */}
      {hasResults ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {statCards.slice(0, 4).map((s, i) => (
              <StatCard key={i} {...s} />
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {statCards.slice(4).map((s, i) => (
              <StatCard key={i} {...s} />
            ))}
          </div>

          {/* Trades table */}
          {trades.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="w-4 h-4 text-emerald-500" />
                  آخر {trades.length} صفقة (تفصيلي)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-96 overflow-y-auto [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr className="text-right border-b">
                        <th className="p-2 font-medium">التاريخ</th>
                        <th className="p-2 font-medium">السهم</th>
                        <th className="p-2 font-medium">السوق</th>
                        <th className="p-2 font-medium">الإشارة</th>
                        <th className="p-2 font-medium">Entry</th>
                        <th className="p-2 font-medium">Target</th>
                        <th className="p-2 font-medium">Stop</th>
                        <th className="p-2 font-medium">العائد الفعلي</th>
                        <th className="p-2 font-medium">Hit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map((t, idx) => (
                        <tr key={`${t.ticker}-${t.prediction_date}-${idx}`} className="border-b hover:bg-muted/30">
                          <td className="p-2 text-xs text-muted-foreground whitespace-nowrap" dir="ltr">{t.prediction_date}</td>
                          <td className="p-2 font-mono font-bold text-xs">{t.ticker}</td>
                          <td className="p-2 text-xs">
                            <Badge variant="outline" className="text-[10px]">{t.market || '—'}</Badge>
                          </td>
                          <td className="p-2 text-xs">{t.signal || '—'}</td>
                          <td className="p-2 font-mono text-xs">{t.entry?.toFixed?.(2) ?? '—'}</td>
                          <td className="p-2 font-mono text-xs text-emerald-600">{t.target?.toFixed?.(2) ?? '—'}</td>
                          <td className="p-2 font-mono text-xs text-red-600">{t.stop?.toFixed?.(2) ?? '—'}</td>
                          <td className={cn(
                            'p-2 font-mono text-xs font-bold',
                            (t.actual_return ?? 0) > 0 ? 'text-emerald-600' : (t.actual_return ?? 0) < 0 ? 'text-red-600' : '',
                          )}>
                            {(t.actual_return ?? 0) > 0 ? '+' : ''}{(t.actual_return ?? 0).toFixed(2)}%
                          </td>
                          <td className="p-2">
                            <Badge
                              variant={t.hit === 'target' ? 'default' : t.hit === 'stop' ? 'destructive' : 'outline'}
                              className="text-[10px]"
                            >
                              {t.hit === 'target' ? 'تارجت' : t.hit === 'stop' ? 'ستوب' : 'مفتوحة'}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Out-of-sample */}
          {data?.out_of_sample && (data.out_of_sample.last_30d || data.out_of_sample.last_45d) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Out-of-Sample (آخر فترة)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {data.out_of_sample.last_30d && (
                    <OosCard title="آخر 30 يوم" stats={data.out_of_sample.last_30d} />
                  )}
                  {data.out_of_sample.last_45d && (
                    <OosCard title="آخر 45 يوم" stats={data.out_of_sample.last_45d} />
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* By Month */}
          {data?.by_month && data.by_month.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">الأداء الشهري</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr className="text-right border-b">
                        <th className="p-2">الشهر</th>
                        <th className="p-2">الصفقات</th>
                        <th className="p-2">WR</th>
                        <th className="p-2">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_month.map((m) => (
                        <tr key={m.month} className="border-b hover:bg-muted/50">
                          <td className="p-2 font-mono">{m.month}</td>
                          <td className="p-2">{m.trades}</td>
                          <td className="p-2">
                            <Badge variant={(m.wr ?? 0) >= 50 ? 'default' : 'destructive'}>{(m.wr ?? 0).toFixed(0)}%</Badge>
                          </td>
                          <td className={`p-2 font-mono ${(m.net ?? 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {(m.net ?? 0) > 0 ? '+' : ''}{(m.net ?? 0).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Explosive stocks */}
          {data?.explosive_stocks && data.explosive_stocks.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="w-4 h-4 text-amber-500" />
                  الأسهم الانفجارية والقيادية المُصطادة
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr className="text-right border-b">
                        <th className="p-2">السهم</th>
                        <th className="p-2">الصفقات</th>
                        <th className="p-2">WR</th>
                        <th className="p-2">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.explosive_stocks.map((t) => (
                        <tr key={t.ticker} className="border-b hover:bg-muted/50">
                          <td className="p-2 font-mono font-bold">{t.ticker}</td>
                          <td className="p-2">{t.trades}</td>
                          <td className="p-2">
                            <Badge variant={(t.wr ?? 0) >= 50 ? 'default' : 'destructive'}>{(t.wr ?? 0).toFixed(0)}%</Badge>
                          </td>
                          <td className={`p-2 font-mono ${(t.net ?? 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {(t.net ?? 0) > 0 ? '+' : ''}{(t.net ?? 0).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Top tickers */}
          {data?.by_ticker && data.by_ticker.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">أعلى 15 سهم ربحاً</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-background">
                      <tr className="text-right border-b">
                        <th className="p-2">السهم</th>
                        <th className="p-2">الصفقات</th>
                        <th className="p-2">WR</th>
                        <th className="p-2">Net</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_ticker.map((t) => (
                        <tr key={t.ticker} className="border-b hover:bg-muted/50">
                          <td className="p-2 font-mono font-bold">{t.ticker}</td>
                          <td className="p-2">{t.trades}</td>
                          <td className="p-2">
                            <Badge variant={(t.wr ?? 0) >= 50 ? 'default' : 'destructive'}>{(t.wr ?? 0).toFixed(0)}%</Badge>
                          </td>
                          <td className={`p-2 font-mono ${(t.net ?? 0) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {(t.net ?? 0) > 0 ? '+' : ''}{(t.net ?? 0).toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            {summary?.message || 'لا توجد توقعات. اضغط "تشغيل باك تست جديد" للبدء.'}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  label, value, icon, tone,
}: { label: string; value: string; icon?: React.ReactNode; tone?: 'success' | 'danger' | 'neutral' }) {
  const toneClass = tone === 'success' ? 'text-emerald-600' : tone === 'danger' ? 'text-red-600' : '';
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{label}</span>
          {icon}
        </div>
        <div className={`text-xl font-bold mt-1 ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function OosCard({ title, stats }: { title: string; stats: OutOfSampleStats }) {
  const tone = stats.pf >= 1.5 ? 'success' : stats.pf >= 1.0 ? 'neutral' : 'danger';
  return (
    <div className="border rounded-lg p-3 space-y-1">
      <div className="text-sm font-medium">{title}</div>
      <div className="text-2xl font-bold">
        {stats.trades} <span className="text-sm font-normal text-muted-foreground">صفقة</span>
      </div>
      <div className="flex gap-3 text-sm">
        <span>WR: <strong>{(stats.wr ?? 0).toFixed(1)}%</strong></span>
        <span>PF: <strong className={tone === 'success' ? 'text-emerald-600' : tone === 'danger' ? 'text-red-600' : ''}>{(stats.pf ?? 0).toFixed(2)}</strong></span>
        <span className={stats.net > 0 ? 'text-emerald-600' : 'text-red-600'}>
          Net: {stats.net > 0 ? '+' : ''}{(stats.net ?? 0).toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
