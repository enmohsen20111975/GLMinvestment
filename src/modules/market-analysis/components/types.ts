/**
 * Types for MarketAnalysisView modules.
 * Extracted from MarketAnalysisView.tsx as part of PHASE3-BUNDLE-OPT.
 *
 * MAESTRO-DISABLED (Task PHASE-2-MAESTRO-KILL, Rule 73)
 * -------------------------------------------------------
 * The types referencing `maestroScore`, `raw_maestro_score`, and the
 * `'maestro'` literal in `source` union are retained for backward compatibility.
 * They map to the `maestro_score` DB column (stored_analyses table) and to
 * historical prediction-source labels. Removing them would break existing
 * API contracts (Rule 4 — NO-DELETION). No runtime maestro engine calls
 * exist in this file — it is purely a type declaration module.
 */

import type { MarketType } from '@/lib/store';
import type { Column } from '@/components/shared/UnifiedTable';

// ============================================================================
// Stock Data
// ============================================================================
export interface StockData {
  ticker: string;
  name: string;
  name_ar?: string;
  current_price: number;
  change_percent: number;
  change_value?: number;
  signal?: string | number;
  signal_ar?: string;
  master_score?: number;
  sector?: string;
  volume?: string | number;
  entry_price?: number;
  target_price?: number;
  stop_loss?: number;
  risk_reward?: number;
  // P16-DELAY-COMPENSATION: flag من الـ backend (chart_routes / stored_analysis_routes)
  // بيكون true بس لو السوق المصري مفتوح (intraday) والتوقع BUY → الـ backend نقلّل
  // الـ stop 15% ووسّع الـ target 5% عشان يعوّض تأخير البيانات 5 دقايق.
  delay_compensation_applied?: boolean;
  // P15-ATH-BREAKOUT: flag لأسهم الاختراق التاريخي (من sniper scan)
  ath_breakout?: boolean;
  confidence?: number;
  rsi?: number;
  technical_score?: number;
  prediction_date?: string;
  // Lifecycle fields (from /api/unified/predictions)
  status?: 'PENDING' | 'TARGET_HIT' | 'STOPPED' | 'EXPIRED' | string;
  final_price?: number | null;
  profit_loss_percent?: number | null;
  hit_target?: number | null;
  hit_stop_loss?: number | null;
  target_hit_date?: string | null;
  stop_hit_date?: string | null;
  evaluation_date?: string | null;
  max_profit_percent?: number | null;
  max_loss_percent?: number | null;
  holding_days?: number | null;
  // Rich analysis fields
  analysis_methods?: string[] | null;
  reasons?: string[] | null;
  trend_direction?: string | null;
  rsi_value?: number | null;
  macd_histogram?: number | null;
  candle_patterns?: Array<{ name: string; name_ar?: string; type?: string; strength?: number }> | null;
  sr_zone?: string | null;
  sr_support?: number | null;
  sr_resistance?: number | null;
  atr_value?: number | null;
  regime?: string | null;
  market_ar?: string;
  id?: string;
  logo_url?: string | null;
  // P6-PREDICTIONS: القيم التاريخية المُتتبَعة منذ التوقع (من daily_closer)
  // دول أعلى/أقل سعر وصلهم السهم من تاريخ التوقع لحد دلوقتي — مش أسعار اليوم.
  // بتاخد الأولوية في تحديد حالة التوقع (TARGET_HIT / STOPPED) على الواجهة.
  max_high_since_pred?: number | null;
  min_low_since_pred?: number | null;
  // Helper-only fields populated by the prediction pipeline (enrichment, not stored).
  high_price?: number | null;
  low_price?: number | null;
  horizon?: string | null;
  timeframe?: string | null;
  regime?: string | null;
  persona?: string | null;
  persona_type?: string | null;
}

/** Lightweight live-price snapshot returned by the market-prices API. */
export interface LiveStock {
  current_price?: number | null;
  close?: number | null;
  high_price?: number | null;
  low_price?: number | null;
  change_percent?: number | null;
  [key: string]: unknown;
}

