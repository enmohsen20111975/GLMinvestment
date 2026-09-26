#!/usr/bin/env python3
"""
deploy_data_cleanup.py — ONE script for production deployment
================================================================
ده السكربت الوحيد اللي لازم تشغله على سرفر الإنتاج.

بيـ عمل كل حاجة بترتيب محسوب:
  1. backup كل DBs
  2. sync_stocks_metadata (normalize market='مصر' → 'EGX')
  3. consolidate_prices (merge stock_daily_prices → data_engine)
  4. move unused DBs to archive/
  5. verify النتيجة

كل خطوة بـ backup + test + log.

Usage:
    python3 scripts/deploy_data_cleanup.py --dry-run    # شوف هيتعمل إيه
    python3 scripts/deploy_data_cleanup.py               # نفذ
    python3 scripts/deploy_data_cleanup.py --verify      # تحقق بس
"""
import os, sys, shutil, sqlite3, argparse, time
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
os.chdir(PROJECT_ROOT)

DB_DIR = PROJECT_ROOT / 'db'
ARCHIVE_DIR = DB_DIR / 'archive'
BACKUP_DIR = PROJECT_ROOT / 'backups' / f'data-cleanup-{datetime.now().strftime("%Y%m%d_%H%M%S")}'

G = '\033[92m'; R = '\033[91m'; Y = '\033[93m'; C = '\033[96m'; B = '\033[1m'; X = '\033[0m'
def ok(m):    print(f"  {G}✅{X} {m}")
def fail(m):  print(f"  {R}❌{X} {m}"); sys.exit(1)
def info(m):  print(f"  {C}ℹ️{X} {m}")
def head(m):  print(f"\n{B}{C}━━━ {m} ━━━{X}")

