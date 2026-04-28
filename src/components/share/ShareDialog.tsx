'use client';

import React, { useState, useRef, useCallback } from 'react';
import {
  Share2,
  Twitter,
  Facebook,
  Link2,
  Copy,
  Check,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  Send,
  Linkedin,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';

// ==================== TYPES ====================

export interface ShareStockData {
  ticker: string;
  name: string;
  nameAr?: string;
  price: number;
  change?: number | null;
  recommendation?: string;
  recommendationAr?: string;
  confidence?: number;
  metrics?: {
    pe?: number;
    roe?: number;
    pb?: number;
    dividendYield?: number;
    eps?: number;
    debtToEquity?: number;
  };
  fairValue?: number;
  upsidePotential?: number;
  targetPrice?: number;
  stopLoss?: number;
  riskLevel?: string;
  sector?: string;
}

interface ShareDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stockData: ShareStockData;
}

// ==================== HELPERS ====================

function getRecommendationColor(rec?: string): { bg: string; text: string } {
  if (!rec) return { bg: '#f5f5f5', text: '#6b7280' };
  const r = rec.toLowerCase();
  if (r.includes('strong buy')) return { bg: '#059669', text: '#ffffff' };
  if (r.includes('buy') || r.includes('شراء')) return { bg: '#16a34a', text: '#ffffff' };
  if (r.includes('hold') || r.includes('احتفاظ') || r.includes('متابعة')) return { bg: '#d97706', text: '#ffffff' };
  if (r.includes('sell') || r.includes('بيع') || r.includes('avoid') || r.includes('تجنب')) return { bg: '#ea580c', text: '#ffffff' };
  if (r.includes('strong sell') || r.includes('strong avoid')) return { bg: '#dc2626', text: '#ffffff' };
  return { bg: '#6b7280', text: '#ffffff' };
}

function getRecommendationLabelAr(rec?: string, fallback?: string): string {
  if (fallback) return fallback;
  if (!rec) return 'غير محدد';
  const r = rec.toLowerCase();
  if (r.includes('strong buy')) return 'شراء قوي';
  if (r.includes('buy') && !r.includes('strong')) return 'شراء';
  if (r.includes('hold') || r.includes('متابعة')) return 'احتفاظ';
  if (r.includes('sell') || r.includes('بيع') || r.includes('avoid') || r.includes('تجنب')) return 'تجنب';
  if (r.includes('strong sell') || r.includes('strong avoid')) return 'تجنب قوي';
  return rec;
}

function generateShareText(data: ShareStockData): string {
  const name = data.nameAr || data.name;
  const rec = getRecommendationLabelAr(data.recommendation, data.recommendationAr);
  const changeStr = data.change != null
    ? ` (${data.change >= 0 ? '+' : ''}${data.change.toFixed(2)}%)`
    : '';

  let text = `📊 تحليل سهم ${data.ticker} - ${name}\n`;
  text += `💰 السعر الحالي: ${data.price.toFixed(2)} ج.م${changeStr}\n`;

  if (data.recommendation || data.recommendationAr) {
    text += `🎯 التوصية: ${rec}\n`;
  }

  if (data.metrics) {
    if (data.metrics.pe != null) text += `📈 P/E: ${data.metrics.pe.toFixed(1)}\n`;
    if (data.metrics.roe != null) text += `📊 ROE: ${data.metrics.roe.toFixed(1)}%\n`;
    if (data.metrics.dividendYield != null) text += `💸 العائد: ${data.metrics.dividendYield.toFixed(1)}%\n`;
  }

  if (data.fairValue) {
    text += `🏢 القيمة العادلة: ${data.fairValue.toFixed(2)} ج.م`;
    if (data.upsidePotential != null) {
      text += ` (${data.upsidePotential > 0 ? '+' : ''}${data.upsidePotential.toFixed(1)}%)`;
    }
    text += '\n';
  }

  text += `\n🔑 تحليل منصة EGX للاستثمار`;
  text += `\n⚠️ هذا التحليل لأغراض تعليمية فقط`;

  return text;
}

function getPlatformUrl(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin;
  }
  return 'https://egx-platform.com';
}

// ==================== SOCIAL SHARE FUNCTIONS ====================

function shareToTwitter(text: string, url: string) {
  const encoded = encodeURIComponent(text);
  const encodedUrl = encodeURIComponent(url);
  window.open(`https://twitter.com/intent/tweet?text=${encoded}&url=${encodedUrl}`, '_blank', 'noopener,noreferrer,width=600,height=400');
}

