/**
 * Professional Financial Analysis Engine for EGX (Egyptian Stock Exchange)
 *
 * Server-side only module. Implements sophisticated financial calculations
 * including technical indicators, advanced scoring, pattern detection,
 * risk metrics, and professional recommendations.
 *
 * @module analysis-engine
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PricePoint {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ProfessionalAnalysis {
  scores: {
    composite: number;
    technical: number;
    value: number;
    quality: number;
    momentum: number;
    risk: number;
  };
  recommendation: {
    action: string;
    action_ar: string;
    confidence: number;
    entry_price: number;
    target_price: number;
    stop_loss: number;
    risk_reward_ratio: number;
    time_horizon: string;
    time_horizon_ar: string;
    summary_ar: string;
  };
  indicators: {
    rsi: { value: number; signal: string };
    macd: { line: number; signal: number; histogram: number; signal_text: string };
    bollinger: { upper: number; middle: number; lower: number; position: number; signal_text: string };
    stochastic_rsi: { k: number; d: number; signal_text: string };
    atr: number;
    atr_percent: number;
    obv: number;
    obv_trend: string;
    vwap: number;
    roc: { roc_5: number; roc_10: number; roc_20: number; signal_text: string };
  };
  patterns: {
    detected: Array<{ name: string; name_ar: string; type: 'bullish' | 'bearish' | 'neutral'; reliability: string }>;
    ma_cross: string | null;
  };
  risk_metrics: {
    sharpe_ratio: number;
    max_drawdown: number;
    max_drawdown_percent: number;
    var_95: number;
    beta: number;
    volatility_annualized: number;
  };
  price_levels: {
    support_1: number;
    support_2: number;
    resistance_1: number;
    resistance_2: number;
    pivot: number;
  };
  trend: {
    direction: string;
    direction_ar: string;
    strength: 'strong' | 'moderate' | 'weak';
    strength_ar: string;
  };
  volume_analysis: {
    avg_volume_20: number;
    current_vs_avg: number;
    signal: string;
    signal_ar: string;
  };
  data_quality: {
    history_points: number;
    quality: 'high' | 'medium' | 'low';
  };
  fair_value: {
    graham_number: number;
    lynch_value: number;
    dcf_simplified: number;
    pe_based: number;
    average_fair_value: number;
    upside_to_fair: number;
    verdict: 'undervalued' | 'fair' | 'overvalued';
    verdict_ar: string;
    details: {
      eps: number;
      book_value_per_share: number;
      growth_rate: number;
      risk_free_rate: number;
      sector_avg_pe: number;
      graham_calc: string;
      lynch_calc: string;
      dcf_calc: string;
      pe_calc: string;
    };
  };
  regime?: {
    current: 'BULL' | 'BEAR' | 'RANGE';
    weights_source: 'learned' | 'default';
    applied_weights: {
      technical: number;
      value: number;
      quality: number;
      momentum: number;
      risk: number;
    };
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safely convert a value to number, with fallback */
function toNum(value: unknown, fallback: number = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Clamp a value between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Round to N decimal places */
function round(value: number, decimals: number = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Simple moving average over an array of numbers */
function sma(data: number[], period: number): number {
  if (data.length === 0 || period <= 0) return 0;
  const slice = data.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

/** Exponential moving average over an array of numbers */
function ema(data: number[], period: number): number[] {
  if (data.length === 0 || period <= 0) return [];
  const result: number[] = [];
  const k = 2 / (period + 1);
  let prev = sma(data.slice(0, period), period); // seed with SMA
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      // not enough data yet — accumulate SMA seed
      prev = sma(data.slice(0, i + 1), i + 1);
      result.push(prev);
    } else if (i === period - 1) {
      prev = sma(data.slice(0, period), period);
      result.push(prev);
    } else {
      prev = data[i] * k + prev * (1 - k);
      result.push(prev);
    }
  }
  return result;
}

/** Standard deviation of the last `period` values */
function stddev(data: number[], period: number): number {
  if (data.length === 0 || period <= 1) return 0;
  const slice = data.slice(-period);
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / (period - 1);
  return Math.sqrt(variance);
}

/**
 * Normalize raw price history records into PricePoint[].
 * Handles both `close_price` / `close` field names, filters out invalid rows.
 */
export function normalizePriceHistory(
  history: Array<Record<string, unknown>>
): PricePoint[] {
  return history
    .map((row) => {
      const open = toNum(row.open_price ?? row.open);
      const high = toNum(row.high_price ?? row.high);
      const low = toNum(row.low_price ?? row.low);
      const close = toNum(row.close_price ?? row.close);
      const volume = toNum(row.volume);
      return {
        date: String(row.date ?? ''),
        open,
        high: high > 0 ? high : close,
        low: low > 0 ? low : close,
        close,
        volume,
      };
    })
    .filter((p) => p.close > 0);
}

// ---------------------------------------------------------------------------
// 1. Technical Indicators
// ---------------------------------------------------------------------------

/** MACD (12, 26, 9) — returns { macdLine, signalLine, histogram } */
export function calculateMACD(closes: number[]): {
  macdLine: number;
  signalLine: number;
  histogram: number;
} {
  if (closes.length < 35) {
    return { macdLine: 0, signalLine: 0, histogram: 0 };
  }

  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);

  // MACD line = EMA12 - EMA26
  const macdLineArr: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    macdLineArr.push(ema12[i] - ema26[i]);
  }

  // Signal line = 9-period EMA of MACD line
  const signalLineArr = ema(macdLineArr, 9);

  const macdLine = macdLineArr[macdLineArr.length - 1];
  const signalLine = signalLineArr[signalLineArr.length - 1];
  const histogram = macdLine - signalLine;

  return { macdLine: round(macdLine, 4), signalLine: round(signalLine, 4), histogram: round(histogram, 4) };
}

/** Bollinger Bands (20 period, 2 std dev) */
export function calculateBollingerBands(closes: number[]): {
  upper: number;
  middle: number;
  lower: number;
  bandwidth: number;
} {
  if (closes.length < 20) {
    const last = closes.length > 0 ? closes[closes.length - 1] : 0;
    return { upper: last, middle: last, lower: last, bandwidth: 0 };
  }

  const middle = sma(closes, 20);
  const sd = stddev(closes, 20);
  const upper = middle + 2 * sd;
  const lower = middle - 2 * sd;
  const bandwidth = middle > 0 ? (upper - lower) / middle : 0;

  return {
    upper: round(upper, 4),
    middle: round(middle, 4),
    lower: round(lower, 4),
    bandwidth: round(bandwidth, 4),
  };
}

/** RSI (14 period) */
export function calculateRSI(closes: number[]): number {
  if (closes.length < 15) return 50;

  const period = 14;
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  if (gains.length < period) return 50;

  // Initial averages (using SMA for seed)
  const initAvgGain = sma(gains.slice(0, period), period);
  const initAvgLoss = sma(losses.slice(0, period), period);

  let avgGain = initAvgGain;
  let avgLoss = initAvgLoss;

  // Smoothed averages
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return round(100 - 100 / (1 + rs), 2);
}

/** Stochastic RSI (RSI period=14, Stoch period=14, %K smoothing=3, %D smoothing=3) */
export function calculateStochasticRSI(closes: number[]): { k: number; d: number } {
  if (closes.length < 30) return { k: 50, d: 50 };

  // First compute RSI values
  const rsiPeriod = 14;
  const rsiValues: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }

  if (gains.length < rsiPeriod) return { k: 50, d: 50 };

  const initAvgGain = sma(gains.slice(0, rsiPeriod), rsiPeriod);
  const initAvgLoss = sma(losses.slice(0, rsiPeriod), rsiPeriod);

  let avgGain = initAvgGain;
  let avgLoss = initAvgLoss;

  rsiValues.push(initAvgLoss === 0 ? 100 : round(100 - 100 / (1 + initAvgGain / initAvgLoss), 2));

  for (let i = rsiPeriod; i < gains.length; i++) {
    avgGain = (avgGain * (rsiPeriod - 1) + gains[i]) / rsiPeriod;
    avgLoss = (avgLoss * (rsiPeriod - 1) + losses[i]) / rsiPeriod;
    rsiValues.push(avgLoss === 0 ? 100 : round(100 - 100 / (1 + avgGain / avgLoss), 2));
  }

  if (rsiValues.length < 14) return { k: 50, d: 50 };

  // Compute Stochastic of RSI
  const stochPeriod = 14;
  const rawStoch: number[] = [];

  for (let i = stochPeriod - 1; i < rsiValues.length; i++) {
    const slice = rsiValues.slice(i - stochPeriod + 1, i + 1);
    const minRSI = Math.min(...slice);
    const maxRSI = Math.max(...slice);
    const range = maxRSI - minRSI;
    rawStoch.push(range === 0 ? 50 : ((rsiValues[i] - minRSI) / range) * 100);
  }

  if (rawStoch.length < 3) return { k: 50, d: 50 };

  // Smooth %K with 3-period SMA
  const k = sma(rawStoch, 3);

  // %D = 3-period SMA of %K values
  const d = rawStoch.length >= 5 ? sma(rawStoch.slice(0, -2).concat([k]), 3) : k;

  return { k: round(clamp(k, 0, 100), 2), d: round(clamp(d, 0, 100), 2) };
}

/** Average True Range (14 period) */
export function calculateATR(data: PricePoint[], period: number = 14): number {
  if (data.length < 2) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const high = data[i].high;
    const low = data[i].low;
    const prevClose = data[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) {
    const avg = trueRanges.reduce((s, v) => s + v, 0) / trueRanges.length;
    return round(avg, 4);
  }

  // Wilder's smoothing (EMA-like)
  let atr = sma(trueRanges.slice(0, period), period);
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return round(atr, 4);
}

/** On-Balance Volume (OBV) */
export function calculateOBV(data: PricePoint[]): number {
  if (data.length === 0) return 0;

  let obv = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i].close > data[i - 1].close) {
      obv += data[i].volume;
    } else if (data[i].close < data[i - 1].close) {
      obv -= data[i].volume;
    }
  }
  return obv;
}

/** OBV trend — compare recent OBV vs older OBV */
export function getOBVTrend(data: PricePoint[]): string {
  if (data.length < 20) return 'neutral';

  const half = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, half);
  const secondHalf = data.slice(half);

  const obv1 = calculateOBV(firstHalf);
  const obv2 = calculateOBV(data) - obv1;

  if (obv2 > obv1 * 1.05) return 'rising';
  if (obv2 < obv1 * 0.95) return 'falling';
  return 'neutral';
}

/** Volume Weighted Average Price (VWAP) — cumulative, uses entire dataset */
export function calculateVWAP(data: PricePoint[]): number {
  if (data.length === 0) return 0;

  let cumTPV = 0; // cumulative typical price × volume
  let cumVol = 0;

  for (const p of data) {
    const tp = (p.high + p.low + p.close) / 3;
    cumTPV += tp * p.volume;
    cumVol += p.volume;
  }

  return cumVol > 0 ? round(cumTPV / cumVol, 4) : 0;
}

/** Price Rate of Change at various periods */
export function calculateROC(closes: number[]): {
  roc_5: number;
  roc_10: number;
  roc_20: number;
} {
  const len = closes.length;
  const roc5 = len > 5 ? ((closes[len - 1] - closes[len - 6]) / closes[len - 6]) * 100 : 0;
  const roc10 = len > 10 ? ((closes[len - 1] - closes[len - 11]) / closes[len - 11]) * 100 : 0;
  const roc20 = len > 20 ? ((closes[len - 1] - closes[len - 21]) / closes[len - 21]) * 100 : 0;

  return {
    roc_5: round(roc5, 2),
    roc_10: round(roc10, 2),
    roc_20: round(roc20, 2),
  };
}

// ---------------------------------------------------------------------------
// 2. Advanced Scoring System
// ---------------------------------------------------------------------------

/** Calculate simple moving averages for multiple periods */
function calculateMAs(closes: number[]): { ma5: number; ma10: number; ma20: number; ma50: number; ma200: number } {
  return {
    ma5: closes.length >= 5 ? sma(closes, 5) : closes[closes.length - 1] || 0,
    ma10: closes.length >= 10 ? sma(closes, 10) : closes[closes.length - 1] || 0,
    ma20: closes.length >= 20 ? sma(closes, 20) : closes[closes.length - 1] || 0,
    ma50: closes.length >= 50 ? sma(closes, 50) : 0,
    ma200: closes.length >= 200 ? sma(closes, 200) : 0,
  };
}

/** Momentum Score (0-100): Based on ROC, MACD histogram, price vs MAs */
function calculateMomentumScore(
  closes: number[],
  macdHist: number,
  mas: { ma5: number; ma10: number; ma20: number; ma50: number; ma200: number }
): number {
  let score = 50;
  const currentPrice = closes.length > 0 ? closes[closes.length - 1] : 0;
  if (currentPrice <= 0) return 50;

  // ROC contribution (±20 points)
  const roc = closes.length > 20
    ? ((currentPrice - closes[closes.length - 21]) / closes[closes.length - 21]) * 100
    : 0;
  score += clamp(roc * 0.8, -20, 20);

  // MACD histogram contribution (±15 points)
  score += clamp(macdHist * 2, -15, 15);

  // Price vs MAs alignment (±15 points)
  if (currentPrice > mas.ma5 && currentPrice > mas.ma20) score += 10;
  else if (currentPrice < mas.ma5 && currentPrice < mas.ma20) score -= 10;
  if (currentPrice > mas.ma50) score += 5;
  else if (currentPrice < mas.ma50) score -= 5;

  return clamp(Math.round(score), 0, 100);
}

