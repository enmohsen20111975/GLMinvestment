/**
 * Iterative Learning Engine - محرك التعلم التكراري
 * 
 * الهدف: تحسين نسبة النجاح من 60% إلى 99%
 * الطريقة:
 * 1. تشغيل Backtest على بيانات تاريخية
 * 2. تحليل النتائج واستخراج الأخطاء
 * 3. تعديل البارامترات
 * 4. إعادة الاختبار
 * 5. تكرار حتى الوصول للهدف
 */

import { runBacktest, type BacktestConfig, type BacktestResult, type BacktestTrade } from './backtesting-engine';

// ==================== TYPES ====================

export interface LearningParameters {
  // RSI Parameters
  rsi_oversold: number;        // default: 30
  rsi_overbought: number;      // default: 70
  rsi_weight: number;          // default: 15

  // MACD Parameters
  macd_weight: number;         // default: 10

  // Moving Averages
  ma_weight: number;           // default: 12

  // Bollinger
  bollinger_std: number;       // default: 2
  bollinger_weight: number;    // default: 8

  // Risk Management
  stop_loss_min: number;       // default: 3%
  stop_loss_max: number;       // default: 8%
  target_multiplier: number;   // default: 2

  // Entry Conditions
  confidence_threshold: number; // default: 55
  min_indicators_agree: number; // default: 2

  // Volume
  volume_threshold: number;    // default: 1.5
  volume_weight: number;       // default: 5
}

export interface LearningIteration {
  iteration: number;
  parameters: LearningParameters;
  result: BacktestResult;
  changes: string[];
  timestamp: string;
}

export interface LearningProgress {
  target_win_rate: number;
  current_win_rate: number;
  iterations: LearningIteration[];
  best_parameters: LearningParameters;
  best_win_rate: number;
  total_trades_analyzed: number;
  status: 'running' | 'completed' | 'failed' | 'idle';
  started_at: string;
  completed_at?: string;
}

export interface ParameterAdjustment {
  parameter: keyof LearningParameters;
  oldValue: number;
  newValue: number;
  reason: string;
  expectedImpact: 'increase_win_rate' | 'reduce_losses' | 'improve_timing';
}

// ==================== DEFAULT PARAMETERS ====================

export const DEFAULT_PARAMETERS: LearningParameters = {
  rsi_oversold: 30,
  rsi_overbought: 70,
  rsi_weight: 15,
  macd_weight: 10,
  ma_weight: 12,
  bollinger_std: 2,
  bollinger_weight: 8,
  stop_loss_min: 3,
  stop_loss_max: 8,
  target_multiplier: 2,
  confidence_threshold: 55,
  min_indicators_agree: 2,
  volume_threshold: 1.5,
  volume_weight: 5
};

// ==================== ITERATIVE LEARNING ENGINE ====================

let currentProgress: LearningProgress | null = null;
let shouldStop = false;

/**
 * تشغيل التعلم التكراري
 */
