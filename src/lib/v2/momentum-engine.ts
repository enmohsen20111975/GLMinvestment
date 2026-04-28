/**
 * V2 Layer 3: Momentum & Timing Engine
 * Multi-timeframe technical analysis with trend scoring,
 * support/resistance intelligence, and signal confluence.
 *
 * Pure calculations — no external AI dependencies.
 */

import {
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  calculateStochasticRSI,
  normalizePriceHistory,
  type PricePoint,
} from '@/lib/analysis-engine';

import type {
  MomentumResult,
  TrendScore,
  SupportResistance,
  SignalConfluence,
} from './types';

import { getWeight } from './config-service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Clamp value between min and max */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Simple moving average of the last `period` values */
function sma(data: number[], period: number): number {
  if (data.length === 0 || period <= 0) return 0;
  const slice = data.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

/** Round to N decimal places */
function round(value: number, decimals: number = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

// ---------------------------------------------------------------------------
// Part A: Trend Score
// ---------------------------------------------------------------------------

function calculateTrendScore(
  stock: Record<string, unknown>,
  priceHistory: PricePoint[],
): TrendScore {
  const closes = priceHistory.map(p => p.close);
  const currentPrice = Number(stock.current_price) || (closes.length > 0 ? closes[closes.length - 1] : 0);

  if (currentPrice <= 0 || closes.length < 20) {
    return {
      score: 50,
      weeklyMACDBullish: false,
      dailyAbove50EMA: false,
      dailyAbove200EMA: false,
      rsiSweetSpot: false,
      volumeAboveAvg: false,
      details: 'بيانات غير كافية لحساب زخم الاتجاه',
    };
  }

  let trendScore = 0;
  const details: string[] = [];

  // ---- 1. Weekly MACD Bullish (40 pts) ----
  const macd = calculateMACD(closes);
  const weeklyMACDBullish = macd.histogram > 0 && macd.macdLine > macd.signalLine;
  if (weeklyMACDBullish) {
    trendScore += 40;
    details.push('MACD إيجابي (+40 نقطة)');
  } else {
    details.push('MACD سلبي');
  }

  // ---- 2. Daily > 50 EMA (30 pts) + Golden Cross Bonus (15 pts) ----
  const sma50 = closes.length >= 50 ? sma(closes, 50) : 0;
  const sma200 = closes.length >= 200 ? sma(closes, 200) : 0;

  const dailyAbove50EMA = sma50 > 0 && currentPrice > sma50;
  const dailyAbove200EMA = sma200 > 0 && currentPrice > sma200;

  if (dailyAbove50EMA) {
    trendScore += 30;
    details.push('السعر أعلى من المتوسط المتحرك 50 (+30 نقطة)');
  } else {
    details.push('السعر أقل من المتوسط المتحرك 50');
  }

  if (dailyAbove50EMA && dailyAbove200EMA) {
    trendScore += 15;
    details.push('تقاطع ذهبي — السعر أعلى من المتوسط 200 (+15 نقطة إضافية)');
  }

  // ---- 3. RSI Sweet Spot (up to 30 pts) ----
  const rsi = calculateRSI(closes);
  let rsiSweetSpot = false;
  let rsiPts = 0;

  if (rsi >= 40 && rsi <= 60) {
    rsiPts = 20;
    rsiSweetSpot = true;
    details.push(`RSI = ${round(rsi, 1)} في المنطقة المثالية (+20 نقطة)`);
  } else if (rsi < 15) {
    rsiPts = 25;
    details.push(`RSI = ${round(rsi, 1)} تشبع بيعي شديد — فرصة عالية لكن محفوفة بالمخاطر (+25 نقطة)`);
  } else if (rsi < 25) {
    rsiPts = 35;
    details.push(`RSI = ${round(rsi, 1)} تشبع بيعي عميق — فرصة شراء قوية (+35 نقطة)`);
  } else if (rsi < 35) {
    rsiPts = 30;
    details.push(`RSI = ${round(rsi, 1)} تشبع بيعي — فرصة شراء (+30 نقطة)`);
  } else if (rsi > 60 && rsi <= 70) {
    rsiPts = 10;
    details.push(`RSI = ${round(rsi, 1)} لا يزال مقبولاً (+10 نقاط)`);
  } else if (rsi > 75) {
    rsiPts = 5;
    details.push(`RSI = ${round(rsi, 1)} تشبع شرائي قوي — خطر تصحيح (+5 نقاط)`);
  }

  trendScore += rsiPts;

  // ---- 4. Volume Confirmation (10 pts) ----
  const volumeConfirmMultiplier = getWeight('volume_confirm_multiplier', 1.5);
  const recent20Volumes = priceHistory.slice(-20).map(p => p.volume);
  const avgVolume20 = recent20Volumes.length > 0
    ? recent20Volumes.reduce((s, v) => s + v, 0) / recent20Volumes.length
    : 0;
  const currentVolume = Number(stock.volume) || (priceHistory.length > 0 ? priceHistory[priceHistory.length - 1].volume : 0);

  const volumeAboveAvg = avgVolume20 > 0 && currentVolume > avgVolume20 * volumeConfirmMultiplier;

  if (volumeAboveAvg) {
    trendScore += 10;
    details.push(`حجم التداول ${round(currentVolume / avgVolume20, 1)}× أعلى من المتوسط (+10 نقاط)`);
  } else {
    details.push(`حجم التداول ضعيف (${round(currentVolume / (avgVolume20 || 1), 1)}× من المتوسط)`);
  }

  // Clamp score to 0-100
  trendScore = clamp(Math.round(trendScore), 0, 100);

  return {
    score: trendScore,
    weeklyMACDBullish,
    dailyAbove50EMA,
    dailyAbove200EMA,
    rsiSweetSpot,
    volumeAboveAvg,
    details: details.join(' | '),
  };
}

// ---------------------------------------------------------------------------
// Part B: Support / Resistance Intelligence
// ---------------------------------------------------------------------------

interface IndicatorBundle {
  bollinger: { upper: number; middle: number; lower: number; bandwidth: number };
  atr: number;
}

function calculateSupportResistance(
  stock: Record<string, unknown>,
  priceHistory: PricePoint[],
  indicators: IndicatorBundle,
): SupportResistance {
  const closes = priceHistory.map(p => p.close);
  const currentPrice = Number(stock.current_price) || (closes.length > 0 ? closes[closes.length - 1] : 0);

  if (currentPrice <= 0 || priceHistory.length < 20) {
    return {
      strongSupport: Number(stock.support_level) || 0,
      strongResistance: Number(stock.resistance_level) || 0,
      positionPercent: 50,
      zone: 'normal',
      zoneAr: 'عادي',
    };
  }

  // 3-month low / high (~60 trading days)
  const threeMonthWindow = priceHistory.slice(-60);
  const threeMonthLow = threeMonthWindow.length > 0
    ? Math.min(...threeMonthWindow.map(p => p.low))
    : currentPrice;
  const threeMonthHigh = threeMonthWindow.length > 0
    ? Math.max(...threeMonthWindow.map(p => p.high))
    : currentPrice;

  // Bollinger Bands
  const { lower: bbLower, upper: bbUpper } = indicators.bollinger;

  // Pivot Points (Classic formula)
  const lastBar = priceHistory[priceHistory.length - 1];
  const pivot = (lastBar.high + lastBar.low + lastBar.close) / 3;
  const pivotS1 = 2 * pivot - lastBar.high;
  const pivotR1 = 2 * pivot - lastBar.low;
  const pivotS2 = pivot - (pivotR1 - pivotS1);
  const pivotR2 = pivot + (pivotR1 - pivotS1);

  // Strong Support = MIN(3-month low, Bollinger Lower, Pivot S2)
  const strongSupport = Math.min(threeMonthLow, bbLower, pivotS2);

  // Strong Resistance = MAX(3-month high, Bollinger Upper, Pivot R2)
  const strongResistance = Math.max(threeMonthHigh, bbUpper, pivotR2);

  // Position %
  const range = strongResistance - strongSupport;
  let positionPercent = 50;
  let zone: 'accumulation' | 'normal' | 'distribution';
  let zoneAr: string;

  if (range > 0) {
    positionPercent = clamp(round(((currentPrice - strongSupport) / range) * 100, 1), 0, 100);
  }

  if (positionPercent < 20) {
    zone = 'accumulation';
    zoneAr = 'منطقة تجميع';
  } else if (positionPercent > 80) {
    zone = 'distribution';
    zoneAr = 'منطقة توزيع';
  } else {
    zone = 'normal';
    zoneAr = 'عادي';
  }

  return {
    strongSupport: round(strongSupport, 4),
    strongResistance: round(strongResistance, 4),
    positionPercent,
    zone,
    zoneAr,
  };
}

// ---------------------------------------------------------------------------
// Part C: Signal Confluence
// ---------------------------------------------------------------------------

/**
 * Check alignment of 3 signals:
 * 1. Quality Score > config `quality_min_recommend` (default 70)
 * 2. Technical Score (trend score) > config `technical_min_recommend` (default 60)
 * 3. Volume Confirmation > 1.5x average
 *
 * Only if all 3 align does the recommendation trigger.
 */
export function checkSignalConfluence(
  qualityScore: number,
  technicalScore: number,
  volumeConfirmed: boolean,
): SignalConfluence {
  const qualityMin = getWeight('quality_min_recommend', 70);
  const technicalMin = getWeight('technical_min_recommend', 60);

  const qualityAligned = qualityScore > qualityMin;
  const technicalAligned = technicalScore > technicalMin;
  const volumeAligned = volumeConfirmed;

  const alignedCount = [qualityAligned, technicalAligned, volumeAligned].filter(Boolean).length;
  const requiredCount = 3;
  const allAligned = alignedCount === requiredCount;

  return {
    qualityAligned,
    technicalAligned,
    volumeAligned,
    alignedCount,
    requiredCount,
    allAligned,
  };
}

// ---------------------------------------------------------------------------
// Main Export: calculateMomentum
// ---------------------------------------------------------------------------

/**
 * Layer 3: Momentum & Timing Engine
 *
 * Computes a multi-timeframe technical momentum score along with
 * support/resistance intelligence and signal confluence.
 *
 * @param stock      - Stock record with fields: ticker, current_price, previous_close, volume, support_level, resistance_level
 * @param priceHistory - Array of price records with fields: open_price, high_price, low_price, close_price, volume, date
 * @returns MomentumResult with trendScore, supportResistance, signalConfluence, volumeConfirm
 */
export function calculateMomentum(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>,
): MomentumResult {
  // Normalize price history using the shared utility
  const normalized = normalizePriceHistory(priceHistory);

  // --- Guard: insufficient data → conservative defaults ---
  if (normalized.length < 20) {
    const conservativeTrend: TrendScore = {
      score: 50,
      weeklyMACDBullish: false,
      dailyAbove50EMA: false,
      dailyAbove200EMA: false,
      rsiSweetSpot: false,
      volumeAboveAvg: false,
      details: 'بيانات تاريخية غير كافية (أقل من 20 نقطة) — تم استخدام القيم المحافظة الافتراضية',
    };

    const conservativeSR: SupportResistance = {
      strongSupport: Number(stock.support_level) || 0,
      strongResistance: Number(stock.resistance_level) || 0,
      positionPercent: 50,
      zone: 'normal',
      zoneAr: 'عادي',
    };

    const conservativeConfluence: SignalConfluence = {
      qualityAligned: false,
      technicalAligned: false,
      volumeAligned: false,
      alignedCount: 0,
      requiredCount: 3,
      allAligned: false,
    };

    return {
      score: 50,
      trendScore: conservativeTrend,
      supportResistance: conservativeSR,
      signalConfluence: conservativeConfluence,
      volumeConfirm: false,
    };
  }

  const closes = normalized.map(p => p.close);

  // --- Part A: Trend Score ---
  const trendScore = calculateTrendScore(stock, normalized);

  // --- Part B: Support / Resistance ---
  const bollinger = calculateBollingerBands(closes);
  const atr = calculateATR(normalized);
  const indicators: IndicatorBundle = { bollinger, atr };

  const supportResistance = calculateSupportResistance(stock, normalized, indicators);

  // --- Part C: Signal Confluence ---
  // The technical score is the trend score; the quality score will be provided
  // by Layer 2 (Quality Engine) when orchestrating the full pipeline.
  // Here we compute volume confirmation for the confluence check.
  const volumeConfirmMultiplier = getWeight('volume_confirm_multiplier', 1.5);
  const recent20Volumes = normalized.slice(-20).map(p => p.volume);
  const avgVolume20 = recent20Volumes.reduce((s, v) => s + v, 0) / recent20Volumes.length;
  const currentVolume = Number(stock.volume) || normalized[normalized.length - 1].volume;
  const volumeConfirmed = avgVolume20 > 0 && currentVolume > avgVolume20 * volumeConfirmMultiplier;

  // For the confluence check, we use 0 for qualityScore since it comes from Layer 2.
  // The orchestrator will call checkSignalConfluence() with the actual quality score.
  // Here we just embed the volume state and pre-fill technical alignment.
  const signalConfluence: SignalConfluence = {
    qualityAligned: false, // will be set by orchestrator
    technicalAligned: trendScore.score > getWeight('technical_min_recommend', 60),
    volumeAligned: volumeConfirmed,
    alignedCount: [false, trendScore.score > getWeight('technical_min_recommend', 60), volumeConfirmed].filter(Boolean).length,
    requiredCount: 3,
    allAligned: false, // requires quality score from Layer 2
  };

  // --- Composite Momentum Score ---
  // Trend Score 65%, Volume Confirmation 20%, Trend Consistency 15%
  // Volume confirmed boosts, but doesn't dominate
  const volumeBoost = volumeConfirmed ? 75 : 35;
  const consistencyBoost = trendScore.dailyAbove50EMA ? 55 : 25;
  const score = clamp(
    Math.round(
      trendScore.score * 0.65 +
      volumeBoost * 0.20 +
      consistencyBoost * 0.15
    ),
    0,
    100,
  );

  return {
    score,
    trendScore,
    supportResistance,
    signalConfluence,
    volumeConfirm: volumeConfirmed,
  };
}
