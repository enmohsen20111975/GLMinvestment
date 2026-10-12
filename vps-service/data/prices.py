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

    load_egksco_history(ticker, limit=120) -> List[Dict]
        FIX-1 (Rule 46): read directly from db/data_engine.db.egksco_price_history.
        This is the CANONICAL price source since 2026-09-03 (DB-CLEANUP-WAVE-3).
        load_price_history() calls this FIRST; falls back to _canonical_load only
        if egksco returns empty.

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
1. **FIX-1 (Step 2)**: `load_price_history` now calls `load_egksco_history`
   FIRST (data_engine.db.egksco_price_history — Rule 46 canonical source).
   Only if egksco returns empty does it fall back to `_canonical_load`
   (master_analyzer.load_merged_history). Per owner directive: NEVER use
   placeholder data — empty `[]` is honest, fake data is forbidden (Rule 24).
2. **Process-level LRU cache**: same (ticker, limit) in the same run = 1 DB hit.
   This cuts DB reads by ~80% in batch analysis (20 stocks × 5 readers each).
3. **Consistent return format**: always `[{date, open, high, low, close, volume}]`.
   Callers that need tuples or floats use the convenience helpers.
4. **Fallback chain** (per owner directive: empty `[]` is preferred over fake):
   - PRIMARY: data_engine.db.egksco_price_history (Rule 46)
   - SECONDARY: price_history.db + intraday.db (legacy master_analyzer path)
   - LAST RESORT: stock_daily_prices (stocks.db)
   - NEVER placeholder data (Rule 24)

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
# FIX-1 (Rule 46 — DB-CLEANUP-WAVE-3): data_engine.db.egksco_price_history is
# the CANONICAL price source since 2026-09-03. price_history.db is a safety net
# only. Reference: engines/backtest_engine.py:128-131 + core/migrator.py:488-500.
DATA_ENGINE_DB = str(DB_DIR / "data_engine.db")


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


def _parse_volume(v: Any) -> int:
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return int(v)
    v_str = str(v).strip().replace('\u202f', '').replace(' ', '').replace(',', '')
    if not v_str:
        return 0
    multiplier = 1
    if v_str.upper().endswith('K'):
        multiplier = 1000
        v_str = v_str[:-1]
    elif v_str.upper().endswith('M'):
        multiplier = 1000000
        v_str = v_str[:-1]
    elif v_str.upper().endswith('B'):
        multiplier = 1000000000
        v_str = v_str[:-1]
    try:
        return int(float(v_str) * multiplier)
    except Exception:
        return 0


def _parse_price(p: Any) -> Optional[float]:
    if p is None:
        return None
    if isinstance(p, (int, float)):
        return float(p)
    try:
        cleaned = str(p).strip().replace(',', '').replace(' ', '')
        return float(cleaned)
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Canonical egksco reader (FIX-1: data_engine.db.egksco_price_history)
# ─────────────────────────────────────────────────────────────────────────────
# BRAVO-CO-DEPLOYMENT (B1): egksco is tried in BOTH data_engine.db AND
# stocks.db (some deployments keep the table in stocks.db with column `date`
# instead of `price_date`). We probe both files transparently so the caller
# doesn't care which physical DB the canonical source lives in.
_EGKSCO_DB_CANDIDATES: Tuple[str, ...] = (DATA_ENGINE_DB, STOCKS_DB)


