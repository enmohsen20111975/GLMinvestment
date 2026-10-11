#!/usr/bin/env python3
"""
backfill_hit_timestamps.py — DEV-15 §2 Rebuild from root (G7 — round 3)
========================================================================

Replaces the DEV-08 implementation (which used ``datetime.now(timezone.utc)``
and ``outcome_date`` for timing — that was WRONG because it never verified
the price actually crossed the target/stop level on that day).

DEV-15 strategy (per task spec):

For each prediction with status='TARGET_HIT':
    → scan ``stock_daily_prices`` between ``prediction_date`` and ``outcome_date``
      for the first day where ``high >= target_price``
    → if found:
        target_hit_at = <candle_date>T00:00:00+00:00
        exit_price    = target_price           (or open if gap-up)
    → if NOT found (🚨 fake TARGET_HIT):
        convert status to ``closed_win`` (if actual_return > 0)
        or ``EXPIRED`` (if actual_return <= 0); record ``prev_status='TARGET_HIT'``

For each prediction with status='STOPPED':
    → scan ``stock_daily_prices`` between ``prediction_date`` and ``outcome_date``
      for the first day where ``low <= stop_loss``
    → if found:
        stop_hit_at = <candle_date>T00:00:00+00:00
        exit_price  = stop_loss             (or open if gap-down)
    → if NOT found (🚨 fake STOPPED):
        convert status to ``EXPIRED``; record ``prev_status='STOPPED'``

The report groups rows into 3 categories:
    (a) confirmed_by_prices  — found a candle that crossed the level
    (b) no_price_data        — no stock_daily_prices rows between the dates
    (c) fake_hit             — had price rows but none crossed (🚨)

Properties:
    - DRY-RUN by default (no DB writes).
    - Backs up predictions.db → .bak.dev-15.<utc-ts>.db before any UPDATE.
    - IDEMPOTENT:
        * Confirmed rows: re-running OVERWRITES target_hit_at / stop_hit_at
          with the SAME candle date (a no-op effectively).
        * Converted rows: their new status (closed_win / EXPIRED) means the
          scan no longer picks them up (WHERE status='TARGET_HIT' no longer
          matches) → 0 changes on re-run.

Usage:
    python3 vps-service/scripts/backfill_hit_timestamps.py --dry-run
    python3 vps-service/scripts/backfill_hit_timestamps.py --execute
    python3 vps-service/scripts/backfill_hit_timestamps.py --db /path/to/predictions.db --dry-run

Exit codes:
    0 = success (dry-run or execute)
    2 = fatal error (DB not found / SQLite error)

References:
    - Documentation/00-CONSTITUTION.md §27 (NO-FAKE-DATA)
    - agent-ctx/DEV-08-lead-technical-implementer.md (the wrong implementation
      being replaced)
    - worklog.md DEV-15
    - vps-service/jobs/daily_closer.py::_mark_closed (the new price-aware
      writer that pairs with this backfill)
"""
from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

# ─────────────────────────────────────────────────────────────────────────────
# Path resolution — same pattern as add_prev_status_column.py (DEV-11)
# ─────────────────────────────────────────────────────────────────────────────
_VPS_ROOT = Path(__file__).resolve().parents[1]  # vps-service/
_PROJECT_ROOT = _VPS_ROOT.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

try:
    from utils.db_paths import DBPaths  # type: ignore
    DEFAULT_PREDICTIONS_DB = DBPaths.PREDICTIONS_DB
    DEFAULT_STOCKS_DB = DBPaths.STOCKS_DB
except Exception:
    DEFAULT_PREDICTIONS_DB = str(_PROJECT_ROOT / 'db' / 'predictions.db')
    DEFAULT_STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def get_db_path(cli_arg: str | None, default: str) -> Path:
    """Resolve DB path: CLI arg > env var > default."""
    if cli_arg:
        return Path(cli_arg).resolve()
    return Path(default).resolve()


def backup_db(db_path: Path) -> Path:
    """Copy predictions.db → .bak.dev-15.<UTC-ts>.db before any UPDATE."""
    ts = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    bak_path = db_path.parent / f"{db_path.stem}.bak.dev-15.{ts}{db_path.suffix}"
    shutil.copy2(db_path, bak_path)
    return bak_path


