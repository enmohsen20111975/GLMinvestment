#!/usr/bin/env python3
"""
================================================================
_fix_america_to_us.py — Standalone sandbox migration (Wave 1 P0 Fix 1)
================================================================
Rebuilds the أمريكا → US market name migration that was claimed
(fabricated) in the lost commit 25781d3 ("أمريكا → US market name
(62 rows) FIXED") but never actually performed.

RULE 1 (NEVER touch prod DBs): this script ONLY writes to the
sandbox `db/stocks.db`. It will refuse to run against any path
matching the production layout (`/root/GLMinvestment/...`).

Idempotent: WHERE market='أمريكا' only touches affected rows.
Re-running on already-migrated data is a no-op.

Usage:
    python3 scripts/_fix_america_to_us.py            # apply + verify
    python3 scripts/_fix_america_to_us.py --verify    # verify only (read-only)
    python3 scripts/_fix_america_to_us.py --dry-run   # report what would change

Exit codes:
    0 = migration applied (or skipped idempotently) AND verification passed
    1 = verification FAILED (rows with market='أمريكا' still present)
    2 = environment error (production path detected, DB missing, etc.)
================================================================
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path

# Rule 61 — RELATIVE-PATHS-ONLY
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent if SCRIPT_DIR.name == "scripts" else SCRIPT_DIR
DB_PATH = PROJECT_ROOT / "db" / "stocks.db"

# Rule 1 — safeguard: refuse to run on production-like paths
PRODUCTION_PATH_MARKERS = ("/root/GLMinvestment", "/home/meme/my_apps/GLMinvestment")


def assert_sandbox(path: Path) -> None:
    """Refuse to run if the resolved DB path matches a production layout."""
    resolved = str(path.resolve())
    for marker in PRODUCTION_PATH_MARKERS:
        if resolved.startswith(marker):
            print(f"❌ REFUSING to run on production path: {resolved}", file=sys.stderr)
            print("   Rule 1 (NEVER touch prod DBs). Aborting.", file=sys.stderr)
            sys.exit(2)


def ensure_currency_column(conn: sqlite3.Connection) -> bool:
    """Add `currency` column to stocks if missing. Idempotent. Returns True if added."""
    cols = [c[1] for c in conn.execute("PRAGMA table_info(stocks)").fetchall()]
    if "currency" not in cols:
        conn.execute("ALTER TABLE stocks ADD COLUMN currency TEXT DEFAULT 'EGP'")
        conn.commit()
        print("  ℹ️  Added missing column stocks.currency TEXT DEFAULT 'EGP'")
        return True
    return False


def pre_count(conn: sqlite3.Connection) -> int:
    return conn.execute("SELECT COUNT(*) FROM stocks WHERE market = 'أمريكا'").fetchone()[0]


def apply_migration(conn: sqlite3.Connection) -> int:
    """Run the idempotent UPDATE. Returns number of rows touched."""
    cursor = conn.execute(
        "UPDATE stocks SET market = ?, currency = ? WHERE market = ?",
        ("US", "USD", "أمريكا"),
    )
    conn.commit()
    return cursor.rowcount


def verify(conn: sqlite3.Connection) -> tuple[int, int, list[tuple]]:
    """Return (america_count_remaining, us_count_total, market_breakdown)."""
    america_count = conn.execute(
        "SELECT COUNT(*) FROM stocks WHERE market = 'أمريكا'"
    ).fetchone()[0]
    us_count = conn.execute(
        "SELECT COUNT(*) FROM stocks WHERE market = 'US'"
    ).fetchone()[0]
    breakdown = conn.execute(
        "SELECT market, currency, COUNT(*) FROM stocks GROUP BY market, currency ORDER BY market"
    ).fetchall()
    return america_count, us_count, breakdown


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Wave 1 P0 Fix 1 — migrate stocks.market='أمريكا' → 'US' (sandbox only)"
    )
    parser.add_argument(
        "--db",
        type=str,
        default=str(DB_PATH),
        help="Path to stocks.db (defaults to db/stocks.db)",
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Read-only verification — do not apply migration",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would change — do not write",
    )
    args = parser.parse_args()

    db_path = Path(args.db).resolve()
    assert_sandbox(db_path)

    if not db_path.exists():
        print(f"❌ DB not found: {db_path}", file=sys.stderr)
        return 2

    print("=" * 60)
    print("Wave 1 P0 Fix 1 — أمريكا → US market name migration")
    print("=" * 60)
    print(f"  DB path:    {db_path}")
    print(f"  Mode:       {'VERIFY-ONLY' if args.verify else ('DRY-RUN' if args.dry_run else 'LIVE')}")
    print()

    conn = sqlite3.connect(str(db_path))

    # Sanity check — does the stocks table exist?
    tables = [t[0] for t in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='stocks'"
    ).fetchall()]
    if "stocks" not in tables:
        print(f"❌ Table 'stocks' not found in {db_path}", file=sys.stderr)
        conn.close()
        return 2

    pre = pre_count(conn)
    print(f"  PRE-migration:  COUNT(stocks WHERE market='أمريكا') = {pre}")

    if args.verify:
        america_count, us_count, breakdown = verify(conn)
        print(f"  POST-migration: COUNT(stocks WHERE market='أمريكا') = {america_count}")
        print(f"                  COUNT(stocks WHERE market='US')       = {us_count}")
        print()
        print("  Market / currency / count breakdown:")
        for row in breakdown:
            print(f"    market={row[0]!r:12s} currency={row[1]!r:6s} count={row[2]}")
        conn.close()
        return 0 if america_count == 0 else 1

    if args.dry_run:
        print(f"  DRY-RUN: would UPDATE {pre} rows (market='أمريكا' → 'US', currency='USD')")
        conn.close()
        return 0

    # LIVE migration
    ensure_currency_column(conn)
    touched = apply_migration(conn)
    print(f"  Migration:      {touched} rows UPDATEd (market='أمريكا' → 'US', currency='USD')")

    america_count, us_count, breakdown = verify(conn)
    print(f"  POST-migration: COUNT(stocks WHERE market='أمريكا') = {america_count}")
    print(f"                  COUNT(stocks WHERE market='US')       = {us_count}")
    print()
    print("  Market / currency / count breakdown:")
    for row in breakdown:
        print(f"    market={row[0]!r:12s} currency={row[1]!r:6s} count={row[2]}")

    conn.close()

    print()
    if america_count == 0:
        print("✅ VERIFICATION PASSED — zero أمريكا rows remaining")
        return 0
    else:
        print(f"❌ VERIFICATION FAILED — {america_count} أمريكا rows still present", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
