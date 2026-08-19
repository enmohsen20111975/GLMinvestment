/**
 * نظام التحقق من التوقعات
 * Prediction Verification Engine for دليل الاستثمار
 * 
 * هذا النظام يقوم بـ:
 * 1. تسجيل التوقعات اليومية
 * 2. التحقق من التوقعات السابقة
 * 3. حساب دقة كل نوع توقعة
 * 4. تحديث درجات الثقة للمؤشرات
 */

import { createDatabase, isInitialized, type SqliteDatabase } from '@/lib/sqlite-wrapper';
import * as path from 'path';
import { existsSync } from 'fs';
import { getWeight, setWeight } from './config-service';

// ==================== TYPES ====================

export interface PredictionRecord {
  id?: number;
  ticker: string;
  stock_name: string;
  prediction_date: string;
  recommendation: 'Strong Buy' | 'Buy' | 'Hold' | 'Avoid' | 'Strong Avoid';
  composite_score: number;
  entry_price: number;
  target_price: number;
  stop_loss: number;
  confidence: number;
  indicators_used: string[];
  market_regime: string;
  
  // نتائج التحقق (تُملأ لاحقاً)
  verification_date?: string;
  actual_price?: number;
  price_change_percent?: number;
  hit_target?: boolean;
  hit_stop_loss?: boolean;
  outcome?: 'profit' | 'loss' | 'neutral';
  profit_percent?: number;
  holding_days?: number;
  verified?: boolean;
}

export interface VerificationResult {
  ticker: string;
  prediction_date: string;
  recommendation: string;
  entry_price: number;
  actual_price: number;
  price_change_percent: number;
  outcome: 'profit' | 'loss' | 'neutral';
  hit_target: boolean;
  hit_stop_loss: boolean;
  days_to_verify: number;
}

export interface VerificationSummary {
  total_predictions: number;
  verified_predictions: number;
  pending_predictions: number;
  
  // نتائج حسب نوع التوقعة
  strong_buy_results: RecommendationResult;
  buy_results: RecommendationResult;
  hold_results: RecommendationResult;
  avoid_results: RecommendationResult;
  
  // نتائج حسب المؤشر
  indicator_results: Map<string, RecommendationResult>;
  
  // دقة النظام الإجمالية
  overall_accuracy: number;
  
  // دقة حسب فترة التحقق
  accuracy_7_days: number;
  accuracy_14_days: number;
  accuracy_30_days: number;
}

export interface RecommendationResult {
  total: number;
  correct: number;
  incorrect: number;
  accuracy: number;
  avg_profit_percent: number;
  avg_loss_percent: number;
  expectancy: number;
}

// ==================== DATABASE ACCESS ====================

function getDb(): SqliteDatabase {
  if (!isInitialized()) {
    throw new Error('sql.js not initialized');
  }
  // توحيد قواعد البيانات: prediction_logs اترحّل لـ predictions.db
  // (مش stocks.db زي ما كان قبل التوحيد)
  const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
  if (!existsSync(dbPath)) {
    throw new Error(`Predictions DB not found: ${dbPath}`);
  }
  return createDatabase(dbPath);
}

function getWritableDb(): SqliteDatabase {
  if (!isInitialized()) {
    throw new Error('sql.js not initialized');
  }
  // توحيد قواعد البيانات: prediction_logs اترحّل لـ predictions.db
  const dbPath = path.join(process.cwd(), 'db', 'predictions.db');
  return createDatabase(dbPath);
}

// ==================== PREDICTION TABLE MANAGEMENT ====================

/**
 * التأكد من وجود جدول التوقعات
 */
