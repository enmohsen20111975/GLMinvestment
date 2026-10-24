#!/usr/bin/env python3
"""
BRAVO sanitize_stocks_table.py — Deactivate dead stocks (price <= 0 or NULL).
=========================================================================
Phase 2 of the secure-rules mandate.

Sets is_active = 0 for stocks where:
  - current_price <= 0
  - current_price IS NULL
  - ticker IS NULL

Safe:
  - UPDATE only (no DELETE)
  - --dry-run flag
  - verify before/after counts
  - idempotent (re-run = 0 new updates)

Rule 17 (relative paths): parents[1] = project root.
Rule 1: sandbox only — production needs owner approval.

Usage:
    python3 scripts/sanitize_stocks_table.py --dry-run
    python3 scripts/sanitize_stocks_table.py
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"


def main() -> int:
    parser = argparse.ArgumentParser(description="Sanitize stocks table — deactivate dead stocks")
    parser.add_argument("--dry-run", action="store_true", help="Show without updating")
    args = parser.parse_args()

    print("=" * 60)
    print("BRAVO sanitize_stocks_table.py — Phase 2")
    print(f"DB: {STOCKS_DB}")
    print(f"Mode: {'DRY-RUN' if args.dry_run else 'EXECUTE'}")
    print("=" * 60)

    if not STOCKS_DB.exists():
        print(f"ERROR: {STOCKS_DB} not found")
        return 1

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(STOCKS_DB), writable=False).__enter__()
    conn.row_factory = sqlite3.Row

    # BEFORE
    total = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
    active = conn.execute("SELECT COUNT(*) FROM stocks WHERE is_active = 1").fetchone()[0]
    dead = conn.execute(
        "SELECT COUNT(*) FROM stocks WHERE current_price <= 0 OR current_price IS NULL OR ticker IS NULL"
    ).fetchone()[0]
    dead_active = conn.execute(
        "SELECT COUNT(*) FROM stocks WHERE (current_price <= 0 OR current_price IS NULL OR ticker IS NULL) AND is_active = 1"
    ).fetchone()[0]

    print(f"\nBEFORE:")
    print(f"  Total stocks: {total}")
    print(f"  Active (is_active=1): {active}")
    print(f"  Dead (price<=0/NULL/ticker NULL): {dead}")
    print(f"  Dead BUT still active: {dead_active} ← these need deactivation")

    # Sample dead stocks
    print(f"\nSample dead stocks:")
    rows = conn.execute(
        "SELECT ticker, name_ar, current_price, is_active FROM stocks "
        "WHERE current_price <= 0 OR current_price IS NULL OR ticker IS NULL LIMIT 10"
    ).fetchall()
    for r in rows:
        print(f"  {r['ticker']}: price={r['current_price']}, active={r['is_active']}, name={r['name_ar']}")

    if not args.dry_run and dead_active > 0:
        # UPDATE: deactivate dead stocks
        result = conn.execute(
            "UPDATE stocks SET is_active = 0 "
            "WHERE current_price <= 0 OR current_price IS NULL OR ticker IS NULL"
        )
        conn.commit()
        updated = result.rowcount
        print(f"\n✅ Updated: {updated} stocks deactivated (is_active → 0)")
    elif args.dry_run and dead_active > 0:
        print(f"\n{'Would update' if args.dry_run else 'Updated'}: {dead_active} stocks → is_active = 0")
    else:
        print(f"\n✅ No updates needed — all dead stocks already deactivated")

    # AFTER
    if not args.dry_run:
        active_after = conn.execute("SELECT COUNT(*) FROM stocks WHERE is_active = 1").fetchone()[0]
        dead_active_after = conn.execute(
            "SELECT COUNT(*) FROM stocks WHERE (current_price <= 0 OR current_price IS NULL OR ticker IS NULL) AND is_active = 1"
        ).fetchone()[0]
        print(f"\nAFTER:")
        print(f"  Active: {active_after} (was {active})")
        print(f"  Dead AND active: {dead_active_after} (was {dead_active})")

    conn.close()
    print(f"\n✅ Done.{' (dry-run)' if args.dry_run else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
