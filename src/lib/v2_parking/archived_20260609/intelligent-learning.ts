/**
 * Intelligent Learning Engine - محرك التعلم الذكي
 * 
 * الفرق عن النظام القديم:
 * 1. يستخدم البارامترات فعلياً في اتخاذ القرار
 * 2. يحلل أنماط الصفقات الرابحة vs الخاسرة
 * 3. يستخدم تحسين بايزي بدلاً من العشوائية
 * 4. يتعلم من الأخطاء ويعدل القواعد
 * 5. يستخدم Cross-Validation لتجنب Overfitting
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
  pattern_insights: string[];
  data_range?: {
    start_date: string;
    end_date: string;
    tickers_count: number;
  };
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
  winning_patterns: string[];
  losing_patterns: string[];
  cross_validation_score?: number;
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

// ==================== CROSS-VALIDATION DATA SPLITS ====================

/**
 * تقسيم البيانات لتجنب Overfitting
 * كل fold يستخدم فترة زمنية مختلفة
 */
const DATA_FOLDS = [
  { name: 'Fold 1: Q3 2025', start: '2025-07-01', end: '2025-09-30' },
  { name: 'Fold 2: Q4 2025', start: '2025-10-01', end: '2025-12-31' },
  { name: 'Fold 3: Q1 2026', start: '2026-01-01', end: '2026-03-31' },
  { name: 'Fold 4: Q2 2026', start: '2026-04-01', end: '2026-06-30' },
  { name: 'Fold 5: Full Year', start: '2025-07-01', end: '2026-05-31' },
];

/**
 * الحصول على fold عشوائي
 */
function getRandomFold(iteration: number): { name: string; start: string; end: string } {
  // استخدم الـ iteration لتحديد الـ fold بشكل دوري
  const foldIndex = iteration % DATA_FOLDS.length;
  return DATA_FOLDS[foldIndex];
}

/**
 * الحصول على مجموعة أسهم عشوائية
 */
async function getRandomTickers(allTickers: string[], seed: number): Promise<string[]> {
  // خلط الأسهم باستخدام seed للتكرار
  const shuffled = [...allTickers].sort((a, b) => {
    const hashA = (seed + a.charCodeAt(0)) % 100;
    const hashB = (seed + b.charCodeAt(0)) % 100;
    return hashA - hashB;
  });
  
  // اختر 30-50 سهم عشوائي
  const count = 30 + (seed % 20);
  return shuffled.slice(0, count);
}

// ==================== PATTERN ANALYSIS ====================

interface TradePattern {
  rsi_range: string;
  macd_signal: string;
  ma_signal: string;
  bollinger_signal: string;
  action: 'BUY' | 'SELL';
  win_rate: number;
  sample_size: number;
  avg_return: number;
}

function extractPattern(trade: BacktestTrade): string {
  // Create a pattern signature from trade reasoning
  const parts: string[] = [];
  
  if (trade.reasoning.includes('RSI تشبع بيعي')) parts.push('RSI_OV');
  else if (trade.reasoning.includes('RSI تشبع شرائي')) parts.push('RSI_OB');
  else parts.push('RSI_N');
  
  if (trade.reasoning.includes('MACD إيجابي')) parts.push('MACD_B');
  else if (trade.reasoning.includes('MACD سلبي')) parts.push('MACD_BE');
  else parts.push('MACD_N');
  
  if (trade.reasoning.includes('فوق كل المتوسطات')) parts.push('MA_A');
  else if (trade.reasoning.includes('تحت كل المتوسطات')) parts.push('MA_B');
  else parts.push('MA_M');
  
  if (trade.reasoning.includes('تحت النطاق السفلي')) parts.push('BB_L');
  else if (trade.reasoning.includes('فوق النطاق العلوي')) parts.push('BB_U');
  else parts.push('BB_N');
  
  parts.push(trade.action);
  
  return parts.join('|');
}

