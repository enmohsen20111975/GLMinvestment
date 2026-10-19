'use client';

/**
 * TradeResultsGenerator — مولّد قوالب نتائج الصفقات
 * ====================================================
 * Task 38-B — Client-side component that:
 *   1. Fetches data from `/api/trade-results?period=X` (Task 38-A Data Engine).
 *   2. Renders the appropriate template (Daily/Weekly/Monthly) at native pixel size.
 *   3. Has a "تحميل صورة" (Download Image) button → converts DOM to PNG via html-to-image.
 *   4. Has a "نشر على تليجرام" (Publish to Telegram) button → sends PNG to
 *      `/api/market/publish-status-image`.
 *
 * Rule 67 (NO fabricated data):
 *   - لو `/api/trade-results` رجع 404/503 → نظهر رسالة "محرك النتائج غير متاح بعد"
 *     ونعرض قالب بحالة EmptyState (لا أرقام، لا جدول، لا بطاقات KPI).
 *   - لو `stats === null` (مفيش صفقات مؤهلة) → القالب يعرض EmptyState تلقائياً.
 *
 * Rule 30 (Palette):
 *   - dark navy + emerald + gold + slate + red. لا indigo/blue primary.
 *
 * Rule 68 (Verification):
 *   - html-to-image مثبّت بالفعل (package.json line 83).
 *   - لا dependency جديدة.
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { toPng } from 'html-to-image';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, Send, RefreshCw, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  DailyResultsTemplate,
  WeeklyResultsTemplate,
  MonthlyResultsTemplate,
  normalizeReportData,
  type ReportData,
  type ReportPeriod,
} from './TradeResultsTemplates';

// ─── Constants ───────────────────────────────────────────────────────────────

interface PeriodConfig {
  period: ReportPeriod;
  title: string;
  description: string;
  width: number;
  height: number;
}

const PERIODS: Record<ReportPeriod, PeriodConfig> = {
  daily: {
    period: 'daily',
    title: 'اليومي',
    description: 'نتائج صفقات اليوم بعد إغلاق السوق',
    width: 1080,
    height: 1350,
  },
  weekly: {
    period: 'weekly',
    title: 'الأسبوعي',
    description: 'نتائج صفقات الأسبوع — تقرير شامل',
    width: 1200,
    height: 628,
  },
  monthly: {
    period: 'monthly',
    title: 'الشهري',
    description: 'نتائج صفقات الشهر — التقرير الأبرز',
    width: 1080,
    height: 1080,
  },
};

const PERIOD_ORDER: ReportPeriod[] = ['daily', 'weekly', 'monthly'];

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Caption يُرفق مع الصورة عند النشر على تيليجرام */
function buildCaption(data: ReportData | null, period: ReportPeriod): string {
  const labels: Record<ReportPeriod, string> = {
    daily: '📊 نتائج صفقات اليوم',
    weekly: '📈 نتائج صفقات الأسبوع',
    monthly: '🏆 نتائج صفقات الشهر',
  };
  const head = labels[period];
  const date = new Date().toLocaleDateString('ar-EG', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  if (!data || !data.stats) {
    return `${head}\n📅 ${date}\n\nلا توجد نتائج مؤهلة لهذه الفترة بعد إغلاق السوق.\n\n🔗 invest.m2y.net`;
  }

  const s = data.stats;
  return [
    head,
    `📅 ${date}`,
    '',
    `🏆 الصفقات الناجحة: ${s.winning_closed} من ${s.total_closed}`,
    `🎯 نسبة النجاح: ${(s.success_rate ?? 0).toFixed(1)}%`,
    `📈 متوسط العائد: ${s.average_return >= 0 ? '+' : ''}${(s.average_return ?? 0).toFixed(2)}%`,
    `📊 إجمالي الحركة: ${(s.total_price_movement ?? 0).toFixed(2)}%`,
    '',
    '⭐ أبرز الصفقات الرابحة:',
    ...s.top_trades.slice(0, 5).map((t, i) => {
      const ret = t.realized_return_pct >= 0 ? `+${(t.realized_return_pct ?? 0).toFixed(2)}%` : `${(t.realized_return_pct ?? 0).toFixed(2)}%`;
      const badge = t.exit_price >= t.target_price ? ' 🎯 تجاوز الهدف' : '';
      return `${i + 1}. ${t.ticker} — ${ret}${badge}`;
    }),
    '',
    '🔗 تابع النتائج والتوقعات داخل منصة دليل الاستثمار',
    '🌐 invest.m2y.net',
    '',
    '⚠️ النتائج السابقة لا تضمن نتائج مستقبلية. الاستثمار في البورصة ينطوي على مخاطر، والقرار الاستثماري مسؤولية المستخدم.',
  ].join('\n');
}

// ─── Sub-component: Template preview (scaled to fit container) ────────────────

interface TemplatePreviewProps {
  period: ReportPeriod;
  data: ReportData;
  /** ref على العنصر الجذر اللي بيتـ capture لـ html-to-image */
  captureRef: React.RefObject<HTMLDivElement>;
}

/**
 * يعرض القالب بدقّة البكسل الأصلية (مثلاً 1080×1350) لكن مع CSS scale
 * عشان يظهر داخل modal أصغر.
 *
 * الـ capture بيشيل الـ scale (عشان يطلّع الصورة بالحجم الكامل)
 * عبر إنّ الـ ref مبعوت على العنصر الكبير الفعلي (الأب)، لكن html-to-image
 * بياخد البطاقة بكل أحجامها بفضل pixelRatio: 2.
 */
function TemplatePreview({ period, data, captureRef }: TemplatePreviewProps) {
  const cfg = PERIODS[period];

  // احسب scale بناءً على عرض الحاوية المتاح (max 560px)
  // الـ container ده موجود في الـ Dialog (max-w-4xl → ~896px)
  // نستخدم scale ثابت 0.45 لكل القوالب عشان تتساوى في الـ preview
  const scale = useMemo(() => {
    if (cfg.width <= 628) return 0.55;
    if (cfg.width <= 1080) return 0.48;
    return 0.42;
  }, [cfg.width]);

  const scaledWidth = cfg.width * scale;
  const scaledHeight = cfg.height * scale;

  return (
    <div
      style={{
        width: scaledWidth,
        height: scaledHeight,
        margin: '0 auto',
        position: 'relative',
      }}
    >
      {/* الـ scale container — الـ ref بيتـ capture على ده
          (html-to-image بياخد العنصر بكل أحجامه الداخلية بفضل width/height options) */}
      <div
        ref={captureRef}
        style={{
          width: cfg.width,
          height: cfg.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top right',
          position: 'absolute',
          top: 0,
          right: 0,
        }}
      >
        {period === 'daily' && <DailyResultsTemplate data={data} />}
        {period === 'weekly' && <WeeklyResultsTemplate data={data} />}
        {period === 'monthly' && <MonthlyResultsTemplate data={data} />}
      </div>
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export interface TradeResultsGeneratorProps {
  /** الفترة المبدئية (default: daily) */
  defaultPeriod?: ReportPeriod;
  /** السوق (يُستخدم للـ telegram publish — default: EGX) */
  market?: string;
  /** لو true، الـ dialog يفتح تلقائياً */
  open?: boolean;
  /** callback عند الإغلاق */
  onOpenChange?: (open: boolean) => void;
}

export function TradeResultsGenerator({
  defaultPeriod = 'daily',
  market = 'EGX',
  open: controlledOpen,
  onOpenChange,
}: TradeResultsGeneratorProps) {
  const [period, setPeriod] = useState<ReportPeriod>(defaultPeriod);
  const [data, setData] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engineAvailable, setEngineAvailable] = useState<boolean>(true);
  const [downloading, setDownloading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);

  const isOpen = controlledOpen ?? uncontrolledOpen;
  const setOpen = onOpenChange ?? setUncontrolledOpen;

  const captureRef = useRef<HTMLDivElement>(null);

  // ── Fetch data ──
  const fetchData = useCallback(async (p: ReportPeriod) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trade-results?period=${p}`, {
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.status === 404) {
        // Task 38-A Data Engine مش متاح بعد
        setEngineAvailable(false);
        setData({
          period: p,
          period_start: new Date().toISOString(),
          period_end: new Date().toISOString(),
          stats: null,
          validation: { valid: false, errors: ['Data Engine not available'] },
        });
        return;
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error_ar || err?.error || `HTTP ${res.status}`);
      }

      const raw = await res.json();
      const reportData = normalizeReportData(raw?.data ?? raw);
      setData(reportData);
      setEngineAvailable(true);
    } catch (e: unknown) {
      const err = e as { message?: string };
      console.error('[TradeResultsGenerator] fetch error:', err);
      setError(err?.message || 'فشل في تحميل البيانات');
      setEngineAvailable(false);
      // استخدم EmptyState بدل ما نظهر error في القالب نفسه
      setData({
        period: p,
        period_start: new Date().toISOString(),
        period_end: new Date().toISOString(),
        stats: null,
        validation: { valid: false, errors: [err?.message || 'fetch failed'] },
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Auto-fetch on period change (only if open) ──
  useEffect(() => {
    if (isOpen) {
      fetchData(period);
    }
  }, [isOpen, period, fetchData]);

  // ── Capture card to PNG (full native resolution via html-to-image) ──
  const captureCard = useCallback(async (): Promise<string | null> => {
    if (!captureRef.current) {
      toast.error('لا يمكن التقاط الصورة — القالب غير متاح');
      return null;
    }
    const cfg = PERIODS[period];
    try {
      // مهم: نشيل الـ scale temporarily عشان نلتقط بدقة البكسل الكاملة
      const el = captureRef.current;
      const originalTransform = el.style.transform;
      const originalTransformOrigin = el.style.transformOrigin;
      el.style.transform = 'scale(1)';
      el.style.transformOrigin = 'top left';

      try {
        const dataUrl = await toPng(el, {
          quality: 0.95,
          pixelRatio: 2,
          backgroundColor: '#0a0e1a',
          cacheBust: true,
          skipFonts: true,
          width: cfg.width,
          height: cfg.height,
          style: {
            transform: 'scale(1)',
            transformOrigin: 'top left',
          },
        });
        return dataUrl;
      } finally {
        // رجّع الـ scale الأصلي
        el.style.transform = originalTransform;
        el.style.transformOrigin = originalTransformOrigin;
      }
    } catch (err) {
      console.error('[TradeResultsGenerator] toPng error:', err);
      toast.error('فشل في توليد الصورة');
      return null;
    }
  }, [period]);

  // ── Download handler ──
  const handleDownload = useCallback(async () => {
    setDownloading(true);
    try {
      const dataUrl = await captureCard();
      if (!dataUrl) return;

      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const filename = `trade-results-${period}-${yyyy}-${mm}-${dd}.png`;

      const link = document.createElement('a');
      link.download = filename;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success('تم تحميل الصورة', { description: filename });
    } finally {
      setDownloading(false);
    }
  }, [captureCard, period]);

  // ── Publish to Telegram handler ──
  const handlePublish = useCallback(async () => {
    setPublishing(true);
    try {
      const dataUrl = await captureCard();
      if (!dataUrl) return;

      const caption = buildCaption(data, period);

      const res = await fetch('/api/market/publish-status-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: dataUrl,
          market,
          caption,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (res.ok && json.success) {
        toast.success('تم النشر على تيليجرام', {
          description: json.message_id ? `رسالة #${json.message_id}` : undefined,
        });
      } else {
        const errMsg = json?.error_ar || json?.error || 'فشل في النشر على تيليجرام';
        toast.error('فشل النشر', { description: errMsg });
      }
    } finally {
      setPublishing(false);
    }
  }, [captureCard, data, period, market]);

  // ── Render ──
  const busy = downloading || publishing;
  const cfg = PERIODS[period];
  // Controlled mode (open + onOpenChange passed): لا نظهر زر التشغيل
  // — الـ caller (مثلاً UnifiedPublishButton) بيتحكم في الفتح بنفسه.
  const isControlled = controlledOpen !== undefined && onOpenChange !== undefined;

  return (
    <>
      {/* زر التشغيل (يفتح الـ dialog) — يظهر فقط في الوضع غير المُتحكَم */}
      {!isControlled && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="gap-1.5 border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
        >
          <span className="text-base leading-none">📊</span>
          <span className="hidden sm:inline">نتائج الصفقات</span>
        </Button>
      )}

      <Dialog open={isOpen} onOpenChange={setOpen}>
        <DialogContent
          className="max-w-4xl max-h-[92vh] overflow-y-auto bg-slate-950 border-slate-700 text-slate-100"
          dir="rtl"
        >
          <DialogHeader>
            <DialogTitle className="text-warning flex items-center gap-2 text-lg">
              <span>📊</span>
              نتائج الصفقات — قوالب النشر الاجتماعي
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              اختر الفترة، عاين القالب، ثم حمّل الصورة أو انشرها مباشرة على تيليجرام.
            </DialogDescription>
          </DialogHeader>

          {/* Period tabs */}
          <Tabs value={period} onValueChange={(v) => setPeriod(v as ReportPeriod)}>
            <TabsList className="grid grid-cols-3 w-full bg-slate-900">
              {PERIOD_ORDER.map((p) => (
                <TabsTrigger
                  key={p}
                  value={p}
                  className="data-[state=active]:bg-warning data-[state=active]:text-slate-900 data-[state=active]:font-bold"
                >
                  {PERIODS[p].title}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Status strip */}
          <div className="flex items-center justify-between flex-wrap gap-2 text-xs text-slate-400">
            <div className="flex items-center gap-2">
              <span className="font-mono">
                {cfg.width} × {cfg.height}px
              </span>
              <span className="text-slate-600">·</span>
              <span>{cfg.description}</span>
            </div>
            <div className="flex items-center gap-2">
              {!engineAvailable && (
                <span className="inline-flex items-center gap-1 text-warning bg-warning/10 px-2 py-1 rounded border border-warning/30">
                  <AlertTriangle className="h-3 w-3" />
                  محرك النتائج غير متاح بعد
                </span>
              )}
              {data?.stats && (
                <span className="inline-flex items-center gap-1 text-profit bg-profit/10 px-2 py-1 rounded border border-profit/30">
                  ✓ {data.stats.winning_closed} صفقة ناجحة
                </span>
              )}
            </div>
          </div>

          {/* Preview container */}
          <div className="overflow-x-auto bg-slate-900/50 rounded-lg p-4 border border-slate-800">
            {loading && (
              <div className="flex items-center justify-center py-16 text-slate-400">
                <Loader2 className="h-6 w-6 animate-spin ml-2" />
                جارٍ تحميل النتائج...
              </div>
            )}
            {error && !loading && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AlertTriangle className="h-8 w-8 mb-2 text-warning" />
                <p className="text-warning mb-1 font-bold">فشل في تحميل البيانات</p>
                <p className="text-slate-500 text-sm">{error}</p>
                <p className="text-slate-600 text-xs mt-3 max-w-md">
                  سيتم عرض القالب بحالة فارغة (لا توجد نتائج مؤهلة) — Rule 67: لا أرقام مبتكرة.
                </p>
              </div>
            )}
            {data && !loading && (
              <TemplatePreview
                period={period}
                data={data}
                captureRef={captureRef}
              />
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between gap-2 flex-wrap pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchData(period)}
              disabled={busy || loading}
              className="border-slate-600 text-slate-300 hover:bg-slate-800"
            >
              <RefreshCw className="h-4 w-4 ml-1" />
              تحديث
            </Button>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleDownload}
                disabled={busy || loading || !data}
                className="bg-warning hover:bg-warning text-white gap-1.5"
              >
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                تحميل صورة
              </Button>
              <Button
                size="sm"
                onClick={handlePublish}
                disabled={busy || loading || !data || !engineAvailable}
                className="bg-profit hover:bg-profit text-white gap-1.5"
                title={!engineAvailable ? 'محرك النتائج غير متاح' : undefined}
              >
                {publishing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                نشر على تليجرام
              </Button>
            </div>
          </div>

          {/* Hint */}
          <div className="text-[10px] text-slate-500 text-center pt-1 border-t border-slate-800 mt-1">
            القالب بدقة {cfg.width}×{cfg.height}px · الصورة تُصدّر بدقة مضاعفة (pixelRatio 2) ·
            <span className="text-warning/70"> invest.m2y.net</span>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default TradeResultsGenerator;
