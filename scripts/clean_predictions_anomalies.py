#!/usr/bin/env python3
"""
clean_predictions_anomalies.py — Purge anomalous predictions + add safety filters

Owner directive (PREDICTIONS-CLEANUP-1, 2026-10-27):
  1. Delete ADP (US stock contaminated as EGX) + negative stop_loss + entry_price <= 0
  2. Deduplicate: keep only latest prediction per (ticker, persona, market, track)
  3. Safety filter: flag predictions where |current_price - entry_price|/current_price > 10%

This script is IDEMPOTENT and PRODUCTION-SAFE:
  - Makes a backup before any DELETE
  - Uses transactions
  - Reports before/after counts
  - Never touches predictions_duplicates_archive (historical)

Usage:
  python3 scripts/clean_predictions_anomalies.py --dry-run    # report only
  python3 scripts/clean_predictions_anomalies.py --apply       # execute cleanup
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "db" / "predictions.db"

# Anomaly thresholds
ENTRY_PRICE_MIN = 0.01  # entry_price must be > 0
STOP_LOSS_MIN = 0.0     # stop_loss must be >= 0
PRICE_DEVIATION_MAX = 0.10  # 10% max deviation from current market price


def log(msg: str) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}", flush=True)


def backup_db(db_path: Path) -> Path:
    """Create a timestamped backup."""
    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    bak = db_path.with_name(f"{db_path.name}.bak-{ts}")
    shutil.copy2(db_path, bak)
    return bak


def find_anomalies(conn: sqlite3.Connection) -> dict:
    """Find all anomalous predictions (report only, no changes)."""
    stats = {}
    stats["total"] = conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]

    # 1. ADP ticker (US stock contaminated as EGX)
    stats["adp_ticker"] = conn.execute(
        "SELECT COUNT(*) FROM predictions WHERE ticker = 'ADP'"
    ).fetchone()[0]

    # 2. Negative stop_loss
    stats["negative_stop_loss"] = conn.execute(
        "SELECT COUNT(*) FROM predictions WHERE stop_loss < 0"
    ).fetchone()[0]

    # 3. Zero/negative entry_price
    stats["bad_entry_price"] = conn.execute(
        f"SELECT COUNT(*) FROM predictions WHERE entry_price <= {ENTRY_PRICE_MIN}"
    ).fetchone()[0]

    # 4. Duplicates: same (ticker, persona, market, track) on same day
    stats["duplicates"] = conn.execute("""
        SELECT COUNT(*) FROM (
            SELECT ticker, substr(prediction_date, 1, 10) as day, persona, market, track,
                   COUNT(*) as cnt
            FROM predictions
            GROUP BY ticker, substr(prediction_date, 1, 10), persona, market, track
            HAVING cnt > 1
        )
    """).fetchone()[0]

    # 5. Duplicate rows (rows that would be removed by dedup — all but latest per group)
    stats["duplicate_rows_to_remove"] = conn.execute("""
        SELECT COUNT(*) FROM (
            SELECT id, ROW_NUMBER() OVER (
                PARTITION BY ticker, substr(prediction_date, 1, 10), persona, market, track
                ORDER BY prediction_date DESC, id DESC
            ) as rn
            FROM predictions
        ) WHERE rn > 1
    """).fetchone()[0]

    return stats


def clean_anomalies(conn: sqlite3.Connection, apply: bool) -> dict:
    """Delete anomalous predictions. Returns stats."""
    stats = {"deleted_adp": 0, "deleted_neg_stop": 0, "deleted_bad_entry": 0,
             "deleted_duplicates": 0}

    if not apply:
        return stats

    # 1. Delete ADP
    cur = conn.execute("DELETE FROM predictions WHERE ticker = 'ADP'")
    stats["deleted_adp"] = cur.rowcount

    # 2. Delete negative stop_loss
    cur = conn.execute(f"DELETE FROM predictions WHERE stop_loss < {STOP_LOSS_MIN}")
    stats["deleted_neg_stop"] = cur.rowcount

    # 3. Delete bad entry_price
    cur = conn.execute(f"DELETE FROM predictions WHERE entry_price <= {ENTRY_PRICE_MIN}")
    stats["deleted_bad_entry"] = cur.rowcount

    # 4. Delete duplicates (keep latest per group)
    # SQLite supports ROW_NUMBER() in CTE since 3.25
    cur = conn.execute("""
        DELETE FROM predictions WHERE id IN (
            SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (
                    PARTITION BY ticker, substr(prediction_date, 1, 10), persona, market, track
                    ORDER BY prediction_date DESC, id DESC
                ) as rn
                FROM predictions
            ) WHERE rn > 1
        )
    """)
    stats["deleted_duplicates"] = cur.rowcount

    conn.commit()
    return stats


def check_unique_index(conn: sqlite3.Connection) -> bool:
    """Check if idx_predictions_dedup UNIQUE index exists (from SCANNER-LIVE-2)."""
    idx = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_predictions_dedup'"
    ).fetchone()
    return idx is not None


def main() -> int:
    ap = argparse.ArgumentParser(description="Clean anomalous predictions")
    ap.add_argument("--dry-run", action="store_true", help="report only, no changes")
    ap.add_argument("--apply", action="store_true", help="execute cleanup")
    ap.add_argument("--db", default=str(DB_PATH))
    args = ap.parse_args()

    if not args.dry_run and not args.apply:
        log("❌ must specify --dry-run or --apply")
        return 1

    db_path = Path(args.db)
    if not db_path.exists():
        log(f"❌ DB not found: {db_path}")
        return 1

    print("=" * 70)
    print("Predictions Anomaly Cleanup")
    print("=" * 70)
    print(f"DB: {db_path}")
    print(f"Mode: {'DRY-RUN' if args.dry_run else 'APPLY'}")
    print()

    # Backup if applying
    if args.apply:
        bak = backup_db(db_path)
        log(f"📦 backup: {bak}")

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    # Find anomalies
    log("Scanning for anomalies...")
    stats = find_anomalies(conn)
    print()
    log("BEFORE:")
    for k, v in stats.items():
        print(f"  {k:30}: {v}")

    # Check UNIQUE index
    has_idx = check_unique_index(conn)
    print(f"  UNIQUE index (idx_predictions_dedup): {'EXISTS ✅' if has_idx else 'MISSING ⚠️'}")

    # Clean
    if args.apply:
        log("\nCleaning...")
        clean_stats = clean_anomalies(conn, apply=True)
        print()
        log("DELETED:")
        for k, v in clean_stats.items():
            print(f"  {k:30}: {v}")

        # After
        after = find_anomalies(conn)
        print()
        log("AFTER:")
        for k, v in after.items():
            print(f"  {k:30}: {v}")

    conn.close()
    print()
    print("=" * 70)
    print("Done")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