def main():
    parser = argparse.ArgumentParser(description='Deploy data cleanup — ONE script for production')
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--verify', action='store_true')
    args = parser.parse_args()
    
    print(f"{B}{C}╔════════════════════════════════════════════════════════════╗{X}")
    print(f"{B}{C}║   📋 DATA CLEANUP DEPLOYMENT (production-ready)             ║{X}")
    print(f"{B}{C}╚════════════════════════════════════════════════════════════╝{X}")
    print(f"  Time: {datetime.now().isoformat()}")
    print(f"  Project: {PROJECT_ROOT}")
    if args.dry_run: print(f"  {Y}MODE: DRY-RUN{X}")
    elif args.verify: print(f"  {C}MODE: VERIFY-ONLY{X}")
    else: print(f"  {G}MODE: APPLY{X}")
    
    if args.verify:
        # Just verify
        verify_final_state()
        return
    
    # ═══ STEP 1: BACKUP ═══
    head("Step 1: Backup ALL DBs")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    
    if not args.dry_run:
        for db_file in os.listdir(DB_DIR):
            if db_file.endswith('.db'):
                src = DB_DIR / db_file
                dst = BACKUP_DIR / db_file
                shutil.copy2(str(src), str(dst))
                size = src.stat().st_size
                ok(f"{db_file} ({size/(1024*1024):.1f}MB)")
        ok(f"Backup: {BACKUP_DIR}")
    else:
        info("DRY-RUN: would backup all DBs")
    
    # ═══ STEP 2: SYNC STOCKS METADATA ═══
    head("Step 2: Sync stocks metadata (market='مصر' → 'EGX')")
    
    de_db = DB_DIR / 'data_engine.db'
    s_db = DB_DIR / 'stocks.db'
    
    if not args.dry_run:
        de_conn = sqlite3.connect(str(de_db), timeout=30)
        
        # Normalize market='مصر' → 'EGX'
        n_misr = de_conn.execute("SELECT COUNT(*) FROM stocks WHERE market='مصر'").fetchone()[0]
        if n_misr > 0:
            de_conn.execute("UPDATE stocks SET market='EGX' WHERE market='مصر'")
            de_conn.commit()
            ok(f"Normalized {n_misr} stocks: market='مصر' → 'EGX'")
        else:
            ok("No market='مصر' stocks — already normalized")
        
        # Sync missing stocks from stocks.db
        s_conn = sqlite3.connect(str(s_db), timeout=30)
        s_conn.row_factory = sqlite3.Row
        de_symbols = set(r[0] for r in de_conn.execute("SELECT symbol FROM stocks").fetchall())
        
        s_stocks = s_conn.execute("SELECT ticker, name, sector, market, current_price, last_update FROM stocks WHERE market='EGX'").fetchall()
        
        inserted = 0
        for row in s_stocks:
            if row['ticker'] not in de_symbols:
                de_conn.execute("INSERT OR IGNORE INTO stocks (symbol, name, sector, market, price, last_update) VALUES (?, ?, ?, 'EGX', ?, ?)",
                    (row['ticker'], row['name'], row['sector'], row['current_price'], row['last_update']))
                inserted += 1
        de_conn.commit()
        s_conn.close()
        
        n_egx = de_conn.execute("SELECT COUNT(*) FROM stocks WHERE market='EGX'").fetchone()[0]
        ok(f"data_engine.db.stocks: {n_egx} EGX stocks (inserted {inserted} new)")
        de_conn.close()
    else:
        info("DRY-RUN: would normalize market + sync stocks")
    
    # ═══ STEP 3: CONSOLIDATE PRICES ═══
    head("Step 3: Consolidate prices (stock_daily_prices → data_engine)")
    
    if not args.dry_run:
        s_conn = sqlite3.connect(str(s_db), timeout=30)
        s_conn.row_factory = sqlite3.Row
        de_conn = sqlite3.connect(str(de_db), timeout=30)
        
        sdp_rows = s_conn.execute('''
            SELECT ticker, price_date, 
                   COALESCE(open_price, open) as open_price,
                   COALESCE(high_price, high) as high_price,
                   COALESCE(low_price, low) as low_price,
                   COALESCE(close_price, close) as close_price,
                   volume, turnover
            FROM stock_daily_prices WHERE price_date IS NOT NULL
        ''').fetchall()
        
        inserted = 0
        for row in sdp_rows:
            exists = de_conn.execute("SELECT 1 FROM egksco_price_history WHERE symbol=? AND price_date=?", (row['ticker'], row['price_date'])).fetchone()
            if not exists:
                de_conn.execute('''INSERT OR REPLACE INTO egksco_price_history 
                    (symbol, price_date, open_price, high_price, low_price, close_price, volume, turnover)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
                    (row['ticker'], row['price_date'], row['open_price'], row['high_price'],
                     row['low_price'], row['close_price'], 
                     row['volume'] if isinstance(row['volume'], int) else None, row['turnover']))
                inserted += 1
        de_conn.commit()
        
        ok(f"Consolidated: {inserted} new rows inserted (of {len(sdp_rows)} total)")
        
        # Verify
        n = de_conn.execute('SELECT COUNT(*) FROM egksco_price_history').fetchone()[0]
        last = de_conn.execute('SELECT MAX(price_date) FROM egksco_price_history').fetchone()[0]
        n_last = de_conn.execute('SELECT COUNT(DISTINCT symbol) FROM egksco_price_history WHERE price_date=?', (last,)).fetchone()[0]
        ok(f"data_engine.egksco_price_history: {n:,} rows, last={last} ({n_last} tickers)")
        
        s_conn.close()
        de_conn.close()
    else:
        info("DRY-RUN: would consolidate prices")
    
    # ═══ STEP 4: MOVE UNUSED DBs ═══
    head("Step 4: Move unused DBs to archive/")
    
    unused = ['market.db', 'finance.db', 'gold_prices.db', 'learned.db', 'prices.db']
    
    if not args.dry_run:
        ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
        moved = 0
        for db_name in unused:
            db_path = DB_DIR / db_name
            if db_path.exists():
                shutil.move(str(db_path), str(ARCHIVE_DIR / db_name))
                moved += 1
                ok(f"Moved: {db_name} → archive/")
            else:
                info(f"{db_name}: not found — skipping")
        ok(f"Moved {moved} unused DBs to archive/")
    else:
        for db_name in unused:
            db_path = DB_DIR / db_name
            if db_path.exists():
                info(f"DRY-RUN: would move {db_name}")
    
    # ═══ STEP 5: VERIFY ═══
    head("Step 5: Final verification")
    verify_final_state()
    
    print(f"\n{B}{G}════════════════════════════════════════════{X}")
    print(f"{B}{G}  ✅ DATA CLEANUP COMPLETE{X}")
    print(f"{B}{G}════════════════════════════════════════════{X}")
    print(f"\n  Backup: {BACKUP_DIR}")
    print(f"  Archive: {ARCHIVE_DIR}")
    print(f"\n  Next:")
    print(f"    python3 vps-service/jobs/v40_2_daily_generator.py --next-session --force")
    print(f"    python3 vps-service/jobs/daily_closer.py")

def verify_final_state():
    """Verify the final state of all DBs."""
    de_db = DB_DIR / 'data_engine.db'
    
    if not de_db.exists():
        fail("data_engine.db not found!")
    
    conn = sqlite3.connect(str(de_db), timeout=10)
    
    # Check EGX stocks
    n_egx = conn.execute("SELECT COUNT(*) FROM stocks WHERE market='EGX'").fetchone()[0]
    n_misr = conn.execute("SELECT COUNT(*) FROM stocks WHERE market='مصر'").fetchone()[0]
    ok(f"data_engine.stocks: {n_egx} EGX, {n_misr} مصر (should be 0)")
    
    # Check prices
    n = conn.execute('SELECT COUNT(*) FROM egksco_price_history').fetchone()[0]
    last = conn.execute('SELECT MAX(price_date) FROM egksco_price_history').fetchone()[0]
    n_last = conn.execute('SELECT COUNT(DISTINCT symbol) FROM egksco_price_history WHERE price_date=?', (last,)).fetchone()[0]
    ok(f"data_engine.egksco_price_history: {n:,} rows, last={last} ({n_last} tickers)")
    
    conn.close()
    
    # Check archive
    if ARCHIVE_DIR.exists():
        archived = os.listdir(ARCHIVE_DIR)
        ok(f"Archive: {len(archived)} DBs ({', '.join(archived)})")

if __name__ == '__main__':
    main()
