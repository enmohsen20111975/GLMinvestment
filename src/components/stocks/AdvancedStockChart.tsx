'use client';

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useTheme } from 'next-themes';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  AreaSeries,
  BarSeries,
  type IChartApi,
  type ISeriesApi,
  type Time,
  ColorType,
  LineStyle,
  CrosshairMode,
} from 'lightweight-charts';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Camera,
  Minus,
  Type,
  Square,
  MousePointer2,
  MoveHorizontal,
  Crosshair as CrosshairIcon,
  BarChart3,
  Settings,
  RotateCcw,
  Layers,
  Minimize2,
  TrendingUp,
  TrendingDown,
  ChevronDown,
  Pencil,
  Eraser,
  Target,
  Activity,
} from 'lucide-react';
import { cn, safeToFixed } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Types ───────────────────────────────────────────────────────────────────

interface AdvancedStockChartProps {
  ticker: string;
  stockName?: string;
}

interface OhlcvBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

type ChartType =
  | 'candlestick'
  | 'ohlc'
  | 'line'
  | 'area'
  | 'hollow'
  | 'heikin_ashi';

type TimeframeKey = '1W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

type DrawingToolType =
  | 'crosshair'
  | 'trendline'
  | 'horizontal'
  | 'fibonacci'
  | 'rectangle'
  | 'text';

interface IndicatorState {
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
  rsi: boolean;
  macd: boolean;
  bollinger: boolean;
}

interface DrawingPoint {
  x: number;
  y: number;
}

interface Drawing {
  id: string;
  type: DrawingToolType;
  points: DrawingPoint[];
  text?: string;
  color?: string;
}

interface HoveredData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TIMEFRAMES: { key: TimeframeKey; label: string; days: number }[] = [
  { key: '1W', label: '1W', days: 7 },
  { key: '1M', label: '1M', days: 30 },
  { key: '3M', label: '3M', days: 90 },
  { key: '6M', label: '6M', days: 180 },
  { key: '1Y', label: '1Y', days: 365 },
  { key: 'ALL', label: 'ALL', days: 9999 },
];

const CHART_TYPES: { key: ChartType; label: string; icon: React.ReactNode }[] = [
  { key: 'candlestick', label: 'Candles', icon: <BarChart3 className="size-3.5" /> },
  { key: 'ohlc', label: 'OHLC', icon: <BarChart3 className="size-3.5" /> },
  { key: 'line', label: 'Line', icon: <TrendingUp className="size-3.5" /> },
  { key: 'area', label: 'Area', icon: <Layers className="size-3.5" /> },
  { key: 'hollow', label: 'Hollow', icon: <Target className="size-3.5" /> },
  { key: 'heikin_ashi', label: 'HA', icon: <Layers className="size-3.5" /> },
];

const DRAWING_TOOLS: { key: DrawingToolType; label: string; icon: React.ReactNode }[] = [
  { key: 'crosshair', label: 'Crosshair', icon: <CrosshairIcon className="size-3.5" /> },
  { key: 'trendline', label: 'Trend Line', icon: <MoveHorizontal className="size-3.5" /> },
  { key: 'horizontal', label: 'Horizontal', icon: <Minus className="size-3.5" /> },
  { key: 'fibonacci', label: 'Fibonacci', icon: <Target className="size-3.5" /> },
  { key: 'rectangle', label: 'Rectangle', icon: <Square className="size-3.5" /> },
  { key: 'text', label: 'Text', icon: <Type className="size-3.5" /> },
];

const UP_COLOR = '#22c55e';
const DOWN_COLOR = '#ef4444';
const VOL_MA_COLOR = '#a16207';

// ─── Indicator Calculations (pure JS) ────────────────────────────────────────

function calcSMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += data[i - j];
      result.push(sum / period);
    }
  }
  return result;
}

function calcEMA(data: number[], period: number): number[] {
  const result: number[] = [];
  const k = 2 / (period + 1);
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      result.push(data[0]);
    } else {
      result.push(data[i] * k + result[i - 1] * (1 - k));
    }
  }
  return result;
}

function calcRSI(closes: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i === 0) {
      result.push(null);
      gains.push(0);
      losses.push(0);
      continue;
    }
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);
    if (i < period) {
      result.push(null);
    } else {
      const avgGain =
        gains.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
      const avgLoss =
        losses.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push(100 - 100 / (1 + rs));
    }
  }
  return result;
}

interface MACDResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

function calcMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9
): MACDResult {
  const emaFast = calcEMA(closes, fast);
  const emaSlow = calcEMA(closes, slow);
  const macdLine: number[] = closes.map((_, i) => emaFast[i] - emaSlow[i]);
  const signalLine = calcEMA(macdLine, signal);
  const histogram: (number | null)[] = macdLine.map((v, i) =>
    i < slow - 1 ? null : v - signalLine[i]
  );
  const macdResult: (number | null)[] = macdLine.map((v, i) =>
    i < slow - 1 ? null : v
  );
  const signalResult: (number | null)[] = signalLine.map((v, i) =>
    i < slow + signal - 2 ? null : v
  );
  return { macd: macdResult, signal: signalResult, histogram };
}

