"""
db_helpers.py — Strangler Pattern module (Phase 7.2 → 7.3 dedup)
=================================================================
Originally extracted VERBATIM from `daily_predictor.py` (Phase 7.2).
Now re-exports from the canonical `core/db_helpers.py` (Phase 7.3) to
deduplicate the 7+ identical `_open_db` implementations across the codebase.

Re-exports: `_V402_DBM_AVAILABLE`, `_dbm`, `_open_db()` — same names, same
behavior, single source of truth in `core/db_helpers.py`.
"""
from __future__ import annotations

# Phase 7.3 dedup: delegate to canonical core/db_helpers.py
from core.db_helpers import _open_db, dbm as _dbm, DBM_AVAILABLE as _V402_DBM_AVAILABLE

__all__ = ['_open_db', '_dbm', '_V402_DBM_AVAILABLE']
