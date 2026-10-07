/**
 * Maestro Engine — Honest Tracking
 * =================================
 * Pure-TypeScript implementation of the Maestro orchestrator that powers the
 * "Honest Predictions" admin page. Replaces the previous Python-only
 * `backfill_with_personas.py` (which only worked for EGX because it depended
 * on `egypt_stocks.db`).
 *
 * What this module does
 * ----------------------
 * 1. `ensureSchema(db)` — creates the `predictions`, `stored_analyses` and
 *    `prediction_lessons` tables in `db/predictions.db` if they don't exist.
 * 2. `generateHistoricalPredictions(opts)` — for every ticker in stocks.db
 *    (filtered by market), walks price_history.db and, at each sample date,
 *    runs the full Maestro pipeline:
 *      • Technical analysis  (RSI, MA20, MA50, ATR, Bollinger width)
 *      • Support / Resistance zones (swing-high/low lookup)
 *      • Candlestick pattern detection
 *      • Fundamental snapshot from stocks.db (P/E, ROE, market cap)
 *      • Persona engines (gambler + investor) — confluence scoring
 *    Persists the latest snapshot per ticker into `stored_analyses`, and
 *    inserts one row per (ticker, sample-date) into `predictions` whenever
 *    the derived signal is BUY or SELL.
 * 3. `verifyPendingPredictions(db, limit)` — evaluates every PENDING
 *    prediction against the 30-day price window after entry, using the
 *    same smart-exit algorithm as `verify-pending/route.ts` (stop-loss,
 *    target, profit-taking via RSI/MA20/trailing-stop, time-exit).
 * 4. `extractLessons(db)` — runs the LearningEngine inline: mines closed
 *    predictions for failure patterns (high-RSI entries, tight stops, low
 *    R:R, weak SELL signals) and writes them into `prediction_lessons`.
 * 5. `computeComprehensiveStats(db)` — full breakdown including per-market,
 *    per-month, cumulative-return time-series for the dashboard charts.
 *
 * All DB access uses `better-sqlite3` directly. No Python, no network.
 */

import Database from 'better-sqlite3';
import path from 'path';

import {
  detectStockRegime, classifyVolatility, classifySectorSpeed,
  getDynamicParams as getGeminiDynamicParams,
  detectBBSqueeze, calculateStructuralTargets,
  type StockRegime, type SqueezeLevel
} from '@/lib/dynamic-analysis-engine';

// ============================================================================
// CONSTANTS
// ============================================================================

const CWD = process.cwd();
const PRED_DB_PATH = path.join(CWD, 'db', 'predictions.db');
const STOCKS_DB_PATH = path.join(CWD, 'db', 'stocks.db');
const PRICE_DB_PATH = path.join(CWD, 'db', 'price_history.db');

const SCHEMA_SQL = [
  // predictions: one row per (ticker, sample-date, signal)
  `CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    market TEXT,
    signal TEXT,
    signal_type TEXT NOT NULL,
    prediction_date TEXT NOT NULL,
    entry_price REAL NOT NULL,
    target_price REAL,
    stop_loss REAL,
    master_score REAL,
    technical_score REAL,
    fundamental_score REAL,
    ai_pattern_score REAL,
    sentiment_score REAL,
    risk_reward REAL,
    atr_at_entry REAL,
    highest_price_reached REAL,
    outcome_date TEXT,
    exit_price REAL,
    actual_return REAL,
    exit_reason TEXT,
    hit_target INTEGER DEFAULT 0,
    hit_stop INTEGER DEFAULT 0,
    is_correct INTEGER,
    holding_days INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_predictions_ticker ON predictions(ticker)`,
  `CREATE INDEX IF NOT EXISTS idx_predictions_market ON predictions(market)`,
  `CREATE INDEX IF NOT EXISTS idx_predictions_date ON predictions(prediction_date)`,
  `CREATE INDEX IF NOT EXISTS idx_predictions_outcome ON predictions(outcome_date)`,
  `CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(outcome_date, hit_target, hit_stop)`,

  // stored_analyses: latest Maestro snapshot per ticker (one row per ticker)
  `CREATE TABLE IF NOT EXISTS stored_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT UNIQUE,
    market TEXT DEFAULT 'EGX',
    signal TEXT,
    maestro_score REAL,
    confidence REAL,
    entry_price REAL,
    target_price REAL,
    stop_loss REAL,
    risk_reward REAL,
    technical_score REAL,
    fundamental_score REAL,
    ai_decision TEXT,
    ai_confidence REAL,
    ai_reason TEXT,
    ai_narrative TEXT,
    ai_updated_at TEXT,
    analysis_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  // prediction_lessons: lessons mined by LearningEngine
  `CREATE TABLE IF NOT EXISTS prediction_lessons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT, category TEXT, rule TEXT, evidence TEXT,
    failure_rate REAL, sample_size INTEGER, recommendation TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
];

// Indicator / strategy parameters (sane defaults — match the UI sliders)
export interface MaestroParams {
  atrPeriod: number;        // default 14
  swingLookback: number;    // default 20
  rsiOverbought: number;    // default 75
  rsiOversold: number;      // default 25
  rsiPeriod: number;        // default 14
  minRiskReward: number;    // default 1.5
  exitSignalThreshold: number; // default 60
  trailingStopPct: number;  // default 0.05
  minProfitPct: number;     // default 0.03
  // V2: optional ATR multipliers from Gemini dynamic engine
  atrStopMultiplier?: number;
  atrTargetMultiplier?: number;
}

export const DEFAULT_PARAMS: MaestroParams = {
  atrPeriod: 14,
  swingLookback: 20,
  rsiOverbought: 75,
  rsiOversold: 25,
  rsiPeriod: 14,
  minRiskReward: 1.5,
  exitSignalThreshold: 60,
  trailingStopPct: 0.05,
  minProfitPct: 0.03,
};

/** Stocks.db row shape used by the Maestro engine for fundamental scoring. */
export interface StockRow {
  ticker?: string;
  sector?: string | null;
  pe_ratio?: number | string | null;
  roe?: number | string | null;
  profit_margin?: number | string | null;
  dividend_yield?: number | string | null;
  [key: string]: unknown;
}

/** Generic SQL row — better-sqlite3 returns unknown objects. */
type SqlRow = Record<string, unknown>;

/** Aggregated count row returned by `SELECT COUNT(*) as c ...` queries. */
interface CountRow extends SqlRow {
  c?: number | string | null;
}

/** Aggregated stats row returned by the overall predictions query. */
interface OverallStatsRow extends SqlRow {
  total?: number | string | null;
  closed?: number | string | null;
  active?: number | string | null;
  target_hits?: number | string | null;
  stopped?: number | string | null;
  profit_taken?: number | string | null;
  expired?: number | string | null;
  wins?: number | string | null;
  buys?: number | string | null;
  sells?: number | string | null;
  avg_return?: number | string | null;
  avg_profit?: number | string | null;
  avg_loss?: number | string | null;
  net_pl?: number | string | null;
  avg_rr?: number | string | null;
  avg_holding_days?: number | string | null;
  avg_confidence?: number | string | null;
}

/** Per-market aggregation row used internally by computeComprehensiveStats. */
interface MarketAgg {
  total: number;
  wins: number;
  losses: number;
  closed: number;
  active: number;
  pending: number;
  net_pl: number;
  sr_adoption: number;
  candle_adoption: number;
}

export interface ByMarketRow {
  market: string;
  total: number;
  wins: number;
  losses: number;
  closed: number;
  active: number;
  pending: number;
  win_rate: number;
  net_pl: number;
  avg_return: number | null;
  sr_adoption: number;
  candle_adoption: number;
}

export interface CandlestickPatternStat {
  name: string;
  count: number;
  wins: number;
  losses: number;
  win_rate: number;
}

/** Lesson row — produced by extractLessons and stored in prediction_lessons. */
export interface PredictionLesson {
  type: string;
  category: string;
  rule: string;
  evidence: string;
  failure_rate: number;
  sample_size: number;
  recommendation: string;
  created_at?: string;
}

export function computeDynamicParams(
  baseParams: MaestroParams,
  stock: StockRow | null | undefined,
  ind: Indicators | null,
): MaestroParams {
  const p: MaestroParams = { ...baseParams };
  if (!ind) return p;

  const sector = (stock?.sector || '').toLowerCase();
  const fastSectors = ['technology', 'tech', 'تكنولوجيا', 'pharma', 'أدوية', 'financial', 'مصرفي', 'banking', 'بنوك'];
  const slowSectors = ['utilities', 'مرافق', 'real estate', 'عقارات', 'consumer staples', 'سلع استهلاكية', 'cement', 'أسمنت'];

  // 1) Market regime (stock-level trend)
  if (ind.trend === 'BULLISH') {
    p.rsiOverbought = Math.max(50, p.rsiOverbought - 5);
    p.rsiOversold = Math.max(0, p.rsiOversold - 3);
    p.minRiskReward = Math.max(0.5, p.minRiskReward - 0.2);
  } else if (ind.trend === 'BEARISH') {
    p.rsiOverbought = Math.min(100, p.rsiOverbought + 5);
    p.rsiOversold = Math.min(50, p.rsiOversold + 3);
    p.minRiskReward = Math.min(10, p.minRiskReward + 0.3);
  }

  // 2) Volatility regime
  if (ind.atr && ind.close && ind.close > 0) {
    const atrPct = (ind.atr / ind.close) * 100;
    if (atrPct > 5) {
      p.swingLookback = Math.min(100, p.swingLookback + 5);
      p.atrPeriod = Math.min(100, p.atrPeriod + 2);
      p.rsiPeriod = Math.min(30, p.rsiPeriod + 2);
    } else if (atrPct < 1.5) {
      p.swingLookback = Math.max(5, p.swingLookback - 3);
      p.rsiPeriod = Math.max(5, p.rsiPeriod - 1);
    }
  }

  // 3) Volume regime
  if (ind.volumeTrend === 'spike' || ind.volumeTrend === 'increasing') {
    p.swingLookback = Math.max(5, p.swingLookback - 2);
  }

  // 4) Sector regime
  if (fastSectors.some(s => sector.includes(s))) {
    p.swingLookback = Math.max(5, p.swingLookback - 2);
    p.atrPeriod = Math.max(2, p.atrPeriod - 1);
    p.rsiPeriod = Math.max(5, p.rsiPeriod - 1);
  } else if (slowSectors.some(s => sector.includes(s))) {
    p.swingLookback = Math.min(100, p.swingLookback + 3);
    p.rsiPeriod = Math.min(30, p.rsiPeriod + 1);
  }

  // 5) Profit-taking thresholds
  if (ind.atr && ind.close && ind.close > 0) {
    const atrPct = (ind.atr / ind.close) * 100;
    if (atrPct > 5) {
      p.trailingStopPct = Math.min(0.15, p.trailingStopPct + 0.02);
      p.minProfitPct = Math.min(0.10, p.minProfitPct + 0.02);
    } else if (atrPct < 1.5) {
      p.trailingStopPct = Math.max(0.02, p.trailingStopPct - 0.01);
      p.minProfitPct = Math.max(0.01, p.minProfitPct - 0.01);
    }
  }

  return p;
}