interface BollingerResult {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
}

function calcBollinger(
  closes: number[],
  period = 20,
  stdDev = 2
): BollingerResult {
  const middle = calcSMA(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (middle[i] === null) {
      upper.push(null);
      lower.push(null);
    } else {
      let sumSq = 0;
      for (let j = 0; j < period; j++) {
        sumSq += Math.pow(closes[i - j] - middle[i]!, 2);
      }
      const sd = Math.sqrt(sumSq / period);
      upper.push(middle[i]! + stdDev * sd);
      lower.push(middle[i]! - stdDev * sd);
    }
  }
  return { upper, middle, lower };
}

function calcHeikinAshi(bars: OhlcvBar[]): OhlcvBar[] {
  const result: OhlcvBar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const haClose =
      (bars[i].open + bars[i].high + bars[i].low + bars[i].close) / 4;
    const haOpen =
      i === 0
        ? (bars[i].open + bars[i].close) / 2
        : (result[i - 1].open + result[i - 1].close) / 2;
    const haHigh = Math.max(bars[i].high, haClose, haOpen);
    const haLow = Math.min(bars[i].low, haClose, haOpen);
    result.push({
      date: bars[i].date,
      open: haOpen,
      high: haHigh,
      low: haLow,
      close: haClose,
      volume: bars[i].volume,
    });
  }
  return result;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatVol(vol: number): string {
  if (vol >= 1_000_000_000) return (vol / 1_000_000_000).toFixed(1) + 'B';
  if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(1) + 'M';
  if (vol >= 1_000) return (vol / 1_000).toFixed(1) + 'K';
  return vol.toString();
}