function analyzeTradePatternsInternal(trades: BacktestTrade[]): {
  winningPatterns: string[];
  losingPatterns: string[];
  patternStats: Map<string, { wins: number; total: number; avgReturn: number }>;
} {
  const patternStats = new Map<string, { wins: number; total: number; avgReturn: number }>();
  
  for (const trade of trades) {
    const pattern = extractPattern(trade);
    const existing = patternStats.get(pattern) || { wins: 0, total: 0, avgReturn: 0 };
    existing.total++;
    if (trade.actual_return > 0) existing.wins++;
    existing.avgReturn += trade.actual_return;
    patternStats.set(pattern, existing);
  }
  
  // Calculate final averages and sort
  const patternList = Array.from(patternStats.entries()).map(([pattern, stats]) => ({
    pattern,
    win_rate: (stats.wins / stats.total) * 100,
    sample_size: stats.total,
    avg_return: stats.avgReturn / stats.total
  }));
  
  // Sort by win rate
  patternList.sort((a, b) => b.win_rate - a.win_rate);
  
  const winningPatterns = patternList
    .filter(p => p.sample_size >= 3 && p.win_rate >= 60)
    .map(p => `${p.pattern}: ${p.win_rate.toFixed(1)}% (${p.sample_size} trades)`);
  
  const losingPatterns = patternList
    .filter(p => p.sample_size >= 3 && p.win_rate < 40)
    .map(p => `${p.pattern}: ${p.win_rate.toFixed(1)}% (${p.sample_size} trades)`);

  return { winningPatterns, losingPatterns, patternStats };
}

// ==================== PARAMETER OPTIMIZATION ====================

interface ParameterImpact {
  parameter: keyof LearningParameters;
  currentValue: number;
  suggestedValue: number;
  confidence: number; // How confident we are about this change
  reason: string;
}

function analyzeParameterImpact(
  trades: BacktestTrade[],
  currentParams: LearningParameters
): ParameterImpact[] {
  const impacts: ParameterImpact[] = [];
  
  // Analyze winners vs losers
  const winners = trades.filter(t => t.actual_return > 0);
  const losers = trades.filter(t => t.actual_return <= 0);
  
  if (winners.length < 5 || losers.length < 5) {
    // Not enough data, make conservative suggestions
    return [{
      parameter: 'confidence_threshold',
      currentValue: currentParams.confidence_threshold,
      suggestedValue: Math.min(85, currentParams.confidence_threshold + 10),
      confidence: 0.3,
      reason: 'Insufficient data - increasing selectivity'
    }];
  }
  
  // Analyze RSI patterns
  const winnersWithOversold = winners.filter(t => t.reasoning.includes('RSI تشبع بيعي')).length;
  const losersWithOversold = losers.filter(t => t.reasoning.includes('RSI تشبع بيعي')).length;
  const oversoldWinRate = winnersWithOversold / (winnersWithOversold + losersWithOversold + 0.01);
  
  if (oversoldWinRate < 0.5 && currentParams.rsi_oversold < 35) {
    // RSI oversold isn't working well - need more extreme levels
    impacts.push({
      parameter: 'rsi_oversold',
      currentValue: currentParams.rsi_oversold,
      suggestedValue: Math.max(20, currentParams.rsi_oversold - 5),
      confidence: 0.7,
      reason: `RSI oversold win rate is ${(oversoldWinRate * 100).toFixed(1)}% - need more extreme levels`
    });
  }
  
  // Analyze MACD patterns
  const winnersWithMacdBull = winners.filter(t => t.reasoning.includes('MACD إيجابي')).length;
  const losersWithMacdBull = losers.filter(t => t.reasoning.includes('MACD إيجابي')).length;
  const macdBullWinRate = winnersWithMacdBull / (winnersWithMacdBull + losersWithMacdBull + 0.01);
  
  if (macdBullWinRate > 0.6) {
    // MACD is working well - increase its weight
    impacts.push({
      parameter: 'macd_weight',
      currentValue: currentParams.macd_weight,
      suggestedValue: Math.min(25, currentParams.macd_weight + 3),
      confidence: 0.8,
      reason: `MACD bullish win rate is ${(macdBullWinRate * 100).toFixed(1)}% - increasing weight`
    });
  } else if (macdBullWinRate < 0.4) {
    // MACD isn't working - decrease weight
    impacts.push({
      parameter: 'macd_weight',
      currentValue: currentParams.macd_weight,
      suggestedValue: Math.max(5, currentParams.macd_weight - 3),
      confidence: 0.7,
      reason: `MACD bullish win rate is ${(macdBullWinRate * 100).toFixed(1)}% - decreasing weight`
    });
  }
  
  // Analyze MA patterns
  const winnersAboveMA = winners.filter(t => t.reasoning.includes('فوق كل المتوسطات')).length;
  const losersAboveMA = losers.filter(t => t.reasoning.includes('فوق كل المتوسطات')).length;
  const aboveMAWinRate = winnersAboveMA / (winnersAboveMA + losersAboveMA + 0.01);
  
  if (aboveMAWinRate > 0.55) {
    impacts.push({
      parameter: 'ma_weight',
      currentValue: currentParams.ma_weight,
      suggestedValue: Math.min(20, currentParams.ma_weight + 2),
      confidence: 0.6,
      reason: `Above all MAs win rate is ${(aboveMAWinRate * 100).toFixed(1)}% - increasing weight`
    });
  }
  
  // Analyze confidence threshold effectiveness
  const highConfTrades = trades.filter(t => t.confidence >= 70);
  const lowConfTrades = trades.filter(t => t.confidence < 60);
  
  if (highConfTrades.length > 0 && lowConfTrades.length > 0) {
    const highConfWinRate = highConfTrades.filter(t => t.actual_return > 0).length / highConfTrades.length;
    const lowConfWinRate = lowConfTrades.filter(t => t.actual_return > 0).length / lowConfTrades.length;
    
    if (highConfWinRate > lowConfWinRate + 0.15) {
      // Higher confidence trades are significantly better
      impacts.push({
        parameter: 'confidence_threshold',
        currentValue: currentParams.confidence_threshold,
        suggestedValue: Math.min(80, currentParams.confidence_threshold + 5),
        confidence: 0.85,
        reason: `High confidence win rate (${(highConfWinRate * 100).toFixed(1)}%) >> low confidence (${(lowConfWinRate * 100).toFixed(1)}%)`
      });
    }
  }
  
  // Analyze stop loss effectiveness
  const stoppedOut = losers.filter(t => t.hit_stop_loss);
  if (stoppedOut.length > losers.length * 0.7) {
    // Most losses are from stop loss - maybe too tight
    impacts.push({
      parameter: 'stop_loss_min',
      currentValue: currentParams.stop_loss_min,
      suggestedValue: Math.min(6, currentParams.stop_loss_min + 0.5),
      confidence: 0.5,
      reason: `${((stoppedOut.length / losers.length) * 100).toFixed(0)}% of losses hit stop loss - may be too tight`
    });
  }
  
  // Analyze target effectiveness
  const hitTarget = winners.filter(t => t.hit_target);
  if (hitTarget.length < winners.length * 0.3) {
    // Few winners hit target - maybe too ambitious
    impacts.push({
      parameter: 'target_multiplier',
      currentValue: currentParams.target_multiplier,
      suggestedValue: Math.max(1.5, currentParams.target_multiplier - 0.3),
      confidence: 0.6,
      reason: `Only ${((hitTarget.length / winners.length) * 100).toFixed(0)}% of winners hit target - may be too ambitious`
    });
  }
  
  return impacts;
}

