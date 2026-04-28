/**
 * المرحلة الثانية: نظام التعلّم الذاتي
 * Self-Learning Engine for Egyptian Stock Market
 *
 * هذا النظام يتعلّم من أخطائه ويُحسّن أداءه تلقائياً
 * بناءً على المرجع المُقدَّم من المستخدم
 */

import { createDatabase, isInitialized, type SqliteDatabase } from '@/lib/sqlite-wrapper';
import * as path from 'path';
import { existsSync } from 'fs';
import { getWeight, clearCache } from './config-service';

// ==================== TYPES ====================

export type SignalDirection = 'buy' | 'sell';
export type MarketPhase = 'BULL' | 'BEAR' | 'RANGE';
export type CloseReason = 'target' | 'stop_loss' | 'manual' | 'news' | 'timeout';
export type IndicatorType = 'RSI' | 'MACD' | 'Ichimoku' | 'Fibonacci' | 'Bollinger' | 'MA' | 'ADX' | 'Stochastic' | 'Volume' | 'SupportResistance';

// ==================== SIGNAL LOG TYPES ====================

export interface SignalLog {
  id?: number;
  ticker: string;
  stock_id: number | null;
  signal_date: string;
  direction: SignalDirection;
  indicators_used: IndicatorType[];
  score: number;
  calculated_entry_price: number;
  calculated_stop_loss: number;
  calculated_target: number;
  has_news: boolean;
  news_summary?: string;
  executed: boolean;
  execution_reason?: string;
  created_at: string;
}

// ==================== TRADE LOG TYPES ====================

export interface TradeLog {
  id?: number;
  signal_id: number | null;
  ticker: string;
  stock_id: number | null;
  direction: SignalDirection;
  open_date: string;
  actual_entry_price: number;
  actual_stop_loss: number;
  actual_target: number;
  shares_count: number;
  trade_value: number;
  commission: number;
  tax: number;
  spread: number;
  total_cost: number;
  status: 'open' | 'closed';
  created_at: string;
}

// ==================== OUTCOME LOG TYPES ====================

export interface OutcomeLog {
  id?: number;
  trade_id: number;
  close_date: string;
  actual_exit_price: number;
  close_reason: CloseReason;
  gross_profit_loss: number;
  net_profit_loss: number;
  profit_loss_percent: number;
  days_open: number;
  created_at: string;
}

// ==================== CONTEXT LOG TYPES ====================

export interface ContextLog {
  id?: number;
  trade_id: number;
  egx30_state: MarketPhase;
  egx30_adx: number;
  official_usd_rate: number;
  parallel_usd_rate: number;
  usd_gap_percent: number;
  egx30_volume: number;
  egx30_avg_volume: number;
  liquidity_ratio: number;
  is_dividend_season: boolean;
  is_cbe_decision_near: boolean;
  market_sentiment: number;
  created_at: string;
}

// ==================== INDICATOR TRUST SCORE TYPES ====================

export interface IndicatorTrustScore {
  id?: number;
  indicator_name: IndicatorType;
  current_score: number;
  base_score: number;
  total_signals: number;
  successful_signals: number;
  failed_signals: number;
  consecutive_losses: number;
  status: 'active' | 'reflection' | 'disabled';
  reflection_start?: string;
  reflection_end?: string;
  last_updated: string;
  regime_scores: RegimeScore[];
}

export interface RegimeScore {
  regime: MarketPhase;
  score: number;
  signals: number;
  success_rate: number;
}

// ==================== LESSON TYPES ====================

export interface LearnedLesson {
  id?: number;
  lesson_type: 'direct' | 'compound' | 'environmental';
  title: string;
  description: string;
  trigger_conditions: string; // JSON
  action: string;
  confidence: number;
  occurrences: number;
  first_seen: string;
  last_seen: string;
  status: 'testing' | 'validated' | 'rejected';
  validation_start?: string;
  validation_end?: string;
  paper_trades_tested: number;
  paper_trades_success: number;
  created_at: string;
}

// ==================== MIRROR ANALYSIS RESULT ====================

export interface MirrorAnalysisResult {
  question: string;
  answer: boolean;
  insight: string;
  severity: 'info' | 'warning' | 'critical';
}

// ==================== PATTERN DETECTION RESULT ====================

export interface PatternDetectionResult {
  pattern_name: string;
  occurrences: number;
  success_rate: number;
  suggested_lesson: string;
  suggested_action: string;
}

// ==================== EXPECTANCY RESULT ====================

export interface ExpectancyResult {
  indicator: IndicatorType;
  regime: MarketPhase;
  total_trades: number;
  win_rate: number;
  avg_win_percent: number;
  avg_loss_percent: number;
  expectancy: number;
  recommendation: 'increase_weight' | 'maintain' | 'reduce_weight' | 'disable';
}

// ==================== DATABASE ACCESS ====================

function getWriteDb(): SqliteDatabase {
  if (!isInitialized()) {
    throw new Error('sql.js is not yet initialized. Self-learning engine requires database access.');
  }
  const dbPath = path.join(process.cwd(), 'db', 'egx_investment.db');
  if (!existsSync(dbPath)) {
    throw new Error(`Heavy DB file not found: ${dbPath}`);
  }
  return createDatabase(dbPath);
}

function getReadDb(): SqliteDatabase {
  if (!isInitialized()) {
    throw new Error('sql.js is not yet initialized. Self-learning engine requires database access.');
  }
  const dbPath = path.join(process.cwd(), 'db', 'egx_investment.db');
  if (!existsSync(dbPath)) {
    throw new Error(`Heavy DB file not found: ${dbPath}`);
  }
  return createDatabase(dbPath, { readonly: true });
}

// ==================== DATABASE INITIALIZATION ====================

/**
 * إنشاء جداول المرحلة الثانية إذا لم تكن موجودة
 */
