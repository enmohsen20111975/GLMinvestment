'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/lib/store';
import { Header } from '@/components/layout/Header';
import { AiRecommendations } from '@/components/recommendations/AiRecommendations';
import { GoldMarketCompact } from '@/components/recommendations/GoldMarketCompact';
import { SmartTip } from '@/components/smart-tips/SmartTip';
import { DataCoverageBanner } from '@/components/stocks/DataCoverageBanner';
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { BarChart3, TrendingUp, TrendingDown, Minus, ArrowRightLeft, ChevronLeft } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types for batch-analysis top stocks                                */
/* ------------------------------------------------------------------ */
interface TopAnalyzedStock {
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
}

interface BatchAnalysisResponse {
  analyzed: TopAnalyzedStock[];
  without_data: { ticker: string; name_ar: string; sector: string; reason: string }[];
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
function recommendationColor(action: string): string {
  const a = action.toLowerCase();
  if (a === 'strong_buy' || a === 'buy' || a === 'شراء' || a === 'شراء قوي')
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800';
  if (a === 'accumulate' || a === 'تراكم' || a === 'تجميع')
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-200 dark:border-amber-800';
  if (a === 'hold' || a === 'احتفاظ')
    return 'bg-gray-100 text-gray-800 dark:bg-gray-800/40 dark:text-gray-300 border-gray-200 dark:border-gray-700';
  return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-200 dark:border-red-800';
}

function scoreBadgeColor(score: number): string {
  if (score >= 70) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300';
  if (score >= 50) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
  return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
}

function RecIcon({ action }: { action: string }) {
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
/*  Top Stocks Skeleton                                                 */
/* ------------------------------------------------------------------ */
function TopStocksSkeleton() {
  return (
    <Card className="border-border/60">
      <CardHeader className="pb-3">
        <Skeleton className="h-5 w-48" />
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-2">
              <Skeleton className="h-8 w-8 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-2.5 w-full rounded-full" />
              </div>
              <Skeleton className="h-6 w-16 rounded-md" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  Recommendations Skeleton (unchanged)                                */
/* ------------------------------------------------------------------ */
function RecommendationsSkeleton() {
  return (
    <div className="space-y-5 p-4 md:p-6" dir="rtl">
      {/* Market Outlook skeleton */}
      <div className="rounded-xl border p-5">
        <div className="flex items-center gap-2 mb-5">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-5 w-36" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="flex flex-col items-center gap-3">
            <Skeleton className="h-40 w-40 rounded-full" />
            <Skeleton className="h-9 w-28 rounded-full" />
          </div>
          <div className="space-y-4">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-14 w-full rounded-lg" />
            </div>
          </div>
          <div className="space-y-4">
            <Skeleton className="h-20 w-full rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        </div>
      </div>

      {/* Table skeleton */}
      <div className="rounded-xl border p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-5 rounded" />
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
          <div className="flex gap-1.5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-16 rounded-md" />
            ))}
          </div>
        </div>
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-2">
              <Skeleton className="h-4 w-8" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-24 hidden md:block" />
              <Skeleton className="h-4 w-20 hidden lg:block" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-4 w-14" />
              <div className="flex-1 flex gap-2 justify-center">
                <Skeleton className="h-2 w-20 rounded-full" />
                <Skeleton className="h-4 w-8" />
              </div>
              <Skeleton className="h-6 w-16 rounded-lg" />
            </div>
          ))}
        </div>
      </div>

      {/* Bottom cards skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border p-5">
          <Skeleton className="h-5 w-28 mb-4" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-6 flex-1 rounded-md" />
                <Skeleton className="h-6 w-16 rounded-full" />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-xl border p-5">
          <Skeleton className="h-5 w-28 mb-4" />
          <Skeleton className="h-10 w-full rounded-lg mb-4" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>

      {/* Buy now + summary skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border p-5 border-emerald-200 dark:border-emerald-900/50">
          <Skeleton className="h-5 w-36 mb-1" />
          <Skeleton className="h-3 w-48 mb-4" />
          <div className="space-y-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        </div>
        <div className="rounded-xl border p-5">
          <Skeleton className="h-5 w-24 mb-4" />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Top 5 Stocks Section                                               */
/* ------------------------------------------------------------------ */
function TopStocksSection() {
  const { setCurrentView, setSelectedTicker, loadStockDetail } = useAppStore();
  const [topStocks, setTopStocks] = useState<TopAnalyzedStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTopStocks = useCallback(async () => {
    try {
      const res = await fetch('/api/stocks/batch-analysis', { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = await res.json() as Record<string, unknown>;
      // API now returns both `report` (backend format) and top-level `analyzed`/`summary` (frontend format)
      const analyzed = Array.isArray(raw.analyzed) ? raw.analyzed as TopAnalyzedStock[]
        : Array.isArray((raw.report as Record<string, unknown>)?.with_data) ? (raw.report as Record<string, unknown>).with_data as TopAnalyzedStock[]
        : [];
      // Sort by composite_score descending and take top 5
      const sorted = [...analyzed].sort((a, b) => (b.composite_score || 0) - (a.composite_score || 0)).slice(0, 5);
      setTopStocks(sorted);
      setError(null);
    } catch (err) {
      console.error('[TopStocksSection] Failed to fetch:', err);
      setError('فشل في تحميل بيانات التحليل');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTopStocks();
  }, [fetchTopStocks]);

  const handleStockClick = (ticker: string) => {
    setSelectedTicker(ticker);
    loadStockDetail(ticker);
  };

  if (error && !loading) return null;

  return (
    <section className="space-y-3" dir="rtl">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary" />
          تحليل شامل لجميع الأسهم — أفضل 5
        </h3>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1 text-muted-foreground"
          onClick={() => setCurrentView('analysis')}
        >
          عرض الكل
          <ChevronLeft className="w-3 h-3" />
        </Button>
      </div>

      {loading ? (
        <TopStocksSkeleton />
      ) : topStocks.length === 0 ? (
        <Card className="border-border/60">
          <CardContent className="p-6 text-center text-muted-foreground text-sm">
            لا توجد بيانات تحليل متاحة حالياً
          </CardContent>
        </Card>
      ) : (
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              أفضل 5 أسهم من حيث التقييم الشامل
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {topStocks.map((stock, idx) => (
                <div
                  key={stock.ticker}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group"
                  onClick={() => handleStockClick(stock.ticker)}
                >
                  {/* Rank badge */}
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                    idx === 0 ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300' :
                    idx === 1 ? 'bg-gray-100 text-gray-700 dark:bg-gray-800/40 dark:text-gray-300' :
                    idx === 2 ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' :
                    'bg-muted text-muted-foreground'
                  }`}>
                    {idx + 1}
                  </div>

                  {/* Stock info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm text-foreground">{stock.ticker}</span>
                      <span className="text-xs text-muted-foreground truncate">{stock.name_ar}</span>
                    </div>
                    <Progress value={stock.composite_score} className="h-1.5 mt-1.5 [&>div]:bg-primary" />
                  </div>

                  {/* Score + Recommendation */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge className={`text-xs font-bold ${scoreBadgeColor(stock.composite_score || 0)}`}>
                      {(stock.composite_score ?? 0).toFixed(0)}%
                    </Badge>
                    <Badge className={`text-[10px] border ${recommendationColor(typeof stock.recommendation === 'string' ? stock.recommendation : stock.recommendation?.action || 'hold')}`}>
                      <RecIcon action={typeof stock.recommendation === 'string' ? stock.recommendation : stock.recommendation?.action || 'hold'} />
                      {typeof stock.recommendation === 'string' ? stock.recommendation : stock.recommendation?.action_ar || 'احتفاظ'}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Recommendations View                                          */
/* ------------------------------------------------------------------ */
export function RecommendationsView() {
  const { isLoading, aiInsights, loadAiInsights, v2Data, v2Loading, v2Error, loadV2Recommendations } = useAppStore();

  useEffect(() => {
    if (!aiInsights) {
      loadAiInsights();
    }
    if (!v2Data && !v2Error) {
      loadV2Recommendations();
    }
  }, [aiInsights, loadAiInsights, v2Data, v2Error, loadV2Recommendations]);

  const isAnyLoading = isLoading || v2Loading;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header
        title="التحليلات"
        subtitle="تحليل ذكي شامل لسوق الأوراق المالية المصرية"
      />

      <main className="flex-1">
        {isAnyLoading && !aiInsights && !v2Data ? (
          <RecommendationsSkeleton />
        ) : (
          <div className="p-4 md:p-6 space-y-4">
            {/* Data Coverage Banner */}
            <DataCoverageBanner />

            {/* Smart Tip */}
            <SmartTip trigger="recommendation_view" category="analysis" />

            {/* Top 5 Analyzed Stocks Section */}
            <TopStocksSection />

            <AiRecommendations />
          </div>
        )}

        {/* Gold & Silver Market Overview — always visible, independent loading */}
        <div className="px-4 md:px-6 pb-6">
          <section aria-label="أسعار الذهب والفضة">
            <GoldMarketCompact />
          </section>
        </div>
      </main>
    </div>
  );
}
