'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Newspaper,
  TrendingUp,
  TrendingDown,
  Activity,
  AlertCircle,
  RefreshCw,
  Clock,
  ExternalLink,
  Search,
  Filter,
  Share2,
  Copy,
  Check,
  Image as ImageIcon,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Brain,
  Target,
  Globe,
} from 'lucide-react';
import { useAppStore, MARKET_NAMES_AR, MarketType } from '@/lib/store';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// ==================== TYPES ====================

interface NewsItem {
  id: string;
  title: string;
  summary: string;
  body?: string;
  source: string;
  timestamp: string;
  category: 'egx' | 'crypto' | 'sentiment' | 'market' | 'news_agent';
  importance: 'high' | 'medium' | 'low';
  url?: string;
  tickers?: string[];
  sentiment?: string;
  recommended_action?: string;
  reasoning?: string;
  image_paths?: string[];
  published_at?: string;
}

interface NewsFeedData {
  success: boolean;
  timestamp: string;
  news: NewsItem[];
  cache_duration: number;
  summary?: {
    total: number;
    agent?: number;
    egx?: number;
    crypto?: number;
    sentiment?: number;
    market_filter: string;
  };
}

// ==================== HELPERS ====================

const categoryIcons: Record<string, any> = {
  egx: TrendingUp,
  crypto: Activity,
  sentiment: AlertCircle,
  market: Globe,
  news_agent: Brain,
};

const categoryLabels: Record<string, string> = {
  egx: 'بورصة مصرية',
  crypto: 'كريبتو',
  sentiment: 'مشاعر السوق',
  market: 'السوق العالمي',
  news_agent: 'تحليل ذكي',
};

const importanceColors: Record<string, string> = {
  high: 'bg-red-500/20 text-red-400 border-red-500/50',
  medium: 'bg-teal-500/20 text-teal-400 border-teal-500/50',
  low: 'bg-slate-500/20 text-slate-400 border-slate-500/50',
};

