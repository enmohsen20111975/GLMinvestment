"""
config/markets.py — Supported markets canonical mapping.

Uses data_engine.data_layer.normalize_market() as SSOT.
This module is a thin wrapper that re-exports the canonical mapping
and adds learning-engine-specific metadata per market.
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import List


@dataclass(frozen=True)
class MarketMeta:
    code: str
    name_ar: str
    name_en: str
    currency: str
    timezone: str
    trading_days_per_week: int  # 5 = Mon-Fri, 6 = Sun-Fri
    typical_daily_session_utc: tuple  # (start_hour, end_hour)


# ─── Canonical market registry (aligned with data_layer.normalize_market) ───
MARKETS: dict[str, MarketMeta] = {
    "EGX": MarketMeta(
        code="EGX", name_ar="البورصة المصرية", name_en="Egyptian Exchange",
        currency="EGP", timezone="Africa/Cairo",
        trading_days_per_week=5,  # Mon-Fri (Sunday is NOT a trading day in EGX)
        typical_daily_session_utc=(7, 12),  # 9:00-14:00 Cairo = 7:00-12:00 UTC
    ),
    "TADAWUL": MarketMeta(
        code="TADAWUL", name_ar="تداول السعودية", name_en="Saudi Exchange",
        currency="SAR", timezone="Asia/Riyadh",
        trading_days_per_week=6,  # Sun-Fri (Sunday IS a trading day)
        typical_daily_session_utc=(7, 11),
    ),
    "KSE": MarketMeta(
        code="KSE", name_ar="بورصة الكويت", name_en="Kuwait Stock Exchange",
        currency="KWD", timezone="Asia/Kuwait",
        trading_days_per_week=6,
        typical_daily_session_utc=(6, 10),
    ),
    "QSE": MarketMeta(
        code="QSE", name_ar="بورصة قطر", name_en="Qatar Stock Exchange",
        currency="QAR", timezone="Asia/Qatar",
        trading_days_per_week=6,
        typical_daily_session_utc=(6, 10),
    ),
    "US": MarketMeta(
        code="US", name_ar="الأسواق الأمريكية", name_en="US Markets",
        currency="USD", timezone="America/New_York",
        trading_days_per_week=5,
        typical_daily_session_utc=(14, 21),  # 9:30-16:00 ET
    ),
    "CRYPTO": MarketMeta(
        code="CRYPTO", name_ar="العملات الرقمية", name_en="Cryptocurrency",
        currency="USD", timezone="UTC",
        trading_days_per_week=7,  # 24/7
        typical_daily_session_utc=(0, 24),
    ),
}


def all_market_codes() -> List[str]:
    """Return list of all supported market codes."""
    return list(MARKETS.keys())


def get_market_meta(code: str) -> MarketMeta:
    """Get market metadata. Raises KeyError if unknown."""
    if code not in MARKETS:
        raise KeyError(f"Unknown market code: {code}. Supported: {list(MARKETS.keys())}")
    return MARKETS[code]


def is_trading_day(day_of_week: int, market_code: str) -> bool:
    """
    Check if a given weekday is a trading day for the market.
    day_of_week: 0=Monday ... 6=Sunday (Python convention)
    """
    meta = get_market_meta(market_code)
    if meta.trading_days_per_week == 7:
        return True  # Crypto
    if meta.trading_days_per_week == 6:
        # Sun-Fri: trade on days 0-4 (Mon-Fri) AND 6 (Sunday)
        return day_of_week in (0, 1, 2, 3, 4, 6)
    # 5 days: Mon-Fri
    return day_of_week in (0, 1, 2, 3, 4)
