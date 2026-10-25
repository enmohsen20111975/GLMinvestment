#!/usr/bin/env python3
"""
Fix Corrupted Epoch Millisecond Dates in auth.db
=================================================
Scans the User table and api_tokens table in db/auth.db for any raw numeric
timestamps (e.g. 1791051532825) and safely converts them to standard ISO 8601
UTC strings ('YYYY-MM-DDTHH:MM:SS.mmmZ').

This prevents Prisma's Rust runtime from throwing:
  PrismaClientKnownRequestError: Inconsistent column data:
  Could not convert value "1791051532825" of the field `last_active_at` to type `DateTime`.
"""

import sqlite3
import sys
import os
from datetime import datetime, timezone

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'db', 'auth.db')

def fix_table_dates(conn):
    cursor = conn.cursor()
    
    date_columns = [
        ('User', 'last_active_at'),
        ('User', 'last_login'),
        ('User', 'created_at'),
        ('User', 'updated_at'),
        ('User', 'email_verified'),
        ('User', 'trial_ends_at'),
        ('api_tokens', 'expires_at'),
        ('api_tokens', 'created_at'),
        ('api_tokens', 'last_used_at'),
    ]
    
    total_fixed = 0
    for table, col in date_columns:
        # Check if table and column exist
        try:
            cursor.execute(f"SELECT 1 FROM {table} LIMIT 1")
        except sqlite3.OperationalError:
            continue
            
        columns = [row[1] for row in cursor.execute(f"PRAGMA table_info({table})").fetchall()]
        if col not in columns:
            continue
            
        # Select all non-null values
        rows = cursor.execute(f"SELECT rowid, {col} FROM {table} WHERE {col} IS NOT NULL").fetchall()
        for rowid, val in rows:
            if isinstance(val, (int, float)) or (isinstance(val, str) and val.isdigit()):
                ms = int(val)
                if ms < 10000000000:
                    ms *= 1000
                iso = datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'
                cursor.execute(f"UPDATE {table} SET {col} = ? WHERE rowid = ?", (iso, rowid))
                total_fixed += 1
                print(f"  Fixed {table}.{col} for rowid {rowid}: {val} -> {iso}")

    conn.commit()
    return total_fixed

def main():
    if not os.path.exists(DB_PATH):
        print(f"Error: Database not found at {DB_PATH}")
        sys.exit(1)
        
    print(f"Opening {DB_PATH}...")
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_PATH, writable=False).__enter__()
    try:
        fixed = fix_table_dates(conn)
        print(f"Successfully repaired {fixed} date entries in auth.db!")
    finally:
        conn.close()

if __name__ == '__main__':
    main()
