// SingleStockAnalysis types (Phase 3)
export interface CandleProbabilities {
  prob_continue_up: number;
  prob_mild_pullback: number;
  prob_sharp_drop: number;
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
