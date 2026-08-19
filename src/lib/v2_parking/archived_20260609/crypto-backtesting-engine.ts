/**
 * محرك الاختبار الرجعي للعملات الرقمية - Crypto Backtesting Engine
 * 
 * نفس نظام التعلم التكراري الموجود للأسهم المصرية
 * لكن مُكيّف للعملات الرقمية (تقلب أعلى، تداول 24/7)
 */

// ==================== TYPES ====================

export interface CryptoBacktestConfig {
  start_date: string;      // YYYY-MM-DD
  end_date: string;        // YYYY-MM-DD
  capital: number;         // رأس المال بالدولار
  max_positions: number;   // أقصى عدد صفقات مفتوحة
  holding_days: number;    // عدد أيام الاحتفاظ
  confidence_threshold: number; // حد الثقة للدخول
  coins?: string[];        // عملات محددة (اختياري)
  
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
    volume_threshold?: number;
  };
}

export interface CryptoBacktestTrade {
  id: number;
  coin: string;
  symbol: string;
  entry_date: string;
  entry_price: number;
  action: 'BUY' | 'SELL';
  quantity: number;
  position_value: number;
  stop_loss: number;
  target_price: number;
  confidence: number;
  reasoning: string;
  
  // النتيجة الفعلية
  exit_date: string;
  exit_price: number;
  actual_high: number;
  actual_low: number;
  actual_return: number;
  
  // التقييم
  hit_target: boolean;
  hit_stop_loss: boolean;
  analysis_correct: boolean;
  lesson: string;
}

export interface CryptoBacktestResult {
  config: CryptoBacktestConfig;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_return: number;
  avg_return: number;
  avg_winner: number;
  avg_loser: number;
  best_trade: CryptoBacktestTrade | null;
  worst_trade: CryptoBacktestTrade | null;
  sharpe_ratio: number;
  max_drawdown: number;
  
  trades: CryptoBacktestTrade[];
  lessons: string[];
  
  // أداء حسب العملة
  coin_performance: Map<string, { trades: number; win_rate: number; avg_return: number }>;
}

// ==================== DEFAULT PARAMETERS ====================

const DEFAULT_PARAMS = {
  rsi_oversold: 30,
  rsi_overbought: 70,
  rsi_weight: 15,
  macd_weight: 10,
  ma_weight: 12,
  bollinger_weight: 8,
  stop_loss_min: 5,      // أعلى للكريبتو
  stop_loss_max: 15,     // أعلى للكريبتو
  target_multiplier: 2,
  min_indicators_agree: 2,
  volume_threshold: 1.5
};

const DEFAULT_CONFIG = {
  capital: 10000,
  max_positions: 5,
  holding_days: 14,      // أقل للكريبتو
  confidence_threshold: 65,
  start_date: '2025-01-01',
  end_date: '2025-03-31'
};

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
  volume_ratio: number;
}

