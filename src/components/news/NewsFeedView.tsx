'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Newspaper,
  Share2,
  ExternalLink,
  Copy,
  Check,
  Search,
  RotateCw,
  Clock,
  TrendingUp,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Sparkles,
  Maximize2,
  X,
  Building2,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useAppStore } from '@/lib/store';

// ==================== TYPES ====================

export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  body?: string;
  source: string;
  timestamp: string;
  category: 'egx' | 'crypto' | 'market' | 'news_agent';
  importance: 'high' | 'medium' | 'low';
  url?: string;
  tickers?: string[];
  sentiment?: 'positive' | 'negative' | 'neutral' | 'bullish' | 'bearish';
  recommended_action?: 'buy' | 'sell' | 'monitor' | 'hold' | 'general' | string;
  reasoning?: string;
  image_paths?: string[];
  published_at?: string;
}

export interface NewsFeedData {
  news: NewsItem[];
  total: number;
  markets: string[];
  last_updated: string;
  sources: string[];
}

// ==================== HELPERS & CONFIG ====================

function normalizeSentiment(sentiment?: string): 'positive' | 'negative' | 'neutral' {
  if (sentiment === 'bullish' || sentiment === 'positive') return 'positive';
  if (sentiment === 'bearish' || sentiment === 'negative') return 'negative';
  return 'neutral';
}

function formatDate(timestamp: string) {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return timestamp;
    return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return timestamp;
  }
}

