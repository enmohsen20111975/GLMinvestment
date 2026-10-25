/**
 * Admin API - تشغيل التحليل المتقدم وحفظ النتائج
 * =================================================
 * يقوم بتشغيل التحليل الشامل وحفظ النتائج في قاعدة البيانات
 */

import { NextRequest, NextResponse } from 'next/server';
export const dynamic = "force-dynamic";

import { db } from '@/lib/db';
// P0-11-AUTH fix (2026-09-27): added admin auth guard (canonical multi-method
// check via requireAdminAsync — accepts X-Admin-Token, admin_session cookie,
// NextAuth session, or localhost bypass in dev). Pre-existing verifyAdminToken
// kept as defense-in-depth.
import { requireAdminAsync } from '@/lib/admin-guard';
import { verifyAdminToken } from '@/lib/admin-auth-server';
import { ensureInitialized, getLightDb, getHeavyDb } from '@/lib/egx-db';

// Python Backend URL
const PYTHON_BACKEND_URL = 'http://127.0.0.1:8010';

// ==================== Interfaces ====================

interface StockData {
  symbol: string;
  name?: string;
  price: number;
  change_percent?: number;
  volume?: number;
  high?: number;
  low?: number;
  open?: number;
  previous_close?: number;
}

interface CandleData {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  date?: string;
}

// ==================== Helper Functions ====================

async function fetchStocksFromPythonBackend(): Promise<StockData[]> {
  const response = await fetch(`${PYTHON_BACKEND_URL}/api/stocks`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) throw new Error(`Python Backend returned ${response.status}`);

  const data = await response.json();
  return (data.data || []).map((s: any) => ({
    symbol: s.symbol,
    name: s.name,
    price: s.current_price || s.price || 0,
    change_percent: s.change_percent || 0,
    volume: s.volume || 0,
    high: s.high_price || s.high || 0,
    low: s.low_price || s.low || 0,
    open: s.open_price || s.open || 0,
    previous_close: s.previous_close || 0
  }));
}

// Fallback: Fetch stocks from local database
async function fetchStocksFromLocalDB(): Promise<StockData[]> {
  await ensureInitialized();
  const db = getLightDb();
  
  const rows = db.prepare(`
    SELECT ticker as symbol, name, current_price, previous_close,
           volume, high_price, low_price, open_price
    FROM stocks WHERE is_active = 1 AND current_price > 0
    ORDER BY volume DESC
  `).all() as Record<string, unknown>[];
  
  return rows.map((s: Record<string, unknown>) => {
    const prev = Number(s.previous_close) || 0;
    const curr = Number(s.current_price) || 0;
    const changePercent = prev > 0 ? ((curr - prev) / prev) * 100 : 0;
    
    return {
      symbol: String(s.symbol || ''),
      name: String(s.name || ''),
      price: curr,
      change_percent: changePercent,
      volume: Number(s.volume) || 0,
      high: Number(s.high_price) || curr,
      low: Number(s.low_price) || curr,
      open: Number(s.open_price) || curr,
      previous_close: prev
    };
  });
}

// Fetch stocks with fallback
async function fetchStocks(): Promise<{ stocks: StockData[]; source: string }> {
  // Try Python Backend first
  try {
    const stocks = await fetchStocksFromPythonBackend();
    if (stocks.length > 0) {
      return { stocks, source: 'python_backend' };
    }
  } catch (error) {
    console.log('[Advanced Analysis] Python Backend not available, using local DB');
  }
  
  // Fallback to local DB
  const stocks = await fetchStocksFromLocalDB();
  return { stocks, source: 'local_db' };
}