/**
 * computeDynamicParamsV2 — Enhanced version using the Gemini Dynamic Analysis Engine.
 * Calls the existing computeDynamicParams first, then overlays Gemini engine parameters:
 *   • RSI thresholds (overbought/oversold) from Gemini
 *   • ATR multipliers (stop/target) from Gemini
 *   • minRiskReward from Gemini
 * Base atrPeriod / rsiPeriod / swingLookback are kept from the existing function.
 */
export function computeDynamicParamsV2(
  baseParams: MaestroParams,
  stock: StockRow | null | undefined,
  ind: Indicators | null,
): MaestroParams {
  // Step 1: Get the existing dynamic params as the base
  const base = computeDynamicParams(baseParams, stock, ind);
  if (!ind) return base;

  // Step 2: Determine regime / volatility / sector speed for the Gemini engine
  const atrPct = (ind.atr && ind.close && ind.close > 0) ? (ind.atr / ind.close) * 100 : 2;
  const regime = detectStockRegime(
    ind.trend,
    ind.rsi,
    null, // ADX not available in Indicators
    ind.ma20 && ind.close ? ((ind.close - ind.ma20) / ind.ma20) * 100 : null,
    ind.ma50 && ind.close ? ((ind.close - ind.ma50) / ind.ma50) * 100 : null,
  );
  const volatility = classifyVolatility(atrPct);
  const sectorSpeed = classifySectorSpeed(stock?.sector || '');

  // Step 3: Get Gemini engine params
  const gemini = getGeminiDynamicParams(regime, volatility, sectorSpeed);

  // Step 4: Merge — Gemini RSI thresholds, ATR multipliers, minRiskReward override;
  //          keep existing atrPeriod, rsiPeriod, swingLookback
  base.rsiOverbought = gemini.rsiOverbought;
  base.rsiOversold = gemini.rsiOversold;
  base.minRiskReward = gemini.minRiskReward;
  base.atrStopMultiplier = gemini.atrStopMultiplier;
  base.atrTargetMultiplier = gemini.atrTargetMultiplier;

  return base;
}

const MIN_HISTORY_DAYS = 35;        // need >= 35 days to compute RSI14 + ATR14 + MA20 + S/R
const TARGET_MULT = 2.0;            // target = entry ± TARGET_MULT * ATR
const STOP_MULT = 1.5;              // stop   = entry ∓ STOP_MULT * ATR
const EVAL_WINDOW_DAYS = 30;        // verify window
const RECENT_FALLBACK_DAYS = 7;     // use current_price for predictions < 7 days old
const SPLIT_RATIO = 5;              // >5x price jump = stock split (skip)

// ============================================================================
// DB OPENING
// ============================================================================

export function openPredictionsDb(writable = true): Database.Database {
  try {
    return new Database(PRED_DB_PATH, {
      readonly: !writable,
      timeout: 5000,
      fileMustExist: false,
    });
  } catch {
    return new Database(`file:${PRED_DB_PATH}?immutable=1`, {
      readonly: true,
      timeout: 5000,
    });
  }
}

function openReadonly(p: string): Database.Database | null {
  try {
    return new Database(p, { readonly: true, timeout: 5000, fileMustExist: true });
  } catch {
    return null;
  }
}

export function ensureSchema(db: Database.Database): void {
  // Create every table first. SQLite leaves existing tables untouched.
  const tableSql = SCHEMA_SQL.filter(s => s.startsWith('CREATE TABLE'));
  for (const sql of tableSql) {
    db.exec(sql);
  }

  const ensureColumns = (table: string, migrations: Array<[string, string]>) => {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (rows.length === 0) throw new Error(`Schema setup failed: ${table} was not created`);
    const names = new Set(rows.map(row => row.name));
    for (const [column, sql] of migrations) {
      if (!names.has(column)) {
        try {
          db.exec(sql);
          names.add(column);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!/duplicate column name/i.test(message)) {
            throw new Error(`Schema migration failed for ${table}.${column}: ${message}`);
          }
        }
      }
    }
  };

  // Support both fresh installations and every legacy schema previously
  // shipped to production. These are the fields used by insert/verify/stats.
  ensureColumns('predictions', [
    ['market', "ALTER TABLE predictions ADD COLUMN market TEXT DEFAULT 'EGX'"],
    ['signal', "ALTER TABLE predictions ADD COLUMN signal TEXT DEFAULT 'HOLD'"],
    ['signal_type', "ALTER TABLE predictions ADD COLUMN signal_type TEXT DEFAULT 'HOLD'"],
    ['prediction_date', 'ALTER TABLE predictions ADD COLUMN prediction_date TEXT'],
    ['entry_price', 'ALTER TABLE predictions ADD COLUMN entry_price REAL'],
    ['target_price', 'ALTER TABLE predictions ADD COLUMN target_price REAL'],
    ['stop_loss', 'ALTER TABLE predictions ADD COLUMN stop_loss REAL'],
    ['master_score', 'ALTER TABLE predictions ADD COLUMN master_score REAL'],
    ['technical_score', 'ALTER TABLE predictions ADD COLUMN technical_score REAL'],
    ['fundamental_score', 'ALTER TABLE predictions ADD COLUMN fundamental_score REAL'],
    ['ai_pattern_score', 'ALTER TABLE predictions ADD COLUMN ai_pattern_score REAL'],
    ['sentiment_score', 'ALTER TABLE predictions ADD COLUMN sentiment_score REAL'],
    ['outcome_date', 'ALTER TABLE predictions ADD COLUMN outcome_date TEXT'],
    ['exit_price', 'ALTER TABLE predictions ADD COLUMN exit_price REAL'],
    ['actual_return', 'ALTER TABLE predictions ADD COLUMN actual_return REAL'],
    ['hit_target', 'ALTER TABLE predictions ADD COLUMN hit_target INTEGER DEFAULT 0'],
    ['hit_stop', 'ALTER TABLE predictions ADD COLUMN hit_stop INTEGER DEFAULT 0'],
    ['is_correct', 'ALTER TABLE predictions ADD COLUMN is_correct INTEGER'],
    ['holding_days', 'ALTER TABLE predictions ADD COLUMN holding_days INTEGER'],
    ['notes', 'ALTER TABLE predictions ADD COLUMN notes TEXT'],
    ['exit_reason', 'ALTER TABLE predictions ADD COLUMN exit_reason TEXT'],
    ['risk_reward', 'ALTER TABLE predictions ADD COLUMN risk_reward REAL'],
    ['atr_at_entry', 'ALTER TABLE predictions ADD COLUMN atr_at_entry REAL'],
    ['highest_price_reached', 'ALTER TABLE predictions ADD COLUMN highest_price_reached REAL'],
    ['lowest_price_reached', 'ALTER TABLE predictions ADD COLUMN lowest_price_reached REAL'],
    ['is_trend_following', 'ALTER TABLE predictions ADD COLUMN is_trend_following INTEGER DEFAULT 0'],
    ['trailing_stop_atr_mult', 'ALTER TABLE predictions ADD COLUMN trailing_stop_atr_mult REAL'],
    ['initial_stop_atr_mult', 'ALTER TABLE predictions ADD COLUMN initial_stop_atr_mult REAL'],
    ['confidence', 'ALTER TABLE predictions ADD COLUMN confidence REAL'],
    // HONEST-TRACKING-FIX: الأعمدة اللي كانت ناقصة وبتسبب خطأ "no such column"
    ['exit_type', 'ALTER TABLE predictions ADD COLUMN exit_type TEXT'],
    ['persona', 'ALTER TABLE predictions ADD COLUMN persona TEXT'],
    ['target_price_2', 'ALTER TABLE predictions ADD COLUMN target_price_2 REAL'],
    // SCHEMA-MISMATCH-FIX (أغسطس 2026): الـ trading pipeline (daily_closer.py +
    // prediction_tracker.py) بـ يكتب status='CLOSED' + exit_type + pnl_pct لكن
    // مش بـ يكتب outcome_date/actual_return/is_correct. بدون الأعمدة دي، الـ
    // honest-tracking APIs بـ تحسب التوقعات المقفولة دي كـ PENDING → الـ dashboard
    // بـ يعرض 0% win rate و 2 صفقة مقفولة بس (بدل 97). بنضيف status + pnl_pct +
    // closed_at لـ ensureSchema علشان أي DB (حتى الفريش) يبقى عندهم.
    ['status', 'ALTER TABLE predictions ADD COLUMN status TEXT'],
    ['pnl_pct', 'ALTER TABLE predictions ADD COLUMN pnl_pct REAL'],
    ['closed_at', 'ALTER TABLE predictions ADD COLUMN closed_at TEXT'],
    // FIX-P2-PREDICTIONS (AUDIT-1-PREDICTIONS): audit trail columns so the
    // system can prove a recommendation was actually published to Telegram
    // BEFORE the price moved. Stats + missed-opportunities endpoints filter
    // on `was_published = 1` so test/backfill rows don't inflate the win
    // rate. `target_hit_at` + `stop_hit_at` are kept separate from
    // `outcome_date` so the temporal ordering between target/stop hits can
    // be reconstructed. See prisma/predictions-schema.prisma for full notes.
    ['published_at', 'ALTER TABLE predictions ADD COLUMN published_at TEXT'],
    ['telegram_message_id', 'ALTER TABLE predictions ADD COLUMN telegram_message_id TEXT'],
    ['was_published', 'ALTER TABLE predictions ADD COLUMN was_published INTEGER DEFAULT 0'],
    ['target_hit_at', 'ALTER TABLE predictions ADD COLUMN target_hit_at TEXT'],
    ['stop_hit_at', 'ALTER TABLE predictions ADD COLUMN stop_hit_at TEXT'],
  ]);

  ensureColumns('stored_analyses', [
    ['market', "ALTER TABLE stored_analyses ADD COLUMN market TEXT DEFAULT 'EGX'"],
    ['signal', "ALTER TABLE stored_analyses ADD COLUMN signal TEXT DEFAULT 'HOLD'"],
    ['maestro_score', 'ALTER TABLE stored_analyses ADD COLUMN maestro_score REAL DEFAULT 0'],
    ['confidence', 'ALTER TABLE stored_analyses ADD COLUMN confidence REAL DEFAULT 0'],
    ['entry_price', 'ALTER TABLE stored_analyses ADD COLUMN entry_price REAL'],
    ['target_price', 'ALTER TABLE stored_analyses ADD COLUMN target_price REAL'],
    ['stop_loss', 'ALTER TABLE stored_analyses ADD COLUMN stop_loss REAL'],
    ['risk_reward', 'ALTER TABLE stored_analyses ADD COLUMN risk_reward REAL'],
    ['technical_score', 'ALTER TABLE stored_analyses ADD COLUMN technical_score REAL'],
    ['fundamental_score', 'ALTER TABLE stored_analyses ADD COLUMN fundamental_score REAL'],
    ['ai_decision', 'ALTER TABLE stored_analyses ADD COLUMN ai_decision TEXT'],
    ['ai_reason', 'ALTER TABLE stored_analyses ADD COLUMN ai_reason TEXT'],
    ['ai_narrative', 'ALTER TABLE stored_analyses ADD COLUMN ai_narrative TEXT'],
    ['ai_updated_at', 'ALTER TABLE stored_analyses ADD COLUMN ai_updated_at TEXT'],
    ['analysis_json', 'ALTER TABLE stored_analyses ADD COLUMN analysis_json TEXT'],
    ['updated_at', 'ALTER TABLE stored_analyses ADD COLUMN updated_at TEXT'],
  ]);

  const indexSql = SCHEMA_SQL.filter(s => s.startsWith('CREATE INDEX'));
  for (const sql of indexSql) {
    db.exec(sql);
  }
}