let drawingIdCounter = 0;
function nextDrawingId(): string {
  return 'draw-' + ++drawingIdCounter + '-' + Date.now();
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AdvancedStockChart({
  ticker,
  stockName,
}: AdvancedStockChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // ── Refs ──
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const svgOverlayRef = useRef<SVGSVGElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const chartCreated = useRef(false);

  // ── State ──
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [timeframe, setTimeframe] = useState<TimeframeKey>('1Y');
  const [indicators, setIndicators] = useState<IndicatorState>({
    sma20: false,
    sma50: false,
    sma200: false,
    rsi: false,
    macd: false,
    bollinger: false,
  });
  const [activeTool, setActiveTool] = useState<DrawingToolType>('crosshair');
  const [drawings, setDrawings] = useState<Drawing[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredData, setHoveredData] = useState<HoveredData | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<DrawingPoint | null>(null);
  const [textInput, setTextInput] = useState<{
    id: string;
    x: number;
    y: number;
    value: string;
  } | null>(null);
  const [showIndicators, setShowIndicators] = useState(false);
  const [showDrawings, setShowDrawings] = useState(false);
  const [allData, setAllData] = useState<OhlcvBar[]>([]);

  // ─── Data fetching ────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function fetchData() {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/stocks/${ticker}/history?days=9999`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (json.success && json.data) {
          if (!cancelled) setAllData(json.data as OhlcvBar[]);
        } else {
          throw new Error(json.error || 'Failed to fetch data');
        }
      } catch (e) {
        if (!cancelled)
          setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  // ─── Filter by timeframe ──────────────────────────────────────────────────

  const filteredData = useMemo(() => {
    if (allData.length === 0) return [];
    const tf = TIMEFRAMES.find((t) => t.key === timeframe);
    if (!tf || tf.days >= 9999) return allData;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - tf.days);
    return allData.filter((b) => new Date(b.date) >= cutoff);
  }, [allData, timeframe]);

  // ─── Calculate indicators ─────────────────────────────────────────────────

  const indicatorData = useMemo(() => {
    if (filteredData.length === 0)
      return {
        sma20: [] as (number | null)[],
        sma50: [] as (number | null)[],
        sma200: [] as (number | null)[],
        rsi: [] as (number | null)[],
        macd: { macd: [], signal: [], histogram: [] } as MACDResult,
        bollinger: { upper: [], middle: [], lower: [] } as BollingerResult,
        volMA: [] as (number | null)[],
        heikinAshi: [] as OhlcvBar[],
      };

    const closes = filteredData.map((b) => b.close);
    const volumes = filteredData.map((b) => b.volume);

    return {
      sma20: calcSMA(closes, 20),
      sma50: calcSMA(closes, 50),
      sma200: calcSMA(closes, 200),
      rsi: calcRSI(closes, 14),
      macd: calcMACD(closes, 12, 26, 9),
      bollinger: calcBollinger(closes, 20, 2),
      volMA: calcSMA(volumes, 20),
      heikinAshi: calcHeikinAshi(filteredData),
    };
  }, [filteredData]);

  // ─── Last bar for OHLCV header ────────────────────────────────────────────

  const lastBar = useMemo(() => {
    if (filteredData.length === 0) return null;
    return filteredData[filteredData.length - 1];
  }, [filteredData]);

  const prevClose = useMemo(() => {
    if (filteredData.length < 2) return null;
    return filteredData[filteredData.length - 2].close;
  }, [filteredData]);

  const displayData = useMemo(
    () =>
      hoveredData ||
      (lastBar
        ? {
            date: lastBar.date,
            open: lastBar.open,
            high: lastBar.high,
            low: lastBar.low,
            close: lastBar.close,
            volume: lastBar.volume,
          }
        : null),
    [hoveredData, lastBar]
  );

  const priceChange = useMemo(() => {
    if (!displayData || !prevClose) return null;
    return displayData.close - prevClose;
  }, [displayData, prevClose]);

  const priceChangePct = useMemo(() => {
    if (!priceChange || !prevClose) return null;
    return (priceChange / prevClose) * 100;
  }, [priceChange, prevClose]);

  // ─── Theme colors ─────────────────────────────────────────────────────────

  const themeColors = useMemo(() => {
    const bg = isDark ? '#0f1117' : '#ffffff';
    const gridColor = isDark ? '#1e293b' : '#e2e8f0';
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const borderColor = isDark ? '#1e293b' : '#e2e8f0';
    const crosshairColor = isDark ? '#475569' : '#94a3b8';
    const areaTop = isDark ? 'rgba(34,197,94,0.4)' : 'rgba(34,197,94,0.3)';
    const areaBottom = 'rgba(34,197,94,0.02)';
    return {
      bg,
      gridColor,
      textColor,
      borderColor,
      crosshairColor,
      areaTop,
      areaBottom,
    };
  }, [isDark]);

  // ─── Chart lifecycle ──────────────────────────────────────────────────────

  const rebuildChart = useCallback(() => {
    if (!containerRef.current) return;

    // Destroy existing chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }
    chartCreated.current = false;

    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const w = rect.width > 0 ? rect.width : 800;
    const h = rect.height > 0 ? rect.height : 500;

    const chart = createChart(container, {
      width: w,
      height: h,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: themeColors.bg },
        textColor: themeColors.textColor,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: themeColors.gridColor, style: LineStyle.Dotted },
        horzLines: { color: themeColors.gridColor, style: LineStyle.Dotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: themeColors.crosshairColor,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#64748b',
        },
        horzLine: {
          color: themeColors.crosshairColor,
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#64748b',
        },
      },
      rightPriceScale: {
        borderColor: themeColors.borderColor,
        scaleMargins: { top: 0.05, bottom: 0.05 },
      },
      timeScale: {
        borderColor: themeColors.borderColor,
        timeVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: { vertTouchDrag: false },
    });

    chartRef.current = chart;
    chartCreated.current = true;
  }, [themeColors]);

  // Build chart when theme changes
  useEffect(() => {
    rebuildChart();
    return () => {
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
      chartCreated.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebuildChart]);

  // ─── Update chart data & series ───────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || filteredData.length === 0 || !chartCreated.current) return;

    const times = filteredData.map((b) => b.date as Time);

    const displayBars =
      chartType === 'heikin_ashi' ? indicatorData.heikinAshi : filteredData;

    // ── Remove all existing series ──
    const allPanes = chart.panes();
    for (let pi = allPanes.length - 1; pi >= 0; pi--) {
      const pSeries = allPanes[pi].getSeries();
      for (const s of pSeries) {
        try {
          chart.removeSeries(s);
        } catch {
          /* ignore */
        }
      }
    }

    // ── Main price series ──
    if (
      chartType === 'candlestick' ||
      chartType === 'hollow' ||
      chartType === 'heikin_ashi'
    ) {
      const series = chart.addSeries(
        CandlestickSeries,
        {
          upColor: UP_COLOR,
          downColor: DOWN_COLOR,
          borderUpColor: UP_COLOR,
          borderDownColor: DOWN_COLOR,
          wickUpColor: UP_COLOR,
          wickDownColor: DOWN_COLOR,
          ...(chartType === 'hollow'
            ? { upColor: 'transparent', borderUpColor: UP_COLOR }
            : {}),
        },
        0
      );
      series.setData(
        displayBars.map((b) => ({
          time: b.date as Time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }))
      );
    } else if (chartType === 'ohlc') {
      const series = chart.addSeries(
        BarSeries,
        { upColor: UP_COLOR, downColor: DOWN_COLOR },
        0
      );
      series.setData(
        displayBars.map((b) => ({
          time: b.date as Time,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        }))
      );
    } else if (chartType === 'line') {
      const series = chart.addSeries(
        LineSeries,
        { color: UP_COLOR, lineWidth: 2 },
        0
      );
      series.setData(
        displayBars.map((b) => ({
          time: b.date as Time,
          value: b.close,
        }))
      );
    } else if (chartType === 'area') {
      const series = chart.addSeries(
        AreaSeries,
        {
          topColor: themeColors.areaTop,
          bottomColor: themeColors.areaBottom,
          lineColor: UP_COLOR,
          lineWidth: 2,
        },
        0
      );
      series.setData(
        displayBars.map((b) => ({
          time: b.date as Time,
          value: b.close,
        }))
      );
    }

    // ── Current price line ──
    if (lastBar) {
      const plSeries = chart.addSeries(
        LineSeries,
        {
          color: themeColors.textColor,
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          lastValueVisible: false,
          priceLineVisible: false,
          crosshairMarkerVisible: false,
        },
        0
      );
      plSeries.setData([
        { time: times[0], value: lastBar.close },
        { time: times[times.length - 1], value: lastBar.close },
      ]);
    }

    // ── Volume pane ──
    const volPane = chart.addPane();
    const volPaneIdx = volPane.paneIndex();

    const volumeSeries = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: 'volume' },
        priceScaleId: 'vol',
      },
      volPaneIdx
    );
    chart.priceScale('vol', volPaneIdx).applyOptions({
      scaleMargins: { top: 0.1, bottom: 0.0 },
    });
    volumeSeries.setData(
      filteredData.map((b, i) => ({
        time: times[i],
        value: b.volume,
        color: b.close >= b.open ? UP_COLOR : DOWN_COLOR,
      }))
    );

    // Volume MA20
    const volMASeries = chart.addSeries(
      LineSeries,
      {
        color: VOL_MA_COLOR,
        lineWidth: 1,
        priceScaleId: 'vol',
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      },
      volPaneIdx
    );
    volMASeries.setData(
      indicatorData.volMA
        .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
        .filter(Boolean) as { time: Time; value: number }[]
    );

    // ── SMA overlays on main chart ──
    if (indicators.sma20) {
      const s = chart.addSeries(
        LineSeries,
        {
          color: '#eab308',
          lineWidth: 1,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: 'SMA 20',
        },
        0
      );
      s.setData(
        indicatorData.sma20
          .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
          .filter(Boolean) as { time: Time; value: number }[]
      );
    }
    if (indicators.sma50) {
      const s = chart.addSeries(
        LineSeries,
        {
          color: '#3b82f6',
          lineWidth: 1,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: 'SMA 50',
        },
        0
      );
      s.setData(
        indicatorData.sma50
          .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
          .filter(Boolean) as { time: Time; value: number }[]
      );
    }
    if (indicators.sma200) {
      const s = chart.addSeries(
        LineSeries,
        {
          color: '#ef4444',
          lineWidth: 1,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: 'SMA 200',
        },
        0
      );
      s.setData(
        indicatorData.sma200
          .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
          .filter(Boolean) as { time: Time; value: number }[]
      );
    }

    // ── Bollinger Bands on main chart ──
    if (indicators.bollinger) {
      const upper = chart.addSeries(
        LineSeries,
        {
          color: '#8b5cf6',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        0
      );
      upper.setData(
        indicatorData.bollinger.upper
          .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
          .filter(Boolean) as { time: Time; value: number }[]
      );

      const middle = chart.addSeries(
        LineSeries,
        {
          color: '#8b5cf680',
          lineWidth: 1,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        0
      );
      middle.setData(
        indicatorData.bollinger.middle
          .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
          .filter(Boolean) as { time: Time; value: number }[]
      );

      const lower = chart.addSeries(
        LineSeries,
        {
          color: '#8b5cf6',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        0
      );
      lower.setData(
        indicatorData.bollinger.lower
          .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
          .filter(Boolean) as { time: Time; value: number }[]
      );
    }

    // ── RSI pane ──
    if (indicators.rsi) {
      const rsiPane = chart.addPane();
      const rsiIdx = rsiPane.paneIndex();

      const rsiSeries = chart.addSeries(
        LineSeries,
        {
          color: '#a855f7',
          lineWidth: 2,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: 'RSI(14)',
        },
        rsiIdx
      );
      rsiSeries.setData(
        indicatorData.rsi
          .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
          .filter(Boolean) as { time: Time; value: number }[]
      );

      // Overbought line at 70
      const ob = chart.addSeries(
        LineSeries,
        {
          color: '#ef444460',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        rsiIdx
      );
      ob.setData(times.map((t) => ({ time: t, value: 70 })));

      // Oversold line at 30
      const os = chart.addSeries(
        LineSeries,
        {
          color: '#22c55e60',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        },
        rsiIdx
      );
      os.setData(times.map((t) => ({ time: t, value: 30 })));
    }

    // ── MACD pane ──
    if (indicators.macd) {
      const macdPane = chart.addPane();
      const macdIdx = macdPane.paneIndex();

      // Histogram
      const mHist = chart.addSeries(
        HistogramSeries,
        { priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } },
        macdIdx
      );
      mHist.setData(
        indicatorData.macd.histogram
          .map((v, i) =>
            v !== null
              ? {
                  time: times[i],
                  value: v,
                  color: v >= 0 ? UP_COLOR : DOWN_COLOR,
                }
              : null
          )
          .filter(
            Boolean
          ) as { time: Time; value: number; color: string }[]
      );

      // MACD line
      const mLine = chart.addSeries(
        LineSeries,
        {
          color: '#3b82f6',
          lineWidth: 2,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: 'MACD',
        },
        macdIdx
      );
      mLine.setData(
        indicatorData.macd.macd
          .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
          .filter(Boolean) as { time: Time; value: number }[]
      );

      // Signal line
      const mSignal = chart.addSeries(
        LineSeries,
        {
          color: '#f97316',
          lineWidth: 2,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
          title: 'Signal',
        },
        macdIdx
      );
      mSignal.setData(
        indicatorData.macd.signal
          .map((v, i) => (v !== null ? { time: times[i], value: v } : null))
          .filter(Boolean) as { time: Time; value: number }[]
      );
    }

    chart.timeScale().fitContent();
  }, [
    filteredData,
    chartType,
    indicators,
    indicatorData,
    themeColors,
    lastBar,
  ]);

  // ─── Crosshair move handler ───────────────────────────────────────────────

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || filteredData.length === 0) return;

    const handler = (param: any) => {
      if (!param.point || !param.time) {
        if (lastBar) {
          setHoveredData({
            date: lastBar.date,
            open: lastBar.open,
            high: lastBar.high,
            low: lastBar.low,
            close: lastBar.close,
            volume: lastBar.volume,
          });
        }
        return;
      }

      const timeStr =
        typeof param.time === 'string'
          ? param.time
          : param.time instanceof Date
            ? param.time.toISOString().split('T')[0]
            : new Date(param.time * 1000).toISOString().split('T')[0];

      const bar = filteredData.find((b) => b.date === timeStr);
      if (bar) {
        setHoveredData({
          date: bar.date,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
        });
      }
    };

    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [filteredData, lastBar]);

  // ─── Fullscreen listener ──────────────────────────────────────────────────

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  // ─── Drawing tool handlers ────────────────────────────────────────────────

  const handleSvgMouseDown = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      if (activeTool === 'crosshair' || activeTool === 'text') return;
      const rect = svgOverlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setDrawStart({ x, y });
      setIsDrawing(true);
      // Create a temporary drawing for preview
      setDrawings((prev) => [
        ...prev,
        { id: nextDrawingId(), type: activeTool, points: [{ x, y }] },
      ]);
    },
    [activeTool]
  );

  const handleSvgMouseMove = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      if (!isDrawing || !drawStart) return;
      const rect = svgOverlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      setDrawings((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.points.length === 1) {
          return [
            ...prev.slice(0, -1),
            { ...last, points: [last.points[0], { x, y }] },
          ];
        }
        return prev;
      });
    },
    [isDrawing, drawStart]
  );

  const handleSvgMouseUp = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      if (!isDrawing || !drawStart) return;
      const rect = svgOverlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      // Update the final drawing with the second point
      setDrawings((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.points.length === 1) {
          return [
            ...prev.slice(0, -1),
            { ...last, points: [last.points[0], { x, y }] },
          ];
        }
        return prev;
      });

      setIsDrawing(false);
      setDrawStart(null);
    },
    [isDrawing, drawStart]
  );

  const handleSvgClick = useCallback(
    (e: ReactMouseEvent<SVGSVGElement>) => {
      if (activeTool !== 'horizontal' && activeTool !== 'text') return;
      const rect = svgOverlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (activeTool === 'horizontal') {
        setDrawings((prev) => [
          ...prev,
          {
            id: nextDrawingId(),
            type: 'horizontal',
            points: [{ x: 0, y }, { x: rect.width, y }],
          },
        ]);
      } else if (activeTool === 'text') {
        setTextInput({ id: nextDrawingId(), x, y, value: '' });
      }
    },
    [activeTool]
  );

  const handleTextSubmit = useCallback(() => {
    if (!textInput || !textInput.value.trim()) {
      setTextInput(null);
      return;
    }
    setDrawings((prev) => [
      ...prev,
      {
        id: textInput.id,
        type: 'text',
        points: [{ x: textInput.x, y: textInput.y }],
        text: textInput.value,
      },
    ]);
    setTextInput(null);
  }, [textInput]);

  const handleClearDrawings = useCallback(() => {
    setDrawings([]);
  }, []);

  // ─── Chart controls ───────────────────────────────────────────────────────

  const handleZoomIn = useCallback(() => {
    if (!chartRef.current) return;
    const ts = chartRef.current.timeScale();
    const current = ts.options().rightOffset ?? 5;
    ts.applyOptions({ rightOffset: Math.max(1, current - 5) });
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!chartRef.current) return;
    const ts = chartRef.current.timeScale();
    const current = ts.options().rightOffset ?? 5;
    ts.applyOptions({ rightOffset: Math.min(80, current + 5) });
  }, []);

  const handleFit = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
  }, []);

  const handleScreenshot = useCallback(async () => {
    if (!chartRef.current) return;
    try {
      const canvas = chartRef.current.takeScreenshot();
      const link = document.createElement('a');
      link.download = `${ticker}_chart_${new Date().toISOString().split('T')[0]}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('Screenshot failed:', e);
    }
  }, [ticker]);

  const handleFullscreen = useCallback(() => {
    if (!wrapperRef.current) return;
    if (!document.fullscreenElement) {
      wrapperRef.current
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(() => {});
    } else {
      document
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(() => {});
    }
  }, []);

  const toggleIndicator = useCallback((key: keyof IndicatorState) => {
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const changeChartType = useCallback((type: ChartType) => {
    setChartType(type);
  }, []);

  const changeTimeframe = useCallback((tf: TimeframeKey) => {
    setTimeframe(tf);
  }, []);

  // ─── Drawing SVG renderer ─────────────────────────────────────────────────

  const renderDrawing = (d: Drawing) => {
    const color = d.color || (isDark ? '#e2e8f0' : '#334155');

    switch (d.type) {
      case 'trendline': {
        const [p1, p2] = d.points;
        if (!p2) return null;
        return (
          <line
            key={d.id}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke={color}
            strokeWidth={2}
            strokeLinecap="round"
          />
        );
      }
      case 'horizontal': {
        const [p1, p2] = d.points;
        return (
          <line
            key={d.id}
            x1={p1.x}
            y1={p1.y}
            x2={p2.x}
            y2={p2.y}
            stroke={color}
            strokeWidth={1}
            strokeDasharray="6,3"
          />
        );
      }
      case 'fibonacci': {
        const [p1, p2] = d.points;
        if (!p2) return null;
        const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
        const fibColors = [
          '#ef4444',
          '#f97316',
          '#eab308',
          '#22c55e',
          '#3b82f6',
          '#8b5cf6',
          '#ef4444',
        ];
        return (
          <g key={d.id}>
            <line
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              stroke={color}
              strokeWidth={1}
              strokeDasharray="4,4"
              opacity={0.5}
            />
            {levels.map((level, idx) => {
              const y = p1.y + (p2.y - p1.y) * level;
              const minX = Math.min(p1.x, p2.x);
              const maxX = Math.max(p1.x, p2.x);
              return (
                <g key={idx}>
                  <line
                    x1={minX}
                    y1={y}
                    x2={maxX}
                    y2={y}
                    stroke={fibColors[idx]}
                    strokeWidth={1}
                    strokeDasharray="3,3"
                    opacity={0.7}
                  />
                  <text
                    x={maxX + 4}
                    y={y + 3}
                    fill={fibColors[idx]}
                    fontSize={10}
                    fontFamily="system-ui, sans-serif"
                  >
                    {(level * 100).toFixed(1)}%
                  </text>
                </g>
              );
            })}
          </g>
        );
      }
      case 'rectangle': {
        const [p1, p2] = d.points;
        if (!p2) return null;
        const rx = Math.min(p1.x, p2.x);
        const ry = Math.min(p1.y, p2.y);
        const rw = Math.abs(p2.x - p1.x);
        const rh = Math.abs(p2.y - p1.y);
        return (
          <rect
            key={d.id}
            x={rx}
            y={ry}
            width={rw}
            height={rh}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            rx={2}
          />
        );
      }
      case 'text': {
        if (!d.text) return null;
        const [p1] = d.points;
        return (
          <text
            key={d.id}
            x={p1.x}
            y={p1.y}
            fill={color}
            fontSize={12}
            fontFamily="system-ui, sans-serif"
            fontWeight={500}
          >
            {d.text}
          </text>
        );
      }
      default:
        return null;
    }
  };

  // ─── Loading / Error states ───────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <Skeleton className="h-5 w-40" />
          <div className="flex gap-2">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-7 w-16" />
          </div>
        </div>
        <Skeleton className="w-full h-[500px]" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center justify-center text-muted-foreground gap-3 min-h-[400px]">
        <p className="text-sm font-medium text-destructive">Failed to load chart data</p>
        <p className="text-xs">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.location.reload()}
        >
          <RotateCcw className="size-3.5 mr-1.5" />
          Retry
        </Button>
      </div>
    );
  }

  // ─── No data state ──────────────────────────────────────────────────────

  if (!isLoading && !error && filteredData.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center justify-center text-muted-foreground gap-3 min-h-[400px]">
        <BarChart3 className="size-10 opacity-30" />
        <p className="text-sm font-medium">لا توجد بيانات تاريخية لهذا السهم</p>
        <p className="text-xs text-center max-w-md">
          البيانات السعرية التاريخية غير متوفرة حالياً. يمكنك النقر على &quot;مزامنة البيانات&quot; من لوحة تحكم المدير لتحديث البيانات.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => window.location.reload()}
        >
          <RotateCcw className="size-3.5 mr-1.5" />
          إعادة المحاولة
        </Button>
      </div>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────────

  const activeIndicatorCount = Object.values(indicators).filter(Boolean).length;

  return (
    <div
      ref={wrapperRef}
      className={cn(
        'rounded-xl border border-border bg-card overflow-hidden flex flex-col',
        isFullscreen && 'rounded-none border-0'
      )}
    >
      {/* ── Top toolbar ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border gap-2 flex-wrap">
        {/* Left: Stock name & price */}
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-sm font-semibold text-foreground truncate">
            {stockName || ticker}
          </span>
          {displayData && (
            <div className="flex items-center gap-1.5" dir="ltr">
              <span className="text-sm font-bold tabular-nums text-foreground">
                {safeToFixed(displayData.close, 3)}
              </span>
              {priceChange !== null && priceChangePct !== null && (
                <span
                  className={cn(
                    'text-xs font-medium tabular-nums flex items-center gap-0.5',
                    priceChange >= 0
                      ? 'text-emerald-500'
                      : 'text-red-500'
                  )}
                >
                  {priceChange >= 0 ? (
                    <TrendingUp className="size-3" />
                  ) : (
                    <TrendingDown className="size-3" />
                  )}
                  {priceChange >= 0 ? '+' : ''}
                  {safeToFixed(priceChange, 3)} (
                  {priceChangePct >= 0 ? '+' : ''}
                  {safeToFixed(priceChangePct, 2)}%)
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right: Chart type + Timeframes + Controls */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Chart type selector */}
          <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5">
            {CHART_TYPES.map((ct) => (
              <Tooltip key={ct.key}>
                <TooltipTrigger asChild>
                  <Button
                    variant={chartType === ct.key ? 'secondary' : 'ghost'}
                    size="sm"
                    className={cn(
                      'h-6 px-2 text-xs gap-1',
                      chartType === ct.key && 'shadow-xs'
                    )}
                    onClick={() => changeChartType(ct.key)}
                  >
                    {ct.icon}
                    <span className="hidden sm:inline">{ct.label}</span>
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{ct.label}</TooltipContent>
              </Tooltip>
            ))}
          </div>

          <Separator orientation="vertical" className="h-5" />

          {/* Timeframes */}
          <div className="flex items-center gap-0.5">
            {TIMEFRAMES.map((tf) => (
              <Button
                key={tf.key}
                variant={timeframe === tf.key ? 'default' : 'ghost'}
                size="sm"
                className="h-6 px-2 text-xs font-medium"
                onClick={() => changeTimeframe(tf.key)}
              >
                {tf.label}
              </Button>
            ))}
          </div>

          <Separator orientation="vertical" className="h-5" />

          {/* Drawing tools */}
          <div className="flex items-center gap-0.5 bg-muted/50 rounded-md p-0.5">
            {DRAWING_TOOLS.map((tool) => (
              <Tooltip key={tool.key}>
                <TooltipTrigger asChild>
                  <Button
                    variant={
                      activeTool === tool.key ? 'secondary' : 'ghost'
                    }
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => setActiveTool(tool.key)}
                  >
                    {tool.icon}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">{tool.label}</TooltipContent>
              </Tooltip>
            ))}
            {drawings.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-red-400 hover:text-red-500"
                    onClick={handleClearDrawings}
                  >
                    <Eraser className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Clear Drawings</TooltipContent>
              </Tooltip>
            )}
          </div>

          <Separator orientation="vertical" className="h-5" />

          {/* Indicators toggle */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className={cn(
                  'h-6 px-2 text-xs gap-1 relative',
                  activeIndicatorCount > 0 &&
                    'text-amber-500'
                )}
                onClick={() => setShowIndicators((p) => !p)}
              >
                <Activity className="size-3.5" />
                <span className="hidden md:inline">Indicators</span>
                {activeIndicatorCount > 0 && (
                  <span className="absolute -top-1 -right-1 bg-amber-500 text-[9px] text-white rounded-full size-3.5 flex items-center justify-center font-bold">
                    {activeIndicatorCount}
                  </span>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Technical Indicators</TooltipContent>
          </Tooltip>

          {/* Zoom & utility controls */}
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={handleZoomIn}
                >
                  <ZoomIn className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Zoom In</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={handleZoomOut}
                >
                  <ZoomOut className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Zoom Out</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={handleFit}
                >
                  <Maximize2 className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Fit</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={handleScreenshot}
                >
                  <Camera className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Screenshot</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={handleFullscreen}
                >
                  {isFullscreen ? (
                    <Minimize2 className="size-3.5" />
                  ) : (
                    <Maximize2 className="size-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* ── OHLCV Header ── */}
      {displayData && (
        <div
          className="flex items-center gap-4 px-4 py-1.5 text-xs border-b border-border bg-muted/30"
          dir="ltr"
        >
          <span className="text-muted-foreground font-medium">
            {displayData.date}
          </span>
          <div className="flex items-center gap-4 flex-1 tabular-nums">
            <span>
              <span className="text-muted-foreground">O </span>
              <span className="text-foreground font-medium">
                {safeToFixed(displayData.open, 3)}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">H </span>
              <span className="text-emerald-500 font-medium">
                {safeToFixed(displayData.high, 3)}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">L </span>
              <span className="text-red-500 font-medium">
                {safeToFixed(displayData.low, 3)}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">C </span>
              <span
                className={cn(
                  'font-medium',
                  displayData.close >= displayData.open
                    ? 'text-emerald-500'
                    : 'text-red-500'
                )}
              >
                {safeToFixed(displayData.close, 3)}
              </span>
            </span>
            <span>
              <span className="text-muted-foreground">Vol </span>
              <span className="text-foreground font-medium">
                {formatVol(displayData.volume)}
              </span>
            </span>
          </div>
        </div>
      )}

      {/* ── Indicators dropdown panel ── */}
      {showIndicators && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/20 flex-wrap">
          <span className="text-xs text-muted-foreground font-medium mr-1">
            Indicators:
          </span>
          {(
            [
              { key: 'sma20' as const, label: 'SMA 20', color: '#eab308' },
              { key: 'sma50' as const, label: 'SMA 50', color: '#3b82f6' },
              { key: 'sma200' as const, label: 'SMA 200', color: '#ef4444' },
              { key: 'bollinger' as const, label: 'BB(20,2)', color: '#8b5cf6' },
              { key: 'rsi' as const, label: 'RSI(14)', color: '#a855f7' },
              { key: 'macd' as const, label: 'MACD(12,26,9)', color: '#3b82f6' },
            ] as const
          ).map((ind) => (
            <Button
              key={ind.key}
              variant={indicators[ind.key] ? 'secondary' : 'outline'}
              size="sm"
              className="h-7 px-2.5 text-xs gap-1.5"
              onClick={() => toggleIndicator(ind.key)}
            >
              <span
                className="size-2 rounded-full inline-block"
                style={{ backgroundColor: ind.color }}
              />
              {ind.label}
            </Button>
          ))}
        </div>
      )}

      {/* ── Chart container ── */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={containerRef}
          className="w-full"
          style={{ height: isFullscreen ? 'calc(100vh - 120px)' : '500px' }}
        />

        {/* SVG drawing overlay */}
        <svg
          ref={svgOverlayRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ zIndex: 10 }}
        >
          {drawings.map(renderDrawing)}
        </svg>

        {/* Interactive SVG overlay for drawing tools */}
        {activeTool !== 'crosshair' && (
          <svg
            className="absolute inset-0 w-full h-full"
            style={{ zIndex: 11, cursor: activeTool === 'text' ? 'text' : 'crosshair' }}
            onMouseDown={handleSvgMouseDown}
            onMouseMove={handleSvgMouseMove}
            onMouseUp={handleSvgMouseUp}
            onClick={handleSvgClick}
          />
        )}

        {/* Text input overlay */}
        {textInput && (
          <div
            className="absolute z-20"
            style={{ left: textInput.x, top: textInput.y }}
          >
            <div className="flex items-center gap-1 bg-card border border-border rounded-md shadow-lg p-1">
              <input
                type="text"
                autoFocus
                value={textInput.value}
                onChange={(e) =>
                  setTextInput((p) => (p ? { ...p, value: e.target.value } : null))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleTextSubmit();
                  if (e.key === 'Escape') setTextInput(null);
                }}
                onBlur={handleTextSubmit}
                placeholder="Type..."
                className="w-32 h-6 px-2 text-xs bg-transparent border-0 outline-none text-foreground placeholder:text-muted-foreground"
                dir="ltr"
              />
            </div>
          </div>
        )}

        {/* Active tool indicator */}
        {activeTool !== 'crosshair' && (
          <div className="absolute bottom-3 left-3 z-20 flex items-center gap-1.5 bg-card/90 backdrop-blur-sm border border-border rounded-md px-2.5 py-1 shadow-xs">
            <Pencil className="size-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground font-medium">
              {DRAWING_TOOLS.find((t) => t.key === activeTool)?.label}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
