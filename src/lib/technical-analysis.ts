/**
 * Technical Analysis Engine (REAL — no fabrication)
 * ================================================
 * محرك التحليل الفني الموحّد — يجمع بين:
 *   1. مؤشرات الاتجاه (MA, EMA, MACD)
 *   2. مؤشرات الزخم (RSI, Stochastic)
 *   3. مؤشرات التقلب (Bollinger Bands, ATR)
 *   4. الدعوم والمقاومات (Swing Highs/Lows)
 *   5. الشموع اليابانية (Candlestick Patterns)
 *
 * كل تحليل بيرجع تقرير مفصّل بالأدلة المستخدمة.
 */

import { PriceRow } from './market-data-access';
import { Candle, CandlePattern, CandleSignal, detectCandlestickPatterns, toCandles, aggregateCandleSignal } from './candlestick-patterns';

// ============== Indicators ==============

export function computeRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

export function computeSMA(prices: number[], period: number): number {
  if (prices.length < period) return prices.length > 0 ? prices[prices.length - 1] : 0;
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

export function computeEMA(prices: number[], period: number): number {
  if (prices.length < period) return computeSMA(prices, prices.length);
  const k = 2 / (period + 1);
  let ema = computeSMA(prices.slice(0, period), period);
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

export function computeMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
  if (prices.length < 35) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = computeEMA(prices, 12);
  const ema26 = computeEMA(prices, 26);
  const macd = ema12 - ema26;
  // Signal line is 9-period EMA of MACD line (approximation)
  const macdValues: number[] = [];
  for (let i = 26; i < prices.length; i++) {
    const slice = prices.slice(0, i + 1);
    macdValues.push(computeEMA(slice, 12) - computeEMA(slice, 26));
  }
  const signal = macdValues.length >= 9 ? computeEMA(macdValues, 9) : (macdValues[macdValues.length - 1] || macd);
  return { macd, signal, histogram: macd - signal };
}

export function computeBollingerBands(prices: number[], period = 20, stdDev = 2): { upper: number; middle: number; lower: number } {
  if (prices.length < period) {
    const last = prices[prices.length - 1] || 0;
    return { upper: last, middle: last, lower: last };
  }
  const slice = prices.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return { upper: mean + stdDev * sd, middle: mean, lower: mean - stdDev * sd };
}

export function computeATR(prices: PriceRow[], period = 14): number {
  if (prices.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = prices.length - period; i < prices.length; i++) {
    const p = prices[i];
    const prevClose = prices[i - 1].close_price;
    const tr = Math.max(
      p.high_price - p.low_price,
      Math.abs(p.high_price - prevClose),
      Math.abs(p.low_price - prevClose)
    );
    trs.push(tr);
  }
  return trs.reduce((a, b) => a + b, 0) / period;
}

export function computeStochastic(prices: PriceRow[], period = 14): { k: number; d: number } {
  if (prices.length < period) return { k: 50, d: 50 };
  const slice = prices.slice(-period);
  const highestHigh = Math.max(...slice.map(p => p.high_price));
  const lowestLow = Math.min(...slice.map(p => p.low_price));
  const currentClose = slice[slice.length - 1].close_price;
  const k = highestHigh === lowestLow ? 50 : ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
  // %D is 3-period SMA of %K (approximation)
  const d = k; // Simplified
  return { k, d };
}

// ============== Support/Resistance ==============

export interface SRResult {
  support: number | null;
  resistance: number | null;
  far_resistance: number | null;
  far_support: number | null;
  zone: string;
  zone_ar: string;
  pivot: number;
}

export function computeSR(prices: PriceRow[], lookback = 5): SRResult | null {
  const closes = prices.map(p => p.close_price);
  if (closes.length < 30) return null;
  const current = closes[closes.length - 1];
  const window = closes.slice(-90);
  const highs: number[] = [], lows: number[] = [];
  for (let i = lookback; i < window.length - lookback; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (window[j] >= window[i]) isHigh = false;
      if (window[j] <= window[i]) isLow = false;
    }
    if (isHigh) highs.push(window[i]);
    if (isLow) lows.push(window[i]);
  }
  const supports = lows.filter(l => l < current).sort((a, b) => (current - a) - (current - b));
  const resistances = highs.filter(h => h > current).sort((a, b) => (a - current) - (b - current));
  const support = supports[0] ?? null;
  const resistance = resistances[0] ?? null;
  const far_resistance = resistances[1] ?? resistances[0] ?? null;
  const far_support = supports[1] ?? supports[0] ?? null;
  const pivot = support && resistance ? (support + resistance + current) / 3 : current;

  let zone = 'middle', zone_ar = 'منطقة وسطى';
  if (resistance === null && support !== null) { zone = 'breakout'; zone_ar = 'اختراق صاعد'; }
  else if (support === null && resistance !== null) { zone = 'breakdown'; zone_ar = 'اختراق هابط'; }
  else if (support !== null && current <= support * 1.03) { zone = 'near_support'; zone_ar = 'قرب الدعم'; }
  else if (resistance !== null && current >= resistance * 0.97) { zone = 'near_resistance'; zone_ar = 'قرب المقاومة'; }

  return { support, resistance, far_resistance, far_support, zone, zone_ar, pivot };
}