export function initializePhase2Tables(): void {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    // جدول تسجيل الإشارات
    db.run(`
      CREATE TABLE IF NOT EXISTS signal_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT NOT NULL,
        stock_id INTEGER,
        signal_date TEXT NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('buy', 'sell')),
        indicators_used TEXT NOT NULL,
        score REAL NOT NULL,
        calculated_entry_price REAL NOT NULL,
        calculated_stop_loss REAL NOT NULL,
        calculated_target REAL NOT NULL,
        has_news INTEGER DEFAULT 0,
        news_summary TEXT,
        executed INTEGER DEFAULT 0,
        execution_reason TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // جدول تسجيل الصفقات
    db.run(`
      CREATE TABLE IF NOT EXISTS trade_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_id INTEGER,
        ticker TEXT NOT NULL,
        stock_id INTEGER,
        direction TEXT NOT NULL CHECK(direction IN ('buy', 'sell')),
        open_date TEXT NOT NULL,
        actual_entry_price REAL NOT NULL,
        actual_stop_loss REAL NOT NULL,
        actual_target REAL NOT NULL,
        shares_count INTEGER NOT NULL,
        trade_value REAL NOT NULL,
        commission REAL DEFAULT 0,
        tax REAL DEFAULT 0,
        spread REAL DEFAULT 0,
        total_cost REAL DEFAULT 0,
        status TEXT DEFAULT 'open' CHECK(status IN ('open', 'closed')),
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (signal_id) REFERENCES signal_logs(id)
      )
    `);

    // جدول تسجيل النتائج
    db.run(`
      CREATE TABLE IF NOT EXISTS outcome_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id INTEGER NOT NULL,
        close_date TEXT NOT NULL,
        actual_exit_price REAL NOT NULL,
        close_reason TEXT NOT NULL CHECK(close_reason IN ('target', 'stop_loss', 'manual', 'news', 'timeout')),
        gross_profit_loss REAL NOT NULL,
        net_profit_loss REAL NOT NULL,
        profit_loss_percent REAL NOT NULL,
        days_open INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (trade_id) REFERENCES trade_logs(id)
      )
    `);

    // جدول تسجيل البيئة
    db.run(`
      CREATE TABLE IF NOT EXISTS context_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        trade_id INTEGER NOT NULL,
        egx30_state TEXT NOT NULL CHECK(egx30_state IN ('BULL', 'BEAR', 'RANGE')),
        egx30_adx REAL DEFAULT 0,
        official_usd_rate REAL DEFAULT 0,
        parallel_usd_rate REAL DEFAULT 0,
        usd_gap_percent REAL DEFAULT 0,
        egx30_volume REAL DEFAULT 0,
        egx30_avg_volume REAL DEFAULT 0,
        liquidity_ratio REAL DEFAULT 1,
        is_dividend_season INTEGER DEFAULT 0,
        is_cbe_decision_near INTEGER DEFAULT 0,
        market_sentiment REAL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (trade_id) REFERENCES trade_logs(id)
      )
    `);

    // جدول درجات الثقة للمؤشرات
    db.run(`
      CREATE TABLE IF NOT EXISTS indicator_trust_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        indicator_name TEXT NOT NULL UNIQUE,
        current_score REAL DEFAULT 100,
        base_score REAL DEFAULT 100,
        total_signals INTEGER DEFAULT 0,
        successful_signals INTEGER DEFAULT 0,
        failed_signals INTEGER DEFAULT 0,
        consecutive_losses INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active' CHECK(status IN ('active', 'reflection', 'disabled')),
        reflection_start TEXT,
        reflection_end TEXT,
        regime_scores TEXT DEFAULT '{}',
        last_updated TEXT DEFAULT (datetime('now'))
      )
    `);

    // جدول الدروس المستفادة
    db.run(`
      CREATE TABLE IF NOT EXISTS learned_lessons (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lesson_type TEXT NOT NULL CHECK(lesson_type IN ('direct', 'compound', 'environmental')),
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        trigger_conditions TEXT NOT NULL,
        action TEXT NOT NULL,
        confidence REAL DEFAULT 0,
        occurrences INTEGER DEFAULT 1,
        first_seen TEXT DEFAULT (datetime('now')),
        last_seen TEXT DEFAULT (datetime('now')),
        status TEXT DEFAULT 'testing' CHECK(status IN ('testing', 'validated', 'rejected')),
        validation_start TEXT,
        validation_end TEXT,
        paper_trades_tested INTEGER DEFAULT 0,
        paper_trades_success INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // جدول الوزون حسب الطور
    db.run(`
      CREATE TABLE IF NOT EXISTS regime_indicator_weights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        indicator_name TEXT NOT NULL,
        regime TEXT NOT NULL CHECK(regime IN ('BULL', 'BEAR', 'RANGE')),
        weight REAL DEFAULT 1.0,
        expectancy REAL DEFAULT 0,
        last_calculated TEXT DEFAULT (datetime('now')),
        UNIQUE(indicator_name, regime)
      )
    `);

    // جدول المراجعات الدورية
    db.run(`
      CREATE TABLE IF NOT EXISTS review_cycles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        review_type TEXT NOT NULL CHECK(review_type IN ('daily', 'weekly', 'monthly', 'quarterly')),
        review_date TEXT NOT NULL,
        total_trades INTEGER DEFAULT 0,
        winning_trades INTEGER DEFAULT 0,
        losing_trades INTEGER DEFAULT 0,
        total_profit_loss REAL DEFAULT 0,
        win_rate REAL DEFAULT 0,
        avg_win REAL DEFAULT 0,
        avg_loss REAL DEFAULT 0,
        expectancy REAL DEFAULT 0,
        best_indicator TEXT,
        worst_indicator TEXT,
        patterns_detected INTEGER DEFAULT 0,
        lessons_learned INTEGER DEFAULT 0,
        weight_adjustments INTEGER DEFAULT 0,
        summary TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);

    // جدول الغلطة القاتلة
    db.run(`
      CREATE TABLE IF NOT EXISTS fatal_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        error_date TEXT NOT NULL,
        trade_id INTEGER,
        error_type TEXT NOT NULL,
        loss_percent REAL NOT NULL,
        capital_impact_percent REAL NOT NULL,
        consecutive_losses INTEGER DEFAULT 0,
        trading_halted INTEGER DEFAULT 0,
        halt_reason TEXT,
        review_completed INTEGER DEFAULT 0,
        review_findings TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (trade_id) REFERENCES trade_logs(id)
      )
    `);

    // إنشاء فهارس
    db.run(`CREATE INDEX IF NOT EXISTS idx_signal_logs_ticker ON signal_logs(ticker)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_signal_logs_date ON signal_logs(signal_date)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_trade_logs_ticker ON trade_logs(ticker)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_trade_logs_status ON trade_logs(status)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_outcome_logs_trade ON outcome_logs(trade_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_context_logs_trade ON context_logs(trade_id)`);
    db.run(`CREATE INDEX IF NOT EXISTS idx_indicator_trust_name ON indicator_trust_scores(indicator_name)`);

    console.log('[SelfLearning] Phase 2 tables initialized successfully');
  } finally {
    db.close();
  }
}

// ==================== SIGNAL LOGGING ====================

/**
 * تسجيل إشارة جديدة
 */
export function logSignal(signal: Omit<SignalLog, 'id' | 'created_at'>): number {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    const result = db.prepare(`
      INSERT INTO signal_logs (
        ticker, stock_id, signal_date, direction, indicators_used,
        score, calculated_entry_price, calculated_stop_loss, calculated_target,
        has_news, news_summary, executed, execution_reason
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      signal.ticker,
      signal.stock_id,
      signal.signal_date,
      signal.direction,
      JSON.stringify(signal.indicators_used),
      signal.score,
      signal.calculated_entry_price,
      signal.calculated_stop_loss,
      signal.calculated_target,
      signal.has_news ? 1 : 0,
      signal.news_summary || null,
      signal.executed ? 1 : 0,
      signal.execution_reason || null
    );

    return result.lastInsertRowid as number;
  } finally {
    db.close();
  }
}

/**
 * تحديث حالة تنفيذ الإشارة
 */
export function updateSignalExecution(signalId: number, executed: boolean, reason?: string): void {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');
    db.prepare(`
      UPDATE signal_logs SET executed = ?, execution_reason = ? WHERE id = ?
    `).run(executed ? 1 : 0, reason || null, signalId);
  } finally {
    db.close();
  }
}

/**
 * الحصول على إشارات غير منفذة
 */
