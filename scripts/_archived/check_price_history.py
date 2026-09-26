#!/usr/bin/env python3
import sqlite3, os
DB = os.path.join(os.path.dirname(__file__), '..', 'db', 'price_history.db')
conn = sqlite3.connect(DB)
c = conn.cursor()

# Get schema
print("=== price_history schema ===")
for row in c.execute("PRAGMA table_info(price_history)"):
    print(f"  {row[1]} ({row[2]})")

# Get row count
total = c.execute("SELECT COUNT(*) FROM price_history").fetchone()[0]
print(f"\nTotal: {total}")

# Get date range and tickers
print("\n=== Data summary ===")
for row in c.execute("SELECT MIN(date), MAX(date), COUNT(*), COUNT(DISTINCT ticker) FROM price_history"):
    print(f"Date range: {row[0]} to {row[1]} | {row[2]} records | {row[3]} tickers")

# Sample tickers
print("\nSample tickers:")
for row in c.execute("SELECT ticker, MIN(date), MAX(date), COUNT(*) FROM price_history GROUP BY ticker LIMIT 15"):
    print(f"  {row[0]}: {row[1]} to {row[2]} ({row[3]} records)")

# Check if any EGX tickers exist
print("\n=== Checking EGX overlap ===")
egx_symbols = [r[0] for r in c.execute("""
    SELECT DISTINCT symbol FROM stocks 
    WHERE market IN ('egx', 'EGX', 'مصر')
""").fetchall()] if True else []
print(f"EGX symbols in stocks table: {len(egx_symbols)}")

conn.close()

# Also check data_engine.db stocks table for market values
print("\n=== Markets in data_engine.db ===")
DE_DB = os.path.join(os.path.dirname(__file__), '..', 'db', 'data_engine.db')
conn2 = sqlite3.connect(DE_DB)
for row in conn2.execute("SELECT DISTINCT market FROM stocks"):
    print(f"  '{row[0]}'")
conn2.close()