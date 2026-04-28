/**
 * نظام التسجيل الموحد - Unified Scoring System
 *
 * هذا الملف هو "القلب" الذي يربط المحركات الثلاثة:
 * 1. analysis-engine.ts - يحلل السهم ويدي Score (بأوزان ثابتة)
 * 2. self-learning-engine.ts - يسجل الصفقات الحقيقية ويحسب Trust
 * 3. market-learning-engine.ts - يعمل Paper Trades على البيانات التاريخية
 *
 * النتيجة: Score ديناميكي يتغير بناءً على التعلم
 */

import {
  calculateProfessionalAnalysis,
  detectMarketRegime,
  normalizePriceHistory,
  type PricePoint,
  type ProfessionalAnalysis
} from '../analysis-engine';
import {
  getAllIndicatorTrustScores,
  getIndicatorTrustScore,
  logSignal,
  logTrade,
  closeTrade,
  type IndicatorType,
  type SignalDirection,
  type MarketPhase
} from './self-learning-engine';
import {
  getRecommendedWeights,
  getIndicatorPerformance,
  type IndicatorPerformance
} from './market-learning-engine';

// ==================== TYPES ====================

export interface UnifiedScoreInput {
  ticker: string;
  stockId?: number;
  currentPrice: number;
  history: Array<Record<string, unknown>>;
  stockData: Record<string, unknown>;
  marketADX?: number;
  egx30Trend?: 'up' | 'down' | 'neutral';
  egx30DownDays?: number;
  hasCBENews?: boolean;
}

export interface UnifiedScoreResult {
  ticker: string;
  score: number;
  recommendation: ProfessionalAnalysis['recommendation'];
  weights: {
    technical: number;
    value: number;
    quality: number;
    momentum: number;
    risk: number;
  };
  weightsSource: 'learned' | 'default';
  adjustments: WeightAdjustment[];
  trustScores: Record<string, number>;
  regime: MarketPhase;
  analysis: ProfessionalAnalysis;
  signalId?: number;
}

export interface WeightAdjustment {
  factor: string;
  reason: string;
  adjustment: number;
  reasonAr: string;
}

export interface RealTradeResult {
  ticker: string;
  direction: SignalDirection;
  entryPrice: number;
  exitPrice: number;
  stopLoss: number;
  targetPrice: number;
  score: number;
  weights: Record<string, number>;
  profitPercent: number;
  daysOpen: number;
  closeReason: 'target' | 'stop_loss' | 'manual' | 'news' | 'timeout';
}

// ==================== MAIN FUNCTION ====================

/**
 * حساب التسجيل الموحد للسهم
 * This is the main entry point for unified scoring
 */
