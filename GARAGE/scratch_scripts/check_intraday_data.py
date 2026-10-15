#!/usr/bin/env python3
import sqlite3

con = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/intraday.db')
cur = con.cursor()
cnt = cur.execute('SELECT COUNT(*) FROM stock_intraday').fetchone()[0]
print('Total rows in stock_intraday:', cnt)
adpc = cur.execute("SELECT COUNT(*) FROM stock_intraday WHERE ticker='ADPC'").fetchone()[0]
print('ADPC rows:', adpc)
comi = cur.execute("SELECT COUNT(*) FROM stock_intraday WHERE ticker='COMI'").fetchone()[0]
print('COMI rows:', comi)
distinct = cur.execute('SELECT COUNT(DISTINCT ticker) FROM stock_intraday').fetchone()[0]
print('Distinct tickers:', distinct)
sample = cur.execute('SELECT DISTINCT ticker FROM stock_intraday LIMIT 10').fetchall()
print('Sample tickers:', sample)
con.close()
