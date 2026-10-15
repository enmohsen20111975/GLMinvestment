#!/usr/bin/env python3
import sqlite3

def check_db(name, path, q):
    try:
        con = sqlite3.connect(path)
        cur = con.cursor()
        print(f"=== {name} ===")
        for r in cur.execute(q):
            print(r)
        con.close()
    except Exception as e:
        print(f"Error in {name}: {e}")

check_db("predictions.db", "/home/meme/my_apps/GLMinvestment/db/predictions.db", 
         "SELECT name FROM sqlite_master WHERE type='table'")

check_db("predictions.db predictions for AJWA", "/home/meme/my_apps/GLMinvestment/db/predictions.db",
         "SELECT id, ticker, target_price, timeframe, created_at FROM predictions WHERE ticker='AJWA' ORDER BY created_at DESC LIMIT 3")

check_db("data_engine.db for AJWA", "/home/meme/my_apps/GLMinvestment/db/data_engine.db",
         "SELECT name FROM sqlite_master WHERE type='table'")
