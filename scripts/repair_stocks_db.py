#!/usr/bin/env python3
import sqlite3
import os
import shutil
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
db_path = str(PROJECT_ROOT / 'db' / 'stocks.db')
backup_path = db_path + '.backup'

print(f"Creating backup of {db_path} to {backup_path}...")
shutil.copy2(db_path, backup_path)

# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn = db_manager.connection(db_path, writable=False).__enter__()
cursor = conn.cursor()

try:
    print("Getting schema of 'screener_results'...")
    cursor.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='screener_results'")
    schema_row = cursor.fetchone()
    if not schema_row:
        print("Table 'screener_results' not found.")
        conn.close()
        exit(0)
    create_sql = schema_row[0]
    print(f"Table Schema: {create_sql}")

    print("Getting column names...")
    cursor.execute("PRAGMA table_info(screener_results)")
    columns_info = cursor.fetchall()
    columns = [info[1] for info in columns_info]
    symbol_index = columns.index('symbol')
    print(f"Columns: {columns}, symbol index: {symbol_index}")

    print("Reading rows from corrupted 'screener_results' table...")
    rows = []
    
    # Try reading directly from database bypassing SQLite transaction if needed,
    # or just read from backup DB to make sure we don't hit transaction locks!
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    backup_conn = db_manager.connection(backup_path, writable=False).__enter__()
    backup_cursor = backup_conn.cursor()
    try:
        backup_cursor.execute("SELECT * FROM screener_results")
        all_rows = backup_cursor.fetchall()
        print(f"Read {len(all_rows)} raw rows from backup.")
        for r in all_rows:
            if r[symbol_index] is not None:
                rows.append(r)
            else:
                print(f"Skipping row with NULL symbol: {r}")
    except Exception as e:
        print(f"Error reading from backup table (corruption expected): {e}")
        # Try to read row-by-row
        backup_cursor.execute("SELECT id FROM screener_results")
        ids = [r[0] for r in backup_cursor.fetchall()]
        for row_id in ids:
            try:
                backup_cursor.execute("SELECT * FROM screener_results WHERE id = ?", (row_id,))
                r = backup_cursor.fetchone()
                if r and r[symbol_index] is not None:
                    rows.append(r)
                else:
                    print(f"Skipping corrupted/NULL row {row_id}")
            except Exception as row_err:
                print(f"Skipping corrupted row {row_id}: {row_err}")
    finally:
        backup_conn.close()

    print(f"Recovered {len(rows)} valid rows.")

    placeholders = ", ".join(["?"] * len(columns))
    insert_sql = f"INSERT INTO screener_results ({', '.join(columns)}) VALUES ({placeholders})"

    print("Dropping corrupted 'screener_results' table...")
    cursor.execute("DROP TABLE screener_results")

    print("Recreating table 'screener_results'...")
    cursor.execute(create_sql)

    print("Inserting data back...")
    if rows:
        cursor.executemany(insert_sql, rows)
        print("Data restored successfully.")
    else:
        print("No rows to restore.")

    print("Running REINDEX on all indexes...")
    cursor.execute("REINDEX")

    print("Committing transaction...")
    conn.commit()

    print("Running VACUUM to compact the database...")
    conn.isolation_level = None
    cursor.execute("VACUUM")

    print("Running integrity check...")
    cursor.execute("PRAGMA integrity_check")
    integrity_result = cursor.fetchall()
    print(f"Integrity check results: {integrity_result}")

    print("Repair completed successfully!")
except Exception as e:
    print(f"Repair failed: {e}")
    conn.rollback()
finally:
    conn.close()
