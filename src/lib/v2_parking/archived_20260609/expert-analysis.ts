/**
 * V2 Expert Analysis Engine — Human-Like Stock Analysis Logic
 * 
 * This module implements the "expert mind" logic for Egyptian stock market analysis.
 * Based on professional analyst methodology, not just mathematical formulas.
 * 
 * Features:
 * - Dead Stock Detection (الأسهم الميتة)
 * - Fibonacci Retracement Levels
 * - Ichimoku Cloud Analysis
 * - Dividend Price Adjustment
 * - Advanced Pattern Recognition (Wedges, Flags, Head & Shoulders)
 * - Human-Like Scoring System
 * 
 * @version 2.2.0
 */

import type { PricePoint } from '@/lib/analysis-engine';
import type {
  SafetyViolation,
  RedFlag,
  MarketRegime,
} from './types';

// ==================== TYPES ====================

export interface DeadStockResult {
  isDead: boolean;
  reasons: string[];
  reasonsAr: string[];
  score: number; // 0-100, lower = deader
}

export interface FibonacciLevels {
  level_236: number;
  level_382: number;
  level_500: number;
  level_618: number;
  level_786: number;
  currentLevel: string; // which level price is closest to
  currentLevelAr: string;
  inBuyZone: boolean; // price in 38.2%-61.8% retracement zone
}

export interface IchimokuResult {
  tenkanSen: number;      // Conversion Line (9-period)
  kijunSen: number;       // Base Line (26-period)
  senkouA: number;        // Leading Span A
  senkouB: number;        // Leading Span B
  chikouSpan: number;     // Lagging Span
  cloudTop: number;
  cloudBottom: number;
  pricePosition: 'above_cloud' | 'in_cloud' | 'below_cloud';
  pricePositionAr: string;
  trend: 'bullish' | 'bearish' | 'neutral';
  trendAr: string;
  signalStrength: number; // 0-100
  futureCloudBullish: boolean;
  tkCross: 'bullish' | 'bearish' | 'none';
  tkCrossAr: string;
}

export interface DividendAdjustment {
  needsAdjustment: boolean;
  adjustedPrices: number[];
  adjustmentType: 'cash' | 'stock' | 'none';
  dividendValue: number;
  exDividendDate: string | null;
  warning: string | null; // if dividend > 50% of earnings
}

export interface AdvancedPattern {
  name: string;
  nameAr: string;
  type: 'bullish' | 'bearish' | 'neutral';
  reliability: 'high' | 'medium' | 'low';
  reliabilityAr: string;
  targetPrice: number | null;
  stopLoss: number | null;
  confidence: number; // 0-100
}

export interface ExpertScoring {
  total: number; // 0-100
  breakdown: {
    marketDirection: { score: number; weight: number; reason: string; reasonAr: string };
    trendStrength: { score: number; weight: number; reason: string; reasonAr: string };
    supportResistance: { score: number; weight: number; reason: string; reasonAr: string };
    fibonacci: { score: number; weight: number; reason: string; reasonAr: string };
    candlePatterns: { score: number; weight: number; reason: string; reasonAr: string };
    momentum: { score: number; weight: number; reason: string; reasonAr: string };
    volume: { score: number; weight: number; reason: string; reasonAr: string };
    ichimoku: { score: number; weight: number; reason: string; reasonAr: string };
    rsi: { score: number; weight: number; reason: string; reasonAr: string };
  };
  verdict: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  verdictAr: string;
}

// ==================== HELPERS ====================

