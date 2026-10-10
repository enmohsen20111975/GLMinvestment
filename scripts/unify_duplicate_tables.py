#!/usr/bin/env python3
"""
P0-8-DB-UNIFY — Drop duplicate tables across the 4 SQLite databases.

This script:
  1. Backs up every DB to *.bak-unify (skipped if backup exists)
  2. Dumps any duplicate table that has rows to a JSON sidecar (data preservation)
  3. Drops the duplicate tables (verified safe — see per-table decisions in
     the P0-8-DB-UNIFY-REPORT.md)
  4. Logs every action with before/after row counts

Rules followed:
  - Backup EVERY DB before any DROP
  - NEVER drop a table with data unless it's provably a stale duplicate
    (verified: all symbols/keys exist in the canonical DB with fresher data)
  - Skip + log if verification fails
"""

from __future__ import annotations

import json
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_DIR = PROJECT_ROOT / "db"
OUTPUT_DIR = PROJECT_ROOT / "scripts" / "output"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# Drops plan (verified by db_unify_verify_*.js — see P0-8-DB-UNIFY-REPORT.md)
# ─────────────────────────────────────────────────────────────────────────────
# Each entry: (db_file, table, canonical_db, rows_before, reason)
# rows_before is a sanity check — the script refuses to drop if the live count
# doesn't match (guards against concurrent writes between inventory and drop).
# ─────────────────────────────────────────────────────────────────────────────
DROPS = [
    # stocks.db duplicates → canonical elsewhere
    ("stocks.db", "gold_prices", "data_engine.db", 3,
     "3 stale default rows (source='default', 2026-06-03) — data_engine.db "
     "has 187K live rows written by metals_forex_fetcher.py every 5 min. "
     "precomputeGoldData() in precomputed-cache.ts was already failing on "
     "the missing 'change' column — code now reads from data_engine.db."),

    ("stocks.db", "learned_lessons", "predictions.db", 0,
     "Empty table with different schema (8 cols vs predictions.db's 10 cols). "
     "predictions.db.learned_lessons has 19,464 rows — canonical."),

    ("stocks.db", "egksco_price_history", "data_engine.db", 0,
     "Empty table — data_engine.db.egksco_price_history has 13,246 rows "
     "(canonical, read by v38_backtest_engine, daily_closer, etc.)."),

    # predictions.db duplicates → canonical in stocks.db or data_engine.db
    ("predictions.db", "cached_analysis", "stocks.db", 0,
     "Empty fallback-cache table with different schema (18 cols vs "
     "stocks.db's 39 cols). stocks.db.cached_analysis has 143 fresh rows. "
     "Migrator recreates this table on schema-build if needed."),

    ("predictions.db", "telegram_news", "stocks.db", 0,
     "Empty table with different schema (8 cols vs stocks.db's 10 cols). "
     "stocks.db.telegram_news has 6 fresh rows. "
     "TelegramSignalImporter._ensure_schema() recreates the table on init."),

    ("predictions.db", "ExpertRecommendation", "stocks.db", 17,
     "17 stale seed rows (exp001-exp017, max date 2026-06-03). 16/17 are "
     "direct duplicates of rows in stocks.db by (symbol, recommendation_date). "
     "1 unique (FWRY @ 2026-06-03) preserved to JSON sidecar. stocks.db has "
     "127 fresh rows (latest 2026-09-07). unified_learning_engine.py:1224 "
     "uses 'in tables' existence check — gracefully skips when missing."),

    # auth.db duplicates → canonical in stocks.db
    ("auth.db", "ExpertRecommendation", "stocks.db", 17,
     "17 stale seed rows identical to predictions.db.ExpertRecommendation "
     "(17/17 overlap by id+symbol+date). No code references auth.db version "
     "of ExpertRecommendation — stocks.db is the canonical source read by "
     "expert-recommendations/route.ts, expert_memory_bridge.py, etc."),

    # data_engine.db duplicates → canonical in stocks.db
    ("data_engine.db", "egksco_stocks", "stocks.db", 0,
     "Empty table. stocks.db.egksco_stocks has 250 rows. "
     "live_price.py:_price_from_data_engine() catches sqlite3.OperationalError "
     "and falls back to _price_from_stocks_egksco() — safe to drop."),

    ("data_engine.db", "stocks", "stocks.db", 296,
     "296 rows, ALL stale (>7 days old, last_update 2026-09-08). Verified "
     "ALL 296 symbols exist in stocks.db.stocks (which has 976 rows, fresher "
     "2026-09-26, 58 cols vs data_engine's 16 cols). smart_confluence_engine."
     "py:96-116 has a fallback path that reads stocks.db.stocks when "
     "data_engine.db.stocks is unavailable — switching to that path."),
]


def backup_all_dbs() -> dict[str, str]:
    """Back up every DB file (stocks, predictions, auth, data_engine) to .bak-unify.

    Returns: {db_name: backup_path}
    """
    backups: dict[str, str] = {}
    dbs = ["stocks.db", "predictions.db", "auth.db", "data_engine.db"]
    for db_name in dbs:
        src = DB_DIR / db_name
        dst = DB_DIR / f"{db_name}.bak-unify"
        if not src.exists():
            print(f"  ⚠️  {db_name} missing — skipped backup")
            continue
        if dst.exists():
            print(f"  ⊙  {db_name}.bak-unify already exists — skipped (preserving first backup)")
            backups[db_name] = str(dst)
            continue
        # Copy the main file + WAL + SHM (the SQLite DB may be in WAL mode)
        shutil.copy2(src, dst)
        for suffix in ("-wal", "-shm"):
            wal_src = Path(str(src) + suffix)
            if wal_src.exists():
                shutil.copy2(wal_src, Path(str(dst) + suffix))
        size_mb = dst.stat().st_size / (1024 * 1024)
        print(f"  ✓  Backed up {db_name} → {dst.name} ({size_mb:.1f} MB)")
        backups[db_name] = str(dst)
    return backups


