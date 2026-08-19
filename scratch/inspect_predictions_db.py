import sqlite3
import json

conn = sqlite3.connect('db/predictions.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
print("Tables in db/predictions.db:", tables)

for t in tables:
    count = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    print(f"Table '{t}': {count} rows")
    if t == 'predictions':
        cur.execute("SELECT persona, outcome_date, exit_type, is_correct, COUNT(*) as cnt FROM predictions GROUP BY persona, outcome_date IS NOT NULL, exit_type")
        for r in cur.fetchall():
            print("  predictions summary:", dict(r))

conn.close()
