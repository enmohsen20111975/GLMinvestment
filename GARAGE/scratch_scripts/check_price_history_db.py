import sqlite3

try:
    conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/price_history.db')
    tables = [r[0] for r in conn.execute("SELECT name, type FROM sqlite_master WHERE type IN ('table','view')").fetchall()]
    print('Tables/Views in price_history.db:', tables)
    for t, tp in conn.execute("SELECT name, type FROM sqlite_master WHERE type IN ('table','view')").fetchall():
        cnt = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
        print(f"  {tp} {t}: {cnt} rows")
except Exception as e:
    print('Error in price_history.db:', e)
