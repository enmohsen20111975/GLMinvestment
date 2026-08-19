import sqlite3, datetime

conn = sqlite3.connect('db/predictions.db')
cur = conn.cursor()

for d in [7, 30, 90, 365]:
    cutoff = (datetime.datetime.now() - datetime.timedelta(days=d)).strftime('%Y-%m-%d')
    rows = cur.execute("""
        SELECT hit_target, hit_stop 
        FROM predictions 
        WHERE substr(COALESCE(NULLIF(prediction_date, ''), created_at), 1, 10) >= ?
    """, (cutoff,)).fetchall()
    
    wins = sum(1 for r in rows if r[0] == 1)
    losses = sum(1 for r in rows if r[1] == 1)
    settled = wins + losses
    wr = (wins / settled * 100) if settled > 0 else 0.0
    print(f"🗓️ Days Window: {d:3d} days => {len(rows):4d} predictions | Wins: {wins:3d} | Losses: {losses:3d} | Win Rate: {wr:5.1f}%")

conn.close()
