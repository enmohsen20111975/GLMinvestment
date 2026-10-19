'use client';

/**
 * NewsFeedView — الأخبار المالية والاقتصادية
 * Features: 2-column layout, investment insights, social sharing (Facebook, Twitter X, LinkedIn, WhatsApp, Telegram)
 */

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
import { withOfficialLinks, OFFICIAL_LINKS_SHORT } from '@/modules/publishing/lib/official-links';
import { UnifiedPublishButton } from '@/modules/publishing/components/UnifiedPublishButton';
import { useTranslation } from '@/lib/i18n-context';

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
  const t = useTranslation();
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
          <span>{t('news.feed.imageFromSource', { source })}</span>
          <span className="flex items-center gap-1 bg-black/40 px-2 py-1 rounded">
            <Maximize2 className="w-3.5 h-3.5" /> {t('news.feed.zoom')}
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
              aria-label={t('news.feed.closeAriaLabel')}
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
function InvestmentDecisionInsight({
  item,
  onTickerClick,
}: {
  item: NewsItem;
  onTickerClick?: (ticker: string) => void;
}) {
  const t = useTranslation();
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
        withOfficialLinks(
          `${t('news.feed.insight.copyTextTemplate', { title: item.title })}:\n` +
            `${t('news.feed.insight.sentimentLabel')}: ${sentimentKey === 'positive' ? t('news.feed.insight.sentimentPositive') : sentimentKey === 'negative' ? t('news.feed.insight.sentimentNegative') : t('news.feed.insight.sentimentNeutral')}\n` +
            `${t('news.feed.insight.recommendationLabel')}: ${action}\n` +
            `${t('news.feed.insight.stocksLabel')} ${(item.tickers || []).join(', ')}\n\n` +
            `${t('news.feed.insight.analysisLabel')} ${item.reasoning}`
        )
      );
      setCopied(true);
      toast.success(t('news.feed.insight.toastCopySuccess'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('news.feed.insight.toastCopyFailed'));
    }
  };

  return (
    <div className="rounded-xl border border-border/80 bg-muted/30 p-3.5 space-y-3">
      <div className="flex items-center justify-between pb-2 border-b border-border/50">
        <div className="flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-bold text-foreground">{t('news.feed.insight.title')}</span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={handleCopyAnalysis}
          className="h-6 px-2 text-[11px] gap-1 text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="w-3 h-3 text-profit" /> : <Copy className="w-3 h-3" />}
          <span>{copied ? t('news.feed.insight.copied') : t('news.feed.insight.copy')}</span>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {/* Sentiment Badge */}
        {sentimentKey === 'positive' && (
          <Badge className="bg-profit/10 text-profit dark:text-profit border-profit/30 text-xs gap-1">
            <ArrowUpRight className="w-3 h-3" />
            {t('news.feed.insight.sentimentPositive')}
          </Badge>
        )}
        {sentimentKey === 'negative' && (
          <Badge className="bg-loss/10 text-loss dark:text-loss border-loss/30 text-xs gap-1">
            <ArrowDownRight className="w-3 h-3" />
            {t('news.feed.insight.sentimentNegative')}
          </Badge>
        )}
        {sentimentKey === 'neutral' && (
          <Badge variant="outline" className="text-muted-foreground text-xs gap-1">
            <Minus className="w-3 h-3" />
            {t('news.feed.insight.sentimentNeutral')}
          </Badge>
        )}

        {/* Action Badge */}
        {(action === 'buy' || action === 'شراء') && (
          <Badge className="bg-profit/15 text-profit dark:text-profit border-profit/30 text-xs">
            {t('news.feed.insight.buyOpportunity')}
          </Badge>
        )}
        {(action === 'sell' || action === 'بيع') && (
          <Badge className="bg-loss/15 text-loss dark:text-loss border-loss/30 text-xs">
            {t('news.feed.insight.sellSignal')}
          </Badge>
        )}
        {(action === 'monitor' || action === 'مراقبة') && (
          <Badge className="bg-warning/15 text-warning dark:text-warning border-warning/30 text-xs">
            {t('news.feed.insight.monitor')}
          </Badge>
        )}
      </div>

      {/* Analysis Reasoning Text */}
      <p className="text-xs text-foreground/85 leading-relaxed font-normal">
        {item.reasoning}
      </p>

      {/* Related Tickers */}
      {item.tickers && item.tickers.length > 0 && (
        <div className="flex items-center gap-1 pt-2 border-t border-border/40 flex-wrap">
          <span className="text-[10px] text-muted-foreground">{t('news.feed.insight.stocksLabel')}</span>
          {item.tickers.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onTickerClick?.(t)}
              className="font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
            >
              {t}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FacebookIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="#1877F2">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  );
}

function TwitterXIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function WhatsAppIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="#25D366">
      <path d="M12.031 6.172c-3.181 0-5.767 2.586-5.768 5.766-.001 1.298.38 2.27 1.019 3.287l-.711 2.598 2.669-.699c.969.54 1.772.82 2.79.82h.001c3.181 0 5.767-2.586 5.768-5.766 0-3.18-2.586-5.766-5.768-5.766zm9.969 5.828c0 5.523-4.477 10-10 10-1.761 0-3.414-.46-4.856-1.266L2 22l1.472-5.029C2.628 15.547 2 13.847 2 12c0-5.523 4.477-10 10-10s10 4.477 10 10z" />
    </svg>
  );
}

function TelegramIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="#229ED9">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function LinkedInIcon({ className = "w-3.5 h-3.5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="#0A66C2">
      <path d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z" />
    </svg>
  );
}

/**
 * Social Sharing and Copy Actions
 */
function ShareAndActions({ item }: { item: NewsItem }) {
  const t = useTranslation();
  const [copied, setCopied] = useState(false);

  const fullTextToShare = useMemo(() => {
    const parts = [item.title, '\n'];
    if (item.body) {
      parts.push(item.body);
    } else if (item.summary) {
      parts.push(item.summary);
    }
    if (item.url) {
      parts.push(`\n${t('news.feed.share.sourceLabel')} ${item.url}`);
    }
    return withOfficialLinks(parts.join('\n'));
  }, [item]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullTextToShare);
      setCopied(true);
      toast.success(t('news.feed.share.toastCopySuccess'));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('news.feed.share.toastCopyFailed'));
    }
  };

  const getTargetUrl = () => {
    return item.url || (typeof window !== 'undefined' ? window.location.href : 'https://invist.m2y.net');
  };

  const handleFacebook = () => {
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(getTargetUrl())}`,
      '_blank',
      'noopener,noreferrer,width=600,height=500'
    );
  };

  const handleTwitter = () => {
    const tags = item.tickers?.length ? item.tickers.join(',') : 'EGX,بورصة';
    window.open(
      `https://twitter.com/intent/tweet?text=${encodeURIComponent(item.title)}&url=${encodeURIComponent(getTargetUrl())}&hashtags=${encodeURIComponent(tags)}`,
      '_blank',
      'noopener,noreferrer,width=600,height=500'
    );
  };

  const handleWhatsApp = () => {
    const text = encodeURIComponent(`*${item.title}*\n\n${item.summary || ''}\n\n${getTargetUrl()}\n\n${OFFICIAL_LINKS_SHORT}`);
    window.open(`https://wa.me/?text=${text}`, '_blank', 'noopener,noreferrer');
  };

  const handleTelegram = () => {
    const text = encodeURIComponent(`${item.title}\n\n${item.summary || ''}\n\n${OFFICIAL_LINKS_SHORT}`);
    window.open(`https://t.me/share/url?url=${encodeURIComponent(getTargetUrl())}&text=${text}`, '_blank', 'noopener,noreferrer');
  };

  const handleLinkedIn = () => {
    window.open(
      `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(getTargetUrl())}`,
      '_blank',
      'noopener,noreferrer,width=600,height=500'
    );
  };

  // hashtags من tickers (إذا وُجدت) — تُضاف للنشر على فيسبوك/تويتر.
  const hashtags = item.tickers && item.tickers.length > 0 ? item.tickers : ['EGX', 'بورصة'];
  // URL المشارة — يستخدم item.url إن وُجد، وإلا رابط المنصة الرسمي.
  const shareUrl = item.url || (typeof window !== 'undefined' ? window.location.href : 'https://invist.m2y.net');

  return (
    <div className="space-y-2 pt-2">
      <span className="text-[11px] font-medium text-muted-foreground block">{t('news.feed.share.label')}</span>
      {/* UnifiedPublishButton — يوحد كل منصات النشر + النسخ في زر واحد */}
      <UnifiedPublishButton
        content={fullTextToShare}
        title={item.title}
        url={shareUrl}
        hashtags={hashtags}
        filename={`news_${item.id}`}
        variant="outline"
        size="sm"
        split
      />
      {/* رابط المصدر الأصلي */}
      {item.url && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => window.open(item.url, '_blank')}
          title={t('news.feed.share.sourceLinkTitle')}
          className="h-8 w-full text-xs gap-1.5 justify-center hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          <span>{t('news.feed.share.sourceLink')}</span>
        </Button>
      )}
    </div>
  );
}

