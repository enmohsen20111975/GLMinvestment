'use client';

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Share2, Copy, Check, Image, Loader2, Download, CheckCircle, Circle, Filter, Send } from 'lucide-react';
import { toast } from 'sonner';
import { toPng } from 'html-to-image';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { OFFICIAL_LINKS_BLOCK } from '@/lib/official-links';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface StockAnalysisResult {
  ticker: string;
  name?: string;
  nameAr?: string;
  price: number;
  change?: number;
  signal: string;
  signalAr?: string;
  confidence?: number;
  sector?: string;
  targetPrice?: number;
  stopLoss?: number;
}

export interface ShareAllAnalysisProps {
  stocks: StockAnalysisResult[];
  title?: string;
  analysisType?: 'scanner' | 'recommendations' | 'deep' | 'portfolio';
  trigger?: React.ReactNode;
  /** فلترة مسبقة - لو محددة، هتظهر الأسهم المصفاة فقط */
  preselectedTickers?: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const APP_LINKS = {
  website: 'https://invist.m2y.net',
  android: 'https://play.google.com/store/apps/details?id=egx.investment',
  ios: '', // Empty until iOS app is released
};

const PLATFORM_NAME = 'دليل الاستثمار';
const PLATFORM_SLOGAN = 'دليلك الذكي للاستثمار في البورصة';

// ─── Helper Functions ─────────────────────────────────────────────────────────

function getSignalColor(signal: string): string {
  const s = (signal || '').toString().toLowerCase();
  if (s.includes('strong buy') || s.includes('شراء قوي')) return '#059669';
  if (s.includes('buy') || s.includes('شراء')) return '#10b981';
  if (s.includes('accumulate') || s.includes('تجميع')) return '#3b82f6';
  if (s.includes('hold') || s.includes('احتفاظ') || s.includes('متابعة')) return '#f59e0b';
  if (s.includes('reduce') || s.includes('تخفيف')) return '#f97316';
  if (s.includes('sell') || s.includes('بيع')) return '#ef4444';
  return '#6b7280';
}

function getSignalEmoji(signal: string): string {
  const s = (signal || '').toString().toLowerCase();
  if (s.includes('strong buy') || s.includes('شراء قوي')) return '🚀';
  if (s.includes('buy') || s.includes('شراء')) return '🟢';
  if (s.includes('accumulate') || s.includes('تجميع')) return '💎';
  if (s.includes('hold') || s.includes('احتفاظ') || s.includes('متابعة')) return '🟡';
  if (s.includes('reduce') || s.includes('تخفيف')) return '🟠';
  if (s.includes('sell') || s.includes('بيع')) return '🔴';
  return '⚪';
}

function isBuySignal(signal: string): boolean {
  const s = (signal || '').toString().toLowerCase();
  return s.includes('buy') || s.includes('شراء') || s.includes('accumulate') || s.includes('تجميع');
}

function isSellSignal(signal: string): boolean {
  const s = (signal || '').toString().toLowerCase();
  return s.includes('sell') || s.includes('بيع') || s.includes('reduce') || s.includes('تخفيف');
}

function isHoldSignal(signal: string): boolean {
  const s = (signal || '').toString().toLowerCase();
  return s.includes('hold') || s.includes('احتفاظ') || s.includes('متابعة');
}

function isAccumulateSignal(signal: string): boolean {
  const s = (signal || '').toString().toLowerCase();
  return s.includes('accumulate') || s.includes('تجميع');
}

function isReduceSignal(signal: string): boolean {
  const s = (signal || '').toString().toLowerCase();
  return s.includes('reduce') || s.includes('تخفيف');
}

// ─── Share Card Component (Hidden, for image generation) ─────────────────────

function AllAnalysisCard({
  stocks,
  title,
  analysisType,
  cardRef,
}: {
  stocks: StockAnalysisResult[];
  title: string;
  analysisType: string;
  cardRef: React.RefObject<HTMLDivElement | null>;
}) {
  const buyStocks = stocks.filter(isBuySignal).slice(0, 5);
  const sellStocks = stocks.filter(isSellSignal).slice(0, 3);

  const analysisTypeLabel: Record<string, string> = {
    scanner: 'المسح الشامل',
    recommendations: 'التوقعات',
    deep: 'التحليل العميق',
    portfolio: 'محفظتي',
  };

  return (
    <div
      ref={cardRef}
      style={{
        width: '650px',
        padding: '0',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
        borderRadius: '20px',
        fontFamily: 'Arial, sans-serif',
        direction: 'rtl',
        color: '#f8fafc',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div style={{
        background: 'linear-gradient(135deg, #059669, #0d9488)',
        padding: '24px 32px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: '22px', fontWeight: 'bold', color: 'white', marginBottom: '6px' }}>
            {title}
          </div>
          <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)' }}>
            {analysisTypeLabel[analysisType] || 'تحليل الأسهم'} • {stocks.length} سهم
          </div>
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{
            background: 'rgba(255,255,255,0.2)',
            padding: '8px 16px',
            borderRadius: '12px',
            color: 'white',
            fontWeight: 'bold',
            fontSize: '14px',
          }}>
            {PLATFORM_NAME}
          </div>
          <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', marginTop: '4px', textAlign: 'left' }} suppressHydrationWarning>
            {new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '24px 32px' }}>
        {/* Buy Signals */}
        {buyStocks.length > 0 && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '16px',
            }}>
              <span style={{ fontSize: '18px' }}>🚀</span>
              <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#10b981' }}>
                أفضل فرص الشراء
              </span>
            </div>
            <div style={{ display: 'grid', gap: '10px' }}>
              {buyStocks.map((stock, i) => (
                <div
                  key={stock.ticker}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    background: 'rgba(16,185,129,0.1)',
                    borderRadius: '12px',
                    border: '1px solid rgba(16,185,129,0.2)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '8px',
                      background: 'linear-gradient(135deg, #059669, #0d9488)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'white',
                      fontWeight: 'bold',
                      fontSize: '12px',
                    }}>
                      {i + 1}
                    </span>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '15px' }}>{stock.ticker}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>{stock.nameAr || stock.name}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ fontWeight: 'bold', fontSize: '15px' }}>{stock.price.toFixed(2)} ج.م</div>
                    <div style={{
                      display: 'inline-block',
                      padding: '2px 8px',
                      borderRadius: '10px',
                      background: getSignalColor(stock.signal) + '20',
                      color: getSignalColor(stock.signal),
                      fontSize: '11px',
                      fontWeight: '600',
                    }}>
                      {getSignalEmoji(stock.signal)} {stock.signalAr || stock.signal}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Sell Signals */}
        {sellStocks.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '16px',
            }}>
              <span style={{ fontSize: '18px' }}>⚠️</span>
              <span style={{ fontSize: '16px', fontWeight: 'bold', color: '#ef4444' }}>
                تنبيهات بيع
              </span>
            </div>
            <div style={{ display: 'grid', gap: '10px' }}>
              {sellStocks.map((stock) => (
                <div
                  key={stock.ticker}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 16px',
                    background: 'rgba(239,68,68,0.1)',
                    borderRadius: '10px',
                    border: '1px solid rgba(239,68,68,0.2)',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 'bold', fontSize: '14px' }}>{stock.ticker}</span>
                    <span style={{ marginRight: '8px', fontSize: '11px', color: '#94a3b8' }}>{stock.nameAr || stock.name}</span>
                  </div>
                  <div style={{
                    padding: '2px 8px',
                    borderRadius: '10px',
                    background: '#ef444420',
                    color: '#ef4444',
                    fontSize: '11px',
                    fontWeight: '600',
                  }}>
                    {stock.signalAr || stock.signal}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats Summary */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '12px',
          marginBottom: '20px',
        }}>
          <div style={{
            background: 'rgba(16,185,129,0.1)',
            padding: '12px',
            borderRadius: '12px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#10b981' }}>
              {stocks.filter(isBuySignal).length}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>شراء</div>
          </div>
          <div style={{
            background: 'rgba(59,130,246,0.1)',
            padding: '12px',
            borderRadius: '12px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#3b82f6' }}>
              {stocks.filter(s => (s.signal || '').toString().toLowerCase().includes('accumulate') || (s.signal || '').toString().toLowerCase().includes('تجميع')).length}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>تجميع</div>
          </div>
          <div style={{
            background: 'rgba(245,158,11,0.1)',
            padding: '12px',
            borderRadius: '12px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#f59e0b' }}>
              {stocks.filter(isHoldSignal).length}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>متابعة</div>
          </div>
          <div style={{
            background: 'rgba(239,68,68,0.1)',
            padding: '12px',
            borderRadius: '12px',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: '20px', fontWeight: 'bold', color: '#ef4444' }}>
              {stocks.filter(isSellSignal).length}
            </div>
            <div style={{ fontSize: '11px', color: '#94a3b8' }}>بيع</div>
          </div>
        </div>

        {/* App Download Links */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,0.2), rgba(13,148,136,0.2))',
          borderRadius: '12px',
          padding: '16px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '10px' }}>
            📱 حمّل تطبيق {PLATFORM_NAME}
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
            <div style={{
              background: 'rgba(255,255,255,0.1)',
              padding: '8px 16px',
              borderRadius: '8px',
              fontSize: '11px',
            }}>
              🤖 Android
            </div>
            {APP_LINKS.ios && (
              <div style={{
                background: 'rgba(255,255,255,0.1)',
                padding: '8px 16px',
                borderRadius: '8px',
                fontSize: '11px',
              }}>
                🍎 iOS
              </div>
            )}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px' }}>
            {APP_LINKS.website}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={{
        padding: '16px 32px',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        background: 'rgba(0,0,0,0.2)',
      }}>
        <span style={{ fontSize: '10px', color: '#64748b' }}>
          ⚠️ هذا التحليل لأغراض تعليمية فقط ولا يعتبر نصيحة استثمارية
        </span>
        <span style={{ fontSize: '10px', color: '#64748b' }}>
          {PLATFORM_NAME}
        </span>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function ShareAllAnalysis({
  stocks,
  title = 'تحليل السوق',
  analysisType = 'scanner',
  trigger,
  preselectedTickers,
}: ShareAllAnalysisProps) {
  const [open, setOpen] = useState(false);
  const [generatingImage, setGeneratingImage] = useState(false);
  const [copied, setCopied] = useState(false);
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(new Set());
  const [signalFilter, setSignalFilter] = useState<'all' | 'buy' | 'sell' | 'hold'>('all');
  const [sendingToTelegram, setSendingToTelegram] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // Filter stocks based on signal filter
  const filteredStocks = useMemo(() => {
    let result = stocks;
    
    // Apply signal filter
    if (signalFilter === 'buy') {
      result = result.filter(isBuySignal);
    } else if (signalFilter === 'sell') {
      result = result.filter(isSellSignal);
    } else if (signalFilter === 'hold') {
      result = result.filter(isHoldSignal);
    }
    
    // Apply preselected tickers if provided
    if (preselectedTickers && preselectedTickers.length > 0) {
      result = result.filter(s => preselectedTickers.includes(s.ticker));
    }
    
    return result;
  }, [stocks, signalFilter, preselectedTickers]);

  // Stocks to share (either selected or filtered)
  const stocksToShare = useMemo(() => {
    if (selectedTickers.size > 0) {
      return stocks.filter(s => selectedTickers.has(s.ticker));
    }
    return filteredStocks.slice(0, 10); // Limit to 10 for sharing
  }, [stocks, selectedTickers, filteredStocks]);

  // Toggle stock selection
  const toggleStock = useCallback((ticker: string) => {
    setSelectedTickers(prev => {
      const next = new Set(prev);
      if (next.has(ticker)) {
        next.delete(ticker);
      } else {
        next.add(ticker);
      }
      return next;
    });
  }, []);

  // Select all filtered
  const selectAllFiltered = useCallback(() => {
    setSelectedTickers(new Set(filteredStocks.map(s => s.ticker)));
  }, [filteredStocks]);

  // Clear selection
  const clearSelection = useCallback(() => {
    setSelectedTickers(new Set());
  }, []);

  // Generate share text (Telegram limit: 4096 chars)
  const shareText = useMemo(() => {
    const buyStocks = stocksToShare.filter(isBuySignal).slice(0, 5);
    const sellStocks = stocksToShare.filter(isSellSignal).slice(0, 3);

    const stats = {
      buy: stocksToShare.filter(isBuySignal).length,
      accumulate: stocksToShare.filter(s => (s.signal || '').toString().toLowerCase().includes('accumulate') || (s.signal || '').toString().toLowerCase().includes('تجميع')).length,
      hold: stocksToShare.filter(isHoldSignal).length,
      sell: stocksToShare.filter(isSellSignal).length,
    };

    let text = `📊 ${title}\n`;
    text += `━━━━━━━━━━━━━━━━━━\n`;
    text += `📈 تم تحليل ${stocksToShare.length} سهم\n\n`;

    text += `📊 الملخص:\n`;
    text += `🟢 شراء: ${stats.buy} | 💎 تجميع: ${stats.accumulate}\n`;
    text += `🟡 متابعة: ${stats.hold} | 🔴 بيع: ${stats.sell}\n\n`;

    if (buyStocks.length > 0) {
      text += `🚀 أفضل فرص الشراء:\n`;
      buyStocks.forEach((s, i) => {
        text += `${i + 1}. ${s.ticker} - ${s.price.toFixed(2)} ج.م`;
        if (s.change !== undefined) {
          text += ` (${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%)`;
        }
        text += `\n   ${getSignalEmoji(s.signal)} ${s.signalAr || s.signal}`;
        if (s.confidence) text += ` - ثقة: ${s.confidence.toFixed(0)}%`;
        text += `\n`;
      });
      text += `\n`;
    }

    if (sellStocks.length > 0) {
      text += `⚠️ تنبيهات بيع:\n`;
      sellStocks.forEach(s => {
        text += `• ${s.ticker} - ${s.signalAr || s.signal}\n`;
      });
      text += `\n`;
    }

    text += `━━━━━━━━━━━━━━━━━━\n`;
    text += `🚀 ${PLATFORM_NAME}\n`;
    text += OFFICIAL_LINKS_BLOCK;
    text += `\n\n⚠️ تعليمي فقط`;

    // Ensure message is under Telegram limit (4096 chars)
    if (text.length > 4000) {
      text = text.substring(0, 3950) + '...';
    }

    return text;
  }, [stocksToShare, title]);

  // Send to Telegram Channel (with pie chart showing signal distribution)
  const handleSendToTelegram = useCallback(async () => {
    if (stocksToShare.length === 0) {
      toast.error('اختر على الأقل سهم واحد للمشاركة');
      return;
    }

    setSendingToTelegram(true);
    try {
      // Calculate signal distribution for pie chart
      const buyCount = stocksToShare.filter(isBuySignal).length;
      const accumulateCount = stocksToShare.filter(s =>
        (s.signal || '').toString().toLowerCase().includes('accumulate') ||
        (s.signal || '').toString().toLowerCase().includes('تجميع')
      ).length;
      const holdCount = stocksToShare.filter(isHoldSignal).length;
      const sellCount = stocksToShare.filter(isSellSignal).length;

      const response = await fetch('/api/telegram/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: shareText,
          title: title,
          // Send signal distribution chart
          chartType: 'signal_distribution',
          chartData: {
            buy: buyCount,
            accumulate: accumulateCount,
            hold: holdCount,
            sell: sellCount
          },
          includeLinks: true
        }),
      });

      const data = await response.json();

      if (data.success) {
        const imageMsg = data.hasImage ? ' (مع رسم بياني)' : '';
        toast.success(`تم الإرسال إلى قناة تليجرام بنجاح!${imageMsg}`);
        setOpen(false);
      } else {
        toast.error(data.error || 'فشل في الإرسال إلى تليجرام');
      }
    } catch (err) {
      console.error('Telegram send error:', err);
      toast.error('حدث خطأ أثناء الإرسال');
    } finally {
      setSendingToTelegram(false);
    }
  }, [stocksToShare, shareText, title]);

  // Generate image
  const generateImage = useCallback(async (): Promise<Blob | null> => {
    if (!cardRef.current) return null;
    try {
      setGeneratingImage(true);
      const dataUrl = await toPng(cardRef.current, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: '#0f172a',
      });
      const res = await fetch(dataUrl);
      return await res.blob();
    } catch (err) {
      console.error('Image generation failed:', err);
      return null;
    } finally {
      setGeneratingImage(false);
    }
  }, []);

  // Copy text
  const handleCopyText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      toast.success('تم نسخ النص بنجاح');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('فشل نسخ النص');
    }
  }, [shareText]);

  // Download image
  const handleDownloadImage = useCallback(async () => {
    const blob = await generateImage();
    if (!blob) {
      toast.error('فشل في إنشاء الصورة');
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `market_analysis_${new Date().toISOString().split('T')[0]}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('تم تحميل الصورة بنجاح');
  }, [generateImage]);

  // Native share
  const handleNativeShare = useCallback(async () => {
    if (!navigator.share) {
      toast.error('المشاركة غير مدعومة في هذا المتصفح');
      return;
    }
    try {
      const imageBlob = await generateImage();
      const shareData: ShareData = {
        title: `${title} - ${PLATFORM_NAME}`,
        text: shareText,
      };
      if (imageBlob && navigator.canShare) {
        const file = new File([imageBlob], 'market_analysis.png', { type: 'image/png' });
        if (navigator.canShare({ files: [file] })) {
          shareData.files = [file];
        }
      }
      await navigator.share(shareData);
      setOpen(false);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        console.error('Share failed:', err);
        toast.error('فشل في المشاركة');
      }
    }
  }, [title, shareText, generateImage]);

  // Social share URLs
  const shareUrls = useMemo(() => ({
    twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(shareText)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(APP_LINKS.website)}&text=${encodeURIComponent(shareText)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(APP_LINKS.website)}&quote=${encodeURIComponent(shareText)}`,
  }), [shareText]);

  const defaultTrigger = (
    <Button variant="outline" size="sm" className="gap-2">
      <Share2 className="w-4 h-4" />
      مشاركة التحليلات
    </Button>
  );

  return (
    <>
      {/* Hidden card for image generation */}
      <div style={{ position: 'fixed', left: '-9999px', top: '-9999px', zIndex: -1 }}>
        <AllAnalysisCard
          stocks={stocksToShare}
          title={title}
          analysisType={analysisType}
          cardRef={cardRef}
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          {trigger || defaultTrigger}
        </DialogTrigger>
        
        <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right flex items-center gap-2">
              <Share2 className="w-5 h-5 text-primary" />
              مشاركة التحليلات
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 overflow-hidden flex flex-col gap-4">
            {/* Signal Filter */}
            <div className="flex items-center gap-2 flex-wrap">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">فلترة:</span>
              <div className="flex gap-1 flex-wrap">
                {/* Filter tabs - showing correct counts based on actual signal values */}
              {[
                  { key: 'all', label: 'الكل', count: stocks.length },
                  { key: 'buy', label: 'شراء', count: stocks.filter(s => {
                    const sig = (s.signal || '').toString().toLowerCase();
                    return sig.includes('buy') || sig.includes('شراء');
                  }).length },
                  { key: 'sell', label: 'بيع', count: stocks.filter(s => {
                    const sig = (s.signal || '').toString().toLowerCase();
                    return sig.includes('sell') || sig.includes('بيع');
                  }).length },
                  { key: 'hold', label: 'متابعة', count: stocks.filter(s => {
                    const sig = (s.signal || '').toString().toLowerCase();
                    return sig.includes('hold') || sig.includes('احتفاظ') || sig.includes('متابعة');
                  }).length },
                ].map(({ key, label, count }) => (
                  <Button
                    key={key}
                    variant={signalFilter === key ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setSignalFilter(key as typeof signalFilter)}
                  >
                    {label} ({count})
                  </Button>
                ))}
              </div>
            </div>

            {/* Selection Actions */}
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                تم اختيار {selectedTickers.size} من {filteredStocks.length} سهم
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={selectAllFiltered}>
                  اختيار الكل
                </Button>
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={clearSelection}>
                  إلغاء الاختيار
                </Button>
              </div>
            </div>

            {/* Stock List */}
            <ScrollArea className="flex-1 max-h-48 border rounded-lg">
              <div className="p-2 space-y-1">
                {filteredStocks.slice(0, 20).map((stock) => (
                  <button
                    key={stock.ticker}
                    onClick={() => toggleStock(stock.ticker)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors text-right",
                      selectedTickers.has(stock.ticker)
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-muted"
                    )}
                  >
                    {selectedTickers.has(stock.ticker) ? (
                      <CheckCircle className="w-4 h-4 text-primary flex-shrink-0" />
                    ) : (
                      <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    )}
                    <span className="font-bold">{stock.ticker}</span>
                    <span className="text-muted-foreground truncate flex-1">{stock.nameAr || stock.name}</span>
                    <Badge 
                      variant="outline" 
                      className="text-[10px]"
                      style={{ color: getSignalColor(stock.signal), borderColor: getSignalColor(stock.signal) }}
                    >
                      {stock.signalAr || stock.signal}
                    </Badge>
                  </button>
                ))}
              </div>
            </ScrollArea>

            {/* Share Actions */}
            <div className="space-y-3 pt-2 border-t">
              {/* Native Share */}
              {typeof navigator !== 'undefined' && navigator.share && (
                <button
                  onClick={handleNativeShare}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                >
                  <Share2 className="w-5 h-5" />
                  <span className="font-medium">مشاركة...</span>
                </button>
              )}

              {/* Copy & Download */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={handleCopyText}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-muted hover:bg-muted/80 transition-colors"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  <span className="text-sm">{copied ? 'تم النسخ!' : 'نسخ النص'}</span>
                </button>
                <button
                  onClick={handleDownloadImage}
                  disabled={generatingImage}
                  className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-muted hover:bg-muted/80 transition-colors disabled:opacity-50"
                >
                  {generatingImage ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span className="text-sm">{generatingImage ? 'جارٍ...' : 'تحميل صورة'}</span>
                </button>
              </div>

              {/* Send to Telegram Channel */}
              <button
                onClick={handleSendToTelegram}
                disabled={sendingToTelegram || stocksToShare.length === 0}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-[#0088cc] text-white hover:bg-[#0077b5] transition-colors disabled:opacity-50"
              >
                {sendingToTelegram ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
                <span className="font-medium">
                  {sendingToTelegram ? 'جارٍ الإرسال...' : 'إرسال إلى قناة تليجرام'}
                </span>
              </button>

              {/* Social Media */}
              <div className="grid grid-cols-4 gap-2">
                <SocialBtn label="واتساب" color="#25D366" onClick={() => window.open(shareUrls.whatsapp, '_blank')} />
                <SocialBtn label="تليجرام" color="#0088cc" onClick={() => window.open(shareUrls.telegram, '_blank')} />
                <SocialBtn label="X" color="#000" onClick={() => window.open(shareUrls.twitter, '_blank', 'width=600,height=400')} />
                <SocialBtn label="فيسبوك" color="#1877F2" onClick={() => window.open(shareUrls.facebook, '_blank', 'width=600,height=400')} />
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Social Button ────────────────────────────────────────────────────────────

function SocialBtn({
  label,
  color,
  onClick,
}: {
  label: string;
  color: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors text-xs font-medium"
    >
      <span style={{ color }}>{label}</span>
    </button>
  );
}
