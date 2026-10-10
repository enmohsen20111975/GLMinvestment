#!/usr/bin/env python3
"""
GLMinvestment — Import EGX30 index daily history into production databases.

Source CSV (Arabic headers):
  تاريخ, اخر سعر, سعر الفتح, عالي, منخفض, الحجم, التغير %
  Date format: DD/MM/YYYY (with RLM/LRM markers \u200f \u200e)
  Numbers: comma thousands separator, decimal point (e.g. "52,928.06")
  Volume:  "363.06M" (millions) / "176.40M"
  Change:  "0.70%"

What it does (idempotent, safe to re-run daily):
  1. Parses the EGX30 CSV (default: db/EGX30-5 years ago-<date>.csv).
  2. Loads every daily OHLCV row into stocks.db -> stock_daily_prices (ticker='EGX30').
     Uses INSERT OR IGNORE on UNIQUE(ticker, price_date) so new daily rows append
     without clobbering existing history.
  3. Refreshes the market_indices EGX30 snapshot (current_value, previous_close,
     change_percent, last_update) from the latest CSV row so beta / trend filters
     and the lightweight API serve fresh data.
  4. Logs a summary to db/backups/egx30_import.log.

Usage:
  python3 scripts/import_egx30_production.py
  python3 scripts/import_egx30_production.py "db/EGX30-5 years ago-18-07-2026.csv"

Golden rules respected:
  - CREATE TABLE IF NOT EXISTS (no ALTER TABLE).
  - INSERT OR IGNORE keeps it idempotent for daily runs.
  - No new UI / no new endpoints; reuses the existing stock_daily_prices + market_indices.
"""
import csv
import os
import re
import sys
import glob
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = str(PROJECT_ROOT / "db" / "stocks.db")
SYMBOL = "EGX30"
LOG_PATH = str(PROJECT_ROOT / "db" / "backups" / "egx30_import.log")


def log(msg: str) -> None:
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] {msg}"
    print(line)
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def find_csv(explicit: str | None) -> str:
    if explicit:
        p = Path(explicit)
        if not p.is_absolute():
            p = PROJECT_ROOT / p
        if p.exists():
            return str(p)
        raise FileNotFoundError(f"CSV not found: {p}")
    # default: latest EGX30 CSV in db/
    candidates = sorted(
        glob.glob(str(PROJECT_ROOT / "db" / "EGX30*.csv")),
        key=lambda x: os.path.getmtime(x),
        reverse=True,
    )
    if not candidates:
        raise FileNotFoundError("No EGX30*.csv found in db/")
    return candidates[0]


def clean_str(s: str) -> str:
    return (
        s.replace("\u200f", "")
        .replace("\u200e", "")
        .replace("\u202a", "")
        .replace("\u202c", "")
        .strip()
    )


def parse_date(raw: str) -> str:
    return datetime.strptime(clean_str(raw), "%d/%m/%Y").strftime("%Y-%m-%d")


def parse_num(raw: str) -> float:
    return float(clean_str(raw).replace(",", ""))


def parse_volume(raw: str) -> int:
    s = clean_str(raw).upper()
    m = re.match(r"^([\d.]+)\s*([BKMGTPE]?)$", s)
    if not m:
        try:
            return int(float(s))
        except ValueError:
            return 0
    val = float(m.group(1))
    unit = m.group(2)
    mult = {"B": 1_000_000_000, "M": 1_000_000, "K": 1_000}
    return int(val * mult.get(unit, 1))


def parse_change(raw: str) -> float:
    s = clean_str(raw).replace("%", "").replace("+", "").strip()
    try:
        return float(s)
    except ValueError:
        return 0.0


def main() -> int:
    explicit = sys.argv[1] if len(sys.argv) > 1 else None
    try:
        csv_path = find_csv(explicit)
    except FileNotFoundError as e:
        log(f"ERROR: {e}")
        return 1
    if not os.path.exists(DB_PATH):
        log(f"ERROR: DB not found: {DB_PATH}")
        return 1

    log(f"CSV source: {csv_path}")

    rows = []
    with open(csv_path, encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        headers = [clean_str(h) for h in next(reader)]
        log(f"Headers: {headers}")
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
                log(f"WARN: skipped row {row}: {e}")

    if not rows:
        log("ERROR: no rows parsed")
        return 1

    # newest first in CSV; sort ascending for previous_close derivation
    rows.sort(key=lambda r: r[1])
    log(f"Parsed {len(rows)} rows. Range: {rows[0][1]} -> {rows[-1][1]}")

    import sqlite3

    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA journal_mode=WAL")
    cur = conn.cursor()

    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS stock_daily_prices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            price_date TEXT NOT NULL,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume INTEGER,
            change_percent REAL,
            fetch_time TEXT,
            UNIQUE(ticker, price_date)
        )
        """
    )

    inserted = 0
    for r in rows:
        try:
            cur.execute(
                """
                INSERT OR IGNORE INTO stock_daily_prices
                  (ticker, price_date, open, high, low, close, volume, change_percent)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                r,
            )
            if cur.rowcount == 1:
                inserted += 1
        except sqlite3.Error as e:
            log(f"WARN: insert failed {r[1]}: {e}")

    conn.commit()

    cur.execute(
        "SELECT COUNT(*), MIN(price_date), MAX(price_date) FROM stock_daily_prices WHERE ticker=?",
        (SYMBOL,),
    )
    cnt, mn, mx = cur.fetchone()
    log(f"stock_daily_prices EGX30: {cnt} total rows, range {mn} -> {mx}, +{inserted} new")

    # Refresh market_indices snapshot from latest row
    latest = rows[-1]
    latest_date, latest_open, latest_high, latest_low, latest_close, latest_vol, latest_chg = (
        latest[1], latest[2], latest[3], latest[4], latest[5], latest[6], latest[7]
    )
    # previous_close = close of the day before latest (by date order)
    prev_close = rows[-2][5] if len(rows) > 1 else latest_open

    cur.execute("SELECT symbol FROM market_indices WHERE symbol=?", (SYMBOL,))
    if cur.fetchone():
        cur.execute(
            """
            UPDATE market_indices
               SET current_value=?, previous_close=?, change_percent=?,
                   last_update=datetime('now','localtime')
             WHERE symbol=?
            """,
            (latest_close, prev_close, latest_chg, SYMBOL),
        )
    else:
        cur.execute(
            """
            INSERT INTO market_indices
              (symbol, name, name_ar, current_value, previous_close, change_percent, last_update)
            VALUES (?, 'EGX 30 Index', 'مؤشر EGX 30', ?, ?, ?, datetime('now','localtime'))
            """,
            (SYMBOL, latest_close, prev_close, latest_chg),
        )
    conn.commit()

    cur.execute(
        "SELECT symbol, current_value, previous_close, change_percent, last_update FROM market_indices WHERE symbol=?",
        (SYMBOL,),
    )
    log(f"market_indices snapshot refreshed: {cur.fetchone()}")

    conn.close()
    log("DONE.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
