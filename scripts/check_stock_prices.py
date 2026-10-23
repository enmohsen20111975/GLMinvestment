import sqlite3

# Phase 7.1: migrated to db_manager (writable=True)
from core.db_manager import db_manager
conn = db_manager.connection('db/stocks.db', writable=True).__enter__()
rows = conn.execute("SELECT ticker, name_ar, current_price, close, open_price, high_price, low_price, last_update FROM stocks WHERE ticker IN ('COMI', 'SWDY', 'ETEL', 'AMOC', 'FWRY')").fetchall()
for r in rows:
    print(r)

print("\n--- In stock_daily_prices ---")
rows2 = conn.execute("SELECT * FROM stock_daily_prices WHERE ticker IN ('COMI', 'SWDY', 'ETEL', 'AMOC', 'FWRY') ORDER BY fetch_time DESC LIMIT 5").fetchall()
for r in rows2:
    print(r)
conn.close()

print("\n--- In price_history.db ---")
# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn_ph = db_manager.connection('db/price_history.db', writable=False).__enter__()
rows_ph = conn_ph.execute("SELECT ticker, date, close_price, open_price, high_price, low_price, source FROM price_history WHERE ticker IN ('COMI', 'SWDY', 'ETEL', 'AMOC', 'FWRY') ORDER BY date DESC LIMIT 10").fetchall()
for r in rows_ph:
    print(r)
conn_ph.close()
