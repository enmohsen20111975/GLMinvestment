#!/usr/bin/env python3
"""
Import EGX30 historical daily prices from the uploaded CSV into stocks.db.

Creates a NEW table `index_daily_prices` (CREATE TABLE IF NOT EXISTS — golden rule:
no ALTER TABLE) holding historical OHLCV for market indices (EGX30 first).

Source CSV: upload/بيانات تاريخية - مؤشر EGX 30.csv
  Headers (Arabic): تاريخ, اخر سعر, سعر الفتح, عالي, منخفض, الحجم, التغير %
  Date format: DD/MM/YYYY (with RLM/LRM markers \u200f \u200e)
  Numbers: comma thousands separator, decimal point (e.g. "51,443.07")
  Volume:  "404.83M" (millions)
  Change:  "-0.52%"

This gives the Trend Filter (is_trend_up) and Relative Strength (Minervini)
calculators REAL market history instead of the 1-day snapshot in market_indices.
"""
import csv
import os
import re
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

_PROJECT_ROOT = Path(__file__).parent.parent.resolve()
CSV_PATH = str(_PROJECT_ROOT / "upload" / "بيانات تاريخية - مؤشر EGX 30.csv")
DB_PATH = str(_PROJECT_ROOT / "db" / "stocks.db")
SYMBOL = "EGX30"


def clean_str(s: str) -> str:
    """Remove Arabic right-to-left/left-to-right markers."""
    return s.replace("\u200f", "").replace("\u200e", "").replace("\u202a", "").replace("\u202c", "").strip()


def parse_date(raw: str) -> str:
    raw = clean_str(raw)
    return datetime.strptime(raw, "%d/%m/%Y").strftime("%Y-%m-%d")


def parse_num(raw: str) -> float:
    return float(clean_str(raw).replace(",", ""))


def parse_volume(raw: str) -> int:
    """Parse '404.83M' -> 404830000. Also handle K and raw integers."""
    s = clean_str(raw).upper()
    m = re.match(r"^([\d.]+)\s*([KM]?)$", s)
    if not m:
        try:
            return int(float(s))
        except ValueError:
            return 0
    val = float(m.group(1))
    unit = m.group(2)
    if unit == "M":
        val *= 1_000_000
    elif unit == "K":
        val *= 1_000
    return int(val)


def parse_change(raw: str) -> float:
    s = clean_str(raw).replace("%", "").replace("+", "").strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


def main() -> int:
    if not os.path.exists(CSV_PATH):
        print(f"ERROR: CSV not found: {CSV_PATH}")
        return 1
    if not os.path.exists(DB_PATH):
        print(f"ERROR: DB not found: {DB_PATH}")
        return 1

    rows = []
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        headers = next(reader)
        headers = [clean_str(h) for h in headers]
        for row in reader:
            if not row or len(row) < 7:
                continue
            try:
                d = parse_date(row[0])
                close = parse_num(row[1])
                open_ = parse_num(row[2])
                high = parse_num(row[3])
                low = parse_num(row[4])
                vol = parse_volume(row[5])
                chg = parse_change(row[6])
                rows.append((SYMBOL, d, open_, high, low, close, vol, chg))
            except Exception as e:
                print(f"WARN: skipped row {row}: {e}", file=sys.stderr)

    print(f"Parsed {len(rows)} rows. Date range: {rows[-1][1]} -> {rows[0][1]}")

    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    # Golden rule: CREATE TABLE IF NOT EXISTS (no ALTER TABLE)
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS index_daily_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            price_date TEXT NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL NOT NULL,
            volume INTEGER,
            change_percent REAL,
            source TEXT DEFAULT 'user_upload',
            created_at TEXT DEFAULT (datetime('now','localtime')),
            UNIQUE(symbol, price_date)
        )
        """
    )
    cur.execute("CREATE INDEX IF NOT EXISTS idx_index_dp_symbol_date ON index_daily_prices(symbol, price_date)")

    # Wipe existing EGX30 rows so re-imports are idempotent (INSERT OR REPLACE also works,
    # but a clean delete+insert avoids partial-state issues).
    cur.execute("DELETE FROM index_daily_prices WHERE symbol = ?", (SYMBOL,))
    inserted = 0
    for r in rows:
        try:
            cur.execute(
                """
                INSERT INTO index_daily_prices
                  (symbol, price_date, open, high, low, close, volume, change_percent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                r,
            )
            inserted += 1
        except sqlite3.IntegrityError:
            pass
    conn.commit()

    # Verify
    cur.execute("SELECT COUNT(*), MIN(price_date), MAX(price_date) FROM index_daily_prices WHERE symbol=?", (SYMBOL,))
    cnt, mn, mx = cur.fetchone()
    print(f"DB now has {cnt} EGX30 rows, range {mn} -> {mx}")

    # Also update the snapshot `market_indices` table's current_value/change_percent
    # so the 1-day path keeps working with the freshest row.
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='market_indices'")
    if cur.fetchone():
        cur.execute("SELECT close, change_percent FROM index_daily_prices WHERE symbol=? ORDER BY price_date DESC LIMIT 1", (SYMBOL,))
        latest = cur.fetchone()
        if latest:
            close, chg = latest
            cur.execute(
                """
                UPDATE market_indices
                   SET current_value=?, change_percent=?, last_update=datetime('now','localtime')
                 WHERE symbol=?
                """,
                (close, chg, SYMBOL),
            )
            conn.commit()
            print(f"Updated market_indices snapshot: EGX30 current_value={close}, change_percent={chg}")
    conn.close()
    print("DONE.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
