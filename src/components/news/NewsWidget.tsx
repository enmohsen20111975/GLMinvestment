'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Card, CardContent, CardHeader, CardTitle, CardDescription
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Newspaper, TrendingUp, TrendingDown, AlertTriangle,
  RefreshCw, ExternalLink, Brain, Bell
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NewsItem {
  title: string;
  link: string;
  pub_date: string;
  source: string;
  sentiment?: 'positive' | 'negative' | 'neutral';
  importance?: string;
}

interface NewsAnalysis {
  market_sentiment: 'bullish' | 'bearish' | 'neutral';
  positive_count: number;
  negative_count: number;
  neutral_count: number;
  alerts: Array<{ type: string; title: string; message: string }>;
  top_stories: NewsItem[];
}

interface NewsWidgetProps {
  compact?: boolean;
  showAnalysis?: boolean;
  maxItems?: number;
}

export function NewsWidget({
  compact = false,
  showAnalysis = true,
  maxItems = 10
}: NewsWidgetProps) {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [important, setImportant] = useState<NewsItem[]>([]);
  const [analysis, setAnalysis] = useState<NewsAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'news' | 'analysis' | 'alerts'>('news');

  const fetchNews = useCallback(async () => {
    setLoading(true);
    try {
      const newsRes = await fetch(`/api/news?action=egx&max=${maxItems}`);
      const newsData = await newsRes.json();

      if (newsData.success) {
        setNews(newsData.news || []);
        setImportant(newsData.important || []);
      }

      if (showAnalysis) {
        const analysisRes = await fetch('/api/news?action=analyze');
        const analysisData = await analysisRes.json();

        if (analysisData.success) {
          setAnalysis(analysisData.analysis);
        }
      }
    } catch (error) {
      console.error('Failed to fetch news:', error);
    } finally {
      setLoading(false);
    }
  }, [maxItems, showAnalysis]);

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('ar-EG', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  };

  const getMarketSentimentColor = () => {
    if (!analysis) return 'text-gray-500';
    switch (analysis.market_sentiment) {
      case 'bullish': return 'text-green-500';
      case 'bearish': return 'text-red-500';
      default: return 'text-yellow-500';
    }
  };

  if (compact) {
    return (
      <Card className="h-full">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Newspaper className="h-4 w-4" />
              أخبار البورصة
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={fetchNews} disabled={loading}>
              <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[200px]">
            <div className="space-y-2 p-3 pt-0">
              {important.slice(0, 5).map((item, idx) => (
                <a
                  key={idx}
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-xs hover:bg-muted/50 p-2 rounded overflow-hidden break-words"
                >
                  <p className="line-clamp-2">{item.title}</p>
                  <p className="text-muted-foreground text-[10px] mt-1">{item.source}</p>
                </a>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="h-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Newspaper className="h-5 w-5" />
              أخبار البورصة المصرية
            </CardTitle>
            <CardDescription>تحليل وتجميع الأخبار المهمة</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={fetchNews} disabled={loading}>
            <RefreshCw className={cn("h-4 w-4 ml-2", loading && "animate-spin")} />
            تحديث
          </Button>
        </div>

        <div className="flex gap-2 mt-4">
          <Button
            variant={activeTab === 'news' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('news')}
          >
            <Newspaper className="h-4 w-4 ml-1" />
            الأخبار ({news.length})
          </Button>
          <Button
            variant={activeTab === 'analysis' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('analysis')}
          >
            <Brain className="h-4 w-4 ml-1" />
            التحليل
          </Button>
          <Button
            variant={activeTab === 'alerts' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setActiveTab('alerts')}
          >
            <Bell className="h-4 w-4 ml-1" />
            التنبيهات
            {analysis?.alerts?.length ? (
              <Badge variant="destructive" className="ml-1 text-[10px]">
                {analysis.alerts.length}
              </Badge>
            ) : null}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        {showAnalysis && analysis && activeTab === 'analysis' && (
          <div className="mb-4 p-4 bg-muted/50 rounded-lg">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-muted-foreground">الاتجاه العام للسوق</span>
              <span className={cn("text-lg font-bold", getMarketSentimentColor())}>
                {analysis.market_sentiment === 'bullish' ? '📈 صعودي' :
                 analysis.market_sentiment === 'bearish' ? '📉 هبوطي' : '➡️ محايد'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-green-500">{analysis.positive_count}</p>
                <p className="text-xs text-muted-foreground">إيجابي</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-yellow-500">{analysis.neutral_count}</p>
                <p className="text-xs text-muted-foreground">محايد</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-500">{analysis.negative_count}</p>
                <p className="text-xs text-muted-foreground">سلبي</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'alerts' && (
          <div className="space-y-3">
            {analysis?.alerts?.length ? (
              analysis.alerts.map((alert, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg"
                >
                  <AlertTriangle className="h-5 w-5 text-red-500 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm">{alert.title}</p>
                    <p className="text-xs text-muted-foreground mt-1">{alert.message}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center text-muted-foreground py-8">
                <Bell className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>لا توجد تنبيهات حالياً</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'news' && (
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {important.length > 0 ? important.map((item, idx) => (
                <a
                  key={idx}
                  href={item.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-3 hover:bg-muted/50 rounded-lg border transition-colors overflow-hidden break-words"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <p className="font-medium text-sm line-clamp-2 break-words">{item.title}</p>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="text-xs text-muted-foreground">{item.source}</span>
                        <span className="text-xs text-muted-foreground">•</span>
                        <span className="text-xs text-muted-foreground">{formatDate(item.pub_date)}</span>
                      </div>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  </div>
                </a>
              )) : (
                <div className="text-center text-muted-foreground py-8">
                  <Newspaper className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>جاري تحميل الأخبار...</p>
                </div>
              )}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}

export default NewsWidget;