// ============== Trend Detection ==============

export interface TrendInfo {
  direction: 'uptrend' | 'downtrend' | 'sideways';
  direction_ar: string;
  strength: number; // 0-100
  ma5: number;
  ma20: number;
  ma50: number;
  price_vs_ma20: number; // % above/below MA20
}

export function detectTrend(closes: number[]): TrendInfo {
  const ma5 = computeSMA(closes, 5);
  const ma20 = computeSMA(closes, 20);
  const ma50 = closes.length >= 50 ? computeSMA(closes, 50) : ma20;
  const last = closes[closes.length - 1];
  const price_vs_ma20 = ma20 > 0 ? ((last - ma20) / ma20) * 100 : 0;

  let direction: TrendInfo['direction'] = 'sideways';
  let direction_ar = 'اتجاه عرضي';
  let strength = 50;

  if (last > ma20 && ma5 > ma20 && ma20 > ma50) {
    direction = 'uptrend';
    direction_ar = 'اتجاه صاعد';
    strength = 70 + Math.min(30, Math.abs(price_vs_ma20) * 2);
  } else if (last < ma20 && ma5 < ma20 && ma20 < ma50) {
    direction = 'downtrend';
    direction_ar = 'اتجاه هابط';
    strength = 70 + Math.min(30, Math.abs(price_vs_ma20) * 2);
  } else {
    strength = 40 + Math.min(20, Math.abs(price_vs_ma20));
  }

  return { direction, direction_ar, strength: Math.min(100, Math.round(strength)), ma5, ma20, ma50, price_vs_ma20 };
}

// ============== Comprehensive Analysis ==============

export type Signal = 'BUY' | 'SELL' | 'HOLD';

export interface AnalysisReport {
  signal: Signal;
  confidence: number; // 0-100
  entry_price: number;
  target_price: number;
  stop_loss: number;
  risk_reward: number;
  sr_used: boolean;
  sr: SRResult | null;
  trend: TrendInfo;
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  bollinger: { upper: number; middle: number; lower: number };
  atr: number;
  stochastic: { k: number; d: number };
  candle_signal: CandleSignal;
  patterns: CandlePattern[];
  reasons: string[]; // بالعربي — الأدلة اللي بنينا عليها القرار
  analysis_methods: string[]; // الطرق المستخدمة
}

