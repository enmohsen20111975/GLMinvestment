#!/usr/bin/env python3
"""
Database Sync Script
====================
Syncs data from data_engine.db to stocks.db and price_history.db

Runs every 5 minutes via cron or manually from admin panel.

Author: GLM Investment Team
"""

import sqlite3
import os
import json
from datetime import datetime
from typing import Optional, List, Dict, Any

# ============================================================================
# CONFIGURATION
# ============================================================================

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_ENGINE_DB = os.path.join(BASE_DIR, 'data_engine', 'data', 'data_engine.db')
STOCKS_DB = os.path.join(BASE_DIR, 'db', 'stocks.db')
PRICE_HISTORY_DB = os.path.join(BASE_DIR, 'db', 'price_history.db')

# Market code mapping (Arabic -> Code)
MARKET_MAPPING = {
    'مصر': 'EGX',
    'السعودية': 'TADAWUL',
    'الكويت': 'KSE',
    'قطر': 'QSE',
    'الإمارات': 'DFM',
    'البحرين': 'BSE',
}

# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def parse_volume(vol_str: str) -> int:
    """Convert volume string to integer (e.g., '1.44 M' -> 1440000)"""
    if not vol_str:
        return 0
    try:
        vol_str = str(vol_str).replace(',', '').strip()
        if 'M' in vol_str or 'م' in vol_str:
            return int(float(vol_str.replace('M', '').replace('م', '')) * 1_000_000)
        elif 'B' in vol_str or 'ب' in vol_str:
            return int(float(vol_str.replace('B', '').replace('ب', '')) * 1_000_000_000)
        elif 'K' in vol_str or 'أ' in vol_str:
            return int(float(vol_str.replace('K', '').replace('أ', '')) * 1_000)
        else:
            return int(float(vol_str))
    except:
        return 0

def parse_market_cap(cap_str: str) -> float:
    """Convert market cap string to float"""
    if not cap_str:
        return 0.0
    try:
        cap_str = str(cap_str).replace(',', '').strip()
        if 'B' in cap_str or 'ب' in cap_str:
            return float(cap_str.replace('B', '').replace('ب', '')) * 1_000_000_000
        elif 'M' in cap_str or 'م' in cap_str:
            return float(cap_str.replace('M', '').replace('م', '')) * 1_000_000
        else:
            return float(cap_str)
    except:
        return 0.0

def get_timestamp() -> str:
    return datetime.now().isoformat()

# ============================================================================
# SYNC FUNCTIONS
# ============================================================================

def sync_stocks(source_conn: sqlite3.Connection, target_conn: sqlite3.Connection) -> Dict[str, int]:
    """
    Sync stocks from data_engine.db to stocks.db
    """
    print("[SYNC] Syncing stocks...")
    
    source_cur = source_conn.cursor()
    target_cur = target_conn.cursor()
    
    # Get all stocks from source
    source_cur.execute("""
        SELECT symbol, name, price, change_percent, volume, market_cap, market, 
               sector, tabs_data, logo_url, created_at
        FROM stocks
    """)
    stocks = source_cur.fetchall()
    
    inserted = 0
    updated = 0
    skipped = 0
    
    for stock in stocks:
        symbol, name, price, change_percent, volume, market_cap, market, sector, tabs_data, logo_url, created_at = stock
        
        # Convert market name
        market_code = MARKET_MAPPING.get(market, market)
        
        # Parse volume and market_cap
        volume_num = parse_volume(volume)
        market_cap_num = parse_market_cap(market_cap)
        
        # Check if exists
        target_cur.execute("SELECT id FROM stocks WHERE ticker = ?", (symbol,))
        exists = target_cur.fetchone()
        
        now = get_timestamp()
        
        if exists:
            # Update
            target_cur.execute("""
                UPDATE stocks SET
                    name = ?,
                    name_ar = ?,
                    current_price = ?,
                    previous_close = ?,
                    change_percent = ?,
                    volume = ?,
                    market_cap = ?,
                    market = ?,
                    sector = ?,
                    last_update = ?,
                    updated_at = ?
                WHERE ticker = ?
            """, (
                name, name, price, price, change_percent, volume_num, market_cap_num,
                market_code, sector, now, now, symbol
            ))
            updated += 1
        else:
            # Insert
            target_cur.execute("""
                INSERT INTO stocks (
                    ticker, name, name_ar, market, sector,
                    current_price, previous_close, change_percent,
                    volume, market_cap, is_active, last_update, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
            """, (
                symbol, name, name, market_code, sector,
                price, price, change_percent,
                volume_num, market_cap_num, now, now, now
            ))
            inserted += 1
    
    target_conn.commit()
    
    result = {
        'total': len(stocks),
        'inserted': inserted,
        'updated': updated,
        'skipped': skipped
    }
    print(f"[SYNC] Stocks: {result}")
    return result