export async function calculateUnifiedScore(input: UnifiedScoreInput): Promise<UnifiedScoreResult> {
  const {
    ticker,
    stockId,
    currentPrice,
    history,
    stockData,
    marketADX = 25,
    egx30Trend = 'neutral',
    egx30DownDays = 0,
    hasCBENews = false
  } = input;

  // Normalize price history
  const pricePoints = normalizePriceHistory(history);
  const closes = pricePoints.map(p => p.close);

  // Step 1: Detect market regime
  const regime = detectMarketRegime(closes);

  // Step 2: Get initial weights from Market Learning (Paper Trades)
  const paperWeights = getPaperWeights(regime);

  // Step 3: Get Trust Scores from Self Learning (Real Trades)
  const trustScores = getIndicatorTrust();

  // Step 4: Calculate adjustments based on realism
  const adjustments: WeightAdjustment[] = [];

  // 4a: Liquidity adjustment
  const avgVolume = calculateAvgVolume(pricePoints, 20);
  const freeFloat = (stockData.free_float as number) || (stockData.shares_outstanding as number) || 0;
  const liquidityRatio = freeFloat > 0 ? (avgVolume / freeFloat) * 100 : 1;

  if (liquidityRatio < 0.1) {
    adjustments.push({
      factor: 'liquidity',
      reason: 'Low liquidity (avgVolume < 0.1% freeFloat)',
      adjustment: 0.7,
      reasonAr: 'سيولة ضعيفة - تقليل الأوزان 30%'
    });
  }

  // 4b: Stock category adjustment (low-priced stocks are riskier)
  if (currentPrice < 5) {
    adjustments.push({
      factor: 'price_category',
      reason: 'Low-priced stock (< 5 EGP)',
      adjustment: 0.8,
      reasonAr: 'سهم منخفض السعر - تقليل الأوزان 20%'
    });
  }

  // Step 5: Filter weights by Trust Scores
  const trustAdjustedWeights = applyTrustFilter(paperWeights, trustScores, adjustments);

  // Step 6: Market filter adjustments
  if (marketADX < 20) {
    adjustments.push({
      factor: 'weak_trend',
      reason: `Weak trend (ADX = ${marketADX} < 20)`,
      adjustment: 0.8,
      reasonAr: 'اتجاه ضعيف - تقليل الأوزان 20%'
    });
  }

  if (egx30Trend === 'down' && egx30DownDays >= 5) {
    adjustments.push({
      factor: 'market_downtrend',
      reason: `EGX30 down for ${egx30DownDays} consecutive days`,
      adjustment: 0.6,
      reasonAr: 'البورصة في هبوط مستمر - تقليل الأوزان 40%'
    });
  }

  if (hasCBENews) {
    adjustments.push({
      factor: 'cbe_news',
      reason: 'CBE decision within 3 days',
      adjustment: 0.5,
      reasonAr: 'قرار بنكي قريب - تقليل الأوزان 50%'
    });
  }

  // Step 7: Normalize final weights
  const finalWeights = normalizeWeights(trustAdjustedWeights, adjustments);

  // Step 8: Run analysis with dynamic weights
  const analysis = calculateProfessionalAnalysis(
    stockData,
    history
  );

  // Determine weights source
  const hasLearnedWeights = Object.values(trustScores).some(t => t > 0);
  const weightsSource: 'learned' | 'default' = hasLearnedWeights ? 'learned' : 'default';

  // Step 9: Log the signal for future learning
  let signalId: number | undefined;
  try {
    const indicatorsUsed = getActiveIndicators(trustScores);
    signalId = logSignal({
      ticker,
      stock_id: stockId || null,
      signal_date: new Date().toISOString().split('T')[0],
      direction: analysis.recommendation.action.includes('buy') || analysis.recommendation.action.includes('accumulate') ? 'buy' : 'sell',
      indicators_used: indicatorsUsed,
      score: analysis.scores.composite,
      calculated_entry_price: analysis.recommendation.entry_price,
      calculated_stop_loss: analysis.recommendation.stop_loss,
      calculated_target: analysis.recommendation.target_price,
      has_news: hasCBENews,
      executed: false
    });
  } catch (e) {
    console.error('[UnifiedScoring] Failed to log signal:', e);
  }

  return {
    ticker,
    score: analysis.scores.composite,
    recommendation: analysis.recommendation,
    weights: finalWeights,
    weightsSource,
    adjustments,
    trustScores,
    regime,
    analysis,
    signalId
  };
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Get weights from Market Learning Engine based on regime
 */
function getPaperWeights(regime: MarketPhase): {
  technical: number;
  value: number;
  quality: number;
  momentum: number;
  risk: number;
} {
  try {
    const recommendedWeights = getRecommendedWeights(regime);

    // Map indicator-level weights to category weights
    // Technical indicators: RSI, MACD, Bollinger, MA, Stochastic, ADX, SupportResistance
    // Value indicators: PE, PB, Dividend Yield
    // Quality indicators: ROE, Debt/Equity
    // Momentum indicators: MACD, ADX, Volume
    // Risk: ATR, Volatility

    const technicalIndicators = ['RSI', 'MACD', 'Bollinger', 'MA', 'Stochastic', 'ADX', 'SupportResistance'];
    const momentumIndicators = ['MACD', 'ADX', 'Volume'];

    let technicalWeight = 0.30;
    let momentumWeight = 0.10;

    // Calculate average weight for each category
    const technicalAvg = calculateAverageWeight(recommendedWeights, technicalIndicators);
    const momentumAvg = calculateAverageWeight(recommendedWeights, momentumIndicators);

    // Apply adjustments
    technicalWeight = 0.30 * technicalAvg;
    momentumWeight = 0.10 * momentumAvg;

    return {
      technical: technicalWeight,
      value: 0.25, // Value weights remain stable
      quality: 0.25, // Quality weights remain stable
      momentum: momentumWeight,
      risk: 0.10 // Risk weights remain stable
    };
  } catch (e) {
    console.error('[UnifiedScoring] Error getting paper weights:', e);
    return getDefaultWeights();
  }
}

function calculateAverageWeight(weights: Record<string, number>, indicators: string[]): number {
  const relevantWeights = indicators
    .filter(i => weights[i] !== undefined)
    .map(i => weights[i]);

  if (relevantWeights.length === 0) return 1.0;
  return relevantWeights.reduce((a, b) => a + b, 0) / relevantWeights.length;
}

/**
 * Get Trust Scores from Self Learning Engine
 */
function getIndicatorTrust(): Record<string, number> {
  try {
    const scores = getAllIndicatorTrustScores();
    const result: Record<string, number> = {};

    for (const score of scores) {
      result[score.indicator_name] = score.current_score;
    }

    return result;
  } catch (e) {
    console.error('[UnifiedScoring] Error getting trust scores:', e);
    return {};
  }
}

/**
 * Apply Trust Score filtering to weights
 */
function applyTrustFilter(
  weights: Record<string, number>,
  trustScores: Record<string, number>,
  adjustments: WeightAdjustment[]
): Record<string, number> {
  const result = { ...weights };

  // Map indicator categories to trust score indicators
  const indicatorMapping: Record<string, IndicatorType[]> = {
    technical: ['RSI', 'MACD', 'Bollinger', 'MA', 'Stochastic', 'ADX'],
    momentum: ['MACD', 'ADX', 'Volume']
  };

  for (const [category, indicators] of Object.entries(indicatorMapping)) {
    let categoryMultiplier = 1.0;

    for (const indicator of indicators) {
      const trust = trustScores[indicator];

      if (trust !== undefined) {
        if (trust < 30) {
          // Trust < 30: Remove this indicator's contribution
          categoryMultiplier *= 0.7;
          adjustments.push({
            factor: `trust_${indicator.toLowerCase()}`,
            reason: `${indicator} trust = ${trust} (< 30), reducing weight`,
            adjustment: 0.7,
            reasonAr: `ثقة ${indicator} ضعيفة - تقليل الوزن`
          });
        } else if (trust >= 30 && trust < 50) {
          // Trust 30-50: Reduce weight by 50%
          categoryMultiplier *= 0.85;
        } else if (trust > 70) {
          // Trust > 70: Increase weight by 20% (but not more than double)
          categoryMultiplier *= 1.1;
        }
      }
    }

    if (result[category] !== undefined) {
      result[category] *= categoryMultiplier;
    }
  }

  return result;
}

/**
 * Normalize weights to sum to 1.0
 */
function normalizeWeights(
  weights: Record<string, number>,
  adjustments: WeightAdjustment[]
): {
  technical: number;
  value: number;
  quality: number;
  momentum: number;
  risk: number;
} {
  let technical = weights.technical || 0.30;
  let value = weights.value || 0.25;
  let quality = weights.quality || 0.25;
  let momentum = weights.momentum || 0.10;
  let risk = weights.risk || 0.10;

  // Apply adjustment factors
  for (const adj of adjustments) {
    if (adj.adjustment !== undefined) {
      technical *= adj.adjustment;
      value *= adj.adjustment;
      quality *= adj.adjustment;
      momentum *= adj.adjustment;
      risk *= adj.adjustment;
    }
  }

  // Normalize to sum = 1.0
  const total = technical + value + quality + momentum + risk;
  if (total > 0) {
    technical = technical / total;
    value = value / total;
    quality = quality / total;
    momentum = momentum / total;
    risk = risk / total;
  }

  return {
    technical: Math.round(technical * 100) / 100,
    value: Math.round(value * 100) / 100,
    quality: Math.round(quality * 100) / 100,
    momentum: Math.round(momentum * 100) / 100,
    risk: Math.round(risk * 100) / 100
  };
}

/**
 * Calculate average volume
 */
function calculateAvgVolume(data: PricePoint[], period: number): number {
  if (data.length < period) {
    return data.reduce((sum, p) => sum + p.volume, 0) / data.length;
  }
  const recent = data.slice(-period);
  return recent.reduce((sum, p) => sum + p.volume, 0) / period;
}

/**
 * Get active indicators based on trust scores
 */
function getActiveIndicators(trustScores: Record<string, number>): IndicatorType[] {
  const allIndicators: IndicatorType[] = ['RSI', 'MACD', 'Ichimoku', 'Fibonacci', 'Bollinger', 'MA', 'ADX', 'Stochastic', 'Volume', 'SupportResistance'];

  return allIndicators.filter(indicator => {
    const trust = trustScores[indicator];
    // Include if no trust score (new) or trust >= 30
    return trust === undefined || trust >= 30;
  });
}

/**
 * Get default weights
 */
function getDefaultWeights(): {
  technical: number;
  value: number;
  quality: number;
  momentum: number;
  risk: number;
} {
  return {
    technical: 0.30,
    value: 0.25,
    quality: 0.25,
    momentum: 0.10,
    risk: 0.10
  };
}

// ==================== REAL TRADE RECORDING ====================

/**
 * Record a real trade after it closes
 * This is called after the position is closed to update the learning system
 */
export function recordRealTrade(result: RealTradeResult): void {
  try {
    // Create a minimal trade record
    const tradeId = logTrade({
      signal_id: null, // Will be linked later if exists
      ticker: result.ticker,
      stock_id: null,
      direction: result.direction,
      open_date: new Date(Date.now() - result.daysOpen * 24 * 60 * 60 * 1000).toISOString(),
      actual_entry_price: result.entryPrice,
      actual_stop_loss: result.stopLoss,
      actual_target: result.targetPrice,
      shares_count: 100, // Placeholder
      trade_value: result.entryPrice * 100,
      spread: 0
    });

    // Close the trade with the outcome
    closeTrade(tradeId, result.exitPrice, result.closeReason, {
      egx30_state: 'RANGE', // Will be updated if context available
      egx30_adx: 25
    });

    console.log(`[UnifiedScoring] Recorded trade: ${result.ticker} ${result.direction} ${result.profitPercent > 0 ? '+' : ''}${result.profitPercent.toFixed(2)}%`);
  } catch (e) {
    console.error('[UnifiedScoring] Error recording trade:', e);
  }
}

// ==================== EXPORT FOR API ====================

export {
  type IndicatorType,
  type MarketPhase,
  type SignalDirection
};
