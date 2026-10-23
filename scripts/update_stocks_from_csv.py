#!/usr/bin/env python3
"""
تحديث قاعدة البيانات من ملف CSV
- تحديث sector
- تحديث change_percent
- مسح التوقعات البيظة (إبقاء 80 فقط)
"""

import sqlite3
import csv
import os
from pathlib import Path

# Paths
DB_PATH = str(Path(__file__).resolve().parent.parent / 'db' / 'stocks.db')
CSV_PATH = str(Path(__file__).resolve().parent.parent / 'upload' / 'stocks.csv')

def main():
    print("=" * 60)
    print("تحديث قاعدة البيانات من CSV")
    print("=" * 60)

    # Connect to database
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_PATH, writable=False).__enter__()
    cursor = conn.cursor()

    # Read CSV
    print(f"\n[1] قراءة ملف CSV: {CSV_PATH}")
    stocks_data = {}
    
    with open(CSV_PATH, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            ticker = row.get('ticker', '').strip()
            if ticker:
                stocks_data[ticker] = {
                    'sector': row.get('sector', '').strip() or None,
                    'change_percent': float(row.get('change_percent', 0) or 0),
                    'current_price': float(row.get('current_price', 0) or 0),
                    'previous_close': float(row.get('previous_close', 0) or 0),
                }
    
    print(f"   تم قراءة {len(stocks_data)} سهم من CSV")

    # Update stocks table
    print(f"\n[2] تحديث جدول stocks...")
    updated_sector = 0
    updated_change = 0
    updated_price = 0

    for ticker, data in stocks_data.items():
        # Update sector
        if data['sector']:
            cursor.execute("""
                UPDATE stocks SET sector = ? WHERE ticker = ?
            """, (data['sector'], ticker))
            if cursor.rowcount > 0:
                updated_sector += 1

        # Update change_percent
        cursor.execute("""
            UPDATE stocks SET change_percent = ? WHERE ticker = ?
        """, (data['change_percent'], ticker))
        if cursor.rowcount > 0:
            updated_change += 1

        # Update prices if available
        if data['current_price'] > 0:
            cursor.execute("""
                UPDATE stocks SET 
                    current_price = ?,
                    previous_close = ?
                WHERE ticker = ?
            """, (data['current_price'], data['previous_close'], ticker))
            if cursor.rowcount > 0:
                updated_price += 1

    conn.commit()
    print(f"   ✅ تم تحديث sector: {updated_sector} سهم")
    print(f"   ✅ تم تحديث change_percent: {updated_change} سهم")
    print(f"   ✅ تم تحديث الأسعار: {updated_price} سهم")

    # Clean prediction_logs
    print(f"\n[3] تنظيف جدول prediction_logs...")
    cursor.execute("SELECT COUNT(*) FROM prediction_logs")
    before_count = cursor.fetchone()[0]
    print(f"   عدد التوقعات قبل التنظيف: {before_count}")

    if before_count > 80:
        # Keep only the latest 80 predictions
        cursor.execute("""
            DELETE FROM prediction_logs 
            WHERE id NOT IN (
                SELECT id FROM prediction_logs 
                ORDER BY created_at DESC 
                LIMIT 80
            )
        """)
        deleted = cursor.rowcount
        conn.commit()
        
        cursor.execute("SELECT COUNT(*) FROM prediction_logs")
        after_count = cursor.fetchone()[0]
        print(f"   ✅ تم حذف {deleted} توقع")
        print(f"   عدد التوقعات بعد التنظيف: {after_count}")
    else:
        print(f"   ⏭️ التوقعات أقل من 80، لا حاجة للحذف")

    # Verify updates
    print(f"\n[4] التحقق من التحديثات...")
    
    cursor.execute("SELECT COUNT(*) FROM stocks WHERE sector IS NOT NULL AND sector != ''")
    with_sector = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM stocks WHERE change_percent != 0")
    with_change = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM stocks WHERE current_price > 0")
    with_price = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM prediction_logs")
    predictions_count = cursor.fetchone()[0]

    print(f"   أسهم بقطاع: {with_sector}")
    print(f"   أسهم بـ change_percent: {with_change}")
    print(f"   أسهم بسعر: {with_price}")
    print(f"   عدد التوقعات: {predictions_count}")

    # Sample data
    print(f"\n[5] عينة من البيانات المحدثة:")
    cursor.execute("""
        SELECT ticker, name, sector, current_price, change_percent 
        FROM stocks 
        WHERE sector IS NOT NULL AND sector != ''
        LIMIT 5
    """)
    for row in cursor.fetchall():
        print(f"   {row[0]} - {row[1][:20]} - قطاع: {row[2]} - سعر: {row[3]} - تغيير: {row[4]}%")

    conn.close()
    print("\n" + "=" * 60)
    print("✅ تم التحديث بنجاح!")
    print("=" * 60)

if __name__ == '__main__':
    main()
