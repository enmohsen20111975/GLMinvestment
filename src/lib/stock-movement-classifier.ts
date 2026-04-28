/**
 * Stock Movement Classifier
 * 
 * تصنيف الأسهم حسب حركتها خلال السنة الماضية:
 * - alive: أسهم بتتحرك باستمرار (جيدة للتداول)
 * - slow: أسهم حركتها بطيئة (تحتاج صبر)
 * - dead: أسهم شبه ثابتة/ميتة (تجنبها)
 */

import type { Database as SqliteDatabase } from 'sql.js';

export type StockMovementType = 'alive' | 'slow' | 'dead' | 'unknown';

export interface StockMovementInfo {
  ticker: string;
  movement_type: StockMovementType;
  movement_score: number; // 0-100
  avg_daily_change: number;
  trading_days_count: number;
  total_volume: number;
  avg_volume: number;
  price_volatility: number;
  trend_direction: 'up' | 'down' | 'sideways';
  days_since_last_trade: number;
  classification_reason: string;
  classification_reason_ar: string;
}

// Thresholds for classification
const THRESHOLDS = {
  // Minimum trading days in a year (252 trading days)
  min_trading_days: 50,
  
  // Average daily change percentage
  alive_min_daily_change: 1.0, // At least 1% average daily movement
  dead_max_daily_change: 0.3,  // Less than 0.3% average daily movement
  
  // Price volatility (standard deviation of daily returns)
  alive_min_volatility: 1.5,
  dead_max_volatility: 0.5,
  
  // Days since last trade
  dead_min_inactive_days: 30,
  
  // Volume indicators
  alive_min_avg_volume_ratio: 1.0, // Average volume relative to market
};

/**
 * Calculate movement classification for a single stock
 */
export function classifyStockMovement(
  priceHistory: Array<{ date: string; close: number; volume: number }>,
  ticker: string
): StockMovementInfo {
  const defaultResult: StockMovementInfo = {
    ticker,
    movement_type: 'unknown',
    movement_score: 50,
    avg_daily_change: 0,
    trading_days_count: 0,
    total_volume: 0,
    avg_volume: 0,
    price_volatility: 0,
    trend_direction: 'sideways',
    days_since_last_trade: 0,
    classification_reason: 'Insufficient data',
    classification_reason_ar: 'بيانات غير كافية',
  };

  if (!priceHistory || priceHistory.length < THRESHOLDS.min_trading_days) {
    return {
      ...defaultResult,
      movement_type: 'unknown',
      classification_reason: `Only ${priceHistory?.length || 0} trading days`,
      classification_reason_ar: `فقط ${priceHistory?.length || 0} يوم تداول`,
    };
  }

  // Sort by date ascending
  const sorted = [...priceHistory].sort((a, b) => 
    new Date(a.date).getTime() - new Date(b.date).getTime()
  );

  // Calculate daily changes
  const dailyChanges: number[] = [];
  const dailyReturns: number[] = [];
  let totalVolume = 0;

  for (let i = 1; i < sorted.length; i++) {
    const prevClose = sorted[i - 1].close;
    const currClose = sorted[i].close;
    const currVolume = sorted[i].volume || 0;
    
    if (prevClose > 0 && currClose > 0) {
      const change = Math.abs((currClose - prevClose) / prevClose) * 100;
      dailyChanges.push(change);
      
      const returnVal = (currClose - prevClose) / prevClose;
      dailyReturns.push(returnVal);
      
      totalVolume += currVolume;
    }
  }

  const tradingDays = sorted.length;
  const avgDailyChange = dailyChanges.length > 0 
    ? dailyChanges.reduce((a, b) => a + b, 0) / dailyChanges.length 
    : 0;
  
  const avgVolume = totalVolume / tradingDays || 0;

  // Calculate volatility (standard deviation of returns)
  let volatility = 0;
  if (dailyReturns.length > 1) {
    const mean = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (dailyReturns.length - 1);
    volatility = Math.sqrt(variance) * 100; // Convert to percentage
  }

  // Determine trend direction
  const firstClose = sorted[0].close;
  const lastClose = sorted[sorted.length - 1].close;
  const overallChange = firstClose > 0 ? ((lastClose - firstClose) / firstClose) * 100 : 0;
  
  let trendDirection: 'up' | 'down' | 'sideways';
  if (overallChange > 10) trendDirection = 'up';
  else if (overallChange < -10) trendDirection = 'down';
  else trendDirection = 'sideways';

  // Check days since last trade
  const lastDate = new Date(sorted[sorted.length - 1].date);
  const today = new Date();
  const daysSinceLastTrade = Math.floor((today.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24));

  // Calculate movement score (0-100)
  let movementScore = 0;
  
  // Score based on average daily change (0-40 points)
  movementScore += Math.min(40, avgDailyChange * 20);
  
  // Score based on volatility (0-30 points)
  movementScore += Math.min(30, volatility * 10);
  
  // Score based on trading frequency (0-20 points)
  const tradingFrequency = tradingDays / 252; // Relative to full year
  movementScore += tradingFrequency * 20;
  
  // Score based on recency (0-10 points)
  if (daysSinceLastTrade <= 1) movementScore += 10;
  else if (daysSinceLastTrade <= 3) movementScore += 7;
  else if (daysSinceLastTrade <= 7) movementScore += 4;
  else if (daysSinceLastTrade > 30) movementScore -= 20;

  movementScore = Math.max(0, Math.min(100, movementScore));

  // Classify the stock
  let movementType: StockMovementType;
  let reason: string;
  let reasonAr: string;

  // Check for dead stock first
  if (daysSinceLastTrade > THRESHOLDS.dead_min_inactive_days) {
    movementType = 'dead';
    reason = `No trading activity for ${daysSinceLastTrade} days`;
    reasonAr = `لا يوجد نشاط تداول منذ ${daysSinceLastTrade} يوم`;
  }
  else if (avgDailyChange < THRESHOLDS.dead_max_daily_change && volatility < THRESHOLDS.dead_max_volatility) {
    movementType = 'dead';
    reason = `Very low movement: ${avgDailyChange.toFixed(2)}% avg daily change`;
    reasonAr = `حركة ضعيفة جداً: متوسط التغير اليومي ${avgDailyChange.toFixed(2)}%`;
  }
  // Check for alive stock
  else if (avgDailyChange >= THRESHOLDS.alive_min_daily_change && volatility >= THRESHOLDS.alive_min_volatility) {
    movementType = 'alive';
    reason = `Active stock: ${avgDailyChange.toFixed(2)}% avg daily change, ${volatility.toFixed(2)}% volatility`;
    reasonAr = `سهم نشط: متوسط التغير اليومي ${avgDailyChange.toFixed(2)}%، تذبذب ${volatility.toFixed(2)}%`;
  }
  // Slow stock
  else {
    movementType = 'slow';
    reason = `Moderate movement: ${avgDailyChange.toFixed(2)}% avg daily change`;
    reasonAr = `حركة متوسطة: متوسط التغير اليومي ${avgDailyChange.toFixed(2)}%`;
  }

  return {
    ticker,
    movement_type: movementType,
    movement_score: Math.round(movementScore),
    avg_daily_change: Number(avgDailyChange.toFixed(4)),
    trading_days_count: tradingDays,
    total_volume: totalVolume,
    avg_volume: Math.round(avgVolume),
    price_volatility: Number(volatility.toFixed(4)),
    trend_direction: trendDirection,
    days_since_last_trade: daysSinceLastTrade,
    classification_reason: reason,
    classification_reason_ar: reasonAr,
  };
}

