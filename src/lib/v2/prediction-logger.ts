/**
 * V2 Prediction Logger — Records stock predictions for self-learning feedback loop.
 *
 * When the recommendation engine generates predictions for stocks, this module
 * snapshots the prediction data (scores, prices, market context) into the
 * prediction_logs table. Later, the FeedbackLoop compares these predictions
 * against actual price movements to evaluate accuracy.
 */

import type { StockRecommendation, MarketAnalysis } from './types';
import { getWeight } from './config-service';

// ==================== DATABASE ACCESS ====================

import { createDatabase, isInitialized, type SqliteDatabase } from '@/lib/sqlite-wrapper';
import * as path from 'path';

function getWriteDb(): SqliteDatabase {
  if (!isInitialized()) {
    throw new Error('sql.js is not yet initialized. Prediction logger requires database access.');
  }
  const dbPath = path.join(process.cwd(), 'db', 'egx_investment.db');
  return createDatabase(dbPath);
}

// ==================== TYPES ====================

export interface PredictionLogEntry {
  id: number;
  ticker: string;
  stock_id: number | null;
  sector: string;
  prediction_date: string;
  predicted_direction: 'up' | 'down' | 'neutral';
  predicted_price_5d: number | null;
  predicted_price_10d: number | null;
  predicted_price_20d: number | null;
  target_price: number | null;
  stop_loss: number | null;
  entry_price: number | null;
  composite_score: number | null;
  quality_score: number | null;
  momentum_score: number | null;
  fair_value: number | null;
  upside_potential: number | null;
  recommendation: string | null;
  confidence: number | null;
  market_regime: string | null;
  regime_multiplier: number | null;
  weights_snapshot: string | null;
  features_snapshot: string | null;
  validated: number;
  validated_at: string | null;
  actual_price_5d: number | null;
  actual_price_10d: number | null;
  actual_price_20d: number | null;
  direction_correct_5d: number | null;
  direction_correct_10d: number | null;
  direction_correct_20d: number | null;
  price_error_5d: number | null;
  price_error_10d: number | null;
  price_error_20d: number | null;
  target_reached: number | null;
  stop_hit: number | null;
  model_version: string | null;
  source: string;
  created_at: string | null;
}

export interface BatchLogResult {
  total: number;
  inserted: number;
  skipped: number;
  errors: string[];
}

export interface PredictionStats {
  total_predictions: number;
  validated_predictions: number;
  unvalidated_predictions: number;
  oldest_prediction: string | null;
  newest_prediction: string | null;
  by_recommendation: Record<string, number>;
  by_regime: Record<string, number>;
  avg_composite_score: number;
}

// ==================== PREDICTION DIRECTION ====================

/**
 * Determine predicted direction from a recommendation.
 */
function getPredictedDirection(rec: StockRecommendation): 'up' | 'down' | 'neutral' {
  if (rec.recommendation === 'Strong Buy' || rec.recommendation === 'Buy') return 'up';
  if (rec.recommendation === 'Strong Avoid' || rec.recommendation === 'Avoid') return 'down';
  return 'neutral';
}

/**
 * Estimate future price based on momentum and fair value.
 * Uses weighted average of current momentum trend and fair value gap.
 */
function estimateFuturePrice(
  currentPrice: number,
  fairValue: number,
  momentumScore: number,
  qualityScore: number,
  days: number
): number {
  // Fair value gap as annualized return
  const fairValueGap = (fairValue - currentPrice) / currentPrice;

  // Momentum as signal strength (score 0-100 → 0-0.5 annualized)
  const momentumSignal = (momentumScore / 100) * 0.5;

  // Quality acts as confidence multiplier (higher quality = trust fair value more)
  const qualityConfidence = 0.3 + (qualityScore / 100) * 0.7;

  // Blend: quality-weighted fair value target + momentum signal
  const blendedAnnualReturn = fairValueGap * qualityConfidence + momentumSignal * (1 - qualityConfidence);

  // Convert to daily and project forward
  const dailyReturn = blendedAnnualReturn / 252;
  const projectedPrice = currentPrice * Math.pow(1 + dailyReturn, days);

  return Math.round(projectedPrice * 1000) / 1000;
}

// ==================== WEIGHT SNAPSHOT ====================

/**
 * Capture the current calculation weights as a JSON snapshot.
 */
