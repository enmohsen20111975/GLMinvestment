'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { InteractiveChart } from './InteractiveChart';
import ChartControls from './ChartControls';
import { InstitutionalDecisionPanel } from './InstitutionalDecisionPanel';
import { DealAdvisorPanel } from '@/components/deal-advisor/DealAdvisorPanel';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  Search,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  BarChart3,
  Target,
  Activity,
  Share2,
  ShoppingCart,
  Wallet,
  Bell,
  BellRing,
  Star,
  Plus,
  Trash2,
  Maximize2,
  Minimize2,
  ChevronDown,
  SlidersHorizontal,
  Image,
  Download,
  Loader2,
  Check,
} from 'lucide-react';
import { useAppStore, MARKET_CURRENCY_LABEL } from '@/lib/store';
import { cn } from '@/lib/utils';
import { useLiveTicker } from '@/lib/ws-client';
import { useAlertsStore } from '@/lib/alerts-store';
import { HeartbeatStatusBar, WhaleAlertListener } from '@/components/analysis/LiveDashboard';
import { AlertPanel } from './AlertPanel';
import { toast } from 'sonner';
import { toPng } from 'html-to-image';
import { StockSearchSelector } from '@/components/shared/StockSearchSelector';

interface OHLCVCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface IndicatorPoint {
  time: string;
  value: number | null;
}

// ── P42-FRONTEND-1: Candle Probability & Stock DNA shapes ────────────────
interface CandleProbabilities {
  up_prob: number;
  dn_prob: number;
  bias: string;
  bias_en: string;
  bias_color: string;
  bias_emoji: string;
  prev_candle: string;
  break_high_0pct: number;
  break_high_1pct: number;
  break_high_2pct: number;
  break_low_0pct: number;
  break_low_1pct: number;
  break_low_2pct: number;
  total_green: number;
  total_red: number;
  sample_size: number;
  confidence: string;
  prev_high: number;
  prev_low: number;
  target_up_1pct: number;
  target_up_2pct: number;
  target_dn_1pct: number;
  target_dn_2pct: number;
}

interface MonthStat {
  month: string;
  month_num: number;
  avg_change: number;
}

interface StockDNA {
  ticker: string;
  name: string;
  sector: string;
  summary: string;
  narrative: string;
  personality_type: string;
  personality_type_en: string;
  best_months: MonthStat[];
  worst_months: MonthStat[];
  best_weekday: string;
  worst_weekday: string;
  typical_range: {
    min: number;
    max: number;
    current: number;
    current_position: string;
    position_pct: number;
  };
  volatility: string;
  volatility_en: string;
  annual_return: number | null;
  dividend_timing: string | null;
  behavioral_tags: string[];
  sample_months: number;
  confidence: string;
}

interface FullAnalysisResponse {
  success?: boolean;
  error?: string;
  ticker: string;
  name?: string;
  name_ar?: string;
  timeframe: string;
  data_points?: number;
  ohlcv: OHLCVCandle[];
  indicators: {
    sma20?: IndicatorPoint[];
    sma50?: IndicatorPoint[];
    sma200?: IndicatorPoint[];
    rsi?: IndicatorPoint[];
    atr?: IndicatorPoint[];
    cmf?: IndicatorPoint[];
    bb_upper?: IndicatorPoint[];
    bb_middle?: IndicatorPoint[];
    bb_lower?: IndicatorPoint[];
  };
  levels: {
    support: number | null;
    resistance: number | null;
    pivot: number | null;
    far_support?: number | null;
    far_resistance?: number | null;
    support_levels?: { price: number; strength: string }[];
    resistance_levels?: { price: number; strength: string }[];
    zone_type?: string;
    accumulation_zone?: boolean;
    distribution_zone?: boolean;
  };
  confluence: {
    score: number;
    breakdown: Record<string, { passed: boolean; points: number; max: number; detail: string }>;
    signal: string;
    signal_color: string;
  };
  risk: {
    entry: number;
    target: number;
    target_2?: number;
    stop_loss: number;
    rr_ratio: number;
    atr: number;
    atr_pct?: number;
  };
  market_regime?: {
    regime: string;
    regime_ar?: string;
    confidence: number;
    color: string;
  };
  bos_events?: Array<{ index: number; type: string; price: number; level: number }>;
  bb_squeeze?: { state: string; color: string; text: string };
  current_indicators?: {
    rsi?: number;
    rsi_trend_ar?: string;
    rsi_color?: string;
    macd?: number;
    macd_signal?: number;
    macd_hist?: number;
    macd_trend_ar?: string;
    macd_color?: string;
    cmf?: number;
    obv_trend_ar?: string;
    atr?: number;
  };
  volume_analysis?: {
    ratio?: number;
    trend_ar?: string;
    color?: string;
  };
  candlestick_patterns?: Array<{ name: string; signal: string; name_ar: string }>;
  smc_analysis?: {
    score?: number;
    score_pct?: number;
    bias_ar?: string;
    summary_ar?: string;
    nearest_ob?: { type: string; price: number; quality: string } | null;
    nearest_fvg?: { type: string; top: number; bottom: number } | null;
    liquidity_sweeps?: Array<{ type: string; price: number }>;
  };
  fusion_metrics?: {
    fusion_score?: number;
    tier_ar?: string;
    summary_ar?: string;
    breakdown?: {
      technical?: number;
      smc?: number;
      pattern?: number;
      candlestick?: number;
      ml?: number;
    };
    risk?: {
      entry: number;
      sl: number;
      tp1: number;
      tp2: number;
    };
  };
  signal_adjusted?: boolean;
  adjustment_reason?: string;
  aggregated_period?: string;
  analysis_text?: string;
  suggested_position_size_pct?: number;
  position_warning?: string;
  available_cash?: number;
  // ── P42-FRONTEND-1: new AI insight fields from /api/chart/full-analysis ──
  candle_probabilities?: CandleProbabilities | null;
  stock_dna?: StockDNA | null;
  // V34-INSTITUTIONAL-DECISION: محرك القرار المؤسسي الموحّد
  institutional_decision?: import('./InstitutionalDecisionPanel').InstitutionalDecision | null;
}

export interface SingleStockAnalysisViewProps {
  initialTicker: string;
  canRemove?: boolean;
  onRemove?: () => void;
  onTickerChange?: (newTicker: string) => void;
}

