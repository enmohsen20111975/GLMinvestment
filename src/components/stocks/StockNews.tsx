'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  Newspaper,
  ExternalLink,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  Clock,
  Globe,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn, safeToFixed } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// ==================== TYPES ====================

interface NewsArticle {
  title: string;
  title_ar: string;
  source: string;
  url: string;
  published_at: string;
  summary: string;
  summary_ar: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentiment_score: number;
  relevance_score: number;
  categories: string[];
}

interface OverallSentiment {
  score: number;
  label: 'positive' | 'negative' | 'neutral';
  label_ar: string;
  confidence: number;
}

// ==================== HELPERS ====================

function getRelativeTime(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'الآن';
  if (diffMins < 60) return `منذ ${diffMins} دقيقة`;
  if (diffHours < 24) return `منذ ${diffHours} ساعة`;
  if (diffDays === 1) return 'أمس';
  if (diffDays < 7) return `منذ ${diffDays} يوم`;
  if (diffDays < 30) return `منذ ${Math.floor(diffDays / 7)} أسبوع`;
  if (diffDays < 365) return `منذ ${Math.floor(diffDays / 30)} شهر`;
  return `منذ ${Math.floor(diffDays / 365)} سنة`;
}

function getSentimentColor(sentiment: string): string {
  switch (sentiment) {
    case 'positive':
      return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400';
    case 'negative':
      return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400';
    default:
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400';
  }
}

function getSentimentBadgeVariant(sentiment: string): 'default' | 'destructive' | 'secondary' | 'outline' {
  switch (sentiment) {
    case 'positive':
      return 'default';
    case 'negative':
      return 'destructive';
    default:
      return 'secondary';
  }
}

function getSentimentIcon(sentiment: string) {
  switch (sentiment) {
    case 'positive':
      return <TrendingUp className="w-3 h-3" />;
    case 'negative':
      return <TrendingDown className="w-3 h-3" />;
    default:
      return <Minus className="w-3 h-3" />;
  }
}

function getSentimentLabelAr(sentiment: string): string {
  switch (sentiment) {
    case 'positive':
      return 'إيجابي';
    case 'negative':
      return 'سلبي';
    default:
      return 'محايد';
  }
}

function getCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    earnings: 'أرباح',
    technical: 'فني',
    sector: 'قطاع',
    regulatory: 'تنظيمي',
    dividend: 'توزيعات',
    ipo: 'طرح',
    indices: 'مؤشرات',
    economy: 'اقتصاد',
    partnership: 'شراكات',
    general: 'عام',
  };
  return labels[category] || category;
}

// ==================== SKELETON ====================

