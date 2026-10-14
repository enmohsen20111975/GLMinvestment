import sqlite3
import os
from datetime import datetime

db_dir = "/home/meme/my_apps/GLMinvestment/db"

for db_name in ['stocks.db', 'data_engine.db', 'price_history.db', 'intraday.db', 'predictions.db']:
    path = os.path.join(db_dir, db_name)
    if not os.path.exists(path):
        print(f"File {db_name} does not exist.")
        continue
    try:
        conn = sqlite3.connect(path)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [r[0] for r in cursor.fetchall()]
        print(f"\n=== {db_name} ===")
        print(f"Tables: {tables}")
        
        for tbl in ['price_history', 'prices', 'stock_prices', 'intraday_prices', 'predictions', 'honest_predictions']:
            if tbl in tables:
                col_name = 'created_at' if 'created_at' in [c[1] for c in cursor.execute(f"PRAGMA table_info({tbl})").fetchall()] else 'date'
                try:
                    res = cursor.execute(f"SELECT MAX({col_name}), COUNT(*) FROM {tbl}").fetchone()
                    print(f"  -> Table '{tbl}': max({col_name}) = {res[0]}, total rows = {res[1]}")
                except Exception as ex:
                    print(f"  -> Table '{tbl}': Error querying {ex}")
    except Exception as e:
        print(f"Error reading {db_name}: {e}")
