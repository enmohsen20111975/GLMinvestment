#!/usr/bin/env python3
"""
fix_all_false_targets.py
========================

Forensic cleanup of ALL false TARGET_HIT predictions in `db/predictions.db`
that were mislabeled by the (now-removed) `maker_fuel_exhausted` VPS script.

Context (HELI-CLEANUP-2, following HELI-INVESTIGATION):
    A now-removed VPS script ran on 2026-09-22/23 and set
    `exit_type='maker_fuel_exhausted'` on 363 predictions across 33 tickers.
    It used the heuristic
        `status = 'TARGET_HIT' if actual_return > 0 else 'STOPPED'`
    regardless of whether `target_price` was actually reached. Of those 363,
    325 were marked TARGET_HIT (17 of which were HELI and already cleaned in
    HELI-INVESTIGATION). The remaining 308 false TARGET_HITs across 24
    non-HELI tickers are in scope for THIS script.

Algorithm (per task spec, extended with target_price_2 awareness):
    For each prediction with exit_type='maker_fuel_exhausted' AND status='TARGET_HIT':
        1. Fetch actual price_history between prediction_date and outcome_date
           (or +30 calendar days if outcome_date is null).
        2. Determine actual outcome (truthful, based on price data):
             * max_high >= target_price       → keep TARGET_HIT (true TP1 hit)
             * elif target_price_2 > 0 AND
               max_high >= target_price_2      → set closed_win (true TP2 hit,
                                                  profitable but missed TP1)
             * elif min_low <= stop_loss       → set STOPPED
             * elif window expired             → set EXPIRED
             * else                            → set active (shouldn't be closed)
        3. Recompute actual_return = (outcome_close - entry) / entry * 100
           (only when entry > 0 and outcome_close > 0).
        4. Update highest_price_reached / lowest_price_reached if missing or
           if actual window max/min differs from recorded.
        5. Print BEFORE/AFTER for every row.

Safety:
    * Creates a backup: db/predictions.db.bak-full-cleanup
    * Only touches predictions with exit_type='maker_fuel_exhausted' AND
      status='TARGET_HIT' (the false-positive set). True TARGET_HITs (TP1
      reached) are preserved as TARGET_HIT and only have highest/lowest
      price_reached corrected if needed.
    * Only updates status / actual_return / highest_price_reached /
      lowest_price_reached / updated_at — never deletes rows, never touches
      entry_price/target_price/stop_loss/outcome_date/closed_at.
    * Wraps all writes in a single transaction (atomic).

Usage:
    python3 scripts/fix_all_false_targets.py --dry-run   # log only, no writes
    python3 scripts/fix_all_false_targets.py              # apply changes
"""
from __future__ import annotations

import json
import os
import shutil
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
PRED_DB = ROOT / "db" / "predictions.db"
PRICE_DB = ROOT / "db" / "price_history.db"
BACKUP_PATH = ROOT / "db" / "predictions.db.bak-full-cleanup"
LOG_PATH = ROOT / "scripts" / "output" / "fix_all_false_targets_log_{}.txt".format(
    datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
)

DRY_RUN = "--dry-run" in sys.argv
PRICE_EPS = 1e-4  # 1-tick tolerance (EGP floats are 4-decimal)


def parse_date_str(s: Optional[str]) -> str:
    """Return 'YYYY-MM-DD' from a datetime/date string."""
    if not s:
        return ""
    return str(s).split(" ")[0].split("T")[0][:10]


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


