#!/usr/bin/env python3
"""
backfill_hit_timestamps.py — DEV-08 §2 Backfill target_hit_at + stop_hit_at
============================================================================

Backfill target_hit_at + stop_hit_at for historical predictions whose
hit-timestamps were left NULL by the legacy DEV-02 path (which only started
writing these columns after 2026-10-12). On the production VPS this
affects ~506 TARGET_HIT + ~83 STOPPED rows.

Strategy (per DEV-08 task spec):

  For each prediction with status='TARGET_HIT' AND target_hit_at IS NULL:
    → target_hit_at = outcome_date (تاريخ الإغلاق المسجل)

  For each prediction with status='STOPPED' AND stop_hit_at IS NULL:
    → stop_hit_at = outcome_date (تاريخ الإغلاق المسجل)

  Also validates exit_price:
    - If exit_price IS NULL or <= 0 AND status='TARGET_HIT':
        → exit_price = target_price (السعر المسجل كهدف)
    - If exit_price IS NULL or <= 0 AND status='STOPPED':
        → exit_price = stop_loss (السعر المسجل كوقف)

  The timestamp is stored as `<outcome_date>T00:00:00+00:00` — an explicit
  UTC ISO-8601 string. This is a "close-time" timestamp, NOT an intraday
  hit-time (we cannot derive the latter from daily OHLC bars; that would
  require intraday tick data). outcome_date already records the day on
  which the daily_closer detected the hit/stop.

Properties:
  - DRY-RUN by default (no DB writes).
  - Backs up predictions.db → .bak.dev-08.<utc-ts>.db before any UPDATE.
  - IDEMPOTENT: every UPDATE has `AND <column> IS NULL` in WHERE —
    re-running the script after success yields 0 changes.
  - Prints a categorized report: counts of rows backfilled, missing
    outcome_date (skipped), and "suspect" rows where exit_price already
    equals target_price / stop_loss (potential synthetic fill).

Usage:
    python3 vps-service/scripts/backfill_hit_timestamps.py --dry-run
    python3 vps-service/scripts/backfill_hit_timestamps.py --execute

    # Override DB path (default: db/predictions.db or $PREDICTIONS_DB):
    python3 vps-service/scripts/backfill_hit_timestamps.py --db /path/to/predictions.db --dry-run

Exit codes:
    0 = success (dry-run or execute)
    2 = fatal error (DB not found / wrong args / SQLite error)

References:
    - Documentation/00-CONSTITUTION.md §27 (NO-FAKE-DATA)
    - worklog.md DEV-08
    - vps-service/jobs/daily_closer.py::_mark_closed (target_hit_at/stop_hit_at writers)
"""
from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

# ─────────────────────────────────────────────────────────────────────────────
# Path resolution — same pattern as add_prediction_guard_trigger.py (DEV-07)
# ─────────────────────────────────────────────────────────────────────────────
_VPS_ROOT = Path(__file__).resolve().parents[1]  # vps-service/
_PROJECT_ROOT = _VPS_ROOT.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

try:
    from utils.db_paths import DBPaths  # type: ignore
    DEFAULT_DB_PATH = DBPaths.PREDICTIONS_DB
except Exception:
    DEFAULT_DB_PATH = str(_PROJECT_ROOT / 'db' / 'predictions.db')


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def get_db_path(cli_arg: str | None) -> Path:
    """Resolve DB path: CLI arg > env var > default."""
    if cli_arg:
        return Path(cli_arg).resolve()
    env = os.environ.get('PREDICTIONS_DB_PATH')
    if env:
        return Path(env).resolve()
    return Path(DEFAULT_DB_PATH).resolve()


def backup_db(db_path: Path) -> Path:
    """Copy predictions.db → .bak.dev-08.<UTC-ts>.db before any UPDATE.

    Uses shutil.copy2 to preserve file metadata.
    """
    ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    bak_path = db_path.parent / f"{db_path.stem}.bak.dev-08.{ts}{db_path.suffix}"
    shutil.copy2(db_path, bak_path)
    return bak_path


