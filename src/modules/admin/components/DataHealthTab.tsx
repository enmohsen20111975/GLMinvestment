'use client';

/**
 * DataHealthTab
 * =============
 * FRONTEND-1 (Deliverable 2) — Data Health Dashboard.
 *
 * Surfaces backend data freshness to the admin UI. Fetches
 * `/api/admin/data-health` on mount + every 60s and renders:
 *
 *   1. Overall health badge (GREEN / YELLOW / RED) with Arabic label.
 *   2. Per-market × per-source health matrix (rows = markets,
 *      columns = 5 data sources). Each cell shows latest date + 🟢🟡🔴.
 *   3. egksco_stocks status card (rows + latest timestamp + status badge).
 *   4. Summary card: total active / fresh / stale + frozen markets list.
 *   5. Last-updated timestamp + auto-refresh indicator.
 *
 * All labels are Arabic. Mobile-responsive (table scrolls horizontally).
 *
 * Color tokens used: profit (emerald) / warning (amber) / loss (rose) —
 * NO indigo/blue (Rule 30).
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  HeartPulse, RefreshCw, AlertTriangle, CheckCircle2, Database,
  Activity, Snowflake, Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types — mirror the API response shape (src/app/api/admin/data-health/route.ts)
// ---------------------------------------------------------------------------

type HealthLevel = 'GREEN' | 'YELLOW' | 'RED';

interface MarketStocks {
  active: number;
  fresh: number;
  stale: number;
  latest_update: string | null;
}
interface MarketDailyPrices {
  latest: string | null;
  rows_today: number;
  rows_total: number;
}
interface MarketPriceHistory {
  latest: string | null;
  rows: number;
  sampled_tickers: number;
  frozen: boolean;
}
interface MarketIntraday {
  tickers_today: number;
  rows_today: number;
  latest_today: string | null;
  latest_any: string | null;
  tickers_any: number;
}
interface MarketHistoricalData {
  latest: string | null;
  rows: number;
  frozen: boolean;
}
interface MarketHealth {
  stocks: MarketStocks;
  daily_prices: MarketDailyPrices;
  price_history: MarketPriceHistory;
  intraday: MarketIntraday;
  historical_data: MarketHistoricalData;
}
interface EgkscoStocks {
  rows: number;
  latest: string | null;
  expected: number;
  ok: boolean;
  status: 'healthy' | 'stale' | 'empty';
}
interface Summary {
  total_active: number;
  total_fresh: number;
  total_stale: number;
  frozen_markets: string[];
}
interface DataHealthResponse {
  success: boolean;
  timestamp: string;
  markets: Record<string, MarketHealth>;
  egksco_stocks: EgkscoStocks;
  overall_health: HealthLevel;
  overall_health_ar: string;
  summary: Summary;
  errors: string[];
  error?: 'db_locked';
  partial: boolean;
}

// ---------------------------------------------------------------------------
// Display order + column labels (Arabic)
// ---------------------------------------------------------------------------

const MARKET_ORDER = ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US'];

const MARKET_LABELS_AR: Record<string, string> = {
  EGX: 'البورصة المصرية',
  TADAWUL: 'السعودية',
  KSE: 'الكويت',
  QSE: 'قطر',
  US: 'أمريكا',
};

const SOURCE_COLUMNS = [
  { key: 'stocks',         label: 'السعر الحالي',          desc: 'آخر تحديث لصف stocks' },
  { key: 'daily_prices',   label: 'الأسعار اليومية',       desc: 'stock_daily_prices' },
  { key: 'price_history',  label: 'التاريخي الكاثوليكي',    desc: 'price_history.db' },
  { key: 'intraday',       label: 'اللحظي',                desc: 'intraday.db (اليوم)' },
  { key: 'historical_data',label: 'التاريخي القديم',        desc: 'data_engine.historical_data' },
] as const;

type SourceKey = typeof SOURCE_COLUMNS[number]['key'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function classifyAge(dateStr: string | null | undefined): 'fresh' | 'aging' | 'stale' | 'unknown' {
  if (!dateStr) return 'stale';
  const iso = dateStr.length >= 10 ? dateStr.slice(0, 10) : dateStr;
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t)) return 'unknown';
  const ageDays = (Date.now() - t) / (24 * 60 * 60 * 1000);
  if (ageDays <= 3) return 'fresh';
  if (ageDays <= 7) return 'aging';
  return 'stale';
}

function levelToEmoji(level: 'fresh' | 'aging' | 'stale' | 'unknown'): string {
  switch (level) {
    case 'fresh':  return '🟢';
    case 'aging':  return '🟡';
    case 'stale':  return '🔴';
    default:       return '⚪';
  }
}

function levelToColor(level: 'fresh' | 'aging' | 'stale' | 'unknown'): string {
  switch (level) {
    case 'fresh':  return 'text-profit';
    case 'aging':  return 'text-warning';
    case 'stale':  return 'text-loss';
    default:       return 'text-muted-foreground';
  }
}

function levelToLabelAr(level: 'fresh' | 'aging' | 'stale' | 'unknown'): string {
  switch (level) {
    case 'fresh':  return 'طازج';
    case 'aging':  return 'متأخر قليلاً';
    case 'stale':  return 'متجمد/قديم';
    default:       return 'غير معروف';
  }
}

function formatDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  // Show only the YYYY-MM-DD portion for clarity (most cells are dates).
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function timeAgoAr(s: string | null | undefined): string {
  if (!s) return 'لم يحدّث بعد';
  const t = Date.parse(s.length >= 10 ? `${s.slice(0, 10)}T${s.length >= 19 ? s.slice(11, 19) : '00:00:00'}` : s);
  if (Number.isNaN(t)) return '—';
  const diffMs = Date.now() - t;
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return 'الآن';
  if (diffMin < 60) return `منذ ${diffMin} دقيقة`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `منذ ${diffHr} ساعة`;
  const diffDay = Math.floor(diffHr / 24);
  return `منذ ${diffDay} يوم`;
}

function healthBadgeClasses(level: HealthLevel): string {
  switch (level) {
    case 'GREEN':  return 'bg-profit/15 text-profit border-profit/30';
    case 'YELLOW': return 'bg-warning/15 text-warning border-warning/30';
    case 'RED':    return 'bg-loss/15 text-loss border-loss/30';
  }
}

function egkscoBadgeClasses(status: EgkscoStocks['status']): string {
  switch (status) {
    case 'healthy': return 'bg-profit/15 text-profit border-profit/30';
    case 'stale':   return 'bg-warning/15 text-warning border-warning/30';
    case 'empty':   return 'bg-loss/15 text-loss border-loss/30';
  }
}

function egkscoLabelAr(status: EgkscoStocks['status']): string {
  switch (status) {
    case 'healthy': return 'سليم';
    case 'stale':   return 'متأخر';
    case 'empty':   return 'فارغ';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DataHealthTab() {
  const [data, setData] = useState<DataHealthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/data-health', {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json: DataHealthResponse = await res.json();
      if (!json.success) {
        throw new Error('استجابة غير صالحة من السيرفر');
      }
      setData(json);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'خطأ في الاتصال';
      setError(msg);
      // Only toast on manual refresh, not the first load (avoid double error UI).
      if (data) {
        toast.error(`فشل تحديث صحة البيانات: ${msg}`);
      }
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initial fetch + 60s polling.
  useEffect(() => {
    fetchData();
    timerRef.current = setInterval(fetchData, 60_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetchData]);

  // ---------- Derived ----------

  const marketKeys = data
    ? Array.from(new Set([
        ...MARKET_ORDER,
        ...Object.keys(data.markets),
      ])).filter(m => data.markets[m]).sort((a, b) => {
        // Canonical order first, then any extras alphabetically.
        const ai = MARKET_ORDER.indexOf(a);
        const bi = MARKET_ORDER.indexOf(b);
        if (ai !== -1 && bi !== -1) return ai - bi;
        if (ai !== -1) return -1;
        if (bi !== -1) return 1;
        return a.localeCompare(b);
      })
    : MARKET_ORDER;

  const overall = data?.overall_health ?? 'GREEN';
  const overallAr = data?.overall_health_ar ?? 'أخضر';
  const egksco = data?.egksco_stocks;
  const summary = data?.summary;

  // ---------- Render ----------

  return (
    <div className="space-y-5" dir="rtl">
      {/* ─── Header + Overall Health Badge ─── */}
      <Card className={cn('border', overall === 'GREEN' ? 'border-profit/30' : overall === 'YELLOW' ? 'border-warning/30' : 'border-loss/30')}>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className={cn(
                'p-2 rounded-lg',
                overall === 'GREEN' ? 'bg-profit/10' : overall === 'YELLOW' ? 'bg-warning/10' : 'bg-loss/10',
              )}>
                <HeartPulse className={cn(
                  'w-6 h-6',
                  overall === 'GREEN' ? 'text-profit' : overall === 'YELLOW' ? 'text-warning' : 'text-loss',
                )} />
              </div>
              <div>
                <CardTitle className="flex items-center gap-2 text-lg">
                  صحة البيانات — Data Health Dashboard
                </CardTitle>
                <CardDescription className="mt-1 text-xs">
                  طزاجة كل مصدر بيانات لكل سوق — يُحدّث تلقائياً كل 60 ثانية
                </CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge
                variant="outline"
                className={cn('text-sm font-bold px-3 py-1.5 gap-1.5', healthBadgeClasses(overall))}
              >
                <span className="text-base">
                  {overall === 'GREEN' ? '🟢' : overall === 'YELLOW' ? '🟡' : '🔴'}
                </span>
                الحالة العامة: {overallAr} ({overall})
              </Badge>
              <Button
                onClick={() => { setLoading(true); fetchData(); }}
                disabled={loading}
                variant="ghost"
                size="sm"
                className="gap-2"
              >
                <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
                تحديث
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* ─── Loading skeleton ─── */}
      {loading && !data && (
        <Card>
          <CardContent className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      )}

      {/* ─── Error state ─── */}
      {error && !data && (
        <Card className="border-loss/40 bg-loss/5">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-loss shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-loss">فشل تحميل بيانات الصحة</p>
              <p className="text-xs text-muted-foreground mt-1" dir="ltr">{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => { setLoading(true); fetchData(); }}
              >
                إعادة المحاولة
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Main content ─── */}
      {data && (
        <>
          {/* Partial / DB-locked warning */}
          {data.partial && (
            <Card className="border-warning/40 bg-warning/5">
              <CardContent className="p-3 flex items-center gap-2 text-xs">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                <span className="text-warning font-semibold">
                  بعض قواعد البيانات لم تكن متاحة أثناء الفحص ({data.errors.length} خطأ).
                  {data.error === 'db_locked' && ' سبب محتمل: قفل مؤقت من خدمة البايثون.'}
                </span>
              </CardContent>
            </Card>
          )}

          {/* ─── Per-market × per-source health matrix ─── */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Database className="w-4 h-4 text-profit" />
                مصفوفة الصحة لكل سوق × كل مصدر
              </CardTitle>
              <CardDescription className="text-xs">
                كل خلية تعرض آخر تاريخ للبيانات + مؤشر اللون (🟢 طازج ≤3 أيام / 🟡 متأخر قليلاً ≤7 / 🔴 متجمد &gt;7)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-thumb]:bg-muted-foreground/30 [&::-webkit-scrollbar-thumb]:rounded-full">
                <Table className="min-w-[820px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-right sticky right-0 bg-card z-10 min-w-[140px]">السوق</TableHead>
                      {SOURCE_COLUMNS.map(col => (
                        <TableHead key={col.key} className="text-center min-w-[150px]">
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="font-semibold text-xs">{col.label}</span>
                            <span className="text-[10px] text-muted-foreground" dir="ltr">{col.desc}</span>
                          </div>
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {marketKeys.map(market => {
                      const m = data.markets[market];
                      if (!m) return null;
                      return (
                        <TableRow key={market}>
                          <TableCell className="sticky right-0 bg-card z-10">
                            <div className="flex flex-col">
                              <span className="font-bold text-sm" dir="ltr">{market}</span>
                              <span className="text-[11px] text-muted-foreground">
                                {MARKET_LABELS_AR[market] || market}
                              </span>
                            </div>
                          </TableCell>
                          {SOURCE_COLUMNS.map(col => (
                            <HealthCell
                              key={col.key}
                              sourceKey={col.key}
                              market={m}
                            />
                          ))}
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* ─── Bottom row: egksco_stocks + summary ─── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* egksco_stocks status */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="w-4 h-4 text-profit" />
                  حالة egksco_stocks
                </CardTitle>
                <CardDescription className="text-xs">
                  الجدول الموحّد لبيانات الأسهم المصرية (المتوقع ~{egksco?.expected ?? 1205} سجل)
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {egksco ? (
                  <>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">الحالة</span>
                      <Badge
                        variant="outline"
                        className={cn('text-xs font-bold gap-1.5', egkscoBadgeClasses(egksco.status))}
                      >
                        <span>{egksco.status === 'healthy' ? '🟢' : egksco.status === 'stale' ? '🟡' : '🔴'}</span>
                        {egkscoLabelAr(egksco.status)}
                      </Badge>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <StatTile
                        label="عدد السجلات"
                        value={egksco.rows.toLocaleString('ar-EG')}
                        subValue={`المتوقع: ${egksco.expected.toLocaleString('ar-EG')}`}
                        ok={egksco.rows >= egksco.expected * 0.9}
                      />
                      <StatTile
                        label="آخر تحديث"
                        value={formatDateTime(egksco.latest)}
                        subValue={timeAgoAr(egksco.latest)}
                        ok={classifyAge(egksco.latest) === 'fresh'}
                      />
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">لا توجد بيانات</p>
                )}
              </CardContent>
            </Card>

            {/* Summary card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-profit" />
                  ملخص الصحة الإجمالي
                </CardTitle>
                <CardDescription className="text-xs">
                  إحصاءات شاملة لكل الأسهم النشطة في كل الأسواق
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {summary && (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <StatTile
                        label="إجمالي النشط"
                        value={summary.total_active.toLocaleString('ar-EG')}
                        ok={summary.total_active > 0}
                      />
                      <StatTile
                        label="طازج (≤3 أيام)"
                        value={summary.total_fresh.toLocaleString('ar-EG')}
                        ok={summary.total_fresh > 0}
                      />
                      <StatTile
                        label="متجهّر/قديم"
                        value={summary.total_stale.toLocaleString('ar-EG')}
                        ok={summary.total_stale === 0}
                        warnOnPositive
                      />
                    </div>
                    {summary.frozen_markets.length > 0 ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-loss">
                          <Snowflake className="w-3.5 h-3.5" />
                          مصادر متجمدة ({summary.frozen_markets.length}):
                        </div>
                        <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                          {summary.frozen_markets.map(fm => (
                            <Badge
                              key={fm}
                              variant="outline"
                              className="text-[10px] bg-loss/10 text-loss border-loss/30 font-mono"
                              dir="ltr"
                            >
                              {fm}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 text-xs text-profit font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        لا توجد مصادر متجمدة — كل البيانات تتدفّق
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ─── Last-updated footer ─── */}
          <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3" />
              <span>آخر فحص: {lastUpdated ? lastUpdated.toLocaleString('ar-EG') : '—'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-profit opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-profit" />
              </span>
              <span>تحديث تلقائي كل 60 ثانية</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface HealthCellProps {
  sourceKey: SourceKey;
  market: MarketHealth;
}

function HealthCell({ sourceKey, market }: HealthCellProps) {
  let latest: string | null = null;
  let sub: string = '';
  let frozen = false;

  switch (sourceKey) {
    case 'stocks':
      latest = market.stocks.latest_update;
      sub = `${market.stocks.active} سهم · ${market.stocks.fresh} طازج`;
      break;
    case 'daily_prices':
      latest = market.daily_prices.latest;
      sub = `${market.daily_prices.rows_today.toLocaleString('ar-EG')} صف اليوم`;
      break;
    case 'price_history':
      latest = market.price_history.latest;
      sub = `${market.price_history.rows.toLocaleString('ar-EG')} صف · عينة ${market.price_history.sampled_tickers}`;
      frozen = market.price_history.frozen;
      break;
    case 'intraday':
      latest = market.intraday.latest_today ?? market.intraday.latest_any;
      sub = `${market.intraday.tickers_today} سهم اليوم`;
      break;
    case 'historical_data':
      latest = market.historical_data.latest;
      sub = `${market.historical_data.rows.toLocaleString('ar-EG')} صف`;
      frozen = market.historical_data.frozen;
      break;
  }

  const level = classifyAge(latest);
  const emoji = levelToEmoji(level);
  const color = levelToColor(level);
  const label = levelToLabelAr(level);

  return (
    <TableCell className="text-center align-top">
      <div className="flex flex-col items-center gap-1">
        <span className="text-lg leading-none">{emoji}</span>
        <span className={cn('text-xs font-mono font-semibold', color)} dir="ltr">
          {formatDateTime(latest)}
        </span>
        <span className="text-[10px] text-muted-foreground">{sub}</span>
        <span className={cn('text-[10px] font-semibold', color)}>{label}</span>
        {frozen && (
          <Badge variant="outline" className="text-[9px] bg-loss/10 text-loss border-loss/30 px-1 py-0 h-4 gap-0.5">
            <Snowflake className="w-2.5 h-2.5" />
            متجمد
          </Badge>
        )}
      </div>
    </TableCell>
  );
}

function StatTile({
  label,
  value,
  subValue,
  ok,
  warnOnPositive = false,
}: {
  label: string;
  value: string;
  subValue?: string;
  ok: boolean;
  warnOnPositive?: boolean;
}) {
  const colorClass = warnOnPositive
    ? (ok ? 'text-profit' : 'text-loss')
    : (ok ? 'text-profit' : 'text-warning');
  return (
    <div className="p-2.5 rounded-lg bg-muted/40 border border-border/50 flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className={cn('text-base font-bold', colorClass)}>{value}</span>
      {subValue && <span className="text-[10px] text-muted-foreground">{subValue}</span>}
    </div>
  );
}

export default DataHealthTab;
