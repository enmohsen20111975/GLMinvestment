/**
 * Unified Prediction System - نظام التوقعات الموحد
 * 
 * يجمع:
 * 1. أفضل البارامترات من التعلم التكراري
 * 2. الأحداث الخاصة (توزيعات، اكتتاب، أخبار)
 * 3. التحليل الفني المتقدم
 * 
 * الهدف: توقعات بنسبة نجاح 99-100%
 */

import { DEFAULT_PARAMETERS, type LearningParameters, getLearningProgress } from './intelligent-learning';
import { checkUpcomingEvents, adjustDecisionForEvents, type StockEvent } from './special-events';
import { db } from '@/lib/db';

// =================--- ENSURE TABLE EXISTS ---====================

let tableEnsured = false;

async function ensureOptimizedParametersTable(): Promise<void> {
  if (tableEnsured) return;
  
  try {
    await db.$executeRaw`
      CREATE TABLE IF NOT EXISTS OptimizedParameters (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        win_rate REAL NOT NULL,
        total_trades INTEGER NOT NULL,
        rsi_oversold REAL NOT NULL,
        rsi_overbought REAL NOT NULL,
        rsi_weight REAL NOT NULL,
        macd_weight REAL NOT NULL,
        ma_weight REAL NOT NULL,
        bollinger_weight REAL NOT NULL,
        stop_loss_min REAL NOT NULL,
        stop_loss_max REAL NOT NULL,
        target_multiplier REAL NOT NULL,
        confidence_threshold REAL NOT NULL,
        min_indicators_agree REAL NOT NULL,
        volume_weight REAL NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `;
    tableEnsured = true;
    console.log('[UnifiedPrediction] OptimizedParameters table ensured');
  } catch (error) {
    console.error('[UnifiedPrediction] Failed to create table:', error);
  }
}

// ==================== TYPES ====================

export interface PredictionResult {
  ticker: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  stop_loss: number;
  target_price: number;
  
  // Analysis breakdown
  technical_score: number;
  technical_reasoning: string[];
  
  // Event adjustments
  event_warnings: string[];
  event_opportunities: string[];
  event_adjustment: number;
  
  // Learning parameters used
  parameters_source: 'optimized' | 'default';
  parameters: LearningParameters;
  
  // Risk assessment
  risk_level: 'low' | 'medium' | 'high';
  risk_factors: string[];
  
  // Timestamps
  analyzed_at: string;
}

export interface ActiveParameters {
  id: string;
  name: string;
  win_rate: number;
  parameters: LearningParameters;
  is_active: boolean;
}

// =================--- LOAD OPTIMIZED PARAMETERS ---====================

let cachedParameters: ActiveParameters | null = null;
let cacheTime: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * الحصول على البارامترات الفعالة
 */
export async function getActiveParameters(): Promise<ActiveParameters> {
  const now = Date.now();
  
  // Ensure table exists
  await ensureOptimizedParametersTable();
  
  // Check cache
  if (cachedParameters && (now - cacheTime) < CACHE_TTL) {
    return cachedParameters;
  }
  
  try {
    // Try to load from OptimizedParameters table
    const result = await db.$queryRaw<ActiveParameters[]>`
      SELECT 
        id, name, win_rate, is_active,
        rsi_oversold, rsi_overbought, rsi_weight,
        macd_weight, ma_weight, bollinger_weight,
        stop_loss_min, stop_loss_max, target_multiplier,
        confidence_threshold, min_indicators_agree, volume_weight
      FROM OptimizedParameters
      WHERE is_active = 1
      ORDER BY win_rate DESC
      LIMIT 1
    `;
    
    if (result && result.length > 0) {
      const row = result[0] as Record<string, unknown>;
      cachedParameters = {
        id: row.id as string,
        name: row.name as string,
        win_rate: row.win_rate as number,
        is_active: Boolean(row.is_active),
        parameters: {
          rsi_oversold: row.rsi_oversold as number,
          rsi_overbought: row.rsi_overbought as number,
          rsi_weight: row.rsi_weight as number,
          macd_weight: row.macd_weight as number,
          ma_weight: row.ma_weight as number,
          bollinger_std: 2,
          bollinger_weight: row.bollinger_weight as number,
          stop_loss_min: row.stop_loss_min as number,
          stop_loss_max: row.stop_loss_max as number,
          target_multiplier: row.target_multiplier as number,
          confidence_threshold: row.confidence_threshold as number,
          min_indicators_agree: row.min_indicators_agree as number,
          volume_threshold: 1.5,
          volume_weight: row.volume_weight as number
        }
      };
      cacheTime = now;
      
      console.log(`[UnifiedPrediction] Using optimized parameters: ${cachedParameters.name} (${cachedParameters.win_rate}% win rate)`);
      return cachedParameters;
    }
  } catch (error) {
    console.log('[UnifiedPrediction] No optimized parameters found, using defaults');
  }
  
  // Also check current learning progress
  const learningProgress = getLearningProgress();
  if (learningProgress && learningProgress.best_win_rate > 80) {
    const params: ActiveParameters = {
      id: 'learning-current',
      name: 'Current Learning Session',
      win_rate: learningProgress.best_win_rate,
      is_active: true,
      parameters: learningProgress.best_parameters
    };
    cachedParameters = params;
    cacheTime = now;
    return params;
  }
  
  // Return defaults
  return {
    id: 'default',
    name: 'Default Parameters',
    win_rate: 0,
    is_active: true,
    parameters: DEFAULT_PARAMETERS
  };
}

