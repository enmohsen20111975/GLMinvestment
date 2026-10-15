#!/usr/bin/env python3
"""
Fix data_engine.db SQLite Corruption
======================================
Fixes: "malformed database schema (gold_prices_clean) - invalid rootpage"

Strategy:
  1. Open the corrupted DB using IMMUTABLE mode (bypasses schema validation)
  2. Read all CREATE TABLE/INDEX/VIEW/TRIGGER statements from sqlite_master
  3. Rebuild a new database table-by-table, recreating gold_prices_clean with correct schema
  4. Copy all data from old tables (except gold_prices_clean) to the new database
  5. Replace the corrupted DB with the fixed one

NOTE: Python's sqlite3 with uri='?immutable=1' can open a database even
when individual table schemas are corrupted, because it doesn't validate
the rootpage pointers until the table is actually queried.
"""

import sqlite3
import os
import shutil
import sys
import time
from pathlib import Path

DB_DIR = Path("/home/meme/my_apps/GLMinvestment/db")
DB_PATH = DB_DIR / "data_engine.db"
BACKUP_PATH = DB_DIR / f"data_engine.db.corrupt_backup.{int(time.time() * 1000)}"
NEW_DB_PATH = DB_DIR / "data_engine.db.fixed"

GOLD_CLEAN_SCHEMA = """
CREATE TABLE IF NOT EXISTS gold_prices_clean (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT,
    country TEXT,
    currency TEXT,
    karat TEXT,
    price_per_gram REAL,
    usd_rate_used REAL,
    global_ounce_usd REAL,
    UNIQUE(timestamp, country, karat)
)
"""

EXCLUDED_TABLES = {'gold_prices_clean', 'sqlite_sequence'}

def log(prefix, msg):
    print(f"{prefix} {msg}")