export function ensurePredictionTable(): void {
  const db = getWritableDb();
  try {
    db.pragma('journal_mode = WAL');
    
    db.run(`
      CREATE TABLE IF NOT EXISTS prediction_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        stock_name TEXT NOT NULL,
        prediction_date TEXT NOT NULL,
        recommendation TEXT NOT NULL,
        composite_score REAL NOT NULL,
        entry_price REAL NOT NULL,
        target_price REAL,
        stop_loss REAL,
        confidence REAL,
        indicators_used TEXT DEFAULT '[]',
        market_regime TEXT DEFAULT 'neutral',
        
        -- نتائج التحقق
        verification_date TEXT,
        actual_price REAL,
        price_change_percent REAL,
        hit_target INTEGER DEFAULT 0,
        hit_stop_loss INTEGER DEFAULT 0,
        outcome TEXT,
        profit_percent REAL,
        holding_days INTEGER,
        verified INTEGER DEFAULT 0,
        
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);
    
    db.run(`CREATE INDEX IF NOT EXISTS idx_prediction_ticker ON prediction_logs(ticker)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_prediction_date ON prediction_logs(prediction_date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_prediction_verified ON prediction_logs(verified)`);
    
  } finally {
    db.close();
  }
}

// ==================== LOG PREDICTIONS ====================

/**
 * تسجيل توقعات جديدة
 */
export function logPredictions(predictions: Omit<PredictionRecord, 'id'>[]): number[] {
  const db = getWritableDb();
  try {
    db.pragma('journal_mode = WAL');
    
    const ids: number[] = [];
    
    for (const pred of predictions) {
      const result = db.prepare(`
        INSERT INTO prediction_logs (
          ticker, stock_name, prediction_date, recommendation, composite_score,
          entry_price, target_price, stop_loss, confidence, indicators_used, market_regime
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        pred.ticker,
        pred.stock_name,
        pred.prediction_date,
        pred.recommendation,
        pred.composite_score,
        pred.entry_price,
        pred.target_price || null,
        pred.stop_loss || null,
        pred.confidence || 50,
        JSON.stringify(pred.indicators_used || []),
        pred.market_regime || 'neutral'
      );
      
      ids.push(result.lastInsertRowid as number);
    }
    
    console.log(`[Verification] Logged ${predictions.length} predictions`);
    return ids;
  } finally {
    db.close();
  }
}

/**
 * تسجيل توقعات من تحليلات
 */
export function logPredictionsFromRecommendations(
  recommendations: Array<{
    ticker: string;
    name: string;
    recommendation: string;
    compositeScore: number;
    currentPrice: number;
    exitStrategy?: { targetPrice: number; stopLoss: number };
    confidence?: number;
    marketRegime?: string;
  }>,
  predictionDate: string = new Date().toISOString().split('T')[0]
): number[] {
  const predictions: Omit<PredictionRecord, 'id'>[] = recommendations
    .filter(r => r.recommendation === 'Strong Buy' || r.recommendation === 'Buy' || r.recommendation === 'Hold')
    .map(r => ({
      ticker: r.ticker,
      stock_name: r.name,
      prediction_date: predictionDate,
      recommendation: r.recommendation as 'Strong Buy' | 'Buy' | 'Hold',
      composite_score: r.compositeScore,
      entry_price: r.currentPrice,
      target_price: r.exitStrategy?.targetPrice || r.currentPrice * 1.15,
      stop_loss: r.exitStrategy?.stopLoss || r.currentPrice * 0.92,
      confidence: r.confidence || 50,
      indicators_used: ['RSI', 'MACD', 'MA', 'Bollinger', 'Volume'],
      market_regime: r.marketRegime || 'neutral',
    }));
  
  return logPredictions(predictions);
}

// ==================== VERIFY PREDICTIONS ====================

/**
 * التحقق من التوقعات غير المُحققة
 */
export function verifyPendingPredictions(
  daysToVerify: number = 14
): VerificationResult[] {
  // أمان: تأكد إن daysToVerify عدد صحيح موجب (منع SQL injection)
  if (!Number.isInteger(daysToVerify) || daysToVerify <= 0 || daysToVerify > 365) {
    throw new Error(`Invalid daysToVerify: ${daysToVerify}. Must be integer 1-365.`);
  }

  const db = getWritableDb();
  try {
    db.pragma('journal_mode = WAL');

    // الحصول على التوقعات غير المُحققة (parameterized query — آمن من SQL injection)
    const pending = db.prepare(`
      SELECT * FROM prediction_logs
      WHERE verified = 0
      AND date(prediction_date) <= date('now', ?)
      AND recommendation IN ('Strong Buy', 'Buy', 'Hold')
    `).all(`-${daysToVerify} days`) as PredictionRecord[];
    
    const results: VerificationResult[] = [];
    
    for (const pred of pending) {
      // الحصول على السعر الفعلي بعد X يوم
      const actualPrice = getStockPriceAfterDays(db, pred.ticker, pred.prediction_date, daysToVerify);
      
      if (!actualPrice) continue;
      
      const priceChangePercent = ((actualPrice - pred.entry_price) / pred.entry_price) * 100;
      
      let outcome: 'profit' | 'loss' | 'neutral';
      if (priceChangePercent > 2) {
        outcome = 'profit';
      } else if (priceChangePercent < -2) {
        outcome = 'loss';
      } else {
        outcome = 'neutral';
      }
      
      const hitTarget = pred.target_price ? actualPrice >= pred.target_price : false;
      const hitStopLoss = pred.stop_loss ? actualPrice <= pred.stop_loss : false;
      
      // تحديث السجل
      db.prepare(`
        UPDATE prediction_logs SET
          verification_date = date('now'),
          actual_price = ?,
          price_change_percent = ?,
          hit_target = ?,
          hit_stop_loss = ?,
          outcome = ?,
          profit_percent = ?,
          holding_days = ?,
          verified = 1,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        actualPrice,
        priceChangePercent,
        hitTarget ? 1 : 0,
        hitStopLoss ? 1 : 0,
        outcome,
        priceChangePercent,
        daysToVerify,
        pred.id
      );
      
      results.push({
        ticker: pred.ticker,
        prediction_date: pred.prediction_date,
        recommendation: pred.recommendation,
        entry_price: pred.entry_price,
        actual_price: actualPrice,
        price_change_percent: priceChangePercent,
        outcome,
        hit_target: hitTarget,
        hit_stop_loss: hitStopLoss,
        days_to_verify: daysToVerify,
      });
      
      // تحديث درجات الثقة للمؤشرات
      if (pred.indicators_used) {
        updateIndicatorScoresFromVerification(
          JSON.parse(pred.indicators_used as unknown as string),
          outcome === 'profit',
          priceChangePercent
        );
      }
    }
    
    console.log(`[Verification] Verified ${results.length} predictions`);
    return results;
  } finally {
    db.close();
  }
}

/**
 * الحصول على سعر السهم بعد عدد أيام
 */
function getStockPriceAfterDays(
  db: SqliteDatabase,
  ticker: string,
  startDate: string,
  days: number
): number | null {
  const targetDate = new Date(startDate);
  targetDate.setDate(targetDate.getDate() + days);
  const targetDateStr = targetDate.toISOString().split('T')[0];
  
  const row = db.prepare(`
    SELECT sph.close_price
    FROM stock_price_history sph
    JOIN stocks s ON s.id = sph.stock_id
    WHERE s.ticker = ? AND sph.date >= ?
    ORDER BY sph.date ASC
    LIMIT 1
  `).get(ticker, targetDateStr) as { close_price: number } | undefined;
  
  return row ? row.close_price : null;
}

/**
 * تحديث درجات المؤشرات من التحقق
 */
function updateIndicatorScoresFromVerification(
  indicators: string[],
  isProfit: boolean,
  profitPercent: number
): void {
  const db = getWritableDb();
  try {
    db.pragma('journal_mode = WAL');
    
    for (const indicator of indicators) {
      const current = db.prepare(`
        SELECT * FROM indicator_trust_scores WHERE indicator_name = ?
      `).get(indicator) as Record<string, unknown> | undefined;
      
      if (!current) {
        // إنشاء سجل جديد
        db.prepare(`
          INSERT INTO indicator_trust_scores (indicator_name, current_score, total_signals, successful_signals, failed_signals)
          VALUES (?, 100, 1, ?, ?)
        `).run(indicator, isProfit ? 1 : 0, isProfit ? 0 : 1);
      } else {
        // تحديث السجل الحالي
        const scoreChange = isProfit 
          ? Math.min(profitPercent * 0.5, 10)  // +10 max
          : Math.max(profitPercent * 0.5, -15); // -15 max
        
        const newScore = Math.max(0, Math.min(200, 
          (current.current_score as number) + scoreChange
        ));
        
        db.prepare(`
          UPDATE indicator_trust_scores SET
            current_score = ?,
            total_signals = total_signals + 1,
            successful_signals = successful_signals + ?,
            failed_signals = failed_signals + ?,
            last_updated = datetime('now')
          WHERE indicator_name = ?
        `).run(
          newScore,
          isProfit ? 1 : 0,
          isProfit ? 0 : 1,
          indicator
        );
      }
    }
  } finally {
    db.close();
  }
}

// ==================== GET VERIFICATION SUMMARY ====================

/**
 * الحصول على ملخص التحقق
 */
export function getVerificationSummary(): VerificationSummary {
  const db = getDb();
  try {
    // إحصائيات عامة
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN verified = 1 THEN 1 ELSE 0 END) as verified,
        SUM(CASE WHEN verified = 0 THEN 1 ELSE 0 END) as pending
      FROM prediction_logs
    `).get() as { total: number; verified: number; pending: number };
    
    // نتائج حسب نوع التوقعة
    const strongBuyResults = getResultsByRecommendation(db, 'Strong Buy');
    const buyResults = getResultsByRecommendation(db, 'Buy');
    const holdResults = getResultsByRecommendation(db, 'Hold');
    const avoidResults = getResultsByRecommendation(db, 'Avoid');
    
    // الدقة الإجمالية
    const allVerified = db.prepare(`
      SELECT
        SUM(CASE WHEN outcome = 'profit' THEN 1 ELSE 0 END) as profits,
        COUNT(*) as total
      FROM prediction_logs
      WHERE verified = 1 AND outcome IS NOT NULL
    `).get() as { profits: number; total: number };
    
    const overallAccuracy = allVerified.total > 0 
      ? (allVerified.profits / allVerified.total) * 100 
      : 0;
    
    // دقة حسب فترة التحقق
    const accuracy7Days = getAccuracyByDays(db, 7);
    const accuracy14Days = getAccuracyByDays(db, 14);
    const accuracy30Days = getAccuracyByDays(db, 30);
    
    // نتائج حسب المؤشر
    const indicatorResults = getResultsByIndicator(db);
    
    return {
      total_predictions: stats.total,
      verified_predictions: stats.verified,
      pending_predictions: stats.pending,
      strong_buy_results: strongBuyResults,
      buy_results: buyResults,
      hold_results: holdResults,
      avoid_results: avoidResults,
      indicator_results: indicatorResults,
      overall_accuracy: Math.round(overallAccuracy * 100) / 100,
      accuracy_7_days: Math.round(accuracy7Days * 100) / 100,
      accuracy_14_days: Math.round(accuracy14Days * 100) / 100,
      accuracy_30_days: Math.round(accuracy30Days * 100) / 100,
    };
  } finally {
    db.close();
  }
}

function getResultsByRecommendation(
  db: SqliteDatabase,
  recommendation: string
): RecommendationResult {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN outcome = 'profit' THEN 1 ELSE 0 END) as correct,
      SUM(CASE WHEN outcome != 'profit' THEN 1 ELSE 0 END) as incorrect,
      AVG(CASE WHEN outcome = 'profit' THEN profit_percent END) as avg_profit,
      AVG(CASE WHEN outcome != 'profit' THEN ABS(profit_percent) END) as avg_loss
    FROM prediction_logs
    WHERE verified = 1 AND recommendation = ?
  `).get(recommendation) as {
    total: number;
    correct: number;
    incorrect: number;
    avg_profit: number | null;
    avg_loss: number | null;
  };
  
  const total = stats.total || 0;
  const correct = stats.correct || 0;
  const incorrect = stats.incorrect || 0;
  const accuracy = total > 0 ? (correct / total) * 100 : 0;
  const avgProfit = stats.avg_profit || 0;
  const avgLoss = stats.avg_loss || 0;
  
  // Expectancy = (Accuracy × Avg Profit) - ((1 - Accuracy) × Avg Loss)
  const expectancy = (accuracy / 100 * avgProfit) - ((1 - accuracy / 100) * avgLoss);
  
  return {
    total,
    correct,
    incorrect,
    accuracy: Math.round(accuracy * 100) / 100,
    avg_profit_percent: Math.round(avgProfit * 100) / 100,
    avg_loss_percent: Math.round(avgLoss * 100) / 100,
    expectancy: Math.round(expectancy * 100) / 100,
  };
}

function getAccuracyByDays(db: SqliteDatabase, days: number): number {
  const stats = db.prepare(`
    SELECT
      SUM(CASE WHEN outcome = 'profit' THEN 1 ELSE 0 END) as profits,
      COUNT(*) as total
    FROM prediction_logs
    WHERE verified = 1
    AND holding_days = ?
    AND outcome IS NOT NULL
  `).get(days) as { profits: number; total: number };
  
  return stats.total > 0 ? (stats.profits / stats.total) * 100 : 0;
}

function getResultsByIndicator(db: SqliteDatabase): Map<string, RecommendationResult> {
  const results = new Map<string, RecommendationResult>();
  
  // الحصول على جميع التوقعات مع المؤشرات
  const predictions = db.prepare(`
    SELECT indicators_used, outcome, profit_percent
    FROM prediction_logs
    WHERE verified = 1 AND indicators_used IS NOT NULL
  `).all() as Array<{ indicators_used: string; outcome: string; profit_percent: number }>;
  
  const indicatorStats = new Map<string, { wins: number; losses: number; returns: number }>();
  
  for (const pred of predictions) {
    try {
      const indicators = JSON.parse(pred.indicators_used) as string[];
      
      for (const indicator of indicators) {
        const current = indicatorStats.get(indicator) || { wins: 0, losses: 0, returns: 0 };
        
        if (pred.outcome === 'profit') {
          current.wins++;
        } else {
          current.losses++;
        }
        current.returns += pred.profit_percent || 0;
        
        indicatorStats.set(indicator, current);
      }
    } catch {
      // تجاهل أخطاء JSON
    }
  }
  
  for (const [indicator, stats] of indicatorStats) {
    const total = stats.wins + stats.losses;
    const accuracy = total > 0 ? (stats.wins / total) * 100 : 0;
    const avgReturn = total > 0 ? stats.returns / total : 0;
    
    results.set(indicator, {
      total,
      correct: stats.wins,
      incorrect: stats.losses,
      accuracy: Math.round(accuracy * 100) / 100,
      avg_profit_percent: Math.round(avgReturn * 100) / 100,
      avg_loss_percent: 0,
      expectancy: Math.round(avgReturn * 100) / 100,
    });
  }
  
  return results;
}

// ==================== AUTO-ADJUST WEIGHTS ====================

/**
 * تعديل الأوزان تلقائياً بناءً على دقة المؤشرات
 */
export function autoAdjustWeights(): { indicator: string; oldWeight: number; newWeight: number }[] {
  const db = getDb();
  const adjustments: { indicator: string; oldWeight: number; newWeight: number }[] = [];
  
  try {
    // الحصول على درجات المؤشرات
    const scores = db.prepare(`
      SELECT indicator_name, current_score, total_signals, successful_signals
      FROM indicator_trust_scores
      WHERE total_signals >= 5
    `).all() as Array<{
      indicator_name: string;
      current_score: number;
      total_signals: number;
      successful_signals: number;
    }>;
    
    for (const score of scores) {
      const winRate = score.successful_signals / score.total_signals;
      const weightKey = `${score.indicator_name.toLowerCase()}_weight`;
      
      try {
        const oldWeight = getWeight(weightKey, 1.0);
        let newWeight = oldWeight;
        
        // تعديل الوزن بناءً على معدل النجاح
        if (winRate >= 0.65) {
          // مؤشر قوي - زيادة الوزن
          newWeight = Math.min(2.0, oldWeight * 1.1);
        } else if (winRate >= 0.50) {
          // مؤشر متوسط - الحفاظ على الوزن
          newWeight = oldWeight;
        } else if (winRate >= 0.40) {
          // مؤشر ضعيف - تقليل الوزن
          newWeight = Math.max(0.5, oldWeight * 0.9);
        } else {
          // مؤشر سيء - تقليل كبير
          newWeight = Math.max(0.1, oldWeight * 0.7);
        }
        
        // تطبيق الوزن الجديد
        if (newWeight !== oldWeight) {
          setWeight(weightKey, newWeight);
          adjustments.push({
            indicator: score.indicator_name,
            oldWeight: Math.round(oldWeight * 100) / 100,
            newWeight: Math.round(newWeight * 100) / 100,
          });
        }
      } catch {
        // الوزن غير موجود في الإعدادات
      }
    }
    
    console.log(`[Verification] Applied ${adjustments.length} weight adjustments`);
    return adjustments;
  } finally {
    db.close();
  }
}

// ==================== CLEANUP OLD PREDICTIONS ====================

/**
 * حذف التوقعات القديمة (أكثر من 90 يوم)
 */
export function cleanupOldPredictions(): number {
  const db = getWritableDb();
  try {
    db.pragma('journal_mode = WAL');
    
    const result = db.prepare(`
      DELETE FROM prediction_logs
      WHERE prediction_date < date('now', '-90 days')
      AND verified = 1
    `).run();
    
    const deleted = result.changes;
    console.log(`[Verification] Cleaned up ${deleted} old predictions`);
    return deleted;
  } finally {
    db.close();
  }
}
/**
 * نظام التحقق من التوقعات
 * Prediction Verification Engine for دليل الاستثمار
 * 
 * هذا النظام يقوم بـ:
 * 1. تسجيل التوقعات اليومية
 * 2. التحقق من التوقعات السابقة
 * 3. حساب دقة كل نوع توقعة
 * 4. تحديث درجات الثقة للمؤشرات
 */

