/**
 * V2 Feedback Loop — Self-Learning Engine
 *
 * Compares logged predictions against actual price movements to:
 * 1. Validate past predictions (fill in actual prices, compute accuracy)
 * 2. Calculate accuracy metrics by recommendation type, regime, horizon
 * 3. Run historical backtesting (simulate predictions on past data, validate with known outcomes)
 * 4. Identify which weight parameters lead to better/worse predictions
 * 5. Trigger weight auto-tuning based on accuracy analysis
 */

import type { StockRecommendation, MarketAnalysis } from './types';
import { getWeight, clearCache } from './config-service';
import { analyzeSingleStock } from './recommendation-engine';
import { logBacktestPrediction, getPredictionStats, logBatchPredictions } from './prediction-logger';

// ==================== DATABASE ACCESS ====================

import { createDatabase, isInitialized, type SqliteDatabase } from '@/lib/sqlite-wrapper';
import * as path from 'path';
import { existsSync } from 'fs';

function getWriteDb(): SqliteDatabase {
  if (!isInitialized()) {
    throw new Error('sql.js is not yet initialized. Feedback loop requires database access.');
  }
  const dbPath = path.join(process.cwd(), 'db', 'egx_investment.db');
  if (!existsSync(dbPath)) {
    throw new Error(`Heavy DB file not found: ${dbPath}`);
  }
  return createDatabase(dbPath);
}

function getReadDb(): SqliteDatabase {
  if (!isInitialized()) {
    throw new Error('sql.js is not yet initialized. Feedback loop requires database access.');
  }
  const dbPath = path.join(process.cwd(), 'db', 'egx_investment.db');
  if (!existsSync(dbPath)) {
    throw new Error(`Heavy DB file not found: ${dbPath}`);
  }
  return createDatabase(dbPath, { readonly: true });
}

// ==================== TYPES ====================

export interface FeedbackRunResult {
  success: boolean;
  timestamp: string;
  predictions_validated: number;
  accuracy_summary: AccuracySummary;
  weight_adjustments: WeightAdjustment[];
  backtest_results: BacktestResult | null;
  model_accuracy: ModelAccuracy;
  message: string;
}

export interface AccuracySummary {
  horizon_5d: HorizonAccuracy | null;
  horizon_10d: HorizonAccuracy | null;
  horizon_20d: HorizonAccuracy | null;
  overall_direction_accuracy: number;
  overall_avg_price_error: number;
  total_validated: number;
}

export interface HorizonAccuracy {
  total: number;
  direction_correct: number;
  direction_accuracy: number;
  avg_price_error: number;
  by_recommendation: Record<string, { total: number; correct: number; accuracy: number }>;
  by_regime: Record<string, { total: number; correct: number; accuracy: number }>;
  avg_score_correct: number;
  avg_score_incorrect: number;
  target_reached_count: number;
  stop_hit_count: number;
}

export interface WeightAdjustment {
  parameter_name: string;
  old_value: number;
  new_value: number;
  reason: string;
  accuracy_impact: string;
}

export interface BacktestResult {
  total_stocks_tested: number;
  total_predictions_generated: number;
  predictions_validated_5d: number;
  predictions_validated_10d: number;
  predictions_validated_20d: number;
  accuracy_5d: number;
  accuracy_10d: number;
  accuracy_20d: number;
  by_sector: Record<string, number>;
  top_performers: Array<{ ticker: string; score: number; direction: string; correct5d: boolean; correct10d: boolean }>;
  worst_performers: Array<{ ticker: string; score: number; direction: string; correct5d: boolean; correct10d: boolean }>;
  avg_quality_score_correct: number;
  avg_quality_score_incorrect: number;
  avg_momentum_score_correct: number;
  avg_momentum_score_incorrect: number;
}

export interface ModelAccuracy {
  overall: number;
  fundamental: number;
  technical: number;
  predictions_validated: number;
  last_evaluated: string | null;
}

// ==================== VALIDATE EXISTING PREDICTIONS ====================

/**
 * Validate existing unvalidated predictions by comparing against actual price history.
 */
