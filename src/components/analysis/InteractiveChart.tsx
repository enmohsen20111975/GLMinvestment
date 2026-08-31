'use client';

import React, { useEffect, useMemo, useRef } from 'react';
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  type IChartApi,
  type ISeriesApi,
  ColorType,
  LineStyle,
  type Time,
} from 'lightweight-charts';
import { useTheme } from 'next-themes';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChartData {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface IndicatorData {
  time: string;
  value: number | null;
}

interface FullChartProps {
  ohlcv: ChartData[];
  indicators: {
    sma20?: IndicatorData[];
    sma50?: IndicatorData[];
    sma200?: IndicatorData[];
    rsi?: IndicatorData[];
    cmf?: IndicatorData[];
    bb_upper?: IndicatorData[];
    bb_middle?: IndicatorData[];
    bb_lower?: IndicatorData[];
    // TOOLKIT-UNIFY-010: MACD from backend (unified with maestro)
    macd?: IndicatorData[];
    macd_signal?: IndicatorData[];
    macd_histogram?: IndicatorData[];
  };
  visibleIndicators: Record<string, boolean>;
  levels?: {
    support: number | null;
    resistance: number | null;
    pivot: number | null;
    far_support?: number | null;
    far_resistance?: number | null;
    support_levels?: { price: number; strength: string }[];
    resistance_levels?: { price: number; strength: string }[];
  };
  regimeColor?: string;
  targetPrice?: number | null;
  stopLossPrice?: number | null;
  // CHART-PRO-047: Entry + TP2 + TP3 lines
  entryPrice?: number | null;
  target2Price?: number | null;
  target3Price?: number | null;
  bbSqueezeLevel?: string | null;
  bosEvents?: Array<{ index: number; type: string; price: number; level: number }>;
  // STRATEGY-041: Live candle update — آخر سعر لحظي من WebSocket
  livePrice?: number | null;
  // CHART-V2-044: Advanced indicators
  cmfData?: IndicatorData[];
  macdProjection?: Array<number | null>;
  smartMarkers?: Array<{
    time: string;
    type: string;
    position: string;
    color: string;
    shape: string;
    text: string;
  }>;
  // SMC-ENGINE-066: Smart Money Concepts (Order Blocks + FVG + Sweeps)
  smcData?: {
    order_blocks?: Array<{ type: string; top: number; bottom: number; time?: number }>;
    fvgs?: Array<{ type: string; top: number; bottom: number; time?: number }>;
    sweeps?: Array<{ type: string; level: number; time?: number }>;
    score?: number;
    signals?: string[];
    ready?: boolean;
    // BRIEF-045: zones for box drawing
    smc_zones?: Array<{ type: string; top: number; bottom: number; zone_type: string }>;
  };
  // PHASE 11: محرك التحليل الموحد (Multi-Source Confluence)
  fusionMetrics?: {
    score: number;
    signal: string;
    signal_ar: string;
    fair_value: number;
    fair_premium: number;
    bigbeluga: {
      trend: number;          // -1, 0, 1
      in_pocket: boolean;     // السعر داخل الجيب الذهبي؟
      fib_618: number;
      fib_786: number;
      basis: number;
      upper_band: number;
      lower_band: number;
    };
    risk: {
      entry: number;
      sl: number;
      tp1: number;
      tp2: number;
      risk_amount: number;
      rr_ratio_tp1: number;
      rr_ratio_tp2: number;
    };
    ready: boolean;
  };
}

// ─── Theme Constants (CHART-UX-030: TradingView Dark Theme) ──────────────────

const CHART_BG = '#131722';      // TradingView dark background
const CHART_GRID = '#363c4e';    // TradingView grid lines (was #1e222d — too dark)
const CHART_TEXT = '#d1d4dc';    // TradingView text color
const UP_COLOR = '#26a69a';      // TradingView bullish candle
const DOWN_COLOR = '#ef5350';    // TradingView bearish candle

const SMA20_COLOR = '#f0b90b';   // gold
const SMA50_COLOR = '#ff9800';   // CHART-UX-030: orange (was #2196f3 blue)
const SMA200_COLOR = '#2196f3';  // CHART-UX-030: blue (was #9c27b0 purple)
const BB_UPPER_COLOR = '#607d8b';
const BB_MIDDLE_COLOR = '#78909c';
const BB_LOWER_COLOR = '#607d8b';
const BB_SQUEEZE_COLOR = '#f97316'; // Orange for squeeze

const SUPPORT_COLOR = '#26a69a';
const RESISTANCE_COLOR = '#ef5350';
const PIVOT_COLOR = '#ff9800';

const RSI_COLOR = '#e040fb';
const CMF_COLOR = '#00bcd4';

const EMA9_COLOR = '#ff6b6b';
const EMA21_COLOR = '#4ecdc4';

const MACD_LINE_COLOR = '#2196f3';
const MACD_SIGNAL_COLOR = '#ff6b6b';
const MACD_HIST_POS = '#26a69a';
const MACD_HIST_NEG = '#ef5350';

const OBV_COLOR = '#ab47bc';
const FIB_COLOR = '#ffd700';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toTime(timeVal: string | number): Time {
  if (typeof timeVal === 'number') {
    return timeVal as Time;
  }
  if (!timeVal) {
    return Math.floor(Date.now() / 1000) as Time;
  }
  const s = String(timeVal).trim();
  const asNum = Number(s);
  if (!isNaN(asNum) && /^\d+(\.\d+)?$/.test(s)) {
    return Math.floor(asNum) as Time;
  }
  if (s.length === 10 && s[4] === '-' && s[7] === '-') {
    return s as Time;
  }
  if (s.includes('/')) {
    const parts = s.split(' ');
    const dateParts = parts[0].split('/');
    const timeParts = parts[1] ? parts[1].split(':') : ['00', '00'];
    const now = new Date();
    const day = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10) - 1;
    const year = dateParts[2] ? parseInt(dateParts[2], 10) : now.getFullYear();
    const hours = parseInt(timeParts[0], 10) || 0;
    const mins = parseInt(timeParts[1], 10) || 0;
    const d = new Date(year, month, day, hours, mins);
    if (!isNaN(d.getTime())) {
      return Math.floor(d.getTime() / 1000) as Time;
    }
  }
  const parsed = Date.parse(s.replace(' ', 'T'));
  if (!isNaN(parsed)) {
    return Math.floor(parsed / 1000) as Time;
  }
  return s as Time;
}