export function getUnexecutedSignals(limit: number = 50): SignalLog[] {
  const db = getReadDb();
  try {
    const rows = db.prepare(`
      SELECT * FROM signal_logs WHERE executed = 0 ORDER BY signal_date DESC LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>;

    return rows.map(row => ({
      id: row.id as number,
      ticker: row.ticker as string,
      stock_id: row.stock_id as number | null,
      signal_date: row.signal_date as string,
      direction: row.direction as SignalDirection,
      indicators_used: JSON.parse(row.indicators_used as string) as IndicatorType[],
      score: row.score as number,
      calculated_entry_price: row.calculated_entry_price as number,
      calculated_stop_loss: row.calculated_stop_loss as number,
      calculated_target: row.calculated_target as number,
      has_news: Boolean(row.has_news),
      news_summary: row.news_summary as string | undefined,
      executed: Boolean(row.executed),
      execution_reason: row.execution_reason as string | undefined,
      created_at: row.created_at as string,
    }));
  } finally {
    db.close();
  }
}

// ==================== TRADE LOGGING ====================

/**
 * تسجيل صفقة جديدة
 */
export function logTrade(trade: Omit<TradeLog, 'id' | 'created_at'>): number {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    // حساب العمولة والضريبة حسب السوق المصري
    const tradeValue = trade.trade_value;
    const commission = tradeValue * 0.005; // 0.5% عمولة
    const tax = trade.direction === 'sell' ? tradeValue * 0.005 : 0; // 0.5% ضريبة دمغة على البيع
    const spread = trade.spread || (tradeValue * 0.001); // 0.1% سبريد تقريبي
    const totalCost = commission + tax + spread;

    const result = db.prepare(`
      INSERT INTO trade_logs (
        signal_id, ticker, stock_id, direction, open_date,
        actual_entry_price, actual_stop_loss, actual_target,
        shares_count, trade_value, commission, tax, spread, total_cost, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      trade.signal_id,
      trade.ticker,
      trade.stock_id,
      trade.direction,
      trade.open_date,
      trade.actual_entry_price,
      trade.actual_stop_loss,
      trade.actual_target,
      trade.shares_count,
      trade.trade_value,
      commission,
      tax,
      spread,
      totalCost,
      'open'
    );

    return result.lastInsertRowid as number;
  } finally {
    db.close();
  }
}

/**
 * إغلاق صفقة
 */
export function closeTrade(
  tradeId: number,
  exitPrice: number,
  closeReason: CloseReason,
  context?: Partial<ContextLog>
): OutcomeLog {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    // الحصول على بيانات الصفقة
    const trade = db.prepare('SELECT * FROM trade_logs WHERE id = ?').get(tradeId) as Record<string, unknown>;
    if (!trade) throw new Error(`Trade ${tradeId} not found`);

    const entryPrice = trade.actual_entry_price as number;
    const totalCost = trade.total_cost as number;
    const sharesCount = trade.shares_count as number;
    const openDate = new Date(trade.open_date as string);
    const closeDate = new Date();

    // حساب الأرباح/الخسائر
    const direction = trade.direction as string;
    let grossProfitLoss: number;
    if (direction === 'buy') {
      grossProfitLoss = (exitPrice - entryPrice) * sharesCount;
    } else {
      grossProfitLoss = (entryPrice - exitPrice) * sharesCount;
    }

    const netProfitLoss = grossProfitLoss - totalCost - (exitPrice * sharesCount * 0.01); // خصم تكاليف البيع
    const profitLossPercent = (netProfitLoss / (entryPrice * sharesCount)) * 100;
    const daysOpen = Math.ceil((closeDate.getTime() - openDate.getTime()) / (1000 * 60 * 60 * 24));

    // إدخال نتيجة الصفقة
    const outcomeResult = db.prepare(`
      INSERT INTO outcome_logs (
        trade_id, close_date, actual_exit_price, close_reason,
        gross_profit_loss, net_profit_loss, profit_loss_percent, days_open
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tradeId,
      closeDate.toISOString(),
      exitPrice,
      closeReason,
      grossProfitLoss,
      netProfitLoss,
      profitLossPercent,
      daysOpen
    );

    // تحديث حالة الصفقة
    db.prepare(`UPDATE trade_logs SET status = 'closed' WHERE id = ?`).run(tradeId);

    // تسجيل بيئة الصفقة إذا تم توفيرها
    if (context) {
      logContext(tradeId, context);
    }

    // تحديث درجات الثقة للمؤشرات
    updateIndicatorTrustScores(tradeId, profitLossPercent > 0);

    return {
      id: outcomeResult.lastInsertRowid as number,
      trade_id: tradeId,
      close_date: closeDate.toISOString(),
      actual_exit_price: exitPrice,
      close_reason: closeReason,
      gross_profit_loss: grossProfitLoss,
      net_profit_loss: netProfitLoss,
      profit_loss_percent: profitLossPercent,
      days_open: daysOpen,
      created_at: closeDate.toISOString(),
    };
  } finally {
    db.close();
  }
}

// ==================== CONTEXT LOGGING ====================

/**
 * تسجيل بيئة الصفقة
 */
export function logContext(tradeId: number, context: Partial<ContextLog>): void {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    db.prepare(`
      INSERT INTO context_logs (
        trade_id, egx30_state, egx30_adx, official_usd_rate, parallel_usd_rate,
        usd_gap_percent, egx30_volume, egx30_avg_volume, liquidity_ratio,
        is_dividend_season, is_cbe_decision_near, market_sentiment
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      tradeId,
      context.egx30_state || 'RANGE',
      context.egx30_adx || 0,
      context.official_usd_rate || 0,
      context.parallel_usd_rate || 0,
      context.usd_gap_percent || 0,
      context.egx30_volume || 0,
      context.egx30_avg_volume || 0,
      context.liquidity_ratio || 1,
      context.is_dividend_season ? 1 : 0,
      context.is_cbe_decision_near ? 1 : 0,
      context.market_sentiment || 0
    );
  } finally {
    db.close();
  }
}

// ==================== INDICATOR TRUST SCORE SYSTEM ====================

/**
 * تهيئة درجات الثقة للمؤشرات
 */
export function initializeIndicatorTrustScores(): void {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    const indicators: IndicatorType[] = ['RSI', 'MACD', 'Ichimoku', 'Fibonacci', 'Bollinger', 'MA', 'ADX', 'Stochastic', 'Volume', 'SupportResistance'];

    for (const indicator of indicators) {
      const exists = db.prepare('SELECT id FROM indicator_trust_scores WHERE indicator_name = ?').get(indicator);
      if (!exists) {
        db.prepare(`
          INSERT INTO indicator_trust_scores (indicator_name, current_score, base_score, status, regime_scores)
          VALUES (?, 100, 100, 'active', '{}')
        `).run(indicator);
      }
    }
  } finally {
    db.close();
  }
}

/**
 * الحصول على درجة ثقة المؤشر
 */
export function getIndicatorTrustScore(indicator: IndicatorType): IndicatorTrustScore | null {
  const db = getReadDb();
  try {
    const row = db.prepare('SELECT * FROM indicator_trust_scores WHERE indicator_name = ?').get(indicator) as Record<string, unknown> | undefined;

    if (!row) return null;

    return {
      id: row.id as number,
      indicator_name: row.indicator_name as IndicatorType,
      current_score: row.current_score as number,
      base_score: row.base_score as number,
      total_signals: row.total_signals as number,
      successful_signals: row.successful_signals as number,
      failed_signals: row.failed_signals as number,
      consecutive_losses: row.consecutive_losses as number,
      status: row.status as 'active' | 'reflection' | 'disabled',
      reflection_start: row.reflection_start as string | undefined,
      reflection_end: row.reflection_end as string | undefined,
      last_updated: row.last_updated as string,
      regime_scores: JSON.parse(row.regime_scores as string || '[]') as RegimeScore[],
    };
  } finally {
    db.close();
  }
}

/**
 * الحصول على كل درجات الثقة
 */
export function getAllIndicatorTrustScores(): IndicatorTrustScore[] {
  const db = getReadDb();
  try {
    const rows = db.prepare('SELECT * FROM indicator_trust_scores').all() as Array<Record<string, unknown>>;

    return rows.map(row => ({
      id: row.id as number,
      indicator_name: row.indicator_name as IndicatorType,
      current_score: row.current_score as number,
      base_score: row.base_score as number,
      total_signals: row.total_signals as number,
      successful_signals: row.successful_signals as number,
      failed_signals: row.failed_signals as number,
      consecutive_losses: row.consecutive_losses as number,
      status: row.status as 'active' | 'reflection' | 'disabled',
      reflection_start: row.reflection_start as string | undefined,
      reflection_end: row.reflection_end as string | undefined,
      last_updated: row.last_updated as string,
      regime_scores: JSON.parse(row.regime_scores as string || '[]') as RegimeScore[],
    }));
  } finally {
    db.close();
  }
}

/**
 * تحديث درجات الثقة بعد صفقة
 */
