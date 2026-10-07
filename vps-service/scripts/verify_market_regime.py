import sqlite3
from pathlib import Path

# P23-PORTABILITY: مسار نسبي من __file__ — parents[2] = project_root.
# verify_market_regime.py موجود في: <project_root>/vps-service/scripts/verify_market_regime.py
_DB_PATH = str(Path(__file__).resolve().parents[2] / "db" / "price_history.db")

def check_schema():
    conn = sqlite3.connect(_DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT sql FROM sqlite_master WHERE name='price_history'")
    print("price_history schema:", cursor.fetchone())
    conn.close()

if __name__ == "__main__":
    check_schema()