def iso_utc_from_date(date_str: str | None) -> str | None:
    """Convert a YYYY-MM-DD date string to `<date>T00:00:00+00:00`.

    Returns None if the input is empty/None — caller should skip such rows.
    """
    if not date_str or not date_str.strip():
        return None
    return f"{date_str}T00:00:00+00:00"


# ─────────────────────────────────────────────────────────────────────────────
# SQL — all UPDATEs are idempotent (WHERE column IS NULL)
# ─────────────────────────────────────────────────────────────────────────────
SQL_SCAN_TARGET_HIT = """
    SELECT id, ticker, outcome_date, target_price, exit_price, actual_exit_price
    FROM predictions
    WHERE status = 'TARGET_HIT' AND target_hit_at IS NULL
    ORDER BY id
"""

SQL_SCAN_STOPPED = """
    SELECT id, ticker, outcome_date, stop_loss, exit_price, actual_exit_price
    FROM predictions
    WHERE status = 'STOPPED' AND stop_hit_at IS NULL
    ORDER BY id
"""

SQL_BACKFILL_TARGET_HIT_AT = """
    UPDATE predictions
    SET target_hit_at = outcome_date || 'T00:00:00+00:00'
    WHERE status = 'TARGET_HIT'
      AND target_hit_at IS NULL
      AND outcome_date IS NOT NULL
      AND outcome_date != ''
"""

SQL_BACKFILL_STOP_HIT_AT = """
    UPDATE predictions
    SET stop_hit_at = outcome_date || 'T00:00:00+00:00'
    WHERE status = 'STOPPED'
      AND stop_hit_at IS NULL
      AND outcome_date IS NOT NULL
      AND outcome_date != ''
"""

SQL_BACKFILL_EXIT_PRICE_TARGET = """
    UPDATE predictions
    SET exit_price = target_price
    WHERE status = 'TARGET_HIT'
      AND (exit_price IS NULL OR exit_price <= 0)
      AND target_price IS NOT NULL
      AND target_price > 0
"""

SQL_BACKFILL_EXIT_PRICE_STOP = """
    UPDATE predictions
    SET exit_price = stop_loss
    WHERE status = 'STOPPED'
      AND (exit_price IS NULL OR exit_price <= 0)
      AND stop_loss IS NOT NULL
      AND stop_loss > 0
"""

# Count projections for dry-run (must match the WHERE clauses above)
SQL_COUNT_BACKFILL_TARGET_HIT_AT = """
    SELECT COUNT(*) FROM predictions
    WHERE status = 'TARGET_HIT'
      AND target_hit_at IS NULL
      AND outcome_date IS NOT NULL
      AND outcome_date != ''
"""

SQL_COUNT_BACKFILL_STOP_HIT_AT = """
    SELECT COUNT(*) FROM predictions
    WHERE status = 'STOPPED'
      AND stop_hit_at IS NULL
      AND outcome_date IS NOT NULL
      AND outcome_date != ''
"""

SQL_COUNT_BACKFILL_EXIT_PRICE_TARGET = """
    SELECT COUNT(*) FROM predictions
    WHERE status = 'TARGET_HIT'
      AND (exit_price IS NULL OR exit_price <= 0)
      AND target_price IS NOT NULL
      AND target_price > 0
"""

SQL_COUNT_BACKFILL_EXIT_PRICE_STOP = """
    SELECT COUNT(*) FROM predictions
    WHERE status = 'STOPPED'
      AND (exit_price IS NULL OR exit_price <= 0)
      AND stop_loss IS NOT NULL
      AND stop_loss > 0
"""