def main() -> int:
    if not PRED_DB.exists():
        print(f"ERROR: predictions.db not found at {PRED_DB}", file=sys.stderr)
        return 2
    if not PRICE_DB.exists():
        print(f"ERROR: price_history.db not found at {PRICE_DB}", file=sys.stderr)
        return 2

    print("=" * 80)
    print(f"FULL FALSE-TARGET_CLEANUP {'(DRY RUN — no writes)' if DRY_RUN else '(APPLY MODE)'}")
    print("=" * 80)
    print(f"predictions.db: {PRED_DB}")
    print(f"price_history.db: {PRICE_DB}")
    print()

    # ── 1. Backup ─────────────────────────────────────────────────────────────
    if not DRY_RUN:
        if BACKUP_PATH.exists():
            print(f"[INFO] Backup already exists at {BACKUP_PATH} — skipping backup")
        else:
            print(f"[INFO] Backing up predictions.db → {BACKUP_PATH}")
            shutil.copy2(PRED_DB, BACKUP_PATH)
            print(f"        Backup size: {BACKUP_PATH.stat().st_size:,} bytes")
        print()

    # ── 2. Open connections ──────────────────────────────────────────────────
    pred_uri = f"file:{PRED_DB}?mode={'ro' if DRY_RUN else 'rw'}"
    price_uri = f"file:{PRICE_DB}?mode=ro"
    pred_conn = sqlite3.connect(pred_uri, uri=True)
    price_conn = sqlite3.connect(price_uri, uri=True)
    pred_conn.row_factory = sqlite3.Row
    price_conn.row_factory = sqlite3.Row

    # ── 3. Fetch all false TARGET_HITs with exit_type='maker_fuel_exhausted' ──
    preds = pred_conn.execute(
        """
        SELECT id, ticker, prediction_date, outcome_date, closed_at,
               entry_price, target_price, target_price_2, stop_loss,
               status, actual_return, exit_type, exit_price,
               highest_price_reached, lowest_price_reached, persona
        FROM predictions
        WHERE exit_type = 'maker_fuel_exhausted' AND status = 'TARGET_HIT'
        ORDER BY ticker, prediction_date ASC
        """
    ).fetchall()

    print(f"False TARGET_HITs found (exit_type='maker_fuel_exhausted'): {len(preds)}")
    by_ticker: Dict[str, int] = Counter(p["ticker"] for p in preds)
    print("By ticker:")
    for tk, n in sorted(by_ticker.items(), key=lambda kv: -kv[1]):
        print(f"  {tk}: {n}")
    print()

    if not preds:
        print("[INFO] No false TARGET_HITs to fix.")
        pred_conn.close()
        price_conn.close()
        return 0

    # ── 4. Pre-fetch price_history per ticker (batched, like reconcile script) ─
    distinct_tickers = sorted({p["ticker"] for p in preds if p["ticker"]})
    print(f"[INFO] Pre-fetching price history for {len(distinct_tickers)} tickers...")
    price_cache: Dict[str, List[Dict[str, Any]]] = {}
    cur = price_conn.cursor()
    for tk in distinct_tickers:
        cur.execute(
            "SELECT date, high_price, low_price, close_price "
            "FROM price_history WHERE ticker = ? ORDER BY date ASC",
            (tk,),
        )
        rows = cur.fetchall()
        price_cache[tk] = [
            {"date": r["date"], "high": r["high_price"],
             "low": r["low_price"], "close": r["close_price"]}
            for r in rows
        ]
    cur.close()
    print(f"      Cached {sum(len(v) for v in price_cache.values())} price rows "
          f"across {len(price_cache)} tickers.")
    print()

    # ── 5. For each prediction, determine actual outcome ─────────────────────
    changes: List[Dict[str, Any]] = []
    now = datetime.utcnow()

    for p in preds:
        pid = p["id"]
        ticker = p["ticker"] or ""
        pred_date_str = parse_date_str(p["prediction_date"])
        outcome_date_str = parse_date_str(p["outcome_date"] or p["closed_at"])
        entry = safe_float(p["entry_price"]) or 0.0
        target = safe_float(p["target_price"]) or 0.0
        target2 = safe_float(p["target_price_2"]) or 0.0
        stop = safe_float(p["stop_loss"]) or 0.0
        recorded_return = safe_float(p["actual_return"]) or 0.0
        recorded_high = safe_float(p["highest_price_reached"]) or 0.0
        recorded_low = safe_float(p["lowest_price_reached"]) or 0.0
        exit_type = p["exit_type"] or ""

        # Determine window end
        if outcome_date_str:
            window_end_str = outcome_date_str
        else:
            pred_dt = parse_date(p["prediction_date"])
            if pred_dt:
                window_end_str = (pred_dt + timedelta(days=30)).strftime("%Y-%m-%d")
            else:
                window_end_str = now.strftime("%Y-%m-%d")

        rows = price_cache.get(ticker, [])
        max_high = float("-inf")
        min_low = float("inf")
        outcome_close = 0.0
        for r in rows:
            d = r["date"] or ""
            if d <= pred_date_str or d > window_end_str:
                continue
            h = safe_float(r["high"])
            l = safe_float(r["low"])
            c = safe_float(r["close"])
            if h is None and l is None and c is None:
                continue
            if h is not None and h > max_high:
                max_high = h
            if l is not None and l < min_low:
                min_low = l
            if c is not None:
                outcome_close = c  # last close in window (rows are sorted asc)

        has_price_data = max_high != float("-inf") and min_low != float("inf")
        window_expired = window_end_str < now.strftime("%Y-%m-%d")

        # Determine actual status — strict 4-branch + TP2 extension
        if has_price_data and target > 0 and max_high + PRICE_EPS >= target:
            new_status = "TARGET_HIT"
            new_return = recorded_return  # keep — likely based on target exit
            reason = (f"target WAS hit (TP1: max_high={max_high:.4f} >= "
                      f"target={target:.4f})")
        elif has_price_data and target2 > 0 and max_high + PRICE_EPS >= target2:
            new_status = "closed_win"
            # Recompute return based on outcome_close
            if entry > 0 and outcome_close > 0:
                new_return = round((outcome_close - entry) / entry * 100, 2)
            else:
                new_return = recorded_return
            reason = (f"TP2 was hit but not TP1 (max_high={max_high:.4f}, "
                      f"target2={target2:.4f}, target1={target:.4f}) — "
                      f"truthful status: closed_win")
        elif has_price_data and stop > 0 and min_low - PRICE_EPS <= stop:
            new_status = "STOPPED"
            if entry > 0:
                new_return = round((stop - entry) / entry * 100, 2)
            else:
                new_return = recorded_return
            reason = (f"stop was hit (min_low={min_low:.4f} <= "
                      f"stop={stop:.4f})")
        elif has_price_data and outcome_close > 0 and entry > 0 and window_expired:
            new_status = "EXPIRED"
            new_return = round((outcome_close - entry) / entry * 100, 2)
            reason = (f"window expired without target hit "
                      f"(max_high={max_high:.4f} < target={target:.4f}, "
                      f"min_low={min_low:.4f} > stop={stop:.4f}, "
                      f"outcome_close={outcome_close:.4f})")
        elif has_price_data and not window_expired:
            # Window still open — shouldn't be in closed set; reopen as active
            new_status = "active"
            new_return = recorded_return
            reason = (f"window still open (window_end={window_end_str}) — "
                      f"reopening as active")
        else:
            # Insufficient price data — default to EXPIRED (window_expired)
            new_status = "EXPIRED"
            new_return = recorded_return
            reason = "insufficient price data — defaulting to EXPIRED"

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
            "window_end": window_end_str,
            "entry": entry,
            "target": target,
            "target2": target2,
            "stop": stop,
            "old_status": "TARGET_HIT",
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
            "outcome_close": round(outcome_close, 4) if outcome_close else 0.0,
            "exit_type": exit_type,
            "reason": reason,
        })

    # ── 6. Print BEFORE / AFTER table (compact, by ticker) ──────────────────
    print("-" * 180)
    print(f"{'ID':>6}  {'TICKER':<7}  {'PRED_DATE':<10}  {'ENTRY':>7}  {'TP1':>8}  "
          f"{'TP2':>8}  {'STOP':>7}  {'MAX_HIGH':>9}  {'MIN_LOW':>9}  "
          f"{'OLD_STATUS':<12} -> {'NEW_STATUS':<12}  {'OLD_RET':>8} -> {'NEW_RET':>8}  REASON")
    print("-" * 180)
    for c in changes:
        print(f"{c['id']:>6}  {c['ticker']:<7}  {c['pred_date']:<10}  "
              f"{c['entry']:>7.2f}  {c['target']:>8.2f}  {c['target2']:>8.2f}  "
              f"{c['stop']:>7.2f}  {c['max_high_window']:>9.4f}  "
              f"{c['min_low_window']:>9.4f}  "
              f"{c['old_status']:<12} -> {c['new_status']:<12}  "
              f"{c['old_return']:>8.2f} -> {c['new_return']:>8.2f}  "
              f"{c['reason']}")
    print("-" * 180)

    # ── 7. Summary counts ───────────────────────────────────────────────────
    status_cnt = Counter(c["new_status"] for c in changes)
    print()
    print("Summary of new statuses:")
    for s, n in sorted(status_cnt.items(), key=lambda kv: -kv[1]):
        print(f"  {s}: {n}")
    print()

    changed = [c for c in changes if c["new_status"] != c["old_status"]]
    unchanged = [c for c in changes if c["new_status"] == c["old_status"]]
    high_corrections = [c for c in unchanged
                        if c["new_high"] > c["old_high"] + PRICE_EPS]
    low_corrections = [c for c in unchanged
                       if c["old_low"] > 0 and c["new_low"] > 0
                       and c["new_low"] < c["old_low"] - PRICE_EPS]

    print(f"Total false TARGET_HITs examined       : {len(changes)}")
    print(f"  True TP1 hits (kept TARGET_HIT)       : {len(unchanged)}")
    print(f"  Status changes (TARGET_HIT -> X)      : {len(changed)}")
    print(f"  highest_price_reached corrections    : {len(high_corrections)} "
          f"(on unchanged rows)")
    print()

    # By-ticker breakdown of changes
    by_ticker_changes: Dict[str, Counter] = defaultdict(Counter)
    for c in changes:
        by_ticker_changes[c["ticker"]][c["new_status"]] += 1
    print("By ticker (new statuses):")
    print(f"  {'TICKER':<7}  {'TOTAL':>5}  {'TARGET_HIT':>10}  {'closed_win':>10}  "
          f"{'STOPPED':>8}  {'EXPIRED':>8}  {'active':>6}")
    for tk in sorted(by_ticker_changes.keys(),
                     key=lambda t: -by_ticker_changes[t].total()):
        cnt = by_ticker_changes[tk]
        total = cnt.total()
        print(f"  {tk:<7}  {total:>5}  {cnt.get('TARGET_HIT', 0):>10}  "
              f"{cnt.get('closed_win', 0):>10}  {cnt.get('STOPPED', 0):>8}  "
              f"{cnt.get('EXPIRED', 0):>8}  {cnt.get('active', 0):>6}")
    print()

    # ── 8. Apply UPDATEs in a single atomic transaction ──────────────────────
    if DRY_RUN:
        print("[DRY RUN] No writes performed. Re-run without --dry-run to apply.")
    else:
        print("[INFO] Applying UPDATEs in a single atomic transaction...")
        try:
            pred_conn.execute("BEGIN")
            cur = pred_conn.cursor()
            n_status_changed = 0
            n_high_corrected = 0
            n_low_corrected = 0
            for c in changes:
                # Determine if we need to UPDATE this row at all
                status_changed = c["new_status"] != c["old_status"]
                high_changed = c["new_high"] > c["old_high"] + PRICE_EPS
                low_changed = (c["old_low"] > 0 and c["new_low"] > 0
                              and c["new_low"] < c["old_low"] - PRICE_EPS)
                return_changed = (abs(c["new_return"] - c["old_return"])
                                  > PRICE_EPS)

                if not (status_changed or high_changed or low_changed
                        or return_changed):
                    continue

                cur.execute(
                    """
                    UPDATE predictions
                    SET status = ?,
                        actual_return = ?,
                        highest_price_reached = ?,
                        lowest_price_reached = ?,
                        updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (
                        c["new_status"],
                        c["new_return"],
                        c["new_high"] if c["new_high"] else None,
                        c["new_low"] if c["new_low"] else None,
                        c["id"],
                    ),
                )
                if status_changed:
                    n_status_changed += 1
                if high_changed:
                    n_high_corrected += 1
                if low_changed:
                    n_low_corrected += 1

                log_bits = []
                if status_changed:
                    log_bits.append(f"status '{c['old_status']}' -> '{c['new_status']}'")
                if return_changed:
                    log_bits.append(f"return {c['old_return']:.2f}% -> {c['new_return']:.2f}%")
                if high_changed:
                    log_bits.append(f"high {c['old_high']:.4f} -> {c['new_high']:.4f}")
                if low_changed:
                    log_bits.append(f"low {c['old_low']:.4f} -> {c['new_low']:.4f}")
                print(f"  ✓ id={c['id']:<7} {c['ticker']:<6}  " + ", ".join(log_bits))

            pred_conn.execute("COMMIT")
            print()
            print(f"[OK] Transaction committed.")
            print(f"     Status changes applied  : {n_status_changed}")
            print(f"     highest_price corrected : {n_high_corrected}")
            print(f"     lowest_price corrected  : {n_low_corrected}")
        except Exception as e:
            pred_conn.execute("ROLLBACK")
            print(f"[ERROR] Transaction rolled back: {e}", file=sys.stderr)
            pred_conn.close()
            price_conn.close()
            raise

    # ── 9. Write log file ────────────────────────────────────────────────────
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_PATH, "w") as f:
        f.write("Full False TARGET_HIT Cleanup (HELI-CLEANUP-2)\n")
        f.write(f"Run at: {datetime.utcnow().isoformat()}Z\n")
        f.write(f"Dry run: {DRY_RUN}\n")
        f.write(f"Total false TARGET_HITs examined: {len(changes)}\n")
        f.write(f"Status changed: {len(changed)}\n")
        f.write(f"Kept TARGET_HIT (true TP1 hit): {len(unchanged)}\n")
        f.write("=" * 180 + "\n")
        for c in changes:
            f.write(json.dumps(c, default=str) + "\n")
    print()
    print(f"[INFO] Log written to: {LOG_PATH}")

    pred_conn.close()
    price_conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
