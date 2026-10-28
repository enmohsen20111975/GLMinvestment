#!/usr/bin/env python3
"""
S-1.1 — Restore predictions.db with FULL schema (Bravo, Integration Stabilization)
==================================================================================
Creates db/predictions.db with:
  - `predictions` table containing ALL columns any writer in the codebase
    requires (consolidated from migrator.py heal list + prediction_tracker.py
    primary INSERT path + sniper_routes + intraday_scanner + B2 dedup logic).
  - `lifecycle_status TEXT DEFAULT NULL` column — the LITERAL 'testing' value
    the primary INSERT path uses (lines 801, 843, 872 of prediction_tracker.py).
    Without this column, the primary INSERT FAILS and the writer silently
    falls back to the 16-column legacy schema (no risk_reward, no atr, no T2).
  - `track TEXT DEFAULT 'full_analysis'` column — required by the B2 UNIQUE
    INDEX identity (ticker, day, persona, market, track).
  - `update_count INTEGER DEFAULT 0` + `is_duplicate INTEGER DEFAULT 0`
    (B2 traceability columns — added by the migration script, but defined
    here too so they exist even before the migration script runs).
  - `original_stop_loss REAL` (B2 worklog mentions it; preserved for restore).
  - UNIQUE INDEX `idx_predictions_dedup`
    ON (ticker, substr(prediction_date,1,10), persona, market, track).
  - `predictions_duplicates_archive` table (mirror + archived_at).
  - The other tables the FastAPI migrator expects to find in predictions.db
    (so startup doesn't fail): stored_analyses, persona_predictions,
    prediction_outcomes, cached_analysis, crypto_predictions_log.
  - Indexes used by prediction_tracker (id, ticker, prediction_date, etc.).

NO data is restored — only the schema. This DB is created fresh because the
owner's ground truth says no predictions dump exists; we are NOT fabricating
predictions either. Real predictions get written by the live pipeline.

Run:
    python3 scripts/s1_restore_predictions_db.py
"""
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = PROJECT_ROOT / 'db' / 'predictions.db'