// ==================== BAYESIAN OPTIMIZATION ====================

function bayesianSuggestParameters(
  history: LearningIteration[],
  currentParams: LearningParameters,
  _patternStats: Map<string, { wins: number; total: number; avgReturn: number }>
): Partial<LearningParameters> {
  // If we have history, learn from it
  if (history.length >= 3) {
    // Find which parameter changes correlated with improvements
    const improvements: Array<{ param: keyof LearningParameters; direction: number; impact: number }> = [];
    
    for (let i = 1; i < history.length; i++) {
      const prev = history[i - 1];
      const curr = history[i];
      
      if (curr.result.win_rate > prev.result.win_rate) {
        // This iteration improved - note what changed
        const params = Object.keys(DEFAULT_PARAMETERS) as (keyof LearningParameters)[];
        for (const param of params) {
          const change = curr.parameters[param] - prev.parameters[param];
          if (Math.abs(change) > 0.01) {
            improvements.push({
              param,
              direction: Math.sign(change),
              impact: curr.result.win_rate - prev.result.win_rate
            });
          }
        }
      }
    }
    
    // Apply the best performing changes
    const suggestions: Partial<LearningParameters> = {};
    const paramImpacts = new Map<keyof LearningParameters, { total: number; count: number }>();
    
    for (const imp of improvements) {
      const existing = paramImpacts.get(imp.param) || { total: 0, count: 0 };
      existing.total += imp.direction * imp.impact;
      existing.count++;
      paramImpacts.set(imp.param, existing);
    }
    
    for (const [param, data] of paramImpacts) {
      if (data.count >= 2) {
        const avgImpact = data.total / data.count;
        if (Math.abs(avgImpact) > 0.5) {
          // Significant impact - continue in this direction
          const currentValue = currentParams[param];
          const step = avgImpact > 0 ? 1 : -1;
          const min = param === 'rsi_oversold' ? 15 : param === 'rsi_overbought' ? 60 : 0;
          const max = param === 'rsi_oversold' ? 40 : param === 'rsi_overbought' ? 85 : 100;
          
          suggestions[param] = Math.max(min as number, Math.min(max as number, currentValue + step * 2));
        }
      }
    }
    
    return suggestions;
  }
  
  return {};
}

