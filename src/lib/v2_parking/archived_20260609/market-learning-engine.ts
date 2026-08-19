/**
 * نظام التعلّم من حركة السوق
 * Market Movement Learning Engine
 *
 * يتعلم من البيانات التاريخية وحركة السوق الفعلية
 * وليس من صفقات المستخدم
 */

import { createDatabase, isInitialized, type SqliteDatabase } from '@/lib/sqlite-wrapper';
import * as path from 'path';
import { existsSync } from 'fs';

// ==================== TYPES ====================

export type SignalDirection = 'buy' | 'sell';
export type MarketPhase = 'BULL' | 'BEAR' | 'RANGE';
export type IndicatorType = 'RSI' | 'MACD' | 'Bollinger' | 'MA' | 'ADX' | 'Stochastic' | 'Volume' | 'SupportResistance';

export interface MarketSignal {
  id?: number;
  ticker: string;
  signal_date: string;
  direction: SignalDirection;
  entry_price: number;
  stop_loss: number;
  target_price: number;
  indicators_used: IndicatorType[];
  indicator_scores: Record<string, number>;
  market_phase: MarketPhase;
  confidence: number;
  status: 'pending' | 'hit_target' | 'hit_stop' | 'expired';
  outcome_date?: string;
  outcome_price?: number;
  profit_loss_percent?: number;
  days_to_resolve?: number;
  created_at: string;
}

export interface IndicatorPerformance {
  indicator: IndicatorType;
  market_phase: MarketPhase;
  total_signals: number;
  hit_target: number;
  hit_stop: number;
  win_rate: number;
  avg_profit: number;
  avg_loss: number;
  expectancy: number;
  last_updated: string;
}

export interface MarketLesson {
  id?: number;
  lesson_type: 'indicator_failure' | 'pattern_success' | 'market_condition';
  title: string;
  description: string;
  trigger_conditions: string;
  recommended_action: string;
  confidence: number;
  occurrences: number;
  success_rate: number;
  first_seen: string;
  last_seen: string;
  status: 'active' | 'testing' | 'deprecated';
}

// ==================== DATABASE ACCESS ====================

function getDb(): SqliteDatabase {
  if (!isInitialized()) {
    throw new Error('sql.js is not yet initialized');
  }
  const dbPath = path.join(process.cwd(), 'db', 'egx_investment.db');
  if (!existsSync(dbPath)) {
    throw new Error(`Database not found: ${dbPath}`);
  }
  return createDatabase(dbPath);
}

// ==================== TABLE INITIALIZATION ====================

