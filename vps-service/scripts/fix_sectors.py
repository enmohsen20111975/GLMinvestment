#!/usr/bin/env python3
"""
Fix Sectors in stocks.db
================================

يحدث القطاعات باستخدام الـ ticker mapping الصحيح
"""

import sqlite3
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent.parent))
from data.egx_ticker_sector_map import TICKER_SECTOR_MAP

DB_PATH = str(Path(__file__).resolve().parents[2] / "db" / "stocks.db")


def fix_sectors():
    """Fix sectors using ticker mapping."""
    print("=" * 70)
    print("🔧 إصلاح القطاعات باستخدام Ticker Mapping")
    print("=" * 70)

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Step 1: Count current state
    cursor.execute("SELECT COUNT(*) FROM stocks")
    total = cursor.fetchone()[0]
    print(f"\n📊 إجمالي الأسهم: {total}")

    # Step 2: Update sectors using ticker mapping
    print("\n🔄 تحديث القطاعات...")
    updated = 0
    not_found = []

    cursor.execute("SELECT ticker, name_ar FROM stocks")
    all_stocks = cursor.fetchall()

    for ticker, name_ar in all_stocks:
        if ticker in TICKER_SECTOR_MAP:
            new_sector = TICKER_SECTOR_MAP[ticker]
            cursor.execute('''
                UPDATE stocks 
                SET sector = ?, is_active = 1 
                WHERE ticker = ?
            ''', (new_sector, ticker))
            if cursor.rowcount > 0:
                updated += 1
        else:
            not_found.append((ticker, name_ar))

    conn.commit()

    # Step 3: Set is_active = 0 for unmapped stocks
    print("\n🚫 تحديد الأسهم غير النشطة...")
    cursor.execute('''
        UPDATE stocks 
        SET is_active = 0 
        WHERE ticker NOT IN (SELECT ticker FROM stocks WHERE is_active = 1)
    ''')

    conn.commit()

    # Step 4: Show results
    print(f"\n📊 النتائج:")
    print(f"   ✅ تم تحديث: {updated} سهم")
    print(f"   ⚠️ غير موجود في الـ mapping: {len(not_found)} سهم")

    # Show sector distribution
    print("\n📊 توزيع القطاعات (النشطة فقط):")
    cursor.execute('''
        SELECT sector, COUNT(*) as count 
        FROM stocks 
        WHERE is_active = 1 AND sector IS NOT NULL
        GROUP BY sector 
        ORDER BY count DESC
    ''')

    total_active = 0
    for row in cursor.fetchall():
        print(f"   {row[0]}: {row[1]}")
        total_active += row[1]

    print(f"\n   📈 إجمالي النشطة: {total_active}")

    # Show unmapped tickers
    if not_found:
        print(f"\n⚠️ Tickers غير موجودة في الـ mapping ({len(not_found)}):")
        for ticker, name in not_found[:15]:
            print(f"   {ticker}: {name}")
        if len(not_found) > 15:
            print(f"   ... و {len(not_found) - 15} أخرى")

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
    print("✅ تم الإصلاح!")
    print("=" * 70)


if __name__ == "__main__":
    fix_sectors()