/**
 * حفظ بارامترات محسنة جديدة
 */
export async function saveOptimizedParameters(
  name: string,
  winRate: number,
  totalTrades: number,
  parameters: LearningParameters
): Promise<string> {
  const id = `opt-${Date.now()}`;
  
  // Ensure table exists
  await ensureOptimizedParametersTable();
  
  try {
    // Deactivate all previous parameters
    await db.$executeRaw`UPDATE OptimizedParameters SET is_active = 0`;
    
    await db.$executeRaw`
      INSERT INTO OptimizedParameters (
        id, name, win_rate, total_trades,
        rsi_oversold, rsi_overbought, rsi_weight,
        macd_weight, ma_weight, bollinger_weight,
        stop_loss_min, stop_loss_max, target_multiplier,
        confidence_threshold, min_indicators_agree, volume_weight,
        is_active, created_at
      ) VALUES (
        ${id}, ${name}, ${winRate}, ${totalTrades},
        ${parameters.rsi_oversold}, ${parameters.rsi_overbought}, ${parameters.rsi_weight},
        ${parameters.macd_weight}, ${parameters.ma_weight}, ${parameters.bollinger_weight},
        ${parameters.stop_loss_min}, ${parameters.stop_loss_max}, ${parameters.target_multiplier},
        ${parameters.confidence_threshold}, ${parameters.min_indicators_agree}, ${parameters.volume_weight},
        1, datetime('now')
      )
    `;
    
    // Clear cache
    cachedParameters = null;
    
    console.log(`[UnifiedPrediction] Saved optimized parameters: ${name} (${winRate}%)`);
    return id;
    
  } catch (error) {
    console.error('[UnifiedPrediction] Failed to save parameters:', error);
    throw error;
  }
}

// =================--- TECHNICAL ANALYSIS ---====================

interface TechnicalData {
  price: number;
  rsi: number;
  macd_signal: 'bullish' | 'bearish' | 'neutral';
  ma_signal: 'above_all' | 'below_all' | 'mixed';
  bollinger_signal: 'above_upper' | 'below_lower' | 'neutral';
  atr_percent: number;
}

/**
 * حساب التحليل الفني
 */
function calculateTechnicalScore(
  tech: TechnicalData,
  params: LearningParameters
): {
  score: number;
  reasoning: string[];
  bullishCount: number;
  bearishCount: number;
} {
  let score = 50;
  const reasoning: string[] = [];
  let bullishCount = 0;
  let bearishCount = 0;
  
  // RSI Analysis
  if (tech.rsi <= params.rsi_oversold) {
    score += params.rsi_weight;
    reasoning.push(`RSI تشبع بيعي (${tech.rsi.toFixed(0)})`);
    bullishCount++;
  } else if (tech.rsi >= params.rsi_overbought) {
    score -= params.rsi_weight;
    reasoning.push(`RSI تشبع شرائي (${tech.rsi.toFixed(0)})`);
    bearishCount++;
  }
  
  // MACD Analysis
  if (tech.macd_signal === 'bullish') {
    score += params.macd_weight;
    reasoning.push('MACD إيجابي');
    bullishCount++;
  } else if (tech.macd_signal === 'bearish') {
    score -= params.macd_weight;
    reasoning.push('MACD سلبي');
    bearishCount++;
  }
  
  // MA Analysis
  if (tech.ma_signal === 'above_all') {
    score += params.ma_weight;
    reasoning.push('فوق كل المتوسطات');
    bullishCount++;
  } else if (tech.ma_signal === 'below_all') {
    score -= params.ma_weight;
    reasoning.push('تحت كل المتوسطات');
    bearishCount++;
  }
  
  // Bollinger Analysis
  if (tech.bollinger_signal === 'below_lower') {
    score += params.bollinger_weight;
    reasoning.push('تحت النطاق السفلي للبولينجر');
    bullishCount++;
  } else if (tech.bollinger_signal === 'above_upper') {
    score -= params.bollinger_weight;
    reasoning.push('فوق النطاق العلوي للبولينجر');
    bearishCount++;
  }
  
  return { score, reasoning, bullishCount, bearishCount };
}

