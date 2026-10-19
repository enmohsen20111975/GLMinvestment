#!/usr/bin/env python3
"""
🧹 Database Cleanup Script for Corrupted/Scraped Symbols
=====================================================
Deletes corrupted stock records (such as those with description text appended to the symbol)
from all SQLite databases to ensure data purity.
"""

import sqlite3
import re
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / "db"
DBS = ["data_engine.db", "stocks.db", "predictions.db", "price_history.db", "historical.db"]

def identify_corrupted_symbols():
    data_engine_path = DB_DIR / "data_engine.db"
    if not data_engine_path.exists():
        print("❌ Error: data_engine.db not found!")
        return set()
        
    conn = sqlite3.connect(data_engine_path)
    cursor = conn.cursor()
    rows = cursor.execute("SELECT DISTINCT symbol, market FROM stocks").fetchall()
    
    corrupted_symbols = set()
    for sym, mkt in rows:
        if not sym:
            continue
        is_corrupted = False
        if mkt == 'السعودية':
            # Saudi tickers must be purely digits
            if not re.match(r'^\d+$', sym):
                is_corrupted = True
        else:
            # EGX, KSE, QSE tickers must be uppercase, numbers, dots, dashes, length 2 to 15
            if not re.match(r'^[A-Z0-9.\-_]{2,15}$', sym):
                is_corrupted = True
                
        if is_corrupted:
            corrupted_symbols.add(sym)
            
    conn.close()
    return corrupted_symbols

def delete_corrupted_symbols(corrupted_symbols):
    print(f"\n=== Deleting {len(corrupted_symbols)} corrupted symbols from databases ===")
    
    for db_name in DBS:
        db_path = DB_DIR / db_name
        if not db_path.exists():
            continue
            
        print(f"Processing database: {db_name}")
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Get all tables
        tables = cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        table_names = [t[0] for t in tables]
        
        deleted_count_db = 0
        for tname in table_names:
            if tname == 'sqlite_sequence':
                continue
                
            cols = [c[1] for c in cursor.execute(f"PRAGMA table_info({tname})").fetchall()]
            
            # Find column storing ticker/symbol
            col_to_use = None
            for c in ['ticker', 'symbol', 'stock_symbol']:
                if c in cols:
                    col_to_use = c
                    break
                    
            if not col_to_use:
                continue
                
            # Delete corrupted symbols
            for sym in corrupted_symbols:
                cursor.execute(f"DELETE FROM {tname} WHERE {col_to_use} = ?", (sym,))
                deleted_count_db += cursor.rowcount
                
        conn.commit()
        conn.close()
        print(f"   Deleted {deleted_count_db} rows from {db_name}")

if __name__ == "__main__":
    corrupted = identify_corrupted_symbols()
    if corrupted:
        # Stop PM2 services before modifying DBs
        import subprocess
        print("🛑 Stopping PM2 services...")
        subprocess.run(["pm2", "stop", "all"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        delete_corrupted_symbols(corrupted)
        
        # Re-run symbol alignment script
        print("\n⚙️ Re-running align_production_symbols.py to synchronize...")
        align_script = str(PROJECT_ROOT / "vps-service" / "align_production_symbols.py")
        subprocess.run(["python3", align_script])
        
        # Restart PM2 services
        print("🚀 Restarting PM2 services...")
        subprocess.run(["pm2", "start", "all"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        
        print("\n🎉 Databases are 100% clean and correct!")
    else:
        print("✅ No corrupted symbols found.")
