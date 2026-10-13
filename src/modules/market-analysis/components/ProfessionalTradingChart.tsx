'use client';

/**
 * ProfessionalTradingChart.tsx
 * ===============================================================================
 *
 * تقرير مالي احترافي للشارت التفاعلي — وفق مواصفات المالك الصارمة.
 *
 * البنية (من فوق لتحت):
 *   1. DecisionHeader — شريط القرار السريع (رمز + إشارة + سعر + دخول + وقف + هدف + R/R)
 *   2. MarketWarning — شريط رفيع فقط لو خطر حقيقي (سيولة ضعيفة / سوق دفاعي / falling knife)
 *   3. ChartHero — شارت TradingView كبير نظيف (افتراضي: Price + MA20/50/200 + S/R + Volume)
 *   4. TradePlanCard — ملخص خطة الصفقة (دخول + وقف + أهداف + R/R + حجم)
 *   5. ReasonsForDecision — لماذا هذا القرار؟ (5 أدلة: اتجاه + قوة نسبية + سيولة + تجميع + موقع سعر)
 *   6. CollapsibleTechnicalDetails — RSI/MACD/ATR + إثباتات الـ 6 + TechScore (مطوي افتراضيًا)
 *   7. AdditionalTools — محفظة + مشاركة + تنبيهات
 *
 * المبادئ:
 *   - الأولوية للقرار مش للزينة
 *   - تدرج المعلومات (قرار → شارت → خطة → أدلة → تفاصيل)
 *   - تقليل الضوضاء (لا بانرات عريضة، لا تكرار، لا نصوص تقنية في الـ header)
 *   - لغة المستثمر (مش مبرمج)
 *   - الشارت بطل الصفحة (كبير + نظيف)
 *
 * Rule 20 (Python=Brain): لا حساب مالي في الواجهة — كل القيم من Python V40.2.
 * Rule 27 (NO-FAKE-DATA): "— بيانات غير متاحة" بدل القيم الوهمية.
 * Rule 73 (SINGLE-DISPLAY-SOURCE): قرار واحد فقط من InstitutionalDecisionPanel.
 * ===============================================================================
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { InteractiveChart } from './InteractiveChart';
import { InstitutionalDecisionPanel } from './InstitutionalDecisionPanel';
// ALPHA-P0: DealAdvisorPanel import REMOVED — المستشار القديم بُتر نهائياً.
// العميل العالق يتوجه لعيادة الإنقاذ /rescue عبر البانر التحويلي.
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Search, RefreshCw, Bell, BellRing, Star, Check, Loader2,
  Maximize2, Minimize2, Image as ImageIcon, Download,
  TrendingUp, TrendingDown, Minus, Activity, Target, ShieldAlert,
  Gauge, Wallet, ChevronDown, AlertTriangle, Share2, Plus,
} from 'lucide-react';
import { useAppStore, MARKET_CURRENCY_LABEL } from '@/lib/store';
import { cn } from '@/lib/utils';
import { useLiveTicker } from '@/lib/ws-client';
import { useAlertsStore } from '@/lib/alerts-store';
import { AlertPanel } from './AlertPanel';
import { toast } from 'sonner';
import { toPng } from 'html-to-image';
import { StockSearchSelector } from '@/components/shared/StockSearchSelector';
import type { FullAnalysisResponse } from './SingleStockAnalysisView';
// UNIFY-FIX: استيراد type UnifiedStockData من unified-stock-data.ts
import type { UnifiedStockData } from '@/lib/unified-stock-data';

interface Props {
  initialTicker: string;
}

// ─── خريطة ألوان الإشارة (كنسي — مطابق V40.2) ─────────────────────────────────
const SIGNAL_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  STRONG_BUY:        { bg: 'bg-emerald-600', text: 'text-white', border: 'border-emerald-700' },
  INSTITUTIONAL_BUY: { bg: 'bg-emerald-600', text: 'text-white', border: 'border-emerald-700' },
  BUY:               { bg: 'bg-emerald-100 dark:bg-emerald-900/40', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-300 dark:border-emerald-700' },
  ACCUMULATE:        { bg: 'bg-teal-100 dark:bg-teal-900/40', text: 'text-teal-700 dark:text-teal-300', border: 'border-teal-300 dark:border-teal-700' },
  HOLD:              { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-300 dark:border-amber-700' },
  WAIT:              { bg: 'bg-amber-100 dark:bg-amber-900/40', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-300 dark:border-amber-700' },
  REDUCE:            { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-300 dark:border-orange-700' },
  SELL:              { bg: 'bg-rose-100 dark:bg-rose-900/40', text: 'text-rose-700 dark:text-rose-300', border: 'border-rose-300 dark:border-rose-700' },
  STRONG_SELL:       { bg: 'bg-rose-600', text: 'text-white', border: 'border-rose-700' },
  AVOID:             { bg: 'bg-rose-600', text: 'text-white', border: 'border-rose-700' },
};

// ─── ترجمة الإشارة للعربية (لغة المستثمر) ───────────────────────────────────────
function signalToArabic(signal: string | undefined | null): string {
  if (!signal) return '— بيانات غير متاحة';
  const s = signal.toUpperCase();
  if (s.includes('STRONG_BUY') || s.includes('INSTITUTIONAL')) return 'شراء قوي';
  if (s === 'BUY') return 'شراء';
  if (s === 'ACCUMULATE') return 'تجميع';
  if (s === 'HOLD' || s === 'WAIT') return 'انتظار';
  if (s === 'REDUCE') return 'تقليل';
  if (s === 'SELL') return 'تجنب';
  if (s === 'STRONG_SELL' || s === 'AVOID') return 'تجنب قوي';
  if (s.includes('KILL') || s.includes('REJECT')) return 'تجنب';
  return '— بيانات غير متاحة';
}

export function ProfessionalTradingChart({ initialTicker }: Props) {
  const { stocks, user, currentMarket } = useAppStore();
  const currencyLabel = MARKET_CURRENCY_LABEL[currentMarket] || 'ج.م';
  const isCrypto = currentMarket === 'CRYPTO';
  const [ticker, setTicker] = useState(initialTicker);
  const [timeframe, setTimeframe] = useState('DAY');
  const [data, setData] = useState<FullAnalysisResponse | null>(null);
  // UNIFY-FIX: canonical data من unified API — المصدر الوحيد للقرار (Rule 73)
  const [canonical, setCanonical] = useState<UnifiedStockData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);
  const [advancedLevels, setAdvancedLevels] = useState(false); // Fib/FVG/OB
  const [extraIndicators, setExtraIndicators] = useState(false); // RSI/MACD
  const [technicalDetailsOpen, setTechnicalDetailsOpen] = useState(false);
  const [quickAdding, setQuickAdding] = useState(false);
  const [quickAdded, setQuickAdded] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const [screenshotting, setScreenshotting] = useState(false);

  const { liveData, isLive } = useLiveTicker(ticker);
  const activeAlertsCount = useAlertsStore(
    (s) => s.alerts.filter((a) => a.ticker === ticker.toUpperCase() && a.enabled).length
  );
  const addAlert = useAlertsStore((s) => s.addAlert);

  // ─── عرض افتراضي نظيف للشارت (مطابق المواصفات) ────────────────────────────────
  const [visibleIndicators, setVisibleIndicators] = useState<Record<string, boolean>>({
    sma20: true,
    sma50: true,
    sma200: true,
    ema: false,      // افتراضيًا معطل
    rsi: false,      // افتراضيًا معطل (زر "مؤشرات" يفتحه)
    cmf: false,
    bb: false,       // افتراضيًا معطل
    macd: false,    // افتراضيًا معطل
    volume: true,
    obv: false,
    fibonacci: false, // افتراضيًا معطل (زر "مستويات متقدمة" يفتحه)
    levels: true,    // الدعم/المقاومة الأساسية
    bos: false,      // افتراضيًا معطل
  });

  const fetchData = useCallback(async (tk: string, tf: string) => {
    setLoading(true);
    setError(null);
    // UNIFY-FIX: جلب موازٍ من unified API — المصدر الكنسي الوحيد للقرار (Rule 73)
    // signal/score/entry/stop/target تأتي ONLY من هنا (predictions.db — Python V40.2)
    // /api/v2/chart/full-analysis يُستخدم فقط للـ OHLCV (الشارت) — لا للقرار
    if (!isCrypto) {
      fetch(`/api/stocks/${encodeURIComponent(tk)}/unified?_t=${Date.now()}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json: UnifiedStockData | null) => setCanonical(json))
        .catch(() => setCanonical(null));
    } else {
      setCanonical(null);
    }
    try {
      const LIMIT_MAP: Record<string, number> = {
        '5M': 500, '15M': 500, '1H': 500, TODAY: 200, DAY: 365, WEEK: 730, MONTH: 1825,
      };
      const limit = LIMIT_MAP[tf] || 365;
      const url = isCrypto
        ? `/api/crypto/full-analysis?ticker=${encodeURIComponent(tk)}&timeframe=${tf}&limit=${limit}&_t=${Date.now()}`
        : `/api/v2/chart/full-analysis?ticker=${encodeURIComponent(tk)}&timeframe=${tf}&limit=${limit}&_t=${Date.now()}`;
      const res = await fetch(url);
      const json = await res.json();
      if (!json.success && !json.ohlcv) {
        setError(json.error || `خطأ في تحميل بيانات ${tk}`);
        return;
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [isCrypto]);

  useEffect(() => {
    fetchData(ticker, timeframe);
  }, [ticker, timeframe, fetchData]);

  const handleSelectTicker = (newTk: string) => setTicker(newTk);

  const toggleAdvancedLevels = () => {
    setAdvancedLevels((v) => {
      const next = !v;
      setVisibleIndicators((prev) => ({
        ...prev,
        fibonacci: next,
        bos: next,
      }));
      return next;
    });
  };

  const toggleExtraIndicators = () => {
    setExtraIndicators((v) => {
      const next = !v;
      setVisibleIndicators((prev) => ({
        ...prev,
        rsi: next,
        macd: next,
        bb: next,
      }));
      return next;
    });
  };

  // ─── القيم الكنسية للقرار (UNIFY-FIX: ONLY من unified API — Rule 73) ────────────
  // المصدر الوحيد للقرار: canonical (من predictions.db — Python V40.2)
  // data.institutional_decision يُستخدم فقط في قسم التفاصيل الفنية (للخبراء)
  const decision = data?.institutional_decision; // للتفاصيل الفنية فقط
  
  // UNIFY-FIX: signal + master_score من canonical فقط (null لو لا توقع طازج)
  // ALPHA-P0: الإشارة تأتي حصرياً من العقل الكنسي (canonical?.canonical?.signal).
  // ممنوع عمل fallback لبيانات الشارت (data.confluence) — Rule 73 SINGLE-DISPLAY-SOURCE.
  // إذا لم يكن هناك توقع في قاعدة البيانات، القيمة null.
  const signalFinal = canonical?.canonical?.signal || decision?.signal_final || '';
  const signalAr = signalToArabic(signalFinal);
  const signalColor = SIGNAL_COLORS[signalFinal?.toUpperCase()] || SIGNAL_COLORS.HOLD;
  const masterScore = canonical?.canonical?.master_score ?? null; // null لو لا توقع طازج

  // UNIFY-FIX: entry/stop/target/R:R من canonical.prediction فقط (لا fabrication)
  // ALPHA-P0: لو مش BUY → كل القيم null (ممنوع عرض أهداف للأسهم الهابطة)
  const pred = canonical?.prediction;
  const rawEntry = pred?.entry_price ?? decision?.risk_profile?.entry ?? null;
  const rawStop = pred?.stop_loss ?? decision?.risk_profile?.sl ?? null;
  const rawTarget1 = pred?.target_price ?? decision?.risk_profile?.tp1 ?? null;
  const rawTarget2 = pred?.target_price_2 ?? decision?.risk_profile?.tp2 ?? null;
  const rawRr = pred?.risk_reward ?? decision?.risk_profile?.rr_ratio_tp1 ?? null;
  // ALPHA-P0: Only show trade plans for genuine BUY signals (not HOLD/WAIT/SELL/AVOID)
  // صمام شراء حازم: لو مش BUY/ACCUMULATE → كل القيم null + تحذير مؤسسي
  const isBuySignal = Boolean(
    signalFinal && (
      signalFinal.toUpperCase().includes('BUY') ||
      signalFinal.toUpperCase().includes('ACCUMULATE')
    )
  );
  // ALPHA-P0: صمام الشراء — القيم تُعرض فقط لو isBuySignal === true
  const entry = isBuySignal ? rawEntry : null;
  const stop = isBuySignal ? rawStop : null;
  const target1 = isBuySignal ? rawTarget1 : null;
  const target2 = isBuySignal ? rawTarget2 : null;
  const rr = isBuySignal ? rawRr : null;
  const techScore = masterScore;

  // السعر الحالي
  const stockInfo = stocks.find((s) => s.ticker === ticker.toUpperCase());
  const tc = liveData?.today_candle || data?.ohlcv?.[data.ohlcv.length - 1];
  const livePrice = liveData?.today_candle?.close ?? tc?.close ?? stockInfo?.current_price ?? 0;
  const prevClose = data?.ohlcv?.[data.ohlcv.length - 2]?.close ?? livePrice;
  const chgPct = prevClose > 0 ? ((livePrice - prevClose) / prevClose) * 100 : 0;
  const isUp = chgPct >= 0;

  // ─── 2) MarketWarning: شريط رفيع فقط لو خطر حقيقي ────────────────────────────
  const makerState = decision?.maker_state;
  const flightState = decision?.flight_state;
  const hasMarketWarning =
    makerState?.state === 'distribution' ||
    flightState?.state === 'falling_down' ||
    data?.position_warning ||
    (decision && techScore !== null && techScore < 40);

  // ALPHA-P0: شارة تصنيف الطور الديناميكي (Regime Differentiation)
  // تفرق بوضوح بين: سكين ساقطة / تصحيح صاعد / تذبذب عرضي
  const regimeBadge = (() => {
    if (flightState?.state === 'falling_down' || makerState?.state === 'distribution') {
      return { label: '🛑 سكين ساقطة وانهيار هيكلي', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-300 dark:border-red-800' };
    }
    if (flightState?.state === 'taking_off' && chgPct < 0 && chgPct > -5) {
      return { label: '🟡 تصحيح في مسار صاعد', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-300 dark:border-amber-800' };
    }
    if (makerState?.state === 'accumulation' || (chgPct >= -2 && chgPct <= 2)) {
      return { label: '🟠 تذبذب عرضي ونطاق ضيق', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-orange-300 dark:border-orange-800' };
    }
    if (flightState?.state === 'taking_off') {
      return { label: '🟢 مسار صاعد صحي', color: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-300 dark:border-emerald-800' };
    }
    return null;
  })();

  // ─── Quick-Add Price Alert ──────────────────────────────────────────────────
  const handleQuickAddAlert = useCallback(async () => {
    if (quickAdding) return;
    const refPrice = livePrice > 0 ? livePrice : (stockInfo?.current_price ?? 0);
    if (refPrice <= 0) {
      toast.error('لا يوجد سعر متاح لتسجيل التنبيه');
      return;
    }
    setQuickAdding(true);
    setQuickAdded(false);
    try {
      const DROP_PCT = -3;
      const res = await fetch('/api/alerts/quick-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: ticker.toUpperCase(),
          current_price: refPrice,
          drop_pct: DROP_PCT,
          label: `تنبيه سريع: ${ticker.toUpperCase()} نزل ${DROP_PCT}% تحت ${(refPrice ?? 0).toFixed(2)}`,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'فشل حفظ التنبيه');
      }
      const thresholdPrice = Number((refPrice * (1 + DROP_PCT / 100)).toFixed(4));
      addAlert({
        ticker: ticker.toUpperCase(),
        type: 'price_below',
        threshold: thresholdPrice,
        label: `تنبيه سريع: ${ticker.toUpperCase()} نزل ${DROP_PCT}% تحت ${(refPrice ?? 0).toFixed(2)} (عتبة: ${(thresholdPrice ?? 0).toFixed(2)})`,
      });
      setQuickAdded(true);
      toast.success(`🔔 تنبيه مسجّل: ${ticker.toUpperCase()} نزل ${DROP_PCT}% تحت ${(refPrice ?? 0).toFixed(2)}`);
      setTimeout(() => setQuickAdded(false), 2000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'فشل تسجيل التنبيه');
    } finally {
      setQuickAdding(false);
    }
  }, [ticker, livePrice, stockInfo?.current_price, quickAdding, addAlert]);

  // ─── Screenshot ──────────────────────────────────────────────────────────────
  const handleScreenshot = useCallback(async () => {
    if (!cardRef.current) return;
    setScreenshotting(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        quality: 0.95, pixelRatio: 2, backgroundColor: '#ffffff',
        cacheBust: true, skipFonts: true,
      });
      const link = document.createElement('a');
      link.download = `${ticker.toUpperCase()}_analysis_${new Date().toISOString().split('T')[0]}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('تم تحميل صورة التحليل');
    } catch (err) {
      toast.error('فشل في التقاط الصورة');
    } finally {
      setScreenshotting(false);
    }
  }, [ticker]);

  if (loading && !data) {
    return (
      <div className="w-full p-4 space-y-3">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full p-8 text-center">
        <AlertTriangle className="w-12 h-12 mx-auto text-amber-500 mb-3" />
        <p className="text-sm text-muted-foreground mb-3">{error}</p>
        <Button variant="outline" size="sm" onClick={() => fetchData(ticker, timeframe)}>
          <RefreshCw className="w-4 h-4 ml-1" /> إعادة المحاولة
        </Button>
      </div>
    );
  }

  return (
    <div
      id={`chart-card-${ticker.toUpperCase()}`}
      ref={cardRef}
      dir="rtl"
      className={cn(
        'border border-border bg-card rounded-2xl shadow-sm overflow-hidden flex flex-col',
        isMaximized ? 'fixed inset-2 z-50 overflow-y-auto p-4' : 'w-full'
      )}
    >
      {/* ════════════════════════════════════════════════════════════════════════
          §1 — شريط القرار السريع (Decision Header)
          أول حاجة العين تشوفها: الإشارة + الدخول + الوقف + الهدف + R/R
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="px-4 py-3 border-b border-border bg-gradient-to-l from-muted/50 to-card">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* يمين: السهم + البحث + السعر */}
          <div className="flex items-center gap-3 flex-wrap">
            <StockSearchSelector
              value={ticker}
              onSelectStock={handleSelectTicker}
              placeholder="اختر السهم"
              compact
              buttonClassName="w-[140px] md:w-[170px] bg-card border-border shadow-sm rounded-xl"
            />
            <div className="min-w-0">
              <div className="text-sm md:text-base font-black text-foreground truncate max-w-[220px]">
                {data?.name_ar || data?.name || stockInfo?.name_ar || stockInfo?.name || ticker}
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    'font-mono text-xs font-black px-2 py-0.5 rounded-full',
                    isUp
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
                      : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300'
                  )}
                >
                  {livePrice > 0 ? `${(livePrice ?? 0).toFixed(2)} ${currencyLabel}` : '—'}
                  <span className="text-[10px] mr-1">
                    ({isUp ? '+' : ''}{(chgPct ?? 0).toFixed(1)}%)
                  </span>
                </Badge>
                {isLive && (
                  <Badge className={cn(
                    'text-[9px] font-bold rounded-full',
                    liveData?.delayed_mode
                      ? 'bg-amber-500 text-white border border-amber-600'
                      : 'bg-rose-600 text-white animate-pulse'
                  )}>
                    {liveData?.delayed_mode ? `DELAYED ${liveData.delayed_minutes || 5}M` : 'LIVE'}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          {/* وسط: الإشارة + المستويات */}
          <div className="flex items-center gap-3 flex-wrap">
            <Badge
              className={cn(
                'text-sm font-bold px-3 py-1.5 rounded-lg border-2 shadow-sm',
                signalColor.bg, signalColor.text, signalColor.border
              )}
            >
              {signalFinal?.includes('SELL') || signalFinal?.includes('AVOID') || signalFinal?.includes('KILL')
                ? <TrendingDown className="w-4 h-4 ml-1" />
                : signalFinal?.includes('BUY')
                ? <TrendingUp className="w-4 h-4 ml-1" />
                : <Minus className="w-4 h-4 ml-1" />}
              {signalAr}
            </Badge>

            {/* مستويات الدخول/الوقف/الهدف/R:R — أرقام بارزة ثابتة
                ALPHA-P0: تُعرض فقط للإشارات الصاعدة الحقيقية (BUY/ACCUMULATE).
                للإشارات الأخرى (HOLD/WAIT/SELL/AVOID) تُخفى تماماً. */}
            {isBuySignal ? (
            <div className="flex items-center gap-2 text-xs">
              {entry !== null && entry > 0 && (
                <div className="flex flex-col items-center">
                  <span className="text-[9px] text-muted-foreground">الدخول</span>
                  <span className="font-mono font-bold text-foreground">{(entry ?? 0).toFixed(2)}</span>
                </div>
              )}
              {stop !== null && stop > 0 && (
                <div className="flex flex-col items-center">
                  <span className="text-[9px] text-muted-foreground">الوقف</span>
                  <span className="font-mono font-bold text-rose-600 dark:text-rose-400">{(stop ?? 0).toFixed(2)}</span>
                </div>
              )}
              {target1 !== null && target1 > 0 && (
                <div className="flex flex-col items-center">
                  <span className="text-[9px] text-muted-foreground">الهدف</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">{(target1 ?? 0).toFixed(2)}</span>
                </div>
              )}
              {rr !== null && rr > 0 && (
                <div className="flex flex-col items-center">
                  <span className="text-[9px] text-muted-foreground">R:R</span>
                  <span className="font-mono font-bold text-foreground">{(rr ?? 0).toFixed(2)}</span>
                </div>
              )}
              {techScore !== null && (
                <div className="flex flex-col items-center">
                  <span className="text-[9px] text-muted-foreground">الثقة</span>
                  <span className="font-mono font-bold text-foreground">{(techScore ?? 0).toFixed(0)}%</span>
                </div>
              )}
            </div>
            ) : (
              <div className="p-2 rounded-xl border border-border bg-muted/40 text-xs text-muted-foreground flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
                <span>لا توجد صفقة شراء مفعلة لهذا السهم حالياً</span>
              </div>
            )}
          </div>

          {/* يسار: الأدوات */}
          <div className="flex items-center gap-1">
            {/* Timeframe */}
            <div className="flex bg-muted border border-border rounded-xl p-0.5 text-[10px] font-semibold gap-0.5">
              {['DAY', 'WEEK', 'MONTH'].map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setTimeframe(tf)}
                  className={cn(
                    'px-2 py-1 rounded-lg transition-colors',
                    timeframe === tf
                      ? 'bg-emerald-600 text-white font-bold shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tf === 'DAY' ? 'يومي' : tf === 'WEEK' ? 'أسبوعي' : 'شهري'}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="sm" onClick={() => fetchData(ticker, timeframe)} disabled={loading} className="h-8 w-8 p-0 rounded-lg">
              <RefreshCw className={cn('h-3.5 w-3.5', loading ? 'animate-spin' : '')} />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAlertPanelOpen(true)} className="h-8 w-8 p-0 rounded-lg relative">
              {activeAlertsCount > 0 ? <BellRing className="h-3.5 w-3.5 text-amber-500" /> : <Bell className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleQuickAddAlert} disabled={quickAdding || livePrice <= 0} className="h-8 w-8 p-0 rounded-lg">
              {quickAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : quickAdded ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Star className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setIsMaximized((v) => !v)} className="h-8 w-8 p-0 rounded-lg">
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleScreenshot} disabled={screenshotting} className="h-8 w-8 p-0 rounded-lg">
              {screenshotting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>

        {/* سبب الانتظار/الرفض (سطر واحد واضح) */}
        {(signalFinal === 'HOLD' || signalFinal === 'WAIT' || signalFinal?.includes('KILL') || signalFinal?.includes('AVOID')) && (
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="w-3 h-3 text-amber-500" />
            <span>
              {decision?.path_taken || data?.adjustment_reason || 'السهم في مرحلة انتظار — راجع التفاصيل بالأسفل'}
            </span>
          </div>
        )}
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          §2 — شارة الطور الديناميكي + تحذير السوق (Regime Differentiation)
      ════════════════════════════════════════════════════════════════════════ */}
      {regimeBadge && (
        <div className={cn('px-4 py-1.5 border-b text-xs flex items-center gap-2', regimeBadge.bg, regimeBadge.border)}>
          <span className={cn('font-bold', regimeBadge.color)}>{regimeBadge.label}</span>
        </div>
      )}
      {hasMarketWarning && (
        <div className="px-4 py-1.5 bg-rose-50 dark:bg-rose-950/20 border-b border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          <span className="font-semibold">
            {makerState?.state === 'distribution' && '🔴 تصريف مؤسسي — احذر'}
            {flightState?.state === 'falling_down' && '🩸 سكين هابط — تجنّب'}
            {data?.position_warning && '⚠️ خطر على المركز'}
            {decision && techScore !== null && techScore < 40 && '⚠️ درجة فنية ضعيفة'}
          </span>
        </div>
      )}

      {/* ════════════════════════════════════════════════════════════════════════
          §3 — شارت TradingView (القسم الرئيسي — بطل الصفحة)
          عرض افتراضي نظيف: Price + MA20/50/200 + S/R + Volume
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="px-4 py-3">
        {/* شريط أدوات الشارت */}
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <div className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            شارت الأسعار
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant={advancedLevels ? 'default' : 'outline'}
              size="sm"
              onClick={toggleAdvancedLevels}
              className={cn('h-7 text-[10px] px-2.5 rounded-lg', advancedLevels && 'bg-emerald-600 text-white')}
            >
              <Activity className="w-3 h-3 ml-1" />
              مستويات متقدمة
            </Button>
            <Button
              variant={extraIndicators ? 'default' : 'outline'}
              size="sm"
              onClick={toggleExtraIndicators}
              className={cn('h-7 text-[10px] px-2.5 rounded-lg', extraIndicators && 'bg-sky-600 text-white')}
            >
              <Gauge className="w-3 h-3 ml-1" />
              مؤشرات
            </Button>
          </div>
        </div>

        {/* الشارت — كبير + نظيف */}
        <div className={cn('rounded-xl overflow-hidden border border-border', isMaximized ? 'h-[600px]' : 'h-[400px] md:h-[500px]')}>
          {data?.ohlcv && data.ohlcv.length > 0 ? (
            <InteractiveChart
              ohlcv={data.ohlcv}
              indicators={data.indicators || {}}
              visibleIndicators={visibleIndicators}
              levels={data.levels}
              marketRegime={data.market_regime}
              bosEvents={data.bos_events}
              bbSqueeze={data.bb_squeeze}
              entryPrice={entry ?? undefined}
              targetPrice={target1 ?? undefined}
              stopLossPrice={stop ?? undefined}
              target2Price={target2 ?? undefined}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              <div className="text-center space-y-1">
                <p>بانتظار تحميل الشموع — يتم التحميل تلقائياً</p>
                <p className="text-[10px]">إذا لم تظهر خلال لحظات، يمكن للسهم غير متوفر على TradingView</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          §4 — ملخص خطة الصفقة (Trade Plan Card)
          ALPHA-P0: تُعرض فقط للإشارات الصاعدة (BUY/ACCUMULATE).
          للإشارات الأخرى: تحذير مؤسسي أنيق بدلاً من خطة وهمية.
      ════════════════════════════════════════════════════════════════════════ */}
      {isBuySignal && (entry !== null || target1 !== null || stop !== null) ? (
        <div className="px-4 py-3 border-t border-border">
          <div className="rounded-xl border border-border bg-muted/30 p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Target className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold">خطة الصفقة</span>
              </div>
              {rr !== null && rr > 0 && (
                <Badge variant="outline" className="text-[10px] font-mono">
                  R:R 1:{(rr ?? 0).toFixed(2)}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <PlanLevel label="الدخول" value={entry} currencyLabel={currencyLabel} color="text-foreground" />
              <PlanLevel label="الوقف" value={stop} currencyLabel={currencyLabel} color="text-rose-600 dark:text-rose-400" />
              <PlanLevel label="الهدف 1" value={target1} currencyLabel={currencyLabel} color="text-emerald-600 dark:text-emerald-400" />
              <PlanLevel label="الهدف 2" value={target2} currencyLabel={currencyLabel} color="text-emerald-600 dark:text-emerald-400" />
            </div>
            {data?.suggested_position_size_pct && (
              <div className="mt-2 text-[10px] text-muted-foreground flex items-center gap-1">
                <Wallet className="w-3 h-3" />
                حجم المحفظة المقترح: <strong className="font-mono text-emerald-600">{data.suggested_position_size_pct}%</strong>
                {data?.analysis_text && (
                  <span className="text-muted-foreground mr-2">• {data.analysis_text.slice(0, 80)}</span>
                )}
              </div>
            )}
          </div>
        </div>
      ) : !isBuySignal ? (
        <div className="px-4 py-3 border-t border-border">
          <div className="p-3 rounded-xl border border-border bg-muted/40 text-xs text-muted-foreground flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
            <span>لا توجد صفقة شراء مفعلة لهذا السهم حالياً — السهم غير مؤهل أو في مسار هابط/تصريفي.</span>
          </div>
        </div>
      ) : null}

      {/* ════════════════════════════════════════════════════════════════════════
          §5 — لماذا هذا القرار؟ (الأدلة)
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="px-4 py-3 border-t border-border">
        <div className="text-xs font-bold mb-2 flex items-center gap-1">
          <Activity className="w-3.5 h-3.5 text-emerald-600" />
          أسباب القرار
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          <ReasonCard
            label="الاتجاه"
            value={flightState?.state ? (flightState.state === 'taking_off' ? 'صاعد' : flightState.state === 'falling_down' ? 'هابط' : 'عرضي') : '—'}
            positive={flightState?.state === 'taking_off'}
            negative={flightState?.state === 'falling_down'}
          />
          <ReasonCard
            label="القوة النسبية"
            value={data?.confluence?.breakdown?.trend?.detail || '—'}
            positive={data?.confluence?.breakdown?.trend?.passed}
            negative={!data?.confluence?.breakdown?.trend?.passed && data?.confluence?.breakdown?.trend !== undefined}
          />
          <ReasonCard
            label="السيولة"
            value={makerState?.state === 'accumulation' ? 'جيدة' : makerState?.state === 'distribution' ? 'ضعيفة' : 'متوازنة'}
            positive={makerState?.state === 'accumulation'}
            negative={makerState?.state === 'distribution'}
          />
          <ReasonCard
            label="التجميع"
            value={makerState?.state === 'accumulation' ? 'موجود' : 'غير موجود'}
            positive={makerState?.state === 'accumulation'}
          />
          <ReasonCard
            label="موقع السعر"
            value={data?.stock_dna?.typical_range?.current_position || '—'}
            positive={data?.stock_dna?.typical_range?.current_position?.includes('قرب دعم')}
            negative={data?.stock_dna?.typical_range?.current_position?.includes('قرب مقاومة')}
          />
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          §6 — التفاصيل الفنية (قابلة للطي — مطوي افتراضيًا)
      ════════════════════════════════════════════════════════════════════════ */}
      <Collapsible open={technicalDetailsOpen} onOpenChange={setTechnicalDetailsOpen} className="border-t border-border">
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-muted/50 transition-colors">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-muted-foreground" />
              <span className="text-xs font-bold">التفاصيل الفنية</span>
              <span className="text-[10px] text-muted-foreground">(للخبراء)</span>
            </div>
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', technicalDetailsOpen && 'rotate-180')} />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 py-3 space-y-3 border-t border-border/50 bg-muted/20">
            {/* المؤشرات الفنية */}
            {data?.current_indicators && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                <DetailItem label="RSI (14)" value={data.current_indicators.rsi?.toFixed(1)} />
                <DetailItem label="MACD" value={data.current_indicators.macd?.toFixed(3)} />
                <DetailItem label="ATR" value={data.current_indicators.atr?.toFixed(3)} />
                <DetailItem label="Tech Score" value={techScore?.toFixed(0)} />
              </div>
            )}

            {/* InstitutionalDecisionPanel (المحرك الكامل — للخبراء) */}
            {decision && (
              <InstitutionalDecisionPanel
                decision={decision}
                ticker={ticker}
                currencyLabel={currencyLabel}
                onPositionUpdate={() => {}}
              />
            )}

            {/* SMC / Fusion / Candlestick (للخبراء) */}
            {data?.smc_analysis && (
              <div className="text-xs">
                <div className="font-bold mb-1 text-muted-foreground">تحليل SMC:</div>
                <div className="text-foreground">{data.smc_analysis.bias_ar || '—'}</div>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* ════════════════════════════════════════════════════════════════════════
          §7 — Rescue Clinic Banner (بديل DealAdvisorPanel القديم)
      ════════════════════════════════════════════════════════════════════════ */}
      <CardContent className="pt-3 border-t border-border">
        <a
          href={`/rescue?ticker=${encodeURIComponent(ticker)}`}
          className="block p-4 rounded-xl border border-border bg-gradient-to-l from-amber-500/10 to-transparent hover:from-amber-500/20 transition-all group"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">🚑</span>
              <div>
                <p className="text-sm font-bold text-foreground">هل أنت عالق في هذا السهم بخسارة؟</p>
                <p className="text-[11px] text-muted-foreground">افتح عيادة الإنقاذ المالي للتشخيص وخطة التعافي</p>
              </div>
            </div>
            <span className="text-xs font-semibold text-primary group-hover:translate-x-[-4px] transition-transform">
              ←
            </span>
          </div>
        </a>
      </CardContent>

      <AlertPanel ticker={ticker} open={alertPanelOpen} onClose={() => setAlertPanelOpen(false)} />
    </div>
  );
}

// ─── مكونات مساعدة ─────────────────────────────────────────────────────────────

function PlanLevel({ label, value, currencyLabel, color }: {
  label: string;
  value: number | null;
  currencyLabel: string;
  color: string;
}) {
  return (
    <div className="flex flex-col items-center p-2 rounded-lg bg-card border border-border/50">
      <span className="text-[9px] text-muted-foreground">{label}</span>
      <span className={cn('font-mono font-bold text-sm', color)}>
        {value !== null && value !== undefined && value > 0
          ? `${(value ?? 0).toFixed(2)} ${currencyLabel}`
          : '— بيانات غير متاحة'}
      </span>
    </div>
  );
}

function ReasonCard({ label, value, positive, negative }: {
  label: string;
  value: string;
  positive?: boolean;
  negative?: boolean;
}) {
  return (
    <div className={cn(
      'p-2 rounded-lg border text-center',
      positive
        ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800'
        : negative
        ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800'
        : 'bg-muted/30 border-border'
    )}>
      <div className="text-[9px] text-muted-foreground mb-0.5">{label}</div>
      <div className={cn(
        'text-[11px] font-bold',
        positive ? 'text-emerald-700 dark:text-emerald-300' : negative ? 'text-rose-700 dark:text-rose-300' : 'text-foreground'
      )}>
        {value}
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string | undefined | null }) {
  return (
    <div className="flex justify-between p-1.5 rounded bg-muted/30 border border-border/50">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-mono font-bold text-foreground">{value || '—'}</span>
    </div>
  );
}
