// SingleStockAnalysis types (Phase 3)
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
  break_low_0pct?: number;
  break_low_1pct?: number;
  [key: string]: unknown;
}
export interface StockDNA {
  ticker: string;
  signal: string;
  score: number;
  sector: string;
}
export interface FullAnalysisResponse {
  success: boolean;
  data: {
    stock_info: StockDNA;
    candle_probabilities: CandleProbabilities;
  };
}

export const DEFAULT_VISIBLE_INDICATORS = ['sma', 'ema', 'volume'] as string[];
export type ChartEngine = unknown;
export type VisibleIndicatorsMap = Record<string, boolean>;

export { buildAnalysisUrl } from './helpers';
