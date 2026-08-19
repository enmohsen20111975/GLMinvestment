import shutil
import sqlite3
from pathlib import Path

DB_DIR = Path('db')

print("--- Step 1: Restoring price_history.db ---")
backup_ph = DB_DIR / 'price_history.db.backup_20260723_155413'
target_ph = DB_DIR / 'price_history.db'

shutil.copy2(backup_ph, target_ph)
print(f"✅ Restored price_history.db ({target_ph.stat().st_size / (1024*1024):.1f} MB)")

conn_ph = sqlite3.connect(target_ph)
ph_count = conn_ph.execute("SELECT count(*) FROM price_history").fetchone()[0]
print(f"✅ Verified price_history rows: {ph_count}")
conn_ph.close()

print("\n--- Step 2: Activating all EGX stocks in stocks.db ---")
conn_stocks = sqlite3.connect(DB_DIR / 'stocks.db')
conn_stocks.execute("UPDATE stocks SET is_active = 1 WHERE market = 'EGX'")
conn_stocks.commit()
active_egx = conn_stocks.execute("SELECT count(*) FROM stocks WHERE is_active = 1 AND market = 'EGX'").fetchone()[0]
print(f"✅ Active EGX stocks count in stocks.db: {active_egx}")
conn_stocks.close()

print("\n--- Step 3: Clearing old hallucinated predictions in predictions.db ---")
conn_pred = sqlite3.connect(DB_DIR / 'predictions.db')
conn_pred.execute("DELETE FROM predictions")
conn_pred.execute("DELETE FROM stored_analyses")
conn_pred.execute("DELETE FROM learned_lessons")
conn_pred.commit()
print("✅ Cleared predictions, stored_analyses, and learned_lessons in predictions.db")
conn_pred.close()

print("\n--- All Restoration Steps Completed Successfully! ---")