function updateIndicatorTrustScores(tradeId: number, isProfit: boolean): void {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    // الحصول على الإشارة المرتبطة بالصفقة
    const trade = db.prepare('SELECT signal_id FROM trade_logs WHERE id = ?').get(tradeId) as Record<string, unknown> | undefined;
    if (!trade || !trade.signal_id) return;

    const signal = db.prepare('SELECT indicators_used FROM signal_logs WHERE id = ?').get(trade.signal_id) as Record<string, unknown> | undefined;
    if (!signal) return;

    const indicators = JSON.parse(signal.indicators_used as string) as IndicatorType[];
    const outcome = db.prepare('SELECT profit_loss_percent FROM outcome_logs WHERE trade_id = ?').get(tradeId) as Record<string, unknown> | undefined;
    const profitPercent = outcome ? (outcome.profit_loss_percent as number) : 0;

    for (const indicator of indicators) {
      const current = db.prepare('SELECT * FROM indicator_trust_scores WHERE indicator_name = ?').get(indicator) as Record<string, unknown> | undefined;
      if (!current) continue;

      let scoreChange = 0;
      let newConsecutiveLosses = current.consecutive_losses as number;

      if (isProfit) {
        // قواعد الزيادة
        if (profitPercent < 3) scoreChange = 3;
        else if (profitPercent <= 6) scoreChange = 8;
        else scoreChange = 15;

        newConsecutiveLosses = 0;
      } else {
        // قواعد النقصان
        if (profitPercent > -2) scoreChange = -5;
        else if (profitPercent >= -4) scoreChange = -12;
        else scoreChange = -25;

        newConsecutiveLosses++;

        // خصم إضافي للتحذيرات المتجاهلة
        // (يمكن إضافة منطق لاحقاً)
      }

      let newScore = Math.max(0, Math.min(200, (current.current_score as number) + scoreChange));
      let newStatus = current.status as string;

      // حالات الطوارئ
      if (newConsecutiveLosses >= 3 && newStatus === 'active') {
        newScore = newScore * 0.5; // خصم 50%
        newStatus = 'reflection';
        const reflectionEnd = new Date();
        reflectionEnd.setDate(reflectionEnd.getDate() + 14);

        db.prepare(`
          UPDATE indicator_trust_scores SET
            current_score = ?,
            consecutive_losses = ?,
            status = ?,
            reflection_start = datetime('now'),
            reflection_end = ?,
            last_updated = datetime('now')
          WHERE indicator_name = ?
        `).run(newScore, newConsecutiveLosses, newStatus, reflectionEnd.toISOString(), indicator);
      } else if (newScore <= 30 && newStatus !== 'disabled') {
        newStatus = 'disabled';

        db.prepare(`
          UPDATE indicator_trust_scores SET
            current_score = ?,
            status = ?,
            last_updated = datetime('now')
          WHERE indicator_name = ?
        `).run(newScore, newStatus, indicator);
      } else {
        db.prepare(`
          UPDATE indicator_trust_scores SET
            current_score = ?,
            total_signals = total_signals + 1,
            successful_signals = successful_signals + ?,
            failed_signals = failed_signals + ?,
            consecutive_losses = ?,
            last_updated = datetime('now')
          WHERE indicator_name = ?
        `).run(newScore, isProfit ? 1 : 0, isProfit ? 0 : 1, newConsecutiveLosses, indicator);
      }
    }
  } finally {
    db.close();
  }
}

// ==================== MIRROR ANALYSIS (آلية المرآة) ====================

/**
 * تحليل المرآة - 6 أسئلة بعد كل صفقة مغلقة
 */
export function runMirrorAnalysis(tradeId: number): MirrorAnalysisResult[] {
  const db = getReadDb();
  try {
    const results: MirrorAnalysisResult[] = [];

    // الحصول على بيانات الصفقة والنتيجة والبيئة
    const trade = db.prepare('SELECT * FROM trade_logs WHERE id = ?').get(tradeId) as Record<string, unknown> | undefined;
    const outcome = db.prepare('SELECT * FROM outcome_logs WHERE trade_id = ?').get(tradeId) as Record<string, unknown> | undefined;
    const context = db.prepare('SELECT * FROM context_logs WHERE trade_id = ?').get(tradeId) as Record<string, unknown> | undefined;
    const signal = trade?.signal_id ? db.prepare('SELECT * FROM signal_logs WHERE id = ?').get(trade.signal_id) as Record<string, unknown> | undefined : undefined;

    if (!trade || !outcome) return results;

    const isProfit = (outcome.profit_loss_percent as number) > 0;
    const entryPrice = trade.actual_entry_price as number;
    const stopLoss = trade.actual_stop_loss as number;
    const target = trade.actual_target as number;

    // السؤال 1: هل دخلت ضد السوق؟
    if (context) {
      const marketState = context.egx30_state as string;
      const direction = trade.direction as string;

      if ((marketState === 'BEAR' && direction === 'buy') || (marketState === 'BULL' && direction === 'sell')) {
        results.push({
          question: 'هل دخلت ضد السوق؟',
          answer: true,
          insight: isProfit
            ? 'نجحت رغم السباحة ضد التيار - لكن هذا استثناء وليس قاعدة'
            : 'السباحة ضد التيار غالية - السوق كان ضدك',
          severity: isProfit ? 'info' : 'warning',
        });
      }
    }

    // السؤال 2: هل الوقف كان قريب ولا بعيد؟
    const stopDistance = Math.abs((stopLoss - entryPrice) / entryPrice) * 100;

    if (stopDistance < 2) {
      results.push({
        question: 'هل الوقف كان قريب جداً؟',
        answer: true,
        insight: 'الوقف أقل من 2% - غالباً اتضرب بالضوضاء (Noise)',
        severity: 'warning',
      });
    } else if (stopDistance > 6) {
      results.push({
        question: 'هل الوقف كان بعيد جداً؟',
        answer: true,
        insight: 'الوقف أكبر من 6% - الخسارة كانت ستكون كبيرة لو ضرب',
        severity: 'warning',
      });
    } else {
      results.push({
        question: 'هل الوقف كان مناسب؟',
        answer: true,
        insight: `الوقف ${stopDistance.toFixed(1)}% في النطاق المثالي (3-5%)`,
        severity: 'info',
      });
    }

    // السؤال 3: هل كان فيه خبر أثر؟
    if (signal && signal.has_news) {
      results.push({
        question: 'هل كان فيه خبر أثر؟',
        answer: true,
        insight: isProfit
          ? 'الخبر كان في صالحك'
          : 'المؤشر الفني لا يغلب الخبر - كان فيه تحذير معلن',
        severity: isProfit ? 'info' : 'critical',
      });
    }

    // السؤال 4: هل الحجم كان ضعيف؟
    if (context && context.liquidity_ratio < 0.7) {
      results.push({
        question: 'هل الحجم كان ضعيف؟',
        answer: true,
        insight: 'الإشارة بدون حجم = فخ سيولة - الحجم كان أقل من المتوسط بـ 30%',
        severity: 'warning',
      });
    }

    // السؤال 5: هل دخلت في "المنتصف"؟
    if (signal) {
      const score = signal.score as number;
      const indicators = JSON.parse(signal.indicators_used as string || '[]');

      // إذا كانت المؤشرات لا توضح دعم/مقاومة قوية
      if (!indicators.includes('SupportResistance') && score < 80) {
        results.push({
          question: 'هل دخلت في المنطقة الوسطى؟',
          answer: true,
          insight: 'المنتصف = منطقة المجهول - لا يوجد دعم/مقاومة واضح',
          severity: 'info',
        });
      }
    }

    // السؤال 6: هل كانت الدرجة عالية بس النتيجة سيئة؟
    if (signal && signal.score > 80 && !isProfit) {
      results.push({
        question: 'هل الدرجة العالية لم تتنبأ بالنتيجة؟',
        answer: true,
        insight: 'المؤشرات المتعددة ممكن تتفق على غلط - درجة عالية لا تعني ضمان',
        severity: 'critical',
      });
    }

    return results;
  } finally {
    db.close();
  }
}