function validateExistingPredictions(): number {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    // Get unvalidated predictions that are old enough to have 5-day actuals
    const cutoff5d = new Date();
    cutoff5d.setDate(cutoff5d.getDate() - 5);
    const cutoff10d = new Date();
    cutoff10d.setDate(cutoff10d.getDate() - 10);
    const cutoff20d = new Date();
    cutoff20d.setDate(cutoff20d.getDate() - 20);

    const unvalidated = db.prepare(`
      SELECT * FROM prediction_logs 
      WHERE validated = 0 
        AND prediction_date <= ?
      ORDER BY prediction_date ASC
    `).all(cutoff5d.toISOString().split('T')[0]) as Array<Record<string, unknown>>;

    let count = 0;

    for (const pred of unvalidated) {
      const stockId = pred.stock_id as number | null;
      const ticker = pred.ticker as string;
      const predDate = pred.prediction_date as string;
      const currentPrice = Number(pred.predicted_price_5d) || 0; // entry price was stored here

      // Get the actual stock_id if missing
      let sid = stockId;
      if (!sid) {
        const stockRow = db.prepare('SELECT id, current_price FROM stocks WHERE ticker = ?').get(ticker) as { id: number; current_price: number } | undefined;
        if (!stockRow) continue;
        sid = stockRow.id;
      }

      // Get price history for validation dates
      const predDateParsed = new Date(predDate);
      const date5d = new Date(predDateParsed);
      date5d.setDate(date5d.getDate() + 5);
      const date10d = new Date(predDateParsed);
      date10d.setDate(date10d.getDate() + 10);
      const date20d = new Date(predDateParsed);
      date20d.setDate(date20d.getDate() + 20);

      const histRows = db.prepare(`
        SELECT date, close_price FROM stock_price_history 
        WHERE stock_id = ? AND date >= ? AND date <= ?
        ORDER BY date ASC
      `).all(sid, predDate, date20d.toISOString().split('T')[0]) as Array<{ date: string; close_price: number }>;

      if (histRows.length === 0) continue;

      // Get the entry price (use first close on or after prediction date)
      const entryRow = histRows.find(h => new Date(h.date) >= predDateParsed);
      const entryPrice = entryRow?.close_price || Number(pred.entry_price) || histRows[0].close_price;

      // Find prices closest to 5d, 10d, 20d targets
      let actual5d: number | null = null;
      let actual10d: number | null = null;
      let actual20d: number | null = null;

      const date5dStr = date5d.toISOString().split('T')[0];
      const date10dStr = date10d.toISOString().split('T')[0];
      const date20dStr = date20d.toISOString().split('T')[0];

      for (const row of histRows) {
        const rowDate = row.date.split('T')[0];
        if (!actual5d && rowDate >= date5dStr) actual5d = row.close_price;
        if (!actual10d && rowDate >= date10dStr) actual10d = row.close_price;
        if (!actual20d && rowDate >= date20dStr) actual20d = row.close_price;
      }

      // If we have at least one actual price, validate
      if (!actual5d && !actual10d && !actual20d) continue;

      const direction = pred.predicted_direction as string;

      // Calculate direction correctness
      const dirCorrect5d = actual5d
        ? ((direction === 'up' && actual5d > entryPrice) || (direction === 'down' && actual5d < entryPrice) || direction === 'neutral') ? 1 : 0
        : null;
      const dirCorrect10d = actual10d
        ? ((direction === 'up' && actual10d > entryPrice) || (direction === 'down' && actual10d < entryPrice) || direction === 'neutral') ? 1 : 0
        : null;
      const dirCorrect20d = actual20d
        ? ((direction === 'up' && actual20d > entryPrice) || (direction === 'down' && actual20d < entryPrice) || direction === 'neutral') ? 1 : 0
        : null;

      // Calculate price errors
      const pred5d = Number(pred.predicted_price_5d);
      const pred10d = Number(pred.predicted_price_10d);
      const pred20d = Number(pred.predicted_price_20d);

      const priceErr5d = (actual5d && pred5d > 0) ? Math.round(((actual5d - pred5d) / pred5d) * 10000) / 100 : null;
      const priceErr10d = (actual10d && pred10d > 0) ? Math.round(((actual10d - pred10d) / pred10d) * 10000) / 100 : null;
      const priceErr20d = (actual20d && pred20d > 0) ? Math.round(((actual20d - pred20d) / pred20d) * 10000) / 100 : null;

      // Check target reached / stop hit
      const targetPrice = Number(pred.target_price) || 0;
      const stopLoss = Number(pred.stop_loss) || 0;

      let targetReached: number | null = null;
      let stopHit: number | null = null;

      const allPrices = [actual5d, actual10d, actual20d].filter((p): p is number => p !== null);
      if (targetPrice > 0 && allPrices.length > 0) {
        targetReached = allPrices.some(p => p >= targetPrice) ? 1 : 0;
      }
      if (stopLoss > 0 && allPrices.length > 0) {
        stopHit = allPrices.some(p => p <= stopLoss) ? 1 : 0;
      }

      db.prepare(`
        UPDATE prediction_logs SET
          validated = 1,
          validated_at = datetime('now'),
          actual_price_5d = ?,
          actual_price_10d = ?,
          actual_price_20d = ?,
          direction_correct_5d = ?,
          direction_correct_10d = ?,
          direction_correct_20d = ?,
          price_error_5d = ?,
          price_error_10d = ?,
          price_error_20d = ?,
          target_reached = ?,
          stop_hit = ?
        WHERE id = ?
      `).run(
        actual5d, actual10d, actual20d,
        dirCorrect5d, dirCorrect10d, dirCorrect20d,
        priceErr5d, priceErr10d, priceErr20d,
        targetReached, stopHit,
        pred.id,
      );

      count++;
    }

    return count;
  } finally {
    db.close();
  }
}

// ==================== CALCULATE ACCURACY METRICS ====================