function toNum(v: unknown, fallback: number = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, decimals: number = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function sma(data: number[], period: number): number {
  if (data.length === 0 || period <= 0) return 0;
  const slice = data.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

function ema(data: number[], period: number): number[] {
  if (data.length === 0 || period <= 0) return [];
  const result: number[] = [];
  const k = 2 / (period + 1);
  let prev = sma(data.slice(0, period), period);
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
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

function highest(data: number[], period: number, offset: number = 0): number {
  const slice = data.slice(-(period + offset), data.length - offset || data.length);
  return slice.length > 0 ? Math.max(...slice) : 0;
}

function lowest(data: number[], period: number, offset: number = 0): number {
  const slice = data.slice(-(period + offset), data.length - offset || data.length);
  return slice.length > 0 ? Math.min(...slice) : 0;
}

// ==================== 1. DEAD STOCK DETECTION ====================

/**
 * Detect "dead stocks" (الأسهم الميتة) - stocks with no real market activity.
 * 
 * Criteria from expert analysis:
 * 1. Daily volume < 0.1% of free float
 * 2. Bid-Ask spread > 1% of price
 * 3. More than 40% Doji candles in last 20 days
 * 4. Price in bottom 10% of 52-week range with no breakout
 */
export function detectDeadStock(
  stock: Record<string, unknown>,
  priceHistory: PricePoint[]
): DeadStockResult {
  const reasons: string[] = [];
  const reasonsAr: string[] = [];
  let score = 100;
  
  const currentPrice = toNum(stock.current_price);
  const volume = toNum(stock.volume);
  const freeFloat = toNum(stock.free_float, toNum(stock.market_cap) / currentPrice || 1000000);
  
  // 1. Volume check: < 0.1% of free float
  if (freeFloat > 0 && volume > 0) {
    const volumePercent = (volume / freeFloat) * 100;
    if (volumePercent < 0.1) {
      reasons.push(`Volume ${volumePercent.toFixed(3)}% of free float - extremely low liquidity`);
      reasonsAr.push(`حجم التداول ${volumePercent.toFixed(3)}% من الأسهم الحرة - سيولة منخفضة للغاية`);
      score -= 40;
    } else if (volumePercent < 0.5) {
      reasons.push(`Volume ${volumePercent.toFixed(2)}% of free float - low liquidity`);
      reasonsAr.push(`حجم التداول ${volumePercent.toFixed(2)}% من الأسهم الحرة - سيولة منخفضة`);
      score -= 20;
    }
  }
  
  // 2. Spread estimation (using daily high-low as proxy)
  if (priceHistory.length >= 5) {
    const recentPrices = priceHistory.slice(-5);
    let avgSpread = 0;
    for (const p of recentPrices) {
      if (p.high > 0 && p.low > 0) {
        avgSpread += (p.high - p.low) / p.high;
      }
    }
    avgSpread /= recentPrices.length;
    
    if (avgSpread > 0.05) { // > 5% daily range = high spread/volatility risk
      reasons.push(`Average daily spread ${(avgSpread * 100).toFixed(1)}% - high price uncertainty`);
      reasonsAr.push(`متوسط الفجوة اليومية ${(avgSpread * 100).toFixed(1)}% - عدم يقين في السعر`);
      score -= 15;
    }
  }
  
  // 3. Doji candle detection (flat candles = no decision)
  if (priceHistory.length >= 20) {
    const recent20 = priceHistory.slice(-20);
    let dojiCount = 0;
    
    for (const p of recent20) {
      const body = Math.abs(p.close - p.open);
      const range = p.high - p.low;
      // Doji: body < 10% of range
      if (range > 0 && body / range < 0.1) {
        dojiCount++;
      }
    }
    
    const dojiPercent = (dojiCount / 20) * 100;
    if (dojiPercent >= 40) {
      reasons.push(`${dojiPercent.toFixed(0)}% Doji candles - stock is "asleep"`);
      reasonsAr.push(`${dojiPercent.toFixed(0)}% شموع مسطحة - السهم "نايم"`);
      score -= 30;
    } else if (dojiPercent >= 25) {
      reasons.push(`${dojiPercent.toFixed(0)}% Doji candles - low activity`);
      reasonsAr.push(`${dojiPercent.toFixed(0)}% شموع مسطحة - نشاط منخفض`);
      score -= 15;
    }
  }
  
  // 4. 52-week range check
  if (priceHistory.length >= 60) {
    const yearPrices = priceHistory.slice(-250); // ~1 year of trading days
    const yearHigh = Math.max(...yearPrices.map(p => p.high));
    const yearLow = Math.min(...yearPrices.map(p => p.low));
    const yearRange = yearHigh - yearLow;
    
    if (yearRange > 0) {
      const positionInRange = (currentPrice - yearLow) / yearRange;
      
      if (positionInRange < 0.1) {
        // Price in bottom 10% of yearly range
        reasons.push(`Price in bottom 10% of 52-week range - possible "glass ceiling"`);
        reasonsAr.push(`السعر في أدنى 10% من النطاق السنوي - "سقف زجاجي" محتمل`);
        score -= 20;
      }
    }
  }
  
  // 5. Price too low (penny stock risk)
  if (currentPrice > 0 && currentPrice < 2) {
    reasons.push(`Price ${currentPrice.toFixed(2)} EGP - penny stock territory`);
    reasonsAr.push(`السعر ${currentPrice.toFixed(2)} جنيه - منطقة أسهم رخيصة عالية المخاطر`);
    score -= 15;
  }
  
  score = clamp(score, 0, 100);
  
  return {
    isDead: score < 40,
    reasons,
    reasonsAr,
    score,
  };
}

// ==================== 2. FIBONACCI RETRACEMENT ====================

/**
 * Calculate Fibonacci retracement levels from a significant price swing.
 * 
 * The "expert mind" logic:
 * - 38.2%: Light retracement - stock is strong
 * - 50%: Mid point - decision point
 * - 61.8%: Deep retracement - strong support zone
 * - 78.6%: "Red line" - if broken, trend is reversed
 */
export function calculateFibonacci(
  priceHistory: PricePoint[]
): FibonacciLevels | null {
  if (priceHistory.length < 30) return null;
  
  const closes = priceHistory.map(p => p.close);
  const currentPrice = closes[closes.length - 1];
  
  // Find significant swing (look for clear wave in last 60 days)
  const lookback = Math.min(60, closes.length);
  const recentCloses = closes.slice(-lookback);
  
  // Find swing high and low
  let swingHigh = recentCloses[0];
  let swingLow = recentCloses[0];
  let swingHighIndex = 0;
  let swingLowIndex = 0;
  
  for (let i = 1; i < recentCloses.length; i++) {
    if (recentCloses[i] > swingHigh) {
      swingHigh = recentCloses[i];
      swingHighIndex = i;
    }
    if (recentCloses[i] < swingLow) {
      swingLow = recentCloses[i];
      swingLowIndex = i;
    }
  }
  
  // Determine trend direction
  const isUpTrend = swingHighIndex > swingLowIndex;
  
  // Calculate Fibonacci levels
  const range = swingHigh - swingLow;
  let level_236: number, level_382: number, level_500: number, level_618: number, level_786: number;
  
  if (isUpTrend) {
    // Uptrend: measure from low to high
    level_236 = swingHigh - range * 0.236;
    level_382 = swingHigh - range * 0.382;
    level_500 = swingHigh - range * 0.500;
    level_618 = swingHigh - range * 0.618;
    level_786 = swingHigh - range * 0.786;
  } else {
    // Downtrend: measure from high to low
    level_236 = swingLow + range * 0.236;
    level_382 = swingLow + range * 0.382;
    level_500 = swingLow + range * 0.500;
    level_618 = swingLow + range * 0.618;
    level_786 = swingLow + range * 0.786;
  }
  
  // Determine current level
  const levels = [
    { name: '23.6%', nameAr: '٢٣.٦٪', value: level_236 },
    { name: '38.2%', nameAr: '٣٨.٢٪', value: level_382 },
    { name: '50%', nameAr: '٥٠٪', value: level_500 },
    { name: '61.8%', nameAr: '٦١.٨٪', value: level_618 },
    { name: '78.6%', nameAr: '٧٨.٦٪', value: level_786 },
  ];
  
  let closestLevel = levels[0];
  let minDistance = Math.abs(currentPrice - levels[0].value);
  
  for (const level of levels) {
    const distance = Math.abs(currentPrice - level.value);
    if (distance < minDistance) {
      minDistance = distance;
      closestLevel = level;
    }
  }
  
  // Check if in buy zone (38.2% - 61.8% retracement in uptrend)
  const inBuyZone = isUpTrend && 
    currentPrice >= level_618 && 
    currentPrice <= level_382;
  
  return {
    level_236: round(level_236, 4),
    level_382: round(level_382, 4),
    level_500: round(level_500, 4),
    level_618: round(level_618, 4),
    level_786: round(level_786, 4),
    currentLevel: closestLevel.name,
    currentLevelAr: closestLevel.nameAr,
    inBuyZone,
  };
}

// ==================== 3. ICHIMOKU CLOUD ====================

/**
 * Calculate Ichimoku Cloud indicators.
 * 
 * The "one glance" system that tells you:
 * - Trend direction (above/below cloud)
 * - Signal strength (TK cross)
 * - Future trend (cloud projection)
 */
export function calculateIchimoku(
  priceHistory: PricePoint[]
): IchimokuResult | null {
  if (priceHistory.length < 52) return null;
  
  const closes = priceHistory.map(p => p.close);
  const currentPrice = closes[closes.length - 1];
  
  // Tenkan-sen (Conversion Line): 9-period high/low avg
  const tenkanHigh = highest(closes, 9);
  const tenkanLow = lowest(closes, 9);
  const tenkanSen = (tenkanHigh + tenkanLow) / 2;
  
  // Kijun-sen (Base Line): 26-period high/low avg
  const kijunHigh = highest(closes, 26);
  const kijunLow = lowest(closes, 26);
  const kijunSen = (kijunHigh + kijunLow) / 2;
  
  // Senkou Span A (Leading Span A): avg of Tenkan and Kijun, plotted 26 periods ahead
  const senkouA = (tenkanSen + kijunSen) / 2;
  
  // Senkou Span B (Leading Span B): 52-period high/low avg, plotted 26 periods ahead
  const senkouBHigh = highest(closes, 52);
  const senkouBLow = lowest(closes, 52);
  const senkouB = (senkouBHigh + senkouBLow) / 2;
  
  // Chikou Span (Lagging Span): current close plotted 26 periods back
  const chikouSpan = currentPrice;
  
  // Cloud top and bottom
  const cloudTop = Math.max(senkouA, senkouB);
  const cloudBottom = Math.min(senkouA, senkouB);
  
  // Price position relative to cloud
  let pricePosition: 'above_cloud' | 'in_cloud' | 'below_cloud';
  let pricePositionAr: string;
  
  if (currentPrice > cloudTop) {
    pricePosition = 'above_cloud';
    pricePositionAr = 'أعلى السحابة (ترند صاعد)';
  } else if (currentPrice < cloudBottom) {
    pricePosition = 'below_cloud';
    pricePositionAr = 'تحت السحابة (ترند هابط)';
  } else {
    pricePosition = 'in_cloud';
    pricePositionAr = 'داخل السحابة (ضبابية)';
  }
  
  // TK Cross signal
  let tkCross: 'bullish' | 'bearish' | 'none';
  let tkCrossAr: string;
  
  if (tenkanSen > kijunSen) {
    tkCross = 'bullish';
    tkCrossAr = 'تقاطع صعودي';
  } else if (tenkanSen < kijunSen) {
    tkCross = 'bearish';
    tkCrossAr = 'تقاطع هبوطي';
  } else {
    tkCross = 'none';
    tkCrossAr = 'لا تقاطع';
  }
  
  // Future cloud bullish?
  const futureCloudBullish = senkouA > senkouB;
  
  // Determine trend
  let trend: 'bullish' | 'bearish' | 'neutral';
  let trendAr: string;
  
  if (pricePosition === 'above_cloud' && tkCross === 'bullish' && futureCloudBullish) {
    trend = 'bullish';
    trendAr = 'صاعد قوي';
  } else if (pricePosition === 'below_cloud' && tkCross === 'bearish' && !futureCloudBullish) {
    trend = 'bearish';
    trendAr = 'هابط قوي';
  } else {
    trend = 'neutral';
    trendAr = 'محايد';
  }
  
  // Calculate signal strength (0-100)
  let signalStrength = 50;
  
  // Price position (±20 points)
  if (pricePosition === 'above_cloud') signalStrength += 20;
  else if (pricePosition === 'below_cloud') signalStrength -= 20;
  
  // TK cross (±15 points)
  if (tkCross === 'bullish' && pricePosition === 'above_cloud') signalStrength += 15;
  else if (tkCross === 'bearish' && pricePosition === 'below_cloud') signalStrength -= 15;
  
  // Future cloud (±10 points)
  if (futureCloudBullish && pricePosition === 'above_cloud') signalStrength += 10;
  else if (!futureCloudBullish && pricePosition === 'below_cloud') signalStrength -= 10;
  
  // Chikou span confirmation (±5 points)
  if (priceHistory.length > 26) {
    const price26Ago = closes[closes.length - 26];
    if (chikouSpan > price26Ago) signalStrength += 5;
    else signalStrength -= 5;
  }
  
  return {
    tenkanSen: round(tenkanSen, 4),
    kijunSen: round(kijunSen, 4),
    senkouA: round(senkouA, 4),
    senkouB: round(senkouB, 4),
    chikouSpan: round(chikouSpan, 4),
    cloudTop: round(cloudTop, 4),
    cloudBottom: round(cloudBottom, 4),
    pricePosition,
    pricePositionAr,
    trend,
    trendAr,
    signalStrength: clamp(Math.round(signalStrength), 0, 100),
    futureCloudBullish,
    tkCross,
    tkCrossAr,
  };
}

// ==================== 4. DIVIDEND ADJUSTMENT ====================

/**
 * Adjust historical prices for dividends and stock splits.
 * 
 * Critical for Egyptian market where:
 * - Cash dividends cause price drops on ex-date
 * - Stock dividends (bonuses) cause price halving
 * - Failure to adjust leads to false signals
 */
export function adjustForDividend(
  priceHistory: PricePoint[],
  dividendInfo: {
    type: 'cash' | 'stock';
    value: number;
    exDate: string;
    ratio?: number; // for stock dividends, e.g., 1:1 means every share = 2 shares
    yearEarnings?: number; // for warning check
  }
): DividendAdjustment {
  if (!dividendInfo || dividendInfo.value <= 0) {
    return {
      needsAdjustment: false,
      adjustedPrices: priceHistory.map(p => p.close),
      adjustmentType: 'none',
      dividendValue: 0,
      exDividendDate: null,
      warning: null,
    };
  }
  
  const exDateIndex = priceHistory.findIndex(p => p.date === dividendInfo.exDate);
  
  if (exDateIndex === -1) {
    return {
      needsAdjustment: false,
      adjustedPrices: priceHistory.map(p => p.close),
      adjustmentType: dividendInfo.type,
      dividendValue: dividendInfo.value,
      exDividendDate: dividendInfo.exDate,
      warning: null,
    };
  }
  
  const adjustedPrices: number[] = [];
  let warning: string | null = null;
  
  // Check if dividend is suspiciously high
  if (dividendInfo.yearEarnings && dividendInfo.type === 'cash') {
    const payoutRatio = (dividendInfo.value / dividendInfo.yearEarnings) * 100;
    if (payoutRatio > 100) {
      warning = `تحذير: التوزيع (${dividendInfo.value} جنيه) يتجاوز أرباح السنة (${dividendInfo.yearEarnings} جنيه) - استنزاف رأسمال`;
    } else if (payoutRatio > 50) {
      warning = `تنبيه: نسبة التوزيع ${payoutRatio.toFixed(0)}% مرتفعة - قد يكون استنزاف`;
    }
  }
  
  if (dividendInfo.type === 'cash') {
    // Cash dividend: subtract from all prices before ex-date
    for (let i = 0; i < priceHistory.length; i++) {
      if (i < exDateIndex) {
        adjustedPrices.push(priceHistory[i].close - dividendInfo.value);
      } else {
        adjustedPrices.push(priceHistory[i].close);
      }
    }
  } else {
    // Stock dividend (bonus): divide all prices before ex-date
    const ratio = dividendInfo.ratio || 1; // e.g., 1:1 = 2x shares
    const divisor = 1 + ratio;
    
    for (let i = 0; i < priceHistory.length; i++) {
      if (i < exDateIndex) {
        adjustedPrices.push(priceHistory[i].close / divisor);
      } else {
        adjustedPrices.push(priceHistory[i].close);
      }
    }
  }
  
  return {
    needsAdjustment: true,
    adjustedPrices,
    adjustmentType: dividendInfo.type,
    dividendValue: dividendInfo.value,
    exDividendDate: dividendInfo.exDate,
    warning,
  };
}

// ==================== 5. ADVANCED PATTERN RECOGNITION ====================

/**
 * Detect advanced chart patterns beyond basic double top/bottom.
 * 
 * Patterns detected:
 * - Rising Wedge (الوتد الصاعد) - bearish
 * - Falling Wedge (الوتد الهابط) - bullish
 * - Flag (العلم) - continuation
 * - Head and Shoulders (الرأس والكتفين) - reversal
 * - Cup and Handle (الكوب والقبضة) - bullish continuation
 */
export function detectAdvancedPatterns(
  priceHistory: PricePoint[]
): AdvancedPattern[] {
  const patterns: AdvancedPattern[] = [];
  if (priceHistory.length < 30) return patterns;
  
  const closes = priceHistory.map(p => p.close);
  const currentPrice = closes[closes.length - 1];
  
  // ----- 1. Rising Wedge (Bearish) -----
  // Price makes higher highs and higher lows, but lines converge
  if (closes.length >= 20) {
    const recent = closes.slice(-20);
    const highs: number[] = [];
    const lows: number[] = [];
    
    for (let i = 2; i < recent.length - 2; i++) {
      if (recent[i] > recent[i-1] && recent[i] > recent[i+1] && 
          recent[i] > recent[i-2] && recent[i] > recent[i+2]) {
        highs.push(recent[i]);
      }
      if (recent[i] < recent[i-1] && recent[i] < recent[i+1] &&
          recent[i] < recent[i-2] && recent[i] < recent[i+2]) {
        lows.push(recent[i]);
      }
    }
    
    if (highs.length >= 2 && lows.length >= 2) {
      const firstHigh = highs[0];
      const lastHigh = highs[highs.length - 1];
      const firstLow = lows[0];
      const lastLow = lows[lows.length - 1];
      
      // Rising wedge: higher highs AND higher lows, but converging
      const highsRising = lastHigh > firstHigh;
      const lowsRising = lastLow > firstLow;
      const converging = (lastHigh - firstHigh) < (lastLow - firstLow);
      
      if (highsRising && lowsRising && converging) {
        patterns.push({
          name: 'Rising Wedge',
          nameAr: 'وتد صاعد',
          type: 'bearish',
          reliability: 'medium',
          reliabilityAr: 'متوسطة',
          targetPrice: round(lastLow * 0.95, 4),
          stopLoss: round(lastHigh * 1.02, 4),
          confidence: 65,
        });
      }
    }
  }
  
  // ----- 2. Falling Wedge (Bullish) -----
  if (closes.length >= 20) {
    const recent = closes.slice(-20);
    const highs: number[] = [];
    const lows: number[] = [];
    
    for (let i = 2; i < recent.length - 2; i++) {
      if (recent[i] > recent[i-1] && recent[i] > recent[i+1]) {
        highs.push(recent[i]);
      }
      if (recent[i] < recent[i-1] && recent[i] < recent[i+1]) {
        lows.push(recent[i]);
      }
    }
    
    if (highs.length >= 2 && lows.length >= 2) {
      const firstHigh = highs[0];
      const lastHigh = highs[highs.length - 1];
      const firstLow = lows[0];
      const lastLow = lows[lows.length - 1];
      
      // Falling wedge: lower highs AND lower lows, but converging
      const highsFalling = lastHigh < firstHigh;
      const lowsFalling = lastLow < firstLow;
      const converging = (firstLow - lastLow) > (firstHigh - lastHigh);
      
      if (highsFalling && lowsFalling && converging) {
        patterns.push({
          name: 'Falling Wedge',
          nameAr: 'وتد هابط',
          type: 'bullish',
          reliability: 'medium',
          reliabilityAr: 'متوسطة',
          targetPrice: round(lastHigh * 1.10, 4),
          stopLoss: round(lastLow * 0.98, 4),
          confidence: 70,
        });
      }
    }
  }
  
  // ----- 3. Bull Flag (Continuation) -----
  // Sharp rise followed by consolidation
  if (closes.length >= 30) {
    const first10 = closes.slice(-30, -20);
    const last20 = closes.slice(-20);
    
    const first10Change = (first10[first10.length - 1] - first10[0]) / first10[0];
    const last20Range = (Math.max(...last20) - Math.min(...last20)) / Math.min(...last20);
    
    // Rocket: > 15% rise in first 10 days
    // Flag: < 5% range in last 20 days
    if (first10Change > 0.15 && last20Range < 0.05) {
      const flagHigh = Math.max(...last20);
      const flagLow = Math.min(...last20);
      
      patterns.push({
        name: 'Bull Flag',
        nameAr: 'علم صعودي',
        type: 'bullish',
        reliability: 'high',
        reliabilityAr: 'عالية',
        targetPrice: round(flagHigh + (flagHigh - flagLow) * 2, 4),
        stopLoss: round(flagLow * 0.98, 4),
        confidence: 75,
      });
    }
  }
  
  // ----- 4. Head and Shoulders (Reversal) -----
  if (closes.length >= 40) {
    const recent = closes.slice(-40);
    
    // Find peaks
    const peaks: { index: number; value: number }[] = [];
    for (let i = 5; i < recent.length - 5; i++) {
      let isPeak = true;
      for (let j = i - 5; j <= i + 5; j++) {
        if (j !== i && recent[j] >= recent[i]) {
          isPeak = false;
          break;
        }
      }
      if (isPeak) {
        peaks.push({ index: i, value: recent[i] });
      }
    }
    
    // Look for 3-peak pattern (left shoulder, head, right shoulder)
    if (peaks.length >= 3) {
      for (let i = 0; i < peaks.length - 2; i++) {
        const left = peaks[i];
        const head = peaks[i + 1];
        const right = peaks[i + 2];
        
        // Head should be highest
        if (head.value > left.value && head.value > right.value) {
          // Shoulders should be similar (within 5%)
          const shoulderDiff = Math.abs(left.value - right.value) / left.value;
          
          if (shoulderDiff < 0.05) {
            // Find neckline (troughs between peaks)
            const necklineLeft = Math.min(...recent.slice(left.index, head.index));
            const necklineRight = Math.min(...recent.slice(head.index, right.index));
            const neckline = (necklineLeft + necklineRight) / 2;
            
            // Pattern height
            const patternHeight = head.value - neckline;
            const targetPrice = neckline - patternHeight;
            
            patterns.push({
              name: 'Head and Shoulders',
              nameAr: 'الرأس والكتفين',
              type: 'bearish',
              reliability: 'high',
              reliabilityAr: 'عالية',
              targetPrice: round(targetPrice, 4),
              stopLoss: round(head.value * 1.02, 4),
              confidence: 80,
            });
            break;
          }
        }
      }
    }
  }
  
  // ----- 5. Inverse Head and Shoulders (Bullish Reversal) -----
  if (closes.length >= 40) {
    const recent = closes.slice(-40);
    
    // Find troughs
    const troughs: { index: number; value: number }[] = [];
    for (let i = 5; i < recent.length - 5; i++) {
      let isTrough = true;
      for (let j = i - 5; j <= i + 5; j++) {
        if (j !== i && recent[j] <= recent[i]) {
          isTrough = false;
          break;
        }
      }
      if (isTrough) {
        troughs.push({ index: i, value: recent[i] });
      }
    }
    
    if (troughs.length >= 3) {
      for (let i = 0; i < troughs.length - 2; i++) {
        const left = troughs[i];
        const head = troughs[i + 1];
        const right = troughs[i + 2];
        
        // Head should be lowest
        if (head.value < left.value && head.value < right.value) {
          const shoulderDiff = Math.abs(left.value - right.value) / left.value;
          
          if (shoulderDiff < 0.05) {
            const necklineLeft = Math.max(...recent.slice(left.index, head.index));
            const necklineRight = Math.max(...recent.slice(head.index, right.index));
            const neckline = (necklineLeft + necklineRight) / 2;
            
            const patternHeight = neckline - head.value;
            const targetPrice = neckline + patternHeight;
            
            patterns.push({
              name: 'Inverse Head and Shoulders',
              nameAr: 'الرأس والكتفين المقلوب',
              type: 'bullish',
              reliability: 'high',
              reliabilityAr: 'عالية',
              targetPrice: round(targetPrice, 4),
              stopLoss: round(head.value * 0.98, 4),
              confidence: 80,
            });
            break;
          }
        }
      }
    }
  }
  
  // ----- 6. Cup and Handle -----
  if (closes.length >= 60) {
    const cup = closes.slice(-60, -20);
    const handle = closes.slice(-20);
    
    const cupStart = cup[0];
    const cupEnd = cup[cup.length - 1];
    const cupLow = Math.min(...cup);
    const cupHigh = Math.max(...cup);
    
    // Cup should be U-shaped (start ≈ end, lower in middle)
    const cupDepth = (cupHigh - cupLow) / cupHigh;
    const cupSymmetry = Math.abs(cupStart - cupEnd) / cupStart;
    
    // Handle should be slight pullback (5-15%)
    const handleHigh = Math.max(...handle);
    const handleLow = Math.min(...handle);
    const handleDepth = (handleHigh - handleLow) / handleHigh;
    
    if (cupDepth > 0.15 && cupDepth < 0.50 && 
        cupSymmetry < 0.10 && 
        handleDepth > 0.05 && handleDepth < 0.15) {
      
      patterns.push({
        name: 'Cup and Handle',
        nameAr: 'الكوب والقبضة',
        type: 'bullish',
        reliability: 'high',
        reliabilityAr: 'عالية',
        targetPrice: round(cupHigh * 1.20, 4),
        stopLoss: round(handleLow * 0.98, 4),
        confidence: 75,
      });
    }
  }
  
  return patterns;
}

// ==================== 6. EXPERT SCORING SYSTEM ====================

/**
 * Calculate expert-like scoring based on multiple factors.
 * 
 * Scoring breakdown (total 100 points):
 * - Market Direction: 15 points
 * - Trend Strength (ADX): 15 points
 * - Support/Resistance Position: 15 points
 * - Fibonacci Level: 10 points
 * - Candle Patterns: 10 points
 * - Momentum (RSI/MACD): 10 points
 * - Volume: 10 points
 * - Ichimoku: 10 points
 * - RSI Zone: 5 points
 */
export function calculateExpertScore(
  stock: Record<string, unknown>,
  priceHistory: PricePoint[],
  marketRegime: MarketRegime,
  fibonacci: FibonacciLevels | null,
  ichimoku: IchimokuResult | null
): ExpertScoring {
  const closes = priceHistory.map(p => p.close);
  const currentPrice = closes[closes.length - 1] || toNum(stock.current_price);
  
  // Default breakdown
  const breakdown = {
    marketDirection: { score: 50, weight: 15, reason: '', reasonAr: '' },
    trendStrength: { score: 50, weight: 15, reason: '', reasonAr: '' },
    supportResistance: { score: 50, weight: 15, reason: '', reasonAr: '' },
    fibonacci: { score: 50, weight: 10, reason: '', reasonAr: '' },
    candlePatterns: { score: 50, weight: 10, reason: '', reasonAr: '' },
    momentum: { score: 50, weight: 10, reason: '', reasonAr: '' },
    volume: { score: 50, weight: 10, reason: '', reasonAr: '' },
    ichimoku: { score: 50, weight: 10, reason: '', reasonAr: '' },
    rsi: { score: 50, weight: 5, reason: '', reasonAr: '' },
  };
  
  // 1. Market Direction (15 pts)
  if (marketRegime === 'bull') {
    breakdown.marketDirection = { 
      score: 80, weight: 15, 
      reason: 'Bull market - favorable for buying',
      reasonAr: 'سوق صاعدة - مواتية للشراء'
    };
  } else if (marketRegime === 'bear') {
    breakdown.marketDirection = { 
      score: 25, weight: 15, 
      reason: 'Bear market - caution required',
      reasonAr: 'سوق هابطة - الحذر مطلوب'
    };
  } else {
    breakdown.marketDirection = { 
      score: 50, weight: 15, 
      reason: 'Neutral market - selective approach',
      reasonAr: 'سوق محايدة - نهج انتقائي'
    };
  }
  
  // 2. Trend Strength (15 pts) - using MA alignment
  const ma20 = closes.length >= 20 ? sma(closes, 20) : 0;
  const ma50 = closes.length >= 50 ? sma(closes, 50) : 0;
  const ma200 = closes.length >= 200 ? sma(closes, 200) : 0;
  
  let trendScore = 50;
  let trendReason = '';
  let trendReasonAr = '';
  
  if (ma50 > 0 && ma200 > 0) {
    if (currentPrice > ma50 && ma50 > ma200) {
      trendScore = 85;
      trendReason = 'Strong uptrend: Price > MA50 > MA200';
      trendReasonAr = 'ترند صاعد قوي: السعر > المتوسط 50 > المتوسط 200';
    } else if (currentPrice > ma50) {
      trendScore = 70;
      trendReason = 'Uptrend: Price above MA50';
      trendReasonAr = 'ترند صاعد: السعر فوق المتوسط 50';
    } else if (currentPrice < ma50 && ma50 < ma200) {
      trendScore = 20;
      trendReason = 'Strong downtrend: Price < MA50 < MA200';
      trendReasonAr = 'ترند هابط قوي: السعر < المتوسط 50 < المتوسط 200';
    } else if (currentPrice < ma50) {
      trendScore = 35;
      trendReason = 'Downtrend: Price below MA50';
      trendReasonAr = 'ترند هابط: السعر تحت المتوسط 50';
    }
  } else if (ma20 > 0 && currentPrice > ma20) {
    trendScore = 60;
    trendReason = 'Price above MA20';
    trendReasonAr = 'السعر فوق المتوسط 20';
  }
  
  breakdown.trendStrength = { score: trendScore, weight: 15, reason: trendReason, reasonAr: trendReasonAr };
  
  // 3. Support/Resistance Position (15 pts)
  if (priceHistory.length >= 20) {
    const recent20 = priceHistory.slice(-20);
    const low20 = Math.min(...recent20.map(p => p.low));
    const high20 = Math.max(...recent20.map(p => p.high));
    const range20 = high20 - low20;
    
    if (range20 > 0) {
      const position = (currentPrice - low20) / range20;
      
      if (position < 0.25) {
        breakdown.supportResistance = { 
          score: 80, weight: 15, 
          reason: 'Near support - good entry zone',
          reasonAr: 'قريب من الدعم - منطقة دخول جيدة'
        };
      } else if (position > 0.75) {
        breakdown.supportResistance = { 
          score: 25, weight: 15, 
          reason: 'Near resistance - caution zone',
          reasonAr: 'قريب من المقاومة - منطقة حذر'
        };
      } else {
        breakdown.supportResistance = { 
          score: 50, weight: 15, 
          reason: 'Mid-range - wait for clearer signal',
          reasonAr: 'في المنتصف - انتظار إشارة أوضح'
        };
      }
    }
  }
  
  // 4. Fibonacci (10 pts)
  if (fibonacci) {
    if (fibonacci.inBuyZone) {
      breakdown.fibonacci = { 
        score: 85, weight: 10, 
        reason: `In Fibonacci buy zone (38.2%-61.8%), level: ${fibonacci.currentLevel}`,
        reasonAr: `في منطقة شراء فيبوناتشي (٣٨.٢٪-٦١.٨٪)، المستوى: ${fibonacci.currentLevelAr}`
      };
    } else {
      breakdown.fibonacci = { 
        score: 50, weight: 10, 
        reason: `At Fibonacci ${fibonacci.currentLevel}`,
        reasonAr: `عند مستوى فيبوناتشي ${fibonacci.currentLevelAr}`
      };
    }
  }
  
  // 5. Candle Patterns (10 pts)
  const patterns = detectAdvancedPatterns(priceHistory);
  const bullishPatterns = patterns.filter(p => p.type === 'bullish');
  const bearishPatterns = patterns.filter(p => p.type === 'bearish');
  
  if (bullishPatterns.length > 0) {
    const bestPattern = bullishPatterns.reduce((a, b) => a.confidence > b.confidence ? a : b);
    breakdown.candlePatterns = { 
      score: bestPattern.confidence, weight: 10, 
      reason: `${bestPattern.name} detected`,
      reasonAr: `تم رصد نموذج ${bestPattern.nameAr}`
    };
  } else if (bearishPatterns.length > 0) {
    const worstPattern = bearishPatterns.reduce((a, b) => a.confidence > b.confidence ? a : b);
    breakdown.candlePatterns = { 
      score: 100 - worstPattern.confidence, weight: 10, 
      reason: `${worstPattern.name} detected - caution`,
      reasonAr: `تم رصد نموذج ${worstPattern.nameAr} - حذر`
    };
  } else {
    breakdown.candlePatterns = { 
      score: 50, weight: 10, 
      reason: 'No significant patterns detected',
      reasonAr: 'لا توجد أنماط مهمة'
    };
  }
  
  // 6. Momentum (10 pts) - using ROC
  if (closes.length >= 20) {
    const roc10 = ((currentPrice - closes[closes.length - 11]) / closes[closes.length - 11]) * 100;
    
    if (roc10 > 10) {
      breakdown.momentum = { 
        score: 85, weight: 10, 
        reason: `Strong momentum: +${roc10.toFixed(1)}% in 10 days`,
        reasonAr: `زخم قوي: +${roc10.toFixed(1)}٪ في ١٠ أيام`
      };
    } else if (roc10 > 3) {
      breakdown.momentum = { 
        score: 70, weight: 10, 
        reason: `Positive momentum: +${roc10.toFixed(1)}%`,
        reasonAr: `زخم إيجابي: +${roc10.toFixed(1)}٪`
      };
    } else if (roc10 < -10) {
      breakdown.momentum = { 
        score: 20, weight: 10, 
        reason: `Strong negative momentum: ${roc10.toFixed(1)}%`,
        reasonAr: `زخم سلبي قوي: ${roc10.toFixed(1)}٪`
      };
    } else if (roc10 < -3) {
      breakdown.momentum = { 
        score: 35, weight: 10, 
        reason: `Negative momentum: ${roc10.toFixed(1)}%`,
        reasonAr: `زخم سلبي: ${roc10.toFixed(1)}٪`
      };
    } else {
      breakdown.momentum = { 
        score: 50, weight: 10, 
        reason: 'Neutral momentum',
        reasonAr: 'زخم محايد'
      };
    }
  }
  
  // 7. Volume (10 pts)
  const currentVolume = toNum(stock.volume);
  if (priceHistory.length >= 20) {
    const avgVolume = sma(priceHistory.slice(-20).map(p => p.volume), 20);
    const volumeRatio = avgVolume > 0 ? currentVolume / avgVolume : 1;
    
    if (volumeRatio > 2) {
      breakdown.volume = { 
        score: 85, weight: 10, 
        reason: `High volume: ${volumeRatio.toFixed(1)}x average`,
        reasonAr: `حجم تداول عالي: ${volumeRatio.toFixed(1)}× المتوسط`
      };
    } else if (volumeRatio > 1.5) {
      breakdown.volume = { 
        score: 70, weight: 10, 
        reason: `Above average volume: ${volumeRatio.toFixed(1)}x`,
        reasonAr: `حجم أعلى من المتوسط: ${volumeRatio.toFixed(1)}×`
      };
    } else if (volumeRatio < 0.5) {
      breakdown.volume = { 
        score: 25, weight: 10, 
        reason: `Low volume: ${volumeRatio.toFixed(1)}x average`,
        reasonAr: `حجم تداول منخفض: ${volumeRatio.toFixed(1)}× المتوسط`
      };
    } else {
      breakdown.volume = { 
        score: 50, weight: 10, 
        reason: 'Normal volume',
        reasonAr: 'حجم تداول طبيعي'
      };
    }
  }
  
  // 8. Ichimoku (10 pts)
  if (ichimoku) {
    breakdown.ichimoku = { 
      score: ichimoku.signalStrength, weight: 10, 
      reason: `${ichimoku.trendAr}, ${ichimoku.pricePositionAr}`,
      reasonAr: `${ichimoku.trendAr}, ${ichimoku.pricePositionAr}`
    };
  }
  
  // 9. RSI (5 pts)
  if (closes.length >= 15) {
    // Simple RSI approximation
    const gains: number[] = [];
    const losses: number[] = [];
    
    for (let i = 1; i < Math.min(15, closes.length); i++) {
      const change = closes[closes.length - i] - closes[closes.length - i - 1];
      if (change > 0) gains.push(change);
      else losses.push(Math.abs(change));
    }
    
    const avgGain = gains.length > 0 ? sma(gains, gains.length) : 0;
    const avgLoss = losses.length > 0 ? sma(losses, losses.length) : 0;
    const rsi = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
    
    if (rsi < 30) {
      breakdown.rsi = { 
        score: 80, weight: 5, 
        reason: `RSI oversold: ${rsi.toFixed(1)}`,
        reasonAr: `RSI تشبع بيعي: ${rsi.toFixed(1)}`
      };
    } else if (rsi > 70) {
      breakdown.rsi = { 
        score: 20, weight: 5, 
        reason: `RSI overbought: ${rsi.toFixed(1)}`,
        reasonAr: `RSI تشبع شرائي: ${rsi.toFixed(1)}`
      };
    } else if (rsi >= 40 && rsi <= 60) {
      breakdown.rsi = { 
        score: 65, weight: 5, 
        reason: `RSI in sweet spot: ${rsi.toFixed(1)}`,
        reasonAr: `RSI في المنطقة المثالية: ${rsi.toFixed(1)}`
      };
    } else {
      breakdown.rsi = { 
        score: 50, weight: 5, 
        reason: `RSI neutral: ${rsi.toFixed(1)}`,
        reasonAr: `RSI محايد: ${rsi.toFixed(1)}`
      };
    }
  }
  
  // Calculate total score
  let total = 0;
  let totalWeight = 0;
  
  for (const key of Object.keys(breakdown) as Array<keyof typeof breakdown>) {
    total += breakdown[key].score * breakdown[key].weight;
    totalWeight += breakdown[key].weight;
  }
  
  total = Math.round(total / totalWeight);
  
  // Determine verdict
  let verdict: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  let verdictAr: string;
  
  if (total >= 80) {
    verdict = 'strong_buy';
    verdictAr = 'شراء قوي';
  } else if (total >= 60) {
    verdict = 'buy';
    verdictAr = 'شراء';
  } else if (total >= 40) {
    verdict = 'hold';
    verdictAr = 'احتفاظ';
  } else if (total >= 20) {
    verdict = 'sell';
    verdictAr = 'بيع';
  } else {
    verdict = 'strong_sell';
    verdictAr = 'بيع قوي';
  }
  
  return {
    total,
    breakdown,
    verdict,
    verdictAr,
  };
}

// ==================== 7. COMPREHENSIVE ANALYSIS ====================

export interface ComprehensiveAnalysis {
  deadStock: DeadStockResult;
  fibonacci: FibonacciLevels | null;
  ichimoku: IchimokuResult | null;
  advancedPatterns: AdvancedPattern[];
  expertScore: ExpertScoring;
  marketRegime: MarketRegime;
}

/**
 * Run comprehensive expert analysis on a stock.
 */
export function runExpertAnalysis(
  stock: Record<string, unknown>,
  priceHistory: PricePoint[],
  marketRegime: MarketRegime = 'neutral'
): ComprehensiveAnalysis {
  // 1. Dead stock check
  const deadStock = detectDeadStock(stock, priceHistory);
  
  // 2. Fibonacci levels
  const fibonacci = calculateFibonacci(priceHistory);
  
  // 3. Ichimoku cloud
  const ichimoku = calculateIchimoku(priceHistory);
  
  // 4. Advanced patterns
  const advancedPatterns = detectAdvancedPatterns(priceHistory);
  
  // 5. Expert scoring
  const expertScore = calculateExpertScore(stock, priceHistory, marketRegime, fibonacci, ichimoku);
  
  // If stock is dead, penalize score heavily
  if (deadStock.isDead) {
    expertScore.total = Math.min(expertScore.total, 25);
    expertScore.verdict = 'strong_sell';
    expertScore.verdictAr = 'تجنب - سهم ميت';
  }
  
  return {
    deadStock,
    fibonacci,
    ichimoku,
    advancedPatterns,
    expertScore,
    marketRegime,
  };
}
