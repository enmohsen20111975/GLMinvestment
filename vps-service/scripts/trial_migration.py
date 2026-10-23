#!/usr/bin/env python3
"""BRAVO RESTRUCT-B-P2 — Trial migration script.

Backfills NULL trial_ends_at → NOW() + 14 days for free-tier users.
Idempotent: only updates rows where trial_ends_at IS NULL.
Rule 17: relative paths. Rule 1: sandbox copy only — production needs owner approval.

Usage:
    python3 vps-service/scripts/trial_migration.py --dry-run   # show, no write
    python3 vps-service/scripts/trial_migration.py             # execute
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
AUTH_DB = PROJECT_ROOT / "db" / "auth.db"
TRIAL_DAYS = 14


def main() -> int:
    parser = argparse.ArgumentParser(description="BRAVO B-P2 trial migration")
    parser.add_argument("--dry-run", action="store_true", help="Show changes, no write")
    args = parser.parse_args()

    if not AUTH_DB.exists():
        print(f"ERROR: {AUTH_DB} not found")
        return 1

    print(f"{'='*60}")
    print(f"BRAVO RESTRUCT-B-P2 — Trial migration")
    print(f"DB: {AUTH_DB}")
    print(f"Mode: {'DRY-RUN' if args.dry_run else 'WRITE'}")
    print(f"TRIAL_DAYS: {TRIAL_DAYS}")
    print(f"{'='*60}")

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(AUTH_DB), writable=False).__enter__()
    conn.row_factory = sqlite3.Row

    # BEFORE
    total = conn.execute("SELECT COUNT(*) FROM User").fetchone()[0]
    null_trial = conn.execute("SELECT COUNT(*) FROM User WHERE trial_ends_at IS NULL").fetchone()[0]
    free_null = conn.execute(
        "SELECT COUNT(*) FROM User WHERE trial_ends_at IS NULL AND subscription_tier = 'free'"
    ).fetchone()[0]
    print(f"\nBEFORE: {total} users | {null_trial} with NULL trial_ends_at | {free_null} free-tier with NULL")

    # Backfill: only free-tier users with NULL trial_ends_at
    rows = conn.execute(
        "SELECT id, email, subscription_tier, created_at FROM User "
        "WHERE trial_ends_at IS NULL AND subscription_tier = 'free'"
    ).fetchall()

    print(f"\nUsers to backfill: {len(rows)}")
    new_trial_ends = datetime.now(timezone.utc) + timedelta(days=TRIAL_DAYS)

    updated = 0
    for row in rows:
        if not args.dry_run:
            conn.execute(
                "UPDATE User SET trial_ends_at = ?, updated_at = ? WHERE id = ?",
                (new_trial_ends.isoformat(), datetime.now(timezone.utc).isoformat(), row["id"])
            )
        updated += 1
        if updated <= 5:
            print(f"  {row['email']} ({row['subscription_tier']}) → trial_ends_at = {new_trial_ends.isoformat()}")

    if not args.dry_run:
        conn.commit()

    # AFTER
    null_after = conn.execute("SELECT COUNT(*) FROM User WHERE trial_ends_at IS NULL").fetchone()[0]
    print(f"\nAFTER: {null_after} users with NULL trial_ends_at (was {null_trial})")
    print(f"Updated: {updated} free-tier users → trial_ends_at = NOW()+{TRIAL_DAYS}d")

    conn.close()
    print(f"\n✅ Done.{' (dry-run — no writes)' if args.dry_run else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
