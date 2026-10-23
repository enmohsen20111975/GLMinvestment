#!/usr/bin/env python3
"""
Compare Official EGX Stocks with Database
=========================================

يقارن الـ 219 سهم الرسميين مع الـ 290 في قاعدة البيانات
ويحدد الـ 71 سهم الناقصين
"""

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sqlite3
from pathlib import Path

# Import official sectors
from data.egx_official_sectors import STOCK_SECTORS, EGX_OFFICIAL_SECTORS

# Database path
DB_PATH = Path(__file__).parent.parent.parent / 'db' / 'stocks.db'

def get_db_stocks():
    """Get all stocks from database."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_PATH, writable=False).__enter__()
    cursor = conn.cursor()
    
    cursor.execute('''
        SELECT ticker, name, name_ar, sector, is_active
        FROM stocks
        ORDER BY ticker
    ''')
    
    stocks = {}
    for row in cursor.fetchall():
        ticker = row[0]
        stocks[ticker] = {
            'ticker': ticker,
            'name': row[1],
            'name_ar': row[2],
            'sector': row[3],
            'is_active': row[4]
        }
    
    conn.close()
    return stocks

def get_official_tickers():
    """Get official stock tickers from EGX official list."""
    # The official list uses Arabic names, we need to match them with tickers
    # We'll use partial matching
    return set(STOCK_SECTORS.keys())

def normalize_name(name):
    """Normalize Arabic name for comparison."""
    if not name:
        return ""
    return name.strip().replace(' ', '').replace('-', '')

def main():
    print("=" * 70)
    print("EGX STOCK COMPARISON: Official vs Database")
    print("=" * 70)
    
    # Get stocks
    db_stocks = get_db_stocks()
    official_names = get_official_tickers()
    
    print(f"\n📊 Database stocks: {len(db_stocks)}")
    print(f"📊 Official stocks: {len(official_names)}")
    print(f"📊 Difference: {len(db_stocks) - len(official_names)}")
    
    # Build name to ticker mapping from DB
    db_name_to_ticker = {}
    db_ticker_to_name = {}
    
    for ticker, data in db_stocks.items():
        if data['name_ar']:
            db_name_to_ticker[normalize_name(data['name_ar'])] = ticker
            db_ticker_to_name[ticker] = data['name_ar']
        if data['name']:
            db_name_to_ticker[normalize_name(data['name'])] = ticker
    
    # Match official stocks with DB
    matched_stocks = []
    unmatched_official = []
    
    for official_name in official_names:
        normalized = normalize_name(official_name)
        
        # Try exact match first
        if normalized in db_name_to_ticker:
            matched_stocks.append({
                'official_name': official_name,
                'ticker': db_name_to_ticker[normalized],
                'sector': STOCK_SECTORS[official_name]
            })
        else:
            # Try partial match
            found = False
            for db_name, ticker in db_name_to_ticker.items():
                if normalized in db_name or db_name in normalized:
                    matched_stocks.append({
                        'official_name': official_name,
                        'ticker': ticker,
                        'sector': STOCK_SECTORS[official_name]
                    })
                    found = True
                    break
            
            if not found:
                unmatched_official.append(official_name)
    
    # Find stocks in DB not in official list
    matched_tickers = set(s['ticker'] for s in matched_stocks)
    extra_in_db = []
    
    for ticker, data in db_stocks.items():
        if ticker not in matched_tickers:
            extra_in_db.append({
                'ticker': ticker,
                'name_ar': data['name_ar'],
                'sector': data['sector']
            })
    
    # Print results
    print("\n" + "=" * 70)
    print("✅ MATCHED STOCKS (in both official and DB)")
    print("=" * 70)
    print(f"Total: {len(matched_stocks)}")
    
    print("\n" + "=" * 70)
    print("❌ UNMATCHED OFFICIAL (in official but not in DB)")
    print("=" * 70)
    print(f"Total: {len(unmatched_official)}")
    for name in unmatched_official[:20]:
        print(f"   - {name}")
    if len(unmatched_official) > 20:
        print(f"   ... and {len(unmatched_official) - 20} more")
    
    print("\n" + "=" * 70)
    print("⚠️ EXTRA IN DB (in DB but not in official)")
    print("=" * 70)
    print(f"Total: {len(extra_in_db)}")
    for stock in extra_in_db:
        print(f"   - {stock['ticker']}: {stock['name_ar']} ({stock['sector']})")
    
    # Summary
    print("\n" + "=" * 70)
    print("📋 SUMMARY")
    print("=" * 70)
    print(f"Official stocks: {len(official_names)}")
    print(f"Matched: {len(matched_stocks)}")
    print(f"Unmatched official: {len(unmatched_official)}")
    print(f"Extra in DB: {len(extra_in_db)}")
    print(f"\nActive stocks (matched): {len(matched_stocks)}")
    print(f"Inactive stocks (extra): {len(extra_in_db)}")
    
    # Generate SQL to update is_active
    print("\n" + "=" * 70)
    print("🔧 SQL TO UPDATE is_active")
    print("=" * 70)
    
    # Set all to inactive first
    print("\n-- Set all stocks to inactive")
    print("UPDATE stocks SET is_active = 0;")
    
    # Set matched to active
    tickers = [s['ticker'] for s in matched_stocks if s['ticker']]
    if tickers:
        print(f"\n-- Set matched {len(tickers)} stocks to active")
        tickers_str = "', '".join(tickers)
        print(f"UPDATE stocks SET is_active = 1 WHERE ticker IN ('{tickers_str[:100]}...');")
    
    return {
        'matched': matched_stocks,
        'unmatched_official': unmatched_official,
        'extra_in_db': extra_in_db
    }


if __name__ == "__main__":
    main()