// ── P32 TASK 1+2: time → numeric seconds (for sort/dedup) ──
// lightweight-charts requires strictly ascending, unique times. Mixed string/number
// times (daily 'yyyy-mm-dd' vs intraday unix-seconds) must be comparable.
function timeToNumber(t: Time): number {
  if (typeof t === 'number') return t;
  const s = String(t);
  const p = s.split('-');
  if (p.length === 3 && p[0].length === 4) {
    const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    return Math.floor(d.getTime() / 1000);
  }
  const parsed = Date.parse(s.replace(' ', 'T'));
  return isNaN(parsed) ? 0 : Math.floor(parsed / 1000);
}

// ── P32 TASK 2: Sanitize OHLCV before setData() ──
// Drops candles with null/NaN/non-finite OHLC (prevents "Value is null" crash),
// drops candles with unparseable time (prevents "Invalid date string=26/07 09:00"),
// sorts ascending by time, and dedupes by time (keeps last).
// This is the exact filter the client requested: no null candle may reach the chart.
function sanitizeCandles(data: ChartData[]): ChartData[] {
  const cleaned: ChartData[] = [];
  for (const d of data) {
    const o = Number(d.open);
    const h = Number(d.high);
    const l = Number(d.low);
    const c = Number(d.close);
    if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
    if (o <= 0 && h <= 0 && l <= 0 && c <= 0) continue;
    const tnum = timeToNumber(toTime(d.time));
    if (tnum <= 0) continue; // unparseable time → drop (prevents "Invalid date string")
    cleaned.push({ time: d.time, open: o, high: h, low: l, close: c, volume: Number(d.volume) || 0 });
  }
  cleaned.sort((a, b) => timeToNumber(toTime(a.time)) - timeToNumber(toTime(b.time)));
  // Dedupe by time (keep last occurrence's values)
  const out: ChartData[] = [];
  let lastKey = 0;
  for (const d of cleaned) {
    const key = timeToNumber(toTime(d.time));
    if (out.length > 0 && key === lastKey) {
      out[out.length - 1] = d;
    } else {
      out.push(d);
      lastKey = key;
    }
  }
  return out;
}

