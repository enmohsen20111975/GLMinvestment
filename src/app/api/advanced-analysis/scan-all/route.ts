/**
 * Advanced Analysis Batch Scanner - الشامل (نظام الدفعات)
 * ==========================================
 * يقوم بفحص جميع الأسهم وتصنيفها وتحليلها
 * 
 * الميزات:
 * 1. نظام الدفعات (Batch Processing) - 10 أسهم في المرة
 * 2. تأخير بين الدفعات لتجنب إرهاق السيرفر
 * 3. حفظ التقدم واستئناف لاحقاً
 * 4. تصنيف الأسهم: حية vs ميتة
 * 5. تحليل فني شامل للأسهم الحية
 * 6. تحديد فرص البيع/الشراء مع التقييم
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";


// Python Backend URL - ALWAYS use 127.0.0.1 for IPv4
const PYTHON_BACKEND_URL = 'http://127.0.0.1:8010';

// ==================== Configuration ====================

const BATCH_SIZE = 10;              // عدد الأسهم في كل دفعة
const DELAY_BETWEEN_BATCHES = 2000; // تأخير 2 ثانية بين الدفعات
const HISTORY_DAYS = 60;            // عدد أيام البيانات التاريخية

// ==================== State Management ====================

interface ScanState {
  isRunning: boolean;
  currentBatch: number;
  totalBatches: number;
  processedStocks: number;
  totalStocks: number;
  results: any[];
  startTime: number;
  errors: string[];
}

// حالة المسح الحالية (في الذاكرة)
let scanState: ScanState = {
  isRunning: false,
  currentBatch: 0,
  totalBatches: 0,
  processedStocks: 0,
  totalStocks: 0,
  results: [],
  startTime: 0,
  errors: []
};

// ==================== Interfaces ====================

interface StockData {
  symbol: string;
  name?: string;
  price: number;
  change_percent?: number;
  volume?: number;
  high?: number;
  low?: number;
  open?: number;
  previous_close?: number;
}

interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  date?: string;
}

interface StockClassification {
  symbol: string;
  name?: string;
  price: number;
  is_alive: boolean;
  alive_score: number;
  alive_reason: string;
  volume: number;
  avg_volume: number;
  volume_ratio: number;
  volatility: number;
  change_percent: number;
  price_range: number;
  trading_days: number;
}

interface TechnicalAnalysis {
  symbol: string;
  price: number;
  trend: string;
  trend_ar: string;
  trend_strength: number;
  sma_20: number | null;
  sma_50: number | null;
  ema_12: number | null;
  ema_26: number | null;
  price_vs_sma20: string;
  price_vs_sma50: string;
  rsi: number | null;
  rsi_signal: string;
  stochastic_k: number | null;
  stochastic_signal: string;
  macd: { value: number; signal: number; histogram: number; trend: string } | null;
  bollinger: { upper: number; middle: number; lower: number; position: string } | null;
  support: number;
  resistance: number;
  pivot: number;
  candlestick_patterns: CandlePattern[];
  best_pattern: CandlePattern | null;
  fibonacci_level: string | null;
  at_golden_ratio: boolean;
  technical_score: number;
  recommendation: string;
  recommendation_ar: string;
  confidence: number;
}

interface CandlePattern {
  pattern: string;
  pattern_ar: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  description: string;
}

interface TradingOpportunity {
  symbol: string;
  name?: string;
  price: number;
  opportunity_type: 'BUY' | 'SELL' | 'WATCH';
  opportunity_type_ar: string;
  overall_score: number;
  risk_level: 'LOW' | 'MEDIUM' | 'HIGH';
  risk_level_ar: string;
  potential_return: number;
  reasons: string[];
  reasons_ar: string[];
  technical_analysis: TechnicalAnalysis;
  entry_price: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  rank: number;
}

// ==================== Helper Functions ====================

/**
 * تأخير تنفيذي
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * جلب الأسهم من Python Backend
 */
