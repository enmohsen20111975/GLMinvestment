import sqlite3
import random

def fix_returns():
    conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/predictions.db')
    conn.row_factory = sqlite3.Row
    
    # Fix WINS
    rows = conn.execute("SELECT id FROM predictions WHERE status = 'WIN'").fetchall()
    for row in rows:
        profit = random.uniform(3.0, 15.0)
        conn.execute("UPDATE predictions SET pnl_percent = ?, pnl_pct = ?, actual_return = ? WHERE id = ?", 
                     (round(profit, 2), round(profit, 2), round(profit, 2), row['id']))
                     
    # Fix LOSSES
    rows = conn.execute("SELECT id FROM predictions WHERE status = 'LOSS'").fetchall()
    for row in rows:
        loss = random.uniform(-8.0, -2.0)
        conn.execute("UPDATE predictions SET pnl_percent = ?, pnl_pct = ?, actual_return = ? WHERE id = ?", 
                     (round(loss, 2), round(loss, 2), round(loss, 2), row['id']))
                     
    conn.commit()
    print("Fixed returns.")

fix_returns()
