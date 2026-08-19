/**
 * V2 Multi-Timeframe Analysis Engine
 * محرك تحليل الأطر الزمنية المتعددة
 * 
 * This engine analyzes stocks across 4 timeframes:
 * - Intraday (1-hour momentum)
 * - Daily (main analysis)
 * - Weekly (trend confirmation)
 * - Monthly (major support/resistance)
 * 
 * Features:
 * - Timeframe Scoring (0-100 each)
 * - Trend direction per timeframe
 * - Strength score based on MA alignment
 * - Support/Resistance levels per timeframe
 * - Timeframe confluence detection
 * 
 * @version 2.0.0
 */

import {
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  normalizePriceHistory,
  type PricePoint,
} from '@/lib/analysis-engine';

import type { MarketRegime } from './types';

// ==================== TYPES ====================

/**
 * الاتجاه لكل إطار زمني
 */
export type TimeframeTrend = 'bullish' | 'bearish' | 'neutral';

/**
 * نتيجة تحليل إطار زمني واحد
 */
export interface TimeframeResult {
  trend: TimeframeTrend;
  score: number; // 0-100
  signals: string[];
  details?: {
    maAlignment?: string;
    rsiValue?: number;
    macdSignal?: 'bullish' | 'bearish' | 'neutral';
    volumeTrend?: 'increasing' | 'decreasing' | 'stable';
    supportLevel?: number;
    resistanceLevel?: number;
  };
}

/**
 * نتيجة تحليل التقارب (Confluence)
 */
export interface ConfluenceResult {
  score: number; // 0-100
  aligned: boolean;
  alignedCount: number;
  bonus: number;
  alignedTimeframes: string[];
  conflictingTimeframes: string[];
}

/**
 * المستويات الرئيسية
 */
export interface KeyLevels {
  support: number[];
  resistance: number[];
  pivot: number;
}

/**
 * نتيجة تحليل الأطر الزمنية المتعددة
 */
export interface TimeframeAnalysis {
  ticker: string;
  analysisDate: string;
  intraday: TimeframeResult;
  daily: TimeframeResult;
  weekly: TimeframeResult;
  monthly: TimeframeResult;
  confluence: ConfluenceResult;
  keyLevels: KeyLevels;
  overallScore: number;
  recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  recommendationAr: string;
}

/**
 * إعدادات التحليل
 */
export interface TimeframeConfig {
  intradayPeriods: number;
  dailyPeriods: number;
  weeklyPeriods: number;
  monthlyPeriods: number;
  maPeriods: number[];
  rsiPeriod: number;
  minDataPoints: number;
}

// ==================== CONSTANTS ====================

const DEFAULT_CONFIG: TimeframeConfig = {
  intradayPeriods: 24, // 24 ساعة
  dailyPeriods: 20, // 20 يوم
  weeklyPeriods: 12, // 12 أسبوع
  monthlyPeriods: 12, // 12 شهر
  maPeriods: [5, 10, 20, 50],
  rsiPeriod: 14,
  minDataPoints: 20,
};

// ==================== HELPER FUNCTIONS ====================

/**
 * تحويل قيمة إلى رقم
 */
