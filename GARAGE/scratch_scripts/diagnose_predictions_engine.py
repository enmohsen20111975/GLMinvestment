import sqlite3

conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/predictions.db')
cols = [r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()]
print("predictions.db.predictions columns:")
print(cols)
