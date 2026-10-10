#!/usr/bin/env python3
"""
FIX-WAVE-3-HIGH Fix 4 — Reclassify false TARGET_HIT rows in predictions.db.

Per AUDIT-DEEP-2 #2 (CRITICAL): ~242 rows have status='TARGET_HIT' but the
target was never actually reached (highest_price_reached < target_price).
These are data-integrity violations: they inflate the win rate by counting
positions as wins even when the price never hit the target.

Reclassification logic (per task spec; aligned with FIX-WAVE-2-DATA canonical
4-status scheme):
  - actual_return > 0  → 'EXPIRED'  (canonical equivalent of 'CLOSED' —
                                     position ran out of time without hitting
                                     target; was profitable but not target hit)
  - actual_return <= 0 → 'STOPPED'  (likely the stop was hit but exit_price
                                      wasn't recorded correctly)

Idempotent: re-running on already-fixed DB is a no-op.

Rule 1: sandbox DB only (writes allowed). Rule 56: parameterized SQL.
"""

import sqlite3
import sys
from pathlib import Path
from datetime import datetime, timezone

DB_PATH = Path('/home/z/my-project/db/predictions.db')

def main() -> int:
    if not DB_PATH.exists():
        print(f"ERROR: {DB_PATH} not found", file=sys.stderr)
        return 1

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # Pre-fix counts
    before_target_hit = c.execute(
        "SELECT COUNT(*) FROM predictions WHERE status = 'TARGET_HIT'"
    ).fetchone()[0]
    false_count = c.execute(
        "SELECT COUNT(*) FROM predictions WHERE status = 'TARGET_HIT' "
        "AND highest_price_reached < target_price"
    ).fetchone()[0]
    print(f"[before] TARGET_HIT total: {before_target_hit}")
    print(f"[before] false TARGET_HIT (highest < target): {false_count}")

    if false_count == 0:
        print("Nothing to fix. Exiting.")
        conn.close()
        return 0

    # Reclassify — use parameterized SQL (Rule 56)
    now_iso = datetime.now(timezone.utc).isoformat()

    # Positive actual_return → 'EXPIRED' (canonical equivalent of 'CLOSED')
    cur_pos = c.execute(
        "UPDATE predictions "
        "SET status = 'EXPIRED', "
        "    exit_reason = COALESCE(exit_reason, 'auto_reclassified_false_target_hit_positive'), "
        "    updated_at = ? "
        "WHERE status = 'TARGET_HIT' "
        "  AND highest_price_reached < target_price "
        "  AND actual_return > 0",
        (now_iso,)
    )
    positive_reclassified = cur_pos.rowcount

    # Non-positive actual_return → 'STOPPED'
    cur_neg = c.execute(
        "UPDATE predictions "
        "SET status = 'STOPPED', "
        "    exit_reason = COALESCE(exit_reason, 'auto_reclassified_false_target_hit_stopped'), "
        "    updated_at = ? "
        "WHERE status = 'TARGET_HIT' "
        "  AND highest_price_reached < target_price "
        "  AND actual_return <= 0",
        (now_iso,)
    )
    negative_reclassified = cur_neg.rowcount

    conn.commit()

    # Post-fix verification
    after_false = c.execute(
        "SELECT COUNT(*) FROM predictions WHERE status = 'TARGET_HIT' "
        "AND highest_price_reached < target_price"
    ).fetchone()[0]
    after_target_hit = c.execute(
        "SELECT COUNT(*) FROM predictions WHERE status = 'TARGET_HIT'"
    ).fetchone()[0]
    expired_count = c.execute(
        "SELECT COUNT(*) FROM predictions WHERE status = 'EXPIRED'"
    ).fetchone()[0]
    stopped_count = c.execute(
        "SELECT COUNT(*) FROM predictions WHERE status = 'STOPPED'"
    ).fetchone()[0]

    print()
    print(f"[after] TARGET_HIT total: {after_target_hit}")
    print(f"[after] false TARGET_HIT remaining: {after_false}")
    print(f"[after] EXPIRED total: {expired_count}")
    print(f"[after] STOPPED total: {stopped_count}")
    print()
    print(f"Reclassified {positive_reclassified} rows → EXPIRED (positive actual_return)")
    print(f"Reclassified {negative_reclassified} rows → STOPPED (non-positive actual_return)")
    print(f"Total rows fixed: {positive_reclassified + negative_reclassified}")

    conn.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
