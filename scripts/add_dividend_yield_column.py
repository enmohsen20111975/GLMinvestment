#!/usr/bin/env python3
"""
Migration: Add dividend_yield and dps_ttm columns to stocks table
=================================================================
Adds dividend_yield REAL and dps_ttm REAL columns if they don't exist.
"""

import sqlite3
import os

STOCKS_DB = '/home/z/my-project/db/stocks.db'

def column_exists(cursor, table, column):
    """Check if a column exists in a table"""
    cursor.execute(f"PRAGMA table_info({table})")
    columns = [row[1] for row in cursor.fetchall()]
    return column in columns

def migrate():
    if not os.path.exists(STOCKS_DB):
        print(f"❌ stocks.db not found at {STOCKS_DB}")
        return

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    cursor = conn.cursor()

    # Check and add dividend_yield column
    if column_exists(cursor, 'stocks', 'dividend_yield'):
        print("✅ dividend_yield column already exists in stocks table")
    else:
        cursor.execute("ALTER TABLE stocks ADD COLUMN dividend_yield REAL DEFAULT 0")
        conn.commit()
        print("✅ Added dividend_yield REAL DEFAULT 0 to stocks table")

    # Check and add dps_ttm column
    if column_exists(cursor, 'stocks', 'dps_ttm'):
        print("✅ dps_ttm column already exists in stocks table")
    else:
        cursor.execute("ALTER TABLE stocks ADD COLUMN dps_ttm REAL DEFAULT 0")
        conn.commit()
        print("✅ Added dps_ttm REAL DEFAULT 0 to stocks table")

    # Verify
    cursor.execute("PRAGMA table_info(stocks)")
    all_columns = [row[1] for row in cursor.fetchall()]
    print(f"\n📋 Current columns in stocks table ({len(all_columns)}):")
    for col in all_columns:
        print(f"   - {col}")

    conn.close()

if __name__ == '__main__':
    print("=" * 60)
    print("Migration: Add dividend_yield + dps_ttm columns")
    print("=" * 60)
    migrate()
    print("\n✅ Migration complete!")