/** Value Score (0-100): Based on P/E, P/B, PEG, EV/EBITDA */
function calculateValueScore(stock: Record<string, unknown>): number {
  let score = 50;
  const pe = toNum(stock.pe_ratio);
  const pb = toNum(stock.pb_ratio);
  const eps = toNum(stock.eps);
  const dividendYield = toNum(stock.dividend_yield);
  const currentPrice = toNum(stock.current_price);

  // P/E evaluation (±20 points)
  if (pe > 0 && pe <= 10) score += 20;
  else if (pe > 10 && pe <= 15) score += 12;
  else if (pe > 15 && pe <= 20) score += 4;
  else if (pe > 20 && pe <= 30) score -= 5;
  else if (pe > 30) score -= 15;
  else score -= 10; // negative PE

  // P/B evaluation (±15 points)
  if (pb > 0 && pb <= 1) score += 15;
  else if (pb > 1 && pb <= 1.5) score += 8;
  else if (pb > 1.5 && pb <= 2.5) score += 0;
  else if (pb > 2.5 && pb <= 4) score -= 8;
  else if (pb > 4) score -= 15;
  else score -= 5; // negative P/B

  // PEG ratio proxy: P/E / EPS growth rate
  // We use dividend yield as a proxy for value if EPS growth is unknown
  if (dividendYield > 6) score += 10;
  else if (dividendYield > 4) score += 6;
  else if (dividendYield > 2) score += 3;

  // EPS positive check
  if (eps > 0) score += 5;
  else if (eps < 0) score -= 10;

  return clamp(Math.round(score), 0, 100);
}

/** Quality Score (0-100): Based on ROE, debt/equity, profit margins, earnings consistency */
function calculateQualityScore(
  stock: Record<string, unknown>,
  closes: number[]
): number {
  let score = 50;
  const roe = toNum(stock.roe);
  const debtToEquity = toNum(stock.debt_to_equity);

  // ROE evaluation (±20 points)
  if (roe >= 25) score += 20;
  else if (roe >= 18) score += 14;
  else if (roe >= 12) score += 8;
  else if (roe >= 5) score += 0;
  else if (roe >= 0) score -= 8;
  else score -= 15;

  // Debt-to-Equity (±15 points)
  if (debtToEquity >= 0 && debtToEquity <= 0.3) score += 15;
  else if (debtToEquity > 0.3 && debtToEquity <= 0.7) score += 8;
  else if (debtToEquity > 0.7 && debtToEquity <= 1.0) score += 0;
  else if (debtToEquity > 1.0 && debtToEquity <= 1.5) score -= 8;
  else if (debtToEquity > 1.5) score -= 15;
  else score -= 5; // negative

  // Earnings consistency: check if recent returns are generally positive (±10 points)
  if (closes.length >= 20) {
    const recent20 = closes.slice(-20);
    let positiveDays = 0;
    for (let i = 1; i < recent20.length; i++) {
      if (recent20[i] > recent20[i - 1]) positiveDays++;
    }
    const winRate = positiveDays / (recent20.length - 1);
    if (winRate >= 0.55) score += 10;
    else if (winRate >= 0.45) score += 0;
    else score -= 10;
  }

  // Profit margin proxy: higher ROE + lower debt = higher margins (±5 points)
  if (roe >= 15 && debtToEquity <= 0.5) score += 5;

  return clamp(Math.round(score), 0, 100);
}

/** Technical Score (0-100): Based on RSI, MACD signals, Bollinger position, trend alignment */
function calculateTechnicalScore(
  stock: Record<string, unknown>,
  closes: number[],
  macdResult: { macdLine: number; signalLine: number; histogram: number },
  bollinger: { upper: number; middle: number; lower: number },
  stochasticRSI: { k: number; d: number },
  mas: { ma5: number; ma10: number; ma20: number; ma50: number; ma200: number }
): number {
  let score = 50;
  const currentPrice = closes.length > 0 ? closes[closes.length - 1] : 0;
  if (currentPrice <= 0) return 50;

  // RSI evaluation (±15 points) — use computed RSI from stock or recalculate
  const rsi = toNum(stock.rsi, closes.length >= 15 ? calculateRSI(closes) : 50);
  if (rsi >= 30 && rsi <= 70) {
    // Neutral zone, slightly bullish
    score += 5;
    if (rsi >= 45 && rsi <= 55) score += 5; // sweet spot
  } else if (rsi < 30) {
    // Oversold — bullish signal
    score += 15;
  } else if (rsi > 70 && rsi <= 80) {
    // Overbought warning
    score -= 8;
  } else if (rsi > 80) {
    // Highly overbought
    score -= 15;
  }

  // MACD signal (±12 points)
  if (macdResult.histogram > 0 && macdResult.macdLine > 0) {
    score += 12; // strong bullish
  } else if (macdResult.histogram > 0) {
    score += 6; // histogram positive but MACD below zero
  } else if (macdResult.histogram < 0 && macdResult.macdLine < 0) {
    score -= 12; // strong bearish
  } else {
    score -= 6; // histogram negative but MACD above zero
  }

  // Bollinger Band position (±10 points)
  const bbRange = bollinger.upper - bollinger.lower;
  if (bbRange > 0) {
    const bbPos = (currentPrice - bollinger.lower) / bbRange; // 0 to 1
    if (bbPos < 0.1) score += 10; // near lower band — oversold
    else if (bbPos < 0.3) score += 5;
    else if (bbPos > 0.9) score -= 10; // near upper band — overbought
    else if (bbPos > 0.7) score -= 5;
  }

  // Trend alignment (±8 points)
  if (mas.ma50 > 0 && mas.ma200 > 0) {
    if (mas.ma50 > mas.ma200) score += 4; // golden trend
    else score -= 4; // death trend
  }
  if (currentPrice > mas.ma20 && mas.ma20 > 0) score += 4;
  else if (currentPrice < mas.ma20 && mas.ma20 > 0) score -= 4;

  // Stochastic RSI (±5 points)
  if (stochasticRSI.k < 20 && stochasticRSI.d < 20) score += 5; // oversold
  else if (stochasticRSI.k > 80 && stochasticRSI.d > 80) score -= 5; // overbought

  return clamp(Math.round(score), 0, 100);
}

/** Risk Score (0-100): Higher = riskier. Based on ATR, volatility, max drawdown */
function calculateRiskScore(
  atr: number,
  atrPercent: number,
  maxDrawdownPercent: number,
  closes: number[],
  stock: Record<string, unknown>
): number {
  let score = 30; // base risk

  // ATR % contribution (±20 points)
  if (atrPercent >= 5) score += 20;
  else if (atrPercent >= 3.5) score += 15;
  else if (atrPercent >= 2) score += 8;
  else if (atrPercent >= 1) score += 0;
  else score -= 5;

  // Max drawdown contribution (±25 points)
  const mdd = Math.abs(maxDrawdownPercent);
  if (mdd >= 40) score += 25;
  else if (mdd >= 25) score += 18;
  else if (mdd >= 15) score += 10;
  else if (mdd >= 8) score += 5;
  else score -= 3;

  // Volatility contribution (±15 points)
  if (closes.length >= 20) {
    const recent20 = closes.slice(-20);
    const dailyReturns: number[] = [];
    for (let i = 1; i < recent20.length; i++) {
      if (recent20[i - 1] > 0) {
        dailyReturns.push((recent20[i] - recent20[i - 1]) / recent20[i - 1]);
      }
    }
    const vol = dailyReturns.length > 0 ? stddev(dailyReturns, Math.min(dailyReturns.length, 20)) : 0;
    const annualizedVol = vol * Math.sqrt(252);
    if (annualizedVol >= 0.6) score += 15;
    else if (annualizedVol >= 0.4) score += 10;
    else if (annualizedVol >= 0.25) score += 5;
    else score -= 3;
  }

  // Debt-to-equity adds to risk (±10 points)
  const dte = toNum(stock.debt_to_equity);
  if (dte > 2) score += 10;
  else if (dte > 1.5) score += 6;
  else if (dte > 1) score += 3;

  return clamp(Math.round(score), 0, 100);
}

/** Composite Score (0-100): Weighted combination of all sub-scores */
function calculateCompositeScore(
  technical: number,
  value: number,
  quality: number,
  momentum: number,
  risk: number,
  dynamicWeights?: {
    technical?: number;
    value?: number;
    quality?: number;
    momentum?: number;
    risk?: number;
  }
): number {
  // Use dynamic weights if provided, otherwise use defaults
  const wTechnical = dynamicWeights?.technical ?? 0.30;
  const wValue = dynamicWeights?.value ?? 0.25;
  const wQuality = dynamicWeights?.quality ?? 0.25;
  const wMomentum = dynamicWeights?.momentum ?? 0.10;
  const wRisk = dynamicWeights?.risk ?? 0.10;

  // Risk-adjusted momentum: scale by (100 - risk) / 100
  const riskAdjMomentum = momentum * ((100 - risk) / 100);
  const riskAdjScore = risk * ((100 - risk) / 100); // penalize high risk

  const composite = technical * wTechnical + value * wValue + quality * wQuality + riskAdjMomentum * wMomentum + (100 - riskAdjScore) * wRisk;
  return clamp(Math.round(composite), 0, 100);
}

// ---------------------------------------------------------------------------
// Dynamic Weights from Self-Learning System
// ---------------------------------------------------------------------------

interface DynamicWeights {
  technical: number;
  value: number;
  quality: number;
  momentum: number;
  risk: number;
  regime: 'BULL' | 'BEAR' | 'RANGE';
  source: 'learned' | 'default';
  lastUpdated?: string;
}

/**
 * Get dynamic weights from the self-learning system based on market regime.
 * Falls back to default weights if no learned weights are available.
 */
export function getDynamicWeights(regime?: 'BULL' | 'BEAR' | 'RANGE'): DynamicWeights {
  // Default weights
  const defaultWeights: DynamicWeights = {
    technical: 0.30,
    value: 0.25,
    quality: 0.25,
    momentum: 0.10,
    risk: 0.10,
    regime: regime || 'RANGE',
    source: 'default',
  };

  try {
    // Try to import self-learning engine dynamically to avoid circular dependencies
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const selfLearning = require('./v2/self-learning-engine');
    
    if (!selfLearning.isInitialized || !selfLearning.isInitialized()) {
      return defaultWeights;
    }

    // Get regime-specific weights from database
    const db = selfLearning.getReadDb?.();
    if (!db) return defaultWeights;

    const effectiveRegime = regime || 'RANGE';
    
    // Query learned weights for the regime
    const rows = db.prepare(`
      SELECT indicator_name, weight, expectancy 
      FROM regime_indicator_weights 
      WHERE regime = ?
      ORDER BY expectancy DESC
    `).all(effectiveRegime) as Array<{ indicator_name: string; weight: number; expectancy: number }>;

    db.close?.();

    if (!rows || rows.length === 0) {
      return defaultWeights;
    }

    // Map indicator names to score categories
    // RSI, MACD, Bollinger, MA, Ichimoku, Fibonacci, ADX, Stochastic, Volume, SupportResistance
    let technicalWeight = defaultWeights.technical;
    let momentumWeight = defaultWeights.momentum;
    
    // Aggregate weights from learned indicators
    const indicatorCount = rows.length;
    if (indicatorCount > 0) {
      // Calculate average weight adjustment
      const avgWeight = rows.reduce((sum, r) => sum + r.weight, 0) / indicatorCount;
      
      // Adjust technical and momentum weights based on learned weights
      // High expectancy indicators boost their respective categories
      const technicalIndicators = ['RSI', 'MACD', 'Bollinger', 'MA', 'ADX', 'Stochastic'];
      const momentumIndicators = ['MACD', 'ADX', 'Volume'];
      
      const technicalAvg = rows
        .filter(r => technicalIndicators.includes(r.indicator_name))
        .reduce((sum, r) => sum + r.weight, 0) / technicalIndicators.length;
      
      const momentumAvg = rows
        .filter(r => momentumIndicators.includes(r.indicator_name))
        .reduce((sum, r) => sum + r.weight, 0) / Math.max(momentumIndicators.length, 1);

      // Normalize weights to maintain total of 1.0
      const totalDefault = defaultWeights.technical + defaultWeights.value + defaultWeights.quality + defaultWeights.momentum + defaultWeights.risk;
      
      // Apply learned adjustments (cap at ±50% of default)
      technicalWeight = clamp(defaultWeights.technical * (0.5 + technicalAvg), defaultWeights.technical * 0.5, defaultWeights.technical * 1.5);
      momentumWeight = clamp(defaultWeights.momentum * (0.5 + momentumAvg), defaultWeights.momentum * 0.5, defaultWeights.momentum * 1.5);
      
      // Normalize to maintain sum of weights = 1.0
      const currentTotal = technicalWeight + defaultWeights.value + defaultWeights.quality + momentumWeight + defaultWeights.risk;
      const normalizationFactor = totalDefault / currentTotal;
      
      technicalWeight *= normalizationFactor;
      momentumWeight *= normalizationFactor;
    }

    return {
      technical: round(technicalWeight, 2),
      value: defaultWeights.value,
      quality: defaultWeights.quality,
      momentum: round(momentumWeight, 2),
      risk: defaultWeights.risk,
      regime: effectiveRegime,
      source: 'learned',
      lastUpdated: new Date().toISOString(),
    };
  } catch (e) {
    // If any error occurs, return default weights
    console.error('[getDynamicWeights] Error:', e);
    return defaultWeights;
  }
}

/**
 * Detect market regime based on price action
 */
