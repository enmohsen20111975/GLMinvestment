#!/usr/bin/env python3
import sqlite3

con = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/data_engine.db')
cur = con.cursor()

print("=== data_engine.db stocks for AJWA ===")
for r in cur.execute("SELECT * FROM stocks WHERE symbol LIKE '%AJWA%'"):
    print(r)

print("\n=== data_engine.db stock_prices for AJWA ===")
for r in cur.execute("SELECT * FROM stock_prices WHERE symbol LIKE '%AJWA%' ORDER BY date DESC LIMIT 3"):
    print(r)

print("\n=== data_engine.db tab_technical_analysis for AJWA ===")
for r in cur.execute("SELECT * FROM tab_technical_analysis WHERE symbol LIKE '%AJWA%'"):
    print(r)

con.close()
