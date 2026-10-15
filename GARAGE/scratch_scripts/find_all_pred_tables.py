import sqlite3
import glob

for db_file in sorted(glob.glob('/home/meme/my_apps/GLMinvestment/db/*.db')):
    try:
        conn = sqlite3.connect(db_file)
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        for t in tables:
            if 'pred' in t.lower() or 'aipred' in t.lower():
                cnt = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
                print(f'{db_file} -> {t}: {cnt} rows')
    except Exception as e:
        pass
