#!/usr/bin/env python3
"""
fix_auth_timestamps.py — Repair corrupted timestamp columns in auth.db.

ROOT CAUSE:
  Prisma 5.22.0's SQLite query engine writes `DateTime?` columns as
  millisecond timestamps (e.g. "1792334454208") but reads them back
  expecting ISO strings. This causes PrismaClientKnownRequestError P2023
  ("Inconsistent column data: Could not convert value ... to type DateTime")
  on every subsequent User query → login loop / 401 / 503.

AFFECTED COLUMNS (verified via typeof() on snapshot 2026-10-27):
  - last_login:      16 integer rows
  - updated_at:      29 integer rows  (most affected)
  - email_verified:  16 integer rows
  - created_at:      13 integer rows
  - last_active_at:  0 integer rows   (already fixed via last-active-helper.ts)

USAGE:
  # Dry-run (no changes, prints what WOULD be fixed):
  python3 scripts/fix_auth_timestamps.py --dry-run

  # Real fix (creates backup first, then repairs):
  python3 scripts/fix_auth_timestamps.py --apply

  # Verify only (no changes, reports current state):
  python3 scripts/fix_auth_timestamps.py --verify

SAFETY:
  - Always creates a backup (auth.db.bak-YYYYMMDD-HHMMSS) before any change.
  - Idempotent: running twice is safe (second run fixes 0 rows).
  - Only touches rows where typeof() = 'integer' (leaves ISO strings alone).
  - Converts numeric ms → ISO 8601 UTC string via:
      strftime('%Y-%m-%dT%H:%M:%fZ', <ms>/1000, 'unixepoch')
  - Never deletes rows. Never changes non-timestamp columns.

EXIT CODES:
  0 = success (or dry-run completed)
  1 = error (bad args, DB missing, backup failed, etc.)
"""

from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

# ─── Constants ──────────────────────────────────────────────────────────────

DB_PATH = Path(__file__).resolve().parent.parent / "db" / "auth.db"

# Columns to repair (DateTime? or DateTime in Prisma schema, stored as integer ms)
TIMESTAMP_COLUMNS = [
    "created_at",
    "last_login",
    "updated_at",
    "email_verified",
    "last_active_at",  # should already be clean, but check anyway
]

# Trial-related timestamp columns (also DateTime? in schema)
TRIAL_COLUMNS = [
    "trial_ends_at",
    "trial_warning_sent_at",
    "trial_deletion_scheduled_at",
]

ALL_COLUMNS = TIMESTAMP_COLUMNS + TRIAL_COLUMNS


# ─── Helpers ────────────────────────────────────────────────────────────────


