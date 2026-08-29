/**
 * محرك الاختبار الرجعي - Backtesting Engine
 * 
 * ده النظام اللي يختبر الاستراتيجية على بيانات تاريخية
 * ويتعلم من الأخطاء قبل ما يخسر فلوس حقيقية
 * 
 * الفكرة:
 * 1. نختار فترة زمنية في الماضي
 * 2. النظام يعمل كأنه في اليوم ده وياخد قرار
 * 3. نشوف إيه حصل فعلاً في الـ 30 يوم اللي بعد كده
 * 4. نسجل: التحليل كان صح ولا غلط؟
 */

import { createDatabase, initialize as initSqlJs, type SqliteDatabase } from '@/lib/sqlite-wrapper';
import * as path from 'path';
import { existsSync } from 'fs';

// Note: SQLite is available but not used for backtesting
// All data comes from VPS API and analysis is in-memory

// ==================== TYPES ====================

export interface BacktestConfig {
  start_date: string;      // YYYY-MM-DD - بداية الفترة
  end_date: string;        // YYYY-MM-DD - نهاية الفترة
  capital: number;         // رأس المال الافتراضي
  max_positions: number;   // أقصى عدد صفقات مفتوحة
  holding_days: number;    // عدد أيام الاحتفاظ
  confidence_threshold: number; // حد الثقة للدخول (50-100)
  tickers?: string[];      // أسهم محددة (اختياري)
  
  // Learning Parameters
  parameters?: {
    rsi_oversold?: number;
    rsi_overbought?: number;
    rsi_weight?: number;
    macd_weight?: number;
    ma_weight?: number;
    bollinger_weight?: number;
    stop_loss_min?: number;
    stop_loss_max?: number;
    target_multiplier?: number;
    min_indicators_agree?: number;
  };
}

export interface BacktestTrade {
  id: number;
  ticker: string;
  entry_date: string;
  entry_price: number;
  action: 'BUY' | 'SELL';
  shares: number;
  position_value: number;
  stop_loss: number;
  target_price: number;
  confidence: number;
  reasoning: string;
  
  // النتيجة الفعلية
  exit_date: string;
  exit_price: number;
  actual_high: number;     // أعلى سعر وصلله
  actual_low: number;      // أقل سعر وصلله
  actual_return: number;   // العائد الفعلي %
  
  // التقييم
  hit_target: boolean;     // وصل للهدف؟
  hit_stop_loss: boolean;  // وصل للستوب؟
  analysis_correct: boolean; // التحليل كان صح؟
  lesson: string;          // الدرس المستفاد
}

export interface BacktestResult {
  config: BacktestConfig;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_return: number;
  avg_return: number;
  avg_winner: number;
  avg_loser: number;
  best_trade: BacktestTrade | null;
  worst_trade: BacktestTrade | null;
  sharpe_ratio: number;
  max_drawdown: number;
  
  trades: BacktestTrade[];
  lessons: string[];
  
  // أداء حسب السهم
  ticker_performance: Map<string, { trades: number; win_rate: number; avg_return: number }>;
}

// ==================== PYTHON BACKEND DATA FETCHER ====================

/**
 * Get the API URL based on environment
 * - Client-side: use proxy route /api/python
 * - Server-side: use VPS API (YOUR_VPS_IP:8010) or local if PYTHON_API_URL is set
 */
function getApiUrl(): string {
  if (typeof window !== 'undefined') {
    // Client-side: use proxy route
    return '/api/python';
  }
  // Server-side: check for environment variable first
  // Then try localhost (for VPS environment where Python runs locally)
  // Finally fall back to VPS public IP for development
  if (process.env.PYTHON_API_URL) {
    return process.env.PYTHON_API_URL;
  }
  // Default to localhost for VPS environment (Python backend runs on same machine)
  return 'http://127.0.0.1:8010';
}

