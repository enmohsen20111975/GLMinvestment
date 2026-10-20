import sqlite3
import os
import glob

base = "/home/meme/my_apps/GLMinvestment"
print("Searching for .db files in:", base)

db_files = glob.glob(base + "/**/*.db", recursive=True) + glob.glob(base + "/*.db")
print("Found DB files:", db_files)

for db_file in db_files:
    print(f"\n--- DB: {db_file} ---")
    try:
        conn = sqlite3.connect(f"file:{db_file}?mode=ro", uri=True)
        c = conn.cursor()
        c.execute("SELECT name FROM sqlite_master WHERE type='table';")
        tables = [t[0] for t in c.fetchall()]
        print("Tables:", tables)
        for tbl in tables:
            try:
                c.execute(f"PRAGMA table_info({tbl})")
                cols = [col[1] for col in c.fetchall()]
                d_col = next((col for col in ['date', 'timestamp', 'created_at', 'last_updated', 'updated_at', 'time'] if col in cols), None)
                if d_col:
                    max_v = c.execute(f"SELECT max({d_col}) FROM {tbl}").fetchone()[0]
                    cnt = c.execute(f"SELECT count(*) FROM {tbl}").fetchone()[0]
                    print(f"  {tbl} ({cnt} rows): max({d_col}) = {max_v}")
                else:
                    cnt = c.execute(f"SELECT count(*) FROM {tbl}").fetchone()[0]
                    print(f"  {tbl} ({cnt} rows)")
            except Exception as ex:
                print(f"  Err on table {tbl}: {ex}")
        conn.close()
    except Exception as e:
        print("Err opening:", e)
