import sqlite3

conn = sqlite3.connect('db/predictions.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

print("--- persona_predictions ---")
cur.execute("SELECT * FROM persona_predictions LIMIT 5")
for r in cur.fetchall():
    print(dict(r))

print("--- aiPrediction ---")
cur.execute("SELECT * FROM aiPrediction LIMIT 5")
for r in cur.fetchall():
    print(dict(r))

print("--- stored_analyses ---")
cur.execute("SELECT * FROM stored_analyses LIMIT 3")
for r in cur.fetchall():
    print(dict(r))

conn.close()
