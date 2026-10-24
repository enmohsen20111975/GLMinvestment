#!/usr/bin/env python3
"""
migrator.py — Central Database Migration Manager (Phase 3 Task 2)
=================================================================

المشكلة (قبل Phase 3):
----------------------
في كل مرة الباك-إند بيقلع، 67 ملف بايثون بيعملوا `CREATE TABLE IF NOT EXISTS`
متفرقين. ده بيسبب:

  - I/O مرعب في الـ Boot time (كل ملف بيفتح connection + executeScript + close).
  - Race conditions لما الاتنين يحاولوا يعملوا migration في نفس اللحظة.
  - صعوبة تتبّع الـ schema (محدش بيعرف كل الجداول من مكان واحد).
  - Boot time بطيء جداً (كل migration بتاخد 50-200ms → 67 × 100ms = 6.7 ثانية!).

الحل (Phase 3):
--------------
`Migrator` بيكون **Single Source of Truth** لكل schema definitions.

  - كل الـ table definitions موجودة في `_SCHEMA` dict (مرتبة حسب الـ DB).
  - `run_migrations()` بتـ apply كل الـ DDL statements مرة واحدة في الـ boot.
  - بعد `run_migrations()`, بقية الـ modules بتفتح الـ DB للقراءة/الكتابة بس —
    مفيش CREATE TABLE تاني.
  - Idempotent: `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`.
    التشغيل التاني بيكون no-op.
  - يستخدم `db_manager.py` (WAL + busy_timeout) عشان يتفادى الـ locks.
  - Safe mode: لو جدول واحد فشل، يكمّل الباقي (مايوقفش الـ boot).

التوافق مع الـ init_tables() القديمة:
  - `init_tables()` في `analyzers/background_analyzer.py` وغيره لسه شغّال
    كـ fallback. لو الـ migrator شغّال, الـ `CREATE TABLE IF NOT EXISTS`
    بيرجع فوراً (no-op) — مايفضلش overhead.
  - تدريجياً هنشيل الـ init_tables() القديمة في phase جاية.

Usage:
  >>> from core.migrator import run_migrations
  >>> run_migrations()  # call once at startup (main.py / lightweight_server.py)
  >>> # later, any module can just open the DB for read/write — no CREATE TABLE

Author: دليل الاستثمار (Phase 3 — Arteries Cleanup & Fast Boot)
"""

from __future__ import annotations

import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ============================================================================
# DB paths — reuse db_manager's resolver (Single Source of Truth for paths)
# ============================================================================

try:
    from core.db_manager import get_db_path  # type: ignore
    _HAS_DB_MANAGER = True
except ImportError:  # pragma: no cover
    _HAS_DB_MANAGER = False
    import os
    _PROJECT_ROOT = Path(__file__).resolve().parents[2]
    _DB_DIR = Path(os.environ.get("DB_DIR", _PROJECT_ROOT / "db"))

    def get_db_path(name: str) -> str:  # type: ignore[no-redef]
        name = name.lower().strip()
        if name.endswith(".db"):
            name = name[:-3]
        env_val = os.environ.get(f"{name.upper()}_DB")
        if env_val:
            return str(Path(env_val).resolve())
        return str(_DB_DIR / f"{name}.db")


# ============================================================================
# Schema registry — all DDL statements organized by DB name
# ============================================================================
#
# Each entry: (db_name, statement_type, sql)
#   - statement_type: 'table' | 'index' | 'view'
#   - Order matters within a DB: tables first, then indexes, then views.
#
# IMPORTANT: All statements use `IF NOT EXISTS` so re-running is safe (no-op).
# Add new tables here instead of scattering CREATE TABLE across modules.

