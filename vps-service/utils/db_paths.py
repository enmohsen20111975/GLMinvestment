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
    #    يحتوي على: news_articles, telegram_messages, telegram_news,
    #    telegram_recommendations, scraping_status, tracked_channels
    CONTENT_DB: str = _resolve("CONTENT_DB", "content.db")

    # ═══════════════════════════════════════════════════════════════
    # Backward compatibility aliases (توجيه للمسار الجديد)
    # ═══════════════════════════════════════════════════════════════
    # الكود القديم يستخدم هذه الأسماء — كلها توجّه للمسار الجديد

    # ← market.db
    DATA_ENGINE_DB: str = MARKET_DB      # was data_engine.db
    STOCKS_DB: str = MARKET_DB           # was stocks.db
    PRICE_HISTORY_DB: str = MARKET_DB    # was price_history.db
    INTRADAY_DB: str = MARKET_DB         # was intraday.db
    CRYPTO_DB: str = MARKET_DB           # was crypto.db
    GOLD_PRICES_DB: str = MARKET_DB      # was data_engine.db
    HISTORICAL_DB: str = MARKET_DB        # was historical.db
    TELEGRAM_DATA_DB: str = CONTENT_DB   # was telegram_data.db → content.db
    NEWS_DB: str = CONTENT_DB            # was stocks.db → content.db
    COMMUNITY_DB: str = CONTENT_DB       # was community.db → content.db
    ANALYTICS_DB: str = MARKET_DB        # was stocks.db → market.db
    AI_SEARCH_CACHE_DB: str = MARKET_DB  # was ai_search_cache.db → market.db
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

        Returns: مسار الـ DB المناسب
        """
        # market.db tables
        market_tables = {
            'egksco_price_history', 'stock_daily_prices', 'stock_intraday',
            'crypto_intraday', 'commodity_intraday', 'intraday_meta',
            'stocks', 'stock_phase', 'stocks_backup', 'stock_prices',
            'egksco_stocks', 'egksco_sync_status', 'egksco_price_history',
            'screener_presets', 'screener_results', 'screener_lists',
            'market_indices', 'market_regime_log', 'macro_indicators',
            'macro_prices', 'macro_fetch_log',
            'tab_balance_sheet', 'tab_cash_flow', 'tab_dividends',
            'tab_income_statement', 'tab_performance', 'tab_profitability',
            'tab_technical_analysis', 'tab_valuation',
            'crypto_prices', 'crypto_price_history', 'cryptos', 'crypto_metrics',
            'crypto_fetch_log', 'sync_status',
            'gold_prices', 'gold_prices_clean', 'silver_prices',
            'exchange_rates', 'btc_local_prices',
            'cached_analysis', 'system_settings', 'tuned_predictions_summary',
            'real_evaluated_predictions', 'analytics_events',
        }
        # predictions.db tables
        predictions_tables = {
            'predictions', 'persona_predictions', 'prediction_logs',
            'outcome_logs', 'learned_lessons', 'conjunction_patterns',
            'indicator_trust_scores', 'quant_cache', 'stored_analyses',
            'morning_bell_signals', 'exit_notifications', 'backtest_results',
            'optimizer_params_history', 'ExpertRecommendation',
            'crypto_predictions_log', 'aiPredictionStats',
        }
        # auth.db tables
        auth_tables = {
            'User', 'PromoCode', 'SubscriptionPlan', 'api_tokens',
            'task_runs', 'user_trades', 'portfolios', 'portfolio_assets',
            'user_stock_watchlists',
        }
        # content.db tables
        content_tables = {
            'news_articles', 'telegram_messages', 'telegram_news',
            'telegram_recommendations', 'scraping_status', 'tracked_channels',
        }

        t = table_name.lower()
        if t in {x.lower() for x in market_tables}:
            return cls.MARKET_DB
        if t in {x.lower() for x in predictions_tables}:
            return cls.PREDICTIONS_DB
        if t in {x.lower() for x in auth_tables}:
            return cls.AUTH_DB
        if t in {x.lower() for x in content_tables}:
            return cls.CONTENT_DB
        # Default: market.db (most tables are there)
        return cls.MARKET_DB


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
