import sqlite3
import json

def audit(db_name):
    path = f"/home/meme/my_apps/GLMinvestment/db/{db_name}"
    print(f"=== {db_name} ===")
    try:
        conn = sqlite3.connect(path)
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [r[0] for r in cur.fetchall()]
        for t in tables:
            cur.execute(f"PRAGMA table_info('{t}');")
            cols = [c[1] for c in cur.fetchall()]
            cname = 'ticker' if 'ticker' in cols else ('symbol' if 'symbol' in cols else None)
            if cname:
                cur.execute(f"SELECT * FROM {t} WHERE {cname} LIKE '%DTPP%' LIMIT 1")
                row = cur.fetchone()
                if row:
                    d = dict(zip(cols, row))
                    if 'tabs_data' in d and d['tabs_data']:
                        print(f"Table {t} HAS TABS_DATA!")
                        try:
                            td = json.loads(d['tabs_data'])
                            for tk, tv in td.items():
                                if isinstance(tv, dict):
                                    print(f"  TAB [{tk}]: headers={tv.get('headers')} | values={tv.get('values')}")
                        except Exception as e:
                            print(f"  JSON parse error: {e}")
                        del d['tabs_data']
                    print(f"Table {t}: {d}")
        conn.close()
    except Exception as err:
        print(f"Error: {err}")

audit("data_engine.db")
audit("stocks.db")