/**
 * Calculate accuracy metrics from validated predictions.
 */
function calculateAccuracyMetrics(): AccuracySummary {
  const db = getReadDb();
  try {
    const result: AccuracySummary = {
      horizon_5d: calculateHorizonAccuracy(db, '5d', 'direction_correct_5d', 'actual_price_5d', 'price_error_5d'),
      horizon_10d: calculateHorizonAccuracy(db, '10d', 'direction_correct_10d', 'actual_price_10d', 'price_error_10d'),
      horizon_20d: calculateHorizonAccuracy(db, '20d', 'direction_correct_20d', 'actual_price_20d', 'price_error_20d'),
      overall_direction_accuracy: 0,
      overall_avg_price_error: 0,
      total_validated: 0,
    };

    // Overall from best available horizon
    const validHorizons = [result.horizon_5d, result.horizon_10d, result.horizon_20d].filter(h => h !== null) as HorizonAccuracy[];
    if (validHorizons.length > 0) {
      // Weight by prediction count
      let totalWeight = 0;
      let weightedAcc = 0;
      let weightedErr = 0;
      let totalValidated = 0;
      for (const h of validHorizons) {
        totalWeight += h.total;
        weightedAcc += h.direction_accuracy * h.total;
        weightedErr += h.avg_price_error * h.total;
        totalValidated += h.total;
      }
      result.overall_direction_accuracy = totalWeight > 0 ? Math.round((weightedAcc / totalWeight) * 10) / 10 : 0;
      result.overall_avg_price_error = totalWeight > 0 ? Math.round((weightedErr / totalWeight) * 100) / 100 : 0;
      result.total_validated = totalValidated;
    }

    return result;
  } finally {
    db.close();
  }
}

function calculateHorizonAccuracy(
  db: SqliteDatabase,
  horizon: string,
  dirCol: string,
  priceCol: string,
  errCol: string,
): HorizonAccuracy | null {
  const total = db.prepare(`SELECT COUNT(*) as c FROM prediction_logs WHERE validated = 1 AND ${priceCol} IS NOT NULL`).get() as { c: number };
  if (total.c < 5) return null;

  const correct = db.prepare(`SELECT COUNT(*) as c FROM prediction_logs WHERE validated = 1 AND ${dirCol} = 1`).get() as { c: number };

  const avgErr = db.prepare(`SELECT AVG(${errCol}) as avg FROM prediction_logs WHERE validated = 1 AND ${errCol} IS NOT NULL`).get() as { avg: number | null };

  // By recommendation
  const byRecRows = db.prepare(`
    SELECT recommendation,
      COUNT(*) as total,
      SUM(CASE WHEN ${dirCol} = 1 THEN 1 ELSE 0 END) as correct
    FROM prediction_logs WHERE validated = 1 AND ${priceCol} IS NOT NULL
    GROUP BY recommendation
  `).all() as Array<{ recommendation: string; total: number; correct: number }>;

  const by_recommendation: Record<string, { total: number; correct: number; accuracy: number }> = {};
  for (const r of byRecRows) {
    by_recommendation[r.recommendation || 'unknown'] = {
      total: r.total,
      correct: r.correct,
      accuracy: r.total > 0 ? Math.round((r.correct / r.total) * 1000) / 10 : 0,
    };
  }

  // By regime
  const byRegimeRows = db.prepare(`
    SELECT market_regime,
      COUNT(*) as total,
      SUM(CASE WHEN ${dirCol} = 1 THEN 1 ELSE 0 END) as correct
    FROM prediction_logs WHERE validated = 1 AND ${priceCol} IS NOT NULL
    GROUP BY market_regime
  `).all() as Array<{ market_regime: string; total: number; correct: number }>;

  const by_regime: Record<string, { total: number; correct: number; accuracy: number }> = {};
  for (const r of byRegimeRows) {
    by_regime[r.market_regime || 'unknown'] = {
      total: r.total,
      correct: r.correct,
      accuracy: r.total > 0 ? Math.round((r.correct / r.total) * 1000) / 10 : 0,
    };
  }

  // Score correlation
  const scoreRows = db.prepare(`
    SELECT 
      AVG(CASE WHEN ${dirCol} = 1 THEN composite_score END) as avg_correct,
      AVG(CASE WHEN ${dirCol} = 0 THEN composite_score END) as avg_incorrect
    FROM prediction_logs WHERE validated = 1 AND ${priceCol} IS NOT NULL AND composite_score IS NOT NULL
  `).get() as { avg_correct: number | null; avg_incorrect: number | null };

  // Target / stop
  const targetReached = db.prepare(`SELECT COUNT(*) as c FROM prediction_logs WHERE validated = 1 AND target_reached = 1`).get() as { c: number };
  const stopHit = db.prepare(`SELECT COUNT(*) as c FROM prediction_logs WHERE validated = 1 AND stop_hit = 1`).get() as { c: number };

  return {
    total: total.c,
    direction_correct: correct.c,
    direction_accuracy: total.c > 0 ? Math.round((correct.c / total.c) * 1000) / 10 : 0,
    avg_price_error: avgErr?.avg ? Math.round(avgErr.avg * 100) / 100 : 0,
    by_recommendation,
    by_regime,
    avg_score_correct: scoreRows?.avg_correct ? Math.round(scoreRows.avg_correct * 10) / 10 : 0,
    avg_score_incorrect: scoreRows?.avg_incorrect ? Math.round(scoreRows.avg_incorrect * 10) / 10 : 0,
    target_reached_count: targetReached.c,
    stop_hit_count: stopHit.c,
  };
}

