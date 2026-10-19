"""
db_paths.py — Single source of truth لكل مسارات قواعد البيانات
================================================================
PHASE-4-DB-REORG (2026-08-29): إعادة هيكلة لـ 4 قواعد بيانات فقط

التصميم الجديد:
    1. market.db      — كل بيانات السوق والأسعار والميتاداتا والأساسيات
    2. predictions.db  — كل التوقعات والتعلم والنتائج والمحفظة
    3. auth.db         — المستخدمين والاشتراكات والصلاحيات
    4. content.db      — الأخبار والتليجرام والمحتوى

القواعد القديمة (19) تم دمجها في الـ 4 أعلاه. المسارات القديمة
تظل تعمل (backward compat) عبر aliasing للمسار الجديد.

الاستخدام:
    from utils.db_paths import DBPaths
    conn = sqlite3.connect(DBPaths.MARKET_DB)
    conn = sqlite3.connect(DBPaths.PREDICTIONS_DB)
    conn = sqlite3.connect(DBPaths.AUTH_DB)
    conn = sqlite3.connect(DBPaths.CONTENT_DB)

مبدأ التصميم:
    - المسار الافتراضي = <project_root>/db/<name>.db
    - env override له الأولوية دايماً
    - كل كود يستخدم DBPaths (مش hardcoded paths)
"""
from __future__ import annotations

import os
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_DB_DIR = Path(os.environ.get("DB_DIR", _PROJECT_ROOT / "db"))


def _resolve(env_key: str, default_name: str) -> str:
    """ارجع مسار DB: env var لو موجود، иначе <DB_DIR>/<default_name>."""
    env_val = os.environ.get(env_key)
    if env_val:
        return str(Path(env_val).resolve())
    return str(_DB_DIR / default_name)