SCHEMA_SQL = """
-- ======================================================================
-- predictions table — FULL consolidated schema (S-1.1 / Bravo)
-- ======================================================================
-- Columns are union of:
--   (1) migrator.py consolidated heal (migrator.py:1152)
--   (2) prediction_tracker.py primary INSERT path (lines 792-816)
--   (3) sniper_routes.py schema (signal_ar, maestro_score, etc.)
--   (4) daily_closer columns (highest_price_reached, exit_type, etc.)
--   (5) B2 dedup columns (track, update_count, is_duplicate, original_stop_loss)
--   (6) lifecycle_status (THE MISSING COLUMN — primary INSERT hardcodes
--       the literal 'testing' for it; without this column, INSERT fails).
-- ======================================================================
CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    stock_ticker TEXT,
    market TEXT DEFAULT 'EGX',
    track TEXT DEFAULT 'full_analysis',
    signal TEXT,
    signal_type TEXT NOT NULL DEFAULT 'BUY',
    direction TEXT,
    score REAL DEFAULT 0,
    confidence REAL DEFAULT 0,
    master_score REAL,
    maestro_score REAL DEFAULT 0,
    technical_score REAL DEFAULT 50,
    fundamental_score REAL DEFAULT 50,
    ai_pattern_score REAL DEFAULT 50,
    sentiment_score REAL DEFAULT 50,
    entry_price REAL NOT NULL,
    target_price REAL,
    target_price_2 REAL DEFAULT 0,
    stop_loss REAL,
    original_stop_loss REAL,
    risk_reward REAL DEFAULT 0,
    horizon TEXT,
    persona TEXT DEFAULT 'balanced',
    status TEXT DEFAULT 'active',
    prediction_date TEXT NOT NULL,
    outcome_date TEXT,
    exit_price REAL,
    actual_exit_price REAL,
    exit_type TEXT,
    actual_return REAL,
    pnl_percent REAL,
    pnl_pct REAL,
    hit_target INTEGER DEFAULT 0,
    hit_stop INTEGER DEFAULT 0,
    is_correct INTEGER,
    is_trend_following INTEGER DEFAULT 0,
    holding_days INTEGER DEFAULT 0,
    days_to_close INTEGER,
    closed_at DATETIME,
    analysis_json TEXT,
    notes TEXT,
    signal_ar TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME,
    atr_at_entry REAL,
    trailing_stop_atr_mult REAL DEFAULT 2.5,
    initial_stop_atr_mult REAL DEFAULT 2.0,
    highest_price REAL,
    lowest_price REAL,
    highest_price_reached REAL,
    lowest_price_reached REAL,
    explosive_score REAL DEFAULT 0,
    explosive_label TEXT DEFAULT '',
    evidence_count INTEGER DEFAULT 0,
    morning_bell INTEGER DEFAULT 0,
    kill_filter_result TEXT DEFAULT '',
    who_is_buying TEXT DEFAULT '',
    tp1_price REAL,
    tp2_price REAL,
    trailing_stop_pct REAL,
    max_hold_days INTEGER,
    exit_protocol TEXT,
    user_advice_ar TEXT,
    lifecycle_status TEXT DEFAULT NULL,
    update_count INTEGER DEFAULT 0,
    is_duplicate INTEGER DEFAULT 0
);

-- ======================================================================
-- B2 UNIQUE INDEX — prevents daily duplication
-- ======================================================================
-- Identity: (ticker, substr(prediction_date,1,10), persona, market, track)
-- SQLite supports expression indexes since 3.9; the bundled libsqlite3 is
-- 3.46+, so this is safe.
DROP INDEX IF EXISTS idx_predictions_dedup;
CREATE UNIQUE INDEX idx_predictions_dedup
    ON predictions (ticker, substr(prediction_date,1,10), persona, market, track);

-- ======================================================================
-- B2 archive table — mirror of predictions + archived_at
-- ======================================================================
CREATE TABLE IF NOT EXISTS predictions_duplicates_archive (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    stock_ticker TEXT,
    market TEXT DEFAULT 'EGX',
    track TEXT DEFAULT 'full_analysis',
    signal TEXT,
    signal_type TEXT,
    direction TEXT,
    score REAL DEFAULT 0,
    confidence REAL DEFAULT 0,
    master_score REAL,
    maestro_score REAL DEFAULT 0,
    technical_score REAL DEFAULT 50,
    fundamental_score REAL DEFAULT 50,
    ai_pattern_score REAL DEFAULT 50,
    sentiment_score REAL DEFAULT 50,
    entry_price REAL,
    target_price REAL,
    target_price_2 REAL DEFAULT 0,
    stop_loss REAL,
    original_stop_loss REAL,
    risk_reward REAL DEFAULT 0,
    horizon TEXT,
    persona TEXT,
    status TEXT,
    prediction_date TEXT,
    outcome_date TEXT,
    exit_price REAL,
    actual_exit_price REAL,
    exit_type TEXT,
    actual_return REAL,
    pnl_percent REAL,
    pnl_pct REAL,
    hit_target INTEGER DEFAULT 0,
    hit_stop INTEGER DEFAULT 0,
    is_correct INTEGER,
    is_trend_following INTEGER DEFAULT 0,
    holding_days INTEGER DEFAULT 0,
    days_to_close INTEGER,
    closed_at DATETIME,
    analysis_json TEXT,
    notes TEXT,
    signal_ar TEXT,
    created_at TEXT,
    updated_at DATETIME,
    atr_at_entry REAL,
    trailing_stop_atr_mult REAL DEFAULT 2.5,
    initial_stop_atr_mult REAL DEFAULT 2.0,
    highest_price REAL,
    lowest_price REAL,
    highest_price_reached REAL,
    lowest_price_reached REAL,
    explosive_score REAL DEFAULT 0,
    explosive_label TEXT DEFAULT '',
    evidence_count INTEGER DEFAULT 0,
    morning_bell INTEGER DEFAULT 0,
    kill_filter_result TEXT DEFAULT '',
    who_is_buying TEXT DEFAULT '',
    tp1_price REAL,
    tp2_price REAL,
    trailing_stop_pct REAL,
    max_hold_days INTEGER,
    exit_protocol TEXT,
    user_advice_ar TEXT,
    lifecycle_status TEXT,
    update_count INTEGER DEFAULT 0,
    is_duplicate INTEGER DEFAULT 0,
    archived_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ======================================================================
-- Other tables the migrator + FastAPI startup expect in predictions.db
-- ======================================================================
CREATE TABLE IF NOT EXISTS stored_analyses (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    ticker TEXT NOT NULL,
    market TEXT DEFAULT 'EGX',
    recommendation TEXT,
    signal TEXT,
    signal_ar TEXT,
    confidence REAL DEFAULT 0,
    maestro_score REAL DEFAULT 0,
    entry_price REAL,
    target_price REAL,
    stop_loss REAL,
    risk_reward REAL,
    risk_reward_ratio REAL,
    horizon TEXT,
    persona TEXT DEFAULT 'balanced',
    status TEXT DEFAULT 'active',
    notes TEXT,
    narrative TEXT,
    narrative_ar TEXT,
    analysis_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS persona_predictions (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    ticker TEXT NOT NULL,
    market TEXT DEFAULT 'EGX',
    persona TEXT DEFAULT 'balanced',
    signal TEXT,
    signal_ar TEXT,
    score REAL DEFAULT 0,
    confidence REAL DEFAULT 0,
    entry_price REAL,
    target_price REAL,
    stop_loss REAL,
    risk_reward REAL,
    horizon TEXT,
    rationale TEXT,
    rationale_ar TEXT,
    story_arc TEXT,
    analysis_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS prediction_outcomes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prediction_id TEXT NOT NULL,
    outcome_date TEXT NOT NULL,
    exit_price REAL,
    pnl_percent REAL,
    hit_target INTEGER DEFAULT 0,
    hit_stop INTEGER DEFAULT 0,
    days_to_resolve INTEGER,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cached_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT,
    market TEXT,
    confidence REAL,
    analysis_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS crypto_predictions_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker TEXT NOT NULL,
    market TEXT DEFAULT 'CRYPTO',
    signal TEXT,
    signal_type TEXT,
    entry_price REAL,
    target_price REAL,
    stop_loss REAL,
    risk_reward REAL,
    confidence REAL,
    analysis_json TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ======================================================================
-- Indexes (prediction_tracker + misc_routes use these)
-- ======================================================================
CREATE INDEX IF NOT EXISTS idx_predictions_ticker ON predictions(ticker);
CREATE INDEX IF NOT EXISTS idx_predictions_date ON predictions(prediction_date);
CREATE INDEX IF NOT EXISTS idx_predictions_created ON predictions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_predictions_market ON predictions(market);
CREATE INDEX IF NOT EXISTS idx_predictions_outcome ON predictions(outcome_date);
CREATE INDEX IF NOT EXISTS idx_predictions_outcome_target_stop ON predictions(outcome_date, hit_target, hit_stop);
CREATE INDEX IF NOT EXISTS idx_predictions_track ON predictions(track);
CREATE INDEX IF NOT EXISTS idx_stored_ticker ON stored_analyses(ticker);
CREATE INDEX IF NOT EXISTS idx_stored_market ON stored_analyses(market);
CREATE INDEX IF NOT EXISTS idx_stored_score ON stored_analyses(maestro_score);
CREATE INDEX IF NOT EXISTS idx_stored_rec ON stored_analyses(recommendation);
CREATE INDEX IF NOT EXISTS idx_stored_ticker_date ON stored_analyses(ticker, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stored_ticker_market ON stored_analyses(ticker, market);
CREATE INDEX IF NOT EXISTS idx_persona_ticker ON persona_predictions(ticker);
CREATE INDEX IF NOT EXISTS idx_persona_persona ON persona_predictions(persona);
CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status);
"""


