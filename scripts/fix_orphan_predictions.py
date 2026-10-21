#!/usr/bin/env python3
"""
scripts/fix_orphan_predictions.py
=================================
Task 2: إصلاح التوصيات اليتيمة (Orphan Predictions).

يبحث في predictions.db عن أي ticker مش موجود في stocks.db
ويستبدله بالأصل الصحيح (zombie → real).

Usage:
    python3 scripts/fix_orphan_predictions.py --dry-run
    python3 scripts/fix_orphan_predictions.py
"""
import sqlite3
import shutil
import argparse
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
BACKUP_DIR = PROJECT_ROOT / 'db' / 'backups'

# Map: zombie → real ticker
ZOMBIE_MAP = {
    'FWRYF': 'FWRY',
    'CIRAC': 'CIRA',
    'ACAPA': 'ACAP',
    'ACFRA': 'ACFR',
    'ALEXA': 'ALEX',
    'ALEXAD': 'ALEX',
    'CCIDC': 'CCID',
    'MMITRM': 'MMIT',
    'NNBKEN': 'NNBK',
    'FWRYD': 'FWRY',
    'COMID': 'COMI',
    'SWYDD': 'SWDY',
    'HRHOD': 'HRHO',
    'ETELD': 'ETEL',
    'TMGHD': 'TMGH',
    'ABUKD': 'ABUK',
    'MFPCD': 'MFPC',
    'CIEBD': 'CIEB',
    'HDBKD': 'HDBK',
    'EKHOD': 'EKHO',
}

# Tables to check
TABLES_TO_CHECK = [
    ('predictions', 'ticker'),
    ('persona_predictions', 'ticker'),
    ('historical_trades', 'ticker'),
    ('stored_analyses', 'ticker'),
    ('hunter_pick_tracking', 'ticker'),
    ('exit_notifications', 'ticker'),
]


def main():
    parser = argparse.ArgumentParser(description='Fix orphan predictions')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط بدون تعديل')
    args = parser.parse_args()

    print("=" * 60)
    print("🔧 Task 2: Fix Orphan Predictions")
    print(f"   Predictions DB: {PREDICTIONS_DB}")
    print(f"   Stocks DB: {STOCKS_DB}")
    print(f"   Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 60)

    # 1. Get all valid tickers from stocks.db
    sconn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True)
    valid_tickers = set(r[0] for r in sconn.execute("SELECT ticker FROM stocks").fetchall())
    sconn.close()
    print(f"  Valid tickers in stocks.db: {len(valid_tickers)}")

    # 2. Backup
    if not args.dry_run:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_path = BACKUP_DIR / f'predictions.db.backup_orphan_fix_{ts}'
        shutil.copy2(str(PREDICTIONS_DB), str(backup_path))
        print(f"  ✅ Backup: {backup_path}")

    # 3. Find orphans
    conn = sqlite3.connect(str(PREDICTIONS_DB), timeout=30.0)
    cur = conn.cursor()

    total_fixed = 0
    total_skipped = 0
    report = []

    for table, col in TABLES_TO_CHECK:
        try:
            # check if table exists
            exists = cur.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
            ).fetchone()
            if not exists:
                print(f"\n  ⏭️ Table '{table}' not found — skipping")
                continue

            # check if column exists
            cols = [c[1] for c in cur.execute(f"PRAGMA table_info({table})").fetchall()]
            if col not in cols:
                print(f"\n  ⏭️ Column '{col}' not in '{table}' — skipping")
                continue

            # find orphans
            rows = cur.execute(f"SELECT DISTINCT {col} FROM {table} WHERE {col} IS NOT NULL").fetchall()
            orphans = []
            for (ticker,) in rows:
                if ticker and ticker not in valid_tickers:
                    orphans.append(ticker)

            if not orphans:
                print(f"\n  ✅ {table}.{col}: 0 orphans")
                continue

            print(f"\n  📋 {table}.{col}: {len(orphans)} orphan tickers found")

            for orphan in orphans:
                # find replacement
                replacement = ZOMBIE_MAP.get(orphan.upper())

                # also try stripping trailing 'D' (dividend badge)
                if not replacement and orphan.endswith('D') and orphan[:-1] in valid_tickers:
                    replacement = orphan[:-1]

                # also try stripping trailing 'F'
                if not replacement and orphan.endswith('F') and orphan[:-1] in valid_tickers:
                    replacement = orphan[:-1]

                if replacement and replacement in valid_tickers:
                    # count affected rows
                    cnt = cur.execute(f"SELECT COUNT(*) FROM {table} WHERE {col} = ?", (orphan,)).fetchone()[0]
                    print(f"    {orphan} → {replacement} ({cnt} rows)")

                    if not args.dry_run:
                        cur.execute(f"UPDATE {table} SET {col} = ? WHERE {col} = ?", (replacement, orphan))

                    total_fixed += cnt
                    report.append((table, orphan, replacement, cnt))
                else:
                    cnt = cur.execute(f"SELECT COUNT(*) FROM {table} WHERE {col} = ?", (orphan,)).fetchone()[0]
                    print(f"    {orphan} → NO REPLACEMENT ({cnt} rows — skipped)")
                    total_skipped += cnt
                    report.append((table, orphan, None, cnt))

        except Exception as e:
            print(f"  ⚠️ {table}: {e}")

    if not args.dry_run:
        conn.commit()

    conn.close()

    # 4. Report
    print(f"\n{'='*60}")
    print(f"📊 Report")
    print(f"{'='*60}")
    print(f"  Total fixed: {total_fixed} rows")
    print(f"  Total skipped (no replacement): {total_skipped} rows")
    print(f"  Details:")
    for table, orphan, replacement, cnt in report:
        status = f"→ {replacement}" if replacement else "→ SKIPPED"
        print(f"    {table}: {orphan} {status} ({cnt} rows)")

    print(f"\n✅ Task 2 complete" if not args.dry_run else f"\n[DRY RUN] Task 2 preview complete")
    return 0


if __name__ == "__main__":
    exit(main())