class DBPaths:
    """كل مسارات قواعد البيانات — 4 قواعد فقط."""

    DB_DIR: str = str(_DB_DIR)
    PROJECT_ROOT: str = str(_PROJECT_ROOT)

    # ═══════════════════════════════════════════════════════════════
    # الـ 4 قواعد المعتمدة (PHASE-4-DB-REORG)
    # ═══════════════════════════════════════════════════════════════

    # 1. market.db — بيانات السوق والأسعار والميتاداتا والأساسيات
    #    يحتوي على: egksco_price_history, stock_daily_prices, stock_intraday,
    #    crypto_intraday, crypto_prices, gold_prices, exchange_rates, stocks,
    #    tab_* (fundamentals), screener_*, market_indices, macro_indicators, etc.
    MARKET_DB: str = _resolve("MARKET_DB", "market.db")

    # 2. predictions.db — التوقعات والتعلم والنتائج
    #    يحتوي على: predictions, persona_predictions, outcome_logs,
    #    learned_lessons, conjunction_patterns, indicator_trust_scores,
    #    stored_analyses, morning_bell_signals, ExpertRecommendation, etc.
    PREDICTIONS_DB: str = _resolve("PREDICTIONS_DB", "predictions.db")

    # 3. auth.db — المستخدمين والاشتراكات
    #    يحتوي على: User, PromoCode, SubscriptionPlan, api_tokens,
    #    portfolios, portfolio_assets, user_stock_watchlists, etc.
    AUTH_DB: str = _resolve("AUTH_DB", "auth.db")

    # 4. content.db — الأخبار والمحتوى
    #    يحتوي على: market_news (renamed from news_articles per Rule 44),
    #    telegram_messages, telegram_news,
    #    telegram_recommendations, scraping_status, tracked_channels
    CONTENT_DB: str = _resolve("CONTENT_DB", "content.db")

    # ═══════════════════════════════════════════════════════════════
    # Backward compatibility aliases
    # ═══════════════════════════════════════════════════════════════
    # PHASE-2-DB-UNIFY (2026-08-29):
    # الـ 4-DB target architecture (market.db + predictions.db + auth.db + content.db) لم يكتمل
    # بعد على الإنتاج (market.db = 0 بايت). لحين اكتمال الـ migration، كل alias بـ points
    # لـ DBه الأصلي (اللي فيه بيانات حقيقية على الإنتاج):
    #   - price_history.db: 1,248,257 rows (25 سنة) — canonical price history
    #   - data_engine.db: fundamentals (tab_*) + crypto_prices + gold_prices + screener_lists
    #   - stocks.db: stocks metadata + stock_daily_prices (آخر 30 يوم) + screener_*
    #   - intraday.db: stock_intraday + crypto_intraday + commodity_intraday
    #
    # ملاحظة: market.db_alias = market.db (هدف نهائي)، بس دلوقتي الفاضي.
    #
    # P0-8-DB-UNIFY (2026-09-27): 9 duplicate tables dropped across the 4 DBs.
    # See agent-ctx/P0-8-DB-UNIFY-REPORT.md for the full per-table decisions.
    # Backups at db/<dbname>.db.bak-unify; dropped rows dumped to
    # scripts/output/db_unify_dropped_*.json. The canonical DB for each
    # consolidated table is encoded in get_db_for_table() below.

    # Canonical price history (1.24M rows, 25 سنة)
    PRICE_HISTORY_DB: str = _resolve("PRICE_HISTORY_DB", "price_history.db")

    # data_engine.db: fundamentals (tab_*) + live quotes (crypto, gold, exchange)
    DATA_ENGINE_DB: str = _resolve("DATA_ENGINE_DB", "data_engine.db")

    # stocks.db: stocks metadata + stock_daily_prices + screener
    STOCKS_DB: str = _resolve("STOCKS_DB", "stocks.db")

    # intraday.db: tick-level data (1.1M rows)
    INTRADAY_DB: str = _resolve("INTRADAY_DB", "intraday.db")

    # crypto.db: crypto-specific tables (legacy)
    CRYPTO_DB: str = _resolve("CRYPTO_DB", "crypto.db")

    # market.db: هدف نهائي (PHASE-4-DB-REORG) — لسه فاضي على الإنتاج
    MARKET_DB: str = _resolve("MARKET_DB", "market.db")

    # Aliases for legacy code (توجّه للـ canonical source — updated P0-8-DB-UNIFY 2026-09-27)
    GOLD_PRICES_DB: str = DATA_ENGINE_DB  # gold_prices — canonical: data_engine.db (187K rows). Dropped: stocks.db (3 stale rows).
    HISTORICAL_DB: str = DATA_ENGINE_DB   # historical_data (ticker format رقمي)
    # DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
    # Was STOCKS_DB (phantom — stocks.db has no market_news table, only an empty legacy table).
    # news.db.market_news is the canonical source (1019 rows, written by news-agent db_writer).
    NEWS_DB: str = _resolve("NEWS_DB", "news.db")
    COMMUNITY_DB: str = CONTENT_DB        # community tables in content.db
    ANALYTICS_DB: str = STOCKS_DB          # cached_analysis — canonical: stocks.db (143 rows). Dropped: predictions.db (0 rows, fallback-cache recreated by migrator).
    CRYPTO_LEARNING_DB: str = PREDICTIONS_DB  # crypto_learning tables in predictions.db

    # ─── BRAVO DATA-LAYER-1: canonical table names per domain (SSOT) ──────────
    # Added 2026-10-18 per owner directive. These replace the separate
    # canonical_sources.py file (merged here to respect existing architecture).
    PRICE_HISTORY_TABLE: str = "price_history"          # canonical historical
    STOCKS_TABLE: str = "stocks"                          # live/current
    STOCK_DAILY_PRICES_TABLE: str = "stock_daily_prices"  # daily candles
    STOCK_INTRADAY_TABLE: str = "stock_intraday"          # minute ticks
    CRYPTO_PRICES_TABLE: str = "crypto_prices"            # CoinGecko
    BTC_LOCAL_PRICES_TABLE: str = "btc_local_prices"      # BTC in Arab currencies
    CRYPTO_INTRADAY_TABLE: str = "crypto_intraday"        # crypto ticks
    GOLD_PRICES_TABLE: str = "gold_prices"                # all karats
    GOLD_PRICES_CLEAN_TABLE: str = "gold_prices_clean"
    SILVER_PRICES_TABLE: str = "silver_prices"
    EXCHANGE_RATES_TABLE: str = "exchange_rates"
    COMMODITY_INTRADAY_TABLE: str = "commodity_intraday"
    DEPRECATED_EGKSCO_TABLE: str = "egksco_price_history"  # DEPRECATED (Rule 46 amended)

    @classmethod
    def is_deprecated_table(cls, table_name: str) -> bool:
        """Check if a table name is deprecated (per Rule 46 amendment)."""
        return table_name.lower() == cls.DEPRECATED_EGKSCO_TABLE.lower()

    @classmethod
    def all_dbs(cls) -> dict[str, str]:
        """خريطة اسم → مسار لكل القواعد المعتمدة (4 فقط)."""
        return {
            'MARKET_DB': cls.MARKET_DB,
            'PREDICTIONS_DB': cls.PREDICTIONS_DB,
            'AUTH_DB': cls.AUTH_DB,
            'CONTENT_DB': cls.CONTENT_DB,
        }

    @classmethod
    def ensure_dir(cls) -> None:
        """تأكد إن مجلد db موجود."""
        _DB_DIR.mkdir(parents=True, exist_ok=True)

    @classmethod
    def get_db_for_table(cls, table_name: str) -> str:
        """
        حدد أي DB يحتوي على جدول معين (للاستعلام الديناميكي).

        P0-8-DB-UNIFY (2026-09-27): refreshed to point at the *canonical* DB
        for every consolidated table. Previously, several entries pointed at the
        target 4-DB architecture (MARKET_DB = market.db, which is still empty
        in production); now they point at the live DB that actually holds the
        data (data_engine.db / stocks.db / predictions.db / auth.db).

        Returns: مسار الـ DB المناسب
        """
        # ───────────────────────────────────────────────────────────────
        # Canonical DB routing — current state (after P0-8-DB-UNIFY 2026-09-27)
        # ───────────────────────────────────────────────────────────────
        # Tables previously duplicated across DBs now resolve to the single
        # canonical source. See agent-ctx/P0-8-DB-UNIFY-REPORT.md for the
        # per-table decisions and JSON sidecars of any dropped rows.
        # ───────────────────────────────────────────────────────────────

        # data_engine.db tables (canonical — live data written by metals_forex_fetcher.py, scrapers)
        data_engine_tables = {
            'egksco_price_history',  # canonical: 13K rows (was also in stocks.db — 0 rows, dropped)
            'gold_prices', 'gold_prices_clean', 'silver_prices',  # canonical: 187K live rows (was 3 stale rows in stocks.db — dropped)
            'tab_balance_sheet', 'tab_cash_flow', 'tab_dividends',
            'tab_income_statement', 'tab_performance', 'tab_profitability',
            'tab_technical_analysis', 'tab_valuation',
            'crypto_prices', 'crypto_price_history', 'cryptos', 'crypto_metrics',
            'crypto_fetch_log', 'sync_status', 'exchange_rates', 'btc_local_prices',
            'macro_indicators', 'macro_prices', 'macro_fetch_log',
            'historical_data', 'screener_presets', 'screener_results', 'screener_lists',
        }

        # stocks.db tables (canonical — stocks metadata + analysis cache + recommendations)
        stocks_tables = {
            'stocks',  # canonical: 976 rows, 58 cols (was 296 stale rows in data_engine.db — dropped)
            'egksco_stocks',  # canonical: 250 rows (was 0 rows in data_engine.db — dropped)
            'cached_analysis',  # canonical: 143 fresh rows (was 0 rows in predictions.db — dropped)
            'ExpertRecommendation',  # canonical: 127 rows (was 17 stale rows in auth.db + predictions.db — dropped)
            'telegram_news',  # canonical: 6 rows (was 0 rows in predictions.db — dropped)
            'portfolios',  # only in stocks.db (3 rows) — auth.db never had this table
            'stock_daily_prices', 'stock_phase', 'stocks_backup', 'stock_prices',
            'stock_intraday', 'crypto_intraday', 'commodity_intraday', 'intraday_meta',
            'egksco_sync_status', 'market_indices', 'market_regime_log',
            'system_settings', 'tuned_predictions_summary',
            'real_evaluated_predictions', 'analytics_events',
            'gold_price_history', 'currency_rates', 'news',
        }

        # predictions.db tables (canonical — predictions + learning + outcome logs)
        predictions_tables = {
            'predictions', 'persona_predictions', 'prediction_logs',
            'outcome_logs', 'learned_lessons',  # canonical: 19K rows (was 0 rows in stocks.db — dropped)
            'conjunction_patterns', 'indicator_trust_scores', 'quant_cache',
            'stored_analyses', 'morning_bell_signals', 'exit_notifications',
            'backtest_results', 'optimizer_params_history',
            'crypto_predictions_log', 'aiPredictionStats',
            'user_trades',  # only in predictions.db (0 rows) — stocks.db never had this table
            'telegram_recommendations', 'telegram_signals',
        }

        # auth.db tables (canonical — users + subscriptions)
        auth_tables = {
            'User',  # canonical: 101 rows (stocks.db never had this table)
            'PromoCode', 'SubscriptionPlan', 'api_tokens',
            'task_runs', 'user_stock_watchlists', 'portfolio_assets',
            'session', 'account', 'verification_token',
        }

        # content.db tables (target architecture — not yet on production)
        content_tables = {
            'telegram_messages', 'scraping_status',
            'tracked_channels',
        }

        t = table_name.lower()
        # DATA-ENGINE-UNIFY-1 / News Stage 2: read from news.db.market_news (canonical)
        # market_news lives in news.db (1019 rows), NOT content.db (target arch, empty on prod).
        if t == 'market_news':
            return cls.NEWS_DB
        if t in {x.lower() for x in data_engine_tables}:
            return cls.DATA_ENGINE_DB
        if t in {x.lower() for x in stocks_tables}:
            return cls.STOCKS_DB
        if t in {x.lower() for x in predictions_tables}:
            return cls.PREDICTIONS_DB
        if t in {x.lower() for x in auth_tables}:
            return cls.AUTH_DB
        if t in {x.lower() for x in content_tables}:
            return cls.CONTENT_DB
        # Default: stocks.db (most metadata tables live here post-P0-8-DB-UNIFY)
        return cls.STOCKS_DB


