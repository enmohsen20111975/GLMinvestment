'use client';
<<<<<<< HEAD

/**
 * AuditedPerformanceView — سجل الأداء الموثق (Audited Track Record)
 * ==================================================================
 * T-ALPHA-A17: يعرض الصفقات المغلقة بشفافية كاملة:
 *   - بانر إحصائي فخم (إجمالي / Win Rate / متوسط الربح / أفضل صفقة)
 *   - جدول الصفقات المغلقة (تاريخ دخول/خروج، ربح/خسارة، نتيجة)
 *
 * مصدر البيانات: /api/v2/commercial-feed (audited_performance track)
 * Rule 27: لا بيانات وهمية — إذا الـ API فارغ، اعرض رسالة واضحة.
 */

=======
>>>>>>> 0a55727 (feat(ui): A-18: Null safety + unified Arabic tabs + English purge)
import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
<<<<<<< HEAD
import {
  Trophy, TrendingUp, TrendingDown, Target, ShieldAlert,
  RefreshCw, Activity, Award, BarChart3,
} from 'lucide-react';

interface AuditedTrade {
  ticker: string;
  signal: string;
  signal_ar: string;
  entry_price: number | null;
  target_price: number | null;
  stop_loss: number | null;
  exit_price: number | null;
  actual_return: number | null;
  pnl_pct: number | null;
  hit_target: number | null;
  hit_stop: number | null;
  holding_days: number | null;
  market: string;
  prediction_date: string | null;
  closed_at: string | null;
}

