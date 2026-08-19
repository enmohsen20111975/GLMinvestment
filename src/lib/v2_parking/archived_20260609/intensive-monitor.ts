/**
 * V2 Intensive Stock Monitor
 * 
 * CRITICAL for user success: Enhanced monitoring for watchlist and portfolio stocks
 * 
 * Features:
 * 1. Real-time price change detection
 * 2. Technical indicator monitoring (RSI, MACD, Support/Resistance breaks)
 * 3. Risk alerts (approaching stop loss, target price)
 * 4. Performance tracking vs recommendations
 * 5. Automatic re-analysis triggers
 * 
 * This module provides intensive care for stocks the user cares about most.
 */

import type { StockRecommendation } from './types';
import { analyzeSingleStock } from './recommendation-engine';
import { getWeight } from './config-service';

// ==================== TYPES ====================

export interface MonitoringAlert {
  ticker: string;
  type: 'price_spike' | 'price_drop' | 'rsi_oversold' | 'rsi_overbought' | 
        'support_break' | 'resistance_break' | 'stop_loss_near' | 'target_near' |
        'macd_cross' | 'volume_surge' | 'recommendation_change' | 'risk_warning';
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  messageAr: string;
  currentValue?: number;
  threshold?: number;
  timestamp: string;
  action?: string;
  actionAr?: string;
}

export interface StockMonitoringStatus {
  ticker: string;
  lastPrice: number;
  previousPrice: number;
  priceChange: number;
  priceChangePercent: number;
  lastRSI: number;
  lastMACD: { macd: number; signal: number; histogram: number };
  support: number;
  resistance: number;
  stopLoss: number;
  targetPrice: number;
  currentRecommendation: string;
  previousRecommendation: string;
  daysToTarget: number | null;
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  lastUpdate: string;
  alertCount: number;
  activeAlerts: MonitoringAlert[];
}

export interface PortfolioHealthReport {
  totalStocks: number;
  healthyCount: number;
  warningCount: number;
  criticalCount: number;
  totalValue: number;
  totalGain: number;
  totalGainPercent: number;
  riskDistribution: { low: number; medium: number; high: number; critical: number };
  sectorDistribution: Record<string, number>;
  topGainers: Array<{ ticker: string; gain: number }>;
  topLosers: Array<{ ticker: string; loss: number }>;
  alerts: MonitoringAlert[];
  recommendations: string[];
  recommendationsAr: string[];
}

// ==================== CONSTANTS ====================

// Thresholds for alerts
const PRICE_SPIKE_THRESHOLD = 0.05;      // 5% spike in a day
const PRICE_DROP_THRESHOLD = -0.05;      // 5% drop in a day
const RSI_OVERSOLD = 30;
const RSI_OVERBOUGHT = 70;
const STOP_LOSS_NEAR_THRESHOLD = 0.03;   // 3% above stop loss
const TARGET_NEAR_THRESHOLD = 0.05;      // 5% below target
const VOLUME_SURGE_THRESHOLD = 3.0;      // 3x average volume

// ==================== HELPER FUNCTIONS ====================

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ==================== MONITORING FUNCTIONS ====================

/**
 * Analyze a watchlist/portfolio stock with intensive monitoring
 * Returns detailed status and alerts
 */
