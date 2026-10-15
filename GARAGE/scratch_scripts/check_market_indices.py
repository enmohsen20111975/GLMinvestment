import sqlite3

conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/stocks.db')
rows = conn.execute("SELECT * FROM market_indices").fetchall()
cols = [c[1] for c in conn.execute("PRAGMA table_info(market_indices)").fetchall()]
print('Columns:', cols)
for r in rows:
    print(dict(zip(cols, r)))