// ==================== HISTORICAL BACKTESTING ====================

/**
 * Run a historical backtest: simulate predictions at various points in the past,
 * then immediately validate against known future prices.
 *
 * This seeds the prediction_logs table with pre-validated predictions,
 * allowing the system to learn from a large sample immediately.
 */
export function runHistoricalBacktest(backtestDays: number = 60): BacktestResult {
  const db = getReadDb();
  try {
    clearCache();

    const result: BacktestResult = {
      total_stocks_tested: 0,
      total_predictions_generated: 0,
      predictions_validated_5d: 0,
      predictions_validated_10d: 0,
      predictions_validated_20d: 0,
      accuracy_5d: 0,
      accuracy_10d: 0,
      accuracy_20d: 0,
      by_sector: {},
      top_performers: [],
      worst_performers: [],
      avg_quality_score_correct: 0,
      avg_quality_score_incorrect: 0,
      avg_momentum_score_correct: 0,
      avg_momentum_score_incorrect: 0,
    };

    // Get stocks with enough history
    const stocks = db.prepare(`
      SELECT s.id, s.ticker, s.name, s.name_ar, s.sector, s.current_price, s.previous_close,
             s.pe_ratio, s.pb_ratio, s.roe, s.debt_to_equity, s.eps, s.dividend_yield,
             s.market_cap, s.volume,
             COUNT(h.id) as hist_count
      FROM stocks s
      JOIN stock_price_history h ON s.id = h.stock_id
      WHERE s.is_active = 1 AND s.current_price > 0
      GROUP BY s.id
      HAVING hist_count >= 80
      ORDER BY s.volume DESC
      LIMIT 150
    `).all() as Array<Record<string, unknown>>;

    result.total_stocks_tested = stocks.length;

    // Generate predictions at multiple historical snapshots
    // Use snapshots every 10 trading days within the backtest window
    const snapshots: Array<{ date: string; dayIndex: number }> = [];

    // Find date range
    const dateRange = db.prepare(`
      SELECT MIN(date) as min_date, MAX(date) as max_date 
      FROM stock_price_history 
      WHERE stock_id IN (SELECT id FROM stocks WHERE is_active = 1)
    `).get() as { min_date: string; max_date: string };

    const maxDate = new Date(dateRange.max_date);
    const minDate = new Date(dateRange.min_date);

    // Generate snapshots going back from the most recent data
    // Every 10 trading days, going back up to backtestDays*3 to have room for 20-day validation
    const totalLookback = Math.min(backtestDays * 3, Math.floor((maxDate.getTime() - minDate.getTime()) / (86400000)));
    let currentDate = new Date(maxDate);
    let dayCount = 0;

    while (dayCount < totalLookback) {
      // We need at least 20 trading days after this snapshot for validation
      const validationDeadline = new Date(currentDate);
      validationDeadline.setDate(validationDeadline.getDate() + 30);

      if (validationDeadline <= maxDate) {
        snapshots.push({
          date: currentDate.toISOString().split('T')[0],
          dayIndex: dayCount,
        });
      }

      currentDate.setDate(currentDate.getDate() - 10);
      dayCount += 10;
    }

    // Limit snapshots to avoid overloading
    const maxSnapshots = Math.min(snapshots.length, Math.floor(backtestDays / 5));
    const selectedSnapshots = snapshots.slice(0, maxSnapshots);

    let totalCorrect5d = 0;
    let totalTested5d = 0;
    let totalCorrect10d = 0;
    let totalTested10d = 0;
    let totalCorrect20d = 0;
    let totalTested20d = 0;

    // Track quality/momentum scores for correct vs incorrect
    let sumQualityCorrect = 0;
    let sumQualityIncorrect = 0;
    let sumMomentumCorrect = 0;
    let sumMomentumIncorrect = 0;

    // For each snapshot, run analysis on a subset of stocks
    for (const snapshot of selectedSnapshots) {
      for (const stock of stocks) {
        try {
          const stockId = Number(stock.id);
          const ticker = String(stock.ticker);

          // Get price history up to snapshot date
          const history = db.prepare(`
            SELECT date, open_price as open, high_price as high, low_price as low,
                   close_price as close, volume
            FROM stock_price_history
            WHERE stock_id = ? AND date <= ?
            ORDER BY date ASC
            LIMIT 120
          `).all(stockId, snapshot.date) as Array<Record<string, unknown>>;

          if (history.length < 40) continue;

          // Get the price at snapshot date
          const snapshotPriceRow = history[history.length - 1];
          const snapshotPrice = Number(snapshotPriceRow?.close || 0);
          if (snapshotPrice <= 0) continue;

          // Create a synthetic stock record with snapshot prices
          const syntheticStock = { ...stock };
          syntheticStock.current_price = snapshotPrice;
          syntheticStock.previous_close = history.length >= 2 ? Number(history[history.length - 2].close) : snapshotPrice;

          // Run analysis with limited history
          const analysis = analyzeSingleStock(syntheticStock, history);
          if (!analysis) continue;

          // Now validate: get actual prices 5d, 10d, 20d after snapshot
          const futureHistory = db.prepare(`
            SELECT date, close_price FROM stock_price_history
            WHERE stock_id = ? AND date > ?
            ORDER BY date ASC
            LIMIT 30
          `).all(stockId, snapshot.date) as Array<{ date: string; close_price: number }>;

          let actual5d: number | null = null;
          let actual10d: number | null = null;
          let actual20d: number | null = null;

          if (futureHistory.length >= 5) actual5d = futureHistory[4].close_price;
          if (futureHistory.length >= 10) actual10d = futureHistory[9].close_price;
          if (futureHistory.length >= 20) actual20d = futureHistory[19].close_price;

          const direction = (analysis.recommendation === 'Strong Buy' || analysis.recommendation === 'Buy') ? 'up' as const
            : (analysis.recommendation === 'Strong Avoid' || analysis.recommendation === 'Avoid') ? 'down' as const
            : 'neutral' as const;

          // Log the backtest prediction
          logBacktestPrediction({
            ticker,
            stockId,
            sector: String(stock.sector || ''),
            predictionDate: snapshot.date,
            currentPrice: snapshotPrice,
            direction,
            compositeScore: analysis.compositeScore,
            qualityScore: analysis.qualityScore.total,
            momentumScore: analysis.momentumScore.score,
            fairValue: analysis.fairValue.averageFairValue,
            upsidePotential: analysis.fairValue.upsidePotential,
            recommendation: analysis.recommendation,
            confidence: analysis.confidence,
            marketRegime: analysis.marketRegime,
            regimeMultiplier: 1.0,
            targetPrice: analysis.exitStrategy.targetPrice || null,
            stopLoss: analysis.exitStrategy.stopLoss || null,
            entryPrice: analysis.entryPrice || null,
            actualPrice5d: actual5d,
            actualPrice10d: actual10d,
            actualPrice20d: actual20d,
          });

          result.total_predictions_generated++;

          // Track accuracy
          if (actual5d !== null) {
            const correct5d = (direction === 'up' && actual5d > snapshotPrice)
              || (direction === 'down' && actual5d < snapshotPrice)
              || direction === 'neutral';
            totalTested5d++;
            if (correct5d) {
              totalCorrect5d++;
              sumQualityCorrect += analysis.qualityScore.total;
              sumMomentumCorrect += analysis.momentumScore.score;
            } else {
              sumQualityIncorrect += analysis.qualityScore.total;
              sumMomentumIncorrect += analysis.momentumScore.score;
            }
          }

          if (actual10d !== null) {
            const correct10d = (direction === 'up' && actual10d > snapshotPrice)
              || (direction === 'down' && actual10d < snapshotPrice)
              || direction === 'neutral';
            totalTested10d++;
            if (correct10d) totalCorrect10d++;
          }

          if (actual20d !== null) {
            const correct20d = (direction === 'up' && actual20d > snapshotPrice)
              || (direction === 'down' && actual20d < snapshotPrice)
              || direction === 'neutral';
            totalTested20d++;
            if (correct20d) totalCorrect20d++;
          }

          // Track sector performance
          const sector = String(stock.sector || 'unknown');
          if (actual5d !== null) {
            const correct5d = (direction === 'up' && actual5d > snapshotPrice)
              || (direction === 'down' && actual5d < snapshotPrice)
              || direction === 'neutral';
            if (!result.by_sector[sector]) result.by_sector[sector] = { correct: 0, total: 0 };
            result.by_sector[sector].total++;
            if (correct5d) result.by_sector[sector].correct++;
          }
        } catch {
          // Skip this stock/snapshot combo
        }
      }
    }

    // Calculate final metrics
    result.predictions_validated_5d = totalTested5d;
    result.predictions_validated_10d = totalTested10d;
    result.predictions_validated_20d = totalTested20d;
    result.accuracy_5d = totalTested5d > 0 ? Math.round((totalCorrect5d / totalTested5d) * 1000) / 10 : 0;
    result.accuracy_10d = totalTested10d > 0 ? Math.round((totalCorrect10d / totalTested10d) * 1000) / 10 : 0;
    result.accuracy_20d = totalTested20d > 0 ? Math.round((totalCorrect20d / totalTested20d) * 1000) / 10 : 0;

    // Convert sector stats to accuracy %
    for (const [sector, stats] of Object.entries(result.by_sector)) {
      (result.by_sector as Record<string, number>)[sector] = stats.total > 0
        ? Math.round((stats.correct / stats.total) * 1000) / 10
        : 0;
    }

    // Score correlations
    result.avg_quality_score_correct = totalCorrect5d > 0 ? Math.round(sumQualityCorrect / totalCorrect5d * 10) / 10 : 0;
    result.avg_quality_score_incorrect = (totalTested5d - totalCorrect5d) > 0
      ? Math.round(sumQualityIncorrect / (totalTested5d - totalCorrect5d) * 10) / 10 : 0;
    result.avg_momentum_score_correct = totalCorrect5d > 0 ? Math.round(sumMomentumCorrect / totalCorrect5d * 10) / 10 : 0;
    result.avg_momentum_score_incorrect = (totalTested5d - totalCorrect5d) > 0
      ? Math.round(sumMomentumIncorrect / (totalTested5d - totalCorrect5d) * 10) / 10 : 0;

    return result;
  } finally {
    db.close();
  }
}

