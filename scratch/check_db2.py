import sqlite3
import os

try:
    conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/predictions.db')
    conn.row_factory = sqlite3.Row
    print("aiPrediction rows:", conn.execute("SELECT COUNT(*) FROM aiPrediction").fetchone()[0])
    
    conn_data = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/data_engine.db')
    
    # Next.js likely stored predictions somewhere? Let's check Next.js data directory.
    nextjs_db_path = '/home/meme/my_apps/GLMinvestment/src/lib/honest-tracking/data'
    if os.path.exists(nextjs_db_path):
        print("Next.js data folder:", os.listdir(nextjs_db_path))
except Exception as e:
    print("Error:", e)