// =================--- MAIN PREDICTION FUNCTION ---====================

/**
 * توقع موحد لسهم واحد
 */
export async function makeUnifiedPrediction(
  ticker: string,
  tech: TechnicalData,
  options: {
    skipEvents?: boolean;
    customParams?: LearningParameters;
  } = {}
): Promise<PredictionResult> {
  // Load parameters
  const activeParams = options.customParams 
    ? { id: 'custom', name: 'Custom', win_rate: 0, is_active: true, parameters: options.customParams }
    : await getActiveParameters();
  
  const params = activeParams.parameters;
  
  // Calculate technical score
  const { score: technicalScore, reasoning, bullishCount, bearishCount } = calculateTechnicalScore(tech, params);
  
  // Determine initial action
  let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  if (bullishCount >= params.min_indicators_agree && technicalScore >= params.confidence_threshold) {
    action = 'BUY';
  } else if (bearishCount >= params.min_indicators_agree && technicalScore <= 100 - params.confidence_threshold) {
    action = 'SELL';
  }
  
  let confidence = technicalScore;
  const riskFactors: string[] = [];
  
  // Event analysis
  let eventWarnings: string[] = [];
  let eventOpportunities: string[] = [];
  let eventAdjustment = 0;
  
  if (!options.skipEvents) {
    try {
      const events = await checkUpcomingEvents(ticker, 14);
      
      if (events.length > 0) {
        const adjusted = adjustDecisionForEvents(ticker, confidence, action, events);
        
        confidence = adjusted.adjusted_confidence;
        action = adjusted.adjusted_action;
        eventWarnings = adjusted.event_warnings;
        eventOpportunities = adjusted.event_opportunities;
        eventAdjustment = adjusted.adjusted_confidence - technicalScore;
      }
    } catch (error) {
      console.log(`[UnifiedPrediction] Event check failed for ${ticker}`);
    }
  }
  
  // Risk assessment
  const riskLevel: 'low' | 'medium' | 'high' = 
    confidence >= 75 ? 'low' : confidence >= 60 ? 'medium' : 'high';
  
  if (tech.rsi < 25 || tech.rsi > 75) {
    riskFactors.push('RSI في منطقة متطرفة');
  }
  
  if (tech.atr_percent > 4) {
    riskFactors.push('تذبذب عالي في السعر');
  }
  
  if (eventWarnings.length > 0) {
    riskFactors.push('أحداث خاصة تؤثر على السهم');
  }
  
  // Calculate stop loss and target
  const stopLossPercent = Math.max(params.stop_loss_min, Math.min(params.stop_loss_max, tech.atr_percent * 1.5));
  const targetPercent = stopLossPercent * params.target_multiplier;
  
  let stopLoss: number, targetPrice: number;
  if (action === 'BUY') {
    stopLoss = tech.price * (1 - stopLossPercent / 100);
    targetPrice = tech.price * (1 + targetPercent / 100);
  } else if (action === 'SELL') {
    stopLoss = tech.price * (1 + stopLossPercent / 100);
    targetPrice = tech.price * (1 - targetPercent / 100);
  } else {
    stopLoss = tech.price * (1 - stopLossPercent / 100);
    targetPrice = tech.price * (1 + targetPercent / 100);
  }
  
  return {
    ticker,
    action,
    confidence: Math.round(confidence),
    stop_loss: Math.round(stopLoss * 100) / 100,
    target_price: Math.round(targetPrice * 100) / 100,
    
    technical_score: Math.round(technicalScore),
    technical_reasoning: reasoning,
    
    event_warnings: eventWarnings,
    event_opportunities: eventOpportunities,
    event_adjustment: eventAdjustment,
    
    parameters_source: activeParams.id === 'default' ? 'default' : 'optimized',
    parameters: params,
    
    risk_level: riskLevel,
    risk_factors: riskFactors,
    
    analyzed_at: new Date().toISOString()
  };
}

// =================--- BATCH PREDICTION ---====================

/**
 * توقعات متعددة
 */
export async function makeBatchPredictions(
  stocks: Array<{ ticker: string; tech: TechnicalData }>
): Promise<PredictionResult[]> {
  const results: PredictionResult[] = [];
  
  for (const stock of stocks) {
    try {
      const prediction = await makeUnifiedPrediction(stock.ticker, stock.tech);
      results.push(prediction);
    } catch (error) {
      console.error(`[UnifiedPrediction] Failed for ${stock.ticker}:`, error);
    }
  }
  
  return results;
}

// =================--- EXPORT ---====================

export const UnifiedPrediction = {
  getActiveParameters,
  saveOptimizedParameters,
  makeUnifiedPrediction,
  makeBatchPredictions
};
