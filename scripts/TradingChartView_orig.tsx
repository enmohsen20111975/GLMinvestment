'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { InteractiveChart } from './InteractiveChart';
import ChartControls from './ChartControls';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Search, AlertTriangle, RefreshCw, TrendingUp, TrendingDown, BarChart3, Target, Activity, Share2, ShoppingCart, Wallet, Bell, BellRing, Star, LayoutGrid, Plus, X, GitCompare, Layers } from 'lucide-react';
import { MultiChartScreener } from '@/components/screener/MultiChartScreener';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { ExchangeSelector } from '@/components/layout/ExchangeSelector';
import { useLiveTicker } from '@/lib/ws-client';
import { useAlerts, useCrossTickerAlerts } from '@/lib/use-alerts';
import { useAlertsStore } from '@/lib/alerts-store';
import { HeartbeatStatusBar, WhaleAlertListener } from '@/components/analysis/LiveDashboard';
import { AlertPanel } from './AlertPanel';
import { toast } from 'sonner';
import { toPng } from 'html-to-image';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// ─── Types ────────────────────────────────────────────────────────────

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

interface FullAnalysisResponse {
  success?: boolean;
  error?: string;
  ticker: string;
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
  project_signals?: {
    maestro_signal?: { signal: string; label_ar: string; score: number; color: string; action: string } | null;
    persona_investor?: unknown;
    persona_gambler?: unknown;
    ai_confidence?: unknown;
  };
  volume_analysis?: { avg_20d: number; recent_5d: number; ratio: number };
  current_indicators?: {
    rsi: number;
    atr: number;
    sma20: number;
    sma50: number;
    sma200: number;
    bb_width: number;
    cmf: number;
    // TOOLKIT-UNIFY-010: MACD + candlestick (unified with maestro)
    macd?: number;
    macd_signal?: number;
    macd_histogram?: number;
    macd_trend?: 'bullish' | 'bearish' | 'bullish_weak' | 'bearish_weak' | 'neutral';
    macd_trend_ar?: string;
    macd_color?: string;
  };
  candlestick_patterns?: Array<{
    name: string;
    name_ar: string;
    signal: 'bullish' | 'bearish' | 'neutral';
    strength: 'weak' | 'medium' | 'strong';
  }>;
  fundamentals?: {
    valuation?: { pe_ratio?: number | null; pb_ratio?: number | null; peg_ratio?: number | null };
    valuation_insights?: Array<{ field: string; value: string | number | null; verdict: string; color: string; text: string }>;
    balance_sheet?: { total_assets?: number | null; total_liabilities?: number | null; solvency_ratio?: number | null };
    balance_sheet_insights?: Array<{ field: string; value: string | number | null; verdict: string; color: string; text: string }>;
    profitability?: { roe?: number | null; profit_margin?: number | null };
    profitability_insights?: Array<{ field: string; value: string | number | null; verdict: string; color: string; text: string }>;
    dividends?: { dividend_yield?: number | null };
    dividends_insights?: Array<{ field: string; value: string | number | null; verdict: string; color: string; text: string }>;
    performance?: { '1w'?: number | null; '1m'?: number | null; '3m'?: number | null };
    performance_insights?: Array<{ field: string; value: string | number | null; verdict: string; color: string; text: string }>;
    technical_analysis?: { overall_rating?: string | null; ma_rating?: string | null; oscillators_rating?: number | null };
    technical_insights?: Array<{ field: string; value: string | number | null; verdict: string; color: string; text: string }>;
  };
  analysis_text?: string | null;
  screener_tags?: {
    tags?: string[];
    list_types?: Record<string, string>;
    is_gold?: boolean;
    is_trap?: boolean;
    has_data?: boolean;
  } | null;
  // POSITION-SIZING-024: position sizing + T+2 cash warning (optional)
  suggested_position_size_pct?: number | null;
  position_warning?: string | null;
  available_cash?: number | null;
  // CHART-UX-030: stock name + user state + aggregation metadata
  name?: string;
  name_ar?: string;
  aggregated_period?: string | null;
  user_state?: 'buyer' | 'owner';
  signal_adjusted?: boolean;
  adjustment_reason?: string;
  // CHART-V2-044: Advanced indicators
  cmf_data?: Array<{ time: string; value: number | null }>;
  vol_z_score?: number;
  macd_projection?: Array<number | null>;
  news_confirmed?: boolean;
  news_title?: string;
  news_source?: string;
  smart_markers?: Array<{
    time: string;
    type: string;
    position: string;
    color: string;
    shape: string;
    text: string;
  }>;
}

interface TradingChartViewProps {
  initialTicker?: string;
}