_SCHEMA: Dict[str, List[Tuple[str, str]]] = {
    # ------------------------------------------------------------------
    # stocks.db — الأسهم + الأسعار اليومية + الفهارس السوقية + المحفظة
    # ------------------------------------------------------------------
    'stocks': [
        # ---- tables ----
        ('table', """
            CREATE TABLE IF NOT EXISTS stocks (
                ticker TEXT PRIMARY KEY,
                name TEXT,
                name_ar TEXT,
                market TEXT DEFAULT 'EGX',
                sector TEXT,
                industry TEXT,
                current_price REAL,
                previous_close REAL,
                change REAL,
                change_percent REAL,
                volume INTEGER,
                value_traded REAL,
                turnover_egp REAL,
                is_active INTEGER DEFAULT 1,
                last_updated TEXT,
                last_update TEXT,
                pe_ratio REAL,
                pb_ratio REAL,
                roe REAL,
                market_cap REAL,
                shares_outstanding REAL,
                dividend_yield REAL,
                currency TEXT DEFAULT 'EGP',
                exchange TEXT DEFAULT 'EGX',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS stock_daily_prices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                price_date TEXT NOT NULL,
                open_price REAL,
                high_price REAL,
                low_price REAL,
                close_price REAL,
                volume INTEGER,
                turnover REAL,
                change_percent REAL,
                UNIQUE(ticker, price_date),
                -- P14-PHASE-B (DATA-05): FK to stocks(ticker) for same-DB integrity
                FOREIGN KEY (ticker) REFERENCES stocks(ticker) ON DELETE CASCADE
            )
        """),
        # P25-LIVING-ENGINE (Aug 2026): Stock DNA — ملف تعريف السهم الديناميكي.
        # جدول كمي بيتعبّي كل يوم من scripts/build_stock_profiles.py (يقرأ
        # price_history.db — حتى 25 سنة بيانات على الإنتاج). ده اللي بيخلّي
        # المنصة "كائن حي" يفهم طبيعة كل سهم بدل معادلات عامة ثابتة.
        ('table', """
            CREATE TABLE IF NOT EXISTS stock_adaptive_profiles (
                ticker TEXT PRIMARY KEY,
                sector TEXT,
                -- التذبذب التاريخي
                volatility_percentile_90d REAL,
                avg_atr_pct REAL,
                -- سلوك الحجم
                avg_volume_20d REAL,
                volume_spike_threshold REAL,
                -- النطاق الحقيقي اللي بيتحرك فيه
                typical_move_1d REAL,
                typical_move_5d REAL,
                typical_move_15d REAL,
                -- سلوك الأزمات
                reaction_to_market_crashes TEXT,
                crash_avg_drawdown REAL,
                crash_recovery_days REAL,
                -- شخصية السهم (من stock_dna_analyzer)
                personality_type_en TEXT,
                -- بيانات العينة
                history_days INTEGER,
                history_start_date TEXT,
                history_end_date TEXT,
                confidence TEXT,
                updated_at TEXT,
                profile_json TEXT,
                FOREIGN KEY (ticker) REFERENCES stocks(ticker) ON DELETE CASCADE
            )
        """),
        ('index', "CREATE INDEX IF NOT EXISTS idx_stock_adaptive_profiles_sector ON stock_adaptive_profiles(sector)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_stock_adaptive_profiles_personality ON stock_adaptive_profiles(personality_type_en)"),
        ('table', """
            CREATE TABLE IF NOT EXISTS market_indices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT UNIQUE NOT NULL,
                name TEXT,
                market TEXT DEFAULT 'EGX',
                current_value REAL,
                previous_close REAL,
                change REAL,
                change_percent REAL,
                last_updated TEXT
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS portfolio_assets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                ticker TEXT NOT NULL,
                market TEXT DEFAULT 'EGX',
                shares REAL DEFAULT 0,
                purchase_price REAL DEFAULT 0,
                purchase_date TEXT,
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now')),
                -- P14-PHASE-B (DATA-05): FK to stocks(ticker) for same-DB integrity
                FOREIGN KEY (ticker) REFERENCES stocks(ticker) ON DELETE CASCADE
            )
        """),
        # Phase 3 — outcome_logs + conjunction_patterns + learned_lessons
        # (these were in scripts/init_db_tables.py — moved here for centralization)
        ('table', """
            CREATE TABLE IF NOT EXISTS outcome_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                trade_id INTEGER NOT NULL,
                close_date TEXT NOT NULL,
                actual_exit_price REAL,
                close_reason TEXT,
                gross_profit_loss REAL,
                net_profit_loss REAL,
                profit_loss_percent REAL,
                days_open INTEGER,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS conjunction_patterns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                persona_name TEXT DEFAULT 'balanced',
                sector TEXT NOT NULL,
                regime TEXT NOT NULL,
                rsi_bucket TEXT NOT NULL,
                month INTEGER,
                quarter TEXT,
                total_signals INTEGER DEFAULT 0,
                wins INTEGER DEFAULT 0,
                losses INTEGER DEFAULT 0,
                win_rate REAL DEFAULT 0,
                avg_pnl REAL DEFAULT 0,
                decision TEXT DEFAULT 'proceed',
                confidence_adjustment REAL DEFAULT 0,
                last_updated TEXT,
                UNIQUE(persona_name, sector, regime, rsi_bucket, month)
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS context_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT,
                sector TEXT,
                regime TEXT,
                rsi_bucket TEXT,
                month INTEGER,
                quarter TEXT,
                persona TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS indicator_trust_scores (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                indicator_name TEXT NOT NULL,
                persona_name TEXT DEFAULT 'balanced',
                timeframe TEXT,
                success_count INTEGER DEFAULT 0,
                failure_count INTEGER DEFAULT 0,
                trust_score REAL DEFAULT 0.5,
                last_updated TEXT,
                UNIQUE(indicator_name, persona_name, timeframe)
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS learned_lessons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lesson_type TEXT NOT NULL,
                lesson_text TEXT NOT NULL,
                context_json TEXT,
                confidence REAL DEFAULT 0.5,
                source TEXT,
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS regime_indicator_weights (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                regime TEXT NOT NULL,
                indicator_name TEXT NOT NULL,
                weight REAL DEFAULT 0.5,
                last_updated TEXT,
                UNIQUE(regime, indicator_name)
            )
        """),
        # ---- macro_indicators (P23-PARSE-HOTFIX: centrally managed) ----
        # قبل كده كان الجدول ده بيُنشأ بس من fetch_inflation_worldbank.py بشكل lazzy،
        # ومفيهوش إدارة مركزية. على الإنتاج اتعمل بنسخة schema قديمة (wide:
        # date/usd_to_egp/...) من غير indicator_name → الـ fetcher كان بوقع بـ
        # "table macro_indicators has no column named indicator_name".
        # الحل: (1) عرّف الجدول هنا (Single Source of Truth)، (2) أضف post-schema
        # migration بيعمل ALTER TABLE ADD COLUMN لو الأعمدة ناقصة على الإنتاج.
        ('table', """
            CREATE TABLE IF NOT EXISTS macro_indicators (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                indicator_name TEXT NOT NULL UNIQUE,
                indicator_value REAL NOT NULL DEFAULT 0,
                unit TEXT DEFAULT '%',
                source TEXT,
                recorded_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT DEFAULT (datetime('now'))
            )
        """),
        ('index', "CREATE UNIQUE INDEX IF NOT EXISTS idx_macro_indicators_name ON macro_indicators(indicator_name)"),
        # ---- indexes ----
        ('index', "CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_stocks_market ON stocks(market)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_sdp_ticker_date ON stock_daily_prices(ticker, price_date DESC)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_sdp_date ON stock_daily_prices(price_date DESC)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_sdp_ticker ON stock_daily_prices(ticker)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_conjunction_lookup ON conjunction_patterns(sector, regime, rsi_bucket, month)"),
    ],

    # ------------------------------------------------------------------
    # predictions.db — stored_analyses + analysis_engine_status + persona_predictions
    # ------------------------------------------------------------------
    'predictions': [
        ('table', """
            CREATE TABLE IF NOT EXISTS stored_analyses (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                ticker TEXT NOT NULL,
                market TEXT DEFAULT 'EGX',
                maestro_score REAL DEFAULT 0,
                recommendation TEXT DEFAULT 'hold',
                recommendation_ar TEXT,
                confidence REAL DEFAULT 0,
                entry_price REAL DEFAULT 0,
                target_price REAL,
                stop_loss REAL,
                risk_reward REAL DEFAULT 0,
                regime TEXT,
                regime_score REAL,
                regime_confidence REAL,
                timeframe_score REAL,
                timeframe_aligned INTEGER DEFAULT 0,
                timeframe_count INTEGER DEFAULT 0,
                volume_ratio REAL,
                liquidity_rating TEXT,
                news_risk_level TEXT,
                has_cbe_news INTEGER DEFAULT 0,
                analysis_json TEXT,
                analysis_type TEXT DEFAULT 'scheduled',
                analysis_version TEXT DEFAULT '2.0',
                turnover_egp REAL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(ticker, market)
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS analysis_engine_status (
                id TEXT PRIMARY KEY DEFAULT 'main',
                is_running INTEGER DEFAULT 0,
                current_market TEXT,
                current_ticker TEXT,
                total_analyzed INTEGER DEFAULT 0,
                total_pending INTEGER DEFAULT 0,
                last_full_analysis DATETIME,
                last_run DATETIME,
                next_scheduled_run DATETIME,
                error_count INTEGER DEFAULT 0,
                last_error TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS analysis_jobs (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                job_type TEXT NOT NULL,
                market TEXT,
                ticker TEXT,
                status TEXT DEFAULT 'pending',
                progress REAL DEFAULT 0,
                total_items INTEGER DEFAULT 0,
                processed_items INTEGER DEFAULT 0,
                result_summary TEXT,
                error_message TEXT,
                started_at DATETIME,
                completed_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS persona_predictions (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                ticker TEXT NOT NULL,
                market TEXT DEFAULT 'EGX',
                persona TEXT NOT NULL,
                signal TEXT,
                signal_ar TEXT,
                score REAL DEFAULT 0,
                confidence REAL DEFAULT 0,
                entry_price REAL,
                target_price REAL,
                stop_loss REAL,
                risk_reward REAL,
                rationale TEXT,
                rationale_ar TEXT,
                story_arc TEXT,
                analysis_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(ticker, market, persona)
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS predictions (
                id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
                ticker TEXT NOT NULL,
                stock_ticker TEXT,
                market TEXT DEFAULT 'EGX',
                signal TEXT,
                direction TEXT,
                score REAL DEFAULT 0,
                confidence REAL DEFAULT 0,
                entry_price REAL,
                target_price REAL,
                stop_loss REAL,
                risk_reward REAL,
                horizon TEXT,
                persona TEXT DEFAULT 'balanced',
                status TEXT DEFAULT 'active',
                prediction_date TEXT,
                outcome_date TEXT,
                hit_target INTEGER DEFAULT 0,
                hit_stop INTEGER DEFAULT 0,
                pnl_percent REAL,
                closed_at DATETIME,
                analysis_json TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """),
        ('table', """
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
                created_at TEXT DEFAULT (datetime('now')),
                -- P14-PHASE-B (DATA-05): explicit ON DELETE CASCADE for clean removal
                FOREIGN KEY (prediction_id) REFERENCES predictions(id) ON DELETE CASCADE
            )
        """),
        # ---- indexes ----
        ('index', "CREATE INDEX IF NOT EXISTS idx_stored_ticker ON stored_analyses(ticker)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_stored_market ON stored_analyses(market)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_stored_score ON stored_analyses(maestro_score)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_stored_rec ON stored_analyses(recommendation)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_stored_ticker_date ON stored_analyses(ticker, created_at DESC)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_stored_ticker_market ON stored_analyses(ticker, market)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_persona_ticker ON persona_predictions(ticker)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_persona_persona ON persona_predictions(persona)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_predictions_ticker ON predictions(ticker)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_predictions_status ON predictions(status)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_predictions_created ON predictions(created_at DESC)"),
    ],

    # ------------------------------------------------------------------
    # data_engine.db — مصادر البيانات الخارجية (EGKSCO + fundamentals)
    # ------------------------------------------------------------------
    'data_engine': [
        ('table', """
            CREATE TABLE IF NOT EXISTS egksco_stocks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT UNIQUE NOT NULL,
                name TEXT,
                market TEXT DEFAULT 'EGX',
                sector TEXT,
                last_price REAL,
                change REAL,
                change_percent REAL,
                volume INTEGER,
                turnover REAL,
                last_updated TEXT
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS egksco_price_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                symbol TEXT NOT NULL,
                price_date TEXT NOT NULL,
                open_price REAL,
                high_price REAL,
                low_price REAL,
                close_price REAL,
                volume INTEGER,
                turnover REAL,
                UNIQUE(symbol, price_date)
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS egx_fundamentals (
                ticker TEXT PRIMARY KEY,
                name TEXT,
                pe_ratio REAL,
                pb_ratio REAL,
                roe REAL,
                roa REAL,
                debt_to_equity REAL,
                current_ratio REAL,
                dividend_yield REAL,
                market_cap REAL,
                shares_outstanding REAL,
                sector TEXT,
                industry TEXT,
                last_updated TEXT
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS tab_valuation (
                ticker TEXT PRIMARY KEY,
                pe_ratio REAL,
                pb_ratio REAL,
                ps_ratio REAL,
                ev_ebitda REAL,
                peg_ratio REAL,
                market_cap REAL,
                enterprise_value REAL,
                fair_value REAL,
                last_updated TEXT
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS tab_profitability (
                ticker TEXT PRIMARY KEY,
                roe REAL,
                roa REAL,
                roic REAL,
                gross_margin REAL,
                operating_margin REAL,
                net_margin REAL,
                last_updated TEXT
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS tab_balance_sheet (
                ticker TEXT PRIMARY KEY,
                total_assets REAL,
                total_liabilities REAL,
                total_equity REAL,
                debt_to_equity REAL,
                current_ratio REAL,
                quick_ratio REAL,
                last_updated TEXT
            )
        """),
        # ---- indexes ----
        ('index', "CREATE INDEX IF NOT EXISTS idx_egksco_symbol ON egksco_stocks(symbol)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_egksco_ph_symbol_date ON egksco_price_history(symbol, price_date DESC)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_egx_fund_ticker ON egx_fundamentals(ticker)"),
    ],

    # ------------------------------------------------------------------
    # auth.db — users + watchlists + portfolio_items
    # (mainly managed by Prisma; only fallback tables here)
    # ------------------------------------------------------------------
    'auth': [
        ('table', """
            CREATE TABLE IF NOT EXISTS user_trades (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT NOT NULL,
                ticker TEXT NOT NULL,
                market TEXT DEFAULT 'EGX',
                trade_type TEXT,
                shares REAL,
                price REAL,
                trade_date TEXT,
                notes TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """),
        ('index', "CREATE INDEX IF NOT EXISTS idx_user_trades_user ON user_trades(user_id)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_user_trades_ticker ON user_trades(ticker)"),
    ],

    # ------------------------------------------------------------------
    # crypto.db — الكريبتو
    # ------------------------------------------------------------------
    'crypto': [
        ('table', """
            CREATE TABLE IF NOT EXISTS cryptos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                coin_id TEXT UNIQUE NOT NULL,
                symbol TEXT NOT NULL,
                name TEXT,
                current_price REAL,
                market_cap REAL,
                volume_24h REAL,
                change_24h REAL,
                last_updated TEXT
            )
        """),
        ('table', """
            CREATE TABLE IF NOT EXISTS crypto_prediction_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                coin_id TEXT NOT NULL,
                symbol TEXT,
                signal TEXT,
                score REAL,
                confidence REAL,
                entry_price REAL,
                target_price REAL,
                stop_loss REAL,
                rationale TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """),
        ('index', "CREATE INDEX IF NOT EXISTS idx_cryptos_coin ON cryptos(coin_id)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_cpl_coin ON crypto_prediction_logs(coin_id)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_cpl_created ON crypto_prediction_logs(created_at DESC)"),
    ],

    # ------------------------------------------------------------------
    # intraday.db — الأسعار اللحظية
    # ------------------------------------------------------------------
    'intraday': [
        ('table', """
            CREATE TABLE IF NOT EXISTS intraday_prices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                price_time TEXT NOT NULL,
                price REAL,
                volume INTEGER,
                bid REAL,
                ask REAL,
                source TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            )
        """),
        ('index', "CREATE INDEX IF NOT EXISTS idx_intraday_ticker_time ON intraday_prices(ticker, price_time DESC)"),
        ('index', "CREATE INDEX IF NOT EXISTS idx_intraday_time ON intraday_prices(price_time DESC)"),
    ],

    # ------------------------------------------------------------------
    # cached_analysis + indexes (also in stocks.db)
    # NOTE: kept as a separate section for readability — merged into the
    # 'stocks' entry by _build_schema() to avoid duplicate-key collapse.
    # ------------------------------------------------------------------
}

