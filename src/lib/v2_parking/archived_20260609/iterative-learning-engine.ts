/**
 * محرك التعلم التكراري الذكي - Intelligent Iterative Learning Engine
 * 
 * ده النظام اللي بيكشف الأخطاء ويُصححها تلقائياً
 * واللي بيوصل لـ 75% win rate إن شاء الله
 * 
 * الفكرة:
 * 1. نبدأ ببرمترات افتراضية
 * 2. نشغل backtest
 * 3. نحلل الأخطاء (إيه اللي غلط؟)
 * 4. نُعدّل البرمترات
 * 5. نُعيد التشغيل
 * 6. نكرر لحد ما نوصل للهدف
 */

import { runBacktest, type BacktestConfig, type BacktestTrade } from './backtesting-engine';

// ==================== TYPES ====================

export interface LearningParameters {
  rsi_oversold: number;
  rsi_overbought: number;
  rsi_weight: number;
  macd_weight: number;
  ma_weight: number;
  bollinger_weight: number;
  stop_loss_min: number;
  stop_loss_max: number;
  target_multiplier: number;
  confidence_threshold: number;
  min_indicators_agree: number;
}

export interface LearningIteration {
  iteration: number;
  parameters: LearningParameters;
  result: {
    win_rate: number;
    total_trades: number;
    total_return: number;
  };
  changes_made: string[];
  lessons: string[];
}

export interface LearningResult {
  success: boolean;
  target_achieved: boolean;
  final_win_rate: number;
  target_win_rate: number;
  total_iterations: number;
  iterations: LearningIteration[];
  best_parameters: LearningParameters;
  improvement_history: number[];
}

// ==================== PERSONA DEFAULTS ====================

export const PERSONA_PARAMETERS: Record<string, LearningParameters> = {
  conservative: {
    rsi_oversold: 35,
    rsi_overbought: 65,
    rsi_weight: 12,
    macd_weight: 8,
    ma_weight: 15,
    bollinger_weight: 10,
    stop_loss_min: 4,
    stop_loss_max: 6,
    target_multiplier: 1.5,
    confidence_threshold: 70,
    min_indicators_agree: 3
  },
  balanced: {
    rsi_oversold: 30,
    rsi_overbought: 70,
    rsi_weight: 15,
    macd_weight: 10,
    ma_weight: 12,
    bollinger_weight: 8,
    stop_loss_min: 3,
    stop_loss_max: 8,
    target_multiplier: 2,
    confidence_threshold: 55,
    min_indicators_agree: 2
  },
  gambler: {
    rsi_oversold: 20,
    rsi_overbought: 80,
    rsi_weight: 18,
    macd_weight: 12,
    ma_weight: 8,
    bollinger_weight: 5,
    stop_loss_min: 2,
    stop_loss_max: 15,
    target_multiplier: 3,
    confidence_threshold: 40,
    min_indicators_agree: 1
  },
  smart: {
    rsi_oversold: 28,
    rsi_overbought: 72,
    rsi_weight: 14,
    macd_weight: 11,
    ma_weight: 13,
    bollinger_weight: 9,
    stop_loss_min: 3,
    stop_loss_max: 7,
    target_multiplier: 2.2,
    confidence_threshold: 60,
    min_indicators_agree: 2
  },
  scalper: {
    rsi_oversold: 25,
    rsi_overbought: 75,
    rsi_weight: 20,
    macd_weight: 15,
    ma_weight: 5,
    bollinger_weight: 12,
    stop_loss_min: 1,
    stop_loss_max: 3,
    target_multiplier: 1.2,
    confidence_threshold: 50,
    min_indicators_agree: 2
  },
  trend_follower: {
    rsi_oversold: 30,
    rsi_overbought: 70,
    rsi_weight: 10,
    macd_weight: 18,
    ma_weight: 20,
    bollinger_weight: 6,
    stop_loss_min: 5,
    stop_loss_max: 10,
    target_multiplier: 2.5,
    confidence_threshold: 50,
    min_indicators_agree: 2
  },
  contrarian: {
    rsi_oversold: 38,
    rsi_overbought: 62,
    rsi_weight: 22,
    macd_weight: 5,
    ma_weight: 6,
    bollinger_weight: 15,
    stop_loss_min: 4,
    stop_loss_max: 8,
    target_multiplier: 1.8,
    confidence_threshold: 65,
    min_indicators_agree: 2
  }
};

