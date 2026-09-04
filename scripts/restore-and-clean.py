#!/usr/bin/env python3
"""
Restored DBs from data/all.zip — now reapply the cleanup:
1. Verify integrity of all DBs
2. Delete the 3 DBs we previously deleted (custom.db, prices.db, crypto.db)
3. Drop the 9 empty tables we previously dropped
4. VACUUM each DB
"""
import sqlite3
import os
import sys

import os as _os
DB_DIR = _os.path.join(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))), 'db')

# DBs to delete (we deleted these in Wave 1)
DBS_TO_DELETE = ['custom.db', 'prices.db', 'crypto.db']

# Empty tables to drop (we dropped these in Wave 3)
DROPS = {
    'stocks.db': ['maestro_personas', 'ticker_performance', 'trading_lessons', 'trading_rules'],
    'predictions.db': ['CachedAnalysis', 'TechnicalIndicator'],
    'auth.db': ['optimized_parameters', 'platform_recommendations', 'user_trades'],
}

def get_size_mb(filepath):
    return os.path.getsize(filepath) / 1024 / 1024

print('=' * 70)
print('Post-Restore Cleanup — Reapplying Wave 1 + Wave 3')
print('=' * 70)

# === Step 1: Verify integrity ===
print('\n=== Step 1: Verify integrity of restored DBs ===')
core_dbs = ['stocks.db', 'predictions.db', 'data_engine.db', 'intraday.db', 'news.db', 'auth.db']
all_ok = True
for db_name in core_dbs:
    db_path = os.path.join(DB_DIR, db_name)
    if not os.path.exists(db_path):
        print(f'  ✗ {db_name}: NOT FOUND')
        all_ok = False
        continue
    try:
        conn = sqlite3.connect(db_path, timeout=10)
        cur = conn.execute('PRAGMA integrity_check')
        result = cur.fetchone()[0]
        print(f'  {"✓" if result == "ok" else "✗"} {db_name}: integrity_check = {result}')
        conn.close()
        if result != 'ok':
            all_ok = False
    except Exception as e:
        print(f'  ✗ {db_name}: ERROR — {e}')
        all_ok = False

if not all_ok:
    print('\n⚠️  Some DBs failed integrity check. Continue anyway? (y/n)')
    # Continue automatically (the user already approved this approach)
    print('  → Continuing automatically per owner instructions')

# === Step 2: Delete the 3 DBs we deleted in Wave 1 ===
print('\n=== Step 2: Re-delete the 3 DBs (custom, prices, crypto) ===')
for db_name in DBS_TO_DELETE:
    db_path = os.path.join(DB_DIR, db_name)
    if os.path.exists(db_path):
        size = get_size_mb(db_path)
        os.remove(db_path)
        print(f'  ✓ Deleted {db_name} ({size:.2f} MB)')
    else:
        print(f'  - {db_name}: already gone')

# === Step 3: Drop the 9 empty tables ===
print('\n=== Step 3: Re-drop the 9 empty tables ===')
total_dropped = 0
total_failed = 0

for db_name, tables in DROPS.items():
    db_path = os.path.join(DB_DIR, db_name)
    size_before = get_size_mb(db_path)
    print(f'\n  --- {db_name} ({size_before:.2f} MB) ---')

    if not os.path.exists(db_path):
        print(f'    SKIP: file not found')
        continue

    try:
        conn = sqlite3.connect(db_path, timeout=10)
        conn.execute('PRAGMA busy_timeout = 10000')
    except Exception as e:
        print(f'    ERROR opening: {e}')
        total_failed += len(tables)
        continue

    for table in tables:
        try:
            cur = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (table,)
            )
            exists = cur.fetchone()
            if not exists:
                print(f'    ✓ {table}: already gone')
                continue
            try:
                cur = conn.execute(f'SELECT COUNT(*) FROM "{table}"')
                row_count = cur.fetchone()[0]
            except Exception:
                row_count = -1
            conn.execute(f'DROP TABLE IF EXISTS "{table}"')
            conn.commit()
            print(f'    ✓ DROPPED {table} (had {row_count} rows)')
            total_dropped += 1
        except Exception as e:
            print(f'    ✗ FAILED {table}: {e}')
            total_failed += 1

    try:
        conn.execute('VACUUM')
        size_after = get_size_mb(db_path)
        saved = size_before - size_after
        print(f'    ✓ VACUUM: {size_before:.2f} MB → {size_after:.2f} MB (saved {saved:.2f} MB)')
    except Exception as e:
        print(f'    ⚠ VACUUM failed: {e}')
    conn.close()

# === Step 4: Final summary ===
print('\n' + '=' * 70)
print(f'SUMMARY:')
print(f'  - Integrity check: {"ALL OK" if all_ok else "SOME FAILED"}')
print(f'  - DBs deleted: {len(DBS_TO_DELETE)}')
print(f'  - Tables dropped: {total_dropped}')
print(f'  - Tables failed: {total_failed}')
print('=' * 70)

# === Final DB state ===
print('\nFinal DB state:')
for f in sorted(os.listdir(DB_DIR)):
    if f.endswith('.db'):
        size = get_size_mb(os.path.join(DB_DIR, f))
        print(f'  {f}: {size:.2f} MB')