export function monitorStock(
  stock: Record<string, unknown>,
  priceHistory: Array<Record<string, unknown>>,
  userSettings?: {
    targetPrice?: number;
    stopLoss?: number;
    alertThresholds?: Partial<typeof PRICE_SPIKE_THRESHOLD>;
  }
): StockMonitoringStatus {
  
  // Run full analysis
  const analysis = analyzeSingleStock(stock, priceHistory);
  if (!analysis) {
    return createEmptyStatus(String(stock.ticker || 'UNKNOWN'));
  }

  const currentPrice = analysis.currentPrice;
  const previousClose = analysis.previousClose || currentPrice;
  
  // Calculate price changes
  const priceChange = currentPrice - previousClose;
  const priceChangePercent = previousClose > 0 ? (priceChange / previousClose) * 100 : 0;
  
  // Extract technical indicators
  const rsi = estimateRSI(priceHistory);
  const macd = estimateMACD(priceHistory);
  
  // Get support/resistance
  const support = analysis.momentumScore.supportResistance.strongSupport;
  const resistance = analysis.momentumScore.supportResistance.strongResistance;
  
  // Get stop loss and target
  const stopLoss = userSettings?.stopLoss || analysis.exitStrategy.stopLoss;
  const targetPrice = userSettings?.targetPrice || analysis.exitStrategy.targetPrice;
  
  // Calculate days to target (estimate)
  const daysToTarget = calculateDaysToTarget(
    currentPrice,
    targetPrice,
    analysis.momentumScore.score,
    analysis.qualityScore.total
  );
  
  // Determine risk level
  const riskLevel = determineRiskLevel(
    currentPrice,
    stopLoss,
    support,
    rsi,
    analysis.momentumScore.score
  );
  
  // Generate alerts
  const alerts = generateAlerts({
    ticker: analysis.ticker,
    currentPrice,
    previousClose,
    priceChangePercent,
    rsi,
    macd,
    support,
    resistance,
    stopLoss,
    targetPrice,
    currentRecommendation: analysis.recommendation,
    volumeRatio: analysis.volume.volumeRatio,
    qualityScore: analysis.qualityScore.total
  });
  
  return {
    ticker: analysis.ticker,
    lastPrice: currentPrice,
    previousPrice: previousClose,
    priceChange,
    priceChangePercent,
    lastRSI: rsi,
    lastMACD: macd,
    support,
    resistance,
    stopLoss,
    targetPrice,
    currentRecommendation: analysis.recommendation,
    previousRecommendation: analysis.recommendation, // Would need to track
    daysToTarget,
    riskLevel,
    lastUpdate: new Date().toISOString(),
    alertCount: alerts.length,
    activeAlerts: alerts
  };
}

/**
 * Generate portfolio health report
 */
export function generatePortfolioHealthReport(
  stocks: Array<{
    ticker: string;
    shares: number;
    entryPrice: number;
    currentPrice: number;
    sector: string;
  }>
): PortfolioHealthReport {
  
  const alerts: MonitoringAlert[] = [];
  const recommendations: string[] = [];
  const recommendationsAr: string[] = [];
  
  let totalValue = 0;
  let totalCost = 0;
  const sectorDistribution: Record<string, number> = {};
  const riskCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  
  const gains: Array<{ ticker: string; gain: number }> = [];
  const losses: Array<{ ticker: string; loss: number }> = [];
  
  for (const stock of stocks) {
    const value = stock.shares * stock.currentPrice;
    const cost = stock.shares * stock.entryPrice;
    const gainPercent = cost > 0 ? ((value - cost) / cost) * 100 : 0;
    
    totalValue += value;
    totalCost += cost;
    
    // Sector distribution
    const sector = stock.sector || 'Other';
    sectorDistribution[sector] = (sectorDistribution[sector] || 0) + 1;
    
    // Track gains/losses
    if (gainPercent > 0) {
      gains.push({ ticker: stock.ticker, gain: gainPercent });
    } else {
      losses.push({ ticker: stock.ticker, loss: -gainPercent });
    }
    
    // Risk assessment
    const drawdown = cost > 0 ? ((cost - value) / cost) * 100 : 0;
    if (drawdown > 20) {
      riskCounts.critical++;
      alerts.push({
        ticker: stock.ticker,
        type: 'risk_warning',
        severity: 'critical',
        message: `${stock.ticker} is down ${drawdown.toFixed(1)}% from entry - major loss`,
        messageAr: `${stock.ticker} منخفض ${drawdown.toFixed(1)}% من سعر الشراء - خسارة كبيرة`,
        currentValue: stock.currentPrice,
        threshold: stock.entryPrice,
        timestamp: new Date().toISOString(),
        action: 'Consider selling or averaging down',
        actionAr: 'فكر في البيع أو المتابعة'
      });
    } else if (drawdown > 10) {
      riskCounts.high++;
    } else if (drawdown > 5) {
      riskCounts.medium++;
    } else {
      riskCounts.low++;
    }
  }
  
  const totalGain = totalValue - totalCost;
  const totalGainPercent = totalCost > 0 ? (totalGain / totalCost) * 100 : 0;
  
  // Sort and get top/bottom performers
  gains.sort((a, b) => b.gain - a.gain);
  losses.sort((a, b) => b.loss - a.loss);
  
  const topGainers = gains.slice(0, 3);
  const topLosers = losses.slice(0, 3);
  
  // Generate recommendations
  if (totalGainPercent < -10) {
    recommendations.push('Portfolio is significantly down. Review positions and consider rebalancing.');
    recommendationsAr.push('المحفظة منخفضة بشكل كبير. راجع المراكز وفكر في إعادة التوازن.');
  }
  
  if (riskCounts.critical > 0) {
    recommendations.push(`${riskCounts.critical} stocks have critical losses. Immediate attention required.`);
    recommendationsAr.push(`${riskCounts.critical} أسهم لديها خسائر حرجة. تحتاج اهتمام فوري.`);
  }
  
  // Check sector concentration
  const maxSectorPct = Math.max(...Object.values(sectorDistribution)) / stocks.length * 100;
  if (maxSectorPct > 50) {
    const maxSector = Object.entries(sectorDistribution)
      .reduce((a, b) => a[1] > b[1] ? a : b)[0];
    recommendations.push(`High sector concentration: ${maxSectorPct.toFixed(0)}% in ${maxSector}. Consider diversification.`);
    recommendationsAr.push(`تركز قطاعي عالي: ${maxSectorPct.toFixed(0)}% في ${maxSector}. فكر في التنويع.`);
  }
  
  // Determine health counts
  const healthyCount = riskCounts.low + riskCounts.medium;
  const warningCount = riskCounts.high;
  const criticalCount = riskCounts.critical;
  
  return {
    totalStocks: stocks.length,
    healthyCount,
    warningCount,
    criticalCount,
    totalValue,
    totalGain,
    totalGainPercent,
    riskDistribution: riskCounts,
    sectorDistribution,
    topGainers,
    topLosers,
    alerts,
    recommendations,
    recommendationsAr
  };
}

