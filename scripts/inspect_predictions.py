import sqlite3

def inspect_db():
    conn = sqlite3.connect('db/stocks.db')
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print("Tables in stocks.db:", tables)

    for tbl in tables:
        if 'pred' in tbl or 'rec' in tbl or 'expert' in tbl or 'analysis' in tbl:
            print(f"\n=== Table: {tbl} ===")
            cols = [c[1] for c in cur.execute(f"PRAGMA table_info({tbl})").fetchall()]
            print("Columns:", cols)
            rows = cur.execute(f"SELECT * FROM {tbl} LIMIT 10").fetchall()
            for r in rows:
                print(dict(r))

if __name__ == '__main__':
    inspect_db()
