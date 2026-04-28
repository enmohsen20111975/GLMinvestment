'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useTheme } from 'next-themes';
import {
  ComposedChart,
  Line,
  Bar,
  Area,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { cn, safeToFixed } from '@/lib/utils';
import { useAppStore } from '@/lib/store';
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  Maximize2,
  Minimize2,
  RefreshCw,
  Layers,
  Signal,
  Activity,
  DollarSign,
  Percent,
  Volume2,
  Lightbulb,
  Target,
} from 'lucide-react';

// Chart types
type ChartType = 'line' | 'candlestick' | 'area';

// Timeframes
type TimeframeKey = '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Constants
const TIMEFRAMES: { key: TimeframeKey; label: string; days: number }[] = [
  { key: '1W', label: '1W', days: 7 },
  { key: '1M', label: '1M', days: 30 },
  { key: '3M', label: '3M', days: 90 },
  { key: '6M', label: '6M', days: 180 },
  { key: '1Y', label: '1Y', days: 365 },
  { key: 'ALL', label: 'ALL', days: 9999 },
];

const CHART_TYPES: { key: ChartType; label: string; icon: React.ReactNode; description: string }[] = [
  { key: 'line', label: 'Line', icon: <TrendingUp className="size-3.5" />, description: 'Simple line chart' },
  { key: 'candlestick', label: 'Candle', icon: <BarChart3 className="size-3.5" />, description: 'Japanese candlesticks' },
  { key: 'area', label: 'Area', icon: <Layers className="size-3.5" />, description: 'Area chart' },
];

// SMA calculation
function computeSMA(data: OhlcvBar[], period: number): Array<{ date: string; value: number | null }> {
  const result: Array<{ date: string; value: number | null }> = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push({ date: data[i].date, value: null });
    } else {
      const slice = data.slice(i - period + 1, i + 1);
      const sma = slice.reduce((sum, d) => sum + d.close, 0) / period;
      result.push({ date: data[i].date, value: sma });
    }
  }
  return result;
}

// RSI calculation
function computeRSI(data: OhlcvBar[], period: number = 14): Array<{ date: string; value: number | null }> {
  const result: Array<{ date: string; value: number | null }> = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      result.push({ date: data[i].date, value: null });
    } else {
      const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      result.push({ date: data[i].date, value: rsi });
    }
  }
  return result;
}

// Bollinger Bands calculation
function computeBollingerBands(data: OhlcvBar[], period: number = 20, stdDev: number = 2) {
  return data.map((bar, idx) => {
    if (idx < period - 1) return { date: bar.date, upper: null, middle: null, lower: null };
    const slice = data.slice(idx - period + 1, idx + 1);
    const closes = slice.map(d => d.close);
    const mean = closes.reduce((a, b) => a + b, 0) / period;
    const variance = closes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    return {
      date: bar.date,
      middle: mean,
      upper: mean + stdDev * std,
      lower: mean - stdDev * std,
    };
  });
}

