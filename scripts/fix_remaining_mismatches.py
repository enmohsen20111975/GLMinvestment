#!/usr/bin/env python3
"""
fix_remaining_mismatches.py
===========================

Forensic cleanup of the 369 REAL_MISMATCH records identified by
reconcile_remaining.py (DATA-REVIEW-175).

Context (DATA-REVIEW-175, following HELI-INVESTIGATION + HELI-CLEANUP-2):
    After cleaning up the maker_fuel_exhausted TARGET_HIT cluster, 384
    mismatches remained (reconcile rate 31.66%). The targeted reconciliation
    in reconcile_remaining.py categorized them as:
      - 15 INSUFFICIENT_DATA  → skipped (too few price rows to be confident)
      -  0 FALSE_POSITIVE     → (reconcile was correct for all)
      - 369 REAL_MISMATCH     → in scope for THIS script

    Root cause: a batch close operation ran on 2026-09-22 closing long-stale
    predictions (~365 days old, the "MAX_DAYS_60d" / "365-day max holding
    window" expiry). The closer set status='expired'/'EXPIRED' regardless of
    whether target_price or stop_loss was actually hit during the holding
    window. Secondary causes: leftover maker_fuel_exhausted STOPPED records
    (38 total — only TARGET_HIT branch was fixed in HELI-CLEANUP-2), SL-labeled
    records where TP2 was actually hit first, partial_trailing/partial_stuck
    records mislabeled TARGET_HIT.

Algorithm (per record in REAL_MISMATCH):
    1. Fetch actual price history between prediction_date and outcome_date
       (or +30 calendar days if outcome_date is null).
    2. Determine actual outcome (truthful, based on price data):
         * max_high >= target_price      → TARGET_HIT (true TP1 hit)
         * elif target_price_2 > 0 AND
           max_high >= target_price_2     → closed_win (true TP2 hit,
                                              profitable but missed TP1)
         * elif min_low <= stop_loss      → STOPPED
         * elif window expired            → EXPIRED
         * else                           → active (shouldn't be closed)
    3. Recompute actual_return based on the implied exit price:
         * TARGET_HIT (TP1): exit = target_price
         * closed_win (TP2): exit = target_price_2
         * STOPPED         : exit = stop_loss
         * EXPIRED         : exit = last close in window
         * active          : leave actual_return alone (re-open)
    4. Update highest_price_reached / lowest_price_reached to the actual
       window extremes (if missing or differ from actual).
    5. Update exit_type to a more accurate value reflecting the actual exit:
         * TP1 → 'TP1'
         * TP2 → 'TP2'
         * STOPPED → 'SL'
         * EXPIRED → leave existing exit_type (MAX_DAYS_60d etc. are accurate)
         * active → leave existing exit_type
    6. Print BEFORE/AFTER for every row.

Safety:
    * Creates backup: db/predictions.db.bak-175-cleanup
    * Only touches REAL_MISMATCH records (the 369 to correct).
    * Only updates status / actual_return / highest_price_reached /
      lowest_price_reached / exit_type / updated_at — never deletes rows,
      never touches entry_price/target_price/stop_loss/outcome_date/closed_at.
    * Wraps all writes in a single transaction (atomic).
    * Supports --dry-run flag.

Usage:
    python3 scripts/fix_remaining_mismatches.py --dry-run   # log only
    python3 scripts/fix_remaining_mismatches.py              # apply changes
"""
from __future__ import annotations

import argparse
import json
import shutil
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
PRED_DB = ROOT / "db" / "predictions.db"
PRICE_DB = ROOT / "db" / "price_history.db"
BACKUP_PATH = ROOT / "db" / "predictions.db.bak-175-cleanup"
OUTPUT_DIR = ROOT / "scripts" / "output"

PRICE_EPS = 1e-4
MIN_ROWS_FOR_CONFIDENCE = 5
MIN_WINDOW_DAYS_FOR_INSUF = 10


