/**
 * Stock Movement Classification
 * تصنيف الأسهم حسب الحركة
 *
 * الفئات:
 * - ACTIVE (حية): حجم تداول عالي + تقلبات مستمرة
 * - SLOW (بطيئة): حجم تداول قليل + تقلبات قليلة
 * - DEAD (ميتة): نزول مستمر بدون ارتفاع + قربت تتمسح
 */

import { ensureInitialized, getLightDb, getHeavyDb, isHeavyDbAvailable } from '@/lib/egx-db';

// ==================== TYPES ====================

export type StockMovementCategory = 'active' | 'slow' | 'dead' | 'unknown';

export interface StockMovementInfo {
  ticker: string;
  name: string;
  name_ar: string;
  category: StockMovementCategory;
  score: number; // 0-100
  volume_rank: number; // 1-100
  volatility_score: number; // 0-100
  trend_direction: 'up' | 'down' | 'sideways';
  days_declining: number;
  days_rising: number;
  avg_volume_30d: number;
  current_volume: number;
  price_change_30d: number;
  price_change_7d: number;
  last_update: string;
  reasons: string[];
}

export interface MovementClassificationResult {
  total_stocks: number;
  active_count: number;
  slow_count: number;
  dead_count: number;
  unknown_count: number;
  stocks: StockMovementInfo[];
  last_classified: string;
}

// ==================== THRESHOLDS ====================

const THRESHOLDS = {
  // Active stocks
  MIN_VOLUME_FOR_ACTIVE: 100000, // Minimum 100K volume
  MIN_VOLATILITY_FOR_ACTIVE: 3, // Minimum 3% price change

  // Dead stocks
  MAX_VOLUME_FOR_DEAD: 10000, // Less than 10K volume
  MIN_DAYS_DECLINING_FOR_DEAD: 10, // 10+ days of decline
  MIN_PRICE_DECLINE_FOR_DEAD: 20, // 20%+ decline

  // Slow stocks
  MAX_VOLUME_FOR_SLOW: 50000, // Less than 50K volume
  MAX_VOLATILITY_FOR_SLOW: 2, // Less than 2% price change
};

// ==================== CLASSIFICATION FUNCTIONS ====================

/**
 * Calculate volume percentile rank (1-100)
 */
function calculateVolumeRank(volume: number, allVolumes: number[]): number {
  if (allVolumes.length === 0) return 50;
  const sorted = [...allVolumes].sort((a, b) => a - b);
  const index = sorted.findIndex(v => v >= volume);
  return Math.round(((index === -1 ? sorted.length : index) / sorted.length) * 100);
}

/**
 * Calculate volatility from price history
 */
function calculateVolatility(prices: { high: number; low: number; close: number }[]): number {
  if (prices.length < 2) return 0;

  let totalRange = 0;
  for (const p of prices) {
    if (p.close > 0) {
      totalRange += ((p.high - p.low) / p.close) * 100;
    }
  }
  return prices.length > 0 ? totalRange / prices.length : 0;
}

/**
 * Count consecutive declining/rising days
 */
function countTrendDays(prices: { close: number; date: string }[]): { declining: number; rising: number } {
  if (prices.length < 2) return { declining: 0, rising: 0 };

  let declining = 0;
  let rising = 0;

  for (let i = 1; i < prices.length && i < 30; i++) {
    if (prices[i].close < prices[i - 1].close) {
      if (rising === 0) declining++;
    } else if (prices[i].close > prices[i - 1].close) {
      if (declining === 0) rising++;
    }
  }

  return { declining, rising };
}

/**
 * Classify a single stock
 */