function NewsSkeleton() {
  return (
    <div className="space-y-4" dir="rtl">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-5 w-5 rounded" />
          <Skeleton className="h-6 w-28" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>
      {/* Sentiment bar skeleton */}
      <div className="flex items-center gap-4">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-3 flex-1 rounded-full" />
        <Skeleton className="h-5 w-16" />
      </div>
      {/* Distribution skeleton */}
      <div className="flex gap-2">
        <Skeleton className="h-3 w-full rounded-full" />
      </div>
      <Separator />
      {/* News cards skeleton */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl border p-4 space-y-3">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-3/4" />
          <div className="flex gap-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-5 w-14" />
            <Skeleton className="h-5 w-14" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ==================== SENTIMENT BAR ====================

function SentimentBar({ score }: { score: number }) {
  // score ranges from -1 to 1
  const percentage = ((score + 1) / 2) * 100;
  const clampedPercentage = Math.max(0, Math.min(100, percentage));

  const barColor = score > 0.2
    ? 'bg-emerald-500'
    : score < -0.2
      ? 'bg-red-500'
      : 'bg-amber-500';

  return (
    <div className="flex-1">
      <div className="h-2.5 w-full rounded-full bg-muted overflow-hidden" dir="ltr">
        <div
          className={cn('h-full rounded-full transition-all duration-500', barColor)}
          style={{ width: `${clampedPercentage}%` }}
        />
      </div>
      <div className="flex justify-between mt-1" dir="ltr">
        <span className="text-[10px] text-red-500 font-medium">-1</span>
        <span className="text-[10px] text-muted-foreground">0</span>
        <span className="text-[10px] text-emerald-500 font-medium">+1</span>
      </div>
    </div>
  );
}

// ==================== SENTIMENT DISTRIBUTION ====================

function SentimentDistribution({ news }: { news: NewsArticle[] }) {
  const counts = useMemo(() => {
    const positive = news.filter((n) => n.sentiment === 'positive').length;
    const negative = news.filter((n) => n.sentiment === 'negative').length;
    const neutral = news.filter((n) => n.sentiment === 'neutral').length;
    return { positive, negative, neutral, total: news.length };
  }, [news]);

  if (counts.total === 0) return null;

  const posPct = (counts.positive / counts.total) * 100;
  const neuPct = (counts.neutral / counts.total) * 100;
  const negPct = (counts.negative / counts.total) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">توزيع المشاعر</span>
      </div>
      <div className="flex gap-1 h-2.5 rounded-full overflow-hidden" dir="ltr">
        {counts.positive > 0 && (
          <div
            className="bg-emerald-500 transition-all duration-500"
            style={{ width: `${posPct}%` }}
          />
        )}
        {counts.neutral > 0 && (
          <div
            className="bg-amber-500 transition-all duration-500"
            style={{ width: `${neuPct}%` }}
          />
        )}
        {counts.negative > 0 && (
          <div
            className="bg-red-500 transition-all duration-500"
            style={{ width: `${negPct}%` }}
          />
        )}
      </div>
      <div className="flex justify-between text-[11px] gap-4" dir="rtl">
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <span className="text-muted-foreground">إيجابي</span>
          <span className="font-semibold">{counts.positive}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="text-muted-foreground">محايد</span>
          <span className="font-semibold">{counts.neutral}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-muted-foreground">سلبي</span>
          <span className="font-semibold">{counts.negative}</span>
        </div>
      </div>
    </div>
  );
}

// ==================== NEWS CARD ====================

function NewsCard({ article }: { article: NewsArticle }) {
  const relevancePercent = Math.round(article.relevance_score * 100);

  return (
    <Card className="group hover:shadow-md transition-shadow duration-200 border-border/60">
      <CardContent className="p-4 space-y-3">
        {/* Title */}
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <h3 className="text-sm font-bold leading-relaxed group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors line-clamp-2">
            {article.title_ar || article.title}
          </h3>
        </a>

        {/* Source & Date Row */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Globe className="w-3 h-3" />
            {article.source}
          </span>
          {article.url && (
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
            >
              <ExternalLink className="w-3 h-3 inline" />
            </a>
          )}
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="w-3 h-3" />
            {article.published_at ? getRelativeTime(article.published_at) : ''}
          </span>
        </div>

        {/* Summary */}
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
          {article.summary_ar || article.summary}
        </p>

        {/* Badges Row */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Sentiment Badge */}
          <Badge
            variant={getSentimentBadgeVariant(article.sentiment)}
            className={cn(
              'text-[11px] gap-1 px-2 py-0 border-0',
              getSentimentColor(article.sentiment)
            )}
          >
            {getSentimentIcon(article.sentiment)}
            {getSentimentLabelAr(article.sentiment)}
            {article.sentiment_score !== undefined && (
              <span className="opacity-70 mr-0.5" dir="ltr">
                ({article.sentiment_score > 0 ? '+' : ''}{safeToFixed(article.sentiment_score)})
              </span>
            )}
          </Badge>

          {/* Relevance Badge */}
          <Badge
            variant="outline"
            className={cn(
              'text-[11px] gap-1 px-2 py-0',
              relevancePercent >= 70
                ? 'border-emerald-300 text-emerald-600 dark:border-emerald-700 dark:text-emerald-400'
                : relevancePercent >= 40
                  ? 'border-amber-300 text-amber-600 dark:border-amber-700 dark:text-amber-400'
                  : 'border-muted-foreground/30 text-muted-foreground'
            )}
          >
            صلة: {relevancePercent}%
          </Badge>

          {/* Category Badges */}
          {(article.categories || []).slice(0, 3).map((cat) => (
            <Badge
              key={cat}
              variant="secondary"
              className="text-[11px] px-2 py-0"
            >
              {getCategoryLabel(cat)}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== EMPTY STATE ====================

function EmptyState({ hasFetched }: { hasFetched: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 space-y-4 text-center">
      <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
        <Newspaper className="w-8 h-8 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">
          {hasFetched ? 'لا توجد أخبار متاحة حالياً' : 'اضغط لتحميل الأخبار'}
        </h3>
        <p className="text-xs text-muted-foreground max-w-xs">
          {hasFetched
            ? 'لا توجد نتائج حالياً. يمكنك المحاولة مرة أخرى لاحقاً أو التحقق من مصادر الأخبار الأخرى.'
            : 'اضغط على زر تحميل الأخبار لعرض آخر الأخبار المتعلقة بهذا السهم.'}
        </p>
      </div>
    </div>
  );
}

// ==================== MAIN COMPONENT ====================

export function StockNews() {
  const { selectedTicker, stockNews, stockNewsLoading, loadStockNews } = useAppStore();
  const [activeTab, setActiveTab] = useState('all');

  const news = useMemo((): NewsArticle[] => {
    if (!stockNews) return [];
    return (stockNews.news as NewsArticle[]) || [];
  }, [stockNews]);

  const overallSentiment = useMemo((): OverallSentiment | null => {
    if (!stockNews) return null;
    return (stockNews.overall_sentiment as OverallSentiment) || null;
  }, [stockNews]);

  const totalNews = useMemo((): number => {
    if (!stockNews) return 0;
    return (stockNews.total_news as number) || 0;
  }, [stockNews]);

  const hasFetched = stockNews !== null || stockNewsLoading === false;

  const filteredNews = useMemo(() => {
    if (activeTab === 'all') return news;
    return news.filter((n) => n.sentiment === activeTab);
  }, [news, activeTab]);

  const handleFetchNews = useCallback(() => {
    if (selectedTicker) {
      loadStockNews(selectedTicker);
    }
  }, [selectedTicker, loadStockNews]);

  // Loading state
  if (stockNewsLoading) {
    return (
      <Card dir="rtl">
        <CardContent className="pt-6">
          <NewsSkeleton />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card dir="rtl">
      <CardContent className="pt-6">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Newspaper className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-lg font-bold">أخبار السهم</h2>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleFetchNews}
              disabled={stockNewsLoading || !selectedTicker}
              className="gap-2 text-xs"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', stockNewsLoading && 'animate-spin')} />
              تحميل الأخبار
            </Button>
          </div>

          {/* Overall Sentiment & Stats */}
          {overallSentiment && news.length > 0 && (
            <div className="space-y-3 rounded-xl bg-muted/50 p-4">
              <div className="flex items-center gap-3 flex-wrap">
                <Badge
                  className={cn(
                    'gap-1 border-0 px-2.5',
                    getSentimentColor(overallSentiment.label)
                  )}
                >
                  {getSentimentIcon(overallSentiment.label)}
                  {overallSentiment.label_ar || getSentimentLabelAr(overallSentiment.label)}
                </Badge>
                <div className="flex-1 min-w-[120px]">
                  <SentimentBar score={overallSentiment.score} />
                </div>
                <span className="text-xs text-muted-foreground">
                  {totalNews} خبر
                </span>
                {overallSentiment.confidence > 0 && (
                  <span className="text-[11px] text-muted-foreground" dir="ltr">
                    ثقة: {safeToFixed(overallSentiment.confidence * 100, 0)}%
                  </span>
                )}
              </div>
              <SentimentDistribution news={news} />
            </div>
          )}

          <Separator />

          {/* No news - empty state */}
          {news.length === 0 ? (
            <EmptyState hasFetched={hasFetched && !!stockNews} />
          ) : (
            <>
              {/* Tabs */}
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="all" className="text-xs gap-1">
                    الكل
                    <span className="text-[10px] opacity-60">({news.length})</span>
                  </TabsTrigger>
                  <TabsTrigger value="positive" className="text-xs gap-1 text-emerald-600 dark:text-emerald-400">
                    إيجابي
                    <span className="text-[10px] opacity-60">
                      ({news.filter((n) => n.sentiment === 'positive').length})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="negative" className="text-xs gap-1 text-red-600 dark:text-red-400">
                    سلبي
                    <span className="text-[10px] opacity-60">
                      ({news.filter((n) => n.sentiment === 'negative').length})
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="neutral" className="text-xs gap-1 text-amber-600 dark:text-amber-400">
                    محايد
                    <span className="text-[10px] opacity-60">
                      ({news.filter((n) => n.sentiment === 'neutral').length})
                    </span>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="all" className="mt-4">
                  <div className="space-y-3">
                    {filteredNews.map((article, idx) => (
                      <NewsCard key={article.url || idx} article={article} />
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="positive" className="mt-4">
                  <div className="space-y-3">
                    {filteredNews.length > 0 ? (
                      filteredNews.map((article, idx) => (
                        <NewsCard key={article.url || idx} article={article} />
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        لا توجد أخبار إيجابية
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="negative" className="mt-4">
                  <div className="space-y-3">
                    {filteredNews.length > 0 ? (
                      filteredNews.map((article, idx) => (
                        <NewsCard key={article.url || idx} article={article} />
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        لا توجد أخبار سلبية
                      </p>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="neutral" className="mt-4">
                  <div className="space-y-3">
                    {filteredNews.length > 0 ? (
                      filteredNews.map((article, idx) => (
                        <NewsCard key={article.url || idx} article={article} />
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-6">
                        لا توجد أخبار محايدة
                      </p>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}

          {/* Fetched timestamp */}
          {stockNews && stockNews.fetched_at && (
            <p className="text-[11px] text-muted-foreground text-center pt-2">
              آخر تحديث: {getRelativeTime(stockNews.fetched_at as string)}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
