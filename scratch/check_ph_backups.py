import sqlite3

def check(filename):
    try:
        conn = sqlite3.connect(f'db/{filename}')
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        print(f"File '{filename}': {len(tables)} tables -> {tables}")
        for t in tables:
            cnt = conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
            print(f"   Table '{t}': {cnt} rows")
        conn.close()
    except Exception as e:
        print(f"Error checking {filename}: {e}")

check('price_history.db.backup_20260723_155413')
check('price_history_original.db')