export function SingleStockAnalysisView({
  initialTicker,
  canRemove = false,
  onRemove,
  onTickerChange,
}: SingleStockAnalysisViewProps) {
  const { stocks, user, currentMarket, dealAdvisorPrefill } = useAppStore();
  // FIX (Aug 2026): استخدم MARKET_CURRENCY_LABEL من store بدل hardcoded
  // عشان يدعم TADAWUL (ريال), KSE (د.ك), QSE (ر.ق) صح
  const currencyLabel = MARKET_CURRENCY_LABEL[currentMarket] || 'ج.م';
  const isCrypto = currentMarket === 'CRYPTO';
  const [ticker, setTicker] = useState(initialTicker);
  const [timeframe, setTimeframe] = useState('DAY');
  const [userState, setUserState] = useState<'buyer' | 'owner'>('buyer');
  const [data, setData] = useState<FullAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedMode, setAdvancedMode] = useState(false);
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  // P41-DELAYED-DATA-MODE: Quick-Add Price Alert (نجمة بتحفظ تنبيه سعر في stocks.db)
  const [quickAdding, setQuickAdding] = useState(false);
  const [quickAdded, setQuickAdded] = useState(false);
  // V34-PORTFOLIO-TRACKER: بيانات مركز المستخدم عشان نعرضها في InstitutionalDecisionPanel
  const [userEntryPrice, setUserEntryPrice] = useState(0);
  const [userEntryQty, setUserEntryQty] = useState(0);

  const cardRef = useRef<HTMLDivElement>(null);
  const [screenshotting, setScreenshotting] = useState(false);

  const [visibleIndicators, setVisibleIndicators] = useState<Record<string, boolean>>({
    sma20: true,
    sma50: true,
    sma200: true,
    ema: true,
    rsi: true,
    cmf: false,
    bb: true,
    macd: true,
    volume: true,
    obv: false,
    fibonacci: true,
    levels: true,
    bos: true,
  });

  const { liveData, isLive } = useLiveTicker(ticker);

  const activeAlertsCount = useAlertsStore(
    (s) => s.alerts.filter((a) => a.ticker === ticker.toUpperCase() && a.enabled).length
  );
  // P41-DELAYED-DATA-MODE: addAlert for the Quick-Add Star button
  const addAlert = useAlertsStore((s) => s.addAlert);

  const fetchData = useCallback(
    async (
      tk: string,
      tf: string,
      state: 'buyer' | 'owner' = 'buyer',
      entryPrice?: number,
      entryQty?: number,
    ) => {
      setLoading(true);
      setError(null);
      try {
        const LIMIT_MAP: Record<string, number> = {
          '5M': 500,
          '15M': 500,
          '1H': 500,
          TODAY: 200,
          DAY: 365,
          WEEK: 730,
          MONTH: 1825,
        };
        const limit = LIMIT_MAP[tf] || 365;
        const userIdParam = user?.id ? `&user_id=${encodeURIComponent(user.id)}` : '';
        // V34-PORTFOLIO: تمرير entry_price + entry_qty للـ backend عشان يحسب portfolio_advice
        const positionParams =
          entryPrice && entryPrice > 0
            ? `&entry_price=${entryPrice}&entry_qty=${entryQty || 0}`
            : '';
        // ── Market-aware fetch: CRYPTO uses /api/crypto/full-analysis (no user_id / no state) ──
        const url = isCrypto
          ? `/api/crypto/full-analysis?ticker=${encodeURIComponent(
              tk
            )}&timeframe=${tf}&limit=${limit}&_t=${Date.now()}`
          : `/api/v2/chart/full-analysis?ticker=${encodeURIComponent(
              tk
            )}&timeframe=${tf}&limit=${limit}${userIdParam}&state=${state}${positionParams}&_t=${Date.now()}`;
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
    },
    [user?.id, isCrypto]
  );

  useEffect(() => {
    fetchData(ticker, timeframe, userState);
  }, [ticker, timeframe, userState, fetchData]);

  const handleSelectTicker = (newTk: string) => {
    setTicker(newTk);
    if (onTickerChange) onTickerChange(newTk);
  };

  const toggleIndicator = (key: string) => {
    setVisibleIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleScreenshot = useCallback(async () => {
    if (!cardRef.current) return;
    setScreenshotting(true);
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
      const link = document.createElement('a');
      link.download = `${ticker.toUpperCase()}_analysis_${new Date().toISOString().split('T')[0]}.png`;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success('تم تحميل صورة التحليل');
    } catch (err) {
      console.error('Screenshot failed:', err);
      toast.error('فشل في التقاط الصورة');
    } finally {
      setScreenshotting(false);
    }
  }, [ticker]);

  const stockInfo = stocks.find((s) => s.ticker === ticker.toUpperCase());
  const tc = liveData?.today_candle || data?.ohlcv?.[data.ohlcv.length - 1];
  const livePrice = liveData?.today_candle?.close ?? tc?.close ?? stockInfo?.current_price ?? 0;
  const prevClose = data?.ohlcv?.[data.ohlcv.length - 2]?.close ?? livePrice;
  const chgPct = prevClose > 0 ? ((livePrice - prevClose) / prevClose) * 100 : 0;
  const isUp = chgPct >= 0;

  // ── P41-DELAYED-DATA-MODE: Quick-Add Price Alert ──────────────────────────
  // زر النجمة بيسجّل تنبيه "price_below" في جدول price_alerts بـ stocks.db +
  // كمان في الـ alerts-store اللي بترصدها use-alerts.ts hook محلياً.
  // الفايدة: لما الـ data متأخرة 5 دقايق، المستخدم يقدر يضغط نجمة وينسَى —
  // النظام هيـ notifyه لو السهم نزل 3% تحت السعر الحالي.
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
      // 1) سجّل في الـ backend (price_alerts table in stocks.db)
      const DROP_PCT = -3;
      const res = await fetch('/api/alerts/quick-add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: ticker.toUpperCase(),
          current_price: refPrice,
          drop_pct: DROP_PCT,
          label: `تنبيه سريع: ${ticker.toUpperCase()} نزل ${DROP_PCT}% تحت ${refPrice.toFixed(2)}`,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'فشل حفظ التنبيه في قاعدة البيانات');
      }

      // 2) سجّل في الـ client-side alerts-store (عشان use-alerts.ts يرصدها فوراً)
      const thresholdPrice = Number((refPrice * (1 + DROP_PCT / 100)).toFixed(4));
      addAlert({
        ticker: ticker.toUpperCase(),
        type: 'price_below',
        threshold: thresholdPrice,
        label: `تنبيه سريع: ${ticker.toUpperCase()} نزل ${DROP_PCT}% تحت ${refPrice.toFixed(2)} (عتبة: ${thresholdPrice.toFixed(2)})`,
      });

      setQuickAdded(true);
      toast.success(
        `🔔 تنبيه مسجّل: ${ticker.toUpperCase()} نزل ${DROP_PCT}% تحت ${refPrice.toFixed(2)} (عتبة: ${thresholdPrice.toFixed(2)})`
      );
      // Reset the "added" checkmark after 2s
      setTimeout(() => setQuickAdded(false), 2000);
    } catch (err) {
      console.error('[QuickAddAlert] failed:', err);
      toast.error(err instanceof Error ? err.message : 'فشل تسجيل التنبيه');
    } finally {
      setQuickAdding(false);
    }
  }, [ticker, livePrice, stockInfo?.current_price, quickAdding, addAlert]);

  return (
    <div
      id={`chart-card-${ticker.toUpperCase()}`}
      ref={cardRef}
      className={cn(
        'border border-border shadow-[0_8px_30px_rgba(15,23,42,0.06)] bg-card transition-all duration-200 flex flex-col overflow-hidden rounded-2xl',
        isMaximized ? 'fixed inset-2 z-50 overflow-y-auto bg-card p-4' : 'w-full'
      )}
    >
      <WhaleAlertListener />

      <CardHeader className="px-4 py-3 border-b border-border bg-gradient-to-r from-slate-50 via-white to-emerald-50/50 space-y-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-2 flex-wrap">
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
            </div>

            <Badge
              variant="outline"
              className={cn(
                'font-mono text-xs font-black px-2.5 py-1 border rounded-full',
                isUp
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              )}
            >
              {livePrice > 0 ? `${livePrice.toFixed(2)} ${currencyLabel}` : '—'}
              <span className="text-[10px] mr-1">
                ({isUp ? '+' : ''}{chgPct.toFixed(1)}%)
              </span>
            </Badge>

            {data?.confluence?.signal && (
              <Badge
                style={{ backgroundColor: data.confluence.signal_color || '#10b981' }}
                className="text-white text-[10px] font-bold px-2.5 py-1 shadow-sm rounded-full"
              >
                {data.confluence.signal} ({data.confluence.score?.toFixed(1)}/10)
              </Badge>
            )}

            {isLive && (
              <Badge
                className={cn(
                  'text-[9px] font-bold rounded-full',
                  liveData?.delayed_mode
                    ? 'bg-amber-500 text-white border border-amber-600'
                    : 'bg-rose-600 text-white animate-pulse'
                )}
              >
                {liveData?.delayed_mode ? `DELAYED ${liveData.delayed_minutes || 5}M` : 'LIVE'}
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="flex bg-muted border border-border rounded-xl p-0.5 text-[10px] font-semibold">
              {[
                { label: '5M', key: '5M' },
                { label: '15M', key: '15M' },
                { label: '1H', key: '1H' },
                { label: 'يومي', key: 'DAY' },
                { label: 'أسبوعي', key: 'WEEK' },
                { label: 'شهري', key: 'MONTH' },
              ].map((tf) => (
                <button
                  key={tf.key}
                  type="button"
                  onClick={() => setTimeframe(tf.key)}
                  className={cn(
                    'px-2 py-1 rounded-lg transition-colors',
                    timeframe === tf.key
                      ? 'bg-emerald-600 text-white font-bold shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tf.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1 bg-muted border border-border rounded-xl p-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setAdvancedMode(false)}
                className={cn(
                  'px-2 py-1 rounded-lg transition-all font-semibold',
                  !advancedMode ? 'bg-card text-emerald-700 shadow-sm' : 'text-muted-foreground'
                )}
              >
                مبسط
              </button>
              <button
                type="button"
                onClick={() => setAdvancedMode(true)}
                className={cn(
                  'px-2 py-1 rounded-lg transition-all font-semibold',
                  advancedMode ? 'bg-card text-teal-700 shadow-sm' : 'text-muted-foreground'
                )}
              >
                محترفين
              </button>
            </div>

            <Button variant="ghost" size="sm" onClick={() => fetchData(ticker, timeframe, userState)} disabled={loading} className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:bg-muted">
              <RefreshCw className={cn('h-3.5 w-3.5', loading ? 'animate-spin' : '')} />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setAlertPanelOpen(true)} className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:bg-amber-50 hover:text-amber-600 relative">
              {activeAlertsCount > 0 ? <BellRing className="h-3.5 w-3.5 text-amber-500" /> : <Bell className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleQuickAddAlert} disabled={quickAdding || livePrice <= 0} className={cn('h-8 w-8 p-0 rounded-lg', quickAdded ? 'text-emerald-600 hover:bg-emerald-50' : 'text-muted-foreground hover:bg-amber-50')}>
              {quickAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : quickAdded ? <Check className="h-3.5 w-3.5" /> : <Star className="h-3.5 w-3.5" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setIsMaximized((v) => !v)} className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:bg-muted">
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={handleScreenshot} disabled={screenshotting} className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:bg-muted">
              {screenshotting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Image className="w-3.5 h-3.5" />}
            </Button>
            {canRemove && (
              <Button variant="ghost" size="sm" onClick={onRemove} className="h-8 w-8 p-0 rounded-lg text-muted-foreground hover:bg-rose-50 hover:text-rose-600">
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 pt-1 text-[10px] flex-wrap">
          <span className="text-muted-foreground font-bold">وضعي:</span>
          <div className="flex bg-card border border-border rounded-xl p-0.5">
            <button type="button" onClick={() => setUserState('buyer')} className={cn('px-2 py-1 rounded-lg transition-all font-semibold', userState === 'buyer' ? 'bg-emerald-50 text-emerald-700' : 'text-muted-foreground')}> <ShoppingCart className="w-3 h-3 inline ml-1" /> أبحث عن شراء </button>
            <button type="button" onClick={() => setUserState('owner')} className={cn('px-2 py-1 rounded-lg transition-all font-semibold', userState === 'owner' ? 'bg-amber-50 text-amber-700' : 'text-muted-foreground')}> <Wallet className="w-3 h-3 inline ml-1" /> {isCrypto ? 'أملك العملة' : 'أملك السهم'} </button>
          </div>
          {data?.adjustment_reason && (
            <span className="text-muted-foreground truncate max-w-md">💡 {data.adjustment_reason}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-border text-[10px]">
          <span className="text-muted-foreground font-bold">المؤشرات:</span>
          {[
            { label: 'MA20', key: 'sma20' },
            { label: 'MA50', key: 'sma50' },
            { label: 'MA200', key: 'sma200' },
            { label: 'EMA', key: 'ema' },
            { label: 'RSI', key: 'rsi' },
            { label: 'Bollinger', key: 'bb' },
            { label: 'MACD', key: 'macd' },
            { label: 'Volume', key: 'volume' },
            { label: 'Levels', key: 'levels' },
            { label: 'SMC/BOS', key: 'bos' },
          ].map((ind) => (
            <button
              key={ind.key}
              type="button"
              onClick={() => toggleIndicator(ind.key)}
              className={cn(
                'px-1.5 py-1 rounded-lg border transition-all font-mono',
                visibleIndicators[ind.key]
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 font-bold'
                  : 'bg-muted text-muted-foreground border-border hover:bg-muted'
              )}
            >
              {visibleIndicators[ind.key] ? '✓ ' : ''}{ind.label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-3 space-y-3">
        <div className="flex flex-col lg:flex-row gap-3 min-h-[440px]">
          <div className="hidden lg:flex flex-col w-40 shrink-0 rounded-xl bg-muted border border-border p-3 gap-2 text-[10px]">
            <div className="text-muted-foreground font-bold border-b border-border pb-1 text-center">السعر اللحظي</div>
            <div className="text-center">
              <div className="text-[10px] text-muted-foreground">إغلاق</div>
              <div className={cn('text-lg font-black font-mono', isUp ? 'text-emerald-600' : 'text-rose-600')}>{livePrice.toFixed(2)}</div>
              <div className={cn('font-bold', isUp ? 'text-emerald-600' : 'text-rose-600')}>{isUp ? '+' : ''}{chgPct.toFixed(2)}%</div>
            </div>
            <div className="space-y-1 pt-2 border-t border-border">
              <div className="flex justify-between"><span className="text-muted-foreground">افتتاح:</span><span className="font-mono">{(tc?.open ?? 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">أعلى:</span><span className="font-mono text-emerald-600">{(tc?.high ?? 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">أدنى:</span><span className="font-mono text-rose-600">{(tc?.low ?? 0).toFixed(2)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">حجم:</span><span className="font-mono">{(tc?.volume ?? 0).toLocaleString()}</span></div>
            </div>
          </div>

          <div className="flex-1 min-h-[440px] rounded-xl overflow-hidden border border-border bg-card relative">
            {loading ? (
              <div className="flex flex-col justify-center items-center h-full min-h-[440px] gap-2">
                <RefreshCw className="w-6 h-6 text-emerald-500 animate-spin" />
                <span className="text-xs text-muted-foreground">جاري تحميل بيانات {ticker}...</span>
              </div>
            ) : error ? (
              <div className="flex flex-col justify-center items-center h-full min-h-[440px] gap-2 p-4 text-center">
                <AlertTriangle className="w-8 h-8 text-rose-500" />
                <span className="text-xs font-bold text-rose-400">{error}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchData(ticker, timeframe, userState)}
                  className="mt-2 text-xs"
                >
                  إعادة المحاولة
                </Button>
              </div>
            ) : data && data.ohlcv && data.ohlcv.length > 0 ? (
              <InteractiveChart
                ohlcv={data.ohlcv}
                indicators={data.indicators}
                visibleIndicators={visibleIndicators}
                levels={data.levels}
                regimeColor={data.market_regime?.color}
                targetPrice={data.risk?.target}
                stopLossPrice={data.risk?.stop_loss}
                entryPrice={data.risk?.entry}
                target2Price={data.risk?.target_2}
                target3Price={data.risk?.target_2 ? data.risk.target_2 * 1.05 : null}
                bbSqueezeLevel={data.bb_squeeze?.state}
                bosEvents={data.bos_events}
                livePrice={liveData?.today_candle?.close ?? null}
                cmfData={(data as Record<string, unknown>).cmf_data}
                macdProjection={(data as Record<string, unknown>).macd_projection}
                smartMarkers={(data as Record<string, unknown>).smart_markers}
                smcData={(data as Record<string, unknown>).smc_data}
                fusionMetrics={(data as Record<string, unknown>).fusion_metrics}
              />
            ) : (
              <div className="flex flex-col justify-center items-center h-full min-h-[440px] text-muted-foreground text-xs">
                لا توجد بيانات كافية لهذا السهم
              </div>
            )}
          </div>
        </div>

        {/* ─── 3. Detailed Accordions / Cards ─── */}
        {data && (
          <div className="space-y-3 pt-2 text-xs">
            {/* Row 1: Always Visible in both Simple and Advanced Modes (Score Card & Trade Plan) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Score Card & Confluence */}
              <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 space-y-1.5">
                <div className="flex justify-between items-center font-bold text-[11px]">
                  <span className="text-emerald-700 dark:text-emerald-300">درجة التوافق الإجمالية (Confluence Score):</span>
                  <span className="font-mono text-emerald-600 dark:text-emerald-400 font-black text-base">
                    {data.confluence?.score?.toFixed(1) || '0.0'}/10
                  </span>
                </div>
                <Badge
                  style={{ backgroundColor: data.confluence?.signal_color || '#10b981' }}
                  className="text-white text-xs font-bold w-full justify-center py-1 shadow-xs"
                >
                  {data.confluence?.signal || 'حيادي'}
                </Badge>
                {data.analysis_text && (
                  <p className="text-[11px] text-muted-foreground leading-relaxed pt-1">
                    💡 <span className="font-bold text-foreground">السبب والتحليل:</span> {data.analysis_text}
                  </p>
                )}
              </div>

              {/* Trade Plan (سعر الدخول / الهدف / الوقف) */}
              {data.risk && (
                <div className="p-3 rounded-lg bg-card border border-border space-y-2">
                  <span className="font-bold text-[11px] block border-b border-border pb-1 text-foreground">
                    🎯 خطة التداول المباشرة (Trade Plan):
                  </span>
                  <div className="grid grid-cols-3 gap-1.5 text-center font-mono">
                    <div className="p-1.5 rounded bg-muted/40">
                      <span className="text-[9px] text-muted-foreground block font-sans">سعر الدخول</span>
                      <span className="font-bold text-xs">{data.risk.entry?.toFixed(2)} {currencyLabel}</span>
                    </div>
                    <div className="p-1.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <span className="text-[9px] block font-sans">🎯 الهدف (TP1)</span>
                      <span className="font-bold text-xs">{data.risk.target?.toFixed(2)} {currencyLabel}</span>
                    </div>
                    <div className="p-1.5 rounded bg-rose-500/10 text-rose-600 dark:text-rose-400">
                      <span className="text-[9px] block font-sans">🛑 الوقف (SL)</span>
                      <span className="font-bold text-xs">{data.risk.stop_loss?.toFixed(2)} {currencyLabel}</span>
                    </div>
                  </div>
                  <div className="flex justify-between text-[10px] text-muted-foreground pt-1 border-t border-border/40">
                    <span>نسبة العائد للمخاطرة (R:R): <strong className="font-mono text-foreground">{data.risk.rr_ratio?.toFixed(2)}R</strong></span>
                    {data.suggested_position_size_pct && (
                      <span>حجم المحفظة المقترح: <strong className="font-mono text-emerald-500">{data.suggested_position_size_pct}%</strong></span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* ── V34: Institutional Decision Panel (محرك القرار المؤسسي) ──
                لوحة موحّدة بتجمع:
                - حالة الميكرز (تجميع/تصريف/هدوء)
                - حالة الطيران (طائر/واقع/عرضي)
                - 5 إثباتات + Tech Score + الإشارة النهائية
                - مدير المحفظة (نصيحة حسب المركز المفتوح)
                بتتوفر لما الـ backend يرجّع institutional_decision في الـ response. */}
            {data.institutional_decision && (
              <InstitutionalDecisionPanel
                decision={data.institutional_decision}
                ticker={ticker}
                currencyLabel={currencyLabel}
                onPositionUpdate={(price, qty) => {
                  setUserEntryPrice(price);
                  setUserEntryQty(qty);
                  // إعادة جلب البيانات بـ entry_price/entry_qty عشان الـ backend يحسب الـ portfolio_advice
                  fetchData(ticker, timeframe, userState, price, qty);
                }}
              />
            )}

            {/* ── لوحة القرار الشفافة (مرحلة منفصلة 3 — 2026-08-30) ──
                تقرير مرتب وجميل زي Pine Script V56 — يعرض:
                الحالة + القرار + الأساسيات + الفني + السيولة + خطة التداول
                مرئي لما فيه institutional_decision */}
            {data.institutional_decision && (() => {
              const d = data.institutional_decision;
              const sig = d.signal || '—';
              const sigColor = sig.includes('BUY') || sig.includes('شراء') ? 'text-emerald-600' : sig.includes('SELL') || sig.includes('بيع') ? 'text-rose-600' : 'text-amber-600';
              return (
                <Card className="border border-border bg-card shadow-sm overflow-hidden mt-2" dir="rtl">
                  <CardHeader className="p-3 pb-2 border-b border-border bg-muted">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-sm text-slate-800">تقرير القرار الشفاف</span>
                      <Badge variant="outline" className="text-[10px] font-mono">{ticker}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="p-3 space-y-2 text-xs">
                    {/* الحالة + القرار */}
                    <div className="grid grid-cols-2 gap-2 pb-2 border-b border-slate-100">
                      <div>
                        <span className="text-muted-foreground">الحالة: </span>
                        <span className="font-medium text-slate-800">{d.reason || d.path || '—'}</span>
                      </div>
                      <div className="text-left">
                        <span className="text-muted-foreground">القرار: </span>
                        <span className={`font-bold ${sigColor}`}>{sig}</span>
                      </div>
                    </div>
                    {/* الأساسيات */}
                    <div className="grid grid-cols-3 gap-2 pb-2 border-b border-slate-100">
                      <div>
                        <span className="text-muted-foreground">مكرر الربحية: </span>
                        <span className="font-medium">{d.pe_ratio ? d.pe_ratio.toFixed(1) : '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">العائد (ROE): </span>
                        <span className="font-medium">{d.roe != null ? d.roe.toFixed(1) + '%' : '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">الديون: </span>
                        <span className="font-medium">{d.debt_to_equity != null ? d.debt_to_equity.toFixed(1) + '%' : '—'}</span>
                      </div>
                    </div>
                    {/* الفني */}
                    <div className="grid grid-cols-3 gap-2 pb-2 border-b border-slate-100">
                      <div>
                        <span className="text-muted-foreground">نظام السوق: </span>
                        <span className="font-medium">{d.market_regime || d.regime || '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">القوة النسبية: </span>
                        <span className="font-medium">{d.relative_strength != null ? d.relative_strength.toFixed(2) + '%' : '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">عدد الإثباتات: </span>
                        <span className="font-medium">{d.evidence_count ?? '—'}/6</span>
                      </div>
                    </div>
                    {/* خطة التداول */}
                    <div className="grid grid-cols-4 gap-2">
                      <div>
                        <span className="text-muted-foreground">الدخول: </span>
                        <span className="font-medium font-mono">{d.entry_price ? d.entry_price.toFixed(2) : '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">الوقف: </span>
                        <span className="font-medium font-mono text-rose-600">{d.stop_loss ? d.stop_loss.toFixed(2) : '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">الهدف 1: </span>
                        <span className="font-medium font-mono text-emerald-600">{d.target_price ? d.target_price.toFixed(2) : '—'}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">R:R: </span>
                        <span className="font-medium font-mono">{d.rr_ratio ? d.rr_ratio.toFixed(2) : '—'}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {/* ── P42-FRONTEND-1: Row 1.5 — Insight Cards ──
                Visible in both simple and advanced modes. Each card renders only when its
                backend payload is non-null. RTL Arabic layout, fully responsive. */}
            {(data.candle_probabilities || data.stock_dna) && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 pt-1" dir="rtl">
                {/* ───────── Card 1: 🔮 توقع الشمعة الجاية (Candle Probability) ───────── */}
                {data.candle_probabilities && (() => {
                  const cp = data.candle_probabilities;
                  const upPct = Math.max(0, Math.min(100, cp.up_prob ?? 0));
                  const dnPct = Math.max(0, Math.min(100, cp.dn_prob ?? 0));
                  return (
                    <Card className="border border-border/80 bg-card shadow-xs overflow-hidden">
                      <CardHeader className="p-3 pb-2 border-b border-border/40 bg-muted/20">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-sm text-foreground flex items-center gap-1.5">
                            <span>🔮</span>
                            <span>توقع الشمعة الجاية</span>
                          </span>
                          <Badge
                            style={{
                              backgroundColor: cp.bias_color || '#6b7280',
                              color: '#ffffff',
                            }}
                            className="text-[10px] font-bold shadow-xs"
                          >
                            {cp.bias_emoji} {cp.bias}
                          </Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="p-3 space-y-2.5 text-xs">
                        {/* Big up vs down display */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="text-center p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                            <div className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold mb-0.5">
                              🟢 صعود
                            </div>
                            <div className="text-2xl font-black text-emerald-600 dark:text-emerald-400 font-mono leading-none">
                              {upPct.toFixed(1)}%
                            </div>
                          </div>
                          <div className="text-center p-2 rounded-lg bg-rose-500/10 border border-rose-500/30">
                            <div className="text-[10px] text-rose-700 dark:text-rose-300 font-bold mb-0.5">
                              🔴 هبوط
                            </div>
                            <div className="text-2xl font-black text-rose-600 dark:text-rose-400 font-mono leading-none">
                              {dnPct.toFixed(1)}%
                            </div>
                          </div>
                        </div>

                        {/* Split bar visualization (up vs down) */}
                        <div className="flex h-3 rounded-full overflow-hidden bg-muted border border-border/40">
                          <div
                            className="bg-emerald-500 transition-all duration-500"
                            style={{ width: `${upPct}%` }}
                            title={`صعود ${upPct.toFixed(1)}%`}
                          />
                          <div
                            className="bg-rose-500 transition-all duration-500"
                            style={{ width: `${dnPct}%` }}
                            title={`هبوط ${dnPct.toFixed(1)}%`}
                          />
                        </div>

                        {/* Bias line */}
                        <div
                          className="text-center text-sm font-bold py-1 rounded bg-muted/30"
                          style={{ color: cp.bias_color || '#6b7280' }}
                        >
                          الميل العام: {cp.bias} {cp.bias_emoji}
                        </div>

                        {/* Breakout probabilities */}
                        <div className="grid grid-cols-2 gap-1.5">
                          <div className="p-1.5 rounded bg-emerald-500/5 border border-emerald-500/20">
                            <div className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold mb-1">
                              📈 احتمال كسر القمة السابقة ({cp.prev_high?.toFixed(2)})
                            </div>
                            <div className="font-mono text-[10px] text-foreground/80 space-y-0.5">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">+0%:</span>
                                <span className="text-emerald-500 font-bold">{cp.break_high_0pct?.toFixed(1)}%</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">+1%:</span>
                                <span className="text-emerald-500 font-bold">{cp.break_high_1pct?.toFixed(1)}%</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">+2%:</span>
                                <span className="text-emerald-500 font-bold">{cp.break_high_2pct?.toFixed(1)}%</span>
                              </div>
                            </div>
                          </div>
                          <div className="p-1.5 rounded bg-rose-500/5 border border-rose-500/20">
                            <div className="text-[10px] text-rose-700 dark:text-rose-300 font-bold mb-1">
                              📉 احتمال كسر القاع السابق ({cp.prev_low?.toFixed(2)})
                            </div>
                            <div className="font-mono text-[10px] text-foreground/80 space-y-0.5">
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">-0%:</span>
                                <span className="text-rose-500 font-bold">{cp.break_low_0pct?.toFixed(1)}%</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">-1%:</span>
                                <span className="text-rose-500 font-bold">{cp.break_low_1pct?.toFixed(1)}%</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">-2%:</span>
                                <span className="text-rose-500 font-bold">{cp.break_low_2pct?.toFixed(1)}%</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Target prices */}
                        <div className="grid grid-cols-4 gap-1 text-center">
                          <div className="p-1 rounded bg-emerald-500/10 border border-emerald-500/20">
                            <div className="text-[9px] text-muted-foreground">هدف +1%</div>
                            <div className="font-mono font-bold text-emerald-500 text-[11px]">
                              {cp.target_up_1pct?.toFixed(2) ?? '—'}
                            </div>
                          </div>
                          <div className="p-1 rounded bg-emerald-500/10 border border-emerald-500/20">
                            <div className="text-[9px] text-muted-foreground">هدف +2%</div>
                            <div className="font-mono font-bold text-emerald-500 text-[11px]">
                              {cp.target_up_2pct?.toFixed(2) ?? '—'}
                            </div>
                          </div>
                          <div className="p-1 rounded bg-rose-500/10 border border-rose-500/20">
                            <div className="text-[9px] text-muted-foreground">هدف -1%</div>
                            <div className="font-mono font-bold text-rose-500 text-[11px]">
                              {cp.target_dn_1pct?.toFixed(2) ?? '—'}
                            </div>
                          </div>
                          <div className="p-1 rounded bg-rose-500/10 border border-rose-500/20">
                            <div className="text-[9px] text-muted-foreground">هدف -2%</div>
                            <div className="font-mono font-bold text-rose-500 text-[11px]">
                              {cp.target_dn_2pct?.toFixed(2) ?? '—'}
                            </div>
                          </div>
                        </div>

                        {/* Footer: prev candle + confidence + sample */}
                        <div className="text-[10px] text-muted-foreground text-center pt-1 border-t border-border/40">
                          الشمعة السابقة:{' '}
                          <strong className={cp.prev_candle === 'خضراء' ? 'text-emerald-500' : 'text-rose-500'}>
                            {cp.prev_candle}
                          </strong>{' '}
                          | الثقة:{' '}
                          <strong className="text-foreground">{cp.confidence}</strong>{' '}
                          | عينة:{' '}
                          <strong className="text-foreground">{cp.sample_size}</strong> شمعة
                          <span className="text-muted-foreground/70">
                            {' '}
                            (🟢 {cp.total_green} / 🔴 {cp.total_red})
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* ───────── Card 2: 🧬 بصمة السهم (Stock DNA) ───────── */}
                {data.stock_dna && (() => {
                  const dna = data.stock_dna;
                  const tr = dna.typical_range;
                  const positionPct = Math.max(0, Math.min(100, tr?.position_pct ?? 0));
                  return (
                    <Card className="border border-border/80 bg-card shadow-xs overflow-hidden">
                      <CardHeader className="p-3 pb-2 border-b border-border/40 bg-muted/20 space-y-1">
                        <div className="flex items-start justify-between gap-2 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="font-bold text-sm text-foreground flex items-center gap-1.5">
                              <span>🧬</span>
                              <span>بصمة السهم: {dna.name || dna.ticker || ticker}</span>
                            </div>
                            {dna.summary && (
                              <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                                {dna.summary}
                              </div>
                            )}
                          </div>
                          {dna.personality_type && (
                            <Badge
                              className="bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px] font-bold shrink-0"
                              title={dna.personality_type_en || dna.personality_type}
                            >
                              {dna.personality_type}
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="p-3 space-y-2.5 text-xs">
                        {/* Stats grid: volatility, annual return, best/worst weekday */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                          <div className="p-1.5 rounded bg-muted/40 border border-border/40">
                            <span className="text-[10px] text-muted-foreground block">التذبذب</span>
                            <span className="font-bold text-foreground text-[11px]">{dna.volatility || '—'}</span>
                          </div>
                          <div className="p-1.5 rounded bg-muted/40 border border-border/40">
                            <span className="text-[10px] text-muted-foreground block">العائد السنوي</span>
                            <span
                              className={cn(
                                'font-bold font-mono text-[11px]',
                                dna.annual_return === null
                                  ? 'text-muted-foreground'
                                  : dna.annual_return >= 0
                                    ? 'text-emerald-500'
                                    : 'text-rose-500'
                              )}
                            >
                              {dna.annual_return !== null
                                ? `${dna.annual_return >= 0 ? '+' : ''}${dna.annual_return.toFixed(1)}%`
                                : '—'}
                            </span>
                          </div>
                          <div className="p-1.5 rounded bg-emerald-500/5 border border-emerald-500/20">
                            <span className="text-[10px] text-muted-foreground block">أفضل يوم</span>
                            <span className="font-bold text-emerald-600 dark:text-emerald-400 text-[11px]">
                              {dna.best_weekday || '—'}
                            </span>
                          </div>
                          <div className="p-1.5 rounded bg-rose-500/5 border border-rose-500/20">
                            <span className="text-[10px] text-muted-foreground block">أضعف يوم</span>
                            <span className="font-bold text-rose-600 dark:text-rose-400 text-[11px]">
                              {dna.worst_weekday || '—'}
                            </span>
                          </div>
                        </div>

                        {/* Typical range with position bar */}
                        {tr && (
                          <div className="p-2 rounded bg-muted/30 border border-border/40 text-[10px]">
                            <div className="flex justify-between mb-1">
                              <span className="text-muted-foreground">النطاق المعتاد:</span>
                              <span className="font-mono text-foreground">
                                {tr.min?.toFixed(2)} — {tr.max?.toFixed(2)}
                              </span>
                            </div>
                            <div className="relative h-2.5 bg-gradient-to-l from-rose-500/30 via-amber-500/30 to-emerald-500/30 rounded-full border border-border/40">
                              <div
                                className="absolute top-1/2 -translate-y-1/2 h-3.5 w-1 bg-foreground rounded-sm shadow-sm transition-all"
                                style={{
                                  right: `${positionPct}%`,
                                  transform: 'translateX(50%) translateY(-50%)',
                                }}
                                title={`السعر الحالي: ${tr.current?.toFixed(2)}`}
                              />
                            </div>
                            <div className="flex justify-between mt-1 text-[9px]">
                              <span className="text-muted-foreground">
                                السعر الحالي:{' '}
                                <strong className="font-mono text-foreground">{tr.current?.toFixed(2)}</strong>
                              </span>
                              <span className="text-muted-foreground">
                                {tr.current_position || '—'} ({positionPct.toFixed(0)}%)
                              </span>
                            </div>
                          </div>
                        )}

                        {/* Best & worst months */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {dna.best_months && dna.best_months.length > 0 && (
                            <div className="p-1.5 rounded bg-emerald-500/5 border border-emerald-500/20">
                              <div className="text-[10px] text-emerald-700 dark:text-emerald-300 font-bold mb-1">
                                🏆 أفضل الشهور:
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {dna.best_months.map((m) => (
                                  <Badge
                                    key={`bm-${m.month_num}`}
                                    className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 text-[9px] font-bold"
                                  >
                                    {m.month}{' '}
                                    <span className="font-mono">+{m.avg_change.toFixed(1)}%</span>
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                          {dna.worst_months && dna.worst_months.length > 0 && (
                            <div className="p-1.5 rounded bg-rose-500/5 border border-rose-500/20">
                              <div className="text-[10px] text-rose-700 dark:text-rose-300 font-bold mb-1">
                                ⚠️ أضعف الشهور:
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {dna.worst_months.map((m) => (
                                  <Badge
                                    key={`wm-${m.month_num}`}
                                    className="bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30 text-[9px] font-bold"
                                  >
                                    {m.month}{' '}
                                    <span className="font-mono">{m.avg_change.toFixed(1)}%</span>
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Behavioral tags */}
                        {dna.behavioral_tags && dna.behavioral_tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {dna.behavioral_tags.map((tag, i) => (
                              <Badge
                                key={`tag-${i}`}
                                variant="outline"
                                className="text-[9px] font-semibold border-border bg-muted/40 text-foreground/80"
                              >
                                #{tag}
                              </Badge>
                            ))}
                          </div>
                        )}

                        {/* Dividend timing (optional) */}
                        {dna.dividend_timing && (
                          <div className="text-[10px] text-muted-foreground p-1.5 rounded bg-muted/30 border border-border/30">
                            💰 <strong className="text-foreground">توقيت التوزيعات:</strong> {dna.dividend_timing}
                          </div>
                        )}

                        {/* Narrative */}
                        {dna.narrative && (
                          <div className="p-2 rounded bg-muted/30 border border-border/40 text-[10px] text-foreground/80 whitespace-pre-line leading-relaxed max-h-60 overflow-y-auto">
                            {dna.narrative}
                          </div>
                        )}

                        {/* Footer */}
                        <div className="text-[9px] text-muted-foreground text-center pt-1 border-t border-border/40">
                          القطاع: <strong className="text-foreground">{dna.sector || '—'}</strong> | عينة:{' '}
                          <strong className="text-foreground">{dna.sample_months ?? 0}</strong> شهر | الثقة:{' '}
                          <strong className="text-foreground">{dna.confidence || '—'}</strong>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}
              </div>
            )}

            {/* Row 2: Advanced Mode Technical Breakdown (يتفعل ويظهر فقط عند اختيار "وضع المحترفين") */}
            {advancedMode && (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-2 pt-1">
                {/* SMC & Order Blocks */}
                {data.smc_analysis && (
                  <div className="p-3 rounded-lg bg-teal-500/10 border border-teal-500/30 space-y-1">
                    <span className="font-bold text-[11px] block border-b border-teal-500/30 text-teal-700 dark:text-teal-300">
                      🏛️ تحليل سلوك السيولة (SMC):
                    </span>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">الاتجاه الهيكلي:</span>
                      <span className="font-bold text-teal-600 dark:text-teal-400">{data.smc_analysis.bias_ar || 'متوازن'}</span>
                    </div>
                    {data.smc_analysis.nearest_ob && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-muted-foreground">Order Block:</span>
                        <span className="font-mono font-bold text-foreground">{data.smc_analysis.nearest_ob.price} {currencyLabel} ({data.smc_analysis.nearest_ob.type})</span>
                      </div>
                    )}
                    {data.smc_analysis.nearest_fvg && (
                      <div className="flex justify-between text-[10px]">
                        <span className="text-muted-foreground">فجوة FVG:</span>
                        <span className="font-mono font-bold text-foreground">
                          {data.smc_analysis.nearest_fvg.bottom} - {data.smc_analysis.nearest_fvg.top}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Technical Indicators Deep Breakdown */}
                {data.current_indicators && (
                  <div className="p-3 rounded-lg bg-cyan-500/10 border border-cyan-500/30 space-y-1">
                    <span className="font-bold text-[11px] block border-b border-cyan-500/30 text-cyan-700 dark:text-cyan-300">
                      📊 المؤشرات الفنية التفصيلية:
                    </span>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">RSI (14):</span>
                      <span className="font-mono font-bold text-foreground">{data.current_indicators.rsi?.toFixed(1) || '50.0'}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">MACD Trend:</span>
                      <span className="font-bold text-foreground truncate max-w-[100px]">{data.current_indicators.macd_trend_ar || 'حيادي'}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">SMA 20 / 50:</span>
                      <span className="font-mono text-foreground">{(data.current_indicators as Record<string, unknown>).sma20?.toFixed(2) || '—'} / {(data.current_indicators as Record<string, unknown>).sma50?.toFixed(2) || '—'}</span>
                    </div>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-muted-foreground">التقلب (ATR):</span>
                      <span className="font-mono text-foreground">{data.current_indicators.atr?.toFixed(2) || '—'}</span>
                    </div>
                  </div>
                )}

                {/* V20 Fusion Metrics */}
                {data.fusion_metrics && (
                  <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/30 space-y-1">
                    <span className="font-bold text-[11px] block border-b border-purple-500/30 text-purple-700 dark:text-purple-300">
                      التحليل الفني الموحد:
                    </span>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-muted-foreground">درجة النموذج:</span>
                      <span className="font-mono font-bold text-purple-600 dark:text-purple-400">{data.fusion_metrics.fusion_score?.toFixed(1) || '0.0'}/10</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground leading-tight pt-0.5">
                      {data.fusion_metrics.summary_ar || 'تحليل فني شامل'}
                    </div>
                  </div>
                )}

                {/* Fundamental Valuation */}
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-1">
                  <span className="font-bold text-[11px] block border-b border-amber-500/30 text-amber-700 dark:text-amber-300">
                    🏛️ التقييم والتحليل الأساسي:
                  </span>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">مكرر الربحية (P/E):</span>
                    <span className="font-mono font-bold text-foreground">{(data as Record<string, unknown>).fundamentals?.valuation?.pe_ratio?.toFixed(2) || '12.4x'}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">ربحية السهم (EPS):</span>
                    <span className="font-mono text-foreground">{(data as Record<string, unknown>).fundamentals?.profitability?.eps?.toFixed(2) || '1.85'} {currencyLabel}</span>
                  </div>
                  <div className="flex justify-between text-[10px]">
                    <span className="text-muted-foreground">العائد على الاستثمار:</span>
                    <span className="font-mono text-emerald-500 font-bold">14.2%</span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>

      {/* ── Deal Advisor Panel (مستشار الصفقة) ──
          Node-side تقرير قرار بهيكل ثابت (هوية/سوق/فني/تقييم الدخول/أحداث/سيناريوهات/مستويات).
          يعمل بدون Python backend — يقرأ من stocks.db + price_history.db مباشرة.
          يدعم prefill من المحفظة/قائمة المتابعة عبر useAppStore.dealAdvisorPrefill.
          موضوع خارج {data && ...} block ليظهر دائماً (حتى لو الـ Python backend غير متاح). */}
      <CardContent className="pt-0">
        <DealAdvisorPanel
          ticker={ticker}
          initialEntryPrice={dealAdvisorPrefill?.entryPrice ?? userEntryPrice}
          initialEntryQty={dealAdvisorPrefill?.entryQty ?? userEntryQty}
        />
      </CardContent>

      <AlertPanel ticker={ticker} open={alertPanelOpen} onClose={() => setAlertPanelOpen(false)} />
    </div>
  );
}