def get_db_path(name: str) -> str:
    """
    احصل على مسار DB بالاسم.
    Example: get_db_path('market') -> '/abs/path/db/market.db'
    """
    name = name.lower().strip()
    if name.endswith(".db"):
        name = name[:-3]
    env_key = f"{name.upper()}_DB"
    return _resolve(env_key, f"{name}.db")


# ============================================================================
# tab_* PK auto-detection helper (DATA-ENGINE-UNIFY-1 Stage 2a-fix)
# ============================================================================
# المشكلة: tab_* tables ليها schema مختلفة بين الساندبوكس + الإنتاج:
#   - الساندبوكس (snapshot قديم): symbol PK + TEXT metrics + 8 tables
#   - الإنتاج (laptop + VPS): ticker PK + REAL metrics + 3 tables (valuation/
#     profitability/balance_sheet) — والباقي مش موجود
# الـ readers كانت بـ query بـ ticker (صح للإنتاج) → جون غيّرها لـ symbol
# (غلط للإنتاج) في Stage 2a. الـ fix الصح: auto-detect الـ PK column.
# ============================================================================

import sqlite3 as _sqlite3

# Cache: table_pk_cache[db_path][table] = 'ticker' | 'symbol' | None
_table_pk_cache: dict[str, dict[str, str]] = {}


