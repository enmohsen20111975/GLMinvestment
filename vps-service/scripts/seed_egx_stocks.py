#!/usr/bin/env python3
"""
Seed EGX Stocks to Database
===========================

يقوم بزرع الـ 219 سهم الرسميين في قاعدة البيانات
مع تحديث الـ is_active flag
"""

import sys
from pathlib import Path
from datetime import datetime

# Add parent to path
sys.path.insert(0, str(Path(__file__).parent.parent))

# Import stocks data
from data.egx_stocks_complete import EGX_STOCKS, SECTOR_STATS

# Database (relative path)
import sqlite3
from pathlib import Path as _P
DB_PATH = str(_P(__file__).resolve().parent.parent.parent / 'db' / 'stocks.db')

def seed_stocks():
    """Seed the database with EGX stocks."""
    print("=" * 70)
    print("🌱 SEEDING EGX STOCKS TO DATABASE")
    print("=" * 70)
    
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # First, set all existing stocks to inactive
    cursor.execute("UPDATE stocks SET is_active = 0")
    print("✅ Set all existing stocks to inactive")
    
    # Now insert/update the official stocks
    now = datetime.now().isoformat()
    
    insert_query = '''
        INSERT OR REPLACE INTO stocks 
        (ticker, name_ar, sector, is_active, is_egx, created_at, last_update)
        VALUES (?, ?, ?, 1, 1, ?, ?)
    '''
    
    inserted = 0
    for ticker, (name_ar, sector) in EGX_STOCKS.items():
        try:
            cursor.execute(insert_query, (
                ticker,
                name_ar,
                sector,
                now,
                now
            ))
            inserted += 1
        except Exception as e:
            print(f"❌ Error inserting {ticker}: {e}")
    
    conn.commit()
    
    # Verify
    cursor.execute("SELECT COUNT(*) FROM stocks WHERE is_active = 1")
    active_count = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM stocks")
    total_count = cursor.fetchone()[0]
    
    print(f"\n✅ Inserted/Updated: {inserted} stocks")
    print(f"✅ Active stocks: {active_count}")
    print(f"✅ Total stocks in DB: {total_count}")
    
    # Show by sector
    print("\n📊 Stocks by Sector (Active Only):")
    print("-" * 50)
    cursor.execute('''
        SELECT sector, COUNT(*) as count 
        FROM stocks 
        WHERE is_active = 1 
        GROUP BY sector 
        ORDER BY count DESC
    ''')
    
    for row in cursor.fetchall():
        print(f"   {row[0]}: {row[1]} stocks")
    
    # Show sample
    print("\n📋 Sample Stocks:")
    print("-" * 50)
    cursor.execute('''
        SELECT ticker, name_ar, sector 
        FROM stocks 
        WHERE is_active = 1 
        LIMIT 10
    ''')
    
    for row in cursor.fetchall():
        print(f"   {row[0]}: {row[1]} ({row[2]})")
    
    conn.close()
    print("\n" + "=" * 70)
    print("✅ SEEDING COMPLETE!")
    print("=" * 70)
    
    return inserted


def check_status():
    """Check current database status."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    print("\n📊 DATABASE STATUS:")
    print("-" * 50)
    
    cursor.execute("SELECT COUNT(*) FROM stocks WHERE is_active = 1")
    active = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(*) FROM stocks WHERE is_active = 0")
    inactive = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(DISTINCT sector) FROM stocks WHERE is_active = 1")
    sectors = cursor.fetchone()[0]
    
    print(f"   Active stocks: {active}")
    print(f"   Inactive stocks: {inactive}")
    print(f"   Sectors: {sectors}")
    
    conn.close()
    return {'active': active, 'inactive': inactive, 'sectors': sectors}


if __name__ == "__main__":
    seed_stocks()
    check_status()
