"""
add_prev_status_column — DEV-11 §2 migration script
====================================================

Adds the ``prev_status`` column to the predictions table so that any future
masked-archive (UPDATE status='ARCHIVED' WHERE id=?) can be reversed by
``scripts/restore_archived.py``.

Why we need this
----------------
DEV-06 disabled hard DELETEs by replacing them with
``UPDATE predictions SET status='ARCHIVED', notes=... WHERE <cond>``.
DEV-11 closes the masked-wipe hole (``WHERE 1=1``) but the smaller per-row
archive path is still allowed (e.g., a daily_closer closing a TARGET_HIT
row). When that happens we want to know what the previous status was so
``restore_archived.py`` can revert it cleanly instead of guessing.

The column is nullable TEXT. Existing rows get NULL — they have never been
archived (we don't know what their previous status would have been, and
NULL is the correct "unknown / not archived" sentinel).

Migration properties
-------------------
- IDEMPOTENT — uses ``ALTER TABLE`` only if the column is missing. Safe to
  re-run on every deploy.
- NON-DESTRUCTIVE — adds a nullable column; no row is modified.
- WAL-SAFE — runs in a single transaction.

Usage
-----
    python3 vps-service/scripts/add_prev_status_column.py
    python3 vps-service/scripts/add_prev_status_column.py --db /custom/path.db
    python3 vps-service/scripts/add_prev_status_column.py --dry-run

References
----------
- agent-ctx/DEV-11-14-lead-technical-implementer.md §2
- worklog.md DEV-11
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

# Resolve project root for DB path discovery (Rule 17 + Rule 61)
_VPS_ROOT = Path(__file__).resolve().parents[1]  # vps-service/
_PROJECT_ROOT = _VPS_ROOT.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

try:
    from utils.db_paths import DBPaths
    DEFAULT_DB_PATH = DBPaths.PREDICTIONS_DB
except Exception:
    DEFAULT_DB_PATH = str(_PROJECT_ROOT / 'db' / 'predictions.db')


def column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
    """Return True if `column` exists on `table`."""
    try:
        cur = conn.execute(f"PRAGMA table_info({table})")
        for row in cur.fetchall():
            # row layout: (cid, name, type, notnull, dflt_value, pk)
            if len(row) >= 2 and row[1] == column:
                return True
        return False
    except sqlite3.Error:
        return False


def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    """Return True if `table` exists in the database."""
    try:
        cur = conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name=?",
            (table,),
        )
        return cur.fetchone() is not None
    except sqlite3.Error:
        return False


def add_prev_status_column(db_path: str, dry_run: bool = False) -> bool:
    """Add prev_status TEXT column to predictions (idempotent).

    Args:
        db_path: absolute path to predictions.db
        dry_run: if True, only print what would be done — do not write.

    Returns:
        True if column is present at the end (either already existed or
        was just added). False on error.
    """
    db_path = str(db_path)
    print(f"[DEV-11] DB: {db_path}")

    try:
        conn = sqlite3.connect(db_path, timeout=30.0)
        try:
            conn.execute('PRAGMA busy_timeout=30000')

            if not table_exists(conn, 'predictions'):
                print(
                    "[DEV-11] predictions table not yet created — "
                    "the column will be added by PredictionTracker._init_table() "
                    "on first record_prediction() call. Nothing to do here."
                )
                return True

            if column_exists(conn, 'predictions', 'prev_status'):
                print("[DEV-11] ✓ Column 'prev_status' already exists — no-op.")
                return True

            print("[DEV-11] Column 'prev_status' is missing — adding it.")
            print("[DEV-11]   Definition: prev_status TEXT (nullable)")
            print("[DEV-11]   Effect: existing rows get NULL (= 'never archived')")

            if dry_run:
                print("[DEV-11] --dry-run: not executing ALTER TABLE.")
                return True

            # ALTER TABLE ADD COLUMN is idempotent-safe only when wrapped
            # in the column_exists() check above. SQLite ALTER TABLE ADD
            # COLUMN does not support IF NOT EXISTS, so we have to guard.
            conn.execute(
                "ALTER TABLE predictions ADD COLUMN prev_status TEXT"
            )
            conn.commit()

            # Verify
            if column_exists(conn, 'predictions', 'prev_status'):
                print("[DEV-11] ✓ Column 'prev_status' added successfully.")
                return True
            print("[DEV-11] ✗ ALTER TABLE ran but column not visible — schema issue.")
            return False
        finally:
            conn.close()
    except sqlite3.Error as e:
        print(f"[DEV-11] ERROR: {e}")
        return False


def main() -> int:
    ap = argparse.ArgumentParser(
        description='DEV-11 §2 — Add prev_status TEXT column to predictions',
    )
    ap.add_argument(
        '--db',
        default=DEFAULT_DB_PATH,
        help=f'Path to predictions.db (default: {DEFAULT_DB_PATH})',
    )
    ap.add_argument(
        '--dry-run',
        action='store_true',
        help='Print what would be done — do not write.',
    )
    args = ap.parse_args()

    ok = add_prev_status_column(args.db, dry_run=args.dry_run)
    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