function analyzeTechnical(
  priceHistory: { open: number; high: number; low: number; close: number; volume: number }[]
): TechnicalAnalysis | null {
  if (priceHistory.length < 30) return null;
  
  const closes = priceHistory.map(p => p.close);
  const highs = priceHistory.map(p => p.high);
  const lows = priceHistory.map(p => p.low);
  const volumes = priceHistory.map(p => p.volume);
  const currentPrice = closes[closes.length - 1];
  
  // RSI
  const rsi = calculateRSI(closes);
  const rsi_signal = rsi < 30 ? 'oversold' : rsi > 70 ? 'overbought' : 'neutral';
  
  // MACD
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macd = ema12 - ema26;
  const signal = macd * 0.9;
  const macd_signal = macd > signal && macd > 0 ? 'bullish' : macd < signal && macd < 0 ? 'bearish' : 'neutral';
  
  // Moving Averages
  const ma20 = calculateSMA(closes, 20);
  const ma50 = calculateSMA(closes, 50);
  
  const above20 = currentPrice > ma20;
  const above50 = currentPrice > ma50;
  
  let ma_signal: 'above_all' | 'above_20_50' | 'below_all' | 'mixed' = 'mixed';
  if (above20 && above50) ma_signal = 'above_all';
  else if (above20 && !above50) ma_signal = 'above_20_50';
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
  
  // Volume Ratio
  const avgVolume = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
  const volume_ratio = avgVolume > 0 ? volumes[volumes.length - 1] / avgVolume : 1;
  
  return {
    rsi: Math.round(rsi * 100) / 100,
    rsi_signal,
    macd_signal,
    ma_signal,
    bollinger_signal,
    current_price: Math.round(currentPrice * 100000) / 100000,
    atr_percent: Math.round(atr_percent * 100) / 100,
    volume_ratio: Math.round(volume_ratio * 100) / 100
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

function makeDecision(tech: TechnicalAnalysis, params: typeof DEFAULT_PARAMS = DEFAULT_PARAMS): TradeDecision {
  let score = 50;
  const reasons: string[] = [];
  let bullishIndicators = 0;
  let bearishIndicators = 0;
  
  // RSI
  if (tech.rsi <= params.rsi_oversold) {
    score += params.rsi_weight;
    reasons.push('RSI تشبع بيعي');
    bullishIndicators++;
  } else if (tech.rsi >= params.rsi_overbought) {
    score -= params.rsi_weight;
    reasons.push('RSI تشبع شرائي');
    bearishIndicators++;
  }
  
  // MACD
  if (tech.macd_signal === 'bullish') {
    score += params.macd_weight;
    reasons.push('MACD إيجابي');
    bullishIndicators++;
  } else if (tech.macd_signal === 'bearish') {
    score -= params.macd_weight;
    reasons.push('MACD سلبي');
    bearishIndicators++;
  }
  
  // MA
  if (tech.ma_signal === 'above_all') {
    score += params.ma_weight;
    reasons.push('فوق كل المتوسطات');
    bullishIndicators++;
  } else if (tech.ma_signal === 'below_all') {
    score -= params.ma_weight;
    reasons.push('تحت كل المتوسطات');
    bearishIndicators++;
  }
  
  // Bollinger
  if (tech.bollinger_signal === 'below_lower') {
    score += params.bollinger_weight;
    reasons.push('تحت النطاق السفلي');
    bullishIndicators++;
  } else if (tech.bollinger_signal === 'above_upper') {
    score -= params.bollinger_weight;
    reasons.push('فوق النطاق العلوي');
    bearishIndicators++;
  }
  
  // Volume boost
  if (tech.volume_ratio > params.volume_threshold) {
    score += 5;
    reasons.push(`حجم عالي (${tech.volume_ratio.toFixed(1)}x)`);
  }
  
  // Decision
  const minAgree = params.min_indicators_agree;
  let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  
  if (bullishIndicators >= minAgree && score >= 60) {
    action = 'BUY';
  } else if (bearishIndicators >= minAgree && score <= 40) {
    action = 'SELL';
  }
  
  // Stop Loss & Target - Crypto needs wider stops
  const stopLossPercent = Math.max(params.stop_loss_min, Math.min(params.stop_loss_max, tech.atr_percent * 2));
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
    stop_loss: Math.round(stopLoss * 100000) / 100000,
    target_price: Math.round(target * 100000) / 100000,
    reasoning: reasons.join(' | ')
  };
}

// ==================== DATA FETCHER ====================

async function fetchCryptoHistory(coin: string, days: number = 365): Promise<{
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}[]> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    
    // Use CoinGecko API (free, no key needed)
    const url = `https://api.coingecko.com/api/v3/coins/${coin}/ohlc?vs_currency=usd&days=${Math.min(days, 365)}`;
    
    const response = await fetch(url, {
      signal: controller.signal,
      next: { revalidate: 86400 }
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      console.log(`[CryptoBacktest] ${coin}: API returned ${response.status}`);
      return [];
    }
    
    const data = await response.json();
    
    // CoinGecko OHLC format: [timestamp, open, high, low, close]
    const history = data.map((candle: number[]) => ({
      date: new Date(candle[0]).toISOString().split('T')[0],
      open: candle[1],
      high: candle[2],
      low: candle[3],
      close: candle[4],
      volume: 0 // OHLC doesn't include volume
    }));
    
    console.log(`[CryptoBacktest] ${coin}: ${history.length} records`);
    return history;
    
  } catch (error) {
    console.error(`[CryptoBacktest] Failed to fetch history for ${coin}:`, error);
    return [];
  }
}

// Top cryptocurrencies for backtesting
const TOP_CRYPTOS = [
  { id: 'bitcoin', symbol: 'BTC' },
  { id: 'ethereum', symbol: 'ETH' },
  { id: 'binancecoin', symbol: 'BNB' },
  { id: 'solana', symbol: 'SOL' },
  { id: 'ripple', symbol: 'XRP' },
  { id: 'cardano', symbol: 'ADA' },
  { id: 'dogecoin', symbol: 'DOGE' },
  { id: 'polkadot', symbol: 'DOT' },
  { id: 'avalanche-2', symbol: 'AVAX' },
  { id: 'chainlink', symbol: 'LINK' }
];

// ==================== MAIN BACKTEST ENGINE ====================

