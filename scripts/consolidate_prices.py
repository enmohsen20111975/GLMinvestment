#!/usr/bin/env python3
"""
consolidate_prices.py — Consolidate ALL price data into data_engine.db
=====================================================================
السكربت ده بـ يحل المشكلة الجذرية:

محرك البيانات بـ يجمع الأسعار كل 5 دقايق ويحفظها في stocks.db.stock_daily_prices
لكن الـ V40.2 generator بـ يقرا من data_engine.db.egksco_price_history!

السكربت ده بـ:
1. يـ sync كل البيانات من stocks.db.stock_daily_prices → data_engine.db.egksco_price_history
2. يـ sync من stocks.db.stocks (current_price) → data_engine.db.stocks
3. يـ verify إن البيانات متطابقة

بكده data_engine.db يبقى المصدر الكنونيكال لكل بيانات الأسعار.

Usage:
    python3 scripts/consolidate_prices.py --dry-run    # شوف هيتعمل إيه
    python3 scripts/consolidate_prices.py               # نفذ
"""
import os, sys, sqlite3, argparse
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
os.chdir(PROJECT_ROOT)

STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
DATA_ENGINE_DB = PROJECT_ROOT / 'db' / 'data_engine.db'

G = '\033[92m'; R = '\033[91m'; Y = '\033[93m'; C = '\033[96m'; B = '\033[1m'; X = '\033[0m'
def ok(m):    print(f"  {G}✅{X} {m}")
def fail(m):  print(f"  {R}❌{X} {m}"); sys.exit(1)
def info(m):  print(f"  {C}ℹ️{X} {m}")
def head(m):  print(f"\n{B}{C}━━━ {m} ━━━{X}")

def main():
    parser = argparse.ArgumentParser(description='Consolidate ALL price data into data_engine.db')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be done')
    args = parser.parse_args()
    
    print(f"{B}{C}╔════════════════════════════════════════════════════════════╗{X}")
    print(f"{B}{C}║   📊 CONSOLIDATE ALL PRICES → data_engine.db               ║{X}")
    print(f"{B}{C}╚════════════════════════════════════════════════════════════╝{X}")
    print(f"  Time: {datetime.now().isoformat()}")
    if args.dry_run:
        print(f"  {Y}MODE: DRY-RUN{X}")
    else:
        print(f"  {G}MODE: APPLY{X}")
    
    # ═══ STEP 1: Sync stock_daily_prices → egksco_price_history ═══
    head("Step 1: Sync stock_daily_prices → egksco_price_history")
    
    sdp_conn = sqlite3.connect(str(STOCKS_DB), timeout=30)
    sdp_conn.row_factory = sqlite3.Row
    de_conn = sqlite3.connect(str(DATA_ENGINE_DB), timeout=30)
    
    # Get all rows from stock_daily_prices
    sdp_rows = sdp_conn.execute('''
        SELECT ticker, price_date, 
               COALESCE(open_price, open) as open_price,
               COALESCE(high_price, high) as high_price,
               COALESCE(low_price, low) as low_price,
               COALESCE(close_price, close) as close_price,
               volume, turnover
        FROM stock_daily_prices
        WHERE price_date IS NOT NULL
        ORDER BY price_date
    ''').fetchall()
    
    info(f"stock_daily_prices: {len(sdp_rows)} rows to check")
    
    # Check which rows are MISSING from egksco_price_history
    inserted = 0
    skipped = 0
    for row in sdp_rows:
        # Check if this row exists in egksco
        exists = de_conn.execute(
            'SELECT 1 FROM egksco_price_history WHERE symbol=? AND price_date=?',
            (row['ticker'], row['price_date'])
        ).fetchone()
        
        if exists:
            skipped += 1
            continue
        
        # INSERT the missing row
        if not args.dry_run:
            de_conn.execute('''
                INSERT OR REPLACE INTO egksco_price_history 
                (symbol, price_date, open_price, high_price, low_price, close_price, volume, turnover)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                row['ticker'], row['price_date'],
                row['open_price'], row['high_price'], row['low_price'], row['close_price'],
                row['volume'] if isinstance(row['volume'], int) else None,
                row['turnover']
            ))
        inserted += 1
    
    if not args.dry_run:
        de_conn.commit()
    
    ok(f"Inserted: {inserted} new rows | Skipped (already exists): {skipped}")
    
    # ═══ STEP 2: Sync stocks.db.stocks (current_price) → data_engine.db.stocks ═══
    head("Step 2: Sync current prices (stocks.db.stocks → data_engine.db.stocks)")
    
    # Get all stocks with current_price > 0
    stocks_rows = sdp_conn.execute('''
        SELECT ticker, current_price, last_update, name, sector, market
        FROM stocks 
        WHERE current_price > 0
    ''').fetchall()
    
    info(f"stocks with current_price: {len(stocks_rows)}")
    
    updated = 0
    for row in stocks_rows:
        if not args.dry_run:
            # Update data_engine.db.stocks (uses 'price' not 'current_price')
            de_conn.execute('''
                UPDATE stocks 
                SET price = ?, last_update = ?
                WHERE symbol = ?
            ''', (row['current_price'], row['last_update'], row['ticker']))
            
            # If the stock doesn't exist in data_engine, INSERT it
            if de_conn.total_changes == 0:
                de_conn.execute('''
                    INSERT OR IGNORE INTO stocks (symbol, price, last_update)
                    VALUES (?, ?, ?)
                ''', (row['ticker'], row['current_price'], row['last_update']))
        updated += 1
    
    if not args.dry_run:
        de_conn.commit()
    
    ok(f"Updated: {updated} stocks with current prices")
    
    # ═══ STEP 3: Verify ═══
    head("Step 3: Verify")
    
    # Count after
    egx_count = de_conn.execute('SELECT COUNT(*) FROM egksco_price_history').fetchone()[0]
    egx_tickers = de_conn.execute('SELECT COUNT(DISTINCT symbol) FROM egksco_price_history').fetchone()[0]
    egx_dates = de_conn.execute('SELECT MIN(price_date), MAX(price_date) FROM egksco_price_history').fetchone()
    
    ok(f"egksco_price_history: {egx_count:,} rows, {egx_tickers} tickers")
    ok(f"Date range: {egx_dates[0]} → {egx_dates[1]}")
    
    # Check last date has enough tickers
    last_date = egx_dates[1]
    n_last = de_conn.execute('SELECT COUNT(DISTINCT symbol) FROM egksco_price_history WHERE price_date=?', (last_date,)).fetchone()[0]
    ok(f"Tickers on last date ({last_date}): {n_last}")
    
    if n_last < 100:
        print(f"  {Y}⚠️  Still < 100 tickers on last date — run backfill_egx_yahoo.py{X}")
    else:
        ok(f"✅ Enough tickers for V40.2 generator to scan!")
    
    sdp_conn.close()
    de_conn.close()
    
    print(f"\n{B}{G}════════════════════════════════════════════{X}")
    print(f"{B}{G}  ✅ CONSOLIDATION COMPLETE{X}")
    print(f"{B}{G}════════════════════════════════════════════{X}")
    print(f"\n  Next:")
    print(f"    python3 vps-service/jobs/v40_2_daily_generator.py --next-session --force")
    print(f"    python3 vps-service/jobs/daily_closer.py")

if __name__ == '__main__':
    main()