/** Detailed stock snapshot returned by /api/stocks/[ticker]/detail. */
export interface StockDetail {
  ticker?: string;
  name?: string;
  name_ar?: string;
  current_price?: number | null;
  change_percent?: number | null;
  change_value?: number | null;
  high_price?: number | null;
  low_price?: number | null;
  pe_ratio?: number | null;
  sector?: string | null;
  logo_url?: string | null;
  [key: string]: unknown;
}

/** Prediction row shape returned by /api/predictions/* endpoints (subset of fields used by mapPredictionToStockData). */
export interface PredictionRow {
  id?: string | number;
  ticker?: string;
  symbol?: string;
  name?: string;
  market?: string;
  signal?: string | number;
  signal_ar?: string;
  recommendation?: string;
  current_price?: number | string | null;
  entry_price?: number | string | null;
  target_price?: number | string | null;
  stop_loss?: number | string | null;
  high_price?: number | string | null;
  high?: number | string | null;
  low_price?: number | string | null;
  change_percent?: number | string | null;
  risk_reward?: number | string | null;
  master_score?: number | string | null;
  confidence?: number | string | null;
  sector?: string | null;
  volume?: number | string | null;
  prediction_date?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  date?: string | null;
  status?: string | null;
  status_ar?: string | null;
  [key: string]: unknown;
}

// ============================================================================
// Lifecycle
// ============================================================================
export type LifecycleStatus = 'PENDING' | 'TARGET_HIT' | 'STOPPED' | 'EXPIRED' | string;

export interface StatusBadgeStyle {
  label: string;
  badgeClass: string;
  dotClass: string;
}

// ============================================================================
// Previous Prediction
// ============================================================================
export interface PreviousPrediction {
  ticker?: string;
  symbol?: string;
  name?: string;
  name_ar?: string;
  signal?: string;
  signal_ar?: string;
  entry_price?: number | null;
  target_price?: number | null;
  stop_loss?: number | null;
  master_score?: number;
  confidence?: number;
  prediction_date?: string;
  outcome_date?: string | null;
  exit_price?: number | null;
  actual_return?: number | null;
  is_live_return?: boolean;  // RL-FIX-9: عائد لحظي (معاينة) للصفقات المعلقة
  holding_days?: number;
  status?: string;
  status_ar?: string;
  exit_type?: string | null;  // RL-FIX-9: trailing_profit / trailing_stop / target_hit / etc.
  persona?: string | null;    // RL-FIX-9: gambler / balanced / conservative
  // P6-PREDICTIONS: القيم التاريخية المُتتبَعة منذ التوقع
  max_high_since_pred?: number | null;
  min_low_since_pred?: number | null;
  highest_price_reached?: number | null;
  lowest_price_reached?: number | null;
}

// ============================================================================
// Persona / Stored Analysis
// ============================================================================
export interface PersonaData {
  verdict?: string;
  score?: number;
  reason?: string;
  signal?: string;
  conditions?: string[];
  entry?: number | null;
  target?: number | null;
  stop?: number | null;
  timeframe?: string;
  fair_value?: number | null;
  // Sniper gates data (from sniper/scan engine)
  gates?: {
    liquidity: boolean;
    trend: boolean;
    support_resistance: boolean;
    risk_reward: boolean;
    confirmation: boolean;
    passed: number;
  };
  gate_details?: {
    liquidity_reason?: string;
    trend_reason?: string;
    sr_reason?: string;
    rr_reason?: string;
    confirmation_reason?: string;
  };
  rsi?: number;
  risk_reward?: number;
  sniper_score?: number;
  raw_maestro_score?: number;
  // Enrichment data from sniper/scan
  sector?: string;
  volume?: number;
  volume_ratio?: number;
  beta?: number;
  high_52w?: number;
  low_52w?: number;
  is_egx30?: boolean;
  is_egx100?: boolean;
  momentum_score?: number;
  perf_1w?: number;
  perf_1m?: number;
  perf_3m?: number;
  pe_ratio?: number;
  pb_ratio?: number;
  roe?: number;
  net_margin?: number;
  debt_to_equity?: number;
  current_ratio?: number;
  market_regime?: string;
  volatility?: number;
  momentum_accumulation?: boolean;
  momentum_strength?: number;
  momentum_reason?: string;
  rsi?: number;
  risk_reward?: number;
  perf_1w?: number;
  perf_1m?: number;
  perf_3m?: number;
  support_level?: number | null;
  resistance_level?: number | null;
  price_vs_sr?: string;
  /** Legacy aliases used by some response shapes (kept for compat). */
  high?: number | null;
  low?: number | null;
  support?: number | null;
  resistance?: number | null;
}