export async function runCryptoBacktest(config: Partial<CryptoBacktestConfig> = {}): Promise<CryptoBacktestResult> {
  const fullConfig: CryptoBacktestConfig = {
    ...DEFAULT_CONFIG,
    ...config
  };
  
  // Merge default params with provided params - THIS IS THE KEY FIX!
  const effectiveParams = {
    ...DEFAULT_PARAMS,
    ...(fullConfig.parameters || {})
  };
  
  console.log('[CryptoBacktest] Starting crypto backtest with params:', effectiveParams);
  
  const trades: CryptoBacktestTrade[] = [];
  let tradeId = 0;
  
  // Get coins to test
  const coins = fullConfig.coins || TOP_CRYPTOS.map(c => c.id);
  console.log(`[CryptoBacktest] Testing ${coins.length} coins`);
  
  // For each coin, get history
  for (const coinId of coins) {
    try {
      const crypto = TOP_CRYPTOS.find(c => c.id === coinId) || { id: coinId, symbol: coinId.toUpperCase() };
      
      const history = await fetchCryptoHistory(coinId, 365);
      
      if (history.length < 60) {
        console.log(`[CryptoBacktest] ${coinId}: Skipped - only ${history.length} days`);
        continue;
      }
      
      // Skip first 50 for indicators
      const startIndex = 50;
      const endIndex = history.length - fullConfig.holding_days;
      
      if (endIndex <= startIndex) {
        console.log(`[CryptoBacktest] ${coinId}: Skipped - not enough days after holding period`);
        continue;
      }
      
      let tradesForCoin = 0;
      
      // Process each day
      for (let i = startIndex; i < endIndex; i++) {
        const currentDate = history[i].date;
        
        // Only trade in the test period
        if (currentDate < fullConfig.start_date) continue;
        if (currentDate > fullConfig.end_date) break;
        
        // Get data up to current date
        const dataUpToNow = history.slice(0, i + 1);
        
        // Analyze
        const tech = analyzeTechnical(dataUpToNow);
        if (!tech) continue;
        
        // Make decision - use effectiveParams
        const decision = makeDecision(tech, effectiveParams);
        
        // Only trade if confidence meets threshold
        if (decision.action === 'HOLD' || decision.confidence < fullConfig.confidence_threshold) continue;
        
        const entryPrice = tech.current_price;
        const quantity = (fullConfig.capital / fullConfig.max_positions) / entryPrice;
        const positionValue = quantity * entryPrice;
        
        // Look ahead
        const futureData = history.slice(i + 1, i + 1 + fullConfig.holding_days);
        
        if (futureData.length < fullConfig.holding_days) continue;
        
        const actualHigh = Math.max(...futureData.map(d => d.high));
        const actualLow = Math.min(...futureData.map(d => d.low));
        const exitPrice = futureData[futureData.length - 1].close;
        
        // Check target/stop
        let hitTarget = false, hitStopLoss = false;
        
        if (decision.action === 'BUY') {
          hitTarget = actualHigh >= decision.target_price;
          hitStopLoss = actualLow <= decision.stop_loss;
        } else {
          hitTarget = actualLow <= decision.target_price;
          hitStopLoss = actualHigh >= decision.stop_loss;
        }
        
        // Calculate return
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
        
        // Deduct fees (0.5% for crypto)
        actualReturn -= 0.5;
        
        // Analysis correct?
        const analysisCorrect = actualReturn > 0;
        
        // Lesson
        let lesson = '';
        if (analysisCorrect) {
          lesson = `✅ نجاح: ${decision.reasoning}`;
        } else {
          lesson = `❌ خطأ: ${decision.reasoning}`;
        }
        
        tradeId++;
        trades.push({
          id: tradeId,
          coin: coinId,
          symbol: crypto.symbol,
          entry_date: currentDate,
          entry_price: entryPrice,
          action: decision.action,
          quantity: Math.round(quantity * 100000) / 100000,
          position_value: Math.round(positionValue * 100) / 100,
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
        
        tradesForCoin++;
        
        // Skip some days after trade
        i += 3;
      }
      
      console.log(`[CryptoBacktest] ${coinId}: ${tradesForCoin} trades`);
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`[CryptoBacktest] Error processing ${coinId}:`, error);
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
  
  const sortedByReturn = [...trades].sort((a, b) => b.actual_return - a.actual_return);
  
  const lessons = trades
    .filter(t => !t.analysis_correct)
    .map(t => t.lesson)
    .slice(0, 20);
  
  // Coin performance
  const coinPerf = new Map<string, { trades: number; wins: number; total_return: number }>();
  for (const t of trades) {
    const existing = coinPerf.get(t.coin) || { trades: 0, wins: 0, total_return: 0 };
    existing.trades++;
    if (t.actual_return > 0) existing.wins++;
    existing.total_return += t.actual_return;
    coinPerf.set(t.coin, existing);
  }
  
  const coinPerformance = new Map<string, { trades: number; win_rate: number; avg_return: number }>();
  for (const [coin, data] of coinPerf) {
    coinPerformance.set(coin, {
      trades: data.trades,
      win_rate: (data.wins / data.trades) * 100,
      avg_return: data.total_return / data.trades
    });
  }
  
  return {
    config: fullConfig,
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
    max_drawdown: 0,
    trades,
    lessons,
    coin_performance: coinPerformance
  };
}
