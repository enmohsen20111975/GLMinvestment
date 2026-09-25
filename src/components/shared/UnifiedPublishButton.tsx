'use client';

/**
 * UnifiedPublishButton — مكون النشر الموحّد
 * ============================================
 * زر واحد يفتح dropdown فيه كل أدوات النشر والنسخ والتصدير:
 *
 *   ▸ نشر على المنصات الاجتماعية:
 *       - Telegram
 *       - Facebook
 *       - WhatsApp
 *       - Twitter / X
 *       - LinkedIn  (مضاف لتطابق شاشة الأخبار)
 *
 *   ▸ نسخ النص (clipboard)
 *
 *   ▸ تحويل عنصر HTML لصورة (PNG) عبر html-to-image
 *
 * PROPS:
 *   - content:  النص اللي بيتنسخ/بيتنشر (مطلوب)
 *   - title?:   عنوان اختياري بيتعرض فوق الـ content في النص النهائي
 *   - image?:   React.RefObject<HTMLElement> للعنصر اللي يتلتقط كصورة
 *   - filename?: اسم ملف الصورة النهائي
 *   - hashtags?: هاشتاجات فيسبوك/تويتر
 *   - variant/size/className: styling standard للـ shadcn Button
 *
 * DESIGN NOTES:
 *   - بيستخدم withOfficialLinks() عشان يضيف الروابط الرسمية للنص المنشور
 *   - html-to-image مثبّت بالفعل (package.json)
 *   - sonner للـ toast notifications
 *   - DropdownMenu من shadcn/ui (موجود في src/components/ui)
 */

import React, { useState, useCallback } from 'react';
import { toPng } from 'html-to-image';
import {
  Share2, Send, Facebook, MessageCircle, Twitter, Copy, Image as ImageIcon,
  Loader2, Check, ChevronDown, Linkedin,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { withOfficialLinks } from '@/lib/official-links';

export interface UnifiedPublishButtonProps {
  /** النص الكامل اللي بيتنسخ/بيتنشر */
  content: string;
  /** عنوان اختياري بيتعرض كـ header قبل المحتوى */
  title?: string;
  /** React ref للعنصر اللي يتلتقط كصورة (للـ html-to-image) */
  image?: React.RefObject<HTMLElement | null>;
  /** اسم ملف الصورة الناتج (بدون امتداد) */
  filename?: string;
  /** هاشتاجات لفيسبوك/تويتر (بدون #) */
  hashtags?: string[];
  /** رابط URL بيتشارك على فيسبوك/تويتر (default: رابط المنصة الرسمي) */
  url?: string;
  /** Button variant (default outline) */
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  /** Button size (default sm) */
  size?: 'default' | 'sm' | 'lg' | 'icon';
  /** كلاسات إضافية للزر */
  className?: string;
  /** نص الـ trigger (default: "نشر") */
  triggerLabel?: string;
  /** عرض الأزرار بشكل منفصل بدل dropdown (default: false) */
  split?: boolean;
  /** تعطيل كل الأزرار */
  disabled?: boolean;
}

// ─── Share URL builders ──────────────────────────────────────────────────────
// كل منصة ليها format مختلف لـ share URL. النص بيتعمله encodeURIComponent.

function buildTelegramUrl(text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent('https://invist.m2y.net')}&text=${encodeURIComponent(text)}`;
}

function buildWhatsAppUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function buildFacebookUrl(url: string, quote: string, hashtags: string[]): string {
  const params = new URLSearchParams({
    u: url,
    quote,
  });
  if (hashtags.length > 0) {
    params.set('hashtag', '#' + hashtags[0]);
  }
  return `https://www.facebook.com/sharer/sharer.php?${params.toString()}`;
}

function buildTwitterUrl(text: string, url: string, hashtags: string[]): string {
  const params = new URLSearchParams({ text });
  if (url) params.set('url', url);
  if (hashtags.length > 0) {
    params.set('hashtags', hashtags.join(','));
  }
  return `https://twitter.com/intent/tweet?${params.toString()}`;
}