function classifyStock(
  stock: {
    ticker: string;
    name: string;
    name_ar: string;
    current_price: number;
    previous_close: number;
    volume: number;
    last_update: string;
  },
  priceHistory: { date: string; close: number; high: number; low: number }[],
  allVolumes: number[]
): StockMovementInfo {
  const reasons: string[] = [];
  let category: StockMovementCategory = 'unknown';
  let score = 50;
  let trendDirection: 'up' | 'down' | 'sideways' = 'sideways';

  // Calculate metrics
  const volumeRank = calculateVolumeRank(stock.volume || 0, allVolumes);
  const volatility = priceHistory.length > 1 ? calculateVolatility(priceHistory) : 0;
  const trendDays = countTrendDays(priceHistory.map(p => ({ close: p.close, date: p.date })));

  // Calculate price changes
  let priceChange30d = 0;
  let priceChange7d = 0;
  if (priceHistory.length >= 7) {
    const latest = priceHistory[0].close;
    const day7 = priceHistory[Math.min(6, priceHistory.length - 1)].close;
    priceChange7d = day7 > 0 ? ((latest - day7) / day7) * 100 : 0;
  }
  if (priceHistory.length >= 30) {
    const latest = priceHistory[0].close;
    const day30 = priceHistory[29].close;
    priceChange30d = day30 > 0 ? ((latest - day30) / day30) * 100 : 0;
  }

  // Determine trend direction
  if (trendDays.rising > trendDays.declining * 2) {
    trendDirection = 'up';
  } else if (trendDays.declining > trendDays.rising * 2) {
    trendDirection = 'down';
  }

  // Calculate average volume
  const avgVolume30d = priceHistory.length > 0
    ? priceHistory.reduce((sum, p) => sum + (stock.volume || 0), 0) / priceHistory.length
    : stock.volume || 0;

  // CLASSIFICATION LOGIC

  // Check for DEAD stock
  if (
    (stock.volume || 0) < THRESHOLDS.MAX_VOLUME_FOR_DEAD &&
    trendDays.declining >= THRESHOLDS.MIN_DAYS_DECLINING_FOR_DEAD &&
    priceChange30d < -THRESHOLDS.MIN_PRICE_DECLINE_FOR_DEAD
  ) {
    category = 'dead';
    score = 10;
    reasons.push('حجم تداول منخفض جداً');
    reasons.push(`نزول مستمر لمدة ${trendDays.declining} يوم`);
    reasons.push(`انخفاض ${Math.abs(priceChange30d).toFixed(1)}% خلال 30 يوم`);
  }
  // Check for ACTIVE stock
  else if (
    (stock.volume || 0) >= THRESHOLDS.MIN_VOLUME_FOR_ACTIVE ||
    volatility >= THRESHOLDS.MIN_VOLATILITY_FOR_ACTIVE
  ) {
    category = 'active';
    score = 80 + Math.min(20, volumeRank / 5);
    if ((stock.volume || 0) >= THRESHOLDS.MIN_VOLUME_FOR_ACTIVE) {
      reasons.push('حجم تداول عالي');
    }
    if (volatility >= THRESHOLDS.MIN_VOLATILITY_FOR_ACTIVE) {
      reasons.push('تقلبات سعرية نشطة');
    }
    if (volumeRank >= 80) {
      reasons.push('من أكثر 20% الأسهم تداولاً');
    }
  }
  // Check for SLOW stock
  else if (
    (stock.volume || 0) < THRESHOLDS.MAX_VOLUME_FOR_SLOW &&
    volatility < THRESHOLDS.MAX_VOLATILITY_FOR_SLOW
  ) {
    category = 'slow';
    score = 30;
    reasons.push('حجم تداول قليل');
    reasons.push('تقلبات سعرية محدودة');
  }
  // Default classification based on volume rank
  else {
    if (volumeRank >= 60) {
      category = 'active';
      score = 60 + volumeRank * 0.3;
      reasons.push('حجم تداول متوسط-عالي');
    } else if (volumeRank >= 30) {
      category = 'slow';
      score = 40;
      reasons.push('حجم تداول متوسط-منخفض');
    } else {
      category = 'slow';
      score = 25;
      reasons.push('حجم تداول منخفض');
    }
  }

  return {
    ticker: stock.ticker,
    name: stock.name || '',
    name_ar: stock.name_ar || '',
    category,
    score: Math.round(score),
    volume_rank: volumeRank,
    volatility_score: Math.round(volatility * 10),
    trend_direction: trendDirection,
    days_declining: trendDays.declining,
    days_rising: trendDays.rising,
    avg_volume_30d: Math.round(avgVolume30d),
    current_volume: stock.volume || 0,
    price_change_30d: Math.round(priceChange30d * 100) / 100,
    price_change_7d: Math.round(priceChange7d * 100) / 100,
    last_update: stock.last_update || new Date().toISOString(),
    reasons,
  };
}

