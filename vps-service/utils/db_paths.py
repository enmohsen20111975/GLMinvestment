"""
db_paths.py — مسار مطلق آمن لكل قواعد البيانات
================================================
المشكلة اللي بتحلها:
    استخدام 'db/stocks.db' (مسار نسبي) في السكريبتات بيخلق مجلد متداخل
    db/db/ لما السكريبت يتشغّل من داخل مجلد db. ده السبب الجذري للتكرار.

الحل:
    كل مسار DB يكون ABSOLUTE مبني على موقع المشروع (مش CWD).
    + دعم env var override (STOCKS_DB, PREDICTIONS_DB, ...).

الاستخدام:
    from utils.db_paths import DBPaths
    conn = sqlite3.connect(DBPaths.STOCKS_DB)

    أو لو حابب override:
    STOCKS_DB=/custom/path python3 my_script.py

مبدأ التصميم:
    - المسار الافتراضي = <project_root>/db/<name>.db
    - project_root = مجلد vps-service الأب (parents[1] من utils/)
    - env override له الأولوية دايماً (للإنتاج/الـ sandbox)
"""
from __future__ import annotations

import os
from pathlib import Path

# project_root = مجلد المشروع الأب (vps-service/utils/ -> vps-service -> project_root)
# P0 fix (يوليو 2026): كان parents[1] = vps-service/ (مش project root!)
# الصح: parents[2] = project root (اللي فيه db/ folder)
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_DB_DIR = Path(os.environ.get("DB_DIR", _PROJECT_ROOT / "db"))


def _resolve(env_key: str, default_name: str) -> str:
    """ارجع مسار DB: env var لو موجود، иначе <DB_DIR>/<default_name>."""
    env_val = os.environ.get(env_key)
    if env_val:
        return str(Path(env_val).resolve())
    return str(_DB_DIR / default_name)


class DBPaths:
    """كل مسارات قواعد البيانات المطلقة الآمنة."""

    # المجلد الرئيسي للقواعد (للأدوات اللي بتتحاج كل الملفات)
    DB_DIR: str = str(_DB_DIR)
    PROJECT_ROOT: str = str(_PROJECT_ROOT)

    # قواعد البيانات المعتمدة (الخطة الموحّدة)
    DATA_ENGINE_DB: str = _resolve("DATA_ENGINE_DB", "data_engine.db")
    STOCKS_DB: str = _resolve("STOCKS_DB", "stocks.db")
    PRICE_HISTORY_DB: str = _resolve("PRICE_HISTORY_DB", "price_history.db")
    PREDICTIONS_DB: str = _resolve("PREDICTIONS_DB", "predictions.db")
    AUTH_DB: str = _resolve("AUTH_DB", "auth.db")
    TELEGRAM_DATA_DB: str = _resolve("TELEGRAM_DATA_DB", "stocks.db")  # Consolidated July 2026

    # قواعد مساعدة
    CRYPTO_DB: str = _resolve("CRYPTO_DB", "crypto.db")
    CRYPTO_LEARNING_DB: str = _resolve("CRYPTO_LEARNING_DB", "crypto_learning.db")
    NEWS_DB: str = _resolve("NEWS_DB", "stocks.db")  # Consolidated July 2026
    INTRADAY_DB: str = _resolve("INTRADAY_DB", "intraday.db")
    # v3.65.1: gold_prices canonical source = data_engine.db (written live by metals_forex_fetcher.py).
    # The old `gold_prices.db` (a separate file) never existed — the alias pointed at a non-existent file.
    # Kept as alias for backward-compat with code that reads DBPaths.GOLD_PRICES_DB directly.
    GOLD_PRICES_DB: str = _resolve("GOLD_PRICES_DB", "data_engine.db")
    HISTORICAL_DB: str = _resolve("HISTORICAL_DB", "historical.db")
    COMMUNITY_DB: str = _resolve("COMMUNITY_DB", "community.db")
    ANALYTICS_DB: str = _resolve("ANALYTICS_DB", "stocks.db")  # Consolidated July 2026
    AI_SEARCH_CACHE_DB: str = _resolve("AI_SEARCH_CACHE_DB", "ai_search_cache.db")

    @classmethod
    def all_dbs(cls) -> dict[str, str]:
        """خريطة اسم → مسار لكل القواعد المعتمدة."""
        return {
            k: v for k, v in vars(cls).items()
            if isinstance(v, str) and v.endswith(".db") and not k.startswith("_")
        }

    @classmethod
    def ensure_dir(cls) -> None:
        """تأكد إن مجلد db موجود (للأدوات اللي بتأنشئ قواعد)."""
        _DB_DIR.mkdir(parents=True, exist_ok=True)


def get_db_path(name: str) -> str:
    """
    احصل على مسار DB بالاسم (flexible helper).
    Example: get_db_path('stocks') -> '/abs/path/db/stocks.db'
    """
    name = name.lower().strip()
    if name.endswith(".db"):
        name = name[:-3]
    env_key = f"{name.upper()}_DB"
    return _resolve(env_key, f"{name}.db")
