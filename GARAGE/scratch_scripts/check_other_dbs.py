import sqlite3
import os

for path in ['/home/meme/my_apps/GLMinvestment/db/data_engine.db', '/home/meme/my_apps/GLMinvestment/db/predictions.db']:
    if not os.path.exists(path):
        continue
    conn = sqlite3.connect(path)
    print(f'=== {path} ===')
    for t, tp in conn.execute("SELECT name, type FROM sqlite_master WHERE type IN ('table','view')").fetchall():
        if 'price' in t or 'history' in t or 'pred' in t:
            cnt = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(f"  {tp} {t}: {cnt} rows")
