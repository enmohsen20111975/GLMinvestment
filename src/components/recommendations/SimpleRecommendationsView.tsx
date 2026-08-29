'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw, Send, Loader2, TrendingUp, TrendingDown,
  Target, Shield, AlertTriangle, Copy, Share2, User, Bot, Sparkles, Filter, History, Bell, BellRing
} from 'lucide-react';
import { toast } from 'sonner';
import { OFFICIAL_LINKS_BLOCK } from '@/lib/official-links';
import { cn } from '@/lib/utils';
import { useAppStore, MARKET_NAMES_AR } from '@/lib/store';
import { detectIsSellSignal } from '@/lib/signal-utils';
import { PublishedPredictions } from './PublishedPredictions';
import { RefreshAnalyticsButton } from './RefreshAnalyticsButton';
import { useSignalNotifications } from '@/hooks/useSignalNotifications';

// ============================================================================
// Types
// ============================================================================

// ROBO-ADVISOR-P1: التوقعات السابقة (الأرشيف) بحالاتها
interface PreviousPrediction {
  ticker: string;
  name?: string;
  name_ar?: string;
  signal: string;
  signal_ar: string;
  entry_price: number;
  target_price?: number | null;
  stop_loss?: number | null;
  master_score: number;
  confidence: number;
  prediction_date?: string;
  outcome_date?: string | null;
  exit_price?: number | null;
  actual_return?: number | null;
  holding_days?: number;
  status: 'TARGET_HIT' | 'STOPPED' | 'PENDING';
  status_ar: string;
}

interface StockRecommendation {
  ticker: string;
  name: string;
  current_price: number;
  change_percent: number;
  signal: string;
  signal_ar: string;
  master_score: number;
  entry_price: number;
  stop_loss: number;
  target_price: number;
  target_pct?: string;
  target_price_2?: number;
  investment_target?: number;
  support_level?: number;
  risk_reward_ratio: number;
  technical_score?: number;
  confidence?: number;
  rsi?: number;
  source?: 'ai' | 'human';
  expert_name?: string;
  // CASCADING-FALLBACK-031: شارة التدرج في القبول (شفافية للعميل)
  fallback_tier?: 'strict' | 'moderate' | 'survival' | 'last_resort';
  fallback_tier_ar?: string;
  // ROBO-ADVISOR-P1: وسم الجديد/المستمر
  is_new?: boolean;
  is_continuous?: boolean;
  // P1-MAXHIGH-MINLOW: مسار السهم منذ التوقع (أعلى/أقل سعر)
  peak_high?: number | null;
  trough_low?: number | null;
}

interface HumanRecommendation {
  id: string;
  stock_symbol: string;
  stock_name_ar?: string;
  expert_name: string;
  action: string;
  entry_price: number;
  entry_price_from?: number;
  entry_price_to?: number;
  target_price?: number;
  target_price_2?: number;
  investment_target?: number;
  stop_loss?: number;
  notes?: string;
  session_date?: string;
  status: string;
}

// ============================================================================
// Helper Functions
// ============================================================================

function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined) return '0.00';
  const num = Number(price);
  if (isNaN(num)) return '0.00';
  return num.toFixed(2);
}

// REALITY-CHECK-025: فحص حالة الجلسة — منع تحديث البيانات بعد إغلاق السوق
// Egypt (EGX): الأحد-الخميس، 10:00 - 14:30 بتوقيت القاهرة
// TADAWUL: الأحد-الخميس، 10:00 - 15:00 بتوقيت الرياض
// KSE: الأحد-الخميس، 09:00 - 13:00 بتوقيت الكويت
// QSE: الأحد-الخميس، 09:30 - 13:30 بتوقيت الدوحة
// US: الإثنين-الجمعة، 9:30 - 16:00 EST
// CRYPTO: 24/7 (دائمًا مفتوح)
function isMarketOpen(market: string): boolean {
  const now = new Date();
  const day = now.getDay(); // 0=Sunday, 6=Saturday

  // CRYPTO دائمًا مفتوح 24/7
  if (market === 'CRYPTO') return true;

  // EGX (مصر) — بتوقيت القاهرة (UTC+2/+3)
  // الأحد-الخميس (0-4)
  if (market === 'EGX' || market === 'EGP') {
    if (day === 5 || day === 6) return false; // جمعة/سبت
    const cairoOffset = 2; // UTC+2 (تقريبًا)
    const cairoHour = (now.getUTCHours() + cairoOffset + 24) % 24;
    const cairoMin = now.getUTCMinutes();
    const totalMin = cairoHour * 60 + cairoMin;
    return totalMin >= 600 && totalMin <= 870; // 10:00 - 14:30
  }

  // TADAWUL (السعودية) — بتوقيت الرياض (UTC+3)
  if (market === 'TADAWUL' || market === 'KSA' || market === 'SAU') {
    if (day === 5 || day === 6) return false;
    const riyadhOffset = 3;
    const riyadhHour = (now.getUTCHours() + riyadhOffset + 24) % 24;
    const riyadhMin = now.getUTCMinutes();
    const totalMin = riyadhHour * 60 + riyadhMin;
    return totalMin >= 600 && totalMin <= 900; // 10:00 - 15:00
  }

  // KSE (الكويت) — بتوقيت الكويت (UTC+3)
  if (market === 'KSE' || market === 'KWT') {
    if (day === 5 || day === 6) return false;
    const kuwaitOffset = 3;
    const kuwaitHour = (now.getUTCHours() + kuwaitOffset + 24) % 24;
    const kuwaitMin = now.getUTCMinutes();
    const totalMin = kuwaitHour * 60 + kuwaitMin;
    return totalMin >= 540 && totalMin <= 780; // 09:00 - 13:00
  }

  // QSE (قطر) — بتوقيت الدوحة (UTC+3)
  if (market === 'QSE' || market === 'QAT') {
    if (day === 5 || day === 6) return false;
    const dohaOffset = 3;
    const dohaHour = (now.getUTCHours() + dohaOffset + 24) % 24;
    const dohaMin = now.getUTCMinutes();
    const totalMin = dohaHour * 60 + dohaMin;
    return totalMin >= 570 && totalMin <= 810; // 09:30 - 13:30
  }

  // US — الإثنين-الجمعة، 9:30 - 16:00 EST (UTC-5)
  if (market === 'US' || market === 'USA') {
    if (day === 0 || day === 6) return false; // Sunday/Saturday
    const estOffset = -5;
    const estHour = (now.getUTCHours() + estOffset + 24) % 24;
    const estMin = now.getUTCMinutes();
    const totalMin = estHour * 60 + estMin;
    return totalMin >= 570 && totalMin <= 960; // 09:30 - 16:00
  }

  // افتراضي: مفتوح
  return true;
}

