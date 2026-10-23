#!/usr/bin/env python3
"""
Normalize Sectors to Official Arabic Names
==========================================

يحول كل القطاعات الإنجليزية للعربية الرسمية (18 قطاع)
"""

import sqlite3
from pathlib import Path  # added by patch_db_paths.py

DB_PATH = str(Path(__file__).resolve().parents[2] / "db" / "stocks.db")

# English to Arabic sector mapping
SECTOR_TRANSLATION = {
    # English -> Official Arabic
    'Financial Services': 'خدمات مالية غير مصرفية',
    'Financials': 'خدمات مالية غير مصرفية',
    'Real Estate': 'عقارات',
    'Basic Materials': 'موارد أساسية',
    'Industrials': 'خدمات و منتجات صناعية وسيارات',
    'Industrial': 'خدمات و منتجات صناعية وسيارات',
    'Food & Beverage': 'أغذية و مشروبات و تبغ',
    'Healthcare': 'رعاية صحية و ادوية',
    'Energy': 'طاقة وخدمات مساندة',
    'Tourism': 'سياحة وترفيه',
    'Transportation': 'خدمات النقل والشحن',
    'Telecommunications': 'اتصالات و اعلام و تكنولوجيا المعلومات',
    'Technology': 'اتصالات و اعلام و تكنولوجيا المعلومات',
    'Consumer Goods': 'منسوجات و سلع معمرة',
    'Consumer Services': 'تجارة و موزعون',
    'Media': 'اتصالات و اعلام و تكنولوجيا المعلومات',
    'Agriculture': 'أغذية و مشروبات و تبغ',
}


def normalize_sectors():
    """Normalize all sectors to official Arabic names."""
    print("=" * 70)
    print("🔄 تحويل القطاعات للعربية الرسمية")
    print("=" * 70)

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_PATH, writable=False).__enter__()
    cursor = conn.cursor()

    # Get current distribution
    print("\n📊 القطاعات قبل التحويل:")
    cursor.execute('''
        SELECT sector, COUNT(*) as count
        FROM stocks
        WHERE sector IS NOT NULL
        GROUP BY sector
        ORDER BY count DESC
    ''')
    before = cursor.fetchall()
    for row in before[:15]:
        print(f"   {row[0]}: {row[1]}")

    # Update sectors
    print("\n🔄 تحويل القطاعات...")
    updated = 0

    for english, arabic in SECTOR_TRANSLATION.items():
        cursor.execute('''
            UPDATE stocks
            SET sector = ?
            WHERE sector = ?
        ''', (arabic, english))
        if cursor.rowcount > 0:
            print(f"   ✅ {english} → {arabic} ({cursor.rowcount} سهم)")
            updated += cursor.rowcount

    conn.commit()

    # Get new distribution
    print("\n📊 القطاعات بعد التحويل:")
    cursor.execute('''
        SELECT sector, COUNT(*) as count
        FROM stocks
        WHERE sector IS NOT NULL AND is_active = 1
        GROUP BY sector
        ORDER BY count DESC
    ''')
    after = cursor.fetchall()

    total_active = 0
    distinct_sectors = set()
    for row in after:
        print(f"   {row[0]}: {row[1]}")
        total_active += row[1]
        distinct_sectors.add(row[0])

    print(f"\n📊 الإحصائيات النهائية:")
    print(f"   قطاعات رسمية: {len(distinct_sectors)}")
    print(f"   أسهم نشطة: {total_active}")
    print(f"   تم تحويل: {updated} سهم")

    # Verify data integrity
    print("\n🔍 التحقق من سلامة البيانات:")
    tables = [
        ('stock_price_history', 105757),
        ('signal_logs', 5213),
        ('outcome_logs', 5167),
        ('conjunction_patterns', 114)
    ]

    for table, expected in tables:
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        actual = cursor.fetchone()[0]
        status = "✅" if actual >= expected else "❌"
        print(f"   {status} {table}: {actual:,}")

    conn.close()

    print("\n" + "=" * 70)
    print("✅ تم التحويل بنجاح!")
    print("=" * 70)


if __name__ == "__main__":
    normalize_sectors()