def iso_utc_from_date(date_str: str) -> str:
    """Convert a YYYY-MM-DD date string to `<date>T00:00:00+00:00`."""
    return f"{date_str}T00:00:00+00:00"


def normalize_ticker(ticker: str) -> str:
    """Strip .CA / .SR / .SW suffixes — stock_daily_prices uses bare ticker."""
    if not ticker:
        return ''
    return ticker.upper().strip().split('.')[0]


# ─────────────────────────────────────────────────────────────────────────────
# SQL — scan TARGET_HIT and STOPPED rows (regardless of hit_at state, so we
# can detect fake hits even on rows DEV-08 already filled).
# ─────────────────────────────────────────────────────────────────────────────
SQL_SCAN_TARGET_HIT = """
    SELECT id, ticker, prediction_date, outcome_date,
           target_price, exit_price, actual_exit_price, actual_return
    FROM predictions
    WHERE status = 'TARGET_HIT'
      AND prediction_date IS NOT NULL AND prediction_date != ''
      AND outcome_date   IS NOT NULL AND outcome_date   != ''
    ORDER BY id
"""

SQL_SCAN_STOPPED = """
    SELECT id, ticker, prediction_date, outcome_date,
           stop_loss, exit_price, actual_exit_price, actual_return
    FROM predictions
    WHERE status = 'STOPPED'
      AND prediction_date IS NOT NULL AND prediction_date != ''
      AND outcome_date   IS NOT NULL AND outcome_date   != ''
    ORDER BY id
"""

# Look up daily candles between two dates (inclusive). COALESCE both
# schema variants (open/high/low/close + open_price/high_price/...).
SQL_FETCH_CANDLES = """
    SELECT price_date,
           COALESCE(open,  open_price)  AS open,
           COALESCE(high,  high_price) AS high,
           COALESCE(low,   low_price)  AS low,
           COALESCE(close, close_price) AS close
    FROM stock_daily_prices
    WHERE ticker = ?
      AND price_date >= ?
      AND price_date <= ?
      AND (
        COALESCE(high, high_price) IS NOT NULL
        OR COALESCE(low, low_price) IS NOT NULL
      )
    ORDER BY price_date ASC
"""

# Check if prev_status column exists (added by DEV-11 §2 migration)
SQL_HAS_PREV_STATUS = """
    SELECT COUNT(*) FROM pragma_table_info('predictions')
    WHERE name = 'prev_status'
"""


# ─────────────────────────────────────────────────────────────────────────────
# Per-row classification
# ─────────────────────────────────────────────────────────────────────────────
def find_target_hit_day(
    sdp_cur: sqlite3.Cursor, ticker: str, pred_date: str, outcome_date: str,
    target_price: float,
) -> Tuple[Optional[str], Optional[float], str]:
    """Find first candle between pred_date..outcome_date where high >= target_price.

    Returns:
        (candle_date, exit_price, category) where:
          - candle_date = 'YYYY-MM-DD' of the first crossing day, or None
          - exit_price  = target_price (or open if gap-up), or None
          - category    = 'confirmed_by_prices' | 'no_price_data' | 'fake_hit'
    """
    norm = normalize_ticker(ticker)
    try:
        sdp_cur.execute(SQL_FETCH_CANDLES, (norm, pred_date, outcome_date))
        rows = sdp_cur.fetchall()
    except sqlite3.Error:
        rows = []

    if not rows:
        return None, None, 'no_price_data'

    for price_date, o, h, l, c in rows:
        # Skip rows where high is NULL/0 (corrupt candle)
        if h is None or float(h) <= 0:
            continue
        if float(h) >= target_price:
            # Gap-up handling: if the day opened at/above target, fill at open
            if o is not None and float(o) > 0 and float(o) >= target_price:
                return price_date, float(o), 'confirmed_by_prices'
            return price_date, target_price, 'confirmed_by_prices'
    return None, None, 'fake_hit'


