#!/usr/bin/env python3
"""
scripts/fix_shifted_tab_rows.py
================================
Task 1: إصلاح الـ 8 صفوف المتزحزحة في tab_balance_sheet (data_engine.db).

الصفوف 1-8 فيها column-shift (الـ symbol فيه 'السعودية' بدل ticker).
الـ ticker الحقيقي ضاع (shifted out) → لا يمكن re-align → DELETE (Scenario B).

Usage:
    python3 scripts/fix_shifted_tab_rows.py --dry-run
    python3 scripts/fix_shifted_tab_rows.py
"""
import sqlite3
import shutil
import argparse
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = PROJECT_ROOT / 'db' / 'data_engine.db'
BACKUP_DIR = PROJECT_ROOT / 'db' / 'backups'

# الـ 8 IDs المتزحزحة
SHIFTED_IDS = [4191, 7211, 9551, 9611, 9614, 9649, 9651, 9653]


def main():
    parser = argparse.ArgumentParser(description='Fix shifted tab_balance_sheet rows')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط بدون تعديل')
    args = parser.parse_args()

    print("=" * 60)
    print("🔧 Task 1: Fix shifted tab_balance_sheet rows")
    print(f"   DB: {DB_PATH}")
    print(f"   Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 60)

    if not DB_PATH.exists():
        print(f"❌ DB not found")
        return 1

    # 1. Backup
    if not args.dry_run:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_path = BACKUP_DIR / f'data_engine.db.backup_tab_fix_{ts}'
        shutil.copy2(str(DB_PATH), str(backup_path))
        print(f"✅ Backup: {backup_path}")

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(DB_PATH), writable=False).__enter__()
    cur = conn.cursor()

    # 2. Show the shifted rows
    print(f"\n--- Shifted rows (IDs: {SHIFTED_IDS}) ---")
    placeholders = ','.join('?' * len(SHIFTED_IDS))
    rows = cur.execute(f"""
        SELECT id, symbol, market, fiscal_period, fiscal_end, total_assets
        FROM tab_balance_sheet
        WHERE id IN ({placeholders})
    """, SHIFTED_IDS).fetchall()

    for r in rows:
        print(f"  id={r[0]} symbol='{r[1]}' market='{r[2]}' fiscal_period='{r[3]}' fiscal_end='{r[4]}' total_assets='{r[5]}'")

    print(f"\n  Analysis: columns shifted RIGHT by 1")
    print(f"  symbol='السعودية' (should be ticker) → ticker LOST")
    print(f"  Decision: Scenario B → DELETE (orphaned, no ticker to re-align)")

    # 3. Check for duplicates (are these companies in correct rows elsewhere?)
    # The fiscal_end values are dates → check if any correct row has same fiscal_end
    for r in rows:
        fiscal_end = r[4]  # this is actually total_assets in the shifted data
        if fiscal_end and 'SAR' in str(fiscal_end):
            # try to find a correct row with same total_assets
            match = cur.execute("""
                SELECT id, symbol, total_assets FROM tab_balance_sheet
                WHERE total_assets = ? AND symbol NOT LIKE '%ال%'
            """, (fiscal_end,)).fetchone()
            if match:
                print(f"  ⚠️ id={r[0]}: total_assets='{fiscal_end}' matches correct row id={match[0]} symbol={match[1]}")

    # 4. Before count
    before = cur.execute("SELECT COUNT(*) FROM tab_balance_sheet").fetchone()[0]
    print(f"\n  Before: {before} rows")

    # 5. Delete
    if not args.dry_run:
        cur.execute(f"DELETE FROM tab_balance_sheet WHERE id IN ({placeholders})", SHIFTED_IDS)
        deleted = cur.rowcount
        conn.commit()
        print(f"  ✅ Deleted: {deleted} shifted rows")
    else:
        print(f"  [DRY RUN] Would delete: {len(SHIFTED_IDS)} rows")

    # 6. After count
    after = cur.execute("SELECT COUNT(*) FROM tab_balance_sheet").fetchone()[0]
    print(f"  After: {after} rows")

    # 7. Verify no more shifted rows
    shifted_remaining = cur.execute("""
        SELECT COUNT(*) FROM tab_balance_sheet
        WHERE symbol = 'السعودية' AND market LIKE '20%'
    """).fetchone()[0]
    print(f"  Shifted remaining: {shifted_remaining} (should be 0)")

    # 8. Verify row 1 is now correct
    first = cur.execute("SELECT id, symbol, market, fiscal_period, fiscal_end FROM tab_balance_sheet LIMIT 1").fetchone()
    print(f"  First row now: id={first[0]} symbol={first[1]} market={first[2]} fiscal_period={first[3]} fiscal_end={first[4]}")

    conn.close()
    print(f"\n✅ Task 1 complete" if not args.dry_run else f"\n[DRY RUN] Task 1 preview complete")
    return 0


if __name__ == "__main__":
    exit(main())