export function detectMarketRegime(closes: number[]): 'BULL' | 'BEAR' | 'RANGE' {
  if (closes.length < 50) return 'RANGE';

  const sma20 = sma(closes, 20);
  const sma50 = sma(closes, 50);
  const currentPrice = closes[closes.length - 1];

  // Calculate slope of SMA20 over last 10 periods
  const recentSma20: number[] = [];
  for (let i = closes.length - 10; i < closes.length; i++) {
    recentSma20.push(sma(closes.slice(0, i + 1), 20));
  }
  
  const slopeStart = recentSma20[0];
  const slopeEnd = recentSma20[recentSma20.length - 1];
  const slopePercent = ((slopeEnd - slopeStart) / slopeStart) * 100;

  // Determine regime
  if (slopePercent > 2 && currentPrice > sma20 && currentPrice > sma50 && sma20 > sma50) {
    return 'BULL';
  } else if (slopePercent < -2 && currentPrice < sma20 && currentPrice < sma50 && sma20 < sma50) {
    return 'BEAR';
  }
  return 'RANGE';
}

// ---------------------------------------------------------------------------
// 3. Professional Recommendation Logic
// ---------------------------------------------------------------------------

interface RecommendationResult {
  action: string;
  action_ar: string;
  confidence: number;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  risk_reward_ratio: number;
  time_horizon: string;
  time_horizon_ar: string;
  summary_ar: string;
}

function generateRecommendation(
  composite: number,
  technical: number,
  value: number,
  quality: number,
  momentum: number,
  risk: number,
  currentPrice: number,
  support1: number,
  resistance1: number,
  atr: number
): RecommendationResult {
  let action: string;
  let actionAr: string;
  let confidenceBase: number;

  if (composite >= 82) {
    action = 'strong_buy';
    actionAr = 'شراء قوي';
    confidenceBase = 0.85;
  } else if (composite >= 68) {
    action = 'buy';
    actionAr = 'شراء';
    confidenceBase = 0.70;
  } else if (composite >= 52) {
    action = 'accumulate';
    actionAr = 'تجميع';
    confidenceBase = 0.58;
  } else if (composite >= 42) {
    action = 'hold';
    actionAr = 'احتفاظ';
    confidenceBase = 0.50;
  } else if (composite >= 28) {
    action = 'sell';
    actionAr = 'بيع';
    confidenceBase = 0.60;
  } else {
    action = 'strong_sell';
    actionAr = 'بيع قوي';
    confidenceBase = 0.80;
  }

  // Adjust confidence based on score distance from threshold
  const thresholds = [28, 42, 52, 68, 82];
  let minDist = 100;
  for (const t of thresholds) {
    const dist = Math.abs(composite - t);
    if (dist < minDist) minDist = dist;
  }
  const confidenceAdjust = clamp(1 - minDist / 30, 0, 0.15);
  const confidence = clamp(round(confidenceBase + confidenceAdjust, 2), 0.3, 0.97);

  // Entry price — current price or slightly below for buy signals
  const isBuySignal = composite >= 52;
  const entryPrice = isBuySignal
    ? round(currentPrice * (1 - 0.005), 4) // enter at 0.5% below current
    : round(currentPrice, 4);

  // Target price — capped at 30% above current for EGX (less volatile than US markets)
  let targetPrice: number;
  const maxTargetPrice = currentPrice * 1.30; // Max 30% upside
  if (isBuySignal) {
    // Target based on resistance and momentum
    const range = resistance1 - currentPrice;
    const momentumBoost = momentum >= 60 ? 0.05 : 0; // Reduced from 0.1 to 0.05
    targetPrice = range > 0
      ? round(Math.min(currentPrice + range * (0.4 + momentumBoost), maxTargetPrice), 4)
      : round(Math.min(currentPrice * 1.05, maxTargetPrice), 4); // 5% upside if no clear resistance
  } else {
    // Sell signal — target lower
    targetPrice = round(currentPrice * 0.92, 4);
  }

  // Stop loss — based on ATR and support
  let stopLoss: number;
  if (isBuySignal) {
    stopLoss = support1 > 0
      ? round(support1 * 0.98, 4) // just below support
      : round(currentPrice - atr * 2, 4); // 2× ATR below current
    stopLoss = Math.max(stopLoss, round(currentPrice * 0.90, 4)); // max 10% loss
  } else {
    stopLoss = round(currentPrice + atr * 2, 4); // 2× ATR above for sell
  }

  // Risk-reward ratio
  const potentialGain = Math.abs(targetPrice - entryPrice);
  const potentialLoss = Math.abs(entryPrice - stopLoss);
  const riskRewardRatio = potentialLoss > 0 ? round(potentialGain / potentialLoss, 2) : 0;

  // Time horizon
  let timeHorizon: string;
  let timeHorizonAr: string;
  if (momentum >= 70 || composite >= 75) { timeHorizon = 'short_term'; timeHorizonAr = 'قصير الأجل'; }
  else if (value >= 65 && quality >= 60) { timeHorizon = 'long_term'; timeHorizonAr = 'طويل الأجل'; }
  else { timeHorizon = 'medium_term'; timeHorizonAr = 'متوسط الأجل'; }

  // Arabic summary
  const horizonAr =
    timeHorizon === 'short_term' ? 'قصير الأجل' :
    timeHorizon === 'long_term' ? 'طويل الأجل' : 'متوسط الأجل';

  const riskLevelAr =
    risk >= 65 ? 'مرتفعة' :
    risk >= 40 ? 'متوسطة' : 'منخفضة';

  const rrAr = riskRewardRatio >= 2 ? 'ممتازة' :
    riskRewardRatio >= 1.5 ? 'جيدة' :
    riskRewardRatio >= 1 ? 'مقبولة' : 'ضعيفة';

  let summaryAr: string;
  if (action === 'strong_buy') {
    summaryAr = `تحليل ${actionAr} بثقة ${Math.round(confidence * 100)}%. المؤشرات الفنية والأساسية تدعم ارتفاع السعر مع نسبة عائد/مخاطر ${rrAr}. الأفق الزمني ${horizonAr}. مستوى المخاطر ${riskLevelAr}.`;
  } else if (action === 'buy') {
    summaryAr = `تحليل ${actionAr} بثقة ${Math.round(confidence * 100)}%. توجد فرصة شراء واعدة بناءً على التحليل الفني والأساسي. نسبة عائد/مخاطر ${rrAr}. الأفق الزمني ${horizonAr}.`;
  } else if (action === 'accumulate') {
    summaryAr = `تحليل ${actionAr} بتدرج. يمكن البدء في بناء مركز مع مراقبة مستويات الدعم والمقاومة. الأفق الزمني ${horizonAr}.`;
  } else if (action === 'hold') {
    summaryAr = `تحليل ${actionAr}. لا يوجد دليل كافٍ للبيع أو الشراء. يُنصح بالانتظار ومراقبة تطور المؤشرات. مستوى المخاطر ${riskLevelAr}.`;
  } else if (action === 'sell') {
    summaryAr = `تحليل ${actionAr}. المؤشرات تشير إلى ضعف محتمل. يُنصح بتقليل التعرض مع وضع أوامر وقف الخسارة. الأفق الزمني ${horizonAr}.`;
  } else {
    summaryAr = `تحليل ${actionAr}. توجد إشارات سلبية قوية. يُنصح بالخروج من المركز فورًا مع الحذر من المزيد من الانخفاض. مستوى المخاطر ${riskLevelAr}.`;
  }

  return {
    action,
    action_ar: actionAr,
    confidence,
    entry_price: entryPrice,
    target_price: targetPrice,
    stop_loss: stopLoss,
    risk_reward_ratio: riskRewardRatio,
    time_horizon: timeHorizon,
    time_horizon_ar: timeHorizonAr,
    summary_ar: summaryAr,
  };
}

// ---------------------------------------------------------------------------
// 4. Pattern Detection
// ---------------------------------------------------------------------------

interface DetectedPattern {
  name: string;
  name_ar: string;
  type: 'bullish' | 'bearish' | 'neutral';
  reliability: string;
}

/** Detect chart patterns in price history */
function detectPatterns(closes: number[], data: PricePoint[]): DetectedPattern[] {
  const patterns: DetectedPattern[] = [];
  if (closes.length < 20) return patterns;

  const recent = closes.slice(-40); // last 40 data points for pattern detection
  if (recent.length < 20) return patterns;

  // --- Double Top Detection ---
  // Look for two peaks of similar height with a trough between them
  if (recent.length >= 15) {
    const lookback = Math.min(20, recent.length);
    const segment = recent.slice(-lookback);
    const max1 = Math.max(...segment.slice(0, Math.floor(lookback / 2)));
    const max2 = Math.max(...segment.slice(Math.floor(lookback / 2)));
    const minBetween = Math.min(...segment.slice(Math.floor(lookback * 0.3), Math.ceil(lookback * 0.7)));
    const tolerance = 0.03; // 3% tolerance for similar peaks
    const avgPrice = sma(recent, Math.min(10, recent.length));

    if (max1 > 0 && max2 > 0 && minBetween > 0) {
      const peakDiff = Math.abs(max1 - max2) / ((max1 + max2) / 2);
      if (peakDiff < tolerance && minBetween < max1 * 0.97 && minBetween < max2 * 0.97) {
        patterns.push({
          name: 'Double Top',
          name_ar: 'قمة مزدوجة',
          type: 'bearish',
          reliability: 'متوسطة',
        });
      }
    }
  }

  // --- Double Bottom Detection ---
  if (recent.length >= 15) {
    const lookback = Math.min(20, recent.length);
    const segment = recent.slice(-lookback);
    const min1 = Math.min(...segment.slice(0, Math.floor(lookback / 2)));
    const min2 = Math.min(...segment.slice(Math.floor(lookback / 2)));
    const maxBetween = Math.max(...segment.slice(Math.floor(lookback * 0.3), Math.ceil(lookback * 0.7)));
    const tolerance = 0.03;

    if (min1 > 0 && min2 > 0 && maxBetween > 0) {
      const troughDiff = Math.abs(min1 - min2) / ((min1 + min2) / 2);
      if (troughDiff < tolerance && maxBetween > min1 * 1.03 && maxBetween > min2 * 1.03) {
        patterns.push({
          name: 'Double Bottom',
          name_ar: 'قاع مزدوج',
          type: 'bullish',
          reliability: 'متوسطة',
        });
      }
    }
  }

  // --- Head & Shoulders Detection ---
  if (recent.length >= 25) {
    const segment = recent.slice(-25);
    const third = Math.floor(25 / 3);
    const leftMax = Math.max(...segment.slice(0, third));
    const midMax = Math.max(...segment.slice(third, 2 * third));
    const rightMax = Math.max(...segment.slice(2 * third));
    const leftMin = Math.min(...segment.slice(0, third));
    const rightMin = Math.min(...segment.slice(2 * third));
    const tolerance = 0.04;

    // Head is highest, shoulders similar, neckline at similar lows
    if (
      midMax > leftMax * (1 + tolerance) &&
      midMax > rightMax * (1 + tolerance) &&
      Math.abs(leftMax - rightMax) / ((leftMax + rightMax) / 2) < tolerance * 2
    ) {
      const necklineTolerance = 0.05;
      const necklineDiff = Math.abs(leftMin - rightMin) / ((leftMin + rightMin) / 2 || 1);
      if (necklineDiff < necklineTolerance) {
        patterns.push({
          name: 'Head and Shoulders',
          name_ar: 'الرأس والكتفين',
          type: 'bearish',
          reliability: 'عالية',
        });
      }
    }
  }

  // --- Inverted Head & Shoulders ---
  if (recent.length >= 25) {
    const segment = recent.slice(-25);
    const third = Math.floor(25 / 3);
    const leftMin = Math.min(...segment.slice(0, third));
    const midMin = Math.min(...segment.slice(third, 2 * third));
    const rightMin = Math.min(...segment.slice(2 * third));
    const leftMax = Math.max(...segment.slice(0, third));
    const rightMax = Math.max(...segment.slice(2 * third));
    const tolerance = 0.04;

    if (
      midMin < leftMin * (1 - tolerance) &&
      midMin < rightMin * (1 - tolerance) &&
      Math.abs(leftMin - rightMin) / ((leftMin + rightMin) / 2 || 1) < tolerance * 2
    ) {
      const necklineDiff = Math.abs(leftMax - rightMax) / ((leftMax + rightMax) / 2 || 1);
      if (necklineDiff < 0.05) {
        patterns.push({
          name: 'Inverse Head and Shoulders',
          name_ar: 'الرأس والكتفين المقلوب',
          type: 'bullish',
          reliability: 'عالية',
        });
      }
    }
  }

  // --- Triangle Pattern Detection ---
  if (recent.length >= 20) {
    const segment = recent.slice(-20);
    const firstHalfHighs = segment.slice(0, 10).reduce((max, v) => Math.max(max, v), 0);
    const secondHalfHighs = segment.slice(10).reduce((max, v) => Math.max(max, v), 0);
    const firstHalfLows = segment.slice(0, 10).reduce((min, v) => Math.min(min, v), Infinity);
    const secondHalfLows = segment.slice(10).reduce((min, v) => Math.min(min, v), Infinity);

    const highsConverging = secondHalfHighs < firstHalfHighs;
    const lowsRising = secondHalfLows > firstHalfLows;
    const highsRising = secondHalfHighs > firstHalfHighs;
    const lowsConverging = secondHalfLows < firstHalfLows;

    if (highsConverging && lowsRising) {
      patterns.push({
        name: 'Ascending Triangle',
        name_ar: 'مثلث صاعد',
        type: 'bullish',
        reliability: 'متوسطة',
      });
    } else if (lowsConverging && highsRising) {
      patterns.push({
        name: 'Descending Triangle',
        name_ar: 'مثلث هابط',
        type: 'bearish',
        reliability: 'متوسطة',
      });
    } else if (highsConverging && lowsConverging) {
      patterns.push({
        name: 'Symmetrical Triangle',
        name_ar: 'مثلث متماثل',
        type: 'neutral',
        reliability: 'منخفضة',
      });
    }
  }

  // --- Channel Detection ---
  if (closes.length >= 40) {
    const last40 = closes.slice(-40);
    const upperChannel: number[] = [];
    const lowerChannel: number[] = [];
    const windowSize = 10;

    // Compute rolling highs and lows
    for (let i = windowSize - 1; i < last40.length; i++) {
      upperChannel.push(Math.max(...last40.slice(i - windowSize + 1, i + 1)));
      lowerChannel.push(Math.min(...last40.slice(i - windowSize + 1, i + 1)));
    }

    if (upperChannel.length >= 15) {
      // Check if upper channel has an upward/downward slope
      const firstThirdUpper = sma(upperChannel.slice(0, Math.floor(upperChannel.length / 3)), Math.floor(upperChannel.length / 3));
      const lastThirdUpper = sma(upperChannel.slice(-Math.floor(upperChannel.length / 3)), Math.floor(upperChannel.length / 3));
      const firstThirdLower = sma(lowerChannel.slice(0, Math.floor(lowerChannel.length / 3)), Math.floor(lowerChannel.length / 3));
      const lastThirdLower = sma(lowerChannel.slice(-Math.floor(lowerChannel.length / 3)), Math.floor(lowerChannel.length / 3));

      const upperSlope = firstThirdUpper > 0 ? (lastThirdUpper - firstThirdUpper) / firstThirdUpper : 0;
      const lowerSlope = firstThirdLower > 0 ? (lastThirdLower - firstThirdLower) / firstThirdLower : 0;

      // Channel: both upper and lower trend in same direction
      if (upperSlope > 0.03 && lowerSlope > 0.03) {
        patterns.push({
          name: 'Ascending Channel',
          name_ar: 'قناة صاعدة',
          type: 'bullish',
          reliability: 'متوسطة',
        });
      } else if (upperSlope < -0.03 && lowerSlope < -0.03) {
        patterns.push({
          name: 'Descending Channel',
          name_ar: 'قناة هابطة',
          type: 'bearish',
          reliability: 'متوسطة',
        });
      } else if (Math.abs(upperSlope) < 0.02 && Math.abs(lowerSlope) < 0.02) {
        patterns.push({
          name: 'Horizontal Channel',
          name_ar: 'قناة أفقية',
          type: 'neutral',
          reliability: 'منخفضة',
        });
      }
    }
  }

  // Remove duplicate patterns and limit to 4
  const seen = new Set<string>();
  const unique: DetectedPattern[] = [];
  for (const p of patterns) {
    if (!seen.has(p.name)) {
      seen.add(p.name);
      unique.push(p);
    }
  }

  return unique.slice(0, 4);
}

