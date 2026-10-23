#!/usr/bin/env python3
"""
Migration: Update VPS data_engine.db with missing/empty tables
===============================================================
Copies tab_* tables from ZIP's data_engine.db to VPS's data_engine.db
if they're missing or have very few rows.

Also copies updated crypto_prices, gold_prices, silver_prices.

Usage on VPS:
1. cd /root/GLMinvestment
2. unzip -o "databases zip/data_engine.db.zip" -d /tmp/
3. python3 vps-service/scripts/migrate_data_engine.py
4. pm2 restart python-backend
"""

import sqlite3
import sys
import os
import time

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
VPS_DB = os.path.join(PROJECT_ROOT, 'db', 'data_engine.db')
# ZIP_DB is an extracted archive — keep /tmp default but allow override via env (Rule 61)
ZIP_DB = os.environ.get('MIGRATION_ZIP_DB', '/tmp/data_engine.db')

# Tables to copy (tab_* tables + price tables that might be outdated)
TABLES_TO_CHECK = [
    'tab_technical_analysis',
    'tab_performance',
    'tab_valuation',
    'tab_profitability',
    'tab_balance_sheet',
    'tab_cash_flow',
    'tab_income_statement',
    'tab_dividends',
]

PRICE_TABLES_TO_UPDATE = [
    'crypto_prices',    # ZIP has 128K rows vs VPS might have 700
    'gold_prices',      # ZIP has 129K rows vs VPS might have 1.3K
    'silver_prices',    # ZIP has 21K rows
    'exchange_rates',   # ZIP has 21K rows
]

def get_table_count(conn, table_name):
    try:
        return conn.execute(f'SELECT COUNT(*) FROM [{table_name}]').fetchone()[0]
    except:
        return -1

def table_exists(conn, table_name):
    return conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
    ).fetchone() is not None

def copy_table(src_conn, dst_conn, table_name, batch_size=50000):
    """Copy all rows from src to dst table."""
    # Get column names from source
    sample = src_conn.execute(f'SELECT * FROM [{table_name}] LIMIT 1').fetchall()
    if not sample:
        return 0
    cols = [desc[0] for desc in src_conn.execute(f'SELECT * FROM [{table_name}] LIMIT 0').description]
    col_list = ', '.join(f'[{c}]' for c in cols)
    placeholders = ', '.join('?' * len(cols))
    
    # Create table in destination using source schema
    create_sql = src_conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table_name,)
    ).fetchone()[0]
    dst_conn.execute(f'DROP TABLE IF EXISTS [{table_name}]')
    dst_conn.execute(create_sql)
    
    # Copy data in batches
    total = 0
    offset = 0
    while True:
        rows = src_conn.execute(
            f'SELECT {col_list} FROM [{table_name}] LIMIT ? OFFSET ?',
            (batch_size, offset)
        ).fetchall()
        if not rows:
            break
        dst_conn.executemany(
            f'INSERT INTO [{table_name}] ({col_list}) VALUES ({placeholders})', rows
        )
        total += len(rows)
        offset += batch_size
    
    return total

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
        print(f"Run: unzip -o 'databases zip/data_engine.db.zip' -d /tmp/")
        sys.exit(1)
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    src_conn = db_manager.connection(zip_db_path, writable=False).__enter__()
    src_conn.row_factory = sqlite3.Row
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    dst_conn = db_manager.connection(vps_db_path, writable=False).__enter__()
    dst_conn.execute('PRAGMA busy_timeout=30000')
    
    start_time = time.time()
    total_rows = 0
    
    # ── 1) Copy tab_* tables if missing or empty ──
    print('\n=== Tab Tables ===')
    for table in TABLES_TO_CHECK:
        vps_count = get_table_count(dst_conn, table)
        zip_count = get_table_count(src_conn, table)
        
        if vps_count == -1:
            print(f'  {table}: MISSING in VPS → copying {zip_count:,} rows from ZIP')
            copied = copy_table(src_conn, dst_conn, table)
            dst_conn.commit()
            print(f'  ✅ {table}: {copied:,} rows copied')
            total_rows += copied
        elif vps_count < 10 and zip_count > 10:
            print(f'  {table}: VPS has {vps_count} rows, ZIP has {zip_count:,} → replacing')
            copied = copy_table(src_conn, dst_conn, table)
            dst_conn.commit()
            print(f'  ✅ {table}: {copied:,} rows copied')
            total_rows += copied
        else:
            print(f'  {table}: VPS has {vps_count:,} rows ✓ (skip)')
    
    # ── 2) Update price tables if ZIP has significantly more data ──
    print('\n=== Price Tables ===')
    for table in PRICE_TABLES_TO_UPDATE:
        if not table_exists(src_conn, table):
            print(f'  {table}: not in ZIP, skip')
            continue
        
        vps_count = get_table_count(dst_conn, table)
        zip_count = get_table_count(src_conn, table)
        
        if vps_count < zip_count * 0.5:
            # ZIP has significantly more data (>2x)
            print(f'  {table}: VPS has {vps_count:,}, ZIP has {zip_count:,} → replacing')
            copied = copy_table(src_conn, dst_conn, table)
            dst_conn.commit()
            print(f'  ✅ {table}: {copied:,} rows copied')
            total_rows += copied
        else:
            print(f'  {table}: VPS has {vps_count:,} rows ✓ (skip)')
    
    # ── 3) Recreate indexes ──
    print('\n=== Rebuilding Indexes ===')
    indexes = src_conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND sql NOT LIKE '%sqlite_autoindex%'"
    ).fetchall()
    for idx in indexes:
        try:
            dst_conn.execute(idx['sql'])
        except Exception as e:
            if 'already exists' not in str(e):
                print(f'  ⚠️ Index error: {e}')
    dst_conn.commit()
    print(f'  {len(indexes)} indexes processed')
    
    dst_conn.close()
    src_conn.close()
    
    elapsed = time.time() - start_time
    print(f'\n✅ Done! Copied {total_rows:,} rows in {elapsed:.1f}s')
    print(f'\nNow run: pm2 restart python-backend')

if __name__ == '__main__':
    main()