// ============================================================================
// INDICATOR MATH
// ============================================================================

interface PriceRow {
  date: string;
  open_price: number | null;
  high_price: number | null;
  low_price: number | null;
  close_price: number | null;
  volume: number | null;
}

export interface Indicators {
  rsi: number | null;
  ma20: number | null;
  ma50: number | null;
  atr: number | null;
  support: number | null;
  resistance: number | null;
  bollingerWidth: number | null;
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  candlePattern: string | null;
  volumeTrend: 'increasing' | 'decreasing' | 'spike' | 'flat' | null;
  close: number;
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) sum += values[i];
  return sum / period;
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Math.round((100 - (100 / (1 + rs))) * 100) / 100;
}

function atr(rows: PriceRow[], period = 14): number | null {
  if (rows.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = rows.length - period; i < rows.length; i++) {
    const r = rows[i];
    const prev = rows[i - 1];
    const high = Number(r.high_price || 0);
    const low = Number(r.low_price || 0);
    const prevClose = Number(prev.close_price || 0);
    if (high <= 0 || low <= 0 || prevClose <= 0) continue;
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose),
    );
    trs.push(tr);
  }
  if (trs.length === 0) return null;
  return Math.round((trs.reduce((a, b) => a + b, 0) / trs.length) * 10000) / 10000;
}

function bollingerWidth(closes: number[], period = 20): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return Math.round(((4 * sd) / mean) * 10000) / 10000; // width as fraction of mean
}

function detectCandlestick(rows: PriceRow[]): string | null {
  if (rows.length < 1) return null;
  const r = rows[rows.length - 1];
  const o = Number(r.open_price || 0);
  const c = Number(r.close_price || 0);
  const h = Number(r.high_price || 0);
  const l = Number(r.low_price || 0);
  if (o <= 0 || c <= 0 || h <= 0 || l <= 0) return null;
  const body = Math.abs(c - o);
  const range = h - l;
  if (range <= 0) return null;
  const upperWick = h - Math.max(o, c);
  const lowerWick = Math.min(o, c) - l;
  const bodyPct = body / range;

  // Doji: very small body
  if (bodyPct < 0.1) return 'DOJI';
  // Hammer / Hanging Man: small body, long lower wick
  if (lowerWick > 2 * body && upperWick < 0.3 * body) {
    return c > o ? 'HAMMER' : 'HANGING_MAN';
  }
  // Shooting star / Inverted hammer: small body, long upper wick
  if (upperWick > 2 * body && lowerWick < 0.3 * body) {
    return c < o ? 'SHOOTING_STAR' : 'INVERTED_HAMMER';
  }

  // Need previous row for engulfing / star patterns
  if (rows.length < 2) return null;
  const p = rows[rows.length - 2];
  const po = Number(p.open_price || 0);
  const pc = Number(p.close_price || 0);
  if (po <= 0 || pc <= 0) return null;
  const pBull = pc > po;
  const cBull = c > o;
  // Bullish Engulfing: prev bearish, curr bullish, curr body engulfs prev body
  if (!pBull && cBull && c >= po && o <= pc) return 'BULLISH_ENGULFING';
  // Bearish Engulfing
  if (pBull && !cBull && o >= pc && c <= po) return 'BEARISH_ENGULFING';

  // Morning / Evening Star (need 3 rows)
  if (rows.length >= 3) {
    const p2 = rows[rows.length - 3];
    const p2o = Number(p2.open_price || 0);
    const p2c = Number(p2.close_price || 0);
    if (p2o > 0 && p2c > 0) {
      const p2Bull = p2c > p2o;
      // Morning Star: big bearish, small body, big bullish
      if (!p2Bull && Math.abs(pc - po) < Math.abs(p2c - p2o) * 0.5 && cBull && c > (p2o + p2c) / 2) {
        return 'MORNING_STAR';
      }
      // Evening Star: big bullish, small body, big bearish
      if (p2Bull && Math.abs(pc - po) < Math.abs(p2c - p2o) * 0.5 && !cBull && c < (p2o + p2c) / 2) {
        return 'EVENING_STAR';
      }
    }
  }

  return null;
}

function detectVolumeTrend(rows: PriceRow[]): 'increasing' | 'decreasing' | 'spike' | 'flat' | null {
  if (rows.length < 10) return null;
  const recent = rows.slice(-10).map(r => Number(r.volume || 0));
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  if (recentAvg <= 0) return null;
  const last = recent[recent.length - 1];
  if (last > recentAvg * 2.5) return 'spike';
  const first5 = recent.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const last5 = recent.slice(5).reduce((a, b) => a + b, 0) / 5;
  if (last5 > first5 * 1.3) return 'increasing';
  if (last5 < first5 * 0.7) return 'decreasing';
  return 'flat';
}

/** Compute the full indicator set as of the LAST row in `rows`. */
export function computeIndicators(
  rows: PriceRow[],
  params: MaestroParams,
): Indicators | null {
  if (rows.length < MIN_HISTORY_DAYS) return null;
  const closes = rows.map(r => Number(r.close_price || 0)).filter(v => v > 0);
  if (closes.length < MIN_HISTORY_DAYS) return null;
  const last = rows[rows.length - 1];
  const close = Number(last.close_price || 0);
  if (close <= 0) return null;

  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const rsiVal = rsi(closes, params.rsiPeriod);
  const atrVal = atr(rows, params.atrPeriod);
  const bbWidth = bollingerWidth(closes, 20);

  // Support / Resistance from last `swingLookback` rows
  const lookback = Math.min(rows.length, params.swingLookback);
  const recent = rows.slice(-lookback);
  let sup = Infinity, res = 0;
  for (const r of recent) {
    const l = Number(r.low_price || 0);
    const h = Number(r.high_price || 0);
    if (l > 0 && l < sup) sup = l;
    if (h > 0 && h > res) res = h;
  }
  if (!isFinite(sup)) sup = 0;
  if (res <= 0) res = close * 1.05;

  // Trend (uses MA20 alone when MA50 unavailable, so we can still get a
  // directional bias with only 35 days of history)
  let trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL';
  if (ma20 !== null) {
    if (close > ma20 * 1.005) {
      // Above MA20 — bullish unless we have MA50 and price is below it
      if (ma50 !== null && close < ma50) trend = 'NEUTRAL';
      else trend = 'BULLISH';
    } else if (close < ma20 * 0.995) {
      if (ma50 !== null && close > ma50) trend = 'NEUTRAL';
      else trend = 'BEARISH';
    }
    if (ma50 !== null) {
      if (trend === 'BULLISH' && ma20 > ma50) trend = 'BULLISH';
      else if (trend === 'BEARISH' && ma20 < ma50) trend = 'BEARISH';
    }
  }

  const candlePattern = detectCandlestick(rows);
  const volumeTrend = detectVolumeTrend(rows);

  return {
    rsi: rsiVal,
    ma20, ma50,
    atr: atrVal,
    support: Math.round(sup * 100) / 100,
    resistance: Math.round(res * 100) / 100,
    bollingerWidth: bbWidth,
    trend,
    candlePattern,
    volumeTrend,
    close,
  };
}

