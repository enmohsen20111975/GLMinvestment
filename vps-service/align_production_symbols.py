#!/usr/bin/env python3
"""
🛠️ Ticker & Symbol Alignment Script for Production Server
======================================================
This script fixes incorrect stock names and symbols by aligning all databases 
with the source of truth 'db/data_engine.db'. It handles renames, merges data, 
resolves unique constraint conflicts, and updates metadata.
"""

import sqlite3
import shutil
import os
import sys
from pathlib import Path

# Resolve project directories
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent

# Set database directory
DB_DIR = PROJECT_ROOT / "db"
if not DB_DIR.exists():
    # Try current directory if script directory didn't work
    DB_DIR = Path("db")
    if not DB_DIR.exists():
        print("❌ Error: 'db' directory not found!")
        sys.exit(1)

print(f"📂 Project Root: {PROJECT_ROOT}")
print(f"📂 Database Directory: {DB_DIR.resolve()}")

DBS = ["stocks.db", "predictions.db", "price_history.db", "historical.db"]

# Migration mapping for mismatched/old symbols
MAPPING = {
    'EKHO': 'VLMR',       # Egypt Kuwait Holding -> VLMR
    'MNHD': 'MASR',       # Madinet Nasr Housing -> MASR
    'FAITA': 'FAIT',      # Faisal Bank
    'SEIGA': 'SEIG',      # Saudi Egyptian
    'ICMI': 'FCMD',       # International Co.
    'ANFI': 'TYCN',       # Alexandria National
    'NULL': 'FTNS',       # Fitness Prime
    'QNBA': 'QNBE',       # Qatar National Bank
    'AUTO': 'GBCO',       # GB Corp
    'RMTV': 'RRMTV'       # Rowad Misr
}

def backup_dbs():
    print("\n=== 1. Backing Up Databases ===")
    backup_dir = DB_DIR / "backups"
    backup_dir.mkdir(exist_ok=True)
    
    for db in DBS:
        db_path = DB_DIR / db
        if db_path.exists():
            backup_path = backup_dir / f"{db}.backup_before_align"
            shutil.copy2(db_path, backup_path)
            print(f"   ✅ Backed up {db} to backups/{db}.backup_before_align")
        else:
            print(f"   ℹ️ {db} does not exist, skipping backup.")

