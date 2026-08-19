import sqlite3

try:
    conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/predictions.db')
    conn.row_factory = sqlite3.Row
    statuses = conn.execute("SELECT status, count(*) as c FROM predictions GROUP BY status").fetchall()
    print("Status counts in predictions:")
    for row in statuses:
        print(f"  {row['status']}: {row['c']}")
except Exception as e:
    print("Error:", e)