def dump_table_to_json(db_path: Path, table: str, out_path: Path) -> int:
    """Dump all rows from `table` in `db_path` to `out_path` as JSON.

    Returns: number of rows dumped.
    """
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(f"SELECT * FROM {table}").fetchall()
        data = [dict(r) for r in rows]
        out_path.write_text(json.dumps(data, indent=2, default=str))
        return len(data)
    finally:
        conn.close()


def drop_table(db_name: str, table: str, canonical_db: str,
               expected_rows: int, reason: str) -> dict:
    """Drop a duplicate table from db_name, with full safety checks.

    Returns: dict with action details.
    """
    db_path = DB_DIR / db_name
    result = {
        "db": db_name,
        "table": table,
        "canonical_db": canonical_db,
        "reason": reason,
        "rows_before": None,
        "rows_after": None,
        "action": "PENDING",
        "json_sidecar": None,
    }
    if not db_path.exists():
        result["action"] = "SKIPPED_DB_MISSING"
        return result

    conn = sqlite3.connect(str(db_path))
    try:
        # Check table exists
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table,),
        )
        if not cur.fetchone():
            result["action"] = "SKIPPED_TABLE_ALREADY_GONE"
            return result

        # Count rows (sanity check vs expected_rows)
        rows_before = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        result["rows_before"] = rows_before
        if rows_before != expected_rows:
            print(f"  ⚠️  Row count mismatch: expected {expected_rows}, got {rows_before}")
            print(f"      → SKIPPING (concurrent write suspected — manual review needed)")
            result["action"] = "SKIPPED_ROW_COUNT_MISMATCH"
            return result

        # If rows > 0, dump them to JSON sidecar (data preservation)
        if rows_before > 0:
            ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
            sidecar = OUTPUT_DIR / f"db_unify_dropped_{db_name.replace('.', '_')}_{table}_{ts}.json"
            dumped = dump_table_to_json(db_path, table, sidecar)
            result["json_sidecar"] = str(sidecar)
            print(f"  📦  Dumped {dumped} rows → {sidecar.name}")

        # Drop the table
        conn.execute(f"DROP TABLE {table}")
        conn.commit()

        # Verify it's gone
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table,),
        )
        if cur.fetchone():
            result["action"] = "FAILED_TABLE_STILL_PRESENT"
            return result

        result["rows_after"] = 0
        result["action"] = "DROPPED"
        return result
    except Exception as e:
        result["action"] = f"ERROR: {e}"
        return result
    finally:
        conn.close()


def main(dry_run: bool = False) -> int:
    print("=" * 78)
    print(f"P0-8-DB-UNIFY — Drop duplicate tables ({'DRY-RUN' if dry_run else 'LIVE'})")
    print(f"Timestamp: {datetime.utcnow().isoformat()}Z")
    print("=" * 78)

    # Step 1: Back up every DB
    print("\n[1/3] Backing up DBs ...")
    if not dry_run:
        backups = backup_all_dbs()
        if len(backups) < 4:
            print(f"  ⚠️  Only {len(backups)} DBs backed up — aborting.")
            return 1
    else:
        print("  (dry-run — skipping backups)")
        backups = {"stocks.db": "(skipped)", "predictions.db": "(skipped)",
                   "auth.db": "(skipped)", "data_engine.db": "(skipped)"}

    # Step 2: Drop duplicates
    print(f"\n[2/3] Dropping {len(DROPS)} duplicate tables ...")
    results = []
    for db_name, table, canonical_db, expected_rows, reason in DROPS:
        print(f"\n  ▶  {db_name}.{table}  (canonical: {canonical_db})")
        print(f"     expected rows: {expected_rows}")
        print(f"     reason: {reason[:100]}{'...' if len(reason) > 100 else ''}")
        if dry_run:
            print(f"     (dry-run — would drop)")
            results.append({
                "db": db_name, "table": table, "canonical_db": canonical_db,
                "rows_before": expected_rows, "action": "DRY_RUN",
                "reason": reason,
            })
            continue
        res = drop_table(db_name, table, canonical_db, expected_rows, reason)
        if res["action"] == "DROPPED":
            print(f"     ✅ DROPPED (was {res['rows_before']} rows)")
        elif res["action"].startswith("SKIPPED"):
            print(f"     ⊙  {res['action']}")
        else:
            print(f"     ❌ {res['action']}")
        results.append(res)

    # Step 3: Summary
    print("\n[3/3] Summary")
    print("-" * 78)
    dropped = [r for r in results if r.get("action") == "DROPPED"]
    skipped = [r for r in results if r.get("action", "").startswith("SKIPPED")]
    errored = [r for r in results if r.get("action", "").startswith("ERROR") or r.get("action") == "FAILED_TABLE_STILL_PRESENT"]
    dry_run_results = [r for r in results if r.get("action") == "DRY_RUN"]
    print(f"  Dropped:    {len(dropped)}")
    print(f"  Skipped:    {len(skipped)}")
    print(f"  Errored:    {len(errored)}")
    if dry_run:
        print(f"  Dry-run:    {len(dry_run_results)}")

    # Write results JSON
    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    out_json = OUTPUT_DIR / f"db_unify_drops_{ts}.json"
    out_json.write_text(json.dumps({
        "timestamp": ts,
        "dry_run": dry_run,
        "backups": backups,
        "results": results,
    }, indent=2, default=str))
    print(f"\n  Results saved to: {out_json}")
    return 0 if not errored else 2


if __name__ == "__main__":
    dry = "--dry-run" in sys.argv
    sys.exit(main(dry_run=dry))