export interface AnalysisJson {
  gambler?: PersonaData;
  investor?: PersonaData;
  narrative?: { line1?: string; line2?: string; line3?: string };
  story_arc?: { price_movement?: string; historical_context?: string };
}


/**
 * PredictionContext — السياق الكامل للتوقّع اللي العميل ضغط عليها.
 * بينقل من جدول التوقعات لنافذة التحليل الشامل عشان الاتنين يكونوا متسقين.
 */
export interface PredictionContext {
  ticker: string;
  score: number;           // e.g. 92
  rating: string;          // "شراء قوي"
  ratingColor?: string;   // "#10b981"
  entryPrice?: number;    // 25.01
  targetPrice?: number;   // 30.32
  stopLoss?: number;      // 20.47
  riskReward?: number;    // 2.84
  horizon?: string;       // "يومي - أسبوعي"
  reason?: string;        // سبب التوقّع
  signal?: string;        // "BUY" / "STRONG_BUY"
  confidence?: number;    // 92
  source: 'persona' | 'sniper' | 'maestro' | 'stored';
}


export interface StoredAnalysisItem {
  ticker: string;
  market: string;
  name?: string;
  nameAr?: string;
  logoUrl?: string | null;
  maestroScore: number;
  recommendation?: string;
  recommendationAr?: string;
  confidence?: number;
  entry?: { price?: number; target?: number; stopLoss?: number; riskReward?: number };
  updatedAt?: string;
  analysisJson?: AnalysisJson;
  // DIR-01 (2026-10-12 — GM directive / Rule 73 SINGLE-DISPLAY-SOURCE):
  // These flags are computed by the backend (Python) and/or enrichItems()
  // and MUST be honored by BOTH the table view AND the text formatters
  // (formatSinglePersonaPickText / formatAllPersonaPicksText) so a stock
  // never shows "🟢 شراء قوي + سعر الدخول" in the share text while the
  // table says "منتهية". Previously the text formatters ignored these
  // fields entirely → public credibility scandal.
  /** True when current_price ≥ target_price (target realized → pick is stale). */
  priceTargetMismatch?: boolean;
  /** True when current_price drifted >20% from entry (pick is too old). */
  stale?: boolean;
  /** Human-readable Arabic reason for the stale/mismatch flag. */
  staleReason?: string;
  /** Percentage drift from entry (for stale picks). */
  stalePct?: number;
  // P16-PERSONA-DIVERGENCE: بيانات الأساسيات/المومنتم من stocks.db
  // (محسوبة في الـ backend وعلى الـ frontend يستخدمها pickPersonaDiverged).
  fundamentals?: {
    pe_ratio?: number;
    roe?: number;
    volume_ratio?: number;
    change_1d?: number;
    change_1m?: number;
    volatility?: number;
    fair_value_upside?: number;
    sector?: string;
    dividend_yield?: number;
    rsi?: number;
    is_gambler_opportunity?: boolean | number;
    is_investor_opportunity?: boolean | number;
    gambler_rank_score?: number;
    investor_rank_score?: number;
    // C2-SECTOR-HEAT: دوران قطاعي للمضارب فقط
    sector_heat?: 'hot' | 'dead' | 'neutral';
    sector_heat_boost?: number;
    gambler_rank_score_boosted?: number;
    // CL7-UI-SECTORS (P6): دور السهم جوه قطاعه (leader/mid/laggard) + التعديل
    sector_role?: 'leader' | 'mid' | 'laggard';
    sector_role_boost?: number;
  } | null;
}

