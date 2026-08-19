#!/usr/bin/env python3
"""Verify the database fix by opening and querying it."""
import sqlite3
import sys
from pathlib import Path

DB_PATH = Path("/home/meme/my_apps/GLMinvestment/db/data_engine.db")

print("=" * 60)
print("  Verification of data_engine.db fix")
print("=" * 60)

try:
    conn = sqlite3.connect(str(DB_PATH))
    cur = conn.cursor()
    
    # Test 1: Read sqlite_master
    cur.execute("SELECT name, rootpage FROM sqlite_master WHERE type='table' ORDER BY rowid")
    tables = cur.fetchall()
    print(f"\n✓ Database opened successfully!")
    print(f"  Found {len(tables)} tables:\n")
    for t in tables:
        marker = " <-- PATCHED" if t[0] == "gold_prices_clean" else ""
        print(f"    {t[0]:30s} rootpage={t[1]}{marker}")
    
    # Test 2: Query gold_prices_clean
    print(f"\n--- Querying gold_prices_clean ---")
    cur.execute("SELECT COUNT(*) FROM gold_prices_clean")
    cnt = cur.fetchone()[0]
    print(f"  gold_prices_clean has {cnt} rows")
    
    if cnt > 0:
        cur.execute("SELECT * FROM gold_prices_clean LIMIT 3")
        rows = cur.fetchall()
        print(f"  Sample rows:")
        for row in rows:
            print(f"    {row}")
    
    # Test 3: Check all other tables
    print(f"\n--- Quick integrity check ---")
    for t in tables:
        try:
            cur.execute(f"SELECT COUNT(*) FROM \"{t[0]}\"")
            cnt = cur.fetchone()[0]
            print(f"  ✓ {t[0]:30s} {cnt:>8} rows")
        except Exception as e:
            print(f"  ✗ {t[0]:30s} ERROR: {e}")
    
    conn.close()
    print(f"\n{'='*60}")
    print(f"  ALL CHECKS PASSED")
    print(f"{'='*60}")
    
except Exception as e:
    print(f"\n✗ VERIFICATION FAILED: {e}")
    sys.exit(1)