// ==================== WEIGHT AUTO-TUNING ====================

/**
 * Analyze accuracy and suggest/compute weight adjustments.
 * Uses the feedback data to identify which parameters need tuning.
 */
function computeWeightAdjustments(accuracy: AccuracySummary): WeightAdjustment[] {
  const adjustments: WeightAdjustment[] = [];

  // Check if we have enough data
  const minPredictions = getWeight('feedback_min_predictions', 30);
  if (accuracy.total_validated < minPredictions) {
    return adjustments;
  }

  const targetAccuracy = getWeight('feedback_direction_accuracy_target', 55);
  const boostFactor = getWeight('feedback_boost_factor', 0.05);
  const decayFactor = getWeight('feedback_decay_factor', 0.03);
  const maxAdj = getWeight('feedback_max_weight_adjustment', 15) / 100;

  // Analyze quality vs momentum contribution
  const h5d = accuracy.horizon_5d;
  if (!h5d) return adjustments;

  // If quality score correlates with accuracy → boost quality weights
  if (h5d.avg_score_correct > h5d.avg_score_incorrect + 5) {
    // Quality is discriminating well → boost quality weight
    const qualWeight = getWeight('weight_profitability', 0.25);
    const newQualWeight = Math.min(qualWeight * (1 + boostFactor), qualWeight * (1 + maxAdj));
    adjustments.push({
      parameter_name: 'weight_profitability',
      old_value: qualWeight,
      new_value: Math.round(newQualWeight * 1000) / 1000,
      reason: `جودة النموذج تتنبأ بدقة (متوسط نقاط الصحيح: ${h5d.avg_score_correct} مقابل غير الصحيح: ${h5d.avg_score_incorrect}) — زيادة وزن الربحية`,
      accuracy_impact: `${h5d.avg_score_correct - h5d.avg_score_incorrect} نقطة فرق`,
    });
  } else if (h5d.avg_score_correct < h5d.avg_score_incorrect - 3) {
    // Quality is NOT discriminating → slightly reduce, boost momentum
    const qualWeight = getWeight('weight_profitability', 0.25);
    const newQualWeight = Math.max(qualWeight * (1 - decayFactor), qualWeight * (1 - maxAdj));
    adjustments.push({
      parameter_name: 'weight_profitability',
      old_value: qualWeight,
      new_value: Math.round(newQualWeight * 1000) / 1000,
      reason: `جودة النموذج لا تتنبأ بدقة (فرق سلبي) — تخفيض طفيف لوزن الربحية`,
      accuracy_impact: `${h5d.avg_score_correct - h5d.avg_score_incorrect} نقطة فرق`,
    });
  }

  // Momentum score analysis
  if (h5d.avg_score_correct > h5d.avg_score_incorrect + 3) {
    const momWeight = getWeight('weight_growth', 0.20);
    const newMomWeight = Math.min(momWeight * (1 + boostFactor * 0.5), momWeight * (1 + maxAdj));
    adjustments.push({
      parameter_name: 'weight_growth',
      old_value: momWeight,
      new_value: Math.round(newMomWeight * 1000) / 1000,
      reason: `الزخم يساهم في التنبؤ الدقيق — زيادة طفيفة لوزن النمو`,
      accuracy_impact: `زخم إيجابي`,
    });
  }

  // Regime-specific adjustments
  const bullAcc = h5d.by_regime.bull;
  const bearAcc = h5d.by_regime.bear;
  const neutralAcc = h5d.by_regime.neutral;

  if (bullAcc && bullAcc.accuracy < targetAccuracy - 10) {
    const mult = getWeight('regime_bull_multiplier', 1.3);
    const newMult = Math.max(mult * (1 - decayFactor), 1.0);
    adjustments.push({
      parameter_name: 'regime_bull_multiplier',
      old_value: mult,
      new_value: Math.round(newMult * 1000) / 1000,
      reason: `دقة التحليلات في السوق الصاعد ضعيفة (${bullAcc.accuracy}%) — تخفيض معامل الثقة`,
      accuracy_impact: `دقة سوق صاعد: ${bullAcc.accuracy}%`,
    });
  }

  if (bearAcc && bearAcc.accuracy < targetAccuracy - 10) {
    const mult = getWeight('regime_bear_multiplier', 0.7);
    const newMult = Math.max(mult * (1 - decayFactor), 0.5);
    adjustments.push({
      parameter_name: 'regime_bear_multiplier',
      old_value: mult,
      new_value: Math.round(newMult * 1000) / 1000,
      reason: `دقة التحليلات في السوق الهابط ضعيفة (${bearAcc.accuracy}%) — تعديل المعامل`,
      accuracy_impact: `دقة سوق هابط: ${bearAcc.accuracy}%`,
    });
  }

  // Recommendation threshold adjustments
  const strongBuyAcc = h5d.by_recommendation['Strong Buy'];
  const buyAcc = h5d.by_recommendation['Buy'];

  if (strongBuyAcc && strongBuyAcc.accuracy < 50) {
    const threshold = getWeight('strong_buy_threshold', 65);
    const newThreshold = Math.min(threshold + 2, 85);
    adjustments.push({
      parameter_name: 'strong_buy_threshold',
      old_value: threshold,
      new_value: newThreshold,
      reason: `دقة تحليل "شراء قوي" منخفضة (${strongBuyAcc.accuracy}%) — رفع الحد الأدنى`,
      accuracy_impact: `دقة شراء قوي: ${strongBuyAcc.accuracy}%`,
    });
  }

  if (buyAcc && buyAcc.accuracy > 65) {
    const threshold = getWeight('buy_threshold', 52);
    const newThreshold = Math.max(threshold - 1, 40);
    adjustments.push({
      parameter_name: 'buy_threshold',
      old_value: threshold,
      new_value: newThreshold,
      reason: `دقة تحليل "شراء" جيدة (${buyAcc.accuracy}%) — خفض الحد الأدنى لزيادة الفرص`,
      accuracy_impact: `دقة شراء: ${buyAcc.accuracy}%`,
    });
  }

  return adjustments;
}

