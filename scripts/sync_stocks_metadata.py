#!/usr/bin/env python3
"""
sync_stocks_metadata.py — Sync EGX stocks from stocks.db → data_engine.db
=========================================================================
مشكلة: data_engine.db.stocks فيها 83 سهم بس بـ market='EGX' 
و 293 سهم بـ market='مصر'. النظام بـ يـ search بـ 'EGX' بس.

stocks.db.stocks فيها 452 سهم بـ market='EGX'.

السكربت ده:
1. بـ يـ normalize market='مصر' → 'EGX' في data_engine.db
2. بـ يـ sync الأسهم الناقصة من stocks.db → data_engine.db
3. بـ يـ verify النتيجة

Usage:
    python3 scripts/sync_stocks_metadata.py --dry-run
    python3 scripts/sync_stocks_metadata.py
"""
import os, sys, sqlite3, argparse
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
os.chdir(PROJECT_ROOT)

STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
DATA_ENGINE_DB = PROJECT_ROOT / 'db' / 'data_engine.db'

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    
    print("╔════════════════════════════════════════════════════════════╗")
    print("║   📋 SYNC STOCKS METADATA → data_engine.db                ║")
    print("╚════════════════════════════════════════════════════════════╝")
    
    s_conn = sqlite3.connect(str(STOCKS_DB), timeout=30)
    s_conn.row_factory = sqlite3.Row
    de_conn = sqlite3.connect(str(DATA_ENGINE_DB), timeout=30)
    
    # Step 1: Normalize market='مصر' → 'EGX' in data_engine.db
    print("\n━━━ Step 1: Normalize market='مصر' → 'EGX' ━━━")
    n_misr = de_conn.execute("SELECT COUNT(*) FROM stocks WHERE market='مصر'").fetchone()[0]
    print(f"  Stocks with market='مصر': {n_misr}")
    
    if not args.dry_run and n_misr > 0:
        de_conn.execute("UPDATE stocks SET market='EGX' WHERE market='مصر'")
        de_conn.commit()
        print(f"  ✅ Normalized {n_misr} stocks: market='مصر' → 'EGX'")
    elif args.dry_run:
        print(f"  DRY-RUN: would normalize {n_misr} stocks")
    
    # Step 2: Sync missing stocks from stocks.db → data_engine.db
    print("\n━━━ Step 2: Sync missing stocks from stocks.db ━━━")
    
    # Get EGX stocks from stocks.db
    s_stocks = s_conn.execute("""
        SELECT ticker, name, sector, market, current_price, last_update
        FROM stocks WHERE market='EGX'
    """).fetchall()
    
    # Get existing symbols in data_engine.db
    de_symbols = set(r[0] for r in de_conn.execute("SELECT symbol FROM stocks").fetchall())
    
    inserted = 0
    updated = 0
    for row in s_stocks:
        if row['ticker'] not in de_symbols:
            # INSERT missing stock
            if not args.dry_run:
                de_conn.execute("""
                    INSERT OR IGNORE INTO stocks (symbol, name, sector, market, price, last_update)
                    VALUES (?, ?, ?, 'EGX', ?, ?)
                """, (row['ticker'], row['name'], row['sector'], 
                      row['current_price'], row['last_update']))
            inserted += 1
        else:
            # UPDATE existing stock's market to 'EGX' if it's not
            if not args.dry_run:
                de_conn.execute("""
                    UPDATE stocks SET market='EGX' 
                    WHERE symbol=? AND market != 'EGX'
                """, (row['ticker'],))
            updated += 1
    
    if not args.dry_run:
        de_conn.commit()
    
    print(f"  Inserted: {inserted} new stocks")
    print(f"  Updated: {updated} existing stocks")
    
    # Step 3: Verify
    print("\n━━━ Step 3: Verify ━━━")
    n_egx = de_conn.execute("SELECT COUNT(*) FROM stocks WHERE market='EGX'").fetchone()[0]
    n_misr = de_conn.execute("SELECT COUNT(*) FROM stocks WHERE market='مصر'").fetchone()[0]
    n_total = de_conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
    
    print(f"  data_engine.db.stocks:")
    print(f"    market='EGX': {n_egx}")
    print(f"    market='مصر': {n_misr} (should be 0)")
    print(f"    Total: {n_total}")
    
    if n_egx > 300:
        print(f"  ✅ Enough EGX stocks for V40.2 generator!")
    else:
        print(f"  ⚠️  Still < 300 EGX stocks")
    
    s_conn.close()
    de_conn.close()
    
    print("\n✅ SYNC COMPLETE")

if __name__ == '__main__':
    main()
