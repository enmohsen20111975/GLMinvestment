import sqlite3

conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/stocks.db')
for t in ['stock_daily_prices', 'stock_price_history', 'price_history']:
    try:
        cnt = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        schema = conn.execute(f"SELECT sql FROM sqlite_master WHERE name='{t}'").fetchone()[0]
        print(f"=== {t} ===")
        print(f"  Count: {cnt}")
        print(f"  Schema: {schema}")
        cols = [c[1] for c in conn.execute(f"PRAGMA table_info({t})").fetchall()]
        print(f"  Columns: {cols}")
    except Exception as e:
        print(f"{t}: {e}")
