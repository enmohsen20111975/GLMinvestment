'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useTheme } from 'next-themes';
import {
  createChart,
  ColorType,
  CrosshairMode,
  LineStyle,
  type IChartApi,
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
import {
  computeMultiPersonaScenarios,
  type PersonaScenario,
} from '@/lib/persona-dynamic';
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
  Users,
} from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface TradingViewChartProps {
  ticker: string;
  stockName?: string;
  height?: number;
}

interface OhlcvBar {
  date: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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

const UP_COLOR = '#26a69a';      // TradingView green
const DOWN_COLOR = '#ef5350';    // TradingView red
const VOLUME_UP = 'rgba(38, 166, 154, 0.5)';
const VOLUME_DOWN = 'rgba(239, 83, 80, 0.5)';

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

const TIMEFRAMES = [
  { key: '5m', label: '5\u062f', days: 0, isIntraday: true, period: '1w' },
  { key: '15m', label: '15\u062f', days: 0, isIntraday: true, period: '1w' },
  { key: '1h', label: '1\u0633', days: 0, isIntraday: true, period: '1w' },
  { key: '1W', label: '1W', days: 7, isIntraday: false },
  { key: '1M', label: '1M', days: 30, isIntraday: false },
  { key: '3M', label: '3M', days: 90, isIntraday: false },
  { key: '6M', label: '6M', days: 180, isIntraday: false },
  { key: '1Y', label: '1Y', days: 365, isIntraday: false },
  { key: 'ALL', label: 'ALL', days: 9999, isIntraday: false },
];

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

function calcRSI(data: number[], period: number = 14): (number | null)[] {
  const result: (number | null)[] = [];
  const changes: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    changes.push(data[i] - data[i - 1]);
  }
  
  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      result.push(null);
      continue;
    }
    
    let gainSum = 0;
    let lossSum = 0;
    
    for (let j = i - period; j < i; j++) {
      const change = changes[j] || 0;
      if (change > 0) gainSum += change;
      else lossSum += Math.abs(change);
    }
    
    const avgGain = gainSum / period;
    const avgLoss = lossSum / period;
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const rsi = 100 - (100 / (1 + rs));
    result.push(rsi);
  }
  
  return result;
}

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
      histogram[i] = macd[i] - (signalRaw[signalIdx] || 0);
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