export function initializeMarketLearningTables(): void {
  const db = getDb();
  try {
    db.pragma('journal_mode = WAL');

    // جدول إشارات السوق (Paper Trades)
    db.run(`
      CREATE TABLE IF NOT EXISTS market_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        signal_date TEXT NOT NULL,
        direction TEXT NOT NULL,
        entry_price REAL NOT NULL,
        stop_loss REAL NOT NULL,
        target_price REAL NOT NULL,
        indicators_used TEXT NOT NULL,
        indicator_scores TEXT DEFAULT '{}',
        market_phase TEXT DEFAULT 'RANGE',
        confidence REAL DEFAULT 50,
        status TEXT DEFAULT 'pending',
        outcome_date TEXT,
        outcome_price REAL,
        profit_loss_percent REAL,
        days_to_resolve INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // جدول أداء المؤشرات حسب طور السوق
    db.run(`
      CREATE TABLE IF NOT EXISTS indicator_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        indicator TEXT NOT NULL,
        market_phase TEXT NOT NULL,
        total_signals INTEGER DEFAULT 0,
        hit_target INTEGER DEFAULT 0,
        hit_stop INTEGER DEFAULT 0,
        win_rate REAL DEFAULT 0,
        avg_profit REAL DEFAULT 0,
        avg_loss REAL DEFAULT 0,
        expectancy REAL DEFAULT 0,
        last_updated TEXT DEFAULT (datetime('now')),
        UNIQUE(indicator, market_phase)
      )
    `);

    // جدول دروس السوق
    db.run(`
      CREATE TABLE IF NOT EXISTS market_lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        trigger_conditions TEXT,
        recommended_action TEXT,
        confidence REAL DEFAULT 0,
        occurrences INTEGER DEFAULT 1,
        success_rate REAL DEFAULT 0,
        first_seen TEXT DEFAULT (datetime('now')),
        last_seen TEXT DEFAULT (datetime('now')),
        status TEXT DEFAULT 'testing'
      )
    `);

    // فهارس
    db.run(`CREATE INDEX IF NOT EXISTS idx_market_signals_ticker ON market_signals(ticker)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_market_signals_date ON market_signals(signal_date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_market_signals_status ON market_signals(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_indicator_performance_lookup ON indicator_performance(indicator, market_phase)`);

    console.log('[MarketLearning] Tables initialized successfully');
  } finally {
    db.close();
  }
}

// ==================== SIGNAL GENERATION FROM HISTORICAL DATA ====================

/**
 * توليد إشارات من البيانات التاريخية
 * Generate signals from historical OHLCV data
 */
export function generateHistoricalSignals(
  ticker: string,
  ohlcvData: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>,
  lookbackDays: number = 30
): MarketSignal[] {
  const signals: MarketSignal[] = [];
  
  if (ohlcvData.length < 50) {
    console.log(`[MarketLearning] Not enough data for ${ticker}: ${ohlcvData.length} bars`);
    return signals;
  }

  // حساب المؤشرات لكل نقطة
  for (let i = 50; i < ohlcvData.length - lookbackDays; i++) {
    const currentBar = ohlcvData[i];
    const historicalData = ohlcvData.slice(0, i + 1);
    
    // حساب RSI
    const rsi = calculateRSI(historicalData, 14);
    const currentRsi = rsi[rsi.length - 1];
    
    // حساب SMA
    const sma20 = calculateSMA(historicalData, 20);
    const sma50 = calculateSMA(historicalData, 50);
    const currentSma20 = sma20[sma20.length - 1];
    const currentSma50 = sma50[sma50.length - 1];
    
    // حساب MACD
    const macd = calculateMACD(historicalData);
    const currentMacd = macd.histogram[macd.histogram.length - 1];
    
    // حساب Bollinger Bands
    const bb = calculateBollingerBands(historicalData, 20);
    const currentBb = bb[bb.length - 1];
    
    // تحديد طور السوق
    const marketPhase = determineMarketPhase(historicalData.slice(-20));
    
    // تحديد الإشارة
    const signalResult = evaluateSignal(
      currentBar.close,
      currentRsi,
      currentSma20,
      currentSma50,
      currentMacd,
      currentBb,
      marketPhase
    );
    
    if (signalResult.direction && signalResult.confidence >= 60) {
      // حساب مستويات الدخول والوقف والهدف
      const atr = calculateATR(historicalData, 14);
      const currentAtr = atr[atr.length - 1];
      
      let entryPrice = currentBar.close;
      let stopLoss: number;
      let targetPrice: number;
      
      if (signalResult.direction === 'buy') {
        stopLoss = entryPrice - (currentAtr * 2);
        targetPrice = entryPrice + (currentAtr * 3);
      } else {
        stopLoss = entryPrice + (currentAtr * 2);
        targetPrice = entryPrice - (currentAtr * 3);
      }
      
      // التحقق من النتيجة الفعلية
      const futureData = ohlcvData.slice(i + 1, i + 1 + lookbackDays);
      const outcome = checkSignalOutcome(entryPrice, stopLoss, targetPrice, signalResult.direction, futureData);
      
      const signal: MarketSignal = {
        ticker,
        signal_date: currentBar.date,
        direction: signalResult.direction,
        entry_price: entryPrice,
        stop_loss: stopLoss,
        target_price: targetPrice,
        indicators_used: signalResult.indicators,
        indicator_scores: signalResult.indicatorScores,
        market_phase: marketPhase,
        confidence: signalResult.confidence,
        status: outcome.status,
        outcome_date: outcome.outcomeDate,
        outcome_price: outcome.outcomePrice,
        profit_loss_percent: outcome.profitLossPercent,
        days_to_resolve: outcome.daysToResolve,
        created_at: new Date().toISOString(),
      };
      
      signals.push(signal);
    }
  }
  
  return signals;
}

// ==================== INDICATOR CALCULATIONS ====================

function calculateRSI(data: Array<{ close: number }>, period: number): number[] {
  const rsi: number[] = [];
  const gains: number[] = [];
  const losses: number[] = [];
  
  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? Math.abs(change) : 0);
  }
  
  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      rsi.push(50);
    } else {
      const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }
  }
  
  return rsi;
}

function calculateSMA(data: Array<{ close: number }>, period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      sma.push(0);
    } else {
      const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b.close, 0);
      sma.push(sum / period);
    }
  }
  return sma;
}

function calculateMACD(data: Array<{ close: number }>): { line: number[]; signal: number[]; histogram: number[] } {
  const ema12 = calculateEMA(data.map(d => d.close), 12);
  const ema26 = calculateEMA(data.map(d => d.close), 26);
  const line = ema12.map((v, i) => v - ema26[i]);
  const signal = calculateEMA(line, 9);
  const histogram = line.map((v, i) => v - signal[i]);
  return { line, signal, histogram };
}

function calculateEMA(values: number[], period: number): number[] {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      ema.push(values[i]);
    } else if (i === period - 1) {
      ema.push(values.slice(0, period).reduce((a, b) => a + b, 0) / period);
    } else {
      ema.push((values[i] - ema[i - 1]) * multiplier + ema[i - 1]);
    }
  }
  
  return ema;
}

function calculateBollingerBands(data: Array<{ close: number }>, period: number): Array<{ upper: number; middle: number; lower: number }> {
  return data.map((_, idx) => {
    if (idx < period - 1) {
      return { upper: 0, middle: 0, lower: 0 };
    }
    const slice = data.slice(idx - period + 1, idx + 1);
    const closes = slice.map(d => d.close);
    const mean = closes.reduce((a, b) => a + b, 0) / period;
    const variance = closes.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
    const std = Math.sqrt(variance);
    return {
      upper: mean + 2 * std,
      middle: mean,
      lower: mean - 2 * std,
    };
  });
}

function calculateATR(data: Array<{ high: number; low: number; close: number }>, period: number): number[] {
  const tr: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      tr.push(data[i].high - data[i].low);
    } else {
      const hl = data[i].high - data[i].low;
      const hc = Math.abs(data[i].high - data[i - 1].close);
      const lc = Math.abs(data[i].low - data[i - 1].close);
      tr.push(Math.max(hl, hc, lc));
    }
  }
  
  const atr: number[] = [];
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) {
      atr.push(0);
    } else if (i === period - 1) {
      atr.push(tr.slice(0, period).reduce((a, b) => a + b, 0) / period);
    } else {
      atr.push((atr[i - 1] * (period - 1) + tr[i]) / period);
    }
  }
  
  return atr;
}

function determineMarketPhase(data: Array<{ close: number }>): MarketPhase {
  if (data.length < 20) return 'RANGE';
  
  const closes = data.map(d => d.close);
  const firstHalf = closes.slice(0, Math.floor(closes.length / 2));
  const secondHalf = closes.slice(Math.floor(closes.length / 2));
  
  const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
  
  const change = ((secondAvg - firstAvg) / firstAvg) * 100;
  
  if (change > 5) return 'BULL';
  if (change < -5) return 'BEAR';
  return 'RANGE';
}

// ==================== SIGNAL EVALUATION ====================

function evaluateSignal(
  price: number,
  rsi: number,
  sma20: number,
  sma50: number,
  macdHistogram: number,
  bollinger: { upper: number; middle: number; lower: number },
  marketPhase: MarketPhase
): { direction: SignalDirection | null; confidence: number; indicators: IndicatorType[]; indicatorScores: Record<string, number> } {
  
  const indicators: IndicatorType[] = [];
  const indicatorScores: Record<string, number> = {};
  let buyScore = 0;
  let sellScore = 0;
  
  // RSI
  if (rsi < 30) {
    buyScore += 25;
    indicators.push('RSI');
    indicatorScores['RSI'] = 25;
  } else if (rsi > 70) {
    sellScore += 25;
    indicators.push('RSI');
    indicatorScores['RSI'] = 25;
  } else {
    indicatorScores['RSI'] = 0;
  }
  
  // SMA Crossover
  if (sma20 > sma50 && price > sma20) {
    buyScore += 20;
    indicators.push('MA');
    indicatorScores['MA'] = 20;
  } else if (sma20 < sma50 && price < sma20) {
    sellScore += 20;
    indicators.push('MA');
    indicatorScores['MA'] = 20;
  } else {
    indicatorScores['MA'] = 0;
  }
  
  // MACD
  if (macdHistogram > 0) {
    buyScore += 15;
    indicators.push('MACD');
    indicatorScores['MACD'] = 15;
  } else if (macdHistogram < 0) {
    sellScore += 15;
    indicators.push('MACD');
    indicatorScores['MACD'] = 15;
  } else {
    indicatorScores['MACD'] = 0;
  }
  
  // Bollinger Bands
  if (price < bollinger.lower) {
    buyScore += 20;
    indicators.push('Bollinger');
    indicatorScores['Bollinger'] = 20;
  } else if (price > bollinger.upper) {
    sellScore += 20;
    indicators.push('Bollinger');
    indicatorScores['Bollinger'] = 20;
  } else {
    indicatorScores['Bollinger'] = 0;
  }
  
  // Adjust for market phase
  if (marketPhase === 'BULL') {
    buyScore *= 1.2;
    sellScore *= 0.8;
  } else if (marketPhase === 'BEAR') {
    buyScore *= 0.8;
    sellScore *= 1.2;
  }
  
  const totalScore = Math.max(buyScore, sellScore);
  const direction = buyScore > sellScore ? 'buy' : buyScore < sellScore ? 'sell' : null;
  
  return {
    direction,
    confidence: totalScore,
    indicators,
    indicatorScores,
  };
}

// ==================== OUTCOME CHECKING ====================

function checkSignalOutcome(
  entryPrice: number,
  stopLoss: number,
  targetPrice: number,
  direction: SignalDirection,
  futureData: Array<{ date: string; high: number; low: number; close: number }>
): { status: MarketSignal['status']; outcomeDate?: string; outcomePrice?: number; profitLossPercent?: number; daysToResolve?: number } {
  
  for (let i = 0; i < futureData.length; i++) {
    const bar = futureData[i];
    
    if (direction === 'buy') {
      // Check if target hit
      if (bar.high >= targetPrice) {
        const profitPercent = ((targetPrice - entryPrice) / entryPrice) * 100;
        return {
          status: 'hit_target',
          outcomeDate: bar.date,
          outcomePrice: targetPrice,
          profitLossPercent: profitPercent,
          daysToResolve: i + 1,
        };
      }
      // Check if stop loss hit
      if (bar.low <= stopLoss) {
        const lossPercent = ((stopLoss - entryPrice) / entryPrice) * 100;
        return {
          status: 'hit_stop',
          outcomeDate: bar.date,
          outcomePrice: stopLoss,
          profitLossPercent: lossPercent,
          daysToResolve: i + 1,
        };
      }
    } else {
      // Sell direction
      if (bar.low <= targetPrice) {
        const profitPercent = ((entryPrice - targetPrice) / entryPrice) * 100;
        return {
          status: 'hit_target',
          outcomeDate: bar.date,
          outcomePrice: targetPrice,
          profitLossPercent: profitPercent,
          daysToResolve: i + 1,
        };
      }
      if (bar.high >= stopLoss) {
        const lossPercent = ((entryPrice - stopLoss) / entryPrice) * 100;
        return {
          status: 'hit_stop',
          outcomeDate: bar.date,
          outcomePrice: stopLoss,
          profitLossPercent: lossPercent,
          daysToResolve: i + 1,
        };
      }
    }
  }
  
  // Expired - use final price
  const finalBar = futureData[futureData.length - 1];
  const profitPercent = direction === 'buy'
    ? ((finalBar.close - entryPrice) / entryPrice) * 100
    : ((entryPrice - finalBar.close) / entryPrice) * 100;
  
  return {
    status: 'expired',
    outcomeDate: finalBar.date,
    outcomePrice: finalBar.close,
    profitLossPercent: profitPercent,
    daysToResolve: futureData.length,
  };
}

// ==================== SAVE SIGNALS ====================

export function saveSignals(signals: MarketSignal[]): number {
  if (signals.length === 0) return 0;
  
  const db = getDb();
  try {
    db.pragma('journal_mode = WAL');
    
    const stmt = db.prepare(`
      INSERT OR REPLACE INTO market_signals (
        ticker, signal_date, direction, entry_price, stop_loss, target_price,
        indicators_used, indicator_scores, market_phase, confidence, status,
        outcome_date, outcome_price, profit_loss_percent, days_to_resolve
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    let count = 0;
    for (const signal of signals) {
      try {
        stmt.run(
          signal.ticker,
          signal.signal_date,
          signal.direction,
          signal.entry_price,
          signal.stop_loss,
          signal.target_price,
          JSON.stringify(signal.indicators_used),
          JSON.stringify(signal.indicator_scores),
          signal.market_phase,
          signal.confidence,
          signal.status,
          signal.outcome_date || null,
          signal.outcome_price || null,
          signal.profit_loss_percent || null,
          signal.days_to_resolve || null
        );
        count++;
      } catch (e) {
        // Skip duplicates
      }
    }
    
    return count;
  } finally {
    db.close();
  }
}

// ==================== UPDATE INDICATOR PERFORMANCE ====================

export function updateIndicatorPerformance(): void {
  const db = getDb();
  try {
    db.pragma('journal_mode = WAL');
    
    const indicators: IndicatorType[] = ['RSI', 'MACD', 'Bollinger', 'MA', 'Stochastic', 'Volume', 'SupportResistance'];
    const phases: MarketPhase[] = ['BULL', 'BEAR', 'RANGE'];
    
    for (const indicator of indicators) {
      for (const phase of phases) {
        // Get signals where this indicator was used
        const signals = db.prepare(`
          SELECT * FROM market_signals 
          WHERE indicators_used LIKE ? 
          AND market_phase = ?
          AND status != 'pending'
        `).all(`%"${indicator}"%`, phase) as Array<Record<string, unknown>>;
        
        if (signals.length < 3) continue;
        
        const total = signals.length;
        const hitTarget = signals.filter(s => s.status === 'hit_target').length;
        const hitStop = signals.filter(s => s.status === 'hit_stop').length;
        const winRate = (hitTarget / total) * 100;
        
        const profits = signals
          .filter(s => (s.profit_loss_percent as number) > 0)
          .map(s => s.profit_loss_percent as number);
        const losses = signals
          .filter(s => (s.profit_loss_percent as number) < 0)
          .map(s => Math.abs(s.profit_loss_percent as number));
        
        const avgProfit = profits.length > 0 ? profits.reduce((a, b) => a + b, 0) / profits.length : 0;
        const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;
        
        // Expectancy = (Win Rate * Avg Profit) - (Loss Rate * Avg Loss)
        const expectancy = (winRate / 100 * avgProfit) - ((100 - winRate) / 100 * avgLoss);
        
        db.prepare(`
          INSERT OR REPLACE INTO indicator_performance (
            indicator, market_phase, total_signals, hit_target, hit_stop,
            win_rate, avg_profit, avg_loss, expectancy, last_updated
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).run(indicator, phase, total, hitTarget, hitStop, winRate, avgProfit, avgLoss, expectancy);
      }
    }
    
    console.log('[MarketLearning] Indicator performance updated');
  } finally {
    db.close();
  }
}

// ==================== GET INDICATOR PERFORMANCE ====================

export function getIndicatorPerformance(indicator?: IndicatorType, phase?: MarketPhase): IndicatorPerformance[] {
  const db = getDb();
  try {
    let query = 'SELECT * FROM indicator_performance WHERE 1=1';
    const params: string[] = [];
    
    if (indicator) {
      query += ' AND indicator = ?';
      params.push(indicator);
    }
    if (phase) {
      query += ' AND market_phase = ?';
      params.push(phase);
    }
    
    const rows = db.prepare(query).all(...params) as Array<Record<string, unknown>>;
    
    return rows.map(row => ({
      indicator: row.indicator as IndicatorType,
      market_phase: row.market_phase as MarketPhase,
      total_signals: row.total_signals as number,
      hit_target: row.hit_target as number,
      hit_stop: row.hit_stop as number,
      win_rate: row.win_rate as number,
      avg_profit: row.avg_profit as number,
      avg_loss: row.avg_loss as number,
      expectancy: row.expectancy as number,
      last_updated: row.last_updated as string,
    }));
  } finally {
    db.close();
  }
}

// ==================== GET RECOMMENDED WEIGHTS ====================

export function getRecommendedWeights(marketPhase: MarketPhase): Record<string, number> {
  const performances = getIndicatorPerformance(undefined, marketPhase);
  const weights: Record<string, number> = {};
  
  for (const perf of performances) {
    // Base weight on expectancy
    // Positive expectancy = increase weight, negative = decrease
    let weight = 1.0;
    
    if (perf.expectancy > 3) {
      weight = 1.5; // Increase weight for high performers
    } else if (perf.expectancy > 1) {
      weight = 1.2;
    } else if (perf.expectancy < -1) {
      weight = 0.5; // Decrease weight for poor performers
    } else if (perf.expectancy < 0) {
      weight = 0.8;
    }
    
    // Consider win rate as well
    if (perf.win_rate > 60) {
      weight *= 1.1;
    } else if (perf.win_rate < 40) {
      weight *= 0.9;
    }
    
    weights[perf.indicator] = Math.max(0.1, Math.min(2.0, weight));
  }
  
  return weights;
}

// ==================== LEARN FROM ALL HISTORICAL DATA ====================

export async function learnFromHistoricalData(
  stockHistories: Map<string, Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>>
): Promise<{ totalSignals: number; totalStocks: number }> {
  let totalSignals = 0;
  let totalStocks = 0;
  
  for (const [ticker, data] of stockHistories) {
    const signals = generateHistoricalSignals(ticker, data);
    if (signals.length > 0) {
      const saved = saveSignals(signals);
      totalSignals += saved;
      totalStocks++;
    }
  }
  
  // Update indicator performance after learning
  updateIndicatorPerformance();
  
  console.log(`[MarketLearning] Learned from ${totalStocks} stocks, ${totalSignals} signals generated`);
  
  return { totalSignals, totalStocks };
}