function formatTime(timestamp: string) {
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

// ==================== SUB-COMPONENTS ====================

/**
 * Image gallery/viewer from genuine source
 */
function SourceImageViewer({ images, title, source }: { images?: string[]; title: string; source: string }) {
  const [selectedImage, setSelectedImage] = useState<string | null>(null);

  const validImages = useMemo(() => {
    if (!images || !Array.isArray(images)) return [];
    return images.filter(
      (img) => typeof img === 'string' && img.startsWith('http') && !img.includes('/tmp/')
    );
  }, [images]);

  if (validImages.length === 0) return null;

  return (
    <div className="my-4">
      {/* Featured Primary Image */}
      <div
        className="relative group rounded-lg overflow-hidden border border-border/70 bg-muted/20 cursor-pointer max-h-[380px]"
        onClick={() => setSelectedImage(validImages[0])}
      >
        <img
          src={validImages[0]}
          alt={title}
          className="w-full h-auto max-h-[380px] object-cover transition-transform duration-200 group-hover:scale-[1.01]"
          loading="lazy"
          onError={(e) => {
            (e.target as HTMLElement).style.display = 'none';
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-3 text-white text-xs">
          <span>صورة من المصدر ({source})</span>
          <span className="flex items-center gap-1 bg-black/40 px-2 py-1 rounded">
            <Maximize2 className="w-3.5 h-3.5" /> تكبير
          </span>
        </div>
      </div>

      {/* Thumbnails if multiple images */}
      {validImages.length > 1 && (
        <div className="flex gap-2 mt-2 overflow-x-auto pb-1">
          {validImages.slice(1).map((img, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => setSelectedImage(img)}
              className="relative flex-shrink-0 w-16 h-16 rounded-md overflow-hidden border border-border/70 hover:border-primary transition-all"
            >
              <img src={img} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Modal Lightbox */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setSelectedImage(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] bg-background/95 rounded-xl p-2 border border-border shadow-2xl">
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              className="absolute top-4 left-4 z-10 bg-background/80 hover:bg-background border border-border rounded-full p-1.5 text-foreground transition-colors shadow"
              aria-label="إغلاق"
            >
              <X className="w-4 h-4" />
            </button>
            <img
              src={selectedImage}
              alt={title}
              className="max-w-full max-h-[82vh] object-contain rounded-lg mx-auto"
            />
            <p className="text-xs text-muted-foreground text-center mt-2 px-4 truncate">{title}</p>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Genuine Local AI Decision Support Card (Rendered ONLY if genuine reasoning exists)
 */
function InvestmentDecisionInsight({ item }: { item: NewsItem }) {
  const [copied, setCopied] = useState(false);

  // Strictly enforce: never render unless genuine reasoning exists
  if (!item.reasoning || item.reasoning.trim().length < 10) {
    return null;
  }

  const sentimentKey = normalizeSentiment(item.sentiment);
  const action = (item.recommended_action || 'monitor').toLowerCase();

  const handleCopyAnalysis = async () => {
    try {
      await navigator.clipboard.writeText(
        `التحليل الاستثماري لخبر (${item.title}):\n` +
          `التوجه: ${sentimentKey === 'positive' ? 'إيجابي' : sentimentKey === 'negative' ? 'سلبي' : 'محايد'}\n` +
          `التوصية: ${action}\n` +
          `الأسهم: ${(item.tickers || []).join(', ')}\n\n` +
          `التحليل: ${item.reasoning}`
      );
      setCopied(true);
      toast.success('تم نسخ التحليل الاستثماري');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('فشل النسخ');
    }
  };

  return (
    <div className="my-4 rounded-xl border border-border/80 bg-muted/40 p-4 transition-colors">
      <div className="flex items-center justify-between pb-2 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <span className="text-xs font-bold text-foreground">تحليل استثماري (من المحرك المحلي)</span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopyAnalysis}
          className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? 'تم النسخ' : 'نسخ التحليل'}</span>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        {/* Sentiment Badge */}
        {sentimentKey === 'positive' && (
          <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-xs gap-1">
            <ArrowUpRight className="w-3.5 h-3.5" />
            إيجابي
          </Badge>
        )}
        {sentimentKey === 'negative' && (
          <Badge className="bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-500/30 text-xs gap-1">
            <ArrowDownRight className="w-3.5 h-3.5" />
            سلبي
          </Badge>
        )}
        {sentimentKey === 'neutral' && (
          <Badge variant="outline" className="text-muted-foreground text-xs gap-1">
            <Minus className="w-3.5 h-3.5" />
            محايد
          </Badge>
        )}

        {/* Action Badge */}
        {(action === 'buy' || action === 'شراء') && (
          <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 text-xs">
            فرصة شراء
          </Badge>
        )}
        {(action === 'sell' || action === 'بيع') && (
          <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30 text-xs">
            إشارة بيع / تخفيف
          </Badge>
        )}
        {(action === 'monitor' || action === 'مراقبة') && (
          <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-xs">
            مراقبة
          </Badge>
        )}

        {/* Related Tickers */}
        {item.tickers && item.tickers.length > 0 && (
          <div className="flex items-center gap-1 mr-auto flex-wrap">
            <span className="text-[11px] text-muted-foreground ml-1">الأسهم المرتبطة:</span>
            {item.tickers.map((t) => (
              <Badge
                key={t}
                variant="outline"
                className="font-mono text-xs font-semibold text-primary border-primary/30 bg-primary/5"
              >
                {t}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Analysis Reasoning Text */}
      <p className="text-xs md:text-sm text-foreground/85 leading-relaxed mt-2.5 font-normal whitespace-pre-wrap">
        {item.reasoning}
      </p>
    </div>
  );
}

/**
 * Social Sharing and Copy Actions
 */
function ShareAndActions({ item }: { item: NewsItem }) {
  const [copied, setCopied] = useState(false);

  const fullTextToShare = useMemo(() => {
    const parts = [item.title, '\n'];
    if (item.body) {
      parts.push(item.body);
    } else if (item.summary) {
      parts.push(item.summary);
    }
    if (item.url) {
      parts.push(`\nالمصدر: ${item.url}`);
    }
    return parts.join('\n');
  }, [item]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullTextToShare);
      setCopied(true);
      toast.success('تم نسخ نص الخبر كاملاً');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('فشل النسخ');
    }
  };

  const handleTelegram = () => {
    const text = encodeURIComponent(`${item.title}\n\n${item.summary || ''}\n\n${item.url || ''}`);
    window.open(`https://t.me/share/url?url=${encodeURIComponent(item.url || window.location.href)}&text=${text}`, '_blank');
  };

  const handleWhatsApp = () => {
    const text = encodeURIComponent(`*${item.title}*\n\n${item.summary || ''}\n\n${item.url || ''}`);
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  return (
    <div className="flex items-center gap-2 pt-3 mt-3 border-t border-border/50 flex-wrap">
      <Button
        variant="outline"
        size="sm"
        onClick={handleTelegram}
        className="h-8 text-xs gap-1.5 hover:bg-muted"
      >
        <Share2 className="w-3.5 h-3.5 text-sky-500" />
        <span>تليجرام</span>
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={handleWhatsApp}
        className="h-8 text-xs gap-1.5 hover:bg-muted"
      >
        <Share2 className="w-3.5 h-3.5 text-emerald-500" />
        <span>واتساب</span>
      </Button>

      <Button
        variant="outline"
        size="sm"
        onClick={handleCopy}
        className="h-8 text-xs gap-1.5 hover:bg-muted"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
        <span>{copied ? 'تم النسخ' : 'نسخ الخبر'}</span>
      </Button>

      {item.url && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.open(item.url, '_blank')}
          className="h-8 text-xs gap-1.5 mr-auto hover:bg-muted"
        >
          <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
          <span>المصدر الأصلي</span>
        </Button>
      )}
    </div>
  );
}

/**
 * Standard News Card
 */
function NewsCard({ item }: { item: NewsItem }) {
  const setSelectedStock = useAppStore((s) => s.setSelectedStock);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const [expanded, setExpanded] = useState(false);

  const fullText = item.body || item.summary || '';
  const isLong = fullText.length > 700;

  const handleTickerClick = (ticker: string) => {
    if (!ticker) return;
    setSelectedStock(ticker);
    setActiveTab('stocks');
  };

  return (
    <Card className="overflow-hidden border border-border/70 hover:border-border transition-all duration-200 bg-card shadow-sm hover:shadow-md">
      <CardContent className="p-5">
        {/* Header Metadata */}
        <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap text-xs text-muted-foreground">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Source */}
            <Badge variant="secondary" className="font-normal text-xs gap-1">
              <Building2 className="w-3 h-3" />
              {item.source}
            </Badge>

            {/* Importance */}
            {item.importance === 'high' && (
              <Badge className="bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-xs">
                مهم وعاجل
              </Badge>
            )}

            {/* Tickers */}
            {item.tickers && item.tickers.length > 0 && (
              <div className="flex items-center gap-1">
                {item.tickers.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => handleTickerClick(t)}
                    className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Date & Time */}
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
            <Clock className="w-3.5 h-3.5" />
            <span>{formatDate(item.timestamp)}</span>
            {formatTime(item.timestamp) && (
              <>
                <span>•</span>
                <span>{formatTime(item.timestamp)}</span>
              </>
            )}
          </div>
        </div>

        {/* Title */}
        <h2 className="text-base md:text-lg font-bold text-foreground leading-snug tracking-tight mb-2">
          {item.url ? (
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors inline-flex items-center gap-1"
            >
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </h2>

        {/* Featured Image from Source */}
        <SourceImageViewer images={item.image_paths} title={item.title} source={item.source} />

        {/* Full Article Content */}
        <div className="text-sm text-foreground/90 leading-relaxed font-normal mt-3 space-y-2 whitespace-pre-line">
          {isLong && !expanded ? (
            <>
              <p>{fullText.slice(0, 650)}...</p>
              <Button
                variant="link"
                size="sm"
                onClick={() => setExpanded(true)}
                className="p-0 h-auto text-xs font-semibold text-primary"
              >
                قراءة الخبر كاملاً ↓
              </Button>
            </>
          ) : (
            <>
              <p>{fullText}</p>
              {isLong && expanded && (
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setExpanded(false)}
                  className="p-0 h-auto text-xs font-semibold text-muted-foreground mt-1"
                >
                  إخفاء جزء من النص ↑
                </Button>
              )}
            </>
          )}
        </div>

        {/* Local AI Decision Insight (ONLY if real analysis exists) */}
        <InvestmentDecisionInsight item={item} />

        {/* Sharing and Action Bar */}
        <ShareAndActions item={item} />
      </CardContent>
    </Card>
  );
}

// ==================== MAIN COMPONENT ====================

export function NewsFeedView() {
  const [data, setData] = useState<NewsFeedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [marketFilter, setMarketFilter] = useState<'all' | 'EGX' | 'global'>('all');

  const fetchNews = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/news-feed', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(json.error || 'فشل في تحميل الأخبار');
      }
    } catch (err: any) {
      setError(err.message || 'خطأ في الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNews();
    const interval = setInterval(fetchNews, 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchNews]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchNews();
    setRefreshing(false);
    toast.success('تم تحديث الأخبار');
  };

  const filteredNews = useMemo(() => {
    if (!data?.news) return [];
    let list = data.news;

    if (marketFilter === 'EGX') {
      list = list.filter(
        (n) => n.category === 'egx' || n.source.includes('مصر') || n.source.includes('EGX') || n.source.includes('البورصة')
      );
    } else if (marketFilter === 'global') {
      list = list.filter((n) => n.category === 'crypto' || n.category === 'market');
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          (n.body && n.body.toLowerCase().includes(q)) ||
          (n.summary && n.summary.toLowerCase().includes(q)) ||
          (n.tickers && n.tickers.some((t) => t.toLowerCase().includes(q))) ||
          n.source.toLowerCase().includes(q)
      );
    }

    return list;
  }, [data?.news, marketFilter, searchQuery]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto p-4 md:p-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-primary/10 text-primary">
              <Newspaper className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-bold text-foreground">الأخبار المالية والاقتصادية</h1>
              <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
                تغطية شاملة لأخبار البورصة والشركات المدرجة بالنص الكامل والصور من المصادر
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="gap-1.5 h-9 text-xs"
          >
            <RotateCw className={cn('h-3.5 w-3.5', (refreshing || loading) && 'animate-spin')} />
            <span>تحديث</span>
          </Button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center gap-3">
        {/* Search Input */}
        <div className="relative flex-1 w-full">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="بحث في الأخبار أو رمز السهم (مثال: COMI, TMGH)..."
            className="pr-9 h-10 text-sm bg-card border-border"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
            >
              مسح
            </button>
          )}
        </div>

        {/* Market Filter Tabs */}
        <div className="flex items-center gap-1 bg-muted p-1 rounded-lg w-full sm:w-auto self-stretch">
          <button
            type="button"
            onClick={() => setMarketFilter('all')}
            className={cn(
              'flex-1 sm:flex-none px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              marketFilter === 'all'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            جميع الأخبار ({data?.news?.length || 0})
          </button>
          <button
            type="button"
            onClick={() => setMarketFilter('EGX')}
            className={cn(
              'flex-1 sm:flex-none px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              marketFilter === 'EGX'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            البورصة المصرية
          </button>
          <button
            type="button"
            onClick={() => setMarketFilter('global')}
            className={cn(
              'flex-1 sm:flex-none px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
              marketFilter === 'global'
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            الأسواق العالمية
          </button>
        </div>
      </div>

      {/* Loading Skeletons */}
      {loading && !data && (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Card key={i} className="border-border/60 bg-card">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-24 rounded" />
                  <Skeleton className="h-5 w-16 rounded" />
                </div>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-20 w-full rounded-lg" />
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-20 rounded" />
                  <Skeleton className="h-8 w-20 rounded" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && !loading && (
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="p-6 text-center space-y-2">
            <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchNews}>
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!loading && filteredNews.length === 0 && (
        <Card className="border-border/60 bg-card">
          <CardContent className="p-12 text-center space-y-3">
            <Newspaper className="w-10 h-10 mx-auto text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">لا توجد أخبار مطابقة حالياً</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              سيتم عرض الأخبار الجديدة تلقائياً بمجرد ورودها من وكيل الأخبار ومصادر البورصة.
            </p>
          </CardContent>
        </Card>
      )}

      {/* News Feed List */}
      <div className="space-y-4">
        {filteredNews.map((item) => (
          <NewsCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
