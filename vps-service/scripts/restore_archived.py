"""
restore_archived — DEV-11 §5 — Reverse prior bulk-archive of predictions
=======================================================================

DEV-06 disabled hard DELETEs by replacing them with
``UPDATE predictions SET status='ARCHIVED', notes=... WHERE <cond>``.
DEV-11 closed the masked-wipe hole (``WHERE 1=1``), but some rows may have
already been archived by the previous masked-wipe runs and need to be
restored so historical analytics (honest-tracking / league-report) reflect
the real outcomes (TARGET_HIT / STOPPED / EXPIRED).

This script reads the ``prev_status`` column (added by
``add_prev_status_column.py``) for every row whose current status is
``ARCHIVED``, and restores the prior status.

Strategy
--------
1. ``prev_status IS NOT NULL`` → the row was archived by a per-id UPDATE
   that correctly populated ``prev_status``. We revert status to
   ``prev_status`` and clear ``prev_status``.

2. ``prev_status IS NULL`` but the row has ``outcome_date IS NOT NULL`` and
   a closed-state ``exit_type`` (TARGET_HIT / STOPPED / EXPIRED) — we
   restore status to the value implied by ``exit_type``. This handles
   legacy archived rows from before the ``prev_status`` column existed.

3. ``prev_status IS NULL`` and the row is still pending (``outcome_date
   IS NULL``) — we restore to ``ACTIVE``. The original status of a pending
   row is always ACTIVE.

4. ``notes`` contains ``DEV-06-ARCHIVED`` marker → we strip it so the
   analytics queries don't see archived markers anymore.

Properties
----------
- DRY-RUN by default — prints a report; requires ``--execute`` to write.
- BACKUP before any write — copies predictions.db to
  ``db/predictions.bak.dev-11.<UTC-ts>.db``.
- IDEMPOTENT — running it twice is a no-op (the second run finds 0 rows
  to restore because prev_status is already cleared).

Usage
-----
    python3 vps-service/scripts/restore_archived.py --dry-run
    python3 vps-service/scripts/restore_archived.py --execute
    python3 vps-service/scripts/restore_archived.py --db /custom/path.db --execute

References
----------
- agent-ctx/DEV-11-14-lead-technical-implementer.md §5
- worklog.md DEV-11
"""
from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

# Resolve project root for DB path discovery
_VPS_ROOT = Path(__file__).resolve().parents[1]
_PROJECT_ROOT = _VPS_ROOT.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

try:
    from utils.db_paths import DBPaths
    DEFAULT_DB_PATH = DBPaths.PREDICTIONS_DB
except Exception:
    DEFAULT_DB_PATH = str(_PROJECT_ROOT / 'db' / 'predictions.db')


# Status implied by exit_type, used for legacy archived rows where
# prev_status is NULL. Map: exit_type → status.
# exit_type='TARGET_HIT' (TP1/TP2 hit) → status='TARGET_HIT'
# exit_type='STOPPED' / 'STOP_LOSS'    → status='STOPPED'
# exit_type='EXPIRED' / 'TIMEOUT'      → status='EXPIRED'
EXIT_TYPE_TO_STATUS = {
    'TARGET_HIT': 'TARGET_HIT',
    'TP1': 'TARGET_HIT',
    'TP2': 'TARGET_HIT',
    'TARGET_2_HIT': 'TARGET_HIT',
    'STOPPED': 'STOPPED',
    'STOP_LOSS': 'STOPPED',
    'STOP_LOSS_HIT': 'STOPPED',
    'EXPIRED': 'EXPIRED',
    'TIMEOUT': 'EXPIRED',
    'TIME_OUT': 'EXPIRED',
}


def log(msg: str) -> None:
    print(f"[DEV-11] {msg}", flush=True)


def backup_db(db_path: str) -> str | None:
    """Copy predictions.db to db/predictions.bak.dev-11.<UTC-ts>.db"""
    src = Path(db_path)
    if not src.exists():
        log(f"  source DB not found: {db_path} — skipping backup.")
        return None
    ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    bak = src.parent / f"predictions.bak.dev-11.{ts}.db"
    try:
        shutil.copy2(src, bak)
        log(f"  backup: {bak}")
        return str(bak)
    except OSError as e:
        log(f"  backup FAILED: {e}")
        return None


def classify_restoration(rows: list) -> dict:
    """Bucket archived rows into restoration categories.

    Args:
        rows: list of (id, ticker, prev_status, outcome_date, exit_type, notes)

    Returns:
        dict with keys: from_prev_status, from_exit_type, from_pending,
        total_rows, by_status_after.
    """
    from_prev_status: list = []   # prev_status IS NOT NULL → restore prev_status
    from_exit_type: list = []    # prev_status IS NULL + has exit_type → restore from exit_type
    from_pending: list = []      # prev_status IS NULL + no outcome_date → ACTIVE

    for row in rows:
        pred_id, ticker, prev_status, outcome_date, exit_type, notes = row
        if prev_status:
            from_prev_status.append((pred_id, ticker, prev_status))
        elif outcome_date and exit_type and exit_type.upper() in EXIT_TYPE_TO_STATUS:
            new_status = EXIT_TYPE_TO_STATUS[exit_type.upper()]
            from_exit_type.append((pred_id, ticker, new_status))
        else:
            # Pending row (outcome_date IS NULL) or unknown exit_type — restore to ACTIVE
            from_pending.append((pred_id, ticker, 'ACTIVE'))

    return {
        'from_prev_status': from_prev_status,
        'from_exit_type': from_exit_type,
        'from_pending': from_pending,
        'total_rows': len(rows),
    }