const sentimentConfig: Record<string, { label: string; color: string; icon: any }> = {
  positive: { label: 'إيجابي', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', icon: ArrowUpRight },
  negative: { label: 'سلبي', color: 'text-red-400 bg-red-500/10 border-red-500/30', icon: ArrowDownRight },
  neutral: { label: 'محايد', color: 'text-slate-400 bg-slate-500/10 border-slate-500/30', icon: Minus },
};

function normalizeSentiment(sentiment?: string) {
  if (sentiment === 'bullish') return 'positive';
  if (sentiment === 'bearish') return 'negative';
  return sentiment || 'neutral';
}

const actionConfig: Record<string, { label: string; color: string }> = {
  buy: { label: 'شراء', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' },
  sell: { label: 'بيع', color: 'bg-red-500/20 text-red-400 border-red-500/50' },
  monitor: { label: 'مراقبة', color: 'bg-amber-500/20 text-amber-400 border-amber-500/50' },
  hold: { label: 'احتفاظ', color: 'bg-slate-500/20 text-slate-400 border-slate-500/50' },
  general: { label: 'عام', color: 'bg-slate-500/20 text-slate-400 border-slate-500/50' },
};

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(timestamp: string) {
  const date = new Date(timestamp);
  return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

// ==================== COMPONENTS ====================

function ImageViewer({ images, title }: { images?: string[]; title: string }) {
  const [selected, setSelected] = useState<string | null>(null);

  if (!images || images.length === 0) return null;

  return (
    <div className="mt-3">
      <div className="flex items-center gap-1 mb-2 text-xs text-muted-foreground">
        <ImageIcon className="w-3 h-3" />
        <span>الصور ({images.length})</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {images.map((img, i) => (
          <button
            key={i}
            onClick={() => setSelected(img)}
            className="flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border border-slate-700 hover:border-slate-500 transition-colors"
          >
            <img src={img} alt={`${title} - صورة ${i + 1}`} className="w-full h-full object-cover" />
          </button>
        ))}
      </div>
      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setSelected(null)}
        >
          <div className="relative max-w-3xl max-h-[80vh]">
            <img src={selected} alt="تكبير" className="max-w-full max-h-[80vh] object-contain rounded-lg" />
            <button
              onClick={() => setSelected(null)}
              className="absolute top-2 left-2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AIDecisionCard({ item }: { item: NewsItem }) {
  const [copied, setCopied] = useState(false);

  if (!item.sentiment && !item.recommended_action && !item.reasoning) return null;

  const sentiment = sentimentConfig[normalizeSentiment(item.sentiment)] || sentimentConfig.neutral;
  const SentimentIcon = sentiment.icon;
  const action = actionConfig[item.recommended_action || 'general'] || actionConfig.general;

  const handleCopyReasoning = async () => {
    if (!item.reasoning) return;
    try {
      await navigator.clipboard.writeText(item.reasoning);
      setCopied(true);
      toast.success('تم نسخ التحليل');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('فشل النسخ');
    }
  };

  return (
    <Card className="mt-3 bg-slate-800/50 border-slate-700/50">
      <CardHeader className="pb-2 pt-3">
        <CardTitle className="text-sm flex items-center gap-2 text-white">
          <Brain className="w-4 h-4 text-teal-400" />
          تحليل ذكي
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Badge className={cn('text-xs', sentiment.color)}>
            <SentimentIcon className="w-3 h-3 ml-1" />
            {sentiment.label}
          </Badge>
          <Badge className={cn('text-xs', action.color)}>
            <Target className="w-3 h-3 ml-1" />
            {action.label}
          </Badge>
          {item.importance === 'high' && (
            <Badge className="text-xs bg-red-500/20 text-red-400 border-red-500/50">
              أهمية عالية
            </Badge>
          )}
        </div>

        {item.tickers && item.tickers.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <span className="text-xs text-muted-foreground">الأسهم:</span>
            {item.tickers.map((ticker) => (
              <Badge key={ticker} variant="outline" className="text-xs">
                {ticker}
              </Badge>
            ))}
          </div>
        )}

        {item.reasoning && (
          <div className="bg-slate-900/50 rounded-lg p-3 text-xs text-slate-300 leading-relaxed">
            {item.reasoning}
          </div>
        )}

        {item.reasoning && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopyReasoning}
            className="text-xs h-7 gap-1 text-slate-400 hover:text-white"
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {copied ? 'تم النسخ' : 'نسخ التحليل'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function ShareButtons({ item }: { item: NewsItem }) {
  const [copied, setCopied] = useState(false);
  const text = `${item.title}\n\n${item.summary}\n\n${item.url || ''}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('تم نسخ الخبر');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('فشل النسخ');
    }
  };

  const handleTelegram = () => {
    const url = `https://t.me/share/url?url=${encodeURIComponent(item.url || window.location.href)}&text=${encodeURIComponent(item.title)}`;
    window.open(url, '_blank');
  };

  const handleWhatsApp = () => {
    const url = `https://wa.me/?text=${encodeURIComponent(item.title + ' ' + (item.url || ''))}`;
    window.open(url, '_blank');
  };

  return (
    <div className="flex gap-1 mt-2">
      <Button variant="ghost" size="sm" onClick={handleTelegram} className="h-7 text-xs gap-1 text-slate-400 hover:text-white">
        <Share2 className="w-3 h-3" />
        تليجرام
      </Button>
      <Button variant="ghost" size="sm" onClick={handleWhatsApp} className="h-7 text-xs gap-1 text-slate-400 hover:text-white">
        <Share2 className="w-3 h-3" />
        واتساب
      </Button>
      <Button variant="ghost" size="sm" onClick={handleCopy} className="h-7 text-xs gap-1 text-slate-400 hover:text-white">
        {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        {copied ? 'تم النسخ' : 'نسخ'}
      </Button>
      {item.url && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.open(item.url, '_blank')}
          className="h-7 text-xs gap-1 text-slate-400 hover:text-white"
        >
          <ExternalLink className="w-3 h-3" />
          المصدر
        </Button>
      )}
    </div>
  );
}

function NewsCard({ item }: { item: NewsItem }) {
  const Icon = categoryIcons[item.category] || Activity;
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-slate-700 hover:border-slate-600 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-slate-700/50 mt-0.5">
            <Icon className="h-4 w-4 text-slate-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-sm font-semibold text-white break-words">{item.title}</h3>
              <Badge className={`${importanceColors[item.importance]} text-xs`}>
                {item.importance === 'high' ? 'مهم' : item.importance === 'medium' ? 'متوسط' : 'عادي'}
              </Badge>
            </div>

            <p className="text-xs text-slate-400 mb-1">{item.summary}</p>

            {(item.body || expanded) && item.body && (
              <div className="text-xs text-slate-300 leading-relaxed bg-slate-900/50 rounded-lg p-3 mt-2 whitespace-pre-wrap">
                {item.body}
              </div>
            )}

            {item.body && item.body.length > 200 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExpanded(!expanded)}
                className="text-xs h-6 mt-1 text-slate-400 hover:text-white"
              >
                {expanded ? 'إخفاء النص الكامل' : 'عرض النص الكامل'}
              </Button>
            )}

            <ImageViewer images={item.image_paths} title={item.title} />

            <AIDecisionCard item={item} />

            <ShareButtons item={item} />

            <div className="flex items-center gap-2 mt-2 text-xs text-slate-500">
              <span>{item.source}</span>
              <span className="text-slate-600">•</span>
              <span>{formatDate(item.timestamp)}</span>
              <span className="text-slate-600">•</span>
              <Clock className="h-3 w-3" />
              <span>{formatTime(item.timestamp)}</span>
              {item.category !== 'news_agent' && (
                <>
                  <span className="text-slate-600">•</span>
                  <Badge variant="outline" className="text-[10px] h-5">
                    {categoryLabels[item.category] || item.category}
                  </Badge>
                </>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== MAIN VIEW ====================

export function NewsFeedView() {
  const [data, setData] = useState<NewsFeedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [marketFilter, setMarketFilter] = useState<'all' | 'egx' | 'crypto'>('all');
  const currentMarket = useAppStore((s) => s.currentMarket);

  const fetchNews = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const marketParam = marketFilter === 'all' ? '' : `?market=${marketFilter}`;
      const response = await fetch('/api/news-feed' + marketParam);
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
  }, [marketFilter]);

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchNews();
    setRefreshing(false);
  };

  const filteredNews = useMemo(() => {
    if (!data?.news) return [];
    let news = data.news;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      news = news.filter(item =>
        item.title.toLowerCase().includes(q) ||
        item.summary.toLowerCase().includes(q) ||
        (item.body && item.body.toLowerCase().includes(q)) ||
        (item.tickers && item.tickers.some(t => t.toLowerCase().includes(q)))
      );
    }
    return news;
  }, [data?.news, searchQuery]);

  if (loading) {
    return (
      <div className="space-y-4 p-4 md:p-6" dir="rtl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Newspaper className="h-6 w-6 text-teal-400" />
            <Skeleton className="h-8 w-48" />
          </div>
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="grid gap-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Card key={i} className="bg-slate-900 border-slate-700">
              <CardContent className="p-4">
                <div className="flex gap-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4 p-4 md:p-6" dir="rtl">
        <Card className="bg-slate-900 border-slate-700">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-12 w-12 text-red-400 mx-auto mb-3" />
            <h2 className="text-lg font-bold text-white mb-2">خطأ في التحميل</h2>
            <p className="text-red-400 text-sm mb-4">{error}</p>
            <Button onClick={handleRefresh} variant="outline" size="sm">
              <RefreshCw className="h-4 w-4 ml-2" />
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Newspaper className="h-6 w-6 text-teal-400" />
          <div>
            <h1 className="text-xl font-bold text-white">الأخبار والتحليلات</h1>
            <p className="text-xs text-slate-400">
              {data?.summary?.total || 0} خبر • آخر تحديث: {data ? formatTime(data.timestamp) : ''}
            </p>
          </div>
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

      {/* Filters */}
      <Card className="bg-slate-900 border-slate-700">
        <CardContent className="p-3">
          <div className="flex gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute right-2 top-2.5 w-4 h-4 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث في الأخبار أو الأسهم..."
                className="pr-8 h-9 bg-slate-800 border-slate-700 text-white text-xs"
              />
            </div>
            <Tabs value={marketFilter} onValueChange={(v) => setMarketFilter(v as any)} className="w-auto">
              <TabsList className="bg-slate-800 border-slate-700 h-9">
                <TabsTrigger value="all" className="text-xs h-7 data-[state=active]:bg-slate-700">
                  الكل
                </TabsTrigger>
                <TabsTrigger value="egx" className="text-xs h-7 data-[state=active]:bg-slate-700">
                  🇪🇬 مصر
                </TabsTrigger>
                <TabsTrigger value="crypto" className="text-xs h-7 data-[state=active]:bg-slate-700">
                  ₿ كريبتو
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {/* News Feed */}
      <div className="grid gap-3">
        {filteredNews.length === 0 ? (
          <Card className="bg-slate-900 border-slate-700">
            <CardContent className="p-8 text-center">
              <Newspaper className="h-12 w-12 text-slate-600 mx-auto mb-3" />
              <p className="text-slate-400 text-sm">
                {searchQuery ? 'لا توجد نتائج مطابقة للبحث' : 'لا توجد أخبار متاحة حالياً'}
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredNews.map((item) => <NewsCard key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}

export default NewsFeedView;
