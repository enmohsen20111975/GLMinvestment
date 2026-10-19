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
  Loader2, Check, ChevronDown, Linkedin, Camera, BarChart3,
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
import { cn, safeToFixed } from '@/lib/utils';
// ─── CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 67) ───────────────────
// قبل كده: accumulation + targets كانوا بـ يتحسبوا client-side بـ thresholds
// مختلفة (1.25/0.8 + 0.96 multiplier) → نتائج متضاربة مع الرادار.
// الحل: استيراد canonical functions.
import { classifyAccumulation } from '@/lib/canonical-signal';
import { withOfficialLinks } from '@/modules/publishing/lib/official-links';
import { StockInfographicModal } from './StockInfographicModal';
import { type StockInfographicCardProps } from './StockInfographicCard';
// Task 38-B — Social Media Report Templates (Daily / Weekly / Monthly)
import { TradeResultsGenerator } from './TradeResultsGenerator';

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
  /** رمز السهم (اختياري) — لجلب/بناء بطاقة الإنفوجرافيك تلقائياً إذا لم يتم تمرير infographicData */
  ticker?: string;
  infographicData?: StockInfographicCardProps['data'];
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
  // ── Capture FULL element including hidden/scrollable areas ──────────────
  // html-to-image only captures what's visible by default. To get the full
  // element (including overflow-hidden / scrollable regions), we walk the
  // entire subtree and force overflow:visible on every clipped node, expand
  // the root to its scroll dimensions, then restore everything in finally.

  const savedRoot = {
    overflow: element.style.overflow,
    height: element.style.height,
    width: element.style.width,
    maxHeight: element.style.maxHeight,
    maxWidth: element.style.maxWidth,
    position: element.style.position,
  };

  // Walk entire subtree and save/force overflow:visible on clipped nodes
  // Also strip any CSS filters (grayscale, blur, etc.) that would corrupt the capture
  const savedStyles: { el: HTMLElement; overflow: string; overflowX: string; overflowY: string; height: string; width: string; maxHeight: string; maxWidth: string; filter: string; backdropFilter: string; webkitFilter: string }[] = [];

  function walk(node: Node) {
    if (!(node instanceof HTMLElement)) return;
    const cs = window.getComputedStyle(node);
    const isClipped = cs.overflow === 'hidden' || cs.overflow === 'clip' ||
                     cs.overflowY === 'hidden' || cs.overflowY === 'scroll' ||
                     cs.overflowX === 'hidden' || cs.overflowX === 'scroll';
    if (isClipped) {
      savedStyles.push({
        el: node,
        overflow: node.style.overflow || cs.overflow,
        overflowX: node.style.overflowX || cs.overflowX,
        overflowY: node.style.overflowY || cs.overflowY,
        height: node.style.height,
        width: node.style.width,
        maxHeight: node.style.maxHeight,
        maxWidth: node.style.maxWidth,
        filter: node.style.filter || cs.filter,
        backdropFilter: node.style.backdropFilter || cs.backdropFilter,
        webkitFilter: node.style.webkitFilter || cs.webkitFilter,
      });
      node.style.overflow = 'visible';
      node.style.overflowX = 'visible';
      node.style.overflowY = 'visible';
    }
    // Strip any CSS filter that would desaturate the capture
    if (cs.filter && cs.filter !== 'none' && cs.filter !== 'blur(0px)') {
      const alreadySaved = savedStyles.find(s => s.el === node);
      if (!alreadySaved) {
        savedStyles.push({
          el: node,
          overflow: node.style.overflow || cs.overflow,
          overflowX: node.style.overflowX || cs.overflowX,
          overflowY: node.style.overflowY || cs.overflowY,
          height: node.style.height,
          width: node.style.width,
          maxHeight: node.style.maxHeight,
          maxWidth: node.style.maxWidth,
          filter: node.style.filter || cs.filter,
          backdropFilter: node.style.backdropFilter || cs.backdropFilter,
          webkitFilter: node.style.webkitFilter || cs.webkitFilter,
        });
      }
      node.style.filter = 'none';
      node.style.backdropFilter = 'none';
      node.style.webkitFilter = 'none';
    }
    for (const child of node.children) walk(child);
  }
  walk(element);

  try {
    // Expand root to its full scroll size
    element.style.overflow = 'visible';
    element.style.height = `${element.scrollHeight}px`;
    element.style.width = `${element.scrollWidth}px`;
    element.style.maxHeight = 'none';
    element.style.maxWidth = 'none';
    if (!savedRoot.position || savedRoot.position === 'static') {
      element.style.position = 'relative';
    }

    // Force reflow
    void element.offsetWidth;

    const dataUrl = await toPng(element, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor: '#ffffff',
      width: element.scrollWidth,
      height: element.scrollHeight,
      // نتجål العناصر اللي تسبب مشاكل في الـ capture (SVGs خارجية، إلخ)
      filter: (node) => {
        if (!(node instanceof HTMLElement)) return true;
        // نخطّى العناصر الـ print:hidden
        if (node.dataset?.printHidden === 'true') return false;
        return true;
      },
    });

    const link = document.createElement('a');
    link.download = `${filename}.png`;
    link.href = dataUrl;
    link.click();
  } finally {
    // ── Restore original styles ──
    element.style.overflow = savedRoot.overflow;
    element.style.height = savedRoot.height;
    element.style.width = savedRoot.width;
    element.style.maxHeight = savedRoot.maxHeight;
    element.style.maxWidth = savedRoot.maxWidth;
    element.style.position = savedRoot.position;

    for (const { el, overflow, overflowX, overflowY, height, width, maxHeight, maxWidth, filter, backdropFilter, webkitFilter } of savedStyles) {
      el.style.overflow = overflow;
      el.style.overflowX = overflowX;
      el.style.overflowY = overflowY;
      el.style.height = height;
      el.style.width = width;
      el.style.maxHeight = maxHeight;
      el.style.maxWidth = maxWidth;
      el.style.filter = filter;
      el.style.backdropFilter = backdropFilter;
      el.style.webkitFilter = webkitFilter;
    }
  }
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
  ticker,
  infographicData,
}: UnifiedPublishButtonProps) {
  const [isCapturing, setIsCapturing] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [infographicOpen, setInfographicOpen] = useState(false);
  const [fetchedInfographic, setFetchedInfographic] = useState<StockInfographicCardProps['data'] | null>(null);
  const [loadingInfographic, setLoadingInfographic] = useState(false);
  // Task 38-B — Trade Results modal state
  const [tradeResultsOpen, setTradeResultsOpen] = useState(false);

  // Auto-fetch infographic data if ticker is provided and infographicData is not
  const resolvedTicker = ticker || (content.match(/([A-Z0-9]{3,6})/)?.[1]);

  const handleOpenInfographic = useCallback(async () => {
    if (infographicData) {
      setInfographicOpen(true);
      return;
    }
    if (!resolvedTicker) return;

    setLoadingInfographic(true);
    try {
      // 1. Fetch real stock details + unified publish-data + 30-day footprint
      // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72)
      // Also fetch /api/stocks/[ticker]/unified as the canonical source for
      // signal_ar / accumulation / money_flow / prediction / radar.buy_pct.
      // PHASE4-APIS (Task PHASE4-APIS, Rule 27): footprint endpoint (410 Gone)
      // replaced with /api/flow/[ticker] (canonical Python compute_money_flow).
      // Response shape mapping (preserves buildInfographic consumer contract):
      //   flow.buy_pressure → buy_volume, flow.sell_pressure → sell_volume,
      //   flow.net_flow → delta_volume; poc/vah/val = null (volume-profile
      //   concepts not available from money-flow API).
      const [stockRes, publishRes, flowRes, unifiedRes] = await Promise.allSettled([
        fetch(`/api/stocks/${resolvedTicker}`),
        fetch(`/api/stocks/${resolvedTicker}/publish-data`),
        fetch(`/api/flow/${encodeURIComponent(resolvedTicker)}`),
        fetch(`/api/stocks/${resolvedTicker}/unified`),
      ]);

      const stockData = stockRes.status === 'fulfilled' && stockRes.value.ok ? await stockRes.value.json() : null;
      const publishJson = publishRes.status === 'fulfilled' && publishRes.value.ok ? await publishRes.value.json() : null;
      const flowJson = flowRes.status === 'fulfilled' && flowRes.value.ok ? await flowRes.value.json() : null;
      // Map canonical /api/flow response → legacy footprintData shape so the
      // downstream consumer code (builtData.liquidity block) keeps working.
      const flowPayload = flowJson?.success && flowJson?.flow ? flowJson.flow : null;
      const _buyVolF = flowPayload ? Number(flowPayload.buy_pressure ?? 0) : 0;
      const _sellVolF = flowPayload ? Number(flowPayload.sell_pressure ?? 0) : 0;
      const footprintData = flowPayload
        ? {
            success: true as const,
            poc_price: undefined as number | undefined,
            vah_price: undefined as number | undefined,
            val_price: undefined as number | undefined,
            buy_volume: _buyVolF,
            sell_volume: _sellVolF,
            delta_volume: Number(flowPayload.net_flow ?? (_buyVolF - _sellVolF)),
            buy_sell_ratio: _sellVolF > 0 ? _buyVolF / _sellVolF : 0,
          }
        : null;
      // UNIFIED-API — best-effort; if it fails, fall back to publish-data.
      const unifiedJson = unifiedRes.status === 'fulfilled' && unifiedRes.value.ok ? await unifiedRes.value.json() : null;
      const unified = (unifiedJson?.success ? unifiedJson : null) as any;

      const pData = publishJson?.data || {};
      const stock = stockData?.stock || stockData?.data || stockData || {};
      const current = Number(pData.currentPrice || stock.current_price || unified?.stock?.current_price || stock.close || stock.last_price || 0);
      const prevClose = Number(pData.previousClose || stock.previous_close || unified?.stock?.previous_close || stock.prev_close || current);
      const changeVal = current - prevClose;
      const changePct = pData.changePct != null ? Number(pData.changePct) : (prevClose > 0 ? (changeVal / prevClose) * 100 : 0);
      const rawHigh = Number(stock.high_price || stock.high || current);
      const rawLow = Number(stock.low_price || stock.low || current);
      const rawOpen = Number(stock.open_price || prevClose);

      // Invariants: high >= current, low <= current and low > 0
      const high = rawHigh >= current ? rawHigh : Math.max(current, prevClose);
      const low = (rawLow > 0 && rawLow <= current && rawLow >= current * 0.35) ? rawLow : Math.min(current, prevClose);
      const open = (rawOpen >= low * 0.9 && rawOpen <= high * 1.1) ? rawOpen : prevClose;

      const isUp = current >= open;
      const chartPoints = isUp
        ? [open, low > open * 0.98 ? low : open * 0.99, (high + low) / 2, high * 0.995, (high + current) / 2, current]
        : [open, high < open * 1.02 ? high : open * 1.01, (high + low) / 2, low * 1.005, (low + current) / 2, current];

      // ─── PHASE-0 (Task UNIFICATION-PHASE-0, Rule 73) ─────────────────────
      // ROOT CAUSE FIX: قبل كده كان في client-side signal computation بـ
      // thresholds مختلفة (RSI 35/70, SMA 1.25x, buyPressure 55/45).
      // النتيجة: العميل بيشوف "شراء قوي" من publish-data + "انتظار" من unified.
      //
      // الحل: شيل كل الـ client-side signal computation — استخدم canonical values فقط.
      // لو unified API مش متاح → gaugeScore = null + sentimentLabel = '— بيانات غير متاحة'.
      const gaugeScore = unified?.canonical?.master_score != null
        ? Math.round(Number(unified.canonical.master_score))
        : (pData.masterScore != null ? Math.round(pData.masterScore) : null);

      // سياسة الفراغ: لو canonical NULL → '— بيانات غير متاحة' (مش HOLD الكاذب)
      const sentimentLabel = unified?.canonical?.signal_ar
        ?? (gaugeScore != null
            ? (gaugeScore >= 65 ? 'إيجابي' : gaugeScore <= 40 ? 'سلبي' : 'محايد')
            : '— بيانات غير متاحة');
      const ratingLabel = gaugeScore == null
        ? '—'
        : gaugeScore >= 75 ? 'ممتاز'
        : gaugeScore >= 60 ? 'جيد جداً'
        : gaugeScore >= 45 ? 'متوسط'
        : 'ضعيف';
      const starsCount = gaugeScore == null
        ? 0
        : gaugeScore >= 75 ? 5
        : gaugeScore >= 60 ? 4
        : gaugeScore >= 45 ? 3
        : 2;

      // --- Real SSOT levels (from predictions.db / publish-data) ---
      // ─── CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 27: NO-FAKE-DATA) ─────
      // قبل كده: res1/res2/sup1/sup2 كانوا بـ يـ fabricate بـ multipliers ×1.03/×1.04/×0.97/×0.96.
      // الحل: لو القيم الحقيقية NULL → undefined (لا fabrication).
      // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72) — prediction.entry_price / target_price / stop_loss
      // take precedence when present (canonical source — NO fabrication).
      const res1 = unified?.prediction?.target_price
        ?? pData.resistance1
        ?? pData.targetPrice1
        ?? stock.resistance_level
        ?? undefined;
      const res2 = pData.resistance2
        ?? pData.targetPrice2
        ?? (stock as any).resistance_level_2
        ?? undefined;
      const sup1 = unified?.prediction?.stop_loss
        ?? pData.support1
        ?? pData.stopLoss
        ?? stock.support_level
        ?? undefined;
      const sup2 = pData.support2
        ?? (stock as any).support_level_2
        ?? undefined;

      const bullishTargetStr = (pData.targetPrice1 && pData.targetPrice2)
        ? `${pData.targetPrice1} - ${pData.targetPrice2}`
        : pData.targetPrice1
          ? `${pData.targetPrice1}`
          : (res1 && res2) ? `${res1} - ${res2}` : `${current}`;

      const bearishTargetStr = (pData.stopLoss && sup2)
        ? `${pData.stopLoss} - ${sup2}`
        : pData.stopLoss
          ? `${pData.stopLoss}`
          : (sup1 && sup2) ? `${sup1} - ${sup2}` : `${current}`;

      const builtData: StockInfographicCardProps['data'] = {
        ticker: resolvedTicker,
        name_ar: pData.nameAr || stock.name_ar || stock.name || resolvedTicker,
        sector: pData.sector || stock.sector || 'قطاع عام',
        logo_url: stock.logo_url,
        current_price: current,
        change_value: changeVal,
        change_pct: changePct,
        currency: 'ج.م',
        session: {
          high,
          low,
          prev_close: prevClose,
          volume: stock.volume ? String(stock.volume) : '—',
          turnover: stock.turnover_egp ? `${(stock.turnover_egp / 1e6).toFixed(1)}M` : (stock.value_traded ? `${(stock.value_traded / 1e6).toFixed(1)}M` : '—'),
          trades_count: stock.trades_count || '—',
        },
        chart_data: [
          { time: '10:00', price: Math.max(low, Math.min(high, chartPoints[0])) },
          { time: '11:00', price: Math.max(low, Math.min(high, chartPoints[1])) },
          { time: '12:00', price: Math.max(low, Math.min(high, chartPoints[2])) },
          { time: '01:00', price: Math.max(low, Math.min(high, chartPoints[3])) },
          { time: '02:00', price: Math.max(low, Math.min(high, chartPoints[4])) },
          { time: '03:00', price: Math.max(low, Math.min(high, chartPoints[5])) },
        ],
        technical_indicators: {
          timeframe: 'يومي',
          // ─── PHASE-0 (Task UNIFICATION-PHASE-0, Rule 73) ─────────────
          // شيلنا client-side signal counts — استخدم canonical values فقط.
          // لو unified NULL → 0 (لا fabrication).
          buy_signals: unified?.canonical?.master_score != null && unified.canonical.master_score >= 60 ? 1 : 0,
          neutral_signals: unified?.canonical?.master_score == null ? 1 : (unified.canonical.master_score >= 40 && unified.canonical.master_score < 60 ? 1 : 0),
          sell_signals: unified?.canonical?.master_score != null && unified.canonical.master_score < 40 ? 1 : 0,
          sentiment_label: sentimentLabel,
          gauge_score: gaugeScore ?? 0,
        },
        fundamentals: {
          market_cap: stock.market_cap ? `${(Number(stock.market_cap) / 1e9).toFixed(2)}B` : (pData.marketCap ? `${(Number(pData.marketCap) / 1e9).toFixed(2)}B` : '—'),
          eps: stock.eps || '—',
          p_e: stock.pe_ratio || pData.peRatio || '—',
          dividend_yield: stock.dividend_yield ? `${stock.dividend_yield}%` : undefined,
          yearly_high: Number(stock.high_52w && Number(stock.high_52w) >= current ? stock.high_52w : Math.max(high, current)),
          yearly_low: Number(stock.low_52w && Number(stock.low_52w) <= current && Number(stock.low_52w) > 0 ? stock.low_52w : Math.min(low, current)),
          book_value: stock.book_value ? String(stock.book_value) : undefined,
        },
        levels: {
          resistance_2: res2 ? String(res2) : '—',
          resistance_1: res1 ? String(res1) : '—',
          support_1: sup1 ? String(sup1) : '—',
          support_2: sup2 ? String(sup2) : '—',
        },
        scenarios: {
          bullish_target: bullishTargetStr,
          bullish_text: pData.targetPrice1 ? `هدف أول ${pData.targetPrice1} ج.م وثانٍ ${pData.targetPrice2 || res2} ج.م` : 'استقرار التداولات أعلى الدعم يستهدف مستويات المقاومة الفنية',
          bearish_target: bearishTargetStr,
          bearish_text: pData.stopLoss ? `كسر وقف الخسارة عند ${pData.stopLoss} ج.م يلغي النظرة الإيجابية` : 'كسر الدعم يدعو لتفعيل وقف الخسارة وإعادة التمركز أدنى',
        },
        vision_bullet_points: [
          // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72) — prefer prediction.entry_price
          `نطاق الدخول الآمن: ${unified?.prediction?.entry_price != null ? `${safeToFixed(unified.prediction.entry_price)} ج.م` : (pData.entryZoneLow && pData.entryZoneHigh ? `${pData.entryZoneLow} إلى ${pData.entryZoneHigh} ج.م` : 'قرب مستويات الدعم')}`,
          pData.rsi ? `مؤشر القوة النسبية RSI عند ${pData.rsi} (${pData.rsi < 35 ? 'تشبع بيعي / فرصة ارتداد' : pData.rsi > 65 ? 'تشبع شرائي' : 'منطقة توازن'})` : 'مؤشر الزخم يتماشى مع حركة السيولة',
          pData.stopLoss ? `وقف الخسارة الهيكلي محدد بدقة عند ${pData.stopLoss} ج.م` : 'إدارة المخاطر والالتزام بوقف الخسارة أولوية',
          'مراقبة أحجام التداول والسيولة المؤسسية قبل اتخاذ القرار',
        ],
        rating: {
          score: gaugeScore ?? 0,
          label: ratingLabel,
          stars_count: starsCount,
        },
      };

      // Add liquidity footprint if available — clearly marked as 30-day cumulative
      if (footprintData?.success) {
        const ratio = Number(footprintData.buy_sell_ratio || 0);
        // ─── CANONICAL-CALCULATIONS (Task CALC-DUP-1, Rule 67) ─────────────
        // قبل كده: كان accumulation_label بـ يـ fabricate بـ thresholds 1.25/0.8
        // + labels "تجميع شهري" غير موجودة في canonical → نتائج متضاربة.
        // الحل: نحسب buy_pct ونستخدم canonical classifyAccumulation.
        const buyVol = Number(footprintData.buy_volume || 0);
        const sellVol = Number(footprintData.sell_volume || 0);
        const buyPctFootprint = (buyVol + sellVol) > 0 ? (buyVol / (buyVol + sellVol)) * 100 : null;
        // UNIFIED-API (Task UI-UNIFIED-MIGRATION, Rule 72)
        // Prefer radar.buy_pct from unified API as canonical source for
        // accumulation label; fall back to footprint-derived buy_pct.
        const buyPct = unified?.radar?.buy_pct != null
          ? Number(unified.radar.buy_pct)
          : buyPctFootprint;
        const accumLabel = unified?.canonical?.accumulation ?? classifyAccumulation(buyPct);
        builtData.liquidity = {
          poc_price: footprintData.poc_price,
          vah_price: footprintData.vah_price,
          val_price: footprintData.val_price,
          buy_volume: footprintData.buy_volume,
          sell_volume: footprintData.sell_volume,
          delta_volume: footprintData.delta_volume,
          buy_sell_ratio: ratio,
          // canonical label — مطابق للرادار + تفاصيل السهم
          accumulation_label: `${accumLabel} (${(ratio ?? 0).toFixed(2)}x)`,
        };
      }

      setFetchedInfographic(builtData);
      setInfographicOpen(true);
    } catch (e) {
      console.error('[UnifiedPublishButton] Failed to prepare infographic:', e);
      toast.error('تعذر تجهيز بطاقة الإنفوجرافيك');
    } finally {
      setLoadingInfographic(false);
    }
  }, [infographicData, resolvedTicker]);

  const activeInfographic = infographicData || fetchedInfographic;

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
      toast.error('لا يوجد عنصر متاح للالتقاط كصورة');
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
              <Facebook className="w-3.5 h-3.5 text-primary" />
              فيسبوك
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleWhatsApp} className="gap-2 text-xs cursor-pointer">
              <MessageCircle className="w-3.5 h-3.5 text-profit" />
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
            <DropdownMenuItem
              onClick={() => setTradeResultsOpen(true)}
              className="gap-2 text-xs cursor-pointer font-bold text-warning hover:text-warning focus:text-warning"
            >
              <BarChart3 className="w-3.5 h-3.5 text-warning" />
              📊 نتائج الصفقات
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
            <Check className="w-4 h-4 text-profit" />
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

        {/* Task 38-B — Trade Results generator modal */}
        <TradeResultsGenerator open={tradeResultsOpen} onOpenChange={setTradeResultsOpen} />
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
          <Facebook className="w-3.5 h-3.5 text-primary" />
          فيسبوك
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleWhatsApp} className="gap-2 text-xs cursor-pointer">
          <MessageCircle className="w-3.5 h-3.5 text-profit" />
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
            <Check className="w-3.5 h-3.5 text-profit" />
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
        {(activeInfographic || resolvedTicker) && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">إنفوجرافيك السهم</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={handleOpenInfographic}
              disabled={loadingInfographic}
              className="gap-2 text-xs cursor-pointer font-bold text-warning hover:text-warning focus:text-warning"
            >
              {loadingInfographic ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-warning" />
              ) : (
                <Camera className="w-3.5 h-3.5 text-warning" />
              )}
              {loadingInfographic ? 'جارٍ تحضير الإنفوجرافيك...' : 'بطاقة إنفوجرافيك السهم والسيولة 📸'}
            </DropdownMenuItem>
          </>
        )}
        {/* Task 38-B — Social Media Report Templates (Daily / Weekly / Monthly) */}
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">قوالب نتائج الصفقات</DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => setTradeResultsOpen(true)}
          className="gap-2 text-xs cursor-pointer font-bold text-warning hover:text-warning focus:text-warning"
        >
          <BarChart3 className="w-3.5 h-3.5 text-warning" />
          📊 نتائج الصفقات (يومي / أسبوعي / شهري)
        </DropdownMenuItem>
      </DropdownMenuContent>
      {activeInfographic && (
        <StockInfographicModal
          data={activeInfographic}
          open={infographicOpen}
          onOpenChange={setInfographicOpen}
        />
      )}
      {/* Task 38-B — Trade Results generator modal (Daily/Weekly/Monthly reports) */}
      <TradeResultsGenerator open={tradeResultsOpen} onOpenChange={setTradeResultsOpen} />
    </DropdownMenu>
  );
}

export default UnifiedPublishButton;
