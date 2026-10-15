import sqlite3
import glob

for db_file in glob.glob('/home/meme/my_apps/GLMinvestment/db/*.db'):
    try:
        conn = sqlite3.connect(db_file)
        tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
        for t in tables:
            try:
                for row in conn.execute(f"SELECT * FROM \"{t}\" WHERE CAST(change_percent AS TEXT) LIKE '%32.9%' OR CAST(change AS TEXT) LIKE '%32.9%'").fetchall():
                    print(f"Found in {db_file} -> {t}: {row}")
            except Exception:
                pass
    except Exception:
        pass
