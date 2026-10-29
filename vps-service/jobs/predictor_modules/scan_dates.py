"""
scan_dates.py — Strangler Pattern module (Phase 7.2)
=====================================================
Extracted VERBATIM from `vps-service/jobs/daily_predictor.py` (lines ~339-425).
The original function `get_scan_dates()` is re-exported by daily_predictor.py so
callers see no behavior change.

Purpose:
    Get trading dates from price history within [start, end].
    Tries 3 sources in order:
      1. price_history.db (PRIMARY — canonical, 1.4M rows)
      2. data_engine.db.egksco_price_history (FALLBACK — legacy)
      3. stocks.db.stock_daily_prices (FALLBACK — last resort)

    All raw sqlite3 fallback calls inside `except` blocks have been removed;
    db_manager (DAL) is now the SOLE DB gate (CATEGORY A — no silent bypass).
"""
from __future__ import annotations

import sqlite3
from pathlib import Path

# Import the db_manager flag + singleton (extracted to db_helpers.py).
# Use relative import so the package works regardless of how it's loaded.
from .db_helpers import _V402_DBM_AVAILABLE, _dbm


def get_scan_dates(start_date, end_date, scan_interval):
    """Get trading dates from price history within [start, end].
    
    FIX (2026-09-03): data_engine.db هو PRIMARY (طازج أثناء الجلسة).
    Owner: "لازم تشتغل على data-engine.db لان هى دى الى فيها البيانات اثناء الجلسة"
    
    - data_engine.db.egksco_price_history: 162,946 rows (PRIMARY — طازج)
    - price_history.db.price_history: LEGACY fallback (متجمد)
    - stocks.db.stock_daily_prices: fallback أخير
    """
    _db_dir = Path(__file__).resolve().parents[3] / 'db'
    
    # Phase 4 (DATA-UNIFICATION): price_history.db is now PRIMARY (canonical, 1.4M rows)
    # Legacy: egksco_price_history was PRIMARY — now fallback (was frozen/stale)
    # 1. PRIMARY: price_history.db.price_history (canonical — 1.4M rows, 2000-2026)
    try:
        # Rule 54 / Phase 3: DAL is the SOLE DB gate
        _v402_gsd_ctx = None
        conn = _dbm.get_connection(str(_db_dir / 'price_history.db'), writable=False)
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT date AS price_date FROM price_history WHERE date >= ? AND date <= ? ORDER BY date ASC",
            (start_date, end_date),
        )
        dates = [row[0] for row in cur.fetchall()]
        conn.close()
        
        # UNIFY-FIX (2026-10-08): لو egksco_price_history قديمة → fallback لـ price_history.db
        # كان الكود يرجّع آخر يوم متاح في egksco (2026-09-26) بدل البحث عن بيانات طازجة
        if dates:
            print(f"[V40.2] Using price_history.db (PRIMARY) — {len(dates)} dates", flush=True)
            return dates[::scan_interval]
    except Exception:
        pass
    
    # Phase 4 FALLBACK 1: data_engine.db.egksco_price_history (legacy — was PRIMARY)
    try:
        # Phase 7.1: migrated
        from core.db_manager import db_manager
        conn = db_manager.get_connection(str(_db_dir / 'data_engine.db'), writable=False)
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT price_date FROM egksco_price_history WHERE price_date >= ? AND price_date <= ? ORDER BY price_date ASC",
            (start_date, end_date),
        )
        dates = [row[0] for row in cur.fetchall()]
        conn.close()
        if dates:
            print(f"[V40.2] FALLBACK: egksco_price_history — {len(dates)} dates (price_history.db unavailable)", flush=True)
            return dates[::scan_interval]
    except Exception:
        pass
    
    # 3. FALLBACK 2: stocks.db (stock_daily_prices — آخر 30 يوم)
    try:
        # Rule 54 / Phase 3: DAL is the SOLE DB gate
        _v402_gsd2_ctx = None
        conn = _dbm.get_connection(str(_db_dir / 'stocks.db'), writable=False)
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT price_date FROM stock_daily_prices WHERE price_date >= ? AND price_date <= ? ORDER BY price_date ASC",
            (start_date, end_date),
        )
        dates = [row[0] for row in cur.fetchall()]
        conn.close()
        if dates:
            print(f"[V40.2] Using stocks.db (stock_daily_prices) — {len(dates)} dates", flush=True)
            return dates[::scan_interval]
    except Exception:
        pass
    
    print(f"⚠️  No trading dates found between {start_date} and {end_date}", flush=True)
    return []
