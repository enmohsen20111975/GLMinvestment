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

Behavior is 100% equivalent (Strangler Pattern).
"""
from __future__ import annotations

import os
import sqlite3
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
    # BRAVO-SPEED-FIX (2026-10-20): pre-cache price_history لكل الـ tickers مرة واحدة
    # الـ bottleneck كان: get_price_data بـ 0.78s/ticker × 289 = 225s
    # الـ batch query بـ 1.4s لكل الـ tickers = تحسين 180×
    try:
        _cache_t0 = time.time()
        _ph_db_path = str(Path(__file__).resolve().parents[3] / 'db' / 'price_history.db')
        if os.path.exists(_ph_db_path):
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            _cache_con = db_manager.connection(_ph_db_path, writable=False).__enter__()
            _cache_con.row_factory = sqlite3.Row
            # batch query: كل الـ tickers + آخر 3 سنين (كفاية للـ MA200 + ATR + indicators)
            _ticker_placeholders = ','.join('?' * len(tickers))
            _cache_rows = _cache_con.execute(f"""
                SELECT ticker, date, open_price, high_price, low_price, close_price, volume
                FROM price_history
                WHERE UPPER(ticker) IN ({_ticker_placeholders})
                AND close_price IS NOT NULL AND close_price > 0
                AND date >= date('now', '-3 years')
                ORDER BY ticker, date ASC
            """, [t.upper() for t in tickers]).fetchall()
            _cache_con.close()
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
        else:
            print(f"  ⚠️  price_history.db not found at {_ph_db_path} — falling back to per-ticker queries", flush=True)
            return 0
    except Exception as _cache_err:
        print(f"  ⚠️  pre-cache failed ({type(_cache_err).__name__}: {_cache_err}) — falling back to per-ticker queries", flush=True)
        return 0