def find_stop_hit_day(
    sdp_cur: sqlite3.Cursor, ticker: str, pred_date: str, outcome_date: str,
    stop_loss: float,
) -> Tuple[Optional[str], Optional[float], str]:
    """Find first candle between pred_date..outcome_date where low <= stop_loss.

    Returns:
        (candle_date, exit_price, category) where:
          - candle_date = 'YYYY-MM-DD' of the first crossing day, or None
          - exit_price  = stop_loss (or open if gap-down), or None
          - category    = 'confirmed_by_prices' | 'no_price_data' | 'fake_hit'
    """
    norm = normalize_ticker(ticker)
    try:
        sdp_cur.execute(SQL_FETCH_CANDLES, (norm, pred_date, outcome_date))
        rows = sdp_cur.fetchall()
    except sqlite3.Error:
        rows = []

    if not rows:
        return None, None, 'no_price_data'

    for price_date, o, h, l, c in rows:
        if l is None or float(l) <= 0:
            continue
        if float(l) <= stop_loss:
            # Gap-down: if day opened at/below stop, fill at open
            if o is not None and float(o) > 0 and float(o) <= stop_loss:
                return price_date, float(o), 'confirmed_by_prices'
            return price_date, stop_loss, 'confirmed_by_prices'
    return None, None, 'fake_hit'


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--dry-run', action='store_true', default=False,
                        help='Print report only — do not modify DB (default).')
    parser.add_argument('--execute', action='store_true', default=False,
                        help='Apply backfill (backup → UPDATE → commit).')
    parser.add_argument('--db', type=str, default=None,
                        help='Path to predictions.db (default: db/predictions.db).')
    parser.add_argument('--stocks-db', type=str, default=None,
                        help='Path to stocks.db (default: db/stocks.db).')
    args = parser.parse_args()

    if args.execute and args.dry_run:
        parser.error('Cannot use --dry-run and --execute together.')
    if not args.execute and not args.dry_run:
        args.dry_run = True

    pred_db = get_db_path(args.db, DEFAULT_PREDICTIONS_DB)
    stocks_db = get_db_path(args.stocks_db, DEFAULT_STOCKS_DB)
    if not pred_db.exists():
        print(f'ERROR: predictions DB not found at {pred_db}', file=sys.stderr)
        return 2
    if not stocks_db.exists():
        print(f'ERROR: stocks DB not found at {stocks_db}', file=sys.stderr)
        return 2

    print('=' * 78)
    print('DEV-15 §2 — Rebuild hit-timestamp backfill from root (price-verified)')
    print('=' * 78)
    print(f'predictions DB : {pred_db}')
    print(f'stocks DB      : {stocks_db}')
    print(f'Mode           : {"DRY-RUN (no changes)" if args.dry_run else "EXECUTE (will modify DB)"}')
    print()

    # ── Connect (read-only for dry-run, RW for execute) ──
    if args.dry_run:
        uri = f'file:{pred_db.as_posix()}?mode=ro'
        try:
            conn = sqlite3.connect(uri, uri=True)
        except sqlite3.OperationalError as e:
            print(f'ERROR: cannot open predictions DB read-only: {e}', file=sys.stderr)
            return 2
    else:
        bak_path = backup_db(pred_db)
        print(f'Backup: {bak_path}')
        try:
            conn = sqlite3.connect(str(pred_db))
        except sqlite3.OperationalError as e:
            print(f'ERROR: cannot open predictions DB read-write: {e}', file=sys.stderr)
            return 2

    # stocks.db always opened read-only (we only read prices from it)
    sdp_conn = sqlite3.connect(f'file:{stocks_db.as_posix()}?mode=ro', uri=True)

    try:
        cur = conn.cursor()
        sdp_cur = sdp_conn.cursor()

        # Check whether prev_status column is present
        cur.execute(SQL_HAS_PREV_STATUS)
        has_prev_status = cur.fetchone()[0] > 0
        print(f"prev_status column present : {has_prev_status}")
        if not has_prev_status:
            print('  ⚠️  Run add_prev_status_column.py first (DEV-11 §2).')
            print('      Without prev_status, fake-hit conversions cannot record')
            print('      the prior status — they will still convert but revert')
            print('      will be impossible. ABORTING for safety.')
            return 2
        print()

        # ── Scan ──
        cur.execute(SQL_SCAN_TARGET_HIT)
        target_rows = cur.fetchall()
        cur.execute(SQL_SCAN_STOPPED)
        stop_rows = cur.fetchall()

        print('Scan results:')
        print(f'  TARGET_HIT rows (with prediction_date + outcome_date) : {len(target_rows)}')
        print(f'  STOPPED    rows (with prediction_date + outcome_date) : {len(stop_rows)}')
        print()

        # ── Classify every row ──
        target_confirmed = []   # (id, ticker, candle_date, exit_price, prev_target, prev_actual_exit)
        target_no_data = []     # (id, ticker, pred_date, outcome_date, target_price)
        target_fake = []        # (id, ticker, actual_return, new_status)
        stop_confirmed = []
        stop_no_data = []
        stop_fake = []

        for r in target_rows:
            pred_id, ticker, pred_date, outcome_date, target_price, exit_price, actual_exit_price, actual_return = r
            try:
                tp = float(target_price) if target_price else 0.0
            except (TypeError, ValueError):
                tp = 0.0
            if tp <= 0:
                target_no_data.append((pred_id, ticker, pred_date, outcome_date, target_price))
                continue
            candle_date, exit_px, category = find_target_hit_day(
                sdp_cur, ticker, pred_date, outcome_date, tp,
            )
            if category == 'confirmed_by_prices':
                target_confirmed.append((pred_id, ticker, candle_date, exit_px, exit_price, actual_exit_price))
            elif category == 'no_price_data':
                target_no_data.append((pred_id, ticker, pred_date, outcome_date, target_price))
            else:  # fake_hit
                try:
                    ar = float(actual_return) if actual_return is not None else 0.0
                except (TypeError, ValueError):
                    ar = 0.0
                new_status = 'closed_win' if ar > 0 else 'EXPIRED'
                target_fake.append((pred_id, ticker, ar, new_status))

        for r in stop_rows:
            pred_id, ticker, pred_date, outcome_date, stop_loss, exit_price, actual_exit_price, actual_return = r
            try:
                sl = float(stop_loss) if stop_loss else 0.0
            except (TypeError, ValueError):
                sl = 0.0
            if sl <= 0:
                stop_no_data.append((pred_id, ticker, pred_date, outcome_date, stop_loss))
                continue
            candle_date, exit_px, category = find_stop_hit_day(
                sdp_cur, ticker, pred_date, outcome_date, sl,
            )
            if category == 'confirmed_by_prices':
                stop_confirmed.append((pred_id, ticker, candle_date, exit_px, exit_price, actual_exit_price))
            elif category == 'no_price_data':
                stop_no_data.append((pred_id, ticker, pred_date, outcome_date, stop_loss))
            else:  # fake_hit
                stop_fake.append((pred_id, ticker, 0.0, 'EXPIRED'))

        # ── Report ──
        print('─' * 78)
        print('CATEGORY REPORT (3 buckets per side)')
        print('─' * 78)
        print(f'TARGET_HIT ({len(target_rows)} total):')
        print(f'  (a) confirmed_by_prices : {len(target_confirmed)}')
        print(f'  (b) no_price_data       : {len(target_no_data)}')
        print(f'  (c) 🚨 fake_hit         : {len(target_fake)}  → convert to closed_win / EXPIRED')
        print()
        print(f'STOPPED ({len(stop_rows)} total):')
        print(f'  (a) confirmed_by_prices : {len(stop_confirmed)}')
        print(f'  (b) no_price_data       : {len(stop_no_data)}')
        print(f'  (c) 🚨 fake_hit         : {len(stop_fake)}  → convert to EXPIRED')
        print()

        # ── Samples ──
        if target_confirmed:
            print('Sample TARGET_HIT confirmed (max 5):')
            for row in target_confirmed[:5]:
                print(f'  id={row[0]:>6} {row[1]:8s} hit_date={row[2]} '
                      f'exit_price={row[3]:.4f} (prev exit_price={row[4]}, actual_exit_price={row[5]})')
        if target_fake:
            print('Sample TARGET_HIT 🚨 fake (max 5):')
            for row in target_fake[:5]:
                print(f'  id={row[0]:>6} {row[1]:8s} actual_return={row[2]:.2f}% → new_status={row[3]}')
        if stop_confirmed:
            print('Sample STOPPED confirmed (max 5):')
            for row in stop_confirmed[:5]:
                print(f'  id={row[0]:>6} {row[1]:8s} hit_date={row[2]} '
                      f'exit_price={row[3]:.4f} (prev exit_price={row[4]}, actual_exit_price={row[5]})')
        if stop_fake:
            print('Sample STOPPED 🚨 fake (max 5):')
            for row in stop_fake[:5]:
                print(f'  id={row[0]:>6} {row[1]:8s} → new_status={row[3]}')
        print()

        if args.dry_run:
            print('─' * 78)
            print('DRY-RUN: no changes applied. Re-run with --execute to apply.')
            print('─' * 78)
            return 0

        # ── EXECUTE ──
        # (1) Confirmed TARGET_HIT: overwrite target_hit_at + exit_price
        n_target_at = 0
        n_target_exit = 0
        for pred_id, _tkr, candle_date, exit_px, prev_exit, prev_actual_exit in target_confirmed:
            iso = iso_utc_from_date(candle_date)
            cur.execute(
                "UPDATE predictions SET target_hit_at = ? WHERE id = ?",
                (iso, pred_id),
            )
            n_target_at += cur.rowcount
            # Only overwrite exit_price if it is NULL or 0 — preserve real
            # market exit prices (Rule 27 NO-FAKE-DATA). For confirmed hits,
            # exit_price should be the target price (or open if gap).
            if prev_exit is None or (isinstance(prev_exit, (int, float)) and float(prev_exit) <= 0):
                cur.execute(
                    "UPDATE predictions SET exit_price = ? WHERE id = ?",
                    (exit_px, pred_id),
                )
                n_target_exit += cur.rowcount

        # (2) Confirmed STOPPED: overwrite stop_hit_at + exit_price
        n_stop_at = 0
        n_stop_exit = 0
        for pred_id, _tkr, candle_date, exit_px, prev_exit, prev_actual_exit in stop_confirmed:
            iso = iso_utc_from_date(candle_date)
            cur.execute(
                "UPDATE predictions SET stop_hit_at = ? WHERE id = ?",
                (iso, pred_id),
            )
            n_stop_at += cur.rowcount
            if prev_exit is None or (isinstance(prev_exit, (int, float)) and float(prev_exit) <= 0):
                cur.execute(
                    "UPDATE predictions SET exit_price = ? WHERE id = ?",
                    (exit_px, pred_id),
                )
                n_stop_exit += cur.rowcount

        # (3) Fake TARGET_HIT → closed_win / EXPIRED (record prev_status)
        n_target_fake = 0
        for pred_id, _tkr, ar, new_status in target_fake:
            note = f" | DEV-15-FAKE-TARGET-HIT (actual_return={ar:.2f}%, no candle high>=target_price between pred_date and outcome_date)"
            cur.execute(
                "UPDATE predictions SET prev_status = 'TARGET_HIT', "
                "status = ?, "
                "notes = COALESCE(notes, '') || ? "
                "WHERE id = ?",
                (new_status, note, pred_id),
            )
            n_target_fake += cur.rowcount

        # (4) Fake STOPPED → EXPIRED (record prev_status)
        n_stop_fake = 0
        for pred_id, _tkr, _ar, new_status in stop_fake:
            note = " | DEV-15-FAKE-STOPPED (no candle low<=stop_loss between pred_date and outcome_date)"
            cur.execute(
                "UPDATE predictions SET prev_status = 'STOPPED', "
                "status = ?, "
                "notes = COALESCE(notes, '') || ? "
                "WHERE id = ?",
                (new_status, note, pred_id),
            )
            n_stop_fake += cur.rowcount

        conn.commit()

        print('─' * 78)
        print('EXECUTE complete:')
        print(f'  target_hit_at  rows overwritten      : {n_target_at}')
        print(f'  exit_price     rows backfilled (T)   : {n_target_exit}')
        print(f'  stop_hit_at    rows overwritten      : {n_stop_at}')
        print(f'  exit_price     rows backfilled (S)   : {n_stop_exit}')
        print(f'  🚨 fake TARGET_HIT → closed_win/EXPIRED : {n_target_fake}')
        print(f'  🚨 fake STOPPED    → EXPIRED             : {n_stop_fake}')
        print()
        print('Verify idempotency: re-run with --dry-run — fake-hit counts')
        print('should now read 0 (because the rows are no longer TARGET_HIT/STOPPED).')
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
        try:
            sdp_conn.close()
        except Exception:
            pass


if __name__ == '__main__':
    sys.exit(main())