def _try_egksco_in_db(db_path: str, ticker: str, limit: int) -> List[Dict[str, Any]]:
    """Probe one DB file for egksco_price_history and return rows for `ticker`.

    Used internally by load_egksco_history to scan multiple candidate DBs.
    Returns [] on any failure (file missing, table missing, malformed, etc.).
    """
    import sqlite3
    import os

    if not db_path or not os.path.exists(db_path):
        return []

    base_ticker = ticker.upper().strip().split(".")[0]
    base_limit = max(1, min(int(limit), 2000))

    conn = None
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=3)
        cur = conn.cursor()

        cur.execute("PRAGMA table_info(egksco_price_history)")
        cols = [r[1] for r in cur.fetchall()]
        if not cols:
            return []  # table not in this DB — try next candidate

        # Detect column names (canonical schema uses `price_date` +
        # `*_price`; legacy egksco_scraper uses `date` + `*_price`).
        date_col = "price_date" if "price_date" in cols else (
            "date" if "date" in cols else None
        )
        if date_col is None:
            return []

        open_col = "open_price" if "open_price" in cols else (
            "open" if "open" in cols else None
        )
        high_col = "high_price" if "high_price" in cols else (
            "high" if "high" in cols else None
        )
        low_col = "low_price" if "low_price" in cols else (
            "low" if "low" in cols else None
        )
        close_col = "close_price" if "close_price" in cols else (
            "close" if "close" in cols else None
        )
        vol_col = "volume" if "volume" in cols else None

        if close_col is None:
            return []

        sym_col = "symbol" if "symbol" in cols else (
            "ticker" if "ticker" in cols else None
        )
        if sym_col is None:
            return []

        sel = (
            f"SELECT {date_col}, {open_col}, {high_col}, {low_col}, {close_col}"
            + (f", {vol_col}" if vol_col else ", NULL")
            + f" FROM egksco_price_history WHERE {sym_col} = ?"
            + f" ORDER BY {date_col} DESC LIMIT ?"
        )
        cur.execute(sel, (base_ticker, base_limit))
        rows = cur.fetchall()

        if not rows:
            return []

        result: List[Dict[str, Any]] = []
        for row in reversed(rows):
            d = row[0]
            o = _parse_price(row[1])
            h = _parse_price(row[2])
            l = _parse_price(row[3])
            c = _parse_price(row[4])
            v = _parse_volume(row[5]) if len(row) > 5 else 0
            if c is None or c <= 0:
                continue  # skip corrupt rows
            result.append({
                "date": d,
                "open": o if o is not None else c,
                "high": h if h is not None else c,
                "low": l if l is not None else c,
                "close": c,
                "volume": v,
            })
        return result
    except sqlite3.DatabaseError as e:
        print(f"[data.prices] egksco read error in {db_path}: {e} "
              f"— trying next source (no placeholder per Rule 24)")
        return []
    except Exception as e:
        print(f"[data.prices] egksco probe error in {db_path}: {e}")
        return []
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def load_egksco_history(ticker: str, limit: int = 120) -> List[Dict[str, Any]]:
    """Load daily price history from egksco_price_history.

    THE canonical EGX price source per Rule 46 (DB-CLEANUP-WAVE-3, 2026-09-03)
    which migrated price_history.db → egksco_price_history.

    BRAVO-CO-DEPLOYMENT (B1): probes BOTH data_engine.db AND stocks.db
    transparently — different deployments keep the table in different files.
    Returns the first non-empty result.

    Args:
        ticker: Stock symbol (e.g. "COMI"). Suffixes (.CA, .SR) stripped.
        limit: Max candles to return (most recent). Default 120.

    Returns:
        List of daily candles, OLDEST first:
        [{date, open, high, low, close, volume}, ...]

        EMPTY list `[]` if:
          - DB file not found (per owner directive: NO placeholder data)
          - Table doesn't exist
          - No rows for the ticker

    Per owner directive + Rule 24:
        "مانستعملش بيانات وهمية خالص تحت اى ظرف" — return empty + log honestly.
    """
    if not ticker:
        return []

    base_ticker = ticker.upper().strip().split(".")[0]
    base_limit = max(1, min(int(limit), 2000))

    for db_path in _EGKSCO_DB_CANDIDATES:
        rows = _try_egksco_in_db(db_path, base_ticker, base_limit)
        if rows:
            return rows
    return []  # all candidates empty — honest empty (Rule 24)


# ─────────────────────────────────────────────────────────────────────────────
# price_history.db reader — with PRAGMA integrity_check (BRAVO-CO-DEPLOYMENT B1)
# ─────────────────────────────────────────────────────────────────────────────
def _price_history_db_is_healthy() -> bool:
    """Return True iff price_history.db is openable and passes integrity_check.

    BRAVO-CO-DEPLOYMENT (B1): the production price_history.db was found
    malformed on 2026-10-12 (`PRAGMA integrity_check` returned
    'database disk image is malformed'). Any caller that silently reads
    from it gets `sqlite3.DatabaseError` and falls back to placeholder
    data — which violates Rule 24.

    This helper runs `PRAGMA integrity_check` (read-only, safe on prod)
    before any SELECT. Result is cached for the process lifetime — the
    DB doesn't heal itself mid-run.
    """
    import sqlite3
    import os

    global _price_history_db_health_cache
    if _price_history_db_health_cache is not None:
        return _price_history_db_health_cache

    if not os.path.exists(PRICE_HISTORY_DB):
        _price_history_db_health_cache = False
        return False

    conn = None
    try:
        conn = sqlite3.connect(f"file:{PRICE_HISTORY_DB}?mode=ro", uri=True, timeout=3)
        cur = conn.cursor()
        # PRAGMA integrity_check returns 'ok' for healthy DBs, or a multi-line
        # error message describing the corruption.
        row = cur.execute("PRAGMA integrity_check(1)").fetchone()
        healthy = bool(row) and str(row[0]).strip().lower() == "ok"
        if not healthy:
            print(f"[data.prices] ⚠️ price_history.db integrity_check FAILED: "
                  f"{row[0] if row else 'no result'} — using fallback sources")
        _price_history_db_health_cache = healthy
        return healthy
    except sqlite3.DatabaseError as e:
        print(f"[data.prices] ⚠️ price_history.db integrity_check raised: {e} "
              f"— using fallback sources")
        _price_history_db_health_cache = False
        return False
    except Exception as e:
        print(f"[data.prices] ⚠️ price_history.db integrity probe error: {e}")
        _price_history_db_health_cache = False
        return False
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