// ==================== LEARNING ENGINE ====================

export class IterativeLearningEngine {
  private targetWinRate: number;
  private maxIterations: number;
  private persona: string;
  private parameters: LearningParameters;
  private iterations: LearningIteration[] = [];
  private improvementHistory: number[] = [];
  
  constructor(
    persona: string = 'balanced',
    targetWinRate: number = 75,
    maxIterations: number = 30
  ) {
    this.persona = persona;
    this.targetWinRate = targetWinRate;
    this.maxIterations = maxIterations;
    this.parameters = { ...PERSONA_PARAMETERS[persona] || PERSONA_PARAMETERS.balanced };
  }
  
  /**
   * تحليل الصفقات الخاسرة واستخراج الدروس
   */
  private analyzeLosses(trades: BacktestTrade[]): { issues: string[], suggestions: string[] } {
    const issues: string[] = [];
    const suggestions: string[] = [];
    
    const losers = trades.filter(t => t.actual_return < 0);
    const winners = trades.filter(t => t.actual_return > 0);
    
    if (losers.length === 0) {
      return { issues, suggestions };
    }
    
    // تحليل RSI
    const rsiIssues = losers.filter(t => t.reasoning.includes('RSI'));
    if (rsiIssues.length > losers.length * 0.5) {
      issues.push(`RSI signals causing ${((rsiIssues.length / losers.length) * 100).toFixed(0)}% of losses`);
      
      // اقتراح تعديل
      if (this.parameters.rsi_weight > 5) {
        suggestions.push(`خفّض وزن RSI من ${this.parameters.rsi_weight} إلى ${this.parameters.rsi_weight - 2}`);
      }
    }
    
    // تحليل Stop Loss
    const stopLossHits = losers.filter(t => t.hit_stop_loss);
    if (stopLossHits.length > losers.length * 0.6) {
      issues.push(`Stop loss too tight - ${((stopLossHits.length / losers.length) * 100).toFixed(0)}% hit stop`);
      suggestions.push(`وسّع Stop Loss من ${this.parameters.stop_loss_max}% إلى ${this.parameters.stop_loss_max + 2}%`);
    }
    
    // تحليل Confidence
    const lowConfidenceLosses = losers.filter(t => t.confidence < 60);
    if (lowConfidenceLosses.length > losers.length * 0.4) {
      issues.push(`Low confidence trades losing - ${lowConfidenceLosses.length} trades`);
      suggestions.push(`ارفع حد الثقة من ${this.parameters.confidence_threshold} إلى ${this.parameters.confidence_threshold + 5}`);
    }
    
    // تحليل عدد المؤشرات
    if (this.parameters.min_indicators_agree < 3) {
      issues.push(`Only ${this.parameters.min_indicators_agree} indicators required - too low`);
      suggestions.push(`زوّد المؤشرات المطلوبة إلى ${this.parameters.min_indicators_agree + 1}`);
    }
    
    // تحليل نسبة الربح للخسارة
    if (winners.length > 0 && losers.length > 0) {
      const avgWin = winners.reduce((s, t) => s + t.actual_return, 0) / winners.length;
      const avgLoss = Math.abs(losers.reduce((s, t) => s + t.actual_return, 0) / losers.length);
      
      if (avgLoss > avgWin * 1.5) {
        issues.push(`الخسائر أكبر من الأرباح (${avgLoss.toFixed(1)}% vs ${avgWin.toFixed(1)}%)`);
        suggestions.push(`قلّل Stop Loss أو زوّد الهدف`);
      }
    }
    
    return { issues, suggestions };
  }
  
