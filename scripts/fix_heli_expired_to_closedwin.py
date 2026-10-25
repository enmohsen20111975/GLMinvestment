#!/usr/bin/env python3
"""
fix_heli_expired_to_closedwin.py
================================

Supplementary cleanup for HELI records that were incorrectly marked
status='EXPIRED' by the HELI-INVESTIGATION cleanup (which only checked
TP1, not TP2). These 17 HELI predictions have target_price_2 ≈ 3.77-3.90
EGP (a +20% partial-take-profit), and the price DID reach TP2 on the way
up to 8.77 EGP. So they should be status='closed_win' (profitable TP2
exit), NOT 'EXPIRED'.

Algorithm (per HELI-CLEANUP-2 follow-up):
    For each HELI prediction with exit_type='maker_fuel_exhausted' AND
    status='EXPIRED':
        1. Fetch actual price_history between prediction_date and
           outcome_date (2026-09-22).
        2. If max_high >= target_price_2 → set status='closed_win'
           (legitimate TP2 hit). Recompute actual_return based on
           outcome_close.
        3. Else leave as EXPIRED (TP2 also not hit — true EXPIRED).

Safety:
    * Backs up to db/predictions.db.bak-heli-expired-fix (skips if exists).
    * Only touches HELI EXPIRED records with exit_type='maker_fuel_exhausted'.
    * Only updates status / actual_return / updated_at.
    * Atomic transaction.

Usage:
    python3 scripts/fix_heli_expired_to_closedwin.py --dry-run
    python3 scripts/fix_heli_expired_to_closedwin.py
"""
from __future__ import annotations

import json
import shutil
import sqlite3
import sys
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

ROOT = Path(__file__).resolve().parent.parent
PRED_DB = ROOT / "db" / "predictions.db"
PRICE_DB = ROOT / "db" / "price_history.db"
BACKUP_PATH = ROOT / "db" / "predictions.db.bak-heli-expired-fix"
LOG_PATH = ROOT / "scripts" / "output" / "fix_heli_expired_log_{}.txt".format(
    datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
)

DRY_RUN = "--dry-run" in sys.argv
TICKER = "HELI"
PRICE_EPS = 1e-4


