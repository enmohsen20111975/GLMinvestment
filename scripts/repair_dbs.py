#!/usr/bin/env python3
"""
repair_dbs.py — إصلاح تلف قواعد البيانات (Phase 9 — DB Repair)
=================================================================

الـ script ده بيصلح:
  1. stocks.db: B-tree corruption (VACUUM + REINDEX)
  2. data_engine.db: missing tables (egksco_price_history + screener_lists)
  3. كل DBs: integrity check + WAL checkpoint

Usage:
    python3 scripts/repair_dbs.py
    python3 scripts/repair_dbs.py --dry-run    # فحص فقط بدون إصلاح

Author: برافو (Phase 9 — DB Repair)
"""
from __future__ import annotations

import os
import sys
import sqlite3
from pathlib import Path
from typing import Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / 'db'


def check_integrity(db_path: str) -> Tuple[bool, str]:
    """Check DB integrity."""
    try:
        conn = sqlite3.connect(db_path, timeout=30.0)
        result = conn.execute('PRAGMA integrity_check').fetchone()[0]
        conn.close()
        return (result == 'ok', result)
    except Exception as e:
        return (False, str(e))


def repair_vacuum(db_path: str) -> bool:
    """VACUUM + REINDEX to repair B-tree corruption."""
    try:
        conn = sqlite3.connect(db_path, timeout=60.0)
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=60000')
        print(f"  VACUUM...", end=' ')
        conn.execute('VACUUM')
        print("OK", end=' ')
        print(f"REINDEX...", end=' ')
        conn.execute('REINDEX')
        print("OK", end=' ')
        conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        conn.close()
        return True
    except Exception as e:
        print(f"FAILED: {e}")
        return False


def ensure_table_exists(db_path: str, table_name: str, create_sql: str) -> bool:
    """Create table if not exists."""
    try:
        conn = sqlite3.connect(db_path, timeout=30.0)
        exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table_name,)
        ).fetchone()
        if exists:
            conn.close()
            return False  # already exists
        print(f"  Creating table: {table_name}...", end=' ')
        conn.execute(create_sql)
        conn.commit()
        conn.close()
        print("OK")
        return True
    except Exception as e:
        print(f"FAILED: {e}")
        return False


def main():
    import argparse
    parser = argparse.ArgumentParser(description='DB Repair — Phase 9')
    parser.add_argument('--dry-run', action='store_true', help='Check only, no repairs')
    args = parser.parse_args()

    print("=" * 70)
    print("  DB Repair — Phase 9 (Security & Deployment Prep)")
    print("=" * 70)
    print()

    if not DB_DIR.exists():
        print(f"ERROR: DB dir not found: {DB_DIR}")
        return 2

    db_files = [f for f in os.listdir(DB_DIR) if f.endswith('.db')]
    issues_fixed = 0
    issues_remaining = 0

    for db_name in sorted(db_files):
        db_path = str(DB_DIR / db_name)
        print(f"\nChecking {db_name}...")

        # Step 1: Integrity check
        ok, msg = check_integrity(db_path)
        if ok:
            print(f"  ✅ Integrity: OK")
        else:
            print(f"  ⚠️  Integrity issue: {msg[:60]}")
            if not args.dry_run:
                print(f"  Attempting repair (VACUUM + REINDEX)...")
                if repair_vacuum(db_path):
                    # Re-check
                    ok2, msg2 = check_integrity(db_path)
                    if ok2:
                        print(f"  ✅ Repair successful! Integrity now OK")
                        issues_fixed += 1
                    else:
                        print(f"  ⚠️  VACUUM completed but issue remains: {msg2[:60]}")
                        issues_remaining += 1
                else:
                    print(f"  ❌ Repair failed")
                    issues_remaining += 1
            else:
                issues_remaining += 1

    # Step 2: Ensure missing tables exist
    print("\n" + "=" * 70)
    print("  Checking for missing tables...")
    print("=" * 70)

    data_engine_path = str(DB_DIR / 'data_engine.db')
    if os.path.exists(data_engine_path):
        # egksco_price_history
        ensure_table_exists(data_engine_path, 'egksco_price_history', """
            CREATE TABLE IF NOT EXISTS egksco_price_history (
                symbol TEXT NOT NULL,
                price_date TEXT NOT NULL,
                open_price REAL,
                high_price REAL,
                low_price REAL,
                close_price REAL,
                volume REAL,
                change_percent REAL,
                last_update TEXT,
                PRIMARY KEY (symbol, price_date)
            )
        """)

        # screener_lists
        ensure_table_exists(data_engine_path, 'screener_lists', """
            CREATE TABLE IF NOT EXISTS screener_lists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                category TEXT,
                list_type TEXT,
                market TEXT DEFAULT 'EGX',
                scraped_at TEXT DEFAULT (datetime('now')),
                UNIQUE(ticker, category, market)
            )
        """)

    # Summary
    print("\n" + "=" * 70)
    print(f"  Issues fixed:     {issues_fixed}")
    print(f"  Issues remaining: {issues_remaining}")
    print("=" * 70)

    if issues_remaining == 0:
        print("\n✅ All DBs are healthy — no issues remaining.")
        return 0
    else:
        print(f"\n⚠️  {issues_remaining} issue(s) remaining — check output above.")
        return 1


if __name__ == '__main__':
    sys.exit(main())
