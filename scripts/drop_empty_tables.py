#!/usr/bin/env python3
"""
BRAVO DROP-EMPTY-TABLES-1 — Drop empty tables from all DBs in db/.
===================================================================
Scans every DB in db/, lists all tables, checks row count.
If row count = 0 → DROP TABLE (after verify).

Safety:
  - verify row count = 0 BEFORE drop (double-check)
  - --dry-run flag (list only, no drop)
  - --check-refs flag (grep code for table references before drop)
  - --exclude flag (comma-separated table names to NEVER drop)
  - idempotent (re-run = 0 new drops)
  - log every dropped table + DB
  - integrity_check after all drops

Rule 17 (relative paths): Path(__file__).resolve().parents[1] = project root.
Rule 1: sandbox copy only — production needs owner approval.

Usage:
    python3 scripts/drop_empty_tables.py --dry-run
    python3 scripts/drop_empty_tables.py --dry-run --check-refs
    python3 scripts/drop_empty_tables.py --exclude paper_trades,signal_logs
    python3 scripts/drop_empty_tables.py
"""
from __future__ import annotations

import argparse
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import List, Set, Tuple

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_DIR = PROJECT_ROOT / "db"
CODE_DIRS = [PROJECT_ROOT / "vps-service", PROJECT_ROOT / "data_engine", PROJECT_ROOT / "scripts"]


def _connect(db_path: Path) -> sqlite3.Connection:
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(db_path), writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    return conn


def _get_all_tables(conn: sqlite3.Connection) -> List[str]:
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    return [r[0] for r in rows]


def _get_row_count(conn: sqlite3.Connection, table: str) -> int:
    try:
        return conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    except sqlite3.DatabaseError:
        return -1


def _integrity_check(conn: sqlite3.Connection) -> str:
    try:
        row = conn.execute("PRAGMA integrity_check").fetchone()
        return row[0] if row else "unknown"
    except sqlite3.DatabaseError as e:
        return f"error: {e}"


def _check_code_references(table: str) -> int:
    """Grep code dirs for table name. Returns file count."""
    total = 0
    for code_dir in CODE_DIRS:
        if not code_dir.exists():
            continue
        result = subprocess.run(
            ['grep', '-rl', '--include=*.py', table, str(code_dir)],
            capture_output=True, text=True, cwd=str(PROJECT_ROOT)
        )
        files = [f for f in result.stdout.strip().split('\n') if f and '.pyc' not in f and '__pycache__' not in f]
        total += len(files)
    return total


def _check_auto_create(table: str) -> bool:
    """Check if code has 'CREATE TABLE IF NOT EXISTS <table>' → auto-recreate on use."""
    for code_dir in CODE_DIRS:
        if not code_dir.exists():
            continue
        pattern = f"CREATE TABLE IF NOT EXISTS {table}"
        result = subprocess.run(
            ['grep', '-rl', '--include=*.py', pattern, str(code_dir)],
            capture_output=True, text=True, cwd=str(PROJECT_ROOT)
        )
        if result.stdout.strip():
            return True
    return False


def scan_db(db_path: Path) -> List[Tuple[str, int]]:
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