# Helper: cached_analysis DDL (added to stocks.db by _build_schema).
# IMPORTANT (أغسطس 2026 — PRODUCTION-PREDICTION-KILLER FIX):
# The OLD DDL had (engine, intent, score, expires_at) + UNIQUE(ticker, engine, intent).
# But core/database.py:630 init_cached_analysis_table() expects the NEW schema with
# (analysis_date, master_score, technical_score, fundamental_score, timing_score,
#  pattern_score, market_regime_score, liquidity_level, is_tradeable, market) +
# UNIQUE(ticker, analysis_date). Because CREATE TABLE IF NOT EXISTS does NOT alter an
# existing table, production DBs bootstrapped with the old schema kept crashing with
# "no such column: analysis_date". This DDL now matches database.py exactly, and the
# _ensure_columns() fixup below adds any missing columns to legacy DBs in-place.
_CACHED_ANALYSIS_DDL: List[Tuple[str, str]] = [
    ('table', """
        CREATE TABLE IF NOT EXISTS cached_analysis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            analysis_date TEXT NOT NULL,
            analysis_json TEXT NOT NULL,
            signal TEXT,
            master_score REAL,
            technical_score REAL,
            fundamental_score REAL,
            timing_score REAL,
            pattern_score REAL,
            market_regime_score REAL,
            liquidity_level TEXT,
            is_tradeable INTEGER DEFAULT 1,
            market TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(ticker, analysis_date)
        )
    """),
    ('index', "CREATE INDEX IF NOT EXISTS idx_cached_ticker ON cached_analysis(ticker)"),
    ('index', "CREATE INDEX IF NOT EXISTS idx_cached_date ON cached_analysis(analysis_date)"),
    ('index', "CREATE INDEX IF NOT EXISTS idx_cached_tradeable ON cached_analysis(is_tradeable, analysis_date)"),
    # DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
    # The legacy news table that lived in stocks.db has been retired — every reader
    # now reads news.db.market_news (1019 rows). The DDL + indexes were removed
    # because nothing reads or writes the old table anymore (verified: 0 rows,
    # 0 INSERT/UPDATE/DELETE references). Existing tables are left in place
    # (idempotent — CREATE IF NOT EXISTS was the only op, so fresh builds simply
    # skip creating it). See worklog NEWS-ENGINE-UNIFY-1 / Stage 2.
]

