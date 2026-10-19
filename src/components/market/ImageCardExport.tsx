'use client';

import React, { useRef, useState, useCallback, ReactNode } from 'react';
import { toPng } from 'html-to-image';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Download, Send, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * ImageCardExport
 *
 * Wrapper عام لأي "بطاقة صورة" قابلة للتصدير. يوفر:
 * 1. معاينة البطاقة (children مع ref)
 * 2. زر "تحميل صورة" — يحوّل البطاقة إلى PNG عبر html-to-image
 * 3. زر "نشر على تيليجرام" — يرسل الصورة لـ /api/market/publish-status-image
 *
 * Props:
 * - title: عنوان القسم (مثلاً "بطاقة المستثمر")
 * - description: وصف صغير
 * - filename: اسم الملف عند التحميل (بدون امتداد)
 * - telegramCaption: كابشن النشر على تيليجرام
 * - telegramMarket: السوق الحالي (للـ API)
 * - accentColor: لون الأزرار (hex)
 * - emptyHint: نص يظهر لو مفيش بيانات
 * - hasData: لو false بيخفي الأزرار ويعرض رسالة "قيد التحليل"
 * - children: البطاقة نفسها (لازم تقبل ref عبر cardRef — بنمررها للـ child)
 *
 * الاستخدام:
 * <ImageCardExport ...>
 *   <PersonaImageCard ref={cardRef} ... />
 * </ImageCardExport>
 *
 * ملاحظة: الـ children لازم يكونوا عنصر واحد بيقبل ref (forwardRef).
 * بنستخدم cloneRef عشان نمرر الـ ref للـ child.
 */
export function ImageCardExport({
  title,
  description,
  filename,
  telegramCaption,
  telegramMarket = 'EGX',
  accentColor = '#ea580c',
  borderClass = 'border-orange-200',
  bgClass = 'bg-gradient-to-br from-orange-50 via-warning to-orange-100/40',
  hasData = true,
  emptyHint = 'قيد التحليل — البيانات بتتحدث كل دورة',
  children,
}: {
  title: string;
  description?: string;
  filename: string;
  telegramCaption: string;
  telegramMarket?: string;
  accentColor?: string;
  borderClass?: string;
  bgClass?: string;
  hasData?: boolean;
  emptyHint?: string;
  children: (ref: React.RefObject<HTMLDivElement>) => ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  /* ---------- toPng helper ---------- */
  const captureCard = useCallback(async (): Promise<string | null> => {
    if (!cardRef.current) {
      toast.error('لا يمكن التقاط الصورة — البطاقة غير متاحة');
      return null;
    }
    try {
      const dataUrl = await toPng(cardRef.current, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
        skipFonts: true,
        style: {
          transform: 'scale(1)',
          transformOrigin: 'top right',
        },
      });
      return dataUrl;
    } catch (err) {
      console.error('[ImageCardExport] toPng error:', err);
      toast.error('فشل في توليد الصورة');
      return null;
    }
  }, []);

  /* ---------- download ---------- */
  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const dataUrl = await captureCard();
      if (!dataUrl) return;

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const fullFilename = `${filename}-${yyyy}-${mm}-${dd}.png`;

      const link = document.createElement('a');
      link.download = fullFilename;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success('تم تحميل الصورة', { description: fullFilename });
    } finally {
      setDownloading(false);
    }
  }, [captureCard, filename]);

  /* ---------- publish to telegram ---------- */
  const handlePublish = useCallback(async () => {
    setPublishing(true);
    try {
      const dataUrl = await captureCard();
      if (!dataUrl) return;

      const res = await fetch('/api/market/publish-status-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: dataUrl,
          market: telegramMarket,
          caption: telegramCaption,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.ok && data.success) {
        toast.success('تم النشر على تيليجرام', {
          description: data.message_id ? `رسالة #${data.message_id}` : undefined,
        });
      } else {
        const errMsg =
          data?.error_ar || data?.error || 'فشل في النشر على تيليجرام';
        toast.error('فشل النشر', { description: errMsg });
      }
    } finally {
      setPublishing(false);
    }
  }, [captureCard, telegramCaption, telegramMarket]);

  const busy = downloading || publishing;

  return (
    <Card className={`${borderClass} ${bgClass}`}>
      <CardContent className="p-4 space-y-4">
        {/* العنوان + الأزرار */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3
              className="text-base font-bold flex items-center gap-2"
              style={{ color: accentColor }}
            >
              <span className="text-xl">🖼️</span>
              {title}
            </h3>
            {description && (
              <p className="text-xs opacity-80 mt-1" style={{ color: accentColor }}>
                {description}
              </p>
            )}
          </div>
          {hasData && (
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                size="sm"
                onClick={handleDownload}
                disabled={busy}
                className="text-white"
                style={{ background: accentColor }}
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 ml-1" />
                )}
                تحميل صورة
              </Button>
              <Button
                size="sm"
                onClick={handlePublish}
                disabled={busy}
                className="bg-profit hover:bg-profit text-white"
              >
                {publishing ? (
                  <Loader2 className="h-4 w-4 ml-1 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 ml-1" />
                )}
                نشر على تيليجرام
              </Button>
            </div>
          )}
        </div>

        {/* معاينة البطاقة */}
        {hasData ? (
          <div className="overflow-x-auto rounded-xl bg-white/40 p-2">
            <div className="flex justify-center">
              {children(cardRef)}
            </div>
          </div>
        ) : (
          <div
            className="rounded-xl border-2 border-dashed p-8 text-center"
            style={{ borderColor: `${accentColor}44`, color: accentColor }}
          >
            <span className="text-3xl block mb-2">⏳</span>
            <p className="text-sm font-semibold">{emptyHint}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