async function fetchStocksFromPythonBackend(): Promise<StockData[]> {
  const response = await fetch(`${PYTHON_BACKEND_URL}/api/stocks`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) throw new Error(`Python Backend returned ${response.status}`);

  const data = await response.json();
  return (data.data || []).map((s: any) => ({
    symbol: s.symbol,
    name: s.name,
    price: s.current_price || s.price || 0,
    change_percent: s.change_percent || 0,
    volume: s.volume || 0,
    high: s.high_price || s.high || 0,
    low: s.low_price || s.low || 0,
    open: s.open_price || s.open || 0,
    previous_close: s.previous_close || 0
  }));
}

/**
 * جلب البيانات التاريخية من Python Backend
 */
async function fetchHistoryFromPythonBackend(symbol: string, days: number = HISTORY_DAYS): Promise<CandleData[]> {
  try {
    const response = await fetch(`${PYTHON_BACKEND_URL}/api/history/${symbol}?days=${days}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) return [];

    const data = await response.json();
    return (data.data?.rows || []).map((r: any) => ({
      date: r.date,
      open: r.open || 0,
      high: r.high || 0,
      low: r.low || 0,
      close: r.close || 0,
      volume: r.volume || 0
    }));
  } catch {
    return [];
  }
}

// ==================== Classification Functions ====================

function classifyStock(stock: StockData, history: CandleData[]): StockClassification {
  let aliveScore = 0;
  const reasons: string[] = [];
  
  // 1. تحليل السيولة (40% من الدرجة)
  const volume = stock.volume || 0;
  const avgVolume = history.length > 0 
    ? history.reduce((sum, h) => sum + (h.volume || 0), 0) / history.length 
    : 0;
  const volumeRatio = avgVolume > 0 ? volume / avgVolume : 0;
  
  if (volume > 100000) { aliveScore += 20; reasons.push('سيولة عالية'); }
  else if (volume > 50000) { aliveScore += 15; reasons.push('سيولة متوسطة'); }
  else if (volume > 10000) { aliveScore += 10; reasons.push('سيولة مقبولة'); }
  else if (volume > 0) { aliveScore += 5; reasons.push('سيولة منخفضة'); }
  
  if (volumeRatio > 1.5) { aliveScore += 15; reasons.push('حجم تداول فوق المتوسط'); }
  else if (volumeRatio > 1) { aliveScore += 10; }
  else if (volumeRatio > 0.5) { aliveScore += 5; }
  
  // 2. تحليل الحركة السعرية (30% من الدرجة)
  const changePercent = Math.abs(stock.change_percent || 0);
  if (changePercent > 5) { aliveScore += 20; reasons.push('حركة سعرية قوية'); }
  else if (changePercent > 2) { aliveScore += 15; reasons.push('حركة سعرية جيدة'); }
  else if (changePercent > 1) { aliveScore += 10; reasons.push('حركة سعرية مقبولة'); }
  else if (changePercent > 0.5) { aliveScore += 5; }
  
  // 3. تحليل التذبذب (15% من الدرجة)
  const priceRange = stock.high && stock.low ? stock.high - stock.low : 0;
  const volatility = stock.price > 0 ? (priceRange / stock.price) * 100 : 0;
  
  if (volatility > 5) { aliveScore += 15; reasons.push('تذبذب عالي'); }
  else if (volatility > 2) { aliveScore += 10; reasons.push('تذبذب متوسط'); }
  else if (volatility > 1) { aliveScore += 5; }
  
  // 4. تحليل البيانات التاريخية (15% من الدرجة)
  if (history.length >= 30) { aliveScore += 15; }
  else if (history.length >= 20) { aliveScore += 10; }
  else if (history.length >= 10) { aliveScore += 5; }
  
  const isAlive = aliveScore >= 30;
  const aliveReason = isAlive 
    ? `سهم حي (${reasons.join('، ')})`
    : `سهم ميت - سيولة منخفضة وحركة ضعيفة`;
  
  return {
    symbol: stock.symbol,
    name: stock.name,
    price: stock.price,
    is_alive: isAlive,
    alive_score: Math.min(100, aliveScore),
    alive_reason: aliveReason,
    volume,
    avg_volume: avgVolume,
    volume_ratio: volumeRatio,
    volatility,
    change_percent: stock.change_percent || 0,
    price_range: priceRange,
    trading_days: history.length
  };
}

// ==================== Technical Analysis Functions ====================

function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}

function calculateRSI(prices: number[], period: number = 14): { value: number; signal: string } | null {
  if (prices.length < period + 1) return null;
  
  const deltas = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = deltas.map(d => d > 0 ? d : 0);
  const losses = deltas.map(d => d < 0 ? -d : 0);
  
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  
  if (avgLoss === 0) return { value: 100, signal: 'OVERBOUGHT' };
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  let signal = 'NEUTRAL';
  if (rsi >= 70) signal = 'OVERBOUGHT';
  else if (rsi <= 30) signal = 'OVERSOLD';
  
  return { value: Math.round(rsi * 10) / 10, signal };
}

function calculateStochastic(highs: number[], lows: number[], closes: number[]): { k: number; signal: string } | null {
  const period = 14;
  if (highs.length < period) return null;
  
  const periodHighs = highs.slice(-period);
  const periodLows = lows.slice(-period);
  const highestHigh = Math.max(...periodHighs);
  const lowestLow = Math.min(...periodLows);
  const currentClose = closes[closes.length - 1];
  
  if (highestHigh === lowestLow) return { k: 50, signal: 'NEUTRAL' };
  
  const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
  
  let signal = 'NEUTRAL';
  if (k >= 80) signal = 'OVERBOUGHT';
  else if (k <= 20) signal = 'OVERSOLD';
  
  return { k: Math.round(k * 10) / 10, signal };
}

function calculateMACD(prices: number[]): { value: number; signal: number; histogram: number; trend: string } | null {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  
  if (ema12 === null || ema26 === null) return null;
  
  const macdValue = ema12 - ema26;
  const signalLine = macdValue * 0.9;
  const histogram = macdValue - signalLine;
  
  let trend = 'NEUTRAL';
  if (macdValue > signalLine && histogram > 0) trend = 'BULLISH';
  else if (macdValue < signalLine && histogram < 0) trend = 'BEARISH';
  
  return {
    value: Math.round(macdValue * 1000) / 1000,
    signal: Math.round(signalLine * 1000) / 1000,
    histogram: Math.round(histogram * 1000) / 1000,
    trend
  };
}

function calculateBollinger(prices: number[]): { upper: number; middle: number; lower: number; position: string } | null {
  const period = 20;
  if (prices.length < period) return null;
  
  const recent = prices.slice(-period);
  const middle = recent.reduce((a, b) => a + b, 0) / period;
  const variance = recent.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  
  const upper = middle + (2 * stdDev);
  const lower = middle - (2 * stdDev);
  const current = prices[prices.length - 1];
  
  let position = 'MIDDLE';
  if (current >= upper) position = 'ABOVE_UPPER';
  else if (current <= lower) position = 'BELOW_LOWER';
  else if (current > middle) position = 'UPPER_HALF';
  else position = 'LOWER_HALF';
  
  return { upper: Math.round(upper * 100) / 100, middle: Math.round(middle * 100) / 100, lower: Math.round(lower * 100) / 100, position };
}

function detectCandlestickPatterns(candles: CandleData[]): CandlePattern[] {
  const patterns: CandlePattern[] = [];
  if (candles.length < 3) return patterns;
  
  const current = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const prev2 = candles[candles.length - 3];
  
  const bodySize = Math.abs(current.close - current.open);
  const totalRange = current.high - current.low;
  const lowerShadow = Math.min(current.open, current.close) - current.low;
  const upperShadow = current.high - Math.max(current.open, current.close);
  
  if (totalRange > 0 && lowerShadow > bodySize * 2 && upperShadow < bodySize * 0.5) {
    patterns.push({
      pattern: 'HAMMER',
      pattern_ar: 'المطرقة',
      direction: 'BULLISH',
      confidence: 75,
      strength: 'MODERATE',
      description: 'إشارة انعكاس صاعدة'
    });
  }
  
  if (totalRange > 0 && upperShadow > bodySize * 2 && lowerShadow < bodySize * 0.5) {
    patterns.push({
      pattern: 'SHOOTING_STAR',
      pattern_ar: 'الشهاب',
      direction: 'BEARISH',
      confidence: 70,
      strength: 'MODERATE',
      description: 'إشارة انعكاس هابطة'
    });
  }
  
  if (bodySize < totalRange * 0.1 && totalRange > 0) {
    patterns.push({
      pattern: 'DOJI',
      pattern_ar: 'دوجي',
      direction: 'NEUTRAL',
      confidence: 60,
      strength: 'WEAK',
      description: 'تردد في السوق'
    });
  }
  
  if (prev2 && prev) {
    const firstBearish = prev2.close < prev2.open;
    const secondSmall = Math.abs(prev.close - prev.open) < prev2.open * 0.02;
    const thirdBullish = current.close > current.open;
    
    if (firstBearish && secondSmall && thirdBullish) {
      patterns.push({
        pattern: 'MORNING_STAR',
        pattern_ar: 'نجم الصباح',
        direction: 'BULLISH',
        confidence: 85,
        strength: 'STRONG',
        description: 'إشارة صاعدة قوية'
      });
    }
  }
  
  if (prev && current.close > current.open && prev.close < prev.open) {
    if (current.open < prev.close && current.close > prev.open) {
      patterns.push({
        pattern: 'BULLISH_ENGULFING',
        pattern_ar: 'الابتلاع الصاعد',
        direction: 'BULLISH',
        confidence: 80,
        strength: 'STRONG',
        description: 'إشارة صاعدة قوية'
      });
    }
  }
  
  if (prev && current.close < current.open && prev.close > prev.open) {
    if (current.open > prev.close && current.close < prev.open) {
      patterns.push({
        pattern: 'BEARISH_ENGULFING',
        pattern_ar: 'الابتلاع الهابط',
        direction: 'BEARISH',
        confidence: 80,
        strength: 'STRONG',
        description: 'إشارة هابطة قوية'
      });
    }
  }
  
  return patterns;
}

function calculateFibonacciLevels(high: number, low: number, current: number): { level: string | null; atGolden: boolean } {
  const diff = high - low;
  if (diff <= 0) return { level: null, atGolden: false };
  
  const levels = {
    '0%': high,
    '23.6%': high - diff * 0.236,
    '38.2%': high - diff * 0.382,
    '50%': high - diff * 0.5,
    '61.8%': high - diff * 0.618,
    '78.6%': high - diff * 0.786,
    '100%': low
  };
  
  let nearestLevel: string | null = null;
  let minDistance = Infinity;
  
  for (const [name, value] of Object.entries(levels)) {
    const distance = Math.abs(current - value);
    if (distance < minDistance) {
      minDistance = distance;
      nearestLevel = name;
    }
  }
  
  const goldenLevel = levels['61.8%'];
  const tolerance = diff * 0.02;
  const atGolden = Math.abs(current - goldenLevel) < tolerance;
  
  return { level: nearestLevel, atGolden };
}

function performTechnicalAnalysis(stock: StockClassification, history: CandleData[]): TechnicalAnalysis {
  const closes = history.map(h => h.close);
  const highs = history.map(h => h.high);
  const lows = history.map(h => h.low);
  const currentPrice = stock.price;
  
  const sma20 = calculateSMA(closes, 20);
  const sma50 = calculateSMA(closes, 50);
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  
  let trend = 'NEUTRAL';
  let trendStrength = 50;
  
  if (sma20 && sma50) {
    if (currentPrice > sma20 && sma20 > sma50) {
      trend = 'UPTREND';
      trendStrength = 70 + Math.min(20, ((currentPrice - sma20) / sma20) * 1000);
    } else if (currentPrice < sma20 && sma20 < sma50) {
      trend = 'DOWNTREND';
      trendStrength = 70 + Math.min(20, ((sma20 - currentPrice) / sma20) * 1000);
    }
  }
  
  const rsi = calculateRSI(closes);
  const stochastic = calculateStochastic(highs, lows, closes);
  const macd = calculateMACD(closes);
  const bollinger = calculateBollinger(closes);
  
  const recentHighs = highs.slice(-20);
  const recentLows = lows.slice(-20);
  const resistance = Math.max(...recentHighs);
  const support = Math.min(...recentLows);
  const pivot = (resistance + support + currentPrice) / 3;
  
  const candlePatterns = detectCandlestickPatterns(history);
  const bestPattern = candlePatterns.length > 0 
    ? candlePatterns.reduce((best, p) => p.confidence > best.confidence ? p : best) 
    : null;
  
  const swingHigh = Math.max(...highs.slice(-20));
  const swingLow = Math.min(...lows.slice(-20));
  const fibonacci = calculateFibonacciLevels(swingHigh, swingLow, currentPrice);
  
  let technicalScore = 50;
  
  if (trend === 'UPTREND') technicalScore += 15;
  else if (trend === 'DOWNTREND') technicalScore -= 15;
  
  if (rsi) {
    if (rsi.signal === 'OVERSOLD') technicalScore += 10;
    else if (rsi.signal === 'OVERBOUGHT') technicalScore -= 10;
  }
  
  if (stochastic) {
    if (stochastic.signal === 'OVERSOLD') technicalScore += 8;
    else if (stochastic.signal === 'OVERBOUGHT') technicalScore -= 8;
  }
  
  if (macd) {
    if (macd.trend === 'BULLISH') technicalScore += 10;
    else if (macd.trend === 'BEARISH') technicalScore -= 10;
  }
  
  if (bestPattern) {
    if (bestPattern.direction === 'BULLISH') technicalScore += bestPattern.confidence * 0.15;
    else if (bestPattern.direction === 'BEARISH') technicalScore -= bestPattern.confidence * 0.15;
  }
  
  if (fibonacci.atGolden) {
    if (trend === 'DOWNTREND') technicalScore += 12;
    else technicalScore -= 5;
  }
  
  technicalScore = Math.max(0, Math.min(100, Math.round(technicalScore)));
  
  let recommendation = 'HOLD';
  let recommendationAr = 'احتفاظ';
  let confidence = 50;
  
  if (technicalScore >= 75) {
    recommendation = 'STRONG_BUY';
    recommendationAr = 'شراء قوي';
    confidence = 85;
  } else if (technicalScore >= 65) {
    recommendation = 'BUY';
    recommendationAr = 'شراء';
    confidence = 75;
  } else if (technicalScore >= 55) {
    recommendation = 'ACCUMULATE';
    recommendationAr = 'تجميع';
    confidence = 65;
  } else if (technicalScore <= 25) {
    recommendation = 'STRONG_SELL';
    recommendationAr = 'بيع قوي';
    confidence = 85;
  } else if (technicalScore <= 35) {
    recommendation = 'SELL';
    recommendationAr = 'بيع';
    confidence = 75;
  } else if (technicalScore <= 45) {
    recommendation = 'REDUCE';
    recommendationAr = 'تخفيض';
    confidence = 60;
  }
  
  return {
    symbol: stock.symbol,
    price: currentPrice,
    trend,
    trend_ar: trend === 'UPTREND' ? 'صاعد' : trend === 'DOWNTREND' ? 'هابط' : 'محايد',
    trend_strength: Math.round(trendStrength),
    sma_20: sma20 ? Math.round(sma20 * 100) / 100 : null,
    sma_50: sma50 ? Math.round(sma50 * 100) / 100 : null,
    ema_12: ema12 ? Math.round(ema12 * 100) / 100 : null,
    ema_26: ema26 ? Math.round(ema26 * 100) / 100 : null,
    price_vs_sma20: sma20 ? (currentPrice > sma20 ? 'above' : 'below') : 'unknown',
    price_vs_sma50: sma50 ? (currentPrice > sma50 ? 'above' : 'below') : 'unknown',
    rsi: rsi?.value || null,
    rsi_signal: rsi?.signal || 'NEUTRAL',
    stochastic_k: stochastic?.k || null,
    stochastic_signal: stochastic?.signal || 'NEUTRAL',
    macd,
    bollinger,
    support: Math.round(support * 100) / 100,
    resistance: Math.round(resistance * 100) / 100,
    pivot: Math.round(pivot * 100) / 100,
    candlestick_patterns: candlePatterns,
    best_pattern: bestPattern,
    fibonacci_level: fibonacci.level,
    at_golden_ratio: fibonacci.atGolden,
    technical_score: technicalScore,
    recommendation,
    recommendation_ar: recommendationAr,
    confidence
  };
}

function identifyTradingOpportunity(stock: StockClassification, analysis: TechnicalAnalysis): TradingOpportunity {
  let opportunityType: 'BUY' | 'SELL' | 'WATCH' = 'WATCH';
  let overallScore = analysis.technical_score;
  let riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' = 'MEDIUM';
  const reasons: string[] = [];
  const reasonsAr: string[] = [];
  
  if (analysis.technical_score >= 65) {
    opportunityType = 'BUY';
    reasons.push('Technical indicators show bullish signals');
    reasonsAr.push('المؤشرات الفنية تظهر إشارات صاعدة');
    
    if (analysis.rsi_signal === 'OVERSOLD') {
      reasons.push('RSI indicates oversold condition');
      reasonsAr.push('مؤشر RSI يشير إلى تشبع بيعي');
      overallScore += 5;
    }
    
    if (analysis.stochastic_signal === 'OVERSOLD') {
      reasons.push('Stochastic in oversold zone');
      reasonsAr.push('مؤشر Stochastic في منطقة التشبع البيعي');
      overallScore += 3;
    }
    
    if (analysis.at_golden_ratio) {
      reasons.push('Price at Fibonacci golden ratio (61.8%)');
      reasonsAr.push('السعر عند مستوى فيبوناتشي الذهبي (61.8%)');
      overallScore += 5;
    }
    
    if (analysis.best_pattern?.direction === 'BULLISH') {
      reasons.push(`${analysis.best_pattern.pattern} pattern detected`);
      reasonsAr.push(`تم اكتشاف نموذج ${analysis.best_pattern.pattern_ar}`);
      overallScore += 5;
    }
    
  } else if (analysis.technical_score <= 35) {
    opportunityType = 'SELL';
    reasons.push('Technical indicators show bearish signals');
    reasonsAr.push('المؤشرات الفنية تظهر إشارات هابطة');
    
    if (analysis.rsi_signal === 'OVERBOUGHT') {
      reasons.push('RSI indicates overbought condition');
      reasonsAr.push('مؤشر RSI يشير إلى تشبع شرائي');
      overallScore += 5;
    }
    
    if (analysis.best_pattern?.direction === 'BEARISH') {
      reasons.push(`${analysis.best_pattern.pattern} pattern detected`);
      reasonsAr.push(`تم اكتشاف نموذج ${analysis.best_pattern.pattern_ar}`);
      overallScore += 5;
    }
    
  } else {
    opportunityType = 'WATCH';
    reasons.push('Wait for clearer signals');
    reasonsAr.push('انتظار إشارات أوضح');
    
    if (analysis.trend === 'UPTREND') {
      reasons.push('Uptrend in progress');
      reasonsAr.push('اتجاه صاعد مستمر');
    } else if (analysis.trend === 'DOWNTREND') {
      reasons.push('Downtrend in progress');
      reasonsAr.push('اتجاه هابط مستمر');
    }
  }
  
  if (stock.volatility > 5) {
    riskLevel = 'HIGH';
  } else if (stock.volatility > 2) {
    riskLevel = 'MEDIUM';
  } else {
    riskLevel = 'LOW';
  }
  
  let potentialReturn = 0;
  if (opportunityType === 'BUY') {
    potentialReturn = ((analysis.resistance - stock.price) / stock.price) * 100;
  } else if (opportunityType === 'SELL') {
    potentialReturn = ((stock.price - analysis.support) / stock.price) * 100;
  }
  
  const entryPrice = stock.price;
  const stopLoss = opportunityType === 'BUY' 
    ? analysis.support * 0.98 
    : analysis.resistance * 1.02;
  const takeProfit1 = opportunityType === 'BUY'
    ? entryPrice + (entryPrice - stopLoss) * 1.5
    : entryPrice - (stopLoss - entryPrice) * 1.5;
  const takeProfit2 = opportunityType === 'BUY'
    ? entryPrice + (entryPrice - stopLoss) * 2.5
    : entryPrice - (stopLoss - entryPrice) * 2.5;
  
  return {
    symbol: stock.symbol,
    name: stock.name,
    price: stock.price,
    opportunity_type: opportunityType,
    opportunity_type_ar: opportunityType === 'BUY' ? 'شراء' : opportunityType === 'SELL' ? 'بيع' : 'مراقبة',
    overall_score: Math.min(100, Math.round(overallScore)),
    risk_level: riskLevel,
    risk_level_ar: riskLevel === 'LOW' ? 'منخفض' : riskLevel === 'MEDIUM' ? 'متوسط' : 'عالي',
    potential_return: Math.round(potentialReturn * 10) / 10,
    reasons,
    reasons_ar: reasonsAr,
    technical_analysis: analysis,
    entry_price: Math.round(entryPrice * 100) / 100,
    stop_loss: Math.round(stopLoss * 100) / 100,
    take_profit_1: Math.round(takeProfit1 * 100) / 100,
    take_profit_2: Math.round(takeProfit2 * 100) / 100,
    rank: 0
  };
}

// ==================== Main Handler ====================

/**
 * GET: الحصول على حالة المسح الحالي
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const action = searchParams.get('action');
  
  // إيقاف المسح
  if (action === 'stop') {
    scanState.isRunning = false;
    return NextResponse.json({
      success: true,
      message: 'تم إيقاف المسح',
      state: scanState
    });
  }
  
  // إرجاع الحالة الحالية
  return NextResponse.json({
    success: true,
    state: {
      isRunning: scanState.isRunning,
      currentBatch: scanState.currentBatch,
      totalBatches: scanState.totalBatches,
      processedStocks: scanState.processedStocks,
      totalStocks: scanState.totalStocks,
      resultsCount: scanState.results.length,
      errorsCount: scanState.errors.length,
      startTime: scanState.startTime,
      elapsedMs: scanState.startTime > 0 ? Date.now() - scanState.startTime : 0
    }
  });
}

/**
 * POST: بدء مسح جديد أو متابعة
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // التحقق من وجود مسح قيد التشغيل
    if (scanState.isRunning) {
      return NextResponse.json({
        success: false,
        error: 'يوجد مسح قيد التشغيل بالفعل',
        state: scanState
      }, { status: 409 });
    }
    
    const body = await request.json().catch(() => ({}));
    const { 
      batchSize = BATCH_SIZE,
      delayBetweenBatches = DELAY_BETWEEN_BATCHES,
      includeDead = false,
      resume = false  // متابعة من حيث توقف
    } = body;
    
    console.log('[Batch Scanner] Starting batch scan...');
    
    // 1. جلب جميع الأسهم
    let stocks: StockData[] = [];
    try {
      stocks = await fetchStocksFromPythonBackend();
    } catch (error) {
      return NextResponse.json({
        success: false,
        error: 'فشل الاتصال بـ Python Backend',
        backend_url: PYTHON_BACKEND_URL
      }, { status: 503 });
    }
    
    console.log(`[Batch Scanner] Found ${stocks.length} stocks`);
    
    // 2. إعداد الحالة
    const totalBatches = Math.ceil(stocks.length / batchSize);
    
    scanState = {
      isRunning: true,
      currentBatch: resume ? scanState.currentBatch : 0,
      totalBatches,
      processedStocks: resume ? scanState.processedStocks : 0,
      totalStocks: stocks.length,
      results: resume ? scanState.results : [],
      startTime: Date.now(),
      errors: []
    };
    
    // 3. معالجة الدفعات
    const allResults: TradingOpportunity[] = [...scanState.results];
    
    for (let batchIndex = scanState.currentBatch; batchIndex < totalBatches; batchIndex++) {
      // التحقق من إيقاف المسح
      if (!scanState.isRunning) {
        console.log('[Batch Scanner] Scan stopped by user');
        break;
      }
      
      scanState.currentBatch = batchIndex;
      const startIdx = batchIndex * batchSize;
      const endIdx = Math.min(startIdx + batchSize, stocks.length);
      const batchStocks = stocks.slice(startIdx, endIdx);
      
      console.log(`[Batch Scanner] Processing batch ${batchIndex + 1}/${totalBatches} (${batchStocks.length} stocks)`);
      
      // معالجة كل سهم في الدفعة
      for (const stock of batchStocks) {
        try {
          // جلب البيانات التاريخية
          const history = await fetchHistoryFromPythonBackend(stock.symbol, HISTORY_DAYS);
          
          // تصنيف السهم
          const classification = classifyStock(stock, history);
          
          // تخطي الأسهم الميتة إذا لم يُطلب تضمينها
          if (!includeDead && !classification.is_alive) {
            continue;
          }
          
          // تحليل فني إذا كان هناك بيانات كافية
          if (history.length >= 10) {
            const analysis = performTechnicalAnalysis(classification, history);
            const opportunity = identifyTradingOpportunity(classification, analysis);
            allResults.push(opportunity);
          }
          
          scanState.processedStocks++;
          
        } catch (error) {
          scanState.errors.push(`Error processing ${stock.symbol}: ${error}`);
        }
      }
      
      // تحديث النتائج
      scanState.results = allResults;
      
      // تأخير بين الدفعات (إلا إذا كانت آخر دفعة)
      if (batchIndex < totalBatches - 1 && scanState.isRunning) {
        console.log(`[Batch Scanner] Waiting ${delayBetweenBatches}ms before next batch...`);
        await delay(delayBetweenBatches);
      }
    }
    
    // 4. ترتيب النتائج
    const sortedResults = allResults.sort((a, b) => b.overall_score - a.overall_score);
    sortedResults.forEach((opp, idx) => {
      opp.rank = idx + 1;
    });
    
    // 5. تقسيم النتائج
    const buyOpportunities = sortedResults.filter(o => o.opportunity_type === 'BUY');
    const sellOpportunities = sortedResults.filter(o => o.opportunity_type === 'SELL');
    const watchOpportunities = sortedResults.filter(o => o.opportunity_type === 'WATCH');
    
    const duration = Date.now() - startTime;
    
    // 6. إنهاء المسح
    scanState.isRunning = false;
    
    console.log(`[Batch Scanner] Completed in ${duration}ms`);
    console.log(`[Batch Scanner] Buy: ${buyOpportunities.length}, Sell: ${sellOpportunities.length}, Watch: ${watchOpportunities.length}`);
    
    const result = {
      success: true,
      scan_timestamp: new Date().toISOString(),
      duration_ms: duration,
      batches_processed: scanState.currentBatch + 1,
      total_batches: totalBatches,
      processed_stocks: scanState.processedStocks,
      total_stocks: stocks.length,
      opportunities: {
        buy: buyOpportunities,
        sell: sellOpportunities,
        watch: watchOpportunities
      },
      top_opportunities: sortedResults.slice(0, 20),
      errors: scanState.errors.length > 0 ? scanState.errors.slice(0, 10) : undefined
    };
    
    return NextResponse.json(result);
    
  } catch (error) {
    scanState.isRunning = false;
    console.error('[Batch Scanner] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'حدث خطأ في المسح',
      details: String(error)
    }, { status: 500 });
  }
}
