import sqlite3

# Phase 7.1: migrated to db_manager (writable=False)
from core.db_manager import db_manager
conn = db_manager.connection('/home/meme/my_apps/GLMinvestment/db/predictions.db', writable=False).__enter__()
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = [r[0] for r in cur.fetchall()]
print('Tables:', tables)
for t in tables:
    cur.execute(f"PRAGMA table_info('{t}');")
    cols = [c[1] for c in cur.fetchall()]
    print(f'\n=== Table {t} cols: {cols}')
    cname = 'ticker' if 'ticker' in cols else ('stock_symbol' if 'stock_symbol' in cols else None)
    if cname:
        cur.execute(f"SELECT * FROM {t} WHERE {cname} IN ('RASIYAT', 'OOREDOO', '2120', 'AAYANRE', '3002')")
        rows = cur.fetchall()
        print(f'Matching non-EGX rows in {t}: {len(rows)}')
        for r in rows:
            d = dict(zip(cols, r))
            print("  ->", d)
conn.close()