/**
 * Batch classify all stocks
 */
export function classifyAllStocks(
  db: SqliteDatabase,
  stockIds: Array<{ id: number; ticker: string }>
): Map<string, StockMovementInfo> {
  const results = new Map<string, StockMovementInfo>();

  for (const { id, ticker } of stockIds) {
    try {
      // Get last year of price history
      const rows = db.exec(`
        SELECT date, close_price as close, volume 
        FROM stock_price_history 
        WHERE stock_id = ? 
        ORDER BY date DESC 
        LIMIT 252
      `, [id]);

      if (rows.length === 0 || !rows[0].values) continue;

      const history = rows[0].values.map((row) => ({
        date: String(row[0]),
        close: Number(row[1]) || 0,
        volume: Number(row[2]) || 0,
      }));

      const classification = classifyStockMovement(history, ticker);
      results.set(ticker, classification);
    } catch (err) {
      console.error(`[classifyAllStocks] Error for ${ticker}:`, err);
    }
  }

  return results;
}

/**
 * Get movement type label in Arabic
 */
export function getMovementLabelAr(type: StockMovementType): string {
  switch (type) {
    case 'alive': return 'نشط';
    case 'slow': return 'بطيء';
    case 'dead': return 'ميت';
    default: return 'غير معروف';
  }
}

/**
 * Get movement type color
 */
export function getMovementColor(type: StockMovementType): string {
  switch (type) {
    case 'alive': return 'text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30';
    case 'slow': return 'text-amber-600 bg-amber-100 dark:text-amber-400 dark:bg-amber-900/30';
    case 'dead': return 'text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/30';
    default: return 'text-gray-600 bg-gray-100 dark:text-gray-400 dark:bg-gray-900/30';
  }
}

/**
 * Get recommended action based on movement type
 */
export function getMovementRecommendation(type: StockMovementType): { action: string; action_ar: string } {
  switch (type) {
    case 'alive':
      return { 
        action: 'Good for active trading', 
        action_ar: 'مناسب للتداول النشط' 
      };
    case 'slow':
      return { 
        action: 'Requires patience, suitable for long-term', 
        action_ar: 'يحتاج صبر، مناسب للمدى الطويل' 
      };
    case 'dead':
      return { 
        action: 'Avoid - no meaningful movement', 
        action_ar: 'تجنب - لا توجد حركة معنوية' 
      };
    default:
      return { 
        action: 'Insufficient data', 
        action_ar: 'بيانات غير كافية' 
      };
  }
}
