'use client';

import React, { useState, useEffect, useCallback, Suspense } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowRight, RefreshCw, TrendingUp, TrendingDown, Target, Shield,
  Activity, Award, Clock, Newspaper, AlertTriangle, Zap, ChevronRight,
  DollarSign, BarChart3, Scale, PiggyBank, Percent, LineChart as LineChartIcon,
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  ReferenceLine,
} from 'recharts';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// ============================================================================
// Types — تطابق response الـ Python backend
// ============================================================================

interface BasicInfo {
  ticker: string;
  name: string;
  name_ar: string;
  market: string;
  sector: string;
  industry: string;
  is_active: boolean;
  is_egx30: boolean;
  is_egx70: boolean;
  is_egx100: boolean;
  last_update: string | null;
}

interface PriceData {
  current_price: number;
  previous_close: number;
  open_price: number;
  high_price: number;
  low_price: number;
  change_percent: number;
  volume: number;
  volume_raw: string | number | null;
  avg_volume: number;
  close: number;
}

interface KeyMetrics {
  market_cap: number;
  pe_ratio: number;
  pb_ratio: number;
  ps_ratio: number;
  eps: number;
  roe: number;
  roa: number;
  profit_margin: number;
  dividend_yield: number;
  debt_to_equity: number;
  current_ratio: number;
  book_value_per_share: number;
  beta: number;
}

interface TechnicalData {
  rsi: number;
  ma_50: number;
  ma_200: number;
  support: number;
  resistance: number;
  signal: number | string | null;
  trend: string | null;
  high_52w: number;
  low_52w: number;
}

interface PriceHistoryItem {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface NewsItem {
  title: string;
  summary: string;
  source: string;
  url: string;
  published_at: string;
  category: string;
  language: string;
}

interface PredictionItem {
  signal_type: string;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  prediction_date: string;
  status: string;
  outcome: string;
  outcome_ar: string;
  final_price: number;
  profit_loss_percent: number;
  hit_target: boolean;
  hit_stop_loss: boolean;
  days_to_target: number | null;
  market: string;
}

interface HunterAssessment {
  available: boolean;
  eligible: boolean;
  entry: number;
  stop: number;
  target: number;
  risk_reward: number;
  support: number;
  resistance: number;
  risk_pct: number;
  reward_pct: number;
  entry_trigger: string;
  timeframe: string;
  narrative: string[];
  reason: string;
}

interface DeepAnalysisResponse {
  success: boolean;
  ticker: string;
  market: string;
  name: string;
  name_ar: string;
  timestamp: string;
  elapsed_ms: number;
  basic_info: BasicInfo;
  price: PriceData;
  key_metrics: KeyMetrics;
  technical: TechnicalData;
  price_history: PriceHistoryItem[];
  news: NewsItem[];
  predictions: PredictionItem[];
  hunter_assessment: HunterAssessment;
  meta: {
    hunting_helpers_available: boolean;
    maestro_available: boolean;
    helpers_error: string | null;
    maestro_error: string | null;
    price_history_count: number;
    news_count: number;
    predictions_count: number;
    hunter_available: boolean;
    hunter_eligible: boolean;
  };
  error?: string;
}

// ============================================================================
// Helpers
// ============================================================================

const MARKET_NAMES_AR: Record<string, string> = {
  EGX: 'البورصة المصرية',
  TADAWUL: 'السوق السعودي',
  KSE: 'بورصة الكويت',
  QSE: 'بورصة قطر',
};

function formatNumber(v: number, digits = 2): string {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return v.toLocaleString('ar-EG', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatInt(v: number): string {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return Math.round(v).toLocaleString('ar-EG');
}

function formatVolume(v: number): string {
  if (!v || v <= 0) return '—';
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)} مليار`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} مليون`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)} ألف`;
  return formatInt(v);
}

function formatMarketCap(v: number): string {
  if (!v || v <= 0) return '—';
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(2)} مليار`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(2)} مليون`;
  return formatInt(v);
}

function formatDate(s: string): string {
  if (!s) return '—';
  try {
    // Handle "20260622T140758" or ISO "2026-06-22T14:07:58Z"
    let iso = s;
    if (/^\d{8}T\d{6}/.test(s)) {
      iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}`;
    }
    const d = new Date(iso);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return s;
  }
}

function shortDate(s: string): string {
  if (!s) return '';
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('ar-EG', { month: 'short', day: 'numeric' });
  } catch {
    return s;
  }
}