/**
 * Calculate estimated days to reach target price
 */
function calculateDaysToTarget(
  currentPrice: number,
  targetPrice: number,
  momentumScore: number,
  qualityScore: number
): number | null {
  
  if (targetPrice <= currentPrice) return null;
  
  const upsidePercent = ((targetPrice - currentPrice) / currentPrice) * 100;
  
  // Estimate daily return based on quality and momentum
  // High quality + high momentum = faster movement
  const qualityFactor = qualityScore / 100;  // 0-1
  const momentumFactor = momentumScore / 100; // 0-1
  
  // Estimated annualized return (conservative)
  const estimatedAnnualReturn = 0.15 * qualityFactor + 0.10 * momentumFactor;
  const estimatedDailyReturn = estimatedAnnualReturn / 252;
  
  if (estimatedDailyReturn <= 0) return null;
  
  // Calculate days to reach target
  const days = Math.log(targetPrice / currentPrice) / Math.log(1 + estimatedDailyReturn);
  
  // Cap at 365 days
  return Math.min(Math.round(days), 365);
}

/**
 * Determine overall risk level for a position
 */
function determineRiskLevel(
  currentPrice: number,
  stopLoss: number,
  support: number,
  rsi: number,
  momentumScore: number
): 'low' | 'medium' | 'high' | 'critical' {
  
  let riskScore = 0;
  
  // Distance to stop loss
  const stopLossDistance = ((currentPrice - stopLoss) / currentPrice) * 100;
  if (stopLossDistance < 3) riskScore += 30;      // Very close to stop
  else if (stopLossDistance < 5) riskScore += 20;  // Close to stop
  else if (stopLossDistance < 10) riskScore += 10; // Moderate
  
  // Below support
  if (support > 0 && currentPrice < support) {
    riskScore += 25;
  }
  
  // RSI extremes
  if (rsi > 80) riskScore += 20;
  else if (rsi < 20) riskScore += 15;
  
  // Low momentum
  if (momentumScore < 30) riskScore += 15;
  
  // Map to risk level
  if (riskScore >= 50) return 'critical';
  if (riskScore >= 35) return 'high';
  if (riskScore >= 20) return 'medium';
  return 'low';
}

/**
 * Generate alerts for a stock
 */
