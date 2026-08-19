import sqlite3
from pathlib import Path

db_path = Path('db/predictions.db')
conn = sqlite3.connect(db_path)
cur = conn.cursor()
cur.execute("DELETE FROM predictions WHERE prediction_date < '2026-08-07'")
conn.commit()
deleted = cur.rowcount
print(f"✅ Cleared {deleted} synthetic backfill predictions from predictions.db!")
conn.close()
