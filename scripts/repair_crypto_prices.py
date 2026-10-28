#!/usr/bin/env python3
"""
repair_crypto_prices.py — Recover crypto_prices from corrupt data_engine.db
=========================================================================
الـ data_engine.db فيه corruption في جداول crypto_prices و gold_prices
(B-tree pages معطوبة). السكريبت ده بيستخرج البيانات السليمة ويعمل DB جديد نظيف.

Usage:
    python3 scripts/repair_crypto_prices.py

Output:
    db/data_engine_recovered.db — نسخة نظيفة فيها كل الجداول السليمة
                                  + crypto_prices و gold_prices المسترجعة

خطوات:
    1. يعمل backup للـ DB القديم (data_engine.db.bak)
    2. يقرأ كل الجداول السليمة وينسخها
    3. يستخرج crypto_prices و gold_prices row-by-row (skip corrupt pages)
    4. يحفظ DB جديد نظيف
    5. يطبعلك تقرير باللي اتصنع
"""
import sqlite3
import os
import shutil
from datetime import datetime

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DB = os.path.join(PROJECT_ROOT, 'db', 'data_engine.db')
BAK_DB = os.path.join(PROJECT_ROOT, 'db', 'data_engine.db.bak')
OUT_DB = os.path.join(PROJECT_ROOT, 'db', 'data_engine_recovered.db')
DRAFT_DB = os.path.join(PROJECT_ROOT, 'db', 'data_engine_draft.db')

# Tables to recover row-by-row (the corrupted ones)
CORRUPT_TABLES = ['crypto_prices', 'gold_prices']

def get_all_tables(c):
    return [t[0] for t in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
    ).fetchall()]

def get_schema(c, table):
    return c.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
    ).fetchone()[0]

def safe_count(c, table):
    """Count rows in chunks, skipping corrupt pages."""
    total = 0
    errors = 0
    last_id = 0
    # Find the id column
    cols = [d[1] for d in c.execute(f'PRAGMA table_info("{table}")').fetchall()]
    id_col = 'id' if 'id' in cols else cols[0] if cols else None
    if not id_col:
        return 0, 0
    while True:
        try:
            rows = c.execute(
                f'SELECT {id_col} FROM "{table}" WHERE {id_col} > ? ORDER BY {id_col} LIMIT 500'
            ).fetchall()
            if not rows:
                break
            total += len(rows)
            last_id = rows[-1][0]
        except Exception:
            errors += 1
            last_id += 500
            if errors > 50:
                break
    return total, errors

def recover_table(src_c, dst_c, table):
    """Copy a healthy table verbatim."""
    schema = get_schema(src_c, table)
    dst_c.execute(f'DROP TABLE IF EXISTS "{table}"')
    dst_c.execute(schema)
    cols = [d[1] for d in src_c.execute(f'PRAGMA table_info("{table}")').fetchall()]
    col_list = ', '.join(f'"{c}"' for c in cols)
    placeholders = ', '.join('?' for _ in cols)
    inserted = 0
    errors = 0
    last_id = -1
    id_col = 'id' if 'id' in cols else cols[0]
    while True:
        try:
            rows = src_c.execute(
                f'SELECT {col_list} FROM "{table}" WHERE "{id_col}" > ? ORDER BY "{id_col}" LIMIT 500',
                (last_id,)
            ).fetchall()
            if not rows:
                break
            dst_c.executemany(
                f'INSERT INTO "{table}" ({col_list}) VALUES ({placeholders})', rows
            )
            inserted += len(rows)
            last_id = rows[-1][cols.index(id_col)]
        except Exception as e:
            errors += 1
            last_id += 500
            if errors > 100:
                print(f'  ⚠️  {table}: stopped after {errors} page errors ({inserted} recovered)')
                break
    return inserted, errors

def main():
    print(f'=== data_engine.db repair ===')
    print(f'Source: {SRC_DB} ({os.path.getsize(SRC_DB)/(1024*1024):.1f} MB)')
    print()
    if not os.path.exists(SRC_DB):
        print('❌ data_engine.db not found')
        return 1
    # Backup
    if not os.path.exists(BAK_DB):
        print(f'1. Backup → {BAK_DB}')
        shutil.copy2(SRC_DB, BAK_DB)
        print(f'   ✓ ({os.path.getsize(BAK_DB)/(1024*1024):.1f} MB)')
    else:
        print(f'1. Backup exists already: {BAK_DB}')
    print()
    # Open source (read-only)
    src = sqlite3.connect(f'file:{SRC_DB}?mode=ro', uri=True)
    # Create fresh output
    if os.path.exists(OUT_DB):
        os.remove(OUT_DB)
    dst = sqlite3.connect(OUT_DB)
    # Get all tables
    tables = get_all_tables(src)
    print(f'2. Found {len(tables)} tables')
    print()
    healthy = [t for t in tables if t not in CORRUPT_TABLES]
    print(f'3. Copying {len(healthy)} healthy tables...')
    for t in healthy:
        try:
            schema = get_schema(src, t)
            dst.execute(f'DROP TABLE IF EXISTS "{t}"')
            dst.execute(schema)
            cols = [d[1] for d in src.execute(f'PRAGMA table_info("{t}")').fetchall()]
            col_list = ', '.join(f'"{c}"' for c in cols)
            placeholders = ', '.join('?' for _ in cols)
            rows = src.execute(f'SELECT {col_list} FROM "{t}"').fetchall()
            dst.executemany(
                f'INSERT INTO "{t}" ({col_list}) VALUES ({placeholders})', rows
            )
            print(f'   ✓ {t}: {len(rows)} rows')
        except Exception as e:
            print(f'   ✗ {t}: {str(e)[:80]}')
    print()
    print(f'4. Recovering {len(CORRUPT_TABLES)} corrupted tables (row-by-row)...')
    for t in CORRUPT_TABLES:
        try:
            inserted, errors = recover_table(src, dst, t)
            print(f'   ✓ {t}: recovered {inserted} rows ({errors} page errors skipped)')
        except Exception as e:
            print(f'   ✗ {t}: {str(e)[:80]}')
    print()
    # Copy indexes
    print('5. Copying indexes...')
    idxs = src.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL"
    ).fetchall()
    for (sql,) in idxs:
        try:
            dst.execute(sql)
        except Exception:
            pass
    dst.commit()
    dst.close()
    src.close()
    print()
    print(f'=== DONE ===')
    print(f'Recovered DB: {OUT_DB} ({os.path.getsize(OUT_DB)/(1024*1024):.1f} MB)')
    print()
    print('Next steps:')
    print(f'  1. Stop your app (pm2 stop ...)')
    print(f'  2. Replace:  mv {OUT_DB} {SRC_DB}')
    print(f'  3. Restart:  pm2 restart ...')
    print(f'  4. Verify:   curl http://localhost:3000/api/crypto?limit=5')
    return 0

if __name__ == '__main__':
    exit(main())