def fetch_archived(conn: sqlite3.Connection) -> list:
    """Fetch all rows whose status = 'ARCHIVED'."""
    cur = conn.execute(
        "SELECT id, ticker, prev_status, outcome_date, exit_type, notes "
        "FROM predictions WHERE status = 'ARCHIVED'"
    )
    return cur.fetchall()


def restore(conn: sqlite3.Connection, buckets: dict, execute: bool) -> int:
    """Apply the restoration UPDATEs. Returns total rows updated.

    Three UPDATE paths, one per bucket. Each uses ``WHERE id = ?`` (never
    WHERE 1=1) and clears ``prev_status`` so the script is idempotent.
    """
    total = 0

    # (1) prev_status IS NOT NULL → restore prev_status, clear prev_status,
    #     strip DEV-06-ARCHIVED marker from notes.
    for pred_id, _ticker, prev_status in buckets['from_prev_status']:
        if execute:
            conn.execute(
                "UPDATE predictions "
                "SET status = ?, "
                "    prev_status = NULL, "
                "    notes = REPLACE(COALESCE(notes, ''), ' | DEV-06-ARCHIVED', '') "
                "WHERE id = ?",
                (prev_status, pred_id),
            )
        total += 1

    # (2) prev_status IS NULL + exit_type → restore from exit_type, clear prev.
    for pred_id, _ticker, new_status in buckets['from_exit_type']:
        if execute:
            conn.execute(
                "UPDATE predictions "
                "SET status = ?, "
                "    prev_status = NULL, "
                "    notes = REPLACE(COALESCE(notes, ''), ' | DEV-06-ARCHIVED', '') "
                "WHERE id = ?",
                (new_status, pred_id),
            )
        total += 1

    # (3) prev_status IS NULL + pending → ACTIVE.
    for pred_id, _ticker, _new_status in buckets['from_pending']:
        if execute:
            conn.execute(
                "UPDATE predictions "
                "SET status = 'ACTIVE', "
                "    prev_status = NULL, "
                "    notes = REPLACE(COALESCE(notes, ''), ' | DEV-06-ARCHIVED', '') "
                "WHERE id = ?",
                (pred_id,),
            )
        total += 1

    if execute:
        conn.commit()
    return total


def main() -> int:
    ap = argparse.ArgumentParser(
        description='DEV-11 §5 — Restore predictions previously masked-archived',
    )
    ap.add_argument(
        '--db',
        default=DEFAULT_DB_PATH,
        help=f'Path to predictions.db (default: {DEFAULT_DB_PATH})',
    )
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument(
        '--dry-run',
        action='store_true',
        help='Print a report — do not write (default).',
    )
    mode.add_argument(
        '--execute',
        action='store_true',
        help='Apply the restoration (creates a backup first).',
    )
    args = ap.parse_args()

    execute = args.execute
    if not execute and not args.dry_run:
        # default to dry-run
        args.dry_run = True

    db_path = str(args.db)
    log(f"DB: {db_path}")
    log(f"Mode: {'EXECUTE' if execute else 'DRY-RUN'}")

    if execute:
        bak = backup_db(db_path)
        if bak is None:
            log("Backup failed — aborting.")
            return 1

    try:
        conn = sqlite3.connect(db_path, timeout=30.0)
        conn.execute('PRAGMA busy_timeout=30000')
        try:
            rows = fetch_archived(conn)
        except sqlite3.Error as e:
            log(f"fetch_archived failed: {e}")
            return 1

        if not rows:
            log("✓ 0 rows currently ARCHIVED — nothing to restore.")
            return 0

        buckets = classify_restoration(rows)

        log(f"Total ARCHIVED rows: {buckets['total_rows']}")
        log(f"  restoration from prev_status (NOT NULL): {len(buckets['from_prev_status'])}")
        log(f"  restoration from exit_type (closed):     {len(buckets['from_exit_type'])}")
        log(f"  restoration to ACTIVE (pending):         {len(buckets['from_pending'])}")

        # Show sample of each bucket (max 5 each)
        for name, bucket in (
            ('from_prev_status', buckets['from_prev_status']),
            ('from_exit_type', buckets['from_exit_type']),
            ('from_pending', buckets['from_pending']),
        ):
            if bucket:
                log(f"  sample [{name}]:")
                for row in bucket[:5]:
                    log(f"    id={row[0]} ticker={row[1]} → status={row[2]}")

        total = restore(conn, buckets, execute)
        log(f"Restoration {'applied' if execute else 'projected'}: {total} rows.")

        if execute:
            # Verify idempotency — re-fetch should be 0
            remaining = fetch_archived(conn)
            log(f"Post-execute ARCHIVED rows: {len(remaining)} "
                f"(should be 0 for full restoration).")
        return 0
    finally:
        try:
            conn.close()
        except Exception:
            pass


if __name__ == '__main__':
    sys.exit(main())