def drop_empty_tables(db_path: Path, dry_run: bool = False, check_refs: bool = False,
                      exclude: Set[str] = None) -> dict:
    exclude = exclude or set()
    db_name = db_path.name
    result = {
        'db': db_name,
        'total_tables': 0,
        'empty_tables': [],
        'dropped': [],
        'skipped': [],
        'referenced': [],
        'auto_create': [],
        'integrity_before': '',
        'integrity_after': '',
    }

    if not db_path.exists():
        result['integrity_before'] = 'db not found'
        return result

    conn = _connect(db_path)
    try:
        result['integrity_before'] = _integrity_check(conn)
        tables = _get_all_tables(conn)
        result['total_tables'] = len(tables)

        for tbl in tables:
            count = _get_row_count(conn, tbl)
            if count == 0:
                result['empty_tables'].append(tbl)
            elif count == -1:
                result['skipped'].append(f"{tbl} (count error)")

        for tbl in result['empty_tables']:
            # Check exclude list
            if tbl in exclude:
                result['skipped'].append(f"{tbl} (excluded by --exclude)")
                continue

            # Check code references
            ref_count = _check_code_references(tbl) if check_refs else 0
            auto_create = _check_auto_create(tbl) if check_refs else False

            if check_refs:
                if ref_count > 0:
                    result['referenced'].append((tbl, ref_count, auto_create))
                    if not auto_create:
                        # Referenced + NOT auto-created → SKIP (dangerous)
                        result['skipped'].append(f"{tbl} (referenced {ref_count}x, no auto-create)")
                        continue
                    else:
                        # Referenced + auto-created → safe to drop (will recreate)
                        result['auto_create'].append(tbl)

            # VERIFY: re-check row count = 0 before drop
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
                result['dropped'].append(tbl)

        result['integrity_after'] = _integrity_check(conn)
    finally:
        conn.close()

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="BRAVO DROP-EMPTY-TABLES-1")
    parser.add_argument("--dry-run", action="store_true", help="List without dropping")
    parser.add_argument("--check-refs", action="store_true",
                        help="Check code references before drop (skip referenced + no auto-create)")
    parser.add_argument("--exclude", default="", help="Comma-separated table names to never drop")
    parser.add_argument("--db", default=None, help="Single DB name")
    args = parser.parse_args()

    exclude = set(t.strip() for t in args.exclude.split(',') if t.strip())

    print("=" * 72)
    print("BRAVO DROP-EMPTY-TABLES-1 — Drop empty tables from DBs")
    print(f"DB dir: {DB_DIR}")
    print(f"Mode: {'DRY-RUN' if args.dry_run else 'EXECUTE'}")
    print(f"Check refs: {args.check_refs}")
    if exclude:
        print(f"Excluded: {exclude}")
    print("=" * 72)

    if not DB_DIR.exists():
        print(f"ERROR: {DB_DIR} not found")
        return 1

    if args.db:
        db_files = [DB_DIR / args.db]
    else:
        db_files = sorted(DB_DIR.glob("*.db"))

    total_empty = 0
    total_dropped = 0
    total_referenced = 0

    for db_path in db_files:
        if db_path.name == 'custom.db':
            print(f"\n── {db_path.name} (skipped — Prisma) ──")
            continue

        print(f"\n── {db_path.name} ({db_path.stat().st_size:,} bytes) ──")
        result = drop_empty_tables(db_path, dry_run=args.dry_run, check_refs=args.check_refs, exclude=exclude)

        print(f"  Total tables: {result['total_tables']}")
        print(f"  Empty: {len(result['empty_tables'])}")

        if args.check_refs and result['referenced']:
            print(f"  Referenced in code: {len(result['referenced'])}")
            for tbl, cnt, auto in result['referenced']:
                flag = "✓ auto-create" if auto else "⚠ NO auto-create — SKIPPED"
                print(f"    {tbl}: {cnt} refs ({flag})")

        print(f"  {'Would drop' if args.dry_run else 'Dropped'}: {len(result['dropped'])}")
        if result['dropped']:
            for t in result['dropped']:
                print(f"    ✓ {t}")
        if result['skipped']:
            print(f"  Skipped: {len(result['skipped'])}")
            for s in result['skipped']:
                print(f"    ⚠ {s}")
        print(f"  Integrity: {result['integrity_before']} → {result['integrity_after']}")

        total_empty += len(result['empty_tables'])
        total_dropped += len(result['dropped'])
        total_referenced += len(result['referenced'])

    print("\n" + "=" * 72)
    print(f"SUMMARY: {total_empty} empty | {total_dropped} {'would be ' if args.dry_run else ''}dropped | {total_referenced} referenced")
    all_ok = True  # simplified
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
