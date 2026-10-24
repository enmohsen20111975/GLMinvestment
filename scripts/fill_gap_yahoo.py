#!/usr/bin/env python3
"""
Fetch Real Historical Data from Yahoo Finance
===============================================
يجلب بيانات EGX التاريخية الحقيقية من Yahoo Finance
ويملأ الفجوات في price_history.db

Yahoo uses .CA suffix for EGX stocks (e.g., COMI.CA)
"""

import sqlite3
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')

try:
    import yfinance as yf
    YFINANCE_AVAILABLE = True
except ImportError:
    YFINANCE_AVAILABLE = False
    print("⚠ yfinance not installed. Install with: pip install yfinance")


def fetch_yahoo_history(ticker_yahoo: str, period: str = '3mo') -> list:
    """جلب البيانات التاريخية من Yahoo Finance."""
    try:
        t = yf.Ticker(ticker_yahoo)
        hist = t.history(period=period)
        if hist.empty:
            return []
        
        data = []
        for date, row in hist.iterrows():
            data.append({
                'date': date.strftime('%Y-%m-%d'),
                'open': float(row.get('Open', 0)),
                'high': float(row.get('High', 0)),
                'low': float(row.get('Low', 0)),
                'close': float(row.get('Close', 0)),
                'volume': int(row.get('Volume', 0)),
            })
        return data
    except Exception as e:
        print(f"  ⚠ {ticker_yahoo}: {e}")
        return []


def fill_gap_from_yahoo():
    """ملء الفجوات في price_history.db من Yahoo Finance."""
    if not YFINANCE_AVAILABLE:
        print("❌ yfinance not available")
        return
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    stocks_conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    
    # Get all EGX tickers
    egx_tickers = stocks_conn.execute(
        "SELECT ticker FROM stocks WHERE market = 'EGX' AND current_price > 0"
    ).fetchall()
    egx_tickers = [r[0] for r in egx_tickers]
    print(f"📊 EGX tickers to fetch: {len(egx_tickers)}")
    
    total_inserted = 0
    total_skipped = 0
    failed = []
    
    for i, ticker in enumerate(egx_tickers):
        if i % 20 == 0:
            print(f"  Progress: {i}/{len(egx_tickers)}...")
        
        # Yahoo uses .CA suffix for EGX
        yahoo_ticker = f"{ticker}.CA"
        
        # Fetch from Yahoo
        hist_data = fetch_yahoo_history(yahoo_ticker, period='3mo')
        
        if not hist_data:
            failed.append(ticker)
            continue
        
        # Insert into price_history.db
        for row in hist_data:
            try:
                conn.execute("""
                    INSERT OR REPLACE INTO price_history 
                    (ticker, date, open_price, high_price, low_price, close_price, volume, source)
                    VALUES (?, ?, ?, ?, ?, ?, ?, 'yahoo_finance')
                """, (ticker, row['date'], row['open'], row['high'], 
                      row['low'], row['close'], row['volume']))
                total_inserted += 1
            except:
                total_skipped += 1
        
        # Small delay to avoid rate limiting
        time.sleep(0.1)
    
    conn.commit()
    
    print(f"\n{'='*60}")
    print(f"📊 Yahoo Finance Historical Data Import Complete")
    print(f"{'='*60}")
    print(f"  Total tickers attempted: {len(egx_tickers)}")
    print(f"  Successfully fetched: {len(egx_tickers) - len(failed)}")
    print(f"  Failed: {len(failed)}")
    print(f"  Rows inserted: {total_inserted}")
    print(f"  Rows skipped: {total_skipped}")
    
    if failed:
        print(f"\n  Failed tickers (first 20): {failed[:20]}")
    
    # Verify COMI
    rows = conn.execute("""
        SELECT date, close_price FROM price_history 
        WHERE ticker='COMI' AND date >= '2026-06-01' 
        ORDER BY date DESC LIMIT 15
    """).fetchall()
    print(f"\n  COMI verification (June+):")
    for r in rows:
        print(f"    {r[0]}: {r[1]}")
    
    conn.close()
    stocks_conn.close()


if __name__ == '__main__':
    fill_gap_from_yahoo()