def sync_historical_data(source_conn: sqlite3.Connection, target_conn: sqlite3.Connection) -> Dict[str, int]:
    """
    Sync historical_data from data_engine.db to price_history.db
    """
    print("[SYNC] Syncing historical data...")
    
    source_cur = source_conn.cursor()
    target_cur = target_conn.cursor()
    
    # Get all historical data from source
    source_cur.execute("""
        SELECT symbol, name, market, date, open, high, low, close, volume
        FROM historical_data
        ORDER BY date DESC
    """)
    records = source_cur.fetchall()
    
    inserted = 0
    skipped = 0
    
    now = get_timestamp()
    
    for record in records:
        symbol, name, market, date, open_price, high, low, close, volume = record
        
        if not symbol or not date:
            skipped += 1
            continue
        
        try:
            # Use INSERT OR IGNORE to skip duplicates
            target_cur.execute("""
                INSERT OR IGNORE INTO price_history (
                    ticker, date, open_price, high_price, low_price, close_price, volume, source, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'data_engine', ?)
            """, (symbol, date, open_price, high, low, close, volume, now))
            inserted += 1
        except sqlite3.IntegrityError:
            skipped += 1
    
    target_conn.commit()
    
    result = {
        'total': len(records),
        'inserted': inserted,
        'skipped': skipped
    }
    print(f"[SYNC] Historical: {result}")
    return result

def sync_gold_prices(source_conn: sqlite3.Connection, target_conn: sqlite3.Connection) -> Dict[str, int]:
    """
    Sync gold_prices from data_engine.db to stocks.db
    """
    print("[SYNC] Syncing gold prices...")
    
    source_cur = source_conn.cursor()
    target_cur = target_conn.cursor()
    
    # Get latest gold prices from source
    source_cur.execute("""
        SELECT timestamp, country, currency, karat, price_per_gram, price_per_ounce
        FROM gold_prices
        WHERE timestamp = (SELECT MAX(timestamp) FROM gold_prices)
    """)
    prices = source_cur.fetchall()
    
    inserted = 0
    now = get_timestamp()
    
    for price in prices:
        timestamp, country, currency, karat, price_per_gram, price_per_ounce = price
        
        try:
            target_cur.execute("""
                INSERT OR REPLACE INTO gold_prices (
                    timestamp, country, karat, price_per_gram, price_per_ounce, currency, source, last_update
                ) VALUES (?, ?, ?, ?, ?, ?, 'data_engine', ?)
            """, (timestamp, country, karat, price_per_gram, price_per_ounce, currency, now))
            inserted += 1
        except Exception as e:
            print(f"[SYNC] Gold error: {e}")
    
    target_conn.commit()
    
    result = {'total': len(prices), 'inserted': inserted}
    print(f"[SYNC] Gold: {result}")
    return result

def sync_silver_prices(source_conn: sqlite3.Connection, target_conn: sqlite3.Connection) -> Dict[str, int]:
    """
    Sync silver_prices from data_engine.db to stocks.db
    """
    print("[SYNC] Syncing silver prices...")
    
    source_cur = source_conn.cursor()
    target_cur = target_conn.cursor()
    
    source_cur.execute("""
        SELECT timestamp, country, currency, price_per_gram, price_per_ounce
        FROM silver_prices
        WHERE timestamp = (SELECT MAX(timestamp) FROM silver_prices)
    """)
    prices = source_cur.fetchall()
    
    inserted = 0
    now = get_timestamp()
    
    for price in prices:
        timestamp, country, currency, price_per_gram, price_per_ounce = price
        
        try:
            target_cur.execute("""
                INSERT OR REPLACE INTO silver_prices (
                    timestamp, country, currency, price_per_gram, price_per_ounce, source, last_update
                ) VALUES (?, ?, ?, ?, ?, 'data_engine', ?)
            """, (timestamp, country, currency, price_per_gram, price_per_ounce, now))
            inserted += 1
        except Exception as e:
            print(f"[SYNC] Silver error: {e}")
    
    target_conn.commit()
    
    result = {'total': len(prices), 'inserted': inserted}
    print(f"[SYNC] Silver: {result}")
    return result

def sync_exchange_rates(source_conn: sqlite3.Connection, target_conn: sqlite3.Connection) -> Dict[str, int]:
    """
    Sync exchange_rates from data_engine.db to stocks.db
    """
    print("[SYNC] Syncing exchange rates...")
    
    source_cur = source_conn.cursor()
    target_cur = target_conn.cursor()
    
    source_cur.execute("""
        SELECT timestamp, currency, rate_to_usd
        FROM exchange_rates
        WHERE timestamp = (SELECT MAX(timestamp) FROM exchange_rates)
    """)
    rates = source_cur.fetchall()
    
    inserted = 0
    now = get_timestamp()
    
    for rate in rates:
        timestamp, currency, rate_to_usd = rate
        
        try:
            target_cur.execute("""
                INSERT OR REPLACE INTO exchange_rates (
                    timestamp, currency, rate_to_usd, source, last_update
                ) VALUES (?, ?, ?, 'data_engine', ?)
            """, (timestamp, currency, rate_to_usd, now))
            inserted += 1
        except Exception as e:
            print(f"[SYNC] Exchange rate error: {e}")
    
    target_conn.commit()
    
    result = {'total': len(rates), 'inserted': inserted}
    print(f"[SYNC] Exchange rates: {result}")
    return result

