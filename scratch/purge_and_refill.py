import sqlite3
from pathlib import Path

db_path = Path('db/predictions.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.execute("DELETE FROM predictions")
cur.execute("DELETE FROM stored_analyses")
cur.execute("DELETE FROM learned_lessons")
conn.commit()
print("✅ Purged predictions table completely!")
conn.close()
