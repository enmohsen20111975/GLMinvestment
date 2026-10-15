'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTheme } from 'next-themes';
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
  type IPriceLine,
  type SeriesMarker,
  type Time,
  type DeepPartial,
  type ChartOptions,
  CandlestickSeries,
  ISeriesApi,
  BarSeries,
  LineSeries,
  HistogramSeries,
} from 'lightweight-charts';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
// Task PHASE5-SCREENS-P1 (Rule 67 + 72): import canonical RSI series instead of local calcRSI.
import { computeRSISeries as calcRSI } from '@/lib/canonical-rsi';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { getEGXMarketStatus } from '@/lib/market-hours';
import { useAppStore } from '@/lib/store';

import { toast } from 'sonner';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Camera,
  RotateCcw,
  TrendingUp,
  TrendingDown,
  Clock,
  Eye,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TradingViewChartProps {
  ticker: string;
  stockName?: string;
  height?: number;
}

interface OhlcvBar {
  date?: string | number;          // V-07: optional — fallback to timestamp/time
  timestamp?: string | number;     // V-07: backend /api/chart sends this
  time?: string | number;          // V-07: /api/v2/chart/full-analysis sends this
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// V-07 (CHART-BLANK-FIX): resolve bar date from any of the 3 possible fields.
// Backend /api/chart sends `timestamp`, full-analysis sends `time`, and
// legacy sends `date`. Without this fallback, sanitizeOhlcBar drops ALL
// candles as null → chart renders blank.
function resolveBarDate(bar: OhlcvBar): string | number | undefined {
  return bar.date ?? bar.timestamp ?? bar.time;
}

interface IndicatorSettings {
  sma20: boolean;
  sma50: boolean;
  sma200: boolean;
  ema20: boolean;
  bollingerBands: boolean;
  volume: boolean;
  rsi: boolean;
  macd: boolean;
  stochastic: boolean;
  atr: boolean;
  obv: boolean;
}

type ChartType = 'candlestick' | 'bar' | 'area';

// ─── Constants ───────────────────────────────────────────────────────────────

const UP_COLOR = '#089981';       // TradingView official green
const DOWN_COLOR = '#f23645';     // TradingView official red
const VOLUME_UP = 'rgba(8, 153, 129, 0.5)';
const VOLUME_DOWN = 'rgba(242, 54, 69, 0.5)';

const SMA20_COLOR = '#FF6B6B';   // Red
const SMA50_COLOR = '#4ECDC4';   // Teal
const SMA200_COLOR = '#FFE66D';  // Yellow
const EMA20_COLOR = '#A855F7';   // Purple
const BB_COLOR = '#8B5CF6';      // Purple for Bollinger
const RSI_COLOR = '#F59E0B';     // Amber
const MACD_COLOR = '#3B82F6';    // Blue
const MACD_SIGNAL_COLOR = '#EF4444'; // Red
const STOCH_K_COLOR = '#10B981'; // Green
const STOCH_D_COLOR = '#F59E0B'; // Amber
const ATR_COLOR = '#6366F1';     // Indigo
const OBV_COLOR = '#14B8A6';     // Teal

export const RESOLUTIONS = [
  { key: 'D', label: 'يومي', isIntraday: false },
  { key: 'W', label: 'أسبوعي', isIntraday: false },
];

export const RANGES = [
  { key: '1d', label: '1D', days: 1 },
  { key: '5d', label: '5D', days: 5 },
  { key: '1m', label: '1M', days: 30 },
  { key: '3m', label: '3M', days: 90 },
  { key: '6m', label: '6M', days: 180 },
  { key: '1y', label: '1Y', days: 365 },
  { key: 'all', label: 'الكل', days: 9999 },
];

const TIMEFRAMES = RESOLUTIONS;

// ─── Helper Functions ────────────────────────────────────────────────────────

function formatVolume(vol: number | null | undefined): string {
  if (vol === null || vol === undefined || isNaN(vol)) return '0';
  if (vol >= 1_000_000_000) return (vol / 1_000_000_000).toFixed(1) + 'B';
  if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(1) + 'M';
  if (vol >= 1_000) return (vol / 1_000).toFixed(1) + 'K';
  return vol.toString();
}

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

function calcEMA(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let ema: number | null = null;

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else if (i === period - 1) {
      // First EMA = SMA
      let sum = 0;
      for (let j = 0; j < period; j++) sum += data[i - j];
      ema = sum / period;
      result.push(ema);
    } else {
      ema = data[i] * k + (ema || 0) * (1 - k);
      result.push(ema);
    }
  }
  return result;
}

function calcBollingerBands(
  data: number[],
  period: number = 20,
  stdDev: number = 2
): { upper: (number | null)[]; middle: (number | null)[]; lower: (number | null)[] } {
  const middle = calcSMA(data, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    if (middle[i] === null) {
      upper.push(null);
      lower.push(null);
    } else {
      let sumSq = 0;
      for (let j = 0; j < period; j++) {
        sumSq += Math.pow(data[i - j] - (middle[i] as number), 2);
      }
      const sd = Math.sqrt(sumSq / period);
      upper.push((middle[i] as number) + stdDev * sd);
      lower.push((middle[i] as number) - stdDev * sd);
    }
  }

  return { upper, middle, lower };
}

// ─── CANONICAL-CALCULATIONS (Task PHASE-2-RSI-UNIFICATION, Rule 67: CALCULATION-CANONICAL) ─
// Task PHASE5-SCREENS-P1 (2026-10-08): calcRSI now imported from @/lib/canonical-rsi
// (was a local duplicate). The local function below was REMOVED — canonical is the SSOT.
// calcATR remains local for now (P2: will be moved to @/lib/canonical-atr when created).
// قيمة RSI الواحدة لازم تيجي من computeRSI في unified-stock-data.ts.
// Task PHASE5-SCREENS-P1: local calcRSI REMOVED — now imported from @/lib/canonical-rsi (computeRSISeries).
// The local function body was deleted (was a 44-line duplicate of canonical-rsi.ts::computeRSISeries).

function calcMACD(
  data: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: (number | null)[]; signal: (number | null)[]; histogram: (number | null)[] } {
  const fastEMA = calcEMA(data, fastPeriod);
  const slowEMA = calcEMA(data, slowPeriod);
  const macd: (number | null)[] = [];
  
  for (let i = 0; i < data.length; i++) {
    if (fastEMA[i] === null || slowEMA[i] === null) {
      macd.push(null);
    } else {
      macd.push((fastEMA[i] as number) - (slowEMA[i] as number));
    }
  }
  
  const nonNullMacd = macd.filter((v): v is number => v !== null);
  const signalRaw = calcEMA(nonNullMacd, signalPeriod);
  
  const signal: (number | null)[] = new Array(data.length).fill(null);
  const histogram: (number | null)[] = new Array(data.length).fill(null);
  let signalIdx = 0;
  
  for (let i = 0; i < macd.length; i++) {
    if (macd[i] !== null && signalIdx < signalRaw.length) {
      signal[i] = signalRaw[signalIdx];
      histogram[i] = (macd[i] as number) - (signalRaw[signalIdx] ?? 0);
      signalIdx++;
    }
  }
  
  return { macd, signal, histogram };
}

function calcStochastic(
  highs: number[],
  lows: number[],
  closes: number[],
  kPeriod: number = 14,
  dPeriod: number = 3
): { k: (number | null)[]; d: (number | null)[] } {
  const kValues: (number | null)[] = [];
  
  for (let i = 0; i < closes.length; i++) {
    if (i < kPeriod - 1) {
      kValues.push(null);
      continue;
    }
    
    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    
    for (let j = i - kPeriod + 1; j <= i; j++) {
      highestHigh = Math.max(highestHigh, highs[j]);
      lowestLow = Math.min(lowestLow, lows[j]);
    }
    
    if (highestHigh === lowestLow) {
      kValues.push(50);
    } else {
      kValues.push(((closes[i] - lowestLow) / (highestHigh - lowestLow)) * 100);
    }
  }
  
  const dValues: (number | null)[] = new Array(closes.length).fill(null);
  
  for (let i = 0; i < closes.length; i++) {
    if (kValues[i] === null) continue;
    
    const windowStart = i - dPeriod + 1;
    if (windowStart < 0) continue;
    
    let sum = 0;
    let count = 0;
    for (let j = windowStart; j <= i; j++) {
      if (kValues[j] !== null) {
        sum += kValues[j]!;
        count++;
      }
    }
    
    if (count === dPeriod) {
      dValues[i] = sum / dPeriod;
    }
  }
  
  return { k: kValues, d: dValues };
}