/** Detect MA crossovers */
function detectMACross(
  mas: { ma50: number; ma200: number; ma20: number; ma10: number },
  closes: number[]
): string | null {
  if (closes.length < 50) return null;

  // Golden Cross: MA50 crosses above MA200
  if (mas.ma50 > 0 && mas.ma200 > 0) {
    // Check recent crossover
    const lookback = Math.min(10, closes.length - 50);
    if (lookback >= 2) {
      const recentSlice = closes.slice(-(50 + lookback));
      for (let i = recentSlice.length - 1; i >= Math.max(50, recentSlice.length - lookback); i--) {
        const ma50prev = sma(recentSlice.slice(0, i), 50);
        const ma200prev = sma(recentSlice.slice(0, i), 200);
        if (ma200prev > 0 && ma50prev > 0) {
          if (ma50prev > ma200prev && mas.ma50 > mas.ma200) {
            // Check if this is recent (within last 10 periods)
            const daysAgo = recentSlice.length - 1 - i;
            if (daysAgo <= 10) {
              return 'golden_cross';
            }
            break;
          }
        }
      }

      for (let i = recentSlice.length - 1; i >= Math.max(50, recentSlice.length - lookback); i--) {
        const ma50prev = sma(recentSlice.slice(0, i), 50);
        const ma200prev = sma(recentSlice.slice(0, i), 200);
        if (ma200prev > 0 && ma50prev > 0) {
          if (ma50prev < ma200prev && mas.ma50 < mas.ma200) {
            const daysAgo = recentSlice.length - 1 - i;
            if (daysAgo <= 10) {
              return 'death_cross';
            }
            break;
          }
        }
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// 5. Risk Metrics
// ---------------------------------------------------------------------------

/** Maximum drawdown calculation */
function calculateMaxDrawdown(closes: number[]): { maxDrawdown: number; maxDrawdownPercent: number } {
  if (closes.length === 0) return { maxDrawdown: 0, maxDrawdownPercent: 0 };

  let peak = closes[0];
  let maxDD = 0;
  let maxDDPercent = 0;
  let peakValue = peak;
  let troughValue = peak;

  for (const close of closes) {
    if (close > peak) {
      peak = close;
    }
    const dd = peak - close;
    const ddPercent = peak > 0 ? (dd / peak) * 100 : 0;
    if (dd > maxDD) {
      maxDD = dd;
      maxDDPercent = ddPercent;
      peakValue = peak;
      troughValue = close;
    }
  }

  return { maxDrawdown: round(maxDD, 4), maxDrawdownPercent: round(maxDDPercent, 2) };
}

/** Sharpe Ratio (assumes risk-free rate of ~15% for Egypt) */
function calculateSharpeRatio(closes: number[], riskFreeRate: number = 0.15): number {
  if (closes.length < 20) return 0;

  const dailyRF = riskFreeRate / 252;
  const returns: number[] = [];

  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
  }

  if (returns.length < 10) return 0;

  const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const excessReturn = avgReturn - dailyRF;
  const vol = stddev(returns, Math.min(returns.length, 252));

  if (vol === 0) return 0;

  const annualizedSharpe = (excessReturn / vol) * Math.sqrt(252);
  return round(clamp(annualizedSharpe, -5, 5), 2);
}

/** Value at Risk at 95% confidence (parametric) */
function calculateVaR95(closes: number[]): number {
  if (closes.length < 20) return 0;

  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
  }

  if (returns.length < 10) return 0;

  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const vol = stddev(returns, Math.min(returns.length, 252));

  // 95% VaR = mean - 1.645 * volatility (1-day)
  const var95 = mean - 1.645 * vol;
  return round(var95 * 100, 2); // as percentage
}

/** Beta coefficient vs a benchmark (EGX30 proxy: we use the stock's own MA200 as market proxy if no benchmark given) */
function calculateBeta(stockReturns: number[], benchmarkReturns: number[]): number {
  if (stockReturns.length < 20 || benchmarkReturns.length < 20) return 1;

  const n = Math.min(stockReturns.length, benchmarkReturns.length);
  const stockSlice = stockReturns.slice(-n);
  const benchSlice = benchmarkReturns.slice(-n);

  const stockMean = stockSlice.reduce((s, r) => s + r, 0) / n;
  const benchMean = benchSlice.reduce((s, r) => s + r, 0) / n;

  let covariance = 0;
  let benchVariance = 0;

  for (let i = 0; i < n; i++) {
    covariance += (stockSlice[i] - stockMean) * (benchSlice[i] - benchMean);
    benchVariance += (benchSlice[i] - benchMean) ** 2;
  }

  covariance /= n;
  benchVariance /= n;

  if (benchVariance === 0) return 1;
  return round(clamp(covariance / benchVariance, -3, 3), 2);
}

/** Calculate daily returns for a price series */
// ---------------------------------------------------------------------------
// Fair Value Calculations
// ---------------------------------------------------------------------------

/** Sector-specific average P/E ratios for the Egyptian market */
const SECTOR_AVG_PE: Record<string, number> = {
  'Banks': 12,
  'Financial Services': 11,
  'Real Estate': 10,
  'Chemicals': 8,
  'Construction': 9,
  'Food & Beverage': 14,
  'Healthcare': 15,
  'Telecommunications': 10,
  'Energy': 8,
  'Utilities': 9,
  'Industrial': 10,
  'Technology': 18,
  'Media': 12,
  'Insurance': 10,
  'Investment': 8,
  'Textiles': 7,
  'Mining': 8,
  'Tourism': 10,
  'Automotive': 9,
  'Transport': 8,
};

/** Estimate growth rate from historical price data (CAGR) */
function estimateGrowthRate(closes: number[]): number {
  if (closes.length < 60) return 5; // default 5% if not enough data

  // Use 1-year CAGR from the last 252 data points
  const lookback = Math.min(252, closes.length - 1);
  const startPrice = closes[closes.length - 1 - lookback];
  const endPrice = closes[closes.length - 1];

  if (startPrice <= 0 || endPrice <= 0) return 5;

  const years = lookback / 252;
  const cagr = (Math.pow(endPrice / startPrice, 1 / years) - 1) * 100;
  return clamp(round(cagr, 1), -20, 40);
}

/** Calculate fair value using multiple methods and return detailed results */
function calculateFairValue(
  stock: Record<string, unknown>,
  closes: number[]
): ProfessionalAnalysis['fair_value'] {
  const currentPrice = toNum(stock.current_price);
  const eps = toNum(stock.eps);
  const pb = toNum(stock.pb_ratio);
  const pe = toNum(stock.pe_ratio);
  const sector = String(stock.sector || '');
  const marketCap = toNum(stock.market_cap);
  // sharesOutstanding is available but not directly used in calculation
  // (BVPS is derived from P/B ratio instead)

  // Book Value Per Share
  let bvps: number;
  if (pb > 0 && currentPrice > 0) {
    bvps = currentPrice / pb; // BVPS = Price / P/B
  } else {
    bvps = 0;
  }

  // Growth rate from price history
  const growthRate = estimateGrowthRate(closes);

  // Risk-free rate for Egypt (average of deposit rates)
  const riskFreeRate = 17.5; // Egyptian central bank rate approximately 15-20%

  // Sector average P/E (fallback to market average ~12)
  const sectorAvgPE = SECTOR_AVG_PE[sector] || 12;

  // Effective PEG (P/E / growth rate)
  const peg = eps > 0 && pe > 0 && growthRate > 0 ? pe / growthRate : 1.5;

  // --- Data Quality Check ---
  // Real earnings yield is typically 5-20%, so EPS/Price > 1.5 means bad data
  const epsReasonable = eps > 0 && eps < currentPrice * 1.5;
  const peReasonable = pe > 0 && pe < 100;
  const pbReasonable = pb > 0 && pb < 20;
  const fundamentalDataReliable = epsReasonable && peReasonable && pbReasonable;

  // --- 1. Graham Number ---
  // Fair Value = √(22.5 × EPS × BVPS)
  // Capped at 2× current price to prevent unrealistic values from bad data
  let grahamNumber = 0;
  if (eps > 0 && bvps > 0 && fundamentalDataReliable) {
    grahamNumber = Math.sqrt(22.5 * eps * bvps);
    grahamNumber = round(Math.min(Math.max(grahamNumber, 0), currentPrice * 2), 2);
  }

  // --- 2. Peter Lynch Fair Value ---
  // Fair Value = PEG × EPS × Growth Rate
  // Capped at 2× current price
  let lynchValue = 0;
  if (eps > 0 && growthRate > 0 && fundamentalDataReliable) {
    // Simplified Peter Lynch: FV = EPS × Growth Rate (using PEG = 1 as fair benchmark)
    lynchValue = eps * (1 + growthRate / 100) * Math.min(peg, 1.5); // Cap PEG at 1.5
    lynchValue = round(Math.min(Math.max(lynchValue, 0), currentPrice * 2), 2);
  }

  // --- 3. DCF Simplified (Graham's Intrinsic Value Formula) ---
  // FV = EPS × (8.5 + 2g) × (4.4 / risk_free_rate)
  // Capped at 2× current price; only use if fundamental data is reliable
  let dcfSimplified = 0;
  if (eps > 0 && fundamentalDataReliable) {
    const g = clamp(growthRate, 0, 25); // cap growth rate
    dcfSimplified = eps * (8.5 + 2 * g) * (4.4 / riskFreeRate);
    dcfSimplified = round(Math.min(Math.max(dcfSimplified, 0), currentPrice * 2), 2);
  }

  // --- 4. P/E Based Fair Value ---
  // FV = Sector Average P/E × EPS
  // Capped at 2× current price
  let peBased = 0;
  if (eps > 0 && fundamentalDataReliable) {
    peBased = sectorAvgPE * eps;
    peBased = round(Math.min(Math.max(peBased, 0), currentPrice * 2), 2);
  }

  // --- Calculate Average ---
  const validValues: number[] = [grahamNumber, lynchValue, dcfSimplified, peBased].filter(v => v > 0);
  const averageFairValue = validValues.length > 0
    ? round(validValues.reduce((s, v) => s + v, 0) / validValues.length, 2)
    : currentPrice;

  // --- Upside to fair value ---
  const upsideToFair = currentPrice > 0
    ? round(((averageFairValue - currentPrice) / currentPrice) * 100, 2)
    : 0;

  // --- Verdict ---
  let verdict: 'undervalued' | 'fair' | 'overvalued';
  let verdictAr: string;
  if (upsideToFair >= 15) {
    verdict = 'undervalued';
    verdictAr = 'مقوم بأقل من قيمته';
  } else if (upsideToFair >= -15) {
    verdict = 'fair';
    verdictAr = 'عادل التقييم';
  } else {
    verdict = 'overvalued';
    verdictAr = 'مقوم بأكثر من قيمته';
  }

  // --- Build calculation detail strings ---
  const grahamCalc = bvps > 0 && eps > 0
    ? `√(22.5 × ${eps.toFixed(2)} × ${bvps.toFixed(2)}) = √(${(22.5 * eps * bvps).toFixed(2)}) = ${grahamNumber.toFixed(2)}`
    : `غير متاح (EPS أو BVPS غير صالح)`;

  const lynchCalc = eps > 0 && growthRate > 0
    ? `${peg.toFixed(2)} × ${eps.toFixed(2)} × ${growthRate.toFixed(1)}% = ${lynchValue.toFixed(2)}`
    : `غير متاح (EPS أو معدل النمو غير صالح)`;

  const g = clamp(growthRate, 0, 25);
  const dcfCalc = eps > 0
    ? `${eps.toFixed(2)} × (8.5 + 2×${g.toFixed(1)}) × (4.4 / ${riskFreeRate}) = ${eps.toFixed(2)} × ${(8.5 + 2 * g).toFixed(1)} × ${(4.4 / riskFreeRate).toFixed(4)} = ${dcfSimplified.toFixed(2)}`
    : `غير متاح (EPS غير صالح)`;

  const peCalc = eps > 0
    ? `${sectorAvgPE} × ${eps.toFixed(2)} = ${peBased.toFixed(2)} (متوسط P/E قطاع ${sector || 'السوق'})`
    : `غير متاح (EPS غير صالح)`;

  return {
    graham_number: grahamNumber,
    lynch_value: lynchValue,
    dcf_simplified: dcfSimplified,
    pe_based: peBased,
    average_fair_value: averageFairValue,
    upside_to_fair: upsideToFair,
    verdict,
    verdict_ar: verdictAr,
    data_quality: fundamentalDataReliable ? 'reliable' : 'unreliable',
    data_quality_warning: fundamentalDataReliable ? null : 'بيانات الأساسيات (EPS، P/E، P/B) قد تكون غير دقيقة — يُنصح بالتحقق من مصادر أخرى',
    details: {
      eps,
      book_value_per_share: bvps,
      growth_rate: growthRate,
      risk_free_rate: riskFreeRate,
      sector_avg_pe: sectorAvgPE,
      graham_calc: grahamCalc,
      lynch_calc: lynchCalc,
      dcf_calc: dcfCalc,
      pe_calc: peCalc,
    },
  };
}

function getDailyReturns(closes: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
  }
  return returns;
}

// ---------------------------------------------------------------------------
// Support / Resistance / Pivot
// ---------------------------------------------------------------------------

interface PriceLevels {
  support_1: number;
  support_2: number;
  resistance_1: number;
  resistance_2: number;
  pivot: number;
}

function calculatePriceLevels(
  stock: Record<string, unknown>,
  data: PricePoint[],
  closes: number[]
): PriceLevels {
  const currentPrice = toNum(stock.current_price);
  const stockSupport = toNum(stock.support_level);
  const stockResistance = toNum(stock.resistance_level);

  // Use stock's pre-computed support/resistance if available and reasonable
  const hasValidSupport = stockSupport > 0 && stockSupport < currentPrice * 1.2;
  const hasValidResistance = stockResistance > 0 && stockResistance > currentPrice * 0.8;

  let support1 = hasValidSupport ? stockSupport : currentPrice;
  let resistance1 = hasValidResistance ? stockResistance : currentPrice;

  // Also compute from recent price action if we have enough data
  if (data.length >= 20) {
    const recent20 = data.slice(-20);
    const recentLow = Math.min(...recent20.map((p) => p.low));
    const recentHigh = Math.max(...recent20.map((p) => p.high));

    if (!hasValidSupport || recentLow < support1) {
      support1 = Math.min(recentLow, currentPrice);
    }
    if (!hasValidResistance || recentHigh > resistance1) {
      resistance1 = Math.max(recentHigh, currentPrice);
    }
  }

  // Secondary levels: wider lookback
  if (closes.length >= 50) {
    const recent50Lows = data.slice(-50).map((p) => p.low);
    const recent50Highs = data.slice(-50).map((p) => p.high);
    const support2 = Math.min(...recent50Lows);
    const resistance2 = Math.max(...recent50Highs);

    return {
      support_1: round(support1, 4),
      support_2: round(Math.min(support2, support1), 4),
      resistance_1: round(resistance1, 4),
      resistance_2: round(Math.max(resistance2, resistance1), 4),
      pivot: round((support1 + resistance1 + currentPrice) / 3, 4),
    };
  }

  return {
    support_1: round(support1, 4),
    support_2: round(support1 * 0.97, 4),
    resistance_1: round(resistance1, 4),
    resistance_2: round(resistance1 * 1.03, 4),
    pivot: round((support1 + resistance1 + currentPrice) / 3, 4),
  };
}

// ---------------------------------------------------------------------------
// Trend Analysis
// ---------------------------------------------------------------------------

interface TrendResult {
  direction: string;
  direction_ar: string;
  strength: 'strong' | 'moderate' | 'weak';
  strength_ar: string;
}

function analyzeTrend(
  stock: Record<string, unknown>,
  closes: number[],
  mas: { ma5: number; ma10: number; ma20: number; ma50: number; ma200: number }
): TrendResult {
  if (closes.length < 10) {
    return { direction: 'neutral', direction_ar: 'عرضي', strength: 'weak', strength_ar: 'ضعيف' };
  }

  const currentPrice = closes[closes.length - 1];
  const stockMA50 = toNum(stock.ma_50);
  const stockMA200 = toNum(stock.ma_200);
  const ma50 = stockMA50 > 0 ? stockMA50 : mas.ma50;
  const ma200 = stockMA200 > 0 ? stockMA200 : mas.ma200;

  // Price vs MAs alignment for direction
  let bullishSignals = 0;
  let bearishSignals = 0;

  if (currentPrice > mas.ma5) bullishSignals++;
  else bearishSignals++;

  if (currentPrice > mas.ma20) bullishSignals++;
  else bearishSignals++;

  if (ma50 > 0 && currentPrice > ma50) bullishSignals++;
  else if (ma50 > 0) bearishSignals++;

  if (ma200 > 0 && currentPrice > ma200) bullishSignals++;
  else if (ma200 > 0) bearishSignals++;

  if (ma50 > 0 && ma200 > 0 && ma50 > ma200) bullishSignals++;
  else if (ma50 > 0 && ma200 > 0) bearishSignals++;

  let direction: string;
  let directionAr: string;

  if (bullishSignals >= 4) {
    direction = 'bullish';
    directionAr = 'صاعد';
  } else if (bearishSignals >= 4) {
    direction = 'bearish';
    directionAr = 'هابط';
  } else {
    direction = 'neutral';
    directionAr = 'عرضي';
  }

  // Strength: based on how far price is from MAs and consistency of direction
  let strengthScore = 0;
  if (currentPrice > 0 && mas.ma20 > 0) {
    strengthScore += Math.min(Math.abs(currentPrice - mas.ma20) / mas.ma20 * 100, 15);
  }
  if (currentPrice > 0 && ma50 > 0) {
    strengthScore += Math.min(Math.abs(currentPrice - ma50) / ma50 * 100, 15);
  }

  // Add ADX-like strength from recent movement
  if (closes.length >= 10) {
    const recent10 = closes.slice(-10);
    const highestHigh = Math.max(...recent10);
    const lowestLow = Math.min(...recent10);
    const range = highestHigh - lowestLow;
    if (currentPrice > 0) {
      strengthScore += Math.min((range / currentPrice) * 100 * 5, 20);
    }
  }

  let strength: 'strong' | 'moderate' | 'weak';
  let strengthAr: string;
  if (strengthScore >= 15) {
    strength = 'strong';
    strengthAr = 'قوي';
  } else if (strengthScore >= 7) {
    strength = 'moderate';
    strengthAr = 'متوسط';
  } else {
    strength = 'weak';
    strengthAr = 'ضعيف';
  }

  return { direction, direction_ar: directionAr, strength, strength_ar: strengthAr };
}

// ---------------------------------------------------------------------------
// Volume Analysis
// ---------------------------------------------------------------------------

interface VolumeAnalysis {
  avg_volume_20: number;
  current_vs_avg: number;
  signal: string;
  signal_ar: string;
}

function analyzeVolume(data: PricePoint[]): VolumeAnalysis {
  if (data.length < 2) {
    return { avg_volume_20: 0, current_vs_avg: 1, signal: 'neutral', signal_ar: 'طبيعي' };
  }

  const recent20 = data.slice(-20);
  const avgVolume = recent20.reduce((s, p) => s + p.volume, 0) / recent20.length;
  const currentVolume = data[data.length - 1].volume;
  const ratio = avgVolume > 0 ? currentVolume / avgVolume : 1;

  let signal: string;
  let signalAr: string;

  if (ratio >= 2.5) {
    signal = 'very_high';
    signalAr = 'حجم تداول مرتفع جدًا — تحرك قوي';
  } else if (ratio >= 1.5) {
    signal = 'high';
    signalAr = 'حجم تداول أعلى من المتوسط — اهتمام متزايد';
  } else if (ratio >= 0.8) {
    signal = 'normal';
    signalAr = 'حجم تداول طبيعي';
  } else if (ratio >= 0.5) {
    signal = 'low';
    signalAr = 'حجم تداول منخفض — ضعف في السيولة';
  } else {
    signal = 'very_low';
    signalAr = 'حجم تداول منخفض جدًا — تعامل ضعيف';
  }

  return {
    avg_volume_20: round(avgVolume, 0),
    current_vs_avg: round(ratio, 2),
    signal,
    signal_ar: signalAr,
  };
}

// ---------------------------------------------------------------------------
// Main Export: Professional Analysis
// ---------------------------------------------------------------------------

/**
 * Calculate a comprehensive professional analysis for a given stock.
 *
 * @param stock    - A record with all stock fields (current_price, pe_ratio, etc.)
 * @param priceHistory - Array of price history records with OHLCV fields
 * @returns A ProfessionalAnalysis object with scores, recommendations, indicators, etc.
 */
export function calculateProfessionalAnalysis(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>
): ProfessionalAnalysis {
  // -----------------------------------------------------------------------
  // 0. Normalize data
  // -----------------------------------------------------------------------
  const data = normalizePriceHistory(priceHistory);
  const closes = data.map((p) => p.close);
  const currentPrice = toNum(stock.current_price);
  const dataQuality: 'high' | 'medium' | 'low' =
    data.length >= 50 ? 'high' : data.length >= 20 ? 'medium' : 'low';

  // -----------------------------------------------------------------------
  // 1. Technical Indicators
  // -----------------------------------------------------------------------
  const macdResult = calculateMACD(closes);
  const bollingerResult = calculateBollingerBands(closes);
  const stochRSI = calculateStochasticRSI(closes);
  const rsiValue = calculateRSI(closes);
  const atrValue = calculateATR(data);
  const atrPercent = currentPrice > 0 ? round((atrValue / currentPrice) * 100, 2) : 0;
  const obvValue = calculateOBV(data);
  const obvTrend = getOBVTrend(data);
  const vwapValue = calculateVWAP(data.slice(-20)); // VWAP over recent 20 periods
  const rocResult = calculateROC(closes);
  const mas = calculateMAs(closes);

  // MACD signal text
  const macdSignalText =
    macdResult.histogram > 0 && macdResult.macdLine > macdResult.signalLine
      ? 'إشارة شرائية — الماكد فوق خط الإشارة'
      : macdResult.histogram < 0 && macdResult.macdLine < macdResult.signalLine
        ? 'إشارة بيعية — الماكد تحت خط الإشارة'
        : 'محايد — لا إشارة واضحة';

  // Bollinger signal text
  let bollingerPosition = 50; // default middle
  let bollingerSignalText = 'محايد';
  const bbRange = bollingerResult.upper - bollingerResult.lower;
  if (bbRange > 0 && currentPrice > 0) {
    bollingerPosition = round(((currentPrice - bollingerResult.lower) / bbRange) * 100, 1);
    if (bollingerPosition <= 20) bollingerSignalText = 'قرب الحد السفلي — منطقة تشبع بيعي محتملة';
    else if (bollingerPosition >= 80) bollingerSignalText = 'قرب الحد العلوي — منطقة تشبع شرائي محتملة';
    else if (bollingerPosition >= 60) bollingerSignalText = 'في النصف العلوي — زخم إيجابي';
    else if (bollingerPosition <= 40) bollingerSignalText = 'في النصف السفلي — ضغط بيعي';
    else bollingerSignalText = 'محايد — داخل النطاق الطبيعي';
  }

  // Stochastic RSI signal text
  const stochSignalText =
    stochRSI.k < 20
      ? 'تشبع بيعي — فرصة شراء محتملة'
      : stochRSI.k > 80
        ? 'تشبع شرائي — احتمال تصحيح'
        : stochRSI.k > stochRSI.d
          ? 'إشارة شرائية — %K فوق %D'
          : 'إشارة بيعية — %K تحت %D';

  // RSI signal text
  const rsiSignalText =
    rsiValue >= 70 ? 'overbought' : rsiValue <= 30 ? 'oversold' : 'neutral';

  // OBV trend Arabic
  const obvTrendAr =
    obvTrend === 'rising' ? 'تصاعدي — تأكيد من الحجم للاتجاه'
      : obvTrend === 'falling' ? 'تنازلي — ضعف في دعم الحجم'
      : 'محايد — لا اتجاه واضح للحجم';

  // ROC signal text
  const rocSignalText =
    rocResult.roc_5 > 3 && rocResult.roc_10 > 3
      ? 'زخم إيجابي قوي — تسارع في السعر'
      : rocResult.roc_5 < -3 && rocResult.roc_10 < -3
        ? 'زخم سلبي قوي — تسارع هبوطي'
        : rocResult.roc_5 > 0 && rocResult.roc_20 > 0
          ? 'زخم إيجابي — اتجاه صاعد'
          : rocResult.roc_5 < 0 && rocResult.roc_20 < 0
            ? 'زخم سلبي — اتجاه هابط'
            : 'زخم مختلط — تذبذب';

  const indicators = {
    rsi: {
      value: rsiValue,
      signal: rsiSignalText,
    },
    macd: {
      line: macdResult.macdLine,
      signal: macdResult.signalLine,
      histogram: macdResult.histogram,
      signal_text: macdSignalText,
    },
    bollinger: {
      upper: bollingerResult.upper,
      middle: bollingerResult.middle,
      lower: bollingerResult.lower,
      position: bollingerPosition,
      signal_text: bollingerSignalText,
    },
    stochastic_rsi: {
      k: stochRSI.k,
      d: stochRSI.d,
      signal_text: stochSignalText,
    },
    atr: atrValue,
    atr_percent: atrPercent,
    obv: obvValue,
    obv_trend: obvTrendAr,
    vwap: vwapValue,
    roc: {
      roc_5: rocResult.roc_5,
      roc_10: rocResult.roc_10,
      roc_20: rocResult.roc_20,
      signal_text: rocSignalText,
    },
  };

  // -----------------------------------------------------------------------
  // 2. Risk Metrics
  // -----------------------------------------------------------------------
  const drawdown = calculateMaxDrawdown(closes);
  const sharpe = calculateSharpeRatio(closes);
  const var95 = calculateVaR95(closes);

  // Beta: use stock's own historical returns vs market proxy (50-period MA slope as market trend)
  const stockReturns = getDailyReturns(closes);
  // For beta without a real benchmark, we use a smoothed market proxy
  let beta = 1;
  if (closes.length >= 50) {
    // Create a pseudo-benchmark from the 50-day moving average returns
    const ma50Values: number[] = [];
    for (let i = 49; i < closes.length; i++) {
      ma50Values.push(sma(closes.slice(0, i + 1), 50));
    }
    const benchmarkReturns = getDailyReturns(ma50Values);
    beta = calculateBeta(stockReturns, benchmarkReturns);
  }

  // Annualized volatility
  let volatilityAnnualized = 0;
  if (stockReturns.length >= 20) {
    const dailyVol = stddev(stockReturns, Math.min(stockReturns.length, 252));
    volatilityAnnualized = round(dailyVol * Math.sqrt(252) * 100, 2);
  }

  const riskMetrics = {
    sharpe_ratio: sharpe,
    max_drawdown: drawdown.maxDrawdown,
    max_drawdown_percent: drawdown.maxDrawdownPercent,
    var_95: var95,
    beta,
    volatility_annualized: volatilityAnnualized,
  };

  // -----------------------------------------------------------------------
  // 3. Scoring
  // -----------------------------------------------------------------------
  const momentumScore = calculateMomentumScore(closes, macdResult.histogram, mas);
  const valueScore = calculateValueScore(stock);
  const qualityScore = calculateQualityScore(stock, closes);
  const technicalScore = calculateTechnicalScore(
    stock, closes, macdResult, bollingerResult, stochRSI, mas
  );
  const riskScore = calculateRiskScore(atrValue, atrPercent, drawdown.maxDrawdownPercent, closes, stock);

  // Detect market regime and get dynamic weights from self-learning system
  const regime = detectMarketRegime(closes);
  const dynamicWeights = getDynamicWeights(regime);
  const compositeScore = calculateCompositeScore(technicalScore, valueScore, qualityScore, momentumScore, riskScore, dynamicWeights);

  const scores = {
    composite: compositeScore,
    technical: technicalScore,
    value: valueScore,
    quality: qualityScore,
    momentum: momentumScore,
    risk: riskScore,
  };

  // -----------------------------------------------------------------------
  // 4. Pattern Detection
  // -----------------------------------------------------------------------
  const detectedPatterns = detectPatterns(closes, data);
  const maCross = detectMACross(mas, closes);

  // -----------------------------------------------------------------------
  // 5. Price Levels, Trend, Volume
  // -----------------------------------------------------------------------
  const priceLevels = calculatePriceLevels(stock, data, closes);
  const trend = analyzeTrend(stock, closes, mas);
  const volumeAnalysis = analyzeVolume(data);

  // -----------------------------------------------------------------------
  // 6. Recommendation
  // -----------------------------------------------------------------------
  const recommendation = generateRecommendation(
    compositeScore,
    technicalScore,
    valueScore,
    qualityScore,
    momentumScore,
    riskScore,
    currentPrice,
    priceLevels.support_1,
    priceLevels.resistance_1,
    atrValue,
  );

  // -----------------------------------------------------------------------
  // 7. Fair Value
  // -----------------------------------------------------------------------
  const fairValue = calculateFairValue(stock, closes);

  // -----------------------------------------------------------------------
  // Assemble & Return
  // -----------------------------------------------------------------------
  return {
    scores,
    recommendation,
    indicators,
    patterns: {
      detected: detectedPatterns,
      ma_cross: maCross,
    },
    risk_metrics: riskMetrics,
    price_levels: priceLevels,
    trend,
    volume_analysis: volumeAnalysis,
    data_quality: {
      history_points: data.length,
      quality: dataQuality,
    },
    fair_value: fairValue,
    regime: {
      current: regime,
      weights_source: dynamicWeights.source,
      applied_weights: {
        technical: dynamicWeights.technical,
        value: dynamicWeights.value,
        quality: dynamicWeights.quality,
        momentum: dynamicWeights.momentum,
        risk: dynamicWeights.risk,
      },
    },
  };
}

// ===========================================================================
// SECTION: Enhanced Indicators (ADX, Williams %R, CCI, Parabolic SAR,
//          Ichimoku Cloud, MFI)
// ===========================================================================

// ---------------------------------------------------------------------------
// New Type Definitions
// ---------------------------------------------------------------------------

/** ADX result with directional indicators */
export interface ADXResult {
  adx: number;
  plusDI: number;
  minusDI: number;
}

/** Parabolic SAR result */
export interface ParabolicSARResult {
  sar: number;
  isReversal: boolean;
  trend: 'up' | 'down';
}

/** Ichimoku Cloud result */
export interface IchimokuResult {
  tenkan: number;
  kijun: number;
  senkouA: number;
  senkouB: number;
  chikou: number;
  cloudTop: number;
  cloudBottom: number;
  trend: string;
  signal: string;
}

/** Enhanced indicators bundle */
export interface EnhancedIndicators {
  adx: ADXResult;
  williamsR: number;
  cci: number;
  parabolicSar: ParabolicSARResult;
  ichimoku: IchimokuResult;
  mfi: number;
}

/** Data coverage information for a stock analysis */
export interface DataCoverage {
  has_data: boolean;
  history_points: number;
  quality: 'high' | 'medium' | 'low' | 'none';
  last_date: string;
  first_date: string;
  data_days_span: number;
  analysis_available: boolean;
}

/** Enhanced professional analysis extending the base analysis */
export interface EnhancedProfessionalAnalysis extends ProfessionalAnalysis {
  enhanced_indicators: EnhancedIndicators;
  data_coverage: DataCoverage;
}

/** Stock with analysis results for batch reporting */
export interface StockAnalysisItem {
  ticker: string;
  name: string;
  name_ar: string;
  sector: string;
  current_price: number;
  data_points: number;
  data_quality: 'high' | 'medium' | 'low';
  last_update: string;
  composite_score: number;
  recommendation: string;
  all_scores: {
    composite: number;
    technical: number;
    value: number;
    quality: number;
    momentum: number;
    risk: number;
  };
}

/** Stock without sufficient data for batch reporting */
export interface StockNoDataItem {
  ticker: string;
  name: string;
  name_ar: string;
  sector: string;
  current_price: number;
  reason: string;
}

/** Batch analysis summary statistics */
export interface BatchAnalysisSummary {
  high_quality: number;
  medium_quality: number;
  low_quality: number;
  no_data: number;
}

/** Full batch data coverage report */
export interface StockDataCoverageReport {
  total_stocks: number;
  with_data: StockAnalysisItem[];
  without_data: StockNoDataItem[];
  analysis_summary: BatchAnalysisSummary;
}

// ---------------------------------------------------------------------------
// 6. ADX (Average Directional Index) — 14 period default
// ---------------------------------------------------------------------------

/**
 * Calculate the ADX, +DI, and -DI for a price series.
 * Uses Wilder's smoothing method. Requires at least `period + 1` data points.
 */
export function calculateADX(
  data: PricePoint[],
  period: number = 14
): ADXResult {
  // Neutral defaults for insufficient data
  const neutral: ADXResult = { adx: 0, plusDI: 0, minusDI: 0 };

  if (data.length < period + 1) return neutral;

  // Step 1: Compute +DM, -DM, and TR for each bar
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  const trs: number[] = [];

  for (let i = 1; i < data.length; i++) {
    const highDiff = data[i].high - data[i - 1].high;
    const lowDiff = data[i - 1].low - data[i].low;

    // +DM: positive directional movement
    plusDMs.push(highDiff > lowDiff && highDiff > 0 ? highDiff : 0);
    // -DM: negative directional movement
    minusDMs.push(lowDiff > highDiff && lowDiff > 0 ? lowDiff : 0);

    // True Range
    const tr = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i - 1].close),
      Math.abs(data[i].low - data[i - 1].close)
    );
    trs.push(tr);
  }

  if (trs.length < period) return neutral;

  // Step 2: Smooth using Wilder's method (first value = SMA of first `period` values)
  let smoothPlusDM = sma(plusDMs.slice(0, period), period);
  let smoothMinusDM = sma(minusDMs.slice(0, period), period);
  let smoothTR = sma(trs.slice(0, period), period);

  const diPlusArr: number[] = [];
  const diMinusArr: number[] = [];
  const dxArr: number[] = [];

  // First DI values
  const firstDIPlus = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
  const firstDIMinus = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
  diPlusArr.push(firstDIPlus);
  diMinusArr.push(firstDIMinus);
  const diSum = firstDIPlus + firstDIMinus;
  dxArr.push(diSum > 0 ? (Math.abs(firstDIPlus - firstDIMinus) / diSum) * 100 : 0);

  // Step 3: Smooth subsequent values
  for (let i = period; i < trs.length; i++) {
    smoothPlusDM = smoothPlusDM - (smoothPlusDM / period) + plusDMs[i];
    smoothMinusDM = smoothMinusDM - (smoothMinusDM / period) + minusDMs[i];
    smoothTR = smoothTR - (smoothTR / period) + trs[i];

    const dip = smoothTR > 0 ? (smoothPlusDM / smoothTR) * 100 : 0;
    const dim = smoothTR > 0 ? (smoothMinusDM / smoothTR) * 100 : 0;
    diPlusArr.push(dip);
    diMinusArr.push(dim);

    const sum = dip + dim;
    dxArr.push(sum > 0 ? (Math.abs(dip - dim) / sum) * 100 : 0);
  }

  // Step 4: Calculate ADX as smoothed DX (Wilder's method)
  if (dxArr.length < period) {
    return {
      adx: round(sma(dxArr, dxArr.length), 2),
      plusDI: round(diPlusArr[diPlusArr.length - 1], 2),
      minusDI: round(diMinusArr[diMinusArr.length - 1], 2),
    };
  }

  let adx = sma(dxArr.slice(0, period), period);
  for (let i = period; i < dxArr.length; i++) {
    adx = (adx * (period - 1) + dxArr[i]) / period;
  }

  return {
    adx: round(adx, 2),
    plusDI: round(diPlusArr[diPlusArr.length - 1], 2),
    minusDI: round(diMinusArr[diMinusArr.length - 1], 2),
  };
}

