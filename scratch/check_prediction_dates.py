import sqlite3

conn = sqlite3.connect('db/predictions.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("SELECT created_at, prediction_date, outcome_date, persona, exit_type, COUNT(*) as cnt FROM predictions GROUP BY substr(created_at, 1, 7), persona, exit_type ORDER BY created_at DESC")
rows = cur.fetchall()
for r in rows:
    print(dict(r))

conn.close()
