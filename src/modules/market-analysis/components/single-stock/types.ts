// SingleStockAnalysis types (Phase 3)
import type { PredictionContext } from '@/modules/market-analysis/components/types';

export interface CandleProbabilities {
  prob_continue_up: number;
  prob_mild_pullback: number;
  prob_sharp_drop: number;
  // FIX (BRAVO-DISASTER 2026-10-28): fields used by InsightCards.tsx but missing
  // from the original type definition. All optional so existing callers keep working.
  up_prob?: number;
  dn_prob?: number;
  bias_color?: string;
  bias_emoji?: string;
  bias?: string;
  prev_high?: number;
  prev_low?: number;
  break_high_0pct?: number;
  break_high_1pct?: number;
  break_high_2pct?: number;
  break_low_0pct?: number;
  break_low_1pct?: number;
  break_low_2pct?: number;
  target_up_1pct?: number;
  target_up_2pct?: number;
  target_dn_1pct?: number;
  target_dn_2pct?: number;
  prev_candle?: string;
  confidence?: number | string;
  sample_size?: number | string;
  total_green?: number | string;
  total_red?: number | string;
  [key: string]: unknown;
}
export interface StockDNA {
  ticker: string;
  signal: string;
  score: number;
  sector: string;
  name?: string | null;
  summary?: string | null;
  personality_type?: string | null;
  personality_type_en?: string | null;
  volatility?: string | null;
  annual_return?: number | null | undefined;
  best_weekday?: string | null;
  worst_weekday?: string | null;
  best_months?: Array<{ month?: string; return_pct?: number; month_num?: number; avg_change?: number }> | null;
  worst_months?: Array<{ month?: string; return_pct?: number; month_num?: number; avg_change?: number }> | null;
  behavioral_tags?: Array<{ tag?: string; tag_ar?: string }> | null;
  dividend_timing?: { months?: Array<{ month?: string; avg_return?: number }> } | null;
  narrative?: string | null;
  sample_months?: number | null;
  confidence?: number | null;
  typical_range?: {
    min?: number;
    max?: number;
    current?: number;
    position_pct?: number;
    current_position?: string;
  } | null;
  [key: string]: unknown;
}
export interface FullAnalysisResponse {
  success: boolean;
  data: {
    stock_info: StockDNA;
    candle_probabilities: CandleProbabilities;
    smc_analysis?: Record<string, unknown> | null;
    candlestick_patterns?: Array<Record<string, unknown>> | null;
    current_indicators?: Record<string, unknown> | null;
    fusion_metrics?: Record<string, unknown> | null;
    fundamentals?: Record<string, unknown> | null;
    [key: string]: unknown;
  };
  // FIX (FIX-TSC-BATCH-3): fields used directly by the container/view. All optional.
  ohlcv?: Array<{ close?: number; open?: number; high?: number; low?: number; date?: string }>;
  confluence?: { signal?: string; score?: number; signal_color?: string; [k: string]: unknown };
  risk?: {
    entry?: number; target?: number; stop_loss?: number; target_2?: number;
    rr_ratio?: number; [k: string]: unknown;
  };
  institutional_decision?: Record<string, unknown>;
  candle_probabilities?: CandleProbabilities | null;
  stock_dna?: StockDNA | null;
  confidence?: number;
  analysis_text?: string;
  suggested_position_size_pct?: number | string;
  adjustment_reason?: string;
  name?: string;
  name_ar?: string;
  [key: string]: unknown;
}

// FIX (FIX-TSC-BATCH-3): CanonicalData returned by /api/stocks/[ticker]/unified.
export type CanonicalData = Record<string, unknown> & {
  success?: boolean;
  [key: string]: unknown;
} | null;

export interface SingleStockAnalysisViewProps {
  initialTicker: string;
  predictionContext?: PredictionContext;
  canRemove?: boolean;
  onRemove?: () => void;
  onTickerChange?: (ticker: string) => void;
}

export type ChartEngine = string;
export type VisibleIndicatorsMap = Record<string, boolean>;

export const DEFAULT_VISIBLE_INDICATORS: VisibleIndicatorsMap = {
  sma: true,
  ema: true,
  volume: true,
};

export { buildAnalysisUrl } from './helpers';