// ---------------------------------------------------------------------------
// 7. Williams %R — 14 period default
// ---------------------------------------------------------------------------

/**
 * Williams %R measures overbought/oversold levels.
 * Ranges from -100 to 0. Values above -20 = overbought, below -80 = oversold.
 */
export function calculateWilliamsR(
  data: PricePoint[],
  period: number = 14
): number {
  if (data.length < period) return -50; // neutral default

  const recent = data.slice(-period);
  const highestHigh = Math.max(...recent.map((p) => p.high));
  const lowestLow = Math.min(...recent.map((p) => p.low));
  const currentClose = data[data.length - 1].close;

  const range = highestHigh - lowestLow;
  if (range === 0) return -50;

  const williamsR = ((highestHigh - currentClose) / range) * -100;
  return round(clamp(williamsR, -100, 0), 2);
}

// ---------------------------------------------------------------------------
// 8. CCI (Commodity Channel Index) — 20 period default
// ---------------------------------------------------------------------------

/**
 * CCI measures the deviation of price from its statistical mean.
 * Values above +100 = overbought, below -100 = oversold.
 */
export function calculateCCI(
  data: PricePoint[],
  period: number = 20
): number {
  if (data.length < period) return 0; // neutral default

  const recent = data.slice(-period);

  // Typical Price = (High + Low + Close) / 3
  const typicalPrices = recent.map((p) => (p.high + p.low + p.close) / 3);

  // SMA of Typical Prices
  const meanTP = sma(typicalPrices, period);

  // Mean Deviation
  let meanDeviation = 0;
  for (const tp of typicalPrices) {
    meanDeviation += Math.abs(tp - meanTP);
  }
  meanDeviation /= period;

  if (meanDeviation === 0) return 0;

  const cci = (typicalPrices[typicalPrices.length - 1] - meanTP) / (0.015 * meanDeviation);
  return round(cci, 2);
}

