#!/usr/bin/env python3
"""
Sync data_engine.db → stocks.db
===============================
ينقل البيانات الحقيقية من data_engine.db لـ stocks.db

الجداول المهمة:
- tab_valuation → P/E, P/B, Market Cap
- tab_profitability → ROE, ROA, Margins
- tab_income_statement → EPS
- historical_data → Price history (لكن مش مصر حالياً)
"""

import sqlite3
import os
import shutil
from datetime import datetime

# Paths (relative)
from pathlib import Path as _P
_PROJECT_ROOT = _P(__file__).resolve().parent.parent.parent
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
BACKUP_DIR = str(_PROJECT_ROOT / 'backups')

def backup_stocks_db():
    """إنشاء backup قبل أي تعديل"""
    os.makedirs(BACKUP_DIR, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_path = f'{BACKUP_DIR}/stocks_db_backup_{timestamp}.db'
    shutil.copy2(STOCKS_DB, backup_path)
    print(f"✅ Backup created: {backup_path}")
    return backup_path

def get_egyptian_stocks_from_data_engine():
    """جلب الأسهم المصرية من data_engine.db"""
    conn = sqlite3.connect(DATA_ENGINE_DB)
    cursor = conn.cursor()
    
    # Get Egyptian stocks with valuation and profitability data
    cursor.execute('''
        SELECT 
            s.symbol,
            s.name,
            s.price,
            s.change_percent,
            s.volume,
            s.market_cap,
            s.sector,
            v.pe_ratio,
            v.pb_ratio,
            v.ps_ratio,
            v.market_cap as valuation_market_cap,
            p.roe,
            p.roa,
            p.net_margin,
            p.gross_margin
        FROM stocks s
        -- PILLAR-2: `stocks` table uses `ticker` PK; `tab_valuation`/`tab_profitability`
        -- use `ticker` PK too. tab_* tables have no `market` column, so the
        -- `s.market = v.market` join condition was dropped.
        LEFT JOIN tab_valuation v ON s.ticker = v.ticker
        LEFT JOIN tab_profitability p ON s.ticker = p.ticker
        WHERE s.market = 'مصر'
    ''')
    
    stocks = cursor.fetchall()
    conn.close()
    
    return stocks

def parse_percentage(value):
    """تحويل النسبة المئوية من نص لرقم — Rule 27: NULL بدل 0.0 للقيم الفاضية.
    
    BUG FIX (2026-10-05): كان بترجّع 0.0 للقيم الفاضية، ده بـ يلوّث الـ DB
    بقيم وهمية. دلوقتي بترجّع None (NULL) للقيم الفاضية/المشبوهة.
    """
    if not value or value == '—' or value == '-' or value == '— ' or value == 'None' or value == 'null':
        return None  # NULL بدل 0.0 (Rule 27 — NO-FAKE-DATA)
    try:
        # Remove % and convert to float
        clean = str(value).replace('%', '').replace(',', '').strip()
        if clean.startswith('−') or clean.startswith('-'):
            clean = '-' + clean[1:]
        result = float(clean)
        # Rule 27: منع placeholder values المشبوهة (0.0 = لا توجد بيانات)
        if result == 0.0:
            return None  # NULL بدل 0.0
        return result
    except:
        return None  # NULL بدل 0.0

def parse_numeric(value):
    """تحويل القيمة الرقمية من نص — Rule 27: NULL بدل 0.0 للقيم الفاضية."""
    if not value or value == '—' or value == '-' or value == '— ' or value == 'None' or value == 'null':
        return None  # NULL بدل 0.0
    try:
        clean = str(value).replace(',', '').strip()
        result = float(clean)
        # Rule 27: منع placeholder values (0.0 = لا توجد بيانات)
        if result == 0.0:
            return None  # NULL بدل 0.0
        return result
    except:
        return None  # NULL بدل 0.0

def update_stocks_db(stocks_data):
    """تحديث stocks.db بالبيانات الأساسية"""
    conn = sqlite3.connect(STOCKS_DB)
    cursor = conn.cursor()
    
    updated_count = 0
    inserted_count = 0
    
    for stock in stocks_data:
        (symbol, name, price, change_percent, volume, market_cap, sector,
         pe_ratio, pb_ratio, ps_ratio, valuation_market_cap,
         roe, roa, net_margin, gross_margin) = stock
        
        # Parse values
        pe = parse_numeric(pe_ratio)
        pb = parse_numeric(pb_ratio)
        ps = parse_numeric(ps_ratio)
        roe_val = parse_percentage(roe)
        roa_val = parse_percentage(roa)
        net_margin_val = parse_percentage(net_margin)
        
        # Check if stock exists
        cursor.execute("SELECT id FROM stocks WHERE ticker = ?", (symbol,))
        existing = cursor.fetchone()
        
        if existing:
            # Update existing stock
            cursor.execute('''
                UPDATE stocks SET
                    name = ?,
                    current_price = ?,
                    pe_ratio = ?,
                    pb_ratio = ?,
                    ps_ratio = ?,
                    roe = ?,
                    roa = ?,
                    profit_margin = ?,
                    sector = ?,
                    updated_at = datetime('now')
                WHERE ticker = ?
            ''', (name, price, pe, pb, ps, roe_val, roa_val, net_margin_val, sector, symbol))
            updated_count += 1
        else:
            # Insert new stock
            cursor.execute('''
                INSERT INTO stocks (
                    ticker, name, current_price, pe_ratio, pb_ratio, ps_ratio,
                    roe, roa, profit_margin, sector, market, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'EGX', datetime('now'), datetime('now'))
            ''', (symbol, name, price, pe, pb, ps, roe_val, roa_val, net_margin_val, sector))
            inserted_count += 1
    
    conn.commit()
    conn.close()
    
    return updated_count, inserted_count

def main():
    print("=" * 70)
    print("Sync: data_engine.db → stocks.db")
    print("=" * 70)
    
    # Step 1: Backup
    print("\n📦 Step 1: Creating backup...")
    backup_path = backup_stocks_db()
    
    # Step 2: Get Egyptian stocks from data_engine
    print("\n📊 Step 2: Fetching Egyptian stocks from data_engine.db...")
    stocks = get_egyptian_stocks_from_data_engine()
    print(f"   Found {len(stocks)} Egyptian stocks")
    
    # Step 3: Update stocks.db
    print("\n📝 Step 3: Updating stocks.db...")
    updated, inserted = update_stocks_db(stocks)
    
    # Summary
    print("\n" + "=" * 70)
    print("SYNC COMPLETE")
    print("=" * 70)
    print(f"  Stocks processed: {len(stocks)}")
    print(f"  Updated: {updated}")
    print(f"  Inserted: {inserted}")
    print(f"  Backup: {backup_path}")
    
    # Verify
    print("\n📊 Verification:")
    conn = sqlite3.connect(STOCKS_DB)
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM stocks WHERE pe_ratio > 0")
    pe_count = cursor.fetchone()[0]
    print(f"  Stocks with P/E > 0: {pe_count}")
    
    cursor.execute("SELECT COUNT(*) FROM stocks WHERE roe > 0")
    roe_count = cursor.fetchone()[0]
    print(f"  Stocks with ROE > 0: {roe_count}")
    
    # Sample updated stocks
    print("\n📊 Sample updated stocks:")
    cursor.execute('''
        SELECT ticker, name, pe_ratio, roe 
        FROM stocks 
        WHERE pe_ratio > 0 OR roe > 0
        LIMIT 10
    ''')
    for r in cursor.fetchall():
        print(f"  {r[0]}: P/E={r[2]}, ROE={r[3]}")
    
    conn.close()

if __name__ == '__main__':
    main()
