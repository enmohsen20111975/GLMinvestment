// types + interfaces — extracted (Phase 3)

// ============================================================================
// MAESTRO-DISABLED (Task PHASE-2-MAESTRO-KILL, Rule 73)
// This file is the legacy "Maestro Engine" implementation. It is still
// imported by the honest-tracking API routes (`/api/predictions/honest-tracking/*`)
// and the admin generate-historical-predictions route, so it CANNOT be
// deleted (Rule 4 — NO-DELETION). It is retained for backward compatibility.
//
// IMPORTANT: New UI components MUST NOT call `/api/maestro/*` endpoints — they
// must use the unified API (`/api/stocks/[ticker]/unified`) instead. The
// `maestro_score` column in `stored_analyses` is a DB column (kept for compat)
// and is NOT a maestro-engine reference.
//
// Deprecation status: retained as-is; no new callers should be added.
// ============================================================================

/**
 * Maestro Engine — Honest Tracking
 * =================================
 * Pure-TypeScript implementation of the Maestro orchestrator that powers the
 * "Honest Predictions" admin page. Replaces the previous Python-only
 * `backfill_with_personas.py` (which only worked for EGX because it depended
 * on `egypt_stocks.db`).
 *
 * @deprecated (Task PHASE-2-MAESTRO-KILL) — retained only for backward
 *   compatibility with existing honest-tracking API routes. New code should
 *   use the unified analysis API instead.
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

// CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67) — Wilder's smoothing.
// TS canonical source for RSI is src/lib/unified-stock-data.ts::computeRSI.
import { computeRSI } from '@/lib/canonical-rsi';

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
