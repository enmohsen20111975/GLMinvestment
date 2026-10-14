import sqlite3

conn = sqlite3.connect('db/stocks.db')
rows = conn.execute("SELECT ticker, name_ar, current_price, close, open_price, high_price, low_price, last_update FROM stocks WHERE ticker IN ('COMI', 'SWDY', 'ETEL', 'AMOC', 'FWRY')").fetchall()
for r in rows:
    print(r)

print("\n--- In stock_daily_prices ---")
rows2 = conn.execute("SELECT * FROM stock_daily_prices WHERE ticker IN ('COMI', 'SWDY', 'ETEL', 'AMOC', 'FWRY') ORDER BY fetch_time DESC LIMIT 5").fetchall()
for r in rows2:
    print(r)
conn.close()

print("\n--- In price_history.db ---")
conn_ph = sqlite3.connect('db/price_history.db')
rows_ph = conn_ph.execute("SELECT ticker, date, close_price, open_price, high_price, low_price, source FROM price_history WHERE ticker IN ('COMI', 'SWDY', 'ETEL', 'AMOC', 'FWRY') ORDER BY date DESC LIMIT 10").fetchall()
for r in rows_ph:
    print(r)
conn_ph.close()