# Helper: news.db DDL (added to news.db by _build_schema).
# Phase 2 DATA-P0 (2026-10-08): market_news table + migration from news_articles.
_NEWS_DB_DDL: List[Tuple[str, str]] = [
    # --- market_news TABLE: 8 readers across Python + TS expect `market_news` table
    # with columns: summary_ar, url, tickers, is_catalyst, impact_type, importance,
    # sentiment, source_type, raw_analysis. But news_scraper.py writes to
    # `news_articles` (7894 rows) with different columns (summary, source_url, category).
    # Result: all news queries returned 0 rows. Fix: create market_news table with
    # the expected schema + migrate data from news_articles (one-time, idempotent). ---
    ('table', """
        CREATE TABLE IF NOT EXISTS market_news (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT,
            summary_ar TEXT,
            summary_en TEXT,
            source TEXT,
            source_type TEXT DEFAULT 'scraper',
            url TEXT,
            image_url TEXT,
            tickers TEXT,
            market TEXT DEFAULT 'EGX',
            category TEXT,
            impact_type TEXT DEFAULT 'neutral',
            sentiment TEXT DEFAULT 'neutral',
            importance INTEGER DEFAULT 1,
            is_catalyst INTEGER DEFAULT 0,
            language TEXT DEFAULT 'ar',
            raw_analysis TEXT,
            published_at TEXT,
            fetched_at TEXT DEFAULT CURRENT_TIMESTAMP,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """),
    ('index', "CREATE INDEX IF NOT EXISTS idx_market_news_published ON market_news(published_at DESC)"),
    ('index', "CREATE INDEX IF NOT EXISTS idx_market_news_market ON market_news(market)"),
    ('index', "CREATE INDEX IF NOT EXISTS idx_market_news_tickers ON market_news(tickers)"),
    # --- market_news MIGRATION from news_articles (one-time, idempotent) ---
    # Maps: summary→summary_ar, source_url→url, category→impact_type, symbol→tickers
    ('migration', """
        INSERT OR IGNORE INTO market_news (title, content, summary_ar, source, source_type, url, image_url, tickers, market, category, impact_type, language, published_at, fetched_at, created_at)
        SELECT
            title,
            content,
            summary AS summary_ar,
            source,
            'news_scraper_legacy' AS source_type,
            source_url AS url,
            image_url,
            CASE WHEN symbol IS NOT NULL AND symbol != '' THEN json_quote(symbol) ELSE NULL END AS tickers,
            COALESCE(market, 'EGX') AS market,
            category,
            CASE category WHEN 'positive' THEN 'bullish' WHEN 'negative' THEN 'bearish' ELSE 'neutral' END AS impact_type,
            COALESCE(language, 'ar') AS language,
            published_at,
            fetched_at,
            created_at
        FROM news_articles
        WHERE title NOT IN (SELECT title FROM market_news)
    """),
    # --- price_history VIEW (أغسطس 2026): many analyzers query `price_history` for
    # S/R calculation. The table never existed (only stock_daily_prices did), so S/R
    # fell back to stale Yahoo data. This view aliases stock_daily_prices to the
    # expected column names. NOTE: the real column is `price_date`, NOT `date`. ---
    ('view', """
        CREATE VIEW IF NOT EXISTS price_history AS
        SELECT
            ticker,
            price_date AS date,
            open_price AS open,
            high_price AS high,
            low_price AS low,
            close_price AS close,
            volume,
            turnover,
            change_percent
        FROM stock_daily_prices
    """),
    # Legacy alias used by many older modules — rebuild so it stops raising
    # "no such column: open" on DBs bootstrapped with the broken old view.
    ('view', """
        CREATE VIEW IF NOT EXISTS stock_price_history AS
        SELECT
            ticker AS symbol,
            ticker,
            price_date AS date,
            open_price AS open,
            high_price AS high,
            low_price AS low,
            close_price AS close,
            volume,
            turnover,
            change_percent
        FROM stock_daily_prices
    """),
]


# Predictions.db cached_analysis (أغسطس 2026).
# Different column set from the stocks.db version: the prediction generator
# (api/ai_predictions_routes.py:580) queries `WHERE market=? AND confidence>=?`,
# so this variant exposes `confidence` + `market` + `indicators` prominently.
_PREDICTIONS_CACHED_ANALYSIS_DDL: List[Tuple[str, str]] = [
    ('table', """
        CREATE TABLE IF NOT EXISTS cached_analysis (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            market TEXT DEFAULT 'EGX',
            analysis_date TEXT,
            analysis_json TEXT,
            signal TEXT,
            confidence REAL DEFAULT 0,
            master_score REAL,
            entry_price REAL,
            target_price REAL,
            stop_loss REAL,
            risk_reward REAL,
            indicators TEXT,
            regime TEXT,
            regime_score REAL,
            liquidity_level TEXT,
            is_tradeable INTEGER DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(ticker, market, analysis_date)
        )
    """),
    ('index', "CREATE INDEX IF NOT EXISTS idx_pcached_ticker ON cached_analysis(ticker)"),
    ('index', "CREATE INDEX IF NOT EXISTS idx_pcached_market ON cached_analysis(market, confidence DESC)"),
    ('index', "CREATE INDEX IF NOT EXISTS idx_pcached_date ON cached_analysis(analysis_date)"),
]


