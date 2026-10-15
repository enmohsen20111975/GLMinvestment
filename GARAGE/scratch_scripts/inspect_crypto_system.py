import sqlite3
import os

print("=== 1. PREDICTIONS.DB ===")
p_conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/predictions.db')
p_cur = p_conn.cursor()
p_cur.execute("SELECT ticker, signal, prediction_date, target_price, stop_loss, market FROM predictions WHERE market='CRYPTO'")
print("Crypto predictions:", p_cur.fetchall())

print("\n=== 2. STOCKS.DB (CRYPTO TICKERS) ===")
s_conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/stocks.db')
s_cur = s_conn.cursor()
try:
    s_cur.execute("SELECT ticker, name, current_price, market FROM stocks WHERE market='CRYPTO' LIMIT 10")
    print("Crypto stocks:", s_cur.fetchall())
except Exception as e:
    print("Error querying stocks for CRYPTO:", e)

try:
    s_cur.execute("SELECT count(*) FROM stock_daily_prices WHERE market='CRYPTO'")
    print("Crypto daily prices count in stocks.db:", s_cur.fetchone())
except Exception as e:
    print("Error querying stock_daily_prices for CRYPTO:", e)

print("\n=== 3. DATA_ENGINE.DB ===")
d_path = '/home/meme/my_apps/GLMinvestment/db/data_engine.db'
if os.path.exists(d_path):
    d_conn = sqlite3.connect(d_path)
    d_cur = d_conn.cursor()
    d_cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%crypto%'")
    print("Crypto tables in data_engine:", d_cur.fetchall())

print("\n=== 4. RADAR_SIGNAL_TRACKING (db/stocks.db) ===")
try:
    s_cur.execute("SELECT count(*) FROM radar_signal_tracking WHERE market='CRYPTO'")
    print("Crypto in radar_signal_tracking:", s_cur.fetchone())
except Exception as e:
    print("radar_signal_tracking crypto:", e)