// ============================================================================
// Page (Suspense wrapper because useSearchParams يحتاج Suspense في Next.js 16)
// ============================================================================

export default function StockDeepAnalysisPage() {
  return (
    <Suspense fallback={<PageLoadingSkeleton />}>
      <StockDeepAnalysisContent />
    </Suspense>
  );
}

function PageLoadingSkeleton() {
  return (
    <div className="min-h-screen bg-background p-4 sm:p-6 max-w-5xl mx-auto" dir="rtl">
      <Skeleton className="h-10 w-full mb-4" />
      <Skeleton className="h-32 w-full mb-4" />
      <Skeleton className="h-64 w-full mb-4" />
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

// ============================================================================
// Content — الـ logic الفعلي
// ============================================================================

function StockDeepAnalysisContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const ticker = (params?.ticker as string || '').toString().toUpperCase();
  const market = (searchParams.get('market') || 'EGX').toUpperCase();

  const [data, setData] = useState<DeepAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stock/deep-analysis?ticker=${encodeURIComponent(ticker)}&market=${encodeURIComponent(market)}`, {
        cache: 'no-store',
      });
      if (res.status === 404) {
        const errData = await res.json().catch(() => ({}));
        setError(errData.error || `السهم '${ticker}' مش موجود في السوق '${market}'`);
        setData(null);
        return;
      }
      if (!res.ok) {
        setError(`فشل في تحميل البيانات (HTTP ${res.status})`);
        setData(null);
        return;
      }
      const json = await res.json();
      if (!json.success) {
        setError(json.error || 'فشل في تحميل البيانات');
        setData(null);
        return;
      }
      setData(json);
    } catch (err) {
      setError('فشل في الاتصال بالخادم');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [ticker, market]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="min-h-screen bg-background text-foreground" dir="rtl">
      <div className="max-w-5xl mx-auto p-3 sm:p-6 space-y-4 sm:space-y-6">
        {/* Back button */}
        <div className="flex items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.back()}
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowRight className="h-4 w-4 ml-1" />
            رجوع
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchData}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4 ml-1', loading && 'animate-spin')} />
            تحديث
          </Button>
        </div>

        {loading ? (
          <LoadingState />
        ) : error ? (
          <ErrorState error={error} onRetry={fetchData} ticker={ticker} market={market} />
        ) : data ? (
          <DeepAnalysisView data={data} />
        ) : null}

        {/* Disclaimer */}
        {data && (
          <Card className="bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900">
            <CardContent className="p-4 flex items-start gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-300 leading-relaxed">
                <span className="font-bold">إخلاء مسؤولية: </span>
                هذا التحليل لأغراض تعليمية فقط وليس توصية شراء أو بيع.
                أسهم المخاطر العالية قد تتعرض لخسائر كبيرة. إدارة رأس المال والالتزام بوقف الخسارة
                أهم من تحقيق الربح. الحد الأقصى الموصى به: 5% من رأس المال لكل صفقة.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Loading State
// ============================================================================

function LoadingState() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-72 w-full" />
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
      <Skeleton className="h-48 w-full" />
    </div>
  );
}

// ============================================================================
// Error State
// ============================================================================

function ErrorState({ error, onRetry, ticker, market }: {
  error: string;
  onRetry: () => void;
  ticker: string;
  market: string;
}) {
  return (
    <Card className="border-destructive">
      <CardContent className="p-8 text-center">
        <AlertTriangle className="h-12 w-12 mx-auto mb-3 text-destructive" />
        <p className="text-lg font-medium mb-2">{error}</p>
        <p className="text-sm text-muted-foreground mb-4">
          السهم: <span className="font-mono font-bold">{ticker}</span> — السوق: {MARKET_NAMES_AR[market] || market}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw className="h-4 w-4 ml-2" />
          إعادة المحاولة
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main View
// ============================================================================

function DeepAnalysisView({ data }: { data: DeepAnalysisResponse }) {
  const { basic_info, price, key_metrics, technical, price_history, news, predictions, hunter_assessment } = data;
  const change = price.change_percent;
  const isPositive = change >= 0;

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <StockHeader data={data} />

      {/* Hunter Assessment — لو موجود */}
      {hunter_assessment.available && (
        <HunterAssessmentCard assessment={hunter_assessment} currentPrice={price.current_price} />
      )}

      {/* Price Chart */}
      <PriceChartCard history={price_history} support={technical.support} resistance={technical.resistance} />

      {/* Key Metrics */}
      <KeyMetricsCard metrics={key_metrics} price={price} />

      {/* Technical Analysis */}
      <TechnicalCard technical={technical} price={price} />

      {/* News */}
      <NewsCard news={news} />

      {/* Predictions */}
      <PredictionsCard predictions={predictions} />
    </div>
  );
}

// ============================================================================
// Header
// ============================================================================

function StockHeader({ data }: { data: DeepAnalysisResponse }) {
  const { basic_info, price, meta } = data;
  const change = price.change_percent;
  const isPositive = change >= 0;

  return (
    <Card className={cn(
      'border-r-4',
      isPositive ? 'border-r-emerald-500' : 'border-r-rose-500'
    )}>
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          {/* Right side (in RTL: visually right) */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <h1 className="text-2xl sm:text-3xl font-bold truncate">
                {basic_info.name_ar || basic_info.name || basic_info.ticker}
              </h1>
              <Badge variant="secondary" className="font-mono text-sm">
                {basic_info.ticker}
              </Badge>
            </div>
            <div className="flex items-center gap-2 flex-wrap text-sm">
              <Badge variant="outline">
                {MARKET_NAMES_AR[basic_info.market] || basic_info.market}
              </Badge>
              {basic_info.sector && (
                <Badge variant="outline">{basic_info.sector}</Badge>
              )}
              {basic_info.is_egx30 && <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">EGX30</Badge>}
              {basic_info.is_egx70 && <Badge className="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">EGX70</Badge>}
              {basic_info.is_egx100 && <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300">EGX100</Badge>}
              {!basic_info.is_active && (
                <Badge variant="destructive">غير نشط</Badge>
              )}
            </div>
          </div>

          {/* Left side (price) */}
          <div className="text-left sm:text-left flex-shrink-0">
            <div className="flex items-baseline gap-2 justify-end">
              <span className="text-3xl sm:text-4xl font-bold tabular-nums">
                {formatNumber(price.current_price, 2)}
              </span>
              <span className="text-sm text-muted-foreground">جنيه</span>
            </div>
            <div className={cn(
              'flex items-center gap-1 justify-end mt-1 text-sm font-medium',
              isPositive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
            )}>
              {isPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
              <span className="tabular-nums">
                {isPositive ? '+' : ''}{formatNumber(change, 2)}%
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              آخر تحديث: {basic_info.last_update ? new Date(basic_info.last_update).toLocaleString('ar-EG') : '—'}
            </p>
          </div>
        </div>

        {/* Quick stats row */}
        <Separator className="my-4" />
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <QuickStat label="الإغلاق السابق" value={formatNumber(price.previous_close, 2)} />
          <QuickStat label="افتتاح اليوم" value={formatNumber(price.open_price, 2)} />
          <QuickStat label="أعلى اليوم" value={formatNumber(price.high_price, 2)} />
          <QuickStat label="أدنى اليوم" value={formatNumber(price.low_price, 2)} />
          <QuickStat label="حجم التداول" value={formatVolume(price.volume)} />
          <QuickStat label="متوسط الحجم" value={formatVolume(price.avg_volume)} />
          <QuickStat label="القيمة السوقية" value={formatMarketCap(key_metrics.market_cap)} />
          <QuickStat label="بيتا (β)" value={key_metrics.beta > 0 ? formatNumber(key_metrics.beta, 2) : '—'} />
        </div>

        {meta?.elapsed_ms && (
          <p className="text-[10px] text-muted-foreground/60 mt-3 text-left">
            ⚡ اتعمل التحليل في {meta.elapsed_ms}ms
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function QuickStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums">{value}</span>
    </div>
  );
}

// ============================================================================
// Hunter Assessment Card
// ============================================================================

function HunterAssessmentCard({ assessment, currentPrice }: {
  assessment: HunterAssessment;
  currentPrice: number;
}) {
  const { entry, stop, target, risk_reward, risk_pct, reward_pct, entry_trigger, timeframe, narrative, eligible, reason } = assessment;

  return (
    <Card className={cn(
      'border-r-4',
      eligible ? 'border-r-orange-500 bg-orange-50/40 dark:bg-orange-950/10' : 'border-r-zinc-400'
    )}>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Zap className="h-5 w-5 text-orange-500" />
          تقييم الصياد
          {eligible ? (
            <Badge className="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              مؤهل ✅
            </Badge>
          ) : (
            <Badge variant="secondary">غير مؤهل</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Entry / Stop / Target */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
            <div className="flex items-center gap-1 mb-1">
              <Target className="h-3.5 w-3.5 text-emerald-600" />
              <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">الدخول</span>
            </div>
            <p className="text-xl font-bold text-emerald-900 dark:text-emerald-200 tabular-nums">
              {formatNumber(entry, 2)}
            </p>
            <p className="text-[11px] text-emerald-700/70 dark:text-emerald-400/70 mt-1">
              {entry_trigger}
            </p>
          </div>

          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900">
            <div className="flex items-center gap-1 mb-1">
              <Shield className="h-3.5 w-3.5 text-rose-600" />
              <span className="text-xs text-rose-700 dark:text-rose-400 font-medium">وقف الخسارة</span>
            </div>
            <p className="text-xl font-bold text-rose-900 dark:text-rose-200 tabular-nums">
              {formatNumber(stop, 2)}
            </p>
            <p className="text-[11px] text-rose-700/70 dark:text-rose-400/70 mt-1">
              المخاطرة: -{formatNumber(risk_pct, 1)}%
            </p>
          </div>

          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
            <div className="flex items-center gap-1 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
              <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">الهدف</span>
            </div>
            <p className="text-xl font-bold text-emerald-900 dark:text-emerald-200 tabular-nums">
              {formatNumber(target, 2)}
            </p>
            <p className="text-[11px] text-emerald-700/70 dark:text-emerald-400/70 mt-1">
              العائد: +{formatNumber(reward_pct, 1)}%
            </p>
          </div>
        </div>

        {/* R/R + Timeframe */}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex items-center gap-2 p-3 rounded-lg bg-orange-50 dark:bg-orange-950/30 border border-orange-200 dark:border-orange-900">
            <Award className="h-5 w-5 text-orange-500" />
            <div>
              <p className="text-xs text-muted-foreground">العائد/المخاطرة</p>
              <p className={cn(
                'text-lg font-bold tabular-nums',
                risk_reward >= 3 ? 'text-emerald-600' : risk_reward >= 2 ? 'text-amber-600' : 'text-rose-600'
              )}>
                1:{formatNumber(risk_reward, 1)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 p-3 rounded-lg bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-900">
            <Clock className="h-5 w-5 text-purple-500" />
            <div>
              <p className="text-xs text-muted-foreground">الإطار الزمني</p>
              <p className="text-lg font-bold">{timeframe}</p>
            </div>
          </div>
        </div>

        {/* Reason */}
        {reason && (
          <div className="text-xs text-muted-foreground p-3 rounded-lg bg-muted/30">
            <span className="font-medium">السبب: </span>{reason}
          </div>
        )}

        {/* Narrative */}
        {narrative && narrative.length > 0 && (
          <div className="space-y-1 p-3 rounded-lg bg-muted/30">
            <p className="text-xs font-medium mb-2">📖 السرد التحليلي</p>
            {narrative.map((line, i) => (
              line && (
                <p key={i} className="text-xs text-muted-foreground leading-relaxed">
                  • {line}
                </p>
              )
            ))}
          </div>
        )}

        {/* Disclaimer inside card */}
        {!eligible && (
          <div className="flex items-start gap-2 p-2 rounded text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            <span>هذا السهم لم يعدّ فلاتر الصياد الصارمة (R/R ≥ 3.0). البيانات أعلاه حسابية فقط وليست توصية.</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Price Chart
// ============================================================================

function PriceChartCard({ history, support, resistance }: {
  history: PriceHistoryItem[];
  support: number;
  resistance: number;
}) {
  if (!history || history.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <LineChartIcon className="h-5 w-5 text-purple-500" />
            الرسم البياني للسعر
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 text-center text-muted-foreground">
          لا توجد بيانات تاريخية كافية للسهم
        </CardContent>
      </Card>
    );
  }

  // آخر 90 يوم — قلبناها ASC في الـ backend
  const chartData = history.map(h => ({
    date: shortDate(h.date),
    fullDate: h.date,
    close: h.close,
    volume: h.volume,
  }));

  // تحديد نطاق Y ليشمل support/resistance كمان
  const allValues = [
    ...history.map(h => h.close),
    ...(support > 0 ? [support] : []),
    ...(resistance > 0 ? [resistance] : []),
  ].filter(v => v > 0);
  const minY = allValues.length ? Math.min(...allValues) * 0.98 : 0;
  const maxY = allValues.length ? Math.max(...allValues) * 1.02 : 100;

  const firstClose = history[0]?.close || 0;
  const lastClose = history[history.length - 1]?.close || 0;
  const periodChange = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;
  const isPeriodPositive = periodChange >= 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <LineChartIcon className="h-5 w-5 text-purple-500" />
            الرسم البياني للسعر (آخر {history.length} يوم)
          </CardTitle>
          <div className={cn(
            'text-sm font-medium flex items-center gap-1',
            isPeriodPositive ? 'text-emerald-600' : 'text-rose-600'
          )}>
            {isPeriodPositive ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
            <span className="tabular-nums">
              {isPeriodPositive ? '+' : ''}{formatNumber(periodChange, 1)}%
            </span>
            <span className="text-xs text-muted-foreground mr-1">خلال الفترة</span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-64 sm:h-80 w-full" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={isPeriodPositive ? '#10b981' : '#f43f5e'} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={isPeriodPositive ? '#10b981' : '#f43f5e'} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                interval="preserveStartEnd"
                minTickGap={30}
              />
              <YAxis
                domain={[minY, maxY]}
                tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}
                width={55}
                tickFormatter={(v) => formatNumber(v, 1)}
                orientation="right"
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
                labelStyle={{ color: 'hsl(var(--popover-foreground))' }}
                formatter={(value: number, name: string) => {
                  if (name === 'close') return [formatNumber(value, 2), 'الإغلاق'];
                  return [value, name];
                }}
              />
              <Area
                type="monotone"
                dataKey="close"
                stroke={isPeriodPositive ? '#10b981' : '#f43f5e'}
                strokeWidth={2}
                fill="url(#priceGradient)"
                dot={false}
              />
              {support > 0 && (
                <ReferenceLine y={support} stroke="#10b981" strokeDasharray="4 4" strokeOpacity={0.5}
                  label={{ value: `دعم: ${formatNumber(support, 2)}`, position: 'insideBottomRight', fontSize: 10, fill: '#10b981' }} />
              )}
              {resistance > 0 && (
                <ReferenceLine y={resistance} stroke="#f43f5e" strokeDasharray="4 4" strokeOpacity={0.5}
                  label={{ value: `مقاومة: ${formatNumber(resistance, 2)}`, position: 'insideTopRight', fontSize: 10, fill: '#f43f5e' }} />
              )}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
          <span className="flex items-center gap-1">
            <span className="inline-block w-3 h-0.5 bg-emerald-500"></span>
            سعر الإغلاق
          </span>
          {support > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-emerald-500" style={{borderTop: '2px dashed'}}></span>
              الدعم
            </span>
          )}
          {resistance > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-rose-500" style={{borderTop: '2px dashed'}}></span>
              المقاومة
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Key Metrics
// ============================================================================

function KeyMetricsCard({ metrics, price }: { metrics: KeyMetrics; price: PriceData }) {
  const metrics_list: Array<{
    label: string;
    value: string;
    icon: React.ReactNode;
    color: string;
    hint?: string;
  }> = [
    {
      label: 'مكرر الربحية (P/E)',
      value: metrics.pe_ratio > 0 ? formatNumber(metrics.pe_ratio, 1) : '—',
      icon: <DollarSign className="h-4 w-4" />,
      color: 'text-purple-500',
      hint: metrics.pe_ratio > 0 ? (metrics.pe_ratio > 20 ? 'مرتفع' : metrics.pe_ratio < 10 ? 'منخفض' : 'معتدل') : undefined,
    },
    {
      label: 'مكرر القيمة الدفترية (P/B)',
      value: metrics.pb_ratio > 0 ? formatNumber(metrics.pb_ratio, 2) : '—',
      icon: <Scale className="h-4 w-4" />,
      color: 'text-purple-500',
      hint: metrics.pb_ratio > 0 ? (metrics.pb_ratio > 3 ? 'مرتفع' : metrics.pb_ratio < 1 ? 'تحت القيمة' : 'معتدل') : undefined,
    },
    {
      label: 'ربحية السهم (EPS)',
      value: metrics.eps !== 0 ? formatNumber(metrics.eps, 2) : '—',
      icon: <PiggyBank className="h-4 w-4" />,
      color: 'text-emerald-500',
    },
    {
      label: 'العائد على حقوق الملكية (ROE)',
      value: metrics.roe > 0 ? `${formatNumber(metrics.roe, 1)}%` : '—',
      icon: <Percent className="h-4 w-4" />,
      color: 'text-emerald-500',
      hint: metrics.roe > 0 ? (metrics.roe > 15 ? 'ممتاز' : metrics.roe > 8 ? 'جيد' : 'ضعيف') : undefined,
    },
    {
      label: 'العائد على الأصول (ROA)',
      value: metrics.roa > 0 ? `${formatNumber(metrics.roa, 1)}%` : '—',
      icon: <Activity className="h-4 w-4" />,
      color: 'text-emerald-500',
    },
    {
      label: 'هامش الربح',
      value: metrics.profit_margin !== 0 ? `${formatNumber(metrics.profit_margin, 1)}%` : '—',
      icon: <Percent className="h-4 w-4" />,
      color: metrics.profit_margin >= 0 ? 'text-emerald-500' : 'text-rose-500',
    },
    {
      label: 'الدين / حقوق الملكية',
      value: metrics.debt_to_equity > 0 ? formatNumber(metrics.debt_to_equity, 2) : '—',
      icon: <Scale className="h-4 w-4" />,
      color: metrics.debt_to_equity > 2 ? 'text-rose-500' : 'text-amber-500',
      hint: metrics.debt_to_equity > 0 ? (metrics.debt_to_equity > 2 ? 'مرتفع' : 'مقبول') : undefined,
    },
    {
      label: 'نسبة التداول',
      value: metrics.current_ratio > 0 ? formatNumber(metrics.current_ratio, 2) : '—',
      icon: <Scale className="h-4 w-4" />,
      color: 'text-amber-500',
      hint: metrics.current_ratio > 0 ? (metrics.current_ratio < 1 ? 'ضعيف' : metrics.current_ratio > 2 ? 'قوي' : 'مقبول') : undefined,
    },
    {
      label: 'العائد التوزيعي',
      value: metrics.dividend_yield > 0 ? `${formatNumber(metrics.dividend_yield, 2)}%` : '—',
      icon: <PiggyBank className="h-4 w-4" />,
      color: 'text-purple-500',
    },
    {
      label: 'القيمة الدفترية/سهم',
      value: metrics.book_value_per_share > 0 ? formatNumber(metrics.book_value_per_share, 2) : '—',
      icon: <DollarSign className="h-4 w-4" />,
      color: 'text-purple-500',
    },
    {
      label: 'بيتا (β)',
      value: metrics.beta > 0 ? formatNumber(metrics.beta, 2) : '—',
      icon: <Activity className="h-4 w-4" />,
      color: 'text-amber-500',
      hint: metrics.beta > 0 ? (metrics.beta > 1.5 ? 'تذبذب عالٍ' : metrics.beta < 0.8 ? 'تذبذب منخفض' : 'تذبذب معتدل') : undefined,
    },
    {
      label: 'القيمة السوقية',
      value: formatMarketCap(metrics.market_cap),
      icon: <BarChart3 className="h-4 w-4" />,
      color: 'text-emerald-500',
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-purple-500" />
          المؤشرات المالية الأساسية
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {metrics_list.map((m, i) => (
            <div
              key={i}
              className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span className={m.color}>{m.icon}</span>
                <span className="text-[11px] text-muted-foreground leading-tight">{m.label}</span>
              </div>
              <p className="text-base sm:text-lg font-bold tabular-nums">{m.value}</p>
              {m.hint && (
                <p className="text-[10px] text-muted-foreground/70 mt-0.5">{m.hint}</p>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Technical Analysis
// ============================================================================

function TechnicalCard({ technical, price }: { technical: TechnicalData; price: PriceData }) {
  const rsi = technical.rsi;
  const rsiStatus = rsi > 70 ? { label: 'تشبع شرائي', color: 'text-rose-600', bg: 'bg-rose-50 dark:bg-rose-950/30' }
    : rsi < 30 && rsi > 0 ? { label: 'تشبع بيعي', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-950/30' }
    : rsi > 0 ? { label: 'محايد', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-950/30' }
    : { label: 'غير متاح', color: 'text-muted-foreground', bg: 'bg-muted/30' };

  const trend = technical.trend || 'غير محدد';
  const trendColor = trend === 'صاعد' || trend === 'BULL' ? 'text-emerald-600'
    : trend === 'هابط' || trend === 'BEAR' ? 'text-rose-600'
    : 'text-amber-600';

  // 52-week range position
  const range52w = technical.high_52w - technical.low_52w;
  const currentIn52w = range52w > 0 && price.current_price > 0
    ? ((price.current_price - technical.low_52w) / range52w) * 100
    : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Activity className="h-5 w-5 text-orange-500" />
          التحليل الفني
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* RSI */}
        <div className={cn('p-3 rounded-lg', rsiStatus.bg)}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium">مؤشر القوة النسبية (RSI)</span>
            <Badge variant="outline" className={rsiStatus.color}>
              {rsiStatus.label}
            </Badge>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold tabular-nums">
              {rsi > 0 ? formatNumber(rsi, 1) : '—'}
            </span>
            {rsi > 0 && (
              <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden relative">
                <div className="absolute inset-y-0 left-0 right-0 flex">
                  <div className="w-[30%] bg-emerald-500/30"></div>
                  <div className="w-[40%] bg-amber-500/30"></div>
                  <div className="w-[30%] bg-rose-500/30"></div>
                </div>
                <div
                  className="absolute top-0 bottom-0 w-1 bg-foreground rounded"
                  style={{ right: `${rsi}%` }}
                ></div>
              </div>
            )}
          </div>
        </div>

        {/* MA50 / MA200 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-xs text-muted-foreground mb-1">المتوسط المتحرك 50 يوم</p>
            <p className="text-lg font-bold tabular-nums">
              {technical.ma_50 > 0 ? formatNumber(technical.ma_50, 2) : '—'}
            </p>
            {technical.ma_50 > 0 && price.current_price > 0 && (
              <p className={cn('text-[11px]', price.current_price > technical.ma_50 ? 'text-emerald-600' : 'text-rose-600')}>
                {price.current_price > technical.ma_50 ? 'السعر فوق MA50 (إيجابي)' : 'السعر تحت MA50 (سلبي)'}
              </p>
            )}
          </div>
          <div className="p-3 rounded-lg bg-muted/30">
            <p className="text-xs text-muted-foreground mb-1">المتوسط المتحرك 200 يوم</p>
            <p className="text-lg font-bold tabular-nums">
              {technical.ma_200 > 0 ? formatNumber(technical.ma_200, 2) : '—'}
            </p>
            {technical.ma_200 > 0 && price.current_price > 0 && (
              <p className={cn('text-[11px]', price.current_price > technical.ma_200 ? 'text-emerald-600' : 'text-rose-600')}>
                {price.current_price > technical.ma_200 ? 'السعر فوق MA200 (إيجابي)' : 'السعر تحت MA200 (سلبي)'}
              </p>
            )}
          </div>
        </div>

        {/* Support / Resistance */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900">
            <div className="flex items-center gap-1 mb-1">
              <Shield className="h-3.5 w-3.5 text-emerald-600" />
              <span className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">الدعم</span>
            </div>
            <p className="text-lg font-bold text-emerald-900 dark:text-emerald-200 tabular-nums">
              {technical.support > 0 ? formatNumber(technical.support, 2) : '—'}
            </p>
          </div>
          <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900">
            <div className="flex items-center gap-1 mb-1">
              <Target className="h-3.5 w-3.5 text-rose-600" />
              <span className="text-xs text-rose-700 dark:text-rose-400 font-medium">المقاومة</span>
            </div>
            <p className="text-lg font-bold text-rose-900 dark:text-rose-200 tabular-nums">
              {technical.resistance > 0 ? formatNumber(technical.resistance, 2) : '—'}
            </p>
          </div>
        </div>

        {/* 52w Range */}
        {technical.high_52w > 0 && technical.low_52w > 0 && (
          <div className="p-3 rounded-lg bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">مدى 52 أسبوع</span>
              {currentIn52w !== null && (
                <span className="text-xs text-muted-foreground">
                  السعر الحالي في {formatNumber(currentIn52w, 0)}% من المدى
                </span>
              )}
            </div>
            <div className="relative h-3 bg-gradient-to-l from-rose-300 via-amber-300 to-emerald-300 dark:from-rose-900 dark:via-amber-900 dark:to-emerald-900 rounded-full">
              {currentIn52w !== null && (
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-1 h-5 bg-foreground rounded shadow"
                  style={{ right: `${currentIn52w}%` }}
                ></div>
              )}
            </div>
            <div className="flex items-center justify-between mt-1 text-xs">
              <span className="text-rose-600 font-medium tabular-nums">
                أدنى: {formatNumber(technical.low_52w, 2)}
              </span>
              <span className="text-emerald-600 font-medium tabular-nums">
                أعلى: {formatNumber(technical.high_52w, 2)}
              </span>
            </div>
          </div>
        )}

        {/* Trend + Signal */}
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-muted/30 text-center">
            <p className="text-xs text-muted-foreground mb-1">الاتجاه</p>
            <p className={cn('text-base font-bold', trendColor)}>{trend}</p>
          </div>
          <div className="p-3 rounded-lg bg-muted/30 text-center">
            <p className="text-xs text-muted-foreground mb-1">الإشارة</p>
            <p className="text-base font-bold">{technical.signal ?? '—'}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// News
// ============================================================================

function NewsCard({ news }: { news: NewsItem[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Newspaper className="h-5 w-5 text-purple-500" />
          آخر الأخبار
          {news.length > 0 && (
            <Badge variant="secondary" className="text-xs">{news.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {news.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            لا توجد أخبار حديثة لهذا السهم
          </p>
        ) : (
          <div className="space-y-3 max-h-96 overflow-y-auto pl-1">
            {news.map((n, i) => (
              <div
                key={i}
                className="p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors border-r-2 border-r-purple-300 dark:border-r-purple-800"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <p className="text-sm font-medium leading-snug flex-1">{n.title}</p>
                  {n.url && (
                    <a
                      href={n.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-foreground flex-shrink-0 mt-0.5"
                      aria-label="فتح الخبر"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </a>
                  )}
                </div>
                {n.summary && (
                  <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                    {n.summary}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground">
                  <Badge variant="outline" className="text-[10px] py-0">{n.source || '—'}</Badge>
                  <span>{formatDate(n.published_at)}</span>
                  {n.category && <span>• {n.category}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Predictions
// ============================================================================

function PredictionsCard({ predictions }: { predictions: PredictionItem[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Award className="h-5 w-5 text-orange-500" />
          التوقعات السابقة
          {predictions.length > 0 && (
            <Badge variant="secondary" className="text-xs">{predictions.length}</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {predictions.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            لا توجد توقعات سابقة لهذا السهم
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">التاريخ</TableHead>
                  <TableHead className="text-xs">الإشارة</TableHead>
                  <TableHead className="text-xs text-center">الدخول</TableHead>
                  <TableHead className="text-xs text-center">الهدف</TableHead>
                  <TableHead className="text-xs text-center">الوقف</TableHead>
                  <TableHead className="text-xs text-center">النتيجة</TableHead>
                  <TableHead className="text-xs text-center">العائد</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {predictions.map((p, i) => {
                  const signalColor =
                    p.signal_type === 'BUY' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                    : p.signal_type === 'SELL' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                    : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300';

                  const outcomeColor =
                    p.outcome === 'TARGET_HIT' ? 'text-emerald-600'
                    : p.outcome === 'STOP_HIT' ? 'text-rose-600'
                    : p.outcome === 'CLOSED' ? 'text-amber-600'
                    : 'text-muted-foreground';

                  return (
                    <TableRow key={i}>
                      <TableCell className="text-xs whitespace-nowrap">{formatDate(p.prediction_date)}</TableCell>
                      <TableCell>
                        <Badge className={cn('text-[10px] py-0', signalColor)} variant="secondary">
                          {p.signal_type === 'BUY' ? 'شراء' : p.signal_type === 'SELL' ? 'بيع' : p.signal_type === 'HOLD' ? 'انتظار' : p.signal_type}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-center tabular-nums">{formatNumber(p.entry_price, 2)}</TableCell>
                      <TableCell className="text-xs text-center tabular-nums">{formatNumber(p.target_price, 2)}</TableCell>
                      <TableCell className="text-xs text-center tabular-nums">{formatNumber(p.stop_loss, 2)}</TableCell>
                      <TableCell className={cn('text-xs text-center font-medium', outcomeColor)}>
                        {p.outcome_ar}
                      </TableCell>
                      <TableCell className={cn(
                        'text-xs text-center tabular-nums font-medium',
                        p.profit_loss_percent > 0 ? 'text-emerald-600'
                        : p.profit_loss_percent < 0 ? 'text-rose-600'
                        : 'text-muted-foreground'
                      )}>
                        {p.profit_loss_percent !== 0
                          ? `${p.profit_loss_percent > 0 ? '+' : ''}${formatNumber(p.profit_loss_percent, 2)}%`
                          : '—'}
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
  );
}
