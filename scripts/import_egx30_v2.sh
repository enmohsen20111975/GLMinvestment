#!/bin/bash
# WSL script to import EGX30 CSV into price_history.db

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BASE="$SCRIPT_DIR/.."
CSV_PATH="$BASE/db/بيانات تاريخية - مؤشر EGX 30.csv"
DB_PATH="$BASE/db/price_history.db"
SYMBOL="EGX30"

# Clean WAL/SHM files
rm -f "$DB_PATH-wal" "$DB_PATH-shm" 2>/dev/null

python3 << PYEOF
import csv, os, sqlite3, sys
from pathlib import Path
from datetime import datetime

BASE = str(Path(__file__).resolve().parents[1]) if '__file__' in dir() else "$SCRIPT_DIR/.."
# For inline script, use script directory
BASE = str(Path("$SCRIPT_DIR").resolve().parent)
CSV_PATH = os.path.join(BASE, "db", "بيانات تاريخية - مؤشر EGX 30.csv")
DB_PATH = os.path.join(BASE, "db", "price_history.db")
SYMBOL = "EGX30"

def clean_str(s):
    return s.replace("\u200f","").replace("\u200e","").strip()

rows = []
with open(CSV_PATH, encoding="utf-8-sig") as f:
    reader = csv.reader(f)
    h = next(reader)
    print("Headers:", h)
    for r in reader:
        if not r or len(r) < 7:
            continue
        d = datetime.strptime(clean_str(r[0]), "%d/%m/%Y").strftime("%Y-%m-%d")
        cl = float(clean_str(r[1]).replace(",",""))
        op = float(clean_str(r[2]).replace(",",""))
        hi = float(clean_str(r[3]).replace(",",""))
        lo = float(clean_str(r[4]).replace(",",""))
        vs = clean_str(r[5]).upper()
        if "M" in vs:
            vol = int(float(vs.replace("M","")) * 1_000_000)
        elif "K" in vs:
            vol = int(float(vs.replace("K","")) * 1_000)
        else:
            vol = int(float(vs))
        chg = float(clean_str(r[6]).replace("%","").replace("+",""))
        rows.append((SYMBOL, d, op, hi, lo, cl, vol, chg))

print(f"Parsed {len(rows)} rows. Range: {rows[-1][1]} -> {rows[0][1]}")

os.remove(DB_PATH + "-wal") if os.path.exists(DB_PATH + "-wal") else None
os.remove(DB_PATH + "-shm") if os.path.exists(DB_PATH + "-shm") else None

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA journal_mode=DELETE")
cur = conn.cursor()

cur.execute("""
    CREATE TABLE IF NOT EXISTS index_daily_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        price_date TEXT NOT NULL,
        open REAL, high REAL, low REAL,
        close REAL NOT NULL,
        volume INTEGER,
        change_percent REAL,
        source TEXT DEFAULT 'user_upload',
        created_at TEXT DEFAULT (datetime('now','localtime')),
        UNIQUE(symbol, price_date)
    )
""")
cur.execute("DELETE FROM index_daily_prices WHERE symbol=?", (SYMBOL,))

for r in rows:
    try:
        cur.execute(
            "INSERT INTO index_daily_prices (symbol,price_date,open,high,low,close,volume,change_percent) VALUES (?,?,?,?,?,?,?,?)",
            r,
        )
    except sqlite3.IntegrityError:
        pass

conn.commit()
cur.execute("SELECT COUNT(*), MIN(price_date), MAX(price_date) FROM index_daily_prices WHERE symbol=?", (SYMBOL,))
cnt, mn, mx = cur.fetchone()
print(f"SUCCESS: {cnt} EGX30 rows in price_history.db, range {mn} -> {mx}")
conn.close()
PYEOF