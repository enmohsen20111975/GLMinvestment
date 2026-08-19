'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Newspaper, 
  TrendingUp, 
  TrendingDown, 
  Activity, 
  AlertCircle,
  RefreshCw,
  Clock,
  ExternalLink
} from 'lucide-react';

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  source: string;
  timestamp: string;
  category: 'crypto' | 'market' | 'sentiment';
  importance: 'high' | 'medium' | 'low';
}

interface NewsFeedData {
  success: boolean;
  timestamp: string;
  news: NewsItem[];
  cache_duration: number;
}

const categoryIcons: Record<string, any> = {
  'crypto': Activity,
  'market': TrendingUp,
  'sentiment': AlertCircle
};

const importanceColors: Record<string, string> = {
  'high': 'bg-red-500/20 text-red-400 border-red-500/50',
  'medium': 'bg-blue-500/20 text-blue-400 border-blue-500/50',
  'low': 'bg-slate-500/20 text-slate-400 border-slate-500/50'
};

export function NewsFeedWidget() {
  const [data, setData] = useState<NewsFeedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNews = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/news-feed');
      const result = await response.json();

      if (result.success) {
        setData(result);
      } else {
        setError(result.error || 'فشل في تحميل الأخبار');
      }
    } catch (err: any) {
      setError(err.message || 'خطأ في الاتصال');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNews();
    // Auto-refresh every 5 minutes
    const interval = setInterval(fetchNews, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchNews();
    setRefreshing(false);
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  };

  if (loading) {
    return (
      <Card className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-slate-700">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <Newspaper className="h-5 w-5 text-blue-400" />
            <Skeleton className="h-6 w-32" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-slate-700">
        <CardHeader>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-red-400" />
            <CardTitle className="text-white">خطأ</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-red-400 text-sm mb-4">{error}</p>
          <Button onClick={fetchNews} variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-2" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data || data.news.length === 0) {
    return (
      <Card className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-slate-700">
        <CardHeader>
          <CardTitle className="text-white">لا توجد أخبار</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-slate-700">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Newspaper className="h-5 w-5 text-blue-400" />
            <CardTitle className="text-white text-lg">آخر الأخبار</CardTitle>
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-slate-400 hover:text-white"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-500">
          <Clock className="h-3 w-3" />
          آخر تحديث: {formatTime(data.timestamp)}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {data.news.map((item) => {
          const Icon = categoryIcons[item.category] || Activity;
          
          return (
            <div
              key={item.id}
              className="bg-slate-800/50 rounded-lg p-3 border border-slate-700/50 hover:border-slate-600 transition-colors overflow-hidden break-words"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1">
                  <div className="p-1.5 rounded-lg bg-slate-700/50 mt-0.5">
                    <Icon className="h-4 w-4 text-slate-300" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-white truncate break-words">
                        {item.title}
                      </p>
                      <Badge className={`${importanceColors[item.importance]} text-xs`}>
                        {item.importance === 'high' ? 'مهم' : item.importance === 'medium' ? 'متوسط' : 'عادي'}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-2">{item.summary}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-slate-500">{item.source}</span>
                      <span className="text-xs text-slate-600">•</span>
                      <span className="text-xs text-slate-500">{formatTime(item.timestamp)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Footer */}
        <div className="pt-2 border-t border-slate-700/50 text-xs text-slate-500 flex items-center justify-between">
          <span>يتحدث تلقائياً كل 5 دقائق</span>
          <div className="flex items-center gap-1">
            <span>{data.news.length} عناصر</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default NewsFeedWidget;