async function fetchHistoryFromPythonBackend(symbol: string, days: number = 60): Promise<CandleData[]> {
  try {
    const response = await fetch(`${PYTHON_BACKEND_URL}/api/history/${symbol}?days=${days}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) return [];

    const data = await response.json();
    return (data.data?.rows || []).map((r: any) => ({
      date: r.date,
      open: r.open || 0,
      high: r.high || 0,
      low: r.low || 0,
      close: r.close || 0,
      volume: r.volume || 0
    }));
  } catch {
    return [];
  }
}

// Fallback: Fetch history from local database
async function fetchHistoryFromLocalDB(symbol: string, days: number = 60): Promise<CandleData[]> {
  try {
    await ensureInitialized();
    const heavyDb = getHeavyDb();
    
    // Get stock_id from stocks table in light DB
    const lightDb = getLightDb();
    const stockRow = lightDb.prepare('SELECT id FROM stocks WHERE ticker = ? COLLATE NOCASE').get(symbol) as Record<string, unknown> | undefined;
    
    if (!stockRow) return [];
    
    const stockId = Number(stockRow.id);
    
    const rows = heavyDb.prepare(`
      SELECT date, open_price as open, high_price as high, low_price as low, 
             close_price as close, volume
      FROM stock_price_history 
      WHERE stock_id = ? 
      ORDER BY date DESC 
      LIMIT ?
    `).all(stockId, days) as Record<string, unknown>[];
    
    return rows.map((r: Record<string, unknown>) => ({
      date: String(r.date || ''),
      open: Number(r.open) || 0,
      high: Number(r.high) || 0,
      low: Number(r.low) || 0,
      close: Number(r.close) || 0,
      volume: Number(r.volume) || 0
    })).reverse(); // Reverse to chronological order
  } catch (error) {
    console.log(`[Advanced Analysis] No history for ${symbol}:`, error);
    return [];
  }
}

// Fetch history with fallback
async function fetchHistory(symbol: string, days: number = 60): Promise<CandleData[]> {
  // Try Python Backend first
  try {
    const history = await fetchHistoryFromPythonBackend(symbol, days);
    if (history.length > 0) {
      return history;
    }
  } catch {
    // Fall through to local DB
  }
  
  // Fallback to local DB
  return fetchHistoryFromLocalDB(symbol, days);
}

// ==================== Technical Analysis Functions ====================

function calculateSMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  return prices.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(prices: number[], period: number): number | null {
  if (prices.length < period) return null;
  const multiplier = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }
  return ema;
}

function calculateRSI(prices: number[], period: number = 14): { value: number; signal: string } | null {
  if (prices.length < period + 1) return null;
  
  const deltas = prices.slice(1).map((p, i) => p - prices[i]);
  const gains = deltas.map(d => d > 0 ? d : 0);
  const losses = deltas.map(d => d < 0 ? -d : 0);
  
  const avgGain = gains.slice(-period).reduce((a, b) => a + b, 0) / period;
  const avgLoss = losses.slice(-period).reduce((a, b) => a + b, 0) / period;
  
  if (avgLoss === 0) return { value: 100, signal: 'OVERBOUGHT' };
  
  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));
  
  let signal = 'NEUTRAL';
  if (rsi >= 70) signal = 'OVERBOUGHT';
  else if (rsi <= 30) signal = 'OVERSOLD';
  
  return { value: Math.round(rsi * 10) / 10, signal };
}

function calculateStochastic(highs: number[], lows: number[], closes: number[]): { k: number; signal: string } | null {
  const period = 14;
  if (highs.length < period) return null;
  
  const periodHighs = highs.slice(-period);
  const periodLows = lows.slice(-period);
  const highestHigh = Math.max(...periodHighs);
  const lowestLow = Math.min(...periodLows);
  const currentClose = closes[closes.length - 1];
  
  if (highestHigh === lowestLow) return { k: 50, signal: 'NEUTRAL' };
  
  const k = ((currentClose - lowestLow) / (highestHigh - lowestLow)) * 100;
  
  let signal = 'NEUTRAL';
  if (k >= 80) signal = 'OVERBOUGHT';
  else if (k <= 20) signal = 'OVERSOLD';
  
  return { k: Math.round(k * 10) / 10, signal };
}

function calculateMACD(prices: number[]): { value: number; signal: number; histogram: number; trend: string } | null {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  
  if (ema12 === null || ema26 === null) return null;
  
  const macdValue = ema12 - ema26;
  const signalLine = macdValue * 0.9;
  const histogram = macdValue - signalLine;
  
  let trend = 'NEUTRAL';
  if (macdValue > signalLine && histogram > 0) trend = 'BULLISH';
  else if (macdValue < signalLine && histogram < 0) trend = 'BEARISH';
  
  return {
    value: Math.round(macdValue * 1000) / 1000,
    signal: Math.round(signalLine * 1000) / 1000,
    histogram: Math.round(histogram * 1000) / 1000,
    trend
  };
}

function calculateBollinger(prices: number[]): { upper: number; middle: number; lower: number; position: string } | null {
  const period = 20;
  if (prices.length < period) return null;
  
  const recent = prices.slice(-period);
  const middle = recent.reduce((a, b) => a + b, 0) / period;
  const variance = recent.reduce((sum, p) => sum + Math.pow(p - middle, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  
  const upper = middle + (2 * stdDev);
  const lower = middle - (2 * stdDev);
  const current = prices[prices.length - 1];
  
  let position = 'MIDDLE';
  if (current >= upper) position = 'ABOVE_UPPER';
  else if (current <= lower) position = 'BELOW_LOWER';
  else if (current > middle) position = 'UPPER_HALF';
  else position = 'LOWER_HALF';
  
  return { upper: Math.round(upper * 100) / 100, middle: Math.round(middle * 100) / 100, lower: Math.round(lower * 100) / 100, position };
}

function detectCandlestickPatterns(candles: CandleData[]): any[] {
  const patterns: any[] = [];
  if (candles.length < 3) return patterns;
  
  const current = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  
  const bodySize = Math.abs(current.close - current.open);
  const totalRange = current.high - current.low;
  const lowerShadow = Math.min(current.open, current.close) - current.low;
  const upperShadow = current.high - Math.max(current.open, current.close);
  
  // Hammer
  if (totalRange > 0 && lowerShadow > bodySize * 2 && upperShadow < bodySize * 0.5) {
    patterns.push({
      pattern: 'HAMMER',
      pattern_ar: 'المطرقة',
      direction: 'BULLISH',
      confidence: 75,
      strength: 'MODERATE'
    });
  }
  
  // Shooting Star
  if (totalRange > 0 && upperShadow > bodySize * 2 && lowerShadow < bodySize * 0.5) {
    patterns.push({
      pattern: 'SHOOTING_STAR',
      pattern_ar: 'الشهاب',
      direction: 'BEARISH',
      confidence: 70,
      strength: 'MODERATE'
    });
  }
  
  // Bullish Engulfing
  if (prev && current.close > current.open && prev.close < prev.open) {
    if (current.open < prev.close && current.close > prev.open) {
      patterns.push({
        pattern: 'BULLISH_ENGULFING',
        pattern_ar: 'الابتلاع الصاعد',
        direction: 'BULLISH',
        confidence: 80,
        strength: 'STRONG'
      });
    }
  }
  
  // Bearish Engulfing
  if (prev && current.close < current.open && prev.close > prev.open) {
    if (current.open > prev.close && current.close < prev.open) {
      patterns.push({
        pattern: 'BEARISH_ENGULFING',
        pattern_ar: 'الابتلاع الهابط',
        direction: 'BEARISH',
        confidence: 80,
        strength: 'STRONG'
      });
    }
  }
  
  return patterns;
}

function calculateFibonacci(high: number, low: number, current: number): { goldenPrice: number; atGolden: boolean; levels: any } {
  const diff = high - low;
  if (diff <= 0) return { goldenPrice: 0, atGolden: false, levels: {} };
  
  const levels = {
    '0%': high,
    '23.6%': high - diff * 0.236,
    '38.2%': high - diff * 0.382,
    '50%': high - diff * 0.5,
    '61.8%': high - diff * 0.618,
    '78.6%': high - diff * 0.786,
    '100%': low
  };
  
  const goldenPrice = levels['61.8%'];
  const tolerance = diff * 0.02;
  const atGolden = Math.abs(current - goldenPrice) < tolerance;
  
  return { goldenPrice, atGolden, levels };
}

// ==================== Main Handler ====================

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  // P0-11-AUTH fix (2026-09-27): admin auth guard
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  
  try {
    // Verify admin
    const authHeader = request.headers.get('X-Admin-Token');
    if (!verifyAdminToken(authHeader || '')) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }
    
    const body = await request.json().catch(() => ({}));
    const {
      includeCrypto = true,
      includeEGX = true,
      minVolume = 1000,
      saveResults = true
    } = body;
    
    console.log('[Advanced Analysis] Starting daily scan...');
    
    // Get or create config
    let config = await db.advancedAnalysisConfig.findFirst();
    if (!config) {
      config = await db.advancedAnalysisConfig.create({
        data: {}
      });
    }
    
    // 1. Fetch all stocks
    const { stocks, source } = await fetchStocks();
    
    if (stocks.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'لا توجد أسهم متاحة للتحليل'
      }, { status: 404 });
    }
    
    console.log(`[Advanced Analysis] Found ${stocks.length} stocks (source: ${source})`);
    
    // 2. Analyze each stock
    const results: any[] = [];
    const today = new Date().toISOString().split('T')[0];
    const timestamp = new Date().toISOString();
    
    let aliveCount = 0;
    let deadCount = 0;
    let buyOpportunities = 0;
    let sellOpportunities = 0;
    let totalScore = 0;
    let highestScore = 0;
    let highestScoreTicker = '';
    const topBuyTickers: string[] = [];
    const topSellTickers: string[] = [];
    
    for (const stock of stocks) {
      try {
        // Fetch history
        const history = await fetchHistory(stock.symbol, 60);
        if (history.length < 10) continue;
        
        const closes = history.map(h => h.close);
        const highs = history.map(h => h.high);
        const lows = history.map(h => h.low);
        const currentPrice = stock.price;
        
        // Calculate vitality
        const volume = stock.volume || 0;
        const changePercent = Math.abs(stock.change_percent || 0);
        const avgVolume = history.reduce((sum, h) => sum + (h.volume || 0), 0) / history.length;
        const volumeRatio = avgVolume > 0 ? volume / avgVolume : 0;
        const priceRange = stock.high && stock.low ? stock.high - stock.low : 0;
        const volatility = currentPrice > 0 ? (priceRange / currentPrice) * 100 : 0;
        
        // Calculate vitality score
        let vitalityScore = 0;
        if (volume > 100000) vitalityScore += 30;
        else if (volume > 50000) vitalityScore += 20;
        else if (volume > 10000) vitalityScore += 10;
        
        if (changePercent > 2) vitalityScore += 25;
        else if (changePercent > 1) vitalityScore += 15;
        else if (changePercent > 0.5) vitalityScore += 10;
        
        if (volumeRatio > 1.5) vitalityScore += 20;
        else if (volumeRatio > 1) vitalityScore += 15;
        else if (volumeRatio > 0.5) vitalityScore += 10;
        
        const isAlive = vitalityScore >= 30;
        if (isAlive) aliveCount++; else deadCount++;
        
        // Technical Analysis
        const sma20 = calculateSMA(closes, 20);
        const sma50 = calculateSMA(closes, 50);
        const ema12 = calculateEMA(closes, 12);
        const ema26 = calculateEMA(closes, 26);
        const rsi = calculateRSI(closes);
        const stochastic = calculateStochastic(highs, lows, closes);
        const macd = calculateMACD(closes);
        const bollinger = calculateBollinger(closes);
        const candlePatterns = detectCandlestickPatterns(history);
        
        // Fibonacci
        const swingHigh = Math.max(...highs.slice(-20));
        const swingLow = Math.min(...lows.slice(-20));
        const fibonacci = calculateFibonacci(swingHigh, swingLow, currentPrice);
        
        // Calculate trend
        let trend = 'NEUTRAL';
        if (sma20 && sma50) {
          if (currentPrice > sma20 && sma20 > sma50) trend = 'UPTREND';
          else if (currentPrice < sma20 && sma20 < sma50) trend = 'DOWNTREND';
        }
        
        // Calculate overall score
        let overallScore = 50;
        
        if (trend === 'UPTREND') overallScore += 15;
        else if (trend === 'DOWNTREND') overallScore -= 15;
        
        if (rsi?.signal === 'OVERSOLD') overallScore += 10;
        else if (rsi?.signal === 'OVERBOUGHT') overallScore -= 10;
        
        if (stochastic?.signal === 'OVERSOLD') overallScore += 8;
        else if (stochastic?.signal === 'OVERBOUGHT') overallScore -= 8;
        
        if (macd?.trend === 'BULLISH') overallScore += 10;
        else if (macd?.trend === 'BEARISH') overallScore -= 10;
        
        if (candlePatterns.length > 0) {
          const bestPattern = candlePatterns[0];
          if (bestPattern.direction === 'BULLISH') overallScore += bestPattern.confidence * 0.15;
          else if (bestPattern.direction === 'BEARISH') overallScore -= bestPattern.confidence * 0.15;
        }
        
        if (fibonacci.atGolden && trend === 'DOWNTREND') overallScore += 12;
        
        overallScore = Math.max(0, Math.min(100, Math.round(overallScore)));
        totalScore += overallScore;
        
        if (overallScore > highestScore) {
          highestScore = overallScore;
          highestScoreTicker = stock.symbol;
        }
        
        // Determine recommendation
        let recommendation = 'HOLD';
        let recommendationAr = 'احتفاظ';
        
        if (overallScore >= 70) {
          recommendation = 'STRONG_BUY';
          recommendationAr = 'شراء قوي';
          buyOpportunities++;
          if (topBuyTickers.length < 10) topBuyTickers.push(stock.symbol);
        } else if (overallScore >= 60) {
          recommendation = 'BUY';
          recommendationAr = 'شراء';
          buyOpportunities++;
          if (topBuyTickers.length < 10) topBuyTickers.push(stock.symbol);
        } else if (overallScore <= 30) {
          recommendation = 'STRONG_SELL';
          recommendationAr = 'بيع قوي';
          sellOpportunities++;
          if (topSellTickers.length < 10) topSellTickers.push(stock.symbol);
        } else if (overallScore <= 40) {
          recommendation = 'SELL';
          recommendationAr = 'بيع';
          sellOpportunities++;
          if (topSellTickers.length < 10) topSellTickers.push(stock.symbol);
        }
        
        // Calculate trading levels
        const support = Math.min(...lows.slice(-20));
        const resistance = Math.max(...highs.slice(-20));
        
        const entryPrice = currentPrice;
        const stopLoss = recommendation.includes('BUY') 
          ? support * 0.98 
          : resistance * 1.02;
        const takeProfit1 = recommendation.includes('BUY')
          ? entryPrice + (entryPrice - stopLoss) * 1.5
          : null;
        const takeProfit2 = recommendation.includes('BUY')
          ? entryPrice + (entryPrice - stopLoss) * 2.5
          : null;
        
        // Risk level
        let riskLevel = 'MEDIUM';
        if (volatility > 5) riskLevel = 'HIGH';
        else if (volatility < 2) riskLevel = 'LOW';
        
        // Best pattern
        const bestPattern = candlePatterns.length > 0 ? candlePatterns[0] : null;
        
        // Create result object
        const result = {
          ticker: stock.symbol,
          name: stock.name,
          asset_type: 'stock',
          is_alive: isAlive,
          vitality_score: vitalityScore,
          vitality_reasons: JSON.stringify([]),
          current_price: currentPrice,
          previous_close: stock.previous_close,
          change_percent: stock.change_percent,
          volume: volume,
          trend,
          trend_ar: trend === 'UPTREND' ? 'صاعد' : trend === 'DOWNTREND' ? 'هابط' : 'محايد',
          overall_score: overallScore,
          rsi: rsi?.value,
          rsi_signal: rsi?.signal,
          macd_signal: macd?.trend,
          macd_histogram: macd?.histogram,
          bollinger_position: bollinger?.position,
          stochastic_k: stochastic?.k,
          stochastic_d: null,
          stochastic_signal: stochastic?.signal,
          sma_20: sma20,
          sma_50: sma50,
          ema_12: ema12,
          ema_26: ema26,
          candlestick_patterns: JSON.stringify(candlePatterns),
          best_pattern: bestPattern?.pattern,
          best_pattern_ar: bestPattern?.pattern_ar,
          best_pattern_signal: bestPattern?.direction,
          best_pattern_confidence: bestPattern?.confidence,
          fib_golden_price: fibonacci.goldenPrice,
          fib_at_golden: fibonacci.atGolden,
          fib_levels: JSON.stringify(fibonacci.levels),
          recommendation,
          recommendation_ar: recommendationAr,
          recommendation_score: overallScore,
          entry_price: entryPrice,
          stop_loss: stopLoss,
          take_profit_1: takeProfit1,
          take_profit_2: takeProfit2,
          take_profit_3: null,
          risk_level: riskLevel,
          risk_reward_ratio: takeProfit1 && stopLoss ? ((takeProfit1 - entryPrice) / (entryPrice - stopLoss)) : null,
          scan_date: today,
          scan_timestamp: timestamp
        };
        
        results.push(result);
        
      } catch (error) {
        console.error(`[Advanced Analysis] Error analyzing ${stock.symbol}:`, error);
      }
    }
    
    const duration = Date.now() - startTime;
    
    // Save results to database
    if (saveResults && results.length > 0) {
      try {
        // Delete old results for today
        await db.advancedAnalysisResult.deleteMany({
          where: { scan_date: today }
        });
        
        // Insert new results
        for (const result of results) {
          await db.advancedAnalysisResult.create({ data: result });
        }
        
        // Save summary
        await db.dailyAnalysisSummary.upsert({
          where: { scan_date: today },
          update: {
            total_stocks: stocks.length,
            alive_stocks: aliveCount,
            dead_stocks: deadCount,
            buy_opportunities: buyOpportunities,
            sell_opportunities: sellOpportunities,
            avg_score: totalScore / results.length,
            highest_score: highestScore,
            highest_score_ticker: highestScoreTicker,
            top_buy_tickers: JSON.stringify(topBuyTickers),
            top_sell_tickers: JSON.stringify(topSellTickers),
            scan_timestamp: timestamp,
            duration_ms: duration,
            status: 'completed'
          },
          create: {
            scan_date: today,
            total_stocks: stocks.length,
            alive_stocks: aliveCount,
            dead_stocks: deadCount,
            buy_opportunities: buyOpportunities,
            sell_opportunities: sellOpportunities,
            avg_score: totalScore / results.length,
            highest_score: highestScore,
            highest_score_ticker: highestScoreTicker,
            top_buy_tickers: JSON.stringify(topBuyTickers),
            top_sell_tickers: JSON.stringify(topSellTickers),
            scan_timestamp: timestamp,
            duration_ms: duration,
            status: 'completed'
          }
        });
        
        // Update config
        await db.advancedAnalysisConfig.update({
          where: { id: config.id },
          data: {
            last_scan_at: timestamp,
            last_scan_duration_ms: duration,
            last_scan_stocks: results.length
          }
        });
        
        console.log(`[Advanced Analysis] Saved ${results.length} results to database`);
        
      } catch (error) {
        console.error('[Advanced Analysis] Error saving to database:', error);
      }
    }
    
    console.log(`[Advanced Analysis] Completed in ${duration}ms`);
    
    return NextResponse.json({
      success: true,
      scan_timestamp: timestamp,
      duration_ms: duration,
      total_stocks: stocks.length,
      analyzed_stocks: results.length,
      alive_stocks: aliveCount,
      dead_stocks: deadCount,
      buy_opportunities: buyOpportunities,
      sell_opportunities: sellOpportunities,
      avg_score: Math.round((totalScore / results.length) * 10) / 10,
      highest_score: highestScore,
      highest_score_ticker: highestScoreTicker,
      top_buy_tickers: topBuyTickers.slice(0, 10),
      top_sell_tickers: topSellTickers.slice(0, 10),
      saved_to_db: saveResults,
      data_source: source
    });
    
  } catch (error) {
    console.error('[Advanced Analysis] Error:', error);
    return NextResponse.json({
      success: false,
      error: 'حدث خطأ في التحليل',
      details: String(error)
    }, { status: 500 });
  }
}

/**
 * GET: الحصول على حالة آخر فحص
 */
export async function GET(request: NextRequest) {
  // P0-11-AUTH fix (2026-09-27): admin auth guard
  const authError = await requireAdminAsync(request);
  if (authError) return authError;
  try {
    // Verify admin
    const authHeader = request.headers.get('X-Admin-Token');
    if (!verifyAdminToken(authHeader || '')) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }
    
    const config = await db.advancedAnalysisConfig.findFirst();
    const today = new Date().toISOString().split('T')[0];
    const todaySummary = await db.dailyAnalysisSummary.findUnique({
      where: { scan_date: today }
    });
    
    const resultsCount = await db.advancedAnalysisResult.count({
      where: { scan_date: today }
    });
    
    return NextResponse.json({
      success: true,
      config: {
        scan_time: config?.scan_time || '06:00',
        scan_enabled: config?.scan_enabled ?? true,
        last_scan_at: config?.last_scan_at,
        last_scan_duration_ms: config?.last_scan_duration_ms,
        last_scan_stocks: config?.last_scan_stocks
      },
      today_summary: todaySummary,
      today_results_count: resultsCount
    });
    
  } catch (error) {
    console.error('[admin:advanced-analysis:run]', error);
    return NextResponse.json({
      success: false,
      error: 'internal_error'
    }, { status: 500 });
  }
}
