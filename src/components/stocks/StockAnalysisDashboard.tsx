'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  BarChart3,
  Filter,
  ArrowRightLeft,
  AlertCircle,
  CheckCircle2,
  LayoutGrid,
  LayoutList,
  ArrowUpDown,
  Target,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { Header } from '@/components/layout/Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';

/* ------------------------------------------------------------------ */
/*  Types for /api/stocks/batch-analysis response                      */
/* ------------------------------------------------------------------ */
interface AnalyzedStock {
  ticker: string;
  name_ar: string;
  sector: string;
  current_price: number;
  composite_score: number;
  recommendation: {
    action: string;
    action_ar: string;
    confidence: number;
  };
  data_quality: string;
  technical_score?: number;
  fundamental_score?: number;
  risk_score?: number;
}

interface StockWithoutData {
  ticker: string;
  name_ar: string;
  sector: string;
  reason: string;
}

interface BatchAnalysisResponse {
  analyzed: AnalyzedStock[];
  without_data: StockWithoutData[];
  summary: {
    total_stocks: number;
    analyzed_count: number;
    without_data_count: number;
    average_score: number;
    buy_signals: number;
    sell_signals: number;
    hold_signals: number;
  };
  generated_at: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Color mapping for recommendation actions */
function recommendationColors(action: string): string {
  const a = action.toLowerCase();
  if (a === 'strong_buy' || a === 'buy' || a === 'شراء' || a === 'شراء قوي')
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
  if (a === 'accumulate' || a === 'تراكم' || a === 'تجميع')
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800';
  if (a === 'hold' || a === 'احتفاظ')
    return 'bg-gray-100 text-gray-800 dark:bg-gray-800/40 dark:text-gray-300 border-gray-200 dark:border-gray-700';
  return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800';
}

/** Score badge color */
function scoreBadgeColor(score: number): string {
  if (score >= 70) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
  if (score >= 50) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
  return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
}

/** Data quality badge */
function dataQualityBadge(quality: string) {
  if (quality === 'high' || quality === 'جيدة' || quality === 'عالية')
    return <Badge variant="outline" className="text-emerald-600 border-emerald-300 dark:border-emerald-700 text-[10px]">جودة عالية</Badge>;
  if (quality === 'medium' || quality === 'متوسطة')
    return <Badge variant="outline" className="text-amber-600 border-amber-300 dark:border-amber-700 text-[10px]">جودة متوسطة</Badge>;
  return <Badge variant="outline" className="text-red-600 border-red-300 dark:border-red-700 text-[10px]">جودة منخفضة</Badge>;
}

/** Recommendation icon */
function RecommendationIcon({ action }: { action: string }) {
  const a = action.toLowerCase();
  if (a === 'strong_buy' || a === 'buy' || a === 'شراء' || a === 'شراء قوي')
    return <TrendingUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />;
  if (a === 'accumulate' || a === 'تراكم' || a === 'تجميع')
    return <ArrowRightLeft className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />;
  if (a === 'hold' || a === 'احتفاظ')
    return <Minus className="w-3.5 h-3.5 text-gray-500" />;
  return <TrendingDown className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />;
}

/* ------------------------------------------------------------------ */
/*  Skeleton loading state                                             */
/* ------------------------------------------------------------------ */
function DashboardSkeleton() {
  return (
    <div className="space-y-5 p-4 md:p-6" dir="rtl">
      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-xl" />
        ))}
      </div>
      {/* Tabs skeleton */}
      <div className="flex gap-2 mb-4">
        <Skeleton className="h-9 w-32 rounded-lg" />
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>
      {/* Cards grid skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-36 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Stock Card (with data)                                             */
/* ------------------------------------------------------------------ */
function StockCard({ stock }: { stock: AnalyzedStock }) {
  const { setCurrentView, setSelectedTicker, loadStockDetail } = useAppStore();

  const handleClick = () => {
    setSelectedTicker(stock.ticker);
    loadStockDetail(stock.ticker);
  };

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-shadow border-border/60"
      onClick={handleClick}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header: ticker + sector */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-bold text-sm text-foreground truncate">
              {stock.ticker}
            </h3>
            <p className="text-xs text-muted-foreground truncate">{stock.name_ar}</p>
          </div>
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 flex-shrink-0">
            {stock.sector}
          </Badge>
        </div>

        {/* Price + Score row */}
        <div className="flex items-center justify-between">
          <span className="text-base font-semibold text-foreground">
            {(stock.current_price || 0) > 0 ? (stock.current_price || 0).toFixed(2) : '—'}
            <span className="text-[10px] text-muted-foreground font-normal mr-1">ج.م</span>
          </span>
          <Badge className={`text-xs font-bold ${scoreBadgeColor(stock.composite_score || 0)}`}>
            {(stock.composite_score ?? 0).toFixed(0)}%
          </Badge>
        </div>

        {/* Recommendation */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <RecommendationIcon action={typeof stock.recommendation === 'string' ? stock.recommendation : stock.recommendation?.action || 'hold'} />
            <Badge className={`text-[11px] border ${recommendationColors(typeof stock.recommendation === 'string' ? stock.recommendation : stock.recommendation?.action || 'hold')}`}>
              {typeof stock.recommendation === 'string' ? stock.recommendation : stock.recommendation?.action_ar || 'احتفاظ'}
            </Badge>
          </div>
          {dataQualityBadge(stock.data_quality)}
        </div>

        {/* Score bars */}
        <div className="space-y-1.5">
          {stock.technical_score !== undefined && (
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-muted-foreground w-12">فني</span>
              <Progress value={stock.technical_score} className="h-1.5 flex-1 [&>div]:bg-blue-500" />
              <span className="text-muted-foreground w-6 text-left">{stock.technical_score}</span>
            </div>
          )}
          {stock.fundamental_score !== undefined && (
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-muted-foreground w-12">أساسي</span>
              <Progress value={stock.fundamental_score} className="h-1.5 flex-1 [&>div]:bg-purple-500" />
              <span className="text-muted-foreground w-6 text-left">{stock.fundamental_score}</span>
            </div>
          )}
          {stock.risk_score !== undefined && (
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-muted-foreground w-12">مخاطر</span>
              <Progress value={stock.risk_score} className="h-1.5 flex-1 [&>div]:bg-orange-500" />
              <span className="text-muted-foreground w-6 text-left">{stock.risk_score}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Stock Row (list view)                                               */
/* ------------------------------------------------------------------ */
function StockRow({ stock }: { stock: AnalyzedStock }) {
  const { setCurrentView, setSelectedTicker, loadStockDetail } = useAppStore();
  const handleClick = () => {
    setSelectedTicker(stock.ticker);
    loadStockDetail(stock.ticker);
  };
  const action = typeof stock.recommendation === 'string' ? stock.recommendation : stock.recommendation?.action || 'hold';

  return (
    <tr
      className="border-b border-border/50 hover:bg-muted/30 transition-colors cursor-pointer"
      onClick={handleClick}
    >
      <td className="py-2.5 px-3 font-bold text-sm">{stock.ticker}</td>
      <td className="py-2.5 px-3 text-xs text-muted-foreground hidden sm:table-cell">{stock.name_ar}</td>
      <td className="py-2.5 px-3 text-xs text-muted-foreground hidden md:table-cell">{stock.sector}</td>
      <td className="py-2.5 px-3 font-semibold text-sm">
        {(stock.current_price || 0) > 0 ? (stock.current_price).toFixed(2) : '—'}
        <span className="text-[10px] text-muted-foreground font-normal mr-1">ج.م</span>
      </td>
      <td className="py-2.5 px-3">
        <Badge className={`text-[11px] font-bold ${scoreBadgeColor(stock.composite_score || 0)}`}>
          {(stock.composite_score ?? 0).toFixed(0)}%
        </Badge>
      </td>
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-1.5">
          <RecommendationIcon action={action} />
          <Badge className={`text-[10px] border ${recommendationColors(action)}`}>
            {typeof stock.recommendation === 'string' ? stock.recommendation : stock.recommendation?.action_ar || 'احتفاظ'}
          </Badge>
        </div>
      </td>
      <td className="py-2.5 px-3">
        <div className="flex gap-1.5">
          {stock.technical_score !== undefined && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">
              فني {stock.technical_score}
            </span>
          )}
          {stock.fundamental_score !== undefined && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300">
              أساسي {stock.fundamental_score}
            </span>
          )}
          {stock.risk_score !== undefined && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-50 dark:bg-orange-900/20 text-orange-700 dark:text-orange-300">
              مخاطر {stock.risk_score}
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/*  Without Data Table                                                 */
/* ------------------------------------------------------------------ */
function WithoutDataTable({ stocks }: { stocks: StockWithoutData[] }) {
  return (
    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
      <table className="w-full text-sm" dir="rtl">
        <thead>
          <tr className="border-b border-border sticky top-0 bg-background z-10">
            <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs">الرمز</th>
            <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs hidden sm:table-cell">الاسم</th>
            <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs hidden md:table-cell">القطاع</th>
            <th className="text-right py-2 px-3 font-medium text-muted-foreground text-xs">السبب</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((s) => (
            <tr key={s.ticker} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
              <td className="py-2.5 px-3 font-semibold">{s.ticker}</td>
              <td className="py-2.5 px-3 text-muted-foreground hidden sm:table-cell">{s.name_ar}</td>
              <td className="py-2.5 px-3 text-muted-foreground hidden md:table-cell">{s.sector}</td>
              <td className="py-2.5 px-3">
                <Badge variant="secondary" className="text-[10px]">{s.reason}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Dashboard Component                                           */
/* ------------------------------------------------------------------ */
export function StockAnalysisDashboard() {
  const [data, setData] = useState<BatchAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'cards' | 'list'>('cards');
  const [sortBy, setSortBy] = useState<'score' | 'name' | 'sector' | 'price' | 'risk'>('score');
  const [sortAsc, setSortAsc] = useState(false);

  /* Fetch data */
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/stocks/batch-analysis', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json() as Record<string, unknown>;
      // API now returns both `report` (backend format) and top-level `analyzed`/`summary` (frontend format)
      const analyzed = Array.isArray(raw.analyzed) ? raw.analyzed as AnalyzedStock[]
        : Array.isArray((raw.report as Record<string, unknown>)?.with_data) ? (raw.report as Record<string, unknown>).with_data as AnalyzedStock[]
        : [];
      const withoutData = Array.isArray(raw.without_data) ? raw.without_data as StockWithoutData[]
        : Array.isArray((raw.report as Record<string, unknown>)?.without_data) ? (raw.report as Record<string, unknown>).without_data as StockWithoutData[]
        : [];
      const rawSummary = raw.summary || (raw.report as Record<string, unknown>)?.analysis_summary || {};
      const summary = {
        total_stocks: Number((rawSummary as Record<string, unknown>)?.total_stocks || (rawSummary as Record<string, unknown>)?.no_data !== undefined ? analyzed.length + Number((rawSummary as Record<string, unknown>)?.no_data || 0) : 0),
        analyzed_count: Number((rawSummary as Record<string, unknown>)?.analyzed_count || analyzed.length),
        without_data_count: Number((rawSummary as Record<string, unknown>)?.without_data_count || withoutData.length),
        average_score: Number((rawSummary as Record<string, unknown>)?.average_score || 0),
        buy_signals: Number((rawSummary as Record<string, unknown>)?.buy_signals || 0),
        sell_signals: Number((rawSummary as Record<string, unknown>)?.sell_signals || 0),
        hold_signals: Number((rawSummary as Record<string, unknown>)?.hold_signals || 0),
      } as BatchAnalysisResponse['summary'];
      const json: BatchAnalysisResponse = {
        analyzed,
        without_data: withoutData,
        summary,
        generated_at: String(raw.generated_at || new Date().toISOString()),
      };
      setData(json);
    } catch (err) {
      console.error('[StockAnalysisDashboard] Failed to fetch:', err);
      setError('فشل في تحميل بيانات التحليل الشامل');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  /* Filter stocks based on active filter */
  const filteredStocks = useMemo(() => {
    if (!data) return [];
    const analyzedArr = Array.isArray(data.analyzed) ? data.analyzed : [];
    if (activeFilter === 'all') return analyzedArr;
    const a = activeFilter.toLowerCase();
    return analyzedArr.filter((s) => {
      const action = (typeof s.recommendation === 'string' ? s.recommendation : s.recommendation?.action || 'hold').toLowerCase();
      if (a === 'شراء') return action === 'strong_buy' || action === 'buy' || action === 'شراء' || action === 'شراء قوي';
      if (a === 'تجميع') return action === 'accumulate' || action === 'تراكم' || action === 'تجميع';
      if (a === 'احتفاظ') return action === 'hold' || action === 'احتفاظ';
      if (a === 'بيع') return action === 'strong_sell' || action === 'sell' || action === 'بيع' || action === 'بيع قوي';
      return true;
    });
  }, [data, activeFilter]);

  /* Sort stocks */
  const sortedStocks = useMemo(
    () => {
      const arr = [...filteredStocks];
      const dir = sortAsc ? 1 : -1;
      switch (sortBy) {
        case 'score':
          arr.sort((a, b) => (b.composite_score - a.composite_score) * dir);
          break;
        case 'name':
          arr.sort((a, b) => a.ticker.localeCompare(b.ticker) * dir);
          break;
        case 'sector':
          arr.sort((a, b) => (a.sector || '').localeCompare(b.sector || '') * dir);
          break;
        case 'price':
          arr.sort((a, b) => ((a.current_price || 0) - (b.current_price || 0)) * dir);
          break;
        case 'risk':
          arr.sort((a, b) => ((a.risk_score || 50) - (b.risk_score || 50)) * dir);
          break;
      }
      return arr;
    },
    [filteredStocks, sortBy, sortAsc]
  );

  /* Chance overview: group by confidence ranges */
  const chanceOverview = useMemo(() => {
    if (!data) return [];
    const stocks = Array.isArray(data.analyzed) ? data.analyzed : [];
    const ranges = [
      { label: 'فرصة ممتازة (70%+)', min: 70, max: 100, color: 'bg-emerald-500', textColor: 'text-emerald-700 dark:text-emerald-300', borderColor: 'border-emerald-300 dark:border-emerald-700' },
      { label: 'فرصة جيدة (50-69%)', min: 50, max: 69, color: 'bg-amber-500', textColor: 'text-amber-700 dark:text-amber-300', borderColor: 'border-amber-300 dark:border-amber-700' },
      { label: 'فرصة متوسطة (30-49%)', min: 30, max: 49, color: 'bg-orange-500', textColor: 'text-orange-700 dark:text-orange-300', borderColor: 'border-orange-300 dark:border-orange-700' },
      { label: 'فرصة ضعيفة (<30%)', min: 0, max: 29, color: 'bg-red-500', textColor: 'text-red-700 dark:text-red-300', borderColor: 'border-red-300 dark:border-red-700' },
    ];
    return ranges.map(range => {
      const stocksInRange = stocks.filter(s => {
        const score = s.composite_score || 0;
        return score >= range.min && score <= range.max;
      });
      return {
        ...range,
        count: stocksInRange.length,
        stocks: stocksInRange.sort((a, b) => b.composite_score - a.composite_score),
      };
    }).filter(r => r.count > 0);
  }, [data]);

  /* Filter chips */
  const filterChips = [
    { key: 'all', label: 'الكل' },
    { key: 'شراء', label: 'شراء' },
    { key: 'تجميع', label: 'تجميع' },
    { key: 'احتفاظ', label: 'احتفاظ' },
    { key: 'بيع', label: 'بيع' },
  ];

  /* Sort options */
  const sortOptions = [
    { key: 'score' as const, label: 'التقييم' },
    { key: 'name' as const, label: 'الاسم' },
    { key: 'sector' as const, label: 'القطاع' },
    { key: 'price' as const, label: 'السعر' },
    { key: 'risk' as const, label: 'المخاطر' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header
        title="التحليل الشامل لجميع الأسهم"
        subtitle="تحليل شامل لجميع الأسهم المدرجة في البورصة المصرية"
      />

      <main className="flex-1">
        {loading ? (
          <DashboardSkeleton />
        ) : error || !data ? (
          /* Error state */
          <div className="flex flex-col items-center justify-center py-20 gap-4" dir="rtl">
            <AlertCircle className="w-12 h-12 text-muted-foreground" />
            <p className="text-muted-foreground text-sm">{error || 'لا توجد بيانات متاحة'}</p>
            <Button variant="outline" onClick={fetchData}>
              <RefreshCw className="w-4 h-4 ml-2" />
              إعادة المحاولة
            </Button>
          </div>
        ) : (
          <div className="p-4 md:p-6 space-y-5" dir="rtl">
            {/* Summary Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card className="border-border/60">
                <CardContent className="p-4 flex flex-col items-center gap-1">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  <span className="text-2xl font-bold">{data.summary.analyzed_count}</span>
                  <span className="text-xs text-muted-foreground">تم تحليلها</span>
                </CardContent>
              </Card>
              <Card className="border-border/60">
                <CardContent className="p-4 flex flex-col items-center gap-1">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {(data.summary.average_score ?? 0).toFixed(0)}%
                  </span>
                  <span className="text-xs text-muted-foreground">متوسط التقييم</span>
                </CardContent>
              </Card>
              <Card className="border-border/60">
                <CardContent className="p-4 flex flex-col items-center gap-1">
                  <TrendingUp className="w-5 h-5 text-emerald-500" />
                  <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {data.summary.buy_signals}
                  </span>
                  <span className="text-xs text-muted-foreground">إشارات شراء</span>
                </CardContent>
              </Card>
              <Card className="border-border/60">
                <CardContent className="p-4 flex flex-col items-center gap-1">
                  <TrendingDown className="w-5 h-5 text-red-500" />
                  <span className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {data.summary.sell_signals}
                  </span>
                  <span className="text-xs text-muted-foreground">إشارات بيع</span>
                </CardContent>
              </Card>
            </div>

            {/* Tabs */}
            <Tabs defaultValue="with-data" className="w-full">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                <TabsList>
                  <TabsTrigger value="with-data">
                    أسهم مع بيانات
                    <Badge variant="secondary" className="mr-1.5 text-[10px] px-1.5">
                      {data.analyzed.length}
                    </Badge>
                  </TabsTrigger>
                  <TabsTrigger value="without-data">
                    أسهم بدون بيانات
                    <Badge variant="secondary" className="mr-1.5 text-[10px] px-1.5">
                      {Array.isArray(data.without_data) ? data.without_data.length : 0}
                    </Badge>
                  </TabsTrigger>
                </TabsList>

                <div className="flex items-center gap-2">
                  {/* Sort dropdown */}
                  <div className="flex items-center gap-1.5">
                    <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
                    {sortOptions.map(opt => (
                      <Button
                        key={opt.key}
                        variant={sortBy === opt.key ? 'default' : 'outline'}
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          if (sortBy === opt.key) setSortAsc(!sortAsc);
                          else { setSortBy(opt.key); setSortAsc(opt.key === 'name' || opt.key === 'sector'); }
                        }}
                      >
                        {opt.label}
                        {sortBy === opt.key && (sortAsc ? ' ↑' : ' ↓')}
                      </Button>
                    ))}
                  </div>

                  {/* View toggle */}
                  <div className="flex items-center border border-border rounded-lg overflow-hidden">
                    <button
                      className={`p-1.5 transition-colors ${viewMode === 'cards' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
                      onClick={() => setViewMode('cards')}
                      title="عرض بطاقات"
                    >
                      <LayoutGrid className="w-3.5 h-3.5" />
                    </button>
                    <button
                      className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
                      onClick={() => setViewMode('list')}
                      title="عرض قائمة"
                    >
                      <LayoutList className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <Button variant="outline" size="sm" onClick={fetchData} className="h-8 gap-1.5">
                    <RefreshCw className="w-3.5 h-3.5" />
                    تحديث
                  </Button>
                </div>
              </div>

              {/* Tab 1: Stocks with data */}
              <TabsContent value="with-data">
                {/* Filter chips */}
                <div className="flex items-center gap-2 mb-4 flex-wrap">
                  <Filter className="w-3.5 h-3.5 text-muted-foreground" />
                  {filterChips.map((chip) => (
                    <Button
                      key={chip.key}
                      variant={activeFilter === chip.key ? 'default' : 'outline'}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setActiveFilter(chip.key)}
                    >
                      {chip.label}
                      {chip.key !== 'all' && (
                        <span className="mr-1 text-[10px] opacity-70">
                          ({chip.key === 'all'
                            ? data.analyzed.length
                            : data.analyzed.filter((s) => {
                                const action = (typeof s.recommendation === 'string' ? s.recommendation : s.recommendation?.action || 'hold').toLowerCase();
                                if (chip.key === 'شراء') return action === 'strong_buy' || action === 'buy' || action === 'شراء' || action === 'شراء قوي';
                                if (chip.key === 'تجميع') return action === 'accumulate' || action === 'تراكم' || action === 'تجميع';
                                if (chip.key === 'احتفاظ') return action === 'hold' || action === 'احتفاظ';
                                if (chip.key === 'بيع') return action === 'strong_sell' || action === 'sell' || action === 'بيع' || action === 'بيع قوي';
                                return true;
                              }).length})
                        </span>
                      )}
                    </Button>
                  ))}
                </div>

                {/* View: Cards or List */}
                {sortedStocks.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground text-sm">
                    لا توجد أسهم تطابق التصفية المحددة
                  </div>
                ) : viewMode === 'cards' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {sortedStocks.map((stock) => (
                      <StockCard key={stock.ticker} stock={stock} />
                    ))}
                  </div>
                ) : (
                  <Card className="border-border/60">
                    <CardContent className="p-0">
                      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                        <table className="w-full text-sm" dir="rtl">
                          <thead>
                            <tr className="border-b border-border bg-muted/30 sticky top-0 z-10 bg-background">
                              <th className="text-right py-2.5 px-3 font-medium text-muted-foreground text-xs">الرمز</th>
                              <th className="text-right py-2.5 px-3 font-medium text-muted-foreground text-xs hidden sm:table-cell">الاسم</th>
                              <th className="text-right py-2.5 px-3 font-medium text-muted-foreground text-xs hidden md:table-cell">القطاع</th>
                              <th className="text-right py-2.5 px-3 font-medium text-muted-foreground text-xs">السعر</th>
                              <th className="text-right py-2.5 px-3 font-medium text-muted-foreground text-xs">التقييم</th>
                              <th className="text-right py-2.5 px-3 font-medium text-muted-foreground text-xs">التوصية</th>
                              <th className="text-right py-2.5 px-3 font-medium text-muted-foreground text-xs">النقاط</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedStocks.map((stock) => (
                              <StockRow key={stock.ticker} stock={stock} />
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Tab 2: Stocks without data */}
              <TabsContent value="without-data">
                {!Array.isArray(data.without_data) || data.without_data.length === 0 ? (
                  <div className="text-center py-12">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">
                      جميع الأسهم لديها بيانات كافية للتحليل
                    </p>
                  </div>
                ) : (
                  <Card className="border-border/60">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-500" />
                        أسهم بدون بيانات كافية ({data.without_data.length} سهم)
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <WithoutDataTable stocks={data.without_data} />
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>

            {/* Chance Overview Section */}
            {chanceOverview.length > 0 && (
              <Card className="border-border/60">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Target className="w-4 h-4 text-primary" />
                    نظرة عامة حسب الفرص
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {/* Chance distribution bar */}
                  <div className="flex rounded-full overflow-hidden h-3 mb-4">
                    {chanceOverview.map((range) => {
                      const total = chanceOverview.reduce((s, r) => s + r.count, 0);
                      const pct = total > 0 ? (range.count / total) * 100 : 0;
                      if (pct === 0) return null;
                      return (
                        <div
                          key={range.label}
                          className={`${range.color} transition-all`}
                          style={{ width: `${pct}%` }}
                          title={`${range.label}: ${range.count} أسهم (${pct.toFixed(1)}%)`}
                        />
                      );
                    })}
                  </div>

                  {/* Chance categories */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {chanceOverview.map((range) => (
                      <div
                        key={range.label}
                        className={`rounded-lg border p-3 ${range.borderColor} bg-background`}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-xs font-semibold ${range.textColor}`}>{range.label}</span>
                          <Badge className={`text-xs ${range.color} text-white`}>{range.count}</Badge>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {range.stocks.slice(0, 5).map(s => (
                            <Badge key={s.ticker} variant="outline" className="text-[10px] cursor-pointer hover:bg-muted" onClick={() => {
                              useAppStore.getState().setSelectedTicker(s.ticker);
                              useAppStore.getState().loadStockDetail(s.ticker);
                            }}>
                              {s.ticker} ({(s.composite_score || 0).toFixed(0)}%)
                            </Badge>
                          ))}
                          {range.stocks.length > 5 && (
                            <Badge variant="secondary" className="text-[10px]">
                              +{range.stocks.length - 5} آخر
                            </Badge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Timestamp */}
            {data.generated_at && (
              <p className="text-[10px] text-muted-foreground text-center" dir="ltr">
                تم الإنشاء: {new Date(data.generated_at).toLocaleString('ar-EG')}
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