def parse_date(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    s = s.strip()
    for fmt in (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
    ):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def safe_float(x: Any) -> Optional[float]:
    try:
        if x is None:
            return None
        f = float(x)
        if f != f or f in (float("inf"), float("-inf")):
            return None
        return f
    except (TypeError, ValueError):
        return None


def determine_actual_outcome(
    max_high: float,
    min_low: float,
    target_price: float,
    stop_loss: float,
    window_expired: bool,
    target_price_2: Optional[float] = None,
) -> Tuple[str, Optional[str]]:
    """Returns (actual_status, tp_hit_flag)."""
    if max_high != float("-inf") and max_high + PRICE_EPS >= target_price:
        return "TARGET_HIT", "TP1"
    if (target_price_2 is not None and target_price_2 > 0
            and max_high != float("-inf")
            and max_high + PRICE_EPS >= target_price_2):
        return "TARGET_HIT", "TP2"
    if min_low != float("inf") and min_low - PRICE_EPS <= stop_loss:
        return "STOPPED", None
    if window_expired:
        return "EXPIRED", None
    return "PENDING", None


def window_slice(
    rows: List[Dict[str, Any]], start_date_str: str, end_date_str: str
) -> Tuple[float, float, float, int]:
    """Returns (max_high, min_low, last_close, row_count)."""
    max_high = float("-inf")
    min_low = float("inf")
    last_close = 0.0
    count = 0
    for r in rows:
        d = r["date"] or ""
        if d < start_date_str or d > end_date_str:
            continue
        h = safe_float(r["high"])
        l = safe_float(r["low"])
        c = safe_float(r["close"])
        if h is None and l is None and c is None:
            continue
        count += 1
        if h is not None and h > max_high:
            max_high = h
        if l is not None and l < min_low:
            min_low = l
        if c is not None:
            last_close = c
    return max_high, min_low, last_close, count


def compute_return(exit_price: float, entry_price: float) -> float:
    """Return % return rounded to 2 decimals."""
    if entry_price <= 0:
        return 0.0
    return round((exit_price - entry_price) / entry_price * 100, 2)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input", type=str, default=None,
        help="Path to reconcile_remaining JSON. If omitted, uses latest.",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print changes but do not apply them.",
    )
    args = parser.parse_args()
    DRY_RUN = args.dry_run

    if not PRED_DB.exists():
        print(f"ERROR: predictions.db not found at {PRED_DB}", file=sys.stderr)
        return 2
    if not PRICE_DB.exists():
        print(f"ERROR: price_history.db not found at {PRICE_DB}", file=sys.stderr)
        return 2

    print("=" * 80)
    print(f"DATA-REVIEW-175 CLEANUP {'(DRY RUN — no writes)' if DRY_RUN else '(APPLY MODE)'}")
    print("=" * 80)
    print(f"predictions.db: {PRED_DB}")
    print(f"price_history.db: {PRICE_DB}")
    print()

    # ── 1. Find latest reconcile_remaining JSON ────────────────────────────
    if args.input:
        in_path = Path(args.input)
    else:
        candidates = sorted(OUTPUT_DIR.glob("reconcile_remaining_*.json"))
        if not candidates:
            print("ERROR: no reconcile_remaining_*.json found in "
                  f"{OUTPUT_DIR}. Run scripts/reconcile_remaining.py first.",
                  file=sys.stderr)
            return 2
        in_path = candidates[-1]
    print(f"[INFO] Reading reconcile_remaining JSON: {in_path}")

    with open(in_path) as f:
        rep = json.load(f)
    categorized = rep.get("categorized", [])
    real_mismatches = [c for c in categorized if c["category"] == "REAL_MISMATCH"]
    print(f"[INFO] Loaded {len(categorized)} categorized mismatches")
    print(f"       REAL_MISMATCH to fix: {len(real_mismatches)}")
    print()

    if not real_mismatches:
        print("[INFO] No REAL_MISMATCH records to fix.")
        return 0

    # ── 2. Backup ──────────────────────────────────────────────────────────
    if not DRY_RUN:
        if BACKUP_PATH.exists():
            print(f"[INFO] Backup already exists at {BACKUP_PATH} — skipping backup")
        else:
            print(f"[INFO] Backing up predictions.db → {BACKUP_PATH}")
            shutil.copy2(PRED_DB, BACKUP_PATH)
            print(f"        Backup size: {BACKUP_PATH.stat().st_size:,} bytes")
        print()

    # ── 3. Open connections ───────────────────────────────────────────────
    pred_uri = f"file:{PRED_DB}?mode={'ro' if DRY_RUN else 'rw'}"
    price_uri = f"file:{PRICE_DB}?mode=ro"
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    pred_conn = db_manager.connection(pred_uri, writable=False).__enter__()
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    price_conn = db_manager.connection(price_uri, writable=False).__enter__()
    pred_conn.row_factory = sqlite3.Row
    price_conn.row_factory = sqlite3.Row

    # ── 4. Re-fetch price history per ticker (so we don't rely on the
    #       reconcile_remaining.py report's snapshot which may have been
    #       computed at a slightly different time) ───────────────────────
    distinct_tickers = sorted({c["ticker"] for c in real_mismatches if c["ticker"]})
    print(f"[INFO] Pre-fetching price history for {len(distinct_tickers)} tickers...")
    price_cache: Dict[str, List[Dict[str, Any]]] = {}
    cur = price_conn.cursor()
    for tk in distinct_tickers:
        cur.execute(
            "SELECT date, high_price, low_price, close_price "
            "FROM price_history WHERE ticker = ? ORDER BY date ASC",
            (tk,),
        )
        price_cache[tk] = [
            {"date": r[0], "high": r[1], "low": r[2], "close": r[3]}
            for r in cur.fetchall()
        ]
    cur.close()
    print(f"      Cached price history for {len(price_cache)} tickers")
    print()

    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")

    # ── 5. For each REAL_MISMATCH, compute the actual fix ──────────────────
    changes: List[Dict[str, Any]] = []
    skipped: List[Dict[str, Any]] = []

    for c in real_mismatches:
        pid = c["id"]
        ticker = c["ticker"]
        pred_date_str = c["prediction_date"]
        outcome_date = c.get("outcome_date") or ""
        outcome_date_str = outcome_date[:10] if outcome_date else ""

        # Use outcome_date as window end if set, else +30 days
        if outcome_date_str:
            window_end_str = outcome_date_str
        else:
            pred_dt = parse_date(pred_date_str)
            if pred_dt:
                window_end_str = (pred_dt + timedelta(days=30)).strftime("%Y-%m-%d")
            else:
                window_end_str = today_str

        entry = safe_float(c["entry_price"]) or 0.0
        target = safe_float(c["target_price"]) or 0.0
        target2 = safe_float(c["target_price_2"])
        stop = safe_float(c["stop_loss"]) or 0.0
        recorded_status = c["recorded_status"]
        recorded_return = safe_float(c["actual_return_recorded"]) or 0.0
        recorded_high = safe_float(c["highest_price_reached_recorded"]) or 0.0
        recorded_low = safe_float(c["lowest_price_reached_recorded"]) or 0.0
        exit_type = c.get("exit_type") or ""

        # Slice price history fresh
        rows = price_cache.get(ticker, [])
        max_high, min_low, last_close, n_rows = window_slice(
            rows, pred_date_str, window_end_str
        )
        has_price_data = max_high != float("-inf") and min_low != float("inf")

        # Re-check INSUFFICIENT_DATA (defensive — should match reconcile_remaining)
        pred_dt = parse_date(pred_date_str)
        outcome_dt = parse_date(outcome_date_str)
        window_span_days = ((outcome_dt - pred_dt).days
                            if pred_dt and outcome_dt else 0)
        if n_rows < MIN_ROWS_FOR_CONFIDENCE and window_span_days > MIN_WINDOW_DAYS_FOR_INSUF:
            skipped.append({
                "id": pid, "ticker": ticker,
                "reason": f"insufficient price data ({n_rows} rows in "
                          f"{window_span_days}-day window)",
            })
            continue

        # Determine actual outcome (window_expired if end is in past)
        window_expired = outcome_dt is not None and outcome_dt.date() < now.date()
        if outcome_dt is None and pred_dt is not None:
            window_expired = (pred_dt + timedelta(days=30)).date() < now.date()

        actual_status, tp_hit = determine_actual_outcome(
            max_high, min_low, target, stop, window_expired, target2
        )

        # Compute new status / return / exit_type
        if actual_status == "TARGET_HIT" and tp_hit == "TP1":
            new_status = "TARGET_HIT"
            new_return = compute_return(target, entry)
            new_exit_type = "TP1"
            reason = (f"TP1 hit (max_high={max_high:.4f} >= "
                      f"target={target:.4f})")
        elif actual_status == "TARGET_HIT" and tp_hit == "TP2":
            new_status = "closed_win"
            new_return = compute_return(target2 or 0.0, entry)
            new_exit_type = "TP2"
            reason = (f"TP2 hit but not TP1 (max_high={max_high:.4f} >= "
                      f"target2={target2:.4f}, target1={target:.4f})")
        elif actual_status == "STOPPED":
            new_status = "STOPPED"
            new_return = compute_return(stop, entry)
            new_exit_type = "SL"
            reason = (f"stop hit (min_low={min_low:.4f} <= "
                      f"stop={stop:.4f})")
        elif actual_status == "EXPIRED":
            new_status = "EXPIRED"
            if last_close > 0:
                new_return = compute_return(last_close, entry)
            else:
                new_return = recorded_return
            # Leave existing exit_type alone (MAX_DAYS_60d etc. are accurate)
            new_exit_type = exit_type
            reason = (f"window expired (max_high={max_high:.4f} < "
                      f"target={target:.4f}, min_low={min_low:.4f} > "
                      f"stop={stop:.4f}, last_close={last_close:.4f})")
        elif actual_status == "PENDING":
            # Window hasn't elapsed — shouldn't be in closed set. Skip
            # rather than re-open (would need to also clear outcome_date
            # and closed_at — out of scope for this cleanup).
            skipped.append({
                "id": pid, "ticker": ticker,
                "reason": f"actual outcome PENDING (window not expired)",
            })
            continue
        else:
            skipped.append({
                "id": pid, "ticker": ticker,
                "reason": f"unhandled actual_status: {actual_status}",
            })
            continue

        # Update highest/lowest price_reached to actual values (if better)
        if has_price_data:
            new_high = max(recorded_high, max_high) if max_high > 0 else recorded_high
            if min_low != float("inf") and min_low > 0:
                new_low = (min(recorded_low, min_low) if recorded_low > 0
                          else min_low)
            else:
                new_low = recorded_low
        else:
            new_high = recorded_high
            new_low = recorded_low

        changes.append({
            "id": pid,
            "ticker": ticker,
            "pred_date": pred_date_str,
            "outcome_date": outcome_date_str,
            "entry": entry,
            "target": target,
            "target2": target2 or 0.0,
            "stop": stop,
            "old_status": recorded_status,
            "new_status": new_status,
            "old_return": recorded_return,
            "new_return": new_return,
            "old_high": recorded_high,
            "new_high": round(new_high, 4) if new_high else 0.0,
            "old_low": recorded_low,
            "new_low": round(new_low, 4) if new_low else 0.0,
            "max_high_window": (round(max_high, 4)
                                if max_high != float("-inf") else 0.0),
            "min_low_window": (round(min_low, 4)
                               if min_low != float("inf") else 0.0),
            "last_close_window": round(last_close, 4) if last_close else 0.0,
            "old_exit_type": exit_type,
            "new_exit_type": new_exit_type,
            "tp_hit": tp_hit,
            "reason": reason,
        })

    # ── 6. Print BEFORE / AFTER table ─────────────────────────────────────
    print("-" * 200)
    print(f"{'ID':>6}  {'TICKER':<7}  {'PRED_DATE':<10}  {'ENTRY':>7}  "
          f"{'TP1':>8}  {'TP2':>8}  {'STOP':>7}  {'MAX_HIGH':>9}  "
          f"{'MIN_LOW':>9}  {'OLD_STATUS':<12} -> {'NEW_STATUS':<12}  "
          f"{'OLD_RET':>8} -> {'NEW_RET':>8}  {'OLD_ET':<18} -> {'NEW_ET':<8}  REASON")
    print("-" * 200)
    for c in changes:
        print(f"{c['id']:>6}  {c['ticker']:<7}  {c['pred_date']:<10}  "
              f"{c['entry']:>7.2f}  {c['target']:>8.2f}  {c['target2']:>8.2f}  "
              f"{c['stop']:>7.2f}  {c['max_high_window']:>9.4f}  "
              f"{c['min_low_window']:>9.4f}  "
              f"{c['old_status']:<12} -> {c['new_status']:<12}  "
              f"{c['old_return']:>8.2f} -> {c['new_return']:>8.2f}  "
              f"{c['old_exit_type']:<18} -> {c['new_exit_type']:<8}  "
              f"{c['reason']}")
    print("-" * 200)

    # ── 7. Summary counts ────────────────────────────────────────────────
    status_cnt = Counter(c["new_status"] for c in changes)
    print()
    print("Summary of new statuses:")
    for s, n in sorted(status_cnt.items(), key=lambda kv: -kv[1]):
        print(f"  {s}: {n}")
    print()

    changed = [c for c in changes if c["new_status"] != c["old_status"]]
    unchanged_status = [c for c in changes if c["new_status"] == c["old_status"]]

    print(f"Total REAL_MISMATCHES examined   : {len(changes)}")
    print(f"  Status changes                 : {len(changed)}")
    print(f"  Status unchanged (only return/high/low/exit_type corrected): {len(unchanged_status)}")
    print(f"  Skipped (insufficient/pending) : {len(skipped)}")
    print()

    # By-ticker breakdown of new statuses
    by_ticker_changes: Dict[str, Counter] = defaultdict(Counter)
    for c in changes:
        by_ticker_changes[c["ticker"]][c["new_status"]] += 1
    print("By ticker (new statuses):")
    print(f"  {'TICKER':<7}  {'TOTAL':>5}  {'TARGET_HIT':>10}  {'closed_win':>10}  "
          f"{'STOPPED':>8}  {'EXPIRED':>8}")
    for tk in sorted(by_ticker_changes.keys(),
                     key=lambda t: -by_ticker_changes[t].total()):
        cnt = by_ticker_changes[tk]
        total = cnt.total()
        print(f"  {tk:<7}  {total:>5}  {cnt.get('TARGET_HIT', 0):>10}  "
              f"{cnt.get('closed_win', 0):>10}  {cnt.get('STOPPED', 0):>8}  "
              f"{cnt.get('EXPIRED', 0):>8}")
    print()

    # ── 8. Apply UPDATEs in a single atomic transaction ──────────────────
    if DRY_RUN:
        print("[DRY RUN] No writes performed. Re-run without --dry-run to apply.")
    else:
        print("[INFO] Applying UPDATEs in a single atomic transaction...")
        try:
            pred_conn.execute("BEGIN")
            cur = pred_conn.cursor()
            n_status_changed = 0
            n_return_changed = 0
            n_high_corrected = 0
            n_low_corrected = 0
            n_exit_type_changed = 0

            for c in changes:
                status_changed = c["new_status"] != c["old_status"]
                return_changed = abs(c["new_return"] - c["old_return"]) > PRICE_EPS
                high_changed = c["new_high"] > c["old_high"] + PRICE_EPS
                low_changed = (c["old_low"] > 0 and c["new_low"] > 0
                              and c["new_low"] < c["old_low"] - PRICE_EPS)
                exit_type_changed = c["new_exit_type"] != c["old_exit_type"]

                if not (status_changed or return_changed or high_changed
                        or low_changed or exit_type_changed):
                    continue

                cur.execute(
                    """
                    UPDATE predictions
                    SET status = ?,
                        actual_return = ?,
                        highest_price_reached = ?,
                        lowest_price_reached = ?,
                        exit_type = ?,
                        updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (
                        c["new_status"],
                        c["new_return"],
                        c["new_high"] if c["new_high"] else None,
                        c["new_low"] if c["new_low"] else None,
                        c["new_exit_type"],
                        c["id"],
                    ),
                )
                if status_changed:
                    n_status_changed += 1
                if return_changed:
                    n_return_changed += 1
                if high_changed:
                    n_high_corrected += 1
                if low_changed:
                    n_low_corrected += 1
                if exit_type_changed:
                    n_exit_type_changed += 1

                log_bits = []
                if status_changed:
                    log_bits.append(f"status '{c['old_status']}' -> '{c['new_status']}'")
                if return_changed:
                    log_bits.append(f"return {c['old_return']:.2f}% -> {c['new_return']:.2f}%")
                if high_changed:
                    log_bits.append(f"high {c['old_high']:.4f} -> {c['new_high']:.4f}")
                if low_changed:
                    log_bits.append(f"low {c['old_low']:.4f} -> {c['new_low']:.4f}")
                if exit_type_changed:
                    log_bits.append(f"exit_type '{c['old_exit_type']}' -> '{c['new_exit_type']}'")
                print(f"  ✓ id={c['id']:<7} {c['ticker']:<6}  " + ", ".join(log_bits))

            pred_conn.execute("COMMIT")
            print()
            print(f"[OK] Transaction committed.")
            print(f"     Status changes applied      : {n_status_changed}")
            print(f"     actual_return recalculated  : {n_return_changed}")
            print(f"     highest_price corrected     : {n_high_corrected}")
            print(f"     lowest_price corrected      : {n_low_corrected}")
            print(f"     exit_type updated           : {n_exit_type_changed}")
        except Exception as e:
            pred_conn.execute("ROLLBACK")
            print(f"[ERROR] Transaction rolled back: {e}", file=sys.stderr)
            pred_conn.close()
            price_conn.close()
            raise

    # ── 9. Write log file ────────────────────────────────────────────────
    ts = now.strftime("%Y%m%dT%H%M%SZ")
    log_path = OUTPUT_DIR / f"fix_remaining_mismatches_log_{ts}.json"
    log_path.parent.mkdir(parents=True, exist_ok=True)
    log_data = {
        "run_at": now.isoformat() + "Z",
        "dry_run": DRY_RUN,
        "input_json": str(in_path),
        "backup_path": str(BACKUP_PATH) if not DRY_RUN else None,
        "total_real_mismatches": len(real_mismatches),
        "total_changes_applied": len(changes),
        "total_skipped": len(skipped),
        "summary_new_statuses": dict(status_cnt),
        "changes": changes,
        "skipped": skipped,
    }
    log_path.write_text(json.dumps(log_data, indent=2, default=str), encoding="utf-8")
    print()
    print(f"[INFO] Log written to: {log_path}")

    pred_conn.close()
    price_conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
