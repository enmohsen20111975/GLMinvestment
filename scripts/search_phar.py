import sqlite3

for db_name in ['stocks.db', 'data_engine.db']:
    path = f"/home/meme/my_apps/GLMinvestment/db/{db_name}"
    print(f"=== DB: {db_name} ===")
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(path, writable=False).__enter__()
    cur = conn.cursor()
    cur.execute("SELECT name FROM sqlite_master WHERE type='table';")
    tables = [r[0] for r in cur.fetchall()]
    for t in tables:
        cur.execute(f"PRAGMA table_info('{t}');")
        cols = [c[1] for c in cur.fetchall()]
        cname = 'ticker' if 'ticker' in cols else ('symbol' if 'symbol' in cols else None)
        if cname:
            cur.execute(f"SELECT * FROM {t} WHERE {cname} LIKE '%PHAR%' OR {cname} LIKE '%EPHC%' OR {cname} LIKE '%BIOC%' LIMIT 10")
            rows = cur.fetchall()
            if rows:
                print(f"  Table {t}: {len(rows)} matching rows")
                for r in rows:
                    d = dict(zip(cols, r))
                    print(f"    -> {d.get('symbol') or d.get('ticker')}: {d.get('name') or d.get('name_ar')}")
    conn.close()
