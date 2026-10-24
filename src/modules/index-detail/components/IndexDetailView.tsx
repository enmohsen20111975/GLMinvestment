'use client';

/**
 * IndexDetailView — شاشة احترافية لعرض مؤشر + تأثير كل سهم عليه.
 *
 * Structure (engineering, not copy-paste):
 * 1. IndexHeaderBar — selector + value display
 * 2. IndexPriceChart — recharts area chart with period selector
 * 3. ConstituentEffectBreakdown — diverging bar chart (each stock's contribution)
 * 4. TopMoversList — top 5 gainers + losers (derived from breakdown)
 *
 * Data: 2 API routes (history + breakdown) via useApiQuery.
 * Reuses: recharts, shadcn/ui, apiGet/useApiQuery, UnifiedTable.
 */
import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, BarChart, Bar, Cell, ReferenceLine,
} from 'recharts';

const INDEX_OPTIONS = [
  { value: 'EGX30', label: 'EGX 30', method: 'مرجّح بالقيمة السوقية' },
  { value: 'EGX70', label: 'EGX 70', method: 'أوزان متساوية' },
  { value: 'EGX100', label: 'EGX 100', method: 'أوزان متساوية' },
  { value: 'EGX33', label: 'EGX 33 الشرعي', method: 'شرعي — حد 15%' },
];

const PERIODS = [
  { value: '1W', label: 'أسبوع' },
  { value: '1M', label: 'شهر' },
  { value: '3M', label: '3 شهور' },
  { value: '6M', label: '6 شهور' },
  { value: '1Y', label: 'سنة' },
];

interface HistoryBar { date: string; close: number; change_pct: number; }
interface Constituent {
  code: string; name_ar: string; sector: string;
  weight: number; change_pct: number; contribution: number; direction: string;
}