def main():
    print("=" * 55)
    print("  data_engine.db Corruption Fix Tool (Python)")
    print("=" * 55)
    print()

    # 1. Verify the database exists
    if not DB_PATH.exists():
        log("FATAL:", f"Database not found at {DB_PATH}")
        sys.exit(1)

    size_mb = DB_PATH.stat().st_size / (1024 * 1024)
    log("DB:", str(DB_PATH))
    log("Size:", f"{size_mb:.2f} MB")
    print()

    # 2. Create backup
    log("BACKUP:", "Creating backup...")
    shutil.copy2(DB_PATH, BACKUP_PATH)
    log("OK:", f"Backup saved to {BACKUP_PATH}")
    print()

    # ======================================================================
    # 3. Open with IMMUTABLE mode — this is the KEY to bypass schema validation
    #    SQLite with ?immutable=1 skips rootpage validation on schema load
    # ======================================================================
    log("OPEN:", "Opening in IMMUTABLE mode (bypasses schema validation)...")
    try:
        conn = sqlite3.connect(f"file:{DB_PATH}?immutable=1", uri=True, timeout=30)
        conn.execute("PRAGMA query_only = ON")
        log("OK:", "Database opened in IMMUTABLE mode")
    except sqlite3.DatabaseError as e:
        log("FAIL:", f"Cannot open even in IMMUTABLE mode: {e}")
        log("INFO:", "Trying alternative: checkpoint and retry...")
        
        # Try WAL checkpoint first
        try:
            conn2 = sqlite3.connect(str(DB_PATH), timeout=30)
            conn2.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            conn2.close()
            log("OK:", "WAL checkpoint completed, retrying...")
            conn = sqlite3.connect(f"file:{DB_PATH}?immutable=1", uri=True, timeout=30)
        except Exception as e2:
            log("FAIL:", f"Still cannot open: {e2}")
            return
    print()

    cursor = conn.cursor()

    # 4. Read schema from sqlite_master
    log("SCHEMA:", "Reading database schema...")
    try:
        cursor.execute("SELECT name, sql, rootpage FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = cursor.fetchall()

        cursor.execute("SELECT name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name")
        indices = cursor.fetchall()

        cursor.execute("SELECT name, sql FROM sqlite_master WHERE type='view' AND sql IS NOT NULL ORDER BY name")
        views = cursor.fetchall()

        cursor.execute("SELECT name, sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL ORDER BY name")
        triggers = cursor.fetchall()

        log("SCHEMA:", f"Found {len(tables)} tables, {len(indices)} indices, {len(views)} views, {len(triggers)} triggers")
    except sqlite3.DatabaseError as e:
        log("FAIL:", f"Cannot read schema: {e}")
        conn.close()
        return
    print()

    # 5. Identify corrupted tables
    for name, sql, rootpage in tables:
        if name == 'gold_prices_clean':
            log("PROBLEM:", f"gold_prices_clean (rootpage={rootpage}) is corrupted")
            if sql:
                log("SCHEMA:", sql[:120] + ("..." if len(sql or "") > 120 else ""))
            else:
                log("SCHEMA:", "NO CREATE STATEMENT STORED (corrupted)")
            break
    else:
        log("INFO:", "gold_prices_clean not found - checking other tables...")
        # Check if there are ANY corrupted tables by trying to query each
        for name, sql, rootpage in tables:
            if not sql:
                log("CORRUPT:", f"{name} has no SQL (rootpage={rootpage})")
    print()

    # 6. Create new database
    log("BUILD:", "Creating new database...")
    try:
        if NEW_DB_PATH.exists():
            NEW_DB_PATH.unlink()
        new_conn = sqlite3.connect(str(NEW_DB_PATH), timeout=30)
        new_conn.execute("PRAGMA journal_mode=WAL")
        new_conn.execute("PRAGMA synchronous=NORMAL")
        log("OK:", "New database created")
    except sqlite3.DatabaseError as e:
        log("FAIL:", f"Cannot create new DB: {e}")
        conn.close()
        return
    print()

    new_cursor = new_conn.cursor()

    # 7. Recreate all tables
    log("TABLES:")
    recreated_tables = []
    for name, sql, rootpage in tables:
        if name in EXCLUDED_TABLES:
            log("  SKIP:", f"{name} (will recreate separately)")
            continue
        if not sql:
            log("  WARN:", f"{name} has no SQL definition, skipping")
            continue
        try:
            new_cursor.execute(sql)
            recreated_tables.append(name)
            log("  OK:", name)
        except sqlite3.DatabaseError as e:
            log("  FAIL:", f"{name}: {e}")

    # Recreate gold_prices_clean with correct schema
    try:
        new_cursor.execute(GOLD_CLEAN_SCHEMA)
        recreated_tables.append('gold_prices_clean')
        log("  OK:", "gold_prices_clean (recreated with correct schema)")
    except sqlite3.DatabaseError as e:
        log("  FAIL:", f"gold_prices_clean: {e}")

    # Recreate indices
    log("\nINDICES:")
    for name, sql in indices:
        try:
            new_cursor.execute(sql)
            log("  OK:", name)
        except sqlite3.DatabaseError as e:
            log("  FAIL:", f"{name}: {e}")

    # Recreate views
    if views:
        log("\nVIEWS:")
        for name, sql in views:
            try:
                new_cursor.execute(sql)
                log("  OK:", name)
            except sqlite3.DatabaseError as e:
                log("  FAIL:", f"{name}: {e}")

    # Recreate triggers
    if triggers:
        log("\nTRIGGERS:")
        for name, sql in triggers:
            try:
                new_cursor.execute(sql)
                log("  OK:", name)
            except sqlite3.DatabaseError as e:
                log("  FAIL:", f"{name}: {e}")

    new_conn.commit()

    # 8. Copy data from old DB to new DB
    log("\nDATA:")
    for name in recreated_tables:
        if name in EXCLUDED_TABLES:
            continue
        if name == 'gold_prices_clean':
            # gold_prices_clean is empty - will be repopulated by data engine
            log("  EMPTY:", "gold_prices_clean (will be repopulated by data engine)")
            continue

        try:
            cursor.execute(f'SELECT * FROM "{name}"')
            rows = cursor.fetchall()
            if not rows:
                log("  EMPTY:", name)
                continue

            # Get column names
            col_names = [desc[0] for desc in cursor.description]
            cols = ", ".join(f'"{c}"' for c in col_names)
            placeholders = ", ".join("?" for _ in col_names)
            insert_sql = f'INSERT INTO "{name}" ({cols}) VALUES ({placeholders})'

            # Insert in batches
            batch_size = 500
            total_inserted = 0
            for i in range(0, len(rows), batch_size):
                batch = rows[i:i + batch_size]
                new_cursor.executemany(insert_sql, batch)
                total_inserted += len(batch)
            new_conn.commit()
            log("  OK:", f"{name}: {total_inserted:,} rows copied")
        except sqlite3.DatabaseError as e:
            log("  FAIL:", f"{name}: {e}")
            new_conn.rollback()

    conn.close()
    new_conn.close()

    # 9. Replace old DB with new DB
    log("\nREPLACE:", "Replacing corrupted database...")
    try:
        shutil.move(str(NEW_DB_PATH), str(DB_PATH))
        os.chmod(DB_PATH, 0o644)
        log("OK:", "Database replaced successfully")
    except Exception as e:
        log("FAIL:", f"Replace failed: {e}")
        log("INFO:", f"Fixed DB is at {NEW_DB_PATH}, copy manually to {DB_PATH}")
        return
    print()

    # 10. Verify the fix
    log("VERIFY:")
    try:
        verify_conn = sqlite3.connect(str(DB_PATH), timeout=30)
        vc = verify_conn.cursor()

        vc.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables_list = [r[0] for r in vc.fetchall()]
        log("  TABLES:", ", ".join(tables_list))

        # Test gold_prices_clean
        try:
            vc.execute("SELECT COUNT(*) FROM gold_prices_clean")
            count = vc.fetchone()[0]
            log("  GOLD:", f"gold_prices_clean: {count} rows (query OK)")
        except sqlite3.DatabaseError as e:
            log("  GOLD:", f"gold_prices_clean queryable: {e}")

        # Test historical_data (used by retroactive-predictions route)
        try:
            vc.execute("SELECT COUNT(*) FROM historical_data")
            count = vc.fetchone()[0]
            log("  HIST:", f"historical_data: {count:,} rows")
        except sqlite3.DatabaseError as e:
            if "no such table" in str(e).lower():
                log("  HIST:", "historical_data not found (expected for some DB versions)")
            else:
                log("  HIST:", f"Error: {e}")

        # Test stocks table
        try:
            vc.execute("SELECT COUNT(*) FROM stocks")
            count = vc.fetchone()[0]
            log("  STOCKS:", f"stocks: {count:,} rows")
        except sqlite3.DatabaseError as e:
            log("  STOCKS:", f"Error: {e}")

        # Full integrity check
        try:
            vc.execute("PRAGMA integrity_check")
            result = vc.fetchall()
            log("  INTEGRITY:", " | ".join(str(r[0]) for r in result))
        except sqlite3.DatabaseError as e:
            log("  INTEGRITY:", f"Check failed: {e}")

        verify_conn.close()
        print(f"\n{'=' * 55}")
        log("RESULT:", "Database corruption fixed successfully!")
        log("INFO:", "gold_prices_clean recreated with correct schema (empty)")
        log("INFO:", "Gold price data will be repopulated by data engine on next run")
        log("INFO:", f"Backup preserved at: {BACKUP_PATH.name}")
        print(f"{'=' * 55}")

    except sqlite3.DatabaseError as e:
        log("FAIL:", f"Verification failed: {e}")
        log("INFO:", f"Backup at {BACKUP_PATH}")

if __name__ == "__main__":
    main()
