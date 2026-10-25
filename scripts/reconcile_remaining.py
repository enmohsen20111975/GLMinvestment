#!/usr/bin/env python3
"""
reconcile_remaining.py
======================

Targeted reconciliation of the 384 remaining mismatches from the
reconcile_hit_targets.py output.

Context (DATA-REVIEW-175, following HELI-INVESTIGATION + HELI-CLEANUP-2):
    After HELI-CLEANUP-2 cleaned up 308 false TARGET_HITs with
    exit_type='maker_fuel_exhausted', 384 mismatches remained (mismatch
    rate 31.66%). These have a DIFFERENT root cause — empty/non-maker_fuel
    exit_types like 'MAX_DAYS_60d', 'SL', 'partial_trailing', etc. Most
    were closed by a batch operation on 2026-09-22 (the "60-day max
    holding window" expiry) which set status=EXPIRED regardless of whether
    target_price or stop_loss was actually hit during the holding window.

Algorithm:
    1. Read the latest reconcile_hit_targets.py JSON output.
    2. For each mismatch, re-fetch actual price history in the prediction
       window [prediction_date, outcome_date OR +30 days].
    3. Determine the ACTUAL outcome (same algorithm as reconcile):
         - max_high >= target_price     → TARGET_HIT (TP1)
         - elif target_price_2 reached  → TARGET_HIT (TP2)
         - elif min_low <= stop_loss     → STOPPED
         - elif window expired           → EXPIRED
         - else                          → PENDING
    4. Categorize each mismatch as:
         - FALSE_POSITIVE    : reconcile was wrong (recorded == actual)
         - INSUFFICIENT_DATA : too few price rows in window to be confident
                               (rows < 5 AND window > 10 days)
         - REAL_MISMATCH     : recorded != actual, needs correction
    5. Write JSON report: scripts/output/reconcile_remaining_<ts>.json

Usage:
    python3 scripts/reconcile_remaining.py
    python3 scripts/reconcile_remaining.py --input <reconcile_json>
"""
from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent.parent
PRED_DB = ROOT / "db" / "predictions.db"
PRICE_DB = ROOT / "db" / "price_history.db"
OUTPUT_DIR = ROOT / "scripts" / "output"

PRICE_EPS = 1e-4
# Thresholds for INSUFFICIENT_DATA detection
# If window spans > 10 days but we have < 5 rows, we don't have enough
# data to be confident about the actual outcome (price history is
# incomplete — likely missing days).
MIN_ROWS_FOR_CONFIDENCE = 5
MIN_WINDOW_DAYS_FOR_INSUF = 10

