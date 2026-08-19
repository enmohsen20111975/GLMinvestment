/**
 * محرك الصفقات الوهمية - Paper Trading Engine
 * 
 * هذا المحرك يقوم بـ:
 * 1. تنفيذ صفقات وهمية بناءً على التحليل الفنى والمالى
 * 2. تتبع النتائج الفعلية
 * 3. التعلم من الأخطاء وتحسين الاستراتيجية
 * 
 * المبدأ: النظام يتداول وهمياً ويتعلم من غير ما يخسر فلوس حقيقية
 */

import { createDatabase, isInitialized, type SqliteDatabase } from '@/lib/sqlite-wrapper';
import * as path from 'path';
import { existsSync } from 'fs';

// ==================== TYPES ====================

export type TradeAction = 'BUY' | 'SELL';
export type TradeStatus = 'OPEN' | 'CLOSED';
export type CloseReason = 'TARGET_HIT' | 'STOP_LOSS' | 'TIMEOUT' | 'MANUAL' | 'SIGNAL_REVERSAL';
export type MarketRegime = 'BULL' | 'BEAR' | 'SIDEWAYS' | 'VOLATILE';

export interface TechnicalIndicators {
  rsi: number;
  rsi_signal: 'oversold' | 'neutral' | 'overbought';
  macd: { value: number; signal: number; histogram: number };
  macd_signal: 'bullish' | 'bearish' | 'neutral';
  ma_20: number;
  ma_50: number;
  ma_200: number | null;
  ma_signal: 'above_all' | 'above_20_50' | 'below_all' | 'mixed';
  bollinger: { upper: number; middle: number; lower: number; current: number };
  bollinger_signal: 'above_upper' | 'below_lower' | 'neutral';
  volume_ratio: number; // حجم التداول / المتوسط
  volume_signal: 'high' | 'normal' | 'low';
  support: number | null;
  resistance: number | null;
  atr: number; // Average True Range للتحرك
}

export interface FundamentalData {
  pe_ratio: number | null;
  pb_ratio: number | null;
  dividend_yield: number | null;
  market_cap: number | null;
  eps: number | null;
  roe: number | null;
  debt_to_equity: number | null;
  sector: string | null;
}

export interface TradeDecision {
  ticker: string;
  action: TradeAction;
  confidence: number; // 0-100
  entry_price: number;
  stop_loss: number;
  target_price: number;
  position_size_percent: number; // نسبة من رأس المال
  reasoning: string;
  reasoning_ar: string;
  indicators_used: string[];
  risk_reward_ratio: number;
  expected_holding_days: number;
  market_regime: MarketRegime;
}

export interface PaperTrade {
  id?: number;
  ticker: string;
  action: TradeAction;
  entry_date: string;
  entry_price: number;
  shares: number;
  position_value: number;
  stop_loss: number;
  target_price: number;
  status: TradeStatus;
  
  // التحليل وقت الدخول
  technical_snapshot: string; // JSON
  fundamental_snapshot: string; // JSON
  decision_reasoning: string;
  confidence: number;
  
  // النتيجة
  exit_date?: string;
  exit_price?: number;
  close_reason?: CloseReason;
  profit_loss?: number;
  profit_loss_percent?: number;
  holding_days?: number;
  
  // التعلّم
  lessons_learned?: string; // JSON array
  analysis_correct?: boolean;
  what_went_wrong?: string;
  what_went_right?: string;
  
  created_at: string;
  updated_at: string;
}

export interface LearningLesson {
  id?: number;
  lesson_type: 'technical' | 'fundamental' | 'timing' | 'risk' | 'market_condition';
  ticker?: string;
  condition: string; // الظروف اللي أدت للدرس
  mistake: string; // الغلطة
  correction: string; // التصحيح
  occurrences: number; // عدد مرات التكرار
  success_after_correction: number; // نسبة النجاح بعد التصحيح
  status: 'testing' | 'validated' | 'rejected';
  first_seen: string;
  last_seen: string;
  created_at: string;
}

export interface TradingStats {
  total_trades: number;
  open_trades: number;
  closed_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  avg_profit_percent: number;
  avg_loss_percent: number;
  avg_holding_days: number;
  best_trade: { ticker: string; profit_percent: number } | null;
  worst_trade: { ticker: string; loss_percent: number } | null;
  total_profit_loss: number;
  expectancy: number; // القيمة المتوقعة لكل صفقة
  
  // أداء حسب السهم
  performance_by_ticker: { ticker: string; trades: number; win_rate: number; avg_return: number }[];
  
  // أداء حسب الاستراتيجية
  performance_by_strategy: { strategy: string; trades: number; win_rate: number }[];
}