function normalizeDate(dateStr: string | number): string {
  // Handle UNIX timestamp (number)
  if (typeof dateStr === 'number') {
    const ts = dateStr > 1e11 ? dateStr : dateStr * 1000;
    const date = new Date(ts);
    if (!date || isNaN(date.getTime())) return String(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    const hours = date.getHours();
    const minutes = date.getMinutes();
    if (hours === 0 && minutes === 0) return `${day}/${month}/${year}`;
    return `${day}/${month} ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
  // Original string handling below
  const timeVal = dateStr;
  if (!dateStr) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if (/^\d{8}$/.test(dateStr)) {
    return `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`;
  }
  const d = new Date(dateStr);
  if (!isNaN(d.getTime())) {
    return d.toISOString().split('T')[0];
  }
  return '';
}

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
    return `${day}/${month}/${year}`;
  }

  const hours = date.getHours();
  const minutes = date.getMinutes();

  if (hours === 0 && minutes === 0) {
    return `${day}/${month}/${year}`;
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
function barTime(b: OhlcvBar): Time {
  const d = b.date as unknown;
  if (typeof d === 'number' && isFinite(d) && d > 0) {
    return (d > 1e12 ? Math.floor(d / 1000) : Math.floor(d)) as Time;
  }
  const s = String(d ?? '').trim();
  if (!s) return Math.floor(Date.now() / 1000) as Time;
  const asNum = Number(s);
  if (!isNaN(asNum) && /^\d+(\.\d+)?$/.test(s) && asNum > 0) {
    return (asNum > 1e12 ? Math.floor(asNum / 1000) : Math.floor(asNum)) as Time;
  }
  // 'yyyy-mm-dd' (daily) — lightweight-charts accepts this string as BusinessDay
  if (s.length === 10 && s[4] === '-' && s[7] === '-') return s as Time;
  // 'dd/MM/yyyy' (daily, normalized by normalizeDate)
  if (s.length === 10 && s[2] === '/' && s[5] === '/') {
    const [dd, mm, yyyy] = s.split('/').map(Number);
    const dt = new Date(Date.UTC(yyyy, mm - 1, dd));
    if (!isNaN(dt.getTime())) return Math.floor(dt.getTime() / 1000) as Time;
  }
  // Intraday: 'dd/MM HH:mm' or 'dd/MM/yyyy HH:mm'
  if (s.includes('/')) {
    const parts = s.split(' ');
    const dp = parts[0].split('/');
    const tp = parts[1] ? parts[1].split(':') : ['0', '0'];
    const now = new Date();
    const day = parseInt(dp[0], 10) || 1;
    const month = (parseInt(dp[1], 10) || 1) - 1;
    const year = dp[2] ? parseInt(dp[2], 10) : now.getFullYear();
    const hours = parseInt(tp[0], 10) || 0;
    const mins = parseInt(tp[1], 10) || 0;
    const dt = new Date(Date.UTC(year, month, day, hours, mins));
    if (!isNaN(dt.getTime())) return Math.floor(dt.getTime() / 1000) as Time;
  }
  const parsed = Date.parse(s.replace(' ', 'T'));
  if (!isNaN(parsed)) return Math.floor(parsed / 1000) as Time;
  return Math.floor(Date.now() / 1000) as Time;
}

function sanitizeOhlcBar(bar: OhlcvBar): OhlcvBar | null {
  const date = normalizeDate(bar.date);
  if (!date) return null;
  const open = Number(bar.open);
  const high = Number(bar.high);
  const low = Number(bar.low);
  const close = Number(bar.close);
  if ([open, high, low, close].some((v) => !Number.isFinite(v))) return null;
  if (open <= 0 || high <= 0 || low <= 0 || close <= 0) return null;
  if (high < Math.max(open, low, close)) return null;
  if (low > Math.min(open, high, close)) return null;
  return {
    ...bar,
    date,
    open,
    high,
    low,
    close,
    volume: Number.isFinite(Number(bar.volume)) ? Number(bar.volume) : 0,
  };
}

// P39-PHASE-3: Multi-Persona Dynamic Card — three scenarios on the same chart
// -----------------------------------------------------------------------------
// Renders 🛡️ المستثمر / ⚖️ المتوازن / 🔥 المضارب side-by-side using the shared
// math library `computeMultiPersonaScenarios`. The user can override any input
// (entry, ATR, regime, portfolio net worth, asset weight) and the three cards
// recompute live via useMemo. Clicking a card updates the global active persona
// in the store (with mapping aggressive → gambler for v2 compatibility) and
// shows a sonner toast.
function MultiPersonaDynamicCard({
  ticker,
  currentPrice,
  candles,
}: {
  ticker: string;
  currentPrice: number;
  candles: OhlcvBar[];
}) {
  const persona = useAppStore((s) => s.persona);
  const setPersona = useAppStore((s) => s.setPersona);
  const v2Regime = useAppStore((s) => s.v2Data?.market?.regime);

  // ATR(14) auto-estimate from recent OHLC (last 50 bars). Fallback = entry*0.03.
  const autoAtr = useMemo<number | null>(() => {
    const n = candles.length;
    if (n < 15) return null;
    const slice = candles.slice(Math.max(0, n - 50));
    const trs: number[] = [];
    for (let i = 1; i < slice.length; i++) {
      const h = slice[i].high - slice[i].low;
      const hc = Math.abs(slice[i].high - slice[i - 1].close);
      const lc = Math.abs(slice[i].low - slice[i - 1].close);
      trs.push(Math.max(h, hc, lc));
    }
    if (trs.length < 14) return null;
    const last14 = trs.slice(-14);
    return last14.reduce((a, b) => a + b, 0) / 14;
  }, [candles]);

  const defaultEntry =
    currentPrice > 0
      ? currentPrice
      : candles.length > 0
        ? candles[candles.length - 1].close
        : 0;

  const [entryInput, setEntryInput] = useState<string>(
    defaultEntry > 0 ? String(defaultEntry.toFixed(3)) : '',
  );
  const [atrInput, setAtrInput] = useState<string>('');
  const [autoAtrEnabled, setAutoAtrEnabled] = useState<boolean>(true);
  const [regime, setRegime] = useState<'bull' | 'bear' | 'neutral'>(
    (v2Regime as 'bull' | 'bear' | 'neutral') || 'neutral',
  );
  const [portfolioNetWorthEGP, setPortfolioNetWorthEGP] = useState<number>(100000);
  const [portfolioLoaded, setPortfolioLoaded] = useState(false);
  const [assetWeightPct, setAssetWeightPct] = useState<number>(10);

  // Fetch portfolio net worth once on mount (default 100000 on failure)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/finance/calculate-values', { cache: 'no-store' });
        if (res.ok) {
          const j = await res.json();
          const v =
            j?.net_worth_egp ??
            j?.total_net_worth_egp ??
            j?.total_egp ??
            null;
          if (!cancelled && typeof v === 'number' && v > 0) {
            setPortfolioNetWorthEGP(v);
          }
        }
      } catch {
        // keep default 100000
      } finally {
        if (!cancelled) setPortfolioLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const entry = useMemo(() => {
    const parsed = parseFloat(entryInput);
    return isNaN(parsed) || parsed <= 0 ? defaultEntry : parsed;
  }, [entryInput, defaultEntry]);

  const atr = useMemo(() => {
    if (autoAtrEnabled) {
      return autoAtr ?? entry * 0.03;
    }
    const parsed = parseFloat(atrInput);
    return isNaN(parsed) || parsed < 0
      ? (autoAtr ?? entry * 0.03)
      : parsed;
  }, [atrInput, autoAtrEnabled, autoAtr, entry]);

  const scenarios = useMemo<PersonaScenario[]>(() => {
    if (entry <= 0) return [];
    return computeMultiPersonaScenarios(
      entry,
      atr,
      regime,
      portfolioNetWorthEGP,
      Math.max(0, Math.min(1, assetWeightPct / 100)),
    );
  }, [entry, atr, regime, portfolioNetWorthEGP, assetWeightPct]);

  const activePersonaVector: 'conservative' | 'balanced' | 'aggressive' =
    persona === 'conservative'
      ? 'conservative'
      : persona === 'gambler' || persona === 'aggressive'
        ? 'aggressive'
        : 'balanced';

  const arNum = new Intl.NumberFormat('ar-EG');
  const arNum3 = new Intl.NumberFormat('ar-EG', { maximumFractionDigits: 3 });

  const handleCardClick = (s: PersonaScenario) => {
    const personaToSet = s.persona === 'aggressive' ? 'gambler' : s.persona;
    setPersona(personaToSet);
    toast.success(`تم تغيير الشخصية إلى ${s.emoji} ${s.labelAr}`);
  };

  return (
    <Card dir="rtl" className="rounded-none border-x-0 border-b-0 border-t bg-muted/5">
      <CardContent className="px-4 py-3">
        <div className="mb-3 flex items-center gap-2 flex-wrap">
          <Users className="size-4 text-primary" />
          <span className="text-sm font-bold">بطاقة الشخصيات الديناميكية</span>
          <Badge variant="secondary" className="text-[10px]">{ticker}</Badge>
          {!portfolioLoaded && (
            <span className="text-[10px] text-muted-foreground">… جارٍ تحميل صافي المحفظة</span>
          )}
        </div>

        {/* Inputs */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-3">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">سعر الدخول</Label>
            <Input
              type="number"
              dir="ltr"
              value={entryInput}
              onChange={(e) => setEntryInput(e.target.value)}
              placeholder={defaultEntry > 0 ? defaultEntry.toFixed(3) : '0'}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] text-muted-foreground">
                ATR {autoAtr ? `(تلقائي: ${autoAtr.toFixed(3)})` : '(تلقائي: —)'}
              </Label>
              <div className="flex items-center gap-1">
                <Label className="text-[9px] text-muted-foreground">تلقائي</Label>
                <Switch
                  checked={autoAtrEnabled}
                  onCheckedChange={setAutoAtrEnabled}
                  className="scale-75 origin-right"
                  aria-label="تفعيل ATR التلقائي"
                />
              </div>
            </div>
            <Input
              type="number"
              dir="ltr"
              value={atrInput}
              disabled={autoAtrEnabled}
              onChange={(e) => setAtrInput(e.target.value)}
              placeholder={autoAtr ? autoAtr.toFixed(3) : (entry * 0.03).toFixed(3)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">حالة السوق</Label>
            <Select
              value={regime}
              onValueChange={(v) => setRegime(v as 'bull' | 'bear' | 'neutral')}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="neutral">⚖️ محايد</SelectItem>
                <SelectItem value="bull">🐂 صاعد</SelectItem>
                <SelectItem value="bear">🐻 هابط</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">صافي المحفظة (ج.م)</Label>
            <Input
              type="number"
              dir="ltr"
              value={portfolioNetWorthEGP}
              onChange={(e) => setPortfolioNetWorthEGP(parseFloat(e.target.value) || 0)}
              className="h-8 text-xs"
            />
          </div>
          <div className="space-y-1 col-span-2 md:col-span-1">
            <Label className="text-[10px] text-muted-foreground">
              وزن الأصل: {assetWeightPct}%
            </Label>
            <Slider
              min={1}
              max={30}
              step={1}
              value={[assetWeightPct]}
              onValueChange={(v) => setAssetWeightPct(v[0] ?? 10)}
              className="mt-2"
            />
          </div>
        </div>

        {/* Three side-by-side scenario cards */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
          {scenarios.map((s) => {
            const isActive = s.persona === activePersonaVector;
            return (
              <button
                key={s.persona}
                type="button"
                onClick={() => handleCardClick(s)}
                className={cn(
                  'text-right rounded-lg border bg-card p-3 transition-all hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                  isActive ? 'ring-2 ring-primary border-primary' : 'border-border',
                )}
                style={isActive ? { borderColor: s.color, boxShadow: `0 0 0 1px ${s.color}` } : undefined}
                aria-pressed={isActive}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">{s.emoji}</span>
                    <span className="text-sm font-bold" style={{ color: s.color }}>
                      {s.labelAr}
                    </span>
                  </div>
                  {isActive && (
                    <Badge className="text-[10px] h-5 px-1.5">نشط</Badge>
                  )}
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">وقف الخسارة</span>
                    <span className="font-medium text-red-500" dir="ltr">
                      {arNum3.format(s.stopLoss)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">الهدف</span>
                    <span className="font-medium text-emerald-500" dir="ltr">
                      {arNum3.format(s.targetProfit)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">مخاطرة/عائد</span>
                    <span className="font-medium" dir="ltr">
                      {arNum3.format(s.riskRewardRatio)}:1
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">أقصى عدد أسهم</span>
                    <span className="font-medium" dir="ltr">
                      {arNum.format(s.maxPositionShares)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">قيمة المركز (ج.م)</span>
                    <span className="font-medium" dir="ltr">
                      {arNum.format(Math.round(s.maxPositionValueEGP))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">أقصى مخاطرة</span>
                    <span className="font-medium" dir="ltr">{s.personaMaxRiskPct}%</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
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

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allData, setAllData] = useState<OhlcvBar[]>([]);
  const [lastPrice, setLastPrice] = useState<{ price: number; change: number; changePercent: number } | null>(null);
  const [hoveredPrice, setHoveredPrice] = useState<OhlcvBar | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [timeframe, setTimeframe] = useState<string>('1Y');
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

  // P37-PHASE-1: Market-closed banner (intraday fetch fell back to daily history)
  const [marketClosed, setMarketClosed] = useState(false);
  // P37-PHASE-1: Focus Mode — hide all secondary indicators, keep main + volume only
  const [focusMode, setFocusMode] = useState(false);
  // P39-PHASE-3: Multi-Persona Dynamic Card visibility toggle (default hidden)
  const [multiPersonaOpen, setMultiPersonaOpen] = useState(false);

  // ─── Fetch Data ────────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    // BRIEF-049: re-fetch when timeframe changes (5m/15m/1h need different API)
    void timeframe;

    async function fetchData() {
      setIsLoading(true);
      setError(null);
      setMarketClosed(false); // P37-PHASE-1: reset market-closed banner each fetch

      try {
        // BRIEF-049: For intraday timeframes (5m/15m/1h), fetch from /api/chart/[ticker]
        // which reads from intraday.db (5-min snapshots) and resamples
        const tfConfig = TIMEFRAMES.find((t) => t.key === timeframe);
        const isIntraday = tfConfig?.isIntraday === true;

        let json: any;
        let usedMarketClosedFallback = false;

        if (isIntraday) {
          // P37-PHASE-1: Try intraday first. On failure or empty data (EGX closed
          // Fri/Sat, holidays, or upstream error), fall back to the latest 30
          // daily candles so the chart still shows something useful and surface
          // the "market closed" banner to the user.
          const period = tfConfig?.period || '1d';
          let intradayOk = false;
          try {
            const intradayRes = await fetch(`/api/chart/${ticker}?period=${period}&asset=stock&_t=${Date.now()}`);
            if (intradayRes.ok) {
              const intradayJson = await intradayRes.json();
              if (intradayJson.success && (intradayJson.data || []).length > 0) {
                json = intradayJson;
                intradayOk = true;
              }
            }
          } catch {
            // swallow — fall through to daily-history fallback below
          }
          if (!intradayOk) {
            const dailyRes = await fetch(`/api/stocks/${ticker}/history?days=30`);
            if (!dailyRes.ok) throw new Error(`HTTP ${dailyRes.status}`);
            json = await dailyRes.json();
            usedMarketClosedFallback = true;
          }
        } else {
          // Fetch daily history
          const res = await fetch(`/api/stocks/${ticker}/history?days=9999`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          json = await res.json();
        }

        if (!cancelled) {
          // BRIEF-049: Handle both intraday (data array) and daily (data array) formats
          const rawData = json.data || [];
          if (json.success && rawData.length > 0) {
            const sortedData = [...rawData]
              .sort((a, b) => {
                const getTime = (d: any) => {
                  if (typeof d === 'number') return d > 1e11 ? d : d * 1000;
                  const parsed = new Date(d).getTime();
                  return isNaN(parsed) ? 0 : parsed;
                };
                return getTime(a.date) - getTime(b.date);
              })
              .map(sanitizeOhlcBar)
              .filter((bar): bar is OhlcvBar => bar !== null);
            setAllData(sortedData);

            // P37-PHASE-1: surface the "market closed" banner when we fell back
            // from intraday to daily history.
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
            throw new Error(json.error || 'No historical data available');
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load chart data');
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    fetchData();

    // NO AUTO-POLLING - السوق مقفول و مفيش حاجة تتحرك
    // البيانات بتتجيب مرة واحدة لما المستخدم يختار سهم أو يضغط Refresh
    // لو السوق فاتح، المستخدم يضغط زرار Refresh بنفسه

    return () => {
      cancelled = true;
    };
  }, [ticker, timeframe]);

  // ─── Filter data by timeframe ────────────────────────────────────────────────

  const data = React.useMemo(() => {
    if (allData.length === 0) return [];
    const tf = TIMEFRAMES.find((t) => t.key === timeframe);
    if (!tf) return allData;
    // BRIEF-049: Intraday timeframes return all data (already filtered by API)
    if (tf.isIntraday || tf.days >= 9999) return allData;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - tf.days);
    return allData.filter((b) => new Date(b.date) >= cutoff);
  }, [allData, timeframe]);

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
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
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
        tickMarkFormatter: (time: any) => safeFormatTime(time),
      },
      localization: {
        timeFormatter: (time: any) => safeFormatTime(time),
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

    // ─── Main Price Series ─────────────────────────────────────────────────

    const closes = data.map((bar) => bar.close);
    const highs = data.map((bar) => bar.high);
    const lows = data.map((bar) => bar.low);
    const volumes = data.map((bar) => bar.volume);

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
        const candleData = data.map((bar) => ({
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

        const barData = data.map((bar) => ({
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

        const areaData = data.map((bar) => ({
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

      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: hasOscillator ? 0.85 : 0.85, bottom: 0 },
      });

      const volumeData = data.map((bar) => ({
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
        lineWidth: 1.5,
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
        color: '#ef5350',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: 'OB',
        priceScaleId: oscScaleId,
      });
      obLine.setData(data.map(bar => ({ time: barTime(bar), value: 70 })));

      const osLine = chart.addSeries(LineSeries, {
        color: '#26a69a',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        title: 'OS',
        priceScaleId: oscScaleId,
      });
      osLine.setData(data.map(bar => ({ time: barTime(bar), value: 30 })));
    }

    // MACD
    if (effectiveIndicators.macd) {
      const { macd, signal, histogram } = calcMACD(closes);
      
      const macdLine = chart.addSeries(LineSeries, {
        color: MACD_COLOR,
        lineWidth: 1.5,
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
        lineWidth: 1.5,
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
            time: barTime(data[i]),
            value,
            color: value >= 0 ? '#26a69a' : '#ef5350',
          };
        }).filter(Boolean) as { time: Time; value: number; color?: string }[]
      );
    }

    // Stochastic
    if (effectiveIndicators.stochastic) {
      const { k, d } = calcStochastic(highs, lows, closes);
      
      const kLine = chart.addSeries(LineSeries, {
        color: STOCH_K_COLOR,
        lineWidth: 1.5,
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
        lineWidth: 1.5,
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
        lineWidth: 1.5,
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
        lineWidth: 1.5,
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

    // Fit content
    chart.timeScale().fitContent();

    // Cleanup on unmount
    return () => {
      chart.remove();
      chartRef.current = null;
    };
  }, [data, indicators, focusMode, height, isFullscreen, isDark, chartType]);

  // ─── Controls ──────────────────────────────────────────────────────────────

  const handleZoomIn = useCallback(() => {
    chartRef.current?.timeScale().scrollToRealTime();
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
    chartRef.current?.timeScale().fitContent();
  }, []);

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
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
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
      <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center justify-center min-h-[400px]">
        <RotateCcw className="size-10 text-muted-foreground mb-4" />
        <p className="text-sm font-medium text-destructive mb-2">خطأ في تحميل الشارت</p>
        <p className="text-xs text-muted-foreground mb-4">{error}</p>
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
      <div className="rounded-xl border border-border bg-card p-8 flex flex-col items-center justify-center min-h-[400px]">
        <p className="text-sm font-medium text-muted-foreground">
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
        'rounded-xl border border-border bg-card overflow-hidden',
        isFullscreen && 'rounded-none border-0'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-4">
          <span className="text-sm font-semibold">{stockName || ticker}</span>
          <div className="flex items-center gap-2" dir="ltr">
            <span className="text-lg font-bold">{displayPrice.toFixed(3)}</span>
            <span
              className={cn(
                'text-sm font-medium flex items-center gap-0.5',
                isPositive ? 'text-emerald-500' : 'text-red-500'
              )}
            >
              {isPositive ? (
                <TrendingUp className="size-3" />
              ) : (
                <TrendingDown className="size-3" />
              )}
              {isPositive ? '+' : ''}
              {displayChange.toFixed(3)} ({isPositive ? '+' : ''}
              {displayChangePercent.toFixed(2)}%)
            </span>
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
        <div className="flex items-center gap-4 px-4 py-1.5 text-xs border-b border-border bg-muted/20" dir="ltr">
          <span className="text-muted-foreground">{hoveredPrice ? fmtDateLabel(hoveredPrice.date) : 'Latest'}</span>
          <span>O: <span className="font-medium">{(hoveredPrice?.open || allData[allData.length - 1]?.open || 0).toFixed(3)}</span></span>
          <span>H: <span className="font-medium text-emerald-500">{(hoveredPrice?.high || allData[allData.length - 1]?.high || 0).toFixed(3)}</span></span>
          <span>L: <span className="font-medium text-red-500">{(hoveredPrice?.low || allData[allData.length - 1]?.low || 0).toFixed(3)}</span></span>
          <span>C: <span className="font-medium">{(hoveredPrice?.close || allData[allData.length - 1]?.close || 0).toFixed(3)}</span></span>
          <span>Vol: <span className="font-medium">{formatVolume(hoveredPrice?.volume || allData[allData.length - 1]?.volume || 0)}</span></span>
        </div>
      )}

      {/* Chart Type Selection */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-muted/5">
        <span className="text-xs text-muted-foreground font-medium ml-2">النوع:</span>
        {[
          { key: 'candlestick' as const, label: 'شموع' },
          { key: 'bar' as const, label: 'أعمدة' },
          { key: 'area' as const, label: 'مساحة' },
        ].map((type) => (
          <button
            key={type.key}
            onClick={() => setChartType(type.key)}
            className={cn(
              'px-2 py-1 rounded text-xs font-medium transition-colors',
              chartType === type.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {type.label}
          </button>
        ))}
      </div>

      {/* Timeframe Selection */}
      <div className="flex items-center gap-1 px-4 py-2 border-b border-border bg-muted/5 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium ml-2">الفترة:</span>
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf.key}
            onClick={() => setTimeframe(tf.key)}
            className={cn(
              'px-2 py-1 rounded text-xs font-medium transition-colors',
              timeframe === tf.key
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            {tf.label}
          </button>
        ))}

        {/* P37-PHASE-1: Focus Mode Toggle (mobile-friendly) */}
        <Button
          variant={focusMode ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFocusMode((v) => !v)}
          aria-pressed={focusMode}
          title={focusMode ? 'إيقاف وضع التركيز' : 'إخفاء كل المؤشرات الفنية'}
          className="ms-auto h-7 px-2.5 text-xs gap-1 shrink-0"
        >
          <Eye className="size-3.5" />
          وضع التركيز
        </Button>

        {/* P39-PHASE-3: Multi-Persona Dynamic Card Toggle */}
        <Button
          variant={multiPersonaOpen ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMultiPersonaOpen((v) => !v)}
          aria-pressed={multiPersonaOpen}
          title={multiPersonaOpen ? 'إخفاء بطاقة الشخصيات' : 'إظهار بطاقة الشخصيات الديناميكية'}
          className="h-7 px-2.5 text-xs gap-1 shrink-0"
        >
          <Users className="size-3.5" />
          شخصيات متعددة
        </Button>
      </div>

      {/* Indicator Toggles */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border bg-muted/10 flex-wrap">
        <span className="text-xs text-muted-foreground font-medium">المؤشرات:</span>
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
              'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
              indicators[ind.key]
                ? 'bg-primary/20 text-primary'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: ind.color }}
            />
            {ind.label}
          </button>
        ))}
      </div>

      {/* P37-PHASE-1: Market Closed Banner */}
      {marketClosed && (
        <div
          role="status"
          className="flex items-center gap-2 px-4 py-2 border-b border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        >
          <Clock className="size-4 shrink-0" />
          <span className="text-xs font-medium">
            السوق مغلق - عرض أحدث بيانات متوفرة
          </span>
        </div>
      )}

      {/* Chart Container */}
      <div ref={containerRef} className="w-full" style={{ height: isFullscreen ? 'calc(100vh - 150px)' : `${height}px` }} />

      {/* P39-PHASE-3: Multi-Persona Dynamic Card — three scenarios on the same chart */}
      {multiPersonaOpen && (
        <MultiPersonaDynamicCard
          ticker={ticker}
          currentPrice={lastPrice?.price || 0}
          candles={data}
        />
      )}
    </div>
  );
}
