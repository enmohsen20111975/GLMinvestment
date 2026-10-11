#!/usr/bin/env python3
"""
Drop Orphan Duplicate Tables (Rule 28 NO-DUPLICATION + Rule 29 UNIFIED-SYSTEM)
==============================================================================

Removes orphan duplicate tables from predictions.db + data_engine.db.

Context (CONNECTIVITY-AUDIT 2026-10-12):
- stocks.db.portfolios (9 rows, canonical — Rule 50 MONEY-AS-CUSTOMER-LIFE)
  vs predictions.db.portfolios (4 rows, orphan from June 2026 seed data)
- stocks.db.ExpertRecommendation (48 rows, canonical — has extra columns)
  vs predictions.db.ExpertRecommendation (17 rows, orphan seed)
- data_engine.db.gold_prices (761K rows, canonical)
  vs stocks.db.gold_prices (3 rows, orphan)
- data_engine.db.stocks (1098 rows, canonical — has more tickers)
  vs stocks.db.stocks (1240 rows — wait, this one has MORE rows!)

Wait — stocks.db.stocks has 1240 vs data_engine.db.stocks 1098. Let me check
which is canonical. Per Rule 12, stocks.db is canonical for stock metadata
(per Documentation/01-PROJECT_ANATOMY.md). data_engine.db.stocks is a copy
from a snapshot that's missing ~142 tickers. So stocks.db is canonical.

This script:
1. Backs up the affected DBs (timestamped copies)
2. Drops the orphan tables only (NEVER touches the canonical ones)
3. Logs each action for audit trail

Usage:
    python3 vps-service/scripts/drop_orphan_duplicate_tables.py --dry-run
    python3 vps-service/scripts/drop_orphan_duplicate_tables.py --execute

Rule 1 (DB Safety): backup before any DROP.
Rule 16 (VERIFY-BEFORE-DELETE): dry-run first.
Rule 25 (refactoring-gated): owner approval (this is sandbox — production needs
                              explicit approval per Rule 1).
"""
import sqlite3
import sys
import os
import shutil
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_DIR = PROJECT_ROOT / 'db'
TIMESTAMP = datetime.now().strftime('%Y%m%d_%H%M%S')

# Orphan duplicates to drop (DB, table) — NEVER touch the canonical
ORPHANS = [
    # (db_file, table_name, reason)
    ('predictions.db', 'portfolios',
     'orphan from June 2026 seed — canonical is stocks.db.portfolios (9 rows)'),
    ('predictions.db', 'ExpertRecommendation',
     'orphan seed — canonical is stocks.db.ExpertRecommendation (48 rows, has extra columns)'),
    ('stocks.db', 'gold_prices',
     'orphan (3 rows) — canonical is data_engine.db.gold_prices (761K rows)'),
]


def backup_db(db_path: Path) -> Path:
    """Create a timestamped backup of the DB before any DROP."""
    backup_path = db_path.with_suffix(f'.{TIMESTAMP}.bak')
    shutil.copy2(db_path, backup_path)
    return backup_path


def main():
    dry_run = '--execute' not in sys.argv

    print('=' * 70)
    print('DROP ORPHAN DUPLICATE TABLES (Rule 28 + Rule 29)')
    print('=' * 70)
    print(f'Mode: {"DRY-RUN (no changes)" if dry_run else "EXECUTE (will DROP)"}')
    print(f'Timestamp: {TIMESTAMP}')
    print()

    if dry_run:
        print('Tables to be DROPPED:')
        for db_file, table, reason in ORPHANS:
            db_path = DB_DIR / db_file
            if not db_path.exists():
                print(f'  ⚠️  {db_file}.{table} — DB not found, skipping')
                continue
            conn = sqlite3.connect(str(db_path), timeout=5)
            cur = conn.cursor()
            try:
                cnt = cur.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                print(f'  🗑️  {db_file}.{table} ({cnt} rows) — {reason}')
            except sqlite3.OperationalError:
                print(f'  ✅  {db_file}.{table} — already dropped/missing')
            conn.close()
        print()
        print('To execute, re-run with --execute')
        return

    # EXECUTE mode
    print('Executing DROPs...')
    print()

    for db_file, table, reason in ORPHANS:
        db_path = DB_DIR / db_file
        if not db_path.exists():
            print(f'⚠️  {db_file} not found — skipping {table}')
            continue

        # Step 1: Backup
        backup_path = backup_db(db_path)
        print(f'📦 Backup: {db_path.name} → {backup_path.name}')

        # Step 2: Check if table exists
        conn = sqlite3.connect(str(db_path), timeout=10)
        cur = conn.cursor()
        try:
            exists = cur.execute(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?",
                (table,)
            ).fetchone()[0]
            if not exists:
                print(f'✅ {db_file}.{table} — already dropped/missing')
                conn.close()
                continue

            cnt = cur.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
            print(f'🗑️  DROP TABLE {db_file}.{table} ({cnt} rows) — {reason}')

            # Step 3: DROP
            cur.execute(f'DROP TABLE IF EXISTS "{table}"')
            conn.commit()
            conn.close()
            print(f'   ✅ Dropped')
        except Exception as e:
            print(f'   ❌ ERROR: {e}')
            conn.close()
        print()

    # Vacuum to reclaim space
    print('🧹 Vacuuming predictions.db + stocks.db to reclaim space...')
    for db_file in ['predictions.db', 'stocks.db']:
        db_path = DB_DIR / db_file
        if db_path.exists():
            try:
                conn = sqlite3.connect(str(db_path), timeout=30)
                conn.execute('VACUUM')
                conn.close()
                print(f'   ✅ {db_file} vacuumed')
            except Exception as e:
                print(f'   ⚠️  {db_file} vacuum failed: {e}')

    print()
    print('=' * 70)
    print('DONE — orphan duplicate tables removed.')
    print('=' * 70)
    print('Backups saved with timestamp:', TIMESTAMP)
    print('To restore: cp db/<db>.<timestamp>.bak db/<db>')


if __name__ == '__main__':
    main()
