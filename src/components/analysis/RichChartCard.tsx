'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { InteractiveChart } from './InteractiveChart';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  RefreshCw,
  Maximize2,
  Minimize2,
  Trash2,
  Bell,
  CheckCircle2,
  X,
  Plus,
  SlidersHorizontal,
  ChevronDown,
} from 'lucide-react';
import { useAppStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AlertPanel } from './AlertPanel';

interface OHLCVCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface FullAnalysisResponse {
  success?: boolean;
  error?: string;
  ticker: string;
  timeframe: string;
  ohlcv: OHLCVCandle[];
  indicators: any;
  levels: any;
  confluence: {
    score: number;
    breakdown: Record<string, any>;
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
  };
  current_indicators?: {
    rsi?: number;
    macd?: number;
    macd_trend_ar?: string;
    macd_color?: string;
    atr?: number;
  };
  analysis_text?: string;
}

export interface RichChartCardProps {
  id: string;
  initialTicker: string;
  initialTimeframe?: string;
  canRemove: boolean;
  onRemove: () => void;
  onTickerChange?: (newTicker: string) => void;
}

export function RichChartCard({
  id,
  initialTicker,
  initialTimeframe = 'DAY',
  canRemove,
  onRemove,
  onTickerChange,
}: RichChartCardProps) {
  const { stocks, user } = useAppStore();
  const [ticker, setTicker] = useState(initialTicker);
  const [timeframe, setTimeframe] = useState(initialTimeframe);
  const [data, setData] = useState<FullAnalysisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alertPanelOpen, setAlertPanelOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [showIndicatorsToolbar, setShowIndicatorsToolbar] = useState(false);

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

  const stockInfo = stocks.find((s) => s.ticker === ticker.toUpperCase());

  const fetchData = useCallback(
    async (tk: string, tf: string) => {
      setLoading(true);
      setError(null);
      try {
        const LIMIT_MAP: Record<string, number> = {
          '5M': 500,
          '15M': 500,
          '1H': 500,
          DAY: 365,
          WEEK: 730,
          MONTH: 1825,
        };
        const limit = LIMIT_MAP[tf] || 365;
        const res = await fetch(
          `/api/v2/chart/full-analysis?ticker=${encodeURIComponent(
            tk
          )}&timeframe=${tf}&limit=${limit}&_t=${Date.now()}`
        );
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
    },
    []
  );

  useEffect(() => {
    fetchData(ticker, timeframe);
  }, [ticker, timeframe, fetchData]);

  const handleTickerSelect = (newTk: string) => {
    setTicker(newTk);
    if (onTickerChange) onTickerChange(newTk);
  };

  const toggleIndicator = (key: string) => {
    setVisibleIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const lastCandle = data?.ohlcv?.[data.ohlcv.length - 1];
  const livePrice = lastCandle?.close ?? stockInfo?.current_price ?? 0;
  const prevClose = data?.ohlcv?.[data.ohlcv.length - 2]?.close ?? livePrice;
  const chgPct = prevClose > 0 ? ((livePrice - prevClose) / prevClose) * 100 : 0;
  const isUp = chgPct >= 0;

  return (
    <Card
      className={cn(
        'border-border/80 shadow-md bg-card transition-all duration-200 flex flex-col',
        isMaximized ? 'fixed inset-2 z-50 overflow-y-auto bg-background p-4' : 'w-full'
      )}
    >
      {/* ─── 1. Header Bar ─── */}
      <CardHeader className="p-3 border-b border-border/60 bg-muted/20 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Ticker Selector & Title */}
          <div className="flex items-center gap-2">
            <Select value={ticker} onValueChange={handleTickerSelect} dir="rtl">
              <SelectTrigger className="h-8 text-xs font-bold bg-background border-border w-[120px] md:w-[140px]">
                <SelectValue placeholder="اختر السهم" />
              </SelectTrigger>
              <SelectContent className="max-h-56 bg-popover">
                {stocks.slice(0, 40).map((s) => (
                  <SelectItem key={s.ticker} value={s.ticker} className="text-xs font-mono">
                    <span className="font-bold ml-1">{s.ticker}</span>
                    <span className="text-[10px] text-muted-foreground">({s.name_ar || s.name})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="text-xs font-bold text-foreground truncate max-w-[120px] hidden sm:inline">
              {stockInfo?.name_ar || stockInfo?.name || ticker}
            </span>

            {/* Live Price Badge */}
            <Badge
              variant="outline"
              className={cn(
                'font-mono text-xs font-bold px-2 py-0.5 border',
                isUp
                  ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30'
                  : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30'
              )}
            >
              {livePrice > 0 ? `${livePrice.toFixed(2)} ج.م` : '—'}
              <span className="text-[10px] mr-1">
                ({isUp ? '+' : ''}
                {chgPct.toFixed(1)}%)
              </span>
            </Badge>

            {/* Signal Confluence Badge */}
            {data?.confluence?.signal && (
              <Badge
                style={{ backgroundColor: data.confluence.signal_color || '#10b981' }}
                className="text-white text-[10px] font-bold px-2 py-0.5 shadow-xs"
              >
                {data.confluence.signal} ({data.confluence.score?.toFixed(1)}/10)
              </Badge>
            )}
          </div>

          {/* Timeframe Buttons & Actions */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="flex bg-background border border-border rounded-md p-0.5 text-[10px] font-semibold">
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
                    'px-2 py-1 rounded transition-colors',
                    timeframe === tf.key
                      ? 'bg-emerald-600 text-white font-bold shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {tf.label}
                </button>
              ))}
            </div>

            {/* Indicators Toggle */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowIndicatorsToolbar((v) => !v)}
              className={cn(
                'h-7 px-2 text-[10px] gap-1',
                showIndicatorsToolbar ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-600 border-emerald-500' : ''
              )}
              title="المؤشرات الفنية"
            >
              <SlidersHorizontal className="w-3 h-3" />
              المؤشرات
            </Button>

            {/* Alert Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAlertPanelOpen(true)}
              className="h-7 px-2 text-[10px] gap-1 text-amber-600 border-amber-300 dark:border-amber-800"
              title="تنبيهات السعر"
            >
              <Bell className="w-3 h-3" />
              تنفيذ تنبيه
            </Button>

            {/* Maximize Toggle */}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setIsMaximized((v) => !v)}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title={isMaximized ? 'تصغير' : 'تعتيم وتكبير'}
            >
              {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </Button>

            {/* Remove Card Button */}
            {canRemove && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRemove}
                className="h-7 w-7 p-0 text-muted-foreground hover:text-rose-500"
                title="إزالة هذا الشارت من اللوحة"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Indicators Toolbar (Collapsible) */}
        {showIndicatorsToolbar && (
          <div className="flex items-center gap-1.5 flex-wrap pt-2 border-t border-border/40 text-[10px]">
            <span className="text-muted-foreground font-bold ml-1">المؤشرات المفعلة:</span>
            {[
              { label: 'SMA 20', key: 'sma20' },
              { label: 'SMA 50', key: 'sma50' },
              { label: 'SMA 200', key: 'sma200' },
              { label: 'EMA', key: 'ema' },
              { label: 'RSI', key: 'rsi' },
              { label: 'Bollinger Bands', key: 'bb' },
              { label: 'MACD', key: 'macd' },
              { label: 'الحجم Vol', key: 'volume' },
              { label: 'مستويات الدعم/المقاومة', key: 'levels' },
              { label: 'أحداث SMC / BOS', key: 'bos' },
            ].map((ind) => (
              <button
                key={ind.key}
                type="button"
                onClick={() => toggleIndicator(ind.key)}
                className={cn(
                  'px-2 py-0.5 rounded border transition-all font-mono',
                  visibleIndicators[ind.key]
                    ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border-emerald-500/50 font-bold'
                    : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted'
                )}
              >
                {visibleIndicators[ind.key] ? '✓ ' : ''}
                {ind.label}
              </button>
            ))}
          </div>
        )}
      </CardHeader>

      {/* ─── 2. Interactive Chart Canvas ─── */}
      <CardContent className="p-2 flex-1 flex flex-col min-h-[420px] relative">
        {loading ? (
          <div className="flex-1 flex flex-col justify-center items-center gap-3 min-h-[400px]">
            <RefreshCw className="w-6 h-6 text-emerald-500 animate-spin" />
            <span className="text-xs text-muted-foreground font-semibold">
              جاري تحليل بيانات {ticker} للفترة {timeframe}...
            </span>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col justify-center items-center gap-2 min-h-[400px] text-center p-4">
            <AlertTriangle className="w-8 h-8 text-rose-500" />
            <span className="text-xs font-bold text-rose-400">{error}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchData(ticker, timeframe)}
              className="mt-2 h-7 text-xs"
            >
              إعادة التحميل
            </Button>
          </div>
        ) : data ? (
          <div className="w-full flex-1 min-h-[420px] rounded-lg overflow-hidden border border-border/50">
            <InteractiveChart
              data={data}
              visibleIndicators={visibleIndicators}
              timeframe={timeframe}
              height={isMaximized ? 600 : 420}
            />
          </div>
        ) : null}

        {/* ─── 3. Trade Plan Summary Box (الخطة ومستويات الأسعار) ─── */}
        {data?.risk && (
          <div className="mt-3 p-3 rounded-xl bg-muted/40 border border-border/60 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className="p-2 rounded-lg bg-background border border-border text-center">
              <span className="text-[10px] text-muted-foreground block font-bold">سعر الدخول المقترح</span>
              <span className="font-mono font-black text-sm text-foreground">
                {data.risk.entry > 0 ? `${data.risk.entry.toFixed(2)} ج.م` : '—'}
              </span>
            </div>

            <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-center">
              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 block font-bold">🎯 الهدف الأول (TP)</span>
              <span className="font-mono font-black text-sm text-emerald-600 dark:text-emerald-400">
                {data.risk.target > 0 ? `${data.risk.target.toFixed(2)} ج.م` : '—'}
              </span>
            </div>

            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-center">
              <span className="text-[10px] text-rose-600 dark:text-rose-400 block font-bold">🛑 وقف الخسارة (SL)</span>
              <span className="font-mono font-black text-sm text-rose-600 dark:text-rose-400">
                {data.risk.stop_loss > 0 ? `${data.risk.stop_loss.toFixed(2)} ج.م` : '—'}
              </span>
            </div>

            <div className="p-2 rounded-lg bg-background border border-border text-center">
              <span className="text-[10px] text-muted-foreground block font-bold">مؤشر RSI / الاتجاه</span>
              <span className="font-mono font-bold text-xs text-foreground">
                RSI: {data.current_indicators?.rsi?.toFixed(1) || '50.0'}
              </span>
              <span className="text-[9px] text-muted-foreground block truncate">
                {data.current_indicators?.macd_trend_ar || 'حيادي'}
              </span>
            </div>
          </div>
        )}
      </CardContent>

      {/* Alert Panel Slide-over */}
      <AlertPanel
        ticker={ticker}
        open={alertPanelOpen}
        onClose={() => setAlertPanelOpen(false)}
      />
    </Card>
  );
}