// ============================================================================
// SIGNAL DERIVATION (Maestro confluence)
// ============================================================================

export interface SignalDecision {
  signal: 'BUY' | 'SELL' | 'HOLD';
  technicalScore: number;   // 0..100
  fundamentalScore: number; // 0..100
  masterScore: number;      // 0..100
  confidence: number;       // 0..100
  reasons: string[];
  persona: 'gambler' | 'investor' | 'balanced';
}

/** Fundamental score from stocks.db row (P/E, ROE, etc.). */
function fundamentalScoreFromStock(s: StockRow | null | undefined): number {
  if (!s) return 50;
  let score = 50;
  // P/E: 5..20 is healthy
  const pe = Number(s.pe_ratio || 0);
  if (pe > 0) {
    if (pe < 5) score += 5;        // very cheap
    else if (pe <= 15) score += 12;
    else if (pe <= 25) score += 6;
    else if (pe > 50) score -= 8;  // very expensive
  }
  // ROE: higher is better
  const roe = Number(s.roe || 0);
  if (roe > 0) {
    if (roe >= 20) score += 12;
    else if (roe >= 15) score += 8;
    else if (roe >= 10) score += 4;
  }
  // Profit margin
  const pm = Number(s.profit_margin || 0);
  if (pm > 0) {
    if (pm >= 20) score += 8;
    else if (pm >= 10) score += 4;
  }
  // Dividend yield
  const dy = Number(s.dividend_yield || 0);
  if (dy > 0) score += Math.min(6, dy * 2);
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function deriveSignal(
  ind: Indicators,
  stock: StockRow | null | undefined,
  params: MaestroParams,
): SignalDecision {
  // ════════════════════════════════════════════════════════════════════════
  // AXIS-2 (MASTER DIRECTIVE): تم حذف منطق توليد التوقعات من TypeScript.
  // العقل في البايثون فقط (Rule: Python = THE BRAIN, TS = display-only).
  // توليد التوقعات الفعلي يتم في:
  //   - vps-service/analyzers/maestro_orchestrator.py
  //   - vps-service/analyzers/institutional_decision_engine.py
  //   - vps-service/jobs/daily_predictor.py
  // هذه الدالة теперь stub تعيد HOLD — لأغراض التوافق الخلفي فقط.
  // لا تستدعِها في كود جديد — استدعِ Python backend بدلاً من ذلك.
  // ════════════════════════════════════════════════════════════════════════
  void ind; void stock; void params; // suppress unused-var warnings
  return {
    signal: 'HOLD',
    technicalScore: 50,
    fundamentalScore: 50,
    masterScore: 50,
    confidence: 0,
    reasons: ['[AXIS-2] تم نقل توليد التوقعات إلى البايثون — استدعِ Python backend'],
    persona: 'balanced',
  };
}

// ============================================================================
// NOTES BUILDER (parsable by the list route's parseNotes)
// ============================================================================

function buildNotes(
  ind: Indicators,
  dec: SignalDecision,
  stock: StockRow | null | undefined,
  dynNotes?: { regime?: string; squeeze?: string; targetSrc?: string; stopSrc?: string },
): string {
  const parts: string[] = [];
  parts.push(`persona=${dec.persona}`);
  if (ind.rsi !== null) parts.push(`RSI=${ind.rsi.toFixed(1)}`);
  if (ind.ma20 !== null) parts.push(`MA20=${ind.ma20.toFixed(2)}`);
  if (ind.ma50 !== null) parts.push(`MA50=${ind.ma50.toFixed(2)}`);
  if (ind.atr !== null) parts.push(`ATR=${ind.atr.toFixed(3)}`);
  if (ind.support) parts.push(`support=${ind.support}`);
  if (ind.resistance) parts.push(`resistance=${ind.resistance}`);
  if (ind.trend) parts.push(`trend=${ind.trend}`);
  if (ind.candlePattern) parts.push(`candle=${ind.candlePattern}`);
  if (ind.volumeTrend) parts.push(`vol=${ind.volumeTrend}`);
  if (ind.bollingerWidth !== null) parts.push(`BBw=${ind.bollingerWidth.toFixed(3)}`);
  if (stock) {
    if (stock.pe_ratio) parts.push(`PE=${stock.pe_ratio}`);
    if (stock.roe) parts.push(`ROE=${stock.roe}`);
    if (stock.dividend_yield) parts.push(`DY=${stock.dividend_yield}`);
    if (stock.profit_margin) parts.push(`PM=${stock.profit_margin}`);
    if (stock.sector) parts.push(`sector=${stock.sector}`);
  }
  if (dec.reasons.length > 0) parts.push(`reasons=${dec.reasons.slice(0, 3).join('|')}`);
  // V2: Dynamic analysis engine metadata
  if (dynNotes) {
    if (dynNotes.regime) parts.push(`dyn_regime=${dynNotes.regime}`);
    if (dynNotes.squeeze) parts.push(`dyn_squeeze=${dynNotes.squeeze}`);
    if (dynNotes.targetSrc) parts.push(`dyn_target_src=${dynNotes.targetSrc}`);
    if (dynNotes.stopSrc) parts.push(`dyn_stop_src=${dynNotes.stopSrc}`);
  }
  return parts.join('; ');
}

function buildAnalysisJson(
  ind: Indicators,
  dec: SignalDecision,
  stock: StockRow | null | undefined,
  entry: number, target: number, stop: number,
): string {
  return JSON.stringify({
    indicators: {
      rsi: ind.rsi, ma20: ind.ma20, ma50: ind.ma50, atr: ind.atr,
      support: ind.support, resistance: ind.resistance,
      bollingerWidth: ind.bollingerWidth, trend: ind.trend,
      candlePattern: ind.candlePattern, volumeTrend: ind.volumeTrend,
    },
    scores: {
      technical: dec.technicalScore,
      fundamental: dec.fundamentalScore,
      master: dec.masterScore,
      confidence: dec.confidence,
    },
    signal: dec.signal,
    persona: dec.persona,
    reasons: dec.reasons,
    fundamentals: stock ? {
      pe: stock.pe_ratio || null,
      roe: stock.roe || null,
      dividend_yield: stock.dividend_yield || null,
      profit_margin: stock.profit_margin || null,
      sector: stock.sector || null,
      market_cap: stock.market_cap || null,
    } : null,
    trade: { entry, target, stop },
  });
}

// ============================================================================
// LOCAL AI (Ollama) ENRICHMENT
// ============================================================================

interface AiEnrichmentInput {
  ticker: string;
  market: string;
  ind: Indicators;
  dec: SignalDecision;
  stockTicker: string;
  stockName: string;
  stockSector: string;
  entry: number;
  target: number;
  stop: number;
  rr: number | null;
}

interface AiEnrichmentResult {
  aiDecision: string;
  aiReason: string;
  aiNarrative: string;
}

async function callLocalAiForStock(input: AiEnrichmentInput): Promise<AiEnrichmentResult | null> {
  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434';
  const model = process.env.LOCAL_AI_MODEL || 'glm-fast';

  const prompt = `أنت محلل مالي محترف في البورصة المصرية. بناءً على البيانات التالية، أعطني JSON فقط.
{"decision":"buy/sell/hold","reason":"سبب قصير","narrative":"نص 1-2 سطور"}

البيانات:
السهم: ${input.stockTicker}
الاسم: ${input.stockName}
القطاع: ${input.stockSector || 'غير محدد'}
الإشارة: ${input.dec.signal} (فني=${input.dec.technicalScore}، أساسي=${input.dec.fundamentalScore}، نهائي=${input.dec.masterScore}، ثقة=${input.dec.confidence}%)
RSI: ${input.ind.rsi ?? 'N/A'}
الاتجاه: ${input.ind.trend}
الشمعة: ${input.ind.candlePattern || 'لا يوجد'}
الحجم: ${input.ind.volumeTrend || 'غير معروف'}
الدعم: ${input.ind.support ?? 'N/A'}
المقاومة: ${input.ind.resistance ?? 'N/A'}
ATR: ${input.ind.atr ?? 'N/A'}
دخول=${input.entry} هدف=${input.target}وقف=${input.stop} RR=${input.rr ?? 'N/A'}
الأسباب: ${input.dec.reasons.slice(0, 2).join(' | ') || 'لا يوجد'}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { num_predict: 200, temperature: 0.3 }
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) return null;
    const data = await resp.json();
    const text = data.response?.trim() || '';

    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.decision && parsed.reason !== undefined && parsed.narrative !== undefined) {
          return {
            aiDecision: String(parsed.decision).toUpperCase(),
            aiReason: String(parsed.reason),
            aiNarrative: String(parsed.narrative),
          };
        }
      } catch {
        // fallback below
      }
    }

    const decision = text.includes('بيع') ? 'SELL' : text.includes('شراء') ? 'BUY' : 'HOLD';
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    return {
      aiDecision: decision,
      aiReason: lines[0]?.slice(0, 200) || '',
      aiNarrative: lines.slice(0, 3).join(' ').slice(0, 500) || text.slice(0, 200),
    };
  } catch {
    return null;
  }
}

// ============================================================================
// MAIN GENERATION
// ============================================================================

export interface GenerateOptions {
  startDate: string;          // YYYY-MM-DD
  endDate: string;            // YYYY-MM-DD
  tickersPerMarket: number;   // max tickers per market (5..50)
  sampleEveryDays: number;    // 1..30
  clearExisting: boolean;
  markets: string[];          // ['EGX','TADAWUL','KSE','QSE']
  params: MaestroParams;
}

export interface GenerateResult {
  generated: number;
  by_market: Record<string, number>;
  by_signal: { BUY: number; SELL: number; HOLD: number };
  stored_analyses: number;
  tickers_scanned: number;
  tickers_skipped: number;
  date_range: { start: string; end: string };
  errors: string[];
}

/**
 * Run the full Maestro pipeline and populate predictions.db.
 */
export async function generateHistoricalPredictions(opts: GenerateOptions): Promise<GenerateResult> {
  // ════════════════════════════════════════════════════════════════════════
  // AXIS-2 (MASTER DIRECTIVE): تم حذف توليد التوقعات التاريخية من TypeScript.
  // العقل في البايثون فقط. هذه الدالة الآن stub تعيد نتيجة فارغة + رسالة
  // توجّه المستخدم لتشغيل الـ Python backend (المنتج الفعلي).
  //
  // لتوليد التوقعات الفعلي على الإنتاج:
  //   1. تأكد إن python-backend شغال (pm2 restart python-backend)
  //   2. شغّل: python vps-service/jobs/daily_predictor.py
  //   3. أو: POST http://localhost:8010/api/maestro/run
  //
  // الـ verifyPendingPredictions + runLearningEngine + computeComprehensiveStats
  // (الدوال الـ read-only) لسه تعمل من TS لأنها بقرأ من DB فقط (display).
  // ════════════════════════════════════════════════════════════════════════
  void opts;
  const result: GenerateResult = {
    generated: 0,
    by_market: {},
    by_signal: { BUY: 0, SELL: 0, HOLD: 0 },
    stored_analyses: 0,
    tickers_scanned: 0,
    tickers_skipped: 0,
    date_range: { start: opts.startDate, end: opts.endDate },
    errors: [
      '[AXIS-2] تم نقل توليد التوقعات إلى البايثون (Python = THE BRAIN). ' +
      'شغّل: python vps-service/jobs/daily_predictor.py ' +
      'أو POST http://localhost:8010/api/maestro/run على الإنتاج.',
    ],
  };
  return result;
}

// ============================================================================
// VERIFY (inlined from verify-pending/route.ts)
// ============================================================================

interface VerifyResults {
  checked: number;
  target_hits: number;
  stopped: number;
  expired: number;
  still_pending: number;
  errors: number;
  profit_taken: number;
}

interface VerifyPrediction {
  id: number;
  ticker: string;
  signal_type: string;
  signal: string;
  prediction_date: string;
  entry_price: number;
  target_price: number | null;
  stop_loss: number | null;
}

function parseDate(s: string): Date {
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d.getTime()) ? new Date(s) : d;
}

function addDays(d: Date, days: number): string {
  const r = new Date(d.getTime() + days * 86_400_000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${r.getFullYear()}-${pad(r.getMonth() + 1)}-${pad(r.getDate())}`;
}

interface ExitDecision {
  outcome: 'TARGET_HIT' | 'STOPPED' | 'PROFIT_TAKEN' | 'EXPIRED' | 'SPLIT_DETECTED';
  exitDate: string;
  exitPrice: number;
  holdingDays: number;
  highestPrice: number;
  exitReason: string;
}

function evaluateExit(
  rows: PriceRow[],
  entry: number,
  target: number,
  stop: number,
  isBuy: boolean,
  predDateStr: string,
): ExitDecision {
  // Split detection
  for (const r of rows) {
    const high = Number(r.high_price || 0);
    const low = Number(r.low_price || 0);
    const close = Number(r.close_price || 0);
    if (high <= 0 || low <= 0 || close <= 0) continue;
    if (high > entry * SPLIT_RATIO || low < entry / SPLIT_RATIO ||
        close > entry * SPLIT_RATIO || close < entry / SPLIT_RATIO) {
      return {
        outcome: 'SPLIT_DETECTED', exitDate: r.date, exitPrice: entry,
        holdingDays: 0, highestPrice: entry,
        exitReason: `split_detected_entry=${entry}_window_high=${high}_low=${low}`,
      };
    }
  }

  const closes: number[] = [];
  let peakPrice = entry;
  const TRAILING_STOP_PCT = 0.05;
  const MIN_PROFIT_PCT = 0.03;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const high = Number(r.high_price || 0);
    const low = Number(r.low_price || 0);
    const close = Number(r.close_price || 0);
    if (high <= 0 || low <= 0 || close <= 0) continue;

    closes.push(close);
    const holdingDays = Math.max(0, Math.floor(
      (parseDate(r.date).getTime() - parseDate(predDateStr).getTime()) / 86_400_000
    ));

    if (isBuy) {
      if (high > peakPrice) peakPrice = high;
    } else {
      if (low < peakPrice) peakPrice = low;
    }

    // 1. Stop loss
    if (isBuy && low <= stop) {
      return { outcome: 'STOPPED', exitDate: r.date, exitPrice: stop, holdingDays, highestPrice: peakPrice, exitReason: 'stop_loss_hit' };
    }
    if (!isBuy && high >= stop) {
      return { outcome: 'STOPPED', exitDate: r.date, exitPrice: stop, holdingDays, highestPrice: peakPrice, exitReason: 'stop_loss_hit' };
    }

    // 2. Target
    if (isBuy && high >= target) {
      return { outcome: 'TARGET_HIT', exitDate: r.date, exitPrice: target, holdingDays, highestPrice: peakPrice, exitReason: 'target_hit' };
    }
    if (!isBuy && low <= target) {
      return { outcome: 'TARGET_HIT', exitDate: r.date, exitPrice: target, holdingDays, highestPrice: peakPrice, exitReason: 'target_hit' };
    }

    // 3. Profit-taking signals
    const currentReturn = isBuy
      ? ((close - entry) / entry) * 100
      : ((entry - close) / entry) * 100;

    if (currentReturn >= MIN_PROFIT_PCT) {
      // 3a. RSI extreme
      const rsiVal = rsi(closes, 14);
      if (isBuy && rsiVal !== null && rsiVal >= 75) {
        return { outcome: 'PROFIT_TAKEN', exitDate: r.date, exitPrice: close, holdingDays, highestPrice: peakPrice, exitReason: `rsi_overbought_${rsiVal}` };
      }
      if (!isBuy && rsiVal !== null && rsiVal <= 25) {
        return { outcome: 'PROFIT_TAKEN', exitDate: r.date, exitPrice: close, holdingDays, highestPrice: peakPrice, exitReason: `rsi_oversold_${rsiVal}` };
      }

      // 3b. MA20 reversal
      const ma20 = sma(closes, 20);
      if (ma20 !== null) {
        if (isBuy && close < ma20) {
          return { outcome: 'PROFIT_TAKEN', exitDate: r.date, exitPrice: close, holdingDays, highestPrice: peakPrice, exitReason: `ma20_reversal_close_below_${ma20.toFixed(2)}` };
        }
        if (!isBuy && close > ma20) {
          return { outcome: 'PROFIT_TAKEN', exitDate: r.date, exitPrice: close, holdingDays, highestPrice: peakPrice, exitReason: `ma20_reversal_close_above_${ma20.toFixed(2)}` };
        }
      }

      // 3c. Trailing stop
      const dropFromPeak = isBuy
        ? ((peakPrice - close) / peakPrice) * 100
        : ((close - peakPrice) / peakPrice) * 100;
      if (dropFromPeak >= TRAILING_STOP_PCT * 100) {
        return { outcome: 'PROFIT_TAKEN', exitDate: r.date, exitPrice: close, holdingDays, highestPrice: peakPrice, exitReason: `trailing_stop_${Math.round(dropFromPeak)}pct_from_peak` };
      }
    }
  }

  // 4. Time exit
  const lastRow = rows[rows.length - 1];
  const lastClose = Number(lastRow.close_price || entry);
  return {
    outcome: 'EXPIRED', exitDate: lastRow.date, exitPrice: lastClose,
    holdingDays: EVAL_WINDOW_DAYS, highestPrice: peakPrice, exitReason: 'time_exit_30d',
  };
}

