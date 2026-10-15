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

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { InteractiveChart } from './InteractiveChart';
import { InstitutionalDecisionPanel } from './InstitutionalDecisionPanel';
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
  Brain, Building2, Users, Waves, ShieldCheck, AlertOctagon,
  Copy, Layers, Zap, Eye, EyeOff,
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
  STRONG_BUY:        { bg: 'bg-emerald-600', text: 'text-white', border: 'border-emerald-500/30' },
  INSTITUTIONAL_BUY: { bg: 'bg-emerald-600', text: 'text-white', border: 'border-emerald-500/30' },
  BUY:               { bg: 'bg-emerald-500/10 dark:bg-emerald-500/10', text: 'text-stitch-primary dark:text-stitch-primary', border: 'border-emerald-500/30 dark:border-emerald-500/30' },
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
  // CHART-FIX (2026-10-10): تبديل بين TradingView والشارت المحلي
  const [chartMode, setChartMode] = useState<'tradingview' | 'local'>('tradingview');
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);
  const [advancedLevels, setAdvancedLevels] = useState(false); // Fib/FVG/OB
  const [extraIndicators, setExtraIndicators] = useState(false); // RSI/MACD
  const [technicalDetailsOpen, setTechnicalDetailsOpen] = useState(false);
  // CHART-ENRICH (2026-10-10): تبويبات بدل الأكوردين الميت
  const [activeTab, setActiveTab] = useState<'liquidity' | 'smc' | 'technical'>('liquidity');
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
  
  // UNIFY-FIX: signal + master_score من canonical فقط (Rule 73 — Single Line of Truth)
  // حظر أي fallback لبيانات الشارت القديمة (data.confluence) للأسهم لمنع الإشارات الوهمية
  const signalFinal = canonical?.canonical?.signal || (isCrypto ? (decision?.signal_final || data?.confluence?.signal || '') : '');
  const signalAr = signalFinal ? signalToArabic(signalFinal) : (canonical?.canonical?.signal_ar || '— لا يوجد توقع طازج');
  const signalColor = SIGNAL_COLORS[signalFinal?.toUpperCase()] || SIGNAL_COLORS.HOLD;
  const masterScore = canonical?.canonical?.master_score ?? null;

  // ALPHA-P0: Only show trade plans for genuine BUY signals (not HOLD/WAIT/SELL/AVOID)
  const isBuySignal = Boolean(
    signalFinal && (
      signalFinal.toUpperCase().includes('BUY') ||
      signalFinal.toUpperCase().includes('ACCUMULATE') ||
      signalFinal.toUpperCase().includes('STRONG_BUY')
    )
  );

  // UNIFY-FIX: entry/stop/target/R:R تُعرض فقط لإشارات الشراء الحقيقية (لا fabrication)
  const pred = canonical?.prediction;
  const entry = isBuySignal ? (pred?.entry_price ?? (isCrypto ? (decision?.risk_profile?.entry ?? null) : null)) : null;
  const stop = isBuySignal ? (pred?.stop_loss ?? (isCrypto ? (decision?.risk_profile?.sl ?? null) : null)) : null;
  const target1 = isBuySignal ? (pred?.target_price ?? (isCrypto ? (decision?.risk_profile?.tp1 ?? null) : null)) : null;
  const target2 = isBuySignal ? (pred?.target_price_2 ?? (isCrypto ? (decision?.risk_profile?.tp2 ?? null) : null)) : null;
  const rr = isBuySignal ? (pred?.risk_reward ?? (isCrypto ? (decision?.risk_profile?.rr_ratio_tp1 ?? null) : null)) : null;
  const techScore = masterScore;

  // ─── CHART-ENRICH (2026-10-10): قيم ReasonsForDecision المحسوبة من canonical ───
  // ملء الشرطات الفارغة (—) بقيم حقيقية من unified API
  const radar = canonical?.radar;
  const tech = canonical?.technical;

  // TDZ-FIX (2026-10-10): أنقلنا declarations السعر لـ هنا (قبل الـ useMemo اللي بيستخدمها).
  // قبل كده: livePrice كان معلن على سطر 342 (بعد useMemo على 246/267) = TDZ violation
  // → ReferenceError: Cannot access 'tk' before initialization (الـ minifier سمّاه tk).
  const stockInfo = stocks.find((s) => s.ticker === ticker.toUpperCase());
  const tc = liveData?.today_candle || data?.ohlcv?.[data.ohlcv.length - 1];
  const livePrice = liveData?.today_candle?.close ?? tc?.close ?? stockInfo?.current_price ?? 0;
  const prevClose = data?.ohlcv?.[data.ohlcv.length - 2]?.close ?? livePrice;
  const chgPct = prevClose > 0 ? ((livePrice - prevClose) / prevClose) * 100 : 0;
  const isUp = chgPct >= 0;

  // RSI القيمة + التقييم العربي
  const rsiValue = tech?.rsi ?? data?.current_indicators?.rsi ?? null;
  const rsiAr = useMemo(() => {
    if (rsiValue === null || rsiValue === undefined) return '— بيانات غير متاحة';
    if (rsiValue >= 70) return `${rsiValue.toFixed(1)} • تشبع شرائي`;
    if (rsiValue >= 55) return `${rsiValue.toFixed(1)} • صاعد`;
    if (rsiValue >= 45) return `${rsiValue.toFixed(1)} • محايد`;
    if (rsiValue >= 30) return `${rsiValue.toFixed(1)} • هابط`;
    return `${rsiValue.toFixed(1)} • تشبع بيعي`;
  }, [rsiValue]);

  // موقع السعر بالنسبة للدعم/المقاومة/المتوسطات
  const priceLocationAr = useMemo(() => {
    if (!livePrice || livePrice <= 0) return '— بيانات غير متاحة';
    const support = tech?.support ?? data?.levels?.support ?? null;
    const resistance = tech?.resistance ?? data?.levels?.resistance ?? null;
    const ma50 = tech?.ma_50 ?? null;
    if (support && livePrice > 0 && livePrice <= support * 1.02) {
      return `قرب الدعم (${(support ?? 0).toFixed(2)})`;
    }
    if (resistance && livePrice > 0 && livePrice >= resistance * 0.98) {
      return `قرب المقاومة (${(resistance ?? 0).toFixed(2)})`;
    }
    if (ma50 && livePrice > ma50) {
      return `فوق MA50 (${(ma50 ?? 0).toFixed(2)})`;
    }
    if (ma50 && livePrice < ma50) {
      return `تحت MA50 (${(ma50 ?? 0).toFixed(2)})`;
    }
    return 'منطقة عرضية';
  }, [livePrice, tech?.support, tech?.resistance, tech?.ma_50, data?.levels?.support, data?.levels?.resistance]);

  // السيولة والتجميع (من radar + canonical.buy_pct)
  const liquidityAr = useMemo(() => {
    const buyPct = canonical?.canonical?.buy_pct ?? radar?.buy_pct ?? null;
    const netFlow = radar?.net_flow_egp ?? null;
    const turnover = (livePrice || 0) * (Number(canonical?.stock?.volume ?? 0) || 0);
    if (buyPct !== null && netFlow !== null) {
      const flowM = (netFlow / 1_000_000).toFixed(2);
      const direction = netFlow >= 0 ? 'داخل' : 'خارج';
      return `${flowM}M ج.م • ${buyPct.toFixed(0)}% شرائية`;
    }
    if (buyPct !== null) {
      return `${buyPct.toFixed(0)}% شرائية`;
    }
    if (turnover > 0) {
      return `${(turnover / 1_000_000).toFixed(2)}M ج.م`;
    }
    return '— بيانات غير متاحة';
  }, [canonical?.canonical?.buy_pct, canonical?.stock?.volume, radar?.buy_pct, radar?.net_flow_egp, livePrice]);

  // ─── CHART-ENRICH: AI Executive Stock Story (narrative من prediction.analysis_reason) ─
  const aiStory = useMemo(() => {
    const analysisReason = pred?.analysis_reason ?? null;
    const whoIsBuying = pred?.who_is_buying ?? null;
    const accumulation = canonical?.canonical?.accumulation ?? null;
    const moneyFlow = canonical?.canonical?.money_flow ?? null;
    const phase = canonical?.canonical?.phase ?? null;
    
    // بناء قصة سردية ذكية من الـ data المتاحة
    let summary = '';
    let action = '';
    let risk = '';
    
    // الملخص: من phase + accumulation + money_flow
    if (phase && accumulation) {
      summary = `السهم في مرحلة ${phase} مع ${accumulation}. `;
    } else if (accumulation) {
      summary = `السهم يعرض ${accumulation}. `;
    }
    if (moneyFlow) {
      summary += `تدفق السيولة: ${moneyFlow}.`;
    }
    
    // التوصية والمخاطرة: محكومة حصرياً بإشارة الشراء الحقيقية (لا تناقض)
    if (isBuySignal && entry && target1) {
      action = `الدخول الموصى به عند ${(entry ?? 0).toFixed(2)} ${currencyLabel}، الهدف ${(target1 ?? 0).toFixed(2)} ${(stop ? `مع وقف خسارة عند ${(stop ?? 0).toFixed(2)}` : '')}.`;
      if (stop && entry && rr) {
        const stopPct = ((entry - stop) / entry * 100);
        risk = `وقف الخسارة عند ${(stop ?? 0).toFixed(2)} (${stopPct.toFixed(1)}% تحت الدخول)، نسبة المخاطرة/العائد 1:${(rr ?? 0).toFixed(2)}.`;
      }
    } else if (signalFinal === 'HOLD' || signalFinal === 'WAIT') {
      action = 'الانتظار حتى تأكد الإشارة — لا توجد مراكز شراء مفعلة حالياً.';
      risk = '';
    } else if (signalFinal && (signalFinal.includes('SELL') || signalFinal.includes('REDUCE'))) {
      action = `تجنب الشراء حالياً — الإشارة تصريفية (${signalAr}).`;
      risk = 'مسار هابط أو تصريفي — حماية رأس المال أولى من البحث عن قيعان.';
    } else {
      action = 'لا توجد توصية دخول طازجة من النظام حالياً. راجع المؤشرات الفنية والسيولة بالأسفل.';
      risk = '';
    }
    
    // من يشتري؟
    const who = whoIsBuying ? ` • ${whoIsBuying}` : '';
    
    // analysis_reason لو موجود (من Python V40.2)
    const pythonReason = analysisReason ? `\n\n ${analysisReason}` : '';
    
    return { summary: summary + who, action, risk, pythonReason };
  }, [pred, canonical, signalFinal, signalAr, isBuySignal, entry, target1, stop, rr, currencyLabel]);

  // (السعر الحالي declarations اتقلت لـ سطر 237 — قبل الـ useMemo عشان تتجنب TDZ)

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
      return { label: '🛑 سكين ساقطة وانهيار هيكلي', color: 'text-rose-400 dark:text-rose-400', bg: 'bg-red-50 dark:bg-rose-500/60/30', border: 'border-rose-500/30 dark:border-rose-500/30' };
    }
    if (flightState?.state === 'taking_off' && chgPct < 0 && chgPct > -5) {
      return { label: '🟡 تصحيح في مسار صاعد', color: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-300 dark:border-amber-800' };
    }
    if (makerState?.state === 'accumulation' || (chgPct >= -2 && chgPct <= 2)) {
      return { label: '🟠 تذبذب عرضي ونطاق ضيق', color: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-50 dark:bg-orange-950/30', border: 'border-orange-300 dark:border-orange-800' };
    }
    if (flightState?.state === 'taking_off') {
      return { label: '🟢 مسار صاعد صحي', color: 'text-stitch-primary dark:text-stitch-primary', bg: 'bg-emerald-50 dark:bg-emerald-600/60/30', border: 'border-emerald-500/30 dark:border-emerald-500/30' };
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
      <div className="w-full p-4 space-y-3 dark:bg-surface-container-lowest">
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-xl" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full p-8 text-center dark:bg-surface-container-lowest dark:text-on-surface">
        <AlertTriangle className="w-12 h-12 mx-auto text-amber-500 mb-3 dark:text-error" />
        <p className="text-sm text-stitch-muted mb-3 dark:text-on-surface-variant">{error}</p>
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
        'border border-border/60 stitch-glass rounded-2xl shadow-sm overflow-hidden flex flex-col dark:bg-surface-container-lowest dark:border dark:border-outline-variant/30',
        isMaximized ? 'fixed inset-2 z-50 overflow-y-auto p-4' : 'w-full'
      )}
    >
      {/* ════════════════════════════════════════════════════════════════════════
          §1 — شريط القرار السريع (Decision Header)
          أول حاجة العين تشوفها: الإشارة + الدخول + الوقف + الهدف + R/R
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="px-4 py-3 border-b border-border/60 bg-gradient-to-l from-muted/50 to-card dark:bg-surface-container dark:bg-none dark:border-outline-variant/30">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          {/* يمين: السهم + البحث + السعر */}
          <div className="flex items-center gap-3 flex-wrap">
            <StockSearchSelector
              value={ticker}
              onSelectStock={handleSelectTicker}
              placeholder="اختر السهم"
              compact
              buttonClassName="w-[140px] md:w-[170px] stitch-glass border-border/60 shadow-sm rounded-xl dark:bg-surface-container dark:border-outline-variant/30 dark:text-on-surface"
            />
            <div className="min-w-0">
              <div className="text-sm md:text-base font-black text-stitch-on-surface truncate max-w-[220px] dark:text-on-surface dark:font-outfit">
                {data?.name_ar || data?.name || stockInfo?.name_ar || stockInfo?.name || ticker}
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn(
                    'stitch-num text-xs font-black px-2 py-0.5 rounded-full dark:font-financial',
                    isUp
                      ? 'bg-emerald-50 text-stitch-primary border-emerald-500/30 dark:bg-emerald-600/60/40 dark:text-stitch-primary dark:bg-primary-container/20 dark:text-primary dark:border-primary-container/40'
                      : 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:bg-error-container/20 dark:text-error dark:border-error-container/40'
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
                      : 'bg-rose-600 text-white animate-pulse dark:bg-error dark:text-on-error-container'
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
                  <span className="text-[9px] text-stitch-muted dark:text-on-surface-variant">الدخول</span>
                  <span className="stitch-num font-bold text-stitch-on-surface tabular-nums dark:font-financial dark:text-on-surface">{(entry ?? 0).toFixed(2)}</span>
                </div>
              )}
              {stop !== null && stop > 0 && (
                <div className="flex flex-col items-center">
                  <span className="text-[9px] text-stitch-muted dark:text-on-surface-variant">الوقف</span>
                  <span className="stitch-num font-bold text-rose-600 dark:text-rose-400 dark:text-error tabular-nums dark:font-financial">{(stop ?? 0).toFixed(2)}</span>
                </div>
              )}
              {target1 !== null && target1 > 0 && (
                <div className="flex flex-col items-center">
                  <span className="text-[9px] text-stitch-muted dark:text-on-surface-variant">الهدف</span>
                  <span className="stitch-num font-bold text-stitch-primary dark:text-stitch-primary dark:text-primary tabular-nums dark:font-financial">{(target1 ?? 0).toFixed(2)}</span>
                </div>
              )}
              {rr !== null && rr > 0 && (
                <div className="flex flex-col items-center">
                  <span className="text-[9px] text-stitch-muted dark:text-on-surface-variant">R:R</span>
                  <span className="stitch-num font-bold text-stitch-on-surface tabular-nums dark:font-financial dark:text-on-surface">{(rr ?? 0).toFixed(2)}</span>
                </div>
              )}
              {techScore !== null && (
                <div className="flex flex-col items-center">
                  <span className="text-[9px] text-stitch-muted dark:text-on-surface-variant">الثقة</span>
                  <span className="stitch-num font-bold text-stitch-on-surface tabular-nums dark:font-financial dark:text-on-surface">{(techScore ?? 0).toFixed(0)}%</span>
                </div>
              )}
            </div>
            ) : (
              <div className="p-2 rounded-xl border border-border/60 bg-secondary/40 text-xs text-stitch-muted flex items-center gap-2 dark:bg-surface-container dark:border-outline-variant/30 dark:text-on-surface-variant">
                <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
                <span>لا توجد صفقة شراء مفعلة لهذا السهم حالياً</span>
              </div>
            )}
          </div>

          {/* يسار: الأدوات */}
          <div className="flex items-center gap-1">
            {/* Timeframe — CHART-ENRICH: إضافة 30د/60د للفريمات اللحظية */}
            <div className="flex bg-secondary border border-border/60 rounded-xl p-0.5 text-[10px] font-semibold gap-0.5 dark:bg-surface-container dark:border-outline-variant/30">
              {['5M', '1H', 'DAY', 'WEEK', 'MONTH'].map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setTimeframe(tf)}
                  className={cn(
                    'px-2 py-1 rounded-lg transition-colors',
                    timeframe === tf
                      ? 'bg-emerald-600 text-white font-bold shadow-sm dark:bg-primary-container dark:text-on-primary-container'
                      : 'text-stitch-muted hover:text-stitch-on-surface dark:text-on-surface-variant dark:hover:text-on-surface'
                  )}
                >
                  {tf === '5M' ? '5د' : tf === '1H' ? 'ساعة' : tf === 'DAY' ? 'يومي' : tf === 'WEEK' ? 'أسبوعي' : 'شهري'}
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
              {quickAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : quickAdded ? <Check className="h-3.5 w-3.5 text-stitch-primary" /> : <Star className="h-3.5 w-3.5" />}
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
          <div className="mt-2 text-xs text-stitch-muted flex items-center gap-1 dark:text-on-surface-variant">
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
          CHART-FIX (2026-10-10): إضافة TradingView widget كافتراضي + تبديل للشارت المحلي
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="px-4 py-3">
        {/* شريط أدوات الشارت */}
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          <div className="text-[11px] font-bold text-stitch-muted uppercase tracking-wider dark:text-on-surface-variant dark:font-financial">
            شارت الأسعار
          </div>
          <div className="flex items-center gap-1.5">
            {/* CHART-FIX: زر تبديل بين TradingView الأصلي والشارت المحلي */}
            <Button
              variant={chartMode === 'tradingview' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setChartMode('tradingview')}
              className={cn('h-7 text-[10px] px-2.5 rounded-lg', chartMode === 'tradingview' && 'bg-emerald-600 text-white dark:bg-primary-container dark:text-on-primary-container')}
            >
              TradingView
            </Button>
            <Button
              variant={chartMode === 'local' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setChartMode('local')}
              className={cn('h-7 text-[10px] px-2.5 rounded-lg', chartMode === 'local' && 'bg-emerald-600 text-white dark:bg-primary-container dark:text-on-primary-container')}
            >
              <Activity className="w-3 h-3 ml-1" />
              شارت محلي
            </Button>
          </div>
        </div>

        {/* الشارت — كبير + نظيف */}
        <div className={cn('rounded-xl overflow-hidden border border-border/60 dark:border-outline-variant/30 dark:bg-surface-container-low', isMaximized ? 'h-[600px]' : 'h-[400px] md:h-[500px]')}>
          {chartMode === 'tradingview' ? (
            /* CHART-FIX: TradingView widget — بيجيب الشموع الحية مباشرة بدون فجوات */
            <iframe
              src={`https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(`EGX:${ticker}`)}&interval=D&theme=dark&style=1&timezone=Africa%2FCairo&locale=ar_AE&enable_publishing=false&allow_symbol_change=1&save_image=1&hide_side_toolbar=0&utm_source=invist.m2y.net`}
              className="w-full h-full border-0"
              title={`TradingView ${ticker}`}
              allowFullScreen
            />
          ) : data?.ohlcv && data.ohlcv.length > 0 ? (
            <InteractiveChart
              ohlcv={data.ohlcv}
              indicators={data.indicators || {}}
              visibleIndicators={visibleIndicators}
              levels={data.levels}
              regimeColor={data.market_regime?.color}
              bosEvents={data.bos_events}
              bbSqueezeLevel={data.bb_squeeze?.state}
              entryPrice={entry ?? undefined}
              targetPrice={target1 ?? undefined}
              stopLossPrice={stop ?? undefined}
              target2Price={target2 ?? undefined}
            />
          ) : (
            <div className="h-full flex items-center justify-center text-stitch-muted text-sm dark:text-on-surface-variant dark:bg-surface-container-low">
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
        <div className="px-4 py-3 border-t border-border/60 dark:border-outline-variant/30">
          <div className="rounded-xl border border-border/60 bg-secondary/30 p-3 dark:bg-surface-container-low dark:border-outline-variant/30">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <Target className="w-4 h-4 text-stitch-primary dark:text-primary" />
                <span className="text-xs font-bold dark:text-on-surface dark:font-outfit">خطة الصفقة</span>
              </div>
              {rr !== null && rr > 0 && (
                <Badge variant="outline" className="text-[10px] stitch-num dark:font-financial">
                  R:R 1:{(rr ?? 0).toFixed(2)}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <PlanLevel label="الدخول" value={entry} currencyLabel={currencyLabel} color="text-stitch-on-surface dark:text-on-surface" />
              <PlanLevel label="الوقف" value={stop} currencyLabel={currencyLabel} color="text-rose-600 dark:text-rose-400 dark:text-error" />
              <PlanLevel label="الهدف 1" value={target1} currencyLabel={currencyLabel} color="text-stitch-primary dark:text-stitch-primary dark:text-primary" />
              <PlanLevel label="الهدف 2" value={target2} currencyLabel={currencyLabel} color="text-stitch-primary dark:text-stitch-primary dark:text-primary" />
            </div>
            {data?.suggested_position_size_pct && (
              <div className="mt-2 text-[10px] text-stitch-muted flex items-center gap-1">
                <Wallet className="w-3 h-3" />
                حجم المحفظة المقترح: <strong className="stitch-num text-stitch-primary">{data.suggested_position_size_pct}%</strong>
                {data?.analysis_text && (
                  <span className="text-stitch-muted mr-2">• {data.analysis_text.slice(0, 80)}</span>
                )}
              </div>
            )}
          </div>
        </div>
      ) : !isBuySignal ? (
        <div className="px-4 py-3 border-t border-border/60">
          {(() => {
            // Rule 78 (TradePlanCard filter): For SELL/STRONG_SELL/AVOID signals,
            // show an EXPLICIT red warning panel. For HOLD/WAIT/REDUCE, show an
            // amber "no actionable buy" panel. Never fabricate entry/stop/target.
            const s = (signalFinal || '').toUpperCase();
            const isSellSignal =
              s.includes('SELL') ||
              s.includes('AVOID') ||
              s.includes('KILL') ||
              s.includes('REJECT');
            const isReduce = s.includes('REDUCE');
            const isHoldWait = s === 'HOLD' || s === 'WAIT' || s.includes('ACCUMULATE') === false && !isSellSignal && !isReduce;

            if (isSellSignal) {
              return (
                <div className="p-3 rounded-xl border-2 border-rose-500/30 dark:border-rose-500/30 bg-red-50 dark:bg-rose-500/60/30">
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldAlert className="w-4 h-4 text-rose-400 dark:text-rose-400 shrink-0" />
                    <span className="text-xs font-bold text-rose-400 dark:text-rose-400">
                      تحذير صريح — إشارة تجنّب/بيع
                    </span>
                    <Badge className="text-[9px] bg-rose-500 text-white">لا توجد خطة صفقة</Badge>
                  </div>
                  <p className="text-[11px] text-rose-400 dark:text-rose-400 leading-relaxed">
                    هذا السهم يحمل إشارة تجنّب/بيع ({signalAr}). يمنع نظاميّاً عرض خطة صفقة (دخول/وقف/أهداف) لإشارات
                    البيع/التجنّب. راجع سبب الرفض بالأسفل وتجنّب الدخول حتى تتغير الإشارة إلى شراء حقيقية.
                  </p>
                </div>
              );
            }

            if (isReduce) {
              return (
                <div className="p-3 rounded-xl border-2 border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30">
                  <div className="flex items-center gap-2 mb-1">
                    <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="text-xs font-bold text-amber-700 dark:text-amber-400">
                      إشارة تقليل — لا صفقة شراء جديدة
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                    الإشارة الحالية «تقليل» ({signalAr}). لا تُعرض خطة صفقة شراء في هذه الحالة. لو لديك مركز، راجع
                    سياسة تقليل المخاطر ولا تُضِف كميات جديدة.
                  </p>
                </div>
              );
            }

            // HOLD / WAIT / no-signal
            return (
              <div className="p-3 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-950/20">
                <div className="flex items-center gap-2 mb-0.5">
                  <ShieldAlert className="w-4 h-4 text-amber-500 shrink-0" />
                  <span className="text-xs font-bold text-amber-700 dark:text-amber-400">
                    {isHoldWait ? 'إشارة انتظار' : 'لا توجد إشارة شراء'}
                  </span>
                </div>
                <p className="text-[11px] text-stitch-muted leading-relaxed">
                  لا توجد صفقة شراء مفعلة لهذا السهم حالياً — السهم غير مؤهل أو في مسار هابط/تصريفي/عرضي.
                  خطة الصفقة (دخول + وقف + أهداف) تُعرض فقط لإشارات الشراء الحقيقية (BUY / STRONG_BUY).
                </p>
              </div>
            );
          })()}
        </div>
      ) : null}

      {/* ════════════════════════════════════════════════════════════════════════
          §5 — لماذا هذا القرار؟ (الأدلة) — CHART-ENRICH: ملء الشرطات الفارغة
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="px-4 py-3 border-t border-border/60 dark:border-outline-variant/30">
        <div className="text-xs font-bold mb-2 flex items-center gap-1 dark:text-on-surface dark:font-outfit">
          <Activity className="w-3.5 h-3.5 text-stitch-primary dark:text-primary" />
          أسباب القرار
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-2">
          <ReasonCard
            label="الاتجاه"
            value={flightState?.state ? (flightState.state === 'flying_up' ? 'صاعد' : flightState.state === 'falling_down' ? 'هابط' : 'عرضي') : (canonical?.technical?.trend === 'UP' ? 'صاعد' : canonical?.technical?.trend === 'DOWN' ? 'هابط' : '— بيانات غير متاحة')}
            positive={flightState?.state === 'flying_up' || canonical?.technical?.trend === 'UP'}
            negative={flightState?.state === 'falling_down' || canonical?.technical?.trend === 'DOWN'}
          />
          <ReasonCard
            label="القوة النسبية (RSI)"
            value={rsiAr}
            positive={rsiValue !== null && rsiValue >= 55 && rsiValue < 70}
            negative={rsiValue !== null && (rsiValue >= 70 || rsiValue < 30)}
          />
          <ReasonCard
            label="السيولة"
            value={liquidityAr}
            positive={(canonical?.canonical?.buy_pct ?? 0) >= 60}
            negative={(radar?.net_flow_egp ?? 0) < 0}
          />
          <ReasonCard
            label="التجميع"
            value={canonical?.canonical?.accumulation ?? (makerState?.state === 'absorption' ? 'تجميع مؤسسي' : 'محايد')}
            positive={(canonical?.canonical?.accumulation ?? '').includes('تجميع')}
            negative={(canonical?.canonical?.accumulation ?? '').includes('تصريف')}
          />
          <ReasonCard
            label="موقع السعر"
            value={priceLocationAr}
            positive={priceLocationAr.includes('قرب الدعم') || priceLocationAr.includes('فوق MA50')}
            negative={priceLocationAr.includes('قرب المقاومة') || priceLocationAr.includes('تحت MA50')}
          />
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          §6 — لوحة الأدوات المتقدمة (CHART-ENRICH 2026-10-10)
          استبدال الأكوردين الميت بـ 4 تبويبات حية:
            1. نبض السيولة والمؤسسات (Who Is Buying + Money Flow)
            2. مستويات التداول و SMC (SMC Key Levels)
            3. مستشار الدخول والصفقة (Trade Plan + Deal Advisor)
            4. التفاصيل الفنية (للخبراء)
      ════════════════════════════════════════════════════════════════════════ */}
      <div className="border-t border-border/60 dark:border-outline-variant/30">
        {/* شريط التبويبات */}
        <div className="flex border-b border-border/60 bg-secondary/30 overflow-x-auto dark:bg-surface-container dark:border-outline-variant/30">
          {[
            { id: 'liquidity', label: 'نبض السيولة والمؤسسات', icon: Waves },
            { id: 'smc', label: 'مستويات التداول و SMC', icon: Layers },
            { id: 'technical', label: 'التفاصيل الفنية', icon: Gauge },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-2 text-[11px] font-bold whitespace-nowrap border-b-2 transition-colors',
                activeTab === tab.id
                  ? 'border-emerald-500/30 text-stitch-primary dark:text-stitch-primary dark:border-primary dark:text-primary stitch-glass dark:bg-surface-container-low'
                  : 'border-transparent text-stitch-muted hover:text-stitch-on-surface hover:bg-secondary/50 dark:text-on-surface-variant dark:hover:text-on-surface dark:hover:bg-surface-container-high'
              )}
            >
              <tab.icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* محتوى التبويبات */}
        <div className="px-4 py-3">
          {/* ─── Tab 1: نبض السيولة والمؤسسات (Who Is Buying + Money Flow) ─── */}
          {activeTab === 'liquidity' && (
            <div className="space-y-3">
              {/* أداة: من يشتري؟ (Institutional vs Retail) */}
              <WhoIsBuyingPanel
                buyPct={canonical?.canonical?.buy_pct ?? radar?.buy_pct ?? null}
                sellPct={canonical?.canonical?.sell_pct ?? radar?.sell_pct ?? null}
                whoIsBuying={pred?.who_is_buying ?? null}
                accumulation={canonical?.canonical?.accumulation ?? null}
              />

              {/* أداة: تدفق السيولة والـ Money Flow */}
              <MoneyFlowPanel
                netFlowEgp={radar?.net_flow_egp ?? null}
                buyValueM={radar?.buy_value_m ?? null}
                sellValueM={radar?.sell_value_m ?? null}
                moneyFlow={canonical?.canonical?.money_flow ?? null}
                volumeRatio={radar?.volume_ratio_10d_vs_20d ?? null}
              />

              {/* أداة: كشف المصائد والصعود الوهمي (Trap & Fakeout Radar) */}
              <TrapDetectorPanel
                candlestickPatterns={data?.candlestick_patterns ?? null}
                positionWarning={data?.position_warning ?? null}
                signalFinal={signalFinal}
                makerState={makerState?.state ?? null}
              />
            </div>
          )}

          {/* ─── Tab 2: مستويات التداول و SMC ─── */}
          {activeTab === 'smc' && (
            <div className="space-y-3">
              <SMCKeyLevelsPanel
                support={tech?.support ?? data?.levels?.support ?? null}
                resistance={tech?.resistance ?? data?.levels?.resistance ?? null}
                farSupport={data?.levels?.far_support ?? null}
                farResistance={data?.levels?.far_resistance ?? null}
                pivot={data?.levels?.pivot ?? null}
                entry={entry}
                target1={target1}
                target2={target2}
                stop={stop}
                livePrice={livePrice}
                currencyLabel={currencyLabel}
                smcAnalysis={data?.smc_analysis ?? null}
              />

              {/* SMC Analysis التفصيلي */}
              {data?.smc_analysis && (
                <div className="text-xs rounded-lg border border-border/60 bg-secondary/30 p-2">
                  <div className="font-bold mb-1 text-stitch-muted">تحليل SMC:</div>
                  <div className="text-stitch-on-surface">{data.smc_analysis.bias_ar || '—'}</div>
                  {data.smc_analysis.summary_ar && (
                    <div className="text-stitch-muted mt-1">{data.smc_analysis.summary_ar}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ─── Tab 4: التفاصيل الفنية (للخبراء) ─── */}
          {activeTab === 'technical' && (
            <div className="space-y-3">
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
                  <div className="font-bold mb-1 text-stitch-muted">تحليل SMC:</div>
                  <div className="text-stitch-on-surface">{data.smc_analysis.bias_ar || '—'}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════════════════════
          §7 — Rescue Clinic Banner (بديل DealAdvisorPanel القديم)
      ════════════════════════════════════════════════════════════════════════ */}
      <CardContent className="pt-3 border-t border-border/60">
        <a
          href={`/rescue?ticker=${encodeURIComponent(ticker)}`}
          className="block p-4 rounded-xl border border-border/60 bg-gradient-to-l from-amber-500/10 to-transparent hover:from-amber-500/20 transition-all group"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">🚑</span>
              <div>
                <p className="text-sm font-bold text-stitch-on-surface">هل أنت عالق في هذا السهم بخسارة؟</p>
                <p className="text-[11px] text-stitch-muted">افتح عيادة الإنقاذ المالي للتشخيص وخطة التعافي</p>
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
    <div className="flex flex-col items-center p-2 rounded-lg stitch-glass border border-border/60/50 dark:bg-surface-container dark:border-outline-variant/30">
      <span className="text-[9px] text-stitch-muted dark:text-on-surface-variant">{label}</span>
      <span className={cn('stitch-num font-bold text-sm tabular-nums dark:font-financial', color)}>
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
        ? 'bg-emerald-50 dark:bg-emerald-600/60/30 border-emerald-500/30 dark:border-emerald-500/30 dark:bg-primary-container/20 dark:border-primary-container/40'
        : negative
        ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 dark:bg-error-container/20 dark:border-error-container/40'
        : 'bg-secondary/30 border-border/60 dark:bg-surface-container dark:border-outline-variant/30'
    )}>
      <div className="text-[9px] text-stitch-muted mb-0.5 dark:text-on-surface-variant">{label}</div>
      <div className={cn(
        'text-[11px] font-bold',
        positive ? 'text-stitch-primary dark:text-stitch-primary dark:text-primary' : negative ? 'text-rose-700 dark:text-rose-300 dark:text-error' : 'text-stitch-on-surface dark:text-on-surface'
      )}>
        {value}
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string | undefined | null }) {
  return (
    <div className="flex justify-between p-1.5 rounded bg-secondary/30 border border-border/60/50 dark:bg-surface-container dark:border-outline-variant/30">
      <span className="text-stitch-muted dark:text-on-surface-variant">{label}:</span>
      <span className="stitch-num font-bold text-stitch-on-surface tabular-nums dark:font-financial dark:text-on-surface">{value || '—'}</span>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CHART-ENRICH (2026-10-10): الأدوات الـ 4 المستوحاة من Pine Scripts
// مرجع: V82 + V60.2 (Who Is Buying) + V55 (Money Flow)
// المصدر: canonical + radar + prediction (من /api/stocks/[ticker]/unified)
// ════════════════════════════════════════════════════════════════════════════

// ─── 1) WhoIsBuyingPanel — من يشتري؟ (Institutional vs Retail) ─────────────
// مرجع: EGX_Pro_Institutional_Engine_V60_2_Who_Is_Buying.pine
function WhoIsBuyingPanel({ buyPct, sellPct, whoIsBuying, accumulation }: {
  buyPct: number | null;
  sellPct: number | null;
  whoIsBuying: string | null;
  accumulation: string | null;
}) {
  const institutionalPct = buyPct ?? null;
  const retailPct = sellPct ?? null;
  
  // تحديد الحالة
  let statusBadge = '';
  let statusColor = '';
  if (institutionalPct !== null) {
    if (institutionalPct >= 70) {
      statusBadge = 'تجميع مؤسسي قوي';
      statusColor = 'bg-emerald-500/10 text-stitch-primary border-emerald-500/30 dark:bg-emerald-600/60/40 dark:text-stitch-primary';
    } else if (institutionalPct >= 55) {
      statusBadge = 'تجميع مؤسسي هادئ';
      statusColor = 'bg-teal-100 text-teal-700 border-teal-300 dark:bg-teal-950/40 dark:text-teal-300';
    } else if (institutionalPct >= 45) {
      statusBadge = 'توازن بين المؤسسات والأفراد';
      statusColor = 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-950/40 dark:text-amber-300';
    } else if (institutionalPct >= 30) {
      statusBadge = 'تصريف مؤسسي — احذر';
      statusColor = 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-950/40 dark:text-orange-300';
    } else {
      statusBadge = 'مضاربات أفراد عالية المخاطر';
      statusColor = 'bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300';
    }
  }

  return (
    <div className="rounded-xl border border-border/60 stitch-glass p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Building2 className="w-4 h-4 text-stitch-primary" />
          <span className="text-xs font-bold">من يشتري؟ (مؤسسات vs أفراد)</span>
        </div>
        {statusBadge && (
          <Badge variant="outline" className={cn('text-[9px]', statusColor)}>
            {statusBadge}
          </Badge>
        )}
      </div>
      
      {/* شريط بياني ثنائي (Progress Bar) */}
      {institutionalPct !== null && retailPct !== null ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[10px]">
            <Building2 className="w-3 h-3 text-stitch-primary" />
            <span className="text-stitch-muted">مؤسسات</span>
            <div className="flex-1 h-3 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${institutionalPct}%` }}
              />
            </div>
            <span className="stitch-num font-bold text-stitch-primary dark:text-stitch-primary">
              {institutionalPct.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center gap-2 text-[10px]">
            <Users className="w-3 h-3 text-amber-500" />
            <span className="text-stitch-muted">أفراد</span>
            <div className="flex-1 h-3 rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full bg-amber-500 transition-all"
                style={{ width: `${retailPct}%` }}
              />
            </div>
            <span className="stitch-num font-bold text-amber-700 dark:text-amber-300">
              {retailPct.toFixed(0)}%
            </span>
          </div>
        </div>
      ) : (
        <div className="text-xs text-stitch-muted text-center py-2">
          — بيانات تدفق المؤسسات غير متاحة لهذا السهم
        </div>
      )}
      
      {/* من يشتري؟ من prediction.who_is_buying */}
      {whoIsBuying && (
        <div className="mt-2 pt-2 border-t border-border/60/50 text-[10px] text-stitch-muted">
          <strong>تحليل Python:</strong> {whoIsBuying}
        </div>
      )}
    </div>
  );
}

// ─── 2) MoneyFlowPanel — تدفق السيولة والـ Money Flow ──────────────────────
// مرجع: V55_Money_Flow.pine + V82_Ultimate_EGX_Engine.pine
function MoneyFlowPanel({ netFlowEgp, buyValueM, sellValueM, moneyFlow, volumeRatio }: {
  netFlowEgp: number | null;
  buyValueM: number | null;
  sellValueM: number | null;
  moneyFlow: string | null;
  volumeRatio: number | null;
}) {
  const netFlowM = netFlowEgp !== null ? netFlowEgp / 1_000_000 : null;
  const isPositive = netFlowM !== null && netFlowM >= 0;
  
  // إشارة تدفق السيولة
  let flowSignal = '';
  let flowColor = '';
  if (netFlowM !== null) {
    if (netFlowM > 5) {
      flowSignal = 'سيولة ذكية فائقة الدخول';
      flowColor = 'text-stitch-primary dark:text-stitch-primary';
    } else if (netFlowM > 0) {
      flowSignal = 'سيولة داخلة';
      flowColor = 'text-stitch-primary dark:text-stitch-primary';
    } else if (netFlowM > -5) {
      flowSignal = 'تسرب سيولة خارجة';
      flowColor = 'text-amber-600 dark:text-amber-400';
    } else {
      flowSignal = 'تصريف قوي — خطر';
      flowColor = 'text-rose-700 dark:text-rose-300';
    }
  }

  return (
    <div className="rounded-xl border border-border/60 stitch-glass p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Waves className="w-4 h-4 text-blue-600" />
          <span className="text-xs font-bold">تدفق السيولة (Smart Money Flow)</span>
        </div>
        {flowSignal && (
          <Badge variant="outline" className={cn('text-[9px]', flowColor)}>
            {flowSignal}
          </Badge>
        )}
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
        <div className="rounded-lg bg-secondary/30 p-2 border border-border/60/50">
          <div className="text-[9px] text-stitch-muted">التدفق الصافي</div>
          <div className={cn('stitch-num font-bold', isPositive ? 'text-stitch-primary dark:text-stitch-primary' : 'text-rose-600 dark:text-rose-400')}>
            {netFlowM !== null
              ? `${isPositive ? '+' : ''}${netFlowM.toFixed(2)}M ج.م`
              : '— بيانات غير متاحة'}
          </div>
        </div>
        <div className="rounded-lg bg-secondary/30 p-2 border border-border/60/50">
          <div className="text-[9px] text-stitch-muted">شراء (مليون)</div>
          <div className="stitch-num font-bold text-stitch-primary dark:text-stitch-primary">
            {buyValueM !== null ? `${buyValueM.toFixed(2)}M` : '—'}
          </div>
        </div>
        <div className="rounded-lg bg-secondary/30 p-2 border border-border/60/50">
          <div className="text-[9px] text-stitch-muted">بيع (مليون)</div>
          <div className="stitch-num font-bold text-rose-600 dark:text-rose-400">
            {sellValueM !== null ? `${sellValueM.toFixed(2)}M` : '—'}
          </div>
        </div>
      </div>
      
      <div className="mt-2 flex items-center gap-3 text-[10px]">
        {moneyFlow && (
          <span className="text-stitch-muted">
            <strong>الحالة:</strong> {moneyFlow}
          </span>
        )}
        {volumeRatio !== null && (
          <span className="text-stitch-muted">
            <strong>نسبة الحجم (10d/20d):</strong>{' '}
            <span className={cn('stitch-num font-bold', volumeRatio > 1.5 ? 'text-stitch-primary' : volumeRatio < 0.7 ? 'text-rose-600' : 'text-stitch-on-surface')}>
              {volumeRatio.toFixed(2)}×
            </span>
          </span>
        )}
      </div>
    </div>
  );
}

// ─── 3) TrapDetectorPanel — كشف المصائد والصعود الوهمي ──────────────────────
// مرجع: فلاتر V82 (Fake Breakout / Bull Trap / Liquidity Grab)
function TrapDetectorPanel({ candlestickPatterns, positionWarning, signalFinal, makerState }: {
  candlestickPatterns: Array<{ name: string; signal: string; name_ar: string }> | null;
  positionWarning: string | null;
  signalFinal: string;
  makerState: string | null;
}) {
  // كشف المصائد
  const traps: string[] = [];
  const bullishSignals: string[] = [];
  
  if (candlestickPatterns && candlestickPatterns.length > 0) {
    for (const p of candlestickPatterns) {
      if (p.signal === 'bearish' || p.signal === 'SELL') {
        traps.push(p.name_ar || p.name);
      } else if (p.signal === 'bullish' || p.signal === 'BUY') {
        bullishSignals.push(p.name_ar || p.name);
      }
    }
  }
  
  if (positionWarning) {
    traps.push(positionWarning);
  }
  
  // كشف التصريف
  if (makerState === 'distribution') {
    traps.push('تصريف مؤسسي — السهم بـ يتعرض لضغط بيع مؤسسي');
  }
  
  const isClean = traps.length === 0;
  const hasBullish = bullishSignals.length > 0;
  
  return (
    <div className="rounded-xl border border-border/60 stitch-glass p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-stitch-primary" />
          <span className="text-xs font-bold">كشف المصائد والصعود الوهمي</span>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'text-[9px]',
            isClean
              ? 'bg-emerald-500/10 text-stitch-primary border-emerald-500/30 dark:bg-emerald-600/60/40 dark:text-stitch-primary'
              : 'bg-rose-100 text-rose-700 border-rose-300 dark:bg-rose-950/40 dark:text-rose-300'
          )}
        >
          {isClean ? '✅ خالٍ من المصائد' : '⚠️ تحذير: مصائد مكتشفة'}
        </Badge>
      </div>
      
      {isClean ? (
        <div className="text-xs text-stitch-primary dark:text-stitch-primary text-center py-2">
          لا توجد مصائد أو أنماط سلبية مكتشفة في السهم حالياً
        </div>
      ) : (
        <div className="space-y-1">
          {traps.map((trap, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-rose-700 dark:text-rose-300">
              <AlertOctagon className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{trap}</span>
            </div>
          ))}
        </div>
      )}
      
      {hasBullish && (
        <div className="mt-2 pt-2 border-t border-border/60/50">
          <div className="text-[10px] text-stitch-muted mb-1">إشارات إيجابية:</div>
          <div className="flex flex-wrap gap-1">
            {bullishSignals.map((sig, i) => (
              <Badge key={i} variant="outline" className="text-[9px] bg-emerald-50 text-stitch-primary border-emerald-500/30 dark:bg-emerald-600/60/40 dark:text-stitch-primary">
                {sig}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 4) SMCKeyLevelsPanel — مستويات الدعم والمقاومة المؤسسية ─────────────────
// مرجع: V82 SMC + Key Levels (S1, S2, R1, R2)
function SMCKeyLevelsPanel({ support, resistance, farSupport, farResistance, pivot, entry, target1, target2, stop, livePrice, currencyLabel, smcAnalysis }: {
  support: number | null;
  resistance: number | null;
  farSupport: number | null;
  farResistance: number | null;
  pivot: number | null;
  entry: number | null;
  target1: number | null;
  target2: number | null;
  stop: number | null;
  livePrice: number;
  currencyLabel: string;
  smcAnalysis: { score?: number; score_pct?: number; bias_ar?: string; summary_ar?: string; nearest_ob?: { type: string; price: number; quality: string } | null; nearest_fvg?: { type: string; top: number; bottom: number } | null } | null;
}) {
  const fmt = (v: number | null) => v !== null && v > 0 ? v.toFixed(2) : '—';
  const fmtPct = (level: number | null) => {
    if (!level || !livePrice || livePrice <= 0) return null;
    const pct = ((level - livePrice) / livePrice) * 100;
    return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
  };

  const handleCopy = (value: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(value).then(() => {
        toast.success(`تم نسخ: ${value}`);
      }).catch(() => {});
    }
  };

  const levels = [
    { label: 'مقاومة بعيدة (R2)', value: farResistance, color: 'text-rose-600 dark:text-rose-400' },
    { label: 'مقاومة (R1)', value: resistance, color: 'text-rose-600 dark:text-rose-400' },
    { label: 'الهدف 2', value: target2, color: 'text-stitch-primary dark:text-stitch-primary' },
    { label: 'الهدف 1', value: target1, color: 'text-stitch-primary dark:text-stitch-primary' },
    { label: 'نقطة الدخول', value: entry, color: 'text-blue-600 dark:text-blue-400' },
    { label: 'السعر الحالي', value: livePrice > 0 ? livePrice : null, color: 'text-stitch-on-surface font-black' },
    { label: 'نقطة Pivot', value: pivot, color: 'text-stitch-muted' },
    { label: 'وقف الخسارة', value: stop, color: 'text-rose-600 dark:text-rose-400' },
    { label: 'دعم (S1)', value: support, color: 'text-stitch-primary dark:text-stitch-primary' },
    { label: 'دعم بعيد (S2)', value: farSupport, color: 'text-stitch-primary dark:text-stitch-primary' },
  ];

  return (
    <div className="rounded-xl border border-border/60 stitch-glass p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-purple-600" />
          <span className="text-xs font-bold">مستويات الدعم والمقاومة المؤسسية (SMC)</span>
        </div>
        {smcAnalysis?.score_pct !== undefined && (
          <Badge variant="outline" className="text-[9px]">
            SMC Score: {(smcAnalysis.score_pct ?? 0).toFixed(0)}%
          </Badge>
        )}
      </div>
      
      {/* بطاقة أفقية بمستويات الأسعار */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
        {levels.map((lvl, i) => {
          const pct = fmtPct(lvl.value);
          return (
            <div
              key={i}
              className={cn(
                'flex items-center justify-between p-1.5 rounded-lg border text-xs',
                lvl.value === null ? 'opacity-40' : 'bg-secondary/30 border-border/60/50'
              )}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-stitch-muted">{lvl.label}</span>
                {lvl.value !== null && (
                  <button
                    type="button"
                    onClick={() => handleCopy(fmt(lvl.value))}
                    className="text-stitch-muted hover:text-stitch-on-surface"
                    title="نسخ القيمة"
                  >
                    <Copy className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('stitch-num font-bold', lvl.color)}>
                  {fmt(lvl.value)} {lvl.value !== null && currencyLabel}
                </span>
                {pct && (
                  <span className="text-[9px] text-stitch-muted">{pct}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      
      {/* SMC: Nearest Order Block + FVG */}
      {smcAnalysis && (smcAnalysis.nearest_ob || smcAnalysis.nearest_fvg) && (
        <div className="mt-2 pt-2 border-t border-border/60/50 grid grid-cols-1 md:grid-cols-2 gap-2 text-[10px]">
          {smcAnalysis.nearest_ob && (
            <div className="rounded bg-secondary/30 p-1.5">
              <div className="text-stitch-muted">أقرب Order Block:</div>
              <div className="stitch-num font-bold">
                {smcAnalysis.nearest_ob.type} @ {smcAnalysis.nearest_ob.price.toFixed(2)} ({smcAnalysis.nearest_ob.quality})
              </div>
            </div>
          )}
          {smcAnalysis.nearest_fvg && (
            <div className="rounded bg-secondary/30 p-1.5">
              <div className="text-stitch-muted">أقرب FVG (Fair Value Gap):</div>
              <div className="stitch-num font-bold">
                {smcAnalysis.nearest_fvg.type}: {smcAnalysis.nearest_fvg.bottom.toFixed(2)} → {smcAnalysis.nearest_fvg.top.toFixed(2)}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