export async function startIterativeLearning(
  targetWinRate: number = 99,
  maxIterations: number = 50,
  config: Partial<BacktestConfig> = {}
): Promise<LearningProgress> {
  console.log(`[IterativeLearning] Starting with target: ${targetWinRate}%`);

  shouldStop = false;

  currentProgress = {
    target_win_rate: targetWinRate,
    current_win_rate: 0,
    iterations: [],
    best_parameters: { ...DEFAULT_PARAMETERS },
    best_win_rate: 0,
    total_trades_analyzed: 0,
    status: 'running',
    started_at: new Date().toISOString()
  };

  let currentParams = { ...DEFAULT_PARAMETERS };
  let iteration = 0;

  const backtestConfig: BacktestConfig = {
    start_date: config.start_date || '2025-07-01',
    end_date: config.end_date || '2026-05-31',
    capital: config.capital || 100000,
    max_positions: config.max_positions || 5,
    holding_days: config.holding_days || 30,
    confidence_threshold: currentParams.confidence_threshold,
    tickers: config.tickers
  };

  while (!shouldStop && iteration < maxIterations) {
    iteration++;
    console.log(`[IterativeLearning] Iteration ${iteration}/${maxIterations}`);

    try {
      // Run backtest with current parameters
      const result = await runBacktestWithParams(backtestConfig, currentParams);

      // Record iteration
      const iterationRecord: LearningIteration = {
        iteration,
        parameters: { ...currentParams },
        result,
        changes: [],
        timestamp: new Date().toISOString()
      };

      currentProgress.iterations.push(iterationRecord);
      currentProgress.total_trades_analyzed += result.total_trades;
      currentProgress.current_win_rate = result.win_rate;

      // Update best if improved
      if (result.win_rate > currentProgress.best_win_rate) {
        currentProgress.best_win_rate = result.win_rate;
        currentProgress.best_parameters = { ...currentParams };
      }

      console.log(`[IterativeLearning] Win rate: ${result.win_rate.toFixed(2)}%`);

      // Check if target reached
      if (result.win_rate >= targetWinRate) {
        currentProgress.status = 'completed';
        currentProgress.completed_at = new Date().toISOString();
        console.log(`[IterativeLearning] Target reached! Win rate: ${result.win_rate.toFixed(2)}%`);
        break;
      }

      // Analyze and adjust parameters
      const adjustments = analyzeAndAdjust(result, currentParams, iteration);
      
      if (adjustments.length === 0) {
        // No more adjustments possible
        console.log(`[IterativeLearning] No more improvements possible`);
        break;
      }

      // Apply adjustments
      for (const adj of adjustments) {
        currentParams[adj.parameter] = adj.newValue;
        iterationRecord.changes.push(
          `${adj.parameter}: ${adj.oldValue} → ${adj.newValue} (${adj.reason})`
        );
      }

      // Small delay to prevent server overload
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`[IterativeLearning] Error in iteration ${iteration}:`, error);
    }
  }

  if (currentProgress.status === 'running') {
    currentProgress.status = iteration >= maxIterations ? 'completed' : 'failed';
    currentProgress.completed_at = new Date().toISOString();
  }

  return currentProgress;
}

/**
 * إيقاف التعلم
 */
export function stopIterativeLearning(): void {
  shouldStop = true;
}

/**
 * الحصول على التقدم الحالي
 */
export function getLearningProgress(): LearningProgress | null {
  return currentProgress;
}

/**
 * إعادة تعيين التقدم
 */
export function resetLearningProgress(): void {
  shouldStop = true;
  currentProgress = null;
  console.log('[IterativeLearning] Progress reset');
}

// ==================== PARAMETER OPTIMIZATION ====================

/**
 * Run backtest with custom parameters
 */
async function runBacktestWithParams(
  config: BacktestConfig,
  params: LearningParameters
): Promise<BacktestResult> {
  // Update config with current confidence threshold
  config.confidence_threshold = params.confidence_threshold;
  
  return await runBacktest(config);
}

/**
 * Analyze results and suggest parameter adjustments
 */