def parse_date_str(s: Optional[str]) -> str:
    if not s:
        return ""
    return str(s).split(" ")[0].split("T")[0][:10]


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
    if not PRED_DB.exists() or not PRICE_DB.exists():
        print("ERROR: DBs not found", file=sys.stderr)
        return 2

    print("=" * 80)
    print(f"HELI EXPIRED -> closed_win FIX "
          f"{'(DRY RUN)' if DRY_RUN else '(APPLY)'}")
    print("=" * 80)

    if not DRY_RUN:
        if not BACKUP_PATH.exists():
            print(f"[INFO] Backing up predictions.db → {BACKUP_PATH}")
            shutil.copy2(PRED_DB, BACKUP_PATH)
            print(f"        Backup size: {BACKUP_PATH.stat().st_size:,} bytes")
        else:
            print(f"[INFO] Backup already exists — skipping")
        print()

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

    preds = pred_conn.execute(
        """
        SELECT id, ticker, prediction_date, outcome_date, closed_at,
               entry_price, target_price, target_price_2, stop_loss,
               status, actual_return, exit_type, highest_price_reached,
               lowest_price_reached
        FROM predictions
        WHERE ticker = ? AND exit_type = 'maker_fuel_exhausted'
              AND status = 'EXPIRED'
        ORDER BY prediction_date ASC
        """,
        (TICKER,),
    ).fetchall()

    print(f"HELI EXPIRED (maker_fuel_exhausted) records found: {len(preds)}")
    print()

    if not preds:
        pred_conn.close()
        price_conn.close()
        return 0

    # Pre-fetch HELI price history
    cur = price_conn.cursor()
    cur.execute(
        "SELECT date, high_price, low_price, close_price "
        "FROM price_history WHERE ticker = ? ORDER BY date ASC",
        (TICKER,),
    )
    rows = cur.fetchall()
    cur.close()
    print(f"[INFO] Cached {len(rows)} HELI price rows.")

    changes: List[Dict[str, Any]] = []
    for p in preds:
        pid = p["id"]
        pred_date_str = parse_date_str(p["prediction_date"])
        outcome_date_str = parse_date_str(p["outcome_date"] or p["closed_at"])
        entry = safe_float(p["entry_price"]) or 0.0
        target = safe_float(p["target_price"]) or 0.0
        target2 = safe_float(p["target_price_2"]) or 0.0
        stop = safe_float(p["stop_loss"]) or 0.0
        recorded_return = safe_float(p["actual_return"]) or 0.0
        recorded_high = safe_float(p["highest_price_reached"]) or 0.0

        window_end_str = outcome_date_str or (
            (datetime.strptime(pred_date_str, "%Y-%m-%d") + timedelta(days=30))
            .strftime("%Y-%m-%d")
        )

        max_high = float("-inf")
        outcome_close = 0.0
        for r in rows:
            d = r["date"] or ""
            if d <= pred_date_str or d > window_end_str:
                continue
            h = safe_float(r["high_price"])
            c = safe_float(r["close_price"])
            if h is not None and h > max_high:
                max_high = h
            if c is not None:
                outcome_close = c

        if target2 > 0 and max_high != float("-inf") and max_high + PRICE_EPS >= target2:
            new_status = "closed_win"
            new_return = (round((outcome_close - entry) / entry * 100, 2)
                          if entry > 0 and outcome_close > 0 else recorded_return)
            reason = (f"TP2 hit (max_high={max_high:.4f} >= "
                      f"target2={target2:.4f}); TP1 not hit "
                      f"(target1={target:.4f}) — closed_win")
        else:
            new_status = "EXPIRED"
            new_return = recorded_return
            reason = (f"TP2 NOT hit (max_high={max_high:.4f} < "
                      f"target2={target2:.4f}) — keep EXPIRED")

        changes.append({
            "id": pid,
            "pred_date": pred_date_str,
            "outcome_date": outcome_date_str,
            "entry": entry,
            "target": target,
            "target2": target2,
            "stop": stop,
            "old_status": "EXPIRED",
            "new_status": new_status,
            "old_return": recorded_return,
            "new_return": new_return,
            "max_high_window": (round(max_high, 4)
                                if max_high != float("-inf") else 0.0),
            "outcome_close": round(outcome_close, 4) if outcome_close else 0.0,
            "recorded_high": recorded_high,
            "reason": reason,
        })

    # Print plan
    print("-" * 160)
    print(f"{'ID':>6}  {'PRED_DATE':<10}  {'ENTRY':>6}  {'TP1':>6}  {'TP2':>6}  "
          f"{'STOP':>6}  {'MAX_HIGH':>9}  {'OLD':<8} -> {'NEW':<11}  "
          f"{'OLD_RET':>8} -> {'NEW_RET':>8}  REASON")
    print("-" * 160)
    for c in changes:
        print(f"{c['id']:>6}  {c['pred_date']:<10}  {c['entry']:>6.2f}  "
              f"{c['target']:>6.2f}  {c['target2']:>6.2f}  {c['stop']:>6.2f}  "
              f"{c['max_high_window']:>9.4f}  {c['old_status']:<8} -> "
              f"{c['new_status']:<11}  {c['old_return']:>8.2f} -> "
              f"{c['new_return']:>8.2f}  {c['reason']}")
    print("-" * 160)

    changed = [c for c in changes if c["new_status"] != c["old_status"]]
    print()
    print(f"Will UPDATE status (EXPIRED -> closed_win): {len(changed)} rows")
    print(f"Will keep EXPIRED                            : "
          f"{len(changes) - len(changed)} rows")

    if DRY_RUN:
        print()
        print("[DRY RUN] No writes performed.")
    else:
        print()
        print("[INFO] Applying UPDATEs in a single atomic transaction...")
        try:
            pred_conn.execute("BEGIN")
            cur = pred_conn.cursor()
            for c in changed:
                cur.execute(
                    """
                    UPDATE predictions
                    SET status = ?,
                        actual_return = ?,
                        updated_at = datetime('now')
                    WHERE id = ?
                    """,
                    (c["new_status"], c["new_return"], c["id"]),
                )
                print(f"  ✓ id={c['id']}: status 'EXPIRED' -> "
                      f"'{c['new_status']}', return {c['old_return']:.2f}% -> "
                      f"{c['new_return']:.2f}%")
            pred_conn.execute("COMMIT")
            print()
            print(f"[OK] Transaction committed. {len(changed)} rows updated.")
        except Exception as e:
            pred_conn.execute("ROLLBACK")
            print(f"[ERROR] Transaction rolled back: {e}", file=sys.stderr)
            pred_conn.close()
            price_conn.close()
            raise

    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(LOG_PATH, "w") as f:
        f.write(f"HELI EXPIRED -> closed_win fix (HELI-CLEANUP-2 supplementary)\n")
        f.write(f"Run at: {datetime.utcnow().isoformat()}Z\n")
        f.write(f"Dry run: {DRY_RUN}\n")
        f.write(f"Records examined: {len(changes)}\n")
        f.write(f"Status changed: {len(changed)}\n")
        f.write("=" * 160 + "\n")
        for c in changes:
            f.write(json.dumps(c, default=str) + "\n")
    print()
    print(f"[INFO] Log written to: {LOG_PATH}")

    pred_conn.close()
    price_conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