def migrate_tickers():
    print("\n=== 2. Migrating Ticker References & Merging Data ===")
    for db_name in DBS:
        db_path = DB_DIR / db_name
        if not db_path.exists():
            continue
        
        print(f"\nProcessing database: {db_name}")
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Get all tables in this database
        tables = cursor.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        table_names = [t[0] for t in tables]
        
        for tname in table_names:
            if tname == 'sqlite_sequence':
                continue
                
            cols = [c[1] for c in cursor.execute(f"PRAGMA table_info({tname})").fetchall()]
            
            # Find column storing ticker/symbol
            col_to_use = None
            for c in ['ticker', 'symbol', 'stock_symbol']:
                if c in cols:
                    col_to_use = c
                    break
                    
            if not col_to_use:
                continue
                
            # Perform mapping updates
            for old, new in MAPPING.items():
                count_old = cursor.execute(f"SELECT COUNT(*) FROM {tname} WHERE {col_to_use}=?", (old,)).fetchone()[0]
                if count_old == 0:
                    continue
                    
                # Check if the table has unique/primary constraints that could cause conflicts when updating old -> new
                # Get indexes for this table
                indexes = cursor.execute(f"PRAGMA index_list({tname})").fetchall()
                is_unique_on_ticker = False
                for idx in indexes:
                    idx_name = idx[1]
                    idx_unique = idx[2]
                    if idx_unique:
                        idx_info = cursor.execute(f"PRAGMA index_info({idx_name})").fetchall()
                        idx_cols = [x[2] for x in idx_info]
                        if len(idx_cols) == 1 and idx_cols[0] == col_to_use:
                            is_unique_on_ticker = True
                            break
                
                # Check if there is a primary key constraint on col_to_use
                pk_cols = [c[1] for c in cursor.execute(f"PRAGMA table_info({tname})").fetchall() if c[5] > 0]
                if len(pk_cols) == 1 and pk_cols[0] == col_to_use:
                    is_unique_on_ticker = True

                print(f"   Table: {tname:25s} | Renaming {old:6s} ➔ {new:6s} ({count_old} rows) | Unique ticker: {is_unique_on_ticker}")
                
                # Resolve unique/primary constraints by deleting the old symbol row if new symbol row already exists
                if is_unique_on_ticker:
                    count_new = cursor.execute(f"SELECT COUNT(*) FROM {tname} WHERE {col_to_use}=?", (new,)).fetchone()[0]
                    if count_new > 0:
                        print(f"      ⚠️ Conflict: {new} already exists in unique table {tname}. Deleting old entry {old}.")
                        cursor.execute(f"DELETE FROM {tname} WHERE {col_to_use} = ?", (old,))
                        continue

                # Table-specific composite unique constraints
                # 1. stock_daily_prices: (ticker, price_date)
                if tname == 'stock_daily_prices':
                    cursor.execute("""
                        DELETE FROM stock_daily_prices 
                        WHERE ticker = ? AND price_date IN (
                            SELECT price_date FROM stock_daily_prices WHERE ticker = ?
                        )
                    """, (old, new))
                
                # 2. price_history: (symbol, date) or (symbol, price_date)
                elif tname == 'price_history':
                    date_col = 'date' if 'date' in cols else ('price_date' if 'price_date' in cols else None)
                    if date_col:
                        cursor.execute(f"""
                            DELETE FROM price_history 
                            WHERE {col_to_use} = ? AND {date_col} IN (
                                SELECT {date_col} FROM price_history WHERE {col_to_use} = ?
                            )
                        """, (old, new))
                        
                # 3. cached_analysis: ticker is unique
                elif tname == 'cached_analysis':
                    cursor.execute(f"DELETE FROM cached_analysis WHERE {col_to_use} = ?", (new,))
                    
                # 4. daily_prices: (symbol, price_date) or (symbol, date)
                elif tname == 'daily_prices':
                    date_col = 'date' if 'date' in cols else ('price_date' if 'price_date' in cols else None)
                    if date_col:
                        cursor.execute(f"""
                            DELETE FROM daily_prices 
                            WHERE {col_to_use} = ? AND {date_col} IN (
                                SELECT {date_col} FROM daily_prices WHERE {col_to_use} = ?
                            )
                        """, (old, new))
                
                # 5. technical_indicators: ticker is unique
                elif tname == 'technical_indicators':
                    cursor.execute("DELETE FROM technical_indicators WHERE ticker = ?", (new,))
                
                # 6. platform_recommendations: symbol is unique
                elif tname == 'platform_recommendations':
                    cursor.execute("DELETE FROM platform_recommendations WHERE symbol = ?", (new,))
                    
                # Update old ticker references to new ticker references
                try:
                    cursor.execute(f"UPDATE {tname} SET {col_to_use} = ? WHERE {col_to_use} = ?", (new, old))
                except sqlite3.IntegrityError as e:
                    print(f"      ⚠️ IntegrityError on {tname}: {e}. Attempting recovery by deleting conflicting new rows.")
                    # Fallback recovery: delete new row to let update succeed
                    cursor.execute(f"DELETE FROM {tname} WHERE {col_to_use} = ?", (new,))
                    cursor.execute(f"UPDATE {tname} SET {col_to_use} = ? WHERE {col_to_use} = ?", (new, old))
                
        conn.commit()
        conn.close()