// ==================== MAIN CLASSIFICATION FUNCTION ====================

/**
 * Classify all stocks by movement category
 */
export async function classifyStocksByMovement(): Promise<MovementClassificationResult> {
  await ensureInitialized();

  const lightDb = getLightDb();
  const stocks: StockMovementInfo[] = [];

  // Get all active stocks
  const allStocks = lightDb.prepare(`
    SELECT ticker, name, name_ar, current_price, previous_close, volume, last_update
    FROM stocks
    WHERE is_active = 1
  `).all() as {
    ticker: string;
    name: string;
    name_ar: string;
    current_price: number;
    previous_close: number;
    volume: number;
    last_update: string;
  }[];

  // Get all volumes for ranking
  const allVolumes = allStocks.map(s => s.volume || 0).filter(v => v > 0);

  // Try to get price history from heavy DB
  let heavyDb: ReturnType<typeof getHeavyDb> | null = null;
  try {
    if (isHeavyDbAvailable()) {
      heavyDb = getHeavyDb();
    }
  } catch {
    // Heavy DB not available
  }

  // Classify each stock
  for (const stock of allStocks) {
    // Get price history
    let priceHistory: { date: string; close: number; high: number; low: number }[] = [];

    if (heavyDb) {
      try {
        // Get stock_id from heavy DB
        const stockRow = heavyDb.prepare('SELECT id FROM stocks WHERE ticker = ? COLLATE NOCASE').get(stock.ticker) as { id: number } | undefined;
        if (stockRow) {
          priceHistory = heavyDb.prepare(`
            SELECT date, close_price as close, high_price as high, low_price as low
            FROM stock_price_history
            WHERE stock_id = ?
            ORDER BY date DESC
            LIMIT 30
          `).all(stockRow.id) as { date: string; close: number; high: number; low: number }[];
        }
      } catch {
        // Ignore history fetch errors
      }
    }

    // If no history, use current price as fallback
    if (priceHistory.length === 0 && stock.current_price > 0) {
      priceHistory = [{
        date: stock.last_update || new Date().toISOString(),
        close: stock.current_price,
        high: stock.current_price,
        low: stock.current_price,
      }];
    }

    const classification = classifyStock(stock, priceHistory, allVolumes);
    stocks.push(classification);
  }

  // Sort by score descending
  stocks.sort((a, b) => b.score - a.score);

  // Count categories
  const activeCount = stocks.filter(s => s.category === 'active').length;
  const slowCount = stocks.filter(s => s.category === 'slow').length;
  const deadCount = stocks.filter(s => s.category === 'dead').length;
  const unknownCount = stocks.filter(s => s.category === 'unknown').length;

  return {
    total_stocks: stocks.length,
    active_count: activeCount,
    slow_count: slowCount,
    dead_count: deadCount,
    unknown_count: unknownCount,
    stocks,
    last_classified: new Date().toISOString(),
  };
}

/**
 * Get stocks by category
 */
export function getStocksByCategory(
  classification: MovementClassificationResult,
  category: StockMovementCategory
): StockMovementInfo[] {
  return classification.stocks.filter(s => s.category === category);
}

/**
 * Get top active stocks (for priority processing)
 */
export function getTopActiveStocks(
  classification: MovementClassificationResult,
  limit: number = 50
): StockMovementInfo[] {
  return classification.stocks
    .filter(s => s.category === 'active')
    .slice(0, limit);
}

/**
 * Get stocks to ignore (dead stocks)
 */
export function getDeadStocks(
  classification: MovementClassificationResult
): StockMovementInfo[] {
  return classification.stocks.filter(s => s.category === 'dead');
}
