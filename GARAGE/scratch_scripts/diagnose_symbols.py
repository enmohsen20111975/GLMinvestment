import sqlite3

for db_name in ['stocks.db', 'data_engine.db']:
    path = f'/home/meme/my_apps/GLMinvestment/db/{db_name}'
    try:
        conn = sqlite3.connect(path)
        cur = conn.cursor()
        print(f'=== {db_name} ===')
        tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        print('Tables:', tables)
        for t in ['stocks', 'stock_prices', 'market_data']:
            if t in tables:
                rows = cur.execute(f"SELECT ticker, name, name_ar, market FROM {t} WHERE ticker LIKE '%EDBM%' OR ticker LIKE '%ADP%'").fetchall()
                print(f'{t} matches:', rows)
    except Exception as e:
        print(f'{db_name} error:', e)
