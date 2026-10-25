"""
price_cache.py — Strangler Pattern module (Phase 8.2)
=====================================================
Extracted from `vps-service/jobs/daily_predictor.py` run_generator()
(BRAVO-SPEED-FIX batch query block — lines ~956-989).

Batch-queries price_history.db for ALL tickers at once instead of per-ticker
queries. This was the single biggest perf win in the V40.2 generator:
    before: 0.78s/ticker × 289 = ~225s
    after:  1.4s total = ~180x speedup

Sets `engine._price_cache` so the V38BacktestEngine can reuse the data.

BUG FIX (2026-10-24): The previous version used manual __enter__() + close()
which caused "Cannot operate on a closed database" errors when the regime
engine or other code tried to query the same DB afterwards. Fixed by using
db_manager.query() which properly manages the connection lifecycle via
context manager (open → query → close inside `with` block).

Behavior is 100% equivalent (Strangler Pattern).
"""
from __future__ import annotations

import os
import time
from collections import defaultdict
from pathlib import Path


def pre_cache_price_history(tickers, engine):
    """Batch-query price_history.db for every ticker at once.

    Sets `engine._price_cache` to a dict[ticker_upper] → list of
    (date, open, high, low, close, volume) tuples.

    Args:
        tickers: list[str] — tickers to pre-cache.
        engine:  V38BacktestEngine instance (gets `_price_cache` attribute set).

    Returns:
        int — number of tickers successfully cached (0 on failure).
    """
    try:
        _cache_t0 = time.time()
        _ph_db_path = str(Path(__file__).resolve().parents[3] / 'db' / 'price_history.db')
        if not os.path.exists(_ph_db_path):
            print(f"  ⚠️  price_history.db not found at {_ph_db_path} — falling back to per-ticker queries", flush=True)
            return 0

        # BUG FIX: Use db_manager.query() instead of manual __enter__() + close().
        # The old approach leaked connections and caused "Cannot operate on a closed
        # database" errors when subsequent code tried to query the same DB.
        # db_manager.query() uses a proper context manager (with block) that
        # guarantees the connection is closed after the query completes.
        from core.db_manager import db_manager

        # Build the query with IN clause for all tickers
        _ticker_placeholders = ','.join('?' * len(tickers))
        _cache_rows = db_manager.query('price_history', f"""
            SELECT ticker, date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE UPPER(ticker) IN ({_ticker_placeholders})
            AND close_price IS NOT NULL AND close_price > 0
            AND date >= date('now', '-3 years')
            ORDER BY ticker, date ASC
        """, [t.upper() for t in tickers])

        # group by ticker
        _price_cache = defaultdict(list)
        for r in _cache_rows:
            _price_cache[r['ticker'].upper()].append(
                (r['date'], r['open_price'], r['high_price'], r['low_price'], r['close_price'], r['volume'])
            )
        engine._price_cache = dict(_price_cache)
        _cache_elapsed = time.time() - _cache_t0
        print(f"  ⚡ BRAVO-SPEED-FIX: pre-cached {len(_price_cache)} tickers × {len(_cache_rows)} rows in {_cache_elapsed:.2f}s (batch query)", flush=True)
        return len(_price_cache)
    except Exception as _cache_err:
        print(f"  ⚠️  pre-cache failed ({type(_cache_err).__name__}: {_cache_err}) — falling back to per-ticker queries", flush=True)
        return 0
