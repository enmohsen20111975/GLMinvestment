#!/usr/bin/env python3
"""Check data_engine.db for corruption and WAL issues."""
import sqlite3
import os
from pathlib import Path

DB_DIR = Path("/home/meme/my_apps/GLMinvestment/db")
DB_PATH = DB_DIR / "data_engine.db"

print("=" * 60)
print("  data_engine.db Corruption Diagnosis")
print("=" * 60)

# 1. Check WAL/SHM files
print("\n1. Database files:")
for f in sorted(DB_DIR.glob("data_engine.db*")):
    size = f.stat().st_size
    print(f"   {f.name}: {size:,} bytes")

# 2. Open normally  
print("\n2. Normal open (Python sqlite3):")
try:
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    cur = conn.cursor()
    
    cur.execute("PRAGMA integrity_check")
    integrity = cur.fetchall()
    print(f"   Integrity check: {integrity}")
    
    cur.execute("SELECT name, rootpage FROM sqlite_master WHERE type='table' ORDER BY name")
    tables = cur.fetchall()
    print(f"\n   Tables ({len(tables)}):")
    for name, rootpage in tables:
        print(f"     {name}: rootpage={rootpage}")
    
    # Check gold_prices_clean specifically
    cur.execute("PRAGMA table_info(gold_prices_clean)")
    cols = cur.fetchall()
    print(f"\n   gold_prices_clean columns ({len(cols)}):")
    for c in cols:
        print(f"     {c[1]} ({c[2]})")
    
    cur.execute("SELECT COUNT(*) FROM gold_prices_clean")
    count = cur.fetchone()[0]
    print(f"\n   gold_prices_clean rows: {count}")
    
    conn.close()
    print("\n3. Result: Python opens fine - corruption is better-sqlite3 specific")

except Exception as e:
    print(f"\n   ERROR: {e}")
    print("\n3. Result: Python also fails - database is truly corrupted")

# 3. Check if WAL mode is causing issues
print("\n4. WAL checkpoint test:")
try:
    conn2 = sqlite3.connect(str(DB_PATH))
    cur2 = conn2.cursor()
    cur2.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    result = cur2.fetchone()
    print(f"   WAL checkpoint: {result}")
    conn2.close()
except Exception as e:
    print(f"   WAL checkpoint failed: {e}")

print("\n" + "=" * 60)
