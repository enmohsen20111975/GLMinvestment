#!/usr/bin/env python3
"""
Drop 9 safe tables (0 rows + 0 code references) from stocks.db, predictions.db, auth.db
Then VACUUM each DB to reclaim space.
"""
import sqlite3
import os
import sys

DB_DIR = '/home/z/my-project/db'

DROPS = {
    'stocks.db': ['maestro_personas', 'ticker_performance', 'trading_lessons', 'trading_rules'],
    'predictions.db': ['CachedAnalysis', 'TechnicalIndicator'],
    'auth.db': ['optimized_parameters', 'platform_recommendations', 'user_trades'],
}

def get_size_mb(filepath):
    return os.path.getsize(filepath) / 1024 / 1024

print('=' * 70)
print('Drop Safe Empty Tables — Wave 3b')
print('=' * 70)

total_dropped = 0
total_failed = 0
total_skipped = 0

for db_name, tables in DROPS.items():
    db_path = os.path.join(DB_DIR, db_name)
    size_before = get_size_mb(db_path)

    print(f'\n=== {db_name} ({size_before:.2f} MB) ===')

    if not os.path.exists(db_path):
        print(f'  SKIP: file not found')
        continue

    try:
        conn = sqlite3.connect(db_path, timeout=10)
        conn.execute('PRAGMA busy_timeout = 10000')
    except Exception as e:
        print(f'  ERROR opening: {e}')
        total_failed += len(tables)
        continue

    for table in tables:
        try:
            # Check if table exists
            cur = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (table,)
            )
            exists = cur.fetchone()

            if not exists:
                print(f'  \u2713 {table}: already gone (skip)')
                total_skipped += 1
                continue

            # Check row count
            try:
                cur = conn.execute(f'SELECT COUNT(*) FROM "{table}"')
                row_count = cur.fetchone()[0]
            except Exception:
                row_count = -1

            # DROP
            conn.execute(f'DROP TABLE IF EXISTS "{table}"')
            conn.commit()
            print(f'  \u2713 DROPPED {table} (had {row_count} rows)')
            total_dropped += 1
        except Exception as e:
            print(f'  \u2717 FAILED {table}: {e}')
            total_failed += 1

    # VACUUM to reclaim space
    try:
        print(f'  VACUUM {db_name}...')
        conn.execute('VACUUM')
        size_after = get_size_mb(db_path)
        saved = size_before - size_after
        print(f'  \u2713 VACUUM done. Size: {size_before:.2f} MB \u2192 {size_after:.2f} MB (saved {saved:.2f} MB)')
    except Exception as e:
        print(f'  \u26a0 VACUUM failed: {e}')

    conn.close()

print('\n' + '=' * 70)
print(f'SUMMARY: dropped {total_dropped}, skipped {total_skipped}, failed {total_failed}')
print('=' * 70)