function captureWeightsSnapshot(): string {
  const relevantWeights = [
    'weight_profitability', 'weight_growth', 'weight_safety', 'weight_efficiency', 'weight_valuation',
    'strong_buy_threshold', 'buy_threshold', 'hold_threshold', 'sell_threshold',
    'quality_composite_weight', 'momentum_composite_weight',
    'regime_bull_multiplier', 'regime_bear_multiplier',
  ];
  const snapshot: Record<string, number> = {};
  for (const name of relevantWeights) {
    snapshot[name] = getWeight(name);
  }
  return JSON.stringify(snapshot);
}

// ==================== LOG PREDICTIONS ====================

/**
 * Log a single stock prediction to the database.
 */
export function logPrediction(
  rec: StockRecommendation,
  market: MarketAnalysis
): boolean {
  try {
    const db = getWriteDb();
    try {
      db.pragma('journal_mode = WAL');

      // Get stock_id from stocks table
      const stockRow = db.prepare('SELECT id FROM stocks WHERE ticker = ?').get(rec.ticker) as { id: number } | undefined;
      const stockId = stockRow?.id ?? null;

      const direction = getPredictedDirection(rec);
      const now = new Date().toISOString();

      const predicted5d = estimateFuturePrice(rec.currentPrice, rec.fairValue.averageFairValue, rec.momentumScore.score, rec.qualityScore.total, 5);
      const predicted10d = estimateFuturePrice(rec.currentPrice, rec.fairValue.averageFairValue, rec.momentumScore.score, rec.qualityScore.total, 10);
      const predicted20d = estimateFuturePrice(rec.currentPrice, rec.fairValue.averageFairValue, rec.momentumScore.score, rec.qualityScore.total, 20);

      db.prepare(`
        INSERT INTO prediction_logs (
          ticker, stock_id, sector, prediction_date, predicted_direction,
          predicted_price_5d, predicted_price_10d, predicted_price_20d,
          target_price, stop_loss, entry_price,
          composite_score, quality_score, momentum_score,
          fair_value, upside_potential, recommendation, confidence,
          market_regime, regime_multiplier, weights_snapshot, features_snapshot,
          model_version, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        rec.ticker,
        stockId,
        rec.sector,
        now.split('T')[0], // YYYY-MM-DD
        direction,
        predicted5d,
        predicted10d,
        predicted20d,
        rec.exitStrategy.targetPrice || null,
        rec.exitStrategy.stopLoss || null,
        rec.entryPrice || null,
        rec.compositeScore,
        rec.qualityScore.total,
        rec.momentumScore.score,
        rec.fairValue.averageFairValue,
        rec.fairValue.upsidePotential,
        rec.recommendation,
        rec.confidence,
        rec.marketRegime,
        market.regimeMultiplier,
        captureWeightsSnapshot(),
        JSON.stringify({
          violations_count: rec.violations.length,
          red_flags_count: rec.redFlags.length,
          signal_confluence: rec.momentumScore.signalConfluence.allAligned,
          support: rec.momentumScore.supportResistance.strongSupport,
          resistance: rec.momentumScore.supportResistance.strongResistance,
          position_pct: rec.momentumScore.supportResistance.positionPercent,
          zone: rec.momentumScore.supportResistance.zone,
        }),
        rec.analysisVersion,
        'v2_engine',
        now,
      );

      return true;
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(`[PredictionLogger] Error logging prediction for ${rec.ticker}:`, err);
    return false;
  }
}

/**
 * Log a batch of predictions (all stocks from a recommendation run).
 */
export function logBatchPredictions(
  recommendations: StockRecommendation[],
  market: MarketAnalysis
): BatchLogResult {
  const result: BatchLogResult = {
    total: recommendations.length,
    inserted: 0,
    skipped: 0,
    errors: [],
  };

  for (const rec of recommendations) {
    try {
      const ok = logPrediction(rec, market);
      if (ok) result.inserted++;
      else result.skipped++;
    } catch (err) {
      result.skipped++;
      result.errors.push(`${rec.ticker}: ${String(err)}`);
    }
  }

  return result;
}

/**
 * Log a historical backtest prediction (for seeding past predictions).
 */
export function logBacktestPrediction(params: {
  ticker: string;
  stockId: number | null;
  sector: string;
  predictionDate: string;
  currentPrice: number;
  direction: 'up' | 'down' | 'neutral';
  compositeScore: number;
  qualityScore: number;
  momentumScore: number;
  fairValue: number;
  upsidePotential: number;
  recommendation: string;
  confidence: number;
  marketRegime: string;
  regimeMultiplier: number;
  targetPrice: number | null;
  stopLoss: number | null;
  entryPrice: number | null;
  actualPrice5d: number | null;
  actualPrice10d: number | null;
  actualPrice20d: number | null;
}): boolean {
  try {
    const db = getWriteDb();
    try {
      db.pragma('journal_mode = WAL');

      const predicted5d = estimateFuturePrice(params.currentPrice, params.fairValue, params.momentumScore, params.qualityScore, 5);
      const predicted10d = estimateFuturePrice(params.currentPrice, params.fairValue, params.momentumScore, params.qualityScore, 10);
      const predicted20d = estimateFuturePrice(params.currentPrice, params.fairValue, params.momentumScore, params.qualityScore, 20);

      // Pre-validate if actual prices are available
      let validated = 0;
      let validatedAt: string | null = null;
      let dirCorrect5d: number | null = null;
      let dirCorrect10d: number | null = null;
      let dirCorrect20d: number | null = null;
      let priceErr5d: number | null = null;
      let priceErr10d: number | null = null;
      let priceErr20d: number | null = null;
      let targetReached: number | null = null;
      let stopHit: number | null = null;

      if (params.actualPrice5d !== null || params.actualPrice10d !== null || params.actualPrice20d !== null) {
        validated = 1;
        validatedAt = new Date().toISOString();

        // 5-day validation
        if (params.actualPrice5d !== null) {
          dirCorrect5d = (params.direction === 'up' && params.actualPrice5d > params.currentPrice)
            || (params.direction === 'down' && params.actualPrice5d < params.currentPrice)
            || (params.direction === 'neutral') ? 1 : 0;
          priceErr5d = params.predicted_price_5d
            ? Math.round(((params.actualPrice5d - params.predicted_price_5d) / params.predicted_price_5d) * 10000) / 100
            : null;
          if (params.targetPrice && params.actualPrice5d >= params.targetPrice) targetReached = 1;
          if (params.stopLoss && params.actualPrice5d <= params.stopLoss) stopHit = 1;
        }

        // 10-day validation
        if (params.actualPrice10d !== null) {
          dirCorrect10d = (params.direction === 'up' && params.actualPrice10d > params.currentPrice)
            || (params.direction === 'down' && params.actualPrice10d < params.currentPrice)
            || (params.direction === 'neutral') ? 1 : 0;
          priceErr10d = params.predicted_price_10d
            ? Math.round(((params.actualPrice10d - params.predicted_price_10d) / params.predicted_price_10d) * 10000) / 100
            : null;
          if (params.targetPrice && params.actualPrice10d >= params.targetPrice) targetReached = 1;
          if (params.stopLoss && params.actualPrice10d <= params.stopLoss) stopHit = 1;
        }

        // 20-day validation
        if (params.actualPrice20d !== null) {
          dirCorrect20d = (params.direction === 'up' && params.actualPrice20d > params.currentPrice)
            || (params.direction === 'down' && params.actualPrice20d < params.currentPrice)
            || (params.direction === 'neutral') ? 1 : 0;
          priceErr20d = params.predicted_price_20d
            ? Math.round(((params.actualPrice20d - params.predicted_price_20d) / params.predicted_price_20d) * 10000) / 100
            : null;
          if (params.targetPrice && params.actualPrice20d >= params.targetPrice) targetReached = 1;
          if (params.stopLoss && params.actualPrice20d <= params.stopLoss) stopHit = 1;
        }
      }

      db.prepare(`
        INSERT INTO prediction_logs (
          ticker, stock_id, sector, prediction_date, predicted_direction,
          predicted_price_5d, predicted_price_10d, predicted_price_20d,
          target_price, stop_loss, entry_price,
          composite_score, quality_score, momentum_score,
          fair_value, upside_potential, recommendation, confidence,
          market_regime, regime_multiplier, weights_snapshot,
          validated, validated_at,
          actual_price_5d, actual_price_10d, actual_price_20d,
          direction_correct_5d, direction_correct_10d, direction_correct_20d,
          price_error_5d, price_error_10d, price_error_20d,
          target_reached, stop_hit,
          model_version, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        params.ticker, params.stockId, params.sector, params.predictionDate,
        params.direction, predicted5d, predicted10d, predicted20d,
        params.targetPrice, params.stopLoss, params.entryPrice,
        params.compositeScore, params.qualityScore, params.momentumScore,
        params.fairValue, params.upsidePotential, params.recommendation, params.confidence,
        params.marketRegime, params.regimeMultiplier, captureWeightsSnapshot(),
        validated, validatedAt,
        params.actualPrice5d, params.actualPrice10d, params.actualPrice20d,
        dirCorrect5d, dirCorrect10d, dirCorrect20d,
        priceErr5d, priceErr10d, priceErr20d,
        targetReached, stopHit,
        '2.0.0', 'v2_backtest', new Date().toISOString(),
      );

      return true;
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(`[PredictionLogger] Error logging backtest for ${params.ticker}:`, err);
    return false;
  }
}

// ==================== QUERY PREDICTIONS ====================

/**
 * Get prediction statistics.
 */
export function getPredictionStats(): PredictionStats {
  const db = getWriteDb();
  try {
    const total = (db.prepare('SELECT COUNT(*) as c FROM prediction_logs').get() as { c: number }).c;
    const validated = (db.prepare('SELECT COUNT(*) as c FROM prediction_logs WHERE validated = 1').get() as { c: number }).c;

    const oldest = db.prepare('SELECT MIN(prediction_date) as d FROM prediction_logs').get() as { d: string | null };
    const newest = db.prepare('SELECT MAX(prediction_date) as d FROM prediction_logs').get() as { d: string | null };

    const byRec = db.prepare(`
      SELECT recommendation, COUNT(*) as cnt FROM prediction_logs GROUP BY recommendation
    `).all() as Array<{ recommendation: string; cnt: number }>;

    const byRegime = db.prepare(`
      SELECT market_regime, COUNT(*) as cnt FROM prediction_logs GROUP BY market_regime
    `).all() as Array<{ market_regime: string; cnt: number }>;

    const avgScore = db.prepare('SELECT AVG(composite_score) as avg FROM prediction_logs').get() as { avg: number | null };

    const byRecMap: Record<string, number> = {};
    for (const r of byRec) byRecMap[r.recommendation || 'unknown'] = r.cnt;

    const byRegimeMap: Record<string, number> = {};
    for (const r of byRegime) byRegimeMap[r.market_regime || 'unknown'] = r.cnt;

    return {
      total_predictions: total,
      validated_predictions: validated,
      unvalidated_predictions: total - validated,
      oldest_prediction: oldest?.d ?? null,
      newest_prediction: newest?.d ?? null,
      by_recommendation: byRecMap,
      by_regime: byRegimeMap,
      avg_composite_score: avgScore?.avg ? Math.round(avgScore.avg * 10) / 10 : 0,
    };
  } finally {
    db.close();
  }
}

/**
 * Get recent predictions (paginated).
 */
export function getRecentPredictions(limit: number = 50, offset: number = 0): PredictionLogEntry[] {
  const db = getWriteDb();
  try {
    return db.prepare(`
      SELECT * FROM prediction_logs ORDER BY prediction_date DESC, ticker ASC LIMIT ? OFFSET ?
    `).all(limit, offset) as PredictionLogEntry[];
  } finally {
    db.close();
  }
}

/**
 * Get accuracy summaries over time.
 */
export function getAccuracyHistory(limit: number = 30): Array<Record<string, unknown>> {
  const db = getWriteDb();
  try {
    return db.prepare(`
      SELECT * FROM feedback_accuracy_summary ORDER BY evaluated_at DESC LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/**
 * Get weight adjustment history.
 */
export function getWeightAdjustmentHistory(limit: number = 50): Array<Record<string, unknown>> {
  const db = getWriteDb();
  try {
    return db.prepare(`
      SELECT * FROM weight_adjustment_logs ORDER BY created_at DESC LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;
  } finally {
    db.close();
  }
}

/**
 * Get unvalidated predictions count.
 */
export function getUnvalidatedCount(): number {
  const db = getWriteDb();
  try {
    const r = db.prepare('SELECT COUNT(*) as c FROM prediction_logs WHERE validated = 0').get() as { c: number };
    return r.c;
  } finally {
    db.close();
  }
}

/**
 * Clear all prediction logs (for testing/admin).
 */
export function clearAllPredictions(): number {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');
    const result = db.prepare('DELETE FROM prediction_logs').run();
    db.prepare('DELETE FROM feedback_accuracy_summary').run();
    db.prepare('DELETE FROM weight_adjustment_logs').run();
    return result.changes;
  } finally {
    db.close();
  }
}
