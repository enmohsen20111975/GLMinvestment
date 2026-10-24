#!/usr/bin/env python3
"""
scripts/migrate_egx_indices.py
==============================
سكريبت ترحيل لتثبيت مكونات المؤشرات الرسمية في stocks.db.

- is_egx30 = 1 للـ 30 سهم المعتمدين
- is_egx70 = 1 للـ 70 سهم
- is_egx100 = 1 للـ 100 سهم

Usage:
    python3 scripts/migrate_egx_indices.py
    python3 scripts/migrate_egx_indices.py --dry-run
"""
import sqlite3
import json
import argparse
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
CANONICAL_FILE = PROJECT_ROOT / 'vps-service' / 'data' / 'canonical_indices.json'


def main():
    parser = argparse.ArgumentParser(description='Migrate EGX indices to stocks.db')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط بدون تعديل')
    args = parser.parse_args()

    print("=" * 60)
    print("📋 BRAVO — EGX Indices Migration")
    print(f"   DB: {STOCKS_DB}")
    print(f"   Canonical: {CANONICAL_FILE}")
    print(f"   Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 60)

    if not STOCKS_DB.exists():
        print(f"❌ stocks.db not found")
        return 1

    # اقرأ الملف الدستوري
    with open(CANONICAL_FILE, 'r', encoding='utf-8') as f:
        indices = json.load(f)

    egx30 = indices.get('EGX30', [])
    egx70 = indices.get('EGX70', [])
    egx100 = indices.get('EGX100', [])

    print(f"\nCanonical indices:")
    print(f"  EGX30: {len(egx30)} tickers")
    print(f"  EGX70: {len(egx70)} tickers")
    print(f"  EGX100: {len(egx100)} tickers")

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(STOCKS_DB), writable=False).__enter__()
    cur = conn.cursor()

    # check which columns exist
    cols = [c[1] for c in cur.execute("PRAGMA table_info(stocks)").fetchall()]
    has_30 = 'is_egx30' in cols
    has_70 = 'is_egx70' in cols
    has_100 = 'is_egx100' in cols
    print(f"\nColumns: is_egx30={has_30}, is_egx70={has_70}, is_egx100={has_100}")

    if not has_30:
        print("❌ is_egx30 column missing — cannot migrate")
        conn.close()
        return 1

    # before
    before_30 = cur.execute("SELECT COUNT(*) FROM stocks WHERE is_egx30 = 1").fetchone()[0]
    print(f"\nBefore: is_egx30=1 → {before_30} stocks")

    if not args.dry_run:
        # 1. Reset all to 0
        cur.execute("UPDATE stocks SET is_egx30 = 0")
        print("  ✅ Reset is_egx30 = 0 for all")

        # 2. Set EGX30 members
        placeholders = ','.join('?' * len(egx30))
        cur.execute(f"UPDATE stocks SET is_egx30 = 1 WHERE ticker IN ({placeholders})", egx30)
        updated_30 = cur.rowcount
        print(f"  ✅ Set is_egx30 = 1 for {updated_30} stocks")

        # 3. EGX70 (if column exists)
        if has_70:
            cur.execute("UPDATE stocks SET is_egx70 = 0")
            placeholders70 = ','.join('?' * len(egx70))
            cur.execute(f"UPDATE stocks SET is_egx70 = 1 WHERE ticker IN ({placeholders70})", egx70)
            updated_70 = cur.rowcount
            print(f"  ✅ Set is_egx70 = 1 for {updated_70} stocks")

        # 4. EGX100 (if column exists)
        if has_100:
            cur.execute("UPDATE stocks SET is_egx100 = 0")
            placeholders100 = ','.join('?' * len(egx100))
            cur.execute(f"UPDATE stocks SET is_egx100 = 1 WHERE ticker IN ({placeholders100})", egx100)
            updated_100 = cur.rowcount
            print(f"  ✅ Set is_egx100 = 1 for {updated_100} stocks")

        conn.commit()

    # verify
    after_30 = cur.execute("SELECT COUNT(*) FROM stocks WHERE is_egx30 = 1").fetchone()[0]
    print(f"\nAfter: is_egx30=1 → {after_30} stocks (should be 30)")

    # show the 30
    rows = cur.execute("SELECT ticker, name_ar FROM stocks WHERE is_egx30 = 1 ORDER BY ticker").fetchall()
    print(f"\nEGX30 members ({len(rows)}):")
    for r in rows:
        print(f"  {r[0]}: {r[1]}")

    # check missing
    existing = set(r[0] for r in rows)
    missing = [t for t in egx30 if t not in existing]
    if missing:
        print(f"\n⚠️ Missing from DB: {missing}")
    else:
        print(f"\n✅ All 30 EGX30 members verified")

    conn.close()
    return 0 if after_30 == 30 else 1


if __name__ == "__main__":
    exit(main())