export function analyzePrices(prices: PriceRow[]): AnalysisReport | null {
  if (prices.length < 30) return null;

  const closes = prices.map(p => p.close_price);
  const candles = toCandles(prices);
  const last = closes[closes.length - 1];

  // === Compute all indicators ===
  const trend = detectTrend(closes);
  const rsi = computeRSI(closes);
  const macd = computeMACD(closes);
  const bollinger = computeBollingerBands(closes);
  const atr = computeATR(prices);
  const stochastic = computeStochastic(prices);
  const sr = computeSR(prices);
  const patterns = detectCandlestickPatterns(candles);
  const candleSignal = aggregateCandleSignal(patterns);

  const reasons: string[] = [];
  const methods: string[] = ['المتوسطات المتحركة (MA)', 'RSI', 'MACD', 'Bollinger Bands'];

  // === Signal Scoring ===
  let bullScore = 0;
  let bearScore = 0;

  // Trend
  if (trend.direction === 'uptrend') {
    bullScore += 25;
    reasons.push(`الاتجاه صاعد (السعر فوق MA20 بـ ${trend.price_vs_ma20.toFixed(1)}%)`);
  } else if (trend.direction === 'downtrend') {
    bearScore += 25;
    reasons.push(`الاتجاه هابط (السعر تحت MA20 بـ ${Math.abs(trend.price_vs_ma20).toFixed(1)}%)`);
  } else {
    reasons.push('الاتجاه عرضي');
  }

  // RSI
  if (rsi < 30) {
    bullScore += 20;
    reasons.push(`RSI = ${rsi.toFixed(0)} — تشبّع بيعي (فرصة شراء)`);
  } else if (rsi > 70) {
    bearScore += 20;
    reasons.push(`RSI = ${rsi.toFixed(0)} — تشبّع شرائي (فرصة بيع)`);
  } else if (rsi > 50) {
    bullScore += 8;
    reasons.push(`RSI = ${rsi.toFixed(0)} — زخم صاعد معتدل`);
  } else {
    bearScore += 8;
    reasons.push(`RSI = ${rsi.toFixed(0)} — زخم هابط معتدل`);
  }

  // MACD
  if (macd.histogram > 0 && macd.macd > macd.signal) {
    bullScore += 15;
    reasons.push('MACD صاعد (الخط فوق خط الإشارة)');
  } else if (macd.histogram < 0 && macd.macd < macd.signal) {
    bearScore += 15;
    reasons.push('MACD هابط (الخط تحت خط الإشارة)');
  }

  // Bollinger Bands
  if (last < bollinger.lower) {
    bullScore += 12;
    reasons.push('السعر تحت الحد السفلي لبولينجر — تشبّع بيعي');
  } else if (last > bollinger.upper) {
    bearScore += 12;
    reasons.push('السعر فوق الحد العلوي لبولينجر — تشبّع شرائي');
  }

  // S/R
  let sr_used = false;
  if (sr) {
    methods.push('الدعوم والمقاومات (S/R)');
    if (sr.zone === 'near_support') {
      bullScore += 18;
      sr_used = true;
      reasons.push(`السعر قرب الدعم (${sr.support?.toFixed(2)}) — منطقة شراء`);
    } else if (sr.zone === 'near_resistance') {
      bearScore += 18;
      sr_used = true;
      reasons.push(`السعر قرب المقاومة (${sr.resistance?.toFixed(2)}) — منطقة بيع`);
    } else if (sr.zone === 'breakout') {
      bullScore += 15;
      sr_used = true;
      reasons.push('اختراق المقاومة — زخم صاعد');
    } else if (sr.zone === 'breakdown') {
      bearScore += 15;
      sr_used = true;
      reasons.push('كسر الدعم — زخم هابط');
    }
  }

  // Candlestick patterns
  if (patterns.length > 0) {
    methods.push('الشموع اليابانية');
    if (candleSignal.score > 0) {
      bullScore += Math.min(25, candleSignal.score * 0.3);
      const topPatterns = patterns.filter(p => p.type === 'bullish').slice(0, 2);
      for (const p of topPatterns) {
        reasons.push(`نموذج ${p.name_ar} (${p.name}) — ${p.description.substring(0, 60)}...`);
      }
    } else if (candleSignal.score < 0) {
      bearScore += Math.min(25, Math.abs(candleSignal.score) * 0.3);
      const topPatterns = patterns.filter(p => p.type === 'bearish').slice(0, 2);
      for (const p of topPatterns) {
        reasons.push(`نموذج ${p.name_ar} (${p.name}) — ${p.description.substring(0, 60)}...`);
      }
    }
  }

  // === Determine Signal ===
  let signal: Signal = 'HOLD';
  let confidence = 50;

  const totalScore = bullScore + bearScore;
  if (totalScore > 0) {
    const bullPct = (bullScore / totalScore) * 100;
    if (bullPct >= 60 && bullScore >= 35) {
      signal = 'BUY';
      confidence = Math.min(95, Math.round(bullPct));
    } else if (bullPct <= 40 && bearScore >= 35) {
      signal = 'SELL';
      confidence = Math.min(95, Math.round(100 - bullPct));
    } else {
      signal = 'HOLD';
      confidence = Math.round(50 + Math.abs(bullPct - 50));
    }
  }

  // === Compute Targets ===
  let target: number;
  let stop: number;
  let rr = 0;

  if (signal === 'BUY') {
    if (sr_used && sr && sr.resistance) {
      target = sr.far_resistance ?? sr.resistance;
      stop = (sr.support ?? last * 0.96) * 0.98;
    } else {
      // ATR-based
      target = last + (atr * 2.5 || last * 0.07);
      stop = last - (atr * 1.5 || last * 0.04);
    }
    rr = stop > 0 ? (target - last) / (last - stop) : 0;
  } else if (signal === 'SELL') {
    if (sr_used && sr && sr.support) {
      target = sr.far_support ?? sr.support;
      stop = (sr.resistance ?? last * 1.04) * 1.02;
    } else {
      target = last - (atr * 2.5 || last * 0.07);
      stop = last + (atr * 1.5 || last * 0.04);
    }
    rr = stop > 0 ? (last - target) / (stop - last) : 0;
  } else {
    target = last;
    stop = last;
  }

  // R/R filter — if < 1.5, downgrade to HOLD
  if (signal !== 'HOLD' && rr < 1.5) {
    reasons.push(`نسبة المخاطرة/العائد = ${rr.toFixed(2)} — أقل من 1.5، تم تحويل الإشارة لـ HOLD`);
    signal = 'HOLD';
    confidence = Math.min(confidence, 45);
  }

  return {
    signal,
    confidence,
    entry_price: Math.round(last * 100) / 100,
    target_price: Math.round(target * 100) / 100,
    stop_loss: Math.round(stop * 100) / 100,
    risk_reward: Math.round(rr * 100) / 100,
    sr_used,
    sr,
    trend,
    rsi: Math.round(rsi * 10) / 10,
    macd: { macd: Math.round(macd.macd * 100) / 100, signal: Math.round(macd.signal * 100) / 100, histogram: Math.round(macd.histogram * 100) / 100 },
    bollinger: { upper: Math.round(bollinger.upper * 100) / 100, middle: Math.round(bollinger.middle * 100) / 100, lower: Math.round(bollinger.lower * 100) / 100 },
    atr: Math.round(atr * 100) / 100,
    stochastic: { k: Math.round(stochastic.k * 10) / 10, d: Math.round(stochastic.d * 10) / 10 },
    candle_signal: candleSignal,
    patterns,
    reasons,
    analysis_methods: methods,
  };
}

