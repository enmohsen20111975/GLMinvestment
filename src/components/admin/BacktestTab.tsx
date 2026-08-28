'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Play, RefreshCw, TrendingUp, TrendingDown, Activity, Target, Zap } from 'lucide-react';
import { toast } from 'sonner';

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

interface BacktestData {
  summary: BacktestSummary;
  morning_bell?: OutOfSampleStats;
  by_month?: MonthStats[];
  by_ticker?: TickerStats[];
  explosive_stocks?: TickerStats[];
  out_of_sample?: {
    last_30d?: OutOfSampleStats;
    last_45d?: OutOfSampleStats;
  };
}

export function BacktestTab() {
  const [data, setData] = useState<BacktestData | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<'idle' | 'running' | 'completed' | 'failed'>('idle');
  const [startDate, setStartDate] = useState('2025-12-01');
  const [endDate, setEndDate] = useState('2026-08-27');
  const [maxPicks, setMaxPicks] = useState(5);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/backtest/v40/stats');
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
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  // Poll job status if running
  useEffect(() => {
    if (!jobId || jobStatus !== 'running') return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/admin/backtest/v40/status/${jobId}`);
        const json = await res.json();
        if (json.success && json.data) {
          if (json.data.completed) {
            setJobStatus('completed');
            setRunning(false);
            toast.success('الباك تست خلص! اضغط "تحديث الإحصائيات" لرؤية النتائج.');
            clearInterval(interval);
          }
        }
      } catch (e) {
        // ignore
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [jobId, jobStatus]);

  const runBacktest = async () => {
    setRunning(true);
    setJobStatus('running');
    try {
      const res = await fetch('/api/admin/backtest/v40/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: startDate,
          end_date: endDate,
          max_picks: maxPicks,
          clear_existing: true,
        }),
      });
      const json = await res.json();
      if (json.success) {
        setJobId(json.data.job_id);
        toast.info(`الباك تست بدأ (job ${json.data.job_id}). ممكن ياخد 5-10 دقايق.`);
      } else {
        toast.error(json.error || 'فشل بدء الباك تست');
        setJobStatus('failed');
        setRunning(false);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'خطأ');
      setJobStatus('failed');
      setRunning(false);
    }
  };

  const summary = data?.summary;
  const hasResults = summary && summary.total > 0 && summary.wins !== undefined;

  return (
    <div className="space-y-4">
      {/* Header + Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5" />
            V40.2 Backtest — محرك التوقعات
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
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
          </div>
          {jobStatus === 'running' && (
            <p className="text-sm text-muted-foreground">
              ⏳ الباك تست بيشتغل في الخلفية. النتائج هتظهر تلقائياً لما يخلص.
              ممكن تتابع اللوج في: <code className="text-xs">/tmp/v40_backtest_{jobId}.log</code>
            </p>
          )}
        </CardContent>
      </Card>

      {/* Summary */}
      {hasResults ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="إجمالي الصفقات"
              value={summary!.total!.toString()}
              icon={<Activity className="w-4 h-4" />}
            />
            <StatCard
              label="Win Rate"
              value={`${summary!.wr!.toFixed(1)}%`}
              icon={summary!.wr! >= 50 ? <TrendingUp className="w-4 h-4 text-emerald-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
              tone={summary!.wr! >= 50 ? 'success' : 'danger'}
            />
            <StatCard
              label="Profit Factor"
              value={summary!.pf!.toFixed(2)}
              icon={<Target className="w-4 h-4" />}
              tone={summary!.pf! >= 1.5 ? 'success' : 'danger'}
            />
            <StatCard
              label="Net Return"
              value={`${summary!.net! > 0 ? '+' : ''}${summary!.net!.toFixed(1)}%`}
              icon={summary!.net! > 0 ? <TrendingUp className="w-4 h-4 text-emerald-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
              tone={summary!.net! > 0 ? 'success' : 'danger'}
            />
          </div>

          {/* Detailed stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Wins / Losses" value={`${summary!.wins} / ${summary!.losses}`} />
            <StatCard label="Avg Win" value={`+${summary!.avg_win!.toFixed(2)}%`} tone="success" />
            <StatCard label="Avg Loss" value={`-${summary!.avg_loss!.toFixed(2)}%`} tone="danger" />
            <StatCard label="R:R Ratio" value={`${summary!.rr_ratio!.toFixed(2)}:1`} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <StatCard label="Expectancy / trade" value={`${summary!.expectancy! > 0 ? '+' : ''}${summary!.expectancy!.toFixed(2)}%`} tone={summary!.expectancy! > 0 ? 'success' : 'danger'} />
            {data?.morning_bell && (
              <StatCard
                label="Morning Bell"
                value={`${data.morning_bell.trades}T | WR ${data.morning_bell.wr.toFixed(1)}% | Net ${data.morning_bell.net > 0 ? '+' : ''}${data.morning_bell.net.toFixed(1)}%`}
                tone={data.morning_bell.net > 0 ? 'success' : 'danger'}
              />
            )}
          </div>

          {/* Out-of-sample */}
          {data?.out_of_sample && (
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
                            <Badge variant={m.wr >= 50 ? 'default' : 'destructive'}>{m.wr.toFixed(0)}%</Badge>
                          </td>
                          <td className={`p-2 font-mono ${m.net > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {m.net > 0 ? '+' : ''}{m.net.toFixed(1)}%
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
                            <Badge variant={t.wr >= 50 ? 'default' : 'destructive'}>{t.wr.toFixed(0)}%</Badge>
                          </td>
                          <td className={`p-2 font-mono ${t.net > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {t.net > 0 ? '+' : ''}{t.net.toFixed(1)}%
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
                            <Badge variant={t.wr >= 50 ? 'default' : 'destructive'}>{t.wr.toFixed(0)}%</Badge>
                          </td>
                          <td className={`p-2 font-mono ${t.net > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {t.net > 0 ? '+' : ''}{t.net.toFixed(1)}%
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
}: { label: string; value: string; icon?: React.ReactNode; tone?: 'success' | 'danger' }) {
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
        <span>WR: <strong>{stats.wr.toFixed(1)}%</strong></span>
        <span>PF: <strong className={tone === 'success' ? 'text-emerald-600' : tone === 'danger' ? 'text-red-600' : ''}>{stats.pf.toFixed(2)}</strong></span>
        <span className={stats.net > 0 ? 'text-emerald-600' : 'text-red-600'}>
          Net: {stats.net > 0 ? '+' : ''}{stats.net.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}