// ==================== DATABASE ACCESS ====================

function getDb(): SqliteDatabase {
  if (!isInitialized()) {
    throw new Error('sql.js not initialized');
  }
  const dbPath = path.join(process.cwd(), 'db', 'stocks.db');
  if (!existsSync(dbPath)) {
    throw new Error(`Heavy DB not found: ${dbPath}`);
  }
  return createDatabase(dbPath);
}

// ==================== TABLE INITIALIZATION ====================

export function initializePaperTradingTables(): void {
  const db = getDb();
  try {
    db.pragma('journal_mode = WAL');

    // جدول الصفقات الوهمية
    db.run(`
      CREATE TABLE IF NOT EXISTS paper_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('BUY', 'SELL')),
        entry_date TEXT NOT NULL,
        entry_price REAL NOT NULL,
        shares REAL NOT NULL,
        position_value REAL NOT NULL,
        stop_loss REAL NOT NULL,
        target_price REAL NOT NULL,
        status TEXT DEFAULT 'OPEN' CHECK(status IN ('OPEN', 'CLOSED')),
        
        technical_snapshot TEXT DEFAULT '{}',
        fundamental_snapshot TEXT DEFAULT '{}',
        decision_reasoning TEXT,
        confidence REAL DEFAULT 50,
        
        exit_date TEXT,
        exit_price REAL,
        close_reason TEXT CHECK(close_reason IN ('TARGET_HIT', 'STOP_LOSS', 'TIMEOUT', 'MANUAL', 'SIGNAL_REVERSAL')),
        profit_loss REAL,
        profit_loss_percent REAL,
        holding_days INTEGER,
        
        lessons_learned TEXT DEFAULT '[]',
        analysis_correct INTEGER,
        what_went_wrong TEXT,
        what_went_right TEXT,
        
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // جدول الدروس المستفادة
    db.run(`
      CREATE TABLE IF NOT EXISTS trading_lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_type TEXT NOT NULL CHECK(lesson_type IN ('technical', 'fundamental', 'timing', 'risk', 'market_condition')),
        ticker TEXT,
        condition TEXT NOT NULL,
        mistake TEXT NOT NULL,
        correction TEXT NOT NULL,
        occurrences INTEGER DEFAULT 1,
        success_after_correction REAL DEFAULT 0,
        status TEXT DEFAULT 'testing' CHECK(status IN ('testing', 'validated', 'rejected')),
        first_seen TEXT DEFAULT (datetime('now')),
        last_seen TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // جدول أداء الأسهم
    db.run(`
      CREATE TABLE IF NOT EXISTS ticker_performance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL UNIQUE,
        total_trades INTEGER DEFAULT 0,
        winning_trades INTEGER DEFAULT 0,
        losing_trades INTEGER DEFAULT 0,
        total_profit_loss REAL DEFAULT 0,
        avg_holding_days REAL DEFAULT 0,
        best_return REAL DEFAULT 0,
        worst_return REAL DEFAULT 0,
        known_patterns TEXT DEFAULT '[]',
        last_trade TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // جدول قواعد التداول المستفادة
    db.run(`
      CREATE TABLE IF NOT EXISTS trading_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_name TEXT NOT NULL UNIQUE,
        rule_description TEXT NOT NULL,
        rule_condition TEXT NOT NULL,
        rule_action TEXT NOT NULL,
        priority INTEGER DEFAULT 50,
        success_rate REAL DEFAULT 0,
        times_applied INTEGER DEFAULT 0,
        times_successful INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'paused', 'disabled')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // إنشاء الفهارس
    db.run(`CREATE INDEX IF NOT EXISTS idx_paper_trades_ticker ON paper_trades(ticker)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_paper_trades_status ON paper_trades(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_paper_trades_entry_date ON paper_trades(entry_date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_trading_lessons_type ON trading_lessons(lesson_type)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_trading_rules_status ON trading_rules(status)`);

    console.log('[PaperTrading] Tables initialized successfully');
  } finally {
    db.close();
  }
}

// ==================== TECHNICAL ANALYSIS ====================

/**
 * حساب المؤشرات الفنية من البيانات التاريخية
 */
export function calculateTechnicalIndicators(
  priceHistory: { date: string; open: number; high: number; low: number; close: number; volume: number }[]
): TechnicalIndicators | null {
  if (priceHistory.length < 50) {
    console.log('[TechnicalAnalysis] Not enough data points');
    return null;
  }

  const closes = priceHistory.map(p => p.close);
  const highs = priceHistory.map(p => p.high);
  const lows = priceHistory.map(p => p.low);
  const volumes = priceHistory.map(p => p.volume);
  const currentPrice = closes[closes.length - 1];

  // RSI (14)
  const rsi = calculateRSI(closes, 14);
  let rsi_signal: 'oversold' | 'neutral' | 'overbought' = 'neutral';
  if (rsi < 30) rsi_signal = 'oversold';
  else if (rsi > 70) rsi_signal = 'overbought';

  // MACD (12, 26, 9)
  const macd = calculateMACD(closes);
  let macd_signal: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  if (macd.histogram > 0 && macd.value > macd.signal) macd_signal = 'bullish';
  else if (macd.histogram < 0 && macd.value < macd.signal) macd_signal = 'bearish';

  // Moving Averages
  const ma_20 = calculateSMA(closes, 20);
  const ma_50 = calculateSMA(closes, 50);
  const ma_200 = closes.length >= 200 ? calculateSMA(closes, 200) : null;

  let ma_signal: 'above_all' | 'above_20_50' | 'below_all' | 'mixed' = 'mixed';
  const above20 = currentPrice > ma_20;
  const above50 = currentPrice > ma_50;
  const above200 = ma_200 ? currentPrice > ma_200 : true;

  if (above20 && above50 && above200) ma_signal = 'above_all';
  else if (above20 && above50) ma_signal = 'above_20_50';
  else if (!above20 && !above50) ma_signal = 'below_all';

  // Bollinger Bands (20, 2)
  const bollinger = calculateBollingerBands(closes, 20, 2);
  let bollinger_signal: 'above_upper' | 'below_lower' | 'neutral' = 'neutral';
  if (currentPrice > bollinger.upper) bollinger_signal = 'above_upper';
  else if (currentPrice < bollinger.lower) bollinger_signal = 'below_lower';

  // Volume Analysis
  const avgVolume = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const currentVolume = volumes[volumes.length - 1];
  const volume_ratio = currentVolume / avgVolume;
  let volume_signal: 'high' | 'normal' | 'low' = 'normal';
  if (volume_ratio > 1.5) volume_signal = 'high';
  else if (volume_ratio < 0.5) volume_signal = 'low';

  // Support & Resistance (بسيط)
  const { support, resistance } = findSupportResistance(priceHistory);

  // ATR (14) للتحرك
  const atr = calculateATR(highs, lows, closes, 14);

  return {
    rsi: Math.round(rsi * 100) / 100,
    rsi_signal,
    macd: { 
      value: Math.round(macd.value * 1000) / 1000, 
      signal: Math.round(macd.signal * 1000) / 1000, 
      histogram: Math.round(macd.histogram * 1000) / 1000 
    },
    macd_signal,
    ma_20: Math.round(ma_20 * 100) / 100,
    ma_50: Math.round(ma_50 * 100) / 100,
    ma_200: ma_200 ? Math.round(ma_200 * 100) / 100 : null,
    ma_signal,
    bollinger: {
      upper: Math.round(bollinger.upper * 100) / 100,
      middle: Math.round(bollinger.middle * 100) / 100,
      lower: Math.round(bollinger.lower * 100) / 100,
      current: currentPrice
    },
    bollinger_signal,
    volume_ratio: Math.round(volume_ratio * 100) / 100,
    volume_signal,
    support: support ? Math.round(support * 100) / 100 : null,
    resistance: resistance ? Math.round(resistance * 100) / 100 : null,
    atr: Math.round(atr * 100) / 100
  };
}

// Helper functions for calculations
function calculateRSI(prices: number[], period: number): number {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateSMA(prices: number[], period: number): number {
  const slice = prices.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function calculateEMA(prices: number[], period: number): number {
  const k = 2 / (period + 1);
  let ema = prices[0];

  for (let i = 1; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }

  return ema;
}

function calculateMACD(prices: number[]): { value: number; signal: number; histogram: number } {
  const ema12 = calculateEMA(prices, 12);
  const ema26 = calculateEMA(prices, 26);
  const macdValue = ema12 - ema26;

  // Signal line (9-period EMA of MACD)
  // Simplified: use current MACD as approximation
  const signal = macdValue * 0.9; // Approximate
  const histogram = macdValue - signal;

  return { value: macdValue, signal, histogram };
}

function calculateBollingerBands(prices: number[], period: number, stdDev: number): { upper: number; middle: number; lower: number } {
  const middle = calculateSMA(prices, period);
  const slice = prices.slice(-period);

  // Calculate standard deviation
  const squaredDiffs = slice.map(p => Math.pow(p - middle, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / period;
  const sd = Math.sqrt(avgSquaredDiff);

  return {
    upper: middle + (stdDev * sd),
    middle,
    lower: middle - (stdDev * sd)
  };
}

function calculateATR(highs: number[], lows: number[], closes: number[], period: number): number {
  if (highs.length < period + 1) return 0;

  const trueRanges: number[] = [];

  for (let i = highs.length - period; i < highs.length; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    );
    trueRanges.push(tr);
  }

  return trueRanges.reduce((a, b) => a + b, 0) / period;
}

function findSupportResistance(priceHistory: { high: number; low: number; close: number }[]): { support: number | null; resistance: number | null } {
  if (priceHistory.length < 20) return { support: null, resistance: null };

  const recent = priceHistory.slice(-60);
  const currentPrice = recent[recent.length - 1].close;

  // Find local minima for support
  const lows = recent.map(p => p.low);
  const minLows: number[] = [];

  for (let i = 5; i < lows.length - 5; i++) {
    if (lows[i] < lows[i - 1] && lows[i] < lows[i + 1] && lows[i] < currentPrice) {
      minLows.push(lows[i]);
    }
  }

  // Find local maxima for resistance
  const highs = recent.map(p => p.high);
  const maxHighs: number[] = [];

  for (let i = 5; i < highs.length - 5; i++) {
    if (highs[i] > highs[i - 1] && highs[i] > highs[i + 1] && highs[i] > currentPrice) {
      maxHighs.push(highs[i]);
    }
  }

  // Return closest support and resistance
  const support = minLows.length > 0 ? Math.max(...minLows) : null;
  const resistance = maxHighs.length > 0 ? Math.min(...maxHighs) : null;

  return { support, resistance };
}

// ==================== TRADE DECISION ENGINE ====================

/**
 * اتخاذ قرار التداول بناءً على التحليل
 */
export function makeTradeDecision(
  ticker: string,
  currentPrice: number,
  technical: TechnicalIndicators,
  fundamental: FundamentalData | null,
  marketRegime: MarketRegime,
  tickerPerformance?: { win_rate: number; avg_return: number } | null
): TradeDecision | null {

  let score = 50; // دراسة ابتدائية
  const indicatorsUsed: string[] = [];
  const reasons: string[] = [];
  const reasonsAr: string[] = [];

  // ===== 1. تحليل RSI =====
  if (technical.rsi_signal === 'oversold') {
    score += 15;
    indicatorsUsed.push('RSI');
    reasons.push('RSI oversold (<30) - potential bounce');
    reasonsAr.push('RSI في منطقة تشبع بيعي - احتمال ارتداد');
  } else if (technical.rsi_signal === 'overbought') {
    score -= 15;
    indicatorsUsed.push('RSI');
    reasons.push('RSI overbought (>70) - potential reversal');
    reasonsAr.push('RSI في منطقة تشبع شرائي - احتمال انعكاس');
  }

  // ===== 2. تحليل MACD =====
  if (technical.macd_signal === 'bullish') {
    score += 10;
    indicatorsUsed.push('MACD');
    reasons.push('MACD bullish crossover');
    reasonsAr.push('تقاطع MACD إيجابي');
  } else if (technical.macd_signal === 'bearish') {
    score -= 10;
    indicatorsUsed.push('MACD');
    reasons.push('MACD bearish crossover');
    reasonsAr.push('تقاطع MACD سلبي');
  }

  // ===== 3. تحليل Moving Averages =====
  if (technical.ma_signal === 'above_all') {
    score += 12;
    indicatorsUsed.push('MA');
    reasons.push('Price above all major MAs - uptrend');
    reasonsAr.push('السعر فوق كل المتوسطات - اتجاه صاعد');
  } else if (technical.ma_signal === 'below_all') {
    score -= 12;
    indicatorsUsed.push('MA');
    reasons.push('Price below all major MAs - downtrend');
    reasonsAr.push('السعر تحت كل المتوسطات - اتجاه هابط');
  }

  // ===== 4. تحليل Bollinger =====
  if (technical.bollinger_signal === 'below_lower') {
    score += 8;
    indicatorsUsed.push('Bollinger');
    reasons.push('Price below lower Bollinger - oversold');
    reasonsAr.push('السعر تحت النطاق السفلي - تشبع بيعي');
  } else if (technical.bollinger_signal === 'above_upper') {
    score -= 8;
    indicatorsUsed.push('Bollinger');
    reasons.push('Price above upper Bollinger - overbought');
    reasonsAr.push('السعر فوق النطاق العلوي - تشبع شرائي');
  }

  // ===== 5. تحليل Volume =====
  if (technical.volume_signal === 'high' && score > 50) {
    score += 5;
    indicatorsUsed.push('Volume');
    reasons.push('High volume confirms move');
    reasonsAr.push('حجم تداول عالي يؤكد الحركة');
  } else if (technical.volume_signal === 'low' && Math.abs(score - 50) > 10) {
    score -= 5;
    reasons.push('Low volume - weak confirmation');
    reasonsAr.push('حجم تداول ضعيف - تأكيد ضعيف');
  }

  // ===== 6. Support & Resistance =====
  if (technical.support && currentPrice <= technical.support * 1.02) {
    score += 10;
    indicatorsUsed.push('SupportResistance');
    reasons.push(`Near support level: ${technical.support}`);
    reasonsAr.push(`قريب من مستوى دعم: ${technical.support}`);
  }

  if (technical.resistance && currentPrice >= technical.resistance * 0.98) {
    score -= 10;
    indicatorsUsed.push('SupportResistance');
    reasons.push(`Near resistance level: ${technical.resistance}`);
    reasonsAr.push(`قريب من مستوى مقاومة: ${technical.resistance}`);
  }

  // ===== 7. أداء السهم السابق =====
  if (tickerPerformance) {
    if (tickerPerformance.win_rate > 0.6) {
      score += 5;
      reasons.push(`Good history with this ticker (${(tickerPerformance.win_rate * 100).toFixed(0)}% win rate)`);
      reasonsAr.push(`تاريخ جيد مع هذا السهم (${(tickerPerformance.win_rate * 100).toFixed(0)}% نجاح)`);
    } else if (tickerPerformance.win_rate < 0.4) {
      score -= 5;
      reasons.push(`Poor history with this ticker (${(tickerPerformance.win_rate * 100).toFixed(0)}% win rate)`);
      reasonsAr.push(`تاريخ ضعيف مع هذا السهم (${(tickerPerformance.win_rate * 100).toFixed(0)}% نجاح)`);
    }
  }

  // ===== 8. حالة السوق =====
  if (marketRegime === 'BULL' && score > 50) {
    score += 5;
    reasons.push('Bull market - favorable conditions');
    reasonsAr.push('سوق صاعد - ظروف مواتية');
  } else if (marketRegime === 'BEAR' && score > 50) {
    score -= 5;
    reasons.push('Bear market - caution advised');
    reasonsAr.push('سوق هابط - يُنصح بالحذر');
  }

  // ===== القرار النهائي =====
  if (score < 55 && score > 45) {
    return null; // لا توجد إشارة واضحة
  }

  const action: TradeAction = score >= 55 ? 'BUY' : 'SELL';

  // حساب Stop Loss و Target
  const atrPercent = (technical.atr / currentPrice) * 100;
  const stopLossPercent = Math.max(3, Math.min(8, atrPercent * 1.5)); // 3-8% حسب التحرك
  const targetPercent = stopLossPercent * 2; // Risk:Reward = 1:2

  const stopLoss = action === 'BUY' 
    ? currentPrice * (1 - stopLossPercent / 100)
    : currentPrice * (1 + stopLossPercent / 100);

  const targetPrice = action === 'BUY'
    ? currentPrice * (1 + targetPercent / 100)
    : currentPrice * (1 - targetPercent / 100);

  const riskReward = targetPercent / stopLossPercent;

  // حجم المركز حسب الثقة
  let positionSize = 5; // 5% افتراضياً
  if (score >= 70) positionSize = 10;
  else if (score >= 65) positionSize = 8;
  else if (score >= 60) positionSize = 6;
  else positionSize = 4;

  return {
    ticker,
    action,
    confidence: Math.min(100, Math.max(0, score)),
    entry_price: currentPrice,
    stop_loss: Math.round(stopLoss * 100) / 100,
    target_price: Math.round(targetPrice * 100) / 100,
    position_size_percent: positionSize,
    reasoning: reasons.join(' | '),
    reasoning_ar: reasonsAr.join(' | '),
    indicators_used: indicatorsUsed,
    risk_reward_ratio: Math.round(riskReward * 100) / 100,
    expected_holding_days: Math.round(30 / riskReward), // تقدير
    market_regime: marketRegime
  };
}

// ==================== TRADE EXECUTION ====================

/**
 * فتح صفقة وهمية جديدة
 */
export function openPaperTrade(decision: TradeDecision, capital: number = 100000): number {
  const db = getDb();
  try {
    db.pragma('journal_mode = WAL');

    const positionValue = capital * (decision.position_size_percent / 100);
    const shares = Math.floor(positionValue / decision.entry_price);
    const actualValue = shares * decision.entry_price;

    const result = db.prepare(`
      INSERT INTO paper_trades (
        ticker, action, entry_date, entry_price, shares, position_value,
        stop_loss, target_price, status, decision_reasoning, confidence
      ) VALUES (?, ?, datetime('now'), ?, ?, ?, ?, ?, 'OPEN', ?, ?)
    `).run(
      decision.ticker,
      decision.action,
      decision.entry_price,
      shares,
      actualValue,
      decision.stop_loss,
      decision.target_price,
      `${decision.reasoning_ar} | الثقة: ${decision.confidence}%`,
      decision.confidence
    );

    console.log(`[PaperTrading] Opened ${decision.action} trade for ${decision.ticker} at ${decision.entry_price}`);
    return result.lastInsertRowid as number;
  } finally {
    db.close();
  }
}

/**
 * فحص الصفقات المفتوحة وتحديثها
 */
export function checkOpenTrades(
  currentPrices: Map<string, { high: number; low: number; close: number }>
): { closed: number; stillOpen: number; lessons: string[] } {
  const db = getDb();
  try {
    db.pragma('journal_mode = WAL');

    const openTrades = db.prepare(`
      SELECT * FROM paper_trades WHERE status = 'OPEN'
    `).all() as PaperTrade[];

    let closed = 0;
    let stillOpen = 0;
    const lessons: string[] = [];

    for (const trade of openTrades) {
      const priceData = currentPrices.get(trade.ticker);
      if (!priceData) {
        stillOpen++;
        continue;
      }

      const { high, low, close } = priceData;
      const entryDate = new Date(trade.entry_date);
      const today = new Date();
      const holdingDays = Math.floor((today.getTime() - entryDate.getTime()) / (1000 * 60 * 60 * 24));

      let shouldClose = false;
      let closeReason: CloseReason | null = null;
      let exitPrice = close;

      // فحص الـ Stop Loss
      if (trade.action === 'BUY' && low <= trade.stop_loss) {
        shouldClose = true;
        closeReason = 'STOP_LOSS';
        exitPrice = trade.stop_loss;
      } else if (trade.action === 'SELL' && high >= trade.stop_loss) {
        shouldClose = true;
        closeReason = 'STOP_LOSS';
        exitPrice = trade.stop_loss;
      }

      // فحص الـ Target
      if (!shouldClose) {
        if (trade.action === 'BUY' && high >= trade.target_price) {
          shouldClose = true;
          closeReason = 'TARGET_HIT';
          exitPrice = trade.target_price;
        } else if (trade.action === 'SELL' && low <= trade.target_price) {
          shouldClose = true;
          closeReason = 'TARGET_HIT';
          exitPrice = trade.target_price;
        }
      }

      // فحص Timeout (أكثر من 30 يوم)
      if (!shouldClose && holdingDays >= 30) {
        shouldClose = true;
        closeReason = 'TIMEOUT';
        exitPrice = close;
      }

      if (shouldClose && closeReason) {
        // حساب الربح/الخسارة
        let profitLoss: number;
        let profitLossPercent: number;

        if (trade.action === 'BUY') {
          profitLoss = (exitPrice - trade.entry_price) * trade.shares;
          profitLossPercent = ((exitPrice - trade.entry_price) / trade.entry_price) * 100;
        } else {
          profitLoss = (trade.entry_price - exitPrice) * trade.shares;
          profitLossPercent = ((trade.entry_price - exitPrice) / trade.entry_price) * 100;
        }

        // خصم التكاليف
        const costs = trade.position_value * 0.011; // 1.1% تكاليف
        profitLoss -= costs;
        profitLossPercent -= 1.1;

        // تحديث الصفقة
        db.prepare(`
          UPDATE paper_trades SET
            status = 'CLOSED',
            exit_date = datetime('now'),
            exit_price = ?,
            close_reason = ?,
            profit_loss = ?,
            profit_loss_percent = ?,
            holding_days = ?,
            analysis_correct = ?,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          exitPrice,
          closeReason,
          profitLoss,
          profitLossPercent,
          holdingDays,
          profitLoss > 0 ? 1 : 0,
          trade.id
        );

        // تحديث أداء السهم
        updateTickerPerformance(trade.ticker, profitLoss, profitLossPercent, holdingDays);

        // استخراج درس
        const lesson = extractLesson(trade, closeReason, profitLossPercent);
        if (lesson) lessons.push(lesson);

        closed++;
        console.log(`[PaperTrading] Closed ${trade.ticker} trade: ${profitLossPercent.toFixed(2)}% (${closeReason})`);
      } else {
        stillOpen++;
      }
    }

    return { closed, stillOpen, lessons };
  } finally {
    db.close();
  }
}

/**
 * تحديث أداء السهم
 */
function updateTickerPerformance(ticker: string, profitLoss: number, profitLossPercent: number, holdingDays: number): void {
  const db = getDb();
  try {
    const existing = db.prepare('SELECT * FROM ticker_performance WHERE ticker = ?').get(ticker) as Record<string, unknown> | undefined;

    if (existing) {
      const totalTrades = (existing.total_trades as number) + 1;
      const winningTrades = (existing.winning_trades as number) + (profitLoss > 0 ? 1 : 0);
      const totalPL = (existing.total_profit_loss as number) + profitLoss;
      const avgHolding = ((existing.avg_holding_days as number) * (totalTrades - 1) + holdingDays) / totalTrades;
      const bestReturn = Math.max(existing.best_return as number, profitLossPercent);
      const worstReturn = Math.min(existing.worst_return as number, profitLossPercent);

      db.prepare(`
        UPDATE ticker_performance SET
          total_trades = ?,
          winning_trades = ?,
          losing_trades = ?,
          total_profit_loss = ?,
          avg_holding_days = ?,
          best_return = ?,
          worst_return = ?,
          last_trade = datetime('now'),
          updated_at = datetime('now')
        WHERE ticker = ?
      `).run(totalTrades, winningTrades, totalTrades - winningTrades, totalPL, avgHolding, bestReturn, worstReturn, ticker);
    } else {
      db.prepare(`
        INSERT INTO ticker_performance (
          ticker, total_trades, winning_trades, losing_trades,
          total_profit_loss, avg_holding_days, best_return, worst_return
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?)
      `).run(ticker, profitLoss > 0 ? 1 : 0, profitLoss > 0 ? 0 : 1, profitLoss, holdingDays, profitLossPercent, profitLossPercent);
    }
  } finally {
    db.close();
  }
}

/**
 * استخراج درس من صفقة
 */
function extractLesson(trade: PaperTrade, closeReason: string, profitLossPercent: number): string | null {
  if (Math.abs(profitLossPercent) < 2) return null; // صفقة صغيرة، لا درس

  const lessonType = profitLossPercent > 0 ? 'success' : 'mistake';
  
  // تحليل السبب
  let lesson = '';

  if (closeReason === 'STOP_LOSS') {
    lesson = `توقف خسارة في ${trade.ticker}: الدخول كان خاطئ - ${trade.decision_reasoning}`;
  } else if (closeReason === 'TARGET_HIT') {
    lesson = `هدف محقق في ${trade.ticker}: التحليل كان صحيح - ${trade.decision_reasoning}`;
  } else if (closeReason === 'TIMEOUT') {
    if (profitLossPercent > 0) {
      lesson = `خروج بعد 30 يوم بربح في ${trade.ticker} - الصبر مطلوب`;
    } else {
      lesson = `خروج بعد 30 يوم بخسارة في ${trade.ticker} - التحليل كان خاطئ`;
    }
  }

  // حفظ الدرس
  if (lesson) {
    saveLesson(trade.ticker, lesson, profitLossPercent > 0);
  }

  return lesson;
}

/**
 * حفظ درس في قاعدة البيانات
 */
function saveLesson(ticker: string, lesson: string, wasSuccess: boolean): void {
  const db = getDb();
  try {
    db.pragma('journal_mode = WAL');

    // تحديد نوع الدرس
    let lessonType: 'technical' | 'fundamental' | 'timing' | 'risk' | 'market_condition' = 'technical';
    if (lesson.includes('صبر') || lesson.includes('30 يوم')) lessonType = 'timing';
    if (lesson.includes('توقف')) lessonType = 'risk';

    // التحقق من وجود درس مشابه
    const existing = db.prepare(`
      SELECT * FROM trading_lessons 
      WHERE ticker = ? AND mistake LIKE ? OR correction LIKE ?
    `).get(ticker, `%${lesson.slice(0, 30)}%`, `%${lesson.slice(0, 30)}%`) as Record<string, unknown> | undefined;

    if (existing) {
      // تحديث الدرس الموجود
      const newOccurrences = (existing.occurrences as number) + 1;
      const newSuccessRate = wasSuccess 
        ? ((existing.success_after_correction as number) * (existing.occurrences as number) + 1) / newOccurrences
        : existing.success_after_correction;

      db.prepare(`
        UPDATE trading_lessons SET
          occurrences = ?,
          success_after_correction = ?,
          last_seen = datetime('now')
        WHERE id = ?
      `).run(newOccurrences, newSuccessRate, existing.id);
    } else {
      // إضافة درس جديد
      db.prepare(`
        INSERT INTO trading_lessons (
          lesson_type, ticker, condition, mistake, correction
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        lessonType,
        ticker,
        wasSuccess ? 'Successful trade' : 'Failed trade',
        wasSuccess ? '' : lesson,
        wasSuccess ? lesson : ''
      );
    }
  } finally {
    db.close();
  }
}

// ==================== STATISTICS ====================

/**
 * الحصول على إحصائيات التداول
 */
export function getTradingStats(): TradingStats {
  const db = getDb();
  try {
    const trades = db.prepare(`
      SELECT * FROM paper_trades WHERE status = 'CLOSED'
    `).all() as PaperTrade[];

    const openTrades = db.prepare(`
      SELECT COUNT(*) as count FROM paper_trades WHERE status = 'OPEN'
    `).get() as { count: number };

    const total = trades.length;
    const winning = trades.filter(t => (t.profit_loss || 0) > 0);
    const losing = trades.filter(t => (t.profit_loss || 0) <= 0);

    const avgProfit = winning.length > 0
      ? winning.reduce((sum, t) => sum + (t.profit_loss_percent || 0), 0) / winning.length
      : 0;

    const avgLoss = losing.length > 0
      ? Math.abs(losing.reduce((sum, t) => sum + (t.profit_loss_percent || 0), 0) / losing.length)
      : 0;

    const avgHolding = total > 0
      ? trades.reduce((sum, t) => sum + (t.holding_days || 0), 0) / total
      : 0;

    const winRate = total > 0 ? (winning.length / total) * 100 : 0;
    const expectancy = (winRate / 100 * avgProfit) - ((100 - winRate) / 100 * avgLoss);

    // أفضل وأسوأ صفقة
    const sortedByPL = [...trades].sort((a, b) => (b.profit_loss_percent || 0) - (a.profit_loss_percent || 0));
    const best = sortedByPL[0];
    const worst = sortedByPL[sortedByPL.length - 1];

    // أداء حسب السهم
    const tickerPerf = db.prepare(`SELECT * FROM ticker_performance ORDER BY total_trades DESC`).all() as Array<{
      ticker: string;
      total_trades: number;
      winning_trades: number;
      total_profit_loss: number;
    }>;

    const performanceByTicker = tickerPerf.map(t => ({
      ticker: t.ticker,
      trades: t.total_trades,
      win_rate: t.total_trades > 0 ? (t.winning_trades / t.total_trades) * 100 : 0,
      avg_return: t.total_trades > 0 ? t.total_profit_loss / t.total_trades : 0
    }));

    return {
      total_trades: total,
      open_trades: openTrades.count,
      closed_trades: total,
      winning_trades: winning.length,
      losing_trades: losing.length,
      win_rate: Math.round(winRate * 100) / 100,
      avg_profit_percent: Math.round(avgProfit * 100) / 100,
      avg_loss_percent: Math.round(avgLoss * 100) / 100,
      avg_holding_days: Math.round(avgHolding * 10) / 10,
      best_trade: best ? { ticker: best.ticker, profit_percent: best.profit_loss_percent || 0 } : null,
      worst_trade: worst ? { ticker: worst.ticker, loss_percent: Math.abs(worst.profit_loss_percent || 0) } : null,
      total_profit_loss: trades.reduce((sum, t) => sum + (t.profit_loss || 0), 0),
      expectancy: Math.round(expectancy * 100) / 100,
      performance_by_ticker: performanceByTicker,
      performance_by_strategy: []
    };
  } finally {
    db.close();
  }
}

/**
 * الحصول على الدروس المستفادة
 */
export function getLessons(): LearningLesson[] {
  const db = getDb();
  try {
    return db.prepare(`SELECT * FROM trading_lessons ORDER BY occurrences DESC`).all() as LearningLesson[];
  } finally {
    db.close();
  }
}

/**
 * الحصول على الصفقات المفتوحة
 */
export function getOpenTrades(): PaperTrade[] {
  const db = getDb();
  try {
    return db.prepare(`SELECT * FROM paper_trades WHERE status = 'OPEN' ORDER BY entry_date DESC`).all() as PaperTrade[];
  } finally {
    db.close();
  }
}

/**
 * الحصول على آخر الصفقات المغلقة
 */
export function getRecentClosedTrades(limit: number = 20): PaperTrade[] {
  const db = getDb();
  try {
    return db.prepare(`
      SELECT * FROM paper_trades 
      WHERE status = 'CLOSED' 
      ORDER BY exit_date DESC 
      LIMIT ?
    `).all(limit) as PaperTrade[];
  } finally {
    db.close();
  }
}
/**
 * محرك الصفقات الوهمية - Paper Trading Engine
 * 
 * هذا المحرك يقوم بـ:
 * 1. تنفيذ صفقات وهمية بناءً على التحليل الفنى والمالى
 * 2. تتبع النتائج الفعلية
 * 3. التعلم من الأخطاء وتحسين الاستراتيجية
 * 
 * المبدأ: النظام يتداول وهمياً ويتعلم من غير ما يخسر فلوس حقيقية
 */