def sync_names_from_data_engine():
    print("\n=== 3. Synchronizing Stock Names from data_engine.db ===")
    data_engine_path = DB_DIR / "data_engine.db"
    if not data_engine_path.exists():
        print(f"❌ Error: data_engine.db not found at {data_engine_path}")
        return
        
    conn_de = sqlite3.connect(data_engine_path)
    de_cursor = conn_de.cursor()
    
    # Load all distinct symbols with their latest name/market/sector details
    cols_de = [c[1] for c in de_cursor.execute("PRAGMA table_info(stocks)").fetchall()]
    has_name_ar = 'name_ar' in cols_de
    name_ar_col = 'name_ar' if has_name_ar else "''"
    
    order_col = 'last_update DESC' if 'last_update' in cols_de else 'rowid DESC'
    if 'id' in cols_de: order_col += ', id DESC'
    
    de_rows = de_cursor.execute(f"""
        SELECT symbol, name, market, sector, market_cap, price, change_percent, volume, {name_ar_col}
        FROM stocks
        ORDER BY {order_col}
    """).fetchall()
    
    unique_de_stocks = {}
    for sym, name, market, sector, cap, price, chg, vol, *extra in de_rows:
        nar = extra[0] if extra else ''
        if not sym or not name:
            continue
        if sym not in unique_de_stocks:
            market_map = {
                'مصر': 'EGX',
                'السعودية': 'TADAWUL',
                'الكويت': 'KSE',
                'قطر': 'QSE'
            }
            mkt_code = market_map.get(market, market)
            unique_de_stocks[sym] = {
                'name': name,
                'name_ar': nar or '',
                'market': mkt_code,
                'sector': sector or '',
                'market_cap': cap or '',
                'price': price or 0.0,
                'change_percent': chg or 0.0,
                'volume': vol or 0
            }
            
    print(f"   ℹ️ Loaded {len(unique_de_stocks)} unique stocks from data_engine.db")
    
    conn_st = sqlite3.connect(DB_DIR / "stocks.db")
    st_cursor = conn_st.cursor()
    
    updated_cnt = 0
    inserted_cnt = 0
    fetch_time = datetime_now_iso()
    
    for sym, info in unique_de_stocks.items():
        existing = st_cursor.execute("SELECT id FROM stocks WHERE ticker=?", (sym,)).fetchone()
        
        if existing:
            st_cursor.execute("""
                UPDATE stocks SET
                    name = CASE WHEN ? != '' THEN ? ELSE name END,
                    name_ar = CASE 
                        WHEN ? != '' AND ? GLOB '*[\u0600-\u06ff]*' THEN ? 
                        ELSE COALESCE(NULLIF(name_ar, ''), ?) 
                    END,
                    market = ?,
                    sector = ?,
                    current_price = ?,
                    change_percent = ?,
                    volume = ?,
                    market_cap = ?,
                    is_active = 1,
                    last_update = ?,
                    updated_at = ?
                WHERE ticker = ?
            """, (
                info['name'], info['name'],
                info.get('name_ar', ''), info.get('name_ar', ''), info.get('name_ar', ''),
                info['name'],
                info['market'], info['sector'],
                info['price'], info['change_percent'], info['volume'], info['market_cap'],
                fetch_time, fetch_time, sym
            ))
            updated_cnt += 1
        else:
            st_cursor.execute("""
                INSERT INTO stocks (
                    ticker, name, name_ar, market, sector, current_price, change_percent,
                    volume, market_cap, is_active, last_update, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
            """, (
                sym, info['name'], info.get('name_ar') or '', info['market'], info['sector'],
                info['price'], info['change_percent'], info['volume'], info['market_cap'],
                fetch_time, fetch_time, fetch_time
            ))
            inserted_cnt += 1
            
    print(f"   ✅ Updated {updated_cnt} stocks in stocks.db")
    print(f"   ✅ Inserted {inserted_cnt} new stocks in stocks.db")
    
    # Deactivate obsolete stocks (is_active = 0)
    st_tickers = [r[0] for r in st_cursor.execute("SELECT ticker FROM stocks").fetchall()]
    de_symbols_set = set(unique_de_stocks.keys())
    
    deactivated_cnt = 0
    for ticker in st_tickers:
        if ticker not in de_symbols_set:
            st_cursor.execute("UPDATE stocks SET is_active = 0 WHERE ticker = ?", (ticker,))
            deactivated_cnt += 1
            
    print(f"   ✅ Deactivated {deactivated_cnt} obsolete stocks in stocks.db (marked is_active=0)")
    
    conn_st.commit()
    conn_st.close()
    conn_de.close()

def datetime_now_iso():
    from datetime import datetime
    return datetime.now().isoformat()

if __name__ == "__main__":
    print("======================================================")
    print("⚙️ STARTING DATABASE SYMBOL AND NAME ALIGNMENT")
    print("======================================================")
    backup_dbs()
    migrate_tickers()
    sync_names_from_data_engine()
    print("\n🎉 Alignments executed successfully on the databases!")