function shareToFacebook(text: string, url: string) {
  const encodedUrl = encodeURIComponent(url);
  const encodedQuote = encodeURIComponent(text.split('\n')[0]);
  window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedQuote}`, '_blank', 'noopener,noreferrer,width=600,height=400');
}

function shareToWhatsApp(text: string) {
  const encoded = encodeURIComponent(text);
  window.open(`https://wa.me/?text=${encoded}`, '_blank', 'noopener');
}

function shareToTelegram(text: string, url: string) {
  const encoded = encodeURIComponent(text);
  const encodedUrl = encodeURIComponent(url);
  window.open(`https://t.me/share/url?url=${encodedUrl}&text=${encoded}`, '_blank', 'noopener');
}

function shareToLinkedIn(text: string, url: string) {
  const encodedUrl = encodeURIComponent(url);
  window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`, '_blank', 'noopener,noreferrer,width=600,height=400');
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('تم نسخ النص بنجاح');
  } catch {
    // Fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    toast.success('تم نسخ النص بنجاح');
  }
}

async function copyLinkToClipboard() {
  const url = getPlatformUrl();
  try {
    await navigator.clipboard.writeText(url);
    toast.success('تم نسخ الرابط بنجاح');
  } catch {
    toast.error('فشل في نسخ الرابط');
  }
}

// ==================== WEB SHARE API ====================

async function nativeWebShare(data: ShareStockData, canvas?: HTMLCanvasElement | null) {
  if (!navigator.share) return false;

  const shareText = generateShareText(data);

  const shareData: ShareData = {
    title: `تحليل ${data.ticker} - ${data.nameAr || data.name}`,
    text: shareText,
    url: getPlatformUrl(),
  };

  if (canvas) {
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png', 1.0)
      );
      if (blob) {
        const file = new File([blob], `${data.ticker}_analysis.png`, { type: 'image/png' });
        shareData.files = [file];
      }
    } catch {
      // Fall back to text-only share
    }
  }

  try {
    await navigator.share(shareData);
    return true;
  } catch (err) {
    // User cancelled or error — not a failure
    if ((err as Error).name !== 'AbortError') {
      console.error('Web Share API error:', err);
    }
    return false;
  }
}

// ==================== IMAGE GENERATION ====================

function ShareImageCard({ data, targetRef }: { data: ShareStockData; targetRef: React.RefObject<HTMLDivElement | null> }) {
  const recColor = getRecommendationColor(data.recommendation || data.recommendationAr);
  const recLabel = getRecommendationLabelAr(data.recommendation, data.recommendationAr);
  const name = data.nameAr || data.name;
  const today = new Date().toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const changePercent = data.change ?? 0;
  const isPositive = changePercent >= 0;

  return (
    <div
      ref={targetRef}
      style={{
        width: '480px',
        fontFamily: 'Segoe UI, Tahoma, Arial, sans-serif',
        direction: 'rtl',
        background: 'linear-gradient(135deg, #059669 0%, #0d9488 50%, #0f766e 100%)',
        borderRadius: '16px',
        padding: '0',
        overflow: 'hidden',
        color: '#ffffff',
      }}
    >
      {/* Header Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px 28px 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: 'rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '18px',
              fontWeight: 'bold',
            }}
          >
            EGX
          </div>
          <div>
            <div style={{ fontSize: '14px', fontWeight: 'bold', color: '#ffffff' }}>
              منصة EGX للاستثمار
            </div>
            <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.7)' }}>
              تحليل الأسهم والبورصة المصرية
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'left', fontSize: '11px', color: 'rgba(255,255,255,0.7)' }}>
          {today}
        </div>
      </div>

      {/* White Card */}
      <div
        style={{
          margin: '0 16px 16px',
          background: '#ffffff',
          borderRadius: '12px',
          padding: '24px',
          color: '#1f2937',
        }}
      >
        {/* Ticker + Name */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '16px' }}>
          <div>
            <div style={{ fontSize: '28px', fontWeight: '800', color: '#065f46', letterSpacing: '-0.5px' }}>
              {data.ticker}
            </div>
            <div style={{ fontSize: '14px', color: '#6b7280', marginTop: '2px' }}>
              {name}
            </div>
            {data.sector && (
              <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                {data.sector}
              </div>
            )}
          </div>
          {/* Recommendation Badge */}
          {data.recommendation && (
            <div
              style={{
                background: recColor.bg,
                color: recColor.text,
                padding: '6px 16px',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '700',
                whiteSpace: 'nowrap',
                direction: 'rtl',
              }}
            >
              {recLabel}
            </div>
          )}
        </div>

        {/* Price + Change */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '20px' }}>
          <span style={{ fontSize: '32px', fontWeight: '800', color: '#111827', letterSpacing: '-0.5px' }}>
            {data.price.toFixed(2)}
          </span>
          <span style={{ fontSize: '13px', color: '#6b7280' }}>ج.م</span>
          {data.change != null && (
            <span
              style={{
                fontSize: '15px',
                fontWeight: '700',
                color: isPositive ? '#059669' : '#dc2626',
                direction: 'ltr',
              }}
            >
              {isPositive ? '▲' : '▼'} {Math.abs(changePercent).toFixed(2)}%
            </span>
          )}
        </div>

        {/* Separator */}
        <div style={{ height: '1px', background: '#e5e7eb', margin: '0 -4px 16px' }} />

        {/* Metrics Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
          {data.metrics?.pe != null && (
            <MetricBox label="P/E" value={data.metrics.pe.toFixed(1)} />
          )}
          {data.metrics?.roe != null && (
            <MetricBox label="ROE" value={`${data.metrics.roe.toFixed(1)}%`} highlight />
          )}
          {data.metrics?.pb != null && (
            <MetricBox label="P/B" value={data.metrics.pb.toFixed(1)} />
          )}
          {data.metrics?.dividendYield != null && (
            <MetricBox label="العائد" value={`${data.metrics.dividendYield.toFixed(1)}%`} highlight />
          )}
          {data.metrics?.eps != null && (
            <MetricBox label="EPS" value={`${data.metrics.eps.toFixed(2)}`} />
          )}
          {data.metrics?.debtToEquity != null && (
            <MetricBox label="دين/حقوق" value={data.metrics.debtToEquity.toFixed(2)} />
          )}
          {data.fairValue && (
            <MetricBox label="القيمة العادلة" value={data.fairValue.toFixed(2)} highlight />
          )}
          {data.upsidePotential != null && (
            <MetricBox
              label="إمكانية النمو"
              value={`${data.upsidePotential > 0 ? '+' : ''}${data.upsidePotential.toFixed(1)}%`}
              highlight={data.upsidePotential > 0}
              negative={data.upsidePotential < 0}
            />
          )}
          {data.confidence != null && (
            <MetricBox label="مستوى الثقة" value={`${data.confidence.toFixed(0)}%`} />
          )}
        </div>

        {/* Target / Stop Loss */}
        {(data.targetPrice || data.stopLoss) && (
          <>
            <div style={{ height: '1px', background: '#e5e7eb', margin: '16px -4px' }} />
            <div style={{ display: 'flex', gap: '24px', justifyContent: 'center' }}>
              {data.targetPrice && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '2px' }}>الهدف</div>
                  <div style={{ fontSize: '16px', fontWeight: '700', color: '#059669' }}>
                    {data.targetPrice.toFixed(2)}
                  </div>
                </div>
              )}
              {data.stopLoss && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '2px' }}>وقف الخسارة</div>
                  <div style={{ fontSize: '16px', fontWeight: '700', color: '#dc2626' }}>
                    {data.stopLoss.toFixed(2)}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Footer / Watermark */}
      <div
        style={{
          padding: '0 28px 16px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)' }}>
          Generated by EGX Analysis Platform • {today}
        </div>
      </div>
    </div>
  );
}

function MetricBox({
  label,
  value,
  highlight,
  negative,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      style={{
        background: highlight ? '#ecfdf5' : negative ? '#fef2f2' : '#f9fafb',
        borderRadius: '8px',
        padding: '10px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '10px', color: '#9ca3af', marginBottom: '4px' }}>{label}</div>
      <div
        style={{
          fontSize: '14px',
          fontWeight: '700',
          color: highlight ? '#059669' : negative ? '#dc2626' : '#374151',
          direction: 'ltr',
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ==================== SOCIAL SHARE BUTTON ====================

function SocialShareButton({
  icon: Icon,
  label,
  color,
  bgColor,
  onClick,
}: {
  icon: React.ElementType;
  label: string;
  color: string;
  bgColor: string;
  onClick: () => void;
}) {
  return (
    <Button
      variant="outline"
      className="flex-1 min-w-0 flex-col gap-2 h-auto py-4 px-2 hover:scale-[1.02] transition-transform"
      onClick={onClick}
    >
      <div
        className="w-10 h-10 rounded-full flex items-center justify-center"
        style={{ backgroundColor: bgColor }}
      >
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <span className="text-[10px] font-medium text-foreground leading-tight text-center">{label}</span>
    </Button>
  );
}

// ==================== MAIN COMPONENT ====================

export function ShareDialog({ open, onOpenChange, stockData }: ShareDialogProps) {
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const imageTargetRef = useRef<HTMLDivElement>(null);
  const generatedCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const shareText = generateShareText(stockData);
  const platformUrl = getPlatformUrl();

  // Try native share when dialog opens (mobile)
  const handleNativeShare = useCallback(async () => {
    const canShare = typeof navigator !== 'undefined' && !!navigator.share;
    if (!canShare) return false;

    const supportsFiles = navigator.share !== undefined && typeof navigator.canShare === 'function';
    if (supportsFiles && generatedCanvasRef.current) {
      return await nativeWebShare(stockData, generatedCanvasRef.current);
    }
    return await nativeWebShare(stockData);
  }, [stockData]);

  const handleOpenChange = useCallback(
    async (newOpen: boolean) => {
      if (newOpen) {
        const shared = await handleNativeShare();
        if (shared) {
          onOpenChange(false);
          return;
        }
      } else {
        // Cleanup
        setGeneratedImage(null);
        setCopied(false);
        generatedCanvasRef.current = null;
      }
      onOpenChange(newOpen);
    },
    [handleNativeShare, onOpenChange]
  );

  // Copy link
  const handleCopyLink = async () => {
    await copyLinkToClipboard();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Social shares
  const handleTwitter = () => shareToTwitter(shareText, platformUrl);
  const handleFacebook = () => shareToFacebook(shareText, platformUrl);
  const handleWhatsApp = () => shareToWhatsApp(shareText);
  const handleTelegram = () => shareToTelegram(shareText, platformUrl);
  const handleLinkedIn = () => shareToLinkedIn(shareText, platformUrl);
  const handleCopyText = async () => {
    await copyToClipboard(shareText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Image generation
  const handleGenerateImage = async () => {
    if (!imageTargetRef.current) return;
    setGenerating(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(imageTargetRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: null,
        logging: false,
      });
      generatedCanvasRef.current = canvas;
      const dataUrl = canvas.toDataURL('image/png');
      setGeneratedImage(dataUrl);
      toast.success('تم إنشاء الصورة بنجاح');
    } catch (err) {
      console.error('Image generation error:', err);
      toast.error('حدث خطأ أثناء إنشاء الصورة');
    } finally {
      setGenerating(false);
    }
  };

  const handleDownloadImage = () => {
    if (!generatedImage) return;
    const link = document.createElement('a');
    link.download = `${stockData.ticker}_analysis_${new Date().toISOString().split('T')[0]}.png`;
    link.href = generatedImage;
    link.click();
    toast.success('جارٍ تحميل الصورة...');
  };

  const handleShareImage = async () => {
    if (generatedCanvasRef.current) {
      const shared = await nativeWebShare(stockData, generatedCanvasRef.current);
      if (!shared) {
        toast.info('استخدم زر التحميل لحفظ الصورة ثم شاركها');
      }
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="sm:max-w-lg sm:mx-auto sm:mb-4 sm:rounded-2xl max-h-[90vh] overflow-y-auto"
      >
        <SheetHeader className="text-right" dir="rtl">
          <SheetTitle className="text-lg flex items-center gap-2">
            <Share2 className="w-5 h-5 text-emerald-600" />
            مشاركة تحليل {stockData.ticker}
          </SheetTitle>
          <SheetDescription>
            شارك تحليل السهم على وسائل التواصل الاجتماعي
          </SheetDescription>
        </SheetHeader>

        <Tabs defaultValue="text" className="mt-2" dir="rtl">
          <TabsList className="w-full">
            <TabsTrigger value="text" className="flex-1 gap-1.5">
              <MessageCircle className="w-3.5 h-3.5" />
              مشاركة كنص
            </TabsTrigger>
            <TabsTrigger value="image" className="flex-1 gap-1.5">
              <ImageIcon className="w-3.5 h-3.5" />
              مشاركة كصورة
            </TabsTrigger>
          </TabsList>

          {/* Text Share Tab */}
          <TabsContent value="text" className="space-y-4 mt-4">
            {/* Preview */}
            <div className="rounded-xl border bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground mb-2 font-medium">معاينة النص:</p>
              <pre
                className="text-xs text-foreground whitespace-pre-wrap leading-relaxed font-sans"
                dir="rtl"
              >
                {shareText}
              </pre>
            </div>

            <Separator />

            {/* Social Buttons */}
            <div className="grid grid-cols-3 gap-3">
              <SocialShareButton
                icon={Twitter}
                label="تويتر / X"
                color="#ffffff"
                bgColor="#1DA1F2"
                onClick={handleTwitter}
              />
              <SocialShareButton
                icon={Facebook}
                label="فيسبوك"
                color="#ffffff"
                bgColor="#1877F2"
                onClick={handleFacebook}
              />
              <SocialShareButton
                icon={MessageCircle}
                label="واتساب"
                color="#ffffff"
                bgColor="#25D366"
                onClick={handleWhatsApp}
              />
              <SocialShareButton
                icon={Send}
                label="تيليجرام"
                color="#ffffff"
                bgColor="#0088CC"
                onClick={handleTelegram}
              />
              <SocialShareButton
                icon={Linkedin}
                label="لينكدإن"
                color="#ffffff"
                bgColor="#0A66C2"
                onClick={handleLinkedIn}
              />
              <Button
                variant="outline"
                className="flex-1 min-w-0 flex-col gap-2 h-auto py-4 px-2 hover:scale-[1.02] transition-transform"
                onClick={handleCopyText}
              >
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  {copied ? (
                    <Check className="w-5 h-5 text-emerald-600" />
                  ) : (
                    <Copy className="w-5 h-5 text-foreground" />
                  )}
                </div>
                <span className="text-[10px] font-medium text-foreground leading-tight text-center">
                  {copied ? 'تم النسخ' : 'نسخ النص'}
                </span>
              </Button>
            </div>

            {/* Copy Link */}
            <div className="flex items-center gap-2">
              <div className="flex-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground truncate" dir="ltr">
                {platformUrl}
              </div>
              <Button
                variant="outline"
                size="sm"
                className={cn('gap-2 flex-shrink-0', copied && 'border-emerald-300 bg-emerald-50')}
                onClick={handleCopyLink}
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Link2 className="w-3.5 h-3.5" />
                )}
                {copied ? 'تم' : 'نسخ الرابط'}
              </Button>
            </div>
          </TabsContent>

          {/* Image Share Tab */}
          <TabsContent value="image" className="space-y-4 mt-4">
            {/* Hidden template for html2canvas */}
            <div
              className="absolute left-[-9999px] top-[-9999px]"
              aria-hidden="true"
            >
              <ShareImageCard data={stockData} targetRef={imageTargetRef} />
            </div>

            {/* Image Preview / Generate */}
            {generatedImage ? (
              <div className="space-y-3">
                <div className="rounded-xl border overflow-hidden">
                  <img
                    src={generatedImage}
                    alt={`تحليل ${stockData.ticker}`}
                    className="w-full h-auto"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleDownloadImage}
                    className="flex-1 gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <ImageIcon className="w-4 h-4" />
                    تحميل الصورة
                  </Button>
                  <Button
                    onClick={handleShareImage}
                    variant="outline"
                    className="flex-1 gap-2"
                  >
                    <Share2 className="w-4 h-4" />
                    مشاركة الصورة
                  </Button>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setGeneratedImage(null)}
                  className="w-full text-xs text-muted-foreground"
                >
                  إعادة إنشاء الصورة
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 p-8 text-center">
                  <ImageIcon className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground mb-1">
                    إنشاء بطاقة تحليل احترافية
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    بطاقة فيها جميع بيانات السهم والتوصية لتشاركها كصورة
                  </p>
                </div>
                <Button
                  onClick={handleGenerateImage}
                  disabled={generating}
                  className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
                >
                  {generating ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <ImageIcon className="w-4 h-4" />
                  )}
                  {generating ? 'جارٍ إنشاء الصورة...' : 'إنشاء صورة المشاركة'}
                </Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
