#!/usr/bin/env python3
"""
fix_heli_false_targets.py
=========================

Forensic cleanup of the false TARGET_HIT cluster on HELI predictions in
`db/predictions.db`.

Context (HELI-INVESTIGATION):
    17 HELI predictions were marked `status='TARGET_HIT'` on 2026-09-22 by a
    (now-removed) script that used the heuristic
        `status = 'TARGET_HIT' if actual_return > 0 else 'STOPPED'`
    for `exit_type='maker_fuel_exhausted'` closures. The actual price NEVER
    reached `target_price` (9.40-9.45 EGP) — the high was 8.77 EGP — so these
    are FALSE TARGET_HITs that inflate hit-rate analytics.

Algorithm (per task spec):
    For each HELI prediction with status='TARGET_HIT':
        1. Fetch actual price_history between prediction_date and outcome_date.
        2. Determine actual outcome:
             * max_high >= target_price → keep TARGET_HIT (true hit)
             * min_low <= stop_loss     → STOPPED
             * window has passed        → EXPIRED (target never reached)
        3. Recompute actual_return = (close_on_outcome - entry) / entry * 100.
        4. UPDATE predictions SET status=?, actual_return=?, highest_price_reached=?
           WHERE id=?.
        5. Print BEFORE/AFTER for every row.

Safety:
    * Creates a backup: db/predictions.db.bak-heli-fix
    * Only touches HELI predictions.
    * Only updates status / actual_return / highest_price_reached /
      lowest_price_reached — never deletes rows.
    * Wraps all writes in a single transaction (atomic).

Usage:
    python3 scripts/fix_heli_false_targets.py
    python3 scripts/fix_heli_false_targets.py --dry-run   # log only, no writes
"""
from __future__ import annotations

import os
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

ROOT = Path(__file__).resolve().parent.parent
PRED_DB = ROOT / "db" / "predictions.db"
PRICE_DB = ROOT / "db" / "price_history.db"
BACKUP_PATH = ROOT / "db" / "predictions.db.bak-heli-fix"
LOG_PATH = ROOT / "scripts" / "output" / "heli_fix_log_{}.txt".format(
    datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
)

DRY_RUN = "--dry-run" in sys.argv
TICKER = "HELI"
PRICE_EPS = 1e-4  # 1-tick tolerance (EGP floats are 4-decimal)


def parse_date(s: Optional[str]) -> str:
    """Return 'YYYY-MM-DD' from a datetime/date string."""
    if not s:
        return ""
    return str(s).split(" ")[0].split("T")[0][:10]