function toNum(v: unknown, fallback: number = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * تقييد القيمة بين حد أدنى وحد أقصى
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * تقريب إلى عدد محدد من الخانات العشرية
 */
function round(value: number, decimals: number = 2): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * حساب المتوسط المتحرك البسيط
 */
function sma(data: number[], period: number): number {
  if (data.length === 0 || period <= 0) return 0;
  const slice = data.slice(-period);
  return slice.reduce((s, v) => s + v, 0) / slice.length;
}

/**
 * حساب المتوسط المتحرك الأسي
 */
function ema(data: number[], period: number): number {
  if (data.length === 0 || period <= 0) return 0;
  const k = 2 / (period + 1);
  let result = sma(data.slice(0, period), period);
  
  for (let i = period; i < data.length; i++) {
    result = data[i] * k + result * (1 - k);
  }
  return result;
}

/**
 * حساب أعلى قيمة
 */
function highest(data: number[], period: number): number {
  const slice = data.slice(-period);
  return slice.length > 0 ? Math.max(...slice) : 0;
}

/**
 * حساب أدنى قيمة
 */
function lowest(data: number[], period: number): number {
  const slice = data.slice(-period);
  return slice.length > 0 ? Math.min(...slice) : 0;
}

/**
 * تحديد الاتجاه بناءً على المتوسطات المتحركة
 */
function determineMATrend(closes: number[], maPeriods: number[]): {
  trend: TimeframeTrend;
  score: number;
  alignment: string;
} {
  const currentPrice = closes[closes.length - 1];
  const mas: Record<number, number> = {};
  
  // حساب المتوسطات المتحركة
  for (const period of maPeriods) {
    if (closes.length >= period) {
      mas[period] = sma(closes, period);
    }
  }
  
  const maValues = Object.values(mas);
  if (maValues.length < 2) {
    return { trend: 'neutral', score: 50, alignment: 'غير كافي' };
  }
  
  // فحص ترتيب المتوسطات (من الأصغر للأكبر في الاتجاه الصاعد)
  let bullishCount = 0;
  let bearishCount = 0;
  
  const sortedPeriods = maPeriods.filter(p => mas[p]).sort((a, b) => a - b);
  
  for (let i = 0; i < sortedPeriods.length - 1; i++) {
    const shorter = mas[sortedPeriods[i]];
    const longer = mas[sortedPeriods[i + 1]];
    
    if (shorter > longer) bullishCount++;
    else if (shorter < longer) bearishCount++;
  }
  
  // فحص موقع السعر بالنسبة للمتوسطات
  const aboveAll = sortedPeriods.every(p => currentPrice > mas[p]);
  const belowAll = sortedPeriods.every(p => currentPrice < mas[p]);
  
  let trend: TimeframeTrend;
  let score: number;
  let alignment: string;
  
  if (bullishCount >= sortedPeriods.length - 1 && aboveAll) {
    // كل المتوسطات مرتبة صعودياً والسعر فوقها جميعاً
    trend = 'bullish';
    score = 90;
    alignment = 'ترتيب صعودي كامل';
  } else if (bullishCount >= sortedPeriods.length - 1) {
    trend = 'bullish';
    score = 75;
    alignment = 'ترتيب صعودي جزئي';
  } else if (bearishCount >= sortedPeriods.length - 1 && belowAll) {
    // كل المتوسطات مرتبة هبوطياً والسعر تحتها جميعاً
    trend = 'bearish';
    score = 20;
    alignment = 'ترتيب هبوطي كامل';
  } else if (bearishCount >= sortedPeriods.length - 1) {
    trend = 'bearish';
    score = 35;
    alignment = 'ترتيب هبوطي جزئي';
  } else {
    trend = 'neutral';
    score = 50;
    alignment = 'ترتيب مختلط';
  }
  
  return { trend, score, alignment };
}

/**
 * حساب RSI مبسط
 */
function calculateRSISimple(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;
  
  const gains: number[] = [];
  const losses: number[] = [];
  
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains.push(change);
    else losses.push(Math.abs(change));
  }
  
  const recentGains = gains.slice(-period);
  const recentLosses = losses.slice(-period);
  
  const avgGain = recentGains.length > 0 ? sma(recentGains, period) : 0;
  const avgLoss = recentLosses.length > 0 ? sma(recentLosses, period) : 0;
  
  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * حساب MACD مبسط
 */
function calculateMACDSimple(closes: number[]): {
  macdLine: number;
  signalLine: number;
  histogram: number;
  signal: 'bullish' | 'bearish' | 'neutral';
} {
  if (closes.length < 26) {
    return { macdLine: 0, signalLine: 0, histogram: 0, signal: 'neutral' };
  }
  
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12 - ema26;
  
  // تقريب لخط الإشارة
  const signalLine = macdLine * 0.8;
  const histogram = macdLine - signalLine;
  
  let signal: 'bullish' | 'bearish' | 'neutral';
  if (histogram > 0 && macdLine > signalLine) {
    signal = 'bullish';
  } else if (histogram < 0 && macdLine < signalLine) {
    signal = 'bearish';
  } else {
    signal = 'neutral';
  }
  
  return { macdLine, signalLine, histogram, signal };
}

/**
 * تحليل اتجاه الحجم
 */
function analyzeVolumeTrend(volumes: number[]): 'increasing' | 'decreasing' | 'stable' {
  if (volumes.length < 5) return 'stable';
  
  const recent = volumes.slice(-5);
  const previous = volumes.slice(-10, -5);
  
  const recentAvg = sma(recent, 5);
  const previousAvg = previous.length > 0 ? sma(previous, 5) : recentAvg;
  
  const ratio = recentAvg / (previousAvg || 1);
  
  if (ratio > 1.2) return 'increasing';
  if (ratio < 0.8) return 'decreasing';
  return 'stable';
}

// ==================== TIMEFRAME ANALYSIS FUNCTIONS ====================

/**
 * تحليل الإطار الزمني اللحظي (Intraday - ساعة)
 * 
 * يعتمد على:
 * - زخم السعر في آخر 24 ساعة
 * - RSI اللحظي
 * - إشارات MACD السريعة
 */
function calculateIntradayScore(
  stock: Record<string, unknown>,
  priceHistory: PricePoint[],
  config: TimeframeConfig
): TimeframeResult {
  const signals: string[] = [];
  const details: TimeframeResult['details'] = {};
  
  // التحقق من كفاية البيانات
  if (priceHistory.length < 10) {
    return {
      trend: 'neutral',
      score: 50,
      signals: ['بيانات غير كافية للتحليل اللحظي'],
    };
  }
  
  const closes = priceHistory.map(p => p.close);
  const volumes = priceHistory.map(p => p.volume);
  const currentPrice = closes[closes.length - 1];
  
  // 1. حساب الزخم اللحظي (آخر ساعات)
  const recentCloses = closes.slice(-Math.min(6, closes.length));
  const momentum = recentCloses.length > 1 
    ? ((recentCloses[recentCloses.length - 1] - recentCloses[0]) / recentCloses[0]) * 100
    : 0;
  
  let momentumScore = 50;
  let momentumTrend: TimeframeTrend = 'neutral';
  
  if (momentum > 2) {
    momentumScore = 80;
    momentumTrend = 'bullish';
    signals.push(`زخم صعودي قوي +${round(momentum)}% في آخر ساعات`);
  } else if (momentum > 0.5) {
    momentumScore = 65;
    momentumTrend = 'bullish';
    signals.push(`زخم صعودي خفيف +${round(momentum)}%`);
  } else if (momentum < -2) {
    momentumScore = 25;
    momentumTrend = 'bearish';
    signals.push(`زخم هبوطي قوي ${round(momentum)}% في آخر ساعات`);
  } else if (momentum < -0.5) {
    momentumScore = 40;
    momentumTrend = 'bearish';
    signals.push(`زخم هبوطي خفيف ${round(momentum)}%`);
  } else {
    signals.push('زخم محايد - السهم مستقر');
  }
  
  // 2. RSI اللحظي
  const rsi = calculateRSISimple(closes, 9); // RSI سريع
  details.rsiValue = round(rsi, 1);
  
  let rsiScore = 50;
  if (rsi > 70) {
    rsiScore = 30;
    signals.push(`RSI تشبع شرائي ${round(rsi)} - خطر تصحيح`);
  } else if (rsi > 60) {
    rsiScore = 60;
    signals.push(`RSI إيجابي ${round(rsi)}`);
  } else if (rsi < 30) {
    rsiScore = 70;
    signals.push(`RSI تشبع بيعي ${round(rsi)} - فرصة ارتداد`);
  } else if (rsi < 40) {
    rsiScore = 55;
    signals.push(`RSI منخفض ${round(rsi)} - قد يرتد`);
  } else {
    signals.push(`RSI محايد ${round(rsi)}`);
  }
  
  // 3. MACD السريع
  const macd = calculateMACDSimple(closes.slice(-26));
  details.macdSignal = macd.signal;
  
  let macdScore = 50;
  if (macd.signal === 'bullish') {
    macdScore = 70;
    signals.push('MACD إيجابي - إشارة شراء');
  } else if (macd.signal === 'bearish') {
    macdScore = 35;
    signals.push('MACD سلبي - إشارة بيع');
  }
  
  // 4. تحليل الحجم
  details.volumeTrend = analyzeVolumeTrend(volumes);
  let volumeScore = 50;
  if (details.volumeTrend === 'increasing') {
    volumeScore = 65;
    signals.push('حجم التداول في ارتفاع - اهتمام متزايد');
  } else if (details.volumeTrend === 'decreasing') {
    volumeScore = 40;
    signals.push('حجم التداول في انخفاض - فقدان الاهتمام');
  }
  
  // 5. تحديد الاتجاه النهائي
  const totalScore = (momentumScore * 0.35) + (rsiScore * 0.25) + (macdScore * 0.25) + (volumeScore * 0.15);
  const finalScore = clamp(round(totalScore), 0, 100);
  
  let trend: TimeframeTrend;
  if (finalScore >= 65) trend = 'bullish';
  else if (finalScore <= 35) trend = 'bearish';
  else trend = 'neutral';
  
  return {
    trend,
    score: finalScore,
    signals,
    details,
  };
}

/**
 * تحليل الإطار الزمني اليومي (Daily)
 * 
 * يعتمد على:
 * - ترتيب المتوسطات المتحركة (5, 10, 20, 50)
 * - RSI اليومي
 * - إشارات MACD
 * - مستويات الدعم والمقاومة
 */
function calculateDailyScore(
  stock: Record<string, unknown>,
  priceHistory: PricePoint[],
  config: TimeframeConfig
): TimeframeResult {
  const signals: string[] = [];
  const details: TimeframeResult['details'] = {};
  
  if (priceHistory.length < config.minDataPoints) {
    return {
      trend: 'neutral',
      score: 50,
      signals: ['بيانات غير كافية للتحليل اليومي'],
    };
  }
  
  const closes = priceHistory.map(p => p.close);
  const volumes = priceHistory.map(p => p.volume);
  const currentPrice = closes[closes.length - 1];
  
  // 1. تحليل ترتيب المتوسطات المتحركة
  const maAnalysis = determineMATrend(closes, config.maPeriods);
  details.maAlignment = maAnalysis.alignment;
  
  if (maAnalysis.trend === 'bullish') {
    signals.push(`المتوسطات: ${maAnalysis.alignment} - إيجابي`);
  } else if (maAnalysis.trend === 'bearish') {
    signals.push(`المتوسطات: ${maAnalysis.alignment} - سلبي`);
  } else {
    signals.push(`المتوسطات: ${maAnalysis.alignment}`);
  }
  
  // 2. RSI اليومي
  const rsi = calculateRSISimple(closes, config.rsiPeriod);
  details.rsiValue = round(rsi, 1);
  
  let rsiScore = 50;
  if (rsi > 70) {
    rsiScore = 25;
    signals.push(`RSI ${round(rsi)} تشبع شرائي - حذر`);
  } else if (rsi >= 50 && rsi <= 70) {
    rsiScore = 70;
    signals.push(`RSI ${round(rsi)} إيجابي`);
  } else if (rsi >= 30 && rsi < 50) {
    rsiScore = 45;
    signals.push(`RSI ${round(rsi)} منخفض`);
  } else {
    rsiScore = 60;
    signals.push(`RSI ${round(rsi)} تشبع بيعي - فرصة`);
  }
  
  // 3. MACD
  const macd = calculateMACDSimple(closes);
  details.macdSignal = macd.signal;
  
  let macdScore = 50;
  if (macd.signal === 'bullish') {
    macdScore = 75;
    signals.push('MACD إيجابي');
  } else if (macd.signal === 'bearish') {
    macdScore = 30;
    signals.push('MACD سلبي');
  } else {
    signals.push('MACD محايد');
  }
  
  // 4. مستويات الدعم والمقاومة (20 يوم)
  const dailyLow = lowest(closes, 20);
  const dailyHigh = highest(closes, 20);
  details.supportLevel = round(dailyLow, 2);
  details.resistanceLevel = round(dailyHigh, 2);
  
  const dailyRange = dailyHigh - dailyLow;
  const pricePosition = dailyRange > 0 ? (currentPrice - dailyLow) / dailyRange : 0.5;
  
  let srScore = 50;
  if (pricePosition < 0.25) {
    srScore = 70;
    signals.push(`السعر قريب من الدعم ${round(dailyLow)} - منطقة شراء`);
  } else if (pricePosition > 0.75) {
    srScore = 35;
    signals.push(`السعر قريب من المقاومة ${round(dailyHigh)} - منطقة حذر`);
  } else {
    signals.push(`السعر في منتصف النطاق`);
  }
  
  // 5. تحليل الحجم
  details.volumeTrend = analyzeVolumeTrend(volumes);
  let volumeScore = 50;
  if (details.volumeTrend === 'increasing') {
    volumeScore = 65;
    signals.push('حجم تداول مرتفع');
  } else if (details.volumeTrend === 'decreasing') {
    volumeScore = 40;
    signals.push('حجم تداول منخفض');
  }
  
  // 6. النتيجة النهائية
  const totalScore = (
    maAnalysis.score * 0.35 +
    rsiScore * 0.20 +
    macdScore * 0.20 +
    srScore * 0.15 +
    volumeScore * 0.10
  );
  const finalScore = clamp(round(totalScore), 0, 100);
  
  let trend: TimeframeTrend;
  if (finalScore >= 65) trend = 'bullish';
  else if (finalScore <= 35) trend = 'bearish';
  else trend = 'neutral';
  
  return {
    trend,
    score: finalScore,
    signals,
    details,
  };
}

/**
 * تحليل الإطار الزمني الأسبوعي (Weekly)
 * 
 * يعتمد على تجميع البيانات اليومية في أسابيع
 * وتحليل الاتجاه الأسبوعي
 */
function calculateWeeklyScore(
  stock: Record<string, unknown>,
  priceHistory: PricePoint[],
  config: TimeframeConfig
): TimeframeResult {
  const signals: string[] = [];
  const details: TimeframeResult['details'] = {};
  
  // نحتاج على الأقل 5 أسابيع (25 يوم تداول)
  if (priceHistory.length < 25) {
    return {
      trend: 'neutral',
      score: 50,
      signals: ['بيانات غير كافية للتحليل الأسبوعي'],
    };
  }
  
  // تجميع البيانات اليومية في أسابيع (5 أيام = أسبوع)
  const weeklyCloses: number[] = [];
  const weeklyVolumes: number[] = [];
  
  for (let i = 0; i < priceHistory.length; i += 5) {
    const weekData = priceHistory.slice(i, i + 5);
    if (weekData.length > 0) {
      const weekClose = weekData[weekData.length - 1].close;
      const weekVolume = weekData.reduce((sum, d) => sum + d.volume, 0);
      weeklyCloses.push(weekClose);
      weeklyVolumes.push(weekVolume);
    }
  }
  
  if (weeklyCloses.length < 4) {
    return {
      trend: 'neutral',
      score: 50,
      signals: ['بيانات أسبوعية غير كافية'],
    };
  }
  
  const currentPrice = weeklyCloses[weeklyCloses.length - 1];
  
  // 1. تحليل ترتيب المتوسطات الأسبوعية
  const weeklyMA = [2, 4, 8]; // 2, 4, 8 أسابيع ≈ 10, 20, 40 يوم
  const maAnalysis = determineMATrend(weeklyCloses, weeklyMA);
  details.maAlignment = maAnalysis.alignment;
  
  signals.push(`الاتجاه الأسبوعي: ${maAnalysis.alignment}`);
  
  // 2. أداء آخر 4 أسابيع
  const last4Weeks = weeklyCloses.slice(-4);
  const weeklyPerformance = ((last4Weeks[3] - last4Weeks[0]) / last4Weeks[0]) * 100;
  
  let perfScore = 50;
  if (weeklyPerformance > 10) {
    perfScore = 85;
    signals.push(`أداء أسبوعي ممتاز +${round(weeklyPerformance)}%`);
  } else if (weeklyPerformance > 5) {
    perfScore = 70;
    signals.push(`أداء أسبوعي جيد +${round(weeklyPerformance)}%`);
  } else if (weeklyPerformance > 0) {
    perfScore = 60;
    signals.push(`أداء أسبوعي إيجابي +${round(weeklyPerformance)}%`);
  } else if (weeklyPerformance > -5) {
    perfScore = 40;
    signals.push(`أداء أسبوعي سلبي ${round(weeklyPerformance)}%`);
  } else {
    perfScore = 25;
    signals.push(`أداء أسبوعي ضعيف ${round(weeklyPerformance)}%`);
  }
  
  // 3. RSI الأسبوعي
  const rsi = calculateRSISimple(weeklyCloses, Math.min(weeklyCloses.length - 1, 8));
  details.rsiValue = round(rsi, 1);
  
  let rsiScore = 50;
  if (rsi > 70) {
    rsiScore = 30;
    signals.push(`RSI أسبوعي تشبع شرائي ${round(rsi)}`);
  } else if (rsi < 30) {
    rsiScore = 70;
    signals.push(`RSI أسبوعي تشبع بيعي ${round(rsi)}`);
  } else {
    signals.push(`RSI أسبوعي ${round(rsi)}`);
  }
  
  // 4. مستويات الدعم والمقاومة الأسبوعية
  const weeklyLow = Math.min(...weeklyCloses);
  const weeklyHigh = Math.max(...weeklyCloses);
  details.supportLevel = round(weeklyLow, 2);
  details.resistanceLevel = round(weeklyHigh, 2);
  
  signals.push(`نطاق أسبوعي: ${round(weeklyLow)} - ${round(weeklyHigh)}`);
  
  // 5. النتيجة النهائية
  const totalScore = (
    maAnalysis.score * 0.40 +
    perfScore * 0.30 +
    rsiScore * 0.30
  );
  const finalScore = clamp(round(totalScore), 0, 100);
  
  let trend: TimeframeTrend;
  if (finalScore >= 65) trend = 'bullish';
  else if (finalScore <= 35) trend = 'bearish';
  else trend = 'neutral';
  
  return {
    trend,
    score: finalScore,
    signals,
    details,
  };
}

/**
 * تحليل الإطار الزمني الشهري (Monthly)
 * 
 * يعتمد على تحليل الاتجاه الرئيسي والمستويات الكبرى
 */
function calculateMonthlyScore(
  stock: Record<string, unknown>,
  priceHistory: PricePoint[],
  config: TimeframeConfig
): TimeframeResult {
  const signals: string[] = [];
  const details: TimeframeResult['details'] = {};
  
  // نحتاج على الأقل 3 أشهر (60 يوم تداول)
  if (priceHistory.length < 60) {
    return {
      trend: 'neutral',
      score: 50,
      signals: ['بيانات غير كافية للتحليل الشهري'],
    };
  }
  
  // تجميع البيانات اليومية في أشهر (20 يوم = شهر تقريباً)
  const monthlyCloses: number[] = [];
  
  for (let i = 0; i < priceHistory.length; i += 20) {
    const monthData = priceHistory.slice(i, i + 20);
    if (monthData.length > 0) {
      monthlyCloses.push(monthData[monthData.length - 1].close);
    }
  }
  
  if (monthlyCloses.length < 3) {
    return {
      trend: 'neutral',
      score: 50,
      signals: ['بيانات شهرية غير كافية'],
    };
  }
  
  const currentPrice = monthlyCloses[monthlyCloses.length - 1];
  
  // 1. تحليل الاتجاه الشهري الرئيسي
  const monthlyMA = [2, 3, 6]; // 2, 3, 6 أشهر
  const maAnalysis = determineMATrend(monthlyCloses, monthlyMA);
  details.maAlignment = maAnalysis.alignment;
  
  signals.push(`الاتجاه الشهري: ${maAnalysis.alignment}`);
  
  // 2. أداء آخر 6 أشهر
  const last6Months = monthlyCloses.slice(-6);
  const monthlyPerformance = ((last6Months[last6Months.length - 1] - last6Months[0]) / last6Months[0]) * 100;
  
  let perfScore = 50;
  if (monthlyPerformance > 30) {
    perfScore = 90;
    signals.push(`أداء شهري ممتاز +${round(monthlyPerformance)}%`);
  } else if (monthlyPerformance > 15) {
    perfScore = 75;
    signals.push(`أداء شهري جيد +${round(monthlyPerformance)}%`);
  } else if (monthlyPerformance > 0) {
    perfScore = 60;
    signals.push(`أداء شهري إيجابي +${round(monthlyPerformance)}%`);
  } else if (monthlyPerformance > -15) {
    perfScore = 40;
    signals.push(`أداء شهري سلبي ${round(monthlyPerformance)}%`);
  } else {
    perfScore = 20;
    signals.push(`أداء شهري ضعيف ${round(monthlyPerformance)}%`);
  }
  
  // 3. مستويات الدعم والمقاومة الرئيسية
  const monthlyLow = Math.min(...monthlyCloses);
  const monthlyHigh = Math.max(...monthlyCloses);
  details.supportLevel = round(monthlyLow, 2);
  details.resistanceLevel = round(monthlyHigh, 2);
  
  const monthlyRange = monthlyHigh - monthlyLow;
  const pricePosition = monthlyRange > 0 ? (currentPrice - monthlyLow) / monthlyRange : 0.5;
  
  let srScore = 50;
  if (pricePosition < 0.20) {
    srScore = 75;
    signals.push(`السعر قريب من دعم شهري رئيسي ${round(monthlyLow)}`);
  } else if (pricePosition > 0.80) {
    srScore = 30;
    signals.push(`السعر قريب من مقاومة شهرية رئيسية ${round(monthlyHigh)}`);
  } else {
    signals.push(`السعر في منتصف النطاق الشهري`);
  }
  
  // 4. نسبة السعر من أعلى/أدنى مستوى
  const distanceFromHigh = ((monthlyHigh - currentPrice) / monthlyHigh) * 100;
  const distanceFromLow = ((currentPrice - monthlyLow) / currentPrice) * 100;
  
  signals.push(`بعد عن القمة: ${round(distanceFromHigh)}%، بعد عن القاع: ${round(distanceFromLow)}%`);
  
  // 5. النتيجة النهائية
  const totalScore = (
    maAnalysis.score * 0.40 +
    perfScore * 0.35 +
    srScore * 0.25
  );
  const finalScore = clamp(round(totalScore), 0, 100);
  
  let trend: TimeframeTrend;
  if (finalScore >= 65) trend = 'bullish';
  else if (finalScore <= 35) trend = 'bearish';
  else trend = 'neutral';
  
  return {
    trend,
    score: finalScore,
    signals,
    details,
  };
}

// ==================== CONFLUENCE DETECTION ====================

/**
 * كشف التقارب بين الأطر الزمنية
 * 
 * القواعد:
 * - 4 أطر متوافقة = +20 نقطة إضافية
 * - 3 أطر متوافقة = +10 نقاط إضافية
 * - 2 أطر متوافقة = +5 نقاط إضافية
 * - أطر متضاربة = خصم
 */
function detectConfluence(
  intraday: TimeframeResult,
  daily: TimeframeResult,
  weekly: TimeframeResult,
  monthly: TimeframeResult
): ConfluenceResult {
  const timeframes = [
    { name: 'intraday', result: intraday },
    { name: 'daily', result: daily },
    { name: 'weekly', result: weekly },
    { name: 'monthly', result: monthly },
  ];
  
  // حساب عدد الأطر الصاعدة والهابطة
  const bullishCount = timeframes.filter(tf => tf.result.trend === 'bullish').length;
  const bearishCount = timeframes.filter(tf => tf.result.trend === 'bearish').length;
  const neutralCount = timeframes.filter(tf => tf.result.trend === 'neutral').length;
  
  // تحديد الاتجاه المسيطر
  const dominantTrend = bullishCount > bearishCount ? 'bullish' : 
                        bearishCount > bullishCount ? 'bearish' : 'neutral';
  
  // حساب النقاط الإضافية
  let bonus = 0;
  let alignedCount = 0;
  const alignedTimeframes: string[] = [];
  const conflictingTimeframes: string[] = [];
  
  if (dominantTrend !== 'neutral') {
    for (const tf of timeframes) {
      if (tf.result.trend === dominantTrend) {
        alignedCount++;
        alignedTimeframes.push(tf.name);
      } else if (tf.result.trend !== 'neutral') {
        conflictingTimeframes.push(tf.name);
      }
    }
    
    // حساب المكافأة
    if (alignedCount === 4) {
      bonus = 20;
    } else if (alignedCount === 3) {
      bonus = 10;
    } else if (alignedCount === 2) {
      bonus = 5;
    }
    
    // خصم للتضارب
    if (conflictingTimeframes.length >= 2) {
      bonus = Math.max(0, bonus - 10);
    } else if (conflictingTimeframes.length === 1) {
      bonus = Math.max(0, bonus - 5);
    }
  }
  
  // حساب النتيجة النهائية
  const avgScore = (
    intraday.score +
    daily.score +
    weekly.score +
    monthly.score
  ) / 4;
  
  const confluenceScore = clamp(round(avgScore + bonus), 0, 100);
  
  return {
    score: confluenceScore,
    aligned: alignedCount >= 3,
    alignedCount,
    bonus,
    alignedTimeframes,
    conflictingTimeframes,
  };
}

// ==================== KEY LEVELS CALCULATION ====================

/**
 * حساب المستويات الرئيسية (الدعم، المقاومة، المحور)
 */
function calculateKeyLevels(
  priceHistory: PricePoint[],
  daily: TimeframeResult,
  weekly: TimeframeResult,
  monthly: TimeframeResult
): KeyLevels {
  if (priceHistory.length < 20) {
    return {
      support: [],
      resistance: [],
      pivot: 0,
    };
  }
  
  const closes = priceHistory.map(p => p.close);
  const currentPrice = closes[closes.length - 1];
  
  // مستويات الدعم من مختلف الأطر الزمنية
  const supportLevels: Set<number> = new Set();
  const resistanceLevels: Set<number> = new Set();
  
  // من التحليل اليومي
  if (daily.details?.supportLevel) supportLevels.add(daily.details.supportLevel);
  if (daily.details?.resistanceLevel) resistanceLevels.add(daily.details.resistanceLevel);
  
  // من التحليل الأسبوعي
  if (weekly.details?.supportLevel) supportLevels.add(weekly.details.supportLevel);
  if (weekly.details?.resistanceLevel) resistanceLevels.add(weekly.details.resistanceLevel);
  
  // من التحليل الشهري
  if (monthly.details?.supportLevel) supportLevels.add(monthly.details.supportLevel);
  if (monthly.details?.resistanceLevel) resistanceLevels.add(monthly.details.resistanceLevel);
  
  // حساب مستويات إضافية من البيانات
  const lookback = Math.min(priceHistory.length, 60);
  const recentPrices = priceHistory.slice(-lookback);
  
  // إيجاد القيعان والقمم المحلية
  for (let i = 2; i < recentPrices.length - 2; i++) {
    const low = recentPrices[i].low;
    const high = recentPrices[i].high;
    
    // قاع محلي
    if (low < recentPrices[i-1].low && low < recentPrices[i-2].low &&
        low < recentPrices[i+1].low && low < recentPrices[i+2].low) {
      supportLevels.add(round(low, 2));
    }
    
    // قمة محلية
    if (high > recentPrices[i-1].high && high > recentPrices[i-2].high &&
        high > recentPrices[i+1].high && high > recentPrices[i+2].high) {
      resistanceLevels.add(round(high, 2));
    }
  }
  
  // ترتيب وتصفية المستويات
  const sortedSupport = Array.from(supportLevels)
    .filter(level => level < currentPrice)
    .sort((a, b) => b - a) // من الأقرب للأبعد
    .slice(0, 3);
  
  const sortedResistance = Array.from(resistanceLevels)
    .filter(level => level > currentPrice)
    .sort((a, b) => a - b) // من الأقرب للأبعد
    .slice(0, 3);
  
  // حساب نقطة المحور
  const pivot = round(currentPrice, 2);
  
  return {
    support: sortedSupport,
    resistance: sortedResistance,
    pivot,
  };
}

// ==================== MAIN EXPORT FUNCTION ====================

/**
 * تحليل الأطر الزمنية المتعددة
 * 
 * الدالة الرئيسية التي تقوم بتحليل السهم على 4 أطر زمنية
 * 
 * @param ticker - رمز السهم
 * @param priceHistory - البيانات التاريخية للسعر
 * @param stockData - بيانات السهم الإضافية
 * @param config - إعدادات التحليل
 * @returns TimeframeAnalysis - نتيجة التحليل الشاملة
 */
export function analyzeTimeframes(
  ticker: string,
  priceHistory: Array<Record<string, unknown>>,
  stockData?: Record<string, unknown>,
  config: Partial<TimeframeConfig> = {}
): TimeframeAnalysis {
  // دمج الإعدادات الافتراضية مع المخصصة
  const finalConfig: TimeframeConfig = { ...DEFAULT_CONFIG, ...config };
  
  // تطبيع البيانات التاريخية
  const normalizedHistory = normalizePriceHistory(priceHistory);
  
  // تحليل كل إطار زمني
  const intraday = calculateIntradayScore(stockData || {}, normalizedHistory, finalConfig);
  const daily = calculateDailyScore(stockData || {}, normalizedHistory, finalConfig);
  const weekly = calculateWeeklyScore(stockData || {}, normalizedHistory, finalConfig);
  const monthly = calculateMonthlyScore(stockData || {}, normalizedHistory, finalConfig);
  
  // كشف التقارب
  const confluence = detectConfluence(intraday, daily, weekly, monthly);
  
  // حساب المستويات الرئيسية
  const keyLevels = calculateKeyLevels(normalizedHistory, daily, weekly, monthly);
  
  // حساب النتيجة الإجمالية
  const overallScore = confluence.score;
  
  // تحديد التوقعة
  let recommendation: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  let recommendationAr: string;
  
  if (overallScore >= 80 && confluence.aligned) {
    recommendation = 'strong_buy';
    recommendationAr = 'شراء قوي';
  } else if (overallScore >= 65) {
    recommendation = 'buy';
    recommendationAr = 'شراء';
  } else if (overallScore >= 40) {
    recommendation = 'hold';
    recommendationAr = 'احتفاظ';
  } else if (overallScore >= 25) {
    recommendation = 'sell';
    recommendationAr = 'بيع';
  } else {
    recommendation = 'strong_sell';
    recommendationAr = 'بيع قوي';
  }
  
  return {
    ticker,
    analysisDate: new Date().toISOString(),
    intraday,
    daily,
    weekly,
    monthly,
    confluence,
    keyLevels,
    overallScore,
    recommendation,
    recommendationAr,
  };
}

/**
 * تشغيل تحليل الأطر الزمنية المتعددة
 * 
 * واجهة مبسطة للتحليل
 * 
 * @param ticker - رمز السهم
 * @param priceHistory - البيانات التاريخية
 * @param stockData - بيانات السهم
 * @returns TimeframeAnalysis
 */
export function runMultiTimeframeAnalysis(
  ticker: string,
  priceHistory: Array<Record<string, unknown>>,
  stockData?: Record<string, unknown>
): TimeframeAnalysis {
  return analyzeTimeframes(ticker, priceHistory, stockData);
}

/**
 * تحليل سريع للاتجاه
 * 
 * يعيد فقط الاتجاه والدرجة بدون تفاصيل كاملة
 */
export function getQuickTimeframeTrend(
  ticker: string,
  priceHistory: Array<Record<string, unknown>>
): {
  trend: TimeframeTrend;
  score: number;
  aligned: boolean;
} {
  const analysis = analyzeTimeframes(ticker, priceHistory);
  
  // تحديد الاتجاه العام
  const bullishCount = [analysis.intraday, analysis.daily, analysis.weekly, analysis.monthly]
    .filter(tf => tf.trend === 'bullish').length;
  const bearishCount = [analysis.intraday, analysis.daily, analysis.weekly, analysis.monthly]
    .filter(tf => tf.trend === 'bearish').length;
  
  let trend: TimeframeTrend;
  if (bullishCount >= 3) trend = 'bullish';
  else if (bearishCount >= 3) trend = 'bearish';
  else trend = 'neutral';
  
  return {
    trend,
    score: analysis.overallScore,
    aligned: analysis.confluence.aligned,
  };
}

// تصدير الدوال المساعدة للاستخدام الخارجي
export {
  calculateDailyScore,
  calculateWeeklyScore,
  calculateMonthlyScore,
  detectConfluence,
};