function calcATR(highs: number[], lows: number[], closes: number[], period: number = 14): (number | null)[] {
  const tr: number[] = [];
  
  for (let i = 1; i < closes.length; i++) {
    const h = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    tr.push(Math.max(h, hc, lc));
  }
  
  return calcSMA(tr, period);
}

function calcOBV(closes: number[], volumes: number[]): (number | null)[] {
  const result: (number | null)[] = [0];
  
  for (let i = 1; i < closes.length; i++) {
    const prevClose = closes[i - 1];
    const currClose = closes[i];
    const volume = volumes[i] || 0;
    
    if (currClose > prevClose) {
      result.push((result[i - 1] || 0) + volume);
    } else if (currClose < prevClose) {
      result.push((result[i - 1] || 0) - volume);
    } else {
      result.push(result[i - 1] || 0);
    }
  }
  
  return result;
}

// CHART-FIX (2026-10-01): removed normalizeDate(). It rewrote valid timestamps
// into 'DD/MM HH:mm' strings that the rest of the file could not parse back,
// and nothing needs it now that sanitizeOhlcBar preserves the source date.
function safeFormatTime(timeVal: any): string {
  if (!timeVal) return '';

  let date: Date | null = null;
  let isDateOnly = false;

  if (typeof timeVal === 'string') {
    const trimmed = timeVal.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      isDateOnly = true;
      const [y, m, d] = trimmed.split('-').map(Number);
      date = new Date(y, m - 1, d);
    } else if (/^\d{2}\/\d{2}/.test(trimmed)) {
      // CHART-FIX (2026-10-01): `new Date('09/01/26 10:30')` is parsed as
      // MM/DD by V8 and a missing century becomes 2001 — this is where the
      // bogus '09/01/2001' axis/tooltip label came from. Use the strict
      // day-first parser instead.
      const secs = parseSlashOrDashDate(trimmed);
      if (secs !== null) date = new Date(secs * 1000);
    } else {
      const num = Number(trimmed);
      if (!isNaN(num) && /^\d+(\.\d+)?$/.test(trimmed)) {
        date = new Date(num > 1e11 ? num : num * 1000);
      } else {
        date = new Date(trimmed);
      }
    }
  } else if (typeof timeVal === 'number') {
    date = new Date(timeVal > 1e11 ? timeVal : timeVal * 1000);
  } else if (timeVal && typeof timeVal === 'object' && 'year' in timeVal) {
    date = new Date(timeVal.year, timeVal.month - 1, timeVal.day);
    isDateOnly = true;
  } else {
    date = new Date(timeVal);
  }

  if (!date || isNaN(date.getTime())) return typeof timeVal === 'string' ? timeVal : '';

  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();

  if (isDateOnly) {
    return `${year}-${month}-${day}`;
  }

  const hours = date.getHours();
  const minutes = date.getMinutes();

  if (hours === 0 && minutes === 0) {
    return `${year}-${month}-${day}`;
  }

  const hourStr = String(hours).padStart(2, '0');
  const minStr = String(minutes).padStart(2, '0');
  return `${day}/${month} ${hourStr}:${minStr}`;
}

const fmtDateLabel = safeFormatTime;

// P35-FIX: Convert ANY date representation (number, numeric string, 'yyyy-mm-dd',
// 'dd/MM HH:mm', 'dd/MM/yyyy HH:mm', 'dd/MM/yyyy') to a UNIX-seconds integer Time.
// lightweight-charts REJECTS intraday string dates with "Invalid date string" —
// every series MUST pass a numeric Time. This is the single source of truth.
// CHART-FIX (2026-10-01): barTime now ALWAYS returns a UNIX-seconds integer.
// Previous version mixed string dates ('yyyy-mm-dd' as Time) with numeric timestamps
// causing lightweight-charts to collapse all candles into one giant bar.
// Rule: NO string dates ever leave this function — only integers.
//
// CHART-FIX (2026-10-01, 2nd pass): the previous version silently returned
// `Date.now()` for anything it could not parse. `Date.parse('09/01T10:30')`
// is NaN (JS only accepts ISO or US-order slashes), so every intraday candle
// carrying a 'dd/MM HH:mm' date collapsed onto the SAME timestamp — which is
// what produced the single giant bar / empty chart. Unparseable input must
// now be REJECTED, never guessed.

// Parses an EGX 'dd/MM/yyyy', 'dd/MM/yyyy HH:mm', 'dd/MM HH:mm' or
// 'yyyy-mm-dd[ HH:mm[:ss]]' date into UNIX seconds (UTC). Returns null if the
// value is unusable. Day-first ordering is explicit — never rely on
// Date.parse, which assumes month-first for slashes.
function parseSlashOrDashDate(s: string): number | null {
  // Compact 'yyyyMMdd' (EGX daily feed)
  const c = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (c) {
    const ts = Date.UTC(+c[1], +c[2] - 1, +c[3]);
    const back = new Date(ts);
    if (back.getUTCMonth() !== +c[2] - 1 || back.getUTCDate() !== +c[3]) return null;
    return Math.floor(ts / 1000);
  }
  const m = s.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (m) {
    const [, y, mo, d, hh = '0', mi = '0', ss = '0'] = m;
    return Math.floor(
      Date.UTC(+y, +mo - 1, +d, +hh, +mi, +ss) / 1000
    );
  }
  // Day-first: 'dd/MM/yyyy HH:mm[:ss]' or 'dd/MM HH:mm[:ss]'
  const d2 = s.match(
    /^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (d2) {
    const [, dd, mm, yy, hh = '0', mi = '0', ss = '0'] = d2;
    let year = yy ? +yy : new Date().getUTCFullYear();
    if (year < 100) year += 2000;
    const month = +mm;
    const day = +dd;
    // Reject impossible calendar dates (e.g. 31/02) instead of rolling over.
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const ts = Date.UTC(year, month - 1, day, +hh, +mi, +ss);
    const back = new Date(ts);
    if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
    return Math.floor(ts / 1000);
  }
  return null;
}

// Strict single source of truth for a candle's x-axis coordinate.
// Returns UNIX seconds, or null when the date cannot be trusted.
function parseBarSeconds(date: unknown): number | null {
  // Already a number (UNIX seconds or milliseconds)
  if (typeof date === 'number' && isFinite(date) && date > 0) {
    const ts = date > 1e12 ? date : date * 1000;
    // Guard against ms/seconds confusion producing year-2001 style epochs.
    if (ts < 631152000000) return null; // earlier than 1990-01-01
    return Math.floor(ts / 1000);
  }
  const s = String(date ?? '').trim();
  if (!s) return null;
  // Compact 'yyyyMMdd' is all digits but is a date, not an epoch — check first.
  if (/^\d{8}$/.test(s)) {
    const compact = parseSlashOrDashDate(s);
    if (compact !== null) return compact;
  }
  // Numeric string ('1700000000' or '1700000000000')
  if (/^\d+(\.\d+)?$/.test(s)) {
    const asNum = Number(s);
    if (asNum <= 0) return null;
    return parseBarSeconds(asNum);
  }
  // ISO / EGX slash formats
  const strict = parseSlashOrDashDate(s);
  if (strict !== null) return strict;
  // Last resort: any other parseable ISO string (with explicit zone).
  const parsed = Date.parse(s.includes('T') && !/[Zz]|[+-]\d{2}:?\d{2}$/.test(s)
    ? `${s}Z`
    : s);
  if (isNaN(parsed)) return null;
  const secs = Math.floor(parsed / 1000);
  if (secs * 1000 < 631152000000) return null;
  return secs;
}

function barTime(b: OhlcvBar): Time {
  // V-07 (CHART-BLANK-FIX): read bar.date ?? bar.timestamp ?? bar.time
  const rawDate = resolveBarDate(b);
  return (parseBarSeconds(rawDate as unknown) ?? Math.floor(Date.now() / 1000)) as Time;
}

function sanitizeOhlcBar(bar: OhlcvBar): OhlcvBar | null {
  // V-07 (CHART-BLANK-FIX): read bar.date ?? bar.timestamp ?? bar.time
  const rawDate = resolveBarDate(bar);
  const seconds = parseBarSeconds(rawDate as unknown);
  if (seconds === null) return null;
  let open = Number(bar.open);
  let high = Number(bar.high);
  let low = Number(bar.low);
  let close = Number(bar.close);
  if ([open, high, low, close].some((v) => !Number.isFinite(v))) return null;
  if (close <= 0) return null;
  if (open <= 0) open = close;
  if (high <= 0) high = Math.max(open, close);
  if (low <= 0) low = Math.min(open, close);

  // Auto-heal OHLC integrity instead of rejecting candle
  high = Math.max(high, open, close);
  low = Math.min(low > 0 ? low : open, open, close);

  // Outlier / 52w-placeholder fix:
  // e.g. low=72.0 injected when stock is trading at 250-450 EGP
  if (low < close * 0.4 && close > 10) {
    low = Math.min(open, close) * 0.98;
  }
  if (high > close * 3.0 && close > 10) {
    high = Math.max(open, close) * 1.05;
  }

  return {
    ...bar,
    open: Math.round(open * 1000) / 1000,
    high: Math.round(high * 1000) / 1000,
    low: Math.round(low * 1000) / 1000,
    close: Math.round(close * 1000) / 1000,
    volume: Number.isFinite(Number(bar.volume)) ? Number(bar.volume) : 0,
  };
}

// CHART-OVERHAUL Fix 2: Array-level sanitization filter.
// Rejects invalid OHLC + outliers (low=0, open=null, high>2x close, etc.)
// so the price scale doesn't stretch from 50 to 650 due to corrupted data.
// CHART-FIX (2026-10-01, 2nd pass): also sorts ascending and de-duplicates by
// timestamp. lightweight-charts throws on unsorted or repeated time values,
// which previously surfaced as a blank canvas.
function sanitizeCandles(candles: OhlcvBar[]): OhlcvBar[] {
  const seen = new Set<number>();
  return candles
    .map(sanitizeOhlcBar)
    .filter((bar): bar is OhlcvBar => bar !== null)
    // V-07 (CHART-BLANK-FIX): use resolveBarDate for sort + dedup
    .sort((a, b) => (parseBarSeconds(resolveBarDate(a) as unknown) ?? 0) - (parseBarSeconds(resolveBarDate(b) as unknown) ?? 0))
    .filter((bar) => {
      const t = parseBarSeconds(resolveBarDate(bar) as unknown);
      if (t === null || seen.has(t)) return false;
      seen.add(t);
      return true;
    });
}

// CHART-OVERHAUL Fix 3: Cairo timezone formatters (UTC+2 / +3 with DST).
// lightweight-charts uses UTCTimestamp (seconds since epoch in UTC); the
// localization formatters below render these in Africa/Cairo so the axis
// shows 10:00-14:30 (market hours) instead of 06:00 / 16:30 / 17:45.
const cairoTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const cairoDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  day: '2-digit',
  month: 'short',
});

