import sqlite3
import yfinance as yf
from datetime import datetime, timedelta
import logging
from pathlib import Path
import time
import os
import concurrent.futures

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
INTRADAY_DB = str(_PROJECT_ROOT / 'db' / 'intraday.db')

def fetch_and_store(ticker, market, suffix):
    yf_ticker = f"{ticker}{suffix}"
    try:
        stock = yf.Ticker(yf_ticker)
        # Fetch 1 month of 15-minute data
        df = stock.history(period='1mo', interval='15m')
        
        if df.empty:
            return 0
            
        records = []
        for dt, row in df.iterrows():
            timestamp_iso = dt.isoformat()
            # Convert NaN to 0
            import math
            def nan2zero(val):
                return 0.0 if math.isnan(val) else float(val)
                
            o = nan2zero(row['Open'])
            h = nan2zero(row['High'])
            l = nan2zero(row['Low'])
            c = nan2zero(row['Close'])
            v = nan2zero(row['Volume'])
            
            if c > 0:
                records.append((ticker, market, timestamp_iso, c, v, o, h, l))
        
        if records:
            conn = sqlite3.connect(INTRADAY_DB, timeout=20)
            cur = conn.cursor()
            cur.executemany('''
                INSERT OR REPLACE INTO stock_intraday 
                (ticker, market, timestamp, price, volume, open, high, low) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', records)
            conn.commit()
            conn.close()
            
        return len(records)
    except Exception as e:
        logger.error(f"Error fetching {yf_ticker}: {e}")
        return 0

def backfill_all():
    if not os.path.exists(STOCKS_DB) or not os.path.exists(INTRADAY_DB):
        logger.error("DB files not found!")
        return

    s_conn = sqlite3.connect(STOCKS_DB)
    cur = s_conn.execute("SELECT ticker, market FROM stocks")
    stocks = cur.fetchall()
    s_conn.close()
    
    market_suffixes = {
        'EGX': '.CA',
        'TADAWUL': '.SR',
        'KSE': '.KW',
        'QSE': '.QA',
        'US': ''
    }

    logger.info(f"Found {len(stocks)} stocks. Starting backfill (1mo 15m) in parallel...")
    
    total_records = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = []
        for ticker, market in stocks:
            suffix = market_suffixes.get(market, '')
            futures.append(executor.submit(fetch_and_store, ticker, market, suffix))
        
        completed = 0
        for future in concurrent.futures.as_completed(futures):
            total_records += future.result()
            completed += 1
            if completed % 50 == 0:
                logger.info(f"Progress: {completed}/{len(stocks)}")
                
    logger.info(f"Done! Inserted {total_records} intraday records.")

if __name__ == '__main__':
    backfill_all()