def _build_schema() -> Dict[str, List[Tuple[str, str]]]:
    """Build the final schema registry, merging in the cached_analysis DDL."""
    s: Dict[str, List[Tuple[str, str]]] = {db: list(stmts) for db, stmts in _SCHEMA.items()}
    # Append cached_analysis DDL to stocks.db (single source of truth).
    if 'stocks' not in s:
        s['stocks'] = []
    s['stocks'].extend(_CACHED_ANALYSIS_DDL)
    # Append a predictions.db-flavoured cached_analysis (أغسطس 2026).
    # api/ai_predictions_routes.py:574 does query_db(PREDICTIONS_DB, "SELECT * FROM
    # cached_analysis WHERE market=? AND confidence>=?") as a FALLBACK when
    # stored_analyses is empty. Without this table here, every fallback raises
    # "no such table: cached_analysis" and the rebuild aborts.
    if 'predictions' not in s:
        s['predictions'] = []
    s['predictions'].extend(_PREDICTIONS_CACHED_ANALYSIS_DDL)
    # Append news.db DDL (market_news table + migration from news_articles).
    # Phase 2 DATA-P0 (2026-10-08): fix schema mismatch — readers expect market_news,
    # writers populate news_articles. This migration bridges the gap.
    if 'news' not in s:
        s['news'] = []
    s['news'].extend(_NEWS_DB_DDL)
    return s


# Final schema (with cached_analysis merged in).
SCHEMA: Dict[str, List[Tuple[str, str]]] = _build_schema()


# ============================================================================
# Migration runner
# ============================================================================