def detect_tab_pk_column(db_path: str, table: str) -> str:
    """
    Detect الـ PK column لـ tab_* table (ticker أو symbol أو غيرهم).

    Returns:
        - 'ticker' لو الـ table فيها column اسمه ticker (الـ schema الكنسي للإنتاج).
        - 'symbol' لو الـ table فيها column اسمه symbol (الـ schema القديم للساندبوكس).
        - 'ticker' كـ default لو لا ticker ولا symbol موجودين.

    الـ detection بـ يتـ cached per (db_path, table) عشان الـ performance.

    Usage:
        from utils.db_paths import detect_tab_pk_column
        pk = detect_tab_pk_column(DBPaths.DATA_ENGINE_DB, 'tab_valuation')
        # pk = 'ticker' or 'symbol'
        cur.execute(f"SELECT * FROM tab_valuation WHERE {pk} = ?", (ticker,))
    """
    global _table_pk_cache

    db_key = str(db_path)
    if db_key not in _table_pk_cache:
        _table_pk_cache[db_key] = {}

    if table in _table_pk_cache[db_key]:
        return _table_pk_cache[db_key][table]

    pk = "ticker"  # default (production schema)
    try:
        conn = _sqlite3.connect(db_path, timeout=5.0)
        cols = [row[1] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        conn.close()
        if "ticker" in cols:
            pk = "ticker"
        elif "symbol" in cols:
            pk = "symbol"
        # else: keep default 'ticker'
    except Exception:
        # لو الـ table مش موجود أو DB مش موجود → default 'ticker'
        pass

    _table_pk_cache[db_key][table] = pk
    return pk


def tab_table_exists(db_path: str, table: str) -> bool:
    """
    تحقق إن tab_* table موجود في الـ DB.

    Usage:
        from utils.db_paths import tab_table_exists, DBPaths
        if tab_table_exists(DBPaths.DATA_ENGINE_DB, 'tab_dividends'):
            cur.execute("SELECT * FROM tab_dividends ...")
    """
    try:
        conn = _sqlite3.connect(db_path, timeout=5.0)
        exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table,),
        ).fetchone()
        conn.close()
        return exists is not None
    except Exception:
        return False