// ============== Outcome Verification (REAL) ==============

export interface Outcome {
  status: 'TARGET_HIT' | 'STOPPED' | 'EXPIRED' | 'PENDING';
  outcome_date: string | null;
  final_price: number | null;
  profit_loss_percent: number | null;
  hit_target: 0 | 1;
  hit_stop_loss: 0 | 1;
  days_to_target: number | null;
  max_profit_percent: number | null;
  max_loss_percent: number | null;
}

export function verifyOutcome(
  signal: Signal,
  entry: number,
  target: number,
  stop: number,
  futurePrices: PriceRow[],
  maxDays = 30
): Outcome {
  const isBuy = signal === 'BUY';
  const window = futurePrices.slice(0, maxDays);
  let status: Outcome['status'] = 'PENDING';
  let outcomeDate: string | null = null;
  let finalPrice: number | null = null;
  let daysToTarget: number | null = null;
  let maxProfit = 0;
  let maxLoss = 0;

  for (const p of window) {
    // Track max profit/loss
    if (isBuy) {
      const profit = ((p.high_price - entry) / entry) * 100;
      const loss = ((p.low_price - entry) / entry) * 100;
      if (profit > maxProfit) maxProfit = profit;
      if (loss < maxLoss) maxLoss = loss;
    } else {
      const profit = ((entry - p.low_price) / entry) * 100;
      const loss = ((entry - p.high_price) / entry) * 100;
      if (profit > maxProfit) maxProfit = profit;
      if (loss < maxLoss) maxLoss = loss;
    }

    if (outcomeDate === null) {
      if (isBuy) {
        if (p.high_price >= target) { outcomeDate = p.date; status = 'TARGET_HIT'; }
        else if (p.low_price <= stop) { outcomeDate = p.date; status = 'STOPPED'; }
      } else {
        if (p.low_price <= target) { outcomeDate = p.date; status = 'TARGET_HIT'; }
        else if (p.high_price >= stop) { outcomeDate = p.date; status = 'STOPPED'; }
      }
    }
  }

  if (outcomeDate === null) {
    if (window.length === maxDays) {
      status = 'EXPIRED';
      outcomeDate = window[window.length - 1].date;
    } else {
      status = 'PENDING';
    }
  }

  finalPrice = window.length > 0 ? window[window.length - 1].close_price : null;

  let pnl: number | null = null;
  if (status === 'TARGET_HIT') {
    pnl = isBuy ? ((target - entry) / entry) * 100 : ((entry - target) / entry) * 100;
  } else if (status === 'STOPPED') {
    pnl = isBuy ? ((stop - entry) / entry) * 100 : ((entry - stop) / entry) * 100;
  } else if (status === 'EXPIRED' && finalPrice !== null) {
    pnl = isBuy ? ((finalPrice - entry) / entry) * 100 : ((entry - finalPrice) / entry) * 100;
  }

  if (outcomeDate && window.length > 0) {
    daysToTarget = Math.round((new Date(outcomeDate).getTime() - new Date(window[0].date).getTime()) / 86400000);
  }

  return {
    status,
    outcome_date: outcomeDate,
    final_price: finalPrice !== null ? Math.round(finalPrice * 100) / 100 : null,
    profit_loss_percent: pnl !== null ? Math.round(pnl * 100) / 100 : null,
    hit_target: status === 'TARGET_HIT' ? 1 : 0,
    hit_stop_loss: status === 'STOPPED' ? 1 : 0,
    days_to_target: daysToTarget,
    max_profit_percent: Math.round(maxProfit * 100) / 100,
    max_loss_percent: Math.round(maxLoss * 100) / 100,
  };
}