export interface VerifyResult {
  results: VerifyResults;
  closed_count: number;
  price_sources: Record<string, number>;
}

export function verifyPendingPredictions(limit: number): VerifyResult {
  const pdb = openPredictionsDb(true);
  ensureSchema(pdb);
  const priceDb = openReadonly(PRICE_DB_PATH);
  const stocksDb = openReadonly(STOCKS_DB_PATH);

  const results: VerifyResults = {
    checked: 0, target_hits: 0, stopped: 0, expired: 0,
    still_pending: 0, errors: 0, profit_taken: 0,
  };
  const priceSources: Record<string, number> = {
    price_history_egksco: 0,
    price_history_migration: 0,
    stocks_current: 0,
    unresolved: 0,
  };

  try {
    const preds = pdb.prepare(`
      SELECT id, ticker, signal_type, signal, prediction_date,
             entry_price, target_price, stop_loss
      FROM predictions
      WHERE outcome_date IS NULL
      ORDER BY prediction_date ASC
      LIMIT ?
    `).bind(limit).all() as VerifyPrediction[];

    // Pre-fetch current_price map
    const currentPriceMap = new Map<string, { price: number; asOf: string }>();
    if (stocksDb) {
      try {
        const rows = stocksDb.prepare(
          `SELECT ticker, current_price, last_update FROM stocks WHERE current_price > 0`
        ).all() as Array<{ ticker: string; current_price: number; last_update: string }>;
        for (const r of rows) {
          currentPriceMap.set(r.ticker, {
            price: Number(r.current_price),
            asOf: r.last_update || new Date().toISOString(),
          });
        }
      } catch { /* ignore */ }
    }

    const updateStmt = pdb.prepare(`
      UPDATE predictions
      SET outcome_date = ?, exit_price = ?, actual_return = ?,
          hit_target = ?, hit_stop = ?, is_correct = ?,
          holding_days = ?, highest_price_reached = ?, exit_reason = ?
      WHERE id = ?
    `);

    const tx = pdb.transaction(() => {
      for (const p of preds) {
        results.checked++;
        try {
          if (!p.target_price || !p.stop_loss || !p.entry_price || p.entry_price <= 0) {
            results.errors++;
            continue;
          }

          const predDate = parseDate(p.prediction_date);
          const predDateStr = p.prediction_date.slice(0, 10);
          const windowEnd = addDays(predDate, EVAL_WINDOW_DAYS);
          const isRecent = (Date.now() - predDate.getTime()) < RECENT_FALLBACK_DAYS * 86_400_000;

          const target = Number(p.target_price);
          const stop = Number(p.stop_loss);
          const entry = Number(p.entry_price);
          const isBuy = (p.signal_type || p.signal || '').toUpperCase() === 'BUY';
          const isSell = (p.signal_type || p.signal || '').toUpperCase() === 'SELL';

          if (!isBuy && !isSell) {
            results.still_pending++;
            continue;
          }

          let resolved = false;

          // 1. Try price_history (egksco source first — cleanest)
          if (priceDb) {
            let effectiveRows: PriceRow[] = [];
            try {
              effectiveRows = priceDb.prepare(`
                SELECT date, high_price, low_price, close_price
                FROM price_history
                WHERE ticker = ? AND date > ? AND date <= ? AND source = 'egksco'
                ORDER BY date ASC
              `).bind(p.ticker, predDateStr, windowEnd).all() as PriceRow[];
              if (effectiveRows.length > 0) priceSources.price_history_egksco++;
            } catch { /* ignore */ }

            // Fallback 1: egx_investment_migration (more data, may have splits)
            if (effectiveRows.length === 0) {
              try {
                effectiveRows = priceDb.prepare(`
                  SELECT date, high_price, low_price, close_price
                  FROM price_history
                  WHERE ticker = ? AND date > ? AND date <= ? AND source = 'egx_investment_migration'
                  ORDER BY date ASC
                `).bind(p.ticker, predDateStr, windowEnd).all() as PriceRow[];
                if (effectiveRows.length > 0) priceSources.price_history_migration++;
              } catch { /* ignore */ }
            }

            // Fallback 2: stock_daily_prices in stocks.db (recent data)
            if (effectiveRows.length === 0 && stocksDb) {
              try {
                effectiveRows = stocksDb.prepare(`
                  SELECT price_date as date, high, low, close as close_price
                  FROM stock_daily_prices
                  WHERE ticker = ? AND price_date > ? AND price_date <= ?
                  ORDER BY price_date ASC
                `).bind(p.ticker, predDateStr, windowEnd).all() as PriceRow[];
                if (effectiveRows.length > 0) priceSources.price_history_egksco++;
              } catch { /* table missing */ }
            }

            if (effectiveRows.length > 0) {
              // Validate entry vs first close
              const firstClose = Number(effectiveRows[0].close_price || 0);
              if (firstClose > 0 && entry > 0) {
                const ratio = Math.max(entry, firstClose) / Math.min(entry, firstClose);
                if (ratio > 3) {
                  priceSources.unresolved++;
                  results.still_pending++;
                  results.errors++;
                  continue;
                }
              }

              const exit = evaluateExit(effectiveRows, entry, target, stop, isBuy, predDateStr);
              if (exit.outcome === 'SPLIT_DETECTED') {
                priceSources.unresolved++;
                results.still_pending++;
                continue;
              }

              resolved = true;
              const actualReturn = isBuy
                ? ((exit.exitPrice - entry) / entry) * 100
                : ((entry - exit.exitPrice) / entry) * 100;

              if (actualReturn > 100 || actualReturn < -90) {
                priceSources.unresolved++;
                results.still_pending++;
                results.errors++;
                continue;
              }

              updateStmt.run(
                exit.exitDate + ' 15:00:00',
                exit.exitPrice,
                Math.round(actualReturn * 100) / 100,
                exit.outcome === 'TARGET_HIT' ? 1 : 0,
                exit.outcome === 'STOPPED' ? 1 : 0,
                actualReturn > 0 ? 1 : 0,
                exit.holdingDays,
                exit.highestPrice,
                exit.exitReason,
                p.id,
              );

              if (exit.outcome === 'TARGET_HIT') results.target_hits++;
              else if (exit.outcome === 'STOPPED') results.stopped++;
              else if (exit.outcome === 'PROFIT_TAKEN') results.profit_taken++;
              else results.expired++;
            }
          }

          // 2. Recent fallback: use current_price
          if (!resolved && isRecent && currentPriceMap.has(p.ticker)) {
            const cur = currentPriceMap.get(p.ticker)!;
            priceSources.stocks_current++;
            resolved = true;

            const current = cur.price;
            let outcome: 'TARGET_HIT' | 'STOPPED' | null = null;
            if (isBuy) {
              if (current >= target) outcome = 'TARGET_HIT';
              else if (current <= stop) outcome = 'STOPPED';
            } else {
              if (current <= target) outcome = 'TARGET_HIT';
              else if (current >= stop) outcome = 'STOPPED';
            }

            if (outcome) {
              const exitPrice = outcome === 'TARGET_HIT' ? target : stop;
              const actualReturn = isBuy
                ? ((exitPrice - entry) / entry) * 100
                : ((entry - exitPrice) / entry) * 100;
              const holding = Math.max(0, Math.floor(
                (Date.now() - predDate.getTime()) / 86_400_000
              ));
              updateStmt.run(
                cur.asOf,
                exitPrice,
                Math.round(actualReturn * 100) / 100,
                outcome === 'TARGET_HIT' ? 1 : 0,
                outcome === 'STOPPED' ? 1 : 0,
                actualReturn > 0 ? 1 : 0,
                holding,
                current,
                outcome === 'TARGET_HIT' ? 'target_hit_current_price' : 'stop_hit_current_price',
                p.id,
              );
              if (outcome === 'TARGET_HIT') results.target_hits++;
              else results.stopped++;
            } else {
              results.still_pending++;
            }
          }

          if (!resolved) {
            priceSources.unresolved++;
            results.still_pending++;
          }
        } catch {
          results.errors++;
        }
      }
    });
    tx();
  } finally {
    pdb.close();
    if (priceDb) priceDb.close();
    if (stocksDb) stocksDb.close();
  }

  return {
    results,
    closed_count: results.target_hits + results.stopped + results.expired + results.profit_taken,
    price_sources: priceSources,
  };
}

