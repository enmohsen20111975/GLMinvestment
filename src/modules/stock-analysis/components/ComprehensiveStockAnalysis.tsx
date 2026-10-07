'use client';

/**
 * ComprehensiveStockAnalysis
 * ==========================
 * شاشة التحليلات الشاملة لسهم واحد — تجمع كل المحركات:
 * - Basic Info + Price
 * - Technical Analysis (RSI, MA, S/R, indicators)
 * - Fundamental Analysis (P/E, ROE, Debt, etc.)
 * - Maestro Orchestrator (phases, score, recommendation)
 * - Hunter / Board of Analysts
 * - Price Chart with indicators
 * - News & Sentiment
 * - Predictions history
 * - AI Professional Analysis
 *
 * كل التبويبات بترسم من response الـ /api/stocks/[ticker]/comprehensive
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  TrendingUp, TrendingDown, Activity, BarChart3, DollarSign,
  Shield, Target, Newspaper, Brain, Zap, Award, AlertTriangle,
  RefreshCw, Clock, ChevronRight, Gauge, PieChart, LineChart as LineChartIcon,
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
  ReferenceLine, Line, LineChart, Bar, BarChart, ComposedChart,
  RadialBar, RadialBarChart, PolarAngleAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Progress } from '@/components/ui/progress';
import {
  Tabs, TabsContent, TabsList, TabsTrigger,
} from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface ComprehensiveData {
  success: boolean;
  ticker: string;
  market: string;
  timestamp: string;
  basic?: Record<string, unknown> | null;
  price?: Record<string, unknown> | null;
  keyMetrics?: Record<string, unknown> | null;
  technical?: Record<string, unknown> | null;
  priceHistory?: Array<Record<string, unknown>>;
  maestro?: Record<string, unknown> | null;
  hunter?: Record<string, unknown> | null;
  board?: Record<string, unknown> | null;
  news?: Array<Record<string, unknown>>;
  predictions?: Array<Record<string, unknown>>;
  professional?: Record<string, unknown> | null;
  errors: string[];
  elapsed_ms: number;
}

// ============================================================================
// Helpers
// ============================================================================

function formatPrice(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || isNaN(Number(v))) return '—';
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPct(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || isNaN(Number(v))) return '—';
  const n = Number(v);
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}%`;
}

function formatVolume(v: number | null | undefined): string {
  if (!v || isNaN(Number(v))) return '—';
  const n = Number(v);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  return n.toString();
}

function formatMarketCap(v: number | null | undefined): string {
  if (!v || isNaN(Number(v))) return '—';
  const n = Number(v);
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toString();
}

function shortDate(s: string): string {
  if (!s) return '';
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s.slice(0, 10);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  } catch {
    return s.slice(0, 10);
  }
}

// Color helpers
function changeColor(v: number | null | undefined): string {
  if (v === null || v === undefined) return 'text-muted-foreground';
  const n = Number(v);
  if (n > 0) return 'text-emerald-600 dark:text-emerald-400';
  if (n < 0) return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

function scoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-600 dark:text-emerald-400';
  if (score >= 50) return 'text-amber-600 dark:text-amber-400';
  if (score >= 30) return 'text-orange-600 dark:text-orange-400';
  return 'text-red-600 dark:text-red-400';
}

function scoreBg(score: number): string {
  if (score >= 70) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  if (score >= 30) return 'bg-orange-500';
  return 'bg-red-500';
}

function signalBadge(signal: string): { label: string; className: string } {
  // ─── CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 67) ───────────────
  // قبل كده: كان في 5 labels فقط (شراء قوي/شراء/بيع قوي/بيع/انتظار) —
  // ACCUMULATE/REDUCE كانوا بـ يقعوا في 'انتظار' → العميل بيشوف 'انتظار' بدل 'تجميع'.
  // الحل: إضافة الـ 7 levels الـ canonical.
  const s = (signal || '').toLowerCase();
  if (s.includes('strong_buy')) return { label: 'شراء قوي', className: 'bg-emerald-500 text-white' };
  if (s.includes('buy')) return { label: 'شراء', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' };
  if (s.includes('accumulate')) return { label: 'تجميع', className: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' };
  if (s.includes('strong_sell')) return { label: 'بيع قوي', className: 'bg-red-500 text-white' };
  if (s.includes('sell')) return { label: 'بيع', className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' };
  if (s.includes('reduce')) return { label: 'تخفيض', className: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' };
  return { label: 'انتظار', className: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' };
}

// ============================================================================
// Score Gauge (Radial)
// ============================================================================

function ScoreGauge({ score, label, size = 120 }: { score: number; label: string; size?: number }) {
  const data = [{ name: label, value: score, fill: score >= 70 ? '#10b981' : score >= 50 ? '#f59e0b' : score >= 30 ? '#f97316' : '#ef4444' }];
  return (
    <div className="flex flex-col items-center">
      <ResponsiveContainer width={size} height={size}>
        <RadialBarChart innerRadius="70%" outerRadius="100%" data={data} startAngle={90} endAngle={-270}>
          <PolarAngleAxis type="number" domain={[0, 100]} angleAxisId={0} tick={false} />
          <RadialBar background dataKey="value" cornerRadius={10} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="-mt-[75px] text-center pointer-events-none">
        <div className={cn('text-2xl font-bold', scoreColor(score))}>{Math.round(score)}</div>
        <div className="text-[10px] text-muted-foreground">{label}</div>
      </div>
      <div className="mt-[45px]" />
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

interface Props {
  ticker: string;
  market?: string;
}

export function ComprehensiveStockAnalysis({ ticker, market = 'EGX' }: Props) {
  const [data, setData] = useState<ComprehensiveData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/stocks/${encodeURIComponent(ticker)}/comprehensive?market=${encodeURIComponent(market)}`,
        { cache: 'no-store' }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError('تعذّر تحميل التحليل. يرجى المحاولة مرة أخرى.');
    } finally {
      setLoading(false);
    }
  }, [ticker, market]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-lg font-bold mb-2">فشل تحميل التحليل</p>
          <p className="text-sm text-muted-foreground mb-4">{error}</p>
          <Button onClick={fetchData} variant="outline">
            <RefreshCw className="w-4 h-4 ml-2" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  const price = data.price || {};
  const basic = data.basic || {};
  const rawTech = data.technical || {};
  const currentPriceNum = Number(price.current_price || price.close || 0);
  const tech: Record<string, any> = { ...rawTech };

  // Financial Sanity Gate: Ensure support < price < resistance under all circumstances
  if (currentPriceNum > 0) {
    let sup = Number(tech.support || 0);
    let res = Number(tech.resistance || 0);
    // Rule 67 — never fabricate 52w values. null if missing; formatPrice shows "—".
    let h52: number | null = tech.high_52w != null ? Number(tech.high_52w) : null;
    let l52: number | null = tech.low_52w != null ? Number(tech.low_52w) : null;

    if (sup <= 0 || sup >= currentPriceNum) {
      sup = Number((currentPriceNum * 0.95).toFixed(2));
    }
    if (res <= currentPriceNum) {
      res = Number((currentPriceNum * 1.05).toFixed(2));
    }
    if (sup >= res) {
      sup = Number((currentPriceNum * 0.95).toFixed(2));
      res = Number((currentPriceNum * 1.05).toFixed(2));
    }

    // Real 52-week High/Low: Single source of truth from market database.
    // Rule 67 — null when missing is honest. cp * 1.15 was a fabricated lie.
    if (h52 != null && !isNaN(h52) && h52 > 0) {
      h52 = Math.max(h52, currentPriceNum);
    } else {
      h52 = null;
    }
    if (l52 != null && !isNaN(l52) && l52 > 0) {
      l52 = Math.min(l52, currentPriceNum);
    } else {
      l52 = null;
    }

    tech.support = sup;
    tech.resistance = res;
    tech.high_52w = h52;
    tech.low_52w = l52;
  }

  const metrics = data.keyMetrics || {};
  const maestro = data.maestro?.maestroAnalysis || data.maestro || {};
  const change = Number(price.change_percent || 0);
  const isPositive = change >= 0;

  return (
    <div className="space-y-4">
      {/* Header — Stock Identity + Price */}
      <StockHeaderBar
        ticker={data.ticker}
        name={basic.name_ar || basic.name || data.ticker}
        market={data.market}
        sector={basic.sector}
        price={price.current_price}
        change={change}
        isPositive={isPositive}
        onRefresh={fetchData}
        elapsedMs={data.elapsed_ms}
      />

      {/* Error warnings (if any API failed) */}
      {data.errors.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20">
          <CardContent className="p-3">
            <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-300">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              <span>بعض المحركات فشلت: {data.errors.join(' | ')}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Stats Row (3 cards — Maestro card removed per user request 2026-09-28) */}
      <QuickStatsRow price={price} tech={tech} metrics={metrics} />

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 md:grid-cols-6 h-auto">
          <TabsTrigger value="overview" className="text-xs">نظرة عامة</TabsTrigger>
          <TabsTrigger value="technical" className="text-xs">فني</TabsTrigger>
          <TabsTrigger value="fundamental" className="text-xs">أساسي</TabsTrigger>
          <TabsTrigger value="chart" className="text-xs">رسوم</TabsTrigger>
          <TabsTrigger value="news" className="text-xs">أخبار</TabsTrigger>
          <TabsTrigger value="predictions" className="text-xs">توقعات</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="mt-4">
          <OverviewTab data={data} />
        </TabsContent>

        {/* Technical Tab */}
        <TabsContent value="technical" className="mt-4">
          <TechnicalTab tech={tech} price={price} priceHistory={data.priceHistory} />
        </TabsContent>

        {/* Fundamental Tab */}
        <TabsContent value="fundamental" className="mt-4">
          <FundamentalTab metrics={metrics} basic={basic} />
        </TabsContent>

        {/* Charts Tab */}
        <TabsContent value="chart" className="mt-4">
          <ChartsTab priceHistory={data.priceHistory} tech={tech} />
        </TabsContent>

        {/* News Tab */}
        <TabsContent value="news" className="mt-4">
          <NewsTab news={data.news} />
        </TabsContent>

        {/* Predictions Tab */}
        <TabsContent value="predictions" className="mt-4">
          <PredictionsTab predictions={data.predictions} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================================
// Header Bar
// ============================================================================

function StockHeaderBar({
  ticker, name, market, sector, price, change, isPositive, onRefresh, elapsedMs,
}: {
  ticker: string; name: string; market: string; sector: string;
  price: number; change: number; isPositive: boolean;
  onRefresh: () => void; elapsedMs: number;
}) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 sm:p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          {/* Left: Identity */}
          <div className="flex items-center gap-4">
            <div className={cn(
              'w-14 h-14 rounded-xl flex items-center justify-center text-white font-bold text-xl',
              isPositive ? 'bg-gradient-to-br from-emerald-500 to-teal-600' : 'bg-gradient-to-br from-red-500 to-rose-600'
            )}>
              {ticker.slice(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-xl font-bold">{ticker}</h2>
                <Badge variant="outline" className="text-xs">{market}</Badge>
                {sector && <Badge variant="secondary" className="text-xs">{sector}</Badge>}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{name}</p>
            </div>
          </div>

          {/* Right: Price + Change */}
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-2xl font-bold tabular-nums">
                {formatPrice(price)}
              </div>
              <div className={cn('text-sm font-semibold flex items-center gap-1 justify-end', changeColor(change))}>
                {isPositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                {formatPct(change)}
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={onRefresh} title="تحديث">
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
          <Clock className="w-3 h-3" />
          <span>آخر تحديث: {new Date().toLocaleTimeString('ar-EG')}</span>
          <Separator orientation="vertical" className="h-3" />
          <Zap className="w-3 h-3" />
          <span>زمن الاستجابة: {elapsedMs}ms</span>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Quick Stats Row (3 cards — Maestro card removed per user request 2026-09-28)
// ============================================================================

function QuickStatsRow({ price, tech, metrics }: { price: Record<string, unknown> | null | undefined; tech: Record<string, unknown> | null | undefined; metrics: Record<string, unknown> | null | undefined }) {
  const stats = [
    {
      label: 'السعر',
      value: formatPrice(price.current_price),
      sub: `إغلاق سابق: ${formatPrice(price.previous_close)}`,
      icon: DollarSign,
      color: 'text-teal-600 dark:text-teal-400',
    },
    {
      label: 'RSI (14)',
      value: tech.rsi ? tech.rsi.toFixed(1) : '—',
      sub: tech.rsi > 70 ? 'تشبع شرائي' : tech.rsi < 30 ? 'تشبع بيعي' : 'محايد',
      icon: Activity,
      color: tech.rsi > 70 ? 'text-red-500' : tech.rsi < 30 ? 'text-emerald-500' : 'text-amber-500',
    },
    {
      label: 'P/E',
      value: metrics.pe_ratio ? metrics.pe_ratio.toFixed(1) : '—',
      sub: metrics.pe_ratio < 15 ? 'رخيص' : metrics.pe_ratio > 30 ? 'غالي' : 'عادل',
      icon: BarChart3,
      color: 'text-purple-600 dark:text-purple-400',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
      {stats.map((s, i) => (
        <Card key={i} className="overflow-hidden">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <s.icon className={cn('w-4 h-4', s.color)} />
            </div>
            <div className={cn('text-lg font-bold tabular-nums', s.color)}>{s.value}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{s.sub}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// Overview Tab
// ============================================================================

function OverviewTab({ data }: { data: ComprehensiveData }) {
  const board = data.board || {};
  const hunter = data.hunter || {};
  const price = data.price || {};
  const tech = data.technical || {};

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

      {/* Board of Analysts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Award className="w-4 h-4" />
            مجلس المحللين
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {board.available ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">الإشارة</span>
                <Badge className={signalBadge(board.signal || '').className}>
                  {board.signal_ar || board.signal || '—'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">الثقة</span>
                <span className="font-bold">{Math.round(board.confidence || 0)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">الدرجة</span>
                <span className="font-bold">{Math.round(board.master_score || 0)}</span>
              </div>
              {board.entry_price && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">الدخول</span>
                  <span className="font-bold tabular-nums">{formatPrice(board.entry_price)}</span>
                </div>
              )}
              {board.target_price && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">الهدف</span>
                  <span className="font-bold tabular-nums text-emerald-600">{formatPrice(board.target_price)}</span>
                </div>
              )}
              {board.stop_loss && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">الوقف</span>
                  <span className="font-bold tabular-nums text-red-600">{formatPrice(board.stop_loss)}</span>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8">المجلس غير متاح</p>
          )}
        </CardContent>
      </Card>

      {/* Hunter */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="w-4 h-4" />
            تقييم الصياد
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {hunter.available ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">الحالة</span>
                <Badge variant={hunter.eligible ? 'default' : 'secondary'}>
                  {hunter.eligible ? 'مؤهل' : 'غير مؤهل'}
                </Badge>
              </div>
              {hunter.entry && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">الدخول</span>
                  <span className="font-bold tabular-nums">{formatPrice(hunter.entry)}</span>
                </div>
              )}
              {hunter.target && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">الهدف</span>
                  <span className="font-bold tabular-nums text-emerald-600">{formatPrice(hunter.target)}</span>
                </div>
              )}
              {hunter.stop && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">الوقف</span>
                  <span className="font-bold tabular-nums text-red-600">{formatPrice(hunter.stop)}</span>
                </div>
              )}
              {hunter.rr && (
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">R/R</span>
                  <span className={cn('font-bold', hunter.rr >= 1.5 ? 'text-emerald-600' : hunter.rr >= 1 ? 'text-amber-600' : 'text-red-600')}>
                    {Number(hunter.rr).toFixed(2)}:1
                  </span>
                </div>
              )}
              {hunter.narrative && (
                <p className="text-xs text-muted-foreground pt-2 border-t">{hunter.narrative}</p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8">الصياد غير متاح</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Technical Tab
// ============================================================================

function TechnicalTab({ tech, price, priceHistory }: { tech: Record<string, unknown> | null | undefined; price: Record<string, unknown> | null | undefined; priceHistory: Array<Record<string, unknown>> }) {
  const rsi = Number(tech.rsi || 0);
  const rsiStatus = rsi > 70 ? 'تشبع شرائي ⚠️' : rsi < 30 ? 'تشبع بيعي ✅' : 'محايد';
  const rsiColor = rsi > 70 ? 'text-red-500' : rsi < 30 ? 'text-emerald-500' : 'text-amber-500';

  const ma50 = Number(tech.ma_50 || 0);
  const ma200 = Number(tech.ma_200 || 0);
  const current = Number(price.current_price || 0);
  const trend = ma50 > ma200 ? 'صاعد' : ma50 < ma200 ? 'هابط' : 'عرضي';
  const trendColor = ma50 > ma200 ? 'text-emerald-600' : ma50 < ma200 ? 'text-red-600' : 'text-amber-600';

  return (
    <div className="space-y-4">
      {/* Indicators Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* RSI */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" />
              RSI (14)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="flex items-center justify-between mb-2">
              <span className="text-3xl font-bold tabular-nums">{rsi.toFixed(1)}</span>
              <span className={cn('text-sm font-semibold', rsiColor)}>{rsiStatus}</span>
            </div>
            <div className="relative h-3 bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500 rounded-full">
              <div
                className="absolute top-0 -mt-1 w-1 h-5 bg-foreground rounded"
                style={{ left: `${Math.min(100, Math.max(0, rsi))}%` }}
              />
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
              <span>0 (تشبع بيعي)</span>
              <span>30</span>
              <span>50</span>
              <span>70</span>
              <span>100 (تشبع شرائي)</span>
            </div>
          </CardContent>
        </Card>

        {/* Moving Averages */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <LineChartIcon className="w-4 h-4" />
              المتوسطات المتحركة
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">السعر الحالي</span>
              <span className="font-bold tabular-nums">{formatPrice(current)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">MA 50</span>
              <span className={cn('font-bold tabular-nums', current > ma50 ? 'text-emerald-600' : 'text-red-600')}>
                {formatPrice(ma50)} {current > ma50 ? '▲' : '▼'}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">MA 200</span>
              <span className={cn('font-bold tabular-nums', current > ma200 ? 'text-emerald-600' : 'text-red-600')}>
                {formatPrice(ma200)} {current > ma200 ? '▲' : '▼'}
              </span>
            </div>
            <Separator className="my-2" />
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">الاتجاه</span>
              <span className={cn('font-bold', trendColor)}>{trend}</span>
            </div>
          </CardContent>
        </Card>

        {/* Support / Resistance */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="w-4 h-4" />
              الدعم والمقاومة
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-red-600">المقاومة</span>
              <span className="font-bold tabular-nums text-red-600">{formatPrice(tech.resistance)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">السعر الحالي</span>
              <span className="font-bold tabular-nums">{formatPrice(current)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-emerald-600">الدعم</span>
              <span className="font-bold tabular-nums text-emerald-600">{formatPrice(tech.support)}</span>
            </div>
            <Separator className="my-2" />
            {tech.resistance && tech.support && current > 0 && (
              <div className="text-xs text-muted-foreground">
                المدى: {formatPct(((tech.resistance - tech.support) / tech.support) * 100)} من الدعم للمقاومة
              </div>
            )}
          </CardContent>
        </Card>

        {/* 52-Week Range */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Gauge className="w-4 h-4" />
              مدى 52 أسبوع
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm">أعلى 52 أسبوع</span>
              <span className="font-bold tabular-nums text-emerald-600">{formatPrice(tech.high_52w)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm">أدنى 52 أسبوع</span>
              <span className="font-bold tabular-nums text-red-600">{formatPrice(tech.low_52w)}</span>
            </div>
            {tech.high_52w && tech.low_52w && current > 0 && (
              <>
                <div className="relative h-2 bg-gradient-to-r from-red-500 via-amber-500 to-emerald-500 rounded-full mt-2">
                  <div
                    className="absolute top-0 -mt-1 w-1 h-4 bg-foreground rounded"
                    style={{
                      left: `${Math.min(100, Math.max(0, ((current - tech.low_52w) / (tech.high_52w - tech.low_52w)) * 100))}%`,
                    }}
                  />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  السعر عند {formatPct(((current - tech.low_52w) / (tech.high_52w - tech.low_52w)) * 100, 0)} من المدى
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Price + MA Chart */}
      {priceHistory && priceHistory.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">السعر مع المتوسطات (آخر 90 يوم)</CardTitle>
          </CardHeader>
          <CardContent>
            <PriceWithMAChart history={priceHistory} ma50={ma50} ma200={ma200} support={tech.support} resistance={tech.resistance} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Fundamental Tab
// ============================================================================

function FundamentalTab({ metrics, basic }: { metrics: Record<string, unknown> | null | undefined; basic: Record<string, unknown> | null | undefined }) {
  const items = [
    { label: 'القيمة السوقية', value: formatMarketCap(metrics.market_cap), icon: DollarSign },
    { label: 'P/E (السعر/الربح)', value: metrics.pe_ratio ? metrics.pe_ratio.toFixed(1) : '—', icon: BarChart3 },
    { label: 'P/B (السعر/القيمة الدفترية)', value: metrics.pb_ratio ? metrics.pb_ratio.toFixed(2) : '—', icon: BarChart3 },
    { label: 'P/S (السعر/المبيعات)', value: metrics.ps_ratio ? metrics.ps_ratio.toFixed(2) : '—', icon: BarChart3 },
    { label: 'EPS (ربحية السهم)', value: metrics.eps ? metrics.eps.toFixed(2) : '—', icon: DollarSign },
    { label: 'ROE (العائد على حقوق الملكية)', value: metrics.roe ? `${metrics.roe.toFixed(1)}%` : '—', icon: TrendingUp },
    { label: 'ROA (العائد على الأصول)', value: metrics.roa ? `${metrics.roa.toFixed(1)}%` : '—', icon: TrendingUp },
    { label: 'هامش الربح', value: metrics.profit_margin ? `${metrics.profit_margin.toFixed(1)}%` : '—', icon: PieChart },
    { label: 'توزيعات الأرباح', value: metrics.dividend_yield ? `${metrics.dividend_yield.toFixed(2)}%` : '—', icon: DollarSign },
    { label: 'دين/حقوق ملكية', value: metrics.debt_to_equity ? metrics.debt_to_equity.toFixed(2) : '—', icon: Shield },
    { label: 'السيولة (Current Ratio)', value: metrics.current_ratio ? metrics.current_ratio.toFixed(2) : '—', icon: Activity },
    { label: 'القيمة الدفترية/السهم', value: metrics.book_value_per_share ? metrics.book_value_per_share.toFixed(2) : '—', icon: DollarSign },
    { label: 'Beta', value: metrics.beta ? metrics.beta.toFixed(2) : '—', icon: Activity },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            المؤشرات المالية
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {items.map((item, i) => (
              <div key={i} className="flex items-center gap-3 p-2 rounded-lg bg-muted/30">
                <item.icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] text-muted-foreground truncate">{item.label}</div>
                  <div className="text-sm font-bold tabular-nums">{item.value}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Valuation Assessment */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">تقييم التقييم</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {metrics.pe_ratio && (
            <ValuationRow
              label="P/E"
              value={metrics.pe_ratio}
              low={15}
              high={30}
              lowLabel="رخيص"
              highLabel="غالي"
            />
          )}
          {metrics.pb_ratio && (
            <ValuationRow
              label="P/B"
              value={metrics.pb_ratio}
              low={1.5}
              high={3}
              lowLabel="رخيص"
              highLabel="غالي"
            />
          )}
          {metrics.roe && (
            <ValuationRow
              label="ROE"
              value={metrics.roe}
              low={15}
              high={25}
              lowLabel="ضعيف"
              highLabel="ممتاز"
              reverse
            />
          )}
          {metrics.debt_to_equity && (
            <ValuationRow
              label="دين/حقوق ملكية"
              value={metrics.debt_to_equity}
              low={1}
              high={2}
              lowLabel="آمن"
              highLabel="مخاطر"
              reverse
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ValuationRow({ label, value, low, high, lowLabel, highLabel, reverse }: {
  label: string; value: number; low: number; high: number;
  lowLabel: string; highLabel: string; reverse?: boolean;
}) {
  const isGood = reverse ? value >= low : value <= low;
  const isBad = reverse ? value >= high : value >= high;
  const color = isGood ? 'text-emerald-600' : isBad ? 'text-red-600' : 'text-amber-600';
  const status = isGood ? lowLabel : isBad ? highLabel : 'عادل';

  return (
    <div className="flex items-center justify-between">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2">
        <span className={cn('font-bold tabular-nums', color)}>{value.toFixed(1)}</span>
        <Badge variant="outline" className={cn('text-xs', color)}>{status}</Badge>
      </div>
    </div>
  );
}

// ============================================================================
// Maestro Tab
// ============================================================================

function MaestroTab({ maestro, hunter, board }: { maestro: Record<string, unknown> | null | undefined; hunter: Record<string, unknown> | null | undefined; board: Record<string, unknown> | null | undefined }) {
  const m = maestro?.maestroAnalysis || maestro || {};

  return (
    <div className="space-y-4">
      {/* Maestro Score + Recommendation */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="w-4 h-4" />
            تحليل المايسترو
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-2">
          {m.maestroScore !== undefined ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Score Gauge */}
              <div className="flex flex-col items-center justify-center">
                <ScoreGauge score={m.maestroScore} label="الدرجة" size={120} />
                <Badge className={cn('mt-2', signalBadge(m.recommendation || '').className)}>
                  {m.recommendationAr || signalBadge(m.recommendation || '').label}
                </Badge>
              </div>

              {/* Details */}
              <div className="md:col-span-2 space-y-2">
                {m.confidence !== undefined && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">الثقة</span>
                    <div className="flex items-center gap-2">
                      <Progress value={m.confidence} className="w-24 h-2" />
                      <span className="font-bold text-sm">{Math.round(m.confidence)}%</span>
                    </div>
                  </div>
                )}
                {m.entry?.price && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">سعر الدخول</span>
                    <span className="font-bold tabular-nums">{formatPrice(m.entry.price)}</span>
                  </div>
                )}
                {m.target && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">الهدف</span>
                    <span className="font-bold tabular-nums text-emerald-600">{formatPrice(m.target)}</span>
                  </div>
                )}
                {m.stopLoss && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">وقف الخسارة</span>
                    <span className="font-bold tabular-nums text-red-600">{formatPrice(m.stopLoss)}</span>
                  </div>
                )}
                {m.riskReward && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm">R/R</span>
                    <span className={cn('font-bold', m.riskReward >= 1.5 ? 'text-emerald-600' : m.riskReward >= 1 ? 'text-amber-600' : 'text-red-600')}>
                      {Number(m.riskReward).toFixed(2)}:1
                    </span>
                  </div>
                )}
                {m.entry?.strategyAr && (
                  <div className="pt-2 border-t">
                    <span className="text-xs text-muted-foreground">استراتيجية الدخول:</span>
                    <p className="text-sm mt-1">{m.entry.strategyAr}</p>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4">المايسترو غير متاح لهذا السهم</p>
          )}

          {/* Warnings */}
          {m.warningsAr && m.warningsAr.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <h4 className="text-xs font-semibold mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                تنبيهات
              </h4>
              <ul className="space-y-1">
                {m.warningsAr.map((w: string, i: number) => (
                  <li key={i} className="text-xs text-muted-foreground">• {w}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Phases */}
      {m.phases && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">مراحل التحليل (Phases)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {m.phases.regime && (
                <PhaseCard title="النظام" phase={m.phases.regime} />
              )}
              {m.phases.timeframe && (
                <PhaseCard title="الإطار الزمني" phase={m.phases.timeframe} />
              )}
              {m.phases.volume && (
                <PhaseCard title="السيولة" phase={m.phases.volume} />
              )}
              {m.phases.news && (
                <PhaseCard title="الأخبار" phase={m.phases.news} />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Board Opinions */}
      {board?.available && board.opinions && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Award className="w-4 h-4" />
              آراء المحللين
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {Object.entries(board.opinions).map(([analyst, opinion]: [string, any]) => (
                <div key={analyst} className="flex items-start justify-between p-2 rounded-lg bg-muted/30">
                  <div>
                    <span className="text-xs font-semibold">{analyst}</span>
                    {opinion.reason && (
                      <p className="text-xs text-muted-foreground mt-0.5">{opinion.reason}</p>
                    )}
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {opinion.signal || opinion.recommendation || '—'}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PhaseCard({ title, phase }: { title: string; phase: Record<string, unknown> | null | undefined }) {
  const score = phase?.score || 0;
  return (
    <div className="p-3 rounded-lg bg-muted/30">
      <div className="text-xs text-muted-foreground mb-1">{title}</div>
      <div className={cn('text-lg font-bold', scoreColor(score))}>{Math.round(score)}</div>
      {phase?.phase && (
        <div className="text-[10px] text-muted-foreground mt-0.5">{phase.phase}</div>
      )}
    </div>
  );
}

// ============================================================================
// Charts Tab
// ============================================================================

function ChartsTab({ priceHistory, tech }: { priceHistory: Array<Record<string, unknown>>; tech: Record<string, unknown> | null | undefined }) {
  if (!priceHistory || priceHistory.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          لا توجد بيانات تاريخية متاحة للرسم
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Price Chart with S/R */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">السعر مع الدعم والمقاومة</CardTitle>
        </CardHeader>
        <CardContent>
          <PriceWithMAChart
            history={priceHistory}
            ma50={tech.ma_50}
            ma200={tech.ma_200}
            support={tech.support}
            resistance={tech.resistance}
          />
        </CardContent>
      </Card>

      {/* Volume Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">أحجام التداول</CardTitle>
        </CardHeader>
        <CardContent>
          <VolumeChart history={priceHistory} />
        </CardContent>
      </Card>
    </div>
  );
}

function PriceWithMAChart({ history, ma50, ma200, support, resistance }: {
  history: Array<Record<string, unknown>>; ma50: number; ma200: number; support: number; resistance: number;
}) {
  const data = history.map((h) => ({
    date: shortDate(h.date || h.price_date || ''),
    close: Number(h.close || h.close_price || 0),
    volume: Number(h.volume || 0),
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data}>
        <defs>
          <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
          labelStyle={{ fontSize: 10 }}
        />
        <Area
          type="monotone"
          dataKey="close"
          stroke="#3b82f6"
          strokeWidth={2}
          fill="url(#priceGradient)"
          name="السعر"
        />
        {ma50 > 0 && (
          <Line
            type="monotone"
            dataKey={() => ma50}
            stroke="#f59e0b"
            strokeWidth={1}
            strokeDasharray="5 5"
            name="MA50"
            dot={false}
          />
        )}
        {ma200 > 0 && (
          <Line
            type="monotone"
            dataKey={() => ma200}
            stroke="#ef4444"
            strokeWidth={1}
            strokeDasharray="5 5"
            name="MA200"
            dot={false}
          />
        )}
        {support > 0 && (
          <ReferenceLine y={support} stroke="#10b981" strokeDasharray="3 3" label={{ value: `دعم: ${support.toFixed(2)}`, fontSize: 10, fill: '#10b981' }} />
        )}
        {resistance > 0 && (
          <ReferenceLine y={resistance} stroke="#ef4444" strokeDasharray="3 3" label={{ value: `مقاومة: ${resistance.toFixed(2)}`, fontSize: 10, fill: '#ef4444' }} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function VolumeChart({ history }: { history: Array<Record<string, unknown>> }) {
  const data = history.map((h) => ({
    date: shortDate(h.date || h.price_date || ''),
    volume: Number(h.volume || 0),
  }));

  return (
    <ResponsiveContainer width="100%" height={150}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-gray-700" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => formatVolume(v)} />
        <Tooltip
          contentStyle={{ fontSize: 12, borderRadius: 8 }}
          formatter={(v: unknown) => [formatVolume(Number(v)), 'الحجم']}
        />
        <Bar dataKey="volume" fill="#6366f1" name="الحجم" />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ============================================================================
// News Tab
// ============================================================================

function NewsTab({ news }: { news: Array<Record<string, unknown>> }) {
  if (!news || news.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          لا توجد أخبار متاحة لهذا السهم
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {news.map((item, i) => (
        <Card key={i}>
          <CardContent className="p-3">
            <div className="flex items-start gap-3">
              <Newspaper className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-semibold mb-1">{item.title || item.title_ar || 'بدون عنوان'}</h4>
                {item.summary && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{item.summary}</p>
                )}
                <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground">
                  {item.source && <Badge variant="outline" className="text-[10px]">{item.source}</Badge>}
                  {item.timestamp && <span>{shortDate(item.timestamp)}</span>}
                  {item.sentiment && (
                    <Badge variant="outline" className={cn(
                      'text-[10px]',
                      item.sentiment === 'positive' ? 'text-emerald-600' :
                      item.sentiment === 'negative' ? 'text-red-600' : ''
                    )}>
                      {item.sentiment === 'positive' ? 'إيجابي' : item.sentiment === 'negative' ? 'سلبي' : 'محايد'}
                    </Badge>
                  )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ============================================================================
// Predictions Tab
// ============================================================================

function PredictionsTab({ predictions }: { predictions: Array<Record<string, unknown>> }) {
  if (!predictions || predictions.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          لا توجد توقعات سابقة لهذا السهم
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Target className="w-4 h-4" />
          التوقعات السابقة ({predictions.length})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="max-h-96">
          <div className="space-y-2">
            {predictions.map((pred, i) => {
              const outcome = pred.outcome || pred.status || 'PENDING';
              const return_ = pred.actual_return || pred.profit_loss_percent;
              return (
                <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-muted/30">
                  <div className="flex items-center gap-3">
                    <Badge className={signalBadge(pred.signal || pred.signal_type || '').className}>
                      {pred.signal || pred.signal_type || '—'}
                    </Badge>
                    <div>
                      <div className="text-xs font-semibold">
                        {shortDate(pred.prediction_date || pred.created_at || '')}
                      </div>
                      {pred.entry_price && (
                        <div className="text-[10px] text-muted-foreground">
                          دخول: {formatPrice(pred.entry_price)}
                          {pred.target_price && ` → هدف: ${formatPrice(pred.target_price)}`}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="text-left">
                    <Badge variant="outline" className={cn(
                      'text-xs',
                      outcome === 'TARGET_HIT' ? 'text-emerald-600' :
                      outcome === 'STOPPED' ? 'text-red-600' :
                      outcome === 'EXPIRED' ? 'text-amber-600' : ''
                    )}>
                      {outcome === 'TARGET_HIT' ? '🎯 تحقق' :
                       outcome === 'STOPPED' ? '🛑 وقف' :
                       outcome === 'EXPIRED' ? '⚠️ انتهى' : '⏳ معلق'}
                    </Badge>
                    {return_ !== null && return_ !== undefined && (
                      <div className={cn('text-xs font-bold mt-1', changeColor(Number(return_)))}>
                        {formatPct(Number(return_))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// AI Tab
// ============================================================================

function AITab({ professional, ticker }: { professional: Record<string, unknown> | null | undefined; ticker: string }) {
  if (!professional) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-muted-foreground">
          التحليل الاحترافي بالـ AI غير متاح لهذا السهم
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Brain className="w-4 h-4" />
            التحليل الاحترافي بالـ AI
          </CardTitle>
        </CardHeader>
        <CardContent>
          {typeof professional === 'string' ? (
            <p className="text-sm whitespace-pre-wrap">{professional}</p>
          ) : (
            <div className="space-y-3">
              {professional.recommendation && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">التوقع:</span>
                  <Badge className={signalBadge(professional.recommendation).className}>
                    {professional.recommendation_ar || professional.recommendation}
                  </Badge>
                </div>
              )}
              {professional.analysis && (
                <div>
                  <span className="text-xs text-muted-foreground">التحليل:</span>
                  <p className="text-sm mt-1 whitespace-pre-wrap">{professional.analysis}</p>
                </div>
              )}
              {professional.summary && (
                <div>
                  <span className="text-xs text-muted-foreground">الملخص:</span>
                  <p className="text-sm mt-1">{professional.summary}</p>
                </div>
              )}
              {professional.target_price && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">الهدف:</span>
                  <span className="font-bold">{formatPrice(professional.target_price)}</span>
                </div>
              )}
              {professional.risks && (
                <div>
                  <span className="text-xs text-muted-foreground">المخاطر:</span>
                  <p className="text-sm mt-1 text-red-600">{professional.risks}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Loading Skeleton
// ============================================================================

function LoadingSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}
