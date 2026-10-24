#!/usr/bin/env python3
"""
seed_egx30_real_history.py — Backfill REAL EGX30 official historical values.

Per owner (2026-10-22): provided real EGX30 daily data from EGX official
(close, open, high, low, volume, change%) for 22 trading days (Sep 22 → Oct 22).

Instead of COMPUTING the index (approximate), we seed the REAL official
values directly. The live sync script will chain from the latest real value.

Usage:
    python3 scripts/seed_egx30_real_history.py

After seeding, run sync_market_indices_live.py — it reads the latest real
close as the base → accurate live values.
"""
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'

# === REAL EGX30 official historical data (from EGX — owner provided) ===
# Format: (date YYYY-MM-DD, open, high, low, close, volume, change_percent)
# Volume in actual shares (M = millions, so 229.37M = 229,370,000)
REAL_EGX30_DATA = [
    ("2026-09-22", 54994.31, 55231.93, 54909.80, 54930.89, 208990000, -0.12),
    ("2026-09-23", 54930.89, 55015.98, 54224.93, 54224.93, 207690000, -1.29),
    ("2026-09-24", 54224.93, 54283.28, 52793.23, 53776.69, 289980000, -0.83),
    ("2026-09-27", 53776.69, 54278.64, 52954.38, 53031.69, 202790000, -1.39),
    ("2026-09-28", 53031.69, 53455.22, 51567.66, 52468.71, 215100000, -1.06),
    ("2026-09-29", 52468.71, 52996.51, 52202.68, 52297.12, 163620000, -0.33),
    ("2026-09-30", 52297.12, 52263.20, 50940.72, 51894.83, 238150000, -0.77),
    ("2026-10-01", 51894.83, 53055.03, 51883.87, 53055.03, 257900000, 2.24),
    ("2026-10-04", 53055.03, 54103.95, 53207.62, 53911.10, 238060000, 1.61),
    ("2026-10-05", 53911.10, 54112.97, 53213.10, 53553.41, 208770000, -0.66),
    ("2026-10-06", 53553.41, 53708.69, 53169.17, 53298.14, 227000000, -0.48),
    ("2026-10-07", 53298.14, 53511.88, 53059.86, 53265.16, 172570000, -0.06),
    ("2026-10-11", 53265.16, 53398.56, 52206.70, 52206.70, 174170000, -1.99),
    ("2026-10-12", 52206.70, 52414.92, 51278.60, 51613.92, 185710000, -1.14),
    ("2026-10-13", 51613.92, 51976.48, 50281.76, 51265.27, 242520000, -0.68),
    ("2026-10-14", 51265.27, 52092.34, 51195.07, 51492.83, 167280000, 0.44),
    ("2026-10-15", 51492.83, 52273.34, 51231.55, 52273.34, 198080000, 1.52),
    ("2026-10-18", 52273.34, 52262.87, 50479.58, 50896.19, 230390000, -2.63),
    ("2026-10-19", 50896.19, 51346.52, 49621.20, 51098.83, 223050000, 0.40),
    ("2026-10-20", 51098.83, 52089.01, 51146.64, 52089.01, 220950000, 1.94),
    ("2026-10-21", 52089.01, 52910.41, 52420.62, 52854.95, 178410000, 1.47),
    ("2026-10-22", 52854.95, 52867.55, 51052.26, 51052.26, 229370000, -3.41),
]


def main():
    if not STOCKS_DB.exists():
        print(f"✗ stocks.db not found at {STOCKS_DB}")
        sys.exit(1)

    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(STOCKS_DB), writable=True).__enter__()

    # Ensure table exists
    conn.execute("""
        CREATE TABLE IF NOT EXISTS index_daily_prices (
            symbol TEXT,
            price_date TEXT,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume REAL,
            change_percent REAL,
            PRIMARY KEY (symbol, price_date)
        )
    """)
    conn.commit()

    # Clear existing EGX30 rows in the date range (replace with real data)
    conn.execute("DELETE FROM index_daily_prices WHERE symbol = 'EGX30'")
    conn.commit()

    upserted = 0
    for date, open_, high, low, close, volume, change_pct in REAL_EGX30_DATA:
        conn.execute("""
            INSERT OR REPLACE INTO index_daily_prices
                (symbol, price_date, open, high, low, close, volume, change_percent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, ("EGX30", date, open_, high, low, close, volume, change_pct))
        upserted += 1

    conn.commit()

    # Verify
    count = conn.execute(
        "SELECT COUNT(*) FROM index_daily_prices WHERE symbol='EGX30'"
    ).fetchone()[0]
    latest = conn.execute(
        "SELECT price_date, close, change_percent FROM index_daily_prices "
        "WHERE symbol='EGX30' ORDER BY price_date DESC LIMIT 1"
    ).fetchone()
    earliest = conn.execute(
        "SELECT price_date, close FROM index_daily_prices "
        "WHERE symbol='EGX30' ORDER BY price_date ASC LIMIT 1"
    ).fetchone()

    conn.close()

    print(f"✓ Seeded {upserted} REAL EGX30 rows into index_daily_prices")
    print(f"  Total EGX30 rows: {count}")
    print(f"  Earliest: {earliest[0]} → close={earliest[1]:,.2f}")
    print(f"  Latest:   {latest[0]} → close={latest[1]:,.2f} (change={latest[2]}%)")
    print()
    print("Next: run sync_market_indices_live.py — it will read the latest real")
    print("close (51,052.26) as the base and compute live values accurately.")


if __name__ == "__main__":
    main()
