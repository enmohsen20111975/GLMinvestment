"""
canonical_sources.py — SSOT per-domain data source map.
=========================================================
BRAVO DATA-LAYER-1 (per John's mandate + Owner ground-truth).

Every query for market data MUST route through this map. No code may
hardcode a DB path or table name for the domains listed below.

Rule 11 (SSOT) + Rule 17 (relative paths) + Rule 20 (Python = Brain).

Canonical sources (per Owner directive 2026-10-18):
  - Stock historical prices (candles/chart/RSI/MACD): price_history.db.price_history
  - Stock live/current: stocks.db.stocks
  - Stock intraday (minute): intraday.db.stock_intraday
  - Crypto prices: data_engine.db.crypto_prices + btc_local_prices
  - Crypto intraday: intraday.db.crypto_intraday
  - Gold/metals: data_engine.db.gold_prices + gold_prices_clean + silver_prices
  - Forex/exchange rates: data_engine.db.exchange_rates
  - Commodity intraday: intraday.db.commodity_intraday

⚠️ DEPRECATED: data_engine.db.egksco_price_history (Rule 46 amended 2026-10-18).
   Was 59K rows but stale schema (price_date, not date) + split-brain with
   price_history.db (1.3M rows, 2000-2026). All code must use price_history.db.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional

# Rule 17: relative paths — works on laptop + VPS + sandbox.
# vps-service/core/canonical_sources.py → project root = parents[2]
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_DB_DIR = _PROJECT_ROOT / "db"


class CanonicalSources:
    """Single source of truth for all market data paths + tables.

    All code MUST reference these constants — no hardcoded paths.
    """

    PROJECT_ROOT = str(_PROJECT_ROOT)
    DB_DIR = str(_DB_DIR)

    # ─── Stock prices ─────────────────────────────────────────────────────
    # HISTORICAL (candles, chart, RSI/MACD): price_history.db.price_history
    PRICE_HISTORY_DB = str(_DB_DIR / "price_history.db")
    PRICE_HISTORY_TABLE = "price_history"
    # Schema: ticker, date, open_price, high_price, low_price, close_price,
    #         volume, source, created_at, adjusted, buy_volume, sell_volume,
    #         delta_volume, delta_pct, pressure, market

    # CURRENT/LIVE: stocks.db.stocks
    STOCKS_DB = str(_DB_DIR / "stocks.db")
    STOCKS_TABLE = "stocks"
    STOCK_DAILY_PRICES_TABLE = "stock_daily_prices"
    # stocks table: current_price, close_price, change_percent, volume, last_updated

    # INTRADAY (minute): intraday.db.stock_intraday
    INTRADAY_DB = str(_DB_DIR / "intraday.db")
    STOCK_INTRADAY_TABLE = "stock_intraday"

    # ─── Crypto ───────────────────────────────────────────────────────────
    # PRICES: data_engine.db.crypto_prices (Top 50 CoinGecko) + btc_local_prices
    DATA_ENGINE_DB = str(_DB_DIR / "data_engine.db")
    CRYPTO_PRICES_TABLE = "crypto_prices"
    BTC_LOCAL_PRICES_TABLE = "btc_local_prices"

    # INTRADAY: intraday.db.crypto_intraday
    CRYPTO_INTRADAY_TABLE = "crypto_intraday"

    # ─── Gold / Metals ────────────────────────────────────────────────────
    # data_engine.db.gold_prices + gold_prices_clean + silver_prices
    GOLD_PRICES_TABLE = "gold_prices"
    GOLD_PRICES_CLEAN_TABLE = "gold_prices_clean"
    SILVER_PRICES_TABLE = "silver_prices"

    # ─── Forex / Exchange rates ───────────────────────────────────────────
    # data_engine.db.exchange_rates
    EXCHANGE_RATES_TABLE = "exchange_rates"

    # ─── Commodity intraday ───────────────────────────────────────────────
    # intraday.db.commodity_intraday
    COMMODITY_INTRADAY_TABLE = "commodity_intraday"

    # ─── DEPRECATED (Rule 46 amended 2026-10-18) ──────────────────────────
    # data_engine.db.egksco_price_history — DO NOT USE.
    # Was 59K rows but stale schema + split-brain with price_history.db (1.3M rows).
    # All code must use PRICE_HISTORY_DB.PRICE_HISTORY_TABLE instead.
    DEPRECATED_EGKSCO_TABLE = "egksco_price_history"


# Convenience singleton
CANONICAL = CanonicalSources()


def get_canonical_price_history_path() -> str:
    """Return canonical DB path for stock historical prices."""
    return CanonicalSources.PRICE_HISTORY_DB


def get_canonical_price_history_table() -> str:
    """Return canonical table name for stock historical prices."""
    return CanonicalSources.PRICE_HISTORY_TABLE


def is_deprecated_source(table_name: str) -> bool:
    """Check if a table name is deprecated (per Rule 46 amendment)."""
    return table_name.lower() == CanonicalSources.DEPRECATED_EGKSCO_TABLE.lower()


__all__ = [
    'CanonicalSources',
    'CANONICAL',
    'get_canonical_price_history_path',
    'get_canonical_price_history_table',
    'is_deprecated_source',
]