_price_history_db_health_cache: Optional[bool] = None


def load_price_history_db_rows(ticker: str, limit: int = 120) -> List[Dict[str, Any]]:
    """Read rows from price_history.db (with integrity check).

    Returns [] if the DB is missing, malformed, or has no rows for the ticker.
    Schema expected: price_history(ticker TEXT, date TEXT, open, high, low,
    close, volume) — same as backtest_engine.py uses.
    """
    import sqlite3

    if not _price_history_db_is_healthy():
        return []

    base_ticker = ticker.upper().strip().split(".")[0]
    base_limit = max(1, min(int(limit), 2000))

    conn = None
    try:
        conn = sqlite3.connect(f"file:{PRICE_HISTORY_DB}?mode=ro", uri=True, timeout=3)
        cur = conn.cursor()
        # Detect schema (some deployments use `price_date`, others `date`)
        cur.execute("PRAGMA table_info(price_history)")
        cols = [r[1] for r in cur.fetchall()]
        if not cols:
            return []
        date_col = "date" if "date" in cols else (
            "price_date" if "price_date" in cols else None
        )
        if date_col is None:
            return []
        ticker_col = "ticker" if "ticker" in cols else (
            "symbol" if "symbol" in cols else None
        )
        if ticker_col is None:
            return []
        # Pick OHLC column names
        open_col = "open" if "open" in cols else (
            "open_price" if "open_price" in cols else None
        )
        high_col = "high" if "high" in cols else (
            "high_price" if "high_price" in cols else None
        )
        low_col = "low" if "low" in cols else (
            "low_price" if "low_price" in cols else None
        )
        close_col = "close" if "close" in cols else (
            "close_price" if "close_price" in cols else None
        )
        vol_col = "volume" if "volume" in cols else None
        if close_col is None:
            return []
        sel = (
            f"SELECT {date_col}, {open_col}, {high_col}, {low_col}, {close_col}"
            + (f", {vol_col}" if vol_col else ", NULL")
            + f" FROM price_history WHERE {ticker_col} = ?"
            + f" ORDER BY {date_col} DESC LIMIT ?"
        )
        cur.execute(sel, (base_ticker, base_limit))
        rows = cur.fetchall()
        if not rows:
            return []
        result: List[Dict[str, Any]] = []
        for row in reversed(rows):
            d = row[0]
            o = _parse_price(row[1])
            h = _parse_price(row[2])
            l = _parse_price(row[3])
            c = _parse_price(row[4])
            v = _parse_volume(row[5]) if len(row) > 5 else 0
            if c is None or c <= 0:
                continue
            result.append({
                "date": d,
                "open": o if o is not None else c,
                "high": h if h is not None else c,
                "low": l if l is not None else c,
                "close": c,
                "volume": v,
            })
        return result
    except sqlite3.DatabaseError as e:
        print(f"[data.prices] price_history.db read error: {e} "
              f"— using fallback (no placeholder per Rule 24)")
        return []
    except Exception as e:
        print(f"[data.prices] load_price_history_db_rows error: {e}")
        return []
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