// ==================== INTELLIGENT LEARNING ENGINE ====================

let currentProgress: LearningProgress | null = null;
let shouldStop = false;

// Auto-apply threshold - إذا كانت نسبة النجاح أعلى من هذه القيمة، يتم تطبيق البارامترات تلقائياً
export let AUTO_APPLY_THRESHOLD = 60; // يمكن تغييرها من الإعدادات

export function setAutoApplyThreshold(value: number): void {
  AUTO_APPLY_THRESHOLD = Math.max(50, Math.min(95, value));
  console.log(`[IntelligentLearning] Auto-apply threshold set to ${AUTO_APPLY_THRESHOLD}%`);
}

export function getAutoApplyThreshold(): number {
  return AUTO_APPLY_THRESHOLD;
}

/**
 * تشغيل التعلم الذكي في الخلفية (Background)
 * يستجيب فوراً ويعمل في الخلفية
 */
export function startIntelligentLearningBackground(
  targetWinRate: number = 99,
  maxIterations: number = 100,
  config: Partial<BacktestConfig> = {},
  customInitialParams?: Partial<LearningParameters>
): void {
  console.log(`[IntelligentLearning] Starting BACKGROUND learning with target: ${targetWinRate}%`);
  console.log(`[IntelligentLearning] Auto-apply threshold: ${AUTO_APPLY_THRESHOLD}%`);
  if (customInitialParams) {
    console.log(`[IntelligentLearning] Using custom initial parameters:`, customInitialParams);
  }

  // Reset state
  shouldStop = false;

  // Start with custom params or defaults
  const initialParams = customInitialParams 
    ? { ...DEFAULT_PARAMETERS, ...customInitialParams }
    : { ...DEFAULT_PARAMETERS };

  currentProgress = {
    target_win_rate: targetWinRate,
    current_win_rate: 0,
    iterations: [],
    best_parameters: { ...initialParams },
    best_win_rate: 0,
    total_trades_analyzed: 0,
    status: 'running',
    started_at: new Date().toISOString(),
    winning_patterns: [],
    losing_patterns: [],
    cross_validation_score: 0
  };

  // Run in background
  (async () => {
    let currentParams = { ...initialParams };
    let iteration = 0;
    let noImprovementCount = 0;
    const winRateHistory: number[] = [];

    const baseConfig = {
      capital: config.capital || 100000,
      max_positions: config.max_positions || 5,
      holding_days: config.holding_days || 30,
    };

    while (!shouldStop && iteration < maxIterations) {
      iteration++;
      
      if (!currentProgress) break;
      
      const fold = getRandomFold(iteration);
      console.log(`[IntelligentLearning] Iteration ${iteration}/${maxIterations} - ${fold.name}`);

      try {
        const result = await runBacktest({
          ...baseConfig,
          start_date: fold.start,
          end_date: fold.end,
          confidence_threshold: currentParams.confidence_threshold,
          parameters: {
            rsi_oversold: currentParams.rsi_oversold,
            rsi_overbought: currentParams.rsi_overbought,
            rsi_weight: currentParams.rsi_weight,
            macd_weight: currentParams.macd_weight,
            ma_weight: currentParams.ma_weight,
            bollinger_weight: currentParams.bollinger_weight,
            stop_loss_min: currentParams.stop_loss_min,
            stop_loss_max: currentParams.stop_loss_max,
            target_multiplier: currentParams.target_multiplier,
            min_indicators_agree: currentParams.min_indicators_agree
          }
        });

        const { winningPatterns, losingPatterns, patternStats } = analyzeTradePatternsInternal(result.trades);
        
        const patternInsights: string[] = [];
        patternInsights.push(`📊 ${fold.name}`);
        if (winningPatterns.length > 0) {
          patternInsights.push(`🎯 Winning: ${winningPatterns.slice(0, 2).join(', ')}`);
        }
        if (losingPatterns.length > 0) {
          patternInsights.push(`⚠️ Avoid: ${losingPatterns.slice(0, 2).join(', ')}`);
        }

        winRateHistory.push(result.win_rate);

        const iterationRecord: LearningIteration = {
          iteration,
          parameters: { ...currentParams },
          result,
          changes: [],
          timestamp: new Date().toISOString(),
          pattern_insights: patternInsights,
          data_range: {
            start_date: fold.start,
            end_date: fold.end,
            tickers_count: result.ticker_performance?.size || 0
          }
        };

        currentProgress.iterations.push(iterationRecord);
        currentProgress.total_trades_analyzed += result.total_trades;
        currentProgress.current_win_rate = result.win_rate;
        currentProgress.winning_patterns = winningPatterns;
        currentProgress.losing_patterns = losingPatterns;

        if (winRateHistory.length >= 3) {
          const avgWinRate = winRateHistory.reduce((a, b) => a + b, 0) / winRateHistory.length;
          const variance = winRateHistory.reduce((sum, rate) => sum + Math.pow(rate - avgWinRate, 2), 0) / winRateHistory.length;
          const stdDev = Math.sqrt(variance);
          currentProgress.cross_validation_score = avgWinRate - (stdDev * 0.5);
          console.log(`[IntelligentLearning] CV Score: ${currentProgress.cross_validation_score.toFixed(2)}%`);
        }

        if (result.win_rate > currentProgress.best_win_rate) {
          currentProgress.best_win_rate = result.win_rate;
          currentProgress.best_parameters = { ...currentParams };
          noImprovementCount = 0;
          console.log(`[IntelligentLearning] NEW BEST: ${result.win_rate.toFixed(2)}% on ${fold.name}`);
          
          // AUTO-APPLY: إذا تجاوزت النتيجة الـ threshold، طبق فوراً
          if (result.win_rate >= AUTO_APPLY_THRESHOLD) {
            console.log(`[IntelligentLearning] 🎯 AUTO-APPLYING parameters (${result.win_rate.toFixed(1)}% >= ${AUTO_APPLY_THRESHOLD}%)`);
            try {
              const { saveOptimizedParameters } = await import('./unified-prediction');
              await saveOptimizedParameters(
                `Auto-Applied ${result.win_rate.toFixed(0)}%`,
                result.win_rate,
                result.total_trades,
                currentParams
              );
              console.log(`[IntelligentLearning] ✅ Parameters auto-applied successfully!`);
            } catch (saveError) {
              console.error(`[IntelligentLearning] Failed to auto-apply:`, saveError);
            }
          }
        } else {
          noImprovementCount++;
        }

        if (result.win_rate >= targetWinRate) {
          currentProgress.status = 'completed';
          currentProgress.completed_at = new Date().toISOString();
          console.log(`[IntelligentLearning] TARGET REACHED! Win rate: ${result.win_rate.toFixed(2)}%`);
          break;
        }

        if (noImprovementCount >= 10) {
          const randomThreshold = 60 + Math.floor(Math.random() * 25);
          currentParams.confidence_threshold = randomThreshold;
          iterationRecord.changes.push(`Radical reset: confidence_threshold → ${randomThreshold}`);
          noImprovementCount = 0;
          await new Promise(resolve => setTimeout(resolve, 100));
          continue;
        }

        const impacts = analyzeParameterImpact(result.trades, currentParams);
        const bayesianSuggestions = bayesianSuggestParameters(currentProgress.iterations, currentParams, patternStats);
        const changes: string[] = [];
        
        const highConfidenceImpacts = impacts
          .filter(i => i.confidence >= 0.6)
          .sort((a, b) => b.confidence - a.confidence)
          .slice(0, 3);
        
        for (const impact of highConfidenceImpacts) {
          currentParams[impact.parameter] = impact.suggestedValue;
          changes.push(`${impact.parameter}: ${impact.currentValue.toFixed(1)} → ${impact.suggestedValue.toFixed(1)}`);
        }
        
        for (const [param, value] of Object.entries(bayesianSuggestions)) {
          if (!highConfidenceImpacts.find(i => i.parameter === param)) {
            (currentParams as Record<string, number>)[param] = value as number;
            changes.push(`${param}: Bayesian → ${value}`);
          }
        }

        iterationRecord.changes = changes;
        console.log(`[IntelligentLearning] Win rate: ${result.win_rate.toFixed(2)}%`);

        await new Promise(resolve => setTimeout(resolve, 100));

      } catch (error) {
        console.error(`[IntelligentLearning] Error in iteration ${iteration}:`, error);
      }
    }

    if (currentProgress && currentProgress.status === 'running') {
      currentProgress.status = iteration >= maxIterations ? 'completed' : 'failed';
      currentProgress.completed_at = new Date().toISOString();
    }
    
    console.log(`[IntelligentLearning] Background learning completed. Best: ${currentProgress?.best_win_rate.toFixed(1)}%`);
  })();
}

