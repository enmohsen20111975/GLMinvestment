import sqlite3
import os

try:
    conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/predictions.db')
    conn.row_factory = sqlite3.Row
    first = conn.execute("SELECT * FROM predictions LIMIT 1").fetchone()
    print("predictions first row:", dict(first) if first else "empty")
except Exception as e:
    print("Error:", e)
