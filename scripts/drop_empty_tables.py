#!/usr/bin/env python3
"""
BRAVO DROP-EMPTY-TABLES-1 — Drop empty tables from all DBs in db/.
===================================================================
Scans every DB in db/, lists all tables, checks row count.
If row count = 0 → DROP TABLE (after verify).

Safety:
  - verify row count = 0 BEFORE drop (double-check)
  - --dry-run flag (list only, no drop)
  - idempotent (re-run = 0 new drops)
  - log every dropped table + DB
  - integrity_check after all drops

Rule 17 (relative paths): Path(__file__).resolve().parents[1] = project root.
Rule 1: sandbox copy only — production needs owner approval.

Usage:
    python3 scripts/drop_empty_tables.py --dry-run   # list empty, no drop
    python3 scripts/drop_empty_tables.py              # execute drops
    python3 scripts/drop_empty_tables.py --db stocks  # single DB only
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path
from typing import List, Tuple

# Rule 17: scripts/drop_empty_tables.py → parents[1] = project root
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_DIR = PROJECT_ROOT / "db"


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), timeout=30.0)
    conn.row_factory = sqlite3.Row
    return conn


def _get_all_tables(conn: sqlite3.Connection) -> List[str]:
    """Return list of user table names (exclude sqlite_*)."""
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [r[0] for r in rows]


def _get_row_count(conn: sqlite3.Connection, table: str) -> int:
    """Get row count for a table. Returns -1 on error."""
    try:
        # Quote table name to handle special chars
        return conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    except sqlite3.DatabaseError:
        return -1


def _integrity_check(conn: sqlite3.Connection) -> str:
    """Run PRAGMA integrity_check. Returns 'ok' or error message."""
    try:
        row = conn.execute("PRAGMA integrity_check").fetchone()
        return row[0] if row else "unknown"
    except sqlite3.DatabaseError as e:
        return f"error: {e}"


def scan_db(db_path: Path) -> List[Tuple[str, int]]:
    """Scan a DB, return list of (table_name, row_count) for ALL tables."""
    if not db_path.exists():
        return []
    conn = _connect(db_path)
    try:
        tables = _get_all_tables(conn)
        results = []
        for tbl in tables:
            count = _get_row_count(conn, tbl)
            results.append((tbl, count))
        return results
    finally:
        conn.close()


def drop_empty_tables(db_path: Path, dry_run: bool = False) -> dict:
    """Drop all empty tables (row count = 0) from a DB.
    
    Returns: {
        'db': str,
        'total_tables': int,
        'empty_tables': list of str,
        'dropped': list of str,
        'skipped': list of str,
        'integrity_before': str,
        'integrity_after': str,
    }
    """
    db_name = db_path.name
    result = {
        'db': db_name,
        'total_tables': 0,
        'empty_tables': [],
        'dropped': [],
        'skipped': [],
        'integrity_before': '',
        'integrity_after': '',
    }

    if not db_path.exists():
        result['integrity_before'] = 'db not found'
        return result

    conn = _connect(db_path)
    try:
        # Integrity check BEFORE
        result['integrity_before'] = _integrity_check(conn)

        tables = _get_all_tables(conn)
        result['total_tables'] = len(tables)

        # Find empty tables (row count = 0, NOT -1 which means error)
        for tbl in tables:
            count = _get_row_count(conn, tbl)
            if count == 0:
                result['empty_tables'].append(tbl)
            elif count == -1:
                result['skipped'].append(f"{tbl} (count error)")

        # Drop empty tables (with verify)
        for tbl in result['empty_tables']:
            # VERIFY: re-check row count = 0 before drop (safety)
            verify_count = _get_row_count(conn, tbl)
            if verify_count != 0:
                result['skipped'].append(f"{tbl} (verify failed: count={verify_count})")
                continue

            if not dry_run:
                try:
                    conn.execute(f'DROP TABLE IF EXISTS "{tbl}"')
                    conn.commit()
                    result['dropped'].append(tbl)
                except sqlite3.DatabaseError as e:
                    result['skipped'].append(f"{tbl} (drop error: {e})")
            else:
                result['dropped'].append(tbl)  # would-be-dropped in dry-run

        # Integrity check AFTER
        result['integrity_after'] = _integrity_check(conn)
    finally:
        conn.close()

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="BRAVO DROP-EMPTY-TABLES-1")
    parser.add_argument("--dry-run", action="store_true",
                        help="List empty tables without dropping")
    parser.add_argument("--db", default=None,
                        help="Single DB name (e.g., 'stocks.db'). Default: all DBs.")
    args = parser.parse_args()

    print("=" * 72)
    print("BRAVO DROP-EMPTY-TABLES-1 — Drop empty tables from DBs")
    print(f"DB dir: {DB_DIR}")
    print(f"Mode: {'DRY-RUN (no drops)' if args.dry_run else 'EXECUTE (drop empty)'}")
    if args.db:
        print(f"Single DB: {args.db}")
    print("=" * 72)

    if not DB_DIR.exists():
        print(f"ERROR: {DB_DIR} not found")
        return 1

    # Find all .db files
    if args.db:
        db_files = [DB_DIR / args.db]
        if not db_files[0].exists():
            print(f"ERROR: {db_files[0]} not found")
            return 1
    else:
        db_files = sorted(DB_DIR.glob("*.db"))

    total_empty = 0
    total_dropped = 0
    all_results = []

    for db_path in db_files:
        if db_path.name == 'custom.db':
            # Skip Prisma-managed DB
            print(f"\n── {db_path.name} (skipped — Prisma-managed) ──")
            continue

        print(f"\n── {db_path.name} ({db_path.stat().st_size:,} bytes) ──")
        result = drop_empty_tables(db_path, dry_run=args.dry_run)
        all_results.append(result)

        print(f"  Total tables: {result['total_tables']}")
        print(f"  Empty tables: {len(result['empty_tables'])}")
        if result['empty_tables']:
            for t in result['empty_tables']:
                print(f"    • {t}")
        print(f"  {'Would drop' if args.dry_run else 'Dropped'}: {len(result['dropped'])}")
        if result['dropped']:
            for t in result['dropped']:
                print(f"    ✓ {t}")
        if result['skipped']:
            print(f"  Skipped: {len(result['skipped'])}")
            for s in result['skipped']:
                print(f"    ⚠ {s}")
        print(f"  Integrity before: {result['integrity_before']}")
        print(f"  Integrity after:  {result['integrity_after']}")

        total_empty += len(result['empty_tables'])
        total_dropped += len(result['dropped'])

    # Summary
    print("\n" + "=" * 72)
    print(f"SUMMARY: {total_empty} empty tables found | {total_dropped} {'would be ' if args.dry_run else ''}dropped")
    print(f"DBs scanned: {len(all_results)}")

    # Final integrity check for all
    all_ok = all(r['integrity_after'] == 'ok' for r in all_results if r['integrity_after'])
    if all_ok:
        print("✅ All DBs integrity OK after operation")
    else:
        print("⚠️ Some DBs have integrity issues — check above")

    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