export function TradingChartView({ initialTicker }: TradingChartViewProps) {
  const { currentMarket, stocks, loadStocks, isLoading: storeLoading, marketOverview, user } = useAppStore();
  const [ticker, setTicker] = useState(initialTicker || 'PHDC');
  const [timeframe, setTimeframe] = useState('MONTH');
  // MULTI-STOCK-COMPARISON: View Mode ('chart' = single detailed chart, 'multi' = multi-charts grid)
  const [viewMode, setViewMode] = useState<'chart' | 'multi'>('chart');
  const [compareTickers, setCompareTickers] = useState<string[]>([]);

  const addCompareTicker = (tk: string) => {
    const clean = tk.trim().toUpperCase();
    if (!clean) return;
    if (clean === ticker.toUpperCase()) {
      toast.info('هذا السهم هو السهم الرئيسي بالفعل');
      return;
    }
    if (compareTickers.includes(clean)) {
      toast.info('السهم مضاف بالفعل في القائمة');
      return;
    }
    if (compareTickers.length >= 4) {
      toast.warning('يمكنك إضافة حتى 4 أسهم فقط للمقارنة');
      return;
    }
    setCompareTickers(prev => [...prev, clean]);
    toast.success(`تمت إضافة ${clean} للمقارنة`);
  };

  const removeCompareTicker = (tk: string) => {
    setCompareTickers(prev => prev.filter(t => t !== tk));
  };
  // CHART-UX-030: User State Toggle (buyer = looking to buy, owner = already holding)
  const [userState, setUserState] = useState<'buyer' | 'owner'>('buyer');
  const [data, setData] = useState<FullAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localSearch, setLocalSearch] = useState('');
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
  const [publishing, setPublishing] = useState(false);

  // Phase 8 — UI Diet: "وضع المحترفين" (Advanced Mode) toggle.
  // default = false → العميل بيشوف بس: Score Card + Trade Plan (الإشارة، الدخول، الهدف، الوقف، السبب).
  // advanced = true  → بيظهر بقية الأقسام التقنية (Technical / Fundamental / Pine Script / News / SMC / V20 Fusion).
  const [advancedMode, setAdvancedMode] = useState(false);

  // ALERTS-031: Alert panel open state + alert count badge
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);
  // Use the live `ticker` state (not initialTicker) so the badge updates when
  // the user switches stocks. Count enabled alerts only.
  const activeAlertsCount = useAlertsStore(
    (s) => s.alerts.filter(a => a.ticker === ticker.toUpperCase() && a.enabled).length,
  );

  const fetchData = useCallback(async (tk: string, tf: string, state: 'buyer' | 'owner' = 'buyer') => {
    setLoading(true);
    setError(null);
    try {
      // CHART-UX-030: Updated LIMIT_MAP — fetch enough daily candles for proper
      // weekly/monthly aggregation in the backend.
      // BRIEF-049: أضفنا 5M, 15M, 1H للفريمات اللحظية (Intraday)
      //   5M/15M/1H → بيانات intraday من intraday.db (5-min candles)
      //   TODAY/WEEK → بيانات intraday (آخر 7 أيام)
      //   DAY     → 365 daily candles (1 year)
      //   WEEK    → 730 daily candles (2 years → ~104 weekly after aggregation)
      //   MONTH   → 1825 daily candles (5 years → ~60 monthly after aggregation)
      //   3MONTH/6MONTH/YEAR/ALL → daily candles with the requested range
      const LIMIT_MAP: Record<string, number> = {
        '5M': 500,      // BRIEF-049: 500 شمعة 5 دقايق
        '15M': 500,     // BRIEF-049: 500 شمعة 15 دقيقة
        '1H': 500,      // BRIEF-049: 500 شمعة ساعة
        TODAY: 200,
        DAY: 365,
        WEEK: 730,
        MONTH: 1825,
        '3MONTH': 90,
        '6MONTH': 180,
        YEAR: 365,
        ALL: 500,
      };
      const limit = LIMIT_MAP[tf] || 365;
      // POSITION-SIZING-024: pass user_id (if logged in) so Python backend can
      // compute available_cash (T+2) + suggested_position_size_pct for this user.
      const userId = user?.id || '';
      const userIdParam = userId ? `&user_id=${encodeURIComponent(userId)}` : '';
      // CHART-UX-030: pass user_state (buyer/owner) so backend adjusts the signal
      const stateParam = `&state=${state}`;
      const res = await fetch(`/api/v2/chart/full-analysis?ticker=${encodeURIComponent(tk)}&timeframe=${tf}&limit=${limit}${userIdParam}${stateParam}&_t=${Date.now()}`);
      const json = await res.json();
      if (!json.success) {
        setError(json.error || `خطأ في تحميل بيانات ${tk}`);
        return;
      }
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'فشل تحميل البيانات');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  // CHART-UX-030: refetch when userState changes (so signal adjusts immediately)

  useEffect(() => {
    loadStocks('');
  }, [currentMarket, loadStocks]);

  useEffect(() => {
    if (stocks && stocks.length > 0) {
      const tickerExists = stocks.some(s => s.ticker === ticker);
      if (!tickerExists) {
        const defaultTicker = stocks[0]?.ticker;
        if (defaultTicker) setTicker(defaultTicker);
      }
    }
  }, [currentMarket, stocks]);

  useEffect(() => {
    if (ticker) fetchData(ticker, timeframe, userState);
  }, [ticker, timeframe, userState, fetchData]);

  // ── BRIEF-048: Real-time Chart Sync (polling كل 5 دقايق) ──
  // الشارت بيتحدث تلقائياً كل 5 دقايق بدون ما المستخدم يعمل refresh
  const [isLivePolling, setIsLivePolling] = useState(true);
  const [lastUpdateTime, setLastUpdateTime] = useState<string>('');

  useEffect(() => {
    if (!isLivePolling || !ticker) return;

    // تحديث فوري للأول مرة
    setLastUpdateTime(new Date().toLocaleTimeString('ar-EG'));

    // Polling كل 5 دقايق (300000 ms)
    const pollInterval = setInterval(() => {
      console.log('[BRIEF-048] Auto-refreshing chart data (5-min poll)...');
      fetchData(ticker, timeframe, userState);
      setLastUpdateTime(new Date().toLocaleTimeString('ar-EG'));
    }, 300000); // 5 minutes

    return () => clearInterval(pollInterval);
  }, [ticker, timeframe, userState, isLivePolling, fetchData]);

  // تحديث lastUpdateTime بعد كل fetch ناجح
  useEffect(() => {
    if (data) {
      setLastUpdateTime(new Date().toLocaleTimeString('ar-EG'));
    }
  }, [data]);

  useEffect(() => {
    if (initialTicker && initialTicker !== ticker) setTicker(initialTicker);
  }, [initialTicker]);

  const handleIndicatorToggle = (key: string, value: boolean) => {
    setVisibleIndicators(prev => ({ ...prev, [key]: value }));
  };

  const filteredStocks = (stocks || []).filter(s =>
    s.ticker.toLowerCase().includes(localSearch.toLowerCase()) ||
    (s.name_ar && s.name_ar.toLowerCase().includes(localSearch.toLowerCase())) ||
    (s.name && s.name.toLowerCase().includes(localSearch.toLowerCase()))
  );

  // ─── Single-Viewport Wrapper Ref (captures chart + sidebar for screenshot) ───
  const chartViewRef = useRef<HTMLDivElement>(null);

  // ─── LIVE-ENGINE-028: WebSocket Live Ticker ───
  const { liveData, isLive } = useLiveTicker(ticker);

  // ─── ALERTS-031: Monitor live data against user-defined alerts ───
  useAlerts(ticker, liveData);
  useCrossTickerAlerts();

  const handlePublish = async () => {
    if (!chartViewRef.current || !data) {
      toast.error('لا توجد بيانات للنشر', {
        description: 'افتح سهمًا وانتظر تحميل الشارت أولًا.',
      });
      return;
    }
    if (publishing) return;
    setPublishing(true);
    try {
      // ── 1) التقاط لقطة شاشة للشارت + الـ sidebar (Single-Viewport كامل) ──
      const dataUrl = await toPng(chartViewRef.current, {
        backgroundColor: '#131722',
        pixelRatio: 2,
        quality: 0.95,
        cacheBust: true,
      });

      // ── 2) تجهيز الـ caption التفصيلي ──
      const tk = data.ticker || '---';
      const stockName = stocks.find(s => s.ticker === data.ticker)?.name_ar || '';
      const signal = data.confluence?.signal || '---';
      const score = data.confluence?.score ?? 0;
      const regimeAr = data.market_regime?.regime_ar || data.market_regime?.regime || '---';
      const entry = data.risk?.entry;
      const target = data.risk?.target;
      const stop = data.risk?.stop_loss;
      const rrRatio = data.risk?.rr_ratio;
      const fmt = (v?: number) => (v != null ? v.toFixed(2) : '---');

      const caption = [
        `📊 تحليل ${tk}${stockName ? ` — ${stockName}` : ''}`,
        `🎯 الإشارة: ${signal} (${score}%)`,
        `📈 النظام: ${regimeAr}`,
        `💰 دخول: ${fmt(entry)} | هدف: ${fmt(target)} | وقف: ${fmt(stop)}`,
        `⚖️ R:R: ${rrRatio != null ? rrRatio.toFixed(2) : '---'}`,
        '🔗 invist.m2y.net',
      ].join('\n');

      // ── 3) إرسال الصورة + الـ caption للـ Python backend ──
      const res = await fetch('/api/market/publish-status-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: dataUrl,
          market: 'EGX',
          caption,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        json = { success: false, error_ar: `استجابة غير صالحة من الخادم (${res.status})` };
      }
      if (json.success) {
        toast.success('تم نشر التقرير بنجاح! ✅', {
          description: 'تم رفع الصورة والـ caption على قناة تيليجرام.',
        });
      } else {
        const errMsg = json.error_ar || json.error || 'فشل النشر';
        const lower = String(errMsg).toLowerCase();
        let hint = 'حاول مرة أخرى بعد قليل.';
        if (lower.includes('credentials') || lower.includes('api') || lower.includes('telegram')) {
          hint = 'تأكد من إعداد بوت تيليجرام (API credentials) في الخادم.';
        } else if (lower.includes('network') || lower.includes('fetch') || lower.includes('econnrefused')) {
          hint = 'تأكد من اتصال الإنترنت وأن خادم Python يعمل على المنفذ 8010.';
        } else if (lower.includes('timeout') || lower.includes('abort')) {
          hint = 'انتهت مهلة النشر — حاول مرة أخرى أو صغّر حجم الصورة.';
        } else if (res.status === 400) {
          hint = 'الصورة المُرسلة غير صالحة — تأكد من تحميل الشارت بالكامل.';
        } else if (res.status >= 500) {
          hint = 'مشكلة في الخادم — أبلغ الإدارة إذا تكررت.';
        }
        toast.error(`فشل النشر: ${errMsg}`, { description: hint });
      }
    } catch (err: any) {
      const msg = err?.name === 'AbortError'
        ? 'انتهت مهلة الطلب'
        : (err instanceof Error ? err.message : 'خطأ غير معروف');
      let hint = 'حاول مرة أخرى.';
      if (err?.name === 'AbortError') {
        hint = 'العملية استغرقت وقتًا طويلًا — تأكد من سرعة الإنترنت.';
      } else if (msg.toLowerCase().includes('network') || msg.toLowerCase().includes('fetch')) {
        hint = 'تأكد من اتصال الإنترنت وأن المتصفح متصل بالخادم.';
      }
      toast.error(`فشل في التقاط الصورة: ${msg}`, { description: hint });
    } finally {
      setPublishing(false);
    }
  };

  // ─── Helpers for compact sidebar ────────────────────────────────────
  const fmt = (v?: number | null) => (v != null && !Number.isNaN(v) ? v.toFixed(2) : '---');

  const signal = data?.confluence?.signal || '---';
  const score = data?.confluence?.score ?? 0;
  const signalColor =
    signal === 'BUY' ? '#22c55e' :
    signal === 'SELL' ? '#ef4444' :
    signal === 'HOLD' ? '#eab308' :
    '#a1a1aa';

  const entry = data?.risk?.entry;
  const target = data?.risk?.target;
  const stop = data?.risk?.stop_loss;
  const rrRatio = data?.risk?.rr_ratio;
  const targetPct = (entry && target) ? ((target - entry) / entry) * 100 : null;
  const stopPct = (entry && stop) ? ((stop - entry) / entry) * 100 : null;

  const rsiVal = data?.current_indicators?.rsi;
  const atrVal = data?.current_indicators?.atr;
  const volRatio = data?.volume_analysis?.ratio;
  const bbSqState = data?.bb_squeeze?.state;
  const bbSqIsSqueeze = bbSqState && bbSqState !== 'normal';
  const bbSqText = bbSqIsSqueeze ? 'نعم' : 'لا';
  const bbSqColor = bbSqIsSqueeze ? (data?.bb_squeeze?.color || '#f59e0b') : '#a1a1aa';

  // TOOLKIT-UNIFY-010: MACD value + trend for quick indicators
  const macdVal = data?.current_indicators?.macd;
  const macdTrendAr = data?.current_indicators?.macd_trend_ar;
  const macdColor = data?.current_indicators?.macd_color || '#a1a1aa';

  // TOOLKIT-UNIFY-010: latest candlestick pattern (most informative)
  const candlePatterns = data?.candlestick_patterns || [];
  const lastCandlePattern = candlePatterns.length > 0 ? candlePatterns[candlePatterns.length - 1] : null;
  const candlePatternColor =
    lastCandlePattern?.signal === 'bullish' ? '#22c55e' :
    lastCandlePattern?.signal === 'bearish' ? '#ef4444' :
    '#a1a1aa';

  // Truncate analysis_text to ~3 lines (~240 chars)
  const baladiText = data?.analysis_text
    ? (data.analysis_text.length > 240
      ? data.analysis_text.slice(0, 240).trim() + '…'
      : data.analysis_text)
    : null;

  // POSITION-SIZING-024: suggested position size + T+2 cash warning
  const suggestedPositionSizePct = data?.suggested_position_size_pct ?? null;
  const positionWarning = data?.position_warning ?? null;
  const availableCash = data?.available_cash ?? null;

  return (
    <div
      ref={chartViewRef}
      dir="rtl"
      className="flex flex-col h-full min-h-0 overflow-hidden bg-background text-foreground gap-1.5 p-1.5 md:p-2"
    >
      {/* BRIEF-048: Whale Alert Listener (صامت - بيشتغل في الخلفية) */}
      <WhaleAlertListener />

      {/* ─── Compact Header (shrink-0) ──────────────────────────────── */}
      <div className="flex flex-col gap-1.5 shrink-0">
        {/* BRIEF-048: Heartbeat Status Bar */}
        <div className="flex items-center justify-end">
          <HeartbeatStatusBar />
        </div>
        {/* Row 1: Ticker + Badges + Actions */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm md:text-base font-bold text-foreground font-mono">{ticker}</span>
            {data && (
              <span className="text-[10px] md:text-xs text-muted-foreground font-medium truncate">
                {/* CHART-UX-030: prefer backend name_ar/name, then stocks list, then ticker */}
                {data.name_ar || data.name || stocks.find(s => s.ticker === ticker)?.name_ar || stocks.find(s => s.ticker === ticker)?.name || ''}
              </span>
            )}
            {data?.market_regime && (
              <Badge
                variant="outline"
                className="text-[9px] md:text-[10px] border-border bg-card hidden sm:flex"
                style={{ borderColor: data.market_regime.color || '#666', color: data.market_regime.color || 'currentColor' }}
              >
                {data.market_regime.regime_ar || data.market_regime.regime}
              </Badge>
            )}
            {/* LIVE-ENGINE-028: LIVE badge */}
            {isLive && (
              <Badge className="text-[9px] md:text-[10px] bg-red-600 text-white animate-pulse flex items-center gap-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" />
                LIVE
              </Badge>
            )}
            {/* BRIEF-048: Live Auto-Refresh indicator (polling كل 5 دقايق) */}
            {isLivePolling && (
              <Badge
                className="text-[9px] md:text-[10px] bg-emerald-600 text-white flex items-center gap-0.5 cursor-pointer"
                onClick={() => setIsLivePolling(!isLivePolling)}
                title={`تحديث تلقائي كل 5 دقايق | آخر تحديث: ${lastUpdateTime}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                🔄 {lastUpdateTime ? `محدث ${lastUpdateTime}` : 'Live'}
              </Badge>
            )}
            {!isLivePolling && (
              <Badge
                className="text-[9px] md:text-[10px] bg-muted text-muted-foreground cursor-pointer"
                onClick={() => setIsLivePolling(true)}
                title="التحديث التلقائي متوقف - اضغط للتفعيل"
              >
                ⏸️ متوقف
              </Badge>
            )}
            {/* Pine Script: Dead Cat Bounce warning */}
            {liveData?.is_dead_cat && (
              <Badge className="text-[9px] md:text-[10px] bg-red-900 text-red-300 border border-red-700 animate-pulse">
                ⚠️ فخ ارتداد!
              </Badge>
            )}
            {/* Pine Script: Golden Pullback */}
            {liveData?.is_golden_pullback && (
              <Badge className="text-[9px] md:text-[10px] bg-lime-900 text-lime-300 border border-lime-700">
                🟢 تصحيح ذهبي
              </Badge>
            )}
            {/* Pine Script: Bullish Divergence */}
            {liveData?.is_bullish_divergence && (
              <Badge className="text-[9px] md:text-[10px] bg-blue-900 text-blue-300 border border-blue-700">
                📊 تباعد إيجابي
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-1">
            {data?.bb_squeeze && data.bb_squeeze.state !== 'normal' && (
              <Badge
                variant="outline"
                className="text-[9px] md:text-[10px] hidden md:flex"
                style={{ borderColor: data.bb_squeeze.color, color: data.bb_squeeze.color }}
              >
                {data.bb_squeeze.text}
              </Badge>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchData(ticker, timeframe, userState)}
              disabled={loading}
              title="تحديث"
              className="h-8 w-8 md:h-7 md:w-7 p-0 text-muted-foreground hover:text-white hover:bg-muted touch-manipulation shrink-0"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {/* SCREENER-046: ⭐ Add to Watchlist button */}
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                try {
                  // Ensure user has a default watchlist, then add ticker
                  const wlRes = await fetch('/api/portfolio/watchlists?user_id=default');
                  const wlData = await wlRes.json();
                  let wlId = wlData.watchlists?.[0]?.id;
                  if (!wlId) {
                    // Create default watchlist
                    const createRes = await fetch('/api/portfolio/watchlists', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ user_id: 'default', name: 'قائمتي', tickers: [] }),
                    });
                    const createData = await createRes.json();
                    wlId = createData.watchlist?.id;
                  }
                  if (wlId) {
                    await fetch('/api/portfolio/watchlists', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'add', watchlist_id: wlId, ticker }),
                    });
                    toast.success(`⭐ تمت إضافة ${ticker} لقائمة المتابعة`);
                  }
                } catch {
                  toast.error('فشل إضافة السهم لقائمة المتابعة');
                }
              }}
              title="إضافة لقائمة المتابعة"
              className="h-8 w-8 md:h-7 md:w-7 p-0 text-muted-foreground hover:text-amber-400 hover:bg-muted touch-manipulation shrink-0"
            >
              <Star className="h-3.5 w-3.5" />
            </Button>
            {/* ALERTS-031: Alerts button + badge */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAlertPanelOpen(true)}
              title="التنبيهات"
              className="relative h-8 w-8 md:h-7 md:w-7 p-0 text-muted-foreground hover:text-amber-400 hover:bg-muted touch-manipulation shrink-0"
            >
              {activeAlertsCount > 0 ? (
                <BellRing className="h-3.5 w-3.5 text-amber-400" />
              ) : (
                <Bell className="h-3.5 w-3.5" />
              )}
              {activeAlertsCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] px-1 flex items-center justify-center rounded-full bg-amber-500 text-[8px] font-bold text-white">
                  {activeAlertsCount}
                </span>
              )}
            </Button>
          </div>
        </div>

        {/* CHART-UX-030: Row 1.5 — User State Toggle (Buyer / Owner) */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] md:text-xs text-muted-foreground font-medium shrink-0">
            وضعي:
          </span>
          <div className="flex items-center gap-0.5 bg-background border border-border rounded-md p-0.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setUserState('buyer')}
              className={`h-6 px-2 text-[10px] md:text-xs font-medium rounded transition-all ${
                userState === 'buyer'
                  ? 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 hover:text-emerald-400'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              title="أبحث عن فرصة شراء — النظام يحذّرني من التشبع الشرائي"
            >
              <ShoppingCart className="w-3 h-3 ml-1 inline" />
              أبحث عن شراء
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setUserState('owner')}
              className={`h-6 px-2 text-[10px] md:text-xs font-medium rounded transition-all ${
                userState === 'owner'
                  ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 hover:text-amber-400'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
              title="أملك السهم — النظام ينصحني بتحقيق الربح عند التشبع"
            >
              <Wallet className="w-3 h-3 ml-1 inline" />
              أملك السهم
            </Button>
          </div>
          {/* CHART-UX-030: Show adjustment reason if signal was overridden */}
          {data?.signal_adjusted && data?.adjustment_reason && (
            <Badge variant="outline" className="text-[9px] md:text-[10px] bg-muted text-muted-foreground border-border font-normal whitespace-normal break-words max-w-xl line-clamp-2">
              <span className="font-bold ml-1">{userState === 'owner' ? '💼' : '🛒'}</span>
              {data.adjustment_reason}
            </Badge>
          )}
          {/* CHART-UX-030: Show aggregation badge if weekly/monthly */}
          {data?.aggregated_period && (
            <Badge variant="outline" className="text-[9px] md:text-[10px] text-cyan-400 border-cyan-800 bg-cyan-950/30">
              📅 {data.aggregated_period === 'WEEK' ? 'أسبوعي' : data.aggregated_period === 'MONTH' ? 'شهري' : data.aggregated_period}
            </Badge>
          )}
        </div>

        {/* Row 2: Market + Search + Select + Comparison Controls */}
        <div className="flex items-center gap-1 md:gap-1.5 flex-wrap">
          <ExchangeSelector compact className="h-7 md:h-6 py-0 shrink-0" />

          {marketOverview && (
            <div className="hidden lg:flex items-center gap-1 shrink-0">
              <Badge variant="outline" className="text-[9px] text-emerald-400 border-emerald-800 flex items-center gap-0.5 px-1 py-0.5">
                <TrendingUp className="w-2.5 h-2.5" />
                <span className="hidden xl:inline">ارتفاعات:</span> {marketOverview.summary.gainers}
              </Badge>
              <Badge variant="outline" className="text-[9px] text-red-400 border-red-800 flex items-center gap-0.5 px-1 py-0.5">
                <TrendingDown className="w-2.5 h-2.5" />
                <span className="hidden xl:inline">خسائر:</span> {marketOverview.summary.losers}
              </Badge>
            </div>
          )}

          {/* MULTI-STOCK-COMPARISON: View mode switcher */}
          <div className="flex items-center gap-0.5 bg-muted/60 p-0.5 rounded-md border border-border shrink-0">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setViewMode('chart')}
              className={cn(
                "h-7 md:h-6 px-2 text-[10px] md:text-xs font-semibold rounded transition-all",
                viewMode === 'chart'
                  ? "bg-background text-emerald-600 dark:text-emerald-400 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="عرض الشارت الشامل للسهم مع الخطة والتحليل"
            >
              <TrendingUp className="w-3 h-3 ml-1" />
              شارت شامل
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setViewMode('multi')}
              className={cn(
                "h-7 md:h-6 px-2 text-[10px] md:text-xs font-semibold rounded transition-all",
                viewMode === 'multi'
                  ? "bg-background text-teal-600 dark:text-teal-400 shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
              title="عرض شاشات ومقارنة الأسهم المتعددة"
            >
              <LayoutGrid className="w-3 h-3 ml-1" />
              مقارنة الشاشات
            </Button>
          </div>

          <div className="relative flex-1 min-w-[80px] max-w-[120px] md:max-w-[150px]">
            <Search className="absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              value={localSearch}
              onChange={e => setLocalSearch(e.target.value)}
              placeholder="بحث..."
              className="pr-6 h-7 md:h-6 text-[10px] md:text-xs bg-background border-input text-foreground placeholder:text-muted-foreground touch-manipulation"
            />
          </div>

          <Select value={ticker} onValueChange={setTicker} dir="rtl">
            <SelectTrigger className="h-7 md:h-6 text-[10px] md:text-xs bg-background border-input text-foreground touch-manipulation w-[95px] md:w-[115px]">
              <SelectValue placeholder="اختر السهم" />
            </SelectTrigger>
            <SelectContent className="max-h-48 bg-popover border-border">
              {storeLoading ? (
                <div className="p-2 text-xs text-muted-foreground">جاري...</div>
              ) : filteredStocks.length > 0 ? (
                filteredStocks.slice(0, 30).map(s => {
                  const isUp = s.price_change !== null ? s.price_change >= 0 : true;
                  return (
                    <SelectItem key={s.ticker} value={s.ticker} className="text-xs text-foreground focus:bg-muted">
                      <div className="flex items-center justify-between gap-2 w-full">
                        <span className="font-mono font-bold">{s.ticker}</span>
                        <span className="text-[10px] text-muted-foreground truncate">{s.name_ar || s.name}</span>
                        {s.price_change !== null && (
                          <span className={`text-[10px] ${isUp ? 'text-emerald-500' : 'text-red-500'}`}>
                            {isUp ? '+' : ''}{s.price_change.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </SelectItem>
                  );
                })
              ) : (
                <div className="p-2 text-xs text-muted-foreground">لا يوجد</div>
              )}
            </SelectContent>
          </Select>

          {/* MULTI-STOCK-COMPARISON: Add comparison stock dropdown */}
          <Select onValueChange={(v) => addCompareTicker(v)} dir="rtl">
            <SelectTrigger className="h-7 md:h-6 text-[10px] md:text-xs bg-emerald-50 dark:bg-emerald-950/40 border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 touch-manipulation w-[110px] md:w-[130px] font-bold">
              <Plus className="w-3 h-3 ml-1 text-emerald-600 dark:text-emerald-400" />
              <SelectValue placeholder="+ مقارنة سهم" />
            </SelectTrigger>
            <SelectContent className="max-h-48 bg-popover border-border">
              {filteredStocks.slice(0, 30).map(s => (
                <SelectItem key={`comp-${s.ticker}`} value={s.ticker} className="text-xs text-foreground focus:bg-muted">
                  <div className="flex items-center justify-between gap-2 w-full">
                    <span className="font-mono font-bold">{s.ticker}</span>
                    <span className="text-[10px] text-muted-foreground truncate">{s.name_ar || s.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* MULTI-STOCK-COMPARISON: Active Comparison Badges Bar */}
        {compareTickers.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap p-1.5 bg-teal-500/10 border border-teal-500/30 rounded-lg">
            <span className="text-[10px] md:text-xs font-bold text-teal-700 dark:text-teal-300 flex items-center gap-1">
              <GitCompare className="w-3.5 h-3.5 text-teal-500" />
              أسهم المقارنة ({compareTickers.length}):
            </span>
            <Badge variant="secondary" className="text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-400">
              📌 {ticker} (رئيسي)
            </Badge>
            {compareTickers.map((t) => {
              const st = stocks.find(s => s.ticker === t);
              return (
                <Badge key={t} variant="outline" className="text-[10px] font-mono bg-background border-border flex items-center gap-1 py-0.5 px-2">
                  <span>{st?.name_ar || t}</span>
                  <span className="text-muted-foreground font-bold">({t})</span>
                  <button
                    type="button"
                    onClick={() => removeCompareTicker(t)}
                    className="hover:text-rose-500 transition-colors ml-0.5 p-0.5"
                    title={`إزالة ${t} من المقارنة`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              );
            })}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setCompareTickers([])}
              className="h-5 px-1.5 text-[9px] text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950"
            >
              مسح الكل
            </Button>
          </div>
        )}

        {/* BOS Events */}
        {data?.bos_events && data.bos_events.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {data.bos_events.slice(0, 3).map((bos, i) => (
              <Badge
                key={i}
                variant="outline"
                className="text-[9px] md:text-[10px]"
                style={{ borderColor: bos.type === 'bos_up' ? '#22c55e' : '#ef4444', color: bos.type === 'bos_up' ? '#22c55e' : '#ef4444' }}
              >
                {bos.type === 'bos_up' ? '⬆ BOS' : '⬇ BOS'} @ {bos.price}
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* ALERTS-031: Alert Panel (slide-in from right) */}
      <AlertPanel
        ticker={ticker}
        open={alertPanelOpen}
        onClose={() => setAlertPanelOpen(false)}
      />

      {/* ─── Error ───────────────────────────────────────────────────── */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-950/40 border border-red-800/30 text-red-300 text-xs shrink-0">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ─── MULTI-STOCK-COMPARISON: Canvas Router ─── */}
      {viewMode === 'multi' ? (
        <div className="flex-1 min-h-[75vh] rounded-xl overflow-hidden border border-border">
          <MultiChartScreener />
        </div>
      ) : (
        /* ─── CHART-PRO-048: 3-Section Layout (OHLCV يسار / شارت وسط / Accordion يمين) ─── */
        <div className="flex flex-col lg:flex-row flex-1 min-h-0 gap-1.5">

        {/* ─── 1. OHLCV Box (أقصى اليسار — يتحدث من WebSocket) ─── */}
        <div className="hidden lg:flex flex-col w-44 flex-shrink-0 bg-background border border-border rounded-lg p-3 gap-2">
          <div className="text-[10px] text-muted-foreground font-bold border-b border-border pb-1 mb-1">السعر اللحظي</div>
          {/* OHLCV values from today_candle / liveData */}
          {(() => {
            const tc = liveData?.today_candle || data?.ohlcv?.[data.ohlcv.length - 1];
            const livePrice = liveData?.today_candle?.close ?? tc?.close ?? 0;
            const prevClose = data?.ohlcv?.[data.ohlcv.length - 2]?.close ?? livePrice;
            const chgPct = prevClose > 0 ? ((livePrice - prevClose) / prevClose * 100) : 0;
            const isUp = chgPct >= 0;
            return (
              <>
                <div className="text-center">
                  <div className="text-[9px] text-muted-foreground">السعر</div>
                  <div className={`text-xl font-bold font-mono ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                    {livePrice.toFixed(2)}
                  </div>
                  <div className={`text-[10px] font-medium ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>
                    {isUp ? '+' : ''}{chgPct.toFixed(2)}%
                  </div>
                </div>
                <div className="space-y-1 text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Open</span>
                    <span className="text-foreground font-mono">{(tc?.open ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">High</span>
                    <span className="text-emerald-400 font-mono">{(tc?.high ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Low</span>
                    <span className="text-red-400 font-mono">{(tc?.low ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Close</span>
                    <span className="text-foreground font-mono">{(tc?.close ?? 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Vol</span>
                    <span className="text-foreground font-mono">{(tc?.volume ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
                {/* LIVE badge */}
                {isLive && (
                  <div className="flex items-center justify-center gap-1 mt-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
                    <span className="text-[9px] text-red-400 font-bold">LIVE</span>
                  </div>
                )}
                {/* Score from liveData */}
                {liveData?.score != null && (
                  <div className="border-t border-border pt-2 mt-1 text-center">
                    <div className="text-[9px] text-muted-foreground">Live Score</div>
                    <div className="text-lg font-bold font-mono text-amber-400">{liveData.score.toFixed(0)}</div>
                    {liveData.signal_ar && (
                      <div className="text-[9px] text-emerald-400">{liveData.signal_ar}</div>
                    )}
                  </div>
                )}
              </>
            );
          })()}
        </div>

        {/* ─── 2. Chart Area (المنتصف — يأخذ المساحة المتبقية) ─── */}
        <div className="flex-1 flex flex-col gap-1.5 min-w-0 min-h-0 overflow-y-auto">
          {/* Sticky Timeframe + Indicator Controls (CHART-UX: sticky on scroll) */}
          <div className="sticky top-0 z-30 -mx-1 px-1">
            <ChartControls
              timeframe={timeframe}
              onTimeframeChange={setTimeframe}
              indicators={visibleIndicators}
              onIndicatorToggle={handleIndicatorToggle}
            />
          </div>

          {/* Chart Controls + Indicators above chart */}
          <div className="flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-lg text-[10px] md:text-xs shrink-0 overflow-x-auto">
            {/* Indicators Toggles */}
            <span className="text-muted-foreground font-bold whitespace-nowrap">عرض:</span>
            {[
              { key: 'sma20', label: 'SMA 20' },
              { key: 'sma50', label: 'SMA 50' },
              { key: 'sma200', label: 'SMA 200' },
              { key: 'ema', label: 'EMA 9/21' },
              { key: 'bb', label: 'Bollinger' },
              { key: 'macd', label: 'MACD' },
              { key: 'rsi', label: 'RSI' },
              { key: 'volume', label: 'الحجم' },
              { key: 'fibonacci', label: 'فيبوناتشي' },
              { key: 'levels', label: 'دعم/مقاومة' },
              { key: 'bos', label: 'BOS' },
            ].map((item) => (
              <label key={item.key} className="flex items-center gap-1 cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={visibleIndicators[item.key] ?? false}
                  onChange={(e) => handleIndicatorToggle(item.key, e.target.checked)}
                  className="w-3 h-3 accent-emerald-500"
                />
                <span className="text-muted-foreground">{item.label}</span>
              </label>
            ))}
          </div>

          {/* Chart itself — single chart (P6-CHART: multi-chart grid removed, always single) */}
          <Card className="bg-card text-card-foreground border-border h-[600px] md:h-[700px] flex flex-col">
              <CardContent className="p-0 flex-1 min-h-0 flex flex-col">
                {loading && !data ? (
                  <div className="flex-1 min-h-0 flex items-center justify-center">
                    <Skeleton className="h-full w-full rounded-md" />
                  </div>
                ) : data && data.ohlcv && data.ohlcv.length > 0 ? (
                  <div className="flex-1 min-h-0 relative">
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
                      cmfData={data.cmf_data}
                      macdProjection={data.macd_projection}
                      smartMarkers={data.smart_markers}
                      smcData={data.smc_data}
                      fusionMetrics={data.fusion_metrics}
                    />
                  </div>
                ) : (
                  <div className="flex-1 min-h-0 flex items-center justify-center text-muted-foreground text-xs">
                    لا توجد بيانات
                  </div>
                )}
              </CardContent>
            </Card>

          {/* Future Bar */}
          {data && (
            <div className="shrink-0 flex items-center justify-center gap-4 px-4 py-2 rounded-lg bg-background/60 border border-border text-[10px] md:text-xs">
              <span className="flex items-center gap-1">
                ⚙️ مرآة الزخم:
                <span className={(data.current_indicators?.macd ?? 0) >= 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                  {(data.current_indicators?.macd ?? 0) >= 0 ? 'إيجابي' : 'سلبي'}
                </span>
              </span>
              <span className="text-muted">|</span>
              <span className="flex items-center gap-1">
                🔮 التوقع:
                <span className={(data.macd_projection?.some(v => v !== null && v > 0)) ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                  {(data.macd_projection?.some(v => v !== null && v > 0)) ? 'صاعد' : 'هابط'}
                </span>
              </span>
              <span className="text-muted">|</span>
              <span className="flex items-center gap-1">
                📊 المؤسسات:
                <span className={(data.cmf_data?.[data.cmf_data.length - 1]?.value ?? 0) > 0 ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
                  {(data.cmf_data?.[data.cmf_data.length - 1]?.value ?? 0) > 0 ? 'شراء' : 'بيع'}
                </span>
              </span>
            </div>
          )}

        </div>

        {/* ─── 3. Analysis Accordion (أقصى اليمين — قابل للطي) ─── */}
        <div className="lg:w-72 lg:flex-shrink-0 lg:min-h-0 lg:overflow-y-auto overflow-x-hidden bg-background border border-border rounded-lg p-2 space-y-2">

          {/* Phase 8 — UI Diet: «وضع المحترفين» (Advanced Mode) toggle.
              default OFF → العميل بيشوف بس: Score Card + Trade Plan (الإشارة، الدخول، الهدف، الوقف، السبب).
              ON → بيظهر بقية الأقسام التقنية (Technical / Fundamental / Pine Script / News / SMC / V20 Fusion). */}
          <div className="flex items-center justify-between gap-2 bg-muted/40 rounded-lg p-2 border border-border">
            <div className="flex flex-col">
              <span className="text-[11px] font-bold text-foreground">وضع المحترفين</span>
              <span className="text-[9px] text-muted-foreground leading-tight">
                {advancedMode ? 'كل التفاصيل التقنية ظاهرة' : 'الأساسيات بس (الإشارة، الدخول، الهدف، الوقف)'}
              </span>
            </div>
            <Switch
              checked={advancedMode}
              onCheckedChange={setAdvancedMode}
              aria-label="وضع المحترفين - إظهار التفاصيل التقنية المتقدمة"
              className="scale-90 origin-left"
            />
          </div>

          {/* Score Card (مفتوح دايماً) */}
          <div className="bg-muted/50 rounded-lg p-3 text-center">
            <div className="text-[10px] text-muted-foreground mb-1">النتيجة الإجمالية</div>
            <div className="text-3xl font-bold font-mono" style={{ color: signalColor }}>
              {score}<span className="text-sm text-muted-foreground">/100</span>
            </div>
            <div className="text-sm font-medium" style={{ color: signalColor }}>{signal}</div>
            {data?.confluence?.signal && (
              <Badge className="mt-1.5 text-[9px] bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                {data.confluence.signal}
              </Badge>
            )}
            {data?.humanized_reason && (
              <div className="mt-2 text-[10px] text-muted-foreground border-t border-border pt-2 leading-relaxed">
                {data.humanized_reason}
              </div>
            )}
          </div>

          {/* ── Phase 8: الأقسام التقنية (Technical + Fundamental) — بتظهر بس في وضع المحترفين ── */}
          {advancedMode && (
            <>
          {/* Technical Analysis (قابل للطي) */}
          <details className="bg-muted/50 rounded-lg p-3" open>
            <summary className="cursor-pointer font-bold text-xs text-cyan-500 dark:text-cyan-400">التحليل الفني (Technical)</summary>
            <div className="mt-2 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">مؤشر القوة النسبية (RSI 14):</span>
                <span className={`font-mono font-bold ${(data?.current_indicators?.rsi ?? 50) > 70 ? 'text-red-500 dark:text-red-400' : (data?.current_indicators?.rsi ?? 50) < 30 ? 'text-emerald-500 dark:text-emerald-400' : 'text-foreground'}`}>
                  {(data?.current_indicators?.rsi ?? 0).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">هستوجرام الماكد (MACD Hist):</span>
                <span className={`font-mono font-bold ${(data?.current_indicators?.macd_histogram ?? 0) >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                  {(data?.current_indicators?.macd_histogram ?? 0).toFixed(4)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">اتجاه الماكد (MACD Trend):</span>
                <span className="text-foreground">{data?.current_indicators?.macd_trend_ar ?? 'محايد'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">متوسط 20 يوم (SMA 20):</span>
                <span className="text-foreground font-mono">{(data?.current_indicators?.sma20 ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">متوسط 50 يوم (SMA 50):</span>
                <span className="text-foreground font-mono">{(data?.current_indicators?.sma50 ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">متوسط 200 يوم (SMA 200):</span>
                <span className="text-foreground font-mono">{(data?.current_indicators?.sma200 ?? 0).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">متوسط المدى الحقيقي (ATR):</span>
                <span className="text-foreground font-mono">{(data?.current_indicators?.atr ?? 0).toFixed(4)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">نسبة السيولة (Vol Ratio):</span>
                <span className="text-foreground font-mono">{data?.volume_analysis?.ratio?.toFixed(2) ?? '1.00'}x</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">عرض البولينجر (BB Width):</span>
                <span className="text-foreground font-mono">{(data?.current_indicators?.bb_width ?? 0).toFixed(2)}%</span>
              </div>
            </div>
          </details>

          {/* Fundamental Analysis (قابل للطي) */}
          <details className="bg-muted/50 rounded-lg p-3">
            <summary className="cursor-pointer font-bold text-xs text-amber-500 dark:text-amber-400">التحليل الأساسي (Fundamental)</summary>
            <div className="mt-2 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-muted-foreground">مكرر الربحية (P/E):</span>
                <span className="text-foreground font-mono">{data?.fundamentals?.valuation?.pe_ratio?.toFixed(2) ?? 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">مضاعف القيمة الدفترية (P/B):</span>
                <span className="text-foreground font-mono">{data?.fundamentals?.valuation?.pb_ratio?.toFixed(2) ?? 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">العائد على حقوق المساهمين (ROE):</span>
                <span className="text-foreground font-mono">{data?.fundamentals?.profitability?.roe != null ? `${data.fundamentals.profitability.roe.toFixed(2)}%` : 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">هامش الربح (Profit Margin):</span>
                <span className="text-foreground font-mono">{data?.fundamentals?.profitability?.profit_margin != null ? `${data.fundamentals.profitability.profit_margin.toFixed(2)}%` : 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">عائد التوزيعات (Div Yield):</span>
                <span className="text-foreground font-mono">{data?.fundamentals?.dividends?.dividend_yield != null ? `${data.fundamentals.dividends.dividend_yield.toFixed(2)}%` : 'N/A'}</span>
              </div>
            </div>
          </details>
            </>
          )}

          {/* Trade Plan (قابل للطي) — دايماً ظاهر (الإشارة، الدخول، الهدف، الوقف) */}
          <details className="bg-muted/50 rounded-lg p-3" open>
            <summary className="cursor-pointer font-bold text-xs text-emerald-500 dark:text-emerald-400">خطة التداول (Trade Plan)</summary>
            <div className="mt-2 space-y-1 text-[11px]">
              <div className="flex justify-between">
                <span className="text-blue-500 dark:text-blue-400">الدخول (BUY):</span>
                <span className="text-foreground font-mono font-bold">{fmt(entry)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-emerald-400">الهدف 1 (TP1):</span>
                <span className="text-emerald-400 font-mono font-bold">{fmt(target)}</span>
              </div>
              {data?.risk?.target_2 && (
                <div className="flex justify-between">
                  <span className="text-emerald-400">الهدف 2 (TP2):</span>
                  <span className="text-emerald-400 font-mono font-bold">{fmt(data.risk.target_2)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-red-400">وقف الخسارة (SL):</span>
                <span className="text-red-400 font-mono font-bold">{fmt(stop)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-cyan-400">R:R:</span>
                <span className="text-cyan-400 font-mono font-bold">{rrRatio != null ? `${rrRatio.toFixed(2)}:1` : '---'}</span>
              </div>
              {data?.risk?.partial_exit_note && (
                <div className="mt-1 px-2 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[9px] leading-snug">
                  {data.risk.partial_exit_note}
                </div>
              )}
              {/* Position Sizing */}
              {suggestedPositionSizePct != null && (
                <div className="border-t border-border pt-1 mt-1">
                  <div className="flex justify-between">
                    <span className="text-amber-500 dark:text-amber-400">حجم المركز:</span>
                    <span className="text-amber-500 dark:text-amber-400 font-mono font-bold">{suggestedPositionSizePct.toFixed(2)}%</span>
                  </div>
                  {availableCash != null && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">السيولة:</span>
                      <span className="text-foreground font-mono">{availableCash.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
                    </div>
                  )}
                  {positionWarning && (
                    <div className="mt-1 flex items-start gap-1 px-1.5 py-1 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[9px]">
                      <AlertTriangle className="h-2.5 w-2.5 mt-0.5 shrink-0" />
                      <span>{positionWarning}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </details>

          {/* ── Phase 8: الأقسام التقنية المتقدمة (Pine Script + News + SMC + V20) — بتظهر بس في وضع المحترفين ── */}
          {advancedMode && (
            <>
          {/* Pine Script Flags (قابل للطي) */}
          {(liveData?.is_dead_cat || liveData?.is_golden_pullback || liveData?.is_bullish_divergence || liveData?.is_trap || liveData?.is_low_liquidity) && (
            <details className="bg-muted/50 rounded-lg p-3" open>
              <summary className="cursor-pointer font-bold text-xs text-purple-500 dark:text-purple-400">إشارات ذكية (Pine Script)</summary>
              <div className="mt-2 space-y-1 text-[10px]">
                {liveData?.is_golden_pullback && <div className="text-emerald-500 dark:text-lime-400">🟢 تصحيح ذهبي</div>}
                {liveData?.is_dead_cat && <div className="text-red-500 dark:text-red-400">⚠️ فخ ارتداد</div>}
                {liveData?.is_bullish_divergence && <div className="text-blue-500 dark:text-blue-400">📊 تباعد إيجابي</div>}
                {liveData?.is_trap && <div className="text-red-500 dark:text-red-400">🚨 فخ مضارب</div>}
                {liveData?.is_low_liquidity && <div className="text-amber-500 dark:text-amber-400">⚠️ سيولة ضعيفة</div>}
                {liveData?.reason && <div className="text-muted-foreground mt-1 leading-relaxed">{liveData.reason}</div>}
              </div>
            </details>
          )}

          {/* News (قابل للطي) */}
          {data?.news_confirmed && (
            <details className="bg-muted/50 rounded-lg p-3" open>
              <summary className="cursor-pointer font-bold text-xs text-amber-500 dark:text-amber-400">📰 خبر مؤكد</summary>
              <div className="mt-2 text-[10px] text-foreground leading-relaxed">
                {data.news_title || 'خبر متاح'}
                {data.news_source && <div className="text-muted-foreground mt-1">المصدر: {data.news_source}</div>}
              </div>
            </details>
          )}

          {/* SMC-ENGINE-066: تحليل الحيتان (Smart Money Concepts) */}
          <details className="bg-muted/50 rounded-lg p-3" open>
            <summary className="cursor-pointer font-bold text-xs text-purple-500 dark:text-purple-400">🐋 تحليل الحيتان (SMC)</summary>
            <div className="mt-2 text-[10px] space-y-2">
              {/* SMC Score */}
              {data?.smc_data?.ready !== false && (
                <div className="flex justify-between items-center p-1.5 rounded bg-purple-500/10">
                  <span className="font-semibold">SMC Score:</span>
                  <span className={`font-bold ${data && data.smc_data && data.smc_data.score >= 70 ? 'text-emerald-400' : data && data.smc_data && data.smc_data.score >= 40 ? 'text-amber-400' : 'text-red-400'}`}>
                    {data?.smc_data?.score ?? 0}/100
                  </span>
                </div>
              )}

              {/* Order Blocks */}
              <div className="flex justify-between">
                <span>أقرب Order Block:</span>
                <span className={data?.smc_data?.order_blocks && data.smc_data.order_blocks.length > 0 ? 'text-emerald-400' : 'text-muted-foreground'}>
                  {data?.smc_data?.order_blocks && data.smc_data.order_blocks.length > 0
                    ? data.smc_data.order_blocks[0].type === 'bullish_ob' ? 'Bullish OB ✅' : 'Bearish OB ⚠️'
                    : 'لا يوجد ❌'}
                </span>
              </div>

              {/* Liquidity Sweeps */}
              <div className="flex justify-between">
                <span>سحب سيولة (Sweep):</span>
                <span className={data?.smc_data?.sweeps && data.smc_data.sweeps.length > 0 ? 'text-yellow-400' : 'text-muted-foreground'}>
                  {data?.smc_data?.sweeps && data.smc_data.sweeps.length > 0
                    ? data.smc_data.sweeps[0].type === 'bullish_sweep' ? 'تم سحب بيعي 🎯' : 'تم سحب شرائي ⚠️'
                    : 'لا يوجد'}
                </span>
              </div>

              {/* FVG */}
              <div className="flex justify-between">
                <span>فجوة (FVG):</span>
                <span className={data?.smc_data?.fvgs && data.smc_data.fvgs.length > 0 ? 'text-blue-400' : 'text-muted-foreground'}>
                  {data?.smc_data?.fvgs && data.smc_data.fvgs.length > 0
                    ? data.smc_data.fvgs[0].type === 'bullish_fvg' ? 'Bullish FVG 🚀' : 'Bearish FVG 📉'
                    : 'لا يوجد'}
                </span>
              </div>

              {/* SMC Signals (تفصيلي) */}
              {data?.smc_data?.signals && data.smc_data.signals.length > 0 && (
                <div className="mt-2 pt-2 border-t border-border space-y-1">
                  {data.smc_data.signals.map((sig: string, i: number) => (
                    <div key={i} className="text-[9px] text-muted-foreground leading-relaxed">{sig}</div>
                  ))}
                </div>
              )}
            </div>
          </details>

          {/* PHASE 11: V20 Ultimate Fusion Engine (LuxAlgo + BigBeluga + SMC) */}
          {advancedMode && data?.fusion_metrics && data.fusion_metrics.ready !== false && (
            <details className="bg-muted/50 rounded-lg p-3" open>
              <summary className="cursor-pointer font-bold text-xs text-fuchsia-500 dark:text-fuchsia-400">
                🎯 محرك V20 (Ultimate Fusion)
              </summary>
              <div className="mt-2 text-[10px] space-y-2">
                {/* Fusion Score */}
                <div className="flex justify-between items-center p-1.5 rounded bg-fuchsia-500/10">
                  <span className="font-semibold">Fusion Score:</span>
                  <span className={`font-bold ${
                    data.fusion_metrics.score >= 70 ? 'text-emerald-400'
                    : data.fusion_metrics.score >= 50 ? 'text-amber-400'
                    : 'text-red-400'
                  }`}>
                    {data.fusion_metrics.score.toFixed(1)}/100
                  </span>
                </div>

                {/* Signal */}
                <div className="flex justify-between">
                  <span>الإشارة:</span>
                  <span className={`font-bold ${
                    data.fusion_metrics.signal === 'STRONG_BUY' ? 'text-emerald-400'
                    : data.fusion_metrics.signal === 'ACCUMULATE' ? 'text-amber-400'
                    : 'text-muted-foreground'
                  }`}>
                    {data.fusion_metrics.signal_ar}
                  </span>
                </div>

                {/* Fair Value (VWAP) + Premium */}
                <div className="flex justify-between">
                  <span>القيمة العادلة (VWAP):</span>
                  <span className={data.fusion_metrics.fair_premium < -3 ? 'text-emerald-400'
                    : data.fusion_metrics.fair_premium > 5 ? 'text-red-400'
                    : 'text-muted-foreground'}>
                    {data.fusion_metrics.fair_value.toFixed(2)}
                    {' '}
                    ({data.fusion_metrics.fair_premium > 0 ? '+' : ''}{data.fusion_metrics.fair_premium.toFixed(1)}%)
                  </span>
                </div>

                {/* Golden Pocket */}
                {data.fusion_metrics.bigbeluga && (
                  <div className="flex justify-between">
                    <span>الجيب الذهبي:</span>
                    <span className={data.fusion_metrics.bigbeluga.in_pocket ? 'text-fuchsia-400 font-bold' : 'text-muted-foreground'}>
                      {data.fusion_metrics.bigbeluga.in_pocket ? '🎯 داخل الجيب!' : 'خارج الجيب'}
                    </span>
                  </div>
                )}

                {/* BigBeluga Trend */}
                {data.fusion_metrics.bigbeluga && (
                  <div className="flex justify-between">
                    <span>اتجاه BigBeluga:</span>
                    <span className={data.fusion_metrics.bigbeluga.trend === 1 ? 'text-emerald-400'
                      : data.fusion_metrics.bigbeluga.trend === -1 ? 'text-red-400'
                      : 'text-muted-foreground'}>
                      {data.fusion_metrics.bigbeluga.trend === 1 ? '🚀 صاعد'
                        : data.fusion_metrics.bigbeluga.trend === -1 ? '📉 هابط'
                        : '➡️ عرضي'}
                    </span>
                  </div>
                )}

                {/* Risk Profile (1.5R / 3.0R) */}
                {data.fusion_metrics.risk && data.fusion_metrics.risk.entry > 0 && (
                  <div className="mt-2 pt-2 border-t border-border space-y-1">
                    <div className="font-semibold text-[9px] text-muted-foreground">المخاطر (1.5R / 3.0R):</div>
                    <div className="flex justify-between">
                      <span>الدخول:</span>
                      <span className="text-blue-400">{data.fusion_metrics.risk.entry.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>وقف الخسارة:</span>
                      <span className="text-red-400">{data.fusion_metrics.risk.sl.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>الهدف 1 (1.5R):</span>
                      <span className="text-emerald-400">{data.fusion_metrics.risk.tp1.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>الهدف 2 (3.0R):</span>
                      <span className="text-emerald-300">{data.fusion_metrics.risk.tp2.toFixed(2)}</span>
                    </div>
                  </div>
                )}
              </div>
            </details>
          )}
            </>
          )}

          {/* Publish Button */}
          <Button
            onClick={handlePublish}
            disabled={publishing || !data || loading}
            className="w-full h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-2 shrink-0 disabled:opacity-50"
          >
            {publishing ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
            <span className="text-[11px]">{publishing ? 'جاري النشر...' : 'نشر على تيليجرام'}</span>
          </Button>
        </div>
      </div>
      )}

      {/* ─── MULTI-STOCK-COMPARISON: Comparison Table Matrix (عند إضافة أسهم للمقارنة) ─── */}
      {viewMode === 'chart' && compareTickers.length > 0 && (
        <Card className="border-teal-200 dark:border-teal-900 mt-2 shadow-sm shrink-0">
          <CardContent className="p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-teal-700 dark:text-teal-300 flex items-center gap-1.5">
                <GitCompare className="w-4 h-4 text-teal-500" />
                مقارنة الأداء والإشارات بين الأسهم المختارة ({compareTickers.length + 1})
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setViewMode('multi')}
                className="h-6 px-2 text-[10px] gap-1 text-teal-600 border-teal-300 dark:border-teal-800 dark:text-teal-300"
              >
                <LayoutGrid className="w-3 h-3" />
                عرض مقارنة الشاشات
              </Button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs text-right border-collapse min-w-[600px]">
                <thead className="bg-muted text-muted-foreground font-bold">
                  <tr>
                    <th className="p-2 text-right">السهم</th>
                    <th className="p-2 text-center">السعر الحالي</th>
                    <th className="p-2 text-center">التغير اليومي</th>
                    <th className="p-2 text-center">التوافق والإشارة</th>
                    <th className="p-2 text-center">سعر الدخول</th>
                    <th className="p-2 text-center">الهدف والوقف</th>
                    <th className="p-2 text-center">RSI</th>
                    <th className="p-2 text-center">إزالة</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {[ticker, ...compareTickers].map((tk, idx) => {
                    const st = stocks.find(s => s.ticker === tk);
                    const isPrimary = idx === 0;
                    return (
                      <tr
                        key={tk}
                        className={cn(
                          "hover:bg-muted/40 transition-colors",
                          isPrimary ? "bg-emerald-500/10 font-medium" : ""
                        )}
                      >
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold font-mono text-foreground">{tk}</span>
                            <span className="text-[10px] text-muted-foreground truncate">{st?.name_ar || st?.name || ''}</span>
                            {isPrimary && (
                              <Badge className="bg-emerald-600 text-white text-[9px] py-0 px-1">رئيسي</Badge>
                            )}
                          </div>
                        </td>
                        <td className="p-2 text-center font-mono font-bold">
                          {st?.current_price ? `${st.current_price.toFixed(2)} ج.م` : '—'}
                        </td>
                        <td className="p-2 text-center font-mono font-bold">
                          {st?.price_change !== undefined && st?.price_change !== null ? (
                            <span className={cn("text-[10px]", st.price_change >= 0 ? "text-emerald-500" : "text-rose-500")}>
                              {st.price_change >= 0 ? '+' : ''}{st.price_change.toFixed(1)}%
                            </span>
                          ) : '—'}
                        </td>
                        <td className="p-2 text-center">
                          <Badge variant="outline" className="text-[10px]">
                            {tk === ticker ? (data?.confluence?.signal || '—') : 'مستقر'}
                          </Badge>
                        </td>
                        <td className="p-2 text-center font-mono">
                          {tk === ticker && data?.risk?.entry ? `${data.risk.entry.toFixed(2)} ج.م` : (st?.current_price ? `${st.current_price.toFixed(2)} ج.م` : '—')}
                        </td>
                        <td className="p-2 text-center font-mono text-[10px]">
                          {tk === ticker && data?.risk ? (
                            <div>
                              <span className="text-emerald-600 dark:text-emerald-400">🎯 {data.risk.target?.toFixed(2)}</span>
                              <span className="text-rose-500 ml-2">🛑 {data.risk.stop_loss?.toFixed(2)}</span>
                            </div>
                          ) : '—'}
                        </td>
                        <td className="p-2 text-center font-mono">
                          {tk === ticker && data?.current_indicators?.rsi ? data.current_indicators.rsi.toFixed(1) : '50.0'}
                        </td>
                        <td className="p-2 text-center">
                          {!isPrimary ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeCompareTicker(tk)}
                              className="h-6 w-6 p-0 text-muted-foreground hover:text-rose-500"
                            >
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          ) : (
                            <span className="text-muted-foreground text-[10px]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

