#!/usr/bin/env python3
"""
BRAVO-DB-CLEANUP-001 — Predictions DB cleanup script.
======================================================
Backfills risk_reward + flags Rule 18/8 violators. Idempotent + audit trail.

Rule 17 (RELATIVE-PATHS-ONLY): uses Path(__file__).resolve().parents[1]
→ works on laptop (/home/meme/...), VPS (/root/GLMinvestment/), sandbox (/home/z/...).

Sub-tasks:
  1. Backfill risk_reward: for every row in predictions + aiPrediction where
     risk_reward = 0.0 OR NULL → compute R/R = (target - entry) / (entry - stop).
  2. Flag violators:
     - R/R < 1.8 → status = 'QUARANTINED_RR_VIOLATION' (Rule 18)
     - stop outside [5%, 9%] → status = 'QUARANTINED_STOP_VIOLATION' (Rule 8)
     Original status preserved in quality_flags (predictions) / notes (aiPrediction).

NO DELETE. Only UPDATE. Idempotent (running twice = same result).

Usage:
    python3 scripts/db_cleanup.py              # run both sub-tasks
    python3 scripts/db_cleanup.py --backfill   # only backfill risk_reward
    python3 scripts/db_cleanup.py --flag       # only flag violators
    python3 scripts/db_cleanup.py --dry-run    # show what would change, no writes
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from pathlib import Path
from typing import Any

# Rule 17: relative paths — works on laptop + VPS + sandbox.
# Script lives at vps-service/scripts/db_cleanup.py → parents[2] = project root.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"

# Rule 18: R/R floor. Rule 8: ATR stop range.
RR_FLOOR = 1.8
STOP_MIN_PCT = 5.0
STOP_MAX_PCT = 9.0


def _connect(db_path: Path) -> sqlite3.Connection:
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(db_path), writable=True).__enter__()
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA busy_timeout=30000;")
    return conn


def _compute_rr(entry: float, stop: float, target: float) -> float | None:
    """Compute R/R = (target - entry) / (entry - stop). None if invalid geometry."""
    if entry <= 0 or stop <= 0 or target <= 0:
        return None
    if stop >= entry or target <= entry:
        return None
    risk = entry - stop
    reward = target - entry
    return round(reward / risk, 4) if risk > 0 else None


def _compute_stop_pct(entry: float, stop: float) -> float | None:
    """Compute stop percentage = (entry - stop) / entry * 100. None if invalid."""
    if entry <= 0 or stop <= 0 or stop >= entry:
        return None
    return round(((entry - stop) / entry) * 100, 4)


def _is_quarantined(status: str | None) -> bool:
    """Check if status already indicates quarantine (idempotency check)."""
    if not status:
        return False
    return status.startswith("QUARANTINED_")


def backfill_risk_reward(conn: sqlite3.Connection, dry_run: bool = False) -> dict[str, int]:
    """Sub-task 1: backfill risk_reward where 0.0 or NULL.

    Targets BOTH predictions table and aiPrediction table.
    Idempotent: only updates rows where risk_reward = 0.0 OR NULL.
    """
    stats = {"predictions_needs": 0, "predictions_updated": 0,
             "aiPrediction_needs": 0, "aiPrediction_updated": 0}

    # ── predictions table ──
    rows = conn.execute("""
        SELECT id, entry_price, target_price, stop_loss, risk_reward
        FROM predictions
        WHERE risk_reward IS NULL OR risk_reward = 0.0
    """).fetchall()
    stats["predictions_needs"] = len(rows)
    print(f"  [predictions] rows needing backfill: {len(rows)}")

    for row in rows:
        rr = _compute_rr(float(row["entry_price"]), float(row["stop_loss"]),
                         float(row["target_price"]))
        if rr is not None and not dry_run:
            conn.execute("UPDATE predictions SET risk_reward = ? WHERE id = ?",
                         (rr, row["id"]))
            stats["predictions_updated"] += 1
        elif rr is not None and dry_run:
            stats["predictions_updated"] += 1
        else:
            print(f"    SKIP id={row['id']}: invalid geometry (entry/stop/target)")

    # ── aiPrediction table ──
    rows = conn.execute("""
        SELECT id, entry_price, target_price, stop_loss, risk_reward
        FROM aiPrediction
        WHERE risk_reward IS NULL OR risk_reward = 0.0
    """).fetchall()
    stats["aiPrediction_needs"] = len(rows)
    print(f"  [aiPrediction] rows needing backfill: {len(rows)}")

    for row in rows:
        rr = _compute_rr(float(row["entry_price"]), float(row["stop_loss"]),
                         float(row["target_price"]))
        if rr is not None and not dry_run:
            conn.execute("UPDATE aiPrediction SET risk_reward = ? WHERE id = ?",
                         (rr, row["id"]))
            stats["aiPrediction_updated"] += 1
        elif rr is not None and dry_run:
            stats["aiPrediction_updated"] += 1
        else:
            print(f"    SKIP id={row['id']}: invalid geometry")

    if not dry_run:
        conn.commit()
    return stats


def flag_violators(conn: sqlite3.Connection, dry_run: bool = False) -> dict[str, int]:
    """Sub-task 2: flag Rule 18 / Rule 8 violators.

    Sets status to QUARANTINED_RR_VIOLATION or QUARANTINED_STOP_VIOLATION.
    Preserves original status in quality_flags (predictions) / notes (aiPrediction).
    Idempotent: skips rows already quarantined.
    """
    stats = {"rr_violations": 0, "stop_violations": 0, "skipped_already_quarantined": 0}

    for table, id_col, flag_col in [
        ("predictions", "id", "quality_flags"),
        ("aiPrediction", "id", "notes"),
    ]:
        print(f"\n  [{table}] scanning for violators...")
        rows = conn.execute(f"""
            SELECT {id_col} as id, entry_price, target_price, stop_loss, risk_reward, status, {flag_col} as flag_col
            FROM {table}
            WHERE entry_price > 0 AND stop_loss > 0 AND target_price > 0
        """).fetchall()

        rr_count = 0
        stop_count = 0
        skipped = 0

        for row in rows:
            # Idempotency: skip already-quarantined rows
            if _is_quarantined(row["status"]):
                skipped += 1
                continue

            entry = float(row["entry_price"])
            stop = float(row["stop_loss"])
            target = float(row["target_price"])

            # Use stored risk_reward if valid, else compute
            stored_rr = float(row["risk_reward"]) if row["risk_reward"] is not None else 0.0
            computed_rr = _compute_rr(entry, stop, target)
            effective_rr = computed_rr if computed_rr is not None else stored_rr

            stop_pct = _compute_stop_pct(entry, stop)

            new_status = None
            reason = None
            # Check R/R violation (Rule 18)
            if effective_rr is not None and effective_rr < RR_FLOOR:
                new_status = "QUARANTINED_RR_VIOLATION"
                reason = f"R/R={effective_rr:.2f} < {RR_FLOOR}"
                rr_count += 1
            # Check stop violation (Rule 8) — only if not already quarantined for RR
            elif stop_pct is not None and not (STOP_MIN_PCT <= stop_pct <= STOP_MAX_PCT):
                new_status = "QUARANTINED_STOP_VIOLATION"
                reason = f"stop={stop_pct:.2f}% outside [{STOP_MIN_PCT}%, {STOP_MAX_PCT}%]"
                stop_count += 1

            if new_status and not dry_run:
                # Preserve original status + reason in audit column
                old_status = row["status"] or "NULL"
                old_flag = row["flag_col"] or ""
                audit_trail = f"[BRAVO-CLEANUP original_status={old_status} reason={reason}]"
                new_flag = f"{old_flag} {audit_trail}".strip() if old_flag else audit_trail
                conn.execute(
                    f"UPDATE {table} SET status = ?, {flag_col} = ? WHERE {id_col} = ?",
                    (new_status, new_flag, row["id"])
                )

        stats["rr_violations"] += rr_count
        stats["stop_violations"] += stop_count
        stats["skipped_already_quarantined"] += skipped
        print(f"    RR violations flagged: {rr_count}")
        print(f"    Stop violations flagged: {stop_count}")
        print(f"    Already quarantined (skipped): {skipped}")

    if not dry_run:
        conn.commit()
    return stats


def print_before_counts(conn: sqlite3.Connection) -> None:
    """Print before-state counts for audit log."""
    print("\n=== BEFORE STATE ===")
    for table in ["predictions", "aiPrediction"]:
        total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        rr_zero = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE risk_reward IS NULL OR risk_reward = 0.0"
        ).fetchone()[0]
        quarantined = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE status LIKE 'QUARANTINED_%'"
        ).fetchone()[0]
        print(f"  {table}: {total} total | {rr_zero} rr=0/null | {quarantined} already quarantined")


def print_after_counts(conn: sqlite3.Connection) -> None:
    """Print after-state counts for audit log."""
    print("\n=== AFTER STATE ===")
    for table in ["predictions", "aiPrediction"]:
        total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        rr_zero = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE risk_reward IS NULL OR risk_reward = 0.0"
        ).fetchone()[0]
        rr_below = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE risk_reward > 0 AND risk_reward < {RR_FLOOR}"
        ).fetchone()[0]
        rr_above = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE risk_reward >= {RR_FLOOR}"
        ).fetchone()[0]
        q_rr = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE status = 'QUARANTINED_RR_VIOLATION'"
        ).fetchone()[0]
        q_stop = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE status = 'QUARANTINED_STOP_VIOLATION'"
        ).fetchone()[0]
        print(f"  {table}: {total} total | rr=0/null: {rr_zero} | rr<{RR_FLOOR}: {rr_below} | rr>={RR_FLOOR}: {rr_above}")
        print(f"    QUARANTINED_RR_VIOLATION: {q_rr} | QUARANTINED_STOP_VIOLATION: {q_stop}")


def main() -> int:
    parser = argparse.ArgumentParser(description="BRAVO-DB-CLEANUP-001 — predictions cleanup")
    parser.add_argument("--backfill", action="store_true", help="Only backfill risk_reward")
    parser.add_argument("--flag", action="store_true", help="Only flag violators")
    parser.add_argument("--dry-run", action="store_true", help="Show changes without writing")
    args = parser.parse_args()

    # Default: run both sub-tasks
    run_backfill = args.backfill or (not args.backfill and not args.flag)
    run_flag = args.flag or (not args.backfill and not args.flag)

    print("=" * 72)
    print("BRAVO-DB-CLEANUP-001 — Predictions DB cleanup")
    print(f"DB: {PREDICTIONS_DB}")
    print(f"Mode: {'DRY-RUN' if args.dry_run else 'WRITE'}")
    print(f"RR floor: {RR_FLOOR} | Stop range: [{STOP_MIN_PCT}%, {STOP_MAX_PCT}%]")
    print("=" * 72)

    if not PREDICTIONS_DB.exists():
        print(f"ERROR: {PREDICTIONS_DB} not found")
        return 1

    conn = _connect(PREDICTIONS_DB)
    print_before_counts(conn)

    if run_backfill:
        print("\n── SUB-TASK 1: Backfill risk_reward ──")
        bf_stats = backfill_risk_reward(conn, dry_run=args.dry_run)
        print(f"  predictions: {bf_stats['predictions_updated']}/{bf_stats['predictions_needs']} updated")
        print(f"  aiPrediction: {bf_stats['aiPrediction_updated']}/{bf_stats['aiPrediction_needs']} updated")

    if run_flag:
        print("\n── SUB-TASK 2: Flag violators ──")
        flag_stats = flag_violators(conn, dry_run=args.dry_run)
        print(f"  Total RR violations flagged: {flag_stats['rr_violations']}")
        print(f"  Total Stop violations flagged: {flag_stats['stop_violations']}")
        print(f"  Already quarantined (skipped): {flag_stats['skipped_already_quarantined']}")

    if not args.dry_run:
        print_after_counts(conn)

    conn.close()
    print("\n✅ Done." + (" (dry-run — no writes)" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
