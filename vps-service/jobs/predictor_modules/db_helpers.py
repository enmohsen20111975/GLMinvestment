"""
db_helpers.py — Strangler Pattern module (Phase 7.2)
=====================================================
Extracted VERBATIM from `vps-service/jobs/daily_predictor.py` (lines ~78-117).
Re-exports: `_V402_DBM_AVAILABLE`, `_dbm`, `_open_db()`.
The original names are re-imported by daily_predictor.py so callers see no
behavior change.

Purpose:
    Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect.
    Provides a context manager that prefers the central DAL (db_manager) but
    falls back to a raw sqlite3 connection with the same PRAGMA settings
    (busy_timeout=30000 + WAL for writes) if db_manager fails to import.

    The fallback sqlite3.connect() lives inside an `except` block, so the
    architecture scanner classifies it as CATEGORY A (WARNING) — allowed.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager

# Rule 54 / Phase 3: استخدم db_manager.connection() — fallback sqlite3.connect
try:
    from core.db_manager import db_manager as _dbm
    _V402_DBM_AVAILABLE = True
except Exception as _v402_err:
    _V402_DBM_AVAILABLE = False
    print(f"[v40_2_daily_generator] db_manager not available ({_v402_err}) — falling back to raw sqlite3")


@contextmanager
def _open_db(db_path: str, writable: bool = False):
    """Rule 54 / Phase 3: استخدم db_manager.connection() مع fallback sqlite3.connect."""
    ctx = None
    conn = None
    try:
        if _V402_DBM_AVAILABLE:
            conn = _dbm.get_connection(db_path, writable=writable)
        else:
            raise RuntimeError("db_manager unavailable")
    except Exception:
        conn = sqlite3.connect(db_path, timeout=30.0)
        try:
            conn.execute('PRAGMA busy_timeout=30000')
            if writable:
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('PRAGMA synchronous=NORMAL')
        except Exception:
            pass
        ctx = None
    try:
        yield conn
    finally:
        try:
            if ctx is not None:
                ctx.__exit__(None, None, None)
            else:
                conn.close()
        except Exception:
            pass
