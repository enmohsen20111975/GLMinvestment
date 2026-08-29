'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  TrendingUp, TrendingDown, Clock, Calendar,
  BarChart3, Target, AlertTriangle, CheckCircle,
  Activity, ArrowUpRight, ArrowDownRight, Info,
  RefreshCw, Moon, Copy, Share2, ShieldCheck, ShieldX, Crosshair, Gauge, Facebook, ArrowRight, ArrowLeft,
  Bitcoin, Zap, Download, Image as ImageIcon, FileText, Camera, Loader2, X, Layers
} from 'lucide-react';
import { toPng } from 'html-to-image';
import { Radio } from 'lucide-react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { cn, getRRVerdict, getStockRiskAlert, safeToFixed, verdictStyle, computeRR, rrColor, scoreColor, fmtPrice } from '@/lib/utils';
import { useAppStore, MARKET_NAMES_AR, MARKET_CURRENCY_LABEL, MarketType } from '@/lib/store';
import { useAnalysisStore } from '@/lib/analysis-store';
import { toast } from 'sonner';
import { OFFICIAL_LINKS_BLOCK } from '@/lib/official-links';
// PredictionCredibilityTable moved to dedicated route #prediction-credibility (removed from analysis tabs)
import { DailyPicksPoster } from '@/components/daily-picks/DailyPicksPoster';
import { MarketSelector } from '@/components/shared/MarketSelector';
import { MarketStatusExport } from '@/components/market/MarketStatusExport';
import { RefreshAnalyticsButton } from '@/components/recommendations/RefreshAnalyticsButton';
import { PredictionTrackingDashboard } from '@/components/predictions/PredictionTrackingDashboard';
import { ExecutiveReportView } from '@/components/reports/ExecutiveReportView';
import { ExpertIntelligencePanel } from '@/components/shared/ExpertIntelligencePanel';
import dynamic from 'next/dynamic';
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog';

// Phase 4: Advanced Stock Screener — lazy-loaded (screener tab in #recommendations)
const StockScreenerAdvanced = dynamic(
  () => import('@/components/screener/StockScreener').then(m => ({ default: m.StockScreener })),
  { ssr: false, loading: () => <Skeleton className='h-[400px] w-full rounded-xl' /> }
);


function pickValidPrice(...candidates: any[]): number | undefined {
  for (const c of candidates) {
    if (c != null) {
      const n = Number(c);
      if (!isNaN(n) && n > 0) return n;
    }
  }
  return undefined;
}

const TradingChartViewDynamic = dynamic(
  () => import('./TradingChartView').then(m => ({ default: m.TradingChartView })),
  { ssr: false, loading: () => <Skeleton className='h-[500px] w-full rounded-xl' /> }
);

// ══════ Unified Analysis Modal: lazy-loaded single-stock analysis (شارت + DNA + SMC + خطة التداول) ══════
const SingleStockAnalysisViewDynamic = dynamic(
  () => import('./SingleStockAnalysisView').then(m => ({ default: m.SingleStockAnalysisView })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    ),
  }
);
import { PersonaImageCard, PersonaPick } from '@/components/market/PersonaImageCard';
import { ExpertPredictionsImageCard } from '@/components/market/ExpertPredictionsImageCard';
import { PredictionsImageCard } from '@/components/market/PredictionsImageCard';
import { ExpertRecommendationsPanel } from '@/components/analysis/ExpertRecommendationsPanel';
import { ImageCardExport } from '@/components/market/ImageCardExport';
import { AnalysisFlowDiagram } from '@/components/analysis/AnalysisFlowDiagram';

// ============================================================================
// Types
// ============================================================================

interface StockData {
  ticker: string;
  name: string;
  name_ar?: string;
  current_price: number;
  change_percent: number;
  change_value?: number;
  signal?: string | number;
  signal_ar?: string;
  master_score?: number;
  sector?: string;
  volume?: string | number;
  entry_price?: number;
  target_price?: number;
  stop_loss?: number;
  risk_reward?: number;
  // P16-DELAY-COMPENSATION: flag من الـ backend (chart_routes / stored_analysis_routes)
  // بيكون true بس لو السوق المصري مفتوح (intraday) والتوصية BUY → الـ backend نقلّل
  // الـ stop 15% ووسّع الـ target 5% عشان يعوّض تأخير البيانات 5 دقايق.
  delay_compensation_applied?: boolean;
  // P15-ATH-BREAKOUT: flag لأسهم الاختراق التاريخي (من sniper scan)
  ath_breakout?: boolean;
  confidence?: number;
  rsi?: number;
  technical_score?: number;
  prediction_date?: string;
  // Lifecycle fields (from /api/unified/predictions)
  status?: 'PENDING' | 'TARGET_HIT' | 'STOPPED' | 'EXPIRED' | string;
  final_price?: number | null;
  profit_loss_percent?: number | null;
  hit_target?: number | null;
  hit_stop_loss?: number | null;
  target_hit_date?: string | null;
  stop_hit_date?: string | null;
  evaluation_date?: string | null;
  max_profit_percent?: number | null;
  max_loss_percent?: number | null;
  holding_days?: number | null;
  // Rich analysis fields
  analysis_methods?: string[] | null;
  reasons?: string[] | null;
  trend_direction?: string | null;
  rsi_value?: number | null;
  macd_histogram?: number | null;
  candle_patterns?: Array<{ name: string; name_ar?: string; type?: string; strength?: number }> | null;
  sr_zone?: string | null;
  sr_support?: number | null;
  sr_resistance?: number | null;
  atr_value?: number | null;
  regime?: string | null;
  market_ar?: string;
  id?: string;
  logo_url?: string | null;
  // P6-PREDICTIONS: القيم التاريخية المُتتبَعة منذ التوقع (من daily_closer)
  // دول أعلى/أقل سعر وصلهم السهم من تاريخ التوقع لحد دلوقتي — مش أسعار اليوم.
  // بتاخد الأولوية في تحديد حالة التوقع (TARGET_HIT / STOPPED) على الواجهة.
  max_high_since_pred?: number | null;
  min_low_since_pred?: number | null;
}

// ============================================================================
// Helpers for lifecycle badges & colors
// ============================================================================

type LifecycleStatus = 'PENDING' | 'TARGET_HIT' | 'STOPPED' | 'EXPIRED' | string;

interface StatusBadgeStyle {
  label: string;
  badgeClass: string;
  dotClass: string;
}