# ─────────────────────────────────────────────────────────────────────────────
# exit_price analysis (suspect detection)
# ─────────────────────────────────────────────────────────────────────────────
def analyze_exit_price(target_rows, stop_rows):
    """Categorize exit_price validity.

    Returns a dict with the following keys (each a list of prediction IDs):
      target_*:
        uses_market_price   — exit_price is set and != target_price (real market exit)
        equal_to_target     — exit_price exactly == target_price (potential synthetic fill)
        no_exit             — exit_price is NULL or <= 0 (will be backfilled from target_price)
        missing_outcome_date — outcome_date NULL/empty (will be skipped by target_hit_at backfill)
      stop_*:
        uses_market_price   — exit_price is set and != stop_loss (real market exit)
        equal_to_stop       — exit_price exactly == stop_loss (potential synthetic fill)
        no_exit             — exit_price is NULL or <= 0 (will be backfilled from stop_loss)
        missing_outcome_date — outcome_date NULL/empty (will be skipped by stop_hit_at backfill)
    """
    target_uses_market_price, target_equal_to_target, target_no_exit, target_missing_od = [], [], [], []
    stop_uses_market_price, stop_equal_to_stop, stop_no_exit, stop_missing_od = [], [], [], []

    for r in target_rows:
        pred_id, _ticker, outcome_date, target_price, exit_price, actual_exit_price = r
        if not outcome_date or not str(outcome_date).strip():
            target_missing_od.append(pred_id)
            continue
        # Prefer exit_price; fall back to actual_exit_price (the column daily_closer writes to)
        price = exit_price if (exit_price is not None and exit_price > 0) else actual_exit_price
        if price is None or price <= 0:
            target_no_exit.append(pred_id)
        elif target_price is not None and target_price > 0 and abs(float(price) - float(target_price)) < 1e-4:
            target_equal_to_target.append(pred_id)
        else:
            target_uses_market_price.append(pred_id)

    for r in stop_rows:
        pred_id, _ticker, outcome_date, stop_loss, exit_price, actual_exit_price = r
        if not outcome_date or not str(outcome_date).strip():
            stop_missing_od.append(pred_id)
            continue
        price = exit_price if (exit_price is not None and exit_price > 0) else actual_exit_price
        if price is None or price <= 0:
            stop_no_exit.append(pred_id)
        elif stop_loss is not None and stop_loss > 0 and abs(float(price) - float(stop_loss)) < 1e-4:
            stop_equal_to_stop.append(pred_id)
        else:
            stop_uses_market_price.append(pred_id)

    return {
        'target_uses_market_price': target_uses_market_price,
        'target_equal_to_target': target_equal_to_target,
        'target_no_exit': target_no_exit,
        'target_missing_outcome_date': target_missing_od,
        'stop_uses_market_price': stop_uses_market_price,
        'stop_equal_to_stop': stop_equal_to_stop,
        'stop_no_exit': stop_no_exit,
        'stop_missing_outcome_date': stop_missing_od,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--dry-run', action='store_true', default=False,
                        help='Print report only — do not modify DB (default if no flag given).')
    parser.add_argument('--execute', action='store_true', default=False,
                        help='Apply backfill (backup → UPDATE → commit).')
    parser.add_argument('--db', type=str, default=None,
                        help='Path to predictions.db (default: db/predictions.db or $PREDICTIONS_DB_PATH).')
    args = parser.parse_args()

    if args.execute and args.dry_run:
        parser.error('Cannot use --dry-run and --execute together.')
    # Default mode = dry-run
    if not args.execute and not args.dry_run:
        args.dry_run = True

    db_path = get_db_path(args.db)
    if not db_path.exists():
        print(f'ERROR: DB file not found at {db_path}', file=sys.stderr)
        return 2

    print('=' * 78)
    print('DEV-08 §2 — Backfill target_hit_at + stop_hit_at + exit_price')
    print('=' * 78)
    print(f'DB : {db_path}')
    print(f'Mode: {"DRY-RUN (no changes)" if args.dry_run else "EXECUTE (will modify DB)"}')
    print()

    # ── Connect (read-only for dry-run, RW for execute) ──
    if args.dry_run:
        uri = f'file:{db_path.as_posix()}?mode=ro'
        try:
            conn = sqlite3.connect(uri, uri=True)
        except sqlite3.OperationalError as e:
            print(f'ERROR: cannot open DB read-only: {e}', file=sys.stderr)
            return 2
    else:
        bak_path = backup_db(db_path)
        print(f'Backup: {bak_path}')
        try:
            conn = sqlite3.connect(str(db_path))
        except sqlite3.OperationalError as e:
            print(f'ERROR: cannot open DB read-write: {e}', file=sys.stderr)
            return 2

    try:
        cur = conn.cursor()

        # ── Scan rows whose target_hit_at / stop_hit_at is NULL ──
        cur.execute(SQL_SCAN_TARGET_HIT)
        target_rows = cur.fetchall()
        cur.execute(SQL_SCAN_STOPPED)
        stop_rows = cur.fetchall()

        print('Scan results (rows needing backfill — before any changes):')
        print(f'  TARGET_HIT with NULL target_hit_at : {len(target_rows)}')
        print(f'  STOPPED    with NULL stop_hit_at   : {len(stop_rows)}')
        print()

        # ── Analyze exit_price validity ──
        analysis = analyze_exit_price(target_rows, stop_rows)
        print('exit_price validity breakdown:')
        print(f'  TARGET_HIT scanned ({len(target_rows)} total):')
        print(f'    - has market-price exit (real)        : {len(analysis["target_uses_market_price"])}')
        print(f'    - exit_price == target_price (suspect): {len(analysis["target_equal_to_target"])}')
        print(f'    - exit_price NULL/0 (will backfill)    : {len(analysis["target_no_exit"])}')
        print(f'    - missing outcome_date (skip)         : {len(analysis["target_missing_outcome_date"])}')
        print(f'  STOPPED    scanned ({len(stop_rows)} total):')
        print(f'    - has market-price exit (real)        : {len(analysis["stop_uses_market_price"])}')
        print(f'    - exit_price == stop_loss   (suspect) : {len(analysis["stop_equal_to_stop"])}')
        print(f'    - exit_price NULL/0 (will backfill)    : {len(analysis["stop_no_exit"])}')
        print(f'    - missing outcome_date (skip)         : {len(analysis["stop_missing_outcome_date"])}')
        print()

        # ── Project UPDATE counts (idempotent WHERE matches) ──
        cur.execute(SQL_COUNT_BACKFILL_TARGET_HIT_AT)
        n_target_hit = cur.fetchone()[0]
        cur.execute(SQL_COUNT_BACKFILL_STOP_HIT_AT)
        n_stop_hit = cur.fetchone()[0]
        cur.execute(SQL_COUNT_BACKFILL_EXIT_PRICE_TARGET)
        n_exit_target = cur.fetchone()[0]
        cur.execute(SQL_COUNT_BACKFILL_EXIT_PRICE_STOP)
        n_exit_stop = cur.fetchone()[0]

        print('Projected UPDATE counts (idempotent WHERE column IS NULL):')
        print(f'  target_hit_at   rows to update           : {n_target_hit}')
        print(f'  stop_hit_at     rows to update           : {n_stop_hit}')
        print(f'  exit_price      rows to update (TARGET)  : {n_exit_target}')
        print(f'  exit_price      rows to update (STOPPED) : {n_exit_stop}')
        print()

        if args.dry_run:
            print('DRY-RUN: no changes applied. Re-run with --execute to apply.')
            return 0

        # ── EXECUTE path ──
        cur.execute(SQL_BACKFILL_TARGET_HIT_AT)
        n_target_hit_done = cur.rowcount
        cur.execute(SQL_BACKFILL_STOP_HIT_AT)
        n_stop_hit_done = cur.rowcount
        cur.execute(SQL_BACKFILL_EXIT_PRICE_TARGET)
        n_exit_target_done = cur.rowcount
        cur.execute(SQL_BACKFILL_EXIT_PRICE_STOP)
        n_exit_stop_done = cur.rowcount
        conn.commit()

        print('EXECUTE complete:')
        print(f'  target_hit_at   rows updated : {n_target_hit_done}')
        print(f'  stop_hit_at     rows updated : {n_stop_hit_done}')
        print(f'  exit_price      rows updated (TARGET_HIT): {n_exit_target_done}')
        print(f'  exit_price      rows updated (STOPPED)   : {n_exit_stop_done}')
        print()
        print('Verify idempotency: re-run with --dry-run — all projected counts')
        print('should now read 0 (WHERE column IS NULL no longer matches).')
        return 0
    except sqlite3.Error as e:
        print(f'ERROR: SQLite failure: {e}', file=sys.stderr)
        try:
            conn.rollback()
        except Exception:
            pass
        return 2
    finally:
        try:
            conn.close()
        except Exception:
            pass


if __name__ == '__main__':
    sys.exit(main())