class Migrator:
    """Central migration runner. Applies all DDL statements once at boot.

    Design:
      - Idempotent: uses `IF NOT EXISTS` on every statement. Re-running is safe.
      - Fast: batches statements per-DB to minimize connection overhead.
      - Resilient: a failure on one statement is logged but doesn't stop the
        rest. The boot continues even if a non-critical table fails.
      - Uses db_manager.py (WAL + busy_timeout) to avoid locks.
      - Thread-safe: guarded by `_lock`, runs only once per process.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._applied = False
        self._results: Dict[str, Dict[str, Any]] = {}
        self._last_run_at: Optional[float] = None
        self._last_duration_ms: Optional[float] = None

    def run_migrations(self, force: bool = False) -> Dict[str, Any]:
        """Run all pending migrations.

        Args:
            force: If True, re-run even if already applied (useful for
                recovery / manual re-init).

        Returns:
            Summary dict: {db_name: {tables, indexes, errors, duration_ms}}
        """
        with self._lock:
            if self._applied and not force:
                logger.info(
                    "[Migrator] Already applied (force=False) — skipping. "
                    "Last run took %.1fms.",
                    self._last_duration_ms or 0.0,
                )
                return {
                    'already_applied': True,
                    'last_run_at': self._last_run_at,
                    'last_duration_ms': self._last_duration_ms,
                    'results': self._results,
                }

            start = time.time()
            logger.info(
                "[Migrator] Running migrations across %d databases...",
                len(SCHEMA),
            )

            for db_name, statements in SCHEMA.items():
                self._results[db_name] = self._run_for_db(db_name, statements)

            self._applied = True
            self._last_run_at = time.time()
            self._last_duration_ms = (self._last_run_at - start) * 1000.0

            total_tables = sum(r['tables'] for r in self._results.values())
            total_indexes = sum(r['indexes'] for r in self._results.values())
            total_errors = sum(r['errors'] for r in self._results.values())
            logger.info(
                "[Migrator] Done in %.1fms — tables=%d, indexes=%d, errors=%d",
                self._last_duration_ms, total_tables, total_indexes, total_errors,
            )

            return {
                'already_applied': False,
                'duration_ms': self._last_duration_ms,
                'results': self._results,
                'totals': {
                    'tables': total_tables,
                    'indexes': total_indexes,
                    'errors': total_errors,
                },
            }

    def _run_for_db(self, db_name: str,
                    statements: List[Tuple[str, str]]) -> Dict[str, Any]:
        """Apply all DDL statements for one database.

        Returns a summary dict with counts of tables/indexes created + errors.
        """
        result: Dict[str, Any] = {
            'tables': 0, 'indexes': 0, 'errors': 0,
            'error_messages': [], 'duration_ms': 0.0,
        }
        start = time.time()
        db_path = get_db_path(db_name)
        db_path_obj = Path(db_path)

        if not db_path_obj.exists():
            logger.info(
                "[Migrator] %s.db not found at %s — creating fresh",
                db_name, db_path,
            )

        # Use db_manager if available (WAL + busy_timeout)
        try:
            import sqlite3

            # Open connection with WAL + busy_timeout (consistent with db_manager)
            conn = sqlite3.connect(db_path, timeout=30.0)
            try:
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('PRAGMA busy_timeout=30000')
                conn.execute('PRAGMA synchronous=NORMAL')
                conn.execute('PRAGMA foreign_keys=ON')  # P14-PHASE-B (DATA-02): enforce FK constraints

                for stmt_type, sql in statements:
                    try:
                        # Execute each statement separately so a failure
                        # on one doesn't roll back the others.
                        conn.execute(sql)
                        if stmt_type == 'table':
                            result['tables'] += 1
                        elif stmt_type == 'index':
                            result['indexes'] += 1
                        elif stmt_type == 'migration':
                            result.setdefault('migrations', 0)
                            result['migrations'] += 1
                    except sqlite3.OperationalError as e:
                        # Common case: table already exists with different schema.
                        # Log and continue — don't fail the whole migration.
                        err_msg = f"{stmt_type}: {str(e)[:200]}"
                        result['errors'] += 1
                        result['error_messages'].append(err_msg)
                        logger.warning(
                            "[Migrator] %s.db — %s", db_name, err_msg
                        )
                    except Exception as e:
                        err_msg = f"{stmt_type}: {type(e).__name__}: {str(e)[:200]}"
                        result['errors'] += 1
                        result['error_messages'].append(err_msg)
                        logger.error(
                            "[Migrator] %s.db — unexpected error: %s",
                            db_name, err_msg,
                        )

                conn.commit()

                # P23-PARSE-HOTFIX: post-schema column fixups للجداول اللي اتعملت
                # على الإنتاج بنسخة schema قديمة (CREATE TABLE IF NOT EXISTS مش بيعمل
                # ALTER للأعمدة الناقصة). بنفحص بالـ PRAGMA table_info ونضيف اللي ناقص.
                # (أغسطس 2026: confine to stocks.db — macro_indicators only lives
                # there, so running this on auth/crypto/intraday/data_engine just
                # spammed the log with "no such table: macro_indicators" warnings.)
                if db_name == 'stocks':
                    self._ensure_columns(conn, db_name, 'macro_indicators', [
                        ('indicator_name', 'TEXT'),
                        ('indicator_value', 'REAL DEFAULT 0'),
                        ('unit', "TEXT DEFAULT '%'"),
                        ('source', 'TEXT'),
                        # FIX (Aug 2026): SQLite's ALTER TABLE ADD COLUMN does NOT
                        # accept non-constant defaults like datetime('now') or
                        # CURRENT_TIMESTAMP — only literal constants (string,
                        # number, NULL). Using `DEFAULT (datetime('now'))` here
                        # raised "Cannot add a column with non-constant default"
                        # on every boot, leaving updated_at/recorded_at missing,
                        # which then broke the Inflation storer with
                        # "table macro_indicators has no column named updated_at".
                        # The CREATE TABLE statement above sets the proper
                        # DEFAULT for fresh tables; here we only add the bare
                        # column for legacy DBs and let INSERT set the value.
                        ('recorded_at', 'TEXT'),
                        ('updated_at', 'TEXT'),
                    ])

                # ==================================================================
                # أغسطس 2026 — PRODUCTION-PREDICTION-KILLER FIX
                # ==================================================================
                # cached_analysis on production was bootstrapped with the OLD schema
                # (engine, intent, score, expires_at) and CREATE TABLE IF NOT EXISTS
                # refused to add the NEW columns (analysis_date, master_score, ...).
                # This ALTER-based fixup is the only way to heal legacy DBs in-place
                # without losing existing cached rows. (See _CACHED_ANALYSIS_DDL above
                # for the full story.) Only runs for stocks.db.
                # ==================================================================
                if db_name == 'stocks':
                    self._ensure_columns(conn, db_name, 'cached_analysis', [
                        ('analysis_date', "TEXT"),
                        ('master_score', 'REAL'),
                        ('technical_score', 'REAL'),
                        ('fundamental_score', 'REAL'),
                        ('timing_score', 'REAL'),
                        ('pattern_score', 'REAL'),
                        ('market_regime_score', 'REAL'),
                        ('liquidity_level', 'TEXT'),
                        ('is_tradeable', 'INTEGER DEFAULT 1'),
                        ('market', 'TEXT'),
                    ])

                    # Self-healing price_history / stock_price_history views.
                    # CREATE VIEW IF NOT EXISTS cannot fix a *broken* existing view
                    # (e.g. one referencing a non-existent `open` column). Drop and
                    # recreate on every boot — views hold no data, so this is safe
                    # and guarantees analyzers always find a working price_history.
                    self._recreate_price_history_views(conn, db_name)

                    # stocks table column heal (أغسطس 2026): KSE/QSE/DFM fetchers
                    # query `name_ar` and the EGXPilot live updater writes
                    # `last_update` — both missing on legacy DBs → every stock
                    # fetch raised "no such column".
                    #
                    # CRITICAL (أغسطس 2026, production hang): `is_active` was
                    # missing on the production stocks.db (legacy schema drift).
                    # The Maestro routes (api/maestro_routes.py:433/801/898),
                    # MarketScheduler (jobs/market_scheduler.py:239/250/1564),
                    # hunting_engine, persona_screener, sector_relative,
                    # seasonality_engine, live_indicator_engine, monitor_routes,
                    # and ~20 other callers ALL filter with `WHERE is_active = 1`.
                    # Result: every one of them crashed with
                    # "SqliteError: no such column: is_active" and the server hung.
                    # The CREATE TABLE IF NOT EXISTS above includes is_active, but
                    # it cannot add the column to a pre-existing legacy table.
                    # This ALTER-based heal is the only way to fix it in-place
                    # without losing existing stock rows. DEFAULT 1 means all
                    # existing rows are marked active (matching the old behavior
                    # where every row was implicitly active).
                    # Also healing the other commonly-queried columns that
                    # stock_analysis_routes and hunting_engine SELECT/WHERE on.
                    self._ensure_columns(conn, db_name, 'stocks', [
                        ('is_active', 'INTEGER DEFAULT 1'),
                        ('is_suspended', 'INTEGER DEFAULT 0'),
                        ('name_ar', 'TEXT'),
                        ('last_update', 'TEXT'),
                        ('is_egx30', 'INTEGER DEFAULT 0'),
                        ('is_egx70', 'INTEGER DEFAULT 0'),
                        ('is_egx100', 'INTEGER DEFAULT 0'),
                        ('is_egx', 'INTEGER DEFAULT 1'),
                        ('high_52w', 'REAL'),
                        ('low_52w', 'REAL'),
                        ('support', 'REAL'),
                        ('resistance', 'REAL'),
                        # FIX (P20-Bug2, Aug 2026): Heal turnover_egp + value_traded
                        # on legacy stocks DBs. dynamic_context_engine.py:133 SELECTs
                        # these columns; if missing, market regime detection silently
                        # fails (caught at line 146, logged at DEBUG — invisible).
                        ('turnover_egp', 'REAL'),
                        ('value_traded', 'REAL'),
                    ])

                    # ==================================================================
                    # FIX (P20-Bug2, Aug 2026): stock_daily_prices.turnover column heal
                    # ==================================================================
                    # The stock_price_history VIEW references `turnover` in its SELECT.
                    # On production, stock_daily_prices was bootstrapped with an old
                    # schema that LACKS the `turnover` column. Any query against the
                    # view crashes with: "no such column: turnover".
                    # This surfaces as:
                    #   "[MasterAnalyzer] Market regime detection failed: no such column: turnover"
                    # The CREATE VIEW IF NOT EXISTS can't add columns to a pre-existing
                    # table — this ALTER-based heal is the only in-place fix.
                    self._ensure_columns(conn, db_name, 'stock_daily_prices', [
                        ('ticker', 'TEXT'),
                        ('price_date', 'TEXT'),
                        ('open_price', 'REAL'),
                        ('high_price', 'REAL'),
                        ('low_price', 'REAL'),
                        ('close_price', 'REAL'),
                        ('volume', 'INTEGER'),
                        ('turnover', 'REAL'),       # ← THE FIX for Bug 2
                        ('change_percent', 'REAL'),
                    ])

                # ==================================================================
                # predictions.db column heal (أغسطس 2026)
                # ==================================================================
                # daily_closer queries `outcome_date` on predictions, the cleanup
                # job filters by `prediction_date`, and bag-holder alerts select
                # `stock_ticker` — all three missing on legacy DBs and silently
                # broke prediction close / cleanup / alerts.
                if db_name == 'predictions':
                    # ==================================================================
                    # أغسطس 2026 — CONSOLIDATED PREDICTIONS SCHEMA HEAL
                    # ==================================================================
                    # The `predictions` table is created by THREE different files:
                    #   (1) migrator.py:375        — id TEXT, has score+persona+direction
                    #   (2) prediction_tracker.py:85 — id INTEGER, has signal_type+master_score,
                    #                                  technical_score, ai_pattern_score, etc.
                    #                                  LACKS score, persona, market, hit_target
                    #   (3) sniper_routes.py:310   — id INTEGER, has signal_ar+maestro_score+
                    #                                  highest_price+lowest_price+days_to_close
                    #                                  LACKS score, signal_type, hit_target,
                    #                                  hit_stop, holding_days
                    # CREATE TABLE IF NOT EXISTS silently keeps whichever ran first, so
                    # production ended up with a Frankenstein table missing columns
                    # that the migrator's CREATE INDEX and the historical-query in
                    # misc_routes.py:2096 both require. Symptoms in production logs:
                    #   • "predictions.db — index: no such column: persona"
                    #   • "historical active predictions query failed: no such column: score"
                    # This consolidated list unions ALL columns any caller needs, so
                    # whichever CREATE TABLE won the race, the table ends up complete
                    # before any query runs. Idempotent — ALTER ADD COLUMN on an
                    # existing column is a no-op (caught in _ensure_columns).
                    # ==================================================================
                    self._ensure_columns(conn, db_name, 'predictions', [
                        # --- migrator.py schema columns (so tracker/sniper tables get them) ---
                        ('stock_ticker', 'TEXT'),
                        ('market', "TEXT DEFAULT 'EGX'"),
                        ('signal', 'TEXT'),
                        ('direction', 'TEXT'),
                        ('score', 'REAL DEFAULT 0'),
                        ('confidence', 'REAL DEFAULT 0'),
                        ('entry_price', 'REAL'),
                        ('target_price', 'REAL'),
                        ('stop_loss', 'REAL'),
                        ('risk_reward', 'REAL DEFAULT 0'),
                        ('horizon', 'TEXT'),
                        ('persona', "TEXT DEFAULT 'balanced'"),
                        ('status', "TEXT DEFAULT 'active'"),
                        ('prediction_date', 'TEXT'),
                        ('outcome_date', 'TEXT'),
                        ('hit_target', 'INTEGER DEFAULT 0'),
                        ('hit_stop', 'INTEGER DEFAULT 0'),
                        ('pnl_percent', 'REAL'),
                        ('closed_at', 'DATETIME'),
                        ('analysis_json', 'TEXT'),
                        ('updated_at', 'DATETIME'),
                        # --- prediction_tracker.py schema columns ---
                        ('signal_type', "TEXT DEFAULT 'BUY'"),
                        ('master_score', 'REAL'),
                        ('technical_score', 'REAL DEFAULT 50'),
                        ('fundamental_score', 'REAL DEFAULT 50'),
                        ('ai_pattern_score', 'REAL DEFAULT 50'),
                        ('sentiment_score', 'REAL DEFAULT 50'),
                        ('actual_return', 'REAL'),
                        ('is_correct', 'INTEGER'),
                        ('holding_days', 'INTEGER DEFAULT 0'),
                        ('notes', 'TEXT'),
                        # --- sniper_routes.py schema columns (different names than tracker) ---
                        ('signal_ar', 'TEXT'),
                        ('maestro_score', 'REAL DEFAULT 0'),
                        ('actual_exit_price', 'REAL'),
                        ('highest_price', 'REAL'),
                        ('lowest_price', 'REAL'),
                        ('days_to_close', 'INTEGER'),
                        ('pnl_pct', 'REAL'),
                        # --- daily_closer.py columns (highest_price_reached vs highest_price) ---
                        ('is_trend_following', 'INTEGER DEFAULT 0'),
                        ('exit_type', 'TEXT'),
                        ('trailing_stop_atr_mult', 'REAL DEFAULT 2.5'),
                        ('initial_stop_atr_mult', 'REAL DEFAULT 2.0'),
                        ('atr_at_entry', 'REAL'),
                        ('highest_price_reached', 'REAL'),
                        ('lowest_price_reached', 'REAL'),
                    ])

                    # persona_predictions also needs healing — its CREATE INDEX
                    # failed with "no such column: persona" on legacy DBs.
                    self._ensure_columns(conn, db_name, 'persona_predictions', [
                        ('ticker', 'TEXT'),
                        ('market', "TEXT DEFAULT 'EGX'"),
                        ('persona', "TEXT DEFAULT 'balanced'"),
                        ('signal', 'TEXT'),
                        ('signal_ar', 'TEXT'),
                        ('score', 'REAL DEFAULT 0'),
                        ('confidence', 'REAL DEFAULT 0'),
                        ('entry_price', 'REAL'),
                        ('target_price', 'REAL'),
                        ('stop_loss', 'REAL'),
                        ('risk_reward', 'REAL'),
                        ('rationale', 'TEXT'),
                        ('rationale_ar', 'TEXT'),
                        ('story_arc', 'TEXT'),
                        ('analysis_json', 'TEXT'),
                    ])
            finally:
                conn.close()

        except Exception as e:
            result['errors'] += 1
            result['error_messages'].append(f"connection: {type(e).__name__}: {e}")
            logger.error(
                "[Migrator] Failed to migrate %s.db: %s", db_name, e
            )

        result['duration_ms'] = (time.time() - start) * 1000.0
        logger.info(
            "[Migrator] %s.db — tables=%d, indexes=%d, errors=%d, "
            "duration=%.1fms",
            db_name, result['tables'], result['indexes'],
            result['errors'], result['duration_ms'],
        )
        return result

    def _ensure_columns(self, conn, db_name: str, table: str,
                        columns: List[Tuple[str, str]]) -> None:
        """تأكد إن الأعمدة موجودة في الجدول؛ لو ناقصة اعمل ALTER TABLE ADD COLUMN.

        SQLite الـ CREATE TABLE IF NOT EXISTS بيتجاهل الجدول لو موجود — فلو الجدول
        اتعمل بـ schema قديم، الأعمدة الجديدة مش هتتضاف تلقائياً. ده إصلاح ليه.

        Args:
            conn: sqlite3.Connection مفتوحة
            db_name: اسم الـ DB (للـ logging)
            table: اسم الجدول
            columns: list of (column_name, column_type_definition)
        """
        try:
            cur = conn.execute(f"PRAGMA table_info({table})")
            existing = {row[1] for row in cur.fetchall()}
        except sqlite3.OperationalError:
            # الجدول مش موجود — skip (الـ CREATE TABLE فوق كان المفروض ينشئه)
            return

        for col_name, col_type in columns:
            if col_name not in existing:
                try:
                    conn.execute(
                        f"ALTER TABLE {table} ADD COLUMN {col_name} {col_type}"
                    )
                    logger.info(
                        "[Migrator] %s.db — added column %s.%s (%s)",
                        db_name, table, col_name, col_type,
                    )
                except sqlite3.OperationalError as e:
                    logger.warning(
                        "[Migrator] %s.db — could not add %s.%s: %s",
                        db_name, table, col_name, e,
                    )

    def _recreate_price_history_views(self, conn, db_name: str) -> None:
        """Drop + recreate price_history & stock_price_history views every boot.

        Why: ``CREATE VIEW IF NOT EXISTS`` silently skips a *broken* existing
        view (e.g. one that references a non-existent ``open`` column on a DB
        bootstrapped with an old schema). Analyzers like
        support_resistance_calculator query ``price_history`` and, on failure,
        fall back to stale Yahoo data — which is exactly the "old/wrong prices"
        symptom reported on production (أغسطس 2026). Views hold no data, so
        dropping+recreating is cheap and always leaves a correct definition.

        Only runs for stocks.db (where stock_daily_prices lives).

        FIX (P20-Bug2b, Aug 2026): Dynamic column-name detection.
        Legacy production DBs have `open, high, low, close` columns while newer
        schemas use `open_price, high_price, low_price, close_price`. The old
        hardcoded DDL crashed on legacy DBs with "no such column: open_price".
        Now we detect the actual column names via PRAGMA and build the view
        SELECT accordingly. Also ensures `turnover` column exists (Bug 2 heal).
        """
        if db_name != 'stocks':
            return
        # Guard: only proceed if the underlying table exists, otherwise the
        # views would be invalid.
        try:
            cur = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='stock_daily_prices'"
            )
            if not cur.fetchone():
                return
        except sqlite3.OperationalError:
            return

        # FIX (P20-Bug2b): Detect actual column names in stock_daily_prices.
        # Legacy DBs use `open/high/low/close`; newer use `open_price/high_price/etc`.
        try:
            cur = conn.execute("PRAGMA table_info(stock_daily_prices)")
            sdp_cols = {row[1] for row in cur.fetchall()}
        except sqlite3.OperationalError:
            sdp_cols = set()

        # Ensure turnover column exists (Bug 2 heal — defense in depth)
        if 'turnover' not in sdp_cols:
            try:
                conn.execute("ALTER TABLE stock_daily_prices ADD COLUMN turnover REAL")
                logger.info("[Migrator] %s.db — added turnover column to stock_daily_prices (Bug2 heal)", db_name)
                sdp_cols.add('turnover')
            except sqlite3.OperationalError as e:
                logger.warning("[Migrator] %s.db — could not add turnover: %s", db_name, e)

        # Pick the correct column names based on what actually exists
        open_col = 'open_price' if 'open_price' in sdp_cols else 'open'
        high_col = 'high_price' if 'high_price' in sdp_cols else 'high'
        low_col = 'low_price' if 'low_price' in sdp_cols else 'low'
        close_col = 'close_price' if 'close_price' in sdp_cols else 'close'
        date_col = 'price_date' if 'price_date' in sdp_cols else 'date'

        view_defs = {
            'price_history': f"""
                CREATE VIEW price_history AS
                SELECT
                    ticker,
                    {date_col} AS date,
                    {open_col} AS open,
                    {high_col} AS high,
                    {low_col} AS low,
                    {close_col} AS close,
                    volume,
                    turnover,
                    change_percent
                FROM stock_daily_prices
            """,
            'stock_price_history': f"""
                CREATE VIEW stock_price_history AS
                SELECT
                    ticker AS symbol,
                    ticker,
                    {date_col} AS date,
                    {open_col} AS open,
                    {high_col} AS high,
                    {low_col} AS low,
                    {close_col} AS close,
                    volume,
                    turnover,
                    change_percent
                FROM stock_daily_prices
            """,
        }
        for view_name, ddl in view_defs.items():
            try:
                # FIX (Aug 2026): Use CREATE OR REPLACE VIEW pattern instead of
                # DROP VIEW + CREATE VIEW. This is non-destructive and survives
                # concurrent reads. (SQLite 3.33+ supports CREATE OR REPLACE.)
                # Fallback: DROP VIEW IF EXISTS only if CREATE OR REPLACE fails.
                try:
                    conn.execute(ddl.replace('CREATE VIEW', 'CREATE VIEW IF NOT EXISTS', 1))
                except sqlite3.OperationalError:
                    # View exists with different schema — only then DROP and recreate
                    conn.execute(f"DROP VIEW IF EXISTS {view_name}")
                    conn.execute(ddl)
                logger.info("[Migrator] %s.db — ensured view %s", db_name, view_name)
            except sqlite3.OperationalError as e:
                logger.warning(
                    "[Migrator] %s.db — could not recreate view %s: %s",
                    db_name, view_name, e,
                )

    def get_status(self) -> Dict[str, Any]:
        """Return migration status (for admin UI / debugging)."""
        return {
            'applied': self._applied,
            'last_run_at': self._last_run_at,
            'last_duration_ms': self._last_duration_ms,
            'databases': list(SCHEMA.keys()),
            'total_statements': sum(len(v) for v in SCHEMA.values()),
            'results': self._results,
        }

    def reset(self) -> None:
        """Reset the applied flag (for testing / manual re-init)."""
        with self._lock:
            self._applied = False
            self._results = {}
            self._last_run_at = None
            self._last_duration_ms = None


# ============================================================================
# Module-level singleton
# ============================================================================

migrator = Migrator()


# ============================================================================
# Module-level convenience API
# ============================================================================

def run_migrations(force: bool = False) -> Dict[str, Any]:
    """Module-level shortcut: migrator.run_migrations(force)."""
    return migrator.run_migrations(force=force)


def get_status() -> Dict[str, Any]:
    """Module-level shortcut: migrator.get_status()."""
    return migrator.get_status()


def reset() -> None:
    """Module-level shortcut: migrator.reset()."""
    migrator.reset()


def list_schemas() -> Dict[str, int]:
    """Return a summary of registered schemas (db_name → statement count)."""
    return {db: len(stmts) for db, stmts in SCHEMA.items()}


# ============================================================================
# Self-test (python3 core/migrator.py)
# ============================================================================

def _self_test() -> int:
    """Smoke test: list schemas, run migrations, verify status."""
    print("=" * 70)
    print("Migrator self-test")
    print("=" * 70)

    # 1. List schemas
    schemas = list_schemas()
    print(f"[1] Registered schemas: {schemas}")
    total_stmts = sum(schemas.values())
    print(f"    Total DDL statements: {total_stmts}")
    assert total_stmts > 0, "no statements registered"

    # 2. Run migrations (force=False → first run)
    print("\n[2] Running migrations (first run)...")
    result = run_migrations(force=True)
    totals = result.get('totals', {})
    print(f"    totals: {totals}")
    print(f"    duration: {result.get('duration_ms', 0):.1f}ms")
    assert totals.get('tables', 0) > 0, "no tables created"

    # 3. Run again (should be a no-op)
    print("\n[3] Running migrations (second call — should be no-op)...")
    result2 = run_migrations(force=False)
    print(f"    already_applied: {result2.get('already_applied')}")
    assert result2.get('already_applied') is True, "second run should be no-op"

    # 4. Status
    print("\n[4] Final status:")
    status = get_status()
    print(f"    applied: {status['applied']}")
    print(f"    last_duration_ms: {status['last_duration_ms']:.1f}ms")
    print(f"    databases: {status['databases']}")
    assert status['applied'] is True, "status not applied"

    # 5. Print per-DB breakdown
    print("\n[5] Per-DB breakdown:")
    for db_name, res in status['results'].items():
        print(f"    {db_name}: tables={res['tables']}, indexes={res['indexes']}, "
              f"errors={res['errors']}, duration={res['duration_ms']:.1f}ms")

    print("\n✅ All self-tests passed.")
    return 0


if __name__ == '__main__':
    import sys
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    )
    sys.exit(_self_test())