# ─────────────────────────────────────────────────────────────────────────────
# stock_daily_prices reader (stocks.db) — BRAVO-CO-DEPLOYMENT (B1)
# ─────────────────────────────────────────────────────────────────────────────
def load_stock_daily_prices(ticker: str, limit: int = 120) -> List[Dict[str, Any]]:
    """Read daily candles from stocks.db.stock_daily_prices.

    This table has TWO pairs of OHLC columns: legacy (open/high/low/close)
    and canonical (open_price/high_price/low_price/close_price). The legacy
    pair is sometimes populated when the canonical pair is NULL (e.g. for
    PORT in the 2026-10-12 deployment). We prefer canonical but fall back
    to legacy per-column to maximise coverage without fabrication.

    Schema (stocks.db):
        stock_daily_prices(
            id, ticker, price_date,
            open, high, low, close,           -- legacy OHLC
            volume, change_percent, fetch_time,
            open_price, high_price, low_price, close_price,  -- canonical OHLC
            turnover, market
        )

    Returns candles oldest-first. Honest empty list when no real rows.
    """
    import sqlite3
    import os

    if not ticker or not os.path.exists(STOCKS_DB):
        return []

    base_ticker = ticker.upper().strip().split(".")[0]
    base_limit = max(1, min(int(limit), 2000))

    conn = None
    try:
        conn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True, timeout=3)
        cur = conn.cursor()
        cur.execute("PRAGMA table_info(stock_daily_prices)")
        cols = [r[1] for r in cur.fetchall()]
        if not cols:
            return []

        date_col = "price_date" if "price_date" in cols else "date"
        # Per-column preference: canonical first, legacy second
        open_col = "open_price" if "open_price" in cols else (
            "open" if "open" in cols else None
        )
        high_col = "high_price" if "high_price" in cols else (
            "high" if "high" in cols else None
        )
        low_col = "low_price" if "low_price" in cols else (
            "low" if "low" in cols else None
        )
        # For close we need a robust pick — try canonical; on NULL rows we'll
        # also try legacy in Python (per-row) below.
        close_canon = "close_price" if "close_price" in cols else None
        close_legacy = "close" if "close" in cols else None
        vol_col = "volume" if "volume" in cols else None
        turn_col = "turnover" if "turnover" in cols else None

        # Build SELECT with COALESCE(canonical, legacy) for resilience
        def _col_expr(canon: Optional[str], legacy: Optional[str]) -> str:
            if canon and legacy:
                return f"COALESCE({canon}, {legacy})"
            return canon or legacy or "NULL"

        ohlc = ", ".join([
            _col_expr(open_col, None),
            _col_expr(high_col, None),
            _col_expr(low_col, None),
            _col_expr(close_canon, close_legacy),
        ])
        vol_expr = vol_col if vol_col else "NULL"
        turn_expr = turn_col if turn_col else "NULL"

        sel = (
            f"SELECT {date_col}, {ohlc}, {vol_expr}, {turn_expr} "
            f"FROM stock_daily_prices WHERE ticker = ? "
            f"ORDER BY {date_col} DESC LIMIT ?"
        )
        cur.execute(sel, (base_ticker, base_limit))
        rows = cur.fetchall()
        if not rows:
            return []

        result: List[Dict[str, Any]] = []
        for row in reversed(rows):
            d = row[0]
            o = _parse_price(row[1])
            h = _parse_price(row[2])
            l = _parse_price(row[3])
            c = _parse_price(row[4])
            v = _parse_volume(row[5]) if len(row) > 5 else 0
            turn = _parse_price(row[6]) if len(row) > 6 else None
            if c is None or c <= 0:
                continue  # skip corrupt / NULL rows
            result.append({
                "date": d,
                "open": o if o is not None else c,
                "high": h if h is not None else c,
                "low": l if l is not None else c,
                "close": c,
                "volume": v,
                "turnover": float(turn) if turn else None,
            })
        return result
    except sqlite3.DatabaseError as e:
        print(f"[data.prices] stock_daily_prices read error: {e}")
        return []
    except Exception as e:
        print(f"[data.prices] load_stock_daily_prices error: {e}")
        return []
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def load_stocks_table_snapshot(ticker: str) -> Optional[Dict[str, Any]]:
    """Read the current snapshot row from stocks.db.stocks (single-row fallback).

    BRAVO-CO-DEPLOYMENT (B1): when stock_daily_prices has very few rows
    (e.g. PORT had 37 rows but all stamped with the same current_price —
    effectively 1 candle), we read the `stocks` table snapshot to obtain
    at least one honest candle with the latest open/high/low/close.

    Returns None if no row found. The returned dict has the standard
    {date, open, high, low, close, volume} shape plus a `_source` marker.
    """
    import sqlite3
    import os

    if not ticker or not os.path.exists(STOCKS_DB):
        return None

    base_ticker = ticker.upper().strip().split(".")[0]

    conn = None
    try:
        conn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True, timeout=3)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        row = cur.execute(
            "SELECT ticker, current_price, previous_close, open_price, "
            "high_price, low_price, close, volume, turnover_egp, "
            "last_updated, updated_at, last_update "
            "FROM stocks WHERE ticker = ? LIMIT 1",
            (base_ticker,),
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        cp = _parse_price(d.get("current_price"))
        if cp is None or cp <= 0:
            # Try `close` column as a fallback
            cp = _parse_price(d.get("close"))
            if cp is None or cp <= 0:
                return None
        op = _parse_price(d.get("open_price")) or cp
        hp = _parse_price(d.get("high_price")) or cp
        lp = _parse_price(d.get("low_price")) or cp
        vol = _parse_volume(d.get("volume")) or 0
        # Use last_updated (ISO datetime) → strip to date
        date_str = ""
        for k in ("last_updated", "updated_at", "last_update"):
            v = d.get(k)
            if v:
                date_str = str(v)[:10]
                break
        if not date_str:
            date_str = datetime.now().strftime("%Y-%m-%d")
        return {
            "date": date_str,
            "open": op,
            "high": hp,
            "low": lp,
            "close": cp,
            "volume": vol,
            "turnover": _parse_price(d.get("turnover_egp")),
            "_source": "stocks_snapshot",
        }
    except sqlite3.DatabaseError as e:
        print(f"[data.prices] stocks snapshot read error: {e}")
        return None
    except Exception as e:
        print(f"[data.prices] load_stocks_table_snapshot error: {e}")
        return None
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def _merge_candle_lists(*sources: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Merge multiple candle lists, deduping by date (most recent sources win).

    Each source is a list of {date, open, high, low, close, volume} dicts.
    Sources listed first take precedence (canonical > fallback). Returns a
    single list sorted oldest-first with unique dates.
    """
    by_date: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
    for src in sources:
        if not src:
            continue
        for candle in src:
            d = candle.get("date")
            if not d:
                continue
            # Normalize date to YYYY-MM-DD
            d_str = str(d)[:10]
            if d_str not in by_date:
                # Don't mutate the original dict
                merged = dict(candle)
                merged["date"] = d_str
                by_date[d_str] = merged
            # If date already present, keep the first (higher-priority source)
    return list(by_date.values())


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
        result = _load_from_stock_daily_prices(ticker, limit)
        if result:
            print(f"[data.prices] ⚠️ canonical load failed ({e}), "
                  f"fallback stock_daily_prices returned {len(result)} rows for {ticker}")
        return result


def _load_from_stock_daily_prices(ticker: str, limit: int) -> List[Dict[str, Any]]:
    """Read directly from stocks.db.stock_daily_prices — robust column handling.

    Task P0-BRAVO-CODEPLOYMENT-B1: هذا الـ reader يستخدم الأعمدة الأساسية
    (open/high/low/close) مع fallback إلي open_price/high_price/low_price/close_price
    لو الأعمدة الأساسية NULL. هذا يضمن قراءة كل الشموع المتاحة (حتى 365 شمعة).

    Returns: List of {date, open, high, low, close, volume} oldest first.
    """
    import sqlite3
    base_ticker = ticker.upper().strip().split(".")[0]

    def _parse_vol(v):
        """Parse volume — handles int, float, and string formats like '12.74M', '500K'."""
        if v is None:
            return 0
        if isinstance(v, (int, float)):
            return int(v)
        try:
            return int(v)
        except (ValueError, TypeError):
            pass
        # String with suffix (e.g. '12.74 M', '500 K', '1.2B')
        try:
            s = str(v).strip().replace('\u202f', '').replace('\xa0', '').replace(' ', '').upper()
            multiplier = 1
            if s.endswith('B'):
                multiplier = 1_000_000_000
                s = s[:-1]
            elif s.endswith('M'):
                multiplier = 1_000_000
                s = s[:-1]
            elif s.endswith('K'):
                multiplier = 1_000
                s = s[:-1]
            return int(float(s) * multiplier)
        except Exception:
            return 0

    try:
        conn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True, timeout=3)
        conn.row_factory = sqlite3.Row
        # استخدم COALESCE للأعمدة المزدوجة (open vs open_price)
        rows = conn.execute(
            """SELECT price_date as date,
                      COALESCE(open, open_price) as open,
                      COALESCE(high, high_price) as high,
                      COALESCE(low, low_price) as low,
                      COALESCE(close, close_price) as close,
                      volume
               FROM stock_daily_prices
               WHERE ticker = ? AND COALESCE(close, close_price) IS NOT NULL
                     AND COALESCE(close, close_price) > 0
               ORDER BY price_date DESC LIMIT ?""",
            (base_ticker, limit),
        ).fetchall()
        conn.close()
        result = []
        for r in reversed(rows):
            d = dict(r)
            result.append({
                "date": d["date"],
                "open": float(d["open"]) if d["open"] else 0.0,
                "high": float(d["high"]) if d["high"] else 0.0,
                "low": float(d["low"]) if d["low"] else 0.0,
                "close": float(d["close"]) if d["close"] else 0.0,
                "volume": _parse_vol(d["volume"]),
            })
        return result
    except Exception as e:
        print(f"[data.prices] _load_from_stock_daily_prices error for {ticker}: {e}")
        return []


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────
# BRAVO-CO-DEPLOYMENT (B1) — Multi-source merge strategy:
# 1) egksco_price_history (PRIMARY — Rule 46) — probed in BOTH data_engine.db
#    and stocks.db transparently.
# 2) price_history.db — used only if `PRAGMA integrity_check` passes. Malformed
#    DB is logged once + skipped (no placeholder data, per Rule 24).
# 3) stock_daily_prices in stocks.db — legacy OHLC + canonical OHLC columns
#    via COALESCE for resilience.
# 4) stocks table snapshot (1 row) — appended only if total < 30 candles so
#    the caller sees at least the latest honest price; warning is logged.
# All sources are merged by date (egksco wins on conflicts). If after merging
# the caller asked for limit=90 and got <30 candles, we still return what we
# have — NO fabrication (Rule 27).
_MIN_CANDLES_BEFORE_SNAPSHOT_FALLBACK = 30


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

    BRAVO-CO-DEPLOYMENT (B1) — Source priority + merge strategy:
        1. egksco_price_history (PRIMARY — Rule 46) — probed in both
           data_engine.db AND stocks.db transparently.
        2. price_history.db — used only after `PRAGMA integrity_check` passes.
           Malformed DB is logged + skipped (no placeholder, Rule 24).
        3. stock_daily_prices (stocks.db) — canonical OHLC via COALESCE with
           legacy OHLC columns.
        4. stocks table snapshot (1 row) — appended ONLY if total < 30
           candles so the caller sees at least the latest honest price.
        5. EMPTY list [] is the last resort — NO placeholder data (Rule 24/27).
    """
    if not ticker:
        return []

    # Normalize ticker: uppercase, strip suffix, and resolve known aliases
    raw_norm = ticker.upper().strip().split(".")[0]
    ticker_norm = raw_norm
    if ticker_norm in ('KORRA', 'KORAKORRAD'):
        ticker_norm = 'KORA'
    elif ticker_norm == 'COMMI':
        ticker_norm = 'COMI'
    else:
        try:
            import sqlite3
            conn = sqlite3.connect(STOCKS_DB, timeout=2.0)
            row = conn.execute("SELECT ticker FROM stocks WHERE UPPER(name) = ? OR UPPER(name_ar) = ?", (raw_norm, raw_norm)).fetchone()
            conn.close()
            if row:
                ticker_norm = row[0]
        except Exception:
            pass

    limit = max(1, min(int(limit), 2000))  # clamp 1..2000

    cache_key = (ticker_norm, limit)
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    # ── 1) PRIMARY: egksco_price_history (probes both data_engine.db + stocks.db) ──
    egksco_data = load_egksco_history(ticker_norm, limit)

    # ── 2) price_history.db (with PRAGMA integrity_check) ──
    #     Skip silently if malformed — we already logged the integrity failure.
    ph_data = load_price_history_db_rows(ticker_norm, limit) if not egksco_data else []
    # Even if egksco has data, we still want to fill gaps from price_history.db
    # (some tickers have sparse egksco rows + full price_history rows). But
    # only attempt this if integrity check passed AND egksco returned < limit.
    if egksco_data and len(egksco_data) < limit:
        extra_ph = load_price_history_db_rows(ticker_norm, limit)
        # Merge: egksco takes precedence; ph fills in dates egksco is missing.
        if extra_ph:
            ph_data = extra_ph
# ── Task P0-BRAVO-CODEPLOYMENT-B1 (Bravo addition) ──
    # ── Task P0-BRAVO-CODEPLOYMENT-B1 (Owner Directive 2026-10-12) ──
    # ROOT-CAUSE FIX: لو egksco رجع أقل من 30 شمعة (مثلاً PORT بـ شمعة واحدة)،
    # يُمنع الاكتفاء بها! يتم الدمج فورًا مع stock_daily_prices + price_history.db
    # لضمان إرجاع تاريخ كامل (90 إلى 365 شمعة) لأي سهم له بيانات تاريخية.
    MIN_FULL_HISTORY = 30  # أقل من هذا = "مبتور" → يجب الدمج
    needs_merge = len(egksco_data) < MIN_FULL_HISTORY

    # 2) FALLBACK / MERGE: master_analyzer.load_merged_history (tries price_history.db +
    #    data_engine.db.egksco_price_history via Step-3 fallback + stock_daily_prices)
    if not egksco_data or needs_merge:
        canonical_data = _canonical_load(ticker_norm, limit)
        if not canonical_data and ticker_norm != raw_norm:
            canonical_data = _canonical_load(raw_norm, limit)
        # Task B1: لو canonicalData قليل، اقرأ مباشرة من stock_daily_prices (robust reader)
        sdp_data = _load_from_stock_daily_prices(ticker_norm, limit)
        if len(sdp_data) > len(canonical_data):
            canonical_data = sdp_data  # استخدم الأكثر اكتمالاً
    else:
        canonical_data = []

    # ── 3) stock_daily_prices (stocks.db) — fallback + gap-filler ──
    #     Used when egksco AND price_history.db are both empty/sparse.
    need_sdp_fallback = (
        (not egksco_data and not ph_data)
        or (len(egksco_data) + len(ph_data) < limit)
    )
    sdp_data = load_stock_daily_prices(ticker_norm, limit) if need_sdp_fallback else []
    # Also try the raw_norm ticker variant (alias lookups sometimes fail)
    if not sdp_data and ticker_norm != raw_norm:
        sdp_data = load_stock_daily_prices(raw_norm, limit)

    # ── 4) Merge sources (egksco > price_history.db > stock_daily_prices) ──
    merged = _merge_candle_lists(egksco_data, ph_data, sdp_data)

    # ── 5) Last-resort: stocks table snapshot (single candle) ──
    #     If after all sources we have < 30 unique candles, append the
    #     latest snapshot row so the caller sees at least one honest candle.
    snapshot_used = False
    if len(merged) < _MIN_CANDLES_BEFORE_SNAPSHOT_FALLBACK:
        snapshot = load_stocks_table_snapshot(ticker_norm)
        if snapshot is None and ticker_norm != raw_norm:
            snapshot = load_stocks_table_snapshot(raw_norm)
        if snapshot is not None:
            # Merge — but only if the snapshot's date is not already present.
            existing_dates = {c["date"] for c in merged}
            if snapshot["date"] not in existing_dates:
                merged.append(snapshot)
                snapshot_used = True
            print(
                f"[data.prices] ⚠️ {ticker_norm}: only {len(merged)} unique "
                f"candle(s) across all sources — appended stocks-table snapshot "
                f"(current_price={snapshot.get('close')}, date={snapshot.get('date')}). "
                f"Rule 27: NO fabrication — returning honest data only. "
                f"Run the egksco scraper to backfill history.",
            )

    # ── 6) Honest logging ──
    n_egksco = len(egksco_data)
    n_ph = len(ph_data)
    n_sdp = len(sdp_data)
    n_total = len(merged)
    if n_egksco > 0:
        print(f"[data.prices] {ticker_norm}: egksco={n_egksco} | "
              f"price_history.db={n_ph} | stock_daily_prices={n_sdp} | "
              f"merged={n_total} (egksco PRIMARY — Rule 46)")
    elif n_total > 0:
        print(f"[data.prices] {ticker_norm}: egksco=0 | "
              f"price_history.db={n_ph} | stock_daily_prices={n_sdp} | "
              f"merged={n_total}"
              + (" (+ stocks snapshot)" if snapshot_used else ""))
    else:
        print(f"[data.prices] {ticker_norm}: egksco=0 | price_history.db=0 | "
              f"stock_daily_prices=0 | merged=0 — NO DATA (empty per Rule 24)")

    # Pick the source — egksco first (PRIMARY), fallback to canonical
    data = merged
# ── Task P0-BRAVO-CODEPLOYMENT-B1 (Bravo addition) ──
    n_canonical = len(canonical_data)
    if n_egksco >= MIN_FULL_HISTORY:
        print(f"[data.prices] {ticker_norm}: egksco={n_egksco} rows (PRIMARY — Rule 46) | "
              f"canonical=0 rows (egksco sufficient ≥ {MIN_FULL_HISTORY})")
    elif n_egksco > 0 and n_canonical > 0:
        print(f"[data.prices] {ticker_norm}: egksco={n_egksco} rows (TRUNCATED < {MIN_FULL_HISTORY}) | "
              f"canonical={n_canonical} rows → MERGING for full history (Task B1)")
    elif n_egksco > 0:
        print(f"[data.prices] {ticker_norm}: egksco={n_egksco} rows (TRUNCATED < {MIN_FULL_HISTORY}) | "
              f"canonical=0 rows — no merge data available")
    elif n_canonical > 0:
        print(f"[data.prices] {ticker_norm}: egksco=0 rows | "
              f"canonical(fallback)={n_canonical} rows")
    else:
        print(f"[data.prices] {ticker_norm}: egksco=0 rows | "
              f"canonical=0 rows — NO DATA (empty per Rule 24)")

    # ── MERGE LOGIC (Task B1): dedup by date, prefer egksco (fresher), fill gaps ──
    if n_egksco > 0 and n_canonical > 0:
        # دمج: prefer egksco للتواريخ المتداخلة (أحدث)، أضف canonical للتواريخ الناقصة
        merged_by_date: dict = {}
        for row in canonical_data:
            d = row.get("date") or row.get("price_date")
            if d:
                merged_by_date[d] = row
        for row in egksco_data:
            d = row.get("date") or row.get("price_date")
            if d:
                merged_by_date[d] = row  # egksco يفضل (overwrite canonical)
        data = sorted(merged_by_date.values(), key=lambda r: r.get("date", r.get("price_date", "")))
        print(f"[data.prices] {ticker_norm}: MERGED total={len(data)} rows "
              f"(egksco={n_egksco} + canonical={n_canonical}, dedup by date)")
    else:
        # Pick the source — egksco first (PRIMARY), fallback to canonical
        data = egksco_data if egksco_data else canonical_data

    # Ensure consistent key names (canonical returns date/open/high/low/close/volume)
    # but be defensive: some callers expect close_price/high_price. We standardize here.
    normalized: List[Dict[str, Any]] = []
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
                "change_percent": 0.0,  # computed in post-processing below
            })

    # Sort by date ascending (oldest first) — merge may not preserve order
    normalized.sort(key=lambda x: x["date"] or "")

    # Compute change_percent for each candle (oldest first)
    # FIXED: moved OUTSIDE the row loop (was O(N²) + recomputed each iteration)
    for i in range(1, len(normalized)):
        prev_close = normalized[i - 1]["close"]
        curr_close = normalized[i]["close"]
        if prev_close > 0:
            normalized[i]["change_percent"] = ((curr_close - prev_close) / prev_close) * 100.0

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

    BRAVO-CO-DEPLOYMENT (B1): honours `PRAGMA integrity_check` on
    price_history.db — if the DB is malformed, we skip silently and fall
    back to stock_daily_prices in stocks.db.
    """
    import sqlite3
    tickers: List[str] = []

    # 1) price_history.db — only if integrity_check passes
    if _price_history_db_is_healthy():
        try:
            conn = sqlite3.connect(f"file:{PRICE_HISTORY_DB}?mode=ro", uri=True)
            # Detect ticker column name
            cur = conn.cursor()
            cur.execute("PRAGMA table_info(price_history)")
            cols = [r[1] for r in cur.fetchall()]
            tkr_col = "ticker" if "ticker" in cols else (
                "symbol" if "symbol" in cols else None
            )
            if tkr_col:
                rows = conn.execute(
                    f"SELECT {tkr_col} FROM price_history "
                    f"GROUP BY {tkr_col} HAVING COUNT(*) >= ? "
                    f"ORDER BY {tkr_col}",
                    (min_bars,),
                ).fetchall()
                tickers = [r[0] for r in rows]
            conn.close()
        except sqlite3.DatabaseError:
            tickers = []

    # 2) Fallback: stocks.db.stock_daily_prices (and egksco if present)
    if not tickers:
        try:
            conn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True)
            # stock_daily_prices uses `ticker`
            try:
                rows = conn.execute(
                    "SELECT ticker FROM stock_daily_prices "
                    "GROUP BY ticker HAVING COUNT(*) >= ? "
                    "ORDER BY ticker",
                    (min_bars,),
                ).fetchall()
                tickers = [r[0] for r in rows]
            except sqlite3.DatabaseError:
                pass
            # Also include egksco_price_history tickers if present
            try:
                cur = conn.cursor()
                cur.execute("PRAGMA table_info(egksco_price_history)")
                cols = [r[1] for r in cur.fetchall()]
                sym_col = "symbol" if "symbol" in cols else (
                    "ticker" if "ticker" in cols else None
                )
                if sym_col:
                    rows = conn.execute(
                        f"SELECT {sym_col} FROM egksco_price_history "
                        f"GROUP BY {sym_col} HAVING COUNT(*) >= ? "
                        f"ORDER BY {sym_col}",
                        (min_bars,),
                    ).fetchall()
                    extra = {r[0] for r in rows}
                    merged = list(set(tickers) | extra)
                    merged.sort()
                    tickers = merged
            except sqlite3.DatabaseError:
                pass
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
    "load_egksco_history",
    "load_closes",
    "load_price_history_until",
    "load_price_history_db_rows",
    "load_stock_daily_prices",
    "load_stocks_table_snapshot",
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
