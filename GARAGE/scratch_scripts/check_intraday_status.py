import sqlite3
import os

for path in ['/home/meme/my_apps/GLMinvestment/db/intraday.db', '/home/meme/my_apps/GLMinvestment/db/stocks.db']:
    if not os.path.exists(path):
        print(f'{path} not found')
        continue
    conn = sqlite3.connect(path)
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print(f'=== {path} ===')
    for t in tables:
        if 'intraday' in t or 'trade' in t or 'pressure' in t or 'flow' in t:
            count = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(f'  Table {t}: {count} rows')
            if count > 0:
                cols = [c[1] for c in conn.execute(f"PRAGMA table_info({t})").fetchall()]
                if 'ticker' in cols:
                    tickers = [r[0] for r in conn.execute(f"SELECT DISTINCT ticker FROM {t} LIMIT 20").fetchall()]
                    print(f'    sample tickers: {tickers}')
