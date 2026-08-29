'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  TrendingUp, TrendingDown, RefreshCw, AlertTriangle, Trophy, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TopPerformerStock {
  ticker: string;
  name: string;
  name_ar: string | null;
  sector: string | null;
  market: string;
  start_price: number;
  end_price: number;
  change_pct: number;
  period_days: number;
  start_date: string;
  end_date: string;
  start_volume: number;
  end_volume: number;
}

interface TopPerformersResponse {
  success: boolean;
  period: string;
  direction: string;
  market: string;
  start_date: string;
  end_date: string;
  results: TopPerformerStock[];
  summary: {
    total_stocks: number;
    gainers: number;
    losers: number;
    avg_change: number;
    best_performer: TopPerformerStock | null;
    worst_performer: TopPerformerStock | null;
  };
  error?: string;
  hint?: string;
}

// ─── Format Helpers ──────────────────────────────────────────────────────────

function formatPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(0)}K`;
  return v.toFixed(0);
}

// ─── Period options ─────────────────────────────────────────────────────────

const PERIODS = [
  { value: '1d', label: 'أمس (1 يوم)' },
  { value: '7d', label: 'أسبوع (7 أيام)' },
  { value: '15d', label: '15 يوم' },
  { value: '1m', label: 'شهر (30 يوم)' },
  { value: '3m', label: '3 شهور' },
  { value: '6m', label: '6 شهور' },
  { value: 'YTD', label: 'من أول السنة' },
  { value: '1y', label: 'عام كامل (365 يوم)' },
];

const DIRECTIONS = [
  { value: 'both', label: 'أعلى وأدنى', icon: Activity },
  { value: 'gainers', label: 'أعلى الأرباح', icon: TrendingUp },
  { value: 'losers', label: 'أعلى الخسائر', icon: TrendingDown },
];

// ─── Main Component ─────────────────────────────────────────────────────────

export function TopPerformersView() {
  const [period, setPeriod] = useState('1m');
  const [direction, setDirection] = useState('both');
  const [market, setMarket] = useState('EGX');
  const [limit, setLimit] = useState(20);
  const [data, setData] = useState<TopPerformersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        period,
        direction,
        market,
        limit: String(limit),
      });
      const res = await fetch(`/api/stocks/top-performers?${params}`, { cache: 'no-store' });
      const json: TopPerformersResponse = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(json.error || json.hint || 'فشل في تحميل البيانات');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, [period, direction, market, limit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading && !data) {
    return (
      <div className="space-y-4 p-4 md:p-6" dir="rtl">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="w-4 h-4 animate-spin" />
          جاري تحميل أعلى الأسهم أرباحاً/خسارة...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 p-4 md:p-6" dir="rtl">
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="p-4 text-center">
            <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-rose-500" />
            <div className="text-sm font-medium text-rose-700 dark:text-rose-300">
              {error}
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              تأكد أن Python backend يعمل على port 8010 (محتاج: <code className="font-mono">/api/stocks/top-performers</code>)
            </div>
            <Button variant="outline" size="sm" onClick={fetchData} className="mt-3">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data) return null;

  const summary = data.summary;
  const results = data.results || [];
  const periodLabel = PERIODS.find(p => p.value === period)?.label || period;
  const bestPerformer = summary.best_performer;
  const worstPerformer = summary.worst_performer;

  return (
    <div className="space-y-4 p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Trophy className="w-5 h-5 text-amber-600" />
            أعلى الأسهم أرباحاً وخسارة
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            الفترة: {periodLabel} • من {data.start_date} إلى {data.end_date}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={fetchData} disabled={loading} className="gap-1.5">
          <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          تحديث
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-4 h-4" />
            الفلاتر
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Period */}
            <div>
              <label className="text-xs">الفترة</label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODS.map(p => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Direction */}
            <div>
              <label className="text-xs">النوع</label>
              <Select value={direction} onValueChange={setDirection}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DIRECTIONS.map(d => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Market */}
            <div>
              <label className="text-xs">السوق</label>
              <Select value={market} onValueChange={setMarket}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EGX">البورصة المصرية</SelectItem>
                  <SelectItem value="ALL">الكل</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Limit */}
            <div>
              <label className="text-xs">عدد النتائج</label>
              <Select value={String(limit)} onValueChange={(v) => setLimit(Number(v))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="20">20</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">إجمالي الأسهم</div>
            <div className="text-xl font-bold">{summary.total_stocks}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingUp className="w-3 h-3 text-emerald-500" />
              الرابحة
            </div>
            <div className="text-xl font-bold text-emerald-600">{summary.gainers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1">
              <TrendingDown className="w-3 h-3 text-red-500" />
              الخاسرة
            </div>
            <div className="text-xl font-bold text-red-600">{summary.losers}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <div className="text-xs text-muted-foreground">متوسط التغير</div>
            <div className={cn('text-xl font-bold font-mono', summary.avg_change >= 0 ? 'text-emerald-600' : 'text-red-600')}>
              {summary.avg_change >= 0 ? '+' : ''}{summary.avg_change}%
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Best + Worst Performer */}
      {(bestPerformer || worstPerformer) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {bestPerformer && (
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <Trophy className="w-4 h-4 text-amber-500" />
                  <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                    الأعلى ربحاً — {periodLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono font-bold text-lg">{bestPerformer.ticker}</div>
                    <div className="text-xs text-muted-foreground">
                      {bestPerformer.name_ar || bestPerformer.name}
                      {bestPerformer.sector && ` • ${bestPerformer.sector}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-emerald-600 font-mono font-bold text-xl">
                      +{bestPerformer.change_pct}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatPrice(bestPerformer.start_price)} → {formatPrice(bestPerformer.end_price)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
          {worstPerformer && (
            <Card className="border-red-500/30 bg-red-500/5">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1">
                  <TrendingDown className="w-4 h-4 text-red-500" />
                  <span className="text-sm font-semibold text-red-700 dark:text-red-300">
                    الأعلى خسارة — {periodLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-mono font-bold text-lg">{worstPerformer.ticker}</div>
                    <div className="text-xs text-muted-foreground">
                      {worstPerformer.name_ar || worstPerformer.name}
                      {worstPerformer.sector && ` • ${worstPerformer.sector}`}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-red-600 font-mono font-bold text-xl">
                      {worstPerformer.change_pct}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {formatPrice(worstPerformer.start_price)} → {formatPrice(worstPerformer.end_price)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Results Table */}
      <Card>
        <CardContent className="p-0">
          {results.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              لا توجد نتائج للفلاتر الحالية
            </div>
          ) : (
            <div className="max-h-[600px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="text-right">السهم</TableHead>
                    <TableHead className="text-right">القطاع</TableHead>
                    <TableHead className="text-right">سعر البداية</TableHead>
                    <TableHead className="text-right">سعر النهاية</TableHead>
                    <TableHead className="text-right">التغير %</TableHead>
                    <TableHead className="text-right">عدد الأيام</TableHead>
                    <TableHead className="text-right">الحجم (نهاية)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((s) => (
                    <TableRow key={`${s.ticker}-${s.start_date}`} className="hover:bg-muted/50">
                      <TableCell>
                        <div className="font-mono font-bold text-sm">{s.ticker}</div>
                        <div className="text-xs text-muted-foreground truncate max-w-[180px]">
                          {s.name_ar || s.name}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {s.sector || '—'}
                      </TableCell>
                      <TableCell className="font-mono text-sm">{formatPrice(s.start_price)}</TableCell>
                      <TableCell className="font-mono text-sm">{formatPrice(s.end_price)}</TableCell>
                      <TableCell className={cn('font-mono font-bold', s.change_pct >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                        {s.change_pct >= 0 ? '+' : ''}{s.change_pct}%
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {s.period_days} يوم
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {formatVolume(s.end_volume)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Footer hint */}
      <div className="text-xs text-muted-foreground text-center p-2">
        📡 البيانات من Python backend — الـ logic كله في{' '}
        <code className="font-mono">vps-service/api/top_performers_routes.py</code>
        (يقرأ data_engine.db.egksco_price_history — 162K صف، 1047 سهم، 19 شهر)
        • Node = عرض فقط (Rule 20)
      </div>
    </div>
  );
}
