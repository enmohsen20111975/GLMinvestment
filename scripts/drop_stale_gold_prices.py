#!/usr/bin/env python3
"""
drop_stale_gold_prices.py — v3.65.1 P0-2 finalizer
====================================================
Drops the stale `stocks.db.gold_prices` table (3 hardcoded rows from 2026-06-03)
AFTER verifying that `data_engine.db.gold_prices` has live Egypt data.

CANONICAL SOURCE (per Documentation/DB_ARCHITECTURE.md):
    data_engine.db.gold_prices — 77,659 rows, written live by
    data_engine/scrapers/metals_forex_fetcher.py every 5 minutes.

SAFE TO RUN ON:
    - VPS (production) — after pulling v3.65.1+ and restarting services
    - Sandbox — has test data only

USAGE:
    python3 scripts/drop_stale_gold_prices.py           # dry-run (default)
    python3 scripts/drop_stale_gold_prices.py --apply    # actually DROP

EXIT CODES:
    0 = OK (dry-run passed, or DROP succeeded)
    1 = data_engine.db has no Egypt gold data — DO NOT DROP (would leave no source)
    2 = backup failed — DO NOT DROP
    3 = unexpected error
"""
from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

# Resolve project root (scripts/ -> project root)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_DIR = Path(os.environ.get("DB_DIR", PROJECT_ROOT / "db"))

STOCKS_DB = DB_DIR / "stocks.db"
DATA_ENGINE_DB = DB_DIR / "data_engine.db"

EGYPT_COUNTRIES = ("EG", "Egypt", "EGY", "مصر")


def log(msg: str) -> None:
    print(f"[drop_stale_gold] {msg}")


def check_data_engine_egypt_gold(conn: sqlite3.Connection) -> dict:
    """Verify data_engine.db.gold_prices has live Egypt data. Returns dict with stats."""
    result = {
        "gold_prices_exists": False,
        "gold_prices_egypt_rows": 0,
        "gold_prices_latest_ts": None,
        "gold_prices_clean_exists": False,
        "gold_prices_clean_egypt_rows": 0,
        "latest_egypt_prices": {},
    }

    # Check gold_prices table
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('gold_prices','gold_prices_clean')"
    ).fetchall()]
    result["gold_prices_exists"] = "gold_prices" in tables
    result["gold_prices_clean_exists"] = "gold_prices_clean" in tables

    if result["gold_prices_exists"]:
        placeholders = ",".join("?" * len(EGYPT_COUNTRIES))
        row = conn.execute(
            f"SELECT COUNT(*), MAX(timestamp) FROM gold_prices WHERE country IN ({placeholders})",
            EGYPT_COUNTRIES,
        ).fetchone()
        result["gold_prices_egypt_rows"] = row[0] or 0
        result["gold_prices_latest_ts"] = row[1]

        if result["gold_prices_latest_ts"]:
            prices_rows = conn.execute(
                f"SELECT karat, price_per_gram FROM gold_prices WHERE country IN ({placeholders}) AND timestamp = ?",
                (*EGYPT_COUNTRIES, result["gold_prices_latest_ts"]),
            ).fetchall()
            for karat, price in prices_rows:
                k = str(karat).lower().replace("k", "").strip()
                if k in ("24", "999"):
                    result["latest_egypt_prices"]["24k"] = price
                elif k in ("21", "875"):
                    result["latest_egypt_prices"]["21k"] = price
                elif k in ("18", "750"):
                    result["latest_egypt_prices"]["18k"] = price

    if result["gold_prices_clean_exists"]:
        placeholders = ",".join("?" * len(EGYPT_COUNTRIES))
        row = conn.execute(
            f"SELECT COUNT(*) FROM gold_prices_clean WHERE country IN ({placeholders})",
            EGYPT_COUNTRIES,
        ).fetchone()
        result["gold_prices_clean_egypt_rows"] = row[0] or 0

    return result


