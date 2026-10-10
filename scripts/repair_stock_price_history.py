import sqlite3
import shutil
from pathlib import Path

DB_DIR = Path("/home/meme/my_apps/GLMinvestment/db")
stocks_db_path = DB_DIR / "stocks.db"
ph_db_path = DB_DIR / "price_history.db"

print("=== REPAIRING STOCK_PRICE_HISTORY ===")

# 1. Backup stocks.db
backup_path = DB_DIR / "stocks.db.before_repair"
print(f"Backing up stocks.db to {backup_path}...")
shutil.copy2(stocks_db_path, backup_path)
print("Backup complete.")

# 2. Connect to databases
stocks_conn = sqlite3.connect(str(stocks_db_path))
ph_conn = sqlite3.connect(str(ph_db_path))

stocks_cursor = stocks_conn.cursor()
ph_cursor = ph_conn.cursor()

# 3. Recreate stock_price_history in stocks.db with correct schema
print("Recreating stock_price_history table in stocks.db...")
stocks_cursor.execute("DROP TABLE IF EXISTS stock_price_history")
stocks_cursor.execute("""
    CREATE TABLE stock_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticker TEXT,
        date TEXT,
        open_price REAL,
        high_price REAL,
        low_price REAL,
        close_price REAL,
        volume INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
""")
stocks_conn.commit()

# Create unique index to avoid duplicates
stocks_cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_price_history_ticker_date ON stock_price_history (ticker, date)")
stocks_conn.commit()

# 4. Copy rows from price_history.db -> price_history to stocks.db -> stock_price_history
print("Copying clean records from price_history.db to stocks.db...")
ph_cursor.execute("SELECT ticker, date, open_price, high_price, low_price, close_price, volume, created_at FROM price_history")

batch_size = 5000
total_copied = 0

while True:
    rows = ph_cursor.fetchmany(batch_size)
    if not rows:
        break
    
    stocks_cursor.executemany("""
        INSERT OR IGNORE INTO stock_price_history 
        (ticker, date, open_price, high_price, low_price, close_price, volume, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, rows)
    
    total_copied += len(rows)
    print(f"  Copied {total_copied} rows...")

stocks_conn.commit()
print(f"Successfully copied {total_copied} clean records.")

# 5. Let's check the result in stocks.db for TYCN and ESRS
print("\n=== VERIFYING REPAIRED DATA ===")
for ticker in ['TYCN', 'ESRS']:
    stocks_cursor.execute("SELECT COUNT(*), MIN(close_price), MAX(close_price) FROM stock_price_history WHERE ticker = ?", (ticker,))
    print(f"repaired stock_price_history ({ticker}):", stocks_cursor.fetchone())

stocks_conn.close()
ph_conn.close()

print("\nVacuuming stocks.db to recover space...")
conn = sqlite3.connect(str(stocks_db_path))
try:
    conn.execute("VACUUM")
    print("Vacuum complete.")
except Exception as e:
    print("Vacuum failed:", e)
conn.close()
