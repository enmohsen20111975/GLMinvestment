'use client';

// ============================================================================
// AccuracyDashboard — Historical Accuracy Score for radar signals
// ============================================================================
// Shows the historical win rate of radar signals by type, market, and monthly
// trend.
//
// Layout:
//   ┌──────────────────────────────────────────────────────┐
//   │  📊 دقة الرادار التاريخية                              │
//   │  إجمالي: 245 إشارة | 207 متحقق | 62.5% نجاح           │
//   ├──────────────────────────────────────────────────────┤
//   │  📈 الاتجاه الشهري:                                    │
//   │  [chart showing win rate trend over months]          │
//   ├──────────────────────────────────────────────────────┤
//   │  📋 حسب نوع الإشارة:                                  │
//   │  🚀 Pre-Surge:        68.4% (26/38) | avg +10.3%     │
//   │  🎯 تجميع قوي:        61.2% (20/33) | avg +8.1%      │
//   ├──────────────────────────────────────────────────────┤
//   │  🌍 حسب السوق:                                        │
//   │  🇪🇬 EGX: 65.0% (180 signal)                         │
//   │  🇺🇸 US: 58.0% (45 signal)                           │
//   └──────────────────────────────────────────────────────┘
//
// API: GET /api/radar/accuracy?market={market}&days=90
//
// Color coding:
//   >60%  → emerald (good)
//   40-60 → amber (warning)
//   <40%  → rose (bad)
// ============================================================================

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart3, TrendingUp, TrendingDown, Activity, Clock,
  RefreshCw, AlertTriangle, Trophy, Target, Globe, Layers, Lock,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from '@/components/ui/table';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell,
} from 'recharts';
import { useAppStore } from '@/lib/store';
import { getTrialStatus } from '@/lib/subscription-gate';

// ─── Types (mirror API contract) ─────────────────────────────────────────
interface BySignalType {
  signal_type: string;
  label: string;
  total: number;
  verified: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  avg_outcome_7d: number | null;
  avg_outcome_14d: number | null;
  avg_outcome_30d: number | null;
  avg_time_to_target_days: number | null;
}

interface ByMarket {
  market: string;
  total: number;
  verified: number;
  wins: number;
  win_rate_pct: number;
}

interface MonthlyTrend {
  month: string;
  total: number;
  verified: number;
  wins: number;
  win_rate_pct: number;
}

interface AccuracyResponse {
  success: boolean;
  source?: string;
  market?: string | null;
  days?: number;
  total_signals: number;
  verified: number;
  pending: number;
  wins: number;
  losses: number;
  win_rate_pct: number;
  by_signal_type: BySignalType[];
  by_market: ByMarket[];
  monthly_trend: MonthlyTrend[];
  served_at?: string;
  note?: string;
  error?: string;
}

