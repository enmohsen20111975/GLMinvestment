'use client';

/**
 * HistoricalTradesTable (P1-GEMS-WIRING)
 * ======================================
 * يعرض 13,117 صفقة تاريخية من predictions.db.historical_trades.
 *
 * المكوّن:
 *  - جدول موحّد (UnifiedTable) مع pagination 100/صفحة
 *  - أعمدة: ticker, buy_date, sell_date, buy_price, sell_price, return_pct, exit_reason
 *  - تلوين: أخضر للعائد الموجب، أحمر للسالب
 *  - فلترة بالـ ticker / strategy / outcome
 *  - أزرار تصدير + بحث
 *
 * يتم تركيبه كتبويب "صفقات تاريخية" في MarketAnalysisView.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UnifiedTable, type Column } from '@/components/shared/UnifiedTable';
import {
  History, RefreshCw, AlertCircle, ChevronRight, ChevronLeft,
  TrendingUp, TrendingDown, Minus, Filter, Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import { getTrialStatus } from '@/lib/subscription-gate';
import type { MarketType } from '@/lib/store';

interface HistoricalTrade {
  id: number;
  ticker: string;
  strategy: string;
  buy_date: string;
  buy_price: number;
  sell_date: string | null;
  sell_price: number | null;
  return_pct: number | null;
  holding_days: number | null;
  exit_reason: string | null;
  pattern_type: string | null;
  market_condition: string | null;
  rsi_at_buy: number | null;
  volume_ratio_at_buy: number | null;
  lesson_text: string | null;
  fed_to_ai: number | null;
  created_at: string | null;
}

interface ApiResponse {
  success: boolean;
  total: number;
  returned: number;
  offset: number;
  trades: HistoricalTrade[];
  strategies: string[];
  filters: { limit: number; offset: number; ticker: string | null; strategy: string | null; outcome: string | null; sort: string };
  error?: string;
}

const PAGE_SIZE = 100;

const OUTCOME_OPTIONS = [
  { value: 'all', label: 'كل النتائج' },
  { value: 'WIN', label: 'ربح فقط' },
  { value: 'LOSS', label: 'خسارة فقط' },
  { value: 'BREAKEVEN', label: 'تعادل' },
];

const SORT_OPTIONS = [
  { value: 'buy_date', label: 'تاريخ الشراء' },
  { value: 'pnl_pct', label: 'العائد' },
  { value: 'holding_days', label: 'مدة الحيازة' },
];

interface HistoricalTradesTableProps {
  market?: MarketType;
  initialPageSize?: number;
}

export function HistoricalTradesTable({ initialPageSize = PAGE_SIZE }: HistoricalTradesTableProps) {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(0);
  const [tickerInput, setTickerInput] = useState('');
  const [tickerFilter, setTickerFilter] = useState<string | null>(null);
  const [strategy, setStrategy] = useState<string>('all');
  const [outcome, setOutcome] = useState<string>('all');
  const [sort, setSort] = useState<string>('buy_date');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: String(initialPageSize),
        offset: String(page * initialPageSize),
        sort,
      });
      if (tickerFilter) params.set('ticker', tickerFilter);
      if (strategy !== 'all') params.set('strategy', strategy);
      if (outcome !== 'all') params.set('outcome', outcome);
      const res = await fetch(`/api/predictions/historical-trades?${params.toString()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiResponse;
      if (!json.success) throw new Error(json.error || 'فشل في جلب البيانات');
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطأ غير معروف');
    } finally {
      setLoading(false);
    }
  }, [initialPageSize, page, tickerFilter, strategy, outcome, sort]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset to page 0 when filters change
  useEffect(() => {
    setPage(0);
  }, [tickerFilter, strategy, outcome, sort]);

  const trades = data?.trades ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / initialPageSize));
  const fromRow = page * initialPageSize + 1;
  const toRow = Math.min((page + 1) * initialPageSize, total);

  // PAYWALL Gate 6: free users (post-trial) see summary + 1 winning trade as social proof only.
  // Paid + trial users see the full table with filters + pagination.
  const subscriptionUser = useAppStore((s) => s.user);
  const tradesSubStatus = getTrialStatus(subscriptionUser);
  const tradesLocked = tradesSubStatus.isFreeUser && tradesSubStatus.isTrialExpired;
  const socialProofTrade = useMemo(() => {
    if (!trades.length) return null;
    // Prefer the biggest winner in the current page — showcases the upside.
    const winners = trades.filter((t) => t.return_pct != null && t.return_pct > 0);
    if (winners.length === 0) return trades[0];
    return winners.reduce((best, t) =>
      (t.return_pct ?? 0) > (best.return_pct ?? 0) ? t : best,
    );
  }, [trades]);

  const stats = useMemo(() => {
    if (!trades.length) return null;
    const wins = trades.filter((t) => t.return_pct != null && t.return_pct > 0).length;
    const losses = trades.filter((t) => t.return_pct != null && t.return_pct < 0).length;
    const avgReturn = trades.reduce((s, t) => s + (t.return_pct ?? 0), 0) / trades.length;
    return {
      wins,
      losses,
      winRate: trades.length > 0 ? ((wins / trades.length) * 100).toFixed(1) : '0',
      avgReturn: (avgReturn ?? 0).toFixed(2),
    };
  }, [trades]);

  const columns: Column<HistoricalTrade>[] = useMemo(() => [
    {
      key: 'ticker',
      header: 'السهم',
      headerAr: 'السهم',
      sortable: true,
      align: 'right',
      width: 'min-w-[80px]',
      render: (r) => (
        <span className={cn('font-mono font-semibold', r.ticker ? 'text-foreground' : 'text-muted-foreground/50')}>
          {r.ticker || '—'}
        </span>
      ),
    },
    {
      key: 'strategy',
      header: 'الاستراتيجية',
      headerAr: 'الاستراتيجية',
      sortable: true,
      align: 'right',
      width: 'min-w-[120px]',
      render: (r) => (
        <Badge variant="outline" className="text-[10px] font-mono">
          {r.strategy || '—'}
        </Badge>
      ),
    },
    {
      key: 'buy_date',
      header: 'تاريخ الشراء',
      headerAr: 'تاريخ الشراء',
      sortable: true,
      align: 'center',
      width: 'min-w-[110px]',
      render: (r) => (
        <span className="text-xs tabular-nums">{r.buy_date || '—'}</span>
      ),
    },
    {
      key: 'sell_date',
      header: 'تاريخ البيع',
      headerAr: 'تاريخ البيع',
      sortable: true,
      align: 'center',
      width: 'min-w-[110px]',
      render: (r) => (
        <span className="text-xs tabular-nums">{r.sell_date || '—'}</span>
      ),
    },
    {
      key: 'buy_price',
      header: 'سعر الشراء',
      headerAr: 'سعر الشراء',
      sortable: true,
      align: 'left',
      width: 'min-w-[90px]',
      render: (r) => (
        <span className="text-xs tabular-nums">{r.buy_price != null ? r.buy_price.toFixed(2) : '—'}</span>
      ),
    },
    {
      key: 'sell_price',
      header: 'سعر البيع',
      headerAr: 'سعر البيع',
      sortable: true,
      align: 'left',
      width: 'min-w-[90px]',
      render: (r) => (
        <span className="text-xs tabular-nums">{r.sell_price != null ? r.sell_price.toFixed(2) : '—'}</span>
      ),
    },
    {
      key: 'return_pct',
      header: 'العائد %',
      headerAr: 'العائد %',
      sortable: true,
      align: 'left',
      width: 'min-w-[100px]',
      render: (r) => {
        const v = r.return_pct;
        if (v == null) return <span className="text-muted-foreground">—</span>;
        const isUp = v > 0;
        const isDown = v < 0;
        return (
          <span
            className={cn(
              'text-xs font-bold tabular-nums inline-flex items-center gap-0.5',
              isUp ? 'text-emerald-600 dark:text-emerald-400' : isDown ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground',
            )}
          >
            {isUp ? <TrendingUp className="h-3 w-3" /> : isDown ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            {isUp ? '+' : ''}{(v ?? 0).toFixed(2)}%
          </span>
        );
      },
    },
    {
      key: 'holding_days',
      header: 'مدة الحيازة',
      headerAr: 'مدة الحيازة',
      sortable: true,
      align: 'center',
      width: 'min-w-[90px]',
      render: (r) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {r.holding_days != null ? `${r.holding_days} يوم` : '—'}
        </span>
      ),
    },
    {
      key: 'exit_reason',
      header: 'سبب الخروج',
      headerAr: 'سبب الخروج',
      sortable: true,
      align: 'center',
      width: 'min-w-[110px]',
      render: (r) => {
        const o = r.exit_reason;
        if (!o) return <span className="text-muted-foreground">—</span>;
        const cls = o === 'WIN'
          ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/5'
          : o === 'LOSS'
          ? 'border-red-500/40 text-red-700 dark:text-red-300 bg-red-500/5'
          : 'border-muted-foreground/40 text-muted-foreground bg-muted/20';
        const labelAr = o === 'WIN' ? 'ربح' : o === 'LOSS' ? 'خسارة' : o === 'BREAKEVEN' ? 'تعادل' : o;
        return <Badge variant="outline" className={cn('text-[10px]', cls)}>{labelAr}</Badge>;
      },
    },
    {
      key: 'pattern_type',
      header: 'النمط',
      headerAr: 'النمط',
      align: 'center',
      width: 'min-w-[100px]',
      render: (r) => (
        <span className="text-xs text-muted-foreground">{r.pattern_type || '—'}</span>
      ),
    },
    {
      key: 'market_condition',
      header: 'حالة السوق',
      headerAr: 'حالة السوق',
      align: 'center',
      width: 'min-w-[100px]',
      render: (r) => {
        const c = r.market_condition;
        if (!c) return <span className="text-muted-foreground">—</span>;
        const cls = c === 'bull' ? 'text-emerald-600' : c === 'bear' ? 'text-red-600' : 'text-muted-foreground';
        const labelAr = c === 'bull' ? 'صاعد' : c === 'bear' ? 'هابط' : c === 'sideways' ? 'عرضي' : c;
        return <span className={cn('text-xs font-medium', cls)}>{labelAr}</span>;
      },
    },
  ], []);

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <Card className="border-primary/30 bg-gradient-to-l from-primary/5 to-cyan-500/5">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-lg bg-primary/10">
                <History className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base">الصفقات التاريخية (Backtest)</CardTitle>
                <CardDescription className="text-xs">
                  {total.toLocaleString('ar-EG')} صفقة منفذة من بيانات training الـ AI
                </CardDescription>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
              <RefreshCw className={cn('h-3.5 w-3.5 ml-1', loading && 'animate-spin')} />
              تحديث
            </Button>
          </div>
        </CardHeader>
        {stats && (
          <CardContent className="pt-0 pb-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatPill label="صفقات رابحة" value={stats.wins.toString()} icon={<TrendingUp className="h-3.5 w-3.5 text-emerald-500" />} tone="emerald" />
              <StatPill label="صفقات خاسرة" value={stats.losses.toString()} icon={<TrendingDown className="h-3.5 w-3.5 text-red-500" />} tone="red" />
              <StatPill label="نسبة النجاح" value={`${stats.winRate}%`} icon={<Filter className="h-3.5 w-3.5 text-primary" />} tone="blue" />
              <StatPill label="متوسط العائد" value={`${stats.avgReturn}%`} icon={<History className="h-3.5 w-3.5 text-amber-500" />} tone="amber" />
            </div>
          </CardContent>
        )}
      </Card>

      {/* Filters — PAYWALL Gate 6: hidden for free users post-trial */}
      {!tradesLocked && (
      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs text-muted-foreground mb-1 block">بحث بالـ ticker</label>
              <Input
                value={tickerInput}
                onChange={(e) => setTickerInput(e.target.value.toUpperCase())}
                placeholder="مثال: COMI, ETEL..."
                className="font-mono text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setTickerFilter(tickerInput.trim() || null);
                  }
                }}
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setTickerFilter(tickerInput.trim() || null)}
              disabled={loading}
            >
              <Filter className="h-3.5 w-3.5 ml-1" /> ابحث
            </Button>
            {tickerFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => { setTickerFilter(null); setTickerInput(''); }}
              >
                مسح
              </Button>
            )}
            <div className="w-[160px]">
              <label className="text-xs text-muted-foreground mb-1 block">الاستراتيجية</label>
              <Select value={strategy} onValueChange={setStrategy} disabled={loading}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الاستراتيجيات</SelectItem>
                  {(data?.strategies ?? []).map((s) => (
                    <SelectItem key={s} value={s}>
                      <span className="font-mono text-xs">{s}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[140px]">
              <label className="text-xs text-muted-foreground mb-1 block">النتيجة</label>
              <Select value={outcome} onValueChange={setOutcome} disabled={loading}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTCOME_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[150px]">
              <label className="text-xs text-muted-foreground mb-1 block">ترتيب حسب</label>
              <Select value={sort} onValueChange={setSort} disabled={loading}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>
      )}

      {/* Table — PAYWALL Gate 6: locked for free users post-trial */}
      {tradesLocked ? (
        <Card className="border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20">
          <CardContent className="p-5 space-y-4">
            {/* Social proof — 1 winning trade card */}
            {socialProofTrade && (
              <div className="rounded-lg border border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-950/20 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <TrendingUp className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    مثال على صفقة ناجحة من أرشيف التوقعات
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <span className="font-mono font-bold text-sm">{socialProofTrade.ticker || '—'}</span>
                  <span className="text-muted-foreground">
                    {socialProofTrade.buy_date || '—'} → {socialProofTrade.sell_date || '—'}
                  </span>
                  <span className="text-muted-foreground">
                    {socialProofTrade.holding_days != null ? `${socialProofTrade.holding_days} يوم` : '—'}
                  </span>
                  <span className={cn(
                    'font-bold',
                    (socialProofTrade.return_pct ?? 0) > 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  )}>
                    {socialProofTrade.return_pct != null
                      ? `${socialProofTrade.return_pct > 0 ? '+' : ''}${(socialProofTrade.return_pct ?? 0).toFixed(2)}%`
                      : '—'}
                  </span>
                </div>
              </div>
            )}

            {/* Lock CTA */}
            <div className="flex flex-col items-center gap-2 text-center">
              <div className="h-10 w-10 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center">
                <Lock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                🔒 {total.toLocaleString('ar-EG')} صفقة تاريخية — تفاصيل الصفقات متاحة للمشتركين
              </p>
              <p className="text-xs text-muted-foreground max-w-md">
                اشترك في Premium لعرض الجدول الكامل (13,117 صفقة) مع فلترة بالـ ticker / الاستراتيجية / النتيجة
                وترتيب حسب العائد أو مدة الحيازة.
              </p>
              <Button
                variant="default"
                size="sm"
                className="gap-1.5 mt-1"
                onClick={() => {
                  if (typeof window !== 'undefined') {
                    window.location.href = '/pricing';
                  }
                }}
              >
                اشترك لعرض كل الصفقات
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : error ? (
        <Card className="border-red-500/40">
          <CardContent className="p-6 text-center space-y-2">
            <AlertCircle className="h-6 w-6 text-red-500 mx-auto" />
            <p className="text-sm text-red-600">{error}</p>
            <Button size="sm" variant="outline" onClick={fetchData}>
              <RefreshCw className="h-3 w-3 ml-1" /> حاول مرة أخرى
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-3">
            <UnifiedTable<HistoricalTrade>
              columns={columns}
              data={trades}
              loading={loading}
              loadingRows={8}
              emptyTextAr={loading ? 'جارٍ التحميل...' : 'لا توجد صفقات مطابقة'}
              keyField="id"
              dense
              maxHeight="calc(100vh - 540px)"
              stickyHeader
            />

            {/* Pagination */}
            {!loading && total > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 mt-3 pt-3 border-t">
                <div className="text-xs text-muted-foreground">
                  عرض <span className="font-bold">{fromRow.toLocaleString('ar-EG')}</span> —{' '}
                  <span className="font-bold">{toRow.toLocaleString('ar-EG')}</span> من{' '}
                  <span className="font-bold">{total.toLocaleString('ar-EG')}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(Math.max(0, page - 1))}
                    disabled={page === 0 || loading}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                    السابق
                  </Button>
                  <span className="text-xs text-muted-foreground px-2">
                    {page + 1} / {totalPages.toLocaleString('ar-EG')}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
                    disabled={page + 1 >= totalPages || loading}
                  >
                    التالي
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatPill({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: 'emerald' | 'red' | 'blue' | 'amber';
}) {
  const toneClass = {
    emerald: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/5 border-emerald-500/20',
    red: 'text-red-700 dark:text-red-300 bg-red-500/5 border-red-500/20',
    blue: 'text-primary dark:text-slate-300 bg-primary/5 border-primary/20',
    amber: 'text-amber-700 dark:text-amber-300 bg-amber-500/5 border-amber-500/20',
  }[tone];

  return (
    <div className={cn('rounded-lg border px-3 py-2', toneClass)}>
      <div className="flex items-center gap-1.5 mb-0.5">
        {icon}
        <span className="text-[10px] opacity-80">{label}</span>
      </div>
      <div className="text-sm font-bold tabular-nums">{value}</div>
    </div>
  );
}

export default HistoricalTradesTable;