def main():
    print(f"[S-1.1] Creating predictions.db at {DB_PATH}")
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        # Don't delete existing — just verify schema.
        print(f"  ⚠️  {DB_PATH} already exists; will attempt schema supplement only.")
        # We'll still run executescript which is idempotent (CREATE IF NOT EXISTS).
        # The DROP INDEX + CREATE UNIQUE INDEX is also idempotent.

    conn = sqlite3.connect(str(DB_PATH))
    try:
        conn.executescript(SCHEMA_SQL)
        conn.commit()
    except Exception as e:
        print(f"  ❌ schema creation failed: {e}", flush=True)
        conn.rollback()
        return 2

    # Verify lifecycle_status column
    cols = [r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()]
    if 'lifecycle_status' not in cols:
        print(f"  ❌ lifecycle_status column MISSING after creation. Cols: {cols}")
        return 3

    # Verify UNIQUE INDEX exists
    idx_rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='predictions'"
    ).fetchall()
    idx_names = [r[0] for r in idx_rows]
    if 'idx_predictions_dedup' not in idx_names:
        print(f"  ❌ idx_predictions_dedup UNIQUE INDEX MISSING. Idxs: {idx_names}")
        return 4

    # Verify archive table
    tbl_rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()
    tbl_names = [r[0] for r in tbl_rows]

    print(f"\n  ✅ predictions table columns: {len(cols)}")
    print(f"     key columns: lifecycle_status={('lifecycle_status' in cols)}, "
          f"track={('track' in cols)}, update_count={('update_count' in cols)}, "
          f"is_duplicate={('is_duplicate' in cols)}, "
          f"original_stop_loss={('original_stop_loss' in cols)}")
    print(f"  ✅ indexes on predictions: {idx_names}")
    print(f"  ✅ tables in predictions.db: {tbl_names}")
    print(f"  ✅ total columns in predictions: {len(cols)}")

    conn.close()
    print(f"\n[S-1.1] DONE — predictions.db created with full schema + lifecycle_status.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