  /**
   * تطبيق التعديلات على البرمترات
   */
  private applyAdjustments(suggestions: string[]): string[] {
    const changes: string[] = [];
    
    for (const suggestion of suggestions) {
      // تعديل وزن RSI
      if (suggestion.includes('RSI') && suggestion.includes('خفّض')) {
        const newWeight = Math.max(5, this.parameters.rsi_weight - 2);
        changes.push(`RSI weight: ${this.parameters.rsi_weight} → ${newWeight}`);
        this.parameters.rsi_weight = newWeight;
      }
      
      // تعديل Stop Loss
      if (suggestion.includes('Stop Loss') && suggestion.includes('وسّع')) {
        const newMax = Math.min(15, this.parameters.stop_loss_max + 2);
        changes.push(`Stop Loss max: ${this.parameters.stop_loss_max}% → ${newMax}%`);
        this.parameters.stop_loss_max = newMax;
      }
      
      // تعديل حد الثقة
      if (suggestion.includes('ثقة') && suggestion.includes('ارفع')) {
        const newThreshold = Math.min(85, this.parameters.confidence_threshold + 5);
        changes.push(`Confidence: ${this.parameters.confidence_threshold} → ${newThreshold}`);
        this.parameters.confidence_threshold = newThreshold;
      }
      
      // تعديل عدد المؤشرات
      if (suggestion.includes('المؤشرات') && suggestion.includes('زوّد')) {
        const newMin = Math.min(4, this.parameters.min_indicators_agree + 1);
        changes.push(`Min indicators: ${this.parameters.min_indicators_agree} → ${newMin}`);
        this.parameters.min_indicators_agree = newMin;
      }
    }
    
    // إذا ما فيش تغييرات، نعمل تعديلات استباقية
    if (changes.length === 0) {
      // نجرّب نزيد الثقة أو نقلل المخاطر
      if (this.parameters.confidence_threshold < 75) {
        this.parameters.confidence_threshold += 5;
        changes.push(`رفع الثقة إلى ${this.parameters.confidence_threshold}`);
      } else if (this.parameters.min_indicators_agree < 3) {
        this.parameters.min_indicators_agree += 1;
        changes.push(`زيادة المؤشرات المطلوبة إلى ${this.parameters.min_indicators_agree}`);
      } else {
        // نجرّب نعدّل الـ RSI levels
        this.parameters.rsi_oversold = Math.min(35, this.parameters.rsi_oversold + 2);
        this.parameters.rsi_overbought = Math.max(65, this.parameters.rsi_overbought - 2);
        changes.push(`تعديل RSI: شراء تحت ${this.parameters.rsi_oversold}، بيع فوق ${this.parameters.rsi_overbought}`);
      }
    }
    
    return changes;
  }
  
  /**
   * تشغيل دورة تعلم واحدة
   */
  private async runIteration(config: Partial<BacktestConfig>): Promise<{
    win_rate: number;
    total_trades: number;
    total_return: number;
    trades: BacktestTrade[];
  }> {
    const backtestConfig: Partial<BacktestConfig> = {
      ...config,
      parameters: {
        rsi_oversold: this.parameters.rsi_oversold,
        rsi_overbought: this.parameters.rsi_overbought,
        rsi_weight: this.parameters.rsi_weight,
        macd_weight: this.parameters.macd_weight,
        ma_weight: this.parameters.ma_weight,
        bollinger_weight: this.parameters.bollinger_weight,
        stop_loss_min: this.parameters.stop_loss_min,
        stop_loss_max: this.parameters.stop_loss_max,
        target_multiplier: this.parameters.target_multiplier,
        min_indicators_agree: this.parameters.min_indicators_agree
      }
    };
    
    const result = await runBacktest(backtestConfig);
    
    return {
      win_rate: result.win_rate,
      total_trades: result.total_trades,
      total_return: result.total_return,
      trades: result.trades
    };
  }
  
