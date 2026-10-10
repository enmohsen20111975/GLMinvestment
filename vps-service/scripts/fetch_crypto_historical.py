#!/usr/bin/env python3
"""
Fetch historical crypto data from CoinGecko API for 60-day simulation.
Period: 2025-04-01 to 2025-05-31
Coins: BTC, ETH, SOL, ADA, XRP
"""

import requests
import sqlite3
import time
from datetime import datetime, timedelta
import json

# CoinGecko IDs for our target coins
COIN_IDS = {
    'BTC': 'bitcoin',
    'ETH': 'ethereum', 
    'SOL': 'solana',
    'ADA': 'cardano',
    'XRP': 'ripple'
}

from pathlib import Path as _P
DB_PATH = str(_P(__file__).resolve().parent.parent.parent / 'db' / 'data_engine.db')

def fetch_historical_data(coin_id: str, vs_currency: str = 'usd', days: int = 90) -> dict:
    """
    Fetch historical market data from CoinGecko.
    Returns: {prices: [[timestamp, price], ...], volumes: [[timestamp, volume], ...]}
    """
    url = f'https://api.coingecko.com/api/v3/coins/{coin_id}/market_chart'
    params = {
        'vs_currency': vs_currency,
        'days': days,
        'interval': 'daily'  # Get daily data points
    }
    
    try:
        response = requests.get(url, params=params, timeout=30)
        if response.status_code == 200:
            return response.json()
        else:
            print(f"Error {response.status_code} for {coin_id}: {response.text[:200]}")
            return None
    except Exception as e:
        print(f"Exception fetching {coin_id}: {e}")
        return None

def save_to_database(coin_symbol: str, data: dict) -> int:
    """Save historical data to crypto_prices table."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    prices = data.get('prices', [])
    volumes = data.get('total_volumes', [])
    market_caps = data.get('market_caps', [])
    
    # Create a dict for easy lookup
    volume_dict = {int(v[0]/1000): v[1] for v in volumes}
    mcap_dict = {int(m[0]/1000): m[1] for m in market_caps}
    
    records_added = 0
    for price_point in prices:
        timestamp_ms = price_point[0]
        price = price_point[1]
        
        # Convert timestamp to datetime
        dt = datetime.utcfromtimestamp(timestamp_ms / 1000)
        timestamp_str = dt.strftime('%Y-%m-%d %H:%M:%S')
        date_only = dt.strftime('%Y-%m-%d')
        
        # Get volume and market cap
        ts_key = int(timestamp_ms / 1000)
        volume = volume_dict.get(ts_key, 0)
        market_cap = mcap_dict.get(ts_key, 0)
        
        # Check if record exists
        cursor.execute("""
            SELECT id FROM crypto_prices 
            WHERE symbol = ? AND date(timestamp) = ?
        """, (coin_symbol, date_only))
        
        if cursor.fetchone():
            continue  # Skip existing
        
        # Insert new record
        cursor.execute("""
            INSERT INTO crypto_prices 
            (timestamp, symbol, name, price_usd, total_volume, market_cap, price_change_24h)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (timestamp_str, coin_symbol, COIN_IDS.get(coin_symbol, coin_symbol), 
              price, volume, market_cap, None))
        
        records_added += 1
    
    conn.commit()
    conn.close()
    return records_added

def main():
    print("=" * 60)
    print("Fetching Historical Crypto Data for Simulation")
    print("Period: 2025-04-01 to 2025-05-31 (60 days)")
    print("Coins: BTC, ETH, SOL, ADA, XRP")
    print("=" * 60)
    
    # We need about 90 days of data to cover our simulation period
    # CoinGecko free API allows daily data for up to 365 days
    days_to_fetch = 365  # Get full year to have enough data
    
    total_records = 0
    
    for symbol, coin_id in COIN_IDS.items():
        print(f"\nFetching {symbol} ({coin_id})...")
        
        data = fetch_historical_data(coin_id, days=days_to_fetch)
        
        if data:
            prices = data.get('prices', [])
            print(f"  Received {len(prices)} price points")
            
            records = save_to_database(symbol, data)
            print(f"  Added {records} new records")
            total_records += records
        else:
            print(f"  Failed to fetch data for {symbol}")
        
        # Rate limiting - free API has limits
        time.sleep(2)
    
    print(f"\n{'=' * 60}")
    print(f"Total new records added: {total_records}")
    print("=" * 60)
    
    # Verify data
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    print("\nData verification:")
    for symbol in COIN_IDS.keys():
        cursor.execute("""
            SELECT COUNT(*), MIN(timestamp), MAX(timestamp) 
            FROM crypto_prices WHERE symbol = ?
        """, (symbol,))
        result = cursor.fetchone()
        print(f"  {symbol}: {result[0]} records, {result[1]} to {result[2]}")
    
    conn.close()

if __name__ == '__main__':
    main()
