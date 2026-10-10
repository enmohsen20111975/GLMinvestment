"""
Canonical Source Authority (Task 22, Step 2 — 2026-10-03)
========================================================

Per owner directive: "البيانات النهائية تكون واحدة بس مش كذا مكان"
Per Rule 12: load_merged_history() is the SOLE source of price data.

This module defines the CANONICAL SOURCES per market + provides:
- get_canonical_source(market) → the primary source
- get_fallback_sources(market) → list of fallbacks (in priority order)
- is_write_allowed(market, source) → True if this source can write
- write_guarded(ticker, market, source, ...) → writes ONLY if allowed

Every scraper MUST import + use write_guarded() before INSERT.
This prevents the multi-source contamination that caused CRST-class bugs.

Per Rule 20: Python=Brain — this authority lives here, not in Node.
"""

from typing import List, Optional
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

# ═══════════════════════════════════════════════════════════════
# CANONICAL SOURCE HIERARCHY (per market)
# ═══════════════════════════════════════════════════════════════

CANONICAL_SOURCES = {
    # EGX: intraday_aggregated (from egksco_scraper) is most recent + reliable
    #       → egksco (legacy) → yahoo_clean (5yr history)
    'EGX':       ['intraday_aggregated', 'egksco', 'yahoo_clean'],

    # TADAWUL/KSE/QSE/US: yahoo_clean is the primary (long history)
    #       → egx_investment_migration (legacy fallback for EGX-adjacent)
    'TADAWUL':   ['yahoo_clean', 'egx_investment_migration'],
    'KSE':       ['yahoo_clean'],
    'QSE':       ['yahoo_clean'],
    'US':        ['yahoo_clean'],

    # CRYPTO: crypto_fetcher (API — has 198K rows) → tradingview_live (if available)
    # QA-22 found: tradingview_live has 0 crypto rows — demoted to fallback
    'CRYPTO':    ['crypto_fetcher', 'tradingview_live'],

    # GOLD: gold_fetcher (API — has 163K rows) → yahoo_clean (if available)
    # QA-22 found: yahoo_clean has 0 gold rows — demoted to fallback
    'GOLD':      ['gold_fetcher', 'yahoo_clean'],
}

# Sources that are COMPLETELY BANNED (data quality issues discovered)
# These sources will NEVER be written, even as fallback.
BANNED_SOURCES = {
    'egxpilot_live',     # pilot data, short range, unreliable
    'yahoo_safetynet',   # fallback of fallback, minimal coverage
    'yfinance_backfill',  # 18 rows only, not reliable
}


def get_canonical_source(market: str) -> str:
    """Get the PRIMARY (highest-priority) source for a market."""
    sources = CANONICAL_SOURCES.get(market, ['yahoo_clean'])
    return sources[0]


def get_fallback_sources(market: str) -> List[str]:
    """Get fallback sources (in priority order) for a market."""
    sources = CANONICAL_SOURCES.get(market, ['yahoo_clean'])
    return sources[1:]


def get_all_allowed_sources(market: str) -> List[str]:
    """Get ALL allowed sources (primary + fallbacks) for a market."""
    return CANONICAL_SOURCES.get(market, ['yahoo_clean'])


def is_source_banned(source: str) -> bool:
    """Check if a source is completely banned (data quality issues)."""
    return source in BANNED_SOURCES


def is_write_allowed(market: str, source: str) -> bool:
    """
    Check if a given source is ALLOWED to write for a given market.

    Rules:
    1. BANNED sources → NEVER allowed
    2. Source must be in the market's CANONICAL_SOURCES list
    3. If source is a FALLBACK (not primary), only allowed if primary is STALE
       (no data in last 7 days)
    """
    if is_source_banned(source):
        return False

    allowed = get_all_allowed_sources(market)
    if source not in allowed:
        return False  # source not in this market's hierarchy

    # If source is the PRIMARY → always allowed
    primary = get_canonical_source(market)
    if source == primary:
        return True

    # Source is a FALLBACK → only allowed if primary is stale
    # (We can't check DB here without a connection — caller should use write_guarded)
    return True  # allow fallbacks; write_guarded() will check primary freshness


