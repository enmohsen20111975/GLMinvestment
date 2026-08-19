#!/usr/bin/env python3
"""
Debug Script — فحص مشكلة الرسومات في Screener
==================================================
شغّله على الـ VPS: python3 scripts/debug_charts.py
"""
import sqlite3
import sys
import os
from pathlib import Path

# Add vps-service to path
VPS_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(VPS_DIR))

PROJECT_ROOT = VPS_DIR.parent

print("=" * 60)
print("🔍 Debug: Charts not showing in Screener")
print("=" * 60)

# 1) Check price_history.db
print("\n--- 1. price_history.db ---")
PH_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
print(f"Path: {PH_DB}")
print(f"Exists: {os.path.exists(PH_DB)}")

if os.path.exists(PH_DB):
    try:
        conn = sqlite3.connect(PH_DB)
        conn.row_factory = sqlite3.Row

        # Tables
        tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        print(f"Tables: {[t[0] for t in tables]}")

        # price_history table
        try:
            cols = conn.execute("PRAGMA table_info(price_history)").fetchall()
            print(f"price_history columns: {[c[1] for c in cols]}")
            count = conn.execute("SELECT COUNT(*) FROM price_history").fetchone()[0]
            print(f"Total rows: {count}")
        except Exception as e:
            print(f"price_history table error: {e}")

        # stock_daily_prices table
        try:
            cols2 = conn.execute("PRAGMA table_info(stock_daily_prices)").fetchall()
            print(f"stock_daily_prices columns: {[c[1] for c in cols2]}")
            count2 = conn.execute("SELECT COUNT(*) FROM stock_daily_prices").fetchone()[0]
            print(f"Total rows: {count2}")
        except Exception as e:
            print(f"stock_daily_prices table error: {e}")

        # Check COMI
        for table in ['price_history', 'stock_daily_prices']:
            try:
                if table == 'price_history':
                    q = "SELECT COUNT(*) FROM price_history WHERE ticker = ?"
                else:
                    q = "SELECT COUNT(*) FROM stock_daily_prices WHERE ticker = ?"

                for ticker in ['COMI', 'comi', 'COMI.CA']:
                    count = conn.execute(q, (ticker,)).fetchone()[0]
                    print(f"  {table} → {ticker}: {count} rows")
            except Exception as e:
                print(f"  {table} query error: {e}")

        # Sample tickers
        try:
            samples = conn.execute("SELECT DISTINCT ticker FROM price_history LIMIT 10").fetchall()
            print(f"Sample tickers (price_history): {[r[0] for r in samples]}")
        except:
            pass

        try:
            samples2 = conn.execute("SELECT DISTINCT ticker FROM stock_daily_prices LIMIT 10").fetchall()
            print(f"Sample tickers (stock_daily_prices): {[r[0] for r in samples2]}")
        except:
            pass

        conn.close()
    except Exception as e:
        print(f"DB error: {e}")

# 2) Check stocks.db
print("\n--- 2. stocks.db ---")
S_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
print(f"Path: {S_DB}")
print(f"Exists: {os.path.exists(S_DB)}")

if os.path.exists(S_DB):
    try:
        conn = sqlite3.connect(S_DB)
        conn.row_factory = sqlite3.Row

        # Check stock_daily_prices in stocks.db
        try:
            cols = conn.execute("PRAGMA table_info(stock_daily_prices)").fetchall()
            print(f"stock_daily_prices columns: {[c[1] for c in cols]}")
            count = conn.execute("SELECT COUNT(*) FROM stock_daily_prices").fetchone()[0]
            print(f"Total rows: {count}")

            # Check COMI
            for ticker in ['COMI', 'comi']:
                count = conn.execute("SELECT COUNT(*) FROM stock_daily_prices WHERE ticker = ?", (ticker,)).fetchone()[0]
                print(f"  COMI ({ticker}): {count} rows")

            # Sample
            samples = conn.execute("SELECT DISTINCT ticker FROM stock_daily_prices LIMIT 10").fetchall()
            print(f"Sample tickers: {[r[0] for r in samples]}")

            # Sample data
            data = conn.execute("SELECT * FROM stock_daily_prices WHERE ticker = 'COMI' ORDER BY price_date DESC LIMIT 3").fetchall()
            if data:
                print(f"Sample COMI data:")
                for r in data:
                    print(f"  {dict(r)}")
        except Exception as e:
            print(f"stock_daily_prices error: {e}")

        conn.close()
    except Exception as e:
        print(f"DB error: {e}")

# 3) Test the API endpoint
print("\n--- 3. API Test ---")
try:
    import requests
    for ticker in ['COMI', 'FWRY', 'HRHO', 'EFID']:
        try:
            r = requests.get(f"http://localhost:8010/api/history/{ticker}?days=30", timeout=10)
            if r.status_code == 200:
                data = r.json()
                if data.get('success'):
                    history = data.get('data', {}).get('history', [])
                    print(f"  {ticker}: ✅ {len(history)} points")
                    if history:
                        print(f"    First: {history[0]}")
                        print(f"    Last:  {history[-1]}")
                else:
                    print(f"  {ticker}: ❌ {data.get('error', 'unknown')}")
            else:
                print(f"  {ticker}: ❌ HTTP {r.status_code}")
        except Exception as e:
            print(f"  {ticker}: ❌ {e}")
except ImportError:
    print("  requests not available")

# 4) Test db.get_price_history directly
print("\n--- 4. Direct DB Test ---")
try:
    from core.database import DatabaseManager
    db = DatabaseManager(S_DB)

    for ticker in ['COMI', 'FWRY', 'HRHO']:
        history = db.get_price_history(ticker, 30)
        print(f"  {ticker}: {len(history) if history else 0} rows")
        if history:
            print(f"    First: {history[0]}")
            print(f"    Last:  {history[-1]}")
except Exception as e:
    print(f"  Error: {e}")

# 5) Summary + recommendations
print("\n" + "=" * 60)
print("📋 Summary")
print("=" * 60)

print("""
If price_history table has data but API returns empty:
  → Check if ticker needs .CA suffix
  → Check column names (close_price vs close)

If stock_daily_prices has data but price_history doesn't:
  → The get_price_history function queries price_history first
  → Need to add stock_daily_prices as fallback

If both tables are empty:
  → Data engine not running or not populating

If API returns 404:
  → db.get_price_history returns None
  → Check PRICE_HISTORY_DB_PATH in core/database.py
""")

if __name__ == '__main__':
    pass