function getStatusBadge(status: LifecycleStatus | undefined): StatusBadgeStyle {
  switch (status) {
    case 'TARGET_HIT':
      return { label: '🎯 حقق الهدف', badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900', dotClass: 'bg-emerald-500' };
    case 'STOPPED':
      return { label: '🛑 وقف الخسارة', badgeClass: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border-rose-200 dark:border-rose-900', dotClass: 'bg-rose-500' };
    case 'EXPIRED':
      return { label: '⏰ انتهى', badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-900', dotClass: 'bg-amber-500' };
    case 'PENDING':
    default:
      return { label: '⏳ مفتوح', badgeClass: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300 border-teal-200 dark:border-teal-900', dotClass: 'bg-teal-500' };
  }
}

function pnlColorClass(pnl: number | null | undefined): string {
  if (pnl === null || pnl === undefined) return 'text-muted-foreground';
  return pnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400';
}

function formatPnl(pnl: number | null | undefined): string {
  if (pnl === null || pnl === undefined) return '—';
  const sign = pnl >= 0 ? '+' : '';
  return `${sign}${pnl.toFixed(2)}%`;
}

/**
 * تنسيق نسبة التغير للسهم.
 * FIX-RECOMMENDATIONS (يوليو 2026): لو مفيش change_percent (null/undefined)
 * نعرض "—" بدل ما نعرض "0.00%" مضلل. لو القيمة 0 فعلياً نعرضها عادي.
 */
function formatChangePct(change: number | null | undefined): string {
  if (change === null || change === undefined) return '—';
  const sign = change > 0 ? '+' : '';
  return `${sign}${change.toFixed(2)}%`;
}

function formatDateShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return '—';
  }
}

// FRONTEND-026: كشف اتجاه الإشارة بالتسمية أو بالقيم — مشترك من lib/signal-utils.
// بيكتشف SELL/STRONG_SELL/REDUCE/WEAK_SELL/BEARISH/SHORT/UNDERWEIGHT كـ بيع،
// و BUY/STRONG_BUY/ACCUMULATE/WEAK_BUY/BULLISH/LONG/OVERWEIGHT كـ شراء،
// ولو التسمية محايدة/ناقصة بيكتشف من القيم (target تحت + stop فوق = بيع).
import { detectIsSellSignal, isSellSignalLabel, isBuySignalLabel } from '@/lib/signal-utils';

/** Map an /api/unified/predictions item (raw) to StockData with full lifecycle. */
function mapPredictionToStockData(p: any): StockData {
  const entryPrice = Number(p.entry_price) || Number(p.current_price) || 0;
  const currPrice = Number(p.current_price) || entryPrice;
  let target = Number(p.target_price) || 0;
  let stop = Number(p.stop_loss) || 0;

  // FRONTEND-026: كشف اتجاه الإشارة بالتسمية (SELL/STRONG_SELL/REDUCE/...) أو بالقيم.
  // ده بيمنع الـ BUY fallback من إنه يلغي قيم العقل الصحيحة للـ REDUCE.
  // الواجهة بس تستخدم القيم زي ما هي، مع fallback direction-aware لو ناقصة/معكوسة.
  const isSell = detectIsSellSignal(p.signal, target, stop, entryPrice);
  if (entryPrice > 0) {
    if (isSell) {
      // بيع: الهدف تحت الدخول، الوقف فوق الدخول
      if (target === 0 || target >= entryPrice) {
        target = Number((entryPrice * 0.90).toFixed(2));
      }
      if (stop === 0 || stop <= entryPrice) {
        stop = Number((entryPrice * 1.08).toFixed(2));
      }
    } else {
      // شراء: الهدف فوق الدخول، الوقف تحت الدخول
      if (target === 0 || target <= entryPrice) {
        target = Number((entryPrice * 1.12).toFixed(2));
      }
      if (stop === 0 || stop >= entryPrice) {
        stop = Number((entryPrice * 0.93).toFixed(2));
      }
    }
  }

  const predDate = p.prediction_date || p.created_at || p.updated_at || p.date || '';

  return {
    id: p.id,
    ticker: (p.symbol || p.ticker || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, ''),
    name: p.name || p.symbol || '',
    name_ar: p.name || p.symbol,
    current_price: currPrice,
    high_price: Number(p.high_price) || Number(p.high) || 0,
    low_price: Number(p.low_price) || Number(p.low) || 0,
    max_high_since_pred: Number(p.max_high_since_pred ?? p.highest_price_reached ?? p.high_price ?? 0),
    min_low_since_pred: Number(p.min_low_since_pred ?? p.lowest_price_reached ?? p.low_price ?? 0),
    change_percent: 0,
    signal: p.signal,
    signal_ar: p.signal_ar,
    master_score: Number(p.score) || 0,
    entry_price: entryPrice,
    target_price: target,
    stop_loss: stop,
    risk_reward: Number(p.risk_reward) || (entryPrice > 0 && stop > 0 ? Math.abs(target - entryPrice) / Math.abs(entryPrice - stop) : 0),
    confidence: Number(p.confidence) || 0,
    rsi: Number(p.rsi_value ?? p.rsi) || 50,
    rsi_value: p.rsi_value !== null && p.rsi_value !== undefined ? Number(p.rsi_value) : null,
    technical_score: Number(p.score) || 0,
    prediction_date: predDate,
    // Lifecycle:
    status: p.status || 'PENDING',
    final_price: p.final_price !== null && p.final_price !== undefined ? Number(p.final_price) : null,
    profit_loss_percent: p.profit_loss_percent !== null && p.profit_loss_percent !== undefined ? Number(p.profit_loss_percent) : null,
    hit_target: p.hit_target ?? null,
    hit_stop_loss: p.hit_stop_loss ?? null,
    target_hit_date: p.target_hit_date || null,
    stop_hit_date: p.stop_hit_date || null,
    evaluation_date: p.evaluation_date || null,
    max_profit_percent: p.max_profit_percent !== null && p.max_profit_percent !== undefined ? Number(p.max_profit_percent) : null,
    max_loss_percent: p.max_loss_percent !== null && p.max_loss_percent !== undefined ? Number(p.max_loss_percent) : null,
    holding_days: p.holding_days !== null && p.holding_days !== undefined ? Number(p.holding_days) : null,
    // Rich analysis:
    analysis_methods: Array.isArray(p.analysis_methods) ? p.analysis_methods : null,
    reasons: Array.isArray(p.reasons) ? p.reasons : null,
    trend_direction: p.trend_direction || null,
    macd_histogram: p.macd_histogram !== null && p.macd_histogram !== undefined ? Number(p.macd_histogram) : null,
    candle_patterns: Array.isArray(p.candle_patterns) ? p.candle_patterns : null,
    sr_zone: p.sr_zone || null,
    sr_support: p.sr_support !== null && p.sr_support !== undefined ? Number(p.sr_support) : null,
    sr_resistance: p.sr_resistance !== null && p.sr_resistance !== undefined ? Number(p.sr_resistance) : null,
    atr_value: p.atr_value !== null && p.atr_value !== undefined ? Number(p.atr_value) : null,
    regime: p.regime || null,
    market_ar: p.market_ar || undefined,
    logo_url: p.logo_url || null,
    // P6-PREDICTIONS: القيم التاريخية المُتتبَعة منذ التوقع
    // الأولوية: max_high_since_pred → highest_price_reached → null
    max_high_since_pred: p.max_high_since_pred !== null && p.max_high_since_pred !== undefined
      ? Number(p.max_high_since_pred)
      : (p.highest_price_reached !== null && p.highest_price_reached !== undefined
        ? Number(p.highest_price_reached)
        : null),
    min_low_since_pred: p.min_low_since_pred !== null && p.min_low_since_pred !== undefined
      ? Number(p.min_low_since_pred)
      : (p.lowest_price_reached !== null && p.lowest_price_reached !== undefined
        ? Number(p.lowest_price_reached)
        : null),
  };
}

// ============================================================================
// Market Mapping
// ============================================================================

const MARKET_CODES: Record<MarketType, string> = {
  'EGX': 'EGX',
  'TADAWUL': 'KSA',  // Frontend uses KSA for TADAWUL
  'KSE': 'KSE',
  'QSE': 'QSE',
  'CRYPTO': 'CRYPTO'
};

// ============================================================================
// Helper Functions - تنسيق النصوص للنسخ والمشاركة
// ============================================================================

// تحديد إذا كان السوق مقفول حالياً
function isMarketClosedNow(): boolean {
  const now = new Date();
  const hour = now.getHours();
  const day = now.getDay(); // 0=الأحد, 6=السبت
  
  // السوق المصري: الأحد-الخميس، 10:00-14:30
  const isWorkDay = day >= 0 && day <= 4; // الأحد للخميس
  const isMarketHours = hour >= 10 && hour < 15;
  
  return !isWorkDay || !isMarketHours;
}

// حساب تاريخ الجلسة القادمة
function getNextTradingDay(): Date {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  // لو السبت (6)، يبقى الجلسة القادمة يوم الأحد (بعد يومين)
  if (tomorrow.getDay() === 6) {
    tomorrow.setDate(tomorrow.getDate() + 1);
  }
  // لو الجمعة (5)، يبقى الجلسة القادمة يوم الأحد (بعد يومين)
  if (tomorrow.getDay() === 5) {
    tomorrow.setDate(tomorrow.getDate() + 2);
  }
  
  return tomorrow;
}

// تنسيق التاريخ مع تحديد اليوم أو الغد
function formatDateLabel(predictionDate?: string): { label: string; dateStr: string } {
  const isClosed = isMarketClosedNow();
  const today = new Date();
  
  if (isClosed) {
    // السوق مقفول - التوقعات لجلسة الغد
    const nextDay = getNextTradingDay();
    const dateStr = nextDay.toLocaleDateString('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    return {
      label: 'توقعات لجلسة الغد',
      dateStr: dateStr,
    };
  } else {
    // السوق مفتوح - توقعات اليوم
    const dateStr = today.toLocaleDateString('ar-EG', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    return {
      label: 'توقعات اليوم',
      dateStr: dateStr,
    };
  }
}

function formatAllPredictionsText(stocks: StockData[], market: MarketType): string {
  const marketName = MARKET_NAMES_AR[market] || market;
  const { label, dateStr } = formatDateLabel(stocks[0]?.prediction_date);

  let text = `📊 *${label} - ${marketName}*\n`;
  text += `📅 ${dateStr}\n`;
  text += `━━━━━━━━━━━━━━━━━━━\n\n`;

  stocks.forEach((s, i) => {
    const tp = s.entry_price && s.target_price && s.entry_price > 0
      ? ((s.target_price - s.entry_price) / s.entry_price * 100).toFixed(1)
      : '0.0';
    // FRONTEND-026: شامل لكل إشارات البيع (REDUCE, WEAK_SELL, ...) والشراء (ACCUMULATE, ...)
    const _sigUp = isBuySignalLabel(s.signal);
    const _sigDown = isSellSignalLabel(s.signal);
    const signalIcon = _sigUp
      ? '🟢'
      : _sigDown
      ? '🔴'
      : '🟡';

    text += `${i + 1}- ${signalIcon} *${s.ticker}* - ${s.signal_ar || 'متابعة'}\n`;
    text += `   💰 السعر: ${s.current_price?.toFixed(2)} ${MARKET_CURRENCY_LABEL[market]}\n`;
    text += `   🎯 الهدف: ${s.target_price?.toFixed(2)} (${tp}%)\n`;
    text += `   🛑 وقف الخسارة: ${s.stop_loss?.toFixed(2)}\n`;
    text += `   ⚖️ R/R: ${s.risk_reward?.toFixed(2)}\n`;
    text += `   📈 ثقة: ${Number(s.confidence || 0).toFixed(0)}% | RSI: ${Number(s.rsi || 50).toFixed(0)}\n\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━\n`;
  text += OFFICIAL_LINKS_BLOCK;

  return text;
}

function formatSinglePredictionText(stock: StockData, market: MarketType = 'EGX'): string {
  const tp = stock.entry_price && stock.target_price && stock.entry_price > 0
    ? ((stock.target_price - stock.entry_price) / stock.entry_price * 100).toFixed(1)
    : '0.0';
  // FRONTEND-026: شامل لكل إشارات البيع (REDUCE, WEAK_SELL, ...) والشراء (ACCUMULATE, ...)
  const _sigUp2 = isBuySignalLabel(stock.signal);
  const _sigDown2 = isSellSignalLabel(stock.signal);
  const signalIcon = _sigUp2
    ? '🟢'
    : _sigDown2
    ? '🔴'
    : '🟡';

  let text = `${signalIcon} *${stock.ticker}* - ${stock.signal_ar || 'متابعة'}\n`;
  text += `💰 السعر: ${stock.current_price?.toFixed(2)} ${MARKET_CURRENCY_LABEL[market]}\n`;
  text += `🎯 الهدف: ${stock.target_price?.toFixed(2)} (${tp}%)\n`;
  text += `🛑 وقف الخسارة: ${stock.stop_loss?.toFixed(2)}\n`;
  text += `⚖️ R/R: ${stock.risk_reward?.toFixed(2)}\n`;
  text += `📈 ثقة: ${Number(stock.confidence || 0).toFixed(0)}% | RSI: ${Number(stock.rsi || 50).toFixed(0)}\n\n`;
  text += `${OFFICIAL_LINKS_BLOCK}\n`;

  return text;
}

// Helper formatting functions
function formatSinglePersonaPickText(item: StoredAnalysisItem, persona: 'conservative' | 'balanced' | 'gambler', market: MarketType): string {
  // P26: خريطة الشخصية المعروضة لمفتاح analysisJson (conservative→investor، balanced→gambler كتقريب)
  const _personaKey = persona === 'conservative' ? 'investor' : 'gambler';
  // P26: لو analysisJson مفيهوش sub-dict للبرسونا، ابني PersonaData من الحقول العلوية
  const pd: PersonaData = item.analysisJson?.[_personaKey] || {
    verdict: item.recommendationAr || '',
    score: item.maestroScore || 0,
    reason: '',
    signal: item.recommendation || 'HOLD',
    entry: item.entry?.price ?? null,
    target: item.entry?.target ?? null,
    stop: item.entry?.stopLoss ?? null,
    timeframe: persona === 'balanced' ? '2-6 أسابيع' : (persona === 'conservative' ? '6-12 شهر' : '1-5 أيام'),
  };
  const signalIcon = pd.verdict?.includes('شراء') || pd.verdict?.includes('فرصة') || pd.verdict?.includes('ادخل')
    ? '🟢'
    : pd.verdict?.includes('بيع') || pd.verdict?.includes('تجنب') || pd.verdict?.includes('ابعد') || pd.verdict?.includes('اخرج')
    ? '🔴'
    : '🟡';

  let text = `${signalIcon} *${item.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '')}* - ${pd.verdict || 'متابعة'}\n`;
  if (item.nameAr || item.name) {
    text += `🏢 الاسم: ${item.nameAr || item.name}\n`;
  }
  if (pd.entry) text += `💰 سعر الدخول: ${pd.entry.toFixed(2)}\n`;
  if (pd.tp1 && pd.tp2) {
    text += `🎯 الأهداف (TP1 / TP2): ${pd.tp1.toFixed(2)} | ${pd.tp2.toFixed(2)}\n`;
  } else if (pd.target) {
    text += `🎯 الهدف: ${pd.target.toFixed(2)}\n`;
  }
  if (pd.stop) text += `🛑 وقف الخسارة (ATR): ${pd.stop.toFixed(2)}\n`;
  if (pd.timeframe) text += `⏳ أفق الاستثمار: ${pd.timeframe}\n`;
  if (pd.reason) text += `📝 التحليل: ${pd.reason}\n`;
  
  text += `\n${OFFICIAL_LINKS_BLOCK}\n`;
  return text;
}

function formatAllPersonaPicksText(items: StoredAnalysisItem[], persona: 'conservative' | 'balanced' | 'gambler', market: MarketType): string {
  const marketName = MARKET_NAMES_AR[market] || market;
  // P26: persona names للنص المنسق — 3 شخصيات
  const personaName = persona === 'conservative'
    ? 'المستثمر 🛡️'
    : persona === 'balanced'
    ? 'المتوازن ⚖️'
    : 'المضارب 🎯';
  let text = `📊 *توصيات ${personaName} - ${marketName}*\n`;
  text += `📅 ${formatDateLabel().dateStr}\n`;
  text += `━━━━━━━━━━━━━━━━━━━\n\n`;

  items.forEach((it, i) => {
    // P26: خريطة الشخصية المعروضة لمفتاح analysisJson + fallback للحقول العلوية
    const _personaKey = persona === 'conservative' ? 'investor' : 'gambler';
    const pd: PersonaData = it.analysisJson?.[_personaKey] || {
      verdict: it.recommendationAr || '',
      score: it.maestroScore || 0,
      reason: '',
      signal: it.recommendation || 'HOLD',
      entry: it.entry?.price ?? null,
      target: it.entry?.target ?? null,
      stop: it.entry?.stopLoss ?? null,
      timeframe: persona === 'balanced' ? '2-6 أسابيع' : (persona === 'conservative' ? '6-12 شهر' : '1-5 أيام'),
    };
    const signalIcon = pd.verdict?.includes('شراء') || pd.verdict?.includes('فرصة') || pd.verdict?.includes('ادخل')
      ? '🟢'
      : pd.verdict?.includes('بيع') || pd.verdict?.includes('تجنب') || pd.verdict?.includes('ابعد') || pd.verdict?.includes('اخرج')
      ? '🔴'
      : '🟡';

    text += `${i + 1}- ${signalIcon} *${it.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '')}* - ${pd.verdict || 'متابعة'}\n`;
    if (it.nameAr || it.name) {
      text += `   🏢 الاسم: ${it.nameAr || it.name}\n`;
    }
    if (pd.entry) text += `   💰 سعر الدخول: ${pd.entry.toFixed(2)}\n`;
    if (pd.tp1 && pd.tp2) {
      text += `   🎯 الأهداف (TP1 / TP2): ${pd.tp1.toFixed(2)} | ${pd.tp2.toFixed(2)}\n`;
    } else if (pd.target) {
      text += `   🎯 الهدف: ${pd.target.toFixed(2)}\n`;
    }
    if (pd.stop) text += `   🛑 وقف الخسارة (ATR): ${pd.stop.toFixed(2)}\n`;
    if (pd.reason) text += `   📝 التحليل: ${pd.reason}\n`;
    text += `\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━\n`;
  text += OFFICIAL_LINKS_BLOCK;
  return text;
}

// P43-VIRAL-SHARE: قالب التحليل الشامل الغني — يجمع سيناريو المستثمر + المضارب +
// الـ 8 طبقات الفنية + SMC (الحيتان) + الأساسيات + Footer ثابت.
// يُستخدم في زر "نسخ شامل" و"بطاقة تحليل" داخل StockDetailPanel.
function formatComprehensiveStockText(item: StoredAnalysisItem, market: MarketType, stockDetail?: any): string {
  const ticker = item.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '');
  const name = item.nameAr || item.name || ticker;
  const inv = item.analysisJson?.investor || {};
  const gam = item.analysisJson?.gambler || {};
  const fund = item.fundamentals || {};

  const price = pickValidPrice(stockDetail?.current_price, inv.entry, gam.entry, fund as any) || 0;
  const changePct = stockDetail?.change_percent != null
    ? stockDetail.change_percent
    : (fund as any)?.change_1d != null
    ? (fund as any).change_1d
    : 0;
  const changeIcon = changePct > 0 ? '🟢' : changePct < 0 ? '🔴' : '🟡';

  let text = `📊 تحليل شامل: ${name} (${ticker})\n`;
  text += `السعر الحالي: ${price ? price.toFixed(2) : '—'} جنيه | التغير اليومي: ${changePct >= 0 ? '+' : ''}${changePct.toFixed(2)}% ${changeIcon}\n\n`;

  // ── الخلاصة التنفيذية ──
  text += `📌 الخلاصة التنفيذية:\n`;
  const summary = inv.reason || gam.reason || item.analysisJson?.narrative?.line1 ||
    'تحليل شامل للسهم بناءً على نظام الـ 8 طبقات ومفاهيم المال الذكي.';
  text += `${summary}\n\n`;

  // ── سيناريو المستثمر ──
  if (inv.verdict || inv.entry || inv.target) {
    text += `🏦 سيناريو المستثمر (مدى طويل):\n`;
    text += `- التوصية: ${inv.verdict || 'متابعة'}\n`;
    const invEntry = inv.entry;
    if (invEntry) text += `- الدخول: ${invEntry.toFixed(2)}`;
    if (inv.target) {
      const upside = invEntry ? ((inv.target - invEntry) / invEntry * 100) : 0;
      text += ` | الهدف: ${inv.target.toFixed(2)} (${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%)`;
    }
    if (inv.stop) {
      const downside = invEntry ? ((inv.stop - invEntry) / invEntry * 100) : 0;
      text += ` | الوقف: ${inv.stop.toFixed(2)} (${downside.toFixed(1)}%)`;
    }
    text += `\n`;
    if (inv.risk_reward) text += `- نسبة المخاطرة/العائد (R/R): 1:${inv.risk_reward.toFixed(1)}\n`;
    if (inv.timeframe) text += `- الأفق: ${inv.timeframe}\n`;
    text += `\n`;
  }

  // ── سيناريو المضارب ──
  if (gam.verdict || gam.entry || gam.target) {
    text += `🎯 سيناريو المضارب (مدى قصير):\n`;
    text += `- التوصية: ${gam.verdict || 'متابعة'}\n`;
    const gamEntry = gam.entry;
    if (gamEntry) text += `- الدخول: ${gamEntry.toFixed(2)}`;
    if (gam.target) {
      const upside = gamEntry ? ((gam.target - gamEntry) / gamEntry * 100) : 0;
      text += ` | الهدف: ${gam.target.toFixed(2)} (${upside >= 0 ? '+' : ''}${upside.toFixed(1)}%)`;
    }
    if (gam.stop) {
      const downside = gamEntry ? ((gam.stop - gamEntry) / gamEntry * 100) : 0;
      text += ` | الوقف: ${gam.stop.toFixed(2)} (${downside.toFixed(1)}%)`;
    }
    text += `\n`;
    if (gam.risk_reward) text += `- نسبة المخاطرة/العائد (R/R): 1:${gam.risk_reward.toFixed(1)}\n`;
    text += `\n`;
  }

  // ── التحليل الفني (8 طبقات) ──
  text += `🧠 التحليل الفني (نظام الـ 8 طبقات):\n`;
  const gates = inv.gates || gam.gates;
  if (gates) {
    text += `${gates.trend ? '✅' : '❌'} الاتجاه العام: ${gates.trend ? 'صاعد (مؤكد)' : 'هابط/عرضي'}\n`;
  }
  const rsi = inv.rsi || gam.rsi || (fund as any)?.rsi;
  if (rsi != null) {
    const rsiStatus = rsi > 70 ? 'تشبع شرائي' : rsi < 30 ? 'تشبع بيعي' : 'صحي';
    text += `🟡 القوة النسبية (RSI): ${rsi.toFixed(0)} (${rsiStatus})\n`;
  }
  const volRatio = inv.volume_ratio || gam.volume_ratio || (fund as any)?.volume_ratio;
  if (volRatio != null) {
    text += `${volRatio > 1.2 ? '✅' : '🟡'} الحجم: ${volRatio.toFixed(1)}x ${volRatio > 1.2 ? '(دخول سيولة)' : '(طبيعي)'}\n`;
  }
  if (inv.support_level || inv.resistance_level || gam.support_level || gam.resistance_level) {
    const srStatus = inv.price_vs_sr || gam.price_vs_sr || 'مستويات محددة';
    text += `✅ المستويات (S/R): ${srStatus}\n`;
  }
  const regime = inv.market_regime || gam.market_regime;
  if (regime) {
    text += `✅ نظام السوق (Regime): ${regime}\n`;
  }
  const momentum = inv.momentum_score || gam.momentum_score;
  if (momentum != null) {
    text += `${momentum > 0 ? '✅' : '🟡'} الزخم (Momentum): ${momentum.toFixed(0)}\n`;
  }
  text += `\n`;

  // ─ـ SMC (Smart Money Concepts) ──
  text += `🐋 تحليل الحيتان (Smart Money Concepts - SMC):\n`;
  if (gates) {
    text += `${gates.liquidity ? '✅' : '❌'} السيولة (Liquidity): ${gates.liquidity ? 'مؤكدة' : 'ضعيفة'}\n`;
    text += `${gates.support_resistance ? '✅' : '❌'} المستويات (S/R): ${gates.support_resistance ? 'مؤكدة' : 'غير مؤكدة'}\n`;
    text += `${gates.confirmation ? '✅' : '❌'} التأكيد (Confirmation): ${gates.confirmation ? 'مؤكد' : 'بانتظار التأكيد'}\n`;
  }
  const gd = inv.gate_details || gam.gate_details;
  if (gd?.trend_reason || gd?.liquidity_reason) {
    text += `✅ Verdict: ${gd.trend_reason || gd.liquidity_reason}\n`;
  }
  text += `\n`;

  // ── الأساسيات ──
  const pe = pickValidPrice(inv.pe_ratio, gam.pe_ratio, (fund as any)?.pe_ratio, stockDetail?.pe_ratio);
  const roe = pickValidPrice(inv.roe, gam.roe, (fund as any)?.roe);
  const volatility = pickValidPrice(inv.volatility, gam.volatility, (fund as any)?.volatility);
  const fairValue = (fund as any)?.fair_value_upside;
  if (pe != null || roe != null) {
    text += `📊 التقييم الأساسي (Fundamentals):\n`;
    if (pe != null) {
      const peVerdict = pe < 10 ? 'مقيم بأقل من قيمته' : pe < 20 ? 'عادل' : 'مقيم بأعلى من قيمته';
      text += `- مكرر الربحية (P/E): ${pe.toFixed(1)}x (${peVerdict})\n`;
    }
    if (roe != null) {
      const roeVerdict = roe > 15 ? 'ممتاز' : roe > 10 ? 'جيد' : 'ضعيف';
      text += `- العائد على حقوق الملكية (ROE): ${roe.toFixed(1)}% (${roeVerdict})\n`;
    }
    if (fairValue != null) {
      text += `- القيمة العادلة (PVG): ${fairValue >= 0 ? '+' : ''}${fairValue.toFixed(1)}% ${fairValue >= 0 ? 'خصم (فرصة)' : 'علاوة (حذر)'}\n`;
    }
    if (volatility != null) {
      text += `- التقلب (Volatility): ${volatility.toFixed(1)}%\n`;
    }
    const fundVerdict = (pe != null && pe < 15) && (roe != null && roe > 12)
      ? '🟢 أساسيات قوية تدعم الاستثمار طويل المدى'
      : '🟡 أساسيات متوسطة — يحتاج متابعة دقيقة';
    text += `- التقييم النهائي: ${fundVerdict}\n`;
    text += `\n`;
  }

  text += `-----------------------------------\n`;
  text += OFFICIAL_LINKS_BLOCK;

  return text;
}

function formatSingleExpertPredictionText(s: StockData): string {
  const isUp = (s.change_percent || 0) > 0;
  const isDown = (s.change_percent || 0) < 0;
  const changeIcon = isUp ? '🟢' : isDown ? '🔴' : '🟡';
  
  let text = `${changeIcon} *${s.ticker}* - ${s.name_ar || s.name}\n`;
  text += `💰 السعر: ${s.current_price?.toFixed(2)}\n`;
  text += `📈 التغير: ${(s.change_percent || 0) >= 0 ? '+' : ''}${(s.change_percent || 0).toFixed(2)}%\n`;
  if (s.sector) text += `📁 القطاع: ${s.sector}\n`;
  
  text += `\n${OFFICIAL_LINKS_BLOCK}\n`;
  return text;
}

function formatAllExpertPredictionsText(stocks: StockData[], market: MarketType): string {
  const marketName = MARKET_NAMES_AR[market] || market;
  let text = `📊 *توقعات الخبراء - ${marketName}*\n`;
  text += `📅 ${formatDateLabel().dateStr}\n`;
  text += `━━━━━━━━━━━━━━━━━━━\n\n`;

  stocks.forEach((s, i) => {
    const isUp = (s.change_percent || 0) > 0;
    const isDown = (s.change_percent || 0) < 0;
    const changeIcon = isUp ? '🟢' : isDown ? '🔴' : '🟡';
    
    text += `${i + 1}- ${changeIcon} *${s.ticker}* - ${s.name_ar || s.name}\n`;
    text += `   💰 السعر: ${s.current_price?.toFixed(2)}\n`;
    text += `   📈 التغير: ${(s.change_percent || 0) >= 0 ? '+' : ''}${(s.change_percent || 0).toFixed(2)}%\n`;
    if (s.sector) text += `   📁 القطاع: ${s.sector}\n`;
    text += `\n`;
  });

  text += `━━━━━━━━━━━━━━━━━━━\n`;
  text += OFFICIAL_LINKS_BLOCK;
  return text;
}

function OpenTableView({ stocks }: { stocks: StockData[] }) {
  return (
    <div className="rounded-md border overflow-x-auto bg-card">
      <table className="w-full text-sm min-w-[850px]">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th className="p-2 text-center font-medium w-10">#</th>
            <th className="p-2 text-right font-medium">الرمز</th>
            <th className="p-2 text-right font-medium">الاسم</th>
            <th className="p-2 text-center font-medium text-primary">السعر وقت التحليل</th>
            <th className="p-2 text-center font-medium">أعلى / أقل سعر</th>
            <th className="p-2 text-center font-medium">الإشارة</th>
            <th className="p-2 text-center font-medium">الدخول</th>
            <th className="p-2 text-center font-medium">الهدف</th>
            <th className="p-2 text-center font-medium">الوقف</th>
            <th className="p-2 text-center font-medium">الثقة</th>
            <th className="p-2 text-center font-medium">RSI</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((stock, idx) => {
            // FRONTEND-026: شامل لكل إشارات البيع (REDUCE, WEAK_SELL, ...) والشراء (ACCUMULATE, ...)
            const isUp = isBuySignalLabel(stock.signal);
            const isDown = isSellSignalLabel(stock.signal);
            const signalColor = isUp ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400' : isDown ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400' : 'bg-muted text-muted-foreground';
            const curPrice = pickValidPrice(stock.current_price, stock.close, stock.entry_price);
            const highPrice = pickValidPrice(stock.high_price, stock.high_52w, stock.resistance);
            const lowPrice = pickValidPrice(stock.low_price, stock.low_52w, stock.support);
            return (
              <tr key={stock.id || idx} className="border-t border-border hover:bg-muted/40 transition-colors">
                <td className="p-2 text-center font-mono text-xs">{idx + 1}</td>
                <td className="p-2 font-bold text-xs">{stock.ticker}</td>
                <td className="p-2 text-xs text-muted-foreground">{stock.name_ar || stock.name || stock.ticker}</td>
                <td className="p-2 text-center font-mono text-xs font-bold text-primary">{curPrice ? curPrice.toFixed(2) : '—'}</td>
                <td className="p-2 text-center font-mono text-xs whitespace-nowrap">
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">▲ {highPrice ? highPrice.toFixed(2) : '—'}</span>
                  <span className="text-muted-foreground mx-1">/</span>
                  <span className="text-rose-600 dark:text-rose-400 font-semibold">▼ {lowPrice ? lowPrice.toFixed(2) : '—'}</span>
                </td>
                <td className="p-2 text-center">
                  <div className="flex items-center justify-center gap-1 flex-wrap">
                    <Badge className={cn("text-xs font-bold border-0", signalColor)}>
                      {stock.signal_ar || 'متابعة'}
                    </Badge>
                    {stock.delay_compensation_applied && (
                      <Badge
                        className="text-[10px] font-semibold border-0 cursor-help bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900 transition-colors"
                        title="بسبب تأخر بيانات السوق 5 دقائق، تم توسيع الهدف وتضييق وقف الخسارة لحماية صفقتك. ينصح بالتنفيذ عند ارتداد السعر للدعم وليس عند صعوده السريع."
                        onClick={() => toast.info('⚠️ تعويض تأخير البيانات', {
                          description: 'بسبب تأخر بيانات السوق 5 دقائق، تم توسيع الهدف (+5%) وتضييق وقف الخسارة (-15%) لحماية صفقتك. ينصح بالتنفيذ عند ارتداد السعر للدعم وليس عند صعوده السريع.',
                          duration: 6000,
                        })}
                      >
                        ⚠️ تعويض تأخير
                      </Badge>
                    )}
                    {stock.ath_breakout && (
                      <Badge
                        className="text-[10px] font-semibold border-0 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300"
                        title="🏆 اختراق تاريخي (All-Time High) — فرصة استثنائية مسموح لها بتجاوز بوابات القناص."
                      >
                        🏆 اختراق تاريخي
                      </Badge>
                    )}
                  </div>
                </td>
                <td className="p-2 text-center font-mono text-xs">{stock.entry_price ? stock.entry_price.toFixed(2) : '—'}</td>
                <td className="p-2 text-center font-mono text-xs text-emerald-600 dark:text-emerald-400">{stock.target_price ? stock.target_price.toFixed(2) : '—'}</td>
                <td className="p-2 text-center font-mono text-xs text-rose-600 dark:text-rose-400">{stock.stop_loss ? stock.stop_loss.toFixed(2) : '—'}</td>
                <td className="p-2 text-center font-mono text-xs">{stock.confidence !== undefined ? `${stock.confidence.toFixed(0)}%` : '—'}</td>
                <td className="p-2 text-center font-mono text-xs">{stock.rsi !== undefined ? stock.rsi.toFixed(0) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// Market Status Tab - حالة السوق خلال الأسبوع
// ============================================================================

function MarketStatusTab({ market }: { market: MarketType }) {
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState('');
  const [now, setNow] = useState<Date>(new Date());
  // 🔥 P14 (أغسطس 2026): polling متوقف افتراضياً. كان true → كان بيحمّل الـ backend
  // كل 5 دقايق بـ 6 طلبات متوازية. دلوقتي false، والمستخدم يفعّله يدوياً بزر "مباشر".
  // الـ state ده متزامن مع useAnalysisStore.liveMode عشان كل الـ tabs تحترمه.
  const [autoRefresh, setAutoRefreshState] = useState(false);
  const setAutoRefresh = (v: boolean | ((prev: boolean) => boolean)) => {
    setAutoRefreshState((prev) => {
      const next = typeof v === 'function' ? (v as (p: boolean) => boolean)(prev) : v;
      useAnalysisStore.getState().setLiveMode(next);
      return next;
    });
  };
  // RECOMMENDATIONS-FIX-022 (يوليو 2026): state جديد للمؤشرات + ملخص السوق
  // من /api/market/status (بيرجع indices + summary + most_active من الـ backend).
  const [indices, setIndices] = useState<Array<{
    symbol: string;
    name?: string;
    current_value?: number | null;
    previous_close?: number | null;
    change?: number | null;
    change_percent?: number | null;
    last_update?: string;
  }>>([]);
  const [marketSummary, setMarketSummary] = useState<{
    total_stocks?: number;
    gainers?: number;
    losers?: number;
    unchanged?: number;
    market_breadth?: number;
  }>({});

  const CACHE_TTL = 300000;

  // RECOMMENDATIONS-FIX-022: fetch indices + summary من /api/market/status
  // (بيرجع EGX30, EGX50, EGX70, EGX100, EGX33 + counts من market_indices table).
  // ملاحظة: Next.js /api/market/status بـ proxy لـ /api/market-pulse فالبيانات
  // بتيجي ملفوفة في `data` object. بنعالج الحالتين (top-level OR data-wrapped).
  const fetchMarketStatus = useCallback(async () => {
    try {
      const marketCode = MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market];
      const res = await fetch(`/api/market/status?market=${marketCode}&limit=10`, { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        // data-wrapped (market-pulse) OR top-level (Flask blueprint)
        const payload = json.data && typeof json.data === 'object' ? json.data : json;
        const indicesArr = Array.isArray(payload.indices) ? payload.indices : Array.isArray(json.indices) ? json.indices : [];
        const summaryObj = payload.summary || json.summary || {};
        setIndices(indicesArr);
        setMarketSummary(summaryObj);
      }
    } catch (err) {
      // تجاهل — المؤشرات ليست critical للـ tab
      console.warn('[MarketStatusTab] indices fetch failed', err);
    }
  }, [market]);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const marketCode = MARKET_CODES[market];
      const cache = useAnalysisStore.getState();
      if (cache.stocks && cache.market === marketCode && Date.now() - cache.lastFetched < CACHE_TTL) {
        setStocks(cache.stocks);
        setLastUpdate(new Date().toLocaleString('ar-EG'));
        if (!silent) setLoading(false);
        return;
      }
      // Fetch stocks + market status (indices) in parallel
      const [stocksRes] = await Promise.all([
        fetch(`/api/stocks?market=${marketCode}&limit=500`, { cache: 'no-store' }).then(r => r).catch(() => null),
        fetchMarketStatus(),
      ]);
      if (stocksRes && stocksRes.ok) {
        const data = await stocksRes.json();
        const stocksList = data.stocks || [];
        setStocks(stocksList);
        setLastUpdate(new Date().toLocaleString('ar-EG'));
      } else {
        setError('فشل في تحميل البيانات');
      }
    } catch (err) {
      setError('فشل في الاتصال بالخادم');
      console.error(err);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [market, fetchMarketStatus]);

  useEffect(() => {
    const marketCode = MARKET_CODES[market];
    const cache = useAnalysisStore.getState();
    if (cache.stocks && cache.market === marketCode && Date.now() - cache.lastFetched < CACHE_TTL) {
      setStocks(cache.stocks);
      setLastUpdate(new Date().toLocaleString('ar-EG'));
      setLoading(false);
    } else {
      fetchData();
    }
  }, [market, fetchData]);

  // ساعة حية — تحديث كل ثانية لعرض الوقت الفعلي
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // تحديث مستمر للبيانات كل 5 دقايق (مع إمكانية الإيقاف)
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(() => { fetchData(true); }, 300_000);
    return () => clearInterval(t);
  }, [autoRefresh, fetchData]);

  // حساب إحصائيات الأسبوع من البيانات الحقيقية
  const weekStats = React.useMemo(() => {
    if (stocks.length === 0) {
      return {
        gainers: 0,
        losers: 0,
        unchanged: 0,
        topGainers: [] as StockData[],
        topLosers: [] as StockData[],
        avgChange: 0,
        mostActive: [] as StockData[],
        topByPrice: [] as StockData[],
        sectors: {} as Record<string, number>,
        totalStocks: 0,
        avgPrice: 0,
      };
    }

    const gainers = stocks.filter(s => (s.change_percent || 0) > 0);
    const losers = stocks.filter(s => (s.change_percent || 0) < 0);
    const unchanged = stocks.filter(s => (s.change_percent || 0) === 0);

    const topGainers = [...stocks]
      .filter(s => (s.change_percent || 0) > 0)
      .sort((a, b) => (b.change_percent || 0) - (a.change_percent || 0))
      .slice(0, 5);

    const topLosers = [...stocks]
      .filter(s => (s.change_percent || 0) < 0)
      .sort((a, b) => (a.change_percent || 0) - (b.change_percent || 0))
      .slice(0, 5);

    // Most active by volume
    const mostActive = [...stocks]
      .filter(s => s.volume && s.volume !== '0' && s.volume !== '-')
      .sort((a, b) => {
        const volA = parseFloat(String(a.volume || '0').replace(/[^\d.]/g, '')) || 0;
        const volB = parseFloat(String(b.volume || '0').replace(/[^\d.]/g, '')) || 0;
        return volB - volA;
      })
      .slice(0, 5);

    // Top by price
    const topByPrice = [...stocks]
      .filter(s => (s.current_price || 0) > 0)
      .sort((a, b) => (b.current_price || 0) - (a.current_price || 0))
      .slice(0, 5);

    // Sector distribution
    const sectors: Record<string, number> = {};
    stocks.forEach(s => {
      if (s.sector) {
        sectors[s.sector] = (sectors[s.sector] || 0) + 1;
      }
    });

    const totalChange = stocks.reduce((sum, s) => sum + (s.change_percent || 0), 0);
    const avgChange = stocks.length > 0 ? totalChange / stocks.length : 0;
    const avgPrice = stocks.length > 0 
      ? stocks.reduce((sum, s) => sum + (s.current_price || 0), 0) / stocks.length 
      : 0;

    return {
      gainers: gainers.length,
      losers: losers.length,
      unchanged: unchanged.length,
      topGainers,
      topLosers,
      mostActive,
      topByPrice,
      sectors,
      avgChange,
      totalStocks: stocks.length,
      avgPrice,
    };
  }, [stocks]);

  // وصف تفصيلي لحالة السوق (وصف للى حصل ولى بيحصل) — يوليو 2026
  const marketNarrative = React.useMemo(() => {
    if (stocks.length === 0) return '';
    const gainers = weekStats.gainers;
    const losers = weekStats.losers;
    const unchanged = weekStats.unchanged;
    const breadth = gainers > losers ? 'صاعد' : gainers < losers ? 'هابط' : 'متعادل';
    const breadthEmoji = gainers > losers ? '🟢' : gainers < losers ? '🔴' : '🟡';
    const topGainer = weekStats.topGainers[0];
    const topLoser = weekStats.topLosers[0];
    const mostActive = weekStats.mostActive[0];
    const topSector = Object.entries(weekStats.sectors).sort((a, b) => b[1] - a[1])[0];

    const parts: string[] = [];
    parts.push(
      `أغلق سوق ${MARKET_NAMES_AR[market]} جلسة اليوم في حالة ${breadthEmoji} ${breadth}، حيث سجّل ${gainers} سهم ارتفاعاً مقابل ${losers} سهم انخفضت، بينما استقر ${unchanged} سهم على بلا تغيّر.`
    );
    parts.push(
      `متوسط التغير العام بلغ ${weekStats.avgChange >= 0 ? '+' : ''}${weekStats.avgChange.toFixed(2)}%، ومتوسط سعر الأسهم ${weekStats.avgPrice.toFixed(2)} ج.م عبر ${weekStats.totalStocks} سهم متداول.`
    );
    if (topGainer) {
      parts.push(
        `تصدّر قائمة الرابحين سهم ${topGainer.ticker}${topGainer.name_ar ? ` (${topGainer.name_ar})` : ''} بنسبة +${(topGainer.change_percent || 0).toFixed(2)}%.`
      );
    }
    if (topLoser) {
      parts.push(
        `وجاء سهم ${topLoser.ticker}${topLoser.name_ar ? ` (${topLoser.name_ar})` : ''} على رأس الخاسرين بنسبة ${(topLoser.change_percent || 0).toFixed(2)}%.`
      );
    }
    if (mostActive && mostActive.volume) {
      parts.push(`وسجّل سهم ${mostActive.ticker} الأعلى نشاطاً من حيث حجم التداول (${mostActive.volume}).`);
    }
    if (topSector) {
      parts.push(`وكان قطاع «${topSector[0]}» الأكثر تمثيلاً بعدد ${topSector[1]} سهم.`);
    }
    const advDec = losers > 0 ? (gainers / losers).toFixed(2) : '∞';
    parts.push(`نسبة الأسهم الرابحة إلى الخاسرة بلغت ${advDec}، ما يعكس ${breadth === 'صاعد' ? 'سيطرة للشراء' : breadth === 'هابط' ? 'ضغطاً بيعياً' : 'حالة تذبذب عرضي'}.`);
    return parts.join(' ');
  }, [stocks, weekStats, market]);

  // تحديد حالة السوق
  const getMarketStatus = () => {
    const now = new Date();
    const hour = now.getHours();
    const day = now.getDay(); // 0=الأحد, 6=السبت

    // السوق المصري: الأحد-الخميس، 10:00-14:30 بتوقيت مصر
    const isWorkDay = day >= 0 && day <= 4; // الأحد للخميس
    const isMarketHours = hour >= 10 && hour < 15;

    if (isWorkDay && isMarketHours) {
      return { isOpen: true, status: '🟢 مفتوح', message: 'جاري التداول' };
    } else if (isWorkDay && hour < 10) {
      return { isOpen: false, status: '🔴 مغلق', message: `يفتح الساعة 10:00 ص` };
    } else if (isWorkDay && hour >= 15) {
      return { isOpen: false, status: '🔴 مغلق', message: 'انتهى التداول اليوم' };
    } else {
      return { isOpen: false, status: '🔴 مغلق', message: `يفتح يوم الأحد` };
    }
  };

  const marketStatus = getMarketStatus();

  // 📊 إحصائيات إضافية للـ Telegram post (يوليو 2026)
  // المستخدم طلب بيانات أكتر في caption للـ Telegram
  const telegramCaption = React.useMemo(() => {
    if (stocks.length === 0) return '';
    const gainers = stocks.filter(s => (s.change_percent || 0) > 0).length;
    const losers = stocks.filter(s => (s.change_percent || 0) < 0).length;
    const unchanged = stocks.length - gainers - losers;
    const advDecRatio = losers > 0 ? (gainers / losers).toFixed(2) : '∞';
    const breadth = gainers > losers ? '🟢 صاعد' : gainers < losers ? '🔴 هابط' : '🟡 متوازن';

    const topGainer = weekStats.topGainers[0];
    const topLoser = weekStats.topLosers[0];
    const mostActive = weekStats.mostActive[0];

    const lines = [
      `📊 حالة السوق — ${MARKET_NAMES_AR[market]}`,
      `📅 ${new Date().toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`,
      ``,
      `${marketStatus.status} ${marketStatus.message}`,
      ``,
      `📈 إحصائيات السوق:`,
      `• الأسهم الرابحة: ${gainers} 🟢`,
      `• الأسهم الخاسرة: ${losers} 🔴`,
      `• لم يتغير: ${unchanged} ⚪`,
      `• نسبة الصعود/الهبوط: ${advDecRatio}`,
      `• الاتجاه العام: ${breadth}`,
      `• متوسط التغير: ${weekStats.avgChange >= 0 ? '+' : ''}${weekStats.avgChange.toFixed(2)}%`,
      ``,
    ];

    if (topGainer) {
      lines.push(`🏆 أعلى رابح: ${topGainer.ticker} (+${(topGainer.change_percent || 0).toFixed(2)}%)`);
    }
    if (topLoser) {
      lines.push(`📉 أعلى خاسر: ${topLoser.ticker} (${(topLoser.change_percent || 0).toFixed(2)}%)`);
    }
    if (mostActive) {
      lines.push(`🔥 الأكثر نشاطاً: ${mostActive.ticker} (حجم: ${mostActive.volume || '-'})`);
    }

    lines.push(``);
    lines.push(`منصة دليل الاستثمار | invist.m2y.net`);

    return lines.join('\n');
  }, [stocks, marketStatus, weekStats, market]);

  //Expose caption globally for MarketStatusExport to pick up
  React.useEffect(() => {
    if (typeof window !== 'undefined' && telegramCaption) {
      (window as any).__marketStatusCaption = telegramCaption;
    }
  }, [telegramCaption]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-4 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="text-destructive mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchData}>
            <RefreshCw className="h-4 w-4 ml-2" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  // FIX-RECOMMENDATIONS (يوليو 2026): لو الـ stocks فاضية بعد انتهاء التحميل،
  // اعرض رسالة "جاري تحميل البيانات" بدل عرض كل الإحصائيات بأصفار مضللة.
  if (!loading && stocks.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <span className="text-4xl mb-3 block">⏳</span>
          <p className="text-lg font-semibold mb-1">جاري تحميل البيانات</p>
          <p className="text-sm text-muted-foreground mb-4">
            بنحضّر بيانات سوق {MARKET_NAMES_AR[market]} — حاول مرة تانية بعد ثواني.
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={() => fetchData()}>
              <RefreshCw className="h-4 w-4 ml-2" />
              تحديث الآن
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAutoRefresh(v => !v)}
            >
              {autoRefresh ? 'إيقاف التحديث التلقائي' : 'تشغيل التحديث التلقائي'}
            </Button>
          </div>
          {lastUpdate && (
            <p className="text-xs text-muted-foreground mt-3">
              آخر تحديث: {lastUpdate}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Feature 5 — Market Status Image (download / publish to Telegram) */}
      <MarketStatusExport />

      {/* وصف تفصيلي لحالة السوق (لى حصل ولى بيحصل) — يوليو 2026 */}
      {stocks.length > 0 && marketNarrative && (
        <Card className="border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Radio className="h-4 w-4 text-blue-600" />
              التقرير اليومي للسوق
            </CardTitle>
            <CardDescription>
              وصف تفصيلي لحركة السوق — آخر تحديث: {lastUpdate || now.toLocaleString('ar-EG')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-foreground/90">{marketNarrative}</p>
          </CardContent>
        </Card>
      )}

      {/* الرسوم البيانية لحالة السوق — يوليو 2026 */}
      {stocks.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {/* اتساع السوق (Breadth) — Donut */}
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm flex items-center gap-2">
                <PieChart className="h-4 w-4 text-emerald-600" />
                اتساع السوق (Breadth)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={[
                      { name: 'رابح', value: weekStats.gainers, color: '#22c55e' },
                      { name: 'خاسر', value: weekStats.losers, color: '#ef4444' },
                      { name: 'بلا تغيير', value: weekStats.unchanged, color: '#9ca3af' },
                    ]}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                    label
                  >
                    {[
                      { name: 'رابح', value: weekStats.gainers, color: '#22c55e' },
                      { name: 'خاسر', value: weekStats.losers, color: '#ef4444' },
                      { name: 'بلا تغيير', value: weekStats.unchanged, color: '#9ca3af' },
                    ].map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* أبرز الرابحين والخاسرين — Bar */}
          <Card>
            <CardHeader className="pb-1">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-blue-600" />
                أبرز الرابحين والخاسرين
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={[
                    ...weekStats.topGainers.map((s) => ({ name: s.ticker, value: Number((s.change_percent || 0).toFixed(2)), fill: '#22c55e' })),
                    ...weekStats.topLosers.map((s) => ({ name: s.ticker, value: Number((s.change_percent || 0).toFixed(2)), fill: '#ef4444' })),
                  ]}
                  margin={{ top: 8, right: 8, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} unit="%" />
                  <Tooltip formatter={(v: number) => `${v}%`} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {[
                      ...weekStats.topGainers.map((s, i) => <Cell key={`g${i}`} fill="#22c55e" />),
                      ...weekStats.topLosers.map((s, i) => <Cell key={`l${i}`} fill="#ef4444" />),
                    ]}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* توزيع القطاعات — Horizontal Bar */}
          <Card className="md:col-span-2">
            <CardHeader className="pb-1">
              <CardTitle className="text-sm flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-amber-600" />
                توزيع القطاعات (عدد الأسهم)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={Math.max(160, Object.keys(weekStats.sectors).length * 26)}>
                <BarChart
                  layout="vertical"
                  data={Object.entries(weekStats.sectors)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 8)
                    .map(([sector, count]) => ({ name: sector, value: count }))}
                  margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="value" fill="#f59e0b" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Market Status Card */}
      <Card className={cn(
        "border-2",
        marketStatus.isOpen ? "border-green-500 bg-green-50 dark:bg-green-950" : "border-red-500 bg-red-50 dark:bg-red-950"
      )}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className={cn(
                "h-5 w-5",
                marketStatus.isOpen ? "text-green-600" : "text-red-600"
              )} />
              {MARKET_NAMES_AR[market]}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge
                variant={autoRefresh ? "default" : "outline"}
                className={cn("text-xs gap-1", autoRefresh ? "bg-emerald-600 hover:bg-emerald-700" : "")}
                onClick={() => setAutoRefresh(v => !v)}
                role="button"
              >
                <span className={cn("relative flex h-2 w-2 rounded-full", autoRefresh ? "bg-white" : "bg-muted-foreground")}>
                  {autoRefresh && (
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75" />
                  )}
                </span>
                {autoRefresh ? 'مباشر' : 'متوقف'}
              </Badge>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => fetchData()} title="تحديث الآن">
                <RefreshCw className={cn("h-4 w-4", loading ? "animate-spin" : "")} />
              </Button>
              <Badge variant={marketStatus.isOpen ? "default" : "destructive"} className="text-sm">
                {marketStatus.status}
              </Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">الوقت الحالي</span>
              <p className="font-bold text-lg">{now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</p>
            </div>
            <div>
              <span className="text-muted-foreground">التاريخ</span>
              <p className="font-bold">{now.toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
            </div>
            <div>
              <span className="text-muted-foreground">الحالة</span>
              <p className="font-bold">{marketStatus.message}</p>
            </div>
            <div>
              <span className="text-muted-foreground">عدد الأسهم</span>
              <p className="font-bold">{stocks.length} سهم</p>
            </div>
          </div>

          {/* Market Breadth Bar (يوليو 2026) — للـ Telegram post */}
          {stocks.length > 0 && (
            <div className="mt-4 pt-4 border-t">
              <div className="flex items-center justify-between mb-2 text-sm">
                <span className="font-medium">اتساع السوق (Market Breadth)</span>
                <span className="text-muted-foreground">
                  {stocks.filter(s => (s.change_percent || 0) > 0).length} 🟢 / {' '}
                  {stocks.filter(s => (s.change_percent || 0) < 0).length} 🔴 / {' '}
                  {stocks.filter(s => (s.change_percent || 0) === 0).length} ⚪
                </span>
              </div>
              <div className="flex h-3 rounded-full overflow-hidden bg-muted">
                {(() => {
                  const gainers = stocks.filter(s => (s.change_percent || 0) > 0).length;
                  const losers = stocks.filter(s => (s.change_percent || 0) < 0).length;
                  const unchanged = stocks.length - gainers - losers;
                  const total = stocks.length || 1;
                  return (
                    <>
                      <div
                        className="bg-green-500"
                        style={{ width: `${(gainers / total) * 100}%` }}
                        title={`${gainers} رابح`}
                      />
                      <div
                        className="bg-gray-400"
                        style={{ width: `${(unchanged / total) * 100}%` }}
                        title={`${unchanged} unchanged`}
                      />
                      <div
                        className="bg-red-500"
                        style={{ width: `${(losers / total) * 100}%` }}
                        title={`${losers} خاسر`}
                      />
                    </>
                  );
                })()}
              </div>
              <div className="flex justify-between mt-1 text-xs text-muted-foreground">
                <span>
                  نسبة الصعود/الهبوط: {
                    stocks.filter(s => (s.change_percent || 0) < 0).length > 0
                      ? (stocks.filter(s => (s.change_percent || 0) > 0).length /
                         stocks.filter(s => (s.change_percent || 0) < 0).length).toFixed(2)
                      : '∞'
                  }
                </span>
                <span>
                  الاتجاه: {
                    stocks.filter(s => (s.change_percent || 0) > 0).length >
                    stocks.filter(s => (s.change_percent || 0) < 0).length
                      ? '🟢 صاعد'
                      : stocks.filter(s => (s.change_percent || 0) > 0).length <
                        stocks.filter(s => (s.change_percent || 0) < 0).length
                      ? '🔴 هابط'
                      : '🟡 متوازن'
                  }
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* RECOMMENDATIONS-FIX-022 (يوليو 2026): مؤشرات السوق (EGX30/70/100) */}
      {indices.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              مؤشرات السوق
            </CardTitle>
            <CardDescription>
              قيم المؤشرات الرئيسية — آخر تحديث:{' '}
              {indices[0]?.last_update
                ? new Date(indices[0].last_update).toLocaleString('ar-EG')
                : lastUpdate || '—'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
              {indices.map((idx) => {
                const change = Number(idx.change_percent ?? 0);
                const isUp = change > 0;
                const isDown = change < 0;
                const value = Number(idx.current_value ?? 0);
                return (
                  <div
                    key={idx.symbol}
                    className={cn(
                      'p-3 rounded-lg border text-center',
                      isUp
                        ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900'
                        : isDown
                        ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900'
                        : 'bg-muted border-border'
                    )}
                  >
                    <p className="text-xs font-bold text-muted-foreground mb-1">{idx.symbol}</p>
                    <p className="text-lg font-bold">
                      {value > 0 ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}
                    </p>
                    <p
                      className={cn(
                        'text-xs font-semibold mt-1',
                        isUp
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : isDown
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-muted-foreground'
                      )}
                    >
                      {change > 0 ? '+' : ''}
                      {change.toFixed(2)}%
                    </p>
                  </div>
                );
              })}
            </div>
            {marketSummary && marketSummary.total_stocks != null && (
              <div className="mt-3 pt-3 border-t grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-center">
                <div>
                  <p className="text-muted-foreground">إجمالي الأسهم</p>
                  <p className="font-bold text-base">{marketSummary.total_stocks}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">الرابحة</p>
                  <p className="font-bold text-base text-emerald-600 dark:text-emerald-400">{marketSummary.gainers ?? 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">الخاسرة</p>
                  <p className="font-bold text-base text-rose-600 dark:text-rose-400">{marketSummary.losers ?? 0}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">لم يتغير</p>
                  <p className="font-bold text-base">{marketSummary.unchanged ?? 0}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Weekly Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            حالة السوق خلال الأسبوع
          </CardTitle>
          <CardDescription>
            آخر تحديث: {lastUpdate || new Date().toLocaleDateString('ar-EG')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-3 rounded-lg bg-muted">
              <p className="text-muted-foreground text-xs mb-1">متوسط التغير</p>
              <p className={cn(
                "text-xl font-bold",
                weekStats.avgChange >= 0 ? "text-green-600" : "text-red-600"
              )}>
                {weekStats.avgChange >= 0 ? '+' : ''}{weekStats.avgChange.toFixed(2)}%
              </p>
            </div>
            <div className="text-center p-3 rounded-lg bg-green-50 dark:bg-green-950">
              <p className="text-muted-foreground text-xs mb-1">الأسهم الرابحة</p>
              <p className="text-xl font-bold text-green-600">{weekStats.gainers}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-red-50 dark:bg-red-950">
              <p className="text-muted-foreground text-xs mb-1">الأسهم الخاسرة</p>
              <p className="text-xl font-bold text-red-600">{weekStats.losers}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-muted">
              <p className="text-muted-foreground text-xs mb-1">لم يتغير</p>
              <p className="text-xl font-bold">{weekStats.unchanged}</p>
            </div>
          </div>

          {/* Additional Stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 pt-2">
            <div className="text-center p-3 rounded-lg bg-blue-50 dark:bg-blue-950">
              <p className="text-muted-foreground text-xs mb-1">إجمالي الأسهم</p>
              <p className="text-xl font-bold text-blue-600">{weekStats.totalStocks}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-purple-50 dark:bg-purple-950">
              <p className="text-muted-foreground text-xs mb-1">متوسط السعر</p>
              <p className="text-xl font-bold text-purple-600">{weekStats.avgPrice.toFixed(2)} {currencyLabel}</p>
            </div>
            <div className="text-center p-3 rounded-lg bg-amber-50 dark:bg-amber-950">
              <p className="text-muted-foreground text-xs mb-1">عدد القطاعات</p>
              <p className="text-xl font-bold text-amber-600">{Object.keys(weekStats.sectors).length}</p>
            </div>
          </div>

          {/* Top Gainers & Losers */}
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-1 text-green-600">
                <TrendingUp className="h-4 w-4" />
                أعلى الرابحين
              </h4>
              <div className="space-y-2">
                {weekStats.topGainers.length > 0 ? (
                  weekStats.topGainers.map((stock, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 rounded bg-green-50 dark:bg-green-950 cursor-pointer hover:bg-green-100 dark:hover:bg-green-900 transition-colors" onClick={() => loadStockDetail(stock.ticker)}>
                      <div className="flex items-center gap-2 min-w-0">
                        {stock.logo_url ? (
                          <img
                            src={stock.logo_url}
                            alt={stock.ticker}
                            className="w-5 h-5 rounded-full object-contain flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : null}
                        <div className="min-w-0">
                          <span className="font-semibold">{stock.ticker}</span>
                          <span className="text-muted-foreground text-xs mr-2">{stock.name_ar || stock.name}</span>
                        </div>
                      </div>
                      <Badge variant="default" className="bg-green-600">
                        {formatChangePct(stock.change_percent)}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm p-2">لا توجد أسهم رابحة اليوم</p>
                )}
              </div>
            </div>
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-1 text-red-600">
                <TrendingDown className="h-4 w-4" />
                أعلى الخاسرين
              </h4>
              <div className="space-y-2">
                {weekStats.topLosers.length > 0 ? (
                  weekStats.topLosers.map((stock, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 rounded bg-red-50 dark:bg-red-950 cursor-pointer hover:bg-red-100 dark:hover:bg-red-900 transition-colors" onClick={() => loadStockDetail(stock.ticker)}>
                      <div className="flex items-center gap-2 min-w-0">
                        {stock.logo_url ? (
                          <img
                            src={stock.logo_url}
                            alt={stock.ticker}
                            className="w-5 h-5 rounded-full object-contain flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : null}
                        <div className="min-w-0">
                          <span className="font-semibold">{stock.ticker}</span>
                          <span className="text-muted-foreground text-xs mr-2">{stock.name_ar || stock.name}</span>
                        </div>
                      </div>
                      <Badge variant="destructive">
                        {formatChangePct(stock.change_percent)}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm p-2">لا توجد أسهم خاسرة اليوم</p>
                )}
              </div>
            </div>
          </div>

          {/* Most Active by Volume & Sector Distribution */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Most Active */}
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-1 text-blue-600">
                <Activity className="h-4 w-4" />
                الأكثر نشاطاً (حجم التداول)
              </h4>
              <div className="space-y-2">
                {weekStats.mostActive.length > 0 ? (
                  weekStats.mostActive.map((stock, idx) => (
                    <div key={idx} className="flex items-center justify-between p-2 rounded bg-blue-50 dark:bg-blue-950 cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900 transition-colors" onClick={() => loadStockDetail(stock.ticker)}>
                      <div className="flex items-center gap-2 min-w-0">
                        {stock.logo_url ? (
                          <img
                            src={stock.logo_url}
                            alt={stock.ticker}
                            className="w-5 h-5 rounded-full object-contain flex-shrink-0"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : null}
                        <div className="min-w-0">
                          <span className="font-semibold">{stock.ticker}</span>
                          <span className="text-muted-foreground text-xs mr-2">{stock.name_ar || stock.name}</span>
                        </div>
                      </div>
                      <Badge variant="outline" className="text-blue-600">
                        {stock.volume || '-'}
                      </Badge>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm p-2">لا توجد بيانات أحجام</p>
                )}
              </div>
            </div>

            {/* Sector Distribution */}
            <div>
              <h4 className="font-semibold mb-2 flex items-center gap-1 text-amber-600">
                <BarChart3 className="h-4 w-4" />
                توزيع القطاعات
              </h4>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {Object.entries(weekStats.sectors)
                  .sort(([, a], [, b]) => b - a)
                  .slice(0, 8)
                  .map(([sector, count]) => (
                    <div key={sector} className="flex items-center justify-between p-2 rounded bg-amber-50 dark:bg-amber-950">
                      <span className="text-sm font-medium">{sector}</span>
                      <Badge variant="outline" className="text-amber-600">
                        {count} سهم
                      </Badge>
                    </div>
                  ))}
                {Object.keys(weekStats.sectors).length === 0 && (
                  <p className="text-muted-foreground text-sm p-2">لا توجد بيانات قطاعات</p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Predictions Tab - التحليلات
// ============================================================================

// ============================================================================
// ============================================================================
// Predictions Performance Chart - رسم بياني لمعدل الربح والخسارة بالأيام
// ============================================================================

function PredictionsPerformanceChart({ stocks }: { stocks: StockData[] }) {
  const chartData = React.useMemo(() => {
    const dateMap = new Map<string, { date: string; hits: number; stopped: number; active: number; totalPnl: number; count: number }>();

    stocks.forEach((s) => {
      let rawDate = s.prediction_date || s.target_hit_date || 'اليوم';
      let dateKey = 'اليوم';
      if (rawDate && rawDate !== 'اليوم') {
        const d = new Date(rawDate);
        if (!isNaN(d.getTime())) {
          dateKey = `${d.getMonth() + 1}/${d.getDate()}`;
        }
      }

      if (!dateMap.has(dateKey)) {
        dateMap.set(dateKey, { date: dateKey, hits: 0, stopped: 0, active: 0, totalPnl: 0, count: 0 });
      }
      const item = dateMap.get(dateKey)!;
      item.count += 1;

      const pnl = s.profit_loss_percent !== null && s.profit_loss_percent !== undefined
        ? s.profit_loss_percent
        : s.entry_price && s.current_price && s.entry_price > 0
        ? ((s.current_price - s.entry_price) / s.entry_price) * 100
        : 0;
      item.totalPnl += pnl;

      const isHit = s.status === 'TARGET_HIT' || s.status === 'CLOSED_PROFIT' || s.hit_target;
      const isStopped = s.status === 'STOPPED' || s.status === 'CLOSED_LOSS' || s.hit_stop_loss;

      if (isHit) item.hits += 1;
      else if (isStopped) item.stopped += 1;
      else item.active += 1;
    });

    return Array.from(dateMap.values()).map(d => ({
      ...d,
      avgPnl: d.count > 0 ? Number((d.totalPnl / d.count).toFixed(2)) : 0,
    }));
  }, [stocks]);

  if (chartData.length === 0) return null;

  return (
    <Card className="border border-teal-200 dark:border-teal-900 bg-card p-4 my-2 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-extrabold text-sm text-teal-800 dark:text-teal-300 flex items-center gap-2">
          📊 الأداء التراكمي وتوزيع الصفقات حسب الأيام
        </h4>
        <span className="text-xs text-muted-foreground font-mono">تتبع تلقائي لمعدلات الأرباح والتوصيات الصادرة</span>
      </div>
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip
              contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
              formatter={(val: any, name: string) => {
                if (name === 'hits') return [`${val} صفقة`, '🎯 حققت الهدف'];
                if (name === 'stopped') return [`${val} صفقة`, '🛑 ضربت الوقف'];
                if (name === 'active') return [`${val} صفقة`, '⏳ صفقة مستمرة'];
                if (name === 'avgPnl') return [`${val}%`, '📈 متوسط الربح المئوي'];
                return [val, name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }} />
            <Bar dataKey="hits" name="حققت الهدف 🎯" fill="#10b981" radius={[4, 4, 0, 0]} />
            <Bar dataKey="stopped" name="ضربت الوقف 🛑" fill="#ef4444" radius={[4, 4, 0, 0]} />
            <Bar dataKey="active" name="صفقة مستمرة ⏳" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ============================================================================

function isTraderPrediction(stock: StockData): boolean {
  const rec = String(stock.recommendation || stock.signal || '').toUpperCase();
  const horizon = String((stock as any).horizon || (stock as any).timeframe || (stock as any).regime || '').toLowerCase();
  const persona = String((stock as any).persona || (stock as any).persona_type || '').toLowerCase();

  if (
    rec.includes('SWING') ||
    rec.includes('T1') ||
    rec.includes('DAY') ||
    horizon.includes('short') ||
    horizon.includes('day') ||
    horizon.includes('swing') ||
    horizon.includes('t1') ||
    persona.includes('trader') ||
    persona.includes('gambler') ||
    persona.includes('sniper')
  ) {
    return true;
  }

  if (stock.entry_price && stock.target_price && stock.entry_price > 0) {
    const gap = Math.abs((stock.target_price - stock.entry_price) / stock.entry_price);
    if (gap >= 0.08) return false;
  }

  return true;
}

function evalPrediction(stock: StockData, liveStock?: any) {
  const entryPrice = Number(stock.entry_price || stock.current_price) || 0;
  const currentPrice = Number(liveStock?.current_price || liveStock?.close || stock.current_price) || entryPrice;
  const rawHigh = Number(liveStock?.high_price || (stock as any).high_price || currentPrice);
  const rawLow = Number(liveStock?.low_price || (stock as any).low_price || currentPrice);
  
  // Guard against 52-week high/low leakage into daily high/low
  const highPrice = (rawHigh > currentPrice * 2.0 && currentPrice > 0) ? currentPrice : rawHigh;
  const lowPrice = (rawLow < currentPrice * 0.3 && currentPrice > 0) ? currentPrice : rawLow;

  let targetPrice = Number(stock.target_price) || 0;
  let stopLoss = Number(stock.stop_loss) || 0;

  // FRONTEND-026: كشف اتجاه الإشارة بالتسمية (SELL/STRONG_SELL/REDUCE/...) أو بالقيم.
  // ده بيمنع الـ BUY fallback من إنه يلغي قيم العقل الصحيحة للـ REDUCE.
  // العقل بيبعت القيم صح؛ الواجهة بس تتحقق وتعمل fallback direction-aware.
  const isSellSignal = detectIsSellSignal(stock.signal, targetPrice, stopLoss, entryPrice);

  if (entryPrice > 0) {
    if (isSellSignal) {
      // بيع: الهدف تحت الدخول، الوقف فوق الدخول
      if (targetPrice === 0 || targetPrice >= entryPrice) {
        targetPrice = Number((entryPrice * 0.90).toFixed(2));
      }
      if (stopLoss === 0 || stopLoss <= entryPrice) {
        stopLoss = Number((entryPrice * 1.08).toFixed(2));
      }
    } else {
      // شراء: الهدف فوق الدخول، الوقف تحت الدخول
      if (targetPrice === 0 || targetPrice <= entryPrice) {
        targetPrice = Number((entryPrice * 1.10).toFixed(2));
      }
      if (stopLoss === 0 || stopLoss >= entryPrice) {
        stopLoss = Number((entryPrice * 0.92).toFixed(2));
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // P6-PREDICTIONS: الأولوية للقيم التاريخية المُتتبَعة
  // ═══════════════════════════════════════════════════════════════════
  // الـ daily_closer بيتبع أعلى/أقل سعر وصلهم السهم منذ التوقع ويحفظهم في
  // highest_price_reached / lowest_price_reached. دول القيم التاريخية الصح،
  // مش أسعار اليوم. بنستخدمهم كـ PRIMARY source لتحديد الحالة، ولو مش
  // متوفرين بنرجع لـ highPrice/lowPrice اللحظية.
  // ==================================================================
  const histMaxHigh = Number(stock.max_high_since_pred);
  const histMinLow = Number(stock.min_low_since_pred);
  const hasHistMax = Number.isFinite(histMaxHigh) && histMaxHigh > 0;
  const hasHistMin = Number.isFinite(histMinLow) && histMinLow > 0;

  // maxHigh: تاريخي → لحظي → currentPrice
  const maxHigh = hasHistMax
    ? histMaxHigh
    : Math.max(highPrice || currentPrice, currentPrice);
  // minLow: تاريخي → لحظي → currentPrice
  const minLow = hasHistMin
    ? histMinLow
    : Math.min(lowPrice > 0 ? lowPrice : currentPrice, currentPrice);

  const maxHighUsed = hasHistMax;
  const minLowUsed = hasHistMin;

  const hitTargetFlag = Boolean(stock.hit_target === 1 || stock.hit_target === true || stock.hit_target === '1' || stock.hit_target === 'true');
  const hitStopFlag = Boolean(stock.hit_stop === 1 || stock.hit_stop === true || stock.hit_stop_loss === 1 || stock.hit_stop_loss === true || stock.hit_stop_loss === '1');
  const statusStr = String(stock.status || '').toUpperCase();

  // ─── P6-PREDICTIONS: منطق الـ status حسب القيم التاريخية (PRIMARY) ───
  // شراء: TARGET_HIT لو maxHigh >= target؛ STOPPED لو minLow <= stop
  // بيع:  TARGET_HIT لو minLow <= target؛ STOPPED لو maxHigh >= stop
  // لو القيم التاريخية متوفرة، نعتمد عليهم لوحدهم (مش بنمزج مع currentPrice).
  // لو مش متوفرة، نرجّع للـ live (currentPrice + high/low اليوم).
  // ----------------------------------------------------------------
  let isHit = false;
  let isStopped = false;

  if (isSellSignal) {
    if (hasHistMin && hasHistMax) {
      // القيم التاريخية متوفرة → نعتمد عليهم
      isHit = entryPrice > 0 && targetPrice > 0 && histMinLow <= targetPrice;
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && histMaxHigh >= stopLoss;
    } else if (hasHistMin) {
      // عندي min تاريخي بس → استخدمه للـ target، و highPrice للـ stop
      isHit = entryPrice > 0 && targetPrice > 0 && histMinLow <= targetPrice;
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && (currentPrice >= stopLoss || highPrice >= stopLoss);
    } else if (hasHistMax) {
      // عندي max تاريخي بس → استخدمه للـ stop، و lowPrice للـ target
      isHit = entryPrice > 0 && targetPrice > 0 && (currentPrice <= targetPrice || lowPrice <= targetPrice);
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && histMaxHigh >= stopLoss;
    } else {
      // مفيش قيم تاريخية → fallback كامل للـ live (المنطق القديم)
      isHit = entryPrice > 0 && targetPrice > 0 && (currentPrice <= targetPrice || lowPrice <= targetPrice);
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && (currentPrice >= stopLoss || highPrice >= stopLoss);
    }
  } else {
    if (hasHistMax && hasHistMin) {
      isHit = entryPrice > 0 && targetPrice > 0 && histMaxHigh >= targetPrice;
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && histMinLow <= stopLoss;
    } else if (hasHistMax) {
      isHit = entryPrice > 0 && targetPrice > 0 && histMaxHigh >= targetPrice;
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && (currentPrice <= stopLoss || lowPrice <= stopLoss);
    } else if (hasHistMin) {
      isHit = entryPrice > 0 && targetPrice > 0 && (currentPrice >= targetPrice || highPrice >= targetPrice);
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && histMinLow <= stopLoss;
    } else {
      isHit = entryPrice > 0 && targetPrice > 0 && (currentPrice >= targetPrice || highPrice >= targetPrice);
      isStopped = !isHit && stopLoss > 0 && entryPrice > 0 && (currentPrice <= stopLoss || lowPrice <= stopLoss);
    }
  }

  // دعم التحديد اليدوي الصريح فقط لو السعر كسر بالفعل أو تم التثبيت
  if (!isHit && !isStopped && (statusStr === 'TARGET_HIT' || statusStr === 'CLOSED_PROFIT' || hitTargetFlag)) {
    if (isSellSignal ? (currentPrice <= targetPrice || minLow <= targetPrice || lowPrice <= targetPrice) : (currentPrice >= targetPrice || maxHigh >= targetPrice || highPrice >= targetPrice)) {
      isHit = true;
    }
  }
  if (!isHit && !isStopped && (statusStr === 'STOPPED' || statusStr === 'CLOSED_LOSS' || hitStopFlag)) {
    // نتحقق من كسر الوقف فعلياً لمنع الأخطاء في عرض الصفقات المستمرة
    if (isSellSignal ? (currentPrice >= stopLoss || maxHigh >= stopLoss || highPrice >= stopLoss) : (currentPrice <= stopLoss || minLow <= stopLoss || lowPrice <= stopLoss)) {
      isStopped = true;
    }
  }

  const isActive = !isHit && !isStopped;

  // targetPctNum / stopPctNum حسب الاتجاه (موجب = مكسب متوقع)
  let targetPctNum = 0;
  if (entryPrice > 0 && targetPrice > 0) {
    targetPctNum = isSellSignal
      ? ((entryPrice - targetPrice) / entryPrice) * 100   // بيع: موجب لما target تحت
      : ((targetPrice - entryPrice) / entryPrice) * 100;  // شراء: موجب لما target فوق
  }

  let stopPctNum = 0;
  if (entryPrice > 0 && stopLoss > 0) {
    // وقف الخسارة = خسارة محتملة (سالب دايماً)
    stopPctNum = -Math.abs(((stopLoss - entryPrice) / entryPrice) * 100);
  }

  // livePnl حسب الاتجاه الفعلي (موجب = مكسب فعلي)
  let livePnl = 0;
  if (entryPrice > 0) {
    livePnl = isSellSignal
      ? ((entryPrice - currentPrice) / entryPrice) * 100   // بيع: موجب لما السعر ينزل
      : ((currentPrice - entryPrice) / entryPrice) * 100;  // شراء: موجب لما السعر يطلع
  } else if (stock.profit_loss_percent !== undefined && stock.profit_loss_percent !== null) {
    livePnl = Number(stock.profit_loss_percent);
  }

  // ─── P6-PREDICTIONS: حساب الـ PnL النهائي ──────────────────────────
  // - TARGET_HIT → استخدم target price (مكسب الهدف الكامل)
  // - STOPPED → استخدم stop loss (خسارة الوقف)
  // - ACTIVE → اعرض الـ livePnl الحالي + best potential كـ secondary
  // ----------------------------------------------------------------
  let pnl = livePnl;
  if (isHit) {
    pnl = targetPctNum > 0 ? targetPctNum : livePnl;
  } else if (isStopped) {
    pnl = stopPctNum < 0 ? stopPctNum : livePnl;
  } else {
    // صفقة نشطة — PnL الحقيقي المباشر (يمكن أن يكون 0.00% أو موجب/سالب)
    pnl = Number(livePnl.toFixed(2));
  }

  // "best potential" = أعلى مكسب ممكن كان يتحقق لو بِعنا في القمة (للصفقات النشطة)
  let bestPotentialPnl: number | null = null;
  if (isActive && entryPrice > 0) {
    bestPotentialPnl = isSellSignal
      ? Number((((entryPrice - minLow) / entryPrice) * 100).toFixed(2))
      : Number((((maxHigh - entryPrice) / entryPrice) * 100).toFixed(2));
  }

  const targetPct = targetPctNum > 0 ? targetPctNum.toFixed(1) : '10.0';
  const isTrader = isTraderPrediction(stock);

  // ─── P6-PREDICTIONS: الحالة + الترجمة العربية ─────────────────────
  const status: LifecycleStatus = isHit ? 'TARGET_HIT' : isStopped ? 'STOPPED' : 'PENDING';
  const statusAr: string = status === 'TARGET_HIT'
    ? '✅ تم تحقيق الهدف'
    : status === 'STOPPED'
    ? '❌ ضرب وقف الخسارة'
    : '⏳ جاري التنفيذ';

  // pnlValue (القيمة النقدية التقريبية لكل سهم واحد)
  const pnlValue = entryPrice > 0 ? (pnl / 100) * entryPrice : 0;

  return {
    isHit,
    isStopped,
    isActive,
    pnl,
    pnlValue,
    currentPrice,
    entryPrice,
    targetPrice,
    stopLoss,
    targetPct,
    isTrader,
    isSellSignal,
    // P6-PREDICTIONS: القيم الجديدة
    maxHigh,
    minLow,
    maxHighUsed,
    minLowUsed,
    bestPotentialPnl,
    status,
    statusAr,
  };
}


// Proof & Verification Predictions Table View - جدول نتائج وتوثيق أداء التوقعات
// ============================================================================

function ProofPredictionsTableView({
  stocks,
}: {
  stocks: StockData[];
}) {
  const storeStocks = useAnalysisStore((state) => state.stocks) || [];

  const stocksMap = React.useMemo(() => {
    const map = new Map<string, any>();
    storeStocks.forEach((s) => {
      if (s.ticker) {
        const clean = s.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
        map.set(clean, s);
        map.set(s.ticker.toUpperCase(), s);
      }
    });
    return map;
  }, [storeStocks]);

  const loadStockDetail = useAnalysisStore((state) => state.loadStockDetail);

  if (stocks.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center text-muted-foreground">
          <Info className="h-10 w-10 mx-auto mb-2 opacity-50" />
          <p className="font-semibold">لا توجد صفقات مطابقة للفلاتر المختارة حالياً</p>
          <p className="text-xs mt-1 text-muted-foreground">جرّب تغيير التصفية أو الفئة لتبديل العرض</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-teal-200 dark:border-teal-900 bg-card shadow-sm">
      <table className="w-full text-sm min-w-[1180px] border-collapse">
        <thead className="bg-gradient-to-r from-teal-500/10 via-emerald-500/10 to-teal-500/10 text-foreground font-semibold border-b border-teal-200 dark:border-teal-900">
          <tr>
            <th className="p-3 text-center font-medium w-12">#</th>
            <th className="p-3 text-right font-medium">السهم والرمز</th>
            <th className="p-3 text-center font-medium">نوع الصفقة</th>
            <th className="p-3 text-center font-medium">تاريخ التوقع</th>
            <th className="p-3 text-center font-medium">سعر الدخول</th>
            <th className="p-3 text-center font-medium">الهدف والوقف</th>
            <th className="p-3 text-center font-medium whitespace-nowrap">أعلى وأقل سعر<br/><span className="text-[10px] text-muted-foreground font-normal">منذ التوقع</span></th>
            <th className="p-3 text-center font-medium">نسبة الربح / الخسارة</th>
            <th className="p-3 text-center font-medium">نتيجة وحالة التوقع</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60">
          {stocks.map((stock, i) => {
            const cleanTicker = stock.ticker ? stock.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase() : '';
            const liveStock = stocksMap.get(cleanTicker) || stocksMap.get(stock.ticker?.toUpperCase());
            const { isHit, isStopped, pnl, currentPrice, entryPrice, targetPrice, stopLoss, targetPct, isTrader, maxHigh, minLow, maxHighUsed, minLowUsed, bestPotentialPnl } = evalPrediction(stock, liveStock);

            const displayDate = stock.prediction_date
              ? formatDateShort(stock.prediction_date)
              : 'اليوم';

            // P6-PREDICTIONS: هل الحالة مبنية على المسار التاريخي؟
            const pathBased = maxHighUsed || minLowUsed;

            return (
              <tr
                key={stock.id || `proof-${stock.ticker}-${i}`}
                className={cn(
                  "hover:bg-teal-50/40 dark:hover:bg-teal-950/20 transition-colors cursor-pointer",
                  isHit ? "bg-emerald-50/20 dark:bg-emerald-950/10" : isStopped ? "bg-rose-50/10 dark:bg-rose-950/10" : ""
                )}
                onClick={() => loadStockDetail(stock.ticker)}
              >
                <td className="p-3 text-center font-mono text-xs text-muted-foreground">{i + 1}</td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    {stock.logo_url ? (
                      <img src={stock.logo_url} alt={stock.ticker} className="w-7 h-7 rounded-full object-contain bg-white p-0.5 border" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-teal-100 dark:bg-teal-900 text-teal-800 dark:text-teal-200 flex items-center justify-center font-bold text-xs">
                        {stock.ticker.slice(0, 2)}
                      </div>
                    )}
                    <div>
                      <p className="font-bold text-foreground leading-none">{stock.name_ar || stock.name}</p>
                      <span className="font-mono text-xs text-muted-foreground">{stock.ticker}</span>
                    </div>
                  </div>
                </td>
                <td className="p-3 text-center whitespace-nowrap">
                  {isTrader ? (
                    <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border border-purple-300 gap-1 py-0.5 px-2 text-[11px] font-bold">
                      ⚡ مضارب
                    </Badge>
                  ) : (
                    <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 gap-1 py-0.5 px-2 text-[11px] font-bold">
                      📊 مستثمر
                    </Badge>
                  )}
                </td>
                <td className="p-3 text-center font-mono text-xs text-muted-foreground whitespace-nowrap">
                  {displayDate}
                </td>
                <td className="p-3 text-center font-mono font-semibold text-foreground">
                  {entryPrice ? `${entryPrice.toFixed(2)} ${currencyLabel}` : '—'}
                </td>
                <td className="p-3 text-center font-mono text-xs whitespace-nowrap">
                  <div className="text-emerald-600 dark:text-emerald-400 font-semibold">🎯 {targetPrice ? targetPrice.toFixed(2) : '—'} ({targetPct}%)</div>
                  <div className="text-rose-500 font-normal text-[11px]">🛑 {stopLoss ? stopLoss.toFixed(2) : '—'}</div>
                </td>
                {/* أعلى وأقل سعر منذ التوقع */}
                <td className="p-3 text-center font-mono text-xs whitespace-nowrap">
                  <div className="text-emerald-600 dark:text-emerald-400 font-semibold">
                    ▲ {maxHigh > 0 ? maxHigh.toFixed(2) : (liveStock?.high_price ? liveStock.high_price.toFixed(2) : (currentPrice ? currentPrice.toFixed(2) : '—'))}
                  </div>
                  <div className="text-rose-600 dark:text-rose-400 font-semibold">
                    ▼ {minLow > 0 ? minLow.toFixed(2) : (liveStock?.low_price ? liveStock.low_price.toFixed(2) : (currentPrice ? currentPrice.toFixed(2) : '—'))}
                  </div>
                </td>
                <td className="p-3 text-center font-mono">
                  <span className={cn(
                    "inline-block px-2.5 py-1 rounded-md font-bold text-xs",
                    pnl > 0 ? "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300" :
                    pnl < 0 ? "bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 border border-rose-300" :
                    "bg-gray-100 text-gray-700"
                  )}>
                    {pnl > 0 ? `+${pnl.toFixed(2)}%` : `${pnl.toFixed(2)}%`}
                  </span>
                  {/* P6-PREDICTIONS: "best potential" للصفقات النشطة */}
                  {bestPotentialPnl !== null && bestPotentialPnl > 0 && (
                    <div className="text-[10px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5">
                      قمة: +{bestPotentialPnl.toFixed(2)}%
                    </div>
                  )}
                </td>
                <td className="p-3 text-center whitespace-nowrap">
                  {isHit ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 py-1 px-2.5 text-xs font-bold">
                      🎯 صفقة مكتملة (تم تحقيق الهدف)
                    </Badge>
                  ) : isStopped ? (
                    <Badge variant="destructive" className="gap-1 py-1 px-2.5 text-xs font-bold">
                      🛑 ضربت وقف الخسارة
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-teal-500 text-teal-700 dark:text-teal-300 bg-teal-50/50 dark:bg-teal-950/30 gap-1 py-1 px-2.5 text-xs font-bold">
                      ⏳ صفقة مستمرة (جارية)
                    </Badge>
                  )}
                  {/* P6-PREDICTIONS: وسم "مبنية على المسار" لما الحالة تُحدد بالقيم التاريخية */}
                  {pathBased && (
                    <div className="mt-1">
                      <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-medium bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-900">
                        مبنية على المسار
                      </span>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ============================================================================
// P6-PREDICTIONS: PreviousPredictionsArchive — أرشيف التوقعات السابقة
// ============================================================================
// مكوّن مستقل بيُعرض التوقعات السابقة بحالاتها (✅ تم الهدف / ❌ ضرب وقف / ⏳ معلقة).
// اتسحب من PredictionsTab عشان يتعرض في تبويبات المستثمر والمضارب بدل ما
// يزدحم في التبويب العام. بيقبل قائمة previousPredictions + title اختياري.
// ============================================================================

interface PreviousPrediction {
  ticker?: string;
  symbol?: string;
  name?: string;
  name_ar?: string;
  signal?: string;
  signal_ar?: string;
  entry_price?: number | null;
  target_price?: number | null;
  stop_loss?: number | null;
  master_score?: number;
  confidence?: number;
  prediction_date?: string;
  outcome_date?: string | null;
  exit_price?: number | null;
  actual_return?: number | null;
  is_live_return?: boolean;  // RL-FIX-9: عائد لحظي (معاينة) للصفقات المعلقة
  holding_days?: number;
  status?: string;
  status_ar?: string;
  exit_type?: string | null;  // RL-FIX-9: trailing_profit / trailing_stop / target_hit / etc.
  persona?: string | null;    // RL-FIX-9: gambler / balanced / conservative
  // P6-PREDICTIONS: القيم التاريخية المُتتبَعة منذ التوقع
  max_high_since_pred?: number | null;
  min_low_since_pred?: number | null;
  highest_price_reached?: number | null;
  lowest_price_reached?: number | null;
}

function PreviousPredictionsArchive({
  predictions,
  title = 'توقعات سابقة',
}: {
  predictions: PreviousPrediction[];
  title?: string;
}) {
  if (!predictions || predictions.length === 0) return null;

  return (
    <Card className="border-border">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">📋</span>
          <h3 className="font-bold text-base">{title}</h3>
          <Badge variant="secondary">{predictions.length}</Badge>
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
                {/* P6-PREDICTIONS: عمودان جديدان للقيم التاريخية */}
                <th className="p-2 font-medium hidden md:table-cell">أعلى سعر</th>
                <th className="p-2 font-medium hidden md:table-cell">أقل سعر</th>
                <th className="p-2 font-medium">الحالة</th>
                <th className="p-2 font-medium">العائد</th>
                <th className="p-2 font-medium hidden md:table-cell">التاريخ</th>
              </tr>
            </thead>
            <tbody>
              {predictions.map((p, i) => {
                const statusColor =
                  p.status === 'TARGET_HIT'
                    ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300 border-green-300'
                    : p.status === 'TRAILING_PROFIT'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-300'
                    : p.status === 'STOPPED'
                    ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300 border-red-300'
                    : p.status === 'EXPIRED'
                    ? 'bg-slate-100 text-slate-800 dark:bg-slate-900/40 dark:text-slate-300 border-slate-300'
                    : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 border-amber-300';
                const ret = p.actual_return;
                const retColor = ret === null || ret === undefined
                  ? 'text-muted-foreground'
                  : ret >= 0 ? 'text-green-600' : 'text-red-600';
                const dateStr = p.prediction_date
                  ? (typeof p.prediction_date === 'string' ? p.prediction_date.slice(5, 10) : '')
                  : '';
                const sigColor: Record<string, string> = {
                  'STRONG_BUY': 'bg-emerald-500', 'BUY': 'bg-green-500', 'ACCUMULATE': 'bg-teal-500',
                  'HOLD': 'bg-gray-500', 'REDUCE': 'bg-orange-500', 'SELL': 'bg-red-500', 'STRONG_SELL': 'bg-red-700',
                };
                // P6-PREDICTIONS: قراءة القيم التاريخية بأمان (alias fallback)
                const entryVal = Number(p.entry_price || p.current_price || 0);
                const maxHigh = Number(p.max_high_since_pred ?? p.highest_price_reached ?? p.high_price ?? entryVal) || entryVal;
                const minLow = Number(p.min_low_since_pred ?? p.lowest_price_reached ?? p.low_price ?? entryVal) || entryVal;
                return (
                  <tr key={(p.ticker || '') + '-' + i} className="border-t border-border hover:bg-muted/40">
                    <td className="p-2 font-bold">{p.ticker}</td>
                    <td className="p-2">
                      <span className={cn('inline-block px-1.5 py-0.5 rounded text-xs text-white', sigColor[p.signal || ''] || 'bg-gray-500')}>
                        {p.signal_ar || p.signal}
                      </span>
                    </td>
                    <td className="p-2 hidden sm:table-cell">{entryVal > 0 ? entryVal.toFixed(2) : '—'}</td>
                    <td className="p-2 hidden sm:table-cell">{p.target_price ? Number(p.target_price).toFixed(2) : '—'}</td>
                    {/* P6-PREDICTIONS: القيم التاريخية */}
                    <td className="p-2 hidden md:table-cell font-mono text-xs">
                      {maxHigh > 0
                        ? <span className="text-emerald-600 dark:text-emerald-400">▲ {Number(maxHigh).toFixed(2)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2 hidden md:table-cell font-mono text-xs">
                      {minLow > 0
                        ? <span className="text-rose-600 dark:text-rose-400">▼ {Number(minLow).toFixed(2)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="p-2">
                      <span className={cn('inline-block px-2 py-0.5 rounded text-xs border', statusColor)}>
                        {p.status_ar || p.status}
                      </span>
                    </td>
                    <td className={cn('p-2 font-medium', retColor)}>
                      {ret === null || ret === undefined
                        ? '—'
                        : <span className="inline-flex items-center gap-1">
                            <span>{ret >= 0 ? '+' : ''}{Number(ret).toFixed(1)}%</span>
                            {p.is_live_return && (
                              <span className="text-[9px] text-amber-600 dark:text-amber-400 border border-amber-300 dark:border-amber-700 rounded px-1" title="عائد لحظي — الصفقة لسه مفتوحة">
                                معاينة
                              </span>
                            )}
                          </span>}
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
  );
}

function PredictionsTab({ market }: { market: MarketType }) {
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [closedStocks, setClosedStocks] = useState<StockData[]>([]);
  // ROBO-ADVISOR-P1: أرشيف التوقعات السابقة بحالاتها (✅/❌/⏳)
  const [previousPredictions, setPreviousPredictions] = useState<any[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    closed_count: number;
    win_count: number;
    loss_count: number;
    win_rate: number;
    avg_pnl: number;
    by_status?: Record<string, number>;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // إعدادات واجهة إثبات النتائج والتصفية المتقدمة
  const [viewMode, setViewMode] = useState<'table' | 'chart' | 'image'>('table');
  const [personaFilter, setPersonaFilter] = useState<'all' | 'investor' | 'trader'>('all');
  const [timeFrame, setTimeFrame] = useState<'all' | 'today' | 'week' | 'month'>('all');
  const [filterType, setFilterType] = useState<'smart' | 'successful' | 'completed' | 'stopped' | 'active' | 'all'>('all');

  const fetchPredictions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const marketCode = MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market];
      const res = await fetch(`/api/unified/predictions?market=${marketCode}&limit=100`, {
        cache: 'no-store',
      });
      if (res.ok) {
        const data = await res.json();
        const predictions = Array.isArray(data.predictions) ? data.predictions : [];
        const closedPredictions = Array.isArray(data.closed_predictions) ? data.closed_predictions : [];

        const openMapped: StockData[] = predictions.map((p: any) => mapPredictionToStockData(p));
        const closedMapped: StockData[] = closedPredictions.map((p: any) => mapPredictionToStockData(p));

        setStocks(openMapped);
        setClosedStocks(closedMapped);
        // ROBO-ADVISOR-P1: التقاط أرشيف التوقعات السابقة من العقل
        setPreviousPredictions(Array.isArray(data.previous_predictions) ? data.previous_predictions : []);
        if (data.stats) {
          setStats({
            total: Number(data.stats.total) || 0,
            closed_count: Number(data.stats.closed_count) || 0,
            win_count: Number(data.stats.win_count) || 0,
            loss_count: Number(data.stats.loss_count) || 0,
            win_rate: Number(data.stats.win_rate) || 0,
            avg_pnl: Number(data.stats.avg_pnl) || 0,
            by_status: data.stats.by_status,
          });
        }
      } else {
        setError('فشل في تحميل التوقعات');
      }
    } catch (err) {
      setError('فشل في الاتصال بالخادم');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    fetchPredictions();
    // 🔥 P14: polling بيتوقف لو liveMode مش مفعّل (افتراضي). المستخدم يفعّله يدوياً.
    const interval = setInterval(() => {
      if (!useAnalysisStore.getState().liveMode) return;
      fetchPredictions();
    }, 300_000);
    return () => clearInterval(interval);
  }, [market, fetchPredictions]);

  // دمج كافة التوقعات (المفتوحة والمغلقة)
  const allCombinedStocks = useMemo(() => [...stocks, ...closedStocks], [stocks, closedStocks]);

  const storeStocks = useAnalysisStore((state) => state.stocks) || [];

  const stocksMap = React.useMemo(() => {
    const map = new Map<string, any>();
    storeStocks.forEach((s) => {
      if (s.ticker) {
        const clean = s.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
        map.set(clean, s);
        map.set(s.ticker.toUpperCase(), s);
      }
    });
    return map;
  }, [storeStocks]);

  // 1. تصفية حسب السوق والنطاق الزمني والفئة (المستثمر vs المضارب) فقط للنسبة الإجمالية
  const scopeStocks = useMemo(() => {
    const now = new Date();
    return allCombinedStocks.filter((stock) => {
      const cleanTicker = stock.ticker ? stock.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase() : '';
      const liveStock = stocksMap.get(cleanTicker) || stocksMap.get(stock.ticker?.toUpperCase());
      const evalRes = evalPrediction(stock, liveStock);

      // تصفية الفئة (المستثمر vs المضارب)
      if (personaFilter === 'trader' && !evalRes.isTrader) return false;
      if (personaFilter === 'investor' && evalRes.isTrader) return false;

      // تصفية النطاق الزمني (اليوم / الأسبوع / الشهر)
      if (timeFrame !== 'all' && stock.prediction_date) {
        const predDate = new Date(stock.prediction_date);
        if (!isNaN(predDate.getTime())) {
          const diffMs = now.getTime() - predDate.getTime();
          const diffDays = diffMs / (1000 * 60 * 60 * 24);

          if (timeFrame === 'today' && diffDays > 1.5) return false;
          if (timeFrame === 'week' && diffDays > 7.5) return false;
          if (timeFrame === 'month' && diffDays > 30.5) return false;
        }
      }

      return true;
    });
  }, [allCombinedStocks, personaFilter, timeFrame, stocksMap]);

  // 2. حساب نسبة الدقة التراكمية الإجمالية المستقلة عن فلاتر العرض الفرعية (بين المكسب والخسارة)
  const dynamicTotal = scopeStocks.length;

  const dynamicHits = useMemo(() => {
    return scopeStocks.filter((s) => {
      const cleanTicker = s.ticker ? s.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase() : '';
      const liveStock = stocksMap.get(cleanTicker) || stocksMap.get(s.ticker?.toUpperCase());
      return evalPrediction(s, liveStock).isHit;
    }).length;
  }, [scopeStocks, stocksMap]);

  const dynamicStopped = useMemo(() => {
    return scopeStocks.filter((s) => {
      const cleanTicker = s.ticker ? s.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase() : '';
      const liveStock = stocksMap.get(cleanTicker) || stocksMap.get(s.ticker?.toUpperCase());
      return evalPrediction(s, liveStock).isStopped;
    }).length;
  }, [scopeStocks, stocksMap]);

  // نسبة دقة التوقعات المباشرة = (عدد الصفقات التي حققت الهدف / إجمالي صفقات النطاق المالي) × 100
  const dynamicWinRate = useMemo(() => {
    if (dynamicTotal > 0) return (dynamicHits / dynamicTotal) * 100;
    return 0;
  }, [dynamicHits, dynamicTotal]);

  const dynamicAvgPnl = useMemo(() => {
    if (dynamicTotal === 0) return 0;
    let sum = 0;
    scopeStocks.forEach((s) => {
      const cleanTicker = s.ticker ? s.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase() : '';
      const liveStock = stocksMap.get(cleanTicker) || stocksMap.get(s.ticker?.toUpperCase());
      sum += evalPrediction(s, liveStock).pnl;
    });
    return sum / dynamicTotal;
  }, [scopeStocks, dynamicTotal, stocksMap]);

  // 3. تصفية جدول العرض السفلي حسب زر حالة الصفقة (filterType)
  const filteredCombinedStocks = useMemo(() => {
    return scopeStocks.filter((stock) => {
      const cleanTicker = stock.ticker ? stock.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase() : '';
      const liveStock = stocksMap.get(cleanTicker) || stocksMap.get(stock.ticker?.toUpperCase());
      const evalRes = evalPrediction(stock, liveStock);

      if (filterType === 'successful') return evalRes.isHit;
      if (filterType === 'completed') return evalRes.isHit || evalRes.isStopped;
      if (filterType === 'stopped') return evalRes.isStopped;
      if (filterType === 'active') return evalRes.isActive;

      return true; // 'all' or 'smart'
    });
  }, [scopeStocks, filterType, stocksMap]);

  if (loading && stocks.length === 0 && closedStocks.length === 0) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map(i => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  if (error && stocks.length === 0 && closedStocks.length === 0) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-4 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="text-destructive mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchPredictions}>
            <RefreshCw className="h-4 w-4 ml-2" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  const shareCaptionWithLinks = `📈 إثبات صحة وتوثيق نتائج توقعات المنصة — ${MARKET_NAMES_AR[market] || market}\n` + OFFICIAL_LINKS_BLOCK;

  return (
    <div className="space-y-4">
      {/* 📢 ترويسة التوثيق وإثبات مصداقية التوقعات */}
      <Card className="border-2 border-teal-500/30 bg-gradient-to-r from-teal-50 via-emerald-50 to-teal-50 dark:from-teal-950/40 dark:via-emerald-950/40 dark:to-teal-950/40 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-extrabold text-lg text-teal-800 dark:text-teal-300 flex items-center gap-2">
                🏆 نتائج ودقة التوقعات الفنية والمالية المتقدمة — {MARKET_NAMES_AR[market] || market}
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                توثيق تلقائي مباشر للنتائج والأرباح المحققة لكافة الصفقات والتوصيات الصادرة عن المنصة
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={fetchPredictions} className="gap-1.5 border-teal-400 text-teal-700 dark:text-teal-300">
              <RefreshCw className="h-3.5 w-3.5" />
              تحديث النتائج المباشرة
            </Button>
          </div>

          {/* شريط الإحصائيات التراكمية الحية (يتغير ديناميكياً مع الفلاتر) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center pt-1">
            <div className="rounded-lg bg-white/70 dark:bg-black/30 p-2.5 border border-teal-100 dark:border-teal-900">
              <p className="text-xs text-muted-foreground mb-0.5">إجمالي الصفقات المحددة</p>
              <p className="text-xl font-extrabold text-teal-700 dark:text-teal-300">{dynamicTotal}</p>
            </div>
            <div className="rounded-lg bg-white/70 dark:bg-black/30 p-2.5 border border-emerald-100 dark:border-emerald-900">
              <p className="text-xs text-muted-foreground mb-0.5">صفقات حققت الهدف 🎯</p>
              <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">{dynamicHits}</p>
            </div>
            <div className="rounded-lg bg-white/70 dark:bg-black/30 p-2.5 border border-emerald-100 dark:border-emerald-900">
              <p className="text-xs text-muted-foreground mb-0.5">نسبة دقة التوقعات</p>
              <p className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">
                {dynamicWinRate.toFixed(0)}%
              </p>
            </div>
            <div className="rounded-lg bg-white/70 dark:bg-black/30 p-2.5 border border-teal-100 dark:border-teal-900">
              <p className="text-xs text-muted-foreground mb-0.5">متوسط العائد المئوي</p>
              <p className={cn("text-xl font-extrabold", pnlColorClass(dynamicAvgPnl))}>
                {formatPnl(dynamicAvgPnl)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 🎛️ شريط الفلاتر الذكية والتقسيمات (الفئة + الوقت + حالة الصفقة) */}
      <div className="space-y-2 bg-muted/30 p-3 rounded-xl border border-border">
        {/* الصف الأول: تصفية المستثمر والخصائص + النطاق الزمني */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* تصفية المستثمر vs المضارب */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-teal-800 dark:text-teal-200 ml-1">فئة التوصيات:</span>
            {([
              ['all', '🌐 جميع الصفقات'],
              ['investor', '📊 توقعات المستثمر'],
              ['trader', '⚡ توقعات المضارب'],
            ] as const).map(([p, label]) => (
              <Button
                key={p}
                variant={personaFilter === p ? 'default' : 'outline'}
                size="sm"
                className={cn("h-8 text-xs px-3 font-semibold", personaFilter === p ? "bg-teal-700 text-white hover:bg-teal-800" : "")}
                onClick={() => setPersonaFilter(p)}
              >
                {label}
              </Button>
            ))}
          </div>

          {/* التقسيم الزمني: أيام، أسابيع، شهور، الكل */}
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-muted-foreground ml-1">الوقت:</span>
            {([
              ['all', 'الكل'],
              ['today', '📅 اليوم'],
              ['week', '🗓️ هذا الأسبوع'],
              ['month', '📆 هذا الشهر'],
            ] as const).map(([tf, label]) => (
              <Button
                key={tf}
                variant={timeFrame === tf ? 'secondary' : 'ghost'}
                size="sm"
                className={cn("h-8 text-xs px-2.5", timeFrame === tf ? "font-bold bg-teal-100 text-teal-800 dark:bg-teal-900 dark:text-teal-200" : "")}
                onClick={() => setTimeFrame(tf)}
              >
                {label}
              </Button>
            ))}
          </div>

          {/* أزرار نمط العرض (جدول / رسم بياني / صورة للنشر) */}
          <div className="inline-flex rounded-md border border-border p-0.5 bg-background">
            {([['table', 'جدول'], ['chart', 'رسم بياني 📊'], ['image', 'صورة للنشر 🖼️']] as const).map(([m, l]) => (
              <button
                key={m}
                onClick={() => setViewMode(m)}
                className={cn(
                  'px-3 py-1 text-xs rounded font-medium transition-colors',
                  viewMode === m ? 'bg-teal-600 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {l}
              </button>
            ))}
          </div>
        </div>

        {/* الصف الثاني: تصفية النتيجة والحالة (مكتملة / جارية / ناجحة / ضربت الوقف) */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border/50">
          <span className="text-xs font-semibold text-muted-foreground ml-1">حالة التوقع:</span>
          {([
            ['smart', '💡 التصفية الذكية'],
            ['successful', '🎯 الناجحة فقط'],
            ['completed', '🏁 الصفقات المكتملة'],
            ['active', '⏳ المستمرة (قيد الانتظار)'],
            ['stopped', '🛑 الصفقات الخاسرة (ضربت الوقف)'],
            ['all', '📋 عرض الجميع'],
          ] as const).map(([ft, label]) => (
            <Button
              key={ft}
              variant={filterType === ft ? 'default' : 'outline'}
              size="sm"
              className={cn(
                "h-7 text-xs px-2.5 rounded-full transition-all",
                filterType === ft ? "bg-emerald-600 text-white font-bold" : "text-muted-foreground"
              )}
              onClick={() => setFilterType(ft)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {/* 📊 عرض المحتوى حسب النمط المختار */}
      {viewMode === 'table' ? (
        <ProofPredictionsTableView
          stocks={filteredCombinedStocks}
        />
      ) : viewMode === 'chart' ? (
        <PredictionsPerformanceChart stocks={filteredCombinedStocks} />
      ) : (
        <ImageCardExport
          title="بطاقة نتائج التوقعات الفنية الرسمية"
          description="حمّل صورة إثبات نتائج التوقعات متضمنة الروابط الرسمية جاهزة للنشر الفوري"
          filename={`predictions-proof-${MARKET_CODES[market]}`}
          telegramCaption={shareCaptionWithLinks}
          telegramMarket={MARKET_CODES[market]}
          accentColor="#0d9488"
          borderClass="border-teal-200"
          bgClass="bg-gradient-to-br from-teal-50 via-emerald-50 to-teal-100/40"
          hasData={filteredCombinedStocks.length > 0}
          emptyHint="لا توجد توقعات متاحة حالياً"
        >
          {(ref) => (
            <PredictionsImageCard
              ref={ref}
              market={market}
              stocks={filteredCombinedStocks}
              winRate={dynamicWinRate}
              avgPnl={dynamicAvgPnl}
              hits={dynamicHits}
              lastUpdate={filteredCombinedStocks[0]?.prediction_date ? new Date(filteredCombinedStocks[0].prediction_date).toLocaleTimeString('ar-EG') : undefined}
            />
          )}
        </ImageCardExport>
      )}

      {/* P6-PREDICTIONS: أرشيف التوقعات السابقة اتنقل لتبويبات المستثمر والمضارب */}
      <div className="text-center text-xs text-muted-foreground py-3 border-t border-border/40 mt-2">
        💡 لعرض التوقعات السابقة، راجع تبويب المستثمر أو المضارب
      </div>
    </div>
  );
}

// ============================================================================
// Expert Predictions Tab - توقعات الخبراء
// ============================================================================


function ExpertPredictionsTableView({ stocks }: { stocks: StockData[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full text-sm min-w-[700px]">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th className="p-2 text-center font-medium w-10">#</th>
            <th className="p-2 text-right font-medium">السهم</th>
            <th className="p-2 text-right font-medium">الكود</th>
            <th className="p-2 text-center font-medium">السعر</th>
            <th className="p-2 text-center font-medium">التغير</th>
            <th className="p-2 text-right font-medium">القطاع</th>
            <th className="p-2 text-center font-medium">الحجم</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((s, i) => (
            <tr key={s.id || i} className="border-t border-border hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => loadStockDetail(s.ticker)}>
              <td className="p-2 text-center font-mono text-xs">{i + 1}</td>
              <td className="p-2 font-medium">{s.name_ar || s.name}</td>
              <td className="p-2 font-mono">{s.ticker}</td>
              <td className="p-2 text-center font-mono">{fmtNum(s.current_price)}</td>
              <td className={cn("p-2 text-center font-mono font-medium", (s.change_percent || 0) >= 0 ? "text-green-600" : "text-red-600")}>
                {(s.change_percent || 0) >= 0 ? '+' : ''}{(s.change_percent || 0).toFixed(2)}%
              </td>
              <td className="p-2 text-right">{s.sector || '—'}</td>
              <td className="p-2 text-center font-mono">{s.volume || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpertPredictionsTab({ market }: { market: MarketType }) {
  const [stocks, setStocks] = useState<StockData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'image' | 'cards' | 'table' | 'text'>('image');

  const CACHE_TTL = 300000;

  const fetchPredictions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // استخدام API الأسهم
      const marketCode = MARKET_CODES[market];
      const cache = useAnalysisStore.getState();
      if (cache.stocks && cache.market === marketCode && Date.now() - cache.lastFetched < CACHE_TTL) {
        const allStocks = cache.stocks;
        const sorted = allStocks
          .filter((s: StockData) => s.current_price > 0)
          .sort((a: StockData, b: StockData) => (b.current_price || 0) - (a.current_price || 0));
        setStocks(sorted);
        setLoading(false);
        return;
      }
      const res = await fetch(`/api/stocks?market=${MARKET_CODES[market]}&limit=20`);
      if (res.ok) {
        const data = await res.json();
        const allStocks = data.stocks || [];
        // ترتيب حسب السعر
        const sorted = allStocks
          .filter((s: StockData) => s.current_price > 0)
          .sort((a: StockData, b: StockData) => (b.current_price || 0) - (a.current_price || 0));
        setStocks(sorted);
      } else {
        setError('فشل في تحميل البيانات');
      }
    } catch (err) {
      setError('فشل في الاتصال بالخادم');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [market]);

  useEffect(() => {
    const marketCode = MARKET_CODES[market];
    const cache = useAnalysisStore.getState();
    if (cache.stocks && cache.market === marketCode && Date.now() - cache.lastFetched < CACHE_TTL) {
      const allStocks = cache.stocks;
      const sorted = allStocks
        .filter((s: StockData) => s.current_price > 0)
        .sort((a: StockData, b: StockData) => (b.current_price || 0) - (a.current_price || 0));
      setStocks(sorted);
      setLoading(false);
    } else {
      fetchPredictions();
    }
  }, [market, fetchPredictions]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-4 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="text-destructive mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchPredictions}>
            <RefreshCw className="h-4 w-4 ml-2" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (stocks.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <Info className="h-12 w-12 mx-auto mb-3 text-muted-foreground" />
          <p className="text-muted-foreground">لا توجد بيانات متاحة حالياً</p>
          <p className="text-sm text-muted-foreground mt-1">سيتم إضافة بيانات جديدة قريباً</p>
        </CardContent>
      </Card>
    );
  }

  const viewSelector = (
    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
      <div className="inline-flex rounded-md border border-border p-0.5 bg-muted/40">
        {([['image', 'صورة'], ['cards', 'كروت'], ['table', 'جدول'], ['text', 'نص']] as const).map(([m, l]) => (
          <button
            key={m}
            onClick={() => setViewMode(m)}
            className={cn(
              'px-3 py-1 text-xs rounded font-medium transition-colors',
              viewMode === m ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {l}
          </button>
        ))}
      </div>
      {viewMode === 'text' && stocks.length > 0 && (
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="gap-1" onClick={() => {
            const text = formatAllExpertPredictionsText(stocks, market);
            navigator.clipboard.writeText(text);
            toast.success('تم نسخ جميع التوقعات ✓');
          }}>
            <Copy className="h-3.5 w-3.5" />
            نسخ الكل
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={async () => {
            const text = formatAllExpertPredictionsText(stocks, market);
            if (navigator.share) {
              try { await navigator.share({ title: 'توقعات الخبراء', text }); } catch {}
            } else {
              navigator.clipboard.writeText(text);
              toast.success('تم نسخ جميع التوقعات ✓');
            }
          }}>
            <Share2 className="h-3.5 w-3.5" />
            مشاركة
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {viewSelector}
      {/* بطاقة توقعات الخبراء القابلة للمشاركة (تحميل صورة / نشر تيليجرام) */}
      {viewMode === 'image' && (
      <ImageCardExport
        title="بطاقة توقعات الخبراء"
        description="حمّل صورة جاهزة للنشر أو انشرها مباشرة على قناة تيليجرام"
        filename={`expert-predictions-${MARKET_CODES[market]}`}
        telegramCaption={`🎯 توقعات الخبراء — ${MARKET_NAMES_AR[market]}\nقائمة الأسهم المراقبة — أداء اليوم\n\nمنصة دليل الاستثمار | invist.m2y.net`}
        telegramMarket={MARKET_CODES[market]}
        accentColor="#15803d"
        borderClass="border-green-200"
        bgClass="bg-gradient-to-br from-green-50 via-emerald-50 to-green-100/40"
        hasData={stocks.length > 0}
        emptyHint="لا توجد بيانات متاحة حالياً"
      >
        {(ref) => (
          <ExpertPredictionsImageCard
            ref={ref}
            market={market}
            stocks={stocks.map((s) => ({
              ticker: s.ticker,
              name: s.name,
              name_ar: s.name_ar,
              current_price: s.current_price,
              change_percent: s.change_percent,
              volume: s.volume,
              sector: s.sector,
            }))}
            lastUpdate={new Date().toLocaleTimeString('ar-EG')}
          />
        )}
      </ImageCardExport>
      )}

      {viewMode !== 'image' && (
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold">قائمة الأسهم</h3>
        <Badge variant="secondary">{stocks.length} سهم</Badge>
      </div>
      )}

      {viewMode !== 'image' && (
      <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
        <Clock className="h-3 w-3" />
        مرتبة حسب السعر
      </div>
      )}
      
      {viewMode === 'cards' && (
      <ScrollArea className="h-[400px] pr-2">
        {stocks.map((stock, idx) => (
          <Card key={idx} className={cn(
            "mb-2 border-r-4 cursor-pointer hover:shadow-md transition-shadow",
            (stock.change_percent || 0) > 0 ? "border-r-green-500" : 
            (stock.change_percent || 0) < 0 ? "border-r-red-500" : "border-r-gray-500"
          )} onClick={() => loadStockDetail(stock.ticker)}>
            <CardContent className="p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {stock.logo_url ? (
                    <img src={stock.logo_url} alt={stock.ticker} className="w-5 h-5 rounded-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : null}
                  <Badge variant={
                    (stock.change_percent || 0) > 0 ? "default" : 
                    (stock.change_percent || 0) < 0 ? "destructive" : "secondary"
                  } className="text-xs">
                    {(stock.change_percent || 0) > 0 ? '↑' : (stock.change_percent || 0) < 0 ? '↓' : '–'}
                  </Badge>
                  <span className="font-bold">{stock.ticker}</span>
                  <span className="text-muted-foreground text-sm">{stock.name_ar || stock.name}</span>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {new Date().toLocaleDateString('ar-EG')}
                </div>
              </div>
              
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 text-sm">
                <div>
                  <span className="text-muted-foreground text-xs">السعر:</span>
                  <p className="font-medium">{stock.current_price?.toFixed(2) || '-'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">التغير:</span>
                  <p className={cn(
                    "font-medium",
                    (stock.change_percent || 0) >= 0 ? "text-green-600" : "text-red-600"
                  )}>
                    {(stock.change_percent || 0) >= 0 ? '+' : ''}{(stock.change_percent || 0).toFixed(1)}%
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">القطاع:</span>
                  <p className="font-medium text-xs truncate">{stock.sector || '-'}</p>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs">الحجم:</span>
                  <p className="font-medium text-xs">{stock.volume || '-'}</p>
                </div>
              </div>

              {/* أزرار النسخ والمشاركة */}
              <div className="flex gap-2 mt-3 pt-2 border-t border-border/50">
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 h-7 text-xs flex-1"
                  onClick={() => {
                    const text = formatSingleExpertPredictionText(stock);
                    navigator.clipboard.writeText(text);
                    toast.success('تم نسخ التوقع ✓');
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  نسخ
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 h-7 text-xs flex-1"
                  onClick={async () => {
                    const text = formatSingleExpertPredictionText(stock);
                    if (navigator.share) {
                      try {
                        await navigator.share({ title: `توقعة ${stock.ticker}`, text });
                      } catch {}
                    } else {
                      navigator.clipboard.writeText(text);
                      toast.success('تم نسخ التوقع ✓');
                    }
                  }}
                >
                  <Share2 className="h-3.5 w-3.5" />
                  مشاركة
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 h-7 text-xs flex-1 border-blue-400 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20"
                  onClick={() => {
                    const text = formatSingleExpertPredictionText(stock);
                    navigator.clipboard.writeText(text);
                    window.open('https://www.facebook.com/', '_blank');
                    toast.success('تم نسخ التوقع وجاري فتح فيسبوك لصق المنشور 💙');
                  }}
                >
                  <Facebook className="h-3.5 w-3.5" />
                  فيسبوك
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </ScrollArea>
      )}

      {viewMode === 'table' && (
        <ExpertPredictionsTableView stocks={stocks} />
      )}

      {viewMode === 'text' && (
        <div className="space-y-3">
          {stocks.map((stock, idx) => {
            const singleText = formatSingleExpertPredictionText(stock);
            return (
              <Card key={`txt-expert-${stock.ticker}-${idx}`} className="border border-border cursor-pointer hover:shadow-md transition-shadow" onClick={() => loadStockDetail(stock.ticker)}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold">{stock.ticker} - {stock.name_ar || stock.name}</span>
                    <div className="flex gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-7 text-xs"
                        onClick={() => {
                          navigator.clipboard.writeText(singleText);
                          toast.success('تم نسخ التحليل ✓');
                        }}
                      >
                        <Copy className="h-3 w-3" />
                        نسخ
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-7 text-xs"
                        onClick={async () => {
                          if (navigator.share) {
                            try { await navigator.share({ title: `تحليل ${stock.ticker}`, text: singleText }); } catch {}
                          } else {
                            navigator.clipboard.writeText(singleText);
                            toast.success('تم نسخ التحليل ✓');
                          }
                        }}
                      >
                        <Share2 className="h-3 w-3" />
                        مشاركة
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-7 text-xs border-blue-400 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20"
                        onClick={() => {
                          navigator.clipboard.writeText(singleText);
                          window.open('https://www.facebook.com/', '_blank');
                          toast.success('تم نسخ التحليل وجاري فتح فيسبوك لصق المنشور 💙');
                        }}
                      >
                        <Facebook className="h-3 w-3" />
                        فيسبوك
                      </Button>
                    </div>
                  </div>
                  <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-foreground/90" dir="rtl">
                    {singleText}
                  </pre>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Persona Tab — "سهم واحد، وجهين" (المستثمر / المضارب)
// محرك التصطاد = العقل — يصطاد الفرص من السوق كله
// ============================================================================

interface PersonaData {
  verdict?: string;
  score?: number;
  reason?: string;
  signal?: string;
  conditions?: string[];
  entry?: number | null;
  target?: number | null;
  stop?: number | null;
  timeframe?: string;
  fair_value?: number | null;
  // Sniper gates data (from sniper/scan engine)
  gates?: {
    liquidity: boolean;
    trend: boolean;
    support_resistance: boolean;
    risk_reward: boolean;
    confirmation: boolean;
    passed: number;
  };
  gate_details?: {
    liquidity_reason?: string;
    trend_reason?: string;
    sr_reason?: string;
    rr_reason?: string;
    confirmation_reason?: string;
  };
  rsi?: number;
  risk_reward?: number;
  sniper_score?: number;
  raw_maestro_score?: number;
  // Enrichment data from sniper/scan
  sector?: string;
  volume?: number;
  volume_ratio?: number;
  beta?: number;
  high_52w?: number;
  low_52w?: number;
  is_egx30?: boolean;
  is_egx100?: boolean;
  momentum_score?: number;
  perf_1w?: number;
  perf_1m?: number;
  perf_3m?: number;
  pe_ratio?: number;
  pb_ratio?: number;
  roe?: number;
  net_margin?: number;
  debt_to_equity?: number;
  current_ratio?: number;
  market_regime?: string;
  volatility?: number;
  momentum_accumulation?: boolean;
  momentum_strength?: number;
  momentum_reason?: string;
  rsi?: number;
  risk_reward?: number;
  perf_1w?: number;
  perf_1m?: number;
  perf_3m?: number;
  support_level?: number | null;
  resistance_level?: number | null;
  price_vs_sr?: string;
}

interface AnalysisJson {
  gambler?: PersonaData;
  investor?: PersonaData;
  narrative?: { line1?: string; line2?: string; line3?: string };
  story_arc?: { price_movement?: string; historical_context?: string };
}

interface StoredAnalysisItem {
  ticker: string;
  market: string;
  name?: string;
  nameAr?: string;
  logoUrl?: string | null;
  maestroScore: number;
  recommendation?: string;
  recommendationAr?: string;
  confidence?: number;
  entry?: { price?: number; target?: number; stopLoss?: number; riskReward?: number };
  updatedAt?: string;
  analysisJson?: AnalysisJson;
  // P16-PERSONA-DIVERGENCE: بيانات الأساسيات/المومنتم من stocks.db
  // (محسوبة في الـ backend وعلى الـ frontend يستخدمها pickPersonaDiverged).
  fundamentals?: {
    pe_ratio?: number;
    roe?: number;
    volume_ratio?: number;
    change_1d?: number;
    change_1m?: number;
    volatility?: number;
    fair_value_upside?: number;
    sector?: string;
    dividend_yield?: number;
    rsi?: number;
    is_gambler_opportunity?: boolean | number;
    is_investor_opportunity?: boolean | number;
    gambler_rank_score?: number;
    investor_rank_score?: number;
    // C2-SECTOR-HEAT: دوران قطاعي للمضارب فقط
    sector_heat?: 'hot' | 'dead' | 'neutral';
    sector_heat_boost?: number;
    gambler_rank_score_boosted?: number;
    // CL7-UI-SECTORS (P6): دور السهم جوه قطاعه (leader/mid/laggard) + التعديل
    sector_role?: 'leader' | 'mid' | 'laggard';
    sector_role_boost?: number;
  } | null;
}

/** لون الـ verdict حسب الكلمة */
function getVerdictColor(verdict: string | undefined): { bg: string; text: string; border: string } {
  const v = (verdict || '').toLowerCase();
  if (v.includes('فرصة') || v.includes('ادخل') || v.includes('قوي') || v.includes('شراء')) {
    return { bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-400', border: 'border-emerald-200 dark:border-emerald-900' };
  }
  // DYNAMIC-SYSTEM-001: تجميع (ACCUMULATE) — لون teal مميز
  if (v.includes('تجميع')) {
    return { bg: 'bg-teal-50 dark:bg-teal-950/40', text: 'text-teal-700 dark:text-teal-400', border: 'border-teal-200 dark:border-teal-900' };
  }
  if (v.includes('انتظر')) {
    return { bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-400', border: 'border-amber-200 dark:border-amber-900' };
  }
  if (v.includes('ابعد') || v.includes('بيع') || v.includes('تجنب') || v.includes('اخرج')) {
    return { bg: 'bg-red-50 dark:bg-red-950/40', text: 'text-red-700 dark:text-red-400', border: 'border-red-200 dark:border-red-900' };
  }
  return { bg: 'bg-muted', text: 'text-muted-foreground', border: 'border-border' };
}

/** Score bar color */
function getScoreColor(score: number): string {
  if (score >= 70) return 'bg-emerald-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

function PersonaCard({
  ticker,
  persona,
  data,
  maestroScore,
  updatedAt,
  narrative,
  market,
  nameAr,
  logoUrl,
  fundamentals,
  onClick,
}: {
  ticker: string;
  // P26: 3 personas (conservative / balanced / gambler) بدل 2
  persona: 'conservative' | 'balanced' | 'gambler';
  data: PersonaData;
  maestroScore?: number;
  updatedAt?: string;
  narrative?: { line1?: string; line2?: string; line3?: string };
  market: MarketType;
  nameAr?: string;
  logoUrl?: string | null;
  fundamentals?: StoredAnalysisItem['fundamentals'];
  onClick?: () => void;
}) {
  const { loadStockDetail } = useAppStore();
  const colors = getVerdictColor(data.verdict);
  const score = data.score ?? 0;
  // P26: isInvestor بقى معناها "أفق طويل" = conservative (conservative = alias قديم لـ investor)
  const isInvestor = persona === 'conservative' || persona === 'investor';

  // ألوان البرسونا — emerald للمستثمر، amber للمتوازن، fuchsia للمضارب (تجنّب blue/indigo)
  const personaTheme = isInvestor
    ? { emoji: '🛡️', label: 'المستثمر', accent: 'text-emerald-700 dark:text-emerald-400', accentBg: 'bg-emerald-50 dark:bg-emerald-950/40', accentBorder: 'border-emerald-200 dark:border-emerald-900' }
    : persona === 'balanced'
    ? { emoji: '⚖️', label: 'المتوازن', accent: 'text-amber-700 dark:text-amber-400', accentBg: 'bg-amber-50 dark:bg-amber-950/40', accentBorder: 'border-amber-200 dark:border-amber-900' }
    : { emoji: '🎯', label: 'المضارب', accent: 'text-fuchsia-700 dark:text-fuchsia-400', accentBg: 'bg-fuchsia-50 dark:bg-fuchsia-950/40', accentBorder: 'border-fuchsia-200 dark:border-fuchsia-900' };

  const targetPct = data.entry && data.target && data.entry > 0
    ? ((data.target - data.entry) / data.entry) * 100
    : null;
  const stopPct = data.entry && data.stop && data.entry > 0
    ? ((data.stop - data.entry) / data.entry) * 100
    : null;

  // Gates data from sniper engine
  const hasGates = data.gates && data.gates.passed > 0;
  const gatesList = data.gates ? [
    { label: 'السيولة', passed: data.gates.liquidity, detail: data.gate_details?.liquidity_reason },
    { label: 'الاتجاه', passed: data.gates.trend, detail: data.gate_details?.trend_reason },
    { label: 'دعم/مقاومة', passed: data.gates.support_resistance, detail: data.gate_details?.sr_reason },
    { label: 'عائد/مخاطرة', passed: data.gates.risk_reward, detail: data.gate_details?.rr_reason },
    { label: 'التأكيد', passed: data.gates.confirmation, detail: data.gate_details?.confirmation_reason },
  ] : [];

  // Format volume for display
  const formatVol = (v: number | undefined) => {
    if (!v) return '—';
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}B`;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
    return v.toLocaleString();
  };

  // Performance color
  const perfColor = (v: number | undefined) => {
    if (v === undefined || v === null) return 'text-muted-foreground';
    return v > 0 ? 'text-emerald-600 dark:text-emerald-400' : v < 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground';
  };

  return (
    <Card className={cn('border-2', colors.border, 'overflow-hidden transition-all duration-200 hover:shadow-md cursor-pointer',
      hasGates && data.gates!.passed >= 4 && 'ring-1 ring-emerald-300 dark:ring-emerald-700',
      hasGates && data.gates!.passed >= 5 && 'ring-2 ring-emerald-400 dark:ring-emerald-600',
    )} onClick={onClick || (() => loadStockDetail(ticker))}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={ticker}
                className="w-9 h-9 rounded-full object-contain bg-background border border-border flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
            ) : (
              <span className="text-2xl flex-shrink-0">{personaTheme.emoji}</span>
            )}
            <div>
              <CardTitle className="text-lg">{ticker}</CardTitle>
              {nameAr && (
                <p className="text-xs text-muted-foreground leading-tight">{nameAr}</p>
              )}
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className={cn('text-xs font-semibold', personaTheme.accent)}>
                  {personaTheme.label}
                </p>
                {/* C2-SECTOR-HEAT + CL7-UI-SECTORS: اعرض القطاع من fundamentals
                    (الـ backend بيملأه) مع شارة سخونة القطاع (🔥 hot / ❄️ dead)
                    وشارة دور السهم (قائد/تابع/متأخر). ده بيخلي العميل يفهم ليه
                    المنصة اختارت السهم ده (لأنه قائد قطاع بيتحرك). */}
                {(fundamentals?.sector || data.sector) && (
                  <span className={cn(
                    'text-xs px-1.5 py-0 rounded-full border flex items-center gap-0.5',
                    fundamentals?.sector_heat === 'hot'
                      ? 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-400 dark:border-orange-800'
                      : fundamentals?.sector_heat === 'dead'
                      ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-400 dark:border-sky-800'
                      : 'bg-muted text-muted-foreground border-border'
                  )} title={
                    fundamentals?.sector_heat === 'hot'
                      ? 'قطاع سخن — دوران قطاعي إيجابي (+15% boost للمضارب)'
                      : fundamentals?.sector_heat === 'dead'
                      ? 'قطاع ميت — معظم الأسهم هابطة (-10% penalty للمضارب)'
                      : undefined
                  }>
                    {fundamentals?.sector_heat === 'hot' && <span>🔥</span>}
                    {fundamentals?.sector_heat === 'dead' && <span>❄️</span>}
                    {fundamentals?.sector || data.sector}
                  </span>
                )}
                {/* CL7-UI-SECTORS: شارة دور السهم جوه قطاعه (قائد/تابع/متأخر).
                    قائد قطاع ساخن = فرصة قوية للمضارب. متأخر في قطاع ميت = تجنّب. */}
                {fundamentals?.sector_role && fundamentals.sector_role !== 'mid' && (
                  <span
                    className={cn(
                      'text-xs px-1.5 py-0 rounded-full border flex items-center gap-0.5',
                      fundamentals.sector_role === 'leader'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800'
                        : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800'
                    )}
                    title={
                      fundamentals.sector_role === 'leader'
                        ? 'قائد القطاع — السهم بيقود حركة القطاع (مفضّل للمضارب في قطاع ساخن)'
                        : 'متأخر عن القطاع — السهم بيتأخر عن حركة القطاع (مرفوض للمضارب في قطاع ميت)'
                    }
                  >
                    {fundamentals.sector_role === 'leader' ? '👑 قائد' : '⬇️ متأخر'}
                  </span>
                )}
                {data.is_egx30 && (
                  <span className="text-xs px-1.5 py-0 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                    EGX30
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="text-left flex flex-col items-end gap-1">
            <Badge className={cn(colors.bg, colors.text, 'border-0 text-sm font-bold')}>
              {data.verdict || 'قيد التحليل'}
            </Badge>
            {/* DYNAMIC-SYSTEM-001: شارة "مراقبة" صفراء للأسهم اللي إشارتها HOLD
                بس درجتها عالية (>= 50%) — عشان تبويب المستثمر ميفضلش فاضي.
                المستخدم طلب: "لو السهم إشارته HOLD بس درجته عالية، اعرضه
                واكتب تحته بـ Badge لونه أصفر: مراقبة - انتظر كسر المقاومة" */}
            {isInvestor && data.signal && String(data.signal).toUpperCase() === 'HOLD' && (data.score ?? 0) >= 50 && (
              <Badge variant="outline" className="text-xs px-1.5 py-0 border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800">
                👁️ مراقبة — انتظر كسر المقاومة
              </Badge>
            )}
            {data.gates && (
              <Badge variant="outline" className={cn(
                'text-xs px-1.5 py-0',
                data.gates.passed >= 4 ? 'border-emerald-300 text-emerald-600 dark:text-emerald-400' :
                data.gates.passed >= 3 ? 'border-amber-300 text-amber-600 dark:text-amber-400' :
                'border-red-300 text-red-600 dark:text-red-400'
              )}>
                <Crosshair className="h-2.5 w-2.5 ml-0.5" />
                {data.gates.passed}/5
              </Badge>
            )}
            {updatedAt && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {new Date(updatedAt).toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' })}
              </p>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* ══════ P16-PERSONA-DIVERGENCE: توقيع البرسونا (chip مميز لكل persona) ══════ */}
        {fundamentals && (
          <div className={cn(
            'rounded-md p-2 text-xs flex flex-wrap items-center gap-1.5',
            personaTheme.accentBg,
            personaTheme.accentBorder,
            'border'
          )}>
            {isInvestor ? (
              <>
                <span className={cn('font-bold', personaTheme.accent)}>🏦 توقيع المستثمر:</span>
                {fundamentals.pe_ratio ? <span>P/E {fundamentals.pe_ratio.toFixed(1)}</span> : null}
                {fundamentals.roe ? <span>• ROE {fundamentals.roe.toFixed(0)}%</span> : null}
                {fundamentals.fair_value_upside ? (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    • خصم {fundamentals.fair_value_upside.toFixed(1)}%
                  </span>
                ) : null}
                {fundamentals.dividend_yield ? <span>• توزيع {fundamentals.dividend_yield.toFixed(1)}%</span> : null}
              </>
            ) : (
              <>
                <span className={cn('font-bold', personaTheme.accent)}>🎯 توقيع المضارب:</span>
                {fundamentals.volume_ratio && fundamentals.volume_ratio >= 1.0 ? (
                  <span>حجم {fundamentals.volume_ratio.toFixed(1)}x</span>
                ) : null}
                {fundamentals.change_1d ? (
                  <span className={fundamentals.change_1d > 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'}>
                    • {fundamentals.change_1d > 0 ? '+' : ''}{fundamentals.change_1d.toFixed(1)}%
                  </span>
                ) : null}
                {fundamentals.volatility ? <span>• تقلب {fundamentals.volatility.toFixed(1)}%</span> : null}
                {fundamentals.rsi ? <span>• RSI {fundamentals.rsi.toFixed(0)}</span> : null}
              </>
            )}
          </div>
        )}

        {/* ══════ التوصية — المحور الأساسي ══════ */}
        {(data.entry || data.target || data.stop) && (
          <div className={cn(
            'rounded-lg p-3 border-2',
            data.risk_reward && data.risk_reward >= 2.0
              ? 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-300 dark:border-emerald-800'
              : data.risk_reward && data.risk_reward >= 1.5
              ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-300 dark:border-amber-800'
              : 'bg-muted/50 border-border'
          )}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-foreground">🎯 التوصية</span>
              {data.risk_reward && data.risk_reward > 0 && (
                <span className={cn(
                  'text-lg font-black',
                  data.risk_reward >= 3 ? 'text-emerald-600 dark:text-emerald-400' :
                  data.risk_reward >= 2 ? 'text-emerald-500' :
                  data.risk_reward >= 1.5 ? 'text-amber-600 dark:text-amber-400' :
                  'text-red-600 dark:text-red-400'
                )}>
                  1:{data.risk_reward.toFixed(1)}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-sm min-w-0">
              <div className="rounded-md bg-background/60 p-2 min-w-0">
                <p className="text-muted-foreground text-xs mb-0.5">💰 ادخل</p>
                <p className="font-bold text-foreground text-base">{data.entry ? data.entry.toFixed(2) : '—'}</p>
              </div>
              <div className="rounded-md bg-emerald-100/60 dark:bg-emerald-900/30 p-2">
                <p className="text-emerald-700 dark:text-emerald-400 text-xs mb-0.5">
                  📈 هدف{targetPct !== null && ` +${targetPct.toFixed(1)}%`}
                </p>
                <p className="font-bold text-emerald-700 dark:text-emerald-400 text-base">
                  {data.target ? data.target.toFixed(2) : '—'}
                </p>
              </div>
              <div className="rounded-md bg-red-100/60 dark:bg-red-900/30 p-2">
                <p className="text-red-700 dark:text-red-400 text-xs mb-0.5">
                  🛑 وقف{stopPct !== null && ` ${stopPct.toFixed(1)}%`}
                </p>
                <p className="font-bold text-red-700 dark:text-red-400 text-base">
                  {data.stop ? data.stop.toFixed(2) : '—'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* تنبيه R/R ضعيف — يوليو 2026 */}
        {data.risk_reward !== null && data.risk_reward !== undefined && data.risk_reward > 0 && data.risk_reward < 1.5 && (data.entry || data.target || data.stop) && (
          <div className="flex items-center gap-1.5 rounded-md bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-2 text-xs text-red-700 dark:text-red-400">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
            <span>⚠️ عائد/مخاطرة {data.risk_reward.toFixed(2)}:1 — المخاطرة أكبر من الربح، الصفقة غير آمنة.</span>
          </div>
        )}

        {/* Score bar */}
        <div>
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-muted-foreground">{data.sniper_score ? '🎯 نتيجة التصطاد' : 'النتيجة'}</span>
            <span className="font-bold">{score.toFixed(0)}/100</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all', getScoreColor(score))}
              style={{ width: `${Math.min(100, Math.max(0, score))}%` }}
            />
          </div>
        </div>

        {/* Gates visual — من محرك التصطاد (مع أسباب كل بوابة) */}
        {hasGates && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between px-1">
              <div className="flex items-center gap-1">
                <Crosshair className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs text-muted-foreground">بوابات التصفية ({data.gates.passed}/5)</span>
              </div>
            </div>
            <div className="flex gap-1">
              {gatesList.map((gate, i) => (
                <div
                  key={i}
                  title={gate.detail || ''}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-0.5 rounded-md py-1.5 px-0.5 text-xs transition-colors cursor-default',
                    gate.passed
                      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                      : 'bg-red-50 text-red-500 dark:bg-red-950/40 dark:text-red-400'
                  )}
                >
                  {gate.passed ? (
                    <ShieldCheck className="h-3.5 w-3.5" />
                  ) : (
                    <ShieldX className="h-3.5 w-3.5" />
                  )}
                  <span className="truncate w-full text-center">{gate.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Quick metrics row — RSI + R/R + Volume */}
        <div className="grid grid-cols-3 gap-2 text-xs">
          {/* RSI */}
          <div className="rounded-md bg-muted/50 p-1.5 text-center">
            <p className="text-muted-foreground text-xs mb-0.5">RSI</p>
            <span className={cn(
              'font-semibold text-sm',
              data.rsi && data.rsi > 70 ? 'text-red-600 dark:text-red-400' :
              data.rsi && data.rsi < 30 ? 'text-emerald-600 dark:text-emerald-400' :
              'text-foreground'
            )}>
              {data.rsi && data.rsi > 0 ? data.rsi.toFixed(0) : '—'}
            </span>
          </div>
          {/* Risk/Reward */}
          <div className={cn(
            'rounded-md p-1.5 text-center',
            data.risk_reward && data.risk_reward >= 3 ? 'bg-emerald-50 dark:bg-emerald-950/40' :
            data.risk_reward && data.risk_reward >= 1.5 ? 'bg-amber-50 dark:bg-amber-950/40' :
            data.risk_reward && data.risk_reward > 0 ? 'bg-red-50 dark:bg-red-950/40' :
            'bg-muted/50'
          )}>
            <p className="text-muted-foreground text-xs mb-0.5">عائد/مخاطرة</p>
            <span className={cn(
              'font-bold text-sm',
              data.risk_reward && data.risk_reward >= 3 ? 'text-emerald-600 dark:text-emerald-400' :
              data.risk_reward && data.risk_reward >= 1.5 ? 'text-amber-600 dark:text-amber-400' :
              data.risk_reward && data.risk_reward > 0 ? 'text-red-600 dark:text-red-400' :
              'text-muted-foreground'
            )}>
              {data.risk_reward && data.risk_reward > 0 ? `${data.risk_reward.toFixed(1)}` : '—'}
            </span>
          </div>
          {/* Volume */}
          <div className="rounded-md bg-muted/50 p-1.5 text-center">
            <p className="text-muted-foreground text-xs mb-0.5">الحجم</p>
            <span className="font-semibold text-sm text-foreground">
              {formatVol(data.volume)}
              {data.volume_ratio && data.volume_ratio > 1 && (
                <span className="text-emerald-600 dark:text-emerald-400 text-xs mr-0.5">↑{data.volume_ratio.toFixed(1)}x</span>
              )}
            </span>
          </div>
        </div>

        {/* Momentum / Performance (for المضارب) */}
        {!isInvestor && (data.perf_1w !== undefined || data.perf_1m !== undefined) && (
          <div className="flex items-center gap-3 px-1 text-xs">
            {data.perf_1w !== undefined && (
              <span className={cn('font-semibold', perfColor(data.perf_1w))}>
                أسبوع: {data.perf_1w > 0 ? '+' : ''}{data.perf_1w.toFixed(1)}%
              </span>
            )}
            {data.perf_1m !== undefined && (
              <span className={cn('font-semibold', perfColor(data.perf_1m))}>
                شهر: {data.perf_1m > 0 ? '+' : ''}{data.perf_1m.toFixed(1)}%
              </span>
            )}
            {data.perf_3m !== undefined && (
              <span className={cn('font-semibold', perfColor(data.perf_3m))}>
                3 أشهر: {data.perf_3m > 0 ? '+' : ''}{data.perf_3m.toFixed(1)}%
              </span>
            )}
          </div>
        )}

        {/* Fundamentals (for المستثمر) */}
        {isInvestor && (data.pe_ratio || data.roe || data.net_margin) && (
          <div className="flex items-center gap-3 px-1 text-xs flex-wrap">
            {data.pe_ratio && data.pe_ratio > 0 && (
              <span className="text-muted-foreground">
                P/E: <span className="font-semibold text-foreground">{data.pe_ratio.toFixed(1)}</span>
              </span>
            )}
            {data.roe && (
              <span className="text-muted-foreground">
                ROE: <span className={cn('font-semibold', data.roe > 10 ? 'text-emerald-600' : 'text-foreground')}>{data.roe.toFixed(1)}%</span>
              </span>
            )}
            {data.net_margin && (
              <span className="text-muted-foreground">
                هامش: <span className={cn('font-semibold', data.net_margin > 0 ? 'text-emerald-600' : 'text-red-600')}>{data.net_margin.toFixed(1)}%</span>
              </span>
            )}
            {data.debt_to_equity && (
              <span className="text-muted-foreground">
                دين/حقوق: <span className={cn('font-semibold', data.debt_to_equity < 1 ? 'text-emerald-600' : 'text-amber-600')}>{data.debt_to_equity.toFixed(2)}</span>
              </span>
            )}
          </div>
        )}

        {/* Market regime badge */}
        {data.market_regime && (
          <div className="flex items-center gap-1.5 px-1 text-xs">
            <Gauge className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">وضع السوق:</span>
            <span className={cn(
              'font-semibold',
              data.market_regime === 'bullish' ? 'text-emerald-600 dark:text-emerald-400' :
              data.market_regime === 'bearish' ? 'text-red-600 dark:text-red-400' :
              'text-amber-600 dark:text-amber-400'
            )}>
              {data.market_regime === 'bullish' ? 'صاعد' : data.market_regime === 'bearish' ? 'هابط' : 'متعادل'}
            </span>
          </div>
        )}

        {/* S/R levels */}
        {(data.support_level || data.resistance_level) && (
          <div className="flex items-center gap-3 px-1 text-xs">
            {data.support_level && (
              <span className="text-muted-foreground">
                دعم: <span className="font-semibold text-emerald-600">{data.support_level.toFixed(2)}</span>
              </span>
            )}
            {data.resistance_level && (
              <span className="text-muted-foreground">
                مقاومة: <span className="font-semibold text-red-600">{data.resistance_level.toFixed(2)}</span>
              </span>
            )}
            {data.price_vs_sr === 'near_support' && (
              <span className="text-xs px-1.5 py-0 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                قرب الدعم ✓
              </span>
            )}
            {data.price_vs_sr === 'near_resistance' && (
              <span className="text-xs px-1.5 py-0 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                قرب المقاومة ⚡
              </span>
            )}
          </div>
        )}

        {/* Reason */}
        {data.reason && (
          <p className="text-sm leading-relaxed text-foreground/90 bg-muted/50 rounded-md p-2">
            {data.reason}
          </p>
        )}

        {/* Narrative — القصة */}
        {narrative && (narrative.line1 || narrative.line2 || narrative.line3) && (
          <div className={cn('rounded-md p-2 text-xs space-y-1', personaTheme.accentBg)}>
            {narrative.line1 && <p className="text-foreground/80">📍 {narrative.line1}</p>}
            {narrative.line2 && <p className="text-foreground/80">📊 {narrative.line2}</p>}
            {narrative.line3 && <p className="text-foreground/80">🔮 {narrative.line3}</p>}
          </div>
        )}

        {/* Timeframe (للمستثمر) */}
        {isInvestor && data.timeframe && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span>الإطار الزمني: <span className="font-semibold text-foreground">{data.timeframe}</span></span>
          </div>
        )}

        {/* Fair value (للمستثمر) */}
        {isInvestor && data.fair_value && data.fair_value > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Target className="h-3 w-3" />
            <span>القيمة العادلة: <span className="font-semibold text-foreground">{data.fair_value.toFixed(2)}</span></span>
          </div>
        )}

        {/* Conditions */}
        {data.conditions && data.conditions.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">الشروط والأسباب:</p>
            <div className="flex flex-wrap gap-1.5">
              {data.conditions.slice(0, 5).map((c, i) => (
                <span
                  key={i}
                  className="text-xs px-2 py-0.5 rounded-full bg-muted text-foreground/80 border border-border"
                >
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* أزرار النسخ والمشاركة */}
        <div className="flex gap-2 mt-3 pt-2 border-t border-border/50">
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8 text-xs flex-1"
            onClick={() => {
              const text = formatSinglePersonaPickText({
                ticker,
                nameAr: data.name_ar,
                name: ticker,
                analysisJson: { [persona]: data },
              } as StoredAnalysisItem, persona, market);
              navigator.clipboard.writeText(text);
              toast.success('تم نسخ التوقع ✓');
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            نسخ
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8 text-xs flex-1"
            onClick={async () => {
              const text = formatSinglePersonaPickText({
                ticker,
                nameAr: data.name_ar,
                name: ticker,
                analysisJson: { [persona]: data },
              } as StoredAnalysisItem, persona, market);
              if (navigator.share) {
                try {
                  await navigator.share({ title: `توقعة ${ticker}`, text });
                } catch {}
              } else {
                navigator.clipboard.writeText(text);
                toast.success('تم نسخ التوقع ✓');
              }
            }}
          >
            <Share2 className="h-3.5 w-3.5" />
            مشاركة
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8 text-xs flex-1 border-blue-400 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20"
            onClick={() => {
              const text = formatSinglePersonaPickText({
                ticker,
                nameAr: data.name_ar,
                name: ticker,
                analysisJson: { [persona]: data },
              } as StoredAnalysisItem, persona, market);
              navigator.clipboard.writeText(text);
              window.open('https://www.facebook.com/', '_blank');
              toast.success('تم نسخ التوقع وجاري فتح فيسبوك لصق المنشور 💙');
            }}
          >
            <Facebook className="h-3.5 w-3.5" />
            فيسبوك
          </Button>
        </div>

        {/* Footer — score reference + volatility */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
          <span>{data.sniper_score ? `تصطاد: ${data.sniper_score}` : maestroScore ? `مايسترو: ${maestroScore}` : ''}</span>
          <div className="flex items-center gap-2">
            {data.beta !== undefined && data.beta > 0 && (
              <span>β {data.beta.toFixed(2)}</span>
            )}
            {data.volatility !== undefined && data.volatility > 0 && (
              <span>σ {data.volatility.toFixed(1)}%</span>
            )}
            {data.signal && <span>{data.signal}</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}


function PersonaTableView({ items, persona, market, onSelectItem }: { items: StoredAnalysisItem[], persona: 'conservative' | 'balanced' | 'gambler', market: MarketType, onSelectItem?: (item: StoredAnalysisItem) => void }) {
  // P26: خريطة الشخصية المعروضة لمفتاح analysisJson (conservative→investor، balanced→gambler كتقريب)
  const _personaKey = persona === 'conservative' ? 'investor' : 'gambler';
  const stocks = useAnalysisStore((state) => state.stocks) || [];
  const stocksMap = React.useMemo(() => {
    const map = new Map<string, any>();
    stocks.forEach((s) => {
      if (s.ticker) {
        const clean = s.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
        map.set(clean, s);
        map.set(s.ticker.toUpperCase(), s);
      }
    });
    return map;
  }, [stocks]);

  return (
    <div className="rounded-md border overflow-x-auto bg-card">
      <table className="w-full text-sm min-w-[950px]">
        <thead className="bg-muted/60 text-muted-foreground">
          <tr>
            <th className="p-2 text-center font-medium w-10">#</th>
            <th className="p-2 text-right font-medium">السهم</th>
            <th className="p-2 text-right font-medium">الاسم</th>
            <th className="p-2 text-center font-medium text-primary">السعر وقت التحليل</th>
            <th className="p-2 text-center font-medium">أعلى / أقل سعر</th>
            <th className="p-2 text-center font-medium">التقييم</th>
            <th className="p-2 text-center font-medium">النتيجة</th>
            <th className="p-2 text-center font-medium">الدخول</th>
            <th className="p-2 text-center font-medium">الهدف</th>
            <th className="p-2 text-center font-medium">الوقف</th>
            <th className="p-2 text-center font-medium">R/R</th>
            <th className="p-2 text-center font-medium hidden md:table-cell">أفق الاستثمار</th>
            <th className="p-2 text-right font-medium hidden lg:table-cell">السبب</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, idx) => {
            // P26: استخدم _personaKey + fallback للحقول العلوية للسهم
            const pd: PersonaData = it.analysisJson?.[_personaKey] || {
              verdict: it.recommendationAr || '',
              score: it.maestroScore || 0,
              reason: '',
              signal: it.recommendation || 'HOLD',
              entry: it.entry?.price ?? null,
              target: it.entry?.target ?? null,
              stop: it.entry?.stopLoss ?? null,
              timeframe: persona === 'balanced' ? '2-6 أسابيع' : (persona === 'conservative' ? '6-12 شهر' : '1-5 أيام'),
            };
            const cleanTicker = it.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
            const stockInfo = stocksMap.get(cleanTicker) || stocksMap.get(it.ticker.toUpperCase());
            const curPrice = pickValidPrice(stockInfo?.current_price, stockInfo?.close, pd.entry, typeof it.entry === 'object' ? it.entry?.price : undefined, it.analysisJson?.context?.historical?.current_price_zone);
            const highPrice = pickValidPrice(
              stockInfo?.high_price && stockInfo?.low_price && stockInfo.high_price !== stockInfo.low_price ? stockInfo.high_price : undefined,
              stockInfo?.high_52w && stockInfo?.low_52w && stockInfo.high_52w !== stockInfo.low_52w ? stockInfo.high_52w : undefined,
              (pd as any).high,
              (pd as any).resistance,
              stockInfo?.resistance,
              pd.target && pd.entry ? Math.max(Number(pd.target), Number(pd.entry)) : pd.target,
              stockInfo?.high_price
            );
            const lowPrice = pickValidPrice(
              stockInfo?.high_price && stockInfo?.low_price && stockInfo.high_price !== stockInfo.low_price ? stockInfo.low_price : undefined,
              stockInfo?.high_52w && stockInfo?.low_52w && stockInfo.high_52w !== stockInfo.low_52w ? stockInfo.low_52w : undefined,
              (pd as any).low,
              (pd as any).support,
              stockInfo?.support,
              pd.stop && pd.entry ? Math.min(Number(pd.stop), Number(pd.entry)) : pd.stop,
              stockInfo?.low_price
            );
            const style = verdictStyle(pd.verdict);
            const rr = computeRR(pd);
            const score = pd.score ?? it.maestroScore ?? 0;
            // 🔥 P0-UI FIX: STALE/MISMATCH flags من الـ backend
            // it.stale = السعر الحي بعيد عن entry بـ >20% (توصية قديمة)
            // it.priceTargetMismatch = السعر الحالي ≥ target (الهدف محقّق، التوصية منتهية)
            const isStale = Boolean(it.stale);
            const isMismatch = Boolean(it.priceTargetMismatch);
            const staleReason = (it.staleReason as string) || '';
            const rowOpacity = isMismatch ? 'opacity-50' : (isStale ? 'opacity-70' : '');

            return (
              <tr key={cleanTicker} className={cn("border-t border-border hover:bg-muted/40 transition-colors cursor-pointer", rowOpacity)} onClick={() => onSelectItem?.(it)}>
                <td className="p-2 text-center font-mono text-xs">{idx + 1}</td>
                <td className="p-2 font-bold text-xs">
                  <div className="flex items-center gap-1.5">
                    {it.logoUrl ? (
                      <img
                        src={it.logoUrl}
                        alt={cleanTicker}
                        className="w-5 h-5 rounded-full object-contain flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : null}
                    <span>{cleanTicker}</span>
                    {(isStale || isMismatch) && (
                      <span
                        title={staleReason || (isMismatch ? 'الهدف محقّق — التوصية منتهية' : 'توصية قديمة')}
                        className={cn(
                          "text-[10px] px-1 rounded font-bold cursor-help",
                          isMismatch
                            ? "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200"
                        )}
                      >
                        {isMismatch ? 'منتهية' : `قديمة ${it.stalePct ? `${it.stalePct}%` : ''}`}
                      </span>
                    )}
                  </div>
                </td>
                <td className="p-2 text-xs text-muted-foreground max-w-[120px] truncate" title={it.nameAr || it.name || cleanTicker}>{it.nameAr || it.name || cleanTicker}</td>
                <td className={cn("p-2 text-center font-mono text-xs font-bold", isStale || isMismatch ? "text-amber-600 dark:text-amber-400" : "text-primary")} title={isStale || isMismatch ? staleReason : undefined}>
                  {fmtPrice(curPrice)}
                </td>
                <td className="p-2 text-center font-mono text-xs whitespace-nowrap">
                  <span className="text-emerald-600 dark:text-emerald-400 font-semibold">▲ {fmtPrice(highPrice)}</span>
                  <span className="text-muted-foreground mx-1">/</span>
                  <span className="text-rose-600 dark:text-rose-400 font-semibold">▼ {fmtPrice(lowPrice)}</span>
                </td>
                <td className="p-2 text-center">
                  {isMismatch ? (
                    <Badge className="text-xs font-bold border-0 bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-200">
                      منتهية
                    </Badge>
                  ) : isStale ? (
                    <Badge className="text-xs font-bold border-0 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200" title={staleReason}>
                      ⚠️ قديمة
                    </Badge>
                  ) : (
                    <Badge style={{ backgroundColor: style.bg, color: style.color }} className="text-xs font-bold border-0">
                      {pd.verdict || 'متابعة'}
                    </Badge>
                  )}
                </td>
                <td className={cn('p-2 text-center font-mono text-xs', scoreColor(pd.score))}>
                  {Number(score).toFixed(0)}
                </td>
                <td className="p-2 text-center font-mono text-xs">{fmtPrice(pd.entry)}</td>
                <td className="p-2 text-center font-mono text-xs text-emerald-600 dark:text-emerald-400">{fmtPrice(pd.target)}</td>
                <td className="p-2 text-center font-mono text-xs text-rose-600 dark:text-rose-400">{fmtPrice(pd.stop)}</td>
                <td className={cn('p-2 text-center font-mono text-xs', rrColor(rr))}>
                  {rr != null ? `${rr.toFixed(2)}:1` : '—'}
                </td>
                <td className="p-2 text-center text-xs hidden md:table-cell">{pd.timeframe || '—'}</td>
                <td className="p-2 text-right hidden lg:table-cell text-xs text-muted-foreground max-w-[250px] truncate" title={pd.reason}>{pd.reason || '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// بناء خريطة رمز ← اسم من API الأسهم المباشر (لإثراء نتائج التصطاد بأسماء حقيقية)
type NameMap = Record<string, { name?: string; name_ar?: string; logo_url?: string | null }>;

async function buildNameMap(marketCode: string): Promise<NameMap> {
  const map: NameMap = {};
  try {
    const res = await fetch(`/api/stocks?market=${marketCode}&limit=600`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      const list: any[] = data.stocks || [];
      for (const s of list) {
        const tk = String(s.ticker || s.symbol || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, '');
        if (!tk) continue;
        map[tk] = { name: s.name, name_ar: s.name_ar || s.name, logo_url: s.logo_url || null };
      }
    }
  } catch {
    /* تجاهل — نعتمد على الاسم من نتيجة التصطاد مباشرة */
  }
  return map;
}

// إثراء عناصر التحليل بأسماء الأسهم + الأيقونات (الأولوية: نتيجة التصطاد ← خريطة الأسهم)
function enrichItems(items: StoredAnalysisItem[], nameMap: NameMap): StoredAnalysisItem[] {
  return items.map((it) => {
    const tk = it.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '');
    const mapped = nameMap[tk];
    // لو الاسم والـ logo موجودين على it، نكمل منهم — بس نستخدم mapped كـ fallback
    const name = it.name || (it as any).name || mapped?.name;
    const nameAr = it.nameAr || (it as any).name_ar || mapped?.name_ar || mapped?.name;
    const logoUrl = it.logoUrl || (it as any).logo_url || mapped?.logo_url || null;
    return {
      ...it,
      name,
      nameAr,
      logoUrl,
    };
  });
}

/**
 * يختار أفضل الأسهم لبرسونا معين: يخلط أعلى BUY مع أعلى SELL
 * (عشان المضارب يشوف بيع وشراء حقيقي، مش نوع واحد بس).
 * BUY ترتيبه التنازلي بالـ score، SELL ترتيبه التنازلي بالـ score،
 * وياخد نصيب كل منهم من الـ limit.
 */
function pickPersonaMix(items: StoredAnalysisItem[], persona: 'conservative' | 'balanced' | 'gambler', limit = 5): StoredAnalysisItem[] {
  // P26: balanced = عرض عام بدون فلتر persona-specific، مرتّب بالـ maestroScore.
  if (persona === 'balanced') {
    const actionableBalanced = ['strong_buy', 'buy', 'swing_buy', 't1_buy', 'accumulate', 'strong_sell', 'sell', 'hold', 'wait', 'reduce'];
    return items
      .filter((it) => actionableBalanced.includes((it.recommendation || '').toLowerCase()))
      .sort((a, b) => (b.maestroScore || 0) - (a.maestroScore || 0))
      .slice(0, limit);
  }
  // P26: خريطة الشخصية المعروضة لمفتاح analysisJson (conservative→investor)
  const _personaKey = persona === 'conservative' ? 'investor' : 'gambler';
  // RELAX-INVESTOR-001: أضفنا 'accumulate' للـ actionable list عشان تبويب
  // المستثمر يعرض أسهم ACCUMULATE (تجميع) مش بس BUY/SELL/HOLD.
  const actionable = ['strong_buy', 'buy', 'swing_buy', 't1_buy', 'accumulate', 'strong_sell', 'sell', 'hold', 'wait', 'reduce'];
  const valid = items.filter(
    (it) =>
      it.analysisJson && it.analysisJson[_personaKey] &&
      (it.analysisJson[_personaKey]?.verdict || it.analysisJson[_personaKey]?.score !== undefined) &&
      actionable.includes((it.recommendation || '').toLowerCase()),
  );
  const byScore = (a: StoredAnalysisItem, b: StoredAnalysisItem) =>
    (b.analysisJson?.[_personaKey]?.score ?? 0) - (a.analysisJson?.[_personaKey]?.score ?? 0);

  // RELAX-INVESTOR-001: أضفنا ACCUMULATE لقائمة الشراء عشان تتعامل كفرصة.
  const buys = valid
    .filter((it) => ['BUY', 'STRONG_BUY', 'ACCUMULATE'].includes(String(it.analysisJson?.[_personaKey]?.signal).toUpperCase()))
    .sort(byScore);
  const sells = valid
    .filter((it) => ['SELL', 'STRONG_SELL', 'REDUCE'].includes(String(it.analysisJson?.[_personaKey]?.signal).toUpperCase()))
    .sort(byScore);
  const others = valid
    .filter((it) => !['BUY', 'STRONG_BUY', 'ACCUMULATE', 'SELL', 'STRONG_SELL', 'REDUCE'].includes(String(it.analysisJson?.[_personaKey]?.signal).toUpperCase()))
    .sort(byScore);

  const buyN = Math.min(Math.ceil(limit / 2), buys.length);
  const sellN = Math.min(limit - buyN, sells.length);
  const result = [...buys.slice(0, buyN), ...sells.slice(0, sellN)];
  // لو فيه مساحة (مفيش بيع/شراء كفاية) نكمل من others
  let idx = result.length;
  while (result.length < limit && idx < others.length) {
    result.push(others[idx]);
    idx++;
  }
  return result;
}

// P16-PERSONA-DIVERGENCE: اختيار الأسهم بناءً على فلاتر البرسونا المستقلة.
// - المضارب: يفضّل الـ items اللي fundamentals.is_gambler_opportunity=1،
//   مرتبة بـ gambler_rank_score DESC.
// - المستثمر: يفضّل الـ items اللي fundamentals.is_investor_opportunity=1،
//   مرتبة بـ investor_rank_score DESC.
// لو مفيش enough diverged items → fallback لـ pickPersonaMix (السلوك القديم).
// RELAX-INVESTOR-001: لو مفيش enough diverged items، بنضمّ items اللي إشاراتها
// BUY/ACCUMULATE حتى لو ممعندهاش الـ flag، عشان تبويب المستثمر ميفضلش فاضي.
function pickPersonaDiverged(items: StoredAnalysisItem[], persona: 'conservative' | 'balanced' | 'gambler', limit = 5): StoredAnalysisItem[] {
  // P26: balanced = عرض عام بدون فلتر persona-specific، مرتّب بالـ maestroScore.
  if (persona === 'balanced') {
    const actionableBalanced = ['strong_buy', 'buy', 'swing_buy', 't1_buy', 'accumulate', 'strong_sell', 'sell', 'hold', 'wait', 'reduce'];
    return items
      .filter((it) => actionableBalanced.includes((it.recommendation || '').toLowerCase()))
      .sort((a, b) => (b.maestroScore || 0) - (a.maestroScore || 0))
      .slice(0, limit);
  }
  const flagKey = persona === 'gambler' ? 'is_gambler_opportunity' : 'is_investor_opportunity';
  const rankKey = persona === 'gambler' ? 'gambler_rank_score' : 'investor_rank_score';
  // P26: خريطة الشخصية المعروضة لمفتاح analysisJson (conservative→investor)
  const _personaKey = persona === 'conservative' ? 'investor' : 'gambler';

  // فقط الـ items اللي عندها fundamentals معرّفة وبتطابق persona flag
  const diverged = items.filter((it: any) => {
    const f = it?.fundamentals;
    return f && (f[flagKey] === true || f[flagKey] === 1);
  });

  // مرّتبة بـ rank score تنازلياً
  const sorted = diverged.sort((a: any, b: any) => {
    const ra = (a?.fundamentals?.[rankKey] as number) || 0;
    const rb = (b?.fundamentals?.[rankKey] as number) || 0;
    return rb - ra;
  });

  if (sorted.length >= Math.min(limit, 3)) {
    return sorted.slice(0, limit);
  }

  // RELAX-INVESTOR-001: لو الـ diverged items مش كفاية، نضمّ items اللي إشاراتها
  // BUY/ACCUMULATE (للمستثمر) حتى لو ممعندهاش الـ is_investor_opportunity flag.
  // ده بيضمن إن تبويب المستثمر دايماً فيه محتوى، حتى لو الفلتر الصارم رفض الكل.
  const byPersonaScore = (a: StoredAnalysisItem, b: StoredAnalysisItem) =>
    (b.analysisJson?.[_personaKey]?.score ?? 0) - (a.analysisJson?.[_personaKey]?.score ?? 0);
  const signalTier = items
    .filter((it: any) => {
      const sig = String(it?.analysisJson?.[_personaKey]?.signal || '').toUpperCase();
      return sig === 'BUY' || sig === 'STRONG_BUY' || sig === 'ACCUMULATE';
    })
    .sort(byPersonaScore);

  // ادمج diverged + signalTier بدون تكرار
  const seen = new Set(sorted.map((s) => s.ticker));
  const merged = [...sorted];
  for (const it of signalTier) {
    if (merged.length >= limit) break;
    if (!seen.has(it.ticker)) {
      merged.push(it);
      seen.add(it.ticker);
    }
  }

  if (merged.length >= Math.min(limit, 3)) {
    return merged.slice(0, limit);
  }

  // fallback أخير: لو لسه مش كفاية → كمّل بـ pickPersonaMix
  const fallback = pickPersonaMix(items, persona, limit);
  for (const it of fallback) {
    if (merged.length >= limit) break;
    if (!seen.has(it.ticker)) {
      merged.push(it);
      seen.add(it.ticker);
    }
  }
  return merged.slice(0, limit);
}

function StockDetailPanel({ item, persona, market, subTab, onSubTabChange, onBack, stockDetail }: {
  item: StoredAnalysisItem;
  // P26: 3 personas (conservative / balanced / gambler)
  persona: 'conservative' | 'balanced' | 'gambler';
  market: MarketType;
  subTab: 'details' | 'chart' | 'verdict';
  onSubTabChange: (tab: 'details' | 'chart' | 'verdict') => void;
  onBack: () => void;
  stockDetail: any;
}) {
  // P26: خريطة الشخصية المعروضة لمفتاح analysisJson + fallback للحقول العلوية للسهم
  const _personaKey = persona === 'conservative' ? 'investor' : 'gambler';
  const pd: PersonaData = item.analysisJson?.[_personaKey] || {
    verdict: item.recommendationAr || '',
    score: item.maestroScore || 0,
    reason: '',
    signal: item.recommendation || 'HOLD',
    entry: item.entry?.price ?? null,
    target: item.entry?.target ?? null,
    stop: item.entry?.stopLoss ?? null,
    timeframe: persona === 'balanced' ? '2-6 أسابيع' : (persona === 'conservative' ? '6-12 شهر' : '1-5 أيام'),
  };
  const ticker = item.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '');
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const analysisCardRef = useRef<HTMLDivElement>(null);
  const [capturingChart, setCapturingChart] = useState(false);
  const [capturingCard, setCapturingCard] = useState(false);

  // P43-VIRAL-SHARE: نسخ التحليل الشامل (نص غني + Footer ثابت)
  const handleCopyComprehensive = useCallback(() => {
    const text = formatComprehensiveStockText(item, market, stockDetail);
    navigator.clipboard.writeText(text);
    toast.success('تم نسخ التحليل الشامل ✓', {
      description: 'جاهز للّصق في تليجرام / فيسبوك / واتساب',
    });
  }, [item, market, stockDetail]);

  // P43-VIRAL-SHARE: التقاط صورة لكونتبر الشارت التفاعلي (Telegram-ready)
  const handleChartImage = useCallback(async () => {
    if (!chartContainerRef.current) {
      toast.error('افتح تبويب «الشارت» الأول عشان تلتقط صورته');
      return;
    }
    setCapturingChart(true);
    try {
      const dataUrl = await toPng(chartContainerRef.current, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
        cacheBust: true,
        skipFonts: true,
      });
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const link = document.createElement('a');
      link.download = `${ticker}-chart-${yyyy}-${mm}-${dd}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('تم تحميل صورة الشارت ✓');
    } catch (err) {
      console.error('[ChartImage] toPng error:', err);
      toast.error('فشل في التقاط صورة الشارت');
    } finally {
      setCapturingChart(false);
    }
  }, [ticker]);

  // P43-VIRAL-SHARE: توليد بطاقة تحليل مخصصة (800x600 Telegram-ready) + نسخ النص الشامل
  const handleAnalysisCard = useCallback(async () => {
    if (!analysisCardRef.current) {
      toast.error('البطاقة غير متاحة');
      return;
    }
    setCapturingCard(true);
    try {
      const dataUrl = await toPng(analysisCardRef.current, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: '#0f172a',
        cacheBust: true,
        skipFonts: true,
      });
      const now = new Date();
      const yyyy = now.getFullYear();
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const dd = String(now.getDate()).padStart(2, '0');
      const link = document.createElement('a');
      link.download = `${ticker}-analysis-${yyyy}-${mm}-${dd}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // نسخ النص الشامل في نفس الوقت
      const text = formatComprehensiveStockText(item, market, stockDetail);
      try {
        await navigator.clipboard.writeText(text);
        toast.success('تم نسخ النص وتحميل بطاقة التحليل ✓', {
          description: 'شاركها الآن على تليجرام / فيسبوك! 🚀',
        });
      } catch {
        toast.success('تم تحميل بطاقة التحليل ✓');
      }
    } catch (err) {
      console.error('[AnalysisCard] toPng error:', err);
      toast.error('فشل في توليد بطاقة التحليل');
    } finally {
      setCapturingCard(false);
    }
  }, [item, market, stockDetail, ticker]);

  // بيانات للبطاقة المخفية
  const inv = item.analysisJson?.investor || {};
  const gam = item.analysisJson?.gambler || {};
  const activePd = pd;
  const price = pickValidPrice(stockDetail?.current_price, activePd.entry, inv.entry, gam.entry) || 0;
  const changePct = stockDetail?.change_percent != null ? stockDetail.change_percent : 0;
  const gates = activePd.gates;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1">
          <ArrowRight className="h-4 w-4" />
          رجوع
        </Button>
        <span className="font-bold text-lg">{ticker}</span>
        <span className="text-muted-foreground text-sm">{item.nameAr || item.name}</span>
        {/* P43-VIRAL-SHARE: أزرار النسخ الشامل + بطاقة التحليل + صورة الشارت */}
        <div className="flex items-center gap-2 mr-auto flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8"
            onClick={handleCopyComprehensive}
          >
            <FileText className="h-3.5 w-3.5" />
            نسخ شامل
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1 h-8 border-emerald-400 text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20"
            onClick={handleAnalysisCard}
            disabled={capturingCard}
          >
            {capturingCard ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
            بطاقة تحليل
          </Button>
          {subTab === 'chart' && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1 h-8 border-fuchsia-400 text-fuchsia-600 hover:bg-fuchsia-50 dark:hover:bg-fuchsia-950/20"
              onClick={handleChartImage}
              disabled={capturingChart}
            >
              {capturingChart ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              صورة الشارت
            </Button>
          )}
        </div>
      </div>

      <Tabs value={subTab} onValueChange={(v) => onSubTabChange(v as any)} className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="details">بيانات السهم</TabsTrigger>
          <TabsTrigger value="chart">الشارت</TabsTrigger>
          <TabsTrigger value="verdict">التوصية</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <Card>
            <CardContent className="p-4 space-y-3">
              {!stockDetail ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">السعر وقت التحليل</p>
                    <p className="font-bold">{stockDetail?.current_price ? `${stockDetail.current_price.toFixed(2)} ${currencyLabel}` : pd.entry?.price ? `${pd.entry.price.toFixed(2)} ${currencyLabel}` : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">التغير</p>
                    <p className="font-bold">{stockDetail?.change_percent != null ? `${stockDetail.change_percent >= 0 ? '+' : ''}${stockDetail.change_percent.toFixed(2)}%` : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">الحجم</p>
                    <p className="font-bold">{stockDetail?.volume ? formatVolume(stockDetail.volume) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">القطاع</p>
                    <p className="font-bold">{stockDetail?.sector || '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">P/E</p>
                    <p className="font-bold">{stockDetail?.pe_ratio ? stockDetail.pe_ratio.toFixed(2) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">P/B</p>
                    <p className="font-bold">{stockDetail?.pb_ratio ? stockDetail.pb_ratio.toFixed(2) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">القيمة السوقية</p>
                    <p className="font-bold">{stockDetail?.market_cap ? formatNumber(stockDetail.market_cap) : '—'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">الرأي</p>
                    <p className="font-bold">{pd.verdict || '—'}</p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="chart">
          <Card>
            <CardContent className="p-2">
              <div className="h-[65vh]" ref={chartContainerRef}>
                <TradingChartViewDynamic initialTicker={ticker} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="verdict">
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="space-y-2">
                <h4 className="font-semibold">التوصية</h4>
                <p className="text-lg font-bold">{pd.verdict || 'متابعة'}</p>
                <p className="text-sm text-muted-foreground">{pd.reason}</p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded bg-muted text-center">
                  <p className="text-xs text-muted-foreground">الدخول</p>
                  <p className="font-bold">{pd.entry?.price ? pd.entry.price.toFixed(2) : '—'}</p>
                </div>
                <div className="p-3 rounded bg-muted text-center">
                  <p className="text-xs text-muted-foreground">الهدف</p>
                  <p className="font-bold text-emerald-600">{pd.target ? pd.target.toFixed(2) : '—'}</p>
                </div>
                <div className="p-3 rounded bg-muted text-center">
                  <p className="text-xs text-muted-foreground">الوقف</p>
                  <p className="font-bold text-rose-600">{pd.stop ? pd.stop.toFixed(2) : '—'}</p>
                </div>
              </div>
              {pd.conditions && pd.conditions.length > 0 && (
                <div className="space-y-1">
                  <h5 className="text-sm font-semibold">الشروط</h5>
                  <ul className="list-disc list-inside text-sm text-muted-foreground">
                    {pd.conditions.slice(0, 5).map((c, i) => <li key={i}>{c}</li>)}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* P43-VIRAL-SHARE: بطاقة التحليل المخفية (800x600 Telegram-ready) للتصدير كصورة */}
      <div style={{ position: 'absolute', left: '-99999px', top: 0, pointerEvents: 'none' }} aria-hidden>
        <div
          ref={analysisCardRef}
          style={{
            width: '800px',
            minHeight: '600px',
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
            background: 'linear-gradient(135deg, #ea580c, #d97706)',
            padding: '20px 28px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}>
            <div>
              <div style={{ fontSize: '24px', fontWeight: 'bold', color: 'white', marginBottom: '4px' }}>
                {ticker} · {item.nameAr || item.name || ticker}
              </div>
              <div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.85)' }}>
                تحليل شامل · المستثمر + المضارب
              </div>
            </div>
            <div style={{ textAlign: 'left' }}>
              <div style={{
                background: 'rgba(255,255,255,0.2)',
                padding: '6px 14px',
                borderRadius: '10px',
                color: 'white',
                fontWeight: 'bold',
                fontSize: '13px',
              }}>
                دليل الاستثمار
              </div>
              <div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.7)', marginTop: '4px', textAlign: 'left' }} suppressHydrationWarning>
                {new Date().toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })}
              </div>
            </div>
          </div>

          {/* Body */}
          <div style={{ padding: '24px 28px' }}>
            {/* Price + Change + Verdict */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px', flexWrap: 'wrap', gap: '12px' }}>
              <div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>السعر وقت التحليل</div>
                <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#fbbf24' }}>
                  {price ? price.toFixed(2) : '—'} <span style={{ fontSize: '14px', color: '#94a3b8' }}>{currencyLabel}</span>
                </div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>التغير اليومي</div>
                <div style={{ fontSize: '20px', fontWeight: 'bold', color: changePct >= 0 ? '#10b981' : '#ef4444' }}>
                  {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
                </div>
              </div>
              <div style={{
                padding: '8px 18px',
                borderRadius: '12px',
                background: (activePd.verdict || '').includes('شراء') ? 'rgba(16,185,129,0.2)'
                  : (activePd.verdict || '').includes('بيع') ? 'rgba(239,68,68,0.2)'
                  : 'rgba(245,158,11,0.2)',
                color: (activePd.verdict || '').includes('شراء') ? '#10b981'
                  : (activePd.verdict || '').includes('بيع') ? '#ef4444'
                  : '#f59e0b',
                fontWeight: 'bold',
                fontSize: '16px',
              }}>
                {activePd.verdict || 'متابعة'}
              </div>
            </div>

            {/* Entry / Target / Stop grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '18px' }}>
              <div style={{ background: 'rgba(251,191,36,0.1)', padding: '12px', borderRadius: '12px', textAlign: 'center', border: '1px solid rgba(251,191,36,0.2)' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>الدخول</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#fbbf24' }}>{activePd.entry ? activePd.entry.toFixed(2) : '—'}</div>
              </div>
              <div style={{ background: 'rgba(16,185,129,0.1)', padding: '12px', borderRadius: '12px', textAlign: 'center', border: '1px solid rgba(16,185,129,0.2)' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>الهدف</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#10b981' }}>{activePd.target ? activePd.target.toFixed(2) : '—'}</div>
              </div>
              <div style={{ background: 'rgba(239,68,68,0.1)', padding: '12px', borderRadius: '12px', textAlign: 'center', border: '1px solid rgba(239,68,68,0.2)' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>الوقف</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#ef4444' }}>{activePd.stop ? activePd.stop.toFixed(2) : '—'}</div>
              </div>
            </div>

            {/* Metrics row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px', marginBottom: '18px' }}>
              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>R/R</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>1:{activePd.risk_reward ? activePd.risk_reward.toFixed(1) : '—'}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>RSI</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{activePd.rsi != null ? activePd.rsi.toFixed(0) : '—'}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>Score</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{activePd.score != null ? activePd.score.toFixed(0) : '—'}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.05)', padding: '10px', borderRadius: '10px', textAlign: 'center' }}>
                <div style={{ fontSize: '10px', color: '#94a3b8' }}>Gates</div>
                <div style={{ fontSize: '16px', fontWeight: 'bold' }}>{gates ? `${gates.passed}/5` : '—'}</div>
              </div>
            </div>

            {/* Reason */}
            {activePd.reason && (
              <div style={{
                background: 'rgba(255,255,255,0.05)',
                padding: '12px 16px',
                borderRadius: '10px',
                fontSize: '13px',
                color: '#cbd5e1',
                marginBottom: '14px',
                lineHeight: '1.6',
              }}>
                📝 {activePd.reason}
              </div>
            )}

            {/* Footer links */}
            <div style={{
              background: 'linear-gradient(135deg, rgba(234,88,12,0.15), rgba(217,119,6,0.15))',
              borderRadius: '10px',
              padding: '12px 16px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: '11px', color: '#cbd5e1', marginBottom: '6px' }}>
                🔗 invist.m2y.net | ✈️ t.me/Arabian_investment_guide
              </div>
              <div style={{ fontSize: '10px', color: '#64748b' }}>
                ⚠️ تعليمي فقط — ليس نصيحة استثمارية
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// P42-NO-FREEZE: ثوابت منع تجميد الشاشة.
// PERSONA_DISPLAY_LIMIT: عدد الأسهم اللي بنحتفظ بيها في الـ state (10).
// PERSONA_PAGE_SIZE: عدد الكروت اللي بتترسم في نفس اللحظة (5) — عشان المتصفح مايموتش.
const PERSONA_DISPLAY_LIMIT = 10;
const PERSONA_PAGE_SIZE = 5;

function PersonaTab({ market, persona }: { market: MarketType; persona: 'conservative' | 'balanced' | 'gambler' }) {
  // P26: خريطة الشخصية المعروضة لمفتاح analysisJson (conservative→investor، balanced→gambler كتقريب)
  const _personaKey = persona === 'conservative' ? 'investor' : 'gambler';
  // cache-bust-force-refresh-20260715
  // RECOMMENDATIONS-FIX-022 (يوليو 2026): default viewMode بقى 'table' عشان
  // المستخدم يشوف الجدول بكل الأعمدة (ticker, name_ar, score, entry, target,
  // stop, R/R, verdict) بدل ما يحتاج يضغط على view selector.
  const [items, setItems] = useState<StoredAnalysisItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'image' | 'cards' | 'table' | 'text'>('table');
  const [usingFallback, setUsingFallback] = useState(false);
  const [dataSource, setDataSource] = useState<'stored' | 'predictions'>('stored');
  const [selectedItem, setSelectedItem] = useState<StoredAnalysisItem | null>(null);
  // ══════ Unified Analysis Modal: السهم المختار لفتح نافذة التحليل الشاملة ══════
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<'details' | 'chart' | 'verdict'>('details');
  // P42-NO-FREEZE: ترقيم صفحات الكروت (5 لكل صفحة)
  const [personaPage, setPersonaPage] = useState(0);
  const [stockDetail, setStockDetail] = useState<any>(null);
  // P6-PREDICTIONS: أرشيف التوقعات السابقة (يتم عرضه أسفل الـ PersonaTableView).
  // بيتسحب من نفس /api/unified/predictions تحت مفتاح previous_predictions.
  const [previousPredictions, setPreviousPredictions] = useState<PreviousPrediction[]>([]);
  // C2-SECTOR-HEAT: قطاعات ساخنة/ميتة من الـ backend meta (للـ banner).
  const [sectorHeat, setSectorHeat] = useState<{
    hot?: Array<{ sector: string; avg_chg: number; rising_ratio: number; n: number; boost: number }>;
    dead?: Array<{ sector: string; avg_chg: number; rising_ratio: number; n: number; boost: number }>;
  } | null>(null);
  // CL7-UI-SECTORS: ملخص قطاعي ديناميكي كامل من meta.sectorSummary — لكل قطاع:
  // status, n, avg_chg, rising_ratio, leaders/mids/laggards, top_leader, top_laggard.
  // بيتم عرضه في Section "ذكاء القطاعات" عشان العميل يفهم ليه المنصة اختارت السهم.
  const [sectorSummary, setSectorSummary] = useState<Array<{
    sector: string;
    status: 'hot' | 'dead' | 'neutral';
    n: number;
    avg_chg: number;
    rising_ratio: number;
    boost: number;
    leaders: number;
    mids: number;
    laggards: number;
    top_leader: string | null;
    top_leader_chg: number;
    top_laggard: string | null;
    top_laggard_chg: number;
  }>>([]);

  const marketCode = MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market];

  // Unified Analysis Modal: بدل ما نعرض StockDetailPanel داخل الصفحة،
  // نفتح نافذة منبثقة ضخمة فيها كل مكونات التحليل (شارت + DNA + SMC + خطة التداول).
  const handleSelectItem = useCallback((item: StoredAnalysisItem) => {
    setSelectedTicker(item.ticker);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedItem(null);
    setStockDetail(null);
    setSelectedTicker(null);
  }, []);

  useEffect(() => {
    if (!selectedItem) { setStockDetail(null); return; }
    let cancelled = false;
    fetch(`/api/stocks/${selectedItem.ticker}?market=${marketCode}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled) setStockDetail(d); })
      .catch(() => { if (!cancelled) setStockDetail(null); });
    return () => { cancelled = true; };
  }, [selectedItem, marketCode]);

  useEffect(() => {
    setSelectedItem(null);
    setStockDetail(null);
    setSelectedTicker(null);
    setPersonaPage(0);
  }, [market, persona]);

  // P6-PREDICTIONS: جلب أرشيف التوقعات السابقة من /api/unified/predictions.
  // الـ endpoint بيرجّع previous_predictions كـ list — بنعرضها في تبويب البرسونا
  // عشان المستخدم يشوف أداء التوقعات السابقة جنب التوصيات الحالية.
  // RL-FIX-9: بنمرّر persona للـ API علشان كل تبويب يعرض توقعاته الخاصة
  // (مش نفس الأرشيف لكل التبويبات).
  useEffect(() => {
    let cancelled = false;
    const fetchPrevious = async () => {
      try {
        const res = await fetch(`/api/unified/predictions?market=${marketCode}&limit=100&persona=${persona}`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const prev = Array.isArray(data.previous_predictions) ? data.previous_predictions : [];
        // P26: isLongTerm = conservative (أفق طويل) — للـ balanced و gambler نعرض كل التوقعات.
        const isLongTerm = persona === 'conservative' || persona === 'investor';
        // فلترة خفيفة حسب البرسونا:
        // - المستثمر: يهتم بالأسهم الشرائية (BUY/STRONG_BUY/ACCUMULATE/HOLD).
        // - المتوازن/المضارب: يشوف كل التوقعات بما فيها البيع (SELL/STRONG_SELL/REDUCE).
        const investorSignals = new Set(['BUY', 'STRONG_BUY', 'ACCUMULATE', 'HOLD']);
        const filtered = isLongTerm
          ? prev.filter((p: any) => investorSignals.has(String(p.signal || '').toUpperCase()))
          : prev;
        setPreviousPredictions(filtered);
      } catch (err) {
        // فشل صامت — الأرشيف مكمّل مش أساسي
        console.warn('[PersonaTab] previous predictions fetch failed', err);
      }
    };
    fetchPrevious();
    // 🔥 P14: polling بيتوقف لو liveMode مش مفعّل (افتراضي).
    const intervalId = setInterval(() => {
      if (!useAnalysisStore.getState().liveMode) return;
      fetchPrevious();
    }, 300_000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [marketCode, persona]);

  const fetchPersona = useCallback(async () => {
    setLoading(true);
    setError(null);
    setUsingFallback(false);
    setDataSource('stored');
    handleBack();
    try {
      const marketCode = MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market];

      // Check cache first
      const cache = useAnalysisStore.getState();
      if (cache.storedAnalysis && cache.market === marketCode && Date.now() - cache.lastFetched < 300000) {
        const nameMap = await buildNameMap(marketCode);
        // P16-PERSONA-DIVERGENCE: لو الـ cached items فيها fundamentals،
        // نستخدم pickPersonaDiverged (فلترة وترتيب مستقل لكل persona).
        // غير كده، fallback لـ pickPersonaMix (السلوك القديم).
        const hasFundamentals = (cache.storedAnalysis as any[]).some(
          (it) => it?.fundamentals && (it.fundamentals.is_gambler_opportunity !== undefined || it.fundamentals.is_investor_opportunity !== undefined)
        );
        // P42-NO-FREEZE: cap cached items to 20 before persona sort (bounds client work)
        const cachedCapped = (cache.storedAnalysis as any[]).slice(0, 20);
        const filtered = hasFundamentals
          ? pickPersonaDiverged(cachedCapped, persona, PERSONA_DISPLAY_LIMIT)
          : pickPersonaMix(cachedCapped, persona, PERSONA_DISPLAY_LIMIT);
        if (filtered.length > 0) {
          setItems(enrichItems(filtered, nameMap));
          setDataSource('stored');
          setLoading(false);
          return;
        }
      }

      // خريطة الأسماء (لإثراء النتائج بأسماء الأسهم الحقيقية)
      const nameMap = await buildNameMap(marketCode);

      // ═══════════════════════════════════════════════════════
      // PRIMARY: stored-analysis/results — المخزن الذي يُحدَّث كل 15 دقيقة
      // تلقائياً أثناء الجلسة (MarketScheduler.run_daily_closer → generate_predictions_internal)
      // المصدر الأساسي لكل التحليلات والتوقعات
      // ═══════════════════════════════════════════════════════
      try {
        // P16-PERSONA-DIVERGENCE: نمرّر persona param للـ backend عشان يفلتر
        // ويرتّب الأسهم بمنطق مختلف (مضارب: زخم/حجم، مستثمر: أساسيات/قيمة عادلة).
        // الـ backend بيرجّع قوائم مختلفة جذرياً لكل persona بدل ما يرجّع نفس
        // الأسهم بتغيير الـ verdict بس.
        // P42-NO-FREEZE: limit=20 (كان 400) — مفيش فايدة نعمل sort على 400 سهم
        // في المتصفح والمستثمر مش هيفتح 50. محرك التصطاد بيرجّع كام سهم بس.
        const storedRes = await fetch(`/api/stored-analysis/results?market=${marketCode}&limit=20&persona=${persona}`, {
          cache: 'no-store',
        });
        if (storedRes.ok) {
          const storedData = await storedRes.json();
          const all: StoredAnalysisItem[] = storedData.data || [];
          // لو الـ backend طبّق persona filter → الـ items أصلاً مرتبة صح.
          // لو لأ (fallback) → pickPersonaMix بيرتّب محلياً على 20 بس (خفيف).
          const filtered = storedData.meta?.personaFilterApplied
            ? all.slice(0, PERSONA_DISPLAY_LIMIT)
            : pickPersonaMix(all, persona, PERSONA_DISPLAY_LIMIT);
          // C2-SECTOR-HEAT: خد خريطة القطاعات من الـ meta (للـ banner).
          setSectorHeat(storedData.meta?.sectorHeat || null);
          // CL7-UI-SECTORS: خد ملخص القطاعات الكامل من الـ meta (للـ Section).
          setSectorSummary(storedData.meta?.sectorSummary || []);
          if (filtered.length > 0) {
            setItems(enrichItems(filtered, nameMap));
            setDataSource('stored');
            return; // نجح — لا حاجة لـ fallback
          }
        }
      } catch (storedErr) {
        console.warn('[PersonaTab] stored-analysis failed:', storedErr);
      }

      // ═══════════════════════════════════════════════════════
      // P42-NO-FREEZE: تم إزالة الـ fallback لـ /api/sniper/scan نهائياً.
      // كان بيشتغل MasterAnalyzer لحظياً على مجموعة أسهم وبيوقف المتصفح
      // ثواني/دقايق (الـ "تموت"/freeze). الشاشة دي دلوقتي بتعتمد على القراءة
      // فقط (stored-analysis + predictions). لو القاعدتين فاضيين → نعرض
      // "جاري تحليل الفرص، سيتم التحديث خلال دقائق" بدون أي API ثقيل.
      // ═══════════════════════════════════════════════════════

      // ═══════════════════════════════════════════════════════
      // FALLBACK: unified/predictions (قراءة من DB — مش حسابات لحظية)
      // ═══════════════════════════════════════════════════════
      try {
        const fbRes = await fetch(`/api/unified/predictions?market=${marketCode}&limit=50`, {
          cache: 'no-store',
        });
        if (fbRes.ok) {
          const fbData = await fbRes.json();
          const preds: any[] = Array.isArray(fbData.predictions) ? fbData.predictions : [];
          const mappedPreds = preds.map((p): StoredAnalysisItem | null => {
            const signal = String(p.signal || 'HOLD').toUpperCase();
            const confidence = Number(p.confidence || p.score || 0);
            const reasons: string[] = Array.isArray(p.reasons) ? p.reasons : [];
            // Only show BUY/STRONG_BUY - skip HOLD/SELL
            if (signal !== 'BUY' && signal !== 'STRONG_BUY') return null;
            // P26: isLongTerm = conservative (أفق طويل). balanced و gambler = أفق أقصر.
            const isLongTerm = persona === 'conservative' || persona === 'investor';
            let verdict = isLongTerm ? 'شراء قوي' : 'شراء';
            const personaReason = isLongTerm
              ? `توقع ${signal === 'BUY' ? 'صاعد' : signal === 'SELL' ? 'هابط' : 'متعادل'} — ثقة ${confidence.toFixed(0)}% — مدى متوسط/طويل`
              : `زخم ${signal === 'BUY' ? 'إيجابي' : signal === 'SELL' ? 'سلبي' : 'محايد'} — ثقة ${confidence.toFixed(0)}% — مدى قصير`;
            // P26: _personaKey معرّف على مستوى الـ component (مش محتاجين نعيد تعريفه هنا)
            const pd: PersonaData = {
              verdict,
              score: confidence,
              reason: reasons.length > 0 ? `${personaReason}. ${reasons.slice(0, 2).join(' — ')}` : personaReason,
              conditions: reasons.length > 0 ? reasons.slice(0, 5) : (Array.isArray(p.analysis_methods) ? p.analysis_methods.slice(0, 5) : []),
              entry: p.entry_price !== null && p.entry_price !== undefined ? Number(p.entry_price) : null,
              target: p.target_price !== null && p.target_price !== undefined ? Number(p.target_price) : null,
              stop: p.stop_loss !== null && p.stop_loss !== undefined ? Number(p.stop_loss) : null,
              signal: p.signal,
              timeframe: isLongTerm ? '6-12 شهر' : (persona === 'balanced' ? '2-6 أسابيع' : 'يومي-أسبوعي'),
              fair_value: null,
            };
            return {
              ticker: (p.symbol || p.ticker || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, ''),
              market: marketCode,
              name: p.name || p.stock_name || p.name_ar || p.symbol || p.ticker || '',
              nameAr: p.name_ar || p.name || p.stock_name || p.symbol || p.ticker || '',
              logoUrl: p.logo_url || null,
              maestroScore: Number(p.score) || 0,
              confidence,
              recommendation: p.signal,
              recommendationAr: p.signal_ar,
              entry: {
                price: p.entry_price !== null && p.entry_price !== undefined ? Number(p.entry_price) : undefined,
                target: p.target_price !== null && p.target_price !== undefined ? Number(p.target_price) : undefined,
                stopLoss: p.stop_loss !== null && p.stop_loss !== undefined ? Number(p.stop_loss) : undefined,
                riskReward: p.risk_reward !== null && p.risk_reward !== undefined ? Number(p.risk_reward) : undefined,
              },
              updatedAt: p.prediction_date || p.created_at || new Date().toISOString(),
              analysisJson: {
                // P26: استخدم _personaKey (investor للـ conservative، gambler للـ balanced/gambler)
                [_personaKey]: pd,
                narrative: {
                  line1: p.trend_direction ? `الاتجاه: ${p.trend_direction}` : undefined,
                  line2: p.sr_zone ? `منطقة الدعم/المقاومة: ${p.sr_zone}` : undefined,
                  line3: p.regime ? `نظام السوق: ${p.regime}` : undefined,
                },
              },
            } as StoredAnalysisItem;
          });
          const mappedFiltered = mappedPreds.filter((x: any): x is StoredAnalysisItem => x !== null);
          if (mappedFiltered.length > 0) {
            setItems(enrichItems(mappedFiltered.slice(0, PERSONA_DISPLAY_LIMIT), nameMap));
            setDataSource('predictions');
            setUsingFallback(true);
            return;
          }
        }
      } catch (fbErr) {
        console.error('[PersonaTab] fallback failed', fbErr);
      }

      // لا توجد بيانات من أي مصدر (DB فاضي) → عرض حالة "جاري التحليل"
      // بدون أي API ثقيل (P42-NO-FREEZE).
      setItems([]);
    } catch (err) {
      setError('فشل في الاتصال بالخادم');
      console.error('[PersonaTab]', err);
    } finally {
      setLoading(false);
    }
  }, [market, persona]);

  useEffect(() => {
    const marketCode = MARKET_CODES[market] === 'KSA' ? 'TADAWUL' : MARKET_CODES[market];
    const cache = useAnalysisStore.getState();
    if (cache.storedAnalysis && cache.market === marketCode && Date.now() - cache.lastFetched < 300000) {
      (async () => {
        const nameMap = await buildNameMap(marketCode);
        // P16-PERSONA-DIVERGENCE: استخدم pickPersonaDiverged لو fundamentals موجودة
        const hasFundamentals = (cache.storedAnalysis as any[]).some(
          (it) => it?.fundamentals && (it.fundamentals.is_gambler_opportunity !== undefined || it.fundamentals.is_investor_opportunity !== undefined)
        );
        // P42-NO-FREEZE: cap cached items to 20 before persona sort (bounds client work)
        const cachedCapped = (cache.storedAnalysis as any[]).slice(0, 20);
        const filtered = hasFundamentals
          ? pickPersonaDiverged(cachedCapped, persona, PERSONA_DISPLAY_LIMIT)
          : pickPersonaMix(cachedCapped, persona, PERSONA_DISPLAY_LIMIT);
        if (filtered.length > 0) {
          setItems(enrichItems(filtered, nameMap));
          setDataSource('stored');
          setLoading(false);
        }
      })();
    } else {
      fetchPersona();
    }

    // Auto-refresh recommendations every 5 minutes
    // 🔥 P14: polling بيتوقف لو liveMode مش مفعّل (افتراضي).
    const intervalId = setInterval(() => {
      if (!useAnalysisStore.getState().liveMode) return;
      fetchPersona();
    }, 300_000);

    function onAnalyticsRefreshed() {
      fetchPersona();
    }
    window.addEventListener('analyticsRefreshed', onAnalyticsRefreshed);
    return () => {
      clearInterval(intervalId);
      window.removeEventListener('analyticsRefreshed', onAnalyticsRefreshed);
    };
  }, [fetchPersona, market, persona]);

  // P26: isLongTerm = conservative (أفق طويل). balanced & gambler = أفق أقصر.
  const isLongTerm = persona === 'conservative' || persona === 'investor';
  // P42-NO-FREEZE: ترقيم الصفحات — نرسم 5 كروت بس في كل لحظة عشان المتصفح مايموتش
  const personaTotalPages = Math.max(1, Math.ceil(items.length / PERSONA_PAGE_SIZE));
  const personaPageItems = items.slice(personaPage * PERSONA_PAGE_SIZE, (personaPage + 1) * PERSONA_PAGE_SIZE);
  // P26: ألوان/عناوين 3 شخصيات — 🛡️ مستثمر / ⚖️ متوازن / 🎯 مضارب
  const headerTheme = isLongTerm
    ? { emoji: '🛡️', title: 'المستثمر', subtitle: 'فرص طويلة المدى — محرك التصطاد يختار الأسهم اللي تناسبك (6-12 شهر)', accent: 'text-emerald-700 dark:text-emerald-400' }
    : persona === 'balanced'
    ? { emoji: '⚖️', title: 'المتوازن', subtitle: 'فرص متوسطة المدى — توازن بين الزخم والقيمة (2-6 أسابيع)', accent: 'text-amber-700 dark:text-amber-400' }
    : { emoji: '🎯', title: 'المضارب', subtitle: 'فرص قصيرة المدى — محرك التصطاد يصطاد الزخم والسيولة والارتداد (يومي-أسبوعي)', accent: 'text-fuchsia-700 dark:text-fuchsia-400' };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-44 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive">
        <CardContent className="p-4 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 text-destructive" />
          <p className="text-destructive mb-2">{error}</p>
          <Button variant="outline" size="sm" onClick={fetchPersona}>
            <RefreshCw className="h-4 w-4 ml-2" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <span className="text-4xl mb-3 block">{headerTheme.emoji}</span>
          <p className="text-lg font-semibold mb-1">جاري تحليل الفرص — سيتم التحديث خلال دقائق</p>
          <p className="text-sm text-muted-foreground mb-4">
            {isLongTerm
              ? 'محرك المستثمر بيدوّر على فرص تناسب الشخصية طويلة المدى (6-12 شهر). البيانات بتتحدث كل 15 دقيقة تلقائياً — مفيش تحليل لحظي على الشاشة دي.'
              : persona === 'balanced'
              ? 'محرك المتوازن بيدوّر على فرص متوسطة المدى (2-6 أسابيع). البيانات بتتحدث كل 15 دقيقة تلقائياً — مفيش تحليل لحظي على الشاشة دي.'
              : 'محرك المضارب بيدوّر على فرص زخم قصيرة المدى (يومي-أسبوعي). البيانات بتتحدث كل 15 دقيقة تلقائياً — مفيش تحليل لحظي على الشاشة دي.'}
          </p>
          <div className="flex items-center justify-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={fetchPersona}>
              <RefreshCw className="h-4 w-4 ml-2" />
              تحديث الآن
            </Button>
            <a
              href="https://invist.m2y.net"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              invist.m2y.net
            </a>
          </div>
        </CardContent>
      </Card>
    );
  }

  const viewSelector = (
    <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
      <div className="inline-flex rounded-md border border-border p-0.5 bg-muted/40">
        {([['image', 'صورة'], ['cards', 'كروت'], ['table', 'جدول'], ['text', 'نص']] as const).map(([m, l]) => (
          <button
            key={m}
            onClick={() => setViewMode(m)}
            className={cn(
              'px-3 py-1 text-xs rounded font-medium transition-colors',
              viewMode === m ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {l}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <RefreshAnalyticsButton variant="glow" size="sm" onRefreshed={fetchPersona} />
        {items.length > 0 && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="gap-1" onClick={() => {
              const text = formatAllPersonaPicksText(items, persona, market);
              navigator.clipboard.writeText(text);
              toast.success('تم نسخ جميع التوقعات ✓');
            }}>
              <Copy className="h-3.5 w-3.5" />
              نسخ الكل
            </Button>
            <Button variant="outline" size="sm" className="gap-1" onClick={async () => {
              const text = formatAllPersonaPicksText(items, persona, market);
              if (navigator.share) {
                try { await navigator.share({ title: `توقعات ${headerTheme.title}`, text }); } catch {}
              } else {
                navigator.clipboard.writeText(text);
                toast.success('تم نسخ جميع التوقعات ✓');
              }
            }}>
              <Share2 className="h-3.5 w-3.5" />
              مشاركة
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {selectedItem ? (
        <StockDetailPanel
          item={selectedItem}
          persona={persona}
          market={market}
          subTab={subTab}
          onSubTabChange={setSubTab}
          onBack={handleBack}
          stockDetail={stockDetail}
        />
      ) : (
        <>
          {viewSelector}
          {/* ملاحظة وضع الـ fallback (predictions فقط — sniper اتشال في P42) */}
          {usingFallback && (
        <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-800">
          <CardContent className="p-2.5 flex items-center gap-2 text-xs">
            <Info className="h-4 w-4 text-amber-600 flex-shrink-0" />
            <p className="text-amber-800 dark:text-amber-300">
              {dataSource === 'predictions'
                ? `التحليل المخزن غير متوفر بعد، نعرض أحدث التوقعات (${items.length} سهم). سيتم تحديث التحليل المخزن تلقائياً.`
                : `التحليل المخزن غير متوفر لهذا السوق (${items.length} سهم).`
              }
            </p>
          </CardContent>
        </Card>
      )}

      {/* C2-SECTOR-HEAT: banner القطاعات السخنة (للمضارب فقط) — بيظهر لما في قطاع
          سخن (avg_chg≥1% AND ≥60% صاعد). ده الـ "sector rotation" اللي المفروض
          المضارب يركز عليه. المستثمر مش بيشوف الـ banner ده. */}
      {persona === 'gambler' && sectorHeat && sectorHeat.hot && sectorHeat.hot.length > 0 && (
        <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-800">
          <CardContent className="p-2.5 flex items-start gap-2 text-xs">
            <span className="text-base flex-shrink-0">🔥</span>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-orange-800 dark:text-orange-300 mb-1">
                قطاعات ساخنة — دوران قطاعي إيجابي
              </p>
              <div className="flex flex-wrap gap-1.5">
                {sectorHeat.hot.slice(0, 4).map((s) => (
                  <span
                    key={s.sector}
                    className="px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700 border border-orange-200 dark:bg-orange-900/40 dark:text-orange-400 dark:border-orange-700 whitespace-nowrap"
                    title={`avg change ${s.avg_chg.toFixed(2)}% — ${Math.round(s.rising_ratio * 100)}% صاعد — ${s.n} سهم — boost +${Math.round(s.boost * 100)}%`}
                  >
                    {s.sector} <span className="opacity-70">+{s.avg_chg.toFixed(1)}%</span>
                  </span>
                ))}
              </div>
              <p className="text-[10px] text-orange-600 dark:text-orange-400 mt-1 opacity-80">
                أسهم هذه القطاعات حصلت على +{Math.round((sectorHeat.hot[0]?.boost || 0.15) * 100)}% boost في ترتيب المضارب
              </p>
            </div>
          </CardContent>
        </Card>
      )}



      {/* بطاقة البرسونا القابلة للمشاركة (تحميل صورة / نشر تيليجرام) */}
      {viewMode === 'image' && (
      <ImageCardExport
        title={`بطاقة ${headerTheme.title}`}
        description="حمّل صورة جاهزة للنشر أو انشرها مباشرة على قناة تيليجرام"
        filename={`${persona}-picks-${MARKET_CODES[market]}`}
        telegramCaption={`📊 ${headerTheme.emoji} ${headerTheme.title} — ${MARKET_NAMES_AR[market]}\n${headerTheme.subtitle}\n\nمنصة دليل الاستثمار | invist.m2y.net`}
        telegramMarket={MARKET_CODES[market]}
        // P26: 3 persona themes — emerald للمحافظ، amber للمتوازن، fuchsia للمغامر
        accentColor={isLongTerm ? '#15803d' : (persona === 'balanced' ? '#d97706' : '#a21caf')}
        borderClass={isLongTerm ? 'border-emerald-200' : (persona === 'balanced' ? 'border-amber-200' : 'border-fuchsia-200')}
        bgClass={
          isLongTerm
            ? 'bg-gradient-to-br from-emerald-50 via-teal-50/40 to-emerald-100/40'
            : persona === 'balanced'
            ? 'bg-gradient-to-br from-amber-50 via-yellow-50/40 to-amber-100/40'
            : 'bg-gradient-to-br from-fuchsia-50 via-pink-50/40 to-fuchsia-100/40'
        }
        hasData={items.length > 0}
        emptyHint={
          isLongTerm
            ? 'محرك التصطاد لسه بيدور على فرص تناسب المستثمر.'
            : persona === 'balanced'
            ? 'محرك التصطاد لسه بيدور على فرص تناسب المتوازن.'
            : 'محرك التصطاد لسه بيدور على فرص تناسب المضارب.'
        }
      >
        {(ref) => {
          const picks: PersonaPick[] = items.map((it) => {
            // P26: استخدم _personaKey + fallback للحقول العلوية للسهم
            const pd: PersonaData = it.analysisJson?.[_personaKey] || {
              verdict: it.recommendationAr || '',
              score: it.maestroScore || 0,
              reason: '',
              signal: it.recommendation || 'HOLD',
              entry: it.entry?.price ?? null,
              target: it.entry?.target ?? null,
              stop: it.entry?.stopLoss ?? null,
              timeframe: persona === 'balanced' ? '2-6 أسابيع' : (persona === 'conservative' ? '6-12 شهر' : '1-5 أيام'),
            };
            return {
              ticker: it.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, ''),
              name_ar: it.nameAr || it.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, ''),
              verdict: pd.verdict,
              score: pd.score,
              reason: pd.reason,
              conditions: pd.conditions,
              entry: pd.entry,
              target: pd.target,
              stop: pd.stop,
              timeframe: pd.timeframe,
              fair_value: pd.fair_value,
            };
          });
          return (
            <PersonaImageCard
              ref={ref}
              market={market}
              // P26: PersonaImageCard بيقبل 'investor'|'gambler' بس — مرّرله المفتاح المظبوط
              persona={_personaKey}
              picks={picks}
              lastUpdate={items[0]?.updatedAt ? new Date(items[0].updatedAt).toLocaleTimeString('ar-EG') : undefined}
            />
          );
        }}
      </ImageCardExport>
      )}

      {/* رأس التاب */}
      <Card className={cn('border-l-4', isLongTerm ? 'border-l-emerald-500' : (persona === 'balanced' ? 'border-l-amber-500' : 'border-l-fuchsia-500'))}>
        <CardContent className="p-3 flex items-center gap-3">
          <span className="text-3xl">{headerTheme.emoji}</span>
          <div>
            <h3 className={cn('text-lg font-bold', headerTheme.accent)}>{headerTheme.title}</h3>
            <p className="text-xs text-muted-foreground">{headerTheme.subtitle}</p>
          </div>
          <Badge variant="secondary" className="mr-auto">{items.length} سهم</Badge>
        </CardContent>
      </Card>

      {/* ═══ P21-PERSONA-CONSTRAINTS (Aug 2026): HOLD Banner for Conservative ═══
          لما تبقى إشارات كلها HOLD في تبويب المستثمر، اعرض رسالة واضحة فوق الكروت
          عشان العميل يفهم إن دي حماية لرأس المال، مش "منصة ميتة".
          المضارب لازم يبدأ يعرض توصيات الشراء اللحظية (بعد تعديل الباك-إند). */}
      {isLongTerm && (() => {
        const holdItems = items.filter((it) => {
          // P26: استخدم _personaKey (investor للـ conservative) بدل ما نظبظبط 'investor'
          const pd = it.analysisJson?.[_personaKey] || {};
          const sig = String(pd.signal || pd.verdict || '').toUpperCase();
          return sig.includes('HOLD') || sig.includes('انتظر') || sig.includes('ابعد');
        });
        const holdRatio = items.length > 0 ? holdItems.length / items.length : 0;
        if (holdRatio >= 0.6) {
          return (
            <Card className="border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 dark:border-emerald-800">
              <CardContent className="p-3 flex items-start gap-2.5">
                <span className="text-xl flex-shrink-0 mt-0.5">🛡️</span>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-emerald-900 dark:text-emerald-200 mb-0.5">
                    وضع السوق الحالي لا يناسب الاستثمار طويل المدى
                  </p>
                  <p className="text-xs text-emerald-800 dark:text-emerald-300">
                    التوصيات الحالية للانتظار والحفاظ على رأس المال ({holdItems.length} من {items.length} سهم).
                    لو عايز فرص شراء يومية/أسبوعية، حوّل لتبويب المضارب 🎯 — السهم اللي مش فرصة استثمار ممكن يكون فرصة مضاربة.
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        }
        return null;
      })()}

      {/* ═══ P21: تبديل سريع للبرسونا (Quick Persona Switch) ═══
          زر واضح وجوهري عشان العميل يغير بين (محافظ/متوازن/مغامر) بسهولة جوه التبويب.
          التبديل بيتعمل عبر إرسال حدث 'switchPersona' للـ parent component. */}
      {items.length > 0 && (
        <Card className="border-dashed bg-muted/30">
          <CardContent className="p-2.5 flex items-center justify-between flex-wrap gap-2">
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="text-sm">👤</span>
              الشخصية الحالية:
            </span>
            <div className="inline-flex rounded-md border border-border p-0.5 bg-background">
              <button
                onClick={() => {
                  // P26: قيمة التبويب بقى 'conservative' (مش 'investor')
                  const event = new CustomEvent('switchPersona', { detail: 'conservative' });
                  window.dispatchEvent(event);
                  const conservativeTab = document.querySelector('[data-state="inactive"][value="conservative"]') as HTMLButtonElement | null;
                  conservativeTab?.click();
                }}
                className={cn(
                  'px-3 py-1 text-xs rounded font-medium transition-colors flex items-center gap-1',
                  isLongTerm ? 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                🛡️ محافظ
              </button>
              <button
                onClick={() => {
                  const balancedTab = document.querySelector('[data-state="inactive"][value="balanced"]') as HTMLButtonElement | null;
                  balancedTab?.click();
                }}
                className={cn(
                  'px-3 py-1 text-xs rounded font-medium transition-colors flex items-center gap-1',
                  persona === 'balanced' ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                ⚖️ متوازن
              </button>
              <button
                onClick={() => {
                  const gamblerTab = document.querySelector('[data-state="inactive"][value="gambler"]') as HTMLButtonElement | null;
                  gamblerTab?.click();
                }}
                className={cn(
                  'px-3 py-1 text-xs rounded font-medium transition-colors flex items-center gap-1',
                  persona === 'gambler' ? 'bg-fuchsia-100 dark:bg-fuchsia-950/50 text-fuchsia-700 dark:text-fuchsia-300 shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                🎯 مغامر
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* قائمة الكروت */}
      {viewMode === 'cards' && (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {personaPageItems.map((it) => {
          // P26: استخدم _personaKey + fallback للحقول العلوية للسهم
          const personaData: PersonaData = it.analysisJson?.[_personaKey] || {
            verdict: it.recommendationAr || '',
            score: it.maestroScore || 0,
            reason: '',
            signal: it.recommendation || 'HOLD',
            entry: it.entry?.price ?? null,
            target: it.entry?.target ?? null,
            stop: it.entry?.stopLoss ?? null,
            timeframe: persona === 'balanced' ? '2-6 أسابيع' : (persona === 'conservative' ? '6-12 شهر' : '1-5 أيام'),
          };
          return (
            <PersonaCard
              key={`${it.ticker}-${persona}`}
              ticker={it.ticker}
              persona={persona}
              data={personaData}
              maestroScore={it.maestroScore}
              updatedAt={it.updatedAt}
              narrative={it.analysisJson?.narrative}
              market={market}
              nameAr={it.nameAr}
              logoUrl={it.logoUrl}
              fundamentals={it.fundamentals}
              onClick={() => handleSelectItem(it)}
            />
          );
        })}
      </div>
      )}

      {/* عرض الجدول */}
      {viewMode === 'table' && (
         <PersonaTableView items={personaPageItems} persona={persona} market={market} onSelectItem={handleSelectItem} />
      )}

      {/* عرض النص المنسق للمشاركة */}
      {viewMode === 'text' && (
        <div className="space-y-3">
          {personaPageItems.map((it, idx) => {
            // P26: استخدم _personaKey + fallback للحقول العلوية للسهم
            const pd: PersonaData = it.analysisJson?.[_personaKey] || {
              verdict: it.recommendationAr || '',
              score: it.maestroScore || 0,
              reason: '',
              signal: it.recommendation || 'HOLD',
              entry: it.entry?.price ?? null,
              target: it.entry?.target ?? null,
              stop: it.entry?.stopLoss ?? null,
              timeframe: persona === 'balanced' ? '2-6 أسابيع' : (persona === 'conservative' ? '6-12 شهر' : '1-5 أيام'),
            };
            const ticker = it.ticker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '');
            const singleText = formatSinglePersonaPickText(it, persona, market);
            return (
              <Card key={`txt-${ticker}`} className="border border-border cursor-pointer" onClick={() => handleSelectItem(it)}>
                <CardContent className="p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-bold">{ticker} - {it.nameAr || it.name}</span>
                    <div className="flex gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-7 text-xs"
                        onClick={() => {
                          navigator.clipboard.writeText(singleText);
                          toast.success('تم نسخ التحليل ✓');
                        }}
                      >
                        <Copy className="h-3.5 w-3.5" />
                        نسخ
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-7 text-xs"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (navigator.share) {
                            try { await navigator.share({ title: `تحليل ${ticker}`, text: singleText }); } catch {}
                          } else {
                            navigator.clipboard.writeText(singleText);
                            toast.success('تم نسخ التحليل ✓');
                          }
                        }}
                      >
                        <Share2 className="h-3.5 w-3.5" />
                        مشاركة
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 h-7 text-xs border-blue-400 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/20"
                        onClick={() => {
                          navigator.clipboard.writeText(singleText);
                          window.open('https://www.facebook.com/', '_blank');
                          toast.success('تم نسخ التحليل وجاري فتح فيسبوك لصق المنشور 💙');
                        }}
                      >
                        <Facebook className="h-3.5 w-3.5" />
                        فيسبوك
                      </Button>
                    </div>
                  </div>
                  <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed text-foreground/90" dir="rtl">
                    {singleText}
                  </pre>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* P42-NO-FREEZE: ترقيم الصفحات — 5 كروت لكل صفحة عشان المتصفح مايموتش */}
      {personaTotalPages > 1 && (
        <div className="flex items-center justify-center gap-2 py-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={personaPage === 0}
            onClick={() => setPersonaPage((p) => Math.max(0, p - 1))}
          >
            <ArrowRight className="h-4 w-4" />
            السابق
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums px-2">
            {personaPage + 1} / {personaTotalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            disabled={personaPage >= personaTotalPages - 1}
            onClick={() => setPersonaPage((p) => Math.min(personaTotalPages - 1, p + 1))}
          >
            التالي
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* مخطط خطوات التحليل — engineering logic diagram (إعلاني هندسي) */}
      <AnalysisFlowDiagram persona={persona} className="mt-4" />

      {/* P6-PREDICTIONS: أرشيف التوقعات السابقة — اتنقل هنا من التبويب العام */}
      <PreviousPredictionsArchive
        predictions={previousPredictions}
        title="التوقعات السابقة"
      />
        </>
      )}

      {/* ════════════════════════════════════════════════════════════════════
          🪟 نافذة التحليل الشامل (Unified Analysis Modal)
          بدل ما المستهم يتنقل لصفحة جديدة، نفتح Dialog ضخمة فوق الشاشة
          فيها كل مكونات التحليل: الشارت التفاعلي + بصمة السهم (Stock DNA)
          + تحليل الحيتان (SMC) + توقع الشمعة (Candle Probability) + خطة التداول.
          نعيد استخدام SingleStockAnalysisView الموجود بالفعل وتمرير ticker فقط.
          ════════════════════════════════════════════════════════════════════ */}
      <Dialog
        open={!!selectedTicker}
        onOpenChange={(open) => { if (!open) setSelectedTicker(null); }}
      >
        <DialogContent
          className="max-w-[95vw] sm:max-w-[95vw] w-full h-[90vh] p-0 gap-0 flex flex-col overflow-hidden rounded-lg"
          showCloseButton={false}
        >
          {/* ─── Sticky Header — يظل ثابتاً أثناء التمرير للأسفل ─── */}
          <div className="flex items-center justify-between gap-2 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 px-4 py-2.5 flex-shrink-0 z-10">
            <div className="flex items-center gap-2 min-w-0">
              <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 text-primary flex-shrink-0">
                <BarChart3 className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-sm md:text-base font-bold truncate">
                  نافذة التحليل الشامل
                </DialogTitle>
                {selectedTicker && (
                  <p className="text-[11px] md:text-xs text-muted-foreground truncate">
                    {selectedTicker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '')} — الشارت • بصمة السهم • SMC • خطة التداول
                  </p>
                )}
              </div>
            </div>
            <DialogClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="flex-shrink-0 h-9 w-9 rounded-full hover:bg-muted"
                aria-label="إغلاق نافذة التحليل"
              >
                <X className="h-5 w-5" />
              </Button>
            </DialogClose>
          </div>

          {/* ─── Scrollable Body — SingleStockAnalysisView يحتوي على كل المكونات ─── */}
          <div className="flex-1 overflow-y-auto p-3 md:p-4 bg-muted/10">
            {selectedTicker && (
              <SingleStockAnalysisViewDynamic
                key={selectedTicker}
                initialTicker={selectedTicker.replace(/\.(CA|SR|KW|AE|BH|QA)$/, '')}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Crypto Predictions Tab (BTC + ETH from CryptoLabScheduler)
// ============================================================================

interface CryptoPrediction {
  id: number;
  symbol: string;
  signal: string;
  confidence: number;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  analysis: Record<string, unknown> | null;
  created_at: string;
}

interface CryptoPredictionsResponse {
  success: boolean;
  predictions: CryptoPrediction[];
  last_updated: string | null;
  error?: string;
  note?: string;
}

const usdCurrencyFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const arDateTimeFmt = new Intl.DateTimeFormat('ar-EG', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function cryptoSignalStyle(signal: string): {
  badge: string;
  text: string;
  bg: string;
} {
  const s = (signal || '').toUpperCase();
  if (s === 'BUY' || s === 'STRONG_BUY' || s === 'LONG') {
    return {
      badge: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
      text: 'text-emerald-600',
      bg: 'bg-emerald-500/5',
    };
  }
  if (s === 'SELL' || s === 'STRONG_SELL' || s === 'SHORT') {
    return {
      badge: 'bg-rose-500/15 text-rose-600 border-rose-500/30',
      text: 'text-rose-600',
      bg: 'bg-rose-500/5',
    };
  }
  return {
    badge: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
    text: 'text-amber-600',
    bg: 'bg-amber-500/5',
  };
}

function cryptoSignalLabelAr(signal: string): string {
  const s = (signal || '').toUpperCase();
  if (s === 'BUY' || s === 'STRONG_BUY') return 'شراء';
  if (s === 'SELL' || s === 'STRONG_SELL') return 'بيع';
  if (s === 'LONG') return 'صفقة شراء';
  if (s === 'SHORT') return 'صفقة بيع';
  if (s === 'WAIT') return 'انتظار';
  return 'تجمّد';
}

function cryptoSymbolMeta(symbol: string): { icon: string; name: string } {
  const s = (symbol || '').toUpperCase();
  if (s === 'BTC') return { icon: '₿', name: 'Bitcoin' };
  if (s === 'ETH') return { icon: 'Ξ', name: 'Ethereum' };
  return { icon: '●', name: symbol };
}

function CryptoIndicatorRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number | null | undefined;
  hint?: string;
}) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-semibold tabular-nums" title={hint}>{value}</span>
    </div>
  );
}

function CryptoPredictionCard({ p }: { p: CryptoPrediction }) {
  const meta = cryptoSymbolMeta(p.symbol);
  const style = cryptoSignalStyle(p.signal);
  const analysis = p.analysis || {};
  const indicators =
    (analysis['indicators'] as Record<string, unknown> | undefined) || undefined;
  const rsi = indicators ? (indicators['rsi'] as number | undefined) : undefined;
  const macdHist = indicators
    ? (indicators['macd_hist'] as number | undefined)
    : undefined;
  const macdLine = indicators
    ? (indicators['macd_line'] as number | undefined)
    : undefined;
  const macdSignal = indicators
    ? (indicators['macd_signal'] as number | undefined)
    : undefined;
  const atrPct = indicators
    ? (indicators['atr_pct'] as number | undefined)
    : undefined;
  const trendUp = analysis['trend_up'] as boolean | undefined;
  const change24h = analysis['change_24h_pct'] as number | undefined;
  const fusion = analysis['fusion'] as
    | { signal?: string; signal_ar?: string; score?: number }
    | undefined;
  const finalSignalAr = analysis['final_signal_ar'] as string | undefined;
  const candlesAnalyzed = analysis['candles_analyzed'] as number | undefined;

  const rsiNum = typeof rsi === 'number' ? rsi : undefined;
  const rsiColor =
    rsiNum === undefined
      ? 'text-muted-foreground'
      : rsiNum >= 70
        ? 'text-rose-600'
        : rsiNum <= 30
          ? 'text-emerald-600'
          : 'text-foreground';

  return (
    <Card className={cn('overflow-hidden border-border/60', style.bg)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-background border border-border text-2xl font-bold leading-none shadow-sm">
              {meta.icon}
            </div>
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                {p.symbol}
                {p.symbol === 'BTC' ? (
                  <Bitcoin className="h-4 w-4 text-amber-500" />
                ) : p.symbol === 'ETH' ? (
                  <Zap className="h-4 w-4 text-violet-500" />
                ) : null}
              </CardTitle>
              <p className="text-xs text-muted-foreground">{meta.name}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant="outline" className={cn('px-2.5 py-1 text-xs font-bold', style.badge)}>
              {cryptoSignalLabelAr(p.signal)} · {p.signal}
            </Badge>
            <span className="text-xs text-muted-foreground tabular-nums">
              ثقة {p.confidence.toFixed(1)}%
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Prices grid */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg border border-border/60 bg-background/60 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">الدخول</p>
            <p className="text-sm font-semibold tabular-nums">
              {usdCurrencyFmt.format(p.entry_price)}
            </p>
          </div>
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">الهدف</p>
            <p className="text-sm font-semibold tabular-nums text-emerald-600">
              {usdCurrencyFmt.format(p.target_price)}
            </p>
          </div>
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 p-2.5">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">الإيقاف</p>
            <p className="text-sm font-semibold tabular-nums text-rose-600">
              {usdCurrencyFmt.format(p.stop_loss)}
            </p>
          </div>
        </div>

        {/* Risk/Reward quick stats */}
        {p.entry_price > 0 && p.target_price > 0 && p.stop_loss > 0 && (
          <div className="flex items-center justify-between rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
            <span className="text-muted-foreground">المخاطرة/العائد</span>
            <span className="font-semibold tabular-nums">
              1 :
              {(
                Math.abs(p.target_price - p.entry_price) /
                Math.max(Math.abs(p.entry_price - p.stop_loss), 1e-9)
              ).toFixed(2)}
            </span>
          </div>
        )}

        {/* Indicators */}
        {indicators && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">
              المؤشرات الفنية
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5">
                <span className="text-xs text-muted-foreground">RSI</span>
                <span className={cn('text-xs font-semibold tabular-nums', rsiColor)}>
                  {rsiNum !== undefined ? rsiNum.toFixed(2) : '—'}
                </span>
              </div>
              <CryptoIndicatorRow
                label="MACD Hist"
                value={
                  typeof macdHist === 'number' ? macdHist.toFixed(4) : '—'
                }
                hint="MACD Histogram"
              />
              <CryptoIndicatorRow
                label="ATR %"
                value={
                  typeof atrPct === 'number' ? `${atrPct.toFixed(2)}%` : '—'
                }
                hint="Average True Range %"
              />
              <CryptoIndicatorRow
                label="تغيّر 24h"
                value={
                  typeof change24h === 'number'
                    ? `${change24h >= 0 ? '+' : ''}${change24h.toFixed(2)}%`
                    : '—'
                }
              />
              <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5">
                <span className="text-xs text-muted-foreground">الاتجاه</span>
                <span
                  className={cn(
                    'text-xs font-semibold',
                    trendUp === true
                      ? 'text-emerald-600'
                      : trendUp === false
                        ? 'text-rose-600'
                        : 'text-muted-foreground'
                  )}
                >
                  {trendUp === true
                    ? 'صاعد ↑'
                    : trendUp === false
                      ? 'هابط ↓'
                      : '—'}
                </span>
              </div>
            </div>
            {typeof macdLine === 'number' && typeof macdSignal === 'number' && (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5">
                <span className="text-xs text-muted-foreground">
                  MACD Line / Signal
                </span>
                <span className="text-xs font-semibold tabular-nums">
                  {macdLine.toFixed(2)} / {macdSignal.toFixed(2)}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Fusion / final signal */}
        {(fusion || finalSignalAr) && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs">
            {finalSignalAr && (
              <span className="font-semibold">{finalSignalAr}</span>
            )}
            {fusion?.signal_ar && (
              <Badge variant="secondary" className="px-2 py-0.5 text-[10px]">
                دمج: {fusion.signal_ar}
              </Badge>
            )}
            {typeof fusion?.score === 'number' && (
              <span className="text-muted-foreground tabular-nums">
                نقطة الدمج: {fusion.score}
              </span>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {arDateTimeFmt.format(new Date(p.created_at))}
          </span>
          {typeof candlesAnalyzed === 'number' && (
            <span className="tabular-nums">{candlesAnalyzed} شمعة</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function CryptoPredictionsTab() {
  const [data, setData] = useState<CryptoPredictionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastFetchAt, setLastFetchAt] = useState<Date | null>(null);

  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (silent) setError(null);
    try {
      const res = await fetch('/api/crypto-lab/predictions', {
        cache: 'no-store',
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as CryptoPredictionsResponse;
      if (!json.success) {
        throw new Error(json.error || 'فشل في تحميل التوقعات');
      }
      setData(json);
      setError(null);
      setLastFetchAt(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setError(msg);
      if (!silent) {
        console.error('[CryptoPredictionsTab] fetch failed:', err);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // 🔥 P14: polling بيتوقف لو liveMode مش مفعّل (افتراضي). الكريبتو 24/7 بس
    // مانريدش نحمّل الـ backend كل دقيقة لو المستخدم مش متابع نشط.
    const interval = setInterval(() => {
      if (!useAnalysisStore.getState().liveMode) return;
      fetchData(true);
    }, 60_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // ---- Loading state ----
  if (loading && !data) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" />
          جارٍ تحميل توقعات الكريبتو...
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-72 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    );
  }

  // ---- Error state ----
  if (error && !data) {
    return (
      <Card className="border-rose-500/30 bg-rose-500/5">
        <CardContent className="flex flex-col items-center gap-3 p-6 text-center">
          <AlertTriangle className="h-8 w-8 text-rose-500" />
          <p className="text-sm font-semibold text-rose-600">
            تعذّر تحميل توقعات الكريبتو
          </p>
          <p className="text-xs text-muted-foreground break-all">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData()}
            className="mt-1"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            إعادة المحاولة
          </Button>
        </CardContent>
      </Card>
    );
  }

  const predictions = data?.predictions ?? [];

  // ---- Empty state ----
  if (predictions.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
          <Bitcoin className="h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm font-medium">
            لا توجد توقعات كريبتو بعد. المختبر يعمل كل 15 دقيقة وستظهر التوقعات
            قريباً.
          </p>
          {data?.note && (
            <p className="text-xs text-muted-foreground">{data.note}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData()}
            className="mt-1"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            تحديث
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ---- Success state ----
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Bitcoin className="h-4 w-4 text-amber-500" />
          <span>
            توقعات لحظية لـ BTC و ETH — يُحدّث المختبر كل 15 دقيقة، وتُحدّث
            الصفحة كل دقيقة.
          </span>
        </div>
        <div className="flex items-center gap-2">
          {lastFetchAt && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              آخر تحديث للصفحة:{' '}
              {new Intl.DateTimeFormat('ar-EG', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              }).format(lastFetchAt)}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData()}
            disabled={loading}
          >
            <RefreshCw
              className={cn('h-3.5 w-3.5', loading && 'animate-spin')}
            />
            تحديث
          </Button>
        </div>
      </div>

      {data?.last_updated && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          آخر توقعة من المختبر:{' '}
          <span className="font-semibold tabular-nums">
            {arDateTimeFmt.format(new Date(data.last_updated))}
          </span>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {predictions.map((p) => (
          <CryptoPredictionCard key={p.id} p={p} />
        ))}
      </div>

      {error && (
        <p className="text-xs text-amber-600">
          تحذير: آخر تحديث صامت فشل ({error}). يتم عرض آخر بيانات ناجحة.
        </p>
      )}
    </div>
  );
}

// ============================================================================
// P17 Morning Bell — جرس الصباح (أعلى 3 فرص EGX)
// ============================================================================

interface MorningBellStock {
  ticker: string;
  name_ar: string;
  signal: string;
  signal_ar: string;
  entry: number;
  target: number;
  stop: number;
  risk_reward: number;
  score: number;
  ath_breakout: boolean;
  delay_compensation_applied: boolean;
  updated_at?: string;
  // P41 Live Morning Bell fields (optional — present when live=1)
  price?: number;
  rvol?: number;
  extension_pct_day?: number;
  volume?: number;
  continuation_state?: 'continuing' | 'weakening' | 'exhausted';
  prob_continue_up?: number;
  prob_mild_pullback?: number;
  prob_sharp_drop?: number;
  suggested_tp1?: number;
  suggested_tp2?: number;
  suggested_stop?: number;
  risk_flag?: 'elevated' | 'extreme_north';
  client_responsibility_required?: boolean;
  composite_score?: number;
  confidence?: number;
  momentum_alive?: boolean;
  trajectory?: string;
  plain_ar_warning?: string;
  reason_ar?: string;
}

function HorizontalSectorsBar({ marketCode }: { marketCode: string }) {
  const [sectors, setSectors] = useState<any[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/stored-analysis/results?market=${marketCode}&limit=10`, { cache: 'no-store' });
        if (res.ok) {
          const json = await res.json();
          if (!cancelled && json.meta?.sectorSummary) {
            setSectors(json.meta.sectorSummary);
          }
        }
      } catch (e) {
        console.warn('[HorizontalSectorsBar] fetch failed', e);
      }
    })();
    return () => { cancelled = true; };
  }, [marketCode]);

  if (sectors.length === 0) return null;

  return (
    <div className="flex items-center gap-2 p-2 rounded-xl bg-card/80 border border-border/80 overflow-x-auto no-scrollbar shadow-sm my-1.5">
      <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 font-bold text-xs flex-shrink-0 border border-teal-500/20">
        <Layers className="w-4 h-4 text-teal-500" />
        <span>ذكاء القطاعات</span>
        <Badge variant="secondary" className="text-[10px] px-1 py-0">{sectors.length}</Badge>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
        {sectors.map((s: any) => (
          <div
            key={s.sector}
            className={cn(
              'px-2.5 py-1 rounded-lg border text-xs font-medium flex items-center gap-1.5 flex-shrink-0 transition-all hover:scale-105',
              s.status === 'hot'
                ? 'border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-300'
                : s.status === 'dead'
                ? 'border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300'
                : 'border-border bg-muted/40 text-foreground'
            )}
          >
            <span>{s.status === 'hot' ? '🔥' : s.status === 'dead' ? '❄️' : '📊'}</span>
            <span className="font-bold">{s.sector}</span>
            <span className={cn('font-mono text-[11px]', s.avg_chg > 0 ? 'text-emerald-500 font-bold' : s.avg_chg < 0 ? 'text-rose-500 font-bold' : 'text-muted-foreground')}>
              {s.avg_chg > 0 ? '+' : ''}{s.avg_chg.toFixed(1)}%
            </span>
            {s.top_leader && (
              <span className="text-[10px] px-1 rounded bg-emerald-500/20 text-emerald-400 font-bold">
                👑 {s.top_leader}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function MorningBellSection({ marketCode }: { marketCode: string }) {
  const [stocks, setStocks] = useState<MorningBellStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState('');
  const [marketStatus, setMarketStatus] = useState<'live' | 'closed'>('closed');
  const [isLive, setIsLive] = useState(false);
  const [refreshMin, setRefreshMin] = useState(15);
  const [cacheAge, setCacheAge] = useState<number | null>(null);
  const [vetoed, setVetoed] = useState(false);
  const [noteAr, setNoteAr] = useState('');

  useEffect(() => {
    // الجرس ده EGX-only — باقي الأسواق مش ليها جلسة صباحية مصرية
    if (marketCode !== 'EGX') {
      setStocks([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        // P41: جرّب الـ Live Morning Bell أولاً (RVOL + continuation)
        const liveRes = await fetch(`/api/market/morning-bell?live=1&limit=5`, { cache: 'no-store' });
        if (liveRes.ok) {
          const json = await liveRes.json();
          if (cancelled) return;
          if (json.success !== false && Array.isArray(json.stocks) && json.stocks.length > 0) {
            // خريطة الـ live picks للـ interface
            const mapped: MorningBellStock[] = json.stocks.map((s: any) => ({
              ticker: String(s.ticker || ''),
              name_ar: s.name_ar || s.ticker,
              signal: s.signal || 'morning_bell_buy',
              signal_ar: s.signal_ar || '🔔 شراء جرس الصباح',
              entry: Number(s.price ?? s.entry ?? 0),
              target: Number(s.suggested_tp1 ?? s.target ?? 0),
              stop: Number(s.suggested_stop ?? s.stop ?? 0),
              risk_reward: 0,
              score: Number(s.composite_score ?? s.confidence ?? 85),
              ath_breakout: false,
              delay_compensation_applied: false,
              updated_at: s.updated_at,
              price: Number(s.price ?? 0),
              rvol: Number(s.rvol ?? 0),
              extension_pct_day: Number(s.extension_pct_day ?? 0),
              volume: Number(s.volume ?? 0),
              continuation_state: s.continuation_state,
              prob_continue_up: Number(s.prob_continue_up ?? 0),
              prob_mild_pullback: Number(s.prob_mild_pullback ?? 0),
              prob_sharp_drop: Number(s.prob_sharp_drop ?? 0),
              suggested_tp1: Number(s.suggested_tp1 ?? 0),
              suggested_tp2: Number(s.suggested_tp2 ?? 0),
              suggested_stop: Number(s.suggested_stop ?? 0),
              risk_flag: s.risk_flag,
              client_responsibility_required: Boolean(s.client_responsibility_required),
              composite_score: Number(s.composite_score ?? 0),
              confidence: Number(s.confidence ?? 0),
              momentum_alive: Boolean(s.momentum_alive),
              trajectory: s.trajectory,
              plain_ar_warning: s.plain_ar_warning,
              reason_ar: s.reason_ar,
            }));
            setStocks(mapped);
            setLabel(json.label_ar || `🔔 جرس الصباح (${mapped.length})`);
            setMarketStatus(json.market_status === 'live' ? 'live' : 'closed');
            setIsLive(true);
            setRefreshMin(Number(json.refresh_interval_minutes ?? 15));
            setCacheAge(Number(json.cache_age_seconds ?? 0) || null);
            setVetoed(Boolean(json.market_vetoed));
            setNoteAr(json.note_ar || json.veto_reason || '');
            setLoading(false);
            return;
          }
          // لو الـ live مفيهوش picks (سوق مقفول/فيتو) — اعرض الحالة
          if (json.market_status === 'closed' || json.market_vetoed) {
            setStocks([]);
            setLabel(json.label_ar || '🔔 جرس الصباح');
            setMarketStatus(json.market_status === 'live' ? 'live' : 'closed');
            setIsLive(false);
            setVetoed(Boolean(json.market_vetoed));
            setNoteAr(json.note_ar || json.veto_reason || '');
            setLoading(false);
            return;
          }
        }

        // Fallback للـ static (stored-analysis) لو الـ live فشل
        let rawItems: any[] = [];
        const res = await fetch(`/api/stored-analysis/results?market=EGX&limit=15`, { cache: 'no-store' });
        if (res.ok) {
          const json2 = await res.json();
          if (json2.success !== false && Array.isArray(json2.data)) rawItems = json2.data;
        }
        if (rawItems.length < 3) {
          try {
            const ltRes = await fetch(`/api/stored-analysis/live-tracking?market=EGX&days=30&limit=20`, { cache: 'no-store' });
            if (ltRes.ok) {
              const ltJson = await ltRes.json();
              if (ltJson?.predictions) {
                Object.values(ltJson.predictions).forEach((arr: any) => {
                  if (Array.isArray(arr)) rawItems.push(...arr);
                });
              }
            }
          } catch {}
        }
        if (cancelled) return;
        const seen = new Set<string>();
        const mapped: MorningBellStock[] = [];
        for (const item of rawItems) {
          const rawTicker = String(item.ticker || '').replace(/\.(CA|SR|KW|AE|BH|QA)$/, '').toUpperCase();
          if (!rawTicker || seen.has(rawTicker)) continue;
          seen.add(rawTicker);
          mapped.push({
            ticker: rawTicker,
            name_ar: item.nameAr || item.name || item.name_ar || rawTicker,
            signal: String(item.recommendation || item.signal || 'BUY'),
            signal_ar: item.recommendationAr || (item.signal === 'STRONG_BUY' ? 'شراء قوي 🔥' : 'شراء 🟢'),
            entry: Number(item.entry?.price ?? item.entryPrice ?? item.currentPrice ?? 0),
            target: Number(item.entry?.target ?? item.targetPrice ?? 0),
            stop: Number(item.entry?.stopLoss ?? item.stopLoss ?? 0),
            risk_reward: Number(item.entry?.riskReward ?? 1.5),
            score: Number(item.maestroScore ?? item.confidence ?? 85),
            ath_breakout: false,
            delay_compensation_applied: Boolean(item.entry?.delayCompensation || false),
            updated_at: item.updatedAt || item.created_at,
          });
          if (mapped.length >= 5) break;
        }
        setStocks(mapped);
        setLabel(`أعلى ${mapped.length} فرص صباحية (static) 🍇`);
        setMarketStatus(mapped.length > 0 ? 'live' : 'closed');
        setIsLive(false);
      } catch (e) {
        console.warn('[MorningBell] fetch failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [marketCode]);

  if (marketCode !== 'EGX') return null;

  if (loading) {
    return (
      <section className="grid gap-3" aria-label="Morning Bell">
        <Skeleton className="h-28" />
      </section>
    );
  }

  const contStateColor: Record<string, string> = {
    continuing: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300',
    weakening: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    exhausted: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  };
  const contStateAr: Record<string, string> = {
    continuing: 'مستمرة',
    weakening: 'تضعف',
    exhausted: 'منتهية',
  };

  return (
    <section className="space-y-2" aria-label="Morning Bell">
      <div className="flex items-center gap-2 flex-wrap">
        <h3 className="text-base font-bold flex items-center gap-1.5">
          <span aria-hidden>🔔</span>
          <span>جرس الصباح</span>
        </h3>
        <Badge className="text-[10px] font-semibold border-0 bg-primary/10 text-primary">{label}</Badge>
        {marketStatus === 'live' && stocks.length > 0 && (
          <Badge className="text-[10px] font-semibold border-0 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">● مباشر</Badge>
        )}
        {isLive && stocks.length > 0 && (
          <Badge className="text-[10px] font-semibold border-0 bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-300" title={`دورة تجديد كل ${refreshMin} دقيقة`}>
            ⚡ تجديد {refreshMin}د
            {cacheAge !== null && <span className="opacity-70"> · {Math.floor(cacheAge / 60)}د مضت</span>}
          </Badge>
        )}
        {vetoed && (
          <Badge className="text-[10px] font-semibold border-0 bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">🛡️ كاش</Badge>
        )}
      </div>

      {noteAr && (
        <p className="text-xs text-muted-foreground bg-muted/40 rounded px-2 py-1.5">{noteAr}</p>
      )}

      {stocks.length === 0 ? (
        <p className="text-xs text-muted-foreground">مفيش فرص متاحة دلوقتي.</p>
      ) : (
        <>
          {/* تحذير مسؤولية العميل */}
          <div className="text-[11px] bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5 text-amber-800 dark:text-amber-300">
            ⚠️ جرس الصباح = مخاطر عالية على مسؤولية العميل. استخدم الوقف. الخسارة بعد تجاهل خطة الخروج لا تُحسب على أداء المسار المنضبط.
          </div>
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {stocks.map((s, idx) => (
              <Card
                key={s.ticker}
                className={cn(
                  'overflow-hidden border transition-shadow hover:shadow-md flex flex-col',
                  s.risk_flag === 'extreme_north'
                    ? 'border-red-300 dark:border-red-700 bg-red-50/30 dark:bg-red-950/10'
                    : s.continuation_state === 'continuing'
                      ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50/30 dark:bg-emerald-950/10'
                      : 'border-border'
                )}
              >
                <CardHeader className="pb-2 pt-3 px-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-mono text-sm font-bold">{s.ticker}</span>
                        {idx === 0 && <Badge className="text-[9px] font-bold border-0 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">#1</Badge>}
                        {s.rvol !== undefined && s.rvol >= 1.5 && (
                          <Badge className="text-[9px] font-bold border-0 bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-900/40 dark:text-fuchsia-300" title="Relative Volume — حجم غير عادي">
                            RVOL ×{safeToFixed(s.rvol, 1)}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{s.name_ar}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <Badge className={cn('text-[10px] font-bold border-0', s.signal === 'strong_buy' ? 'bg-emerald-500 text-white' : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300')}>
                        {s.signal_ar}
                      </Badge>
                      {s.continuation_state && (
                        <Badge className={cn('text-[9px] font-semibold border-0', contStateColor[s.continuation_state] || 'bg-muted')}>
                          {contStateAr[s.continuation_state] || s.continuation_state}
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="px-3 pb-3 pt-0 space-y-1.5 flex-1">
                  {/* السعر + الامتداد */}
                  {s.price !== undefined && s.price > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">السعر:</span>
                      <span className="font-mono font-bold">{fmtPrice(s.price)}</span>
                      {s.extension_pct_day !== undefined && (
                        <span className={cn('font-mono font-semibold', s.extension_pct_day >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                          {s.extension_pct_day >= 0 ? '+' : ''}{safeToFixed(s.extension_pct_day, 2)}%
                        </span>
                      )}
                    </div>
                  )}
                  {/* TP1 / TP2 / Stop */}
                  <div className="grid grid-cols-3 gap-1 text-center text-xs">
                    <div className="rounded bg-emerald-500/10 py-1">
                      <div className="text-[9px] text-emerald-700 dark:text-emerald-400">TP1</div>
                      <div className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">{fmtPrice(s.suggested_tp1 ?? s.target)}</div>
                    </div>
                    <div className="rounded bg-emerald-500/10 py-1">
                      <div className="text-[9px] text-emerald-700 dark:text-emerald-400">TP2</div>
                      <div className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">{fmtPrice(s.suggested_tp2 ?? 0)}</div>
                    </div>
                    <div className="rounded bg-red-500/10 py-1">
                      <div className="text-[9px] text-red-700 dark:text-red-400">وقف</div>
                      <div className="font-mono font-semibold text-red-700 dark:text-red-400">{fmtPrice(s.suggested_stop ?? s.stop)}</div>
                    </div>
                  </div>
                  {/* الاحتمالات الثلاثة */}
                  {s.prob_continue_up !== undefined && (
                    <div className="space-y-0.5">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-emerald-700 dark:text-emerald-400">صعود</span>
                        <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">{safeToFixed(s.prob_continue_up! * 100, 0)}%</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-amber-700 dark:text-amber-400">ارتداد بسيط</span>
                        <span className="font-mono font-semibold text-amber-700 dark:text-amber-400">{safeToFixed((s.prob_mild_pullback ?? 0) * 100, 0)}%</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-red-700 dark:text-red-400">هبوط قوي</span>
                        <span className="font-mono font-semibold text-red-700 dark:text-red-400">{safeToFixed((s.prob_sharp_drop ?? 0) * 100, 0)}%</span>
                      </div>
                    </div>
                  )}
                  {/* الشارات */}
                  <div className="flex items-center justify-between gap-1 flex-wrap pt-1">
                    <span className="text-[10px] text-muted-foreground">
                      {s.composite_score !== undefined ? `مركّب: ${safeToFixed(s.composite_score, 0)}` : `R/R: ${s.risk_reward || '—'}`}
                      {s.score !== undefined && s.composite_score === undefined && ` · نقاط: ${s.score}`}
                    </span>
                    <div className="flex items-center gap-1 flex-wrap">
                      {s.risk_flag === 'extreme_north' && (
                        <Badge className="text-[9px] font-semibold border-0 bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300" title="أسهم الشمال — مخاطر عالية جداً">🔴 شمال</Badge>
                      )}
                      {s.delay_compensation_applied && (
                        <Badge className="text-[9px] font-semibold border-0 cursor-help bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                          onClick={() => toast.info('⚠️ تعويض تأخير البيانات', { description: 'تم توسيع الهدف (+5%) وتضييق وقف الخسارة (-15%) لحماية صفقتك.', duration: 6000 })}>
                          ⚠️ تعويض
                        </Badge>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * 🔥 v3.66.9: فحص جلسة EGX الحالية (client-side).
 * مطابق لمنطق Python `_is_egx_intraday_now()` في stored_analysis_routes.py.
 * EGX hours: الأحد-الخميس، 10:00-14:30 توقيت القاهرة (Africa/Cairo).
 */
function _isEgxIntradayNow(): boolean {
  try {
    const now = new Date();
    // Cairo time = UTC+2 (winter) / UTC+3 (summer DST, months 4-10)
    const isDst = 4 <= now.getUTCMonth() + 1 && now.getUTCMonth() + 1 <= 10;
    const cairoOffset = isDst ? 3 : 2;
    const cairoHour = (now.getUTCHours() + cairoOffset + 24) % 24;
    const cairoMinute = now.getUTCMinutes();
    const cairoDay = now.getUTCDay(); // 0=Sun, 6=Sat
    // EGX closed on Friday (5) and Saturday (6)
    if (cairoDay === 5 || cairoDay === 6) return false;
    const minutes = cairoHour * 60 + cairoMinute;
    return minutes >= 600 && minutes < 870; // 10:00 (600) → 14:30 (870)
  } catch {
    return false;
  }
}

interface MarketAnalysisViewProps {
  /** V40.4 §5 UI Mirror Protocol — when set, syncs the store to this market
   * on mount so the unified shell renders crypto/stock data identically. */
  initialMarket?: MarketType;
}

export function MarketAnalysisView({ initialMarket }: MarketAnalysisViewProps = {}) {
  const [activeTab, setActiveTab] = useState('tracking');
  const { currentMarket, loadStockDetail, setCurrentMarket } = useAppStore();
  const marketCode = MARKET_CODES[currentMarket];
  // V40.4 §5: derive the currency label dynamically (EGP/SAR/KWD/QAR/USDT)
  // so the same shell renders the correct currency for every market.
  const currencyLabel = MARKET_CURRENCY_LABEL[currentMarket];

  // V40.4 §5 UI Mirror Protocol: sync the initialMarket prop → store so all
  // sub-tabs (MarketStatusTab, PersonaTab, PredictionTrackingDashboard, …)
  // inherit the market automatically. Runs once on mount.
  useEffect(() => {
    if (initialMarket && initialMarket !== currentMarket) {
      setCurrentMarket(initialMarket);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMarket]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const doPrefetch = async (force = false) => {
      const cache = useAnalysisStore.getState();
      // v3.66.9: لو force=true (session auto-refresh)، نتخطى الـ cache
      if (!force && cache.market === marketCode && cache.stocks && Date.now() - cache.lastFetched < 300000) {
        return;
      }

      useAnalysisStore.getState().setFetching(true);
      useAnalysisStore.getState().setMarket(marketCode);

      try {
        const [stocksRes, predsRes, storedRes] = await Promise.all([
          fetch(`/api/stocks?market=${marketCode}&limit=500`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ stocks: [] })),
          fetch(`/api/unified/predictions?market=${marketCode}&limit=50`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ predictions: [], closed_predictions: [] })),
          fetch(`/api/stored-analysis/results?market=${marketCode}&limit=100`, { cache: 'no-store' }).then(r => r.json()).catch(() => ({ data: [] })),
        ]);

        if (cancelled) return;
        useAnalysisStore.getState().setStocks(stocksRes.stocks || []);
        useAnalysisStore.getState().setPredictions(predsRes.predictions || [], predsRes.closed_predictions || []);
        useAnalysisStore.getState().setStoredAnalysis(storedRes.data || []);
      } finally {
        if (!cancelled) {
          useAnalysisStore.getState().setFetching(false);
          // 🔥 v3.66.9 LIVE: خلال جلسة EGX، اعادة جدولة كل 60 ثانية تلقائياً
          // (مش محتاج liveMode). بعد الجلسة: كل 5 دقايق لو liveMode مفعّل،
          // ولا حاجة لو مقفول. ده بيخلي الشاشة كلها حية خلال وقت التداول.
          const inSession = _isEgxIntradayNow();
          if (inSession) {
            timer = setTimeout(() => doPrefetch(true), 60000); // 60s during session
          } else if (useAnalysisStore.getState().liveMode) {
            timer = setTimeout(doPrefetch, 300000); // 5min after session if live
          }
        }
      }
    };

    doPrefetch();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [marketCode]);

  // 🔥 v3.66.9 LIVE: countdown badge لإظهار التحديث التلقائي القادم
  const [liveCountdown, setLiveCountdown] = useState(60);
  const [isLive, setIsLive] = useState(_isEgxIntradayNow());
  useEffect(() => {
    const checkSession = setInterval(() => {
      setIsLive(_isEgxIntradayNow());
    }, 60000);
    const countdown = setInterval(() => {
      setLiveCountdown((prev) => (prev <= 1 ? 60 : prev - 1));
    }, 1000);
    return () => {
      clearInterval(checkSession);
      clearInterval(countdown);
    };
  }, []);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          <Target className="h-5 w-5 sm:h-6 sm:w-6 text-emerald-600 flex-shrink-0" />
          <span>متابعة التوقعات</span>
          {/* v3.66.9 LIVE badge — بيتحدث تلقائياً خلال جلسة EGX */}
          {isLive && (
            <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 animate-pulse">
              <Activity className="h-3 w-3" />
              LIVE · {liveCountdown}s
            </span>
          )}
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <RefreshAnalyticsButton variant="glow" size="default" />
          <MarketSelector size="default" />
        </div>
      </div>

      {/* 🔔 P17 جرس الصباح — أعلى 3 فرص EGX فوق التبويبات */}
      <MorningBellSection marketCode={marketCode} />
      <HorizontalSectorsBar marketCode={marketCode} />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 h-auto gap-1">
          {/* التبويب الأول: متابعة التوقعات — كل الشخصيات + جرس الصباح + win/loss */}
          <TabsTrigger value="tracking" className="flex items-center gap-1">
            <Target className="h-4 w-4" />
            <span className="hidden sm:inline">متابعة التوقعات</span>
          </TabsTrigger>
          <TabsTrigger value="executive-report" className="flex items-center gap-1">
            <Layers className="h-4 w-4" />
            <span className="hidden sm:inline">ملخص التوقعات</span>
          </TabsTrigger>
          <TabsTrigger value="status" className="flex items-center gap-1">
            <Activity className="h-4 w-4" />
            <span className="hidden sm:inline">حالة السوق</span>
          </TabsTrigger>
          {/* P26-FIX-D: 3 persona tabs (conservative / balanced / gambler) بدل 2 */}
          <TabsTrigger value="conservative" className="flex items-center gap-1">
            <span className="text-base">🛡️</span>
            <span className="hidden sm:inline">المستثمر</span>
          </TabsTrigger>
          <TabsTrigger value="balanced" className="flex items-center gap-1">
            <span className="text-base">⚖️</span>
            <span className="hidden sm:inline">المتوازن</span>
          </TabsTrigger>
          <TabsTrigger value="gambler" className="flex items-center gap-1">
            <span className="text-base">🎯</span>
            <span className="hidden sm:inline">المضارب</span>
          </TabsTrigger>
          <TabsTrigger value="crypto" className="flex items-center gap-1">
            <Bitcoin className="h-4 w-4" />
            <span className="hidden sm:inline">الكريبتو</span>
          </TabsTrigger>
          {/* Phase 4: الفرز المتقدم — TradingView-style screener داخل #recommendations */}
          <TabsTrigger value="screener" className="flex items-center gap-1">
            <Activity className="h-4 w-4 text-emerald-600" />
            <span className="hidden sm:inline">الفرز المتقدم</span>
          </TabsTrigger>
        </TabsList>

        {/* تبويب متابعة التوقعات — كل الشخصيات بحد أقصى 5 + جرس الصباح فوقه بالفعل */}
        <TabsContent value="tracking" className="mt-4">
          <PredictionTrackingDashboard market={currentMarket} />
        </TabsContent>

        <TabsContent value="executive-report" className="mt-4">
          <ExecutiveReportView market={currentMarket} />
        </TabsContent>

        <TabsContent value="status" className="mt-4">
          <MarketStatusTab market={currentMarket} />
        </TabsContent>

        <TabsContent value="conservative" className="mt-4">
          <PersonaTab market={currentMarket} persona="conservative" />
        </TabsContent>

        <TabsContent value="balanced" className="mt-4">
          <PersonaTab market={currentMarket} persona="balanced" />
        </TabsContent>

        <TabsContent value="gambler" className="mt-4">
          <PersonaTab market={currentMarket} persona="gambler" />
        </TabsContent>

        <TabsContent value="crypto" className="mt-4">
          <CryptoPredictionsTab />
        </TabsContent>

        {/* Phase 4: الفرز المتقدم — TradingView-style screener مع sector heat + strongest movers */}
        <TabsContent value="screener" className="mt-4">
          <StockScreenerAdvanced />
        </TabsContent>
      </Tabs>

      {/* Social Share Footer */}
      <Card className="mt-4 bg-muted/50">
        <CardContent className="p-3 text-center text-sm text-muted-foreground">
          <p>📍 تابع أحدث تحليلات السوق على</p>
          <div className="flex items-center justify-center gap-4 mt-2">
            <a href="https://invist.m2y.net" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              invist.m2y.net
            </a>
            <span>|</span>
            <a href="https://t.me/REDACTED_CHANNEL_NAME" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Telegram
            </a>
            <span>|</span>
            <a href="https://www.facebook.com/profile.php?id=61590600300048" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              Facebook
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default MarketAnalysisView;
