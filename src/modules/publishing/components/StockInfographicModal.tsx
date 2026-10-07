'use client';

/**
 * StockInfographicModal — نافذة معاينة وتصدير بطاقة إنفوجرافيك السهم
 * ============================================================================
 *
 * يفتح Dialog فيه:
 *   1. معاينة حية لـ StockInfographicCard
 *   2. 3 أزرار تصدير:
 *      - 📥 تحميل كصورة PNG عالية الدقة (pixelRatio: 2.5)
 *      - ✈️ نشر مباشر إلى تيليجرام (يستدعي /api/telegram/publish-stock بالصورة)
 *      - 📋 نسخ الصورة للحافظة (Clipboard API)
 *
 * يستخدم html-to-image للـ capture + sonner للـ toasts + Dialog من shadcn/ui.
 */

import React, { useCallback, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Download,
  Send,
  Copy,
  Loader2,
  Image as ImageIcon,
  Bot,
} from 'lucide-react';
import { toast } from 'sonner';
import { adminFetch } from '@/lib/admin-auth';
import {
  StockInfographicCard,
  type StockInfographicCardProps,
} from './StockInfographicCard';
import { OFFICIAL_LINKS } from '@/modules/publishing/lib/official-links';

export interface StockInfographicModalProps {
  data: StockInfographicCardProps['data'];
  /** Optional trigger — if omitted, the consumer renders their own. */
  trigger?: React.ReactNode;
  /** Open state control (controlled mode). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type BusyKey = 'download' | 'telegram' | 'clipboard' | null;

export function StockInfographicModal({
  data,
  trigger,
  open,
  onOpenChange,
}: StockInfographicModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const [busy, setBusy] = useState<BusyKey>(null);

  const isControlled = open !== undefined && onOpenChange !== undefined;
  const isOpen = isControlled ? open : internalOpen;
  const setOpen = isControlled ? onOpenChange! : setInternalOpen;

  const cardRef = useRef<HTMLDivElement>(null);

  // ─── Capture the card as a PNG data URL ────────────────────────────────
  const captureCard = useCallback(async (): Promise<string | null> => {
    if (!cardRef.current) {
      toast.error('البطاقة غير متاحة للالتقاط');
      return null;
    }
    // Expand any clipped containers so the full card is captured.
    const el = cardRef.current;
    const saved = {
      overflow: el.style.overflow,
      height: el.style.height,
      width: el.style.width,
      maxHeight: el.style.maxHeight,
    };
    try {
      el.style.overflow = 'visible';
      el.style.height = `${el.scrollHeight}px`;
      el.style.width = `${el.scrollWidth}px`;
      el.style.maxHeight = 'none';
      void el.offsetWidth; // force reflow

      const dataUrl = await toPng(el, {
        cacheBust: true,
        pixelRatio: 2.5,
        backgroundColor: '#070b13',
        width: el.scrollWidth,
        height: el.scrollHeight,
        style: {
          transform: 'none',
          margin: '0',
        },
        skipFonts: false,
      });
      return dataUrl;
    } catch (err) {
      console.error('[StockInfographicModal] capture failed:', err);
      toast.error('فشل التقاط الصورة — حاول مرة تانية');
      return null;
    } finally {
      el.style.overflow = saved.overflow;
      el.style.height = saved.height;
      el.style.width = saved.width;
      el.style.maxHeight = saved.maxHeight;
    }
  }, []);

  // ─── 1) Download PNG ──────────────────────────────────────────────────
  const handleDownload = useCallback(async () => {
    setBusy('download');
    try {
      const dataUrl = await captureCard();
      if (!dataUrl) return;
      const stamp = new Date().toISOString().split('T')[0];
      const link = document.createElement('a');
      link.download = `${data.ticker}-infographic-${stamp}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('تم تحميل بطاقة الإنفوجرافيك بنجاح');
    } finally {
      setBusy(null);
    }
  }, [captureCard, data.ticker]);

  // ─── 2) Publish to Telegram (admin-only) ──────────────────────────────
  const handleTelegramPublish = useCallback(async () => {
    setBusy('telegram');
    try {
      const dataUrl = await captureCard();
      if (!dataUrl) return;

      // Convert dataURL → Blob for multipart upload
      const res = await fetch(dataUrl);
      const blob = await res.blob();

      const formData = new FormData();
      formData.append('ticker', data.ticker);
      formData.append('name_ar', data.name_ar);
      formData.append('image', blob, `${data.ticker}-infographic.png`);
      // Build rich & accurate analysis caption
      let richCaption = `📊 <b>تحليل سهم: ${data.name_ar} (${data.ticker})</b>\n\n`;
      richCaption += `💰 <b>آخر سعر:</b> ${data.current_price} ${data.currency || 'ج.م'}\n`;
      richCaption += `📈 <b>التغير اليومي:</b> ${data.change_pct >= 0 ? '+' : ''}${data.change_pct.toFixed(2)}%\n`;
      richCaption += `📊 <b>حجم التداول:</b> ${data.session.volume} | <b>القيمة:</b> ${data.session.turnover}\n`;
      richCaption += `⏱️ <b>الأعلى / الأدنى:</b> ${data.session.high} / ${data.session.low}\n\n`;

      // Liquidity & Maker Flow
      if (data.liquidity) {
        richCaption += `🌊 <b>بصمة السيولة وصُنّاع السوق:</b>\n`;
        if (data.liquidity.poc_price) richCaption += `  • 🎯 <b>نقطة التحكم (POC):</b> ${data.liquidity.poc_price.toFixed(2)}\n`;
        if (data.liquidity.vah_price && data.liquidity.val_price) {
          richCaption += `  • 📦 <b>منطقة القيمة (VAH - VAL):</b> ${data.liquidity.vah_price.toFixed(2)} — ${data.liquidity.val_price.toFixed(2)}\n`;
        }
        if (data.liquidity.accumulation_label) {
          richCaption += `  • 🐋 <b>حركة الميكر:</b> ${data.liquidity.accumulation_label} (نسبة ش/ب: ${data.liquidity.buy_sell_ratio ? data.liquidity.buy_sell_ratio.toFixed(2) : '1.0'}x)\n\n`;
        }
      }

      // Technical Levels & Scenarios
      richCaption += `📐 <b>المستويات الفنية:</b>\n`;
      richCaption += `  • 🛡️ <b>الدعوم:</b> ${data.levels.support_1} | ${data.levels.support_2}\n`;
      richCaption += `  • 🎯 <b>المقاومات:</b> ${data.levels.resistance_1} | ${data.levels.resistance_2}\n\n`;

      if (data.scenarios.bullish_target) {
        richCaption += `🐂 <b>الهدف الصعودي:</b> ${data.scenarios.bullish_target}\n`;
      }
      if (data.scenarios.bearish_target) {
        richCaption += `🐻 <b>مستوى الحذر / الوقف:</b> ${data.scenarios.bearish_target}\n\n`;
      }

      richCaption += `💡 <b>التقييم الفني:</b> ${data.rating.label} (${data.rating.score}/100) ${'⭐'.repeat(Math.min(5, data.rating.stars_count))}\n\n`;
      richCaption += `#بورصة_مصر #${data.ticker} #تحليل_فني #سيولة_ذكية\n`;
      richCaption += `🔗 منصة دليل الاستثمار: invist.m2y.net`;

      formData.append('caption', richCaption);

      const apiRes = await adminFetch('/api/telegram/publish-stock', {
        method: 'POST',
        body: formData,
      });
      const json = await apiRes.json().catch(() => ({} as Record<string, unknown>));
      if (!apiRes.ok || !json?.success) {
        const errMsg =
          (json?.error as string | undefined) ||
          `فشل النشر على تيليجرام (HTTP ${apiRes.status})`;
        toast.error(errMsg);
        return;
      }
      const msgId = json?.message_id;
      toast.success(
        msgId
          ? `تم نشر ${data.ticker} على قناة تيليجرام ✅ (message_id: ${msgId})`
          : `تم نشر ${data.ticker} على قناة تيليجرام ✅`
      );
    } catch (err) {
      console.error('[StockInfographicModal] telegram publish failed:', err);
      toast.error('فشل الاتصال بالبوت — حاول مرة تانية');
    } finally {
      setBusy(null);
    }
  }, [captureCard, data.ticker, data.name_ar, data.current_price, data.change_pct]);

  // ─── 3) Copy to Clipboard ─────────────────────────────────────────────
  const handleCopyClipboard = useCallback(async () => {
    setBusy('clipboard');
    try {
      const dataUrl = await captureCard();
      if (!dataUrl) return;

      const res = await fetch(dataUrl);
      const blob = await res.blob();

      if (!navigator.clipboard || !window.ClipboardItem) {
        toast.error('الحافظة غير مدعومة في هذا المتصفح');
        return;
      }
      const item = new ClipboardItem({ 'image/png': blob });
      await navigator.clipboard.write([item]);
      toast.success('تم نسخ صورة البطاقة إلى الحافظة');
    } catch (err) {
      console.error('[StockInfographicModal] clipboard write failed:', err);
      toast.error('فشل نسخ الصورة — حاول مرة تانية');
    } finally {
      setBusy(null);
    }
  }, [captureCard]);

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent
        className="max-w-4xl"
        dir="rtl"
      >
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <ImageIcon className="w-4 h-4 text-amber-500" />
            بطاقة إنفوجرافيك السهم
          </DialogTitle>
          <p className="text-xs text-muted-foreground">
            معاينة + تصدير البطاقة كصورة عالية الدقة (PNG 2.5×).
          </p>
        </DialogHeader>

        {/* Scrollable preview — constrain height so the modal stays usable */}
        <div className="max-h-[60vh] overflow-auto rounded-lg bg-slate-950/40 p-3">
          {/* Scale the 800px-wide card down to fit the modal preview */}
          <div
            style={{
              transform: 'scale(0.5)',
              transformOrigin: 'top right',
              width: '800px',
              height: 'auto',
            }}
            className="mx-auto"
          >
            <StockInfographicCard data={data} cardRef={cardRef} />
          </div>
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
          <Button
            onClick={handleDownload}
            disabled={busy !== null}
            variant="default"
            className="bg-amber-600 hover:bg-amber-700 text-white gap-1.5"
          >
            {busy === 'download' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {busy === 'download' ? 'جارٍ...' : 'تحميل كصورة PNG'}
          </Button>

          <Button
            onClick={handleTelegramPublish}
            disabled={busy !== null}
            variant="default"
            className="bg-sky-600 hover:bg-sky-700 text-white gap-1.5"
          >
            {busy === 'telegram' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            {busy === 'telegram' ? 'جارٍ النشر...' : 'نشر على تيليجرام'}
          </Button>

          <Button
            onClick={handleCopyClipboard}
            disabled={busy !== null}
            variant="outline"
            className="gap-1.5"
          >
            {busy === 'clipboard' ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Copy className="w-4 h-4" />
            )}
            {busy === 'clipboard' ? 'جارٍ النسخ...' : 'نسخ للحافظة'}
          </Button>
        </div>

        {/* Bot link — opens the smart analysis bot in a new tab */}
        <a
          href={OFFICIAL_LINKS.bot}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-amber-600/40 bg-amber-600/10 hover:bg-amber-600/20 text-amber-700 dark:text-amber-400 text-sm font-medium transition-colors no-underline"
        >
          <Bot className="w-4 h-4" />
          افتح بوت تحليل الأسهم
        </a>

        <p className="text-[11px] text-muted-foreground text-center pt-1">
          ملاحظة: النشر على تيليجرام متاح فقط للمسؤولين. البيانات متأخرة 15 دقيقة.
        </p>
      </DialogContent>
    </Dialog>
  );
}

export default StockInfographicModal;