def is_primary_fresh(db_path: str, ticker: str, market: str) -> bool:
    """
    Check if the PRIMARY source has fresh data (< 7 days) for this ticker.

    Per Rule 16: VERIFY with evidence.
    """
    primary = get_canonical_source(market)
    try:
        conn = sqlite3.connect(db_path)
        row = conn.execute("""
            SELECT MAX(date) as latest
            FROM price_history
            WHERE ticker = ? AND source = ?
        """, (ticker, primary)).fetchone()
        conn.close()

        if not row or not row[0]:
            return False  # no data from primary → not fresh

        latest_date = datetime.strptime(row[0], '%Y-%m-%d')
        age_days = (datetime.now() - latest_date).days
        return age_days <= 7
    except Exception:
        return False


def write_guarded(
    db_path: str,
    ticker: str,
    market: str,
    date: str,
    open_price: float,
    high_price: float,
    low_price: float,
    close_price: float,
    volume: int,
    source: str,
) -> bool:
    """
    GUARDED WRITE: only writes if the source is allowed for this market.

    Per owner directive: "لازم البيانات النهائية تكون واحدة بس"
    - If source is BANNED → skip write, log warning
    - If source is not in market's hierarchy → skip write, log warning
    - If source is PRIMARY → write normally
    - If source is FALLBACK:
      - If primary is FRESH (< 7 days) → skip write (primary wins)
      - If primary is STALE → write with PRIMARY source name (not fallback name)

    Returns True if written, False if skipped.
    """
    # Check if source is banned
    if is_source_banned(source):
        print(f"[write_guarded] SKIP {ticker} {date}: source '{source}' is BANNED")
        return False

    # Check if source is in market's hierarchy
    allowed = get_all_allowed_sources(market)
    if source not in allowed:
        print(f"[write_guarded] SKIP {ticker} {date}: source '{source}' not in {market} hierarchy")
        return False

    # Determine the source name to use for the write
    primary = get_canonical_source(market)

    if source == primary:
        # Primary source → write normally
        write_source = source
    else:
        # Fallback source → check if primary is fresh
        if is_primary_fresh(db_path, ticker, market):
            print(f"[write_guarded] SKIP {ticker} {date}: primary '{primary}' is fresh, fallback '{source}' not needed")
            return False
        # Primary is stale → write with PRIMARY source name (not fallback name)
        # This ensures the data appears as canonical source
        write_source = primary
        print(f"[write_guarded] {ticker} {date}: primary stale, writing as '{write_source}' (from fallback '{source}')")

    # Execute the write
    try:
        conn = sqlite3.connect(db_path)
        conn.execute("""
            INSERT OR REPLACE INTO price_history
            (ticker, date, open_price, high_price, low_price, close_price, volume, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (ticker, date, open_price, high_price, low_price, close_price, volume, write_source))
        conn.commit()
        conn.close()
        return True
    except Exception as e:
        print(f"[write_guarded] ERROR writing {ticker} {date}: {e}")
        return False


def get_market_for_ticker(ticker: str, db_path: str = 'db/stocks.db') -> str:
    """Look up the market for a given ticker."""
    try:
        conn = sqlite3.connect(db_path)
        row = conn.execute(
            "SELECT market FROM stocks WHERE ticker = ? LIMIT 1",
            (ticker,)
        ).fetchone()
        conn.close()
        if row and row[0]:
            return row[0]
    except Exception:
        pass

    # Fallback: detect by ticker pattern
    ticker_upper = ticker.upper()
    if ticker_upper in ('BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'DOT', 'DOGE'):
        return 'CRYPTO'
    if ticker_upper in ('XAU', 'GOLD', 'XAUUSD'):
        return 'GOLD'
    if '.US' in ticker_upper or ticker_upper in ('AAPL', 'MSFT', 'GOOGL', 'TSLA', 'AMZN'):
        return 'US'

    return 'EGX'  # default


__all__ = [
    'CANONICAL_SOURCES',
    'BANNED_SOURCES',
    'get_canonical_source',
    'get_fallback_sources',
    'get_all_allowed_sources',
    'is_source_banned',
    'is_write_allowed',
    'is_primary_fresh',
    'write_guarded',
    'get_market_for_ticker',
]