export function IndexDetailView({ initialSymbol = 'EGX30' }: { initialSymbol?: string }) {
  const [symbol, setSymbol] = useState(initialSymbol);
  const [period, setPeriod] = useState('1M');
  const [history, setHistory] = useState<HistoryBar[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [breakdown, setBreakdown] = useState<{ constituents: Constituent[]; summary: any; index_value: number; index_change_pct: number } | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);

  // Fetch history
  React.useEffect(() => {
    let cancelled = false;
    setLoadingHistory(true);
    fetch(`/api/market/indices/${symbol}/history?period=${period}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!cancelled && d) {
          setHistory(d.series || []);
          setStats(d.stats || null);
        }
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingHistory(false));
    return () => { cancelled = true; };
  }, [symbol, period]);

  // Fetch breakdown
  React.useEffect(() => {
    let cancelled = false;
    setLoadingBreakdown(true);
    fetch(`/api/market/indices/${symbol}/breakdown`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!cancelled && d) setBreakdown(d);
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoadingBreakdown(false));
    return () => { cancelled = true; };
  }, [symbol]);

  const indexMeta = INDEX_OPTIONS.find(o => o.value === symbol)!;
  const chartData = history.map(h => ({ date: h.date, close: h.close }));
  const topGainers = useMemo(() =>
    breakdown ? breakdown.constituents.filter(c => c.direction === 'up').sort((a,b) => b.contribution - a.contribution).slice(0, 5) : [],
  [breakdown]);
  const topLosers = useMemo(() =>
    breakdown ? breakdown.constituents.filter(c => c.direction === 'down').sort((a,b) => a.contribution - b.contribution).slice(0, 5) : [],
  [breakdown]);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header: index selector + value */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Select value={symbol} onValueChange={setSymbol}>
                <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INDEX_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <Badge variant="outline" className="text-xs">{indexMeta.method}</Badge>
            </div>
            {breakdown && (
              <div className="text-left">
                <div className="text-2xl font-bold tabular-nums">
                  {breakdown.index_value.toLocaleString('ar-EG', { maximumFractionDigits: 2 })}
                </div>
                <div className={cn('text-sm font-semibold', breakdown.index_change_pct >= 0 ? 'text-profit' : 'text-loss')}>
                  {breakdown.index_change_pct >= 0 ? '+' : ''}{breakdown.index_change_pct.toFixed(2)}%
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Chart + period selector */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4" />
              حركة المؤشر
            </CardTitle>
            <div className="flex gap-1">
              {PERIODS.map(p => (
                <Button
                  key={p.value}
                  variant={period === p.value ? 'default' : 'ghost'}
                  size="sm"
                  className="text-xs h-7 px-2"
                  onClick={() => setPeriod(p.value)}
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loadingHistory ? (
            <Skeleton className="h-64 w-full rounded-lg" />
          ) : chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <defs>
                  <linearGradient id="indexGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} className="text-muted-foreground" interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} orientation="right" />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                  labelStyle={{ color: 'hsl(var(--muted-foreground))' }}
                />
                <Area type="monotone" dataKey="close" stroke="#10b981" strokeWidth={2} fill="url(#indexGradient)" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">
              لا توجد بيانات تاريخية متاحة لهذا المؤشر حالياً
            </div>
          )}
          {stats && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs">
              <StatTile label="افتتاح" value={stats.open?.toLocaleString('ar-EG', { maximumFractionDigits: 1 })} />
              <StatTile label="أعلى" value={stats.high?.toLocaleString('ar-EG', { maximumFractionDigits: 1 })} />
              <StatTile label="أدنى" value={stats.low?.toLocaleString('ar-EG', { maximumFractionDigits: 1 })} />
              <StatTile label="من بداية العام" value={`${stats.ytd_change_pct?.toFixed(1)}%`} positive={stats.ytd_change_pct >= 0} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Constituent effect breakdown — the "stock effect" visual */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            تأثير كل سهم على المؤشر
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingBreakdown ? (
            <Skeleton className="h-48 w-full rounded-lg" />
          ) : breakdown && breakdown.constituents.length > 0 ? (
            <>
              {/* Summary */}
              <div className="flex items-center gap-4 mb-3 text-xs">
                <span className="text-profit font-semibold">
                  ↑ +{breakdown.summary.total_positive.toFixed(2)}% صاعد
                </span>
                <span className="text-loss font-semibold">
                  ↓ {breakdown.summary.total_negative.toFixed(2)}% هابط
                </span>
                <span className="text-muted-foreground">
                  {breakdown.summary.gainers} صاعد / {breakdown.summary.losers} هابط
                </span>
              </div>

              {/* Diverging bar chart */}
              <ResponsiveContainer width="100%" height={Math.min(breakdown.constituents.length * 22, 400)}>
                <BarChart
                  data={breakdown.constituents.slice(0, 20)}
                  layout="vertical"
                  margin={{ top: 0, right: 40, left: 60, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v.toFixed(2)}%`} />
                  <YAxis type="category" dataKey="code" tick={{ fontSize: 10 }} width={50} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                    formatter={(v: any) => [`${Number(v).toFixed(3)}%`, 'الأثر']}
                    labelFormatter={(label: any) => {
                      const c = breakdown.constituents.find(c => c.code === label);
                      return c ? `${c.name_ar} (${c.weight.toFixed(1)}% - ${c.change_pct.toFixed(2)}%)` : label;
                    }}
                  />
                  <ReferenceLine x={0} stroke="hsl(var(--border))" />
                  <Bar dataKey="contribution" radius={[0, 3, 3, 0]}>
                    {breakdown.constituents.slice(0, 20).map((c, i) => (
                      <Cell key={i} fill={c.contribution >= 0 ? '#10b981' : '#ef4444'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p className="text-xs text-muted-foreground mt-2">
                كل عمود = وزن السهم × نسبة تغيره = أثره على المؤشر. الأخضر = صاعد، الأحمر = هابط.
              </p>
            </>
          ) : (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">
              لا توجد بيانات متاحة
            </div>
          )}
        </CardContent>
      </Card>

      {/* Top movers */}
      {breakdown && (topGainers.length > 0 || topLosers.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-profit flex items-center gap-2">
                <TrendingUp className="w-4 h-4" /> أعلى المساهمين بالصعود
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {topGainers.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="font-medium">{c.name_ar}</span>
                  <span className="text-profit font-semibold">+{c.contribution.toFixed(3)}%</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-loss flex items-center gap-2">
                <TrendingDown className="w-4 h-4" /> أعلى المساهمين بالهبوط
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {topLosers.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span className="font-medium">{c.name_ar}</span>
                  <span className="text-loss font-semibold">{c.contribution.toFixed(3)}%</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value, positive }: { label: string; value?: string; positive?: boolean }) {
  return (
    <div className="p-2 rounded-lg bg-muted/30">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('font-bold tabular-nums', positive === true && 'text-profit', positive === false && 'text-loss')}>
        {value || '—'}
      </div>
    </div>
  );
}