function getArabicDate(): string {
  const days = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const months = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const day = new Date().getDate();
  const dayName = days[new Date().getDay()];
  const month = months[new Date().getMonth()];
  const year = new Date().getFullYear();
  return `جلسة ${dayName} ${day}-${new Date().getMonth() + 1}-${year}`;
}

const EXPERT_NAMES: Record<string, string> = {
  'AF': 'أحمد الفيومي',
  'RR': 'ريمون رؤوف',
  'MH': 'محسن',
  'ADMIN': 'توقعة الإدارة',
  'XX': 'محلل',
};

// Signal colors
const SIGNAL_COLORS: Record<string, string> = {
  'STRONG_BUY': 'bg-emerald-500 text-white',
  'BUY': 'bg-green-500 text-white',
  'ACCUMULATE': 'bg-teal-500 text-white',
  'HOLD': 'bg-gray-500 text-white',
  'REDUCE': 'bg-orange-500 text-white',
  'SELL': 'bg-red-500 text-white',
  'STRONG_SELL': 'bg-red-700 text-white',
};

// ============================================================================
// ROBO-ADVISOR-P1: FlashingPrice — وميض السعر اللحظي عند التحديث
// ============================================================================
// لما current_price يتحدث، الخلية تومض أخضر (طلع) أو أحمر (نزل).
function FlashingPrice({ price, className }: { price: number; className?: string }) {
  const prevRef = useRef<number | null>(null);
  const [flashDir, setFlashDir] = useState<'up' | 'down' | null>(null);
  const [bumpKey, setBumpKey] = useState(0);

  useEffect(() => {
    const prev = prevRef.current;
    if (prev !== null && prev !== price) {
      setFlashDir(price > prev ? 'up' : 'down');
      setBumpKey((k) => k + 1);
      const t = setTimeout(() => setFlashDir(null), 950);
      prevRef.current = price;
      return () => clearTimeout(t);
    }
    prevRef.current = price;
  }, [price]);

  const flashClass = flashDir === 'up' ? 'price-flash-up' : flashDir === 'down' ? 'price-flash-down' : '';
  return (
    <span key={bumpKey} className={cn('font-medium inline-block transition-colors', flashClass, className)}>
      {formatPrice(price)}
    </span>
  );
}

// ============================================================================
// Financial Metrics Helpers
// ============================================================================

function getRiskPerTradePct(rec: StockRecommendation): number {
  const entry = rec.entry_price || rec.current_price;
  const stop = rec.stop_loss;
  if (entry <= 0 || stop <= 0) return 0;
  const isSell = detectIsSellSignal(rec.signal, rec.target_price, stop, entry);
  if (isSell) {
    return Math.abs((stop - entry) / entry * 100);
  }
  return Math.abs((entry - stop) / entry * 100);
}

