#!/usr/bin/env python3
"""Import EGX30 historical daily prices into price_history.db"""
import csv, os, sqlite3, re, sys
from datetime import datetime

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_PATH = os.path.join(BASE, "db", "بيانات تاريخية - مؤشر EGX 30.csv")
DB_PATH = os.path.join(BASE, "db", "price_history.db")
SYMBOL = "EGX30"

def clean_str(s):
    return s.replace("\u200f","").replace("\u200e","").strip()

def parse_volume(vs):
    vs = clean_str(vs).upper().replace(",","")
    m = re.match(r"^([\d.]+)\s*([BKMGTPE]?)$", vs)
    if not m:
        try: return int(float(vs))
        except: return 0
    val = float(m.group(1))
    unit = m.group(2)
    mult = {"B": 1_000_000_000, "M": 1_000_000, "K": 1_000}
    return int(val * mult.get(unit, 1))

rows = []
with open(CSV_PATH, encoding="utf-8-sig") as f:
    reader = csv.reader(f)
    h = next(reader)
    print("Headers:", h)
    for r in reader:
        if not r or len(r) < 7: continue
        try:
            d = datetime.strptime(clean_str(r[0]), "%d/%m/%Y").strftime("%Y-%m-%d")
            cl = float(clean_str(r[1]).replace(",",""))
            op = float(clean_str(r[2]).replace(",",""))
            hi = float(clean_str(r[3]).replace(",",""))
            lo = float(clean_str(r[4]).replace(",",""))
            vol = parse_volume(r[5])
            chg = float(clean_str(r[6]).replace("%","").replace("+",""))
            rows.append((SYMBOL, d, op, hi, lo, cl, vol, chg))
        except Exception as e:
            sys.stderr.write(f"WARN: {r}: {e}\n")

print(f"Parsed {len(rows)} rows. Range: {rows[-1][1]} -> {rows[0][1]}")

# Clean WAL/SHM files
for ext in ["-wal", "-shm"]:
    f = DB_PATH + ext
    if os.path.exists(f): os.remove(f)

conn = sqlite3.connect(DB_PATH)
conn.execute("PRAGMA journal_mode=DELETE")
cur = conn.cursor()

cur.execute("""
    CREATE TABLE IF NOT EXISTS index_daily_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL, price_date TEXT NOT NULL,
        open REAL, high REAL, low REAL,
        close REAL NOT NULL, volume INTEGER,
        change_percent REAL, source TEXT DEFAULT 'user_upload',
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