// ==================== PATTERN DETECTION (اكتشاف الأنماط) ====================

/**
 * اكتشاف الأنماط المتكررة
 */
export function detectPatterns(monthsBack: number = 1): PatternDetectionResult[] {
  const db = getReadDb();
  try {
    const results: PatternDetectionResult[] = [];
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);

    // البحث عن أنماط: مؤشرات معينة + طور معين + نتيجة خاسرة
    const patterns = db.prepare(`
      SELECT
        s.indicators_used,
        c.egx30_state,
        o.profit_loss_percent,
        COUNT(*) as cnt,
        SUM(CASE WHEN o.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins
      FROM trade_logs t
      JOIN signal_logs s ON t.signal_id = s.id
      JOIN outcome_logs o ON o.trade_id = t.id
      JOIN context_logs c ON c.trade_id = t.id
      WHERE t.open_date >= ?
      GROUP BY s.indicators_used, c.egx30_state
      HAVING cnt >= 4
    `).all(cutoffDate.toISOString().split('T')[0]) as Array<{
      indicators_used: string;
      egx30_state: string;
      profit_loss_percent: number;
      cnt: number;
      wins: number;
    }>;

    for (const pattern of patterns) {
      const successRate = (pattern.wins / pattern.cnt) * 100;

      // إذا كان معدل النجاح ضعيف
      if (successRate < 40 && pattern.cnt >= 4) {
        const indicators = JSON.parse(pattern.indicators_used) as string[];

        results.push({
          pattern_name: `${indicators.join(' + ')} في السوق ${pattern.egx30_state}`,
          occurrences: pattern.cnt,
          success_rate: successRate,
          suggested_lesson: `مؤشرات ${indicators.join(' و')} في السوق ${pattern.egx30_state} = فخ متكرر`,
          suggested_action: `خفف وزن ${indicators[0]} 50% لما يكون الطور = ${pattern.egx30_state}`,
        });
      }
    }

    return results;
  } finally {
    db.close();
  }
}

// ==================== EXPECTANCY CALCULATION ====================

/**
 * حساب القيمة المتوقعة (Expectancy) للمؤشرات
 */
export function calculateExpectancy(regime?: MarketPhase): ExpectancyResult[] {
  const db = getReadDb();
  try {
    const results: ExpectancyResult[] = [];
    const indicators: IndicatorType[] = ['RSI', 'MACD', 'Ichimoku', 'Fibonacci', 'Bollinger', 'MA', 'ADX', 'Stochastic', 'Volume', 'SupportResistance'];

    for (const indicator of indicators) {
      // بناء الاستعلام حسب وجود الطور
      let query: string;
      let params: string[];

      if (regime) {
        query = `
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN o.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins,
            AVG(CASE WHEN o.profit_loss_percent > 0 THEN o.profit_loss_percent END) as avg_win,
            AVG(CASE WHEN o.profit_loss_percent <= 0 THEN ABS(o.profit_loss_percent) END) as avg_loss
          FROM trade_logs t
          JOIN signal_logs s ON t.signal_id = s.id
          JOIN outcome_logs o ON o.trade_id = t.id
          JOIN context_logs c ON c.trade_id = t.id
          WHERE s.indicators_used LIKE ? AND c.egx30_state = ?
        `;
        params = [`%"${indicator}"%`, regime];
      } else {
        query = `
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN o.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins,
            AVG(CASE WHEN o.profit_loss_percent > 0 THEN o.profit_loss_percent END) as avg_win,
            AVG(CASE WHEN o.profit_loss_percent <= 0 THEN ABS(o.profit_loss_percent) END) as avg_loss
          FROM trade_logs t
          JOIN signal_logs s ON t.signal_id = s.id
          JOIN outcome_logs o ON o.trade_id = t.id
          WHERE s.indicators_used LIKE ?
        `;
        params = [`%"${indicator}"%`];
      }

      const stats = db.prepare(query).get(...params) as {
        total: number;
        wins: number;
        avg_win: number | null;
        avg_loss: number | null;
      };

      if (stats.total < 5) continue;

      const winRate = stats.wins / stats.total;
      const avgWin = stats.avg_win || 0;
      const avgLoss = stats.avg_loss || 0;

      // Expectancy = (Win Rate × Avg Win) - (Loss Rate × Avg Loss)
      const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

      let recommendation: 'increase_weight' | 'maintain' | 'reduce_weight' | 'disable';
      if (expectancy > 3) recommendation = 'increase_weight';
      else if (expectancy >= 1) recommendation = 'maintain';
      else if (expectancy >= 0) recommendation = 'reduce_weight';
      else recommendation = 'disable';

      results.push({
        indicator,
        regime: regime || 'BULL',
        total_trades: stats.total,
        win_rate: winRate * 100,
        avg_win_percent: avgWin,
        avg_loss_percent: avgLoss,
        expectancy,
        recommendation,
      });
    }

    return results.sort((a, b) => b.expectancy - a.expectancy);
  } finally {
    db.close();
  }
}

// ==================== LESSON MINING ====================

/**
 * تعدين الدروس التلقائي
 */