/** لون الـ verdict حسب الكلمة */

// ============================================================================
// NameMap
// ============================================================================
export type NameMap = Record<string, { name?: string; name_ar?: string; logo_url?: string | null }>;

// ============================================================================
// Crypto Predictions
// ============================================================================
export interface CryptoPrediction {
  id: number;
  symbol: string;
  signal: string;
  confidence: number;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  analysis: Record<string, unknown> | null;
  created_at: string;
}


export interface CryptoPredictionsResponse {
  success: boolean;
  predictions: CryptoPrediction[];
  last_updated: string | null;
  error?: string;
  note?: string;
}


// ============================================================================
// Sector Tracking
// ============================================================================
export interface SectorTrackingStock {
  ticker: string;
  name: string;
  name_ar: string;
  current_price: number;
  change_percent: number;
  volume: number;
  turnover_egp: number;
  market_cap: number;
  avg_volume: number;
  volume_surge: boolean;
  rsi: number | null;
  ma_50: number | null;
  ma_200: number | null;
  above_ma50: boolean | null;
  trend: string | null;
  high_52w: number | null;
  low_52w: number | null;
  distance_from_52w_high: number | null;
  distance_from_52w_low: number | null;
}


export interface SectorTrackingEntry {
  sector: string;
  stock_count: number;
  avg_change: number;
  turnover: number;
  turnover_pct: number;
  gainers: number;
  losers: number;
  breadth: number;
  heat_level: string;  // HOT | WARM | NEUTRAL | COOL | COLD
  heat_ar: string;
  leader_ticker: string | null;
  leader_change: number | null;
  total_market_cap: number;
  stocks: SectorTrackingStock[];
}


export interface SectorTrackingResponse {
  success: boolean;
  market: string;
  sectors: SectorTrackingEntry[];
  market_summary: {
    total_stocks: number;
    total_sectors: number;
    advancers: number;
    decliners: number;
    breadth: number;
    avg_change: number;
    total_turnover: number;
  };
  rotation?: any;
  error?: string;
  hint?: string;
}


export type SectorSortField =
  | 'avg_change' | 'turnover' | 'stock_count' | 'breadth'
  | 'gainers' | 'losers' | 'turnover_pct' | 'sector'
  | 'heat_level' | 'total_market_cap' | 'leader_change';


export type SectorStockSortField =
  | 'ticker' | 'current_price' | 'change_percent' | 'volume'
  | 'turnover_egp' | 'market_cap' | 'rsi' | 'distance_from_52w_high';


// ============================================================================
// Morning Bell
// ============================================================================
export interface MorningBellStock {
  ticker: string;
  name_ar: string;
  signal: string;
  signal_ar: string;
  entry: number;
  target: number;
  stop: number;
  risk_reward: number;
  score: number;
  ath_breakout: boolean;
  delay_compensation_applied: boolean;
  updated_at?: string;
  // P41 Live Morning Bell fields (optional — present when live=1)
  price?: number;
  rvol?: number;
  extension_pct_day?: number;
  volume?: number;
  continuation_state?: 'continuing' | 'weakening' | 'exhausted';
  prob_continue_up?: number;
  prob_mild_pullback?: number;
  prob_sharp_drop?: number;
  suggested_tp1?: number;
  suggested_tp2?: number;
  suggested_stop?: number;
  risk_flag?: 'elevated' | 'extreme_north';
  client_responsibility_required?: boolean;
  composite_score?: number;
  confidence?: number;
  momentum_alive?: boolean;
  trajectory?: string;
  plain_ar_warning?: string;
  reason_ar?: string;
}


// ============================================================================
// Prediction Row (small tables)
// ============================================================================
export type PredictionRow = Record<string, unknown>;

// ============================================================================
// Market Analysis View Props
// ============================================================================
export interface MarketAnalysisViewProps {
  /** V40.4 §5 UI Mirror Protocol — when set, syncs the store to this market
   * on mount so the unified shell renders crypto/stock data identically. */
  initialMarket?: MarketType;
}