// ---------------------------------------------------------------------------
// 9. Parabolic SAR — trailing stop/reversal system
// ---------------------------------------------------------------------------

/**
 * Parabolic SAR provides trailing stop points and reversal signals.
 * Uses the standard AF step=0.02, maxStep=0.20.
 */
export function calculateParabolicSAR(
  data: PricePoint[],
  step: number = 0.02,
  maxStep: number = 0.20
): ParabolicSARResult {
  const neutral: ParabolicSARResult = {
    sar: data.length > 0 ? data[data.length - 1].close : 0,
    isReversal: false,
    trend: 'up',
  };

  if (data.length < 5) return neutral;

  let trend: 'up' | 'down' = 'up';

  // Determine initial trend from first few bars
  let upCount = 0;
  let downCount = 0;
  const initLen = Math.min(5, data.length);
  for (let i = 1; i < initLen; i++) {
    if (data[i].close > data[i - 1].close) upCount++;
    else downCount++;
  }
  trend = upCount >= downCount ? 'up' : 'down';

  let af = step;
  let sar: number;
  let ep: number; // extreme point

  if (trend === 'up') {
    sar = Math.min(data[0].low, data[1]?.low ?? data[0].low);
    ep = Math.max(data[0].high, data[1]?.high ?? data[0].high);
  } else {
    sar = Math.max(data[0].high, data[1]?.high ?? data[0].high);
    ep = Math.min(data[0].low, data[1]?.low ?? data[0].low);
  }

  let isReversal = false;

  for (let i = 2; i < data.length; i++) {
    // Calculate SAR for the current bar
    sar = sar + af * (ep - sar);

    if (trend === 'up') {
      // SAR must not be above the prior two lows
      if (i >= 2) {
        sar = Math.min(sar, data[i - 1].low);
        sar = Math.min(sar, data[i - 2].low);
      }

      // Check for reversal: if low goes below SAR
      if (data[i].low < sar) {
        trend = 'down';
        isReversal = true;
        sar = ep; // SAR becomes the previous extreme point (high)
        ep = data[i].low; // new extreme point
        af = step;
      } else {
        // Update extreme point if new high
        if (data[i].high > ep) {
          ep = data[i].high;
          af = Math.min(af + step, maxStep);
        }
      }
    } else {
      // downtrend
      // SAR must not be below the prior two highs
      if (i >= 2) {
        sar = Math.max(sar, data[i - 1].high);
        sar = Math.max(sar, data[i - 2].high);
      }

      // Check for reversal: if high goes above SAR
      if (data[i].high > sar) {
        trend = 'up';
        isReversal = true;
        sar = ep; // SAR becomes the previous extreme point (low)
        ep = data[i].high; // new extreme point
        af = step;
      } else {
        // Update extreme point if new low
        if (data[i].low < ep) {
          ep = data[i].low;
          af = Math.min(af + step, maxStep);
        }
      }
    }
  }

  return {
    sar: round(sar, 4),
    isReversal,
    trend,
  };
}