export function mineLessons(): LearnedLesson[] {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');
    const newLessons: LearnedLesson[] = [];

    // 1. دروس مباشرة: أنماط متكررة من الخسائر
    const patterns = detectPatterns(1);

    for (const pattern of patterns) {
      if (pattern.success_rate < 40 && pattern.occurrences >= 4) {
        // التحقق من وجود الدرس مسبقاً
        const existing = db.prepare(`
          SELECT id FROM learned_lessons WHERE title = ?
        `).get(pattern.pattern_name) as Record<string, unknown> | undefined;

        if (existing) {
          // تحديث التكرارات
          db.prepare(`
            UPDATE learned_lessons SET
              occurrences = occurrences + 1,
              last_seen = datetime('now')
            WHERE id = ?
          `).run(existing.id);
        } else {
          // إنشاء درس جديد
          const result = db.prepare(`
            INSERT INTO learned_lessons (
              lesson_type, title, description, trigger_conditions,
              action, confidence, occurrences, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            'direct',
            pattern.pattern_name,
            pattern.suggested_lesson,
            JSON.stringify({ min_occurrences: 4, max_success_rate: 40 }),
            pattern.suggested_action,
            pattern.occurrences * 10,
            pattern.occurrences,
            'testing'
          );

          newLessons.push({
            id: result.lastInsertRowid as number,
            lesson_type: 'direct',
            title: pattern.pattern_name,
            description: pattern.suggested_lesson,
            trigger_conditions: JSON.stringify({ min_occurrences: 4, max_success_rate: 40 }),
            action: pattern.suggested_action,
            confidence: pattern.occurrences * 10,
            occurrences: pattern.occurrences,
            first_seen: new Date().toISOString(),
            last_seen: new Date().toISOString(),
            status: 'testing',
            paper_trades_tested: 0,
            paper_trades_success: 0,
            created_at: new Date().toISOString(),
          });
        }
      }
    }

    // 2. دروس مركبة: توافق المؤشرات
    const compoundPatterns = db.prepare(`
      SELECT
        s.indicators_used,
        COUNT(*) as total,
        SUM(CASE WHEN o.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins,
        AVG(o.profit_loss_percent) as avg_pl
      FROM trade_logs t
      JOIN signal_logs s ON t.signal_id = s.id
      JOIN outcome_logs o ON o.trade_id = t.id
      WHERE s.indicators_used LIKE '%Ichimoku%' AND s.indicators_used LIKE '%Fibonacci%'
      GROUP BY s.indicators_used
      HAVING total >= 5
    `).all() as Array<{
      indicators_used: string;
      total: number;
      wins: number;
      avg_pl: number;
    }>;

    for (const cp of compoundPatterns) {
      const successRate = (cp.wins / cp.total) * 100;

      if (successRate < 40 && cp.total >= 5) {
        const title = 'Ichimoku + Fibonacci معاً = إشارة ضعيفة';

        const existing = db.prepare(`SELECT id FROM learned_lessons WHERE title = ?`).get(title) as Record<string, unknown> | undefined;

        if (!existing) {
          const result = db.prepare(`
            INSERT INTO learned_lessons (
              lesson_type, title, description, trigger_conditions,
              action, confidence, occurrences, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            'compound',
            title,
            'التوافق بين Ichimoku و Fibonacci في السوق المصري مش دائماً إيجابي',
            JSON.stringify({ indicators: ['Ichimoku', 'Fibonacci'], both_present: true }),
            'لو Ichimoku و Fibonacci متفقين، خفف الدرجة 20 نقطة',
            cp.total * 8,
            cp.total,
            'testing'
          );

          newLessons.push({
            id: result.lastInsertRowid as number,
            lesson_type: 'compound',
            title,
            description: 'التوافق بين Ichimoku و Fibonacci في السوق المصري مش دائماً إيجابي',
            trigger_conditions: JSON.stringify({ indicators: ['Ichimoku', 'Fibonacci'], both_present: true }),
            action: 'لو Ichimoku و Fibonacci متفقين، خفف الدرجة 20 نقطة',
            confidence: cp.total * 8,
            occurrences: cp.total,
            first_seen: new Date().toISOString(),
            last_seen: new Date().toISOString(),
            status: 'testing',
            paper_trades_tested: 0,
            paper_trades_success: 0,
            created_at: new Date().toISOString(),
          });
        }
      }
    }

    // 3. دروس بيئية: الدولار والاستقرار النقدي
    const envPatterns = db.prepare(`
      SELECT
        CASE WHEN c.usd_gap_percent < 5 THEN 1 ELSE 0 END as stable_usd,
        COUNT(*) as total,
        SUM(CASE WHEN o.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins,
        AVG(o.profit_loss_percent) as avg_pl
      FROM trade_logs t
      JOIN outcome_logs o ON o.trade_id = t.id
      JOIN context_logs c ON c.trade_id = t.id
      GROUP BY stable_usd
    `).all() as Array<{
      stable_usd: number;
      total: number;
      wins: number;
      avg_pl: number;
    }>;

    for (const ep of envPatterns) {
      if (ep.stable_usd === 1 && ep.total >= 10) {
        const successRate = (ep.wins / ep.total) * 100;

        if (successRate > 60) {
          const title = 'الاستقرار النقدي = بيئة أفضل للربح';

          const existing = db.prepare(`SELECT id FROM learned_lessons WHERE title = ?`).get(title) as Record<string, unknown> | undefined;

          if (!existing) {
            const result = db.prepare(`
              INSERT INTO learned_lessons (
                lesson_type, title, description, trigger_conditions,
                action, confidence, occurrences, status
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              'environmental',
              title,
              `الصفقات الناجحة لما الفرق الدولاري أقل من 5%: ${successRate.toFixed(0)}%`,
              JSON.stringify({ usd_gap_max: 5 }),
              'لو الفرق الدولاري > 10%، خفف حجم الصفقات 50%',
              ep.total * 5,
              ep.total,
              'testing'
            );

            newLessons.push({
              id: result.lastInsertRowid as number,
              lesson_type: 'environmental',
              title,
              description: `الصفقات الناجحة لما الفرق الدولاري أقل من 5%: ${successRate.toFixed(0)}%`,
              trigger_conditions: JSON.stringify({ usd_gap_max: 5 }),
              action: 'لو الفرق الدولاري > 10%، خفف حجم الصفقات 50%',
              confidence: ep.total * 5,
              occurrences: ep.total,
              first_seen: new Date().toISOString(),
              last_seen: new Date().toISOString(),
              status: 'testing',
              paper_trades_tested: 0,
              paper_trades_success: 0,
              created_at: new Date().toISOString(),
            });
          }
        }
      }
    }

    return newLessons;
  } finally {
    db.close();
  }
}

/**
 * الحصول على الدروس المستفادة
 */
export function getLearnedLessons(status?: 'testing' | 'validated' | 'rejected'): LearnedLesson[] {
  const db = getReadDb();
  try {
    let query = 'SELECT * FROM learned_lessons';
    const params: string[] = [];

    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }

    query += ' ORDER BY confidence DESC, occurrences DESC';

    const rows = db.prepare(query).all(...params) as Array<Record<string, unknown>>;

    return rows.map(row => ({
      id: row.id as number,
      lesson_type: row.lesson_type as 'direct' | 'compound' | 'environmental',
      title: row.title as string,
      description: row.description as string,
      trigger_conditions: row.trigger_conditions as string,
      action: row.action as string,
      confidence: row.confidence as number,
      occurrences: row.occurrences as number,
      first_seen: row.first_seen as string,
      last_seen: row.last_seen as string,
      status: row.status as 'testing' | 'validated' | 'rejected',
      validation_start: row.validation_start as string | undefined,
      validation_end: row.validation_end as string | undefined,
      paper_trades_tested: row.paper_trades_tested as number,
      paper_trades_success: row.paper_trades_success as number,
      created_at: row.created_at as string,
    }));
  } finally {
    db.close();
  }
}

// ==================== WEIGHT ADJUSTMENT ====================

/**
 * تعديل الأوزان الشهري
 */
export function adjustMonthlyWeights(): {
  adjustments: Array<{ parameter: string; old_value: number; new_value: number; reason: string }>;
  applied: number;
} {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    const adjustments: Array<{ parameter: string; old_value: number; new_value: number; reason: string }> = [];

    // حساب Expectancy لكل مؤشر حسب الطور
    const regimes: MarketPhase[] = ['BULL', 'BEAR', 'RANGE'];

    for (const regime of regimes) {
      const expectancyResults = calculateExpectancy(regime);

      for (const result of expectancyResults) {
        // تحديث أو إنشاء وزن الطور
        const existing = db.prepare(`
          SELECT * FROM regime_indicator_weights WHERE indicator_name = ? AND regime = ?
        `).get(result.indicator, regime) as Record<string, unknown> | undefined;

        let newWeight: number;

        if (result.recommendation === 'increase_weight') {
          newWeight = existing ? Math.min((existing.weight as number) * 1.2, 2.0) : 1.2;
        } else if (result.recommendation === 'reduce_weight') {
          newWeight = existing ? Math.max((existing.weight as number) * 0.8, 0.3) : 0.8;
        } else if (result.recommendation === 'disable') {
          newWeight = 0.1;
        } else {
          newWeight = existing?.weight as number || 1.0;
        }

        if (existing) {
          if (Math.abs(newWeight - (existing.weight as number)) > 0.05) {
            db.prepare(`
              UPDATE regime_indicator_weights SET
                weight = ?, expectancy = ?, last_calculated = datetime('now')
              WHERE indicator_name = ? AND regime = ?
            `).run(newWeight, result.expectancy, result.indicator, regime);

            adjustments.push({
              parameter: `${result.indicator}_${regime}`,
              old_value: existing.weight as number,
              new_value: newWeight,
              reason: `Expectancy: ${result.expectancy.toFixed(2)}, Win Rate: ${result.win_rate.toFixed(1)}%`,
            });
          }
        } else {
          db.prepare(`
            INSERT INTO regime_indicator_weights (indicator_name, regime, weight, expectancy)
            VALUES (?, ?, ?, ?)
          `).run(result.indicator, regime, newWeight, result.expectancy);

          adjustments.push({
            parameter: `${result.indicator}_${regime}`,
            old_value: 1.0,
            new_value: newWeight,
            reason: `Initial setup. Expectancy: ${result.expectancy.toFixed(2)}`,
          });
        }
      }
    }

    // تحديث الأوزان الرئيسية في calculation_weights
    const overallExpectancy = calculateExpectancy();

    for (const result of overallExpectancy) {
      const paramName = `weight_${result.indicator.toLowerCase()}`;

      // التحقق من وجود المعامل
      const existing = db.prepare(`
        SELECT * FROM calculation_weights WHERE parameter_name = ?
      `).get(paramName) as Record<string, unknown> | undefined;

      if (existing) {
        let adjustment = 0;
        if (result.recommendation === 'increase_weight') adjustment = 0.05;
        else if (result.recommendation === 'reduce_weight') adjustment = -0.03;
        else if (result.recommendation === 'disable') adjustment = -0.5;

        const currentValue = existing.current_value as number;
        const newValue = Math.max(0.1, Math.min(0.5, currentValue + adjustment));

        if (Math.abs(newValue - currentValue) > 0.01) {
          db.prepare(`
            UPDATE calculation_weights SET
              current_value = ?, updated_at = datetime('now'), updated_by = 'auto_learning'
            WHERE parameter_name = ?
          `).run(newValue, paramName);

          adjustments.push({
            parameter: paramName,
            old_value: currentValue,
            new_value: newValue,
            reason: `Monthly adjustment. Expectancy: ${result.expectancy.toFixed(2)}`,
          });
        }
      }
    }

    // مسح الكاش
    clearCache();

    return {
      adjustments,
      applied: adjustments.length,
    };
  } finally {
    db.close();
  }
}

// ==================== FATAL ERROR HANDLING ====================

/**
 * تسجيل الغلطة القاتلة
 */
export function logFatalError(
  tradeId: number,
  lossPercent: number,
  capitalImpactPercent: number,
  consecutiveLosses: number
): { halt_trading: boolean; review_required: boolean } {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    // تحديد نوع الغلطة
    let errorType: string;
    if (lossPercent > 5) {
      errorType = 'single_large_loss';
    } else if (consecutiveLosses >= 3) {
      errorType = 'consecutive_losses';
    } else {
      errorType = 'capital_impact';
    }

    // تسجيل الغلطة
    db.prepare(`
      INSERT INTO fatal_errors (
        error_date, trade_id, error_type, loss_percent,
        capital_impact_percent, consecutive_losses
      ) VALUES (datetime('now'), ?, ?, ?, ?, ?)
    `).run(tradeId, errorType, lossPercent, capitalImpactPercent, consecutiveLosses);

    // تحديد هل يجب إيقاف التداول
    const haltTrading = lossPercent > 5 || capitalImpactPercent > 5 || consecutiveLosses >= 3;

    if (haltTrading) {
      db.prepare(`
        UPDATE fatal_errors SET trading_halted = 1, halt_reason = ?
        WHERE id = last_insert_rowid()
      `).run(errorType);
    }

    return {
      halt_trading: haltTrading,
      review_required: haltTrading,
    };
  } finally {
    db.close();
  }
}

/**
 * التحقق من حالة التداول
 */
export function checkTradingStatus(): {
  can_trade: boolean;
  halt_reason?: string;
  days_remaining?: number;
} {
  const db = getReadDb();
  try {
    // البحث عن أي إيقاف نشط
    const halt = db.prepare(`
      SELECT * FROM fatal_errors
      WHERE trading_halted = 1 AND review_completed = 0
      ORDER BY error_date DESC LIMIT 1
    `).get() as Record<string, unknown> | undefined;

    if (!halt) {
      return { can_trade: true };
    }

    const errorDate = new Date(halt.error_date as string);
    const now = new Date();
    const daysSinceHalt = Math.floor((now.getTime() - errorDate.getTime()) / (1000 * 60 * 60 * 24));

    // الحد الأدنى للإيقاف: 3 أيام
    const minHaltDays = 3;

    if (daysSinceHalt < minHaltDays) {
      return {
        can_trade: false,
        halt_reason: halt.halt_reason as string,
        days_remaining: minHaltDays - daysSinceHalt,
      };
    }

    // إذا مرت 3 أيام، نحتاج مراجعة يدوية
    return {
      can_trade: false,
      halt_reason: 'مراجعة يدوية مطلوبة',
    };
  } finally {
    db.close();
  }
}

/**
 * إنهاء إيقاف التداول
 */
export function resolveTradingHalt(findings?: string): void {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    db.prepare(`
      UPDATE fatal_errors SET
        review_completed = 1,
        review_findings = ?
      WHERE trading_halted = 1 AND review_completed = 0
    `).run(findings || null);
  } finally {
    db.close();
  }
}

// ==================== REVIEW CYCLES ====================

/**
 * تشغيل المراجعة اليومية
 */
export function runDailyReview(): {
  closed_trades: number;
  updated_trust_scores: number;
  mirror_analyses: number;
} {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    const today = new Date().toISOString().split('T')[0];

    // الحصول على الصفقات المغلقة اليوم
    const closedToday = db.prepare(`
      SELECT t.id as trade_id FROM trade_logs t
      JOIN outcome_logs o ON o.trade_id = t.id
      WHERE DATE(o.close_date) = ?
    `).all(today) as Array<{ trade_id: number }>;

    let mirrorAnalyses = 0;

    // تشغيل تحليل المرآة لكل صفقة
    for (const trade of closedToday) {
      const analysis = runMirrorAnalysis(trade.trade_id);
      if (analysis.length > 0) mirrorAnalyses++;
    }

    // التحقق من المؤشرات في حالة تأمل
    const indicators = getAllIndicatorTrustScores();
    let updatedTrustScores = 0;

    for (const indicator of indicators) {
      if (indicator.status === 'reflection' && indicator.reflection_end) {
        const reflectionEnd = new Date(indicator.reflection_end);
        if (new Date() >= reflectionEnd) {
          // إنهاء فترة التأمل
          db.prepare(`
            UPDATE indicator_trust_scores SET
              status = 'active',
              reflection_start = NULL,
              reflection_end = NULL,
              consecutive_losses = 0,
              last_updated = datetime('now')
            WHERE indicator_name = ?
          `).run(indicator.indicator_name);
          updatedTrustScores++;
        }
      }
    }

    return {
      closed_trades: closedToday.length,
      updated_trust_scores: updatedTrustScores,
      mirror_analyses: mirrorAnalyses,
    };
  } finally {
    db.close();
  }
}

/**
 * تشغيل المراجعة الأسبوعية
 */
export function runWeeklyReview(): {
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  avg_win: number;
  avg_loss: number;
  star_indicator: string;
  worst_indicator: string;
  lesson_of_week: string;
} {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    // إحصائيات الصفقات
    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN o.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN o.profit_loss_percent <= 0 THEN 1 ELSE 0 END) as losses,
        AVG(CASE WHEN o.profit_loss_percent > 0 THEN o.profit_loss_percent END) as avg_win,
        AVG(CASE WHEN o.profit_loss_percent <= 0 THEN ABS(o.profit_loss_percent) END) as avg_loss
      FROM trade_logs t
      JOIN outcome_logs o ON o.trade_id = t.id
      WHERE DATE(o.close_date) >= ?
    `).get(weekAgo.toISOString().split('T')[0]) as {
      total: number;
      wins: number;
      losses: number;
      avg_win: number | null;
      avg_loss: number | null;
    };

    // أفضل وأسوأ مؤشر
    const expectancyResults = calculateExpectancy();
    const starIndicator = expectancyResults.length > 0 ? expectancyResults[0].indicator : 'N/A';
    const worstIndicator = expectancyResults.length > 1 ? expectancyResults[expectancyResults.length - 1].indicator : 'N/A';

    // استخراج درس الأسبوع
    const patterns = detectPatterns(1);
    const lessonOfWeek = patterns.length > 0
      ? patterns[0].suggested_lesson
      : 'لا توجد أنماط جديدة هذا الأسبوع';

    // حفظ المراجعة
    db.prepare(`
      INSERT INTO review_cycles (
        review_type, review_date, total_trades, winning_trades, losing_trades,
        win_rate, avg_win, avg_loss, best_indicator, worst_indicator, summary
      ) VALUES ('weekly', datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      stats.total,
      stats.wins,
      stats.losses,
      stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
      stats.avg_win || 0,
      stats.avg_loss || 0,
      starIndicator,
      worstIndicator,
      lessonOfWeek
    );

    return {
      total_trades: stats.total,
      winning_trades: stats.wins,
      losing_trades: stats.losses,
      win_rate: stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
      avg_win: stats.avg_win || 0,
      avg_loss: stats.avg_loss || 0,
      star_indicator: starIndicator,
      worst_indicator: worstIndicator,
      lesson_of_week: lessonOfWeek,
    };
  } finally {
    db.close();
  }
}

/**
 * تشغيل المراجعة الشهرية
 */
export function runMonthlyReview(): {
  expectancy_results: ExpectancyResult[];
  weight_adjustments: number;
  lessons_mined: number;
  indicators_reviewed: number;
} {
  const db = getWriteDb();
  try {
    db.pragma('journal_mode = WAL');

    // حساب Expectancy
    const expectancyResults = calculateExpectancy();

    // تعديل الأوزان
    const adjustmentResult = adjustMonthlyWeights();

    // تعدين الدروس
    const newLessons = mineLessons();

    // مراجعة المؤشرات المعطلة
    const disabledIndicators = getAllIndicatorTrustScores().filter(i => i.status === 'disabled');

    for (const indicator of disabledIndicators) {
      // التحقق مما إذا كان يجب إعادة تفعيله
      const expectancy = expectancyResults.find(e => e.indicator === indicator.indicator_name);
      if (expectancy && expectancy.expectancy > 0) {
        db.prepare(`
          UPDATE indicator_trust_scores SET
            status = 'active',
            current_score = 50,
            last_updated = datetime('now')
          WHERE indicator_name = ?
        `).run(indicator.indicator_name);
      }
    }

    // حفظ المراجعة
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);

    const stats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN o.profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins
      FROM trade_logs t
      JOIN outcome_logs o ON o.trade_id = t.id
      WHERE DATE(o.close_date) >= ?
    `).get(monthAgo.toISOString().split('T')[0]) as { total: number; wins: number };

    db.prepare(`
      INSERT INTO review_cycles (
        review_type, review_date, total_trades, winning_trades,
        win_rate, expectancy, weight_adjustments, lessons_learned
      ) VALUES ('monthly', datetime('now'), ?, ?, ?, ?, ?, ?)
    `).run(
      stats.total,
      stats.wins,
      stats.total > 0 ? (stats.wins / stats.total) * 100 : 0,
      expectancyResults.length > 0 ? expectancyResults[0].expectancy : 0,
      adjustmentResult.applied,
      newLessons.length
    );

    return {
      expectancy_results: expectancyResults,
      weight_adjustments: adjustmentResult.applied,
      lessons_mined: newLessons.length,
      indicators_reviewed: disabledIndicators.length,
    };
  } finally {
    db.close();
  }
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * الحصول على إحصائيات شاملة
 */
export function getSelfLearningStats(): {
  signals: { total: number; executed: number; pending: number };
  trades: { total: number; open: number; closed: number };
  outcomes: { wins: number; losses: number; win_rate: number; avg_profit: number; avg_loss: number };
  indicators: { active: number; reflection: number; disabled: number };
  lessons: { testing: number; validated: number; rejected: number };
} {
  const db = getReadDb();
  try {
    // إحصائيات الإشارات
    const signalStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(executed) as executed
      FROM signal_logs
    `).get() as { total: number; executed: number };

    // إحصائيات الصفقات
    const tradeStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_count
      FROM trade_logs
    `).get() as { total: number; open_count: number; closed_count: number };

    // إحصائيات النتائج
    const outcomeStats = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN profit_loss_percent > 0 THEN 1 ELSE 0 END) as wins,
        AVG(CASE WHEN profit_loss_percent > 0 THEN profit_loss_percent END) as avg_profit,
        AVG(CASE WHEN profit_loss_percent <= 0 THEN ABS(profit_loss_percent) END) as avg_loss
      FROM outcome_logs
    `).get() as {
      total: number;
      wins: number;
      avg_profit: number | null;
      avg_loss: number | null;
    };

    // إحصائيات المؤشرات
    const indicatorStats = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'reflection' THEN 1 ELSE 0 END) as reflection,
        SUM(CASE WHEN status = 'disabled' THEN 1 ELSE 0 END) as disabled
      FROM indicator_trust_scores
    `).get() as { active: number; reflection: number; disabled: number };

    // إحصائيات الدروس
    const lessonStats = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'testing' THEN 1 ELSE 0 END) as testing,
        SUM(CASE WHEN status = 'validated' THEN 1 ELSE 0 END) as validated,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
      FROM learned_lessons
    `).get() as { testing: number; validated: number; rejected: number };

    return {
      signals: {
        total: signalStats.total,
        executed: signalStats.executed || 0,
        pending: signalStats.total - (signalStats.executed || 0),
      },
      trades: {
        total: tradeStats.total,
        open: tradeStats.open_count || 0,
        closed: tradeStats.closed_count || 0,
      },
      outcomes: {
        wins: outcomeStats.wins || 0,
        losses: (outcomeStats.total || 0) - (outcomeStats.wins || 0),
        win_rate: outcomeStats.total > 0 ? ((outcomeStats.wins || 0) / outcomeStats.total) * 100 : 0,
        avg_profit: outcomeStats.avg_profit || 0,
        avg_loss: outcomeStats.avg_loss || 0,
      },
      indicators: {
        active: indicatorStats.active || 0,
        reflection: indicatorStats.reflection || 0,
        disabled: indicatorStats.disabled || 0,
      },
      lessons: {
        testing: lessonStats.testing || 0,
        validated: lessonStats.validated || 0,
        rejected: lessonStats.rejected || 0,
      },
    };
  } finally {
    db.close();
  }
}

/**
 * حساب التكاليف الفعلية للصفقة في السوق المصري
 */
export function calculateEgyptianTradeCosts(
  tradeValue: number,
  direction: 'buy' | 'sell'
): {
  commission: number;
  tax: number;
  spread: number;
  total: number;
  total_percent: number;
} {
  // عمولة الشراء: ~0.5%
  // عمولة البيع: ~0.5%
  // ضريبة دمغة على البيع: 0.5%
  // السبريد: ~0.1% تقريباً

  const commission = tradeValue * 0.005;
  const tax = direction === 'sell' ? tradeValue * 0.005 : 0;
  const spread = tradeValue * 0.001;
  const total = commission + tax + spread;

  return {
    commission,
    tax,
    spread,
    total,
    total_percent: (total / tradeValue) * 100,
  };
}

/**
 * التحقق من الحد الأدنى للربح المتوقع
 */
export function isProfitWorthIt(expectedProfitPercent: number): boolean {
  // في مصر، تكلفة الصفقة الكاملة (شراء+بيع) ≈ 1.5%
  // يجب أن يكون الربح المتوقع 4% على الأقل ليستحق
  const minProfitPercent = getWeight('min_profit_threshold', 4);
  return expectedProfitPercent >= minProfitPercent;
}
