#!/usr/bin/env python3
"""
Seed Official EGX Stocks
========================

يزرع الـ 219 سهم الرسميين في قاعدة البيانات
مع تحديد القطاع و is_active = 1
"""

import sqlite3
from datetime import datetime
from pathlib import Path

# Import official sectors
import sys
sys.path.insert(0, str(Path(__file__).parent.parent / 'vps-service'))
from data.egx_official_sectors import STOCK_SECTORS, EGX_OFFICIAL_SECTORS

# Database path (relative)
from pathlib import Path as _P
DB_PATH = str(_P(__file__).resolve().parent.parent.parent / 'db' / 'stocks.db')

def seed_stocks():
    """Seed the stocks table with official EGX stocks."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Check current count
    cursor.execute("SELECT COUNT(*) FROM stocks")
    current_count = cursor.fetchone()[0]
    print(f"Current stocks in DB: {current_count}")
    
    # Prepare insert
    insert_query = '''
        INSERT OR REPLACE INTO stocks 
        (ticker, name_ar, sector, is_active, is_egx, created_at, last_update)
        VALUES (?, ?, ?, 1, 1, ?, ?)
    '''
    
    now = datetime.now().isoformat()
    inserted = 0
    
    for stock_name, sector in STOCK_SECTORS.items():
        # Generate a ticker from Arabic name (simplified)
        # In real scenario, we'd use actual ticker symbols
        ticker = stock_name.replace(' ', '_').replace('(', '').replace(')', '')[:20]
        
        try:
            cursor.execute(insert_query, (
                ticker,
                stock_name,
                sector,
                now,
                now
            ))
            inserted += 1
        except Exception as e:
            print(f"Error inserting {stock_name}: {e}")
    
    conn.commit()
    
    # Verify
    cursor.execute("SELECT COUNT(*) FROM stocks WHERE is_active = 1")
    active_count = cursor.fetchone()[0]
    
    print(f"\n✅ Inserted: {inserted} stocks")
    print(f"✅ Active stocks: {active_count}")
    
    # Show by sector
    print("\n📊 Stocks by Sector:")
    cursor.execute('''
        SELECT sector, COUNT(*) as count 
        FROM stocks 
        WHERE is_active = 1 
        GROUP BY sector 
        ORDER BY count DESC
    ''')
    
    for row in cursor.fetchall():
        print(f"   {row[0]}: {row[1]} stocks")
    
    conn.close()
    return inserted

def check_existing_tickers():
    """Check if we have actual ticker symbols."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT ticker, name_ar FROM stocks LIMIT 10")
    rows = cursor.fetchall()
    
    print("\n📋 Sample stocks in DB:")
    for row in rows:
        print(f"   {row[0]}: {row[1]}")
    
    conn.close()

if __name__ == "__main__":
    print("=" * 60)
    print("SEEDING OFFICIAL EGX STOCKS")
    print("=" * 60)
    
    seed_stocks()
    check_existing_tickers()
