import sqlite3
import os

db_dir = "/home/meme/my_apps/GLMinvestment/db"
files = ["data_engine.db", "price_history.db", "predictions.db", "stocks.db"]

for f in files:
    path = os.path.join(db_dir, f)
    if os.path.exists(path):
        print(f"\n=== DB: {f} ===")
        conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
        c = conn.cursor()
        c.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [t[0] for t in c.fetchall()]
        print("Tables:", tables)
        for tbl in ['price_history', 'stocks', 'predictions', 'daily_opportunities', 'stock_prices', 'historical_data']:
            if tbl in tables:
                c.execute(f"PRAGMA table_info({tbl})")
                cols = [col[1] for col in c.fetchall()]
                d_col = next((col for col in ['date', 'timestamp', 'created_at', 'last_updated', 'updated_at'] if col in cols), None)
                if d_col:
                    max_v = c.execute(f"SELECT max({d_col}) FROM {tbl}").fetchone()[0]
                    cnt = c.execute(f"SELECT count(*) FROM {tbl}").fetchone()[0]
                    print(f"  {tbl} ({cnt} rows): max({d_col}) = {max_v}")
                else:
                    cnt = c.execute(f"SELECT count(*) FROM {tbl}").fetchone()[0]
                    print(f"  {tbl} ({cnt} rows)")
        conn.close()
