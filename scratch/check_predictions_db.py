import sqlite3
import sys

def check_db():
    try:
        conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/predictions.db')
        conn.row_factory = sqlite3.Row
        
        # Check tables
        tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
        print("Tables:", [t['name'] for t in tables])
        
        # Check rows
        rows = conn.execute("SELECT COUNT(*) as c FROM hunter_pick_tracking").fetchone()
        print("hunter_pick_tracking rows:", rows['c'])
        
        # Get one row
        first = conn.execute("SELECT * FROM hunter_pick_tracking LIMIT 1").fetchone()
        if first:
            print("First row:", dict(first))
            
    except Exception as e:
        print("Error:", e)
        sys.exit(1)

check_db()