async function fetchHistoryFromVPS(ticker: string, startDate: string, endDate: string): Promise<{
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}[]> {
  try {
    // Calculate days between dates + 200 for indicators
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 200;
    
    // Request more days to ensure we get enough historical data for indicators
    const requestDays = Math.max(days, 365); // Request at least 1 year of data
    
    // Add AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    const apiUrl = getApiUrl();
    // Use existing /api/history endpoint instead of /api/stocks/<ticker>/local-history
    const url = `${apiUrl}/api/history/${ticker}?days=${requestDays}`;

    console.log(`[Backtest] Fetching history for ${ticker} from ${url}`);
    
    const response = await fetch(url, { 
      signal: controller.signal,
      next: { revalidate: 86400 } // Cache 1 day
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.log(`[Backtest] ${ticker}: API returned ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    // Handle both response formats
    // Format 1: { success: true, history: [...] }
    // Format 2: { success: true, data: { history: [...] } }
    const history = data.history || data.data?.history || [];
    
    if (history.length === 0) {
      console.log(`[Backtest] ${ticker}: No history data`);
      return [];
    }
    
    // Log first and last date
    const firstDate = history[0]?.date;
    const lastDate = history[history.length - 1]?.date;
    console.log(`[Backtest] ${ticker}: ${history.length} records (${firstDate} to ${lastDate})`);
    
    // Filter by date range - include data before start for indicators
    const filtered = history.filter((h: { date: string }) => {
      const d = h.date;
      return d <= endDate; // Include all data up to end date
    });
    
    return filtered;
  } catch (error) {
    if ((error as Error).name === 'AbortError') {
      console.log(`[Backtest] ${ticker}: Request timed out`);
    } else {
      console.error(`[Backtest] Failed to fetch history for ${ticker}:`, error);
    }
    return [];
  }
}

async function getAvailableTickers(): Promise<string[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout
    
    const apiUrl = getApiUrl();
    const response = await fetch(`${apiUrl}/api/stocks`, { 
      signal: controller.signal,
      next: { revalidate: 86400 } 
    });
    
    clearTimeout(timeoutId);
    
    const data = await response.json();
    
    // Handle both response formats
    // Format 1: { success: true, data: [...] }
    // Format 2: { success: true, stocks: [...] }
    const stocks = data.data || data.stocks || [];
    
    // Filter out treasury bonds and other special instruments that start with numbers or REOPEN
    const tickers = stocks
      .map((s: { ticker?: string; symbol?: string }) => s.ticker || s.symbol)
      .filter((symbol: string | undefined): symbol is string => {
        if (!symbol) return false;
        // Skip treasury bonds (start with numbers) and REOPEN instruments
        if (/^[0-9]/.test(symbol)) return false;
        if (symbol.startsWith('REOPEN')) return false;
        if (symbol.includes('_R')) return false; // Skip rights issues
        return true;
      });
    
    console.log(`[Backtest] Found ${tickers.length} tickers`);
    return tickers;
  } catch (error) {
    console.error('[Backtest] Failed to get tickers:', error);
    return [];
  }
}

// ==================== TECHNICAL INDICATORS ====================

function calculateRSI(closes: number[], period: number = 14): number {
  if (closes.length < period + 1) return 50;
  
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  
  if (losses === 0) return 100;
  return 100 - (100 / (1 + gains / losses));
}

function calculateSMA(data: number[], period: number): number {
  if (data.length < period) return data[data.length - 1];
  return data.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(data: number[], period: number): number {
  const k = 2 / (period + 1);
  let ema = data[0];
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
  }
  return ema;
}

interface TechnicalAnalysis {
  rsi: number;
  rsi_signal: 'oversold' | 'neutral' | 'overbought';
  macd_signal: 'bullish' | 'bearish' | 'neutral';
  ma_signal: 'above_all' | 'above_20_50' | 'below_all' | 'mixed';
  bollinger_signal: 'above_upper' | 'below_lower' | 'neutral';
  current_price: number;
  atr_percent: number;
}

function analyzeTechnical(priceHistory: { open: number; high: number; low: number; close: number; volume: number }[]): TechnicalAnalysis | null {
  if (priceHistory.length < 30) return null; // Reduced from 50 to 30 for shorter data ranges
  
  const closes = priceHistory.map(p => p.close);
  const highs = priceHistory.map(p => p.high);
  const lows = priceHistory.map(p => p.low);
  const currentPrice = closes[closes.length - 1];
  
  // RSI
  const rsi = calculateRSI(closes);
  const rsi_signal = rsi < 30 ? 'oversold' : rsi > 70 ? 'overbought' : 'neutral';
  
  // MACD
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macd = ema12 - ema26;
  const signal = macd * 0.9; // Approximate signal line
  const macd_signal = macd > signal && macd > 0 ? 'bullish' : macd < signal && macd < 0 ? 'bearish' : 'neutral';
  
  // Moving Averages
  const ma20 = calculateSMA(closes, 20);
  const ma50 = calculateSMA(closes, 50);
  const ma200 = closes.length >= 200 ? calculateSMA(closes, 200) : null;
  
  const above20 = currentPrice > ma20;
  const above50 = currentPrice > ma50;
  const above200 = ma200 ? currentPrice > ma200 : true;
  
  let ma_signal: 'above_all' | 'above_20_50' | 'below_all' | 'mixed' = 'mixed';
  if (above20 && above50 && above200) ma_signal = 'above_all';
  else if (above20 && above50) ma_signal = 'above_20_50';
  else if (!above20 && !above50) ma_signal = 'below_all';
  
  // Bollinger
  const middle = ma20;
  const std = Math.sqrt(closes.slice(-20).map(c => Math.pow(c - middle, 2)).reduce((a, b) => a + b, 0) / 20);
  const upper = middle + 2 * std;
  const lower = middle - 2 * std;
  
  let bollinger_signal: 'above_upper' | 'below_lower' | 'neutral' = 'neutral';
  if (currentPrice > upper) bollinger_signal = 'above_upper';
  else if (currentPrice < lower) bollinger_signal = 'below_lower';
  
  // ATR %
  const atrPeriod = 14;
  const trValues: number[] = [];
  for (let i = priceHistory.length - atrPeriod; i < priceHistory.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trValues.push(tr);
  }
  const atr = trValues.reduce((a, b) => a + b, 0) / atrPeriod;
  const atr_percent = (atr / currentPrice) * 100;
  
  return {
    rsi: Math.round(rsi * 100) / 100,
    rsi_signal,
    macd_signal,
    ma_signal,
    bollinger_signal,
    current_price: Math.round(currentPrice * 100) / 100,
    atr_percent: Math.round(atr_percent * 100) / 100
  };
}

// ==================== TRADE DECISION ====================

interface TradeDecision {
  action: 'BUY' | 'SELL' | 'HOLD';
  confidence: number;
  stop_loss: number;
  target_price: number;
  reasoning: string;
}

// Default parameters for when none are provided
const DEFAULT_PARAMS = {
  rsi_oversold: 30,
  rsi_overbought: 70,
  rsi_weight: 15,
  macd_weight: 10,
  ma_weight: 12,
  bollinger_weight: 8,
  stop_loss_min: 3,
  stop_loss_max: 8,
  target_multiplier: 2,
  min_indicators_agree: 2
};

function makeDecision(tech: TechnicalAnalysis, params: typeof DEFAULT_PARAMS = DEFAULT_PARAMS): TradeDecision {
  let score = 50;
  const reasons: string[] = [];
  let bullishIndicators = 0;
  let bearishIndicators = 0;
  
  // RSI - Use configurable thresholds and weights
  if (tech.rsi <= params.rsi_oversold) {
    score += params.rsi_weight;
    reasons.push('RSI تشبع بيعي');
    bullishIndicators++;
  } else if (tech.rsi >= params.rsi_overbought) {
    score -= params.rsi_weight;
    reasons.push('RSI تشبع شرائي');
    bearishIndicators++;
  }
  
  // MACD - Use configurable weight
  if (tech.macd_signal === 'bullish') {
    score += params.macd_weight;
    reasons.push('MACD إيجابي');
    bullishIndicators++;
  } else if (tech.macd_signal === 'bearish') {
    score -= params.macd_weight;
    reasons.push('MACD سلبي');
    bearishIndicators++;
  }
  
  // MA - Use configurable weight
  if (tech.ma_signal === 'above_all') {
    score += params.ma_weight;
    reasons.push('فوق كل المتوسطات');
    bullishIndicators++;
  } else if (tech.ma_signal === 'below_all') {
    score -= params.ma_weight;
    reasons.push('تحت كل المتوسطات');
    bearishIndicators++;
  }
  
  // Bollinger - Use configurable weight
  if (tech.bollinger_signal === 'below_lower') {
    score += params.bollinger_weight;
    reasons.push('تحت النطاق السفلي');
    bullishIndicators++;
  } else if (tech.bollinger_signal === 'above_upper') {
    score -= params.bollinger_weight;
    reasons.push('فوق النطاق العلوي');
    bearishIndicators++;
  }
  
  // Decision - Require minimum indicators to agree
  const minAgree = params.min_indicators_agree;
  let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  
  if (bullishIndicators >= minAgree && score >= 55) {
    action = 'BUY';
  } else if (bearishIndicators >= minAgree && score <= 45) {
    action = 'SELL';
  }
  
  // Stop Loss & Target - Use configurable ranges
  const stopLossPercent = Math.max(params.stop_loss_min, Math.min(params.stop_loss_max, tech.atr_percent * 1.5));
  const targetPercent = stopLossPercent * params.target_multiplier;
  
  let stopLoss: number, target: number;
  if (action === 'BUY') {
    stopLoss = tech.current_price * (1 - stopLossPercent / 100);
    target = tech.current_price * (1 + targetPercent / 100);
  } else {
    stopLoss = tech.current_price * (1 + stopLossPercent / 100);
    target = tech.current_price * (1 - targetPercent / 100);
  }
  
  return {
    action,
    confidence: Math.min(100, Math.max(0, score)),
    stop_loss: Math.round(stopLoss * 100) / 100,
    target_price: Math.round(target * 100) / 100,
    reasoning: reasons.join(' | ')
  };
}

// ==================== BACKTEST ENGINE ====================

// Default configuration values
const DEFAULT_BACKTEST_CONFIG = {
  capital: 100000,
  max_positions: 5,
  holding_days: 30,
  confidence_threshold: 70,
  start_date: '2025-01-01',
  end_date: '2025-03-31'
};

export async function runBacktest(config: Partial<BacktestConfig> = {}): Promise<BacktestResult> {
  // Merge with defaults
  const fullConfig: BacktestConfig = {
    ...DEFAULT_BACKTEST_CONFIG,
    ...config
  };

  console.log('[Backtest] Starting backtest:', fullConfig);

  // Note: No SQLite initialization needed - all data comes from VPS API

  const trades: BacktestTrade[] = [];
  let tradeId = 0;

  // Get tickers to test
  const allTickers = fullConfig.tickers || await getAvailableTickers();
  // Use more tickers for better learning (increased from 5 to 20)
  const tickers = allTickers.slice(0, 20);
  console.log(`[Backtest] Testing ${tickers.length} tickers out of ${allTickers.length} available`);

  // For each ticker, get full history
  for (const ticker of tickers) {
    try {
      const history = await fetchHistoryFromVPS(ticker, fullConfig.start_date, fullConfig.end_date);
      
      if (history.length < 60) {
        console.log(`[Backtest] ${ticker}: Skipped - only ${history.length} days`);
        continue; // Need enough data for indicators
      }
      
      // Skip first 30 for indicators (reduced from 50 to allow shorter data ranges)
      const startIndex = 30;
      const endIndex = history.length - fullConfig.holding_days;

      console.log(`[Backtest] ${ticker}: history.length=${history.length}, startIndex=${startIndex}, endIndex=${endIndex}, holding_days=${fullConfig.holding_days}`);
      
      if (endIndex <= startIndex) {
        console.log(`[Backtest] ${ticker}: Skipped - not enough days after holding period`);
        continue;
      }
      
      let tradesForTicker = 0;
      
      // Process each day
      for (let i = startIndex; i < endIndex; i++) {
        const currentDate = history[i].date;
        
        // Only trade in the test period (not before start_date)
        if (currentDate < fullConfig.start_date) continue;
        if (currentDate > fullConfig.end_date) break;
        
        // Get data up to current date
        const dataUpToNow = history.slice(0, i + 1);
        
        // Analyze
        const tech = analyzeTechnical(dataUpToNow);
        if (!tech) continue;
        
        // Make decision with parameters
        const params = fullConfig.parameters || DEFAULT_PARAMS;
        const decision = makeDecision(tech, params);
        
        // Log first few decisions
        if (tradesForTicker < 3) {
          console.log(`[Backtest] ${ticker} @ ${currentDate}: ${decision.action} (${decision.confidence}%) - ${decision.reasoning}`);
        }
        
        // Only trade if confidence meets threshold
        if (decision.action === 'HOLD' || decision.confidence < fullConfig.confidence_threshold) continue;

        const entryPrice = tech.current_price;
        const shares = Math.floor((fullConfig.capital / fullConfig.max_positions) / entryPrice);
        const positionValue = shares * entryPrice;

        // Look ahead to see what happened
        const futureData = history.slice(i + 1, i + 1 + fullConfig.holding_days);

        if (futureData.length < fullConfig.holding_days) continue;
        
        // Use close price if high/low are null
        const validFutureData = futureData.map(d => ({
          high: d.high || d.close,
          low: d.low || d.close,
          close: d.close
        }));
        
        const actualHigh = Math.max(...validFutureData.map(d => d.high));
        const actualLow = Math.min(...validFutureData.map(d => d.low));
        const exitPrice = validFutureData[validFutureData.length - 1].close;
        
        // Check if hit target or stop loss
        let hitTarget = false, hitStopLoss = false;
        
        if (decision.action === 'BUY') {
          hitTarget = actualHigh >= decision.target_price;
          hitStopLoss = actualLow <= decision.stop_loss;
        } else {
          hitTarget = actualLow <= decision.target_price;
          hitStopLoss = actualHigh >= decision.stop_loss;
        }
        
        // Calculate actual return
        let actualReturn: number;
        if (decision.action === 'BUY') {
          if (hitStopLoss) actualReturn = ((decision.stop_loss - entryPrice) / entryPrice) * 100;
          else if (hitTarget) actualReturn = ((decision.target_price - entryPrice) / entryPrice) * 100;
          else actualReturn = ((exitPrice - entryPrice) / entryPrice) * 100;
        } else {
          if (hitStopLoss) actualReturn = ((entryPrice - decision.stop_loss) / entryPrice) * 100;
          else if (hitTarget) actualReturn = ((entryPrice - decision.target_price) / entryPrice) * 100;
          else actualReturn = ((entryPrice - exitPrice) / entryPrice) * 100;
        }
        
        // Deduct costs (1.1%)
        actualReturn -= 1.1;
        
        // Determine if analysis was correct
        const analysisCorrect = (decision.action === 'BUY' && actualReturn > 0) || 
                                (decision.action === 'SELL' && actualReturn > 0);
        
        // Generate lesson
        let lesson = '';
        if (analysisCorrect) {
          lesson = `✅ نجاح: ${decision.reasoning} كان صحيح`;
        } else {
          lesson = `❌ خطأ: ${decision.reasoning} - الدخول كان خاطئ`;
        }
        
        tradeId++;
        trades.push({
          id: tradeId,
          ticker,
          entry_date: currentDate,
          entry_price: entryPrice,
          action: decision.action,
          shares,
          position_value: positionValue,
          stop_loss: decision.stop_loss,
          target_price: decision.target_price,
          confidence: decision.confidence,
          reasoning: decision.reasoning,
          exit_date: futureData[futureData.length - 1].date,
          exit_price: exitPrice,
          actual_high: actualHigh,
          actual_low: actualLow,
          actual_return: Math.round(actualReturn * 100) / 100,
          hit_target: hitTarget,
          hit_stop_loss: hitStopLoss,
          analysis_correct: analysisCorrect,
          lesson
        });
        
        tradesForTicker++;
        
        // Skip some days after a trade to simulate real conditions
        i += 5;
      }
      
      console.log(`[Backtest] ${ticker}: ${tradesForTicker} trades generated`);
      
    } catch (error) {
      console.error(`[Backtest] Error processing ${ticker}:`, error);
    }
  }
  
  // Calculate results
  const winningTrades = trades.filter(t => t.actual_return > 0);
  const losingTrades = trades.filter(t => t.actual_return <= 0);
  
  const totalReturn = trades.reduce((sum, t) => sum + t.actual_return, 0);
  const avgReturn = trades.length > 0 ? totalReturn / trades.length : 0;
  const avgWinner = winningTrades.length > 0 
    ? winningTrades.reduce((sum, t) => sum + t.actual_return, 0) / winningTrades.length 
    : 0;
  const avgLoser = losingTrades.length > 0 
    ? Math.abs(losingTrades.reduce((sum, t) => sum + t.actual_return, 0) / losingTrades.length) 
    : 0;
  
  // Sort for best/worst
  const sortedByReturn = [...trades].sort((a, b) => b.actual_return - a.actual_return);
  
  // Extract lessons
  const lessons = trades
    .filter(t => !t.analysis_correct)
    .map(t => t.lesson)
    .slice(0, 20);
  
  // Ticker performance
  const tickerPerf = new Map<string, { trades: number; wins: number; total_return: number }>();
  for (const t of trades) {
    const existing = tickerPerf.get(t.ticker) || { trades: 0, wins: 0, total_return: 0 };
    existing.trades++;
    if (t.actual_return > 0) existing.wins++;
    existing.total_return += t.actual_return;
    tickerPerf.set(t.ticker, existing);
  }
  
  const tickerPerformance = new Map<string, { trades: number; win_rate: number; avg_return: number }>();
  for (const [ticker, data] of tickerPerf) {
    tickerPerformance.set(ticker, {
      trades: data.trades,
      win_rate: (data.wins / data.trades) * 100,
      avg_return: data.total_return / data.trades
    });
  }
  
  return {
    config,
    total_trades: trades.length,
    winning_trades: winningTrades.length,
    losing_trades: losingTrades.length,
    win_rate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
    total_return: Math.round(totalReturn * 100) / 100,
    avg_return: Math.round(avgReturn * 100) / 100,
    avg_winner: Math.round(avgWinner * 100) / 100,
    avg_loser: Math.round(avgLoser * 100) / 100,
    best_trade: sortedByReturn[0] || null,
    worst_trade: sortedByReturn[sortedByReturn.length - 1] || null,
    sharpe_ratio: avgLoser > 0 ? Math.round((avgReturn / avgLoser) * 100) / 100 : 0,
    max_drawdown: 0, // TODO: Calculate properly
    trades,
    lessons,
    ticker_performance: tickerPerformance
  };
}