# Normalize statuses (same as reconcile_hit_targets.py)
NORMALIZE_STATUS = {
    "TARGET_HIT": "TARGET_HIT",
    "closed_win": "TARGET_HIT",
    "STOPPED": "STOPPED",
    "closed_stop": "STOPPED",
    "EXPIRED": "EXPIRED",
    "expired": "EXPIRED",
}


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
    """Returns (actual_status, tp_hit_flag). tp_hit_flag is TP1/TP2/None."""
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
) -> Tuple[float, float, float, int, float]:
    """Returns (max_high, min_low, last_close, row_count, max_close)."""
    max_high = float("-inf")
    min_low = float("inf")
    last_close = 0.0
    max_close = float("-inf")
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
            last_close = c  # rows are sorted asc — keep last
            if c > max_close:
                max_close = c
    return max_high, min_low, last_close, count, max_close


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--input", type=str, default=None,
        help="Path to a specific reconcile_hit_targets JSON file. "
             "If omitted, the latest one in scripts/output/ is used.",
    )
    args = parser.parse_args()

    # Find the latest reconcile JSON
    if args.input:
        in_path = Path(args.input)
    else:
        candidates = sorted(OUTPUT_DIR.glob("hit_target_reconciliation_*.json"))
        if not candidates:
            print("ERROR: no hit_target_reconciliation_*.json found in "
                  f"{OUTPUT_DIR}", file=sys.stderr)
            return 2
        in_path = candidates[-1]
    print(f"[INFO] Reading reconcile JSON: {in_path}")

    with open(in_path) as f:
        rep = json.load(f)
    mismatches = rep.get("all_mismatches", [])
    print(f"[INFO] Loaded {len(mismatches)} mismatches from reconcile output")
    print(f"       mismatch rate at start: {rep.get('mismatch_rate_pct')}%")
    print()

    if not mismatches:
        print("[INFO] No mismatches to analyze.")
        return 0

    # Connect to DBs read-only
    pred_uri = f"file:{PRED_DB}?mode=ro"
    price_uri = f"file:{PRICE_DB}?mode=ro"
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    pred_conn = db_manager.connection(pred_uri, writable=False).__enter__()
    pred_conn.row_factory = sqlite3.Row
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    price_conn = db_manager.connection(price_uri, writable=False).__enter__()
    price_conn.row_factory = sqlite3.Row

    # Fetch full prediction rows for each mismatch id (so we can also
    # cross-check exit_type, direction, etc.)
    ids = [m["id"] for m in mismatches]
    placeholders = ",".join("?" * len(ids))
    pred_rows = pred_conn.execute(
        f"""
        SELECT id, ticker, prediction_date, entry_price, target_price,
               target_price_2, stop_loss, status, outcome_date, closed_at,
               actual_return, exit_type, exit_price, actual_exit_price,
               highest_price_reached, lowest_price_reached, persona,
               direction, signal, signal_type
        FROM predictions
        WHERE id IN ({placeholders})
        """,
        ids,
    ).fetchall()
    pred_by_id = {r["id"]: r for r in pred_rows}

    # Pre-fetch price_history per ticker (batched)
    distinct_tickers = sorted({r["ticker"] for r in pred_rows if r["ticker"]})
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
    print(f"[INFO] Cached price history for {len(price_cache)} tickers")
    print()

    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")

    # Categorize each mismatch
    categorized: List[Dict[str, Any]] = []
    cnt_false_positive = 0
    cnt_insufficient = 0
    cnt_real_mismatch = 0

    # Sub-categorize REAL_MISMATCH by transition type
    transition_cnt: Counter = Counter()
    # Sub-categorize INSUFFICIENT_DATA by reason
    insuf_reason_cnt: Counter = Counter()

    for m in mismatches:
        pid = m["id"]
        p = pred_by_id.get(pid)
        if not p:
            categorized.append({
                "id": pid, "category": "INSUFFICIENT_DATA",
                "reason": "prediction row not found in DB (deleted?)",
                "mismatch": m,
            })
            cnt_insufficient += 1
            insuf_reason_cnt["prediction_not_found"] += 1
            continue

        ticker = p["ticker"] or ""
        entry = safe_float(p["entry_price"]) or 0.0
        target = safe_float(p["target_price"]) or 0.0
        target2 = safe_float(p["target_price_2"])
        stop = safe_float(p["stop_loss"]) or 0.0

        pred_dt = parse_date(p["prediction_date"])
        outcome_dt = parse_date(p["outcome_date"]) or parse_date(p["closed_at"])

        if not pred_dt or entry <= 0 or target <= 0 or stop <= 0:
            categorized.append({
                "id": pid, "ticker": ticker,
                "category": "INSUFFICIENT_DATA",
                "reason": "missing critical data (entry/target/stop/pred_date)",
                "mismatch": m, "prediction": dict(p),
            })
            cnt_insufficient += 1
            insuf_reason_cnt["missing_critical_data"] += 1
            continue

        pred_date_str = pred_dt.strftime("%Y-%m-%d")
        if outcome_dt:
            window_end_str = outcome_dt.strftime("%Y-%m-%d")
            window_span_days = (outcome_dt - pred_dt).days
        else:
            window_end_str = (pred_dt + timedelta(days=30)).strftime("%Y-%m-%d")
            window_span_days = 30

        # Slice price history
        rows = price_cache.get(ticker, [])
        max_high, min_low, last_close, n_rows, max_close = window_slice(
            rows, pred_date_str, window_end_str
        )

        # Re-determine actual outcome (independent verification)
        window_expired = outcome_dt is not None and outcome_dt.date() < now.date()
        if outcome_dt is None:
            # +30 day fallback — assume expired if 30d has passed
            window_expired = (pred_dt + timedelta(days=30)).date() < now.date()

        actual_status, tp_hit = determine_actual_outcome(
            max_high, min_low, target, stop, window_expired, target2
        )

        recorded_norm = NORMALIZE_STATUS.get(p["status"], p["status"])

        # ----- categorize -----
        if actual_status == recorded_norm:
            category = "FALSE_POSITIVE"
            reason = (f"reconcile was wrong — actual==recorded ({actual_status}) "
                      f"after re-check with fresh price fetch")
            cnt_false_positive += 1
        elif n_rows < MIN_ROWS_FOR_CONFIDENCE and window_span_days > MIN_WINDOW_DAYS_FOR_INSUF:
            category = "INSUFFICIENT_DATA"
            reason = (f"only {n_rows} price rows in {window_span_days}-day window "
                      f"(need >= {MIN_ROWS_FOR_CONFIDENCE} for confidence)")
            cnt_insufficient += 1
            insuf_reason_cnt["too_few_rows"] += 1
        elif actual_status == "PENDING":
            category = "INSUFFICIENT_DATA"
            reason = (f"actual outcome still PENDING (window not yet expired)")
            cnt_insufficient += 1
            insuf_reason_cnt["window_not_expired"] += 1
        else:
            category = "REAL_MISMATCH"
            reason = (f"recorded={recorded_norm} but actual={actual_status} "
                      f"({tp_hit or 'no TP'}) based on {n_rows} rows in window")
            cnt_real_mismatch += 1
            transition_cnt[f"{recorded_norm}_to_{actual_status}"] += 1

        categorized.append({
            "id": pid,
            "ticker": ticker,
            "prediction_date": pred_date_str,
            "outcome_date": p["outcome_date"],
            "window_end": window_end_str,
            "window_span_days": window_span_days,
            "entry_price": entry,
            "target_price": target,
            "target_price_2": target2,
            "stop_loss": stop,
            "recorded_status": p["status"],
            "recorded_status_norm": recorded_norm,
            "actual_status": actual_status,
            "target_hit_via": tp_hit,
            "exit_type": p["exit_type"],
            "persona": p["persona"],
            "direction": p["direction"],
            "max_high_in_window": max_high,
            "min_low_in_window": min_low,
            "last_close_in_window": last_close,
            "max_close_in_window": max_close,
            "rows_in_window": n_rows,
            "highest_price_reached_recorded": p["highest_price_reached"],
            "lowest_price_reached_recorded": p["lowest_price_reached"],
            "actual_return_recorded": safe_float(p["actual_return"]),
            "category": category,
            "reason": reason,
            "mismatch_type": m.get("mismatch_type"),
        })

    # ----- print summary -----
    print("=" * 80)
    print("CATEGORIZATION SUMMARY")
    print("=" * 80)
    print(f"Total mismatches reviewed       : {len(categorized)}")
    print(f"  FALSE_POSITIVE (reconcile wrong) : {cnt_false_positive}")
    print(f"  INSUFFICIENT_DATA (skip)         : {cnt_insufficient}")
    print(f"  REAL_MISMATCH (needs correction) : {cnt_real_mismatch}")
    print()

    print("REAL_MISMATCH transitions:")
    for k, n in sorted(transition_cnt.items(), key=lambda kv: -kv[1]):
        print(f"  {k:<32} : {n}")
    print()

    print("INSUFFICIENT_DATA reasons:")
    for k, n in sorted(insuf_reason_cnt.items(), key=lambda kv: -kv[1]):
        print(f"  {k:<32} : {n}")
    print()

    # By ticker
    by_ticker_real: Counter = Counter()
    by_ticker_insuf: Counter = Counter()
    for c in categorized:
        if c["category"] == "REAL_MISMATCH":
            by_ticker_real[c["ticker"]] += 1
        elif c["category"] == "INSUFFICIENT_DATA":
            by_ticker_insuf[c["ticker"]] += 1

    print("REAL_MISMATCH by ticker (top 15):")
    for tk, n in by_ticker_real.most_common(15):
        print(f"  {tk:<8}: {n}")
    print()

    print("INSUFFICIENT_DATA by ticker:")
    for tk, n in by_ticker_insuf.most_common():
        print(f"  {tk:<8}: {n}")
    print()

    # By exit_type
    by_exit_real: Counter = Counter()
    by_exit_insuf: Counter = Counter()
    for c in categorized:
        if c["category"] == "REAL_MISMATCH":
            by_exit_real[c["exit_type"] or "<NULL>"] += 1
        elif c["category"] == "INSUFFICIENT_DATA":
            by_exit_insuf[c["exit_type"] or "<NULL>"] += 1

    print("REAL_MISMATCH by exit_type:")
    for et, n in sorted(by_exit_real.items(), key=lambda kv: -kv[1]):
        print(f"  {et:<24}: {n}")
    print()

    # Outcome_date clustering
    by_outcome_date: Counter = Counter()
    for c in categorized:
        if c["category"] == "REAL_MISMATCH":
            od = (c["outcome_date"] or "")[:10]
            by_outcome_date[od] += 1
    print("REAL_MISMATCH by outcome_date (top 5):")
    for od, n in by_outcome_date.most_common(5):
        print(f"  {od}: {n}")
    print()

    # ----- write JSON report -----
    ts = now.strftime("%Y%m%dT%H%M%SZ")
    out_path = OUTPUT_DIR / f"reconcile_remaining_{ts}.json"
    report = {
        "run_at": now.isoformat() + "Z",
        "input_reconcile_json": str(in_path),
        "predictions_db": str(PRED_DB),
        "price_history_db": str(PRICE_DB),
        "total_mismatches_reviewed": len(categorized),
        "false_positive_count": cnt_false_positive,
        "insufficient_data_count": cnt_insufficient,
        "real_mismatch_count": cnt_real_mismatch,
        "real_mismatch_transitions": dict(transition_cnt),
        "insufficient_reasons": dict(insuf_reason_cnt),
        "by_ticker_real": dict(by_ticker_real),
        "by_ticker_insufficient": dict(by_ticker_insuf),
        "by_exit_type_real": dict(by_exit_real),
        "by_outcome_date_real_top5": by_outcome_date.most_common(5),
        "categorized": categorized,
    }
    out_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print(f"[INFO] Wrote report: {out_path}")

    pred_conn.close()
    price_conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