function buildLinkedInUrl(url: string): string {
  // LinkedIn sharer بياخد url فقط (الـ summary ملغي في API الجديد)
  return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildFullContent(content: string, title?: string): string {
  const header = title ? `${title}\n\n` : '';
  return withOfficialLinks(`${header}${content}`);
}

function openShareWindow(url: string): void {
  if (typeof window === 'undefined') return;
  window.open(url, '_blank', 'noopener,noreferrer,width=600,height=600');
}

async function downloadImage(element: HTMLElement, filename: string): Promise<void> {
  const dataUrl = await toPng(element, {
    cacheBust: true,
    pixelRatio: 2,
    backgroundColor: '#ffffff',
    // نتجاهل العناصر اللي بتسبب مشاكل في الـ capture (SVGs خارجية، إلخ)
    filter: (node) => {
      if (!(node instanceof HTMLElement)) return true;
      // نتخطّى العناصر الـ print:hidden
      if (node.dataset?.printHidden === 'true') return false;
      return true;
    },
  });
  const link = document.createElement('a');
  link.download = `${filename}.png`;
  link.href = dataUrl;
  link.click();
}

// ─── Component ─────────────────────────────────────────────────────────────

export function UnifiedPublishButton({
  content,
  title,
  image,
  filename = 'm2y-publish',
  hashtags = [],
  url = 'https://invist.m2y.net',
  variant = 'outline',
  size = 'sm',
  className,
  triggerLabel = 'نشر',
  split = false,
  disabled = false,
}: UnifiedPublishButtonProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  const fullContent = buildFullContent(content, title);

  const handleTelegram = useCallback(() => {
    openShareWindow(buildTelegramUrl(fullContent));
    toast.success('تم فتح تليجرام للنشر');
  }, [fullContent]);

  const handleFacebook = useCallback(() => {
    openShareWindow(buildFacebookUrl(url, fullContent, hashtags));
    toast.success('تم فتح فيسبوك للنشر');
  }, [fullContent, url, hashtags]);

  const handleWhatsApp = useCallback(() => {
    openShareWindow(buildWhatsAppUrl(fullContent));
    toast.success('تم فتح واتساب للنشر');
  }, [fullContent]);

  const handleTwitter = useCallback(() => {
    openShareWindow(buildTwitterUrl(fullContent, url, hashtags));
    toast.success('تم فتح تويتر للنشر');
  }, [fullContent, url, hashtags]);

  const handleLinkedIn = useCallback(() => {
    openShareWindow(buildLinkedInUrl(url));
    toast.success('تم فتح لينكد إن للنشر');
  }, [url]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(fullContent);
      setCopySuccess(true);
      toast.success('تم نسخ النص إلى الحافظة');
      setTimeout(() => setCopySuccess(false), 1500);
    } catch (err) {
      console.error('[UnifiedPublishButton] clipboard write failed:', err);
      toast.error('فشل نسخ النص — حاول مرة تانية');
    }
  }, [fullContent]);

  const handleImage = useCallback(async () => {
    if (!image?.current) {
      toast.error('مفيش عنصر متاح للالتقاط كصورة');
      return;
    }
    setIsCapturing(true);
    try {
      await downloadImage(image.current, filename);
      toast.success('تم حفظ الصورة بنجاح');
    } catch (err) {
      console.error('[UnifiedPublishButton] image capture failed:', err);
      toast.error('فشل التقاط الصورة — حاول مرة تانية');
    } finally {
      setIsCapturing(false);
    }
  }, [image, filename]);

  // ─── Split mode: 3 أزرار منفصلة ────────────────────────────────────────
  if (split) {
    return (
      <div className="flex items-center gap-2" dir="rtl">
        {/* Publish dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant={variant} size={size} disabled={disabled} className={cn('gap-1.5', className)}>
              <Share2 className="w-4 h-4" />
              <span className="hidden sm:inline">{triggerLabel}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel className="text-xs">النشر على منصة</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleTelegram} className="gap-2 text-xs cursor-pointer">
              <Send className="w-3.5 h-3.5 text-sky-500" />
              تليجرام
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleFacebook} className="gap-2 text-xs cursor-pointer">
              <Facebook className="w-3.5 h-3.5 text-blue-600" />
              فيسبوك
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleWhatsApp} className="gap-2 text-xs cursor-pointer">
              <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
              واتساب
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleTwitter} className="gap-2 text-xs cursor-pointer">
              <Twitter className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300" />
              تويتر / X
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleLinkedIn} className="gap-2 text-xs cursor-pointer">
              <Linkedin className="w-3.5 h-3.5 text-[#0A66C2]" />
              لينكد إن
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Copy button */}
        <Button
          variant={variant}
          size={size}
          disabled={disabled}
          onClick={handleCopy}
          className="gap-1.5"
          title="نسخ النص"
        >
          {copySuccess ? (
            <Check className="w-4 h-4 text-emerald-600" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
          <span className="hidden sm:inline">{copySuccess ? 'تم النسخ' : 'نسخ'}</span>
        </Button>

        {/* Image export button */}
        <Button
          variant={variant}
          size={size}
          disabled={disabled || isCapturing || !image?.current}
          onClick={handleImage}
          className="gap-1.5"
          title="حفظ كصورة"
        >
          {isCapturing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ImageIcon className="w-4 h-4" />
          )}
          <span className="hidden sm:inline">{isCapturing ? 'جارٍ...' : 'صورة'}</span>
        </Button>
      </div>
    );
  }

  // ─── Unified mode: dropdown واحد فيه كل الأدوات ────────────────────────
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant={variant}
          size={size}
          disabled={disabled}
          className={cn('gap-1.5', className)}
          aria-label="نشر ومشاركة"
        >
          <Share2 className="w-4 h-4" />
          <span className="hidden sm:inline">{triggerLabel}</span>
          <ChevronDown className="w-3 h-3 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-xs">النشر على المنصات</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleTelegram} className="gap-2 text-xs cursor-pointer">
          <Send className="w-3.5 h-3.5 text-sky-500" />
          تليجرام
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleFacebook} className="gap-2 text-xs cursor-pointer">
          <Facebook className="w-3.5 h-3.5 text-blue-600" />
          فيسبوك
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleWhatsApp} className="gap-2 text-xs cursor-pointer">
          <MessageCircle className="w-3.5 h-3.5 text-emerald-500" />
          واتساب
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleTwitter} className="gap-2 text-xs cursor-pointer">
          <Twitter className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300" />
          تويتر / X
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleLinkedIn} className="gap-2 text-xs cursor-pointer">
          <Linkedin className="w-3.5 h-3.5 text-[#0A66C2]" />
          لينكد إن
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">أدوات محلية</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={handleCopy}
          className="gap-2 text-xs cursor-pointer"
        >
          {copySuccess ? (
            <Check className="w-3.5 h-3.5 text-emerald-600" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          {copySuccess ? 'تم نسخ النص' : 'نسخ النص'}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={handleImage}
          disabled={isCapturing || !image?.current}
          className="gap-2 text-xs cursor-pointer"
        >
          {isCapturing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ImageIcon className="w-3.5 h-3.5" />
          )}
          {isCapturing ? 'جارٍ الالتقاط...' : 'حفظ كصورة'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default UnifiedPublishButton;
