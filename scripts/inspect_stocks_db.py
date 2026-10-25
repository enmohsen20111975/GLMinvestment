import sqlite3

# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn = db_manager.connection('/home/meme/my_apps/GLMinvestment/db/stocks.db', writable=False).__enter__()
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = [r[0] for r in cur.fetchall()]
print('Tables in stocks.db:', tables)
for t in tables:
    cur.execute(f"PRAGMA table_info('{t}');")
    cols = [c[1] for c in cur.fetchall()]
    print(f'Table {t} cols:', cols)
    cur.execute(f"SELECT COUNT(*) FROM {t};")
    cnt = cur.fetchone()[0]
    print(f'Count in {t}:', cnt)

cur.execute("SELECT ticker, name, market FROM stocks LIMIT 10;")
print("\nSample stocks:", cur.fetchall())
conn.close()
