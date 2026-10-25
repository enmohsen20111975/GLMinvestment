/**
 * Premium Chart — Types
 * =====================================================================
 *
 * الأنواع المشتركة لمكون الشارت المتميز. تشمل:
 * - بيانات الشموع (ChartData)
 * - بيانات المؤشرات (IndicatorData)
 * - خطة التداول (TradePlan)
 * - الرسومات التفاعلية (Drawing, Tool, ToolType)
 * - إعدادات المظهر (ChartTheme)
 *
 * تصميم نظيف وقابل للتوسيع — كل أداة رسم لها نوع مخصص.
 */

import type { Time, LineStyle } from 'lightweight-charts';

// ─── Chart Data ──────────────────────────────────────────────────────────────

export interface ChartData {
  time: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorData {
  time: string | number;
  value: number | null;
}

export interface CandleWithIndicators {
  ohlcv: ChartData[];
  indicators?: {
    sma20?: IndicatorData[];
    sma50?: IndicatorData[];
    sma200?: IndicatorData[];
    ema9?: IndicatorData[];
    ema21?: IndicatorData[];
    bb_upper?: IndicatorData[];
    bb_middle?: IndicatorData[];
    bb_lower?: IndicatorData[];
    rsi?: IndicatorData[];
    macd?: IndicatorData[];
    macd_signal?: IndicatorData[];
    macd_histogram?: IndicatorData[];
    obv?: IndicatorData[];
    cmf?: IndicatorData[];
  };
}

// ─── Trade Plan (Entry/Stop/Targets) ─────────────────────────────────────────

export interface TradePlan {
  entry?: number | null;
  stop?: number | null;
  target1?: number | null;
  target2?: number | null;
  target3?: number | null;
  riskReward?: number | null;
}

// ─── SMC (Smart Money Concepts) ──────────────────────────────────────────────

export interface SMCData {
  order_blocks?: Array<{
    type: 'bullish' | 'bearish';
    top: number;
    bottom: number;
    time?: number;
  }>;
  fvgs?: Array<{
    type: 'bullish' | 'bearish';
    top: number;
    bottom: number;
    time?: number;
  }>;
  sweeps?: Array<{
    type: 'bullish' | 'bearish';
    level: number;
    time?: number;
  }>;
  score?: number;
  signals?: string[];
}

// ─── Drawing Tools ──────────────────────────────────────────────────────────

export type ToolType =
  | 'none'
  | 'cursor'
  | 'trendline'
  | 'hline'
  | 'vline'
  | 'rectangle'
  | 'fib'
  | 'brush'
  | 'text'
  | 'arrow'
  | 'measure';

export type DrawingColor =
  | '#ef5350' // red
  | '#26a69a' // green
  | '#2196f3' // blue
  | '#ff9800' // orange
  | '#9c27b0' // purple
  | '#f0b90b' // gold
  | '#ffffff' // white
  | '#78909c'; // gray

export type LineWidth = 1 | 2 | 3 | 4;

export type LineStyleName = 'solid' | 'dashed' | 'dotted' | 'large_dashed';

/** نقطة على الشارت بإحداثيات time/price (تنظّم مع zoom/pan تلقائياً) */
export interface ChartPoint {
  time: number; // unix seconds
  price: number;
}

/** رسم خط الاتجاه */
export interface TrendlineDrawing {
  id: string;
  type: 'trendline';
  points: [ChartPoint, ChartPoint];
  color: DrawingColor;
  width: LineWidth;
  style: LineStyleName;
  extendLeft: boolean;
  extendRight: boolean;
  showLabel: boolean;
  label?: string;
}

/** خط أفقي (مستوى سعر) */
export interface HLineDrawing {
  id: string;
  type: 'hline';
  point: ChartPoint; // time هنا مش مهم — بس price
  color: DrawingColor;
  width: LineWidth;
  style: LineStyleName;
  label?: string;
}

/** خط رأسي (مستوى زمني) */
export interface VLineDrawing {
  id: string;
  type: 'vline';
  point: ChartPoint; // price هنا مش مهم — بس time
  color: DrawingColor;
  width: LineWidth;
  style: LineStyleName;
  label?: string;
}

/** مستطيل (منطقة دعم/مقاومة) */
export interface RectangleDrawing {
  id: string;
  type: 'rectangle';
  points: [ChartPoint, ChartPoint];
  color: DrawingColor;
  width: LineWidth;
  fillOpacity: number; // 0-1
  fillEnabled: boolean;
  label?: string;
}

/** فيبوناتشي retracement */
export interface FibDrawing {
  id: string;
  type: 'fib';
  points: [ChartPoint, ChartPoint]; // [high, low]
  color: DrawingColor;
  width: LineWidth;
  levels: number[]; // افتراضي [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
  showLabels: boolean;
}

/** فرشاة (رسم حر) */
export interface BrushDrawing {
  id: string;
  type: 'brush';
  points: ChartPoint[];
  color: DrawingColor;
  width: LineWidth;
}

/** نص (ملاحظة) */
export interface TextDrawing {
  id: string;
  type: 'text';
  point: ChartPoint;
  text: string;
  color: DrawingColor;
  fontSize: number;
  background?: DrawingColor;
}

/** سهم */
export interface ArrowDrawing {
  id: string;
  type: 'arrow';
  points: [ChartPoint, ChartPoint];
  color: DrawingColor;
  width: LineWidth;
  label?: string;
}

/** قياس (مسافة + نسبة بين نقطتين) */
export interface MeasureDrawing {
  id: string;
  type: 'measure';
  points: [ChartPoint, ChartPoint];
  color: DrawingColor;
}

export type Drawing =
  | TrendlineDrawing
  | HLineDrawing
  | VLineDrawing
  | RectangleDrawing
  | FibDrawing
  | BrushDrawing
  | TextDrawing
  | ArrowDrawing
  | MeasureDrawing;

export type DrawingTool = Exclude<ToolType, 'none' | 'cursor'>;

// ─── Chart Theme ─────────────────────────────────────────────────────────────

export interface ChartTheme {
  background: string;
  textColor: string;
  gridColor: string;
  borderColor: string;
  upColor: string;
  downColor: string;
  sma20Color: string;
  sma50Color: string;
  sma200Color: string;
  ema9Color: string;
  ema21Color: string;
  bbColor: string;
  rsiColor: string;
  macdLineColor: string;
  macdSignalColor: string;
  macdHistPosColor: string;
  macdHistNegColor: string;
  obvColor: string;
  cmfColor: string;
  fibColor: string;
}

export const DARK_THEME: ChartTheme = {
  background: '#131722',
  textColor: '#d1d4dc',
  gridColor: '#1e222d',
  borderColor: '#363c4e',
  upColor: '#26a69a',
  downColor: '#ef5350',
  sma20Color: '#f0b90b',
  sma50Color: '#ff9800',
  sma200Color: '#2196f3',
  ema9Color: '#ff6b6b',
  ema21Color: '#4ecdc4',
  bbColor: '#607d8b',
  rsiColor: '#e040fb',
  macdLineColor: '#2196f3',
  macdSignalColor: '#ff6b6b',
  macdHistPosColor: '#26a69a',
  macdHistNegColor: '#ef5350',
  obvColor: '#ab47bc',
  cmfColor: '#00bcd4',
  fibColor: '#ffd700',
};

export const LIGHT_THEME: ChartTheme = {
  background: '#ffffff',
  textColor: '#131722',
  gridColor: '#e0e3eb',
  borderColor: '#bcc4d4',
  upColor: '#26a69a',
  downColor: '#ef5350',
  sma20Color: '#f0b90b',
  sma50Color: '#ff9800',
  sma200Color: '#2196f3',
  ema9Color: '#ff6b6b',
  ema21Color: '#4ecdc4',
  bbColor: '#607d8b',
  rsiColor: '#9c27b0',
  macdLineColor: '#2196f3',
  macdSignalColor: '#ff6b6b',
  macdHistPosColor: '#26a69a',
  macdHistNegColor: '#ef5350',
  obvColor: '#ab47bc',
  cmfColor: '#00bcd4',
  fibColor: '#ff9800',
};

// ─── PremiumChart Props ──────────────────────────────────────────────────────

export interface PremiumChartProps {
  ticker: string;
  stockName?: string;
  ohlcv: ChartData[];
  indicators?: CandleWithIndicators['indicators'];
  tradePlan?: TradePlan;
  smcData?: SMCData;
  livePrice?: number | null;
  currencyLabel?: string;
  height?: number | string;
  theme?: 'dark' | 'light';
  defaultTimeframe?: string;
  showDrawingToolbar?: boolean;
  showIndicatorPanel?: boolean;
  showTradePlanLines?: boolean;
  showSMCZones?: boolean;
  /** key for localStorage persistence of drawings */
  storageKey?: string;
  onSignalClick?: (signal: string) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function lineStyleToLightweight(style: LineStyleName): LineStyle {
  switch (style) {
    case 'solid': return 0;
    case 'dotted': return 1;
    case 'dashed': return 2;
    case 'large_dashed': return 3;
    default: return 0;
  }
}

export function genId(): string {
  return `d_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const DEFAULT_FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

export const TOOL_LABELS: Record<ToolType, string> = {
  none: 'لا شيء',
  cursor: 'مؤشر',
  trendline: 'خط اتجاه',
  hline: 'خط أفقي',
  vline: 'خط رأسي',
  rectangle: 'مستطيل',
  fib: 'فيبوناتشي',
  brush: 'فرشاة',
  text: 'نص',
  arrow: 'سهم',
  measure: 'قياس',
};