/**
 * Apply weight adjustments to the database.
 */
function applyWeightAdjustments(adjustments: WeightAdjustment[]): number {
  if (adjustments.length === 0) return 0;

  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');
    let applied = 0;

    for (const adj of adjustments) {
      // Use the existing updateWeight logic with circuit breaker
      const current = db.prepare('SELECT current_value, min_bound, max_bound FROM calculation_weights WHERE parameter_name = ?')
        .get(adj.parameter_name) as { current_value: number; min_bound: number | null; max_bound: number | null } | undefined;

      if (!current) continue;

      const maxAdjPct = getWeight('feedback_max_weight_adjustment', 15) / 100;
      const maxAllowed = current.current_value * (1 + maxAdjPct);
      const minAllowed = current.current_value * (1 - maxAdjPct);

      const clampedValue = Math.max(minAllowed, Math.min(maxAllowed, adj.new_value));

      // Also respect bounds
      let finalValue = clampedValue;
      if (current.min_bound !== null && finalValue < current.min_bound) continue;
      if (current.max_bound !== null && finalValue > current.max_bound) continue;

      if (Math.abs(finalValue - current.current_value) < 0.0001) continue; // Too small

      db.prepare(`
        UPDATE calculation_weights 
        SET current_value = ?, updated_at = datetime('now'), updated_by = 'auto_feedback'
        WHERE parameter_name = ?
      `).run(finalValue, adj.parameter_name);

      db.prepare(`
        INSERT INTO weight_adjustment_logs (
          parameter_name, old_value, new_value, requested_value,
          adjustment_reason, adjusted_by, created_at
        ) VALUES (?, ?, ?, ?, ?, 'auto_feedback', datetime('now'))
      `).run(
        adj.parameter_name,
        current.current_value,
        finalValue,
        adj.new_value,
        adj.reason,
      );

      applied++;
    }

    // Invalidate config cache
    clearCache();

    return applied;
  } finally {
    db.close();
  }
}