// ---------------------------------------------------------------------------
// 10. Ichimoku Cloud — comprehensive trend system
// ---------------------------------------------------------------------------

/**
 * Ichimoku Cloud with standard parameters:
 *   Tenkan-sen (Conversion Line): 9 periods
 *   Kijun-sen (Base Line): 26 periods
 *   Senkou Span B (Leading Span B): 52 periods
 *   Senkou Span A (Leading Span A): (Tenkan + Kijun) / 2, plotted 26 periods ahead
 *   Chikou Span (Lagging Span): close plotted 26 periods back
 */
export function calculateIchimoku(data: PricePoint[]): IchimokuResult {
  const neutral: IchimokuResult = {
    tenkan: 0,
    kijun: 0,
    senkouA: 0,
    senkouB: 0,
    chikou: 0,
    cloudTop: 0,
    cloudBottom: 0,
    trend: 'neutral',
    signal: 'neutral',
  };

  if (data.length < 52) {
    // Provide partial results if we have enough for Tenkan/Kijun
    if (data.length >= 26) {
      const closes = data.map((p) => p.close);

      const tenkanPeriod = 9;
      const tenkanSlice = data.slice(-tenkanPeriod);
      const tenkan = (Math.max(...tenkanSlice.map((p) => p.high)) + Math.min(...tenkanSlice.map((p) => p.low))) / 2;

      const kijunPeriod = 26;
      const kijunSlice = data.slice(-kijunPeriod);
      const kijun = (Math.max(...kijunSlice.map((p) => p.high)) + Math.min(...kijunSlice.map((p) => p.low))) / 2;

      const senkouA = (tenkan + kijun) / 2;
      const chikou = closes.length >= 26 ? closes[closes.length - 26] : closes[0];

      return {
        tenkan: round(tenkan, 4),
        kijun: round(kijun, 4),
        senkouA: round(senkouA, 4),
        senkouB: 0,
        chikou: round(chikou, 4),
        cloudTop: round(senkouA, 4),
        cloudBottom: round(senkouA, 4),
        trend: tenkan > kijun ? 'bullish' : 'bearish',
        signal: tenkan > kijun ? 'bullish' : 'bearish',
      };
    }
    return neutral;
  }

  const closes = data.map((p) => p.close);

  // Tenkan-sen (Conversion Line) — 9-period midpoint
  const tenkanPeriod = 9;
  const tenkanSlice = data.slice(-tenkanPeriod);
  const tenkan = (Math.max(...tenkanSlice.map((p) => p.high)) + Math.min(...tenkanSlice.map((p) => p.low))) / 2;

  // Kijun-sen (Base Line) — 26-period midpoint
  const kijunPeriod = 26;
  const kijunSlice = data.slice(-kijunPeriod);
  const kijun = (Math.max(...kijunSlice.map((p) => p.high)) + Math.min(...kijunSlice.map((p) => p.low))) / 2;

  // Senkou Span A — (Tenkan + Kijun) / 2, shifted 26 periods ahead
  const senkouA = (tenkan + kijun) / 2;

  // Senkou Span B — 52-period midpoint, shifted 26 periods ahead
  const senkouBPeriod = 52;
  const senkouBSlice = data.slice(-senkouBPeriod);
  const senkouB = (Math.max(...senkouBSlice.map((p) => p.high)) + Math.min(...senkouBSlice.map((p) => p.low))) / 2;

  // Chikou Span — current close plotted 26 periods back
  const chikou = closes.length >= 26 ? closes[closes.length - 26] : closes[0];

  // Cloud boundaries
  const cloudTop = Math.max(senkouA, senkouB);
  const cloudBottom = Math.min(senkouA, senkouB);

  const currentPrice = closes[closes.length - 1];

  // Determine trend
  let trend: string;
  let signal: string;

  const aboveCloud = currentPrice > cloudTop;
  const belowCloud = currentPrice < cloudBottom;
  const tenkanAboveKijun = tenkan > kijun;

  if (aboveCloud && tenkanAboveKijun) {
    trend = 'bullish';
    signal = 'strong_bullish';
  } else if (aboveCloud) {
    trend = 'bullish';
    signal = 'bullish';
  } else if (belowCloud && !tenkanAboveKijun) {
    trend = 'bearish';
    signal = 'strong_bearish';
  } else if (belowCloud) {
    trend = 'bearish';
    signal = 'bearish';
  } else {
    trend = 'neutral';
    signal = 'inside_cloud';
  }

  return {
    tenkan: round(tenkan, 4),
    kijun: round(kijun, 4),
    senkouA: round(senkouA, 4),
    senkouB: round(senkouB, 4),
    chikou: round(chikou, 4),
    cloudTop: round(cloudTop, 4),
    cloudBottom: round(cloudBottom, 4),
    trend,
    signal,
  };
}

// ---------------------------------------------------------------------------
// 11. MFI (Money Flow Index) — 14 period default
// ---------------------------------------------------------------------------

/**
 * MFI is a volume-weighted RSI. Oscillates between 0 and 100.
 * Above 80 = overbought, below 20 = oversold.
 */
export function calculateMFI(
  data: PricePoint[],
  period: number = 14
): number {
  if (data.length < period + 1) return 50; // neutral default

  const recent = data.slice(-(period + 1));

  // Calculate Typical Price and Raw Money Flow for each bar
  let positiveFlow = 0;
  let negativeFlow = 0;

  for (let i = 1; i < recent.length; i++) {
    const tp = (recent[i].high + recent[i].low + recent[i].close) / 3;
    const prevTP = (recent[i - 1].high + recent[i - 1].low + recent[i - 1].close) / 3;
    const rawMoneyFlow = tp * recent[i].volume;

    if (tp > prevTP) {
      positiveFlow += rawMoneyFlow;
    } else if (tp < prevTP) {
      negativeFlow += rawMoneyFlow;
    }
  }

  if (negativeFlow === 0) return 100;
  const moneyFlowRatio = positiveFlow / negativeFlow;

  const mfi = 100 - (100 / (1 + moneyFlowRatio));
  return round(clamp(mfi, 0, 100), 2);
}

// ===========================================================================
// SECTION: Enhanced Composite Analysis & Batch Analysis
// ===========================================================================

// ---------------------------------------------------------------------------
// 12. Data Coverage Helper
// ---------------------------------------------------------------------------

/** Assess data coverage quality for a given price history */
function assessDataCoverage(data: PricePoint[]): DataCoverage {
  const hasData = data.length > 0;

  if (!hasData) {
    return {
      has_data: false,
      history_points: 0,
      quality: 'none',
      last_date: '',
      first_date: '',
      data_days_span: 0,
      analysis_available: false,
    };
  }

  const historyPoints = data.length;
  const lastDate = data[data.length - 1].date;
  const firstDate = data[0].date;

  // Calculate days span
  let dataDaysSpan = 0;
  if (firstDate && lastDate) {
    const first = new Date(firstDate);
    const last = new Date(lastDate);
    if (!isNaN(first.getTime()) && !isNaN(last.getTime())) {
      dataDaysSpan = Math.round(Math.abs(last.getTime() - first.getTime()) / (1000 * 60 * 60 * 24));
    }
  }

  // Determine quality based on data points
  let quality: 'high' | 'medium' | 'low' | 'none';
  if (historyPoints >= 200) {
    quality = 'high';
  } else if (historyPoints >= 50) {
    quality = 'medium';
  } else if (historyPoints >= 20) {
    quality = 'low';
  } else {
    quality = 'none';
  }

  // Analysis requires at minimum 20 data points
  const analysisAvailable = historyPoints >= 20;

  return {
    has_data: true,
    history_points: historyPoints,
    quality,
    last_date: lastDate,
    first_date: firstDate,
    data_days_span: dataDaysSpan,
    analysis_available: analysisAvailable,
  };
}

// ---------------------------------------------------------------------------
// 13. Enhanced Composite Analysis
// ---------------------------------------------------------------------------

/**
 * Calculate an enhanced professional analysis that includes all original
 * indicators plus the new ADX, Williams %R, CCI, Parabolic SAR, Ichimoku,
 * and MFI indicators, along with detailed data coverage information.
 *
 * @param stock        - A record with all stock fields
 * @param priceHistory - Array of raw price history records
 * @returns EnhancedProfessionalAnalysis
 */
export function calculateEnhancedCompositeAnalysis(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>
): EnhancedProfessionalAnalysis {
  // Normalize data
  const data = normalizePriceHistory(priceHistory);
  const dataCoverage = assessDataCoverage(data);

  // If not enough data for any analysis, return a skeleton with neutral values
  if (!dataCoverage.analysis_available) {
    return {
      scores: {
        composite: 50,
        technical: 50,
        value: calculateValueScore(stock),
        quality: calculateQualityScore(stock, data.map((p) => p.close)),
        momentum: 50,
        risk: 50,
      },
      recommendation: {
        action: 'hold',
        action_ar: 'احتفاظ',
        confidence: 0.3,
        entry_price: toNum(stock.current_price),
        target_price: toNum(stock.current_price),
        stop_loss: toNum(stock.current_price),
        risk_reward_ratio: 0,
        time_horizon: 'medium_term',
        time_horizon_ar: 'متوسط الأجل',
        summary_ar: 'بيانات غير كافية لإجراء تحليل شامل.',
      },
      indicators: {
        rsi: { value: 50, signal: 'neutral' },
        macd: { line: 0, signal: 0, histogram: 0, signal_text: 'بيانات غير كافية' },
        bollinger: { upper: toNum(stock.current_price), middle: toNum(stock.current_price), lower: toNum(stock.current_price), position: 50, signal_text: 'بيانات غير كافية' },
        stochastic_rsi: { k: 50, d: 50, signal_text: 'بيانات غير كافية' },
        atr: 0,
        atr_percent: 0,
        obv: 0,
        obv_trend: 'محايد',
        vwap: 0,
        roc: { roc_5: 0, roc_10: 0, roc_20: 0, signal_text: 'بيانات غير كافية' },
      },
      patterns: {
        detected: [],
        ma_cross: null,
      },
      risk_metrics: {
        sharpe_ratio: 0,
        max_drawdown: 0,
        max_drawdown_percent: 0,
        var_95: 0,
        beta: 1,
        volatility_annualized: 0,
      },
      price_levels: {
        support_1: 0,
        support_2: 0,
        resistance_1: 0,
        resistance_2: 0,
        pivot: toNum(stock.current_price),
      },
      trend: {
        direction: 'neutral',
        direction_ar: 'عرضي',
        strength: 'weak',
        strength_ar: 'ضعيف',
      },
      volume_analysis: {
        avg_volume_20: 0,
        current_vs_avg: 1,
        signal: 'neutral',
        signal_ar: 'طبيعي',
      },
      data_quality: {
        history_points: data.length,
        quality: 'low',
      },
      fair_value: {
        graham_number: 0,
        lynch_value: 0,
        dcf_simplified: 0,
        pe_based: 0,
        average_fair_value: toNum(stock.current_price),
        upside_to_fair: 0,
        verdict: 'fair',
        verdict_ar: 'عادل التقييم',
        details: {
          eps: toNum(stock.eps),
          book_value_per_share: 0,
          growth_rate: 5,
          risk_free_rate: 17.5,
          sector_avg_pe: 12,
          graham_calc: 'بيانات غير كافية',
          lynch_calc: 'بيانات غير كافية',
          dcf_calc: 'بيانات غير كافية',
          pe_calc: 'بيانات غير كافية',
        },
      },
      enhanced_indicators: {
        adx: { adx: 0, plusDI: 0, minusDI: 0 },
        williamsR: -50,
        cci: 0,
        parabolicSar: {
          sar: toNum(stock.current_price),
          isReversal: false,
          trend: 'up',
        },
        ichimoku: {
          tenkan: 0,
          kijun: 0,
          senkouA: 0,
          senkouB: 0,
          chikou: 0,
          cloudTop: 0,
          cloudBottom: 0,
          trend: 'neutral',
          signal: 'neutral',
        },
        mfi: 50,
      },
      data_coverage: dataCoverage,
    };
  }

  // Calculate the base professional analysis
  const baseAnalysis = calculateProfessionalAnalysis(stock, priceHistory);

  // Calculate new enhanced indicators
  const adxResult = calculateADX(data);
  const williamsR = calculateWilliamsR(data);
  const cci = calculateCCI(data);
  const parabolicSar = calculateParabolicSAR(data);
  const ichimokuResult = calculateIchimoku(data);
  const mfi = calculateMFI(data);

  const enhancedIndicators: EnhancedIndicators = {
    adx: adxResult,
    williamsR,
    cci,
    parabolicSar,
    ichimoku: ichimokuResult,
    mfi,
  };

  return {
    ...baseAnalysis,
    enhanced_indicators: enhancedIndicators,
    data_coverage: dataCoverage,
  };
}