def main() -> int:
    if not PRED_DB.exists():
        print(f"ERROR: predictions.db not found at {PRED_DB}", file=sys.stderr)
        return 2
    if not PRICE_DB.exists():
        print(f"ERROR: price_history.db not found at {PRICE_DB}", file=sys.stderr)
        return 2

    # ── 1. Backup ─────────────────────────────────────────────────────────────
    if not DRY_RUN:
        if BACKUP_PATH.exists():
            print(f"[INFO] Backup already exists at {BACKUP_PATH} — skipping backup")
        else:
            print(f"[INFO] Backing up predictions.db → {BACKUP_PATH}")
            shutil.copy2(PRED_DB, BACKUP_PATH)
            print(f"        Backup size: {BACKUP_PATH.stat().st_size:,} bytes")

    # ── 2. Open connections ──────────────────────────────────────────────────
    # predictions.db: open for write (unless --dry-run)
    pred_uri = f"file:{PRED_DB}?mode={'ro' if DRY_RUN else 'rw'}"
    price_uri = f"file:{PRICE_DB}?mode=ro"
    pred_conn = sqlite3.connect(pred_uri, uri=True)
    price_conn = sqlite3.connect(price_uri, uri=True)
    pred_conn.row_factory = sqlite3.Row
    price_conn.row_factory = sqlite3.Row

    # ── 3. Fetch all HELI TARGET_HIT predictions ────────────────────────────
    heli_preds = pred_conn.execute(
        """
        SELECT id, ticker, prediction_date, outcome_date, entry_price,
               target_price, stop_loss, status, actual_return,
               highest_price_reached, lowest_price_reached, exit_type,
               closed_at
        FROM predictions
        WHERE ticker = ? AND status = 'TARGET_HIT'
        ORDER BY prediction_date ASC
        """,
        (TICKER,),
    ).fetchall()

    print()
    print("=" * 80)
    print(f"HELI FALSE TARGET_HIT CLEANUP {'(DRY RUN — no writes)' if DRY_RUN else ''}")
    print("=" * 80)
    print(f"HELI TARGET_HIT predictions found: {len(heli_preds)}")
    print()

    if not heli_preds:
        print("[INFO] No HELI TARGET_HIT predictions to fix.")
        pred_conn.close()
        price_conn.close()
        return 0

    # ── 4. For each prediction, determine actual outcome from price history ──
    changes = []
    for p in heli_preds:
        pid = p["id"]
        pred_date = parse_date(p["prediction_date"])
        outcome_date = parse_date(p["outcome_date"] or p["closed_at"])
        entry = float(p["entry_price"] or 0)
        target = float(p["target_price"] or 0)
        stop = float(p["stop_loss"] or 0)
        recorded_return = float(p["actual_return"] or 0)
        recorded_high = float(p["highest_price_reached"] or 0)
        recorded_low = float(p["lowest_price_reached"] or 0)
        exit_type = p["exit_type"] or ""

        # Fetch price history in the window
        if outcome_date:
            rows = price_conn.execute(
                """
                SELECT date, high_price, low_price, close_price
                FROM price_history
                WHERE ticker = ? AND date > ? AND date <= ?
                ORDER BY date ASC
                """,
                (TICKER, pred_date, outcome_date),
            ).fetchall()
        else:
            rows = []

        max_high = max(
            (float(r["high_price"]) for r in rows if r["high_price"] is not None),
            default=0.0,
        )
        min_low = min(
            (float(r["low_price"]) for r in rows if r["low_price"] is not None),
            default=float("inf"),
        )
        # close on outcome_date (or last available close in window)
        outcome_close = 0.0
        for r in reversed(rows):
            if r["close_price"] is not None:
                outcome_close = float(r["close_price"])
                break

        # Determine actual status — STRICT algorithm (matches reconcile script)
        if target > 0 and max_high + PRICE_EPS >= target:
            new_status = "TARGET_HIT"
            new_return = recorded_return  # keep — likely based on target exit
            reason = f"target WAS hit (max_high={max_high:.4f} >= target={target:.4f})"
        elif stop > 0 and min_low != float("inf") and min_low - PRICE_EPS <= stop:
            new_status = "STOPPED"
            new_return = round(((stop - entry) / entry * 100) if entry > 0 else 0, 2)
            reason = f"stop was hit (min_low={min_low:.4f} <= stop={stop:.4f})"
        elif outcome_close > 0 and entry > 0:
            # Window expired (outcome_date reached). Trade was profitable but
            # never hit target → call it 'EXPIRED' per the strict reconcile
            # algorithm. actual_return reflects real exit-close movement.
            new_status = "EXPIRED"
            new_return = round(((outcome_close - entry) / entry * 100), 2)
            reason = (
                f"window expired without target hit "
                f"(max_high={max_high:.4f} < target={target:.4f}, "
                f"min_low={min_low:.4f} > stop={stop:.4f}, "
                f"outcome_close={outcome_close:.4f})"
            )
        else:
            new_status = "EXPIRED"
            new_return = recorded_return
            reason = "insufficient price data — defaulting to EXPIRED"

        # Update highest_price_reached to actual max_high (fixes the recorded
        # 8.20 placeholder that was wrong — actual was 8.77)
        new_high = max(recorded_high, max_high) if max_high > 0 else recorded_high
        new_low = (
            min(recorded_low, min_low) if (min_low != float("inf") and min_low > 0)
            else recorded_low
        )

        changes.append({
            "id": pid,
            "pred_date": pred_date,
            "outcome_date": outcome_date,
            "entry": entry,
            "target": target,
            "stop": stop,
            "old_status": "TARGET_HIT",
            "new_status": new_status,
            "old_return": recorded_return,
            "new_return": new_return,
            "old_high": recorded_high,
            "new_high": round(new_high, 4) if new_high else 0.0,
            "old_low": recorded_low,
            "new_low": round(new_low, 4) if new_low else 0.0,
            "max_high_window": round(max_high, 4) if max_high else 0.0,
            "min_low_window": round(min_low, 4) if min_low != float("inf") else 0.0,
            "outcome_close": round(outcome_close, 4) if outcome_close else 0.0,
            "exit_type": exit_type,
            "reason": reason,
        })

    # ── 5. Print BEFORE / AFTER table ────────────────────────────────────────
    print("-" * 160)
    print(f"{'ID':>6}  {'PRED_DATE':<10}  {'ENTRY':>6}  {'TARGET':>6}  {'STOP':>6}  "
          f"{'MAX_HIGH':>8}  {'MIN_LOW':>7}  {'OLD_STATUS':<12} -> {'NEW_STATUS':<12}  "
          f"{'OLD_RET':>8} -> {'NEW_RET':>8}  {'EXIT_TYPE':<25}  REASON")
    print("-" * 160)
    for c in changes:
        print(f"{c['id']:>6}  {c['pred_date']:<10}  {c['entry']:>6.2f}  {c['target']:>6.2f}  "
              f"{c['stop']:>6.2f}  {c['max_high_window']:>8.4f}  {c['min_low_window']:>7.4f}  "
              f"{c['old_status']:<12} -> {c['new_status']:<12}  "
              f"{c['old_return']:>8.2f} -> {c['new_return']:>8.2f}  "
              f"{c['exit_type']:<25}  {c['reason']}")
    print("-" * 160)

    # ── 6. Summary counts ────────────────────────────────────────────────────
    from collections import Counter
    cnt = Counter(c["new_status"] for c in changes)
    print()
    print("Summary of new statuses:")
    for s, n in sorted(cnt.items()):
        print(f"  {s}: {n}")
    print()

    changed = [c for c in changes if c["new_status"] != c["old_status"]]
    unchanged = [c for c in changes if c["new_status"] == c["old_status"]]
    print(f"  Will UPDATE status:     {len(changed)} rows")
    print(f"  Will keep TARGET_HIT:   {len(unchanged)} rows (target was actually hit)")

    # ── 7. Apply UPDATEs in a single transaction ────────────────────────────
    if DRY_RUN:
        print()
        print("[DRY RUN] No writes performed. Re-run without --dry-run to apply.")
    else:
        print()
        print("[INFO] Applying UPDATEs in a single transaction...")
        cur = pred_conn.cursor()
        try:
            pred_conn.execute("BEGIN")
            for c in changed:
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
                print(f"  ✓ id={c['id']}: status '{c['old_status']}' -> "
                      f"'{c['new_status']}', return {c['old_return']:.2f}% -> "
                      f"{c['new_return']:.2f}%, high {c['old_high']:.4f} -> "
                      f"{c['new_high']:.4f}")

            # Also patch highest_price_reached on the true-TARGET_HIT rows
            # (the recorded 8.20 placeholder is wrong — actual max was 8.77).
            for c in unchanged:
                if c["new_high"] > c["old_high"] + PRICE_EPS:
                    cur.execute(
                        """
                        UPDATE predictions
                        SET highest_price_reached = ?,
                            lowest_price_reached = ?,
                            updated_at = datetime('now')
                        WHERE id = ?
                        """,
                        (c["new_high"], c["new_low"] if c["new_low"] else None, c["id"]),
                    )
                    print(f"  ✓ id={c['id']}: highest_price_reached "
                          f"{c['old_high']:.4f} -> {c['new_high']:.4f} "
                          f"(status stays TARGET_HIT — true hit)")
            pred_conn.execute("COMMIT")
            print()
            print(f"[OK] Transaction committed. {len(changed)} rows updated status, "
                  f"{len(unchanged)} rows had highest_price_reached corrected.")
        except Exception as e:
            pred_conn.execute("ROLLBACK")
            print(f"[ERROR] Transaction rolled back: {e}", file=sys.stderr)
            raise

    # ── 8. Write log file ────────────────────────────────────────────────────
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_PATH, "w") as f:
        f.write(f"HELI False TARGET_HIT Cleanup\n")
        f.write(f"Run at: {datetime.utcnow().isoformat()}Z\n")
        f.write(f"Dry run: {DRY_RUN}\n")
        f.write(f"Ticker: {TICKER}\n")
        f.write(f"Total TARGET_HIT records examined: {len(heli_preds)}\n")
        f.write(f"Status changed: {len(changed)}\n")
        f.write(f"Status kept TARGET_HIT: {len(unchanged)}\n")
        f.write("=" * 160 + "\n")
        for c in changes:
            f.write(json.dumps(c) + "\n")
    print()
    print(f"[INFO] Log written to: {LOG_PATH}")

    pred_conn.close()
    price_conn.close()
    return 0


if __name__ == "__main__":
    import json
    sys.exit(main())