function getCapitalProtectionInfo(rec: StockRecommendation): { label: string; color: string; bg: string } {
  const rr = Number(rec.risk_reward_ratio) || 0;
  const riskPct = getRiskPerTradePct(rec);
  if (rr >= 2.5 && riskPct <= 3) return { label: 'حماية عالية', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-900/50' };
  if (rr >= 1.5 && riskPct <= 5) return { label: 'حماية متوسطة', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-900/50' };
  return { label: 'حماية منخفضة', color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-900/50' };
}

function getRiskLevelInfo(rec: StockRecommendation): { label: string; color: string; bg: string } {
  const rr = Number(rec.risk_reward_ratio) || 0;
  const riskPct = getRiskPerTradePct(rec);
  if (rr >= 2 && riskPct <= 3) return { label: 'منخفض', color: 'text-emerald-700 dark:text-emerald-300', bg: 'bg-emerald-100 dark:bg-emerald-900/50' };
  if (rr >= 1.2 && riskPct <= 5) return { label: 'متوسط', color: 'text-amber-700 dark:text-amber-300', bg: 'bg-amber-100 dark:bg-amber-900/50' };
  return { label: 'مرتفع', color: 'text-red-700 dark:text-red-300', bg: 'bg-red-100 dark:bg-red-900/50' };
}

function getExpectedReturnColor(pct: number | string | undefined): string {
  const val = Number(pct) || 0;
  if (val >= 10) return 'text-emerald-600 dark:text-emerald-400';
  if (val >= 5) return 'text-green-600 dark:text-green-400';
  if (val >= 0) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function getRRColor(rr: number | string | undefined): string {
  const val = Number(rr) || 0;
  if (val >= 2.5) return 'text-emerald-600 dark:text-emerald-400';
  if (val >= 1.5) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

function formatPct(val: number | undefined | null, decimals = 1): string {
  if (val === null || val === undefined || isNaN(val)) return '0.0';
  return val.toFixed(decimals);
}

// ============================================================================
// Main Component
// ============================================================================

export function SimpleRecommendationsView() {
  const [recommendations, setRecommendations] = useState<StockRecommendation[]>([]);
  const [previousPredictions, setPreviousPredictions] = useState<PreviousPrediction[]>([]);
  const [humanRecs, setHumanRecs] = useState<HumanRecommendation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [activeTab, setActiveTab] = useState<'experts' | 'analysis' | 'smart'>('analysis');
  const [portfolioStats, setPortfolioStats] = useState<{
    winRate: number;
    avgPnl: number;
    winCount: number;
    lossCount: number;
    closedCount: number;
    totalPredictions: number;
  } | null>(null);
  const currentMarket = useAppStore((s) => s.currentMarket);

  // ROBO-ADVISOR-P2: التنبيهات الحية (Service Worker + Web Audio beep)
  const { enabled: notifEnabled, enable: enableNotif, disable: disableNotif, permission: notifPermission } = useSignalNotifications();

  // BRIEF-050: فلاتر التوصيات
  const [signalFilter, setSignalFilter] = useState<'ALL' | 'STRONG_BUY' | 'BUY' | 'ACCUMULATE' | 'HOLD' | 'SELL' | 'STRONG_SELL'>('ALL');
  const [minScore, setMinScore] = useState(0);
  // FINANCIAL-FIRST: الترتيب الافتراضي حسب العائد المتجه (risk_reward) بدلاً من الثقة
  const [sortBy, setSortBy] = useState<'score' | 'confidence' | 'risk_reward'>('risk_reward');
  const [showFilters, setShowFilters] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const noCacheHeaders = { 'Cache-Control': 'no-store, max-age=0' };

      const analysisResponse = await fetch(
        `/api/unified/predictions?market=${currentMarket === 'KSA' ? 'TADAWUL' : currentMarket}&limit=50&_t=${Date.now()}`,
        { cache: 'no-store' as RequestCache, headers: noCacheHeaders }
      );

      const humanResponse = await fetch(
        `/api/expert-recommendations?limit=7&market=${currentMarket}&_t=${Date.now()}`,
        { cache: 'no-store' as RequestCache, headers: noCacheHeaders }
      );

      const analysisResult = await analysisResponse.json();
      const humanResult = await humanResponse.json();

      let aiRecs: StockRecommendation[] = [];
      if (analysisResult.success && analysisResult.predictions && analysisResult.predictions.length > 0) {
        const allPredictions = [...analysisResult.predictions];
        const topPredictions = allPredictions
          .sort((a: any, b: any) => (b.score || 0) - (a.score || 0));

        aiRecs = topPredictions.map((item: any) => {
          const price = Number(item.entry_price) || Number(item.current_price) || 10;
          const isSell = detectIsSellSignal(
            item.signal,
            Number(item.target_price) || 0,
            Number(item.stop_loss) || 0,
            price
          );

          const defTarget     = isSell ? price * 0.95 : price * 1.05;
          const defTarget2    = isSell ? price * 0.90 : price * 1.10;
          const defInvTarget  = isSell ? price * 0.85 : price * 1.15;
          const defStop       = isSell ? price * 1.05 : price * 0.95;
          const defSupport    = isSell ? price * 1.03 : price * 0.97;

          const targetPrice = Number(item.target_price) || Number(defTarget.toFixed(2));
          const targetPct = price > 0
            ? (isSell
                ? ((price - targetPrice) / price * 100)
                : ((targetPrice - price) / price * 100)
              ).toFixed(1)
            : '0.0';

          return {
            ticker: item.symbol || item.ticker,
            name: item.name || item.symbol || item.ticker,
            current_price: price,
            change_percent: Number(item.change_percent) || 0,
            signal: item.signal,
            signal_ar: item.signal_ar,
            master_score: Number(item.score) || 50,
            entry_price: price,
            target_price: targetPrice,
            target_pct: targetPct,
            target_price_2: Number(item.target_price_2) || Number(defTarget2.toFixed(2)),
            investment_target: Number(item.investment_target) || Number(defInvTarget.toFixed(2)),
            support_level: Number(item.support_level) || Number(item.stop_loss) || Number(defSupport.toFixed(2)),
            stop_loss: Number(item.stop_loss) || Number(defStop.toFixed(2)),
            risk_reward_ratio: Number(item.risk_reward) || 2,
            technical_score: Number(item.technical_score) || Number(item.score) || 50,
            confidence: Number(item.confidence) || 50,
            rsi: Number(item.rsi) || 50,
            fallback_tier: (item.fallback_tier as StockRecommendation['fallback_tier']) || 'strict',
            fallback_tier_ar: item.fallback_tier_ar || '',
            is_new: item.is_new === true,
            is_continuous: item.is_continuous === true,
            peak_high: item.peak_high ?? null,
            trough_low: item.trough_low ?? null,
            source: 'ai' as const,
          };
        });
      }

      setRecommendations(aiRecs);

      if (Array.isArray(analysisResult.previous_predictions)) {
        setPreviousPredictions(analysisResult.previous_predictions as PreviousPrediction[]);
      } else {
        setPreviousPredictions([]);
      }

      if (humanResult.success && humanResult.recommendations) {
        setHumanRecs(humanResult.recommendations);
      }

      if (analysisResult.success && analysisResult.stats) {
        setPortfolioStats({
          winRate: Number(analysisResult.stats.win_rate) || 0,
          avgPnl: Number(analysisResult.stats.avg_pnl) || 0,
          winCount: Number(analysisResult.stats.win_count) || 0,
          lossCount: Number(analysisResult.stats.loss_count) || 0,
          closedCount: Number(analysisResult.stats.closed_count) || 0,
          totalPredictions: Number(analysisResult.stats.total) || 0,
        });
      } else {
        setPortfolioStats(null);
      }

      if (aiRecs.length === 0 && (!humanResult.recommendations || humanResult.recommendations.length === 0)) {
        setError('لا توجد توقعات متاحة حالياً');
      }

    } catch (err) {
      console.error('[SimpleRecommendationsView] Error:', err);
      setError('خطأ في الاتصال بالسيرفر');
    } finally {
      setLoading(false);
    }
  }, [currentMarket]);

  useEffect(() => {
    fetchData();
    // REALITY-CHECK-025: auto-refresh بس وقت الجلسة فقط
    // لو السوق مقفول → مفيش فايدة من التحديث (الأسعار مش بتتغير)
    // CRYPTO بتتحول 24/7 عادي
    let interval: ReturnType<typeof setInterval> | null = null;
    const checkAndSetInterval = () => {
      const marketCode = currentMarket === 'KSA' ? 'TADAWUL' : currentMarket;
      if (isMarketOpen(marketCode)) {
        if (!interval) {
          interval = setInterval(fetchData, 300000); // 5 دقائق
        }
      } else {
        // السوق مقفول → وقّف الـ interval
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      }
    };
    checkAndSetInterval();
    // فحص كل دقيقة لو الجلسة فتحت/قفلت
    const sessionChecker = setInterval(checkAndSetInterval, 60000);
    return () => {
      if (interval) clearInterval(interval);
      clearInterval(sessionChecker);
    };
  }, [fetchData, currentMarket]);

  // Copy recommendation
  const copyRecommendation = (rec: StockRecommendation, index: number) => {
    const text = `${index + 1}- *${rec.name} ${rec.ticker} آخر سعر ${formatPrice(rec.current_price)}*
شراء واحتفاظ في ${formatPrice(rec.entry_price)} جنية
أو الاستقرار أعلاه من ${formatPrice(rec.entry_price)} يعطي شراء
*هدف البيع ${formatPrice(rec.target_price)} ثم ${formatPrice(rec.target_price_2)} جنية*
*هدف استثماري في ${formatPrice(rec.investment_target)}*
استوب كسر ${formatPrice(rec.stop_loss)} إغلاق
${OFFICIAL_LINKS_BLOCK}`;

    navigator.clipboard.writeText(text);
    toast.success('تم نسخ التوقع ✓');
  };

  // Copy human recommendation
  const copyHumanRecommendation = (rec: HumanRecommendation, index: number) => {
    const entryFrom = rec.entry_price_from ? `من ${formatPrice(rec.entry_price_from)} ` : '';
    const entryTo = rec.entry_price_to ? `إلى ${formatPrice(rec.entry_price_to)}` : '';
    const entryRange = entryFrom || entryTo ? `${entryFrom}${entryTo}` : formatPrice(rec.entry_price);
    
    let text = `${index + 1}- *${rec.stock_name_ar || rec.stock_symbol} ${rec.stock_symbol}*

📊 التوقعة: ${rec.action === 'buy' ? 'شراء' : rec.action === 'sell' ? 'بيع' : 'احتفاظ'}
💰 سعر الدخول: ${entryRange}
🎯 الهدف الأول: ${formatPrice(rec.target_price)}
🎯 الهدف الثاني: ${formatPrice(rec.target_price_2)}
🎯 هدف استثماري: ${formatPrice(rec.investment_target)}
🛑 وقف الخسارة: ${formatPrice(rec.stop_loss)}`;

    if (rec.notes) {
      text += `\n📝 ملاحظات: ${rec.notes}`;
    }

    text += `\n${OFFICIAL_LINKS_BLOCK}`;

    navigator.clipboard.writeText(text);
    toast.success('تم نسخ التوقع ✓');
  };

  // Copy all recommendations
  const copyAllRecommendations = () => {
    let text = `📊 *توقعات ${MARKET_NAMES_AR[currentMarket] || currentMarket}*\n`;
    text += `📅 ${getArabicDate()}\n\n`;
    
    recommendations.slice(0, 10).forEach((rec, i) => {
      text += `${i + 1}- ${rec.ticker} - ${rec.signal_ar} - سعر: ${formatPrice(rec.current_price)} - هدف: ${formatPrice(rec.target_price)}\n`;
    });

    text += `\n${OFFICIAL_LINKS_BLOCK}`;

    navigator.clipboard.writeText(text);
    toast.success('تم نسخ جميع التوقعات ✓');
  };

  // Share all recommendations
  const shareAllRecommendations = async () => {
    let text = `📊 *توقعات ${MARKET_NAMES_AR[currentMarket] || currentMarket}*\n`;
    text += `📅 ${getArabicDate()}\n\n`;
    
    recommendations.slice(0, 10).forEach((rec, i) => {
      text += `${i + 1}- ${rec.ticker} - ${rec.signal_ar} - سعر: ${formatPrice(rec.current_price)} - هدف: ${formatPrice(rec.target_price)}\n`;
    });

    text += `\n${OFFICIAL_LINKS_BLOCK}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `توقعات ${MARKET_NAMES_AR[currentMarket] || currentMarket}`,
          text: text,
        });
        toast.success('تمت المشاركة ✓');
      } catch (err) {
        // User cancelled
      }
    } else {
      navigator.clipboard.writeText(text);
      toast.success('تم نسخ جميع التوقعات ✓');
    }
  };

  // Publish to Telegram
  const publishToTelegram = async () => {
    setPublishing(true);
    try {
      const response = await fetch('/api/telegram/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'recommendations',
          market: currentMarket,
          recommendations: recommendations.slice(0, 10)
        })
      });

      const result = await response.json();
      if (result.success) {
        toast.success('تم النشر على تيليجرام ✓');
      } else {
        toast.error(result.error || 'فشل النشر');
      }
    } catch (error) {
      toast.error('خطأ في النشر');
    } finally {
      setPublishing(false);
    }
  };

  // Share recommendation
  const shareRecommendation = async (rec: StockRecommendation, index: number) => {
    const text = `${index + 1}- *${rec.name} ${rec.ticker} آخر سعر ${formatPrice(rec.current_price)}*
شراء واحتفاظ في ${formatPrice(rec.entry_price)} جنية
*هدف البيع ${formatPrice(rec.target_price)} ثم ${formatPrice(rec.target_price_2)} جنية*
*هدف استثماري في ${formatPrice(rec.investment_target)}*
استوب كسر ${formatPrice(rec.stop_loss)} إغلاق
${OFFICIAL_LINKS_BLOCK}`;

    // محاولة استخدام Web Share API
    if (navigator.share) {
      try {
        await navigator.share({
          title: `توقعة ${rec.ticker}`,
          text: text,
        });
        toast.success('تمت المشاركة ✓');
      } catch (err) {
        // User cancelled - do nothing
      }
    } else {
      // Fallback: نسخ للحافظة
      navigator.clipboard.writeText(text);
      toast.success('تم نسخ التوقع ✓ (المشاركة غير مدعومة)');
    }
  };

  // Share human recommendation
  const shareHumanRecommendation = async (rec: HumanRecommendation, index: number) => {
    const entryFrom = rec.entry_price_from ? `من ${formatPrice(rec.entry_price_from)} ` : '';
    const entryTo = rec.entry_price_to ? `إلى ${formatPrice(rec.entry_price_to)}` : '';
    const entryRange = entryFrom || entryTo ? `${entryFrom}${entryTo}` : formatPrice(rec.entry_price);
    
    let text = `${index + 1}- *${rec.stock_name_ar || rec.stock_symbol} ${rec.stock_symbol}*

📊 التوقعة: ${rec.action === 'buy' ? 'شراء' : rec.action === 'sell' ? 'بيع' : 'احتفاظ'}
💰 سعر الدخول: ${entryRange}
🎯 الهدف الأول: ${formatPrice(rec.target_price)}
🎯 الهدف الثاني: ${formatPrice(rec.target_price_2)}
🛑 وقف الخسارة: ${formatPrice(rec.stop_loss)}`;

    if (rec.notes) {
      text += `\n📝 ملاحظات: ${rec.notes}`;
    }

    text += `\n${OFFICIAL_LINKS_BLOCK}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `توقعة ${rec.stock_symbol}`,
          text: text,
        });
        toast.success('تمت المشاركة ✓');
      } catch (err) {
        // User cancelled
      }
    } else {
      navigator.clipboard.writeText(text);
      toast.success('تم نسخ التوقع ✓');
    }
  };

  // BRIEF-050: فلترة و ترتيب التوصيات
  const filteredRecommendations = React.useMemo(() => {
    let result = [...recommendations];

    // فلترة بالإشارة مع توحيد الصيغ الإنجليزية والعربية
    if (signalFilter !== 'ALL') {
      const matchSignal = (sig: string | undefined | null, target: string): boolean => {
        if (!sig) return false;
        const norm = sig.toString().toUpperCase().trim().replace(/[\s_]+/g, '');
        const targetNorm = target.toUpperCase().replace(/[\s_]+/g, '');
        if (norm === targetNorm) return true;
        if (targetNorm === 'BUY' && (norm === 'STRONGBUY' || sig === 'شراء' || sig === 'شراء قوي')) return true;
        if (targetNorm === 'STRONGBUY' && (sig === 'شراء قوي')) return true;
        if (targetNorm === 'ACCUMULATE' && (sig === 'تجميع')) return true;
        if (targetNorm === 'HOLD' && (sig === 'احتفاظ')) return true;
        if (targetNorm === 'SELL' && (norm === 'STRONGSELL' || sig === 'بيع' || sig === 'بيع قوي')) return true;
        if (targetNorm === 'STRONGSELL' && (sig === 'بيع قوي')) return true;
        return false;
      };
      result = result.filter(r => matchSignal(r.signal || (r as any).recommendation, signalFilter));
    }

    // فلترة بالـ score
    if (minScore > 0) {
      result = result.filter(r => (r.master_score || 0) >= minScore);
    }

    // ترتيب
    if (sortBy === 'score') {
      result.sort((a, b) => (b.master_score || 0) - (a.master_score || 0));
    } else if (sortBy === 'confidence') {
      result.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    } else if (sortBy === 'risk_reward') {
      result.sort((a, b) => (b.risk_reward_ratio || 0) - (a.risk_reward_ratio || 0));
    }

    return result;
  }, [recommendations, signalFilter, minScore, sortBy]);

  // Loading state
  if (loading) {
    return (
      <div className="h-full flex flex-col bg-background" dir="rtl">
        <div className="p-4 border-b">
          <Skeleton className="h-8 w-48" />
        </div>
        <div className="flex-1 p-4 space-y-4">
          {[1, 2, 3, 4].map(i => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-background" dir="rtl">
      {/* Header */}
      <div className="p-4 border-b bg-card">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">📊 التوقعات والتحليلات</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {MARKET_NAMES_AR[currentMarket] || currentMarket} • {getArabicDate()}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <RefreshAnalyticsButton variant="glow" size="sm" onRefreshed={fetchData} />
            <Button variant="outline" size="sm" onClick={fetchData}>
              <RefreshCw className="h-4 w-4 ml-2" />
              تحديث العرض
            </Button>
            <Button
              variant={showFilters ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
            >
              <Filter className="h-4 w-4 ml-2" />
              فلاتر
            </Button>
            {recommendations.length > 0 && (
              <>
                <Button variant="outline" size="sm" onClick={copyAllRecommendations}>
                  <Copy className="h-4 w-4 ml-2" />
                  نسخ الكل
                </Button>
                <Button 
                  variant="outline"
                  size="sm" 
                  onClick={shareAllRecommendations}
                >
                  <Share2 className="h-4 w-4 ml-2" />
                  مشاركة الكل
                </Button>
                <Button 
                  variant="default" 
                  size="sm" 
                  onClick={publishToTelegram}
                  disabled={publishing}
                >
                  {publishing ? (
                    <Loader2 className="h-4 w-4 ml-2 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4 ml-2" />
                  )}
                  نشر
                </Button>
              </>
            )}
            {/* ROBO-ADVISOR-P2: زر تفعيل التنبيهات الحية (Web Push + Beep) */}
            <Button
              variant={notifEnabled ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                if (notifEnabled) {
                  disableNotif();
                  toast.info('تم إيقاف التنبيهات الحية');
                } else {
                  if (notifPermission === 'denied') {
                    toast.error('الإشعارات محظورة من المتصفح — فعّلها من إعدادات الموقع');
                  } else {
                    enableNotif();
                  }
                }
              }}
              title={notifEnabled ? 'التنبيهات الحية مفعّلة — اضغط للإيقاف' : 'فعّل التنبيهات الحية'}
              className={notifEnabled ? 'bg-emerald-600 hover:bg-emerald-700 text-white' : ''}
            >
              {notifEnabled ? (
                <BellRing className="h-4 w-4 ml-2 animate-pulse" />
              ) : (
                <Bell className="h-4 w-4 ml-2" />
              )}
              {notifEnabled ? 'التنبيهات تعمل' : 'تنبيهات حية'}
            </Button>
          </div>
        </div>

        {/* BRIEF-050: Filters Panel */}
        {showFilters && (
          <div className="mt-3 p-3 rounded-lg bg-muted/50 border border-border space-y-3">
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-xs font-semibold text-muted-foreground">الإشارة:</span>
              {(['ALL', 'STRONG_BUY', 'BUY', 'ACCUMULATE', 'HOLD', 'SELL', 'STRONG_SELL'] as const).map(s => (
                <Button
                  key={s}
                  size="sm"
                  variant={signalFilter === s ? 'default' : 'outline'}
                  className="h-7 text-xs"
                  onClick={() => setSignalFilter(s)}
                >
                  {s === 'ALL' ? 'الكل' : s === 'STRONG_BUY' ? 'شراء قوي' : s === 'BUY' ? 'شراء' : s === 'ACCUMULATE' ? 'تجميع' : s === 'HOLD' ? 'احتفاظ' : s === 'SELL' ? 'بيع' : 'بيع قوي'}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-4 items-center">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">أقل Score:</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={10}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="w-24"
                />
                <span className="text-xs font-bold">{minScore}%</span>
              </div>
               <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">ترتيب:</span>
                <Button
                  size="sm"
                  variant={sortBy === 'score' ? 'default' : 'outline'}
                  className="h-7 text-xs"
                  onClick={() => setSortBy('score')}
                >
                  Score
                </Button>
                <Button
                  size="sm"
                  variant={sortBy === 'confidence' ? 'default' : 'outline'}
                  className="h-7 text-xs"
                  onClick={() => setSortBy('confidence')}
                >
                  ثقة
                </Button>
                <Button
                  size="sm"
                  variant={sortBy === 'risk_reward' ? 'default' : 'outline'}
                  className="h-7 text-xs"
                  onClick={() => setSortBy('risk_reward')}
                >
                  R/R
                </Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              النتائج: {filteredRecommendations.length} من {recommendations.length}
            </div>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="p-4 border-b">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'experts' | 'analysis' | 'smart')}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="smart">
              <Sparkles className="h-4 w-4 ml-2" />
              التوقعات الذكية
            </TabsTrigger>
            <TabsTrigger value="experts">
              <User className="h-4 w-4 ml-2" />
              تحليلات الخبراء ({humanRecs.length})
            </TabsTrigger>
            <TabsTrigger value="analysis">
              <Bot className="h-4 w-4 ml-2" />
              التوقعات ({recommendations.length})
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {error && (
            <Card className="mb-4 border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-yellow-700 dark:text-yellow-400">
                  <AlertTriangle className="h-5 w-5" />
                  <span>{error}</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Portfolio Financial KPIs - Financial metrics FIRST */}
          {portfolioStats && portfolioStats.closedCount > 0 && (
            <Card className="border-2 border-primary/10">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-bold">الأداء المالي للمحفظة</h3>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  <div className="rounded-xl border p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">نسبة النجاح</p>
                    <p className={cn('text-xl font-bold', portfolioStats.winRate >= 60 ? 'text-emerald-600' : portfolioStats.winRate >= 45 ? 'text-amber-600' : 'text-red-600')}>
                      {formatPct(portfolioStats.winRate, 1)}%
                    </p>
                    <p className="text-[10px] text-muted-foreground">{portfolioStats.winCount} ربح / {portfolioStats.lossCount} خسارة</p>
                  </div>
                  <div className="rounded-xl border p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">متوسط العائد</p>
                    <p className={cn('text-xl font-bold', portfolioStats.avgPnl >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      {portfolioStats.avgPnl >= 0 ? '+' : ''}{formatPct(portfolioStats.avgPnl, 2)}%
                    </p>
                    <p className="text-[10px] text-muted-foreground">لكل صفقة</p>
                  </div>
                  <div className="rounded-xl border p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">الصفقات المغلقة</p>
                    <p className="text-xl font-bold text-foreground">{portfolioStats.closedCount}</p>
                    <p className="text-[10px] text-muted-foreground">من أصل {portfolioStats.totalPredictions}</p>
                  </div>
                  <div className="rounded-xl border p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">الربح الكلي</p>
                    <p className="text-xl font-bold text-emerald-600">{portfolioStats.winCount}</p>
                    <p className="text-[10px] text-muted-foreground">صفقة رابحة</p>
                  </div>
                  <div className="rounded-xl border p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">الخسارة الكلية</p>
                    <p className="text-xl font-bold text-red-600">{portfolioStats.lossCount}</p>
                    <p className="text-[10px] text-muted-foreground">صفقة خاسرة</p>
                  </div>
                  <div className="rounded-xl border p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">معامل الربحية</p>
                    <p className="text-xl font-bold text-foreground">
                      {portfolioStats.winCount > 0 && portfolioStats.lossCount > 0
                        ? (portfolioStats.winCount / portfolioStats.lossCount).toFixed(2)
                        : portfolioStats.winCount > 0 ? '∞' : '0.00'}
                    </p>
                    <p className="text-[10px] text-muted-foreground">إجمالي الربح / الخسارة</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Smart Confluence Predictions */}
          {activeTab === 'smart' && <PublishedPredictions />}

          {/* Expert Recommendations */}
          {activeTab === 'experts' && (
            <div className="space-y-3">
              {humanRecs.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center text-muted-foreground">
                    <User className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>لا توجد توقعات خبراء حالياً</p>
                  </CardContent>
                </Card>
              ) : (
                humanRecs.map((rec, index) => (
                  <Card key={rec.id || index} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-bold text-lg">{rec.stock_symbol}</span>
                            <Badge className={cn(
                              rec.action === 'buy' ? 'bg-green-500' : 
                              rec.action === 'sell' ? 'bg-red-500' : 'bg-gray-500'
                            )}>
                              {rec.action === 'buy' ? 'شراء' : rec.action === 'sell' ? 'بيع' : 'احتفاظ'}
                            </Badge>
                          </div>
                          
                          <p className="text-sm text-muted-foreground mb-2">
                            {rec.stock_name_ar || rec.stock_symbol}
                          </p>

                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <span className="text-muted-foreground">الدخول:</span>{' '}
                              <span className="font-medium">{formatPrice(rec.entry_price)}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">الهدف:</span>{' '}
                              <span className="font-medium text-green-600">{formatPrice(rec.target_price)}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">وقف الخسارة:</span>{' '}
                              <span className="font-medium text-red-600">{formatPrice(rec.stop_loss)}</span>
                            </div>
                          </div>

                          {rec.notes && (
                            <p className="text-xs text-muted-foreground mt-2 bg-muted p-2 rounded">
                              📝 {rec.notes}
                            </p>
                          )}

                          {/* أزرار النسخ والمشاركة */}
                          <div className="flex gap-2 mt-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => copyHumanRecommendation(rec, index)}
                              className="gap-1"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              نسخ
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => shareHumanRecommendation(rec, index)}
                              className="gap-1"
                            >
                              <Share2 className="h-3.5 w-3.5" />
                              مشاركة
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </div>
          )}

          {/* AI Analysis */}
          {activeTab === 'analysis' && (
            <div className="space-y-3">
              {filteredRecommendations.length === 0 ? (
                <Card>
                  <CardContent className="p-8 text-center text-muted-foreground">
                    <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
                    <p>{recommendations.length === 0 ? 'لا توجد تحليلات ذكاء اصطناعي حالياً' : 'لا توجد نتائج مطابقة للفلاتر'}</p>
                    {recommendations.length > 0 && (
                      <Button variant="outline" size="sm" className="mt-3" onClick={() => { setSignalFilter('ALL'); setMinScore(0); }}>
                        إلغاء الفلاتر
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ) : (
                filteredRecommendations.map((rec, index) => (
                  <Card key={rec.ticker} className="hover:shadow-md transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-bold text-lg">{rec.ticker}</span>
                            <Badge className={SIGNAL_COLORS[rec.signal] || 'bg-gray-500 text-white'}>
                              {rec.signal_ar}
                            </Badge>
                            <Badge variant="outline">
                              {rec.master_score}%
                            </Badge>
                            {/* CASCADING-FALLBACK-031: شارة التدرج في القبول */}
                            {rec.fallback_tier && rec.fallback_tier !== 'strict' && (
                              <Badge
                                variant="outline"
                                className={
                                  rec.fallback_tier === 'moderate'
                                    ? 'border-emerald-300 text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30'
                                    : rec.fallback_tier === 'survival'
                                    ? 'border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/30'
                                    : 'border-orange-400 text-orange-700 bg-orange-50 dark:bg-orange-950/30'
                                }
                                title={rec.fallback_tier_ar}
                              >
                                {rec.fallback_tier_ar}
                              </Badge>
                            )}
                            {/* ROBO-ADVISOR-P1: وسم الجديد/المستمر */}
                            {rec.is_new && (
                              <Badge className="bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border border-green-300">
                                🆕 جديدة
                              </Badge>
                            )}
                            {rec.is_continuous && (
                              <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300 border border-blue-300">
                                🔄 مستمرة
                              </Badge>
                            )}
                          </div>

                           <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                             <div>
                               <span className="text-muted-foreground">العائد المتوقع:</span>{' '}
                               <span className={cn('font-bold', getExpectedReturnColor(rec.target_pct))}>
                                 {Number(rec.target_pct) >= 0 ? '+' : ''}{rec.target_pct || '0.0'}%
                               </span>
                             </div>
                             <div>
                               <span className="text-muted-foreground">المخاطرة:</span>{' '}
                               <span className="font-medium text-red-600">
                                 {formatPct(getRiskPerTradePct(rec))}%
                               </span>
                             </div>
                             <div>
                               <span className="text-muted-foreground">R/R:</span>{' '}
                               <span className={cn('font-bold', getRRColor(rec.risk_reward_ratio))}>
                                 {Number(rec.risk_reward_ratio).toFixed(2)}
                               </span>
                             </div>
                             <div>
                               <span className="text-muted-foreground">الحماية:</span>{' '}
                               <Badge variant="outline" className={cn('text-[10px] font-bold border-0', getCapitalProtectionInfo(rec).bg, getCapitalProtectionInfo(rec).color)}>
                                 {getCapitalProtectionInfo(rec).label}
                               </Badge>
                             </div>
                           </div>

                           {/* P1-MAXHIGH-MINLOW: مسار السهم منذ التوقع (أعلى/أقل سعر) */}
                           {(rec.peak_high != null || rec.trough_low != null) && (
                             <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
                               {rec.peak_high != null && (
                                 <span className="text-muted-foreground">
                                   أعلى سعر منذ التوقع:{' '}
                                   <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                     ▲ {formatPrice(rec.peak_high)}
                                   </span>
                                 </span>
                               )}
                               {rec.trough_low != null && (
                                 <span className="text-muted-foreground">
                                   أقل سعر منذ التوقع:{' '}
                                   <span className="font-semibold text-rose-600 dark:text-rose-400">
                                     ▼ {formatPrice(rec.trough_low)}
                                   </span>
                                 </span>
                               )}
                             </div>
                           )}

                           {/* Financial Secondary Metrics */}
                           <div className="flex gap-4 mt-2 text-xs">
                             <span className="text-muted-foreground">
                               ثقة: <span className="font-medium">{Number(rec.confidence || 0).toFixed(0)}%</span>
                             </span>
                             <span className="text-muted-foreground">
                               تقني: <span className="font-medium">{Number(rec.technical_score || 0).toFixed(0)}%</span>
                             </span>
                             <span className="text-muted-foreground">
                               RSI: <span className={Number(rec.rsi || 50) > 70 ? 'text-red-500' : Number(rec.rsi || 50) < 30 ? 'text-green-500' : ''}>
                                 {Number(rec.rsi || 50).toFixed(0)}
                               </span>
                             </span>
                           </div>

                          {/* أزرار النسخ والمشاركة */}
                          <div className="flex gap-2 mt-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => copyRecommendation(rec, index)}
                              className="gap-1"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              نسخ
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => shareRecommendation(rec, index)}
                              className="gap-1"
                            >
                              <Share2 className="h-3.5 w-3.5" />
                              مشاركة
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}

            {/* ROBO-ADVISOR-P1: أرشيف التوقعات السابقة بحالاتها */}
            {previousPredictions.length > 0 && (
              <div className="mt-6">
                <Card className="border-border">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-3">
                      <History className="h-5 w-5 text-muted-foreground" />
                      <h3 className="font-bold text-base">توقعات سابقة</h3>
                      <Badge variant="secondary">{previousPredictions.length}</Badge>
                      <span className="text-xs text-muted-foreground hidden sm:inline">— توقعات تم إصدارها سابقاً وحالتها الحالية</span>
                    </div>
                    <div className="max-h-96 overflow-y-auto rounded-md border border-border table-mobile-scroll">
                      <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                          <tr className="text-right text-xs text-muted-foreground">
                            <th className="p-2 font-medium">السهم</th>
                            <th className="p-2 font-medium">الإشارة</th>
                            <th className="p-2 font-medium hidden sm:table-cell">الدخول</th>
                            <th className="p-2 font-medium hidden sm:table-cell">الهدف</th>
                            <th className="p-2 font-medium">الحالة</th>
                            <th className="p-2 font-medium">العائد</th>
                            <th className="p-2 font-medium hidden md:table-cell">التاريخ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {previousPredictions.map((p, i) => {
                            const statusColor =
                              p.status === 'TARGET_HIT'
                                ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-green-300'
                                : p.status === 'STOPPED'
                                ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-300'
                                : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300';
                            const ret = p.actual_return;
                            const retColor = ret === null || ret === undefined
                              ? 'text-muted-foreground'
                              : ret >= 0 ? 'text-green-600' : 'text-red-600';
                            const dateStr = p.prediction_date
                              ? (typeof p.prediction_date === 'string' ? p.prediction_date.slice(5, 10) : '')
                              : '';
                            return (
                              <tr key={p.ticker + '-' + i} className="border-t border-border hover:bg-muted/40">
                                <td className="p-2 font-bold">{p.ticker}</td>
                                <td className="p-2">
                                  <span className={cn('inline-block px-1.5 py-0.5 rounded text-xs text-white', SIGNAL_COLORS[p.signal] || 'bg-gray-500')}>
                                    {p.signal_ar}
                                  </span>
                                </td>
                                <td className="p-2 hidden sm:table-cell">{formatPrice(p.entry_price)}</td>
                                <td className="p-2 hidden sm:table-cell">{p.target_price ? formatPrice(p.target_price) : '—'}</td>
                                <td className="p-2">
                                  <span className={cn('inline-block px-2 py-0.5 rounded text-xs border', statusColor)}>
                                    {p.status_ar}
                                  </span>
                                </td>
                                <td className={cn('p-2 font-medium', retColor)}>
                                  {ret === null || ret === undefined ? '—' : `${ret >= 0 ? '+' : ''}${ret.toFixed(1)}%`}
                                </td>
                                <td className="p-2 hidden md:table-cell text-muted-foreground text-xs">{dateStr}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