function fmtDateLabel(timeVal: string | number): string {
  let date: Date;
  if (typeof timeVal === 'number') {
    date = new Date(timeVal * 1000);
  } else {
    const d = new Date(timeVal);
    date = isNaN(d.getTime()) ? new Date(Number(timeVal) * 1000) : d;
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${day}/${month} ${hour}:${minute}`;
}

function formatLineData(data: IndicatorData[]) {
  return data
    .filter((d) => d.value !== null && d.value !== undefined && !isNaN(d.value))
    .map((d) => ({
      time: toTime(d.time),
      value: d.value,
    }));
}

function formatVolumeData(data: ChartData[]) {
  return data.map((d) => ({
    time: toTime(d.time),
    value: d.volume,
    color: d.close >= d.open ? UP_COLOR + '40' : DOWN_COLOR + '40',
  }));
}

// ─── Client-Side Calculation Functions ────────────────────────────────────────

function calcEMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(data.length).fill(null);
  if (data.length < period) return result;

  const k = 2 / (period + 1);
  // Seed with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i];
  }
  result[period - 1] = sum / period;

  for (let i = period; i < data.length; i++) {
    const prev = result[i - 1]!;
    result[i] = data[i] * k + prev * (1 - k);
  }

  return result;
}

function calcMACD(closes: number[]): {
  macdLine: (number | null)[];
  signalLine: (number | null)[];
  histogram: (number | null)[];
} {
  const macdLine: (number | null)[] = new Array(closes.length).fill(null);
  const signalLine: (number | null)[] = new Array(closes.length).fill(null);
  const histogram: (number | null)[] = new Array(closes.length).fill(null);

  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);

  // MACD line = EMA12 - EMA26
  const macdRaw: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (ema12[i] !== null && ema26[i] !== null) {
      const val = ema12[i]! - ema26[i]!;
      macdLine[i] = val;
      macdRaw.push(val);
    }
  }

  // Signal line = 9-period EMA of MACD
  const macdStartIdx = macdLine.findIndex((v) => v !== null);
  if (macdStartIdx === -1) return { macdLine, signalLine, histogram };

  const signalRaw = calcEMA(macdRaw, 9);
  let signalIdx = 0;
  for (let i = macdStartIdx; i < closes.length; i++) {
    if (signalRaw[signalIdx] !== null) {
      signalLine[i] = signalRaw[signalIdx];
    }
    signalIdx++;
  }

  // Histogram = MACD - Signal
  for (let i = 0; i < closes.length; i++) {
    if (macdLine[i] !== null && signalLine[i] !== null) {
      histogram[i] = macdLine[i]! - signalLine[i]!;
    }
  }

  return { macdLine, signalLine, histogram };
}

function calcOBV(ohlcv: ChartData[]): number[] {
  const obv: number[] = [0];
  for (let i = 1; i < ohlcv.length; i++) {
    if (ohlcv[i].close > ohlcv[i - 1].close) {
      obv.push(obv[i - 1] + ohlcv[i].volume);
    } else if (ohlcv[i].close < ohlcv[i - 1].close) {
      obv.push(obv[i - 1] - ohlcv[i].volume);
    } else {
      obv.push(obv[i - 1]);
    }
  }
  return obv;
}

function calcFibLevels(
  high: number,
  low: number
): { level: number; price: number; label: string; style: LineStyle }[] {
  const diff = high - low;
  return [
    { level: 0, price: high, label: 'Fib 0.0%', style: LineStyle.Solid },
    { level: 0.236, price: high - diff * 0.236, label: 'Fib 23.6%', style: LineStyle.Dotted },
    { level: 0.382, price: high - diff * 0.382, label: 'Fib 38.2%', style: LineStyle.Dashed },
    { level: 0.5, price: high - diff * 0.5, label: 'Fib 50.0%', style: LineStyle.Dashed },
    { level: 0.618, price: high - diff * 0.618, label: 'Fib 61.8%', style: LineStyle.Dashed },
    { level: 0.786, price: high - diff * 0.786, label: 'Fib 78.6%', style: LineStyle.Dotted },
    { level: 1, price: low, label: 'Fib 100%', style: LineStyle.Solid },
  ];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InteractiveChart(props: FullChartProps) {
  const {
    ohlcv,
    indicators,
    visibleIndicators,
    levels,
    regimeColor,
    targetPrice,
    stopLossPrice,
    entryPrice,
    target2Price,
    target3Price,
    bbSqueezeLevel,
    bosEvents,
    livePrice,
    cmfData,
    macdProjection,
    smartMarkers,
    smcData,
    fusionMetrics,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<any>[]>([]);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  // SMART-CHART: تتبع آخر مرة عملنا فيها fitContent — عشان نعمل reset بس لما السياق يتغير (ticker/timeframe)
  // مش مع كل تحديث للبيانات (التحديث اللحظي بيستخدم series.update() ومش محتاج reset)
  const lastFitKeyRef = useRef<string>('');

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  // ── Derive regime theme from regimeColor ──
  const regimeTheme = useMemo(() => {
    if (!regimeColor) return null;
    const color = regimeColor;
    return {
      background: `${color}0D`, // hex alpha 0D = ~5% opacity
      color: color,
    };
  }, [regimeColor]);

  // ── Regime label for badge ──
  const regimeLabel = useMemo(() => {
    if (regimeColor === '#22c55e') return 'صعودي';
    if (regimeColor === '#ef4444') return 'هبوطي';
    if (regimeColor === '#eab308') return 'عرضي';
    if (regimeColor) return 'نظام';
    return null;
  }, [regimeColor]);

  // ── Info overlay data for last candle ──
  const infoOverlay = useMemo(() => {
    if (!ohlcv || ohlcv.length === 0) return null;
    const last = ohlcv[ohlcv.length - 1];
    const prev = ohlcv.length > 1 ? ohlcv[ohlcv.length - 2] : null;
    const change = prev ? ((last.close - prev.close) / prev.close) * 100 : 0;
    return {
      o: last.open,
      h: last.high,
      l: last.low,
      c: last.close,
      volume: last.volume,
      change,
      date: last.time,
    };
  }, [ohlcv]);

  // ── Main chart creation and data binding effect ──
  useEffect(() => {
    if (!containerRef.current) return;
    if (!ohlcv || ohlcv.length === 0) return;

    // P32 TASK 2: Sanitize OHLCV — drop null/NaN candles, sort ascending, dedupe.
    // Prevents lightweight-charts crashes: "Value is null" + "Invalid date string".
    const ohlcvClean = sanitizeCandles(ohlcv);
    if (ohlcvClean.length === 0) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    if (width === 0) return;

    // Clean up previous chart
    if (chartRef.current) {
      try {
        chartRef.current.remove();
      } catch {
        // Already disposed
      }
      chartRef.current = null;
      seriesRefs.current = [];
    }

    const bgColor = isDark ? '#131722' : '#ffffff';
    const textColor = isDark ? '#d1d4dc' : '#0f172a';
    const gridColor = isDark ? '#363c4e' : '#f1f5f9';
    const crosshairLabelBg = isDark ? '#2a2e39' : '#e2e8f0';

    // ── Create chart ──
    const chart = createChart(container, {
      width,
      height: container.clientHeight || 500,
      layout: {
        background: { type: ColorType.Solid, color: bgColor },
        textColor: textColor,
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
        fontSize: 12,
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: {
        mode: 0, // Normal
        vertLine: {
          color: '#758696',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2a2e39',
        },
        horzLine: {
          color: '#758696',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#2a2e39',
        },
      },
      rightPriceScale: {
        borderColor: CHART_GRID,
        scaleMargins: { top: 0.1, bottom: 0.25 },
      },
      timeScale: {
        borderColor: CHART_GRID,
        // ANTI-GAP-056: Show time (hours) for intraday charts so users see 10:15, 10:30 etc.
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 8,
        rightOffset: 5,
      },
      // ANTI-GAP-056: Custom time formatter so intraday timestamps display as 'DD/MM HH:MM'
      localization: {
        timeFormatter: (time: number) => {
          const date = new Date(time * 1000);
          const day = String(date.getDate()).padStart(2, '0');
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const hour = String(date.getHours()).padStart(2, '0');
          const minute = String(date.getMinutes()).padStart(2, '0');
          return `${day}/${month} ${hour}:${minute}`;
        },
      },
      // SMART-CHART: تفعيل صريح لـ Zoom (handleScale) و Pan (handleScroll)
      // المستخدم يقدر يعمل zoom بالماوس و pan من غير ما الشارت يعمل reset
      handleScale: {
        axisPressedMouseMove: true,
        axisDoubleClickReset: true,
        mouseWheel: true,
        pinch: true,
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
    });

    chartRef.current = chart;

    // ── Candlestick series ──
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      borderDownColor: DOWN_COLOR,
      borderUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
    });

    candleSeries.setData(
      ohlcvClean.map((d) => ({
        time: toTime(d.time),
        open: d.open,
        high: d.high,
        low: d.low,
        close: d.close,
      }))
    );

    candleSeriesRef.current = candleSeries;
    seriesRefs.current.push(candleSeries);

    // ── Last Price Line (always visible) ──
    const lastClose = ohlcvClean[ohlcvClean.length - 1].close;
    candleSeries.createPriceLine({
      price: lastClose,
      color: '#ffffff',
      lineWidth: 2,
      lineStyle: 0, // Solid
      axisLabelVisible: true,
      title: `  ${lastClose.toFixed(2)}`,
    });

    // ── EMA 9 & EMA 21 on Main Pane ──
    if (visibleIndicators.ema) {
      const closes = ohlcv.map((d) => d.close);

      const ema9Data = calcEMA(closes, 9);
      const ema9Series = chart.addSeries(LineSeries, {
        color: EMA9_COLOR,
        lineWidth: 1,
        title: 'EMA 9',
        crosshairMarkerVisible: false,
      });
      ema9Series.setData(
        ema9Data
          .map((v, i) =>
            v !== null ? { time: toTime(ohlcv[i].time), value: v } : null
          )
          .filter(Boolean) as { time: Time; value: number }[]
      );
      seriesRefs.current.push(ema9Series);

      const ema21Data = calcEMA(closes, 21);
      const ema21Series = chart.addSeries(LineSeries, {
        color: EMA21_COLOR,
        lineWidth: 1,
        title: 'EMA 21',
        crosshairMarkerVisible: false,
      });
      ema21Series.setData(
        ema21Data
          .map((v, i) =>
            v !== null ? { time: toTime(ohlcv[i].time), value: v } : null
          )
          .filter(Boolean) as { time: Time; value: number }[]
      );
      seriesRefs.current.push(ema21Series);
    }

    // ── SMA Lines (on main pane) ──
    if (visibleIndicators.sma20 && indicators.sma20?.length) {
      const s = chart.addSeries(LineSeries, {
        color: SMA20_COLOR,
        lineWidth: 1,
        title: 'SMA 20',
        crosshairMarkerVisible: false,
      });
      s.setData(formatLineData(indicators.sma20));
      seriesRefs.current.push(s);
    }

    if (visibleIndicators.sma50 && indicators.sma50?.length) {
      const s = chart.addSeries(LineSeries, {
        color: SMA50_COLOR,
        lineWidth: 1,
        title: 'SMA 50',
        crosshairMarkerVisible: false,
      });
      s.setData(formatLineData(indicators.sma50));
      seriesRefs.current.push(s);
    }

    if (visibleIndicators.sma200 && indicators.sma200?.length) {
      const s = chart.addSeries(LineSeries, {
        color: SMA200_COLOR,
        lineWidth: 1,
        title: 'SMA 200',
        crosshairMarkerVisible: false,
      });
      s.setData(formatLineData(indicators.sma200));
      seriesRefs.current.push(s);
    }

    // ── Bollinger Bands (on main pane) — orange when squeeze is active ──
    const isSqueeze = !!bbSqueezeLevel;
    const bbLineColor = isSqueeze ? BB_SQUEEZE_COLOR : BB_UPPER_COLOR;
    const bbMidColor = isSqueeze ? BB_SQUEEZE_COLOR : BB_MIDDLE_COLOR;
    const bbLineWidth = isSqueeze ? 2 : 1;

    if (visibleIndicators.bb && indicators.bb_upper?.length) {
      const upper = chart.addSeries(LineSeries, {
        color: bbLineColor,
        lineWidth: bbLineWidth,
        lineStyle: LineStyle.Dashed,
        title: isSqueeze ? 'BB Upper (Squeeze)' : 'BB Upper',
        crosshairMarkerVisible: false,
      });
      upper.setData(formatLineData(indicators.bb_upper));
      seriesRefs.current.push(upper);
    }

    if (visibleIndicators.bb && indicators.bb_middle?.length) {
      const middle = chart.addSeries(LineSeries, {
        color: bbMidColor,
        lineWidth: bbLineWidth,
        lineStyle: isSqueeze ? LineStyle.Dashed : LineStyle.Dotted,
        title: isSqueeze ? 'BB Middle (Squeeze)' : 'BB Middle',
        crosshairMarkerVisible: false,
      });
      middle.setData(formatLineData(indicators.bb_middle));
      seriesRefs.current.push(middle);
    }

    if (visibleIndicators.bb && indicators.bb_lower?.length) {
      const lower = chart.addSeries(LineSeries, {
        color: bbLineColor,
        lineWidth: bbLineWidth,
        lineStyle: LineStyle.Dashed,
        title: isSqueeze ? 'BB Lower (Squeeze)' : 'BB Lower',
        crosshairMarkerVisible: false,
      });
      lower.setData(formatLineData(indicators.bb_lower));
      seriesRefs.current.push(lower);
    }

    // ── Fibonacci Retracement Levels ──
    if (visibleIndicators.fibonacci) {
      // P32 TASK 2: use sanitized candles for auto-scale (avoid NaN from null highs/lows)
      const dataHigh = Math.max(...ohlcvClean.map((d) => d.high));
      const dataLow = Math.min(...ohlcvClean.map((d) => d.low));
      const fibLevels = calcFibLevels(dataHigh, dataLow);
      const firstTime = ohlcv[0].time;
      const lastTime = ohlcv[ohlcv.length - 1].time;

      fibLevels.forEach((fib) => {
        const fibSeries = chart.addSeries(LineSeries, {
          color: FIB_COLOR + '90',
          lineWidth: fib.level === 0 || fib.level === 1 ? 2 : 1,
          lineStyle: fib.style,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
          title: fib.label,
        });
        fibSeries.setData([
          { time: toTime(firstTime), value: fib.price },
          { time: toTime(lastTime), value: fib.price },
        ]);
        seriesRefs.current.push(fibSeries);
      });
    }

    // ── BOS Event Markers ──
    if (visibleIndicators.bos && bosEvents && bosEvents.length > 0) {
      const markers = bosEvents
        .filter((evt) => evt.index >= 0 && evt.index < ohlcv.length)
        .map((evt) => {
          const isUp = evt.type === 'bos_up';
          return {
            time: toTime(ohlcv[evt.index].time),
            position: isUp ? 'belowBar' as const : 'aboveBar' as const,
            color: isUp ? UP_COLOR : DOWN_COLOR,
            shape: isUp ? 'arrowUp' as const : 'arrowDown' as const,
            text: isUp ? 'BOS ↑' : 'BOS ↓',
          };
        })
        .sort((a, b) => {
          // Guard against non-string time values (e.g. numeric timestamps)
          // which would crash with "localeCompare is not a function".
          const ta = String(a.time ?? '');
          const tb = String(b.time ?? '');
          return ta < tb ? -1 : ta > tb ? 1 : 0;
        });
      const seriesMarkers = createSeriesMarkers(candleSeries, markers);
      seriesRefs.current.push(seriesMarkers as unknown as ISeriesApi<any>);
    }

    // ── Support / Resistance / Pivot Lines ──
    if (levels && visibleIndicators.levels) {
      const lastTime = ohlcv[ohlcv.length - 1].time;
      const firstTime = ohlcv[0].time;
      const lineData = [
        { time: toTime(firstTime), value: 0 },
        { time: toTime(lastTime), value: 0 },
      ];

      // Support lines (single value + levels array)
      const allSupports: number[] = [];
      if (levels.support != null) allSupports.push(levels.support);
      if (levels.far_support != null) allSupports.push(levels.far_support);
      if (levels.support_levels) {
        levels.support_levels.forEach((l) => {
          if (l.price) allSupports.push(l.price);
        });
      }
      allSupports.forEach((price, idx) => {
        const s = chart.addSeries(LineSeries, {
          color: SUPPORT_COLOR + 'AA',
          lineWidth: idx === 0 ? 2 : 1,
          lineStyle: LineStyle.Dashed,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
          title: `دعم ${price.toFixed(2)}`,
        });
        s.setData(lineData.map((d) => ({ time: d.time, value: price })));
        seriesRefs.current.push(s);
      });

      // Resistance lines (single value + levels array)
      const allResistances: number[] = [];
      if (levels.resistance != null) allResistances.push(levels.resistance);
      if (levels.far_resistance != null) allResistances.push(levels.far_resistance);
      if (levels.resistance_levels) {
        levels.resistance_levels.forEach((l) => {
          if (l.price) allResistances.push(l.price);
        });
      }
      allResistances.forEach((price, idx) => {
        const r = chart.addSeries(LineSeries, {
          color: RESISTANCE_COLOR + 'AA',
          lineWidth: idx === 0 ? 2 : 1,
          lineStyle: LineStyle.Dashed,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
          title: `مقاومة ${price.toFixed(2)}`,
        });
        r.setData(lineData.map((d) => ({ time: d.time, value: price })));
        seriesRefs.current.push(r);
      });

      // Pivot line
      if (levels.pivot) {
        const p = chart.addSeries(LineSeries, {
          color: PIVOT_COLOR + '90',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
          title: `Pivot ${levels.pivot.toFixed(2)}`,
        });
        p.setData(
          lineData.map((d) => ({ time: d.time, value: levels.pivot }))
        );
        seriesRefs.current.push(p);
      }
    }

    // ── Target Price Line (TP1) ──
    if (targetPrice) {
      candleSeries.createPriceLine({
        price: targetPrice,
        color: '#26a69a',
        lineWidth: 2,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'TP1',
      });
    }

    // CHART-PRO-047: TP2 Price Line
    if (target2Price) {
      candleSeries.createPriceLine({
        price: target2Price,
        color: '#26a69a',
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'TP2',
      });
    }

    // CHART-PRO-047: TP3 Price Line
    if (target3Price) {
      candleSeries.createPriceLine({
        price: target3Price,
        color: '#26a69a',
        lineWidth: 1,
        lineStyle: 2, // Dashed
        axisLabelVisible: true,
        title: 'TP3',
      });
    }

    // CHART-PRO-047: Entry Price Line (BUY)
    if (entryPrice) {
      candleSeries.createPriceLine({
        price: entryPrice,
        color: '#2196f3',
        lineWidth: 2,
        lineStyle: 1, // Dashed
        axisLabelVisible: true,
        title: 'BUY',
      });
    }

    // ── Stop-Loss Price Line ──
    if (stopLossPrice) {
      candleSeries.createPriceLine({
        price: stopLossPrice,
        color: '#ef5350',
        lineWidth: 2,
        lineStyle: 0, // Solid
        axisLabelVisible: true,
        title: 'SL',
      });
    }

    // ── SMC-ENGINE-066 + BRIEF-045: Smart Money Concepts Zones ──
    // Order Blocks: مناطق المؤسسات (أخضر = Bullish OB، أحمر = Bearish OB)
    // FVG: فجوات القيمة العادلة (أزرق = Bullish، برتقالي = Bearish)
    // BRIEF-045: نرسم المناطق كـ "boxes" محاكاة (top + bottom lines مع label واضح)
    if (smcData && smcData.ready !== false) {
      // BRIEF-045: استخدم smc_zones لو موجودة (أكثر تفصيلاً)
      const _zones = smcData.smc_zones || [];
      const _obs = smcData.order_blocks || [];
      const _fvgs = smcData.fvgs || [];

      // رسم الـ Order Blocks كـ zones (top + bottom = box simulation)
      _obs.forEach((ob) => {
        const isBullish = ob.type === 'bullish_ob';
        const color = isBullish ? 'rgba(38, 166, 154, 0.7)' : 'rgba(239, 83, 80, 0.7)';
        const label = isBullish ? '🟢 Bullish OB' : '🔴 Bearish OB';
        // Top line (حدود المنطقة العلوية)
        candleSeries.createPriceLine({
          price: ob.top,
          color,
          lineWidth: 2,
          lineStyle: 0, // Solid
          axisLabelVisible: true,
          title: label,
        });
        // Bottom line (حدود المنطقة السفلية)
        candleSeries.createPriceLine({
          price: ob.bottom,
          color,
          lineWidth: 2,
          lineStyle: 0, // Solid
          axisLabelVisible: false,
          title: isBullish ? 'OB Bottom' : 'OB Bottom (Bear)',
        });
      });

      // رسم الـ FVG (Fair Value Gaps) كـ zones
      _fvgs.forEach((fvg) => {
        const isBullish = fvg.type === 'bullish_fvg';
        const color = isBullish ? 'rgba(33, 150, 243, 0.6)' : 'rgba(255, 152, 0, 0.6)';
        const label = isBullish ? '🔵 Bullish FVG' : '🟠 Bearish FVG';
        // Top line
        candleSeries.createPriceLine({
          price: fvg.top,
          color,
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: true,
          title: label,
        });
        // Bottom line
        candleSeries.createPriceLine({
          price: fvg.bottom,
          color,
          lineWidth: 1,
          lineStyle: 2, // Dashed
          axisLabelVisible: false,
          title: isBullish ? 'FVG Bottom' : 'FVG Bottom (Bear)',
        });
      });

      // رسم الـ Liquidity Sweeps (خطوط أفقية صفراء)
      if (smcData.sweeps && smcData.sweeps.length > 0) {
        smcData.sweeps.forEach((sweep) => {
          const isBullish = sweep.type === 'bullish_sweep';
          candleSeries.createPriceLine({
            price: sweep.level,
            color: 'rgba(255, 235, 59, 0.8)',
            lineWidth: 1,
            lineStyle: 1, // Dotted
            axisLabelVisible: true,
            title: isBullish ? '🦈 Sweep' : '🦈 Sweep (Bear)',
          });
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════════
    // PHASE 11: V20 ULTIMATE FUSION ENGINE — رسم VWAP + الجيب الذهبي + Risk
    // ═══════════════════════════════════════════════════════════════════
    // المرجعية: Documentation/HOW_WE_ANALYZE_AND_PREDICT.md §19 (Phase 11)
    //
    // بنرسم 5 خطوط أفقية على الشارت:
    //   1. VWAP (القيمة العادلة) — بنفسجي غامق
    //   2. Fib 0.618 (حد الجيب الذهبي العلوي) — برتقالي
    //   3. Fib 0.786 (حد الجيب الذهبي السفلي) — برتقالي
    //   4. TP1 (1.5R) — أخضر فاتح
    //   5. TP2 (3.0R) — أخضر داكن
    //   6. SL (Stop Loss) — أحمر
    // ═══════════════════════════════════════════════════════════════════
    if (fusionMetrics && fusionMetrics.ready !== false) {
      const VWAP_COLOR = 'rgba(168, 85, 247, 0.9)';   // بنفسجي
      const FIB_COLOR = 'rgba(255, 123, 0, 0.7)';     // برتقالي
      const TP1_COLOR = 'rgba(38, 166, 154, 0.8)';    // أخضر فاتح
      const TP2_COLOR = 'rgba(0, 105, 92, 0.9)';      // أخضر داكن
      const SL_COLOR = 'rgba(239, 83, 80, 0.9)';      // أحمر

      // 1. VWAP (القيمة العادلة)
      if (fusionMetrics.fair_value && fusionMetrics.fair_value > 0) {
        candleSeries.createPriceLine({
          price: fusionMetrics.fair_value,
          color: VWAP_COLOR,
          lineWidth: 2,
          lineStyle: 0, // Solid
          axisLabelVisible: true,
          title: `📊 VWAP ${fusionMetrics.fair_premium > 0 ? '+' : ''}${fusionMetrics.fair_premium.toFixed(1)}%`,
        });
      }

      // 2. الجيب الذهبي (Golden Pocket 0.618 - 0.786)
      const bb = fusionMetrics.bigbeluga;
      if (bb) {
        if (bb.fib_618 && bb.fib_618 > 0) {
          candleSeries.createPriceLine({
            price: bb.fib_618,
            color: FIB_COLOR,
            lineWidth: 1,
            lineStyle: 2, // Dashed
            axisLabelVisible: true,
            title: bb.in_pocket ? '🎯 Fib 0.618 (Pocket)' : 'Fib 0.618',
          });
        }
        if (bb.fib_786 && bb.fib_786 > 0) {
          candleSeries.createPriceLine({
            price: bb.fib_786,
            color: FIB_COLOR,
            lineWidth: 1,
            lineStyle: 2, // Dashed
            axisLabelVisible: false,
            title: 'Fib 0.786',
          });
        }

        // لو السعر داخل الجيب الذهبي → اطبع badge في الـ title
        if (bb.in_pocket) {
          // console.log removed (Rule 31: no hype in console)
        }
      }

      // 3. Risk Profile (Entry / SL / TP1 / TP2)
      const risk = fusionMetrics.risk;
      if (risk && risk.entry && risk.entry > 0) {
        // TP2 (3.0R) — أعلى هدف
        if (risk.tp2 && risk.tp2 > 0) {
          candleSeries.createPriceLine({
            price: risk.tp2,
            color: TP2_COLOR,
            lineWidth: 1,
            lineStyle: 1, // Dotted
            axisLabelVisible: true,
            title: `🎯 TP2 (3.0R)`,
          });
        }
        // TP1 (1.5R) — الهدف الأول
        if (risk.tp1 && risk.tp1 > 0) {
          candleSeries.createPriceLine({
            price: risk.tp1,
            color: TP1_COLOR,
            lineWidth: 1,
            lineStyle: 1, // Dotted
            axisLabelVisible: true,
            title: `🎯 TP1 (1.5R)`,
          });
        }
        // SL (Stop Loss)
        if (risk.sl && risk.sl > 0) {
          candleSeries.createPriceLine({
            price: risk.sl,
            color: SL_COLOR,
            lineWidth: 2,
            lineStyle: 0, // Solid
            axisLabelVisible: true,
            title: `🛑 SL`,
          });
        }
      }
    }

    // ── Volume pane (pane index 1) ──
    const volumePane = chart.addPane();
    volumePane.setHeight(80);
    const VOLUME_PANE_INDEX = chart.panes().length - 1;

    const volumeSeries = chart.addSeries(
      HistogramSeries,
      {
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      },
      VOLUME_PANE_INDEX
    );

    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });

    volumeSeries.setData(formatVolumeData(ohlcv));
    seriesRefs.current.push(volumeSeries);

    // ── Volume 20-day SMA overlay on volume pane ──
    const volumes = ohlcv.map((d) => d.volume);
    const volumeSMA20 = calcEMA(volumes, 20); // use EMA for smoother result
    const volSMASeries = chart.addSeries(
      LineSeries,
      {
        color: '#ffffff90',
        lineWidth: 1,
        title: 'Vol MA 20',
        crosshairMarkerVisible: false,
        lastValueVisible: false,
        priceLineVisible: false,
      },
      VOLUME_PANE_INDEX
    );
    volSMASeries.priceScale().applyOptions({
      scaleMargins: { top: 0.0, bottom: 0.2 },
    });
    volSMASeries.setData(
      volumeSMA20
        .map((v, i) =>
          v !== null ? { time: toTime(ohlcv[i].time), value: v } : null
        )
        .filter(Boolean) as { time: Time; value: number }[]
    );
    seriesRefs.current.push(volSMASeries);

    // ── OBV Line on Volume Pane ──
    if (visibleIndicators.obv) {
      const obvData = calcOBV(ohlcv);
      const obvSeries = chart.addSeries(
        LineSeries,
        {
          color: OBV_COLOR,
          lineWidth: 1,
          title: 'OBV',
          crosshairMarkerVisible: false,
          priceFormat: { type: 'price', precision: 0, minMove: 1 },
        },
        VOLUME_PANE_INDEX
      );
      obvSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.0, bottom: 0.2 },
      });
      obvSeries.setData(
        obvData.map((v, i) => ({ time: toTime(ohlcv[i].time), value: v }))
      );
      seriesRefs.current.push(obvSeries);
    }

    // ── RSI Pane ──
    if (visibleIndicators.rsi && indicators.rsi?.length) {
      const rsiPane = chart.addPane();
      rsiPane.setHeight(60);
      const RSI_PANE_INDEX = chart.panes().length - 1;

      const rsiSeries = chart.addSeries(
        LineSeries,
        {
          color: RSI_COLOR,
          lineWidth: 1,
          title: 'RSI',
          crosshairMarkerVisible: false,
          priceFormat: { type: 'price', precision: 1, minMove: 0.1 },
        },
        RSI_PANE_INDEX
      );

      rsiSeries.priceScale().applyOptions({
        autoScale: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      });

      rsiSeries.setData(formatLineData(indicators.rsi));
      seriesRefs.current.push(rsiSeries);

      // Overbought line (70)
      const ob = chart.addSeries(
        LineSeries,
        {
          color: RESISTANCE_COLOR + '80',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
        },
        RSI_PANE_INDEX
      );

      ob.priceScale().applyOptions({
        autoScale: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      });

      ob.setData(
        indicators.rsi.map((d) => ({ time: toTime(d.time), value: 70 }))
      );
      seriesRefs.current.push(ob);

      // Oversold line (30)
      const os = chart.addSeries(
        LineSeries,
        {
          color: SUPPORT_COLOR + '80',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
        },
        RSI_PANE_INDEX
      );

      os.priceScale().applyOptions({
        autoScale: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      });

      os.setData(
        indicators.rsi.map((d) => ({ time: toTime(d.time), value: 30 }))
      );
      seriesRefs.current.push(os);
    }

    // ── CMF Pane ──
    if (visibleIndicators.cmf && indicators.cmf?.length) {
      const cmfPane = chart.addPane();
      cmfPane.setHeight(50);
      const CMF_PANE_INDEX = chart.panes().length - 1;

      const cmfSeries = chart.addSeries(
        LineSeries,
        {
          color: CMF_COLOR,
          lineWidth: 1,
          title: 'CMF',
          crosshairMarkerVisible: false,
          priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
        },
        CMF_PANE_INDEX
      );

      cmfSeries.priceScale().applyOptions({
        autoScale: true,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      });

      cmfSeries.setData(formatLineData(indicators.cmf));
      seriesRefs.current.push(cmfSeries);

      // Zero line
      const zeroLine = chart.addSeries(
        LineSeries,
        {
          color: CHART_TEXT + '40',
          lineWidth: 1,
          lineStyle: LineStyle.Dotted,
          crosshairMarkerVisible: false,
          lastValueVisible: false,
          priceLineVisible: false,
        },
        CMF_PANE_INDEX
      );

      zeroLine.priceScale().applyOptions({
        autoScale: false,
        scaleMargins: { top: 0.1, bottom: 0.1 },
      });

      zeroLine.setData(
        indicators.cmf.map((d) => ({ time: toTime(d.time), value: 0 }))
      );
      seriesRefs.current.push(zeroLine);
    }

    // ── MACD Pane ──
    if (visibleIndicators.macd) {
      // TOOLKIT-UNIFY-010: prefer backend-provided MACD arrays (unified with
      // maestro) and fall back to client-side calcMACD only when missing.
      const hasBackendMacd =
        Array.isArray(indicators.macd) && indicators.macd!.length > 0;
      let macdLine: (number | null)[];
      let signalLine: (number | null)[];
      let histogram: (number | null)[];
      let macdTimes: string[];

      if (hasBackendMacd) {
        macdTimes = indicators.macd!.map((d) => d.time);
        macdLine = indicators.macd!.map((d) => d.value);
        signalLine = (indicators.macd_signal || []).map((d) => d.value);
        // pad signalLine to macdLine length in case of misalignment
        while (signalLine.length < macdLine.length) signalLine.push(null);
        histogram = (indicators.macd_histogram || []).map((d) => d.value);
        while (histogram.length < macdLine.length) histogram.push(null);
      } else {
        const closes = ohlcv.map((d) => d.close);
        const r = calcMACD(closes);
        macdLine = r.macdLine;
        signalLine = r.signalLine;
        histogram = r.histogram;
        macdTimes = ohlcv.map((d) => d.time);
      }

      const macdPane = chart.addPane();
      macdPane.setHeight(70);
      const MACD_PANE_INDEX = chart.panes().length - 1;

      // MACD Histogram
      const histSeries = chart.addSeries(
        HistogramSeries,
        {
          priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
          priceScaleId: 'macd_hist',
        },
        MACD_PANE_INDEX
      );
      histSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.6, bottom: 0.0 },
      });

      histSeries.setData(
        histogram
          .map((v, i) =>
            v !== null && v !== undefined
              ? {
                  time: toTime(macdTimes[i]),
                  value: v,
                  color: v >= 0 ? MACD_HIST_POS + '80' : MACD_HIST_NEG + '80',
                }
              : null
          )
          .filter(Boolean) as {
          time: Time;
          value: number;
          color: string;
        }[]
      );
      seriesRefs.current.push(histSeries);

      // MACD Line
      const macdLineSeries = chart.addSeries(
        LineSeries,
        {
          color: MACD_LINE_COLOR,
          lineWidth: 1,
          title: 'MACD',
          crosshairMarkerVisible: false,
          priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
        },
        MACD_PANE_INDEX
      );
      macdLineSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.0, bottom: 0.4 },
      });
      macdLineSeries.setData(
        macdLine
          .map((v, i) =>
            v !== null && v !== undefined
              ? { time: toTime(macdTimes[i]), value: v }
              : null
          )
          .filter(Boolean) as { time: Time; value: number }[]
      );
      seriesRefs.current.push(macdLineSeries);

      // Signal Line
      const signalLineSeries = chart.addSeries(
        LineSeries,
        {
          color: MACD_SIGNAL_COLOR,
          lineWidth: 1,
          title: 'Signal',
          crosshairMarkerVisible: false,
          priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
        },
        MACD_PANE_INDEX
      );
      signalLineSeries.priceScale().applyOptions({
        scaleMargins: { top: 0.0, bottom: 0.4 },
      });
      signalLineSeries.setData(
        signalLine
          .map((v, i) =>
            v !== null && v !== undefined
              ? { time: toTime(macdTimes[i]), value: v }
              : null
          )
          .filter(Boolean) as { time: Time; value: number }[]
      );
      seriesRefs.current.push(signalLineSeries);

      // Zero line for MACD
      const firstMacdTime = macdLine.findIndex((v) => v !== null);
      if (firstMacdTime !== -1 && macdTimes.length > 0) {
        const lastMacdTime = macdTimes[macdTimes.length - 1];
        const zeroLineMacd = chart.addSeries(
          LineSeries,
          {
            color: CHART_TEXT + '30',
            lineWidth: 1,
            lineStyle: LineStyle.Dotted,
            crosshairMarkerVisible: false,
            lastValueVisible: false,
            priceLineVisible: false,
          },
          MACD_PANE_INDEX
        );
        zeroLineMacd.priceScale().applyOptions({
          autoScale: false,
          scaleMargins: { top: 0.0, bottom: 0.4 },
        });
        zeroLineMacd.setData([
          { time: toTime(macdTimes[firstMacdTime]), value: 0 },
          { time: toTime(lastMacdTime), value: 0 },
        ]);
        seriesRefs.current.push(zeroLineMacd);
      }
    }

    // CHART-V2-044: MACD Projection (LinReg — مرآة المستقبل)
    if (macdProjection && macdProjection.length > 0 && indicators.macd) {
      try {
        const projTimes = indicators.macd.map((d) => d.time);
        const projData: Array<{ time: Time; value: number }> = [];
        const startIdx = Math.max(0, projTimes.length - macdProjection.length);
        for (let i = 0; i < macdProjection.length; i++) {
          const val = macdProjection[i];
          const timeIdx = startIdx + i;
          if (val !== null && val !== undefined && timeIdx < projTimes.length) {
            projData.push({ time: toTime(projTimes[timeIdx]), value: val });
          }
        }
        if (projData.length > 0) {
          const projSeries = chart.addSeries(
            LineSeries,
            {
              color: '#e040fb',  // Fuchsia/Purple
              lineWidth: 2,
              lineStyle: LineStyle.Dashed,
              title: '🔮 Projection',
              crosshairMarkerVisible: true,
              priceFormat: { type: 'price', precision: 4, minMove: 0.0001 },
            },
            MACD_PANE_INDEX
          );
          projSeries.priceScale().applyOptions({
            scaleMargins: { top: 0.0, bottom: 0.4 },
          });
          projSeries.setData(projData);
          seriesRefs.current.push(projSeries);
        }
      } catch {}
    }

    // CHART-V2-044: CMF Line (تدفق المؤسسات)
    if (cmfData && cmfData.length > 0) {
      try {
        const MACD_PANE_INDEX = 1; // Sub-pane (same as MACD)
        const cmfSeries = chart.addSeries(
          LineSeries,
          {
            color: '#facc15',  // Yellow
            lineWidth: 2,
            title: 'CMF',
            crosshairMarkerVisible: true,
            priceFormat: { type: 'price', precision: 3, minMove: 0.001 },
          },
          MACD_PANE_INDEX
        );
        cmfSeries.priceScale().applyOptions({
          scaleMargins: { top: 0.6, bottom: 0.0 },
        });
        cmfSeries.setData(
          cmfData
            .filter((d) => d.value !== null && d.value !== undefined)
            .map((d) => ({ time: toTime(d.time), value: d.value }))
        );
        seriesRefs.current.push(cmfSeries);
      } catch {}
    }

    // CHART-V2-044: Smart Markers (broke_r1, smart_money_in, news_confirmed, vol_spike)
    if (smartMarkers && smartMarkers.length > 0 && ohlcv.length > 0) {
      try {
        const markers = smartMarkers.map((m) => ({
          time: toTime(m.time),
          position: m.position === 'aboveBar' ? 'aboveBar' as const : 'belowBar' as const,
          color: m.color,
          shape: m.shape === 'arrowUp' ? 'arrowUp' as const : 'circle' as const,
          text: m.text,
        }));
        createSeriesMarkers(candleSeriesRef.current || candleSeries, markers);
      } catch {}
    }

    // ── SMART-CHART: Fit content بس لما السياق يتغير (مش مع كل تحديث للبيانات) ──
    // fitKey = أول تاريخ + آخر تاريخ + bucket للطول (عشان نتجنب reset مع كل شمعة جديدة)
    // لو الـ fitKey نفسه → المستخدم عمل zoom/pan وعلمنا نحافظ على view بتاعه
    const firstTime = ohlcv[0]?.time ?? '';
    const lastTime = ohlcv[ohlcv.length - 1]?.time ?? '';
    const lengthBucket = Math.floor(ohlcv.length / 10) * 10;
    const fitKey = `${firstTime}|${lastTime}|${lengthBucket}`;
    if (lastFitKeyRef.current !== fitKey) {
      chart.timeScale().fitContent();
      lastFitKeyRef.current = fitKey;
    }

    // ── Cleanup ──
    return () => {
      try {
        chart.remove();
      } catch {
        // Already disposed
      }
      chartRef.current = null;
      seriesRefs.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ohlcv, indicators, visibleIndicators, levels, regimeColor, targetPrice, stopLossPrice, bbSqueezeLevel, bosEvents, fusionMetrics]);

  // STRATEGY-041: Live candle update — حدّث شمعة النهارده بالسعر اللحظي
  useEffect(() => {
    if (!livePrice || livePrice <= 0) return;
    if (!candleSeriesRef.current || ohlcv.length === 0) return;

    const lastCandle = ohlcv[ohlcv.length - 1];
    const lastTime = toTime(lastCandle.time);

    // حدّث شمعة النهارده: close = livePrice, high = max(high, live), low = min(low, live)
    const updatedCandle = {
      time: lastTime,
      open: lastCandle.open,
      high: Math.max(lastCandle.high, livePrice),
      low: Math.min(lastCandle.low, livePrice),
      close: livePrice,
    };

    try {
      candleSeriesRef.current.update(updatedCandle as any);
    } catch {
      // silent — لو الـ time مش متطابق بالظبط
    }
  }, [livePrice, ohlcv]);

  // ── Responsive resize ──
  useEffect(() => {
    const container = containerRef.current;
    const chart = chartRef.current;
    if (!container || !chart) return;

    const handleResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w > 0 && h > 0) {
        chart.applyOptions({ width: w, height: h });
      }
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(container);

    // Also listen to window resize as a fallback
    window.addEventListener('resize', handleResize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [ohlcv]);

  // ── Empty state ──
  if (!ohlcv || ohlcv.length === 0) {
    return (
      <div
        className="flex items-center justify-center w-full h-full rounded-lg"
        style={{
          backgroundColor: regimeTheme?.background || CHART_BG,
          minHeight: 500,
        }}
      >
        <div className="flex flex-col items-center gap-2 opacity-50">
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke={CHART_TEXT}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <span style={{ color: CHART_TEXT, fontSize: 14 }}>
            No data available
          </span>
        </div>
      </div>
    );
  }

  // ── Format large numbers ──
  function fmtNum(n: number, decimals = 2) {
    return n.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  function fmtVol(n: number) {
    if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toFixed(0);
  }

  return (
    <div className="relative w-full h-full">
      {/* Regime Badge */}
      {regimeLabel && regimeColor && (
        <div
          className="absolute top-3 left-3 z-10 px-3 py-1.5 rounded-md text-xs font-bold shadow-lg select-none"
          style={{
            backgroundColor: regimeColor + '20',
            color: regimeColor,
            border: `1.5px solid ${regimeColor}60`,
            backdropFilter: 'blur(8px)',
          }}
        >
          {regimeLabel}
        </div>
      )}

      {/* Info Overlay Panel */}
      {infoOverlay && (
        <div
          className="absolute top-3 z-10 rounded-md px-3 py-2.5 select-none pointer-events-none"
          style={{
            left: '12px',
            right: 'auto',
            backgroundColor: 'rgba(19, 23, 34, 0.85)',
            backdropFilter: 'blur(12px)',
            border: `1px solid ${CHART_GRID}`,
            color: CHART_TEXT,
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Trebuchet MS', Roboto, Ubuntu, sans-serif",
            fontSize: 11,
            lineHeight: '16px',
          }}
        >
          <div
            className="text-center font-semibold mb-1.5 pb-1.5"
            style={{
              fontSize: 11,
              borderBottom: `1px solid ${CHART_GRID}`,
              color: '#a3a8b8',
            }}
          >
            {fmtDateLabel(infoOverlay.date)}
          </div>
          <div className="grid gap-x-4 gap-y-0.5" style={{ gridTemplateColumns: 'auto auto' }}>
            <span style={{ color: '#787b86' }}>O</span>
            <span className="font-mono text-right">{fmtNum(infoOverlay.o)}</span>
            <span style={{ color: '#787b86' }}>H</span>
            <span className="font-mono text-right">{fmtNum(infoOverlay.h)}</span>
            <span style={{ color: '#787b86' }}>L</span>
            <span className="font-mono text-right">{fmtNum(infoOverlay.l)}</span>
            <span style={{ color: '#787b86' }}>C</span>
            <span
              className="font-mono text-right font-semibold"
              style={{
                color:
                  infoOverlay.change >= 0 ? UP_COLOR : DOWN_COLOR,
              }}
            >
              {fmtNum(infoOverlay.c)}
            </span>
            <span style={{ color: '#787b86' }}>Vol</span>
            <span className="font-mono text-right">{fmtVol(infoOverlay.volume)}</span>
            <span style={{ color: '#787b86' }}>Chg</span>
            <span
              className="font-mono text-right font-semibold"
              style={{
                color:
                  infoOverlay.change >= 0 ? UP_COLOR : DOWN_COLOR,
              }}
            >
              {infoOverlay.change >= 0 ? '+' : ''}
              {infoOverlay.change.toFixed(2)}%
            </span>
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className="w-full h-full rounded-lg overflow-hidden min-h-[300px] md:min-h-[500px]"
        style={{
          backgroundColor: regimeTheme?.background || CHART_BG,
        }}
      />
    </div>
  );
}