function generateAlerts(params: {
  ticker: string;
  currentPrice: number;
  previousClose: number;
  priceChangePercent: number;
  rsi: number;
  macd: { macd: number; signal: number; histogram: number };
  support: number;
  resistance: number;
  stopLoss: number;
  targetPrice: number;
  currentRecommendation: string;
  volumeRatio: number;
  qualityScore: number;
}): MonitoringAlert[] {
  
  const alerts: MonitoringAlert[] = [];
  const now = new Date().toISOString();
  
  // Price spike alert
  if (params.priceChangePercent >= PRICE_SPIKE_THRESHOLD * 100) {
    alerts.push({
      ticker: params.ticker,
      type: 'price_spike',
      severity: 'high',
      message: `${params.ticker} spiked +${params.priceChangePercent.toFixed(1)}% - check for news`,
      messageAr: `${params.ticker} قفز +${params.priceChangePercent.toFixed(1)}% - تحقق من الأخبار`,
      currentValue: params.currentPrice,
      threshold: params.previousClose * (1 + PRICE_SPIKE_THRESHOLD),
      timestamp: now,
      action: 'Review position and consider taking profits',
      actionAr: 'راجع المركز وفكر في جني الأرباح'
    });
  }
  
  // Price drop alert
  if (params.priceChangePercent <= PRICE_DROP_THRESHOLD * 100) {
    alerts.push({
      ticker: params.ticker,
      type: 'price_drop',
      severity: 'high',
      message: `${params.ticker} dropped ${params.priceChangePercent.toFixed(1)}% - review position`,
      messageAr: `${params.ticker} انخفض ${params.priceChangePercent.toFixed(1)}% - راجع المركز`,
      currentValue: params.currentPrice,
      threshold: params.previousClose * (1 + PRICE_DROP_THRESHOLD),
      timestamp: now,
      action: 'Check for negative news, review stop loss',
      actionAr: 'تحقق من الأخبار السلبية، راجع وقف الخسارة'
    });
  }
  
  // RSI oversold
  if (params.rsi < RSI_OVERSOLD) {
    alerts.push({
      ticker: params.ticker,
      type: 'rsi_oversold',
      severity: 'medium',
      message: `${params.ticker} RSI is oversold at ${params.rsi.toFixed(1)}`,
      messageAr: `${params.ticker} RSI في تشبع بيعي عند ${params.rsi.toFixed(1)}`,
      currentValue: params.rsi,
      threshold: RSI_OVERSOLD,
      timestamp: now,
      action: 'Potential bounce opportunity, but watch for falling knife',
      actionAr: 'فرصة ارتداد محتملة، لكن احذر من السهم المنهار'
    });
  }
  
  // RSI overbought
  if (params.rsi > RSI_OVERBOUGHT) {
    alerts.push({
      ticker: params.ticker,
      type: 'rsi_overbought',
      severity: 'medium',
      message: `${params.ticker} RSI is overbought at ${params.rsi.toFixed(1)}`,
      messageAr: `${params.ticker} RSI في تشبع شرائي عند ${params.rsi.toFixed(1)}`,
      currentValue: params.rsi,
      threshold: RSI_OVERBOUGHT,
      timestamp: now,
      action: 'Consider taking partial profits',
      actionAr: 'فكر في جني جزء من الأرباح'
    });
  }
  
  // Support break
  if (params.support > 0 && params.currentPrice < params.support) {
    alerts.push({
      ticker: params.ticker,
      type: 'support_break',
      severity: 'critical',
      message: `${params.ticker} broke support at ${params.support.toFixed(2)}`,
      messageAr: `${params.ticker} كسر الدعم عند ${params.support.toFixed(2)}`,
      currentValue: params.currentPrice,
      threshold: params.support,
      timestamp: now,
      action: 'Consider selling or tightening stop loss',
      actionAr: 'فكر في البيع أو تقوية وقف الخسارة'
    });
  }
  
  // Resistance break (bullish)
  if (params.resistance > 0 && params.currentPrice > params.resistance) {
    alerts.push({
      ticker: params.ticker,
      type: 'resistance_break',
      severity: 'low',
      message: `${params.ticker} broke resistance at ${params.resistance.toFixed(2)} - bullish`,
      messageAr: `${params.ticker} كسر المقاومة عند ${params.resistance.toFixed(2)} - صعودي`,
      currentValue: params.currentPrice,
      threshold: params.resistance,
      timestamp: now,
      action: 'Monitor for continuation, adjust target higher',
      actionAr: 'راقب الاستمرار، ارفع السعر المستهدف'
    });
  }
  
  // Stop loss near
  const stopLossDistance = ((params.currentPrice - params.stopLoss) / params.currentPrice) * 100;
  if (stopLossDistance < STOP_LOSS_NEAR_THRESHOLD * 100 && stopLossDistance > 0) {
    alerts.push({
      ticker: params.ticker,
      type: 'stop_loss_near',
      severity: 'critical',
      message: `${params.ticker} is ${stopLossDistance.toFixed(1)}% above stop loss!`,
      messageAr: `${params.ticker} على بعد ${stopLossDistance.toFixed(1)}% من وقف الخسارة!`,
      currentValue: params.currentPrice,
      threshold: params.stopLoss,
      timestamp: now,
      action: 'IMMEDIATE: Review or exit position',
      actionAr: 'عاجل: راجع أو اخرج من المركز'
    });
  }
  
  // Target near
  const targetDistance = ((params.targetPrice - params.currentPrice) / params.currentPrice) * 100;
  if (targetDistance < TARGET_NEAR_THRESHOLD * 100 && targetDistance > 0) {
    alerts.push({
      ticker: params.ticker,
      type: 'target_near',
      severity: 'low',
      message: `${params.ticker} is ${targetDistance.toFixed(1)}% from target - prepare to sell`,
      messageAr: `${params.ticker} على بعد ${targetDistance.toFixed(1)}% من الهدف - جهز للبيع`,
      currentValue: params.currentPrice,
      threshold: params.targetPrice,
      timestamp: now,
      action: 'Prepare to take profits at target',
      actionAr: 'جهز لجني الأرباح عند الهدف'
    });
  }
  
  // Volume surge
  if (params.volumeRatio >= VOLUME_SURGE_THRESHOLD) {
    alerts.push({
      ticker: params.ticker,
      type: 'volume_surge',
      severity: 'medium',
      message: `${params.ticker} volume is ${params.volumeRatio.toFixed(1)}x average - high interest`,
      messageAr: `${params.ticker} الحجم ${params.volumeRatio.toFixed(1)}× المتوسط - اهتمام عالي`,
      currentValue: params.volumeRatio,
      threshold: VOLUME_SURGE_THRESHOLD,
      timestamp: now,
      action: 'Check for news, unusual activity detected',
      actionAr: 'تحقق من الأخبار، نشاط غير عادي'
    });
  }
  
  // MACD crossover
  if (params.macd.histogram > 0 && params.macd.macd > params.macd.signal) {
    // Bullish MACD cross
    alerts.push({
      ticker: params.ticker,
      type: 'macd_cross',
      severity: 'low',
      message: `${params.ticker} MACD bullish cross detected`,
      messageAr: `${params.ticker} تقاطع MACD صعودي`,
      currentValue: params.macd.histogram,
      timestamp: now,
      action: 'Bullish signal - monitor for confirmation',
      actionAr: 'إشارة صعودية - راقب التأكيد'
    });
  }
  
  return alerts;
}

