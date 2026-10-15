#!/usr/bin/env python3
import sqlite3

con = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/stocks.db')
cur = con.cursor()

print("=== STOCKS TABLE FOR AJWA ===")
for r in cur.execute("SELECT ticker, name, current_price, previous_close, change_percent, last_update FROM stocks WHERE ticker = 'AJWA'"):
    print(r)

print("\n=== STOCK_DAILY_PRICES TABLE FOR AJWA (LAST 5 DAYS) ===")
for r in cur.execute("SELECT ticker, price_date, open, high, low, close, volume, change_percent FROM stock_daily_prices WHERE ticker = 'AJWA' ORDER BY price_date DESC LIMIT 5"):
    print(r)

con.close()
