#!/usr/bin/env python3
"""Check if price_history.db has data for other markets"""
import sqlite3, os

# Check price_history.db
PH_DB = os.path.join(os.path.dirname(__file__), '..', 'db', 'price_history.db')
conn = sqlite3.connect(PH_DB)
c = conn.cursor()
tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print(f"Tables in price_history.db: {tables}")

if 'stock_price_history' in tables:
    total = c.execute("SELECT COUNT(*) FROM stock_price_history").fetchone()[0]
    print(f"\nstock_price_history: {total} rows")
    
    # Check date range
    for row in c.execute("SELECT MIN(date), MAX(date), COUNT(*), COUNT(DISTINCT ticker) FROM stock_price_history"):
        print(f"  Date range: {row[0]} to {row[1]} | {row[2]} records | {row[3]} tickers")

    # Check if there are EGX tickers
    try:
        egx_count = c.execute("""
            SELECT COUNT(DISTINCT ticker) FROM stock_price_history 
            WHERE ticker IN (SELECT symbol FROM sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/data_engine.db').execute(
                "SELECT symbol FROM stocks WHERE market='egx'").fetchall())
        """).fetchone()[0]
    except:
        pass

    # Get first few tickers
    print("\nSample tickers:")
    for row in c.execute("SELECT DISTINCT ticker, MIN(date), MAX(date), COUNT(*) FROM stock_price_history GROUP BY ticker LIMIT 10"):
        print(f"  {row[0]}: {row[1]} to {row[2]} ({row[3]} records)")

conn.close()

# Check if there's a crypto database
print("\n=== Checking crypto data ===")
# Check stocks.db
S_DB = os.path.join(os.path.dirname(__file__), '..', 'db', 'stocks.db')
try:
    sconn = sqlite3.connect(S_DB)
    sc = sconn.cursor()
    # Check for crypto tables
    tables = [r[0] for r in sc.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print(f"Tables in stocks.db: {[t for t in tables if 'crypto' in t.lower()]}")
    sconn.close()
except:
    print("Error checking stocks.db")