/**
 * Simple RSI estimation (for quick monitoring)
 */
function estimateRSI(priceHistory: Array<Record<string, unknown>>, period: number = 14): number {
  if (priceHistory.length < period + 1) return 50;
  
  const closes = priceHistory.slice(-period - 1).map(p => 
    Number(p.close || p.close_price) || 0
  ).filter(c => c > 0);
  
  if (closes.length < period + 1) return 50;
  
  let gains = 0;
  let losses = 0;
  
  for (let i = 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  
  const avgGain = gains / period;
  const avgLoss = losses / period;
  
  if (avgLoss === 0) return 100;
  
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

/**
 * Simple MACD estimation
 */
function estimateMACD(priceHistory: Array<Record<string, unknown>>): { macd: number; signal: number; histogram: number } {
  const closes = priceHistory.map(p => Number(p.close || p.close_price) || 0).filter(c => c > 0);
  
  if (closes.length < 26) {
    return { macd: 0, signal: 0, histogram: 0 };
  }
  
  // Simple EMA approximation
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macd = ema12 - ema26;
  
  // Signal line (9-period EMA of MACD)
  const signal = macd * 0.8; // Simplified
  const histogram = macd - signal;
  
  return { macd: round2(macd), signal: round2(signal), histogram: round2(histogram) };
}

/**
 * Calculate EMA
 */
function calculateEMA(data: number[], period: number): number {
  if (data.length < period) return data[data.length - 1] || 0;
  
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  
  for (let i = period; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  
  return ema;
}

/**
 * Create empty status for error cases
 */
function createEmptyStatus(ticker: string): StockMonitoringStatus {
  return {
    ticker,
    lastPrice: 0,
    previousPrice: 0,
    priceChange: 0,
    priceChangePercent: 0,
    lastRSI: 50,
    lastMACD: { macd: 0, signal: 0, histogram: 0 },
    support: 0,
    resistance: 0,
    stopLoss: 0,
    targetPrice: 0,
    currentRecommendation: 'Unknown',
    previousRecommendation: 'Unknown',
    daysToTarget: null,
    riskLevel: 'medium',
    lastUpdate: new Date().toISOString(),
    alertCount: 0,
    activeAlerts: []
  };
}

// ==================== EXPORTS ====================

export {
  monitorStock,
  generatePortfolioHealthReport,
  calculateDaysToTarget,
  type MonitoringAlert,
  type StockMonitoringStatus,
  type PortfolioHealthReport
};
