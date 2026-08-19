import sqlite3
from datetime import datetime, timedelta

conn = sqlite3.connect('db/predictions.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

for days in (7, 30, 90, 365, 0):
    if days > 0:
        cutoff = (datetime.now() - timedelta(days=days)).strftime('%Y-%m-%d')
        cur.execute(
            "SELECT COUNT(*) as total, SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END) as closed, "
            "SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as wins "
            "FROM predictions WHERE market = 'EGX' AND (substr(created_at,1,10) >= ? OR substr(prediction_date,1,10) >= ?)",
            (cutoff, cutoff)
        )
    else:
        cur.execute(
            "SELECT COUNT(*) as total, SUM(CASE WHEN outcome_date IS NOT NULL THEN 1 ELSE 0 END) as closed, "
            "SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) as wins "
            "FROM predictions WHERE market = 'EGX'"
        )
    r = dict(cur.fetchone())
    print(f"Days={days:3d}: Total={r['total']:5d}, Closed={r['closed']:5d}, Wins={r['wins']:5d}")

conn.close()