/**
 * Standard News Card
 */
function NewsCard({ item }: { item: NewsItem }) {
  const t = useTranslation();
  const setSelectedStock = useAppStore((s) => s.setSelectedStock);
  const setActiveTab = useAppStore((s) => s.setActiveTab);
  const [expanded, setExpanded] = useState(false);

  const fullText = useMemo(() => {
    const raw = item.body || item.summary || '';
    if (!raw) return '';
    const lines = raw.split('\n');
    const seen = new Set<string>();
    const cleaned: string[] = [];
    const normalizedTitle = (item.title || '')
      .replace(/📰/g, '')
      .replace(/🚨\s*إشعار استثماري عاجل\s*\|\s*محفز صعودي قوي\s*🚀/gi, '')
      .replace(/🚨\s*إشعار استثماري عاجل/gi, '')
      .replace(/محفز صعودي قوي\s*🚀?/gi, '')
      .replace(/📊\s*نبض البورصة والأخبار المالية\s*\|\s*Investment Guide/gi, '')
      .trim()
      .toLowerCase();

    for (const l of lines) {
      const trimmed = l.trim().replace(/^[▪️•\-\*]+\s*/, '');
      if (!trimmed) {
        if (cleaned.length > 0 && cleaned[cleaned.length - 1] !== '') {
          cleaned.push('');
        }
        continue;
      }
      const cleanLine = trimmed
        .replace(/📰/g, '')
        .replace(/🚨\s*إشعار استثماري عاجل\s*\|\s*محفز صعودي قوي\s*🚀/gi, '')
        .replace(/🚨\s*إشعار استثماري عاجل/gi, '')
        .replace(/محفز صعودي قوي\s*🚀?/gi, '')
        .replace(/📊\s*نبض البورصة والأخبار المالية\s*\|\s*Investment Guide/gi, '')
        .trim();

      if (!cleanLine) continue;

      const norm = cleanLine.toLowerCase();
      // تخطي السطور المتطابقة مع العنوان أو المكررة
      if (norm === normalizedTitle) continue;
      if (seen.has(norm)) continue;
      seen.add(norm);
      cleaned.push(cleanLine);
    }
    return cleaned.join('\n').trim() || raw;
  }, [item.body, item.summary, item.title]);

  const isLong = fullText.length > 700;

  const handleTickerClick = (ticker: string) => {
    if (!ticker) return;
    setSelectedStock(ticker);
    setActiveTab('stocks');
  };

  return (
    <Card className="overflow-hidden border border-border/70 hover:border-border transition-all duration-200 bg-card shadow-sm hover:shadow-md">
      <CardContent className="p-5">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          {/* Main Content Area (الجزء الأكبر للخبر - 8 أعمدة) */}
          <div className="md:col-span-8 flex flex-col justify-between">
            <div>
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
                    <Badge className="bg-loss/10 text-loss dark:text-loss border border-loss/20 text-xs">
                      {t('news.feed.importanceHigh')}
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

              {/* Title — UI-FIX-P2-P3 issue 2.12: market-data items (sentiment/market) are H3 inside the news list, news items stay H2 */}
              {item.category === 'sentiment' || item.category === 'market' ? (
                <h3 className="text-base md:text-lg font-semibold text-foreground leading-snug tracking-tight mb-3">
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
                </h3>
              ) : (
                <h2 className="text-base md:text-xl font-bold text-foreground leading-snug tracking-tight mb-3">
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
              )}

              {/* Featured Image from Source */}
              <SourceImageViewer images={item.image_paths} title={item.title} source={item.source} />

              {/* Full Article Content */}
              <div className="text-sm md:text-base text-foreground/90 leading-relaxed font-normal mt-3 space-y-2 whitespace-pre-line">
                {isLong && !expanded ? (
                  <>
                    <p>{fullText.slice(0, 750)}...</p>
                    <Button
                      variant="link"
                      size="sm"
                      onClick={() => setExpanded(true)}
                      className="p-0 h-auto text-xs font-semibold text-primary"
                    >
                      {t('news.feed.readFullArticle')}
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
                        {t('news.feed.hidePartialText')}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar Area (التحليل والنشر على جنب - 4 أعمدة) */}
          <div className="md:col-span-4 flex flex-col justify-between border-t md:border-t-0 md:border-r md:border-border/60 pt-4 md:pt-0 md:pr-4 gap-3">
            {/* Local AI Decision Insight */}
            <InvestmentDecisionInsight item={item} onTickerClick={handleTickerClick} />

            {/* Sharing and Action Bar */}
            <ShareAndActions item={item} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ==================== MAIN COMPONENT ====================

export function NewsFeedView() {
  const t = useTranslation();
  const [data, setData] = useState<NewsFeedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [marketFilter, setMarketFilter] = useState<'all' | 'EGX' | 'global'>('all');
  // UI-FIX-P2-P3 issue 2.11: paginate news feed — 12 per page (was rendering all at once, felt sparse when only ~7 came back from API)
  const [visibleCount, setVisibleCount] = useState(12);

  const fetchNews = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/news-feed', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setData(json);
      } else {
        setError(json.error || t('news.feed.errorLoad'));
      }
    } catch (err: any) {
      setError(err.message || t('news.feed.errorConnection'));
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
    toast.success(t('news.feed.toastRefreshed'));
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
          (n.title || '').toLowerCase().includes(q) ||
          (n.body && n.body.toLowerCase().includes(q)) ||
          (n.summary && n.summary.toLowerCase().includes(q)) ||
          (n.tickers && n.tickers.some((t) => (t || '').toLowerCase().includes(q))) ||
          (n.source || '').toLowerCase().includes(q)
      );
    }

    return list;
  }, [data?.news, marketFilter, searchQuery]);

  // UI-FIX-P2-P3 issue 2.11: reset visible count when filters/search change
  useEffect(() => {
    setVisibleCount(12);
  }, [marketFilter, searchQuery, data?.news]);

  const visibleNews = useMemo(() => filteredNews.slice(0, visibleCount), [filteredNews, visibleCount]);
  const hasMore = filteredNews.length > visibleNews.length;

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
              <h1 className="text-xl md:text-2xl font-bold text-foreground">{t('news.feed.title')}</h1>
              <p className="text-xs md:text-sm text-muted-foreground mt-0.5">
                {t('news.feed.subtitle')}
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
            <span>{t('news.feed.refresh')}</span>
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
            placeholder={t('news.feed.searchPlaceholder')}
            className="pr-9 h-10 text-sm bg-card border-border"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
            >
              {t('news.feed.clear')}
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
            {t('news.feed.filterAll', { count: data?.news?.length || 0 })}
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
            {t('news.feed.filterEGX')}
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
            {t('news.feed.filterGlobal')}
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
        <Card className="border-loss/30 bg-loss/5">
          <CardContent className="p-6 text-center space-y-2">
            <p className="text-sm font-semibold text-loss dark:text-loss">{error}</p>
            <Button variant="outline" size="sm" onClick={fetchNews}>
              {t('news.feed.retry')}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {!loading && filteredNews.length === 0 && (
        <Card className="border-border/60 bg-card">
          <CardContent className="p-12 text-center space-y-3">
            <Newspaper className="w-10 h-10 mx-auto text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">{t('news.feed.emptyTitle')}</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              {t('news.feed.emptyBody')}
            </p>
          </CardContent>
        </Card>
      )}

      {/* News Feed List */}
      <div className="space-y-4">
        {visibleNews.map((item) => (
          <NewsCard key={item.id} item={item} />
        ))}
      </div>

      {/* Load More — UI-FIX-P2-P3 issue 2.11: paginate (12 per page) instead of dumping all */}
      {hasMore && (
        <div className="flex justify-center pt-4">
          <Button
            variant="outline"
            size="lg"
            onClick={() => setVisibleCount((c) => c + 12)}
            className="min-h-[44px]"
          >
            {t('news.feed.loadMore', { count: filteredNews.length - visibleNews.length })}
          </Button>
        </div>
      )}
    </div>
  );
}