// ---------------------------------------------------------------------------
// 13b. Fundamental-Only Analysis (no price history needed)
// ---------------------------------------------------------------------------

interface FundamentalOnlyResult {
  hasFundamentalData: boolean;
  composite_score: number;
  recommendation: string;
  all_scores: {
    technical: number;
    value: number;
    quality: number;
    momentum: number;
    risk: number;
  };
}

/**
 * تحليل أساسي فقط — يعتمد على PE, PB, ROE, EPS, dividend_yield
 * لا يحتاج بيانات تاريخية للأسعار
 *
 * @param stock - سجل السهم مع البيانات الأساسية
 * @returns نتيجة التحليل الأساسي
 */
function calculateFundamentalOnlyAnalysis(stock: Record<string, unknown>): FundamentalOnlyResult {
  const pe = toNum(stock.pe_ratio);
  const pb = toNum(stock.pb_ratio);
  const roe = toNum(stock.roe);
  const eps = toNum(stock.eps);
  const divYield = toNum(stock.dividend_yield);
  const debtToEquity = toNum(stock.debt_to_equity);
  const currentPrice = toNum(stock.current_price);
  const roa = toNum(stock.roa);
  const currentRatio = toNum(stock.current_ratio);
  const bookValuePerShare = toNum(stock.book_value_per_share);
  const psRatio = toNum(stock.ps_ratio);
  const evToEbitda = toNum(stock.ev_to_ebitda);
  const marketCap = toNum(stock.market_cap);

  // التحقق من وجود بيانات أساسية كافية
  // Check raw values (before toNum) to distinguish null/undefined from actual 0
  // Also include negative values (e.g., negative PE means the company is losing money — still data)
  const hasPE = stock.pe_ratio != null && stock.pe_ratio !== '' && Number(stock.pe_ratio) !== 0;
  const hasPB = stock.pb_ratio != null && stock.pb_ratio !== '' && Number(stock.pb_ratio) !== 0;
  const hasROE = stock.roe != null && stock.roe !== '' && Number(stock.roe) !== 0;
  const hasEPS = stock.eps != null && stock.eps !== '' && Number(stock.eps) !== 0;
  const hasDivYield = stock.dividend_yield != null && stock.dividend_yield !== '' && Number(stock.dividend_yield) !== 0;
  const hasDebtToEquity = stock.debt_to_equity != null && stock.debt_to_equity !== '' && Number(stock.debt_to_equity) !== 0;
  const hasROA = stock.roa != null && stock.roa !== '' && Number(stock.roa) !== 0;
  const hasBookValue = stock.book_value_per_share != null && stock.book_value_per_share !== '' && Number(stock.book_value_per_share) !== 0;
  const hasPS = stock.ps_ratio != null && stock.ps_ratio !== '' && Number(stock.ps_ratio) !== 0;
  const hasEV = stock.ev_to_ebitda != null && stock.ev_to_ebitda !== '' && Number(stock.ev_to_ebitda) !== 0;
  const hasMarketCap = stock.market_cap != null && stock.market_cap !== '' && Number(stock.market_cap) !== 0;

  const hasAnyFundamental = hasPE || hasPB || hasROE || hasEPS || hasDivYield
    || hasDebtToEquity || hasROA || hasBookValue || hasPS || hasEV || hasMarketCap;
  if (!hasAnyFundamental) {
    return { hasFundamentalData: false, composite_score: 0, recommendation: 'hold', all_scores: { technical: 50, value: 50, quality: 50, momentum: 50, risk: 50 } };
  }

  // === تقييم القيمة (Value Score) ===
  let valueScore = 50;

  // P/E evaluation (±20 نقطة)
  if (pe > 0 && pe <= 8) valueScore += 20;
  else if (pe > 8 && pe <= 12) valueScore += 15;
  else if (pe > 12 && pe <= 15) valueScore += 8;
  else if (pe > 15 && pe <= 20) valueScore += 0;
  else if (pe > 20 && pe <= 30) valueScore -= 5;
  else if (pe > 30) valueScore -= 15;
  else if (pe < 0) valueScore -= 10;

  // P/B evaluation (±15 نقطة)
  if (pb > 0 && pb <= 0.8) valueScore += 15;
  else if (pb > 0.8 && pb <= 1.2) valueScore += 10;
  else if (pb > 1.2 && pb <= 2) valueScore += 3;
  else if (pb > 2 && pb <= 3) valueScore -= 5;
  else if (pb > 3 && pb <= 5) valueScore -= 12;
  else if (pb > 5) valueScore -= 15;

  // P/S evaluation (±5 نقطة)
  if (psRatio > 0 && psRatio <= 1) valueScore += 5;
  else if (psRatio > 1 && psRatio <= 2) valueScore += 2;
  else if (psRatio > 5) valueScore -= 5;

  // EV/EBITDA evaluation (±5 نقطة)
  if (evToEbitda > 0 && evToEbitda <= 6) valueScore += 5;
  else if (evToEbitda > 6 && evToEbitda <= 10) valueScore += 2;
  else if (evToEbitda > 15) valueScore -= 5;

  // Dividend yield (±10 نقطة)
  if (divYield > 8) valueScore += 10;
  else if (divYield > 5) valueScore += 7;
  else if (divYield > 3) valueScore += 4;
  else if (divYield > 0) valueScore += 1;

  valueScore = clamp(Math.round(valueScore), 0, 100);

  // === تقييم الجودة (Quality Score) ===
  let qualityScore = 50;

  // ROE evaluation (±20 نقطة)
  if (roe >= 30) qualityScore += 20;
  else if (roe >= 20) qualityScore += 15;
  else if (roe >= 15) qualityScore += 10;
  else if (roe >= 10) qualityScore += 5;
  else if (roe >= 5) qualityScore += 0;
  else if (roe >= 0) qualityScore -= 8;
  else qualityScore -= 15;

  // ROA evaluation (±10 نقطة)
  if (roa >= 15) qualityScore += 10;
  else if (roa >= 10) qualityScore += 7;
  else if (roa >= 5) qualityScore += 3;
  else if (roa >= 0) qualityScore -= 3;
  else qualityScore -= 10;

  // Debt-to-Equity (±15 نقطة)
  if (debtToEquity >= 0 && debtToEquity <= 0.3) qualityScore += 15;
  else if (debtToEquity > 0.3 && debtToEquity <= 0.5) qualityScore += 10;
  else if (debtToEquity > 0.5 && debtToEquity <= 1.0) qualityScore += 0;
  else if (debtToEquity > 1.0 && debtToEquity <= 1.5) qualityScore -= 8;
  else if (debtToEquity > 1.5) qualityScore -= 15;

  // Current Ratio (±5 نقطة)
  if (currentRatio >= 2) qualityScore += 5;
  else if (currentRatio >= 1.5) qualityScore += 3;
  else if (currentRatio >= 1) qualityScore += 0;
  else if (currentRatio > 0) qualityScore -= 5;

  // EPS positivity (±5 نقطة)
  if (eps > 0) qualityScore += 5;
  else if (eps < 0) qualityScore -= 10;

  qualityScore = clamp(Math.round(qualityScore), 0, 100);

  // === حساب النتيجة المركبة (Composite Score) ===
  // بدون بيانات فنية، نعطي وزن أكبر للتحليل الأساسي
  // The 50 * 0.05 + 50 * 0.10 base ensures composite is always > 0 when fundamental data exists
  const composite = Math.round(valueScore * 0.45 + qualityScore * 0.40 + 50 * 0.05 + 50 * 0.10);
  // Guarantee composite_score > 0 when any fundamental data exists (minimum base is 7.5)
  const compositeClamped = clamp(composite, 1, 100);

  // === تحديد التوصية ===
  let recommendation: string;
  if (compositeClamped >= 72) recommendation = 'strong_buy';
  else if (compositeClamped >= 58) recommendation = 'buy';
  else if (compositeClamped >= 46) recommendation = 'accumulate';
  else if (compositeClamped >= 38) recommendation = 'hold';
  else if (compositeClamped >= 25) recommendation = 'sell';
  else recommendation = 'strong_sell';

  return {
    hasFundamentalData: true,
    composite_score: compositeClamped,
    recommendation,
    all_scores: {
      technical: 50,  // محايد — لا بيانات فنية
      value: valueScore,
      quality: qualityScore,
      momentum: 50,   // محايد — لا بيانات فنية
      risk: 50,       // محايد — لا بيانات فنية
    },
  };
}

// ---------------------------------------------------------------------------
// 14. Batch Analysis — Data Coverage Report
// ---------------------------------------------------------------------------

/**
 * Analyze data coverage across all stocks and generate a comprehensive report.
 *
 * @param allStocks         - Array of stock records (must have id, ticker, name, name_ar, sector, current_price)
 * @param priceHistoryGetter - Function to fetch price history: (stockId: number, days: number) => Record<string, unknown>[]
 * @returns StockDataCoverageReport
 */
export function analyzeStockDataCoverage(
  allStocks: Array<Record<string, unknown>>,
  priceHistoryGetter: (stockId: number, days: number) => Record<string, unknown>[]
): StockDataCoverageReport {
  const withData: StockAnalysisItem[] = [];
  const withoutData: StockNoDataItem[] = [];

  for (const stock of allStocks) {
    const stockId = toNum(stock.id);
    const ticker = String(stock.ticker ?? '');
    const name = String(stock.name ?? '');
    const nameAr = String(stock.name_ar ?? '');
    const sector = String(stock.sector ?? '');
    const currentPrice = toNum(stock.current_price);

    if (!ticker) continue; // skip invalid stocks

    // Request 250 days of data (enough for most advanced indicators)
    const rawHistory = priceHistoryGetter(stockId, 250);
    const data = normalizePriceHistory(rawHistory);
    const coverage = assessDataCoverage(data);

    if (!coverage.analysis_available) {
      // لا توجد بيانات تاريخية كافية — لكن نحاول التحليل الأساسي
      // استخدم PE, PB, ROE, EPS, dividend_yield من بيانات السهم للحصول على تقييم أساسي
      const fundamentalResult = calculateFundamentalOnlyAnalysis(stock);

      if (fundamentalResult.hasFundamentalData) {
        // يوجد بيانات أساسية — نضيفه للتحليل
        withData.push({
          ticker,
          name,
          name_ar: nameAr,
          sector,
          current_price: currentPrice,
          data_points: 0,
          data_quality: 'low' as const,
          last_update: String(stock.last_update ?? ''),
          composite_score: fundamentalResult.composite_score,
          recommendation: fundamentalResult.recommendation,
          all_scores: fundamentalResult.all_scores,
        });
      } else if (currentPrice > 0) {
        // لا توجد بيانات أساسية أو تاريخية كافية، لكن السهم له سعر — نعطيه تقييم محايد
        withData.push({
          ticker,
          name,
          name_ar: nameAr,
          sector,
          current_price: currentPrice,
          data_points: 0,
          data_quality: 'low' as const,
          last_update: String(stock.last_update ?? ''),
          composite_score: 50,
          recommendation: 'hold',
          all_scores: { technical: 50, value: 50, quality: 50, momentum: 50, risk: 50 },
        });
      } else {
        withoutData.push({
          ticker,
          name,
          name_ar: nameAr,
          sector,
          current_price: currentPrice,
          reason: coverage.history_points === 0
            ? 'لا توجد بيانات تاريخية متاحة ولا بيانات أساسية كافية'
            : coverage.history_points < 20
              ? `بيانات غير كافية (${coverage.history_points} نقطة فقط — مطلوب 20 كحد أدنى)`
              : 'بيانات غير صالحة للتحليل',
        });
      }
      continue;
    }

    // Run the enhanced composite analysis
    const analysis = calculateEnhancedCompositeAnalysis(stock, rawHistory);
    const quality = coverage.quality === 'none' ? 'low' : coverage.quality;

    withData.push({
      ticker,
      name,
      name_ar: nameAr,
      sector,
      current_price: currentPrice,
      data_points: coverage.history_points,
      data_quality: quality,
      last_update: coverage.last_date,
      composite_score: analysis.scores.composite,
      recommendation: analysis.recommendation.action,
      all_scores: { ...analysis.scores },
    });
  }

  // Sort by composite score descending
  withData.sort((a, b) => b.composite_score - a.composite_score);

  // Build summary
  const analysisSummary: BatchAnalysisSummary = {
    high_quality: withData.filter((s) => s.data_quality === 'high').length,
    medium_quality: withData.filter((s) => s.data_quality === 'medium').length,
    low_quality: withData.filter((s) => s.data_quality === 'low').length,
    no_data: withoutData.length,
  };

  return {
    total_stocks: allStocks.length,
    with_data: withData,
    without_data: withoutData,
    analysis_summary: analysisSummary,
  };
}
