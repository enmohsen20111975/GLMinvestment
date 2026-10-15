#!/usr/bin/env python3
"""
Fix VPS Database Schema - Updated Version
==========================================
This script fixes the column order issue in stocks.db on VPS.

The problem: VPS database has different column order causing:
- market column to contain price values
- sector column to contain price values

This script will:
1. Check the current schema
2. Rebuild the table with correct column order
3. Migrate the data
"""

import sqlite3
import os
import sys
from datetime import datetime
from pathlib import Path

def get_current_columns(db_path):
    """Get current column names and order."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute('PRAGMA table_info(stocks)')
    columns = cursor.fetchall()
    conn.close()
    return [(col[1], col[2]) for col in columns]

def check_schema_issue(db_path):
    """Check if the schema has the market/sector column order issue."""
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check if market and sector contain numeric values
    cursor.execute('''
        SELECT ticker, market, sector, current_price, open_price 
        FROM stocks 
        WHERE market IS NOT NULL 
        LIMIT 5
    ''')
    samples = cursor.fetchall()
    conn.close()
    
    issues = []
    for row in samples:
        ticker, market, sector, current_price, open_price = row
        # Check if market looks like a price (numeric string)
        try:
            if market and isinstance(market, str):
                market_val = float(market)
                # If market is numeric and close to current_price, it's wrong
                if current_price and abs(market_val - current_price) < 0.1:
                    issues.append(f"ticker={ticker}: market='{market}' should be market name, not price")
        except (ValueError, TypeError):
            pass  # market is not numeric, which is correct
        
        # Check if sector looks like a price
        try:
            if sector and isinstance(sector, str):
                sector_val = float(sector)
                if open_price and abs(sector_val - open_price) < 0.1:
                    issues.append(f"ticker={ticker}: sector='{sector}' should be sector name, not price")
        except (ValueError, TypeError):
            pass
    
    return issues

def fix_schema(db_path, backup=True):
    """Fix the schema by rebuilding the table."""
    print(f"\n{'='*60}")
    print(f"Fixing database: {db_path}")
    print(f"{'='*60}\n")
    
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    
    # Check if stocks_backup exists (from failed attempt)
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='stocks_backup'")
    has_backup = cursor.fetchone() is not None
    
    # Check if stocks table exists
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='stocks'")
    has_stocks = cursor.fetchone() is not None
    
    if has_backup and not has_stocks:
        print("⚠ Found backup from previous failed attempt. Restoring...")
        cursor.execute('ALTER TABLE stocks_backup RENAME TO stocks')
        conn.commit()
        print("✓ Restored stocks table from backup")
    
    # Get current column names for migration
    cursor.execute('PRAGMA table_info(stocks)')
    old_columns_info = cursor.fetchall()
    old_columns = [col[1] for col in old_columns_info]
    
    print(f"Current columns ({len(old_columns)}): {old_columns[:10]}...")
    
    # Check issues
    issues = check_schema_issue(db_path)
    if not issues:
        print("\n✓ No schema issues detected! Database is correct.")
        conn.close()
        return True
    
    print(f"\n⚠ Found {len(issues)} issues:")
    for issue in issues[:5]:
        print(f"  - {issue}")
    
    # Create backup table
    if backup:
        print("\nCreating backup...")
        # Drop old backup if exists
        cursor.execute('DROP TABLE IF EXISTS stocks_backup_old')
        cursor.execute('DROP TABLE IF EXISTS stocks_backup')
        cursor.execute('ALTER TABLE stocks RENAME TO stocks_backup')
        print("✓ Backup created as stocks_backup")
    
    # Create new table with correct schema (SQLite compatible)
    print("\nCreating new table with correct schema...")
    cursor.execute('''
        CREATE TABLE stocks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            name TEXT,
            name_ar TEXT,
            market TEXT NOT NULL DEFAULT 'EGX',
            sector TEXT,
            industry TEXT,
            current_price REAL,
            previous_close REAL,
            open_price REAL,
            high_price REAL,
            low_price REAL,
            change_percent REAL,
            volume INTEGER,
            market_cap REAL,
            pe_ratio REAL,
            pb_ratio REAL,
            ps_ratio REAL,
            eps REAL,
            roe REAL,
            roa REAL,
            debt_to_equity REAL,
            current_ratio REAL,
            book_value_per_share REAL,
            ma_50 REAL,
            ma_200 REAL,
            rsi REAL,
            support REAL,
            resistance REAL,
            signal REAL,
            trend TEXT,
            dividend_yield REAL,
            profit_margin REAL,
            avg_volume REAL,
            beta REAL,
            high_52w REAL,
            low_52w REAL,
            close REAL,
            change_value REAL,
            is_active INTEGER DEFAULT 1,
            is_egx30 INTEGER DEFAULT 0,
            is_egx70 INTEGER DEFAULT 0,
            is_egx100 INTEGER DEFAULT 0,
            last_update TEXT,
            created_at TEXT,
            updated_at TEXT
        )
    ''')
    
    # Create indexes
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON stocks(ticker)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_stocks_market ON stocks(market)')
    cursor.execute('CREATE INDEX IF NOT EXISTS idx_stocks_is_active ON stocks(is_active)')
    
    conn.commit()
    
    # Map old columns to new columns by NAME
    print("\nMigrating data...")
    
    # New columns in correct order
    new_columns = [
        'id', 'ticker', 'name', 'name_ar', 'market', 'sector', 'industry',
        'current_price', 'previous_close', 'open_price', 'high_price', 'low_price',
        'change_percent', 'volume', 'market_cap', 'pe_ratio', 'pb_ratio', 'ps_ratio',
        'eps', 'roe', 'roa', 'debt_to_equity', 'current_ratio', 'book_value_per_share',
        'ma_50', 'ma_200', 'rsi', 'support', 'resistance', 'signal', 'trend',
        'dividend_yield', 'profit_margin', 'avg_volume', 'beta', 'high_52w', 'low_52w',
        'close', 'change_value', 'is_active', 'is_egx30', 'is_egx70', 'is_egx100',
        'last_update', 'created_at', 'updated_at'
    ]
    
    # Build SELECT query from backup using column names
    # Map old column positions to names
    old_col_names = old_columns
    
    # Get all data from backup
    cursor.execute('SELECT * FROM stocks_backup')
    rows = cursor.fetchall()
    print(f"Found {len(rows)} rows to migrate")
    
    migrated = 0
    now = datetime.now().isoformat()
    
    for row in rows:
        # Create dict from old row using old column names
        old_data = {}
        for i, col_name in enumerate(old_col_names):
            if i < len(row):
                old_data[col_name] = row[i]
        
        # Build new row in correct order with correct data
        # The key insight: old 'market' column actually contains 'open_price' data
        # old 'sector' column actually contains 'current_price' or similar
        
        # We need to figure out the correct mapping based on data type
        # If old 'market' looks like a price, it should go to a price column
        
        # Start with default values
        new_row = []
        for col in new_columns:
            val = None
            
            # Try to get value from old data
            if col in old_data and old_data.get(col) is not None:
                val = old_data[col]
            
            # Handle specific column mappings for corrupted data
            # The old schema had: market=price, sector=price
            # We need to detect this and remap
            
            if col == 'market':
                # If old 'market' value looks like a price, use default 'EGX'
                try:
                    if val is not None:
                        float(val)
                        # It's a price, not a market name
                        val = 'EGX'
                except (ValueError, TypeError):
                    # It's a string, which is correct for market
                    pass
            
            if col == 'sector':
                # If old 'sector' value looks like a price, set to None
                try:
                    if val is not None:
                        float(val)
                        # It's a price, not a sector name
                        val = None
                except (ValueError, TypeError):
                    # It's a string, which is correct for sector
                    pass
            
            # Set timestamps if missing
            if col == 'created_at' and val is None:
                val = now
            if col == 'updated_at' and val is None:
                val = now
            
            new_row.append(val)
        
        # Insert
        placeholders = ','.join(['?' for _ in new_columns])
        col_names_str = ','.join(new_columns)
        
        try:
            cursor.execute(f'INSERT INTO stocks ({col_names_str}) VALUES ({placeholders})', new_row)
            migrated += 1
        except Exception as e:
            print(f"Error inserting row {old_data.get('ticker', 'unknown')}: {e}")
            continue
    
    conn.commit()
    
    print(f"\n✓ Migrated {migrated} rows")
    
    # Verify
    cursor.execute('SELECT COUNT(*) FROM stocks')
    new_count = cursor.fetchone()[0]
    print(f"✓ New table has {new_count} rows")
    
    # Check if issues are fixed
    issues_after = check_schema_issue(db_path)
    if not issues_after:
        print("\n✅ All schema issues fixed!")
    else:
        print(f"\n⚠ Still have {len(issues_after)} issues after migration")
    
    conn.close()
    return True

if __name__ == '__main__':
    # Default database path
    if len(sys.argv) > 1:
        db_path = sys.argv[1]
    else:
        db_path = 'str(Path(__file__).resolve().parent.parent)/db/stocks.db'
    
    print(f"\n{'='*60}")
    print(f" VPS Database Schema Fixer v2")
    print(f"{'='*60}")
    print(f"\nDatabase: {db_path}")
    
    if not os.path.exists(db_path):
        print(f"\n✗ Database file not found: {db_path}")
        sys.exit(1)
    
    # Fix the schema
    try:
        fix_schema(db_path)
    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    
    print("\n" + "="*60)
    print(" Done! Please restart the Python backend:")
    print("   pm2 restart python-backend")
    print("="*60)