// ==================== SAVE ACCURACY SUMMARY ====================

function saveAccuracySummary(accuracy: AccuracySummary, modelVersion: string): void {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');
    const now = new Date().toISOString();

    for (const [horizon, data] of [
      ['5d', accuracy.horizon_5d],
      ['10d', accuracy.horizon_10d],
      ['20d', accuracy.horizon_20d],
    ] as const) {
      if (!data) continue;

      db.prepare(`
        INSERT INTO feedback_accuracy_summary (
          evaluated_at, model_version, time_horizon,
          total_predictions, direction_correct, direction_accuracy,
          avg_price_error, median_price_error,
          buy_signal_accuracy, sell_signal_accuracy, strong_buy_accuracy, hold_accuracy,
          target_reached_count, stop_hit_count,
          avg_composite_score_correct, avg_composite_score_incorrect,
          regime_bull_accuracy, regime_bear_accuracy, regime_neutral_accuracy,
          details, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        now, modelVersion, horizon,
        data.total, data.direction_correct, data.direction_accuracy,
        data.avg_price_error, data.avg_price_error,
        data.by_recommendation['Buy']?.accuracy || 0,
        Math.round(((data.by_recommendation['Avoid']?.accuracy || 0) + (data.by_recommendation['Strong Avoid']?.accuracy || 0)) / 2),
        data.by_recommendation['Strong Buy']?.accuracy || 0,
        data.by_recommendation['Hold']?.accuracy || 0,
        data.target_reached_count, data.stop_hit_count,
        data.avg_score_correct, data.avg_score_incorrect,
        data.by_regime.bull?.accuracy || 0,
        data.by_regime.bear?.accuracy || 0,
        data.by_regime.neutral?.accuracy || 0,
        JSON.stringify({ by_recommendation: data.by_recommendation, by_regime: data.by_regime }),
        now,
      );
    }
  } finally {
    db.close();
  }
}

// ==================== MAIN FEEDBACK RUN ====================

/**
 * Run the complete feedback loop:
 * 1. Validate existing unvalidated predictions
 * 2. Calculate accuracy metrics
 * 3. Compute weight adjustments
 * 4. Apply adjustments (if enabled)
 * 5. Save accuracy summary
 */
export function runFeedbackLoop(runBacktest: boolean = false): FeedbackRunResult {
  const result: FeedbackRunResult = {
    success: true,
    timestamp: new Date().toISOString(),
    predictions_validated: 0,
    accuracy_summary: {
      horizon_5d: null,
      horizon_10d: null,
      horizon_20d: null,
      overall_direction_accuracy: 0,
      overall_avg_price_error: 0,
      total_validated: 0,
    },
    weight_adjustments: [],
    backtest_results: null,
    model_accuracy: {
      overall: 0,
      fundamental: 0,
      technical: 0,
      predictions_validated: 0,
      last_evaluated: null,
    },
    message: '',
  };

  try {
    // Step 1: Validate existing predictions
    result.predictions_validated = validateExistingPredictions();

    // Step 2: Run backtest if requested
    if (runBacktest) {
      const backtestDays = getWeight('feedback_backtest_days', 60);
      result.backtest_results = runHistoricalBacktest(backtestDays);
      result.message += `Backtest: ${result.backtest_results.total_predictions_generated} predictions across ${result.backtest_results.total_stocks_tested} stocks. `;
    }

    // Step 3: Calculate accuracy
    result.accuracy_summary = calculateAccuracyMetrics();

    // Step 4: Compute weight adjustments
    const feedbackEnabled = getWeight('feedback_enabled', 1);
    if (feedbackEnabled) {
      result.weight_adjustments = computeWeightAdjustments(result.accuracy_summary);

      // Step 5: Apply adjustments
      if (result.weight_adjustments.length > 0) {
        const applied = applyWeightAdjustments(result.weight_adjustments);
        result.message += `Applied ${applied}/${result.weight_adjustments.length} weight adjustments. `;
      } else {
        result.message += 'No weight adjustments needed. ';
      }
    }

    // Step 6: Save accuracy summary
    saveAccuracySummary(result.accuracy_summary, '2.0.0');

    // Update model accuracy for admin display
    result.model_accuracy = {
      overall: result.accuracy_summary.overall_direction_accuracy,
      fundamental: result.accuracy_summary.horizon_5d?.avg_score_correct || 0,
      technical: result.accuracy_summary.horizon_10d?.avg_score_correct || 0,
      predictions_validated: result.accuracy_summary.total_validated,
      last_evaluated: result.timestamp,
    };

    result.message += `Validated ${result.predictions_validated} predictions. Overall accuracy: ${result.accuracy_summary.overall_direction_accuracy}%.`;

    return result;
  } catch (err) {
    result.success = false;
    result.message = `Feedback loop error: ${String(err)}`;
    return result;
  }
}

/**
 * Get the current model accuracy status (for admin display).
 */
export function getModelAccuracy(): ModelAccuracy {
  const db = getReadDb();
  try {
    const last = db.prepare(`
      SELECT * FROM feedback_accuracy_summary 
      WHERE time_horizon = '5d'
      ORDER BY evaluated_at DESC LIMIT 1
    `).get() as Record<string, unknown> | undefined;

    if (!last) {
      return {
        overall: 0,
        fundamental: 0,
        technical: 0,
        predictions_validated: 0,
        last_evaluated: null,
      };
    }

    return {
      overall: Number(last.direction_accuracy) || 0,
      fundamental: Number(last.avg_composite_score_correct) || 0,
      technical: Number(last.regime_bull_accuracy) || 0,
      predictions_validated: Number(last.total_predictions) || 0,
      last_evaluated: String(last.evaluated_at) || null,
    };
  } finally {
    db.close();
  }
}