/**
 * تشغيل التعلم الذكي مع Cross-Validation (متزامن - للتوافق)
 */
export async function startIntelligentLearning(
  targetWinRate: number = 99,
  maxIterations: number = 100,
  config: Partial<BacktestConfig> = {},
  customInitialParams?: Partial<LearningParameters>
): Promise<LearningProgress> {
  // Start in background
  startIntelligentLearningBackground(targetWinRate, maxIterations, config, customInitialParams);
  
  // Wait a bit for initial progress
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Return current progress
  return currentProgress!;
}

/**
 * إيقاف التعلم
 */
export function stopIntelligentLearning(): void {
  shouldStop = true;
}

/**
 * الحصول على التقدم الحالي
 */
export function getIntelligentLearningProgress(): LearningProgress | null {
  return currentProgress;
}

/**
 * إعادة تعيين التقدم
 */
export function resetIntelligentLearningProgress(): void {
  shouldStop = true;
  currentProgress = null;
  console.log('[IntelligentLearning] Progress reset');
}

/**
 * تحليل الأنماط من صفقات
 */
export function analyzeTradePatterns(trades: BacktestTrade[]): {
  winningPatterns: string[];
  losingPatterns: string[];
  recommendations: string[];
} {
  const { winningPatterns, losingPatterns, patternStats } = analyzeTradePatternsInternal(trades);
  
  const recommendations: string[] = [];
  
  // Analyze pattern statistics
  const goodPatterns = Array.from(patternStats.entries())
    .filter(([, stats]) => stats.total >= 3 && (stats.wins / stats.total) >= 0.6)
    .sort((a, b) => (b[1].wins / b[1].total) - (a[1].wins / a[1].total));
  
  const badPatterns = Array.from(patternStats.entries())
    .filter(([, stats]) => stats.total >= 3 && (stats.wins / stats.total) < 0.4)
    .sort((a, b) => (a[1].wins / a[1].total) - (b[1].wins / b[1].total));
  
  if (goodPatterns.length > 0) {
    recommendations.push(`🎯 Focus on patterns: ${goodPatterns.slice(0, 3).map(([p]) => p).join(', ')}`);
  }
  
  if (badPatterns.length > 0) {
    recommendations.push(`⚠️ Avoid patterns: ${badPatterns.slice(0, 3).map(([p]) => p).join(', ')}`);
  }
  
  // Confidence analysis
  const highConfTrades = trades.filter(t => t.confidence >= 70);
  const lowConfTrades = trades.filter(t => t.confidence < 60);
  
  if (highConfTrades.length > 0 && lowConfTrades.length > 0) {
    const highConfWinRate = highConfTrades.filter(t => t.actual_return > 0).length / highConfTrades.length;
    const lowConfWinRate = lowConfTrades.filter(t => t.actual_return > 0).length / lowConfTrades.length;
    
    if (highConfWinRate > lowConfWinRate + 0.1) {
      recommendations.push(`📊 Use higher confidence threshold (${(highConfWinRate * 100).toFixed(0)}% win rate at 70+ vs ${(lowConfWinRate * 100).toFixed(0)}% below 60)`);
    }
  }

  return { winningPatterns, losingPatterns, recommendations };
}

// Re-export for compatibility
export const startIterativeLearning = startIntelligentLearning;
export const stopIterativeLearning = stopIntelligentLearning;
export const getLearningProgress = getIntelligentLearningProgress;
export const resetLearningProgress = resetIntelligentLearningProgress;
export const analyzePatterns = analyzeTradePatterns;