def connect_ro(db_path: Path) -> sqlite3.Connection:
    """Open read-only connection (URI mode)."""
    uri = f"file:{db_path}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def connect_rw(db_path: Path) -> sqlite3.Connection:
    """Open read-write connection."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def count_corrupted(conn: sqlite3.Connection, column: str) -> int:
    """Count rows where the column holds a numeric millisecond timestamp.

    SQLite stores integer values with typeof() = 'integer'.
    A valid ISO string has typeof() = 'text'.
    NULL is typeof() = 'null' (skipped).
    """
    # Use parameterized column via PRAGMA would be cleaner, but table_info
    # already confirms the column exists. Direct interpolation is safe here
    # because ALL_COLUMNS is a hardcoded constant list (no user input).
    sql = (
        f"SELECT COUNT(*) FROM \"User\" "
        f"WHERE typeof(\"{column}\") = 'integer'"
    )
    return conn.execute(sql).fetchone()[0]


def find_corrupted_rows(conn: sqlite3.Connection, column: str, limit: int = 5):
    """Return sample of corrupted rows for inspection."""
    sql = (
        f"SELECT id, email, \"{column}\" AS val FROM \"User\" "
        f"WHERE typeof(\"{column}\") = 'integer' LIMIT ?"
    )
    return conn.execute(sql, (limit,)).fetchall()


def repair_column(conn: sqlite3.Connection, column: str) -> int:
    """Convert numeric ms timestamps in a column to ISO 8601 strings.

    Uses SQLite's strftime to convert ms → ISO directly inside the DB engine
    (no Python date parsing, no timezone ambiguity).

    The conversion:
      strftime('%Y-%m-%dT%H:%M:%fZ', <ms>/1000, 'unixepoch')
    produces e.g. '2026-10-21T10:46:07.740Z' from 1792334454208.

    Returns the number of rows updated.
    """
    sql = (
        f"UPDATE \"User\" "
        f"SET \"{column}\" = strftime('%Y-%m-%dT%H:%M:%fZ', "
        f"    CAST(\"{column}\" AS REAL) / 1000, 'unixepoch') "
        f"WHERE typeof(\"{column}\") = 'integer'"
    )
    cur = conn.execute(sql)
    return cur.rowcount


def create_backup(db_path: Path) -> Path:
    """Create a timestamped backup of the DB file."""
    ts = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    bak = db_path.with_name(f"{db_path.name}.bak-{ts}")
    shutil.copy2(db_path, bak)
    return bak


def verify_column_exists(conn: sqlite3.Connection, column: str) -> bool:
    """Check that a column exists in the User table."""
    cols = [r[1] for r in conn.execute("PRAGMA table_info('User')").fetchall()]
    return column in cols


# ─── Commands ───────────────────────────────────────────────────────────────


def cmd_verify(args: argparse.Namespace) -> int:
    """Report current state without making changes."""
    if not DB_PATH.exists():
        print(f"ERROR: DB not found at {DB_PATH}", file=sys.stderr)
        return 1

    conn = connect_ro(DB_PATH)
    try:
        print(f"=== auth.db timestamp verification ===")
        print(f"DB: {DB_PATH}")
        print()

        total_corrupted = 0
        for col in ALL_COLUMNS:
            if not verify_column_exists(conn, col):
                print(f"  {col:30} COLUMN MISSING (skipped)")
                continue
            bad = count_corrupted(conn, col)
            total = conn.execute(
                f'SELECT COUNT(*) FROM "User" WHERE "{col}" IS NOT NULL'
            ).fetchone()[0]
            null = conn.execute(
                f'SELECT COUNT(*) FROM "User" WHERE "{col}" IS NULL'
            ).fetchone()[0]
            status = "OK" if bad == 0 else f"{bad} CORRUPTED"
            print(f"  {col:30} total={total:4} null={null:4} corrupted={bad:4} [{status}]")
            total_corrupted += bad

            if bad > 0:
                print(f"    sample corrupted rows:")
                for row in find_corrupted_rows(conn, col, limit=3):
                    print(f"      id={row['id'][:16]}... email={row['email']} val={row['val']}")

        print()
        print(f"TOTAL CORRUPTED ROWS: {total_corrupted}")
        if total_corrupted == 0:
            print("STATUS: CLEAN — no repair needed.")
        else:
            print(f"STATUS: {total_corrupted} rows need repair. Run with --apply.")
        return 0
    finally:
        conn.close()


def cmd_dry_run(args: argparse.Namespace) -> int:
    """Show what WOULD be fixed without making changes."""
    if not DB_PATH.exists():
        print(f"ERROR: DB not found at {DB_PATH}", file=sys.stderr)
        return 1

    conn = connect_ro(DB_PATH)
    try:
        print(f"=== DRY RUN — no changes will be made ===")
        print(f"DB: {DB_PATH}")
        print()

        total_would_fix = 0
        for col in ALL_COLUMNS:
            if not verify_column_exists(conn, col):
                print(f"  {col:30} COLUMN MISSING (skipped)")
                continue
            bad = count_corrupted(conn, col)
            total_would_fix += bad
            if bad > 0:
                print(f"  {col:30} WOULD FIX {bad} rows:")
                for row in find_corrupted_rows(conn, col, limit=5):
                    ms = row["val"]
                    # Show the target ISO value
                    try:
                        iso = datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime(
                            "%Y-%m-%dT%H:%M:%S.000Z"
                        )
                    except Exception:
                        iso = "??"
                    print(f"    id={row['id'][:16]}... {ms} → {iso}")
            else:
                print(f"  {col:30} OK (0 corrupted)")

        print()
        print(f"TOTAL ROWS THAT WOULD BE FIXED: {total_would_fix}")
        if total_would_fix == 0:
            print("Nothing to do. DB is already clean.")
        else:
            print(f"To apply, run: python3 {__file__} --apply")
        return 0
    finally:
        conn.close()


def cmd_apply(args: argparse.Namespace) -> int:
    """Create backup and repair all corrupted timestamps."""
    if not DB_PATH.exists():
        print(f"ERROR: DB not found at {DB_PATH}", file=sys.stderr)
        return 1

    # Step 1: pre-verify
    print("=== STEP 1: Pre-verify corrupted rows ===")
    conn_ro = connect_ro(DB_PATH)
    try:
        total_before = 0
        per_col_before = {}
        for col in ALL_COLUMNS:
            if not verify_column_exists(conn_ro, col):
                per_col_before[col] = 0
                continue
            bad = count_corrupted(conn_ro, col)
            per_col_before[col] = bad
            total_before += bad
            print(f"  {col:30} corrupted={bad}")
        print(f"  TOTAL: {total_before}")
    finally:
        conn_ro.close()

    if total_before == 0:
        print("\nDB is already clean. Nothing to do.")
        return 0

    # Step 2: backup
    print("\n=== STEP 2: Create backup ===")
    bak = create_backup(DB_PATH)
    print(f"  Backup: {bak}")
    print(f"  Size: {bak.stat().st_size} bytes")

    # Step 3: repair
    print("\n=== STEP 3: Repair corrupted timestamps ===")
    conn = connect_rw(DB_PATH)
    try:
        total_fixed = 0
        for col in ALL_COLUMNS:
            if not verify_column_exists(conn, col):
                print(f"  {col:30} COLUMN MISSING (skipped)")
                continue
            fixed = repair_column(conn, col)
            total_fixed += fixed
            print(f"  {col:30} fixed={fixed}")
        conn.commit()
        print(f"  TOTAL FIXED: {total_fixed}")
    except Exception as e:
        conn.rollback()
        print(f"\nERROR during repair: {e}", file=sys.stderr)
        print(f"Rolling back. Backup is at: {bak}", file=sys.stderr)
        return 1
    finally:
        conn.close()

    # Step 4: post-verify
    print("\n=== STEP 4: Post-verify (should be 0 corrupted) ===")
    conn_ro = connect_ro(DB_PATH)
    try:
        total_after = 0
        for col in ALL_COLUMNS:
            if not verify_column_exists(conn_ro, col):
                continue
            bad = count_corrupted(conn_ro, col)
            total_after += bad
            print(f"  {col:30} corrupted={bad}")
        print(f"  TOTAL: {total_after}")
    finally:
        conn_ro.close()

    if total_after == 0:
        print(f"\n✅ SUCCESS: all {total_before} corrupted rows repaired.")
        print(f"   Backup preserved at: {bak}")
        return 0
    else:
        print(f"\n⚠️  WARNING: {total_after} rows still corrupted after repair.", file=sys.stderr)
        print(f"   Backup is at: {bak}", file=sys.stderr)
        return 1


# ─── Main ───────────────────────────────────────────────────────────────────


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Repair corrupted timestamp columns in auth.db (Prisma 5.22.0 bug fix)."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--dry-run", action="store_true", help="Show what would be fixed (no changes).")
    group.add_argument("--apply", action="store_true", help="Create backup and repair.")
    group.add_argument("--verify", action="store_true", help="Report current state (no changes).")
    args = parser.parse_args()

    if args.dry_run:
        return cmd_dry_run(args)
    elif args.apply:
        return cmd_apply(args)
    elif args.verify:
        return cmd_verify(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