// Main component
export function SimpleStockChart({ ticker, stockName }: { ticker: string; stockName?: string }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Access store for professional analysis
  const { professionalAnalysis } = useAppStore();
  const profData = professionalAnalysis as Record<string, unknown> | null;
  const analysis = profData?.analysis as Record<string, unknown> | null;
  const fairValue = analysis?.fair_value as Record<string, unknown> | null;
  const recommendation = analysis?.recommendation as Record<string, unknown> | null;
  const indicators = analysis?.indicators as Record<string, unknown> | null;
  const priceLevels = analysis?.price_levels as Record<string, unknown> | null;
  
  const fairValuePrice = fairValue ? Number(fairValue.average_fair_value) || 0 : 0;
  const entryPrice = recommendation ? Number(recommendation.entry_price) || 0 : 0;
  const targetPrice = recommendation ? Number(recommendation.target_price) || 0 : 0;
  const stopLoss = recommendation ? Number(recommendation.stop_loss) || 0 : 0;
  const support1 = priceLevels ? Number(priceLevels.support_1) || 0 : 0;
  const resistance1 = priceLevels ? Number(priceLevels.resistance_1) || 0 : 0;

  // State
  const [allData, setAllData] = useState<OhlcvBar[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<TimeframeKey>('1Y');
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [showSMA20, setShowSMA20] = useState(true);
  const [showSMA50, setShowSMA50] = useState(true);
  const [showBollinger, setShowBollinger] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showFairValue, setShowFairValue] = useState(true);
  const [showEntryTarget, setShowEntryTarget] = useState(true);
  const [showSupportResistance, setShowSupportResistance] = useState(true);

  // Fullscreen effect
  useEffect(() => {
    if (!isFullscreen) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [isFullscreen]);

  // Fetch data
  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        const url = new URL(`/api/stocks/${encodeURIComponent(ticker)}/history?days=9999`, window.location.origin);
        url.searchParams.set('_cb', Date.now().toString());
        const res = await fetch(url.toString(), { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!cancelled) {
          if (json.success && json.data) {
            setAllData(json.data);
          } else {
            throw new Error(json.error || 'No data');
          }
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Fetch failed');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    fetchData();
    return () => { cancelled = true; };
  }, [ticker]);

  // Filter data by timeframe
  const filteredData = useMemo(() => {
    if (allData.length === 0) return [];
    const tf = TIMEFRAMES.find((t) => t.key === timeframe);
    if (!tf || tf.days >= 9999) return allData;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - tf.days);
    const year = cutoff.getFullYear();
    const month = String(cutoff.getMonth() + 1).padStart(2, '0');
    const day = String(cutoff.getDate()).padStart(2, '0');
    const cutoffStr = `${year}-${month}-${day}`;

    return allData.filter((b) => b.date >= cutoffStr);
  }, [allData, timeframe]);

  // Compute indicators
  const sma20Data = useMemo(() => computeSMA(filteredData, 20), [filteredData]);
  const sma50Data = useMemo(() => computeSMA(filteredData, 50), [filteredData]);
  const bollingerBands = useMemo(() => computeBollingerBands(filteredData, 20, 2), [filteredData]);
  const rsiData = useMemo(() => computeRSI(filteredData, 14), [filteredData]);

  // Chart data with computed values
  const chartData = useMemo(() => {
    return filteredData.map((d, idx) => ({
      ...d,
      candleBodyTop: Math.max(d.open, d.close),
      candleBodyBottom: Math.min(d.open, d.close),
      candleColor: d.close >= d.open ? 'up' : 'down',
      sma20: sma20Data[idx]?.value,
      sma50: sma50Data[idx]?.value,
      bbUpper: bollingerBands[idx]?.upper,
      bbMiddle: bollingerBands[idx]?.middle,
      bbLower: bollingerBands[idx]?.lower,
      rsi: rsiData[idx]?.value,
    }));
  }, [filteredData, sma20Data, sma50Data, bollingerBands, rsiData]);

  // Investment analysis
  const investmentAnalysis = useMemo(() => {
    if (filteredData.length === 0) return null;
    const latest = filteredData[filteredData.length - 1];
    const oldest = filteredData[0];
    const priceChange = latest.close - oldest.close;
    const priceChangePct = (priceChange / oldest.close) * 100;
    const sma20Value = sma20Data[sma20Data.length - 1]?.value;
    const sma50Value = sma50Data[sma50Data.length - 1]?.value;
    const lastBB = bollingerBands[bollingerBands.length - 1];
    const latestRsi = rsiData[rsiData.length - 1]?.value;
    const volumeAvg = filteredData.reduce((sum, d) => sum + d.volume, 0) / filteredData.length;

    return {
      currentPrice: latest.close,
      priceChange,
      priceChangePct,
      sma20: sma20Value,
      sma50: sma50Value,
      support: lastBB?.lower || support1,
      resistance: lastBB?.upper || resistance1,
      rsi: latestRsi,
      volumeAvg,
      trend: sma50Value && latest.close > sma50Value ? 'bullish' : 'bearish',
    };
  }, [filteredData, sma20Data, sma50Data, bollingerBands, rsiData, support1, resistance1]);

  // Chart colors
  const colors = useMemo(() => ({
    bg: isDark ? '#1e293b' : '#ffffff',
    grid: isDark ? '#334155' : '#e2e8f0',
    text: isDark ? '#e2e8f0' : '#475569',
    candleUp: '#10b981',
    candleDown: '#ef4444',
    volumeUp: '#10b981',
    volumeDown: '#ef4444',
    sma20: '#3b82f6',
    sma50: '#f59e0b',
    bbUpper: '#8b5cf6',
    bbLower: '#8b5cf6',
  }), [isDark]);

  // Price domain
  const priceMin = useMemo(() => {
    if (filteredData.length === 0) return 0;
    const min = Math.min(...filteredData.map(d => d.low));
    return min * 0.995;
  }, [filteredData]);

  const priceMax = useMemo(() => {
    if (filteredData.length === 0) return 100;
    const max = Math.max(...filteredData.map(d => d.high));
    return max * 1.005;
  }, [filteredData]);

  // Latest close price
  const latestClose = filteredData.length > 0 ? filteredData[filteredData.length - 1].close : 0;

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-8">
        <div className="h-[500px] w-full animate-pulse bg-muted"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-red-500">
        <p>Error loading chart: {error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => window.location.reload()}>
          <RefreshCw className="size-3.5 mr-1.5" /> Retry
        </Button>
      </div>
    );
  }

  if (filteredData.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 text-center text-muted-foreground">
        <p>No historical data available</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('rounded-xl border border-border bg-card overflow-hidden', isFullscreen && 'fixed inset-0 z-50 rounded-none')}>
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border gap-2 flex-wrap">
        {/* Left: Stock name + price + trend */}
        <div className="flex items-center gap-3 min-w-[200px]">
          <span className="text-sm font-semibold text-foreground truncate">
            {stockName || ticker}
          </span>
          <span className="text-xs font-mono font-bold"
                style={{ color: investmentAnalysis && investmentAnalysis.priceChange >= 0 ? '#10b981' : '#ef4444' }}
                dir="ltr">
            {safeToFixed(latestClose)}
          </span>
          {investmentAnalysis && (
            <Badge variant={investmentAnalysis.trend === 'bullish' ? 'default' : 'destructive'} className="text-[10px]">
              {investmentAnalysis.trend === 'bullish' ? <TrendingUp className="size-2.5" /> : <TrendingDown className="size-2.5" />}
              {investmentAnalysis.priceChangePct >= 0 ? '+' : ''}{safeToFixed(investmentAnalysis.priceChangePct)}%
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground font-mono">
            [{allData.length}/{filteredData.length}]
          </span>
        </div>

        {/* Center: Timeframes */}
        <div className="flex gap-1">
          {TIMEFRAMES.map((tf) => (
            <Button
              key={tf.key}
              variant={timeframe === tf.key ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => setTimeframe(tf.key)}
            >
              {tf.label}
            </Button>
          ))}
        </div>

        {/* Right: Chart types + indicators + fullscreen */}
        <div className="flex items-center gap-2">
          {/* Chart type selector */}
          <div className="flex items-center gap-1 border rounded-md p-0.5">
            {CHART_TYPES.map((ct) => (
              <button
                key={ct.key}
                onClick={() => setChartType(ct.key)}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 text-xs rounded-sm transition-colors',
                  chartType === ct.key
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-muted-foreground'
                )}
                title={ct.description}
              >
                {ct.icon}
                <span className="hidden sm:inline">{ct.label}</span>
              </button>
            ))}
          </div>

          {/* Indicators toggle - Individual toggles for each line */}
          <div className="flex items-center gap-1 border rounded-md p-0.5 flex-wrap">
            <button
              onClick={() => setShowSMA20(!showSMA20)}
              className={cn(
                'px-2 py-1 text-xs rounded-sm transition-colors flex items-center gap-1',
                showSMA20 ? 'bg-blue-500 text-white' : 'hover:bg-muted text-muted-foreground'
              )}
              title="SMA 20 - المتوسط المتحرك 20"
            >
              <span className="size-2 rounded-full bg-blue-400" />
              <span className="hidden sm:inline">SMA20</span>
            </button>
            <button
              onClick={() => setShowSMA50(!showSMA50)}
              className={cn(
                'px-2 py-1 text-xs rounded-sm transition-colors flex items-center gap-1',
                showSMA50 ? 'bg-amber-500 text-white' : 'hover:bg-muted text-muted-foreground'
              )}
              title="SMA 50 - المتوسط المتحرك 50"
            >
              <span className="size-2 rounded-full bg-amber-400" />
              <span className="hidden sm:inline">SMA50</span>
            </button>
            <button
              onClick={() => setShowBollinger(!showBollinger)}
              className={cn(
                'px-2 py-1 text-xs rounded-sm transition-colors flex items-center gap-1',
                showBollinger ? 'bg-purple-500 text-white' : 'hover:bg-muted text-muted-foreground'
              )}
              title="Bollinger Bands"
            >
              <Layers className="size-3" />
              <span className="hidden sm:inline">BB</span>
            </button>
            <button
              onClick={() => setShowFairValue(!showFairValue)}
              className={cn(
                'px-2 py-1 text-xs rounded-sm transition-colors flex items-center gap-1',
                showFairValue ? 'bg-violet-500 text-white' : 'hover:bg-muted text-muted-foreground'
              )}
              title="القيمة العادلة"
            >
              <span className="size-2 rounded-full bg-violet-400" />
              <span className="hidden sm:inline">عادلة</span>
            </button>
            <button
              onClick={() => setShowEntryTarget(!showEntryTarget)}
              className={cn(
                'px-2 py-1 text-xs rounded-sm transition-colors flex items-center gap-1',
                showEntryTarget ? 'bg-cyan-500 text-white' : 'hover:bg-muted text-muted-foreground'
              )}
              title="سعر الدخول والهدف"
            >
              <Target className="size-3" />
            </button>
            <button
              onClick={() => setShowSupportResistance(!showSupportResistance)}
              className={cn(
                'px-2 py-1 text-xs rounded-sm transition-colors flex items-center gap-1',
                showSupportResistance ? 'bg-emerald-500 text-white' : 'hover:bg-muted text-muted-foreground'
              )}
              title="الدعم والمقاومة"
            >
              <Signal className="size-3" />
            </button>
            <button
              onClick={() => setShowVolume(!showVolume)}
              className={cn(
                'px-2 py-1 text-xs rounded-sm transition-colors flex items-center gap-1',
                showVolume ? 'bg-primary text-primary-foreground' : 'hover:bg-muted text-muted-foreground'
              )}
              title="Volume"
            >
              <Volume2 className="size-3" />
            </button>
          </div>

          {/* Fullscreen toggle */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="h-7 w-7 flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
          </button>
        </div>
      </div>

      {/* Chart Area + Investment Panel */}
      <div className="relative">
        <div style={{ height: isFullscreen ? 'calc(100vh - 56px)' : '500px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 10, left: 10 }}>
              {/* Gradients for Area charts */}
              <defs>
                <linearGradient id="priceAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors.candleUp} stopOpacity={0.6} />
                  <stop offset="95%" stopColor={colors.candleUp} stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={colors.candleUp} stopOpacity={0.4} />
                  <stop offset="95%" stopColor={colors.candleUp} stopOpacity={0.05} />
                </linearGradient>
              </defs>
              {/* Grid */}
              <CartesianGrid
                vertical={false}
                stroke={colors.grid}
                strokeDasharray="3 3"
                opacity={0.5}
              />

              {/* Y-Axis (Price) */}
              <YAxis
                yAxisId="price"
                axisLine={false}
                tickLine={false}
                tick={{ fill: colors.text, fontSize: 11 }}
                tickFormatter={(v) => v.toFixed(0)}
                width={50}
                domain={[priceMin, priceMax]}
              />

              {/* Y-Axis (Volume) - hidden */}
              <YAxis
                yAxisId="volume"
                hide
                domain={[0, 'auto']}
              />

              {/* X-Axis (Dates) */}
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fill: colors.text, fontSize: 11 }}
                tickFormatter={(v) => v.slice(5)}
                minTickGap={50}
              />

              {/* Tooltip */}
              <RechartsTooltip
                content={({ active, payload, label }: { active: boolean; payload: Array<{ name: string; value: number; color: string; dataKey: string }>; label: string }) => {
                  if (!active || !payload || payload.length === 0) return null;

                  const close = payload.find((p) => p.dataKey === 'close');
                  const open = payload.find((p) => p.dataKey === 'open');
                  const high = payload.find((p) => p.dataKey === 'high');
                  const low = payload.find((p) => p.dataKey === 'low');
                  const volume = payload.find((p) => p.dataKey === 'volume');

                  return (
                    <div className="bg-background border border-border rounded-lg shadow-lg p-3 text-xs">
                      <p className="font-semibold mb-2">{label}</p>
                      {close && (
                        <p className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Close:</span>
                          <span className="font-mono font-medium">{safeToFixed(close.value)}</span>
                        </p>
                      )}
                      {open && (
                        <p className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Open:</span>
                          <span className="font-mono">{safeToFixed(open.value)}</span>
                        </p>
                      )}
                      {high && (
                        <p className="flex justify-between gap-4">
                          <span className="text-muted-foreground">High:</span>
                          <span className="font-mono text-emerald-600">{safeToFixed(high.value)}</span>
                        </p>
                      )}
                      {low && (
                        <p className="flex justify-between gap-4">
                          <span className="text-muted-foreground">Low:</span>
                          <span className="font-mono text-red-600">{safeToFixed(low.value)}</span>
                        </p>
                      )}
                      {volume && (
                        <p className="flex justify-between gap-4 mt-1 pt-1 border-t border-border">
                          <span className="text-muted-foreground">Vol:</span>
                          <span className="font-mono">{volume.value.toLocaleString()}</span>
                        </p>
                      )}
                    </div>
                  );
                }}
              />

              {/* Volume Area */}
              {showVolume && (
                <Area
                  yAxisId="volume"
                  dataKey="volume"
                  name="Volume"
                  type="stepAfter"
                  stroke="transparent"
                  fill="url(#volumeGradient)"
                  fillOpacity={0.3}
                />
              )}

              {/* Bollinger Bands */}
              {showBollinger && (
                <>
                  <Line
                    type="monotone"
                    dataKey="bbUpper"
                    stroke={colors.bbUpper}
                    dot={false}
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    yAxisId="price"
                  />
                  <Line
                    type="monotone"
                    dataKey="bbLower"
                    stroke={colors.bbLower}
                    dot={false}
                    strokeWidth={1}
                    strokeDasharray="4 4"
                    yAxisId="price"
                  />
                </>
              )}

              {/* Moving Averages - Individual toggles */}
              {showSMA20 && (
                <Line
                  type="monotone"
                  dataKey="sma20"
                  name="SMA 20"
                  stroke={colors.sma20}
                  dot={false}
                  strokeWidth={1.5}
                  connectNulls
                  yAxisId="price"
                />
              )}
              {showSMA50 && (
                <Line
                  type="monotone"
                  dataKey="sma50"
                  name="SMA 50"
                  stroke={colors.sma50}
                  dot={false}
                  strokeWidth={1.5}
                  connectNulls
                  yAxisId="price"
                />
              )}

              {/* Price Line */}
              {chartType === 'line' && (
                <Line
                  type="monotone"
                  dataKey="close"
                  name="Close"
                  stroke={colors.candleUp}
                  dot={false}
                  strokeWidth={2}
                  yAxisId="price"
                />
              )}

              {/* Area Chart */}
              {chartType === 'area' && (
                <Area
                  yAxisId="price"
                  type="monotone"
                  dataKey="close"
                  name="Close"
                  stroke={colors.candleUp}
                  strokeWidth={2}
                  fill="url(#priceAreaGradient)"
                  fillOpacity={0.4}
                />
              )}

              {/* Candlestick - Professional Style */}
              {chartType === 'candlestick' && (
                <Bar
                  yAxisId="price"
                  dataKey="high"
                  name="Candle"
                  barSize={10}
                  shape={(props: any) => {
                    const { x, payload, yAxis } = props;
                    if (!payload || !yAxis) return null;
                    
                    const isUp = payload.close >= payload.open;
                    const color = isUp ? colors.candleUp : colors.candleDown;
                    
                    // Scale prices to Y coordinates
                    const highY = yAxis.scale(payload.high);
                    const lowY = yAxis.scale(payload.low);
                    const bodyTop = yAxis.scale(payload.candleBodyTop);
                    const bodyBottom = yAxis.scale(payload.candleBodyBottom);
                    
                    // Candle dimensions
                    const bodyWidth = 7;
                    const centerX = x + 2;
                    const bodyHeight = Math.max(Math.abs(bodyTop - bodyBottom), 1);
                    
                    return (
                      <g>
                        {/* Upper shadow/wick */}
                        <line
                          x1={centerX}
                          y1={highY}
                          x2={centerX}
                          y2={bodyTop}
                          stroke={color}
                          strokeWidth={1.5}
                        />
                        {/* Lower shadow/wick */}
                        <line
                          x1={centerX}
                          y1={bodyBottom}
                          x2={centerX}
                          y2={lowY}
                          stroke={color}
                          strokeWidth={1.5}
                        />
                        {/* Candle body - Hollow for bullish, Filled for bearish */}
                        <rect
                          x={centerX - bodyWidth / 2}
                          y={bodyTop}
                          width={bodyWidth}
                          height={bodyHeight}
                          fill={isUp ? 'transparent' : color}
                          stroke={color}
                          strokeWidth={1.5}
                          rx={1}
                          ry={1}
                        />
                      </g>
                    );
                  }}
                />
              )}

              {/* Reference Lines from Professional Analysis */}
              {investmentAnalysis && showSupportResistance && (
                <>
                  {/* Support Line */}
                  {investmentAnalysis.support > 0 && (
                    <ReferenceLine
                      yAxisId="price"
                      y={investmentAnalysis.support}
                      stroke="#10b981"
                      strokeDasharray="5 5"
                      strokeWidth={1.5}
                      label={{ value: 'دعم', position: 'right', fill: '#10b981', fontSize: 10 }}
                    />
                  )}
                  {/* Resistance Line */}
                  {investmentAnalysis.resistance > 0 && (
                    <ReferenceLine
                      yAxisId="price"
                      y={investmentAnalysis.resistance}
                      stroke="#ef4444"
                      strokeDasharray="5 5"
                      strokeWidth={1.5}
                      label={{ value: 'مقاومة', position: 'right', fill: '#ef4444', fontSize: 10 }}
                    />
                  )}
                </>
              )}
              {/* Current Price Line - always visible */}
              {investmentAnalysis && (
                <ReferenceLine
                  yAxisId="price"
                  y={investmentAnalysis.currentPrice}
                  stroke={investmentAnalysis.priceChange >= 0 ? '#10b981' : '#ef4444'}
                  strokeDasharray="2 2"
                  strokeWidth={1}
                  opacity={0.5}
                />
              )}

              {/* Fair Value Line */}
              {showFairValue && fairValuePrice > 0 && (
                <ReferenceLine
                  yAxisId="price"
                  y={fairValuePrice}
                  stroke="#8b5cf6"
                  strokeDasharray="8 4"
                  strokeWidth={2}
                  label={{ value: 'القيمة العادلة', position: 'right', fill: '#8b5cf6', fontSize: 10 }}
                />
              )}
              {/* Entry, Target, Stop Loss Lines */}
              {showEntryTarget && entryPrice > 0 && (
                <ReferenceLine
                  yAxisId="price"
                  y={entryPrice}
                  stroke="#06b6d4"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{ value: 'سعر الدخول', position: 'left', fill: '#06b6d4', fontSize: 9 }}
                />
              )}
              {showEntryTarget && targetPrice > 0 && (
                <ReferenceLine
                  yAxisId="price"
                  y={targetPrice}
                  stroke="#22c55e"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{ value: 'الهدف', position: 'left', fill: '#22c55e', fontSize: 9 }}
                />
              )}
              {showEntryTarget && stopLoss > 0 && (
                <ReferenceLine
                  yAxisId="price"
                  y={stopLoss}
                  stroke="#f43f5e"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={{ value: 'وقف الخسارة', position: 'left', fill: '#f43f5e', fontSize: 9 }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Investment Analysis Overlay Panel */}
        {investmentAnalysis && (
          <div className="absolute left-4 top-20 w-64 bg-background/90 backdrop-blur-sm border border-border rounded-lg shadow-lg p-4 text-xs space-y-3">
            <div className="flex items-center gap-2 font-semibold text-sm border-b border-border pb-2">
              <Lightbulb className="size-4 text-amber-500" />
              <span>Investment Check</span>
            </div>

            {/* Price Stats */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <DollarSign className="size-3" /> Current
                </span>
                <span className="font-mono font-bold">{safeToFixed(investmentAnalysis.currentPrice)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Percent className="size-3" /> Change
                </span>
                <Badge variant={investmentAnalysis.priceChange >= 0 ? 'default' : 'destructive'} className="text-[10px]">
                  {investmentAnalysis.priceChange >= 0 ? '+' : ''}{safeToFixed(investmentAnalysis.priceChangePct)}%
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground flex items-center gap-1">
                  <Activity className="size-3" /> Trend
                </span>
                <Badge variant={investmentAnalysis.trend === 'bullish' ? 'default' : 'destructive'} className="text-[10px]">
                  {investmentAnalysis.trend === 'bullish' ? 'صاعد' : 'هابط'}
                </Badge>
              </div>
            </div>

            <Separator />

            {/* Technical Indicators */}
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-muted-foreground">RSI (14)</span>
                <span className={cn(
                  'font-mono',
                  investmentAnalysis.rsi && investmentAnalysis.rsi > 70 ? 'text-red-600' : 
                  investmentAnalysis.rsi && investmentAnalysis.rsi < 30 ? 'text-emerald-600' : ''
                )}>
                  {investmentAnalysis.rsi ? safeToFixed(investmentAnalysis.rsi, 1) : 'N/A'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Support</span>
                <span className="font-mono">{safeToFixed(investmentAnalysis.support)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Resistance</span>
                <span className="font-mono">{safeToFixed(investmentAnalysis.resistance)}</span>
              </div>
            </div>

            <Separator />

            {/* Volume */}
            <div className="flex justify-between">
              <span className="text-muted-foreground flex items-center gap-1">
                <Volume2 className="size-3" /> Avg Volume
              </span>
              <span className="font-mono">{Math.round(investmentAnalysis.volumeAvg).toLocaleString()}</span>
            </div>

            {/* Investment Recommendation */}
            <div className={cn(
              'p-2 rounded text-center text-xs font-medium',
              investmentAnalysis.trend === 'bullish' && investmentAnalysis.rsi && investmentAnalysis.rsi < 70
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : investmentAnalysis.trend === 'bearish' && investmentAnalysis.rsi && investmentAnalysis.rsi > 30
                ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-muted text-muted-foreground'
            )}>
              {investmentAnalysis.rsi && investmentAnalysis.rsi > 70 ? '⚠️ Overbought - Consider Selling' :
               investmentAnalysis.rsi && investmentAnalysis.rsi < 30 ? '✅ Oversold - Potential Buy' :
               investmentAnalysis.trend === 'bullish' ? '📈 Bullish Trend - Hold/Buy' :
               '📉 Bearish Trend - Caution'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
