#!/usr/bin/env python3
"""
🛠️ Database Repair Tool for data_engine.db
===========================================
Repairs sqlite database corruption (database disk image is malformed)
by either reindexing or performing a clean table-by-table reconstruction.
"""

import sqlite3
import shutil
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / "db"
DB_PATH = DB_DIR / "data_engine.db"
CORRUPT_BAK = DB_DIR / "data_engine.db.corrupt"
FIXED_DB = DB_DIR / "data_engine.db.fixed"

def check_integrity(db_path):
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        res = cursor.execute("PRAGMA integrity_check;").fetchone()[0]
        conn.close()
        return res == "ok"
    except Exception as e:
        print(f"Error checking integrity of {db_path}: {e}")
        return False

def try_reindex(db_path):
    print("🔄 Attempting to REINDEX all tables...")
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("REINDEX;")
        conn.commit()
        conn.close()
        print("✅ Reindexing completed successfully.")
        return True
    except Exception as e:
        print(f"❌ Reindexing failed: {e}")
        return False

def rebuild_database():
    print("⚡ Starting full row-by-row database reconstruction...")
    
    if FIXED_DB.exists():
        FIXED_DB.unlink()
        
    conn_old = sqlite3.connect(CORRUPT_BAK)
    cursor_old = conn_old.cursor()
    
    conn_new = sqlite3.connect(FIXED_DB)
    cursor_new = conn_new.cursor()
    
    # Get all tables, indexes, views, triggers
    schema_objects = cursor_old.execute(
        "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL"
    ).fetchall()
    
    # Separate tables from others
    tables = [obj for obj in schema_objects if obj[0] == 'table' and not obj[1].startswith('sqlite_')]
    other_objects = [obj for obj in schema_objects if obj[0] != 'table']
    
    # Recreate tables and copy rows
    for obj_type, name, tbl_name, sql in tables:
        print(f"   Recreating table '{name}'...")
        try:
            cursor_new.execute(sql)
        except Exception as e:
            print(f"   ⚠️ Error creating table '{name}': {e}. Skipping.")
            continue
            
        # Read rows row-by-row to bypass corrupt pages
        try:
            cursor_old.execute(f"SELECT * FROM [{name}]")
            col_count = len(cursor_old.description)
            placeholders = ",".join(["?"] * col_count)
            insert_sql = f"INSERT INTO [{name}] VALUES ({placeholders})"
            
            rows_copied = 0
            rows_failed = 0
            
            while True:
                try:
                    row = cursor_old.fetchone()
                    if row is None:
                        break
                    cursor_new.execute(insert_sql, row)
                    rows_copied += 1
                except Exception as row_err:
                    rows_failed += 1
                    # Skip corrupt row/page
                    continue
            
            conn_new.commit()
            print(f"   📊 Table '{name}': {rows_copied} rows copied successfully, {rows_failed} corrupt rows skipped.")
        except Exception as table_err:
            print(f"   ❌ Error copying data for table '{name}': {table_err}")
            
    # Recreate views, indexes, triggers
    print("   Recreating indexes, views, and triggers...")
    for obj_type, name, tbl_name, sql in other_objects:
        try:
            cursor_new.execute(sql)
        except Exception as e:
            # Skip if index/view creation fails (e.g. index on missing columns)
            continue
            
    conn_new.commit()
    conn_old.close()
    conn_new.close()
    
    if check_integrity(FIXED_DB):
        print("✅ Rebuilt database passes integrity checks.")
        return True
    else:
        print("⚠️ Rebuilt database failed integrity checks.")
        return False

def main():
    if not DB_PATH.exists():
        print(f"❌ Error: Database {DB_PATH} not found.")
        sys.exit(1)
        
    print(f"🔎 Checking integrity of {DB_PATH}...")
    if check_integrity(DB_PATH):
        print("✅ Database integrity is OK. Running reindex to be safe...")
        try_reindex(DB_PATH)
        sys.exit(0)
        
    print("⚠️ Database is CORRUPTED (Integrity check failed).")
    
    # Step 1: Try REINDEX first
    if try_reindex(DB_PATH) and check_integrity(DB_PATH):
        print("🎉 Database successfully repaired using REINDEX!")
        sys.exit(0)
        
    # Step 2: Backup and reconstruct
    print("⚠️ Reindexing did not repair the corruption. Backing up and rebuilding...")
    if CORRUPT_BAK.exists():
        CORRUPT_BAK.unlink()
    shutil.move(str(DB_PATH), str(CORRUPT_BAK))
    print(f"   Backed up corrupt database to {CORRUPT_BAK}")
    
    rebuilt_ok = False
    try:
        rebuilt_ok = rebuild_database()
    except Exception as e:
        print(f"❌ Reconstruction error: {e}")
        
    if rebuilt_ok:
        shutil.move(str(FIXED_DB), str(DB_PATH))
        os.chmod(DB_PATH, 0o644)
        print("🎉 Database repair complete! Rebuilt database is now in place.")
    else:
        print("❌ Rebuild failed. Restoring corrupt backup to prevent loss.")
        if DB_PATH.exists():
            DB_PATH.unlink()
        shutil.copy2(CORRUPT_BAK, DB_PATH)
        sys.exit(1)

if __name__ == "__main__":
    main()
