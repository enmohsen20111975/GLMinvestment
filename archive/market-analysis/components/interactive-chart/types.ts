export interface ChartData {
 time: string; // YYYY-MM-DD
 open: number;
 high: number;
 low: number;
 close: number;
 volume: number;
}

export interface IndicatorData {
 time: string;
 value: number | null;
}

export interface FullChartProps {
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
 trend: number; // -1, 0, 1
 in_pocket: boolean; // السعر داخل الجيب الذهبي؟
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
 // === ALPHA-CHART-MERGE-1: Professional sections (from ProfessionalTradingChart) ===
 // These optional props enable the 7 professional sections (Decision Header, Trade
 // Plan, Reasons, Technical Details, Rescue CTA). When omitted, the chart renders
 // in props-only mode (SingleStockAnalysisView) and no sections appear.
 canonical?: {
 signal?: string;
 signal_ar?: string;
 entry_price?: number | null;
 stop_loss?: number | null;
 target_price?: number | null;
 target_price_2?: number | null;
 tech_score?: number | null;
 risk_reward?: number | null;
 };
 decisionData?: {
 path_taken?: string;
 adjustment_reason?: string;
 };
 flightState?: { state?: string };
 makerState?: { state?: string };
 stockDna?: {
 typical_range?: { current_position?: string };
 };
 confluence?: {
 breakdown?: {
 trend?: { detail?: string; passed?: boolean };
 };
 };
 currentIndicators?: {
 rsi?: number;
 macd?: number;
 atr?: number;
 };
 suggestedPositionSizePct?: number;
 analysisText?: string;
 smcAnalysis?: { bias_ar?: string };
 showDecisionHeader?: boolean;
 showTradePlan?: boolean;
 showReasons?: boolean;
 showTechnicalDetails?: boolean;
 showRescueCTA?: boolean;
 tickerName?: string;
 currencyLabel?: string;
}

// ─── Theme Constants (CHART-UX-030: TradingView Dark Theme) ──────────────────
// ALPHA-FIX: exported so InteractiveChart.tsx can import them (fixes ReferenceError)

export const CHART_BG = '#131722'; // TradingView dark background
export const CHART_GRID = '#363c4e'; // TradingView grid lines (was #1e222d — too dark)
export const CHART_TEXT = '#d1d4dc'; // TradingView text color
export const UP_COLOR = '#26a69a'; // TradingView bullish candle
export const DOWN_COLOR = '#ef5350'; // TradingView bearish candle

export const SMA20_COLOR = '#f0b90b'; // gold
export const SMA50_COLOR = '#ff9800'; // CHART-UX-030: orange (was #2196f3 blue)
export const SMA200_COLOR = '#2196f3'; // CHART-UX-030: blue (was #9c27b0 purple)
export const BB_UPPER_COLOR = '#607d8b';
export const BB_MIDDLE_COLOR = '#78909c';
export const BB_LOWER_COLOR = '#607d8b';
export const BB_SQUEEZE_COLOR = '#f97316'; // Orange for squeeze

export const SUPPORT_COLOR = '#26a69a';
export const RESISTANCE_COLOR = '#ef5350';
export const PIVOT_COLOR = '#ff9800';

export const RSI_COLOR = '#e040fb';
export const CMF_COLOR = '#00bcd4';

export const EMA9_COLOR = '#ff6b6b';
export const EMA21_COLOR = '#4ecdc4';

export const MACD_LINE_COLOR = '#2196f3';
export const MACD_SIGNAL_COLOR = '#ff6b6b';
export const MACD_HIST_POS = '#26a69a';
export const MACD_HIST_NEG = '#ef5350';

export const OBV_COLOR = '#ab47bc';
export const FIB_COLOR = '#ffd700';

// ─── Helpers ──────────────────────────────────────────────────────────────────

