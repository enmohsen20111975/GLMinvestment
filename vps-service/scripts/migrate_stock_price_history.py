#!/usr/bin/env python3
"""
Migration: Add stock_price_history to VPS stocks.db
====================================================
Copies the stock_price_history table (443K+ rows) from the ZIP's stocks.db
into the VPS's stocks.db without affecting existing data.

Usage on VPS:
1. cd /root/GLMinvestment
2. unzip -o "databases zip/stocks.db.zip" -d /tmp/
3. python3 vps-service/scripts/migrate_stock_price_history.py
4. pm2 restart python-backend
"""

import sqlite3
import sys
import os
import time

# Paths
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
VPS_DB = os.path.join(PROJECT_ROOT, 'db', 'stocks.db')
# ZIP_DB is an extracted archive — keep /tmp default but allow override via env (Rule 61)
ZIP_DB = os.environ.get('MIGRATION_ZIP_DB', '/tmp/stocks.db')  # Extracted from databases zip/stocks.db.zip

def main():
    vps_db_path = os.path.abspath(VPS_DB)
    zip_db_path = os.path.abspath(ZIP_DB)
    
    print(f"VPS DB: {vps_db_path}")
    print(f"ZIP DB: {zip_db_path}")
    
    if not os.path.exists(vps_db_path):
        print(f"ERROR: VPS DB not found at {vps_db_path}")
        sys.exit(1)
    
    if not os.path.exists(zip_db_path):
        print(f"ERROR: ZIP DB not found at {zip_db_path}")
        print(f"Run: unzip -o 'databases zip/stocks.db.zip' -d /tmp/")
        sys.exit(1)
    
    # Check if stock_price_history already exists in VPS DB
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    vps_conn = db_manager.get_connection(vps_db_path, writable=False)
    vps_cursor = vps_conn.cursor()
    
    existing = vps_cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='stock_price_history'"
    ).fetchone()
    
    if existing:
        count = vps_cursor.execute("SELECT COUNT(*) FROM stock_price_history").fetchone()[0]
        print(f"stock_price_history already exists with {count} rows.")
        if count > 100000:
            print("Looks good! No migration needed.")
            vps_conn.close()
            return
        else:
            print(f"Table exists but only has {count} rows. Will drop and re-import.")
            vps_cursor.execute("DROP TABLE IF EXISTS stock_price_history")
            vps_conn.commit()
    
    # Read from ZIP DB
    print("\nOpening ZIP database (read-only)...")
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    zip_conn = db_manager.get_connection(zip_db_path, writable=False)
    zip_cursor = zip_conn.cursor()
    
    # Get row count from source
    src_count = zip_cursor.execute("SELECT COUNT(*) FROM stock_price_history").fetchone()[0]
    print(f"Source has {src_count:,} rows in stock_price_history")
    
    # Create table in VPS DB
    print("\nCreating stock_price_history table in VPS DB...")
    vps_cursor.execute('''
        CREATE TABLE IF NOT EXISTS stock_price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            date TEXT NOT NULL,
            open_price REAL,
            high_price REAL,
            low_price REAL,
            close_price REAL,
            volume INTEGER,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (ticker) REFERENCES stocks(ticker),
            UNIQUE(ticker, date)
        )
    ''')
    vps_cursor.execute('CREATE INDEX IF NOT EXISTS idx_sph_ticker ON stock_price_history(ticker)')
    vps_cursor.execute('CREATE INDEX IF NOT EXISTS idx_sph_date ON stock_price_history(date)')
    vps_cursor.execute('CREATE INDEX IF NOT EXISTS idx_sph_ticker_date ON stock_price_history(ticker, date)')
    vps_conn.commit()
    print("Table created.")
    
    # Copy data in batches
    BATCH_SIZE = 50000
    offset = 0
    total_copied = 0
    
    print(f"\nCopying data in batches of {BATCH_SIZE:,}...")
    start_time = time.time()
    
    while True:
        rows = zip_cursor.execute(
            "SELECT ticker, date, open_price, high_price, low_price, close_price, volume "
            "FROM stock_price_history ORDER BY id LIMIT ? OFFSET ?",
            (BATCH_SIZE, offset)
        ).fetchall()
        
        if not rows:
            break
        
        vps_cursor.executemany(
            "INSERT OR IGNORE INTO stock_price_history (ticker, date, open_price, high_price, low_price, close_price, volume) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            rows
        )
        vps_conn.commit()
        
        total_copied += len(rows)
        elapsed = time.time() - start_time
        rate = total_copied / elapsed if elapsed > 0 else 0
        pct = (total_copied / src_count * 100) if src_count > 0 else 0
        print(f"  {total_copied:,}/{src_count:,} rows ({pct:.1f}%) - {rate:,.0f} rows/sec")
        
        offset += BATCH_SIZE
    
    vps_conn.commit()
    vps_conn.close()
    zip_conn.close()
    
    elapsed = time.time() - start_time
    print(f"\n✅ Done! Copied {total_copied:,} rows in {elapsed:.1f}s")
    print(f"\nNow run: pm2 restart python-backend")

if __name__ == '__main__':
    main()
