#!/usr/bin/env python3
"""
import_indices.py — استيراد البيانات التاريخية للمؤشرات إلى قاعدة البيانات الإنتاجية
========================================================================
يقرأ ملفات EGX30_clean.csv و EGX100_clean.csv ويحفظها في جدول price_history 
تحت رموز التداول EGX30 و EGX100 ليعرضها الموقع الإنتاجي.
"""
import sqlite3
import pandas as pd
from pathlib import Path
import os

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PRICE_HISTORY_DB = os.environ.get('PRICE_HISTORY_DB', str(PROJECT_ROOT / 'db' / 'price_history.db'))

def import_indices_to_production():
    print(f"Connecting to production DB: {PRICE_HISTORY_DB}")
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
    cursor = conn.cursor()
    
    # 1. EGX30
    egx30_csv = PROJECT_ROOT / "db" / "EGX30_clean.csv"
    if egx30_csv.exists():
        print(f"Reading: {egx30_csv}")
        df30 = pd.read_csv(egx30_csv)
        
        # Prepare for price_history table
        # Columns: ticker, date, open_price, high_price, low_price, close_price, volume, source
        df30_ph = pd.DataFrame({
            'ticker': 'EGX30',
            'date': df30['date'],
            'open_price': df30['open'],
            'high_price': df30['high'],
            'low_price': df30['low'],
            'close_price': df30['close'],
            'volume': df30['volume'].astype(int),
            'source': 'system'
        })
        
        # Insert or Replace
        inserted = 0
        for _, row in df30_ph.iterrows():
            try:
                cursor.execute("""
                    INSERT OR REPLACE INTO price_history 
                    (ticker, date, open_price, high_price, low_price, close_price, volume, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (row['ticker'], row['date'], row['open_price'], row['high_price'], 
                      row['low_price'], row['close_price'], int(row['volume']), row['source']))
                inserted += 1
            except Exception as e:
                print(f"Error inserting EGX30 row: {e}")
        print(f"✓ Imported {inserted} rows for EGX30 into price_history table.")
    else:
        print(f"EGX30_clean.csv not found at {egx30_csv}")

    # 2. EGX100
    egx100_csv = PROJECT_ROOT / "db" / "EGX100_clean.csv"
    if egx100_csv.exists():
        print(f"Reading: {egx100_csv}")
        df100 = pd.read_csv(egx100_csv)
        
        df100_ph = pd.DataFrame({
            'ticker': 'EGX100',
            'date': df100['date'],
            'open_price': df100['open'],
            'high_price': df100['high'],
            'low_price': df100['low'],
            'close_price': df100['close'],
            'volume': df100['volume'].astype(int),
            'source': 'system'
        })
        
        inserted = 0
        for _, row in df100_ph.iterrows():
            try:
                cursor.execute("""
                    INSERT OR REPLACE INTO price_history 
                    (ticker, date, open_price, high_price, low_price, close_price, volume, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (row['ticker'], row['date'], row['open_price'], row['high_price'], 
                      row['low_price'], row['close_price'], int(row['volume']), row['source']))
                inserted += 1
            except Exception as e:
                print(f"Error inserting EGX100 row: {e}")
        print(f"✓ Imported {inserted} rows for EGX100 into price_history table.")
    else:
        print(f"EGX100_clean.csv not found at {egx100_csv}")

    conn.commit()
    conn.close()
    print("Done!")

if __name__ == "__main__":
    import_indices_to_production()
