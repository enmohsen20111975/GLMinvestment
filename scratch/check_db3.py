import sqlite3
import os

try:
    conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/predictions.db')
    conn.row_factory = sqlite3.Row
    print("predictions rows:", conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0])
except Exception as e:
    print("Error:", e)
