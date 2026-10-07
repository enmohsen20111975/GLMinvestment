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
    TELEGRAM_DATA_DB: str = STOCKS_DB     # telegram_news — canonical: stocks.db (6 rows). Dropped: predictions.db (0 rows, different schema).
    NEWS_DB: str = STOCKS_DB              # was stocks.db → content.db (target architecture); news still in stocks.db for now.
    COMMUNITY_DB: str = CONTENT_DB        # was community.db → content.db
    ANALYTICS_DB: str = STOCKS_DB          # cached_analysis — canonical: stocks.db (143 rows). Dropped: predictions.db (0 rows, fallback-cache recreated by migrator).
    AI_SEARCH_CACHE_DB: str = STOCKS_DB   # was ai_search_cache.db
    CRYPTO_LEARNING_DB: str = PREDICTIONS_DB  # was crypto_learning.db → predictions.db

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
            'gold_price_history', 'currency_rates', 'news', 'news_items',
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
            'market_news', 'telegram_messages', 'scraping_status',
            'tracked_channels',
        }

        t = table_name.lower()
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