def sync_crypto_prices(source_conn: sqlite3.Connection, target_conn: sqlite3.Connection) -> Dict[str, int]:
    """
    Sync crypto_prices from data_engine.db to stocks.db
    """
    print("[SYNC] Syncing crypto prices...")
    
    source_cur = source_conn.cursor()
    target_cur = target_conn.cursor()
    
    source_cur.execute("""
        SELECT timestamp, rank, symbol, name, price_usd, price_change_24h, price_change_7d,
               market_cap, market_cap_rank, total_volume, circulating_supply
        FROM crypto_prices
        WHERE timestamp = (SELECT MAX(timestamp) FROM crypto_prices)
    """)
    cryptos = source_cur.fetchall()
    
    inserted = 0
    now = get_timestamp()
    
    for crypto in cryptos:
        timestamp, rank, symbol, name, price_usd, price_change_24h, price_change_7d, \
            market_cap, market_cap_rank, total_volume, circulating_supply = crypto
        
        try:
            target_cur.execute("""
                INSERT OR REPLACE INTO crypto_prices (
                    timestamp, rank, symbol, name, price_usd, price_change_24h, price_change_7d,
                    market_cap, market_cap_rank, total_volume, circulating_supply, source, last_update
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'data_engine', ?)
            """, (timestamp, rank, symbol, name, price_usd, price_change_24h, price_change_7d,
                  market_cap, market_cap_rank, total_volume, circulating_supply, now))
            inserted += 1
        except Exception as e:
            print(f"[SYNC] Crypto error: {e}")
    
    target_conn.commit()
    
    result = {'total': len(cryptos), 'inserted': inserted}
    print(f"[SYNC] Crypto: {result}")
    return result

def sync_btc_local_prices(source_conn: sqlite3.Connection, target_conn: sqlite3.Connection) -> Dict[str, int]:
    """
    Sync btc_local_prices from data_engine.db to stocks.db
    """
    print("[SYNC] Syncing BTC local prices...")
    
    source_cur = source_conn.cursor()
    target_cur = target_conn.cursor()
    
    source_cur.execute("""
        SELECT timestamp, currency, price, change_24h
        FROM btc_local_prices
        WHERE timestamp = (SELECT MAX(timestamp) FROM btc_local_prices)
    """)
    prices = source_cur.fetchall()
    
    inserted = 0
    now = get_timestamp()
    
    for price in prices:
        timestamp, currency, price_val, change_24h = price
        
        try:
            target_cur.execute("""
                INSERT OR REPLACE INTO btc_local_prices (
                    timestamp, currency, price, change_24h, source, last_update
                ) VALUES (?, ?, ?, ?, 'data_engine', ?)
            """, (timestamp, currency, price_val, change_24h, now))
            inserted += 1
        except Exception as e:
            print(f"[SYNC] BTC local error: {e}")
    
    target_conn.commit()
    
    result = {'total': len(prices), 'inserted': inserted}
    print(f"[SYNC] BTC local: {result}")
    return result

# ============================================================================
# MAIN
# ============================================================================

def run_sync(clear_historical: bool = False) -> Dict[str, Any]:
    """
    Run full sync from data_engine.db to stocks.db and price_history.db
    
    Args:
        clear_historical: If True, clear price_history.db before syncing
    """
    print("=" * 60)
    print(f"[SYNC] Starting sync at {get_timestamp()}")
    print("=" * 60)
    
    # Connect to databases
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    source_conn = db_manager.connection(DATA_ENGINE_DB, writable=False).__enter__()
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    stocks_conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    price_history_conn = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
    
    results = {}
    
    try:
        # Clear historical if requested
        if clear_historical:
            print("[SYNC] Clearing price_history.db...")
            price_history_conn.execute("DELETE FROM price_history")
            price_history_conn.commit()
        
        # Sync all tables
        results['stocks'] = sync_stocks(source_conn, stocks_conn)
        results['historical'] = sync_historical_data(source_conn, price_history_conn)
        results['gold'] = sync_gold_prices(source_conn, stocks_conn)
        results['silver'] = sync_silver_prices(source_conn, stocks_conn)
        results['exchange_rates'] = sync_exchange_rates(source_conn, stocks_conn)
        results['crypto'] = sync_crypto_prices(source_conn, stocks_conn)
        results['btc_local'] = sync_btc_local_prices(source_conn, stocks_conn)
        
        print("=" * 60)
        print("[SYNC] Sync completed successfully!")
        print("=" * 60)
        
    except Exception as e:
        print(f"[SYNC] Error: {e}")
        results['error'] = str(e)
    
    finally:
        source_conn.close()
        stocks_conn.close()
        price_history_conn.close()
    
    return results

if __name__ == '__main__':
    import sys
    
    # Check for --clear-historical flag
    clear_hist = '--clear-historical' in sys.argv
    
    results = run_sync(clear_historical=clear_hist)
    print(json.dumps(results, indent=2))