interface AccuracyDashboardProps {
  market?: string;
  days?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────
const MARKET_FLAG: Record<string, string> = {
  EGX: '🇪🇬',
  TADAWUL: '🇸🇦',
  KSE: '🇰🇼',
  QSE: '🇶🇦',
  US: '🇺🇸',
  CRYPTO: '₿',
  GOLD: '🥇',
  UNKNOWN: '🌐',
};

function colorForWinRate(rate: number): {
  text: string;
  bg: string;
  badge: string;
  bar: string;
  hex: string;
} {
  if (rate >= 60) {
    return {
      text: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-50 dark:bg-emerald-950/30',
      badge: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
      bar: 'bg-emerald-500',
      hex: '#10b981',
    };
  }
  if (rate >= 40) {
    return {
      text: 'text-amber-600 dark:text-amber-400',
      bg: 'bg-amber-50 dark:bg-amber-950/30',
      badge: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
      bar: 'bg-amber-500',
      hex: '#f59e0b',
    };
  }
  return {
    text: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-50 dark:bg-rose-950/30',
    badge: 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800',
    bar: 'bg-rose-500',
    hex: '#f43f5e',
  };
}

const fmtPct = (n: number | null | undefined, withSign = false): string => {
  if (n == null || isNaN(n as number)) return '-';
  const num = Number(n);
  const sign = withSign && num > 0 ? '+' : '';
  return `${sign}${num.toFixed(1)}%`;
};

const fmtNum = (n: number | null | undefined, digits = 2): string => {
  if (n == null || isNaN(n as number)) return '-';
  return Number(n).toFixed(digits);
};

// ─── Component ───────────────────────────────────────────────────────────
export function AccuracyDashboard({ market, days = 90 }: AccuracyDashboardProps) {
  const [data, setData] = useState<AccuracyResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // PAYWALL Gate 3: headline free, details locked for free users post-trial
  const subscriptionUser = useAppStore((s) => s.user);
  const accuracySubStatus = getTrialStatus(subscriptionUser);
  const accuracyLocked = accuracySubStatus.isFreeUser && accuracySubStatus.isTrialExpired;

  const fetchData = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true); else setLoading(true);
    if (!silent) setError(null);
    try {
      const params = new URLSearchParams();
      if (market) params.set('market', market);
      params.set('days', String(days));
      const res = await fetch(`/api/radar/accuracy?${params}`, { cache: 'no-store' });
      const json: AccuracyResponse = await res.json();
      if (json.success) {
        setData(json);
        setLastUpdated(new Date());
      } else {
        setError(json.error || 'فشل في تحميل بيانات الدقة');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [market, days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 5 minutes (accuracy changes slowly)
  useEffect(() => {
    const timer = setInterval(() => fetchData(true), 5 * 60 * 1000);
    return () => clearInterval(timer);
  }, [fetchData]);

  // ─── Derived state ───────────────────────────────────────────────────
  const overallColor = useMemo(
    () => colorForWinRate(data?.win_rate_pct ?? 0),
    [data]
  );

  const monthlyChartData = useMemo(() => {
    if (!data?.monthly_trend) return [];
    return data.monthly_trend.map(t => ({
      month: t.month,
      win_rate: t.win_rate_pct,
      total: t.total,
      color: colorForWinRate(t.win_rate_pct).hex,
    }));
  }, [data]);

  // ─── Loading / Error states ─────────────────────────────────────────
  if (loading && !data) {
    return (
      <div className="space-y-3 p-4" dir="rtl">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card className="p-6 text-center" dir="rtl">
        <AlertTriangle className="h-10 w-10 text-rose-500 mx-auto mb-3" />
        <p className="text-sm text-muted-foreground mb-3">{error}</p>
        <Button size="sm" onClick={() => fetchData()}>
          <RefreshCw className="h-4 w-4 ml-1" /> إعادة المحاولة
        </Button>
      </Card>
    );
  }

  return (
    <div className="space-y-4" dir="rtl" data-testid="accuracy-dashboard">
      {/* ===== HEADER ===== */}
      <Card className="overflow-hidden">
        <div className={`p-4 md:p-5 ${overallColor.bg}`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-background/80 dark:bg-background/40 flex items-center justify-center">
                <BarChart3 className={`h-6 w-6 ${overallColor.text}`} />
              </div>
              <div>
                <h3 className="text-lg md:text-xl font-bold flex items-center gap-2">
                  دقة الرادار التاريخية
                  {market && (
                    <Badge variant="outline" className="text-[10px]">
                      {MARKET_FLAG[market] || '🌐'} {market}
                    </Badge>
                  )}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
                  <span>{data?.days || days} يوم</span>
                  {lastUpdated && (
                    <>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {lastUpdated.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </>
                  )}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchData(true)}
              disabled={refreshing}
              className="gap-1"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              تحديث
            </Button>
          </div>

          {/* Overall stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            <StatBox
              label="إجمالي الإشارات"
              value={data?.total_signals ?? 0}
              icon={<Target className="h-4 w-4" />}
            />
            <StatBox
              label="متحقّق منها"
              value={data?.verified ?? 0}
              sub={data ? `+${data.pending} قيد الانتظار` : ''}
              icon={<Activity className="h-4 w-4" />}
            />
            <StatBox
              label="نسبة النجاح"
              value={`${fmtPct(data?.win_rate_pct ?? 0)}`}
              icon={<Trophy className="h-4 w-4" />}
              valueClassName={overallColor.text}
            />
            <StatBox
              label="الرابحة / الخاسرة"
              value={`${data?.wins ?? 0} / ${data?.losses ?? 0}`}
              icon={data && data.wins >= data.losses ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              valueClassName={overallColor.text}
            />
          </div>

          {/* Win rate progress bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-semibold">نسبة النجاح الإجمالية</span>
              <span className={`font-bold ${overallColor.text}`}>
                {fmtPct(data?.win_rate_pct ?? 0)}
              </span>
            </div>
            <div className="relative h-3 bg-muted rounded-full overflow-hidden">
              <div
                className={`absolute inset-y-0 right-0 ${overallColor.bar} transition-all duration-700`}
                style={{ width: `${Math.min(100, data?.win_rate_pct ?? 0)}%` }}
                data-testid="win-rate-progress-bar"
              />
            </div>
            <div className="flex items-center justify-between text-[10px] text-muted-foreground mt-1">
              <span>0%</span>
              <span className="text-amber-600">40%</span>
              <span className="text-emerald-600">60%</span>
              <span>100%</span>
            </div>
          </div>

          {data?.note && (
            <div className="mt-3 text-xs text-muted-foreground bg-amber-50 dark:bg-amber-950/30 rounded-md p-2 border border-amber-200 dark:border-amber-900">
              {data.note}
            </div>
          )}
        </div>
      </Card>

      {/* ===== MONTHLY TREND CHART — PAYWALL Gate 3: locked for free users post-trial ===== */}
      {accuracyLocked ? (
        <LockedDetailsCard
          title="الاتجاه الشهري"
          icon={<Layers className="h-4 w-4 text-emerald-600" />}
          message="تفاصيل الاتجاه الشهري متاحة للمشتركين"
        />
      ) : (
      <Card data-testid="monthly-trend-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4 text-emerald-600" />
            الاتجاه الشهري
          </CardTitle>
        </CardHeader>
        <CardContent className="p-3">
          {monthlyChartData.length === 0 ? (
            <div className="text-center text-sm text-muted-foreground py-8">
              <Activity className="h-8 w-8 mx-auto mb-2 opacity-40" />
              لا توجد بيانات اتجاه شهري متاحة
            </div>
          ) : (
            <div className="w-full h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={monthlyChartData}
                  margin={{ top: 8, right: 8, left: -16, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(120,120,120,0.15)" />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 11, fill: 'currentColor' }}
                    className="text-muted-foreground"
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={{ fontSize: 11, fill: 'currentColor' }}
                    className="text-muted-foreground"
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip
                    formatter={(value: number) => [`${value.toFixed(1)}%`, 'نسبة النجاح']}
                    labelFormatter={(label: string) => `الشهر: ${label}`}
                    contentStyle={{
                      backgroundColor: 'rgba(30,30,30,0.95)',
                      border: '1px solid rgba(120,120,120,0.3)',
                      borderRadius: '6px',
                      color: '#fff',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="win_rate" name="نسبة النجاح" radius={[4, 4, 0, 0]}>
                    {monthlyChartData.map((entry, idx) => (
                      <Cell key={`cell-${idx}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          {/* Monthly summary table */}
          {monthlyChartData.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الشهر</TableHead>
                    <TableHead className="text-left">الإشارات</TableHead>
                    <TableHead className="text-left">المتحقّق</TableHead>
                    <TableHead className="text-left">الرابحة</TableHead>
                    <TableHead className="text-left">نسبة النجاح</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.monthly_trend.slice().reverse().map((t) => {
                    const c = colorForWinRate(t.win_rate_pct);
                    return (
                      <TableRow key={t.month} data-testid={`monthly-row-${t.month}`}>
                        <TableCell className="font-mono text-xs">{t.month}</TableCell>
                        <TableCell className="text-left font-mono text-xs">{t.total}</TableCell>
                        <TableCell className="text-left font-mono text-xs">{t.verified}</TableCell>
                        <TableCell className="text-left font-mono text-xs">{t.wins}</TableCell>
                        <TableCell className="text-left">
                          <Badge variant="outline" className={`text-[10px] ${c.badge}`}>
                            {fmtPct(t.win_rate_pct)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* ===== BY SIGNAL TYPE — PAYWALL Gate 3: locked for free users post-trial ===== */}
      {accuracyLocked ? (
        <LockedDetailsCard
          title="حسب نوع الإشارة"
          icon={<BarChart3 className="h-4 w-4 text-emerald-600" />}
          message="تفاصيل الدقة حسب نوع الإشارة متاحة للمشتركين"
        />
      ) : (
      <Card data-testid="by-signal-type-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-emerald-600" />
            حسب نوع الإشارة
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>النوع</TableHead>
                <TableHead className="text-left">الإشارات</TableHead>
                <TableHead className="text-left">المتحقّق</TableHead>
                <TableHead className="text-left">الرابحة</TableHead>
                <TableHead className="text-left">نسبة النجاح</TableHead>
                <TableHead className="text-left">متوسط العائد</TableHead>
                <TableHead className="text-left">زمن الهدف</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.by_signal_type.map((s) => {
                const c = colorForWinRate(s.win_rate_pct);
                return (
                  <TableRow
                    key={s.signal_type}
                    data-testid={`signal-type-row-${s.signal_type}`}
                  >
                    <TableCell>
                      <span className="font-semibold text-sm">{s.label}</span>
                      <div className="text-[9px] text-muted-foreground font-mono">
                        {s.signal_type}
                      </div>
                    </TableCell>
                    <TableCell className="text-left font-mono text-xs">{s.total}</TableCell>
                    <TableCell className="text-left font-mono text-xs">{s.verified}</TableCell>
                    <TableCell className="text-left font-mono text-xs">
                      <span className={s.wins > 0 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : ''}>
                        {s.wins}
                      </span>
                      <span className="text-muted-foreground"> / </span>
                      <span className={s.losses > 0 ? 'text-rose-600 dark:text-rose-400' : ''}>
                        {s.losses}
                      </span>
                    </TableCell>
                    <TableCell className="text-left">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-[10px] ${c.badge}`}
                          data-testid={`signal-type-winrate-${s.signal_type}`}
                        >
                          {fmtPct(s.win_rate_pct)}
                        </Badge>
                        <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden hidden sm:block">
                          <div
                            className={`h-full ${c.bar}`}
                            style={{ width: `${Math.min(100, s.win_rate_pct)}%` }}
                          />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-left font-mono text-xs">
                      <span className={
                        (s.avg_outcome_30d ?? 0) > 0
                          ? 'text-emerald-600 dark:text-emerald-400 font-semibold'
                          : (s.avg_outcome_30d ?? 0) < 0
                            ? 'text-rose-600 dark:text-rose-400 font-semibold'
                            : 'text-muted-foreground'
                      }>
                        {fmtPct(s.avg_outcome_30d, true)}
                      </span>
                    </TableCell>
                    <TableCell className="text-left font-mono text-xs text-muted-foreground">
                      {s.avg_time_to_target_days != null
                        ? `${fmtNum(s.avg_time_to_target_days, 1)} يوم`
                        : '-'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      )}

      {/* ===== BY MARKET — PAYWALL Gate 3: locked for free users post-trial ===== */}
      {accuracyLocked ? (
        <LockedDetailsCard
          title="حسب السوق"
          icon={<Globe className="h-4 w-4 text-emerald-600" />}
          message="تفاصيل الدقة حسب السوق متاحة للمشتركين"
        />
      ) : (
      <Card data-testid="by-market-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Globe className="h-4 w-4 text-emerald-600" />
            حسب السوق
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {data && data.by_market.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <Globe className="h-8 w-8 mx-auto mb-2 opacity-40" />
              لا توجد بيانات حسب السوق متاحة
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>السوق</TableHead>
                  <TableHead className="text-left">الإشارات</TableHead>
                  <TableHead className="text-left">المتحقّق</TableHead>
                  <TableHead className="text-left">الرابحة</TableHead>
                  <TableHead className="text-left">نسبة النجاح</TableHead>
                  <TableHead className="text-left w-32">التقدّم</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data?.by_market.map((m) => {
                  const c = colorForWinRate(m.win_rate_pct);
                  return (
                    <TableRow key={m.market} data-testid={`market-row-${m.market}`}>
                      <TableCell>
                        <span className="text-base ml-1">{MARKET_FLAG[m.market] || '🌐'}</span>
                        <span className="font-semibold text-sm">{m.market}</span>
                      </TableCell>
                      <TableCell className="text-left font-mono text-xs">{m.total}</TableCell>
                      <TableCell className="text-left font-mono text-xs">{m.verified}</TableCell>
                      <TableCell className="text-left font-mono text-xs">
                        <span className={m.wins > 0 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : ''}>
                          {m.wins}
                        </span>
                      </TableCell>
                      <TableCell className="text-left">
                        <Badge variant="outline" className={`text-[10px] ${c.badge}`}>
                          {fmtPct(m.win_rate_pct)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-left">
                        <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${c.bar}`}
                            style={{ width: `${Math.min(100, m.win_rate_pct)}%` }}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      )}

      {/* ===== Footer ===== */}
      <Card className="bg-muted/40">
        <CardContent className="p-3 text-center text-xs text-muted-foreground">
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Clock className="h-3 w-3" />
            <span>يتم التحديث تلقائياً كل 5 دقائق</span>
            <span>•</span>
            <span>المصدر: {data?.source || 'غير معروف'}</span>
            {data?.served_at && (
              <>
                <span>•</span>
                <span>
                  آخر تحديث: {new Date(data.served_at).toLocaleString('ar-EG')}
                </span>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

// PAYWALL Gate 3: locked details placeholder — replaces the by-signal-type /
// by-market / monthly-trend cards for free users post-trial. Keeps the
// headline stats visible (sold as the "competence proof") and locks the
// per-row breakdown (which would expose losing signals).
function LockedDetailsCard({
  title,
  icon,
  message,
}: {
  title: string;
  icon?: React.ReactNode;
  message: string;
}) {
  return (
    <Card className="border-amber-500/30 bg-amber-50/30 dark:bg-amber-950/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 flex flex-col items-center gap-2 text-center">
        <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center">
          <Lock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
        </div>
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
          🔒 {message}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 mt-1"
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.location.href = '/pricing';
            }
          }}
        >
          اشترك لعرض التفاصيل
        </Button>
      </CardContent>
    </Card>
  );
}

function StatBox({
  label,
  value,
  sub,
  icon,
  valueClassName = '',
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="bg-background/70 dark:bg-background/40 rounded-lg p-3 border border-border/50">
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-0.5">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`text-xl font-bold ${valueClassName}`}>{value}</div>
      {sub && (
        <div className="text-[9px] text-muted-foreground mt-0.5">{sub}</div>
      )}
    </div>
  );
}

export default AccuracyDashboard;
