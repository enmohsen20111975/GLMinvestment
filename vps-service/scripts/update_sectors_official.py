#!/usr/bin/env python3
"""
Update EGX Sectors to Official 18 Sectors
=========================================

يحدث القطاعات في stocks.db باستخدام التصنيف الرسمي
من الموقع الرسمي للبورصة المصرية (219 سهم في 18 قطاع)

Database: stocks.db (55MB - الرئيسية)
- ممنوع حذف أي بيانات
- فقط تحديث حقل sector و is_active
"""

import sqlite3
from datetime import datetime
from pathlib import Path
import sys

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Import official sectors
from data.egx_official_sectors import STOCK_SECTORS, EGX_OFFICIAL_SECTORS

# Primary database (55MB with all data)
DB_PATH = str(Path(__file__).resolve().parents[2] / "db" / "stocks.db")


def update_sectors():
    """Update sectors in stocks.db."""
    print("=" * 70)
    print("🔄 تحديث القطاعات في stocks.db")
    print("=" * 70)
    print(f"Database: {DB_PATH}")
    print()

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(DB_PATH, writable=False)
    cursor = conn.cursor()

    # Step 1: Check current state
    print("📊 الوضع الحالي:")
    cursor.execute("SELECT COUNT(*) FROM stocks")
    total_stocks = cursor.fetchone()[0]
    print(f"   إجمالي الأسهم: {total_stocks}")

    cursor.execute("SELECT COUNT(DISTINCT sector) FROM stocks WHERE sector IS NOT NULL")
    old_sectors = cursor.fetchone()[0]
    print(f"   القطاعات الحالية: {old_sectors}")

    # Step 2: Check if is_active column exists
    cursor.execute("PRAGMA table_info(stocks)")
    columns = [col[1] for col in cursor.fetchall()]

    if 'is_active' not in columns:
        print("\n➕ إضافة عمود is_active...")
        cursor.execute("ALTER TABLE stocks ADD COLUMN is_active INTEGER DEFAULT 1")
        conn.commit()
        print("   ✅ تم إضافة العمود")

    # Step 3: Build Arabic name to ticker mapping from DB
    print("\n📋 مطابقة الأسهم مع التصنيف الرسمي...")
    cursor.execute("SELECT ticker, name_ar, sector FROM stocks")
    db_stocks = {row[1]: {'ticker': row[0], 'sector': row[2]} for row in cursor.fetchall() if row[1]}

    # Step 4: Match official stocks with DB
    matched = 0
    updated = 0
    unmatched = []

    for official_name, official_sector in STOCK_SECTORS.items():
        # Try to find in DB
        found = False
        for db_name, db_data in db_stocks.items():
            if official_name in db_name or db_name in official_name:
                # Update sector
                cursor.execute('''
                    UPDATE stocks 
                    SET sector = ?, is_active = 1 
                    WHERE name_ar = ?
                ''', (official_sector, db_name))
                if cursor.rowcount > 0:
                    matched += 1
                    updated += cursor.rowcount
                    found = True
                    break

        if not found:
            unmatched.append(official_name)

    # Step 5: Set is_active = 0 for unmatched stocks (الأسهم غير النشطة)
    print("\n🚫 تحديد الأسهم غير النشطة...")
    cursor.execute('''
        UPDATE stocks 
        SET is_active = 0 
        WHERE name_ar NOT IN (SELECT name_ar FROM stocks WHERE is_active = 1)
    ''')
    inactive_count = cursor.rowcount

    conn.commit()

    # Step 6: Verify results
    print("\n📊 النتائج:")
    cursor.execute("SELECT COUNT(*) FROM stocks WHERE is_active = 1")
    active_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM stocks WHERE is_active = 0")
    inactive_count = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(DISTINCT sector) FROM stocks WHERE is_active = 1 AND sector IS NOT NULL")
    new_sectors = cursor.fetchone()[0]

    print(f"   ✅ أسهم متطابقة: {matched}")
    print(f"   ✅ أسهم نشطة: {active_count}")
    print(f"   ⚠️ أسهم غير نشطة: {inactive_count}")
    print(f"   ✅ قطاعات جديدة: {new_sectors}")

    # Show sector distribution
    print("\n📊 توزيع القطاعات:")
    cursor.execute('''
        SELECT sector, COUNT(*) as count 
        FROM stocks 
        WHERE is_active = 1 AND sector IS NOT NULL
        GROUP BY sector 
        ORDER BY count DESC
    ''')

    for row in cursor.fetchall():
        print(f"   {row[0]}: {row[1]}")

    # Show unmatched
    if unmatched:
        print(f"\n⚠️ أسهم غير متطابقة ({len(unmatched)}):")
        for name in unmatched[:10]:
            print(f"   - {name}")
        if len(unmatched) > 10:
            print(f"   ... و {len(unmatched) - 10} أخرى")

    conn.close()

    print("\n" + "=" * 70)
    print("✅ تم التحديث بنجاح!")
    print("=" * 70)


def verify_data_integrity():
    """Verify that no data was lost."""
    print("\n🔍 التحقق من سلامة البيانات...")

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(DB_PATH, writable=False)
    cursor = conn.cursor()

    tables_to_check = [
        ('stock_price_history', 105757),
        ('signal_logs', 5213),
        ('outcome_logs', 5167),
        ('conjunction_patterns', 114)
    ]

    all_ok = True
    for table, expected in tables_to_check:
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        actual = cursor.fetchone()[0]
        status = "✅" if actual >= expected else "❌"
        print(f"   {status} {table}: {actual:,} (expected {expected:,})")
        if actual < expected:
            all_ok = False

    conn.close()

    if all_ok:
        print("\n✅ جميع البيانات سليمة!")
    else:
        print("\n❌ تحذير: قد يكون هناك فقدان في البيانات!")

    return all_ok


if __name__ == "__main__":
    # First verify data
    verify_data_integrity()

    # Then update sectors
    update_sectors()

    # Verify again
    verify_data_integrity()