// ============================================================================
// LEARNING ENGINE (inlined from learn-from-errors/route.ts)
// ============================================================================

export function extractLessons(db: Database.Database): PredictionLesson[] {
  const lessons: PredictionLesson[] = [];
  try {
    const overall = db.prepare(`
      SELECT COUNT(*) as total,
        SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END) as closed
      FROM predictions
    `).get() as OverallStatsRow;
    const closed = Number(overall?.closed || 0);
    if (closed === 0) return lessons;

    // Lesson 1: High RSI failures
    const highRsiFailed = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE outcome_date IS NOT NULL AND is_correct = 0
      AND notes LIKE '%RSI=%'
      AND CAST(SUBSTR(notes, INSTR(notes, 'RSI=') + 4, 5) AS REAL) > 70
    `).get() as CountRow;
    if (Number(highRsiFailed?.c || 0) > 3) {
      const sample = Number(highRsiFailed.c);
      lessons.push({
        type: 'technical', category: 'مؤشرات فنية',
        rule: 'لا تشتري عند RSI مرتفع (>70)',
        evidence: `${sample} صفقة خاسرة من ${closed} عند RSI > 70`,
        failure_rate: Math.round((sample / closed) * 100),
        sample_size: sample,
        recommendation: 'تفعيل فلتر RSI — تجنب الشراء إذا RSI > 70 إلا في حالة Momentum Accumulation',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 2: Low RSI failures (selling at oversold)
    const lowRsiFailed = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE outcome_date IS NOT NULL AND is_correct = 0
      AND notes LIKE '%RSI=%'
      AND CAST(SUBSTR(notes, INSTR(notes, 'RSI=') + 4, 5) AS REAL) < 30
    `).get() as CountRow;
    if (Number(lowRsiFailed?.c || 0) > 3) {
      const sample = Number(lowRsiFailed.c);
      lessons.push({
        type: 'technical', category: 'مؤشرات فنية',
        rule: 'لا تبيع عند RSI منخفض (<30) — قد يكون ارتداد',
        evidence: `${sample} صفقة خاسرة من ${closed} عند RSI < 30`,
        failure_rate: Math.round((sample / closed) * 100),
        sample_size: sample,
        recommendation: 'تفعيل فلتر — عندما RSI < 30، انتظر تأكيد انعكاس قبل الدخول',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 3: Stop loss too tight
    const stopHit = db.prepare(`
      SELECT COUNT(*) as c, AVG(actual_return) as avg_ret FROM predictions
      WHERE outcome_date IS NOT NULL AND hit_stop = 1
    `).get() as CountRow & { avg_ret?: number | null };
    if (Number(stopHit?.c || 0) > 5) {
      const sample = Number(stopHit.c);
      const failureRate = Math.round((sample / closed) * 100);
      lessons.push({
        type: 'risk', category: 'إدارة مخاطر',
        rule: `${sample} صفقة ضربت وقف الخسارة — قد يكون الوقف ضيق جداً`,
        evidence: `${sample} صفقة ضربت الوقف من ${closed} (${failureRate}%)`,
        failure_rate: failureRate,
        sample_size: sample,
        recommendation: 'توسيع الوقف باستخدام ATR × 2.5 بدل 2.0، أو استخدام Trailing Stop',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 4: Low R:R trades
    const lowRR = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE outcome_date IS NOT NULL AND is_correct = 0
      AND target_price IS NOT NULL AND stop_loss IS NOT NULL AND entry_price > 0
      AND (target_price - entry_price) / (entry_price - stop_loss) < 1.5
    `).get() as CountRow;
    if (Number(lowRR?.c || 0) > 3) {
      const sample = Number(lowRR.c);
      lessons.push({
        type: 'risk', category: 'إدارة مخاطر',
        rule: 'صفقات بنسبة R:R أقل من 1.5 فشلت بنسبة عالية',
        evidence: `${sample} صفقة خاسرة من ${closed} بـ R:R < 1.5`,
        failure_rate: Math.round((sample / closed) * 100),
        sample_size: sample,
        recommendation: 'رفع الحد الأدنى لـ R:R إلى 1.5 على الأقل، ويفضل 2.0',
        created_at: new Date().toISOString(),
      });
    }

    // Lesson 5: SELL signals performance
    const sellWins = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE signal_type = 'SELL' AND outcome_date IS NOT NULL AND is_correct = 1
    `).get() as CountRow;
    const sellTotal = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE signal_type = 'SELL' AND outcome_date IS NOT NULL
    `).get() as CountRow;
    if (Number(sellTotal?.c || 0) > 5) {
      const total = Number(sellTotal.c);
      const wins = Number(sellWins?.c || 0);
      const sellWinRate = Math.round((wins / total) * 100);
      if (sellWinRate < 40) {
        lessons.push({
          type: 'strategy', category: 'استراتيجية',
          rule: `إشارات البيع أداؤها ضعيف — نسبة نجاح ${sellWinRate}%`,
          evidence: `${wins} فوز من ${total} صفقة بيع`,
          failure_rate: 100 - sellWinRate,
          sample_size: total,
          recommendation: 'تجنب صفقات البيع المكشوف في الأسواق الصاعدة — ركز على الشراء فقط',
          created_at: new Date().toISOString(),
        });
      }
    }

    // Lesson 6: Persona performance
    const personaRows = db.prepare(`
      SELECT
        SUM(CASE WHEN notes LIKE '%persona=gambler%' THEN 1 ELSE 0 END) as gambler_total,
        SUM(CASE WHEN notes LIKE '%persona=gambler%' AND is_correct = 1 THEN 1 ELSE 0 END) as gambler_wins,
        SUM(CASE WHEN notes LIKE '%persona=investor%' THEN 1 ELSE 0 END) as investor_total,
        SUM(CASE WHEN notes LIKE '%persona=investor%' AND is_correct = 1 THEN 1 ELSE 0 END) as investor_wins,
        SUM(CASE WHEN notes LIKE '%persona=balanced%' THEN 1 ELSE 0 END) as balanced_total,
        SUM(CASE WHEN notes LIKE '%persona=balanced%' AND is_correct = 1 THEN 1 ELSE 0 END) as balanced_wins
      FROM predictions WHERE outcome_date IS NOT NULL
    `).get() as SqlRow;
    if (personaRows) {
      const gTotal = Number(personaRows.gambler_total || 0);
      const gWins = Number(personaRows.gambler_wins || 0);
      const iTotal = Number(personaRows.investor_total || 0);
      const iWins = Number(personaRows.investor_wins || 0);
      if (gTotal > 10 && iTotal > 10) {
        const gWR = Math.round((gWins / gTotal) * 100);
        const iWR = Math.round((iWins / iTotal) * 100);
        if (Math.abs(gWR - iWR) >= 15) {
          const better = gWR > iWR ? 'المغامر (gambler)' : 'المستثمر (investor)';
          const worse = gWR > iWR ? 'المستثمر' : 'المغامر';
          const betterWR = Math.max(gWR, iWR);
          const worseWR = Math.min(gWR, iWR);
          lessons.push({
            type: 'persona', category: 'شخصيات Maestro',
            rule: `شخصية ${better} تتفوق على ${worse} بفارق ${betterWR - worseWR}%`,
            evidence: `${better}: ${betterWR}% (${gWins}/${gTotal} أو ${iWins}/${iTotal}) — ${worse}: ${worseWR}%`,
            failure_rate: worseWR,
            sample_size: gTotal + iTotal,
            recommendation: `زيادة وزن إشارات شخصية ${better} في الـ orchestrator، وتقليل ${worse}`,
            created_at: new Date().toISOString(),
          });
        }
      }
    }

    // Persist lessons (clear old + insert new)
    db.exec('DELETE FROM prediction_lessons');
    const insert = db.prepare(
      'INSERT INTO prediction_lessons (type, category, rule, evidence, failure_rate, sample_size, recommendation) VALUES (?,?,?,?,?,?,?)'
    );
    for (const l of lessons) {
      try {
        insert.run(l.type, l.category, l.rule, l.evidence, l.failure_rate, l.sample_size, l.recommendation);
      } catch { /* ignore */ }
    }
  } catch (e) {
    console.error('extractLessons error:', e);
  }
  return lessons;
}

/**
 * READ-ONLY version of lessons extraction — just reads from the
 * prediction_lessons table without trying to re-extract or write anything.
 * Used by computeComprehensiveStats (which opens the DB readonly).
 */
function readLessons(db: Database.Database): PredictionLesson[] {
  try {
    return db.prepare(`
      SELECT type, category, rule, evidence, failure_rate, sample_size, recommendation, created_at
      FROM prediction_lessons
      ORDER BY failure_rate DESC, sample_size DESC
      LIMIT 20
    `).all() as PredictionLesson[];
  } catch {
    return [];
  }
}

export function runLearningEngine(): PredictionLesson[] {
  const db = openPredictionsDb(true);
  ensureSchema(db);
  try {
    return extractLessons(db);
  } finally {
    db.close();
  }
}

// ============================================================================
// COMPREHENSIVE STATS
// ============================================================================

export interface ComprehensiveStats {
  total_predictions: number;
  closed_predictions: number;
  active_predictions: number;
  target_hits: number;
  stop_hits: number;
  profit_taken: number;
  expired: number;
  wins: number;
  losses: number;
  buy_signals: number;
  sell_signals: number;
  real_win_rate: number;
  avg_return: number | null;
  avg_profit: number | null;
  avg_loss: number | null;
  net_pl: number;
  avg_risk_reward: number | null;
  avg_holding_days: number | null;
  avg_confidence: number | null;
  sr_adoption_rate: number;
  candlestick_adoption_rate: number;
  date_range: { earliest: string | null; latest: string | null };
  markets_covered: string[];
  by_market: ByMarketRow[];
  monthly_breakdown: Array<{ month: string; net_pl: number; closed: number; wins: number; win_rate: number }>;
  cumulative_returns: Array<{ date: string; cumulative_return: number; closed: number }>;
  candlestick_patterns: CandlestickPatternStat[];
  lessons: PredictionLesson[];
}

export function computeComprehensiveStats(): ComprehensiveStats {
  const db = openPredictionsDb(false);
  try {
    const overall = db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN outcome_date IS NULL THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN outcome_date IS NOT NULL AND hit_target = 1 THEN 1 ELSE 0 END) as target_hits,
        SUM(CASE WHEN outcome_date IS NOT NULL AND hit_stop = 1 THEN 1 ELSE 0 END) as stopped,
        SUM(CASE WHEN outcome_date IS NOT NULL AND hit_target = 0 AND hit_stop = 0 AND actual_return > 0 THEN 1 ELSE 0 END) as profit_taken,
        SUM(CASE WHEN outcome_date IS NOT NULL AND hit_target = 0 AND hit_stop = 0 AND actual_return <= 0 THEN 1 ELSE 0 END) as expired,
        SUM(CASE WHEN outcome_date IS NOT NULL AND is_correct = 1 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN signal_type = 'BUY' THEN 1 ELSE 0 END) as buys,
        SUM(CASE WHEN signal_type = 'SELL' THEN 1 ELSE 0 END) as sells,
        AVG(CASE WHEN outcome_date IS NOT NULL AND actual_return IS NOT NULL THEN actual_return END) as avg_return,
        AVG(CASE WHEN outcome_date IS NOT NULL AND actual_return > 0 THEN actual_return END) as avg_profit,
        AVG(CASE WHEN outcome_date IS NOT NULL AND actual_return < 0 THEN actual_return END) as avg_loss,
        SUM(CASE WHEN outcome_date IS NOT NULL AND actual_return IS NOT NULL THEN actual_return ELSE 0 END) as net_pl,
        AVG(CASE WHEN outcome_date IS NOT NULL AND actual_return IS NOT NULL THEN risk_reward END) as avg_rr,
        AVG(CASE WHEN outcome_date IS NOT NULL THEN holding_days END) as avg_holding_days,
        AVG(CASE WHEN outcome_date IS NOT NULL AND master_score IS NOT NULL THEN master_score END) as avg_confidence
      FROM predictions
    `).get() as OverallStatsRow;

    const allRows = db.prepare(`
      SELECT ticker, market, signal_type, outcome_date, hit_target, hit_stop,
             actual_return, is_correct, notes, prediction_date
      FROM predictions
    `).all() as Array<SqlRow>;

    // By market
    const inferMarket = (ticker: string, marketCol: string | null): string => {
      if (marketCol && marketCol !== '') return marketCol;
      if (!ticker) return 'EGX';
      if (/^\d+$/.test(ticker)) return 'TADAWUL';
      return 'EGX';
    };
    const byMarketMap: Record<string, MarketAgg> = {};
    const returnsByMarket: Record<string, number[]> = {};
    for (const r of allRows) {
      const m = inferMarket(String(r.ticker || ''), (r.market as string | null) ?? null);
      if (!byMarketMap[m]) byMarketMap[m] = { total: 0, wins: 0, losses: 0, closed: 0, active: 0, pending: 0, net_pl: 0, sr_adoption: 0, candle_adoption: 0 };
      if (!returnsByMarket[m]) returnsByMarket[m] = [];
      byMarketMap[m].total++;
      if (r.outcome_date) {
        byMarketMap[m].closed++;
        if (r.is_correct === 1) byMarketMap[m].wins++;
        else byMarketMap[m].losses++;
        if (r.actual_return !== null) {
          byMarketMap[m].net_pl += Number(r.actual_return);
          returnsByMarket[m].push(Number(r.actual_return));
        }
      } else {
        byMarketMap[m].active++;
        byMarketMap[m].pending++;
      }
      const notes = (r.notes as string | null) ?? null;
      if (notes && (notes.includes('support=') || notes.includes('resistance='))) byMarketMap[m].sr_adoption++;
      if (notes && notes.includes('candle=')) byMarketMap[m].candle_adoption++;
    }
    const byMarket: ByMarketRow[] = Object.keys(byMarketMap).sort().map((market) => {
      const v = byMarketMap[market];
      const returns = returnsByMarket[market];
      const avgReturn = returns && returns.length > 0
        ? Math.round((returns.reduce((a, b) => a + b, 0) / returns.length) * 100) / 100
        : null;
      return {
        market,
        total: v.total,
        wins: v.wins,
        losses: v.losses,
        closed: v.closed,
        active: v.active,
        pending: v.pending,
        win_rate: v.closed > 0 ? Math.round((v.wins / v.closed) * 1000) / 10 : 0,
        net_pl: Math.round(v.net_pl * 100) / 100,
        avg_return: avgReturn,
        sr_adoption: v.total > 0 ? Math.round((v.sr_adoption / v.total) * 1000) / 10 : 0,
        candle_adoption: v.total > 0 ? Math.round((v.candle_adoption / v.total) * 1000) / 10 : 0,
      };
    });

    // Date range
    const dateRange = db.prepare(`
      SELECT MIN(prediction_date) as earliest, MAX(prediction_date) as latest
      FROM predictions
    `).get() as SqlRow;

    // S/R adoption
    const srCount = db.prepare(`
      SELECT COUNT(*) as c FROM predictions
      WHERE notes LIKE '%support=%' OR notes LIKE '%resistance=%'
    `).get() as CountRow;
    const srRate = Number(overall.total || 0) > 0 ? Math.round((Number(srCount.c || 0) / Number(overall.total)) * 1000) / 10 : 0;

    const candleCount = db.prepare(`
      SELECT COUNT(*) as c FROM predictions WHERE notes LIKE '%candle=%'
    `).get() as CountRow;
    const candleRate = Number(overall.total || 0) > 0 ? Math.round((Number(candleCount.c || 0) / Number(overall.total)) * 1000) / 10 : 0;

    // Candlestick patterns performance
    const candlePatterns = db.prepare(`
      SELECT notes, hit_target, hit_stop, is_correct, outcome_date
      FROM predictions WHERE notes LIKE '%candle=%'
    `).all() as Array<SqlRow>;
    const patternMap: Record<string, { count: number; wins: number; losses: number }> = {};
    for (const r of candlePatterns) {
      const match = (String(r.notes || '')).match(/candle=([A-Z_]+)/);
      if (!match) continue;
      const pat = match[1];
      if (!patternMap[pat]) patternMap[pat] = { count: 0, wins: 0, losses: 0 };
      patternMap[pat].count++;
      if (r.outcome_date) {
        if (r.is_correct === 1) patternMap[pat].wins++;
        else patternMap[pat].losses++;
      }
    }
    const patternStats: CandlestickPatternStat[] = Object.entries(patternMap).map(([name, v]) => ({
      name, count: v.count, wins: v.wins, losses: v.losses,
      win_rate: v.count > 0 ? Math.round((v.wins / (v.wins + v.losses)) * 1000) / 10 : 0,
    })).sort((a, b) => b.count - a.count);

    // Monthly breakdown
    const monthlyRows = db.prepare(`
      SELECT
        SUBSTR(prediction_date, 1, 7) as month,
        COUNT(*) as total,
        SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN outcome_date IS NOT NULL AND is_correct = 1 THEN 1 ELSE 0 END) as wins,
        SUM(CASE WHEN outcome_date IS NOT NULL AND actual_return IS NOT NULL THEN actual_return ELSE 0 END) as net_pl
      FROM predictions
      GROUP BY SUBSTR(prediction_date, 1, 7)
      ORDER BY month ASC
    `).all() as Array<SqlRow>;
    const monthly_breakdown = monthlyRows.map(r => ({
      month: String(r.month || ''),
      net_pl: Math.round(Number(r.net_pl || 0) * 100) / 100,
      closed: Number(r.closed || 0),
      wins: Number(r.wins || 0),
      win_rate: Number(r.closed || 0) > 0 ? Math.round((Number(r.wins) / Number(r.closed)) * 1000) / 10 : 0,
    }));

    // Cumulative returns time-series (closed predictions sorted by outcome_date)
    const closedRows = db.prepare(`
      SELECT outcome_date, actual_return
      FROM predictions
      WHERE outcome_date IS NOT NULL AND actual_return IS NOT NULL
      ORDER BY outcome_date ASC
    `).all() as Array<SqlRow>;
    let cum = 0;
    const cumulative_returns: Array<{ date: string; cumulative_return: number; closed: number }> = [];
    let i = 0;
    for (const r of closedRows) {
      cum += Number(r.actual_return);
      i++;
      const d = String(r.outcome_date).slice(0, 10);
      // Group by date — keep last cumulative
      if (cumulative_returns.length > 0 && cumulative_returns[cumulative_returns.length - 1].date === d) {
        cumulative_returns[cumulative_returns.length - 1].cumulative_return = Math.round(cum * 100) / 100;
        cumulative_returns[cumulative_returns.length - 1].closed = i;
      } else {
        cumulative_returns.push({
          date: d,
          cumulative_return: Math.round(cum * 100) / 100,
          closed: i,
        });
      }
    }
    // Cap to last 200 points for chart readability
    const cappedCumulative = cumulative_returns.length > 200
      ? cumulative_returns.slice(-200)
      : cumulative_returns;

    // Lessons (READ-ONLY — does not re-extract, just reads from prediction_lessons)
    const lessons = readLessons(db);

    const closed = Number(overall?.closed || 0);
    const wins = Number(overall?.wins || 0);

    return {
      total_predictions: Number(overall?.total || 0),
      closed_predictions: closed,
      active_predictions: Number(overall?.active || 0),
      target_hits: Number(overall?.target_hits || 0),
      stop_hits: Number(overall?.stopped || 0),
      profit_taken: Number(overall?.profit_taken || 0),
      expired: Number(overall?.expired || 0),
      wins,
      losses: closed - wins,
      buy_signals: Number(overall?.buys || 0),
      sell_signals: Number(overall?.sells || 0),
      real_win_rate: closed > 0 ? Math.round((wins / closed) * 1000) / 10 : 0,
      avg_return: overall.avg_return != null ? Math.round(Number(overall.avg_return) * 100) / 100 : null,
      avg_profit: overall.avg_profit != null ? Math.round(Number(overall.avg_profit) * 100) / 100 : null,
      avg_loss: overall.avg_loss != null ? Math.round(Number(overall.avg_loss) * 100) / 100 : null,
      net_pl: Math.round(Number(overall.net_pl || 0) * 100) / 100,
      avg_risk_reward: overall.avg_rr != null ? Math.round(Number(overall.avg_rr) * 100) / 100 : null,
      avg_holding_days: overall.avg_holding_days != null ? Math.round(Number(overall.avg_holding_days) * 10) / 10 : null,
      avg_confidence: overall.avg_confidence != null ? Math.round(Number(overall.avg_confidence)) : null,
      sr_adoption_rate: srRate,
      candlestick_adoption_rate: candleRate,
      date_range: {
        earliest: (dateRange.earliest as string | null) || null,
        latest: (dateRange.latest as string | null) || null,
      },
      markets_covered: byMarket.map(m => m.market),
      by_market: byMarket,
      monthly_breakdown,
      cumulative_returns: cappedCumulative,
      candlestick_patterns: patternStats,
      lessons,
    };
  } finally {
    db.close();
  }
}