// CHART-FIX (2026-10-01): Always format from numeric timestamp.
// Never fall through to safeFormatTime (which parses 'dd/MM/yyyy' as MM/DD).
function cairoTimeLabel(time: unknown): string {
  if (typeof time === 'number' && isFinite(time) && time > 0) {
    return cairoTimeFormatter.format(new Date(time * 1000));
  }
  // If it's a string, try to parse as number first
  const num = Number(time);
  if (!isNaN(num) && num > 0) {
    return cairoTimeFormatter.format(new Date(num > 1e12 ? num : num * 1000));
  }
  // Last resort: parse as date
  const d = new Date(String(time));
  if (!isNaN(d.getTime())) {
    return cairoTimeFormatter.format(d);
  }
  return '';
}

function cairoDateLabel(time: unknown): string {
  if (typeof time === 'number' && isFinite(time) && time > 0) {
    return cairoDateFormatter.format(new Date(time * 1000));
  }
  return safeFormatTime(time);
}

// CHART-OVERHAUL Fix 3: Filter intraday candles to EGX market hours
// (10:00 - 14:30 Cairo local time). Removes after-close + pre-open noise
// (e.g. 16:30, 17:45, 06:00) that corrupts the time axis.
// CHART-EMPTY-FIX: only apply to intraday timeframes. Self-defensive — if
// filtering removes > 80% of candles (likely backend already pre-filtered OR
// timezone conversion went wrong), skip the filter and return original data.
// CHART-FIX (2026-10-01): filterMarketHours DISABLED.
// This filter was destroying 90% of intraday candles due to timezone mismatch.
// The backend already returns market-hours-only data. No client-side filter needed.
function filterMarketHours(candles: OhlcvBar[]): OhlcvBar[] {
  return candles;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TradingViewChart({
  ticker,
  stockName,
  height = 500,
}: TradingViewChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const markersRef = useRef<any>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allData, setAllData] = useState<OhlcvBar[]>([]);
  const [lastPrice, setLastPrice] = useState<{ price: number; change: number; changePercent: number } | null>(null);
  const [hoveredPrice, setHoveredPrice] = useState<OhlcvBar | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [timeframe, setTimeframe] = useState<string>('D');
  const [currentRange, setCurrentRange] = useState<string>('1w');
  const [dataSource, setDataSource] = useState<string>('intraday');
  const [chartType, setChartType] = useState<ChartType>('candlestick');
  const [indicators, setIndicators] = useState<IndicatorSettings>({
    sma20: true,
    sma50: true,
    sma200: false,
    ema20: false,
    bollingerBands: false,
    volume: true,
    rsi: false,
    macd: false,
    stochastic: false,
    atr: false,
    obv: false,
  });

  // Market status & display modes
  const [marketClosed, setMarketClosed] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const currentMarket = useAppStore((s) => s.currentMarket);
  const [chartEngine, setChartEngine] = useState<'interactive' | 'tradingview_widget'>('tradingview_widget');
  // GLM5.2-A (ALPHA-MARKERS): toggle states for markers + priceLines
  const [showMakerMarkers, setShowMakerMarkers] = useState(true);
  const [showTradeLines, setShowTradeLines] = useState(true);
  const [showSRZones, setShowSRZones] = useState(false);

  const tvSymbol = useMemo(() => {
    const t = (ticker || 'PHDC').toUpperCase().trim();
    if ((currentMarket as string) === 'CRYPTO' || ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'].includes(t)) {
      return `BINANCE:${t}USDT`;
    }
    if ((currentMarket as string) === 'SAUDI' || currentMarket === 'TADAWUL' || /^\d{4}$/.test(t)) {
      return `TADAWUL:${t}`;
    }
    if (currentMarket === 'US') {
      return `NASDAQ:${t}`;
    }
    return `EGX:${t}`;
  }, [ticker, currentMarket]);

  const tvInterval = useMemo(() => {
    if (timeframe === 'W') return 'W';
    return 'D';
  }, [timeframe]);

  // ─── Fetch Data ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setIsLoading(true);
      setError(null);
      setMarketClosed(false);

      try {
        const tfConfig = RESOLUTIONS.find((t) => t.key === timeframe);
        const isIntraday = tfConfig?.isIntraday === true;

        let json: any;
        let usedMarketClosedFallback = false;

        // 1. Primary fetch: /api/chart/[ticker] with interval and period
        try {
          const chartRes = await fetch(
            `/api/chart/${ticker}?interval=${timeframe}&period=${currentRange}&asset=stock&_t=${Date.now()}`
          );
          if (chartRes.ok) {
            const chartJson = await chartRes.json();
            if (chartJson.success && Array.isArray(chartJson.data) && chartJson.data.length > 0) {
              // V-07 (CHART-BLANK-FIX): normalize each candle to ensure `date` field
              // exists. Backend sends `timestamp` — without this, sanitizeOhlcBar
              // reads bar.date (undefined) → drops all candles → blank chart.
              json = {
                ...chartJson,
                data: chartJson.data.map((c: any) => ({
                  ...c,
                  date: c.date ?? c.timestamp ?? c.time,
                })),
              };
              setDataSource(chartJson.source || (isIntraday ? 'intraday' : 'daily'));
            }
          }
        } catch {
          // swallow and try fallback below
        }

        // 2. Fallback to /api/v2/chart/full-analysis (unified market analysis)
        if (!json || !json.data || json.data.length === 0) {
          try {
            const v2Tf = isIntraday ? timeframe.toUpperCase() : (timeframe === '1W' ? 'WEEK' : 'DAY');
            const v2Res = await fetch(
              `/api/v2/chart/full-analysis?ticker=${encodeURIComponent(ticker)}&timeframe=${v2Tf}&limit=365`
            );
            if (v2Res.ok) {
              const v2Json = await v2Res.json();
              if (v2Json.ohlcv && Array.isArray(v2Json.ohlcv) && v2Json.ohlcv.length > 0) {
                json = {
                  success: true,
                  data: v2Json.ohlcv.map((c: any) => ({
                    date: c.time ?? c.date ?? c.timestamp,
                    open: c.open,
                    high: c.high,
                    low: c.low,
                    close: c.close,
                    volume: c.volume || 0,
                  })),
                  source: 'full_analysis',
                };
                setDataSource('full_analysis');
              }
            }
          } catch {
            // continue to history fallback
          }
        }

        // 3. Fallback to /api/stocks/[ticker]/history if chart endpoint failed
        if (!json || !json.data || json.data.length === 0) {
          const days = isIntraday ? 30 : 365;
          const historyRes = await fetch(`/api/stocks/${ticker}/history?days=${days}`);
          if (historyRes.ok) {
            json = await historyRes.json();
            usedMarketClosedFallback = true;
            setDataSource('fallback_daily');
          }
        }

        if (!cancelled) {
          const rawData = json?.data || [];
          if (rawData.length > 0) {
            // CHART-FIX (2026-10-01): sanitizeCandles now sorts strictly by the
            // parsed timestamp and drops duplicates/unparseable dates, so the
            // old locale-dependent pre-sort is gone.
            const sortedData = sanitizeCandles(rawData as OhlcvBar[]);
            if (sortedData.length === 0) {
              throw new Error('لا توجد بيانات صالحة للعرض لهذا الرمز');
            }
            setAllData(sortedData);

            if (usedMarketClosedFallback || !getEGXMarketStatus().isOpen) {
              setMarketClosed(true);
            }

            // Calculate price change
            if (sortedData.length >= 2) {
              const last = sortedData[sortedData.length - 1];
              const prev = sortedData[sortedData.length - 2];
              const change = last.close - prev.close;
              const changePercent = (change / prev.close) * 100;
              setLastPrice({
                price: last.close,
                change,
                changePercent,
              });
            }
          } else {
            throw new Error(json?.error || 'لا توجد بيانات متاحة لهذا الرمز');
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError('تعذّر تحميل بيانات الرسم البياني. يرجى المحاولة مرة أخرى.');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchData();

    return () => {
      cancelled = true;
    };
  }, [ticker, timeframe, currentRange]);

  const handleResolutionChange = (resKey: string) => {
    setTimeframe(resKey);
    // If switching to intraday while range is year/all, narrow to 1w for performance
    if (['5m', '15m', '30m'].includes(resKey) && ['1y', 'all'].includes(currentRange)) {
      setCurrentRange('1w');
    } else if (['1D', '1W'].includes(resKey) && currentRange === '1d') {
      setCurrentRange('1m');
    }
  };

  const handleRangeChange = (rKey: string) => {
    setCurrentRange(rKey);
    // If user clicks 1D or 5D on daily chart, switch to intraday so day candles show
    if (['1d', '5d'].includes(rKey) && ['1D', '1W'].includes(timeframe)) {
      setTimeframe(rKey === '1d' ? '5m' : '15m');
    } else if (['1m', '3m', '6m', '1y', 'all'].includes(rKey) && ['5m', '15m'].includes(timeframe)) {
      setTimeframe('1D');
    }
  };

  // ─── Filter data by timeframe & range ────────────────────────────────────────

  const data = React.useMemo(() => {
    if (allData.length === 0) return [];
    const tf = RESOLUTIONS.find((t) => t.key === timeframe);
    const rangeConfig = RANGES.find((r) => r.key === currentRange);
    if (!rangeConfig || rangeConfig.days >= 9999) {
      // Intraday: filter to EGX market hours (10:00 - 14:30 Cairo)
      return tf?.isIntraday ? filterMarketHours(allData) : allData;
    }

    const cutoffSeconds = Math.floor(Date.now() / 1000) - rangeConfig.days * 86400;
    // CHART-FIX (2026-10-01): use the strict parser — `new Date('09/01 10:30')`
    // is locale-dependent and returns NaN, which silently emptied the range.
    const filtered = allData.filter((b) => {
      const t = parseBarSeconds(b.date as unknown);
      return t !== null && t >= cutoffSeconds;
    });
    if (filtered.length === 0) return allData;
    // Intraday: also apply market-hours filter to the range-sliced subset
    return tf?.isIntraday ? filterMarketHours(filtered) : filtered;
  }, [allData, timeframe, currentRange]);

  // ─── Create Chart ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return;

    // P37-PHASE-1: Focus Mode strips every secondary indicator and keeps only
    // the main price series + volume, so mobile users get a clean chart when
    // too many overlays clutter the view.
    const effectiveIndicators: IndicatorSettings = focusMode
      ? {
          sma20: false,
          sma50: false,
          sma200: false,
          ema20: false,
          bollingerBands: false,
          rsi: false,
          macd: false,
          stochastic: false,
          atr: false,
          obv: false,
          volume: indicators.volume,
        }
      : indicators;

    // Cleanup previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    const container = containerRef.current;
    const chartHeight = isFullscreen ? window.innerHeight - 100 : height;

    // Theme-aware colors
    const bgColor = isDark ? '#131722' : '#ffffff';
    const textColor = isDark ? '#d1d4dc' : '#191919';
    const gridColor = isDark ? '#1f2943' : '#e0e0e0';
    const crosshairColor = isDark ? '#758696' : '#9b9b9b';
    const labelBgColor = isDark ? '#2A2E39' : '#f0f0f0';
    const borderColor = isDark ? '#2A2E39' : '#d0d0d0';

    const hasOscillator = effectiveIndicators.rsi || effectiveIndicators.macd || effectiveIndicators.stochastic || effectiveIndicators.atr || effectiveIndicators.obv;

    // Chart options
    const options: DeepPartial<ChartOptions> = {
      width: container.clientWidth,
      height: chartHeight,
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: bgColor },
        textColor,
        fontFamily: 'Trebuchet MS, Roboto, Ubuntu, sans-serif',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: gridColor, style: isDark ? LineStyle.Dotted : LineStyle.Solid },
        horzLines: { color: gridColor, style: isDark ? LineStyle.Dotted : LineStyle.Solid },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          width: 1,
          color: crosshairColor,
          style: LineStyle.Dashed,
          labelBackgroundColor: labelBgColor,
        },
        horzLine: {
          width: 1,
          color: crosshairColor,
          style: LineStyle.Dashed,
          labelBackgroundColor: labelBgColor,
        },
      },
      rightPriceScale: {
        borderColor,
        scaleMargins: { top: 0.1, bottom: hasOscillator ? 0.35 : (effectiveIndicators.volume ? 0.2 : 0.1) },
      },
      timeScale: {
        borderColor,
        timeVisible: true,
        secondsVisible: false,
        // CHART-OVERHAUL Fix 1: barSpacing 10 + rightOffset 12 prevents the
        // giant fat candles (6 candles stretched across 1200px = 200px each)
        // caused by unconditional fitContent() on small datasets.
        barSpacing: 10,
        minBarSpacing: 3,
        // CHART-FIX (2026-10-01): hard cap so fitContent() can never stretch a
        // single candle across the full container width again.
        maxBarSpacing: 30,
        fixLeftEdge: false,
        fixRightEdge: true,
        rightOffset: 12,
        tickMarkFormatter: (time: unknown) => cairoTimeLabel(time),
      },
      localization: {
        // CHART-OVERHAUL Fix 3: render times in Africa/Cairo (UTC+2/+3 DST)
        // so the axis shows 10:00-14:30 market hours, not 06:00 / 16:30.
        timeFormatter: (time: unknown) => cairoTimeLabel(time),
      },
    };

    let chart: IChartApi;
    try {
      chart = createChart(container, options);
    } catch (err) {
      console.error('Chart init failed:', err);
      setError('تعذر تهيئة الرسم البياني');
      return;
    }
    chartRef.current = chart;

    // CHART-OVERHAUL Fix 2: defensive sanitization pass right before setData.
    // Outliers (low=0, open=null, high>5x close) are rejected so the price
    // scale stays tight (e.g. 100-110) instead of stretching 50-650.
    // CHART-EMPTY-FIX: if sanitization removes ALL candles, fallback to raw
    // `data` so the chart never renders empty — raw data is better than nothing.
    let cleanData = sanitizeCandles(data);
    if (cleanData.length === 0) {
      console.warn('[chart] all candles filtered out — using raw data');
      cleanData = data;
    }

    // ─── Main Price Series ─────────────────────────────────────────────────

    const closes = cleanData.map((bar) => bar.close);
    const highs = cleanData.map((bar) => bar.high);
    const lows = cleanData.map((bar) => bar.low);
    const volumes = cleanData.map((bar) => bar.volume);

    try {
      if (chartType === 'candlestick') {
        const series = chart.addSeries(CandlestickSeries, {
          upColor: UP_COLOR,
          downColor: DOWN_COLOR,
          borderUpColor: UP_COLOR,
          borderDownColor: DOWN_COLOR,
          wickUpColor: UP_COLOR,
          wickDownColor: DOWN_COLOR,
        });

        // P35-FIX: use unified barTime() so intraday string dates are always
        // converted to UNIX int — no more 'Invalid date string' crashes.
        const candleData = cleanData.map((bar) => ({
          time: barTime(bar),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        }));

        series.setData(candleData);
        candleSeriesRef.current = series;
      } else if (chartType === 'bar') {
        const series = chart.addSeries(BarSeries, {
          upColor: UP_COLOR,
          downColor: DOWN_COLOR,
        });

        const barData = cleanData.map((bar) => ({
          time: barTime(bar),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
        }));

        series.setData(barData);
      } else if (chartType === 'area') {
        const series = chart.addSeries(LineSeries, {
          color: UP_COLOR,
          lineWidth: 2,
        });

        const areaData = cleanData.map((bar) => ({
          time: barTime(bar),
          value: bar.close,
        }));

        series.setData(areaData);
      }
    } catch (err) {
      console.error('Main series failed:', err);
      setError('خطأ في تحميل بيانات الرسم البياني');
      chart.remove();
      chartRef.current = null;
      return;
    }

    // ─── Volume Series (v5 API) ────────────────────────────────────────────────

    if (effectiveIndicators.volume) {
      const volumeSeries = chart.addSeries(HistogramSeries, {
        color: VOLUME_UP,
        priceFormat: {
          type: 'volume',
        },
        priceScaleId: 'volume',
      });

      // CHART-OVERHAUL Fix 4: Volume occupies bottom 18% only (top: 0.82)
      // so volume bars don't cover price candles.
      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.82, bottom: 0 },
      });

      const volumeData = cleanData.map((bar) => ({
        time: barTime(bar),
        value: bar.volume,
        color: bar.close >= bar.open ? VOLUME_UP : VOLUME_DOWN,
      }));

      volumeSeries.setData(volumeData);
      volumeSeriesRef.current = volumeSeries;
    }

    // ─── Moving Averages (v5 API) ──────────────────────────────────────────────

    if (effectiveIndicators.sma20) {
      const sma20Data = calcSMA(closes, 20);
      const sma20Series = chart.addSeries(LineSeries, {
        color: SMA20_COLOR,
        lineWidth: 1,
        title: 'SMA 20',
      });

      sma20Series.setData(
        sma20Data
          .map((value, i) =>
            value !== null ? { time: barTime(data[i]), value } : null
          )
          .filter(Boolean) as { time: Time; value: number }[]
      );
    }

    if (effectiveIndicators.sma50) {
      const sma50Data = calcSMA(closes, 50);
      const sma50Series = chart.addSeries(LineSeries, {
        color: SMA50_COLOR,
        lineWidth: 1,
        title: 'SMA 50',
      });

      sma50Series.setData(
        sma50Data
          .map((value, i) =>
            value !== null ? { time: barTime(data[i]), value } : null
          )
          .filter(Boolean) as { time: Time; value: number }[]
      );
    }

    if (effectiveIndicators.sma200) {
      const sma200Data = calcSMA(closes, 200);
      const sma200Series = chart.addSeries(LineSeries, {
        color: SMA200_COLOR,
        lineWidth: 1,
        title: 'SMA 200',
      });

      sma200Series.setData(
        sma200Data
          .map((value, i) =>
            value !== null ? { time: barTime(data[i]), value } : null
          )
          .filter(Boolean) as { time: Time; value: number }[]
      );
    }

    if (effectiveIndicators.ema20) {
      const ema20Data = calcEMA(closes, 20);
      const ema20Series = chart.addSeries(LineSeries, {
        color: EMA20_COLOR,
        lineWidth: 1,
        title: 'EMA 20',
      });

      ema20Series.setData(
        ema20Data
          .map((value, i) =>
            value !== null ? { time: barTime(data[i]), value } : null
          )
          .filter(Boolean) as { time: Time; value: number }[]
      );
    }

    // ─── Bollinger Bands (v5 API) ──────────────────────────────────────────────

    if (effectiveIndicators.bollingerBands) {
      const bb = calcBollingerBands(closes, 20, 2);

      const upperSeries = chart.addSeries(LineSeries, {
        color: BB_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: 'BB Upper',
      });

      upperSeries.setData(
        bb.upper
          .map((value, i) =>
            value !== null ? { time: barTime(data[i]), value } : null
          )
          .filter(Boolean) as { time: Time; value: number }[]
      );

      const lowerSeries = chart.addSeries(LineSeries, {
        color: BB_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: 'BB Lower',
      });

      lowerSeries.setData(
        bb.lower
          .map((value, i) =>
            value !== null ? { time: barTime(data[i]), value } : null
          )
          .filter(Boolean) as { time: Time; value: number }[]
      );
    }

    // ─── Oscillators & Other Indicators ────────────────────────────────────

    const oscScaleId = hasOscillator ? 'oscillator' : undefined;

    if (hasOscillator) {
      const oscScale = chart.priceScale('oscillator');
      oscScale.applyOptions({
        scaleMargins: { top: 0.65, bottom: effectiveIndicators.volume ? 0.15 : 0 },
      });
    }

    // RSI
    if (effectiveIndicators.rsi) {
      const rsiData = calcRSI(closes, 14);
      const rsiSeries = chart.addSeries(LineSeries, {
        color: RSI_COLOR,
        lineWidth: 2,
        title: 'RSI',
        priceScaleId: oscScaleId,
      });

      rsiSeries.setData(
        rsiData
          .map((value, i) =>
            value !== null ? { time: barTime(data[i]), value } : null
          )
          .filter(Boolean) as { time: Time; value: number }[]
      );

      const obLine = chart.addSeries(LineSeries, {
        color: DOWN_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: 'OB',
        priceScaleId: oscScaleId,
      });
      obLine.setData(cleanData.map(bar => ({ time: barTime(bar), value: 70 })));

      const osLine = chart.addSeries(LineSeries, {
        color: UP_COLOR,
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: 'OS',
        priceScaleId: oscScaleId,
      });
      osLine.setData(cleanData.map(bar => ({ time: barTime(bar), value: 30 })));
    }

    // MACD
    if (effectiveIndicators.macd) {
      const { macd, signal, histogram } = calcMACD(closes);
      
      const macdLine = chart.addSeries(LineSeries, {
        color: MACD_COLOR,
        lineWidth: 2,
        title: 'MACD',
        priceScaleId: oscScaleId,
      });
      macdLine.setData(
        macd.map((value, i) =>
          value !== null ? { time: barTime(data[i]), value } : null
        ).filter(Boolean) as { time: Time; value: number }[]
      );

      const signalLine = chart.addSeries(LineSeries, {
        color: MACD_SIGNAL_COLOR,
        lineWidth: 2,
        title: 'Signal',
        priceScaleId: oscScaleId,
      });
      signalLine.setData(
        signal.map((value, i) =>
          value !== null ? { time: barTime(data[i]), value } : null
        ).filter(Boolean) as { time: Time; value: number }[]
      );

      const histSeries = chart.addSeries(HistogramSeries, {
        color: MACD_COLOR,
        title: 'Hist',
        priceScaleId: oscScaleId,
      });
      histSeries.setData(
        histogram.map((value, i) => {
          if (value === null) return null;
          return {
            time: barTime(cleanData[i]),
            value,
            color: value >= 0 ? UP_COLOR : DOWN_COLOR,
          };
        }).filter(Boolean) as { time: Time; value: number; color?: string }[]
      );
    }

    // Stochastic
    if (effectiveIndicators.stochastic) {
      const { k, d } = calcStochastic(highs, lows, closes);
      
      const kLine = chart.addSeries(LineSeries, {
        color: STOCH_K_COLOR,
        lineWidth: 2,
        title: '%K',
        priceScaleId: oscScaleId,
      });
      kLine.setData(
        k.map((value, i) =>
          value !== null ? { time: barTime(data[i]), value } : null
        ).filter(Boolean) as { time: Time; value: number }[]
      );

      const dLine = chart.addSeries(LineSeries, {
        color: STOCH_D_COLOR,
        lineWidth: 2,
        title: '%D',
        priceScaleId: oscScaleId,
      });
      dLine.setData(
        d.map((value, i) =>
          value !== null ? { time: barTime(data[i]), value } : null
        ).filter(Boolean) as { time: Time; value: number }[]
      );
    }

    // ATR
    if (effectiveIndicators.atr) {
      const atrData = calcATR(highs, lows, closes);
      const atrSeries = chart.addSeries(LineSeries, {
        color: ATR_COLOR,
        lineWidth: 2,
        title: 'ATR',
        priceScaleId: oscScaleId,
      });
      atrSeries.setData(
        atrData.map((value, i) =>
          value !== null ? { time: barTime(data[i]), value } : null
        ).filter(Boolean) as { time: Time; value: number }[]
      );
    }

    // OBV
    if (effectiveIndicators.obv) {
      const obvData = calcOBV(closes, volumes);
      const obvSeries = chart.addSeries(LineSeries, {
        color: OBV_COLOR,
        lineWidth: 2,
        title: 'OBV',
        priceScaleId: oscScaleId,
      });
      obvSeries.setData(
        obvData.map((value, i) =>
          value !== null ? { time: barTime(data[i]), value } : null
        ).filter(Boolean) as { time: Time; value: number }[]
      );
    }

    // ─── Crosshair Move Handler ───────────────────────────────────────────────

    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) {
        setHoveredPrice(null);
        return;
      }

      // P35-FIX: compare by normalized UNIX time, not raw string equality.
      const tNum = typeof param.time === 'number'
        ? (param.time as number)
        : barTime({ date: param.time as unknown as string } as OhlcvBar) as unknown as number;
      const bar = data.find((b) => {
        const bt = barTime(b) as unknown as number;
        return bt === tNum;
      });
      if (bar) {
        setHoveredPrice(bar);
      }
    });

    // CHART-OVERHAUL Fix 1: only fitContent if we have enough candles to
    // fill the screen naturally. With barSpacing: 10, ~30 candles cover the
    // typical viewport — fewer than that would stretch into giant bricks.
    // CHART-EMPTY-FIX: for <30 candles, still call fitContent() but also set
    // barSpacing: 10 to prevent giant candles, then scroll to real time.
    // CHART-FIX (2026-10-01): ALWAYS fitContent — never scrollToRealTime.
    // scrollToRealTime jumps to current time, pushing historical candles off-screen.
    // fitContent shows ALL candles at optimal zoom level.
    chart.timeScale().fitContent();

    // ─── GLM5.2-A (ALPHA-MARKERS): Candlestick Markers + PriceLines ────────
    if (candleSeriesRef.current && cleanData.length > 0) {
      const allHighs = cleanData.map(b => b.high).filter(v => v > 0);
      const allLows = cleanData.map(b => b.low).filter(v => v > 0);
      const allCloses = cleanData.map(b => b.close).filter(v => v > 0);
      const swingHigh = allHighs.length > 0 ? Math.max(...allHighs) : 0;
      const swingLow = allLows.length > 0 ? Math.min(...allLows) : 0;
      const lastClose = allCloses.length > 0 ? allCloses[allCloses.length - 1] : 0;
      const swingRange = swingHigh - swingLow || 1;
      const targetPrice = swingHigh > 0 ? swingHigh : lastClose * 1.05;
      const stopPrice = swingLow > 0 ? swingLow : lastClose * 0.95;
      const fib618 = swingHigh - swingRange * 0.618;

      // ─── Markers (createSeriesMarkers — v5 API) ───────────────────────
      const markers: SeriesMarker<Time>[] = [];
      if (showMakerMarkers) {
        // Entry marker on the last candle
        markers.push({
          time: barTime(cleanData[cleanData.length - 1]) as Time,
          position: 'belowBar',
          color: '#3b82f6',
          shape: 'arrowUp',
          text: 'دخول',
        });

        // Highest-volume candle (volume climax — maker activity)
        let maxVolIdx = 0;
        let maxVol = 0;
        for (let i = 0; i < cleanData.length; i++) {
          if (cleanData[i].volume > maxVol) {
            maxVol = cleanData[i].volume;
            maxVolIdx = i;
          }
        }
        if (maxVolIdx > 0 && maxVolIdx < cleanData.length - 1) {
          markers.push({
            time: barTime(cleanData[maxVolIdx]) as Time,
            position: 'aboveBar',
            color: '#f59e0b',
            shape: 'circle',
            text: 'ذروة حجم',
          });
        }

        // Lowest low (support bounce)
        let lowestIdx = 0;
        let lowestVal = Infinity;
        for (let i = 0; i < cleanData.length; i++) {
          if (cleanData[i].low < lowestVal && cleanData[i].low > 0) {
            lowestVal = cleanData[i].low;
            lowestIdx = i;
          }
        }
        if (lowestIdx > 0) {
          markers.push({
            time: barTime(cleanData[lowestIdx]) as Time,
            position: 'belowBar',
            color: '#10b981',
            shape: 'circle',
            text: 'ارتداد دعم',
          });
        }

        markers.sort((a, b) => (a.time as number) - (b.time as number));
      }

      // Use createSeriesMarkers (v5 API — replaces setMarkers)
      if (markersRef.current) {
        try { markersRef.current.setMarkers(markers); } catch { markersRef.current = null; }
      }
      if (!markersRef.current && candleSeriesRef.current) {
        markersRef.current = createSeriesMarkers(candleSeriesRef.current, markers);
      }

      // ─── PriceLines ──────────────────────────────────────────────────
      // Remove previous price lines
      if (priceLinesRef.current.length > 0) {
        priceLinesRef.current.forEach(pl => {
          try { candleSeriesRef.current?.removePriceLine(pl); } catch { /* silent */ }
        });
        priceLinesRef.current = [];
      }

      if (candleSeriesRef.current && showTradeLines) {
        priceLinesRef.current.push(candleSeriesRef.current.createPriceLine({
          price: targetPrice, color: '#10b981', lineWidth: 2,
          lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '🎯 هدف الصفقة',
        }));
        priceLinesRef.current.push(candleSeriesRef.current.createPriceLine({
          price: stopPrice, color: '#f23645', lineWidth: 2,
          lineStyle: LineStyle.Solid, axisLabelVisible: true, title: '🛑 وقف الخسارة',
        }));
      }

      if (candleSeriesRef.current && showSRZones) {
        priceLinesRef.current.push(candleSeriesRef.current.createPriceLine({
          price: fib618, color: '#f59e0b', lineWidth: 1,
          lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: 'Fib 0.618',
        }));
        priceLinesRef.current.push(candleSeriesRef.current.createPriceLine({
          price: swingHigh, color: '#ef4444', lineWidth: 1,
          lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'مقاومة',
        }));
        priceLinesRef.current.push(candleSeriesRef.current.createPriceLine({
          price: swingLow, color: '#10b981', lineWidth: 1,
          lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: 'دعم',
        }));
      }
    }

    // Cleanup on unmount
    return () => {
      chart.remove();
      chartRef.current = null;
      markersRef.current = null;
    };
  }, [data, indicators, focusMode, height, isFullscreen, isDark, chartType, showMakerMarkers, showTradeLines, showSRZones]);

  // ─── Controls ──────────────────────────────────────────────────────────────

  const handleZoomIn = useCallback(() => {
    chartRef.current?.timeScale().fitContent();
  }, []);

  const handleZoomOut = useCallback(() => {
    if (chartRef.current) {
      const ts = chartRef.current.timeScale();
      const visibleRange = ts.getVisibleRange();
      if (visibleRange) {
        ts.setVisibleRange({
          from: data[0] ? barTime(data[0]) : (Math.floor(Date.now() / 1000) - 86400) as Time,
          to: data[data.length - 1] ? barTime(data[data.length - 1]) : Math.floor(Date.now() / 1000) as Time,
        });
      }
    }
  }, [data]);

  const handleFit = useCallback(() => {
    const ts = chartRef.current?.timeScale();
    if (!ts) return;
    // CHART-OVERHAUL Fix 1: same conditional as initial render — don't stretch
    // <30 candles into giant fat bricks even when user clicks Fit.
    // CHART-EMPTY-FIX: for <30 candles, apply barSpacing + fitContent + scroll.
    if (data.length >= 30) {
      ts.fitContent();
    } else {
      ts.applyOptions({ barSpacing: 10 });
      ts.fitContent();
    }
  }, [data]);

  const handleScreenshot = useCallback(() => {
    if (chartRef.current) {
      const canvas = chartRef.current.takeScreenshot();
      const link = document.createElement('a');
      link.download = `${ticker}_chart_${new Date().toISOString().split('T')[0]}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  }, [ticker]);

  const handleFullscreen = useCallback(() => {
    if (!containerRef.current) return;

    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);

  // ─── Loading State ─────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border/60 bg-card border border-border overflow-hidden dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 dark:border-outline-variant/30">
          <Skeleton className="h-5 w-40" />
          <div className="flex gap-2">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-7 w-16" />
          </div>
        </div>
        <Skeleton className="w-full" style={{ height: `${height}px` }} />
      </div>
    );
  }

  // ─── Error State ───────────────────────────────────────────────────────────

  if (error) {
    return (
      <div className="rounded-xl border border-border/60 bg-card border border-border p-8 flex flex-col items-center justify-center min-h-[400px] dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
        <RotateCcw className="size-10 text-muted-foreground mb-4 dark:text-on-surface-variant" />
        <p className="text-sm font-medium text-destructive mb-2 dark:text-error">خطأ في تحميل الشارت</p>
        <p className="text-xs text-muted-foreground mb-4 dark:text-on-surface-variant">{error}</p>
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

  // ─── No Data State ─────────────────────────────────────────────────────────

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-border/60 bg-card border border-border p-8 flex flex-col items-center justify-center min-h-[400px] dark:bg-surface-container-low dark:border dark:border-outline-variant/30">
        <p className="text-sm font-medium text-muted-foreground dark:text-on-surface-variant">
          لا توجد بيانات تاريخية لهذا السهم
        </p>
      </div>
    );
  }

  // ─── Main Render ───────────────────────────────────────────────────────────

  const displayPrice = hoveredPrice?.close || lastPrice?.price || 0;
  const displayChange = hoveredPrice
    ? hoveredPrice.close - hoveredPrice.open
    : lastPrice?.change || 0;
  const displayChangePercent = hoveredPrice
    ? ((hoveredPrice.close - hoveredPrice.open) / hoveredPrice.open) * 100
    : lastPrice?.changePercent || 0;

  const isPositive = displayChange >= 0;

  return (
    <div
      className={cn(
        'rounded-xl border border-border/60 bg-card border border-border overflow-hidden dark:bg-surface-container-lowest dark:border dark:border-outline-variant/30',
        isFullscreen && 'rounded-none border-0'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border/60 bg-secondary/30 dark:bg-surface-container dark:border-outline-variant/30">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold dark:text-on-surface dark:font-outfit">{stockName || ticker}</span>
          <div className="flex items-center gap-2" dir="ltr">
            <span className="text-lg font-bold tabular-nums dark:text-on-surface dark:font-financial">{(displayPrice ?? 0).toFixed(3)}</span>
            <span
              className={cn(
                'text-sm font-medium flex items-center gap-0.5 tabular-nums dark:font-financial',
                isPositive ? 'text-primary dark:text-primary' : 'text-rose-400 dark:text-error'
              )}
            >
              {isPositive ? (
                <TrendingUp className="size-3" />
              ) : (
                <TrendingDown className="size-3" />
              )}
              {isPositive ? '+' : ''}
              {(displayChange ?? 0).toFixed(3)} ({isPositive ? '+' : ''}
              {(displayChangePercent ?? 0).toFixed(2)}%)
            </span>
          </div>

          {/* Market Status Chip */}
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border bg-background/50 dark:bg-surface-container dark:border-outline-variant/30">
            {getEGXMarketStatus().isOpen ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse dark:bg-primary" />
                <span className="text-primary dark:text-primary dark:text-primary">مباشر</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-muted-foreground dark:text-on-surface-variant">السوق مغلق</span>
              </>
            )}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleZoomIn}>
            <ZoomIn className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleZoomOut}>
            <ZoomOut className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleFit}>
            <Maximize2 className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleScreenshot}>
            <Camera className="size-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={handleFullscreen}>
            <Maximize2 className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* OHLCV Info Bar */}
      {(hoveredPrice || allData.length > 0) && (
        <div className="flex items-center gap-4 px-4 py-1.5 text-xs border-b border-border/60 bg-secondary/20 dark:bg-surface-container dark:border-outline-variant/30" dir="ltr">
          <span className="text-muted-foreground dark:text-on-surface-variant">{hoveredPrice ? fmtDateLabel(hoveredPrice.date) : 'Latest'}</span>
          <span>O: <span className="font-medium tabular-nums dark:font-financial dark:text-on-surface">{(hoveredPrice?.open || allData[allData.length - 1]?.open || 0).toFixed(3)}</span></span>
          <span>H: <span className="font-medium text-primary tabular-nums dark:font-financial dark:text-primary">{(hoveredPrice?.high || allData[allData.length - 1]?.high || 0).toFixed(3)}</span></span>
          <span>L: <span className="font-medium text-rose-400 tabular-nums dark:font-financial dark:text-error">{(hoveredPrice?.low || allData[allData.length - 1]?.low || 0).toFixed(3)}</span></span>
          <span>C: <span className="font-medium tabular-nums dark:font-financial dark:text-on-surface">{(hoveredPrice?.close || allData[allData.length - 1]?.close || 0).toFixed(3)}</span></span>
          <span>Vol: <span className="font-medium tabular-nums dark:font-financial dark:text-on-surface-variant">{formatVolume(hoveredPrice?.volume || allData[allData.length - 1]?.volume || 0)}</span></span>
        </div>
      )}

      {/* TradingView Top Toolbar: Type, Resolution, Mode toggles */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/60 bg-secondary/20 gap-2 flex-wrap dark:bg-surface-container dark:border-outline-variant/30">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Mode Switch: Native Analysis Chart vs Official TradingView Widget */}
          <div className="flex items-center bg-secondary/70 p-0.5 rounded-md border border-border/60/60 dark:bg-surface-container-high dark:border-outline-variant/30">
            <button
              onClick={() => setChartEngine('interactive')}
              className={cn(
                'px-2.5 py-0.5 rounded text-xs font-semibold transition-all',
                chartEngine === 'interactive'
                  ? 'bg-primary text-primary-foreground shadow-sm dark:bg-primary-container dark:text-on-primary-container'
                  : 'text-muted-foreground hover:text-foreground dark:text-on-surface-variant dark:hover:text-on-surface'
              )}
            >
              شارت التحليل
            </button>
            <button
              onClick={() => setChartEngine('tradingview_widget')}
              className={cn(
                'px-2.5 py-0.5 rounded text-xs font-semibold transition-all flex items-center gap-1',
                chartEngine === 'tradingview_widget'
                  ? 'bg-primary text-primary-foreground shadow-sm dark:bg-primary-container dark:text-on-primary-container'
                  : 'text-muted-foreground hover:text-foreground dark:text-on-surface-variant dark:hover:text-on-surface'
              )}
              title="عرض الرسم البياني المباشر من منصة ترادينج فيو الرسمية"
            >
              <span>TradingView الأصلي</span>
            </button>
          </div>

          <div className="h-4 w-px bg-border hidden sm:block dark:bg-outline-variant" />

          {/* Chart Types — only in interactive mode */}
          {chartEngine === 'interactive' && (
          <div className="flex items-center bg-secondary/70 p-0.5 rounded-md border border-border/60/60 dark:bg-surface-container-high dark:border-outline-variant/30">
            {[
              { key: 'candlestick' as const, label: 'شموع' },
              { key: 'bar' as const, label: 'أعمدة' },
              { key: 'area' as const, label: 'مساحة' },
            ].map((type) => (
              <button
                key={type.key}
                onClick={() => setChartType(type.key)}
                className={cn(
                  'px-2 py-0.5 rounded text-xs font-medium transition-all',
                  chartType === type.key
                    ? 'bg-primary text-primary-foreground shadow-sm dark:bg-primary-container dark:text-on-primary-container'
                    : 'text-muted-foreground hover:text-foreground dark:text-on-surface-variant dark:hover:text-on-surface'
                )}
              >
                {type.label}
              </button>
            ))}
          </div>
          )}

          {/* Resolutions — only in interactive mode */}
          {chartEngine === 'interactive' && (
          <>
          <div className="h-4 w-px bg-border hidden sm:block dark:bg-outline-variant" />

          {/* Resolutions (Candle Intervals) — UI-FIX: added gap-1 for spacing */}
          <div className="flex items-center gap-1 bg-secondary/70 p-0.5 rounded-md border border-border/60/60 dark:bg-surface-container-high dark:border-outline-variant/30">
            <span className="text-[10px] text-muted-foreground px-1 font-semibold hidden md:inline dark:text-on-surface-variant">الفريم:</span>
            {RESOLUTIONS.map((res) => {
              const active = timeframe === res.key;
              return (
                <button
                  key={res.key}
                  onClick={() => handleResolutionChange(res.key)}
                  className={cn(
                    'px-2 py-0.5 rounded text-xs font-medium transition-all flex items-center gap-0.5',
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm font-bold dark:bg-primary-container dark:text-on-primary-container'
                      : 'text-muted-foreground hover:text-foreground dark:text-on-surface-variant dark:hover:text-on-surface'
                  )}
                  title={res.isIntraday ? `شمعة لحظية: ${res.label}` : `شمعة: ${res.label}`}
                >
                  {res.label}
                  {res.isIntraday && (
                    <span className={cn('text-[9px]', active ? 'text-primary-foreground dark:text-on-primary-container' : 'text-primary dark:text-primary')}>
                      ⚡
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          </>
          )}
        </div>

        <div className="flex items-center gap-1.5 mr-auto">
          {/* Focus Mode Toggle */}
          <Button
            variant={focusMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFocusMode((v) => !v)}
            aria-pressed={focusMode}
            title={focusMode ? 'إيقاف وضع التركيز' : 'إخفاء كل المؤشرات الفنية'}
            className="h-7 px-2.5 text-xs gap-1"
          >
            <Eye className="size-3.5" />
            وضع التركيز
          </Button>


        </div>
      </div>

      {/* Indicator Toggles — only in interactive mode */}
      {!focusMode && chartEngine === 'interactive' && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-border/60 bg-secondary/10 flex-wrap dark:bg-surface-container dark:border-outline-variant/30">
          <span className="text-[11px] text-muted-foreground font-medium ml-1 dark:text-on-surface-variant">المؤشرات:</span>
          {[
            { key: 'sma20' as const, label: 'SMA 20', color: SMA20_COLOR },
            { key: 'sma50' as const, label: 'SMA 50', color: SMA50_COLOR },
            { key: 'sma200' as const, label: 'SMA 200', color: SMA200_COLOR },
            { key: 'ema20' as const, label: 'EMA 20', color: EMA20_COLOR },
            { key: 'bollingerBands' as const, label: 'BB', color: BB_COLOR },
            { key: 'volume' as const, label: 'Volume', color: '#64748b' },
            { key: 'rsi' as const, label: 'RSI', color: RSI_COLOR },
            { key: 'macd' as const, label: 'MACD', color: MACD_COLOR },
            { key: 'stochastic' as const, label: 'Stoch', color: STOCH_K_COLOR },
            { key: 'atr' as const, label: 'ATR', color: ATR_COLOR },
            { key: 'obv' as const, label: 'OBV', color: OBV_COLOR },
          ].map((ind) => (
            <button
              key={ind.key}
              onClick={() =>
                setIndicators((prev) => ({ ...prev, [ind.key]: !prev[ind.key] }))
              }
              className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium transition-colors border',
                indicators[ind.key]
                  ? 'bg-primary/15 border-primary/40 text-primary dark:bg-primary-container/20 dark:border-primary-container/40 dark:text-primary'
                  : 'bg-card border border-border/50 border-border/60/60 text-muted-foreground hover:bg-secondary dark:bg-surface-container-high/50 dark:border-outline-variant/30 dark:text-on-surface-variant dark:hover:bg-surface-container-highest'
              )}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: ind.color }}
              />
              {ind.label}
            </button>
          ))}
        </div>
      )}

      {/* Subtle Market Notice if using fallback daily candles */}
      {marketClosed && dataSource === 'fallback_daily' && (
        <div
          role="status"
          className="flex items-center justify-between px-3 py-1 border-b border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs"
        >
          <div className="flex items-center gap-1.5">
            <Clock className="size-3.5 shrink-0" />
            <span>السوق مغلق حالياً — تم عرض أحدث شموع يومية متوفرة</span>
          </div>
          <span className="text-[10px] opacity-75 hidden sm:inline">جلسة التداول: 10:00 ص - 2:30 م</span>
        </div>
      )}

      {/* Chart Container / TradingView Widget */}
      {chartEngine === 'tradingview_widget' ? (
        <div
          className="w-full relative bg-card border border-border overflow-hidden dark:bg-surface-container-low"
          style={{ height: isFullscreen ? 'calc(100vh - 150px)' : `${height}px` }}
        >
          <iframe
            src={`https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent(
              tvSymbol
            )}&interval=${tvInterval}&theme=${
              resolvedTheme === 'dark' ? 'dark' : 'light'
            }&style=1&timezone=Africa%2FCairo&locale=ar_AE&enable_publishing=false&allow_symbol_change=1&save_image=1&hide_side_toolbar=0&utm_source=invist.m2y.net`}
            className="w-full h-full border-0"
            title={`TradingView ${ticker}`}
            allowFullScreen
          />
        </div>
      ) : (
        <div
          ref={containerRef}
          className="w-full"
          style={{ height: isFullscreen ? 'calc(100vh - 150px)' : `${height}px` }}
        />
      )}

      {/* TradingView Bottom Range Bar (شريط النطاق الزمني السريع) */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-border/60 bg-secondary/20 text-xs select-none dark:bg-surface-container dark:border-outline-variant/30">
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground ml-1 font-medium dark:text-on-surface-variant">النطاق:</span>
          {RANGES.map((r) => {
            const active = currentRange === r.key;
            return (
              <button
                key={r.key}
                onClick={() => handleRangeChange(r.key)}
                className={cn(
                  'px-2 py-0.5 rounded text-xs font-semibold transition-all',
                  active
                    ? 'bg-primary text-primary-foreground shadow-sm dark:bg-primary-container dark:text-on-primary-container'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60 dark:text-on-surface-variant dark:hover:text-on-surface dark:hover:bg-surface-container-high'
                )}
              >
                {r.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground dark:text-on-surface-variant" dir="ltr">
          <span>{data.length} candles</span>
          <span className="text-border dark:text-outline-variant">|</span>
          <span className="flex items-center gap-1.5">
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                dataSource.includes('intraday') ? 'bg-emerald-500 dark:bg-primary' : 'bg-blue-500'
              )}
            />
            {dataSource.includes('intraday')
              ? `Intraday (${timeframe})`
              : timeframe === '1W'
              ? 'Weekly History'
              : 'Daily History'}
            {dataSource && (
              <span className="text-[9px] opacity-60">({dataSource})</span>
            )}
          </span>
        </div>
      </div>


    </div>
  );
}