def check_stocks_gold(conn: sqlite3.Connection) -> dict:
    """Check the stale stocks.db.gold_prices table."""
    result = {"exists": False, "rows": 0, "sample": []}
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='gold_prices'"
    ).fetchall()]
    result["exists"] = bool(tables)
    if result["exists"]:
        result["rows"] = conn.execute("SELECT COUNT(*) FROM gold_prices").fetchone()[0]
        result["sample"] = conn.execute(
            "SELECT karat, price_per_gram, last_update FROM gold_prices LIMIT 5"
        ).fetchall()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Drop stale stocks.db.gold_prices (v3.65.1 P0-2)")
    parser.add_argument("--apply", action="store_true", help="Actually DROP (default: dry-run)")
    args = parser.parse_args()

    log("=" * 70)
    log("v3.65.1 P0-2: Drop stale stocks.db.gold_prices")
    log("=" * 70)
    log(f"DB_DIR: {DB_DIR}")
    log(f"Mode: {'APPLY' if args.apply else 'DRY-RUN'}")
    log("")

    # Step 1: Verify data_engine.db
    if not DATA_ENGINE_DB.exists():
        log(f"ERROR: {DATA_ENGINE_DB} not found")
        return 3
    log(f"Checking {DATA_ENGINE_DB.name}...")
    de_conn = sqlite3.connect(f"file:{DATA_ENGINE_DB}?mode=ro", uri=True)
    try:
        de_stats = check_data_engine_egypt_gold(de_conn)
    finally:
        de_conn.close()

    log(f"  gold_prices table exists: {de_stats['gold_prices_exists']}")
    log(f"  gold_prices Egypt rows:   {de_stats['gold_prices_egypt_rows']}")
    log(f"  gold_prices latest ts:    {de_stats['gold_prices_latest_ts']}")
    log(f"  gold_prices_clean exists: {de_stats['gold_prices_clean_exists']}")
    log(f"  gold_prices_clean Egypt:  {de_stats['gold_prices_clean_egypt_rows']}")
    if de_stats["latest_egypt_prices"]:
        log("  Latest Egypt prices:")
        for karat, price in de_stats["latest_egypt_prices"].items():
            log(f"    {karat}: {price} EGP/gram")
    log("")

    # Safety check: data_engine.db MUST have Egypt gold data
    has_live_data = (
        de_stats["gold_prices_egypt_rows"] > 0
        or de_stats["gold_prices_clean_egypt_rows"] > 0
    )
    if not has_live_data:
        log("ERROR: data_engine.db has NO Egypt gold data.")
        log("       DO NOT DROP stocks.db.gold_prices — it's the only source (even if stale).")
        log("       Run data_engine/scrapers/metals_forex_fetcher.py first to populate live data.")
        return 1

    # Step 2: Check stocks.db.gold_prices
    if not STOCKS_DB.exists():
        log(f"ERROR: {STOCKS_DB} not found")
        return 3
    log(f"Checking {STOCKS_DB.name}...")
    st_conn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True)
    try:
        st_stats = check_stocks_gold(st_conn)
    finally:
        st_conn.close()

    log(f"  gold_prices table exists: {st_stats['exists']}")
    if st_stats["exists"]:
        log(f"  rows: {st_stats['rows']}")
        if st_stats["sample"]:
            log("  sample:")
            for karat, price, last_update in st_stats["sample"]:
                log(f"    karat={karat}, price={price}, last_update={last_update}")
    log("")

    if not st_stats["exists"]:
        log("OK: stocks.db.gold_prices does not exist. Nothing to DROP.")
        return 0

    # Step 3: Backup stocks.db (if --apply)
    if args.apply:
        backup_name = f"stocks.db.bak.pre_gold_drop_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        backup_path = DB_DIR / backup_name
        log(f"Backing up {STOCKS_DB.name} -> {backup_name}...")
        try:
            shutil.copy2(STOCKS_DB, backup_path)
            log(f"  Backup size: {backup_path.stat().st_size:,} bytes")
        except Exception as e:
            log(f"ERROR: backup failed: {e}")
            return 2

        # Step 4: DROP
        log(f"Dropping stocks.db.gold_prices...")
        try:
            conn = sqlite3.connect(str(STOCKS_DB))
            try:
                conn.execute("DROP TABLE IF EXISTS gold_prices")
                conn.commit()
                # Verify
                remaining = conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='gold_prices'"
                ).fetchall()
                if remaining:
                    log("ERROR: DROP did not remove the table!")
                    return 3
                log("  DROP succeeded.")
            finally:
                conn.close()
        except Exception as e:
            log(f"ERROR: DROP failed: {e}")
            return 3

        # Step 5: integrity check
        log("Running integrity_check...")
        conn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True)
        try:
            chk = conn.execute("PRAGMA integrity_check").fetchone()[0]
            log(f"  integrity_check: {chk}")
        finally:
            conn.close()

        log("")
        log("SUCCESS: stocks.db.gold_prices dropped.")
        log("         All readers now use data_engine.db via getLiveEgyptGoldPrices().")
        log(f"         Backup: {backup_path}")
    else:
        log("DRY-RUN: would DROP stocks.db.gold_prices.")
        log("         Re-run with --apply to actually DROP.")

    log("")
    log("Next steps:")
    log("  1. Restart services: pm2 restart python-backend nextjs")
    log("  2. Verify gold prices load: curl http://localhost:3000/api/finance/calculate-values")
    log("  3. Check logs: pm2 logs nextjs | grep getLiveEgyptGoldPrices")
    return 0


if __name__ == "__main__":
    sys.exit(main())
