#!/usr/bin/env python3
"""BRAVO-DB-RESTORE-FINAL-001 — Verification script.

Checks that all 11 DBs exist in db/, reports table count + sample row counts,
and verifies integrity (can open + query each DB).

Usage:
    python3 vps-service/scripts/verify_db_restore_final.py
"""
from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path

DB_DIR = Path(__file__).resolve().parents[2] / "db"

# Expected DBs with their key tables for sample row count verification.
EXPECTED_DBS = {
    "predictions.db": ["aiPrediction", "predictions", "persona_predictions", "historical_trades"],
    "stocks.db": ["stocks", "stock_daily_prices", "investors_data", "market_indices"],
    "auth.db": ["User", "Account", "SubscriptionPlan"],
    "crypto.db": None,  # will list all tables
    "historical.db": None,
    "decision_log.db": None,
    "metrics.db": None,
    "news.db": None,
    "paper_trading.db": None,
    "data_engine.db": ["gold_prices", "historical_data"],
    "intraday.db": None,
    "price_history.db": None,
}

PASS = 0
FAIL = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  ✓ {name}")
    else:
        FAIL += 1
        print(f"  ✗ {name} — {detail}")


def verify_db(db_name: str, key_tables: list | None) -> None:
    db_path = DB_DIR / db_name
    print(f"\n── {db_name} ──────────────────────────────────────────")

    # 1. Exists
    check(f"{db_name} exists", db_path.exists(), f"not found at {db_path}")

    if not db_path.exists():
        return

    # 2. Size > 0
    size = db_path.stat().st_size
    check(f"{db_name} size > 0 ({size:,} bytes)", size > 0, "empty file")

    # 3. Can open + query
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(str(db_path), writable=False).__enter__()
        conn.row_factory = sqlite3.Row
    except sqlite3.Error as e:
        check(f"{db_name} opens", False, f"sqlite error: {e}")
        return
    check(f"{db_name} opens", True)

    # 4. Table count
    try:
        tables = [
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            ).fetchall()
        ]
    except sqlite3.Error as e:
        check(f"{db_name} table count", False, f"query error: {e}")
        conn.close()
        return
    check(f"{db_name} has tables ({len(tables)})", len(tables) > 0, "no tables")
    print(f"    tables ({len(tables)}): {', '.join(tables[:8])}{'...' if len(tables) > 8 else ''}")

    # 5. Sample row counts for key tables
    if key_tables:
        for t in key_tables:
            if t in tables:
                try:
                    n = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
                    check(f"{db_name}.{t} row count = {n:,}", n >= 0, "query failed")
                except sqlite3.Error as e:
                    check(f"{db_name}.{t} row count", False, str(e))
            else:
                check(f"{db_name}.{t} table exists", False, "table missing")

    # 6. Integrity check (full — integrity_quick_check not supported in older SQLite)
    # NOTE: row_factory is sqlite3.Row, so fetchone() returns a Row; access by index 0.
    try:
        row = conn.execute("PRAGMA integrity_check").fetchone()
        result = row[0] if row else None
        check(f"{db_name} integrity OK", result == "ok", f"integrity: {result}")
    except sqlite3.Error as e:
        check(f"{db_name} integrity", False, str(e))

    conn.close()


def main() -> int:
    print("=" * 72)
    print("BRAVO-DB-RESTORE-FINAL-001 — VERIFICATION")
    print(f"DB dir: {DB_DIR}")
    print("=" * 72)

    # Verify all expected DBs
    for db_name, key_tables in EXPECTED_DBS.items():
        verify_db(db_name, key_tables)

    # Summary
    print("\n" + "=" * 72)
    print(f"RESULTS: {PASS} PASS / {FAIL} FAIL")
    print(f"DBs verified: {len(EXPECTED_DBS)}")
    print("=" * 72)

    return 0 if FAIL == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
