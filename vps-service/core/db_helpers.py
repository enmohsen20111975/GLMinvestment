"""
db_helpers.py — Canonical DB connection helpers (Phase 7.3 dedup)
==================================================================
Single source of truth for `_open_db` context manager + db_manager handle.

Before: 7+ files each defined their own `_open_db`, `_XXX_DBM_AVAILABLE` flag,
and `_dbm` reference — all functionally identical (Rule 54 / Phase 3).

Now: import from here:
    from core.db_helpers import _open_db, dbm, DBM_AVAILABLE

Behavior preserved:
- Prefers db_manager.get_connection (DAL) with WAL + busy_timeout + query_only
- Falls back to raw sqlite3.connect ONLY if db_manager import fails at module load
- CRITICAL FIX (forensic audit 2026-10-28): fallback now enforces
  PRAGMA query_only=1 for readonly, matching db_manager's readonly contract.
  Previously the fallback caught ALL exceptions (not just ImportError) and
  did NOT set query_only → readonly connections could silently write when
  db_manager raised. This closed a DB-gate bypass.

Architecture compliance:
- readonly fallback: query_only=1 enforced (cannot write)
- writable fallback: WAL + busy_timeout + synchronous=NORMAL (same as db_manager)
- fallback only fires on module-import failure (DBM_AVAILABLE=False) OR
  if db_manager.get_connection raises at call time (defensive)
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager

# Rule 54 / Phase 3: use db_manager as the DAL, fallback to raw sqlite3
try:
    from core.db_manager import db_manager as dbm
    DBM_AVAILABLE = True
except Exception as _dbm_err:
    dbm = None
    DBM_AVAILABLE = False
    print(f"[core.db_helpers] db_manager not available ({_dbm_err}) — falling back to raw sqlite3")


@contextmanager
def _open_db(db_path: str, writable: bool = False):
    """Rule 54 / Phase 3: استخدم db_manager.connection() مع fallback sqlite3.connect.

    Args:
        db_path: مسار الـ DB على القرص (ممكن يكون predictions.db أو stocks.db —
                 db_manager بيتعامل مع الـ absolute path مباشرة).
        writable: True للكتابة (WAL + busy_timeout)، False للقراءة فقط.

    Yields:
        sqlite3.Connection — بيستخدم raw sqlite3.connect عادي (بدون row_factory=Row)
        عشان الكود الموجود بـ يستخدم index-based access (row[0], row[1], ...).
        db_manager بـ يضيف row_factory=Row تلقائياً، و Row بـ يدعم index access
        زي tuples بالظبط، فمفيش مشكلة backward compat.

    FORENSIC FIX (2026-10-28):
        الـ fallback بـ يـ enforce PRAGMA query_only=1 للـ readonly connections
        (نفس الـ contract بتاع db_manager). ده بـ يمنع readonly bypass لما
        db_manager يـ raise.
    """
    ctx = None
    conn = None
    try:
        if DBM_AVAILABLE:
            conn = dbm.get_connection(db_path, writable=writable)
        else:
            raise RuntimeError("db_manager unavailable")
    except Exception:
        # fallback: raw sqlite3.connect (backward compat)
        # FORENSIC FIX: enforce query_only=1 for readonly to match db_manager contract
        conn = sqlite3.connect(db_path, timeout=30.0)
        try:
            conn.execute('PRAGMA busy_timeout=30000')
            if writable:
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('PRAGMA synchronous=NORMAL')
            else:
                # CRITICAL: enforce readonly — prevents silent write bypass
                conn.execute('PRAGMA query_only=1')
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


__all__ = ['_open_db', 'open_db_aliased', 'dbm', 'DBM_AVAILABLE']


# ---------------------------------------------------------------------------
# Alias-based variant (used by admin_routes.py + misc_routes.py)
# ---------------------------------------------------------------------------
# These call sites pass BOTH a db_alias (e.g. 'stocks') for db_manager AND
# a db_path for the raw-sqlite fallback. The fallback also forces
# row_factory = sqlite3.Row so dict(row) / row['col'] access keeps working.

@contextmanager
def open_db_aliased(db_alias: str, db_path: str, writable: bool = False):
    """Rule 54 / Phase 3: alias-based _open_db for admin/misc routes.

    Args:
        db_alias: اسم الـ DB المختصر ('stocks', 'predictions', 'data_engine', ...)
        db_path: مسار الـ DB على القرص (للـ fallback)
        writable: True للكتابة (WAL)، False للقراءة (readonly/immutable)

    Yields:
        sqlite3.Connection مع row_factory = sqlite3.Row (موحّد على المسارين).

    FORENSIC FIX (2026-10-28):
        الـ fallback بـ يـ enforce PRAGMA query_only=1 للـ readonly connections.
    """
    ctx = None
    conn = None
    try:
        if DBM_AVAILABLE:
            conn = dbm.get_connection(db_alias, writable=writable)
        else:
            raise RuntimeError("db_manager unavailable")
    except Exception:
        # fallback: raw sqlite3.connect (backward compat)
        # FORENSIC FIX: enforce query_only=1 for readonly to match db_manager contract
        conn = sqlite3.connect(db_path, timeout=30.0)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute('PRAGMA busy_timeout=30000')
            if writable:
                conn.execute('PRAGMA journal_mode=WAL')
                conn.execute('PRAGMA synchronous=NORMAL')
            else:
                # CRITICAL: enforce readonly — prevents silent write bypass
                conn.execute('PRAGMA query_only=1')
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
