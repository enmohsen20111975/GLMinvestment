#!/usr/bin/env python3
import sqlite3
import os

db_path = '/home/meme/my_apps/GLMinvestment/db/stocks.db'
con = sqlite3.connect(db_path)
cur = con.cursor()

print("=== Checking VIEWS and TRIGGERS in stocks.db ===")
rows = cur.execute("SELECT name, type, sql FROM sqlite_master WHERE name LIKE '%price%'").fetchall()
for r in rows:
    print(f"[{r[1].upper()}] {r[0]}:\n{r[2]}\n")

# Test write to price_history view
print("=== Testing INSERT into price_history view ===")
try:
    cur.execute("INSERT INTO price_history (ticker, date, open, close, volume) VALUES ('TEST_TICKER', '2026-10-13', 10, 10, 100)")
    print("SUCCESS: Insert into price_history view succeeded!")
    con.rollback()
except Exception as e:
    print(f"FAILURE on insert to price_history: {type(e).__name__}: {e}")

try:
    cur.execute("INSERT INTO stock_price_history (ticker, date, open, close, volume) VALUES ('TEST_TICKER', '2026-10-13', 10, 10, 100)")
    print("SUCCESS: Insert into stock_price_history view succeeded!")
    con.rollback()
except Exception as e:
    print(f"FAILURE on insert to stock_price_history: {type(e).__name__}: {e}")

con.close()