interface FeedResponse {
  success: boolean;
  audited_performance: AuditedTrade[];
  stats: {
    live_count: number;
    audited_count: number;
    win_rate: number | null;
    avg_return: number | null;
  };
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(1)}%`;
}

function fmtPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return Number(n).toFixed(2);
}
=======
import { Trophy, TrendingUp, Activity, RefreshCw, Award, BarChart3, Target, ShieldAlert } from 'lucide-react';

interface AuditedTrade {
  ticker: string; signal: string; signal_ar: string; entry_price: number | null;
  target_price: number | null; stop_loss: number | null; exit_price: number | null;
  actual_return: number | null; pnl_pct: number | null; hit_target: number | null;
  hit_stop: number | null; holding_days: number | null; market: string;
  prediction_date: string | null; closed_at: string | null;
}
interface FeedResponse {
  success: boolean; audited_performance: AuditedTrade[];
  stats: { live_count: number; audited_count: number; win_rate: number | null; avg_return: number | null; };
}
function fmtPct(n: number | null | undefined): string { if (n == null || !Number.isFinite(Number(n))) return '—'; const s = n >= 0 ? '+' : ''; return `${s}${Number(n).toFixed(1)}%`; }
function fmtPrice(n: number | null | undefined): string { if (n == null || !Number.isFinite(Number(n))) return '—'; return Number(n).toFixed(2); }
>>>>>>> 0a55727 (feat(ui): A-18: Null safety + unified Arabic tabs + English purge)

export function AuditedPerformanceView({ market }: { market: string }) {
  const [data, setData] = useState<FeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
<<<<<<< HEAD

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
=======
  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
>>>>>>> 0a55727 (feat(ui): A-18: Null safety + unified Arabic tabs + English purge)
    try {
      const res = await fetch(`/api/v2/commercial-feed?market=${encodeURIComponent(market)}`, { cache: 'no-store' });
      if (!res.ok) { setError('تعذّر جلب سجل الأداء'); setData(null); return; }
      const json: FeedResponse = await res.json();
      if (!json.success) { setError('تعذّر جلب سجل الأداء'); setData(null); return; }
      setData(json);
<<<<<<< HEAD
    } catch {
      setError('تعذّر الاتصال بالخادم');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-3">
          <Activity className="w-8 h-8 text-amber-500 mx-auto" />
          <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">{error || 'لا توجد بيانات'}</p>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" /> إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  const rawData = data as any;
  const trades: any[] = rawData.audited_performance_history || rawData.audited_performance || [];
  const stats: any = rawData.summary?.audited_performance || rawData.stats || {};

  if (trades.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-2">
          <Trophy className="w-8 h-8 text-muted-foreground/40 mx-auto" />
          <p className="text-sm font-semibold text-muted-foreground">
            لا توجد صفقات مغلقة في السجل الموثق حالياً
          </p>
          <p className="text-xs text-muted-foreground">
            سيظهر سجل الأداء الشفاف هنا فور إغلاق أول صفقة محققة
          </p>
          <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5 mt-2">
            <RefreshCw className="w-3.5 h-3.5" /> تحديث
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Compute stats locally from trades (in case API stats are null)
  const wins = trades.filter(t => Number(t.hit_target) === 1 || (Number(t.actual_return) > 0));
  const losses = trades.filter(t => Number(t.hit_stop) === 1 || (Number(t.actual_return) < 0));
  const winRate = stats.win_rate != null ? stats.win_rate : trades.length > 0 ? Math.round((wins.length / trades.length) * 1000) / 10 : null;
  const avgReturn = stats.avg_return != null ? stats.avg_return : trades.length > 0 ? Math.round((trades.reduce((s, t) => s + (Number(t.actual_return) || 0), 0) / trades.length) * 100) / 100 : null;
  const bestTrade = trades.reduce((best, t) => {
    const ret = Number(t.actual_return) || 0;
    return ret > (Number(best?.actual_return) || -Infinity) ? t : best;
  }, trades[0]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* ===== T-ALPHA-A17: بانر إحصائي فخم ===== */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<BarChart3 className="w-4 h-4" />}
          label="إجمالي الصفقات"
          value={`${trades.length}`}
          accent="text-foreground"
        />
        <StatCard
          icon={<Trophy className="w-4 h-4" />}
          label="نسبة النجاح"
          value={winRate != null ? `${winRate}%` : '—'}
          accent={winRate != null && winRate >= 60 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}
          subtext={`${wins.length} رابحة / ${losses.length} خاسرة`}
        />
        <StatCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="متوسط الربح"
          value={avgReturn != null ? fmtPct(avgReturn) : '—'}
          accent={avgReturn != null && avgReturn >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}
        />
        <StatCard
          icon={<Award className="w-4 h-4" />}
          label="أفضل صفقة"
          value={bestTrade ? `${bestTrade.ticker} ${fmtPct(Number(bestTrade.actual_return))}` : '—'}
          accent="text-emerald-600 dark:text-emerald-400"
          subtext={bestTrade?.prediction_date || ''}
        />
      </div>

      {/* ===== T-ALPHA-A17: جدول الصفقات المغلقة ===== */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary" />
              سجل الصفقات المغلقة ({trades.length})
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={fetchData} className="h-7 px-2">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="max-h-[500px] overflow-y-auto rounded-md border border-border/30
                          [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent
                          [&::-webkit-scrollbar-thumb]:bg-border/60 [&::-webkit-scrollbar-thumb]:rounded-full">
            {/* Table header */}
            <div className="grid grid-cols-12 gap-1 px-2 py-2 border-b border-border/40 text-[9px] font-bold text-muted-foreground uppercase tracking-wide sticky top-0 bg-card z-10">
              <div className="col-span-2">السهم</div>
              <div className="col-span-2 text-center">دخول</div>
              <div className="col-span-2 text-center">خروج</div>
              <div className="col-span-2 text-center">النتيجة</div>
              <div className="col-span-2 text-center">المدة</div>
              <div className="col-span-2 text-center">العائد %</div>
            </div>
            {/* Table rows */}
=======
    } catch { setError('تعذّر الاتصال بالخادم'); setData(null); }
    finally { setLoading(false); }
  }, [market]);
  useEffect(() => { fetchData(); }, [fetchData]);
  if (loading) return (<div className="space-y-3"><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-64 w-full rounded-xl" /></div>);
  if (error || !data) return (
    <Card><CardContent className="p-6 text-center space-y-3">
      <Activity className="w-8 h-8 text-amber-500 mx-auto" />
      <p className="text-sm font-semibold text-amber-600 dark:text-amber-400">{error || 'لا توجد بيانات'}</p>
      <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> إعادة المحاولة</Button>
    </CardContent></Card>
  );
  const trades = data.audited_performance;
  // T-ALPHA-18: Null safety — stats?.win_rate ?? null + local fallback
  const stats = data?.stats;
  const wins = trades.filter(t => Number(t.hit_target) === 1 || (Number(t.actual_return) > 0));
  const losses = trades.filter(t => Number(t.hit_stop) === 1 || (Number(t.actual_return) < 0));
  const winRate = stats?.win_rate ?? (trades.length > 0 ? Math.round((wins.length / trades.length) * 1000) / 10 : null);
  const avgReturn = stats?.avg_return ?? (trades.length > 0 ? Math.round((trades.reduce((s, t) => s + (Number(t.actual_return) || 0), 0) / trades.length) * 100) / 100 : null);
  const bestTrade = trades.length > 0 ? trades.reduce((best, t) => (Number(t.actual_return) || 0) > (Number(best?.actual_return) || -Infinity) ? t : best, trades[0]) : null;

  if (trades.length === 0) return (
    <Card><CardContent className="p-6 text-center space-y-2">
      <Trophy className="w-8 h-8 text-muted-foreground/40 mx-auto" />
      <p className="text-sm font-semibold text-muted-foreground">لا توجد صفقات مغلقة في السجل الموثق حالياً</p>
      <p className="text-xs text-muted-foreground">سيظهر سجل الأداء الشفاف هنا فور إغلاق أول صفقة محققة</p>
      <Button variant="outline" size="sm" onClick={fetchData} className="gap-1.5 mt-2"><RefreshCw className="w-3.5 h-3.5" /> تحديث</Button>
    </CardContent></Card>
  );

  return (
    <div className="space-y-4" dir="rtl">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<BarChart3 className="w-4 h-4" />} label="إجمالي الصفقات" value={`${trades.length}`} accent="text-foreground" />
        <StatCard icon={<Trophy className="w-4 h-4" />} label="نسبة النجاح" value={winRate != null ? `${winRate}%` : '—'} accent={winRate != null && winRate >= 60 ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'} subtext={`${wins.length} رابحة / ${losses.length} خاسرة`} />
        <StatCard icon={<TrendingUp className="w-4 h-4" />} label="متوسط الربح" value={avgReturn != null ? fmtPct(avgReturn) : '—'} accent={avgReturn != null && avgReturn >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'} />
        <StatCard icon={<Award className="w-4 h-4" />} label="أفضل صفقة" value={bestTrade ? `${bestTrade.ticker} ${fmtPct(Number(bestTrade.actual_return))}` : '—'} accent="text-emerald-600 dark:text-emerald-400" subtext={bestTrade?.prediction_date || ''} />
      </div>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2"><Activity className="w-4 h-4 text-primary" /> سجل الصفقات المغلقة ({trades.length})</CardTitle>
            <Button variant="ghost" size="sm" onClick={fetchData} className="h-7 px-2"><RefreshCw className="w-3.5 h-3.5" /></Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="max-h-[500px] overflow-y-auto rounded-md border border-border/30 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-border/60 [&::-webkit-scrollbar-thumb]:rounded-full">
            <div className="grid grid-cols-12 gap-1 px-2 py-2 border-b border-border/40 text-[9px] font-bold text-muted-foreground uppercase tracking-wide sticky top-0 bg-card z-10">
              <div className="col-span-2">السهم</div><div className="col-span-2 text-center">دخول</div><div className="col-span-2 text-center">خروج</div><div className="col-span-2 text-center">النتيجة</div><div className="col-span-2 text-center">المدة</div><div className="col-span-2 text-center">العائد %</div>
            </div>
>>>>>>> 0a55727 (feat(ui): A-18: Null safety + unified Arabic tabs + English purge)
            {trades.map((trade, idx) => {
              const isWin = Number(trade.hit_target) === 1 || (Number(trade.actual_return) > 0);
              const isLoss = Number(trade.hit_stop) === 1 || (Number(trade.actual_return) < 0);
              const ret = Number(trade.actual_return) || Number(trade.pnl_pct) || 0;
              return (
<<<<<<< HEAD
                <div
                  key={`${trade.ticker}-${trade.prediction_date}-${idx}`}
                  className={cn(
                    'grid grid-cols-12 gap-1 px-2 py-1.5 border-b border-border/20 hover:bg-muted/30 transition-colors text-xs items-center',
                    isWin && 'bg-emerald-500/5',
                    isLoss && 'bg-red-500/5',
                  )}
                >
                  <div className="col-span-2">
                    <div className="font-mono font-bold text-[11px]">{trade.ticker}</div>
                    <div className="text-[8px] text-muted-foreground">{trade.prediction_date || '—'}</div>
                  </div>
                  <div className="col-span-2 text-center font-mono text-[10px] tabular-nums">
                    {fmtPrice(trade.entry_price)}
                  </div>
                  <div className="col-span-2 text-center font-mono text-[10px] tabular-nums">
                    {fmtPrice(trade.exit_price)}
                  </div>
                  <div className="col-span-2 text-center">
                    {isWin ? (
                      <Badge className="text-[8px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                        <Target className="w-2.5 h-2.5 ml-0.5" /> ✅ حقق الهدف
                      </Badge>
                    ) : isLoss ? (
                      <Badge className="text-[8px] bg-red-500/10 text-red-600 border-red-500/30">
                        <ShieldAlert className="w-2.5 h-2.5 ml-0.5" /> 🛑 ضرب الوقف
                      </Badge>
                    ) : (
                      <Badge className="text-[8px] bg-muted text-muted-foreground">
                        مُغلق
                      </Badge>
                    )}
                  </div>
                  <div className="col-span-2 text-center text-[10px] text-muted-foreground tabular-nums">
                    {trade.holding_days != null ? `${trade.holding_days} يوم` : '—'}
                  </div>
                  <div className={cn(
                    'col-span-2 text-center font-mono font-bold text-xs tabular-nums',
                    ret > 0 ? 'text-emerald-600 dark:text-emerald-400' : ret < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
                  )}>
                    {ret >= 0 ? '+' : ''}{ret.toFixed(1)}%
                  </div>
=======
                <div key={`${trade.ticker}-${trade.prediction_date}-${idx}`} className={cn('grid grid-cols-12 gap-1 px-2 py-1.5 border-b border-border/20 hover:bg-muted/30 transition-colors text-xs items-center', isWin && 'bg-emerald-500/5', isLoss && 'bg-red-500/5')}>
                  <div className="col-span-2"><div className="font-mono font-bold text-[11px]">{trade.ticker}</div><div className="text-[8px] text-muted-foreground">{trade.prediction_date || '—'}</div></div>
                  <div className="col-span-2 text-center font-mono text-[10px] tabular-nums">{fmtPrice(trade.entry_price)}</div>
                  <div className="col-span-2 text-center font-mono text-[10px] tabular-nums">{fmtPrice(trade.exit_price)}</div>
                  <div className="col-span-2 text-center">{isWin ? <Badge className="text-[8px] bg-emerald-500/10 text-emerald-600 border-emerald-500/30"><Target className="w-2.5 h-2.5 ml-0.5" /> ✅ حقق الهدف</Badge> : isLoss ? <Badge className="text-[8px] bg-red-500/10 text-red-600 border-red-500/30"><ShieldAlert className="w-2.5 h-2.5 ml-0.5" /> 🛑 ضرب الوقف</Badge> : <Badge className="text-[8px] bg-muted text-muted-foreground">مُغلق</Badge>}</div>
                  <div className="col-span-2 text-center text-[10px] text-muted-foreground tabular-nums">{trade.holding_days != null ? `${trade.holding_days} يوم` : '—'}</div>
                  <div className={cn('col-span-2 text-center font-mono font-bold text-xs tabular-nums', ret > 0 ? 'text-emerald-600 dark:text-emerald-400' : ret < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>{ret >= 0 ? '+' : ''}{ret.toFixed(1)}%</div>
>>>>>>> 0a55727 (feat(ui): A-18: Null safety + unified Arabic tabs + English purge)
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
<<<<<<< HEAD

// ════════════════════════════════════════════════════════════════════════════
// StatCard — بطاقة إحصائية فخمة للبانر
// ════════════════════════════════════════════════════════════════════════════
function StatCard({
  icon,
  label,
  value,
  accent,
  subtext,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
  subtext?: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          {icon}
          <span className="text-[10px] font-semibold">{label}</span>
        </div>
        <div className={cn('text-lg font-bold tabular-nums', accent)}>
          {value}
        </div>
        {subtext && (
          <div className="text-[9px] text-muted-foreground">{subtext}</div>
        )}
      </CardContent>
    </Card>
  );
=======
function StatCard({ icon, label, value, accent, subtext }: { icon: React.ReactNode; label: string; value: string; accent: string; subtext?: string; }) {
  return (<Card className="overflow-hidden"><CardContent className="p-3 space-y-1"><div className="flex items-center gap-1.5 text-muted-foreground">{icon}<span className="text-[10px] font-semibold">{label}</span></div><div className={cn('text-lg font-bold tabular-nums', accent)}>{value}</div>{subtext && <div className="text-[9px] text-muted-foreground">{subtext}</div>}</CardContent></Card>);
>>>>>>> 0a55727 (feat(ui): A-18: Null safety + unified Arabic tabs + English purge)
}
