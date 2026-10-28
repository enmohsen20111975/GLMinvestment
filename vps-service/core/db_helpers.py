"""
db_helpers.py — Canonical DB connection helpers (Phase 7.3 dedup)
==================================================================
Single source of truth for `_open_db` context manager + db_manager handle.

Before: 7+ files each defined their own `_open_db`, `_XXX_DBM_AVAILABLE` flag,
and `_dbm` reference — all functionally identical (Rule 54 / Phase 3).

Now: import from here:
    from core.db_helpers import _open_db, dbm, DBM_AVAILABLE

ARCHITECTURE COMPLIANCE (forensic audit 2026-10-28, owner directive):
- db_manager is the SOLE DB gate (per Constitution + 02-DATABASES-AND-DATA.md)
- NO fallback to raw sqlite3.connect when db_manager fails at call time
- If db_manager raises → propagate the error (fail loud, fail safe)
- NO silent bypass of alias/path validation or query_only enforcement
- readonly: db_manager enforces PRAGMA query_only=1 (line 323 of db_manager.py)
- writable: db_manager enforces WAL + busy_timeout + synchronous=NORMAL

The previous fallback (raw sqlite3.connect on ANY exception) was an
architectural bypass: it allowed readonly writes when db_manager failed,
and allowed writable connections to unvalidated paths. Both are now REMOVED.

The ONLY remaining fallback is at module-import time: if `db_manager`
cannot be imported at all (DBM_AVAILABLE=False), we raise a clear RuntimeError
on every call. This is fail-safe (no silent degradation).
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager

# Rule 54 / Phase 3: db_manager is the SOLE DB gate
try:
    from core.db_manager import db_manager as dbm
    DBM_AVAILABLE = True
except Exception as _dbm_err:
    dbm = None
    DBM_AVAILABLE = False
    print(f"[core.db_helpers] CRITICAL: db_manager not available ({_dbm_err}) — "
          f"all DB access will fail loud. No fallback bypass permitted.")


@contextmanager
def _open_db(db_path: str, writable: bool = False):
    """Rule 54 / Phase 3: db_manager is the SOLE DB gate — no fallback bypass.

    Args:
        db_path: مسار الـ DB على القرص (ممكن يكون predictions.db أو stocks.db —
                 db_manager بيتعامل مع الـ absolute path مباشرة).
        writable: True للكتابة (WAL + busy_timeout)، False للقراءة فقط.

    Yields:
        sqlite3.Connection from db_manager (with row_factory=Row, query_only
        enforced for readonly, WAL for writable).

    FORENSIC FIX (2026-10-28, owner directive):
        NO fallback to raw sqlite3.connect. If db_manager fails → propagate
        the error. This closes the DB-gate bypass completely (both readonly
        and writable). Fail loud, fail safe.
    """
    if not DBM_AVAILABLE:
        # Module-level import failed — fail loud, no silent bypass
        raise RuntimeError(
            "db_manager is not available (import failed). "
            "DB access is blocked — no fallback bypass permitted per DB-gate policy."
        )

    conn = None
    try:
        # db_manager enforces: query_only=1 (readonly) / WAL (writable) + alias validation
        conn = dbm.get_connection(db_path, writable=writable)
        try:
            yield conn
        finally:
            try:
                conn.close()
            except Exception:
                pass
    except Exception:
        # Propagate the error — DO NOT fall back to raw sqlite3.connect
        # (this was the bypass vector; now closed per owner directive)
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        raise


__all__ = ['_open_db', 'open_db_aliased', 'dbm', 'DBM_AVAILABLE']


# ---------------------------------------------------------------------------
# Alias-based variant (used by admin_routes.py + misc_routes.py)
# ---------------------------------------------------------------------------

@contextmanager
def open_db_aliased(db_alias: str, db_path: str, writable: bool = False):
    """Rule 54 / Phase 3: alias-based _open_db for admin/misc routes.

    Args:
        db_alias: اسم الـ DB المختصر ('stocks', 'predictions', 'data_engine', ...)
        db_path: مسار الـ DB على القرص (UNUSED now — kept for signature compat)
        writable: True للكتابة (WAL)، False للقراءة (readonly/immutable)

    Yields:
        sqlite3.Connection from db_manager (with row_factory=Row).

    FORENSIC FIX (2026-10-28, owner directive):
        NO fallback to raw sqlite3.connect. The `db_path` parameter is now
        IGNORED (kept only for signature backward-compat) — db_manager resolves
        aliases via its own validated path map. This closes the writable bypass
        that allowed opening unvalidated paths.
    """
    if not DBM_AVAILABLE:
        raise RuntimeError(
            "db_manager is not available (import failed). "
            "DB access is blocked — no fallback bypass permitted per DB-gate policy."
        )

    conn = None
    try:
        # db_manager resolves the alias → validated path + enforces query_only/WAL
        conn = dbm.get_connection(db_alias, writable=writable)
        try:
            yield conn
        finally:
            try:
                conn.close()
            except Exception:
                pass
    except Exception:
        # Propagate — no bypass
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
        raise
