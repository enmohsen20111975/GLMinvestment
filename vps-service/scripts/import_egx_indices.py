#!/usr/bin/env python3
"""
Import EGX30 and EGX100 index data from CSV files into price_history.db.

CSV format (Arabic headers):
  "تاريخ","اخر سعر","سعر الفتح","عالي","منخفض","الحجم","التغير %"
  Date, Close, Open, High, Low, Volume, Change%

Special handling:
  - BOM at file start
  - Arabic Unicode marks (U+200F) in date strings
  - DD/MM/YYYY date format -> YYYY-MM-DD
  - Comma thousands separators in numbers
  - Volume suffixes: M=millions, B=billions
  - Reverse chronological order -> sorted ascending
"""

import csv
import sqlite3
import re
import os
from pathlib import Path

# P23-PORTABILITY: مسارات نسبية من __file__ (مش hardcoded) — يشتغل في كل البيئات.
# import_egx_indices.py موجود في: <project_root>/vps-service/scripts/import_egx_indices.py
# فـ parents[2] = project_root (اللي فيه db/ و upload/).
_PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = str(_PROJECT_ROOT / "db" / "price_history.db")
CSV_FILES = {
    "EGX30": str(_PROJECT_ROOT / "upload" / "EGX30.csv"),
    "EGX100": str(_PROJECT_ROOT / "upload" / "EGX100.csv"),
}

# Arabic column names
COL_DATE = "تاريخ"
COL_CLOSE = "اخر سعر"
COL_OPEN = "سعر الفتح"
COL_HIGH = "عالي"
COL_LOW = "منخفض"
COL_VOLUME = "الحجم"


def parse_date(raw: str) -> str:
    """Convert '25‏/06‏/2026' -> '2026-06-25', stripping Arabic marks."""
    # Strip BOM, zero-width marks, RTL marks, etc.
    cleaned = re.sub(r"[\u200e\u200f\u202a-\u202e\ufeff]", "", raw).strip()
    # Now expect DD/MM/YYYY
    parts = cleaned.split("/")
    if len(parts) != 3:
        raise ValueError(f"Unexpected date format: {raw!r} -> cleaned: {cleaned!r}")
    day, month, year = parts
    return f"{year}-{month.zfill(2)}-{day.zfill(2)}"


def parse_number(raw: str) -> float:
    """Remove comma thousands separators and return float."""
    cleaned = raw.strip().replace(",", "")
    return float(cleaned)


def parse_volume(raw: str) -> int:
    """Convert volume string like '404.83M' or '1.10B' to integer."""
    cleaned = raw.strip().replace(",", "")
    if not cleaned:
        return 0
    if cleaned.upper().endswith("B"):
        return int(float(cleaned[:-1]) * 1_000_000_000)
    elif cleaned.upper().endswith("M"):
        return int(float(cleaned[:-1]) * 1_000_000)
    elif cleaned.upper().endswith("K"):
        return int(float(cleaned[:-1]) * 1_000)
    else:
        return int(float(cleaned))


def read_csv(filepath: str) -> list[dict]:
    """Read the Arabic-format CSV and return list of parsed row dicts."""
    rows = []
    with open(filepath, "r", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                parsed = {
                    "date": parse_date(row[COL_DATE]),
                    "close_price": parse_number(row[COL_CLOSE]),
                    "open_price": parse_number(row[COL_OPEN]),
                    "high_price": parse_number(row[COL_HIGH]),
                    "low_price": parse_number(row[COL_LOW]),
                    "volume": parse_volume(row[COL_VOLUME]),
                }
                rows.append(parsed)
            except Exception as e:
                print(f"  WARNING: Skipping row due to error: {e}")
                print(f"    Row data: {row}")
    # Data is reverse chronological; sort ascending by date
    rows.sort(key=lambda r: r["date"])
    return rows


def import_ticker(ticker: str, filepath: str, conn: sqlite3.Connection) -> int:
    """Import one CSV file into the database. Returns count of inserted rows."""
    print(f"\n{'='*60}")
    print(f"Importing {ticker} from {filepath}")
    print(f"{'='*60}")

    rows = read_csv(filepath)
    print(f"  Parsed {len(rows)} rows")

    if not rows:
        print("  No rows to import!")
        return 0

    print(f"  Date range: {rows[0]['date']} to {rows[-1]['date']}")
    print(f"  Sample (first 3):")
    for r in rows[:3]:
        print(f"    {r['date']}  O={r['open_price']}  H={r['high_price']}  "
              f"L={r['low_price']}  C={r['close_price']}  V={r['volume']}")

    inserted = 0
    cursor = conn.cursor()
    for r in rows:
        cursor.execute("""
            INSERT OR REPLACE INTO price_history
                (ticker, date, open_price, high_price, low_price, close_price, volume, source)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            ticker,
            r["date"],
            r["open_price"],
            r["high_price"],
            r["low_price"],
            r["close_price"],
            r["volume"],
            "egx_index",
        ))
        inserted += 1

    conn.commit()
    print(f"  Inserted/Replaced: {inserted} rows")
    return inserted


def main():
    print("EGX Index Data Import")
    print("=" * 60)
    print(f"Database: {DB_PATH}")

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(DB_PATH, writable=False)

    totals = {}
    for ticker, filepath in CSV_FILES.items():
        if not os.path.exists(filepath):
            print(f"\nERROR: File not found: {filepath}")
            totals[ticker] = 0
            continue
        count = import_ticker(ticker, filepath, conn)
        totals[ticker] = count

    # Summary
    print(f"\n{'='*60}")
    print("IMPORT SUMMARY")
    print(f"{'='*60}")
    for ticker, count in totals.items():
        # Verify from DB
        db_count = conn.execute(
            f"SELECT COUNT(*) FROM price_history WHERE ticker=? AND source='egx_index'",
            (ticker,)
        ).fetchone()[0]
        date_range = conn.execute(
            f"SELECT MIN(date), MAX(date) FROM price_history WHERE ticker=? AND source='egx_index'",
            (ticker,)
        ).fetchone()
        print(f"  {ticker}: {count} rows imported, {db_count} in DB, "
              f"date range: {date_range[0]} to {date_range[1]}")

    conn.close()
    print("\nDone!")


if __name__ == "__main__":
    main()