  /**
   * تشغيل التعلم التكراري الكامل
   */
  async runLearning(
    config: Partial<BacktestConfig> = {},
    onProgress?: (iteration: LearningIteration) => void
  ): Promise<LearningResult> {
    console.log(`[IterativeLearning] Starting with persona: ${this.persona}, target: ${this.targetWinRate}%`);
    
    this.iterations = [];
    this.improvementHistory = [];
    let bestWinRate = 0;
    let bestParameters = { ...this.parameters };
    
    for (let i = 1; i <= this.maxIterations; i++) {
      console.log(`[IterativeLearning] Iteration ${i}/${this.maxIterations}`);
      
      // تشغيل الـ backtest
      const result = await this.runIteration(config);
      
      // تحليل النتائج
      const analysis = this.analyzeLosses(result.trades);
      
      // تسجيل الدورة
      const iteration: LearningIteration = {
        iteration: i,
        parameters: { ...this.parameters },
        result: {
          win_rate: result.win_rate,
          total_trades: result.total_trades,
          total_return: result.total_return
        },
        changes_made: i === 1 ? ['البدء بالبرمترات القياسية'] : [],
        lessons: analysis.issues
      };
      
      this.iterations.push(iteration);
      this.improvementHistory.push(result.win_rate);
      
      // تحديث أفضل نتيجة
      if (result.win_rate > bestWinRate) {
        bestWinRate = result.win_rate;
        bestParameters = { ...this.parameters };
      }
      
      // استدعاء callback التقدم
      if (onProgress) {
        onProgress(iteration);
      }
      
      console.log(`[IterativeLearning] Win rate: ${result.win_rate.toFixed(1)}%, Best: ${bestWinRate.toFixed(1)}%`);
      
      // التحقق من الوصول للهدف
      if (result.win_rate >= this.targetWinRate) {
        console.log(`[IterativeLearning] 🎉 Target achieved! Win rate: ${result.win_rate.toFixed(1)}%`);
        return {
          success: true,
          target_achieved: true,
          final_win_rate: result.win_rate,
          target_win_rate: this.targetWinRate,
          total_iterations: i,
          iterations: this.iterations,
          best_parameters: this.parameters,
          improvement_history: this.improvementHistory
        };
      }
      
      // تطبيق التعديلات للدورة القادمة
      if (i < this.maxIterations) {
        const changes = this.applyAdjustments(analysis.suggestions);
        iteration.changes_made = changes;
      }
      
      // إضافة تأخير بسيط
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // لم نصل للهدف
    console.log(`[IterativeLearning] Max iterations reached. Best win rate: ${bestWinRate.toFixed(1)}%`);
    
    return {
      success: bestWinRate > 50,
      target_achieved: false,
      final_win_rate: bestWinRate,
      target_win_rate: this.targetWinRate,
      total_iterations: this.maxIterations,
      iterations: this.iterations,
      best_parameters: bestParameters,
      improvement_history: this.improvementHistory
    };
  }
  
  /**
   * الحصول على البرمترات الحالية
   */
  getParameters(): LearningParameters {
    return { ...this.parameters };
  }
  
  /**
   * تعيين برمترات جديدة
   */
  setParameters(params: Partial<LearningParameters>): void {
    this.parameters = { ...this.parameters, ...params };
  }
}

// ==================== HELPER FUNCTION ====================

export async function runIterativeLearning(options: {
  persona?: string;
  targetWinRate?: number;
  maxIterations?: number;
  startDate?: string;
  endDate?: string;
  onProgress?: (iteration: LearningIteration) => void;
}): Promise<LearningResult> {
  const engine = new IterativeLearningEngine(
    options.persona || 'balanced',
    options.targetWinRate || 75,
    options.maxIterations || 30
  );
  
  const config: Partial<BacktestConfig> = {};
  if (options.startDate) config.start_date = options.startDate;
  if (options.endDate) config.end_date = options.endDate;
  
  return await engine.runLearning(config, options.onProgress);
}
