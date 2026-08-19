/**
 * مخزن بارامترات التعلم - Learning Parameters Store
 * 
 * يحفظ أفضل البارامترات من التعلم التكراري
 * ويستخدمها في التحليل والتوقعات الفعلية
 */

import { db } from '@/lib/db';

// ==================== TYPES ====================

export interface OptimizedParameters {
  id: string;
  name: string;
  win_rate: number;
  total_trades: number;
  created_at: Date;
  
  // RSI Parameters
  rsi_oversold: number;
  rsi_overbought: number;
  rsi_weight: number;
  
  // MACD Parameters
  macd_weight: number;
  
  // Moving Averages
  ma_weight: number;
  
  // Bollinger
  bollinger_weight: number;
  
  // Risk Management
  stop_loss_min: number;
  stop_loss_max: number;
  target_multiplier: number;
  
  // Entry Conditions
  confidence_threshold: number;
  min_indicators_agree: number;
  
  // Volume
  volume_weight: number;
  
  // Status
  is_active: boolean;
}

export interface LearningParametersInput {
  win_rate: number;
  total_trades: number;
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
  volume_weight: number;
}

// ==================== DEFAULT PARAMETERS ====================

export const DEFAULT_OPTIMIZED_PARAMS: LearningParametersInput = {
  win_rate: 0,
  total_trades: 0,
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
  min_indicators_agree: 2,
  volume_weight: 5
};

// ==================== DATABASE OPERATIONS ====================

/**
 * حفظ بارامترات جديدة
 */
export async function saveOptimizedParameters(
  params: LearningParametersInput,
  name: string = 'Optimized Parameters'
): Promise<OptimizedParameters | null> {
  try {
    // تعطيل جميع البارامترات السابقة
    await db.$executeRaw`
      UPDATE optimized_parameters 
      SET is_active = false
    `;
    
    // إضافة البارامترات الجديدة
    const result = await db.$queryRaw<OptimizedParameters[]>`
      INSERT INTO optimized_parameters (
        id, name, win_rate, total_trades,
        rsi_oversold, rsi_overbought, rsi_weight,
        macd_weight, ma_weight, bollinger_weight,
        stop_loss_min, stop_loss_max, target_multiplier,
        confidence_threshold, min_indicators_agree, volume_weight,
        is_active, created_at
      ) VALUES (
        LOWER(HEX(RANDOMBLOB(16))),
        ${name},
        ${params.win_rate},
        ${params.total_trades},
        ${params.rsi_oversold},
        ${params.rsi_overbought},
        ${params.rsi_weight},
        ${params.macd_weight},
        ${params.ma_weight},
        ${params.bollinger_weight},
        ${params.stop_loss_min},
        ${params.stop_loss_max},
        ${params.target_multiplier},
        ${params.confidence_threshold},
        ${params.min_indicators_agree},
        ${params.volume_weight},
        true,
        datetime('now')
      )
      RETURNING *
    `;
    
    console.log(`[ParamsStore] Saved new parameters with win_rate: ${params.win_rate}%`);
    return result[0] || null;
  } catch (error) {
    console.error('[ParamsStore] Error saving parameters:', error);
    return null;
  }
}

/**
 * الحصول على البارامترات النشطة
 */
export async function getActiveParameters(): Promise<OptimizedParameters | null> {
  try {
    const result = await db.$queryRaw<OptimizedParameters[]>`
      SELECT * FROM optimized_parameters 
      WHERE is_active = true 
      ORDER BY created_at DESC 
      LIMIT 1
    `;
    
    return result[0] || null;
  } catch (error) {
    console.error('[ParamsStore] Error getting active parameters:', error);
    return null;
  }
}

/**
 * الحصول على جميع البارامترات المحفوظة
 */
export async function getAllSavedParameters(): Promise<OptimizedParameters[]> {
  try {
    return await db.$queryRaw<OptimizedParameters[]>`
      SELECT * FROM optimized_parameters 
      ORDER BY win_rate DESC, created_at DESC
    `;
  } catch (error) {
    console.error('[ParamsStore] Error getting all parameters:', error);
    return [];
  }
}

/**
 * تفعيل بارامترات معينة
 */
export async function activateParameters(id: string): Promise<boolean> {
  try {
    // تعطيل جميع البارامترات
    await db.$executeRaw`
      UPDATE optimized_parameters 
      SET is_active = false
    `;
    
    // تفعيل البارامترات المحددة
    await db.$executeRaw`
      UPDATE optimized_parameters 
      SET is_active = true 
      WHERE id = ${id}
    `;
    
    console.log(`[ParamsStore] Activated parameters: ${id}`);
    return true;
  } catch (error) {
    console.error('[ParamsStore] Error activating parameters:', error);
    return false;
  }
}

/**
 * حذف بارامترات
 */
export async function deleteParameters(id: string): Promise<boolean> {
  try {
    await db.$executeRaw`
      DELETE FROM optimized_parameters 
      WHERE id = ${id}
    `;
    
    console.log(`[ParamsStore] Deleted parameters: ${id}`);
    return true;
  } catch (error) {
    console.error('[ParamsStore] Error deleting parameters:', error);
    return false;
  }
}

// ==================== CONVERSION HELPERS ====================

/**
 * تحويل من صيغة التعلم إلى صيغة الحفظ
 */
export function fromLearningParams(
  params: {
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
    volume_weight: number;
  },
  winRate: number,
  totalTrades: number
): LearningParametersInput {
  return {
    win_rate: winRate,
    total_trades: totalTrades,
    rsi_oversold: params.rsi_oversold,
    rsi_overbought: params.rsi_overbought,
    rsi_weight: params.rsi_weight,
    macd_weight: params.macd_weight,
    ma_weight: params.ma_weight,
    bollinger_weight: params.bollinger_weight,
    stop_loss_min: params.stop_loss_min,
    stop_loss_max: params.stop_loss_max,
    target_multiplier: params.target_multiplier,
    confidence_threshold: params.confidence_threshold,
    min_indicators_agree: params.min_indicators_agree,
    volume_weight: params.volume_weight
  };
}

/**
 * تحويل من صيغة الحفظ إلى صيقة Backtest
 */
export function toBacktestParams(params: OptimizedParameters): {
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
  volume_weight: number;
} {
  return {
    rsi_oversold: params.rsi_oversold,
    rsi_overbought: params.rsi_overbought,
    rsi_weight: params.rsi_weight,
    macd_weight: params.macd_weight,
    ma_weight: params.ma_weight,
    bollinger_weight: params.bollinger_weight,
    stop_loss_min: params.stop_loss_min,
    stop_loss_max: params.stop_loss_max,
    target_multiplier: params.target_multiplier,
    confidence_threshold: params.confidence_threshold,
    min_indicators_agree: params.min_indicators_agree,
    volume_weight: params.volume_weight
  };
}

// ==================== MEMORY CACHE ====================

let cachedParams: OptimizedParameters | null = null;
let cacheTime: number = 0;
const CACHE_TTL = 60 * 1000; // دقيقة واحدة

/**
 * الحصول على البارامترات مع التخزين المؤقت
 */
export async function getCachedParameters(): Promise<OptimizedParameters | null> {
  const now = Date.now();
  
  if (cachedParams && (now - cacheTime) < CACHE_TTL) {
    return cachedParams;
  }
  
  cachedParams = await getActiveParameters();
  cacheTime = now;
  
  return cachedParams;
}

/**
 * تحديث التخزين المؤقت
 */
export function invalidateParamsCache(): void {
  cachedParams = null;
  cacheTime = 0;
}