function analyzeAndAdjust(
  result: BacktestResult,
  currentParams: LearningParameters,
  iteration: number
): ParameterAdjustment[] {
  const adjustments: ParameterAdjustment[] = [];

  // If win rate is too low, we need to be more selective
  if (result.win_rate < 50) {
    // Increase confidence threshold - be more selective
    if (currentParams.confidence_threshold < 75) {
      adjustments.push({
        parameter: 'confidence_threshold',
        oldValue: currentParams.confidence_threshold,
        newValue: Math.min(75, currentParams.confidence_threshold + 5),
        reason: 'Increase selectivity - current win rate too low',
        expectedImpact: 'increase_win_rate'
      });
    }

    // Tighten RSI thresholds
    if (currentParams.rsi_oversold > 25) {
      adjustments.push({
        parameter: 'rsi_oversold',
        oldValue: currentParams.rsi_oversold,
        newValue: currentParams.rsi_oversold - 2,
        reason: 'Only buy at more extreme oversold levels',
        expectedImpact: 'increase_win_rate'
      });
    }

    if (currentParams.rsi_overbought < 75) {
      adjustments.push({
        parameter: 'rsi_overbought',
        oldValue: currentParams.rsi_overbought,
        newValue: currentParams.rsi_overbought + 2,
        reason: 'Only sell at more extreme overbought levels',
        expectedImpact: 'increase_win_rate'
      });
    }
  }

  // If win rate is decent but not great, optimize risk management
  if (result.win_rate >= 50 && result.win_rate < 70) {
    // Adjust stop loss based on average loss
    if (result.avg_loser > 5 && currentParams.stop_loss_max > 5) {
      adjustments.push({
        parameter: 'stop_loss_max',
        oldValue: currentParams.stop_loss_max,
        newValue: Math.max(5, currentParams.stop_loss_max - 1),
        reason: 'Reduce max stop loss to limit losses',
        expectedImpact: 'reduce_losses'
      });
    }

    // Adjust target multiplier
    if (result.avg_winner < result.avg_loser * 2 && currentParams.target_multiplier < 3) {
      adjustments.push({
        parameter: 'target_multiplier',
        oldValue: currentParams.target_multiplier,
        newValue: currentParams.target_multiplier + 0.2,
        reason: 'Increase profit targets to improve risk/reward',
        expectedImpact: 'improve_timing'
      });
    }
  }

  // If win rate is good but can be better, fine-tune
  if (result.win_rate >= 70 && result.win_rate < targetWinRate) {
    // Require more indicators to agree
    if (currentParams.min_indicators_agree < 4) {
      adjustments.push({
        parameter: 'min_indicators_agree',
        oldValue: currentParams.min_indicators_agree,
        newValue: currentParams.min_indicators_agree + 1,
        reason: 'Require more confirmation before entry',
        expectedImpact: 'increase_win_rate'
      });
    }

    // Increase volume requirement
    if (currentParams.volume_threshold < 2) {
      adjustments.push({
        parameter: 'volume_threshold',
        oldValue: currentParams.volume_threshold,
        newValue: currentParams.volume_threshold + 0.2,
        reason: 'Require stronger volume confirmation',
        expectedImpact: 'increase_win_rate'
      });
    }
  }

  // Analyze losing trades to find patterns
  const losingTrades = result.trades.filter(t => !t.analysis_correct);
  
  if (losingTrades.length > 0) {
    // Check if many trades hit stop loss quickly
    const stopLossHits = losingTrades.filter(t => t.hit_stop_loss);
    
    if (stopLossHits.length > losingTrades.length * 0.6) {
      // Too many stop losses hit - maybe too tight
      if (currentParams.stop_loss_min < 5) {
        adjustments.push({
          parameter: 'stop_loss_min',
          oldValue: currentParams.stop_loss_min,
          newValue: currentParams.stop_loss_min + 0.5,
          reason: 'Widen minimum stop loss to avoid noise',
          expectedImpact: 'reduce_losses'
        });
      }
    }
  }

  // If we're in later iterations and stuck, try more aggressive changes
  if (iteration > 10 && result.win_rate < 80) {
    // Try increasing indicator weights
    if (currentParams.rsi_weight < 20) {
      adjustments.push({
        parameter: 'rsi_weight',
        oldValue: currentParams.rsi_weight,
        newValue: currentParams.rsi_weight + 2,
        reason: 'Increase RSI importance',
        expectedImpact: 'increase_win_rate'
      });
    }

    if (currentParams.ma_weight < 15) {
      adjustments.push({
        parameter: 'ma_weight',
        oldValue: currentParams.ma_weight,
        newValue: currentParams.ma_weight + 2,
        reason: 'Increase MA importance',
        expectedImpact: 'increase_win_rate'
      });
    }
  }

  // Random exploration occasionally to escape local optima
  if (iteration % 5 === 0 && adjustments.length === 0) {
    const params: (keyof LearningParameters)[] = [
      'rsi_weight', 'macd_weight', 'ma_weight', 'bollinger_weight', 'volume_weight'
    ];
    const randomParam = params[Math.floor(Math.random() * params.length)];
    const currentValue = currentParams[randomParam];
    const change = (Math.random() - 0.5) * 4; // -2 to +2
    
    adjustments.push({
      parameter: randomParam,
      oldValue: currentValue,
      newValue: Math.max(0, Math.min(30, currentValue + change)),
      reason: 'Exploration: random adjustment to find better parameters',
      expectedImpact: 'increase_win_rate'
    });
  }

  return adjustments;
}

/**
 * Analyze what's working and what's not
 */
