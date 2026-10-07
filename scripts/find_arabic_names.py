import sqlite3
import os

print("--- Checking Arabic Names Across All DBs ---")
dbs = ['db/market.db', 'db/stocks.db', 'db/data_engine.db']
for db in dbs:
    if not os.path.exists(db): continue
    conn = sqlite3.connect(db)
    tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    for t in tables:
        cols = [c[1] for c in conn.execute(f"PRAGMA table_info({t})").fetchall()]
        ar_cols = [c for c in cols if 'ar' in c or 'name' in c]
        for c in ar_cols:
            try:
                cnt = conn.execute(f"SELECT COUNT(DISTINCT ticker) FROM {t} WHERE {c} GLOB '*[ا-ي]*'").fetchone()[0]
                if cnt > 0:
                    print(f"  {db} -> Table {t}, Column {c}: {cnt} tickers with Arabic names!")
            except:
                try:
                    cnt = conn.execute(f"SELECT COUNT(DISTINCT symbol) FROM {t} WHERE {c} GLOB '*[ا-ي]*'").fetchone()[0]
                    if cnt > 0:
                        print(f"  {db} -> Table {t}, Column {c}: {cnt} symbols with Arabic names!")
                except:
                    pass
    conn.close()
