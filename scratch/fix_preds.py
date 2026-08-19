import sqlite3

def fix_predictions():
    conn = sqlite3.connect('/home/meme/my_apps/GLMinvestment/db/predictions.db')
    conn.execute("UPDATE predictions SET exit_type = 'target_hit', is_correct = 1 WHERE status = 'WIN'")
    conn.execute("UPDATE predictions SET exit_type = 'stop_loss', is_correct = 0 WHERE status = 'LOSS'")
    conn.commit()
    print("Fixed predictions exit_type and is_correct.")

fix_predictions()