export function analyzePatterns(trades: BacktestTrade[]): {
  winningPatterns: string[];
  losingPatterns: string[];
  recommendations: string[];
} {
  const winners = trades.filter(t => t.analysis_correct);
  const losers = trades.filter(t => !t.analysis_correct);

  const winningPatterns: string[] = [];
  const losingPatterns: string[] = [];
  const recommendations: string[] = [];

  // Analyze winners
  if (winners.length > 0) {
    const avgConfidence = winners.reduce((sum, t) => sum + t.confidence, 0) / winners.length;
    winningPatterns.push(`Average confidence of winners: ${avgConfidence.toFixed(1)}%`);

    const targetHitRate = winners.filter(t => t.hit_target).length / winners.length * 100;
    winningPatterns.push(`Target hit rate: ${targetHitRate.toFixed(1)}%`);

    // Find best performing conditions
    const conditions = new Map<string, { wins: number; total: number }>();
    for (const trade of winners) {
      const key = trade.reasoning.slice(0, 50);
      const existing = conditions.get(key) || { wins: 0, total: 0 };
      existing.wins++;
      conditions.set(key, existing);
    }

    const bestCondition = [...conditions.entries()]
      .sort((a, b) => b[1].wins - a[1].wins)[0];
    if (bestCondition) {
      winningPatterns.push(`Best condition: ${bestCondition[0]}...`);
    }
  }

  // Analyze losers
  if (losers.length > 0) {
    const avgConfidence = losers.reduce((sum, t) => sum + t.confidence, 0) / losers.length;
    losingPatterns.push(`Average confidence of losers: ${avgConfidence.toFixed(1)}%`);

    const stopLossRate = losers.filter(t => t.hit_stop_loss).length / losers.length * 100;
    losingPatterns.push(`Stop loss hit rate: ${stopLossRate.toFixed(1)}%`);

    // Find worst performing conditions
    const conditions = new Map<string, { losses: number }>();
    for (const trade of losers) {
      const key = trade.reasoning.slice(0, 50);
      const existing = conditions.get(key) || { losses: 0 };
      existing.losses++;
      conditions.set(key, existing);
    }

    const worstCondition = [...conditions.entries()]
      .sort((a, b) => b[1].losses - a[1].losses)[0];
    if (worstCondition) {
      losingPatterns.push(`Worst condition: ${worstCondition[0]}...`);
    }
  }

  // Generate recommendations
  if (losers.filter(t => t.hit_stop_loss).length > losers.length * 0.5) {
    recommendations.push('Consider widening stop loss or being more selective on entry');
  }

  if (winners.filter(t => t.hit_target).length < winners.length * 0.3) {
    recommendations.push('Consider lowering profit targets for more consistent wins');
  }

  const avgReturn = trades.reduce((sum, t) => sum + t.actual_return, 0) / trades.length;
  if (avgReturn < 0) {
    recommendations.push('Overall negative returns - review entry criteria');
  }

  return { winningPatterns, losingPatterns, recommendations };
}

/**
 * Get recommended parameters based on historical analysis
 */
export function getRecommendedParameters(
  trades: BacktestTrade[]
): Partial<LearningParameters> {
  const recommendations: Partial<LearningParameters> = {};

  // Analyze confidence levels
  const highConfidenceTrades = trades.filter(t => t.confidence >= 70);
  const lowConfidenceTrades = trades.filter(t => t.confidence < 60);

  const highConfWinRate = highConfidenceTrades.filter(t => t.analysis_correct).length / 
    (highConfidenceTrades.length || 1);
  const lowConfWinRate = lowConfidenceTrades.filter(t => t.analysis_correct).length / 
    (lowConfidenceTrades.length || 1);

  if (highConfWinRate > lowConfWinRate + 0.1) {
    recommendations.confidence_threshold = 65;
  }

  // Analyze stop losses
  const stopLossTrades = trades.filter(t => t.hit_stop_loss);
  if (stopLossTrades.length > trades.length * 0.3) {
    recommendations.stop_loss_min = 4;
    recommendations.stop_loss_max = 6;
  }

  // Analyze targets
  const targetHitTrades = trades.filter(t => t.hit_target);
  if (targetHitTrades.length < trades.length * 0.2) {
    recommendations.target_multiplier = 1.5;
  }

  return recommendations;
}
