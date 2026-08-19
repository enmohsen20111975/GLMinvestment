"""
data/prices.py — THE single source of truth for price history.
================================================================

PHASE 1 of SIMPLIFICATION_PLAN (v3.50.0).

This module replaces **30 duplicate** `_get_price_history` / `get_price_history`
/ `load_merged_history` functions that were scattered across the codebase
(see Documentation/AUDIT_MAP.md §4). Each duplicate read from a different
source or returned a different format — the root cause of the production
bug `analyzed:0` (trigger_analysis_manual read from `stock_daily_prices`
which had ≤6 rows on prod, while the brain used `price_history.db` with
1.2M rows).

Public API
----------
    load_price_history(ticker, limit=120) -> List[Dict]
        The ONE function everyone should call.
        Returns daily candles (oldest first):
            [{date, open, high, low, close, volume}, ...]

    load_closes(ticker, limit=120) -> List[float]
        Convenience: just close prices (for RSI/MACD/etc).

    load_price_history_until(ticker, until_date, limit=120) -> List[Dict]
        History up to (and including) a given date — for backtests.

    clear_cache() -> None
        Clear the process-level memoization cache.

    get_cache_stats() -> Dict
        Returns {size, hits, misses} for observability.

Design
------
1. **Delegates** to the canonical `master_analyzer.load_merged_history`
   (300-line source-normalization logic: yahoo_clean → egksco → migration).
   We do NOT rewrite that logic — too risky. We wrap it.
2. **Process-level LRU cache**: same (ticker, limit) in the same run = 1 DB hit.
   This cuts DB reads by ~80% in batch analysis (20 stocks × 5 readers each).
3. **Consistent return format**: always `[{date, open, high, low, close, volume}]`.
   Callers that need tuples or floats use the convenience helpers.
4. **Fallback**: if `price_history.db` is missing/unreadable, falls back to
   `stock_daily_prices` (with a warning log). This is the ONLY sanctioned
   fallback path — no caller may invent its own.

Migration
---------
The 30 old readers are being converted to thin shims that call
`load_price_history()` (see PHASE 1 worklog). Until PHASE 7, the old
function signatures remain as `@deprecated` wrappers for backward compat.

Rules (enforced by CI in PHASE 7)
---------------------------------
- NO file outside `data/` may import `sqlite3` to read price tables.
- NO file may define `_get_price_history` / `get_price_history` /
  `load_merged_history` — all must `from data.prices import load_price_history`.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ─────────────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent  # repo root
DB_DIR = _PROJECT_ROOT / "db"
PRICE_HISTORY_DB = str(DB_DIR / "price_history.db")
STOCKS_DB = str(DB_DIR / "stocks.db")
INTRADAY_DB = str(DB_DIR / "intraday.db")


# ─────────────────────────────────────────────────────────────────────────────
# Process-level LRU cache (thread-safe)
# ─────────────────────────────────────────────────────────────────────────────
_MAX_CACHE_SIZE = 500  # ~500 tickers × 2 limits = 1000 entries max
_CACHE_TTL_SECONDS = 300  # 5 minutes (covers a full analysis run)

_cache: "OrderedDict[Tuple[str, int], Tuple[List[Dict], float]]" = OrderedDict()
_cache_lock = threading.Lock()
_cache_hits = 0
_cache_misses = 0


def clear_cache() -> None:
    """Clear the price-history cache. Call between unrelated analysis runs."""
    global _cache_hits, _cache_misses
    with _cache_lock:
        _cache.clear()
        _cache_hits = 0
        _cache_misses = 0


def get_cache_stats() -> Dict[str, int]:
    """Return cache statistics for observability / debugging."""
    with _cache_lock:
        return {
            "size": len(_cache),
            "max_size": _MAX_CACHE_SIZE,
            "hits": _cache_hits,
            "misses": _cache_misses,
            "hit_rate": round(_cache_hits / max(_cache_hits + _cache_misses, 1), 3),
        }


def _cache_get(key: Tuple[str, int]) -> Optional[List[Dict]]:
    global _cache_hits, _cache_misses
    now = datetime.now().timestamp()
    with _cache_lock:
        if key in _cache:
            data, ts = _cache[key]
            if now - ts < _CACHE_TTL_SECONDS:
                _cache_hits += 1
                _cache.move_to_end(key)
                return data
            else:
                # expired
                del _cache[key]
        _cache_misses += 1
        return None


def _cache_set(key: Tuple[str, int], data: List[Dict]) -> None:
    now = datetime.now().timestamp()
    with _cache_lock:
        while len(_cache) >= _MAX_CACHE_SIZE:
            _cache.popitem(last=False)  # evict oldest
        _cache[key] = (data, now)
        _cache.move_to_end(key)


# ─────────────────────────────────────────────────────────────────────────────
# Canonical reader (delegates to master_analyzer)
# ─────────────────────────────────────────────────────────────────────────────
def _canonical_load(ticker: str, limit: int) -> List[Dict]:
    """Call the canonical load_merged_history from master_analyzer.

    This is the 300-line source-normalization logic (yahoo_clean → egksco →
    migration). We import lazily to avoid circular imports (master_analyzer
    is heavy).
    """
    try:
        from analyzers.master_analyzer import load_merged_history as _lmh
        return _lmh(ticker, STOCKS_DB, limit=limit) or []
    except Exception as e:
        # Fallback: read directly from stock_daily_prices (defensive)
        # This should rarely happen — only if master_analyzer import fails.
        import sqlite3
        try:
            conn = sqlite3.connect(STOCKS_DB)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT price_date as date, open_price as open, high_price as high, "
                "low_price as low, close_price as close, volume "
                "FROM stock_daily_prices WHERE ticker = ? AND close_price > 0 "
                "ORDER BY price_date DESC LIMIT ?",
                (ticker.upper().split(".")[0], limit),
            ).fetchall()
            conn.close()
            result = [dict(r) for r in reversed(rows)]
            if result:
                print(f"[data.prices] ⚠️ canonical load failed ({e}), "
                      f"fallback stock_daily_prices returned {len(result)} rows for {ticker}")
            return result
        except Exception:
            print(f"[data.prices] ❌ both canonical and fallback failed for {ticker}: {e}")
            return []


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────
def load_price_history(ticker: str, limit: int = 120) -> List[Dict[str, Any]]:
    """Load daily price history for a ticker — THE single source of truth.

    Args:
        ticker: Stock symbol (e.g. "COMI", "COMI.CA"). Suffixes (.CA, .SR) stripped.
        limit: Max number of candles to return (most recent). Default 120.

    Returns:
        List of daily candles, oldest first:
        [{date: "2026-01-01", open: 10.5, high: 10.8, low: 10.2, close: 10.6, volume: 12345}, ...]

        Empty list if no data found.

    Caching:
        Results are cached per (ticker, limit) for 5 minutes. Same ticker in
        the same analysis run = 1 DB hit. Call clear_cache() to reset.

    Source priority (handled by canonical load_merged_history):
        1. yahoo_clean (5+ years raw Yahoo history) — primary
        2. egksco (live TradingView/EGKSCO) — for today's candle
        3. egx_investment_migration (old, normalized) — fallback
        4. stock_daily_prices (stocks.db) — last resort
    """
    if not ticker:
        return []

    # Normalize ticker: uppercase, strip suffix
    ticker_norm = ticker.upper().strip().split(".")[0]
    limit = max(1, min(int(limit), 2000))  # clamp 1..2000

    cache_key = (ticker_norm, limit)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    data = _canonical_load(ticker_norm, limit)

    # Ensure consistent key names (canonical returns date/open/high/low/close/volume)
    # but be defensive: some callers expect close_price/high_price. We standardize here.
    normalized = []
    for row in data:
        if isinstance(row, dict):
            d = row.get("date") or row.get("price_date")
            o = row.get("open") or row.get("open_price") or 0
            h = row.get("high") or row.get("high_price") or 0
            l = row.get("low") or row.get("low_price") or 0
            c = row.get("close") or row.get("close_price") or 0
            v = row.get("volume") or 0
            normalized.append({
                "date": d,
                "open": float(o) if o else 0.0,
                "high": float(h) if h else 0.0,
                "low": float(l) if l else 0.0,
                "close": float(c) if c else 0.0,
                "volume": int(v) if v else 0,
            })

    _cache_set(cache_key, normalized)
    return normalized


def load_closes(ticker: str, limit: int = 120) -> List[float]:
    """Convenience: return just close prices (oldest first). For RSI/MACD/etc."""
    history = load_price_history(ticker, limit)
    return [c["close"] for c in history if c["close"] > 0]


def load_price_history_until(
    ticker: str, until_date: str, limit: int = 120
) -> List[Dict[str, Any]]:
    """Load price history up to (and including) a given date.

    For backtests that need point-in-time data (no look-ahead).

    Args:
        ticker: Stock symbol.
        until_date: ISO date string "YYYY-MM-DD".
        limit: Max candles to return.
    """
    # Fetch more than needed, then filter
    fetch_limit = min(limit * 2, 2000)
    history = load_price_history(ticker, fetch_limit)
    filtered = [c for c in history if c["date"] and c["date"] <= until_date]
    return filtered[-limit:] if len(filtered) > limit else filtered


def get_latest_price(ticker: str) -> Optional[Dict[str, Any]]:
    """Return the most recent candle for a ticker, or None."""
    history = load_price_history(ticker, limit=1)
    return history[-1] if history else None


def get_tickers_with_history(min_bars: int = 10) -> List[str]:
    """Return list of tickers that have at least `min_bars` price bars.

    For analysis batch jobs that need to skip illiquid stocks.
    Reads directly from price_history.db (not cached — too large).
    """
    import sqlite3
    tickers: List[str] = []
    try:
        conn = sqlite3.connect(f"file:{PRICE_HISTORY_DB}?mode=ro", uri=True)
        rows = conn.execute(
            "SELECT ticker FROM price_history "
            "GROUP BY ticker HAVING COUNT(*) >= ? "
            "ORDER BY ticker",
            (min_bars,),
        ).fetchall()
        tickers = [r[0] for r in rows]
        conn.close()
    except sqlite3.DatabaseError:
        # price_history.db missing/empty — fall back to stocks.db
        try:
            conn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True)
            rows = conn.execute(
                "SELECT ticker FROM stock_daily_prices "
                "GROUP BY ticker HAVING COUNT(*) >= ? "
                "ORDER BY ticker",
                (min_bars,),
            ).fetchall()
            tickers = [r[0] for r in rows]
            conn.close()
        except sqlite3.DatabaseError:
            pass
    return tickers


def filter_tickers_by_history_depth(
    tickers: List[str], min_bars: int = 10
) -> List[str]:
    """Filter a list of tickers to only those with at least `min_bars` price bars.

    SELECTION-FIX (v3.56.0): Used by trigger_analysis_manual and run_full_analysis
    to skip junk tickers (e.g. TWSATA/FUTURE with 1 bar) BEFORE handing the list
    to run_analysis_batch. The batch's min_bars gate would otherwise reject them
    one-by-one → `analyzed=0`.

    Args:
        tickers: List of ticker symbols (any case, will be uppercased internally).
        min_bars: Minimum number of price bars required (default 10).

    Returns:
        List of tickers (UPPERCASE) that have >= min_bars in price_history.db
        (or stock_daily_prices as fallback). Preserves the input order. If the
        price_history DB is unreadable, returns the input tickers unchanged
        (defensive — let the batch's own min_bars gate handle it).
    """
    if not tickers:
        return []
    # Preserve order + dedupe (case-insensitive)
    seen: set = set()
    ordered: List[str] = []
    for t in tickers:
        up = str(t or "").strip().upper()
        if up and up not in seen:
            seen.add(up)
            ordered.append(up)

    try:
        valid = set(get_tickers_with_history(min_bars=min_bars))
    except Exception:
        # DB read failed — defensive: return input as-is (batch will skip)
        return ordered

    if not valid:
        # price_history.db empty/missing — return input as-is
        return ordered

    return [t for t in ordered if t in valid]


# ─────────────────────────────────────────────────────────────────────────────
# Backward-compat aliases (deprecated — will be removed in PHASE 7)
# ─────────────────────────────────────────────────────────────────────────────
def load_merged_history(ticker: str, db_path: str = "", limit: int = 100) -> List[Dict]:
    """DEPRECATED: use load_price_history(). Kept for backward compat.

    The db_path argument is ignored (we always use the canonical DB paths).
    """
    return load_price_history(ticker, limit=limit)


__all__ = [
    "load_price_history",
    "load_closes",
    "load_price_history_until",
    "get_latest_price",
    "get_tickers_with_history",
    "filter_tickers_by_history_depth",
    "clear_cache",
    "get_cache_stats",
    # deprecated aliases
    "load_merged_history",
]


if __name__ == "__main__":
    # Smoke test: python3 -m data.prices COMI
    import sys
    t = sys.argv[1] if len(sys.argv) > 1 else "COMI"
    print(f"Loading price history for {t}...")
    h = load_price_history(t, limit=10)
    print(f"Got {len(h)} candles:")
    for c in h:
        print(f"  {c['date']}  O={c['open']:.2f} H={c['high']:.2f} "
              f"L={c['low']:.2f} C={c['close']:.2f} V={c['volume']}")
    print(f"\nCache stats: {get_cache_stats()}")
