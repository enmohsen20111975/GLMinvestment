#!/usr/bin/env python3
"""
reconcile_hit_targets.py
========================

Reconciles recorded `status` values in `predictions.db.predictions` against
the actual price history in `price_history.db.price_history`.

Goal (P0-17-RECONCILE):
  The AUDIT_BACKTEST report found that ~17% of `hit_target` assertions are
  FALSE — predictions claim `status='TARGET_HIT'` but the actual price
  never reached the target. This script:

    1. Reads all closed predictions from predictions.db
    2. For each, fetches actual price history (high/low/close) from
       price_history.db for the verification window (prediction_date →
       outcome_date, or +30 calendar days if outcome_date is null)
    3. Determines the *actual* outcome from the price data:
         max_high >= target_price  → TARGET_HIT
         min_low  <= stop_loss      → STOPPED
         window expired             → EXPIRED
         else                       → PENDING (shouldn't be in closed set)
    4. Compares actual vs recorded status and categorizes as:
         ✅ MATCH  |  ❌ MISMATCH  |  ⚠️ INSUFFICIENT_DATA
    5. Writes:
         - stdout summary
         - JSON report:  scripts/output/hit_target_reconciliation_<ts>.json
         - SQL fixes:     scripts/output/hit_target_fixes_<ts>.sql  (commented out)

  STRICTLY READ-ONLY — the script never writes to either database.
  All suggested UPDATE statements are commented out for manual review.

Algorithm:
  * Price-history queries are BATCHED per-ticker — one query per ticker,
    cache all rows in a dict, then slice in Python by date window. This
    avoids 1-query-per-prediction overhead (predictions ≈ 1,200 rows).

Usage:
  python3 scripts/reconcile_hit_targets.py
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
PRED_DB = ROOT / "db" / "predictions.db"
PRICE_DB = ROOT / "db" / "price_history.db"
OUTPUT_DIR = ROOT / "scripts" / "output"

# Closed statuses we care about (per task spec, 6 statuses)
CLOSED_STATUSES = (
    "TARGET_HIT",
    "STOPPED",
    "closed_win",
    "closed_stop",
    "EXPIRED",
    "expired",
)

# Map recorded status -> normalized canonical label
NORMALIZE_STATUS = {
    "TARGET_HIT": "TARGET_HIT",
    "closed_win": "TARGET_HIT",
    "STOPPED": "STOPPED",
    "closed_stop": "STOPPED",
    "EXPIRED": "EXPIRED",
    "expired": "EXPIRED",
}

# Tolerance (EGP floats are 4-decimal; treat sub-tick differences as hits)
PRICE_EPS = 1e-4


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def parse_date(s: Optional[str]) -> Optional[datetime]:
    """Best-effort parse of a date/datetime string from the DBs."""
    if not s:
        return None
    s = s.strip()
    # Common formats in this DB:
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
    # Fall back to ISO parse
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def normalize_ticker(t: Optional[str]) -> str:
    """Normalize ticker — both DBs use uppercase, but enforce defensively."""
    return (t or "").strip().upper()


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


def pct(part: float, whole: float) -> str:
    return f"{(part / whole * 100.0):.2f}%" if whole else "0.00%"


# ---------------------------------------------------------------------------
# DB layer
# ---------------------------------------------------------------------------
def fetch_closed_predictions(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    """Fetch all closed predictions with the columns we need."""
    sql = """
        SELECT id, ticker, prediction_date, entry_price, target_price,
               stop_loss, status, outcome_date, closed_at, actual_return,
               exit_type
        FROM predictions
        WHERE status IN (?, ?, ?, ?, ?, ?)
    """
    cur = conn.execute(sql, CLOSED_STATUSES)
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def fetch_price_history_by_ticker(
    conn: sqlite3.Connection, tickers: List[str]
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Batched: one query per ticker, fetch ALL rows for that ticker
    sorted by date. Returns {ticker: [{date, high, low, close}, ...]}.
    """
    cache: Dict[str, List[Dict[str, Any]]] = {}
    cur = conn.cursor()
    sql = (
        "SELECT date, high_price, low_price, close_price "
        "FROM price_history WHERE ticker = ? ORDER BY date"
    )
    for tk in tickers:
        if not tk:
            continue
        cur.execute(sql, (tk,))
        rows = cur.fetchall()
        cache[tk] = [
            {"date": r[0], "high": r[1], "low": r[2], "close": r[3]} for r in rows
        ]
    cur.close()
    return cache


def window_slice(
    rows: List[Dict[str, Any]], start_date_str: str, end_date_str: str
) -> Tuple[float, float, float, int]:
    """
    Slice price rows whose `date` (string, 'YYYY-MM-DD') is within
    [start_date_str, end_date_str] inclusive. Returns (max_high, min_low,
    max_close, row_count).  Skips rows with null high/low.
    """
    max_high: float = float("-inf")
    min_low: float = float("inf")
    max_close: float = float("-inf")
    count = 0
    for r in rows:
        d = r["date"] or ""
        # date column is 'YYYY-MM-DD' — string compare is valid for ISO dates
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
        if c is not None and c > max_close:
            max_close = c
    return max_high, min_low, max_close, count


# ---------------------------------------------------------------------------
# Determination logic
# ---------------------------------------------------------------------------
def determine_actual_outcome(
    max_high: float,
    min_low: float,
    target_price: float,
    stop_loss: float,
    window_expired: bool,
) -> str:
    """Apply the algorithm in the task spec."""
    if max_high != float("-inf") and max_high + PRICE_EPS >= target_price:
        return "TARGET_HIT"
    if min_low != float("inf") and min_low - PRICE_EPS <= stop_loss:
        return "STOPPED"
    if window_expired:
        return "EXPIRED"
    return "PENDING"  # still active — shouldn't appear in closed set


def build_suggested_update(
    pred_id: int, actual: str
) -> str:
    """Build the commented-out UPDATE statement for manual review."""
    if actual == "TARGET_HIT":
        new_status = "TARGET_HIT"
    elif actual == "STOPPED":
        new_status = "STOPPED"
    elif actual == "EXPIRED":
        new_status = "EXPIRED"
    else:
        new_status = "active"  # PENDING — re-open the prediction
    # actual_return is set to NULL because we can't reliably reconstruct it
    # without re-running the exit-price logic; reviewer should recompute.
    return (
        f"-- UPDATE predictions SET status='{new_status}', "
        f"actual_return=NULL WHERE id={pred_id};"
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    if not PRED_DB.exists():
        print(f"ERROR: predictions DB not found at {PRED_DB}", file=sys.stderr)
        return 2
    if not PRICE_DB.exists():
        print(f"ERROR: price_history DB not found at {PRICE_DB}", file=sys.stderr)
        return 2

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # Open read-only via URI to GUARANTEE no writes happen.
    pred_uri = f"file:{PRED_DB}?mode=ro"
    price_uri = f"file:{PRICE_DB}?mode=ro"
    pred_conn = sqlite3.connect(pred_uri, uri=True)
    price_conn = sqlite3.connect(price_uri, uri=True)

    print(f"[INFO] predictions.db:   {PRED_DB}")
    print(f"[INFO] price_history.db: {PRICE_DB}")
    print(f"[INFO] READ-ONLY mode (URI ?mode=ro) — no DB writes will occur.")
    print()

    preds = fetch_closed_predictions(pred_conn)
    print(f"[1/4] Fetched {len(preds)} closed predictions.")

    # Pre-fetch price history for every distinct ticker (batched per-ticker)
    distinct_tickers = sorted(
        {normalize_ticker(p["ticker"]) for p in preds if p["ticker"]}
    )
    print(
        f"[2/4] Fetching price history for {len(distinct_tickers)} distinct "
        f"tickers (batched per-ticker)..."
    )
    price_cache = fetch_price_history_by_ticker(price_conn, distinct_tickers)
    print(
        f"      Price-history rows cached for "
        f"{sum(1 for v in price_cache.values() if v)} / "
        f"{len(distinct_tickers)} tickers."
    )

    matches: List[Dict[str, Any]] = []
    mismatches: List[Dict[str, Any]] = []
    insufficient: List[Dict[str, Any]] = []
    anomalies: List[str] = []  # log lines for weird data (e.g., exit<entry)

    now = datetime.now(timezone.utc)
    today_str = now.strftime("%Y-%m-%d")

    for p in preds:
        pid = p["id"]
        ticker_raw = p["ticker"]
        ticker = normalize_ticker(ticker_raw)
        pred_dt = parse_date(p["prediction_date"])
        outcome_dt = parse_date(p["outcome_date"]) or parse_date(p["closed_at"])

        entry = safe_float(p["entry_price"])
        target = safe_float(p["target_price"])
        stop = safe_float(p["stop_loss"])
        recorded_status = p["status"] or ""
        actual_return = safe_float(p["actual_return"])

        # ----- skip if missing critical data -----
        if entry is None or entry <= 0 or target is None or target <= 0 or stop is None or stop <= 0:
            insufficient.append(
                {
                    "id": pid,
                    "ticker": ticker,
                    "prediction_date": p["prediction_date"],
                    "recorded_status": recorded_status,
                    "reason": "missing entry/target/stop",
                    "entry_price": entry,
                    "target_price": target,
                    "stop_loss": stop,
                }
            )
            continue

        if pred_dt is None:
            insufficient.append(
                {
                    "id": pid,
                    "ticker": ticker,
                    "prediction_date": p["prediction_date"],
                    "recorded_status": recorded_status,
                    "reason": "unparseable prediction_date",
                    "entry_price": entry,
                    "target_price": target,
                    "stop_loss": stop,
                }
            )
            continue

        pred_date_str = pred_dt.strftime("%Y-%m-%d")

        # ----- determine window end -----
        if outcome_dt is not None:
            end_dt = outcome_dt
            window_end_str = end_dt.strftime("%Y-%m-%d")
            if end_dt < pred_dt:
                anomalies.append(
                    f"id={pid} ticker={ticker} outcome_date "
                    f"({window_end_str}) < prediction_date ({pred_date_str}) "
                    f"— using outcome_date anyway."
                )
        else:
            # +30 calendar days fallback
            end_dt = pred_dt + timedelta(days=30)
            window_end_str = end_dt.strftime("%Y-%m-%d")

        # ----- look up price history -----
        rows = price_cache.get(ticker, [])
        max_high, min_low, max_close, n_rows = window_slice(
            rows, pred_date_str, window_end_str
        )

        if n_rows == 0:
            insufficient.append(
                {
                    "id": pid,
                    "ticker": ticker,
                    "prediction_date": pred_date_str,
                    "window_end": window_end_str,
                    "recorded_status": recorded_status,
                    "reason": "no price_history rows in window",
                    "entry_price": entry,
                    "target_price": target,
                    "stop_loss": stop,
                }
            )
            continue

        # ----- actual outcome -----
        # Window is "expired" if end_dt is in the past (i.e., before today)
        window_expired = end_dt.date() < now.date()
        actual = determine_actual_outcome(
            max_high, min_low, target, stop, window_expired
        )

        recorded_norm = NORMALIZE_STATUS.get(recorded_status, recorded_status)
        actual_norm = actual  # already canonical

        # ----- compare -----
        record = {
            "id": pid,
            "ticker": ticker,
            "prediction_date": pred_date_str,
            "outcome_date": p["outcome_date"],
            "window_end": window_end_str,
            "entry_price": entry,
            "target_price": target,
            "stop_loss": stop,
            "recorded_status": recorded_status,
            "recorded_status_norm": recorded_norm,
            "actual_status": actual_norm,
            "actual_return_recorded": actual_return,
            "max_high_in_window": max_high,
            "min_low_in_window": min_low,
            "max_close_in_window": max_close,
            "price_rows_in_window": n_rows,
        }

        if actual_norm == "PENDING":
            # Window hasn't elapsed — shouldn't be in closed set; flag as
            # mismatch (recorded closed, but actual = PENDING).
            mismatches.append(record)
        elif actual_norm == recorded_norm:
            matches.append(record)
        else:
            record["mismatch_type"] = f"{recorded_norm}_to_{actual_norm}"
            mismatches.append(record)

    # ----- compute mismatch_type counts -----
    mismatches_by_type: Dict[str, int] = {}
    for m in mismatches:
        key = m.get("mismatch_type") or "OTHER"
        mismatches_by_type[key] = mismatches_by_type.get(key, 0) + 1

    # ----- top mismatches: sort by largest |return| swing first -----
    def mismatch_sort_key(m: Dict[str, Any]) -> float:
        ret = m.get("actual_return_recorded")
        if ret is None:
            return 0.0
        return abs(ret)

    top_mismatches = sorted(mismatches, key=mismatch_sort_key, reverse=True)[:50]

    # ----- print stdout summary -----
    total = len(preds)
    n_match = len(matches)
    n_mismatch = len(mismatches)
    n_insuf = len(insufficient)

    print()
    print("=" * 72)
    print("[3/4] RECONCILIATION SUMMARY")
    print("=" * 72)
    print(f"Total closed predictions checked : {total}")
    print(f"  MATCH (recorded == actual)      : {n_match}  ({pct(n_match, total)})")
    print(f"  MISMATCH (recorded != actual)   : {n_mismatch}  ({pct(n_mismatch, total)})")
    print(f"  INSUFFICIENT_DATA               : {n_insuf}  ({pct(n_insuf, total)})")
    print()
    print("Mismatches by type (recorded_to_actual):")
    for k in sorted(mismatches_by_type, key=lambda k: -mismatches_by_type[k]):
        print(f"  {k:<32} : {mismatches_by_type[k]}")
    print()
    print(f"Anomalies (exit_date < prediction_date etc.): {len(anomalies)}")
    for a in anomalies[:5]:
        print(f"  ⚠️  {a}")
    if len(anomalies) > 5:
        print(f"  ... ({len(anomalies) - 5} more, see JSON report)")
    print()
    print("Top 10 mismatches (by largest |recorded actual_return|):")
    print("-" * 72)
    hdr = (
        f"{'id':<7} {'ticker':<8} {'pred_date':<11} {'recorded':<12} "
        f"{'actual':<12} {'entry':>9} {'target':>9} {'stop':>8} "
        f"{'max_high':>10} {'min_low':>10} {'ret%':>8}"
    )
    print(hdr)
    print("-" * 72)
    for m in top_mismatches[:10]:
        ret = m.get("actual_return_recorded")
        ret_s = f"{ret:+.2f}" if ret is not None else "n/a"
        print(
            f"{m['id']:<7} {m['ticker']:<8} {m['prediction_date']:<11} "
            f"{m['recorded_status_norm']:<12} {m['actual_status']:<12} "
            f"{m['entry_price']:>9.2f} {m['target_price']:>9.2f} "
            f"{m['stop_loss']:>8.2f} {m['max_high_in_window']:>10.2f} "
            f"{m['min_low_in_window']:>10.2f} {ret_s:>8}"
        )

    # ----- write JSON report -----
    ts = now.strftime("%Y%m%dT%H%M%SZ")
    json_path = OUTPUT_DIR / f"hit_target_reconciliation_{ts}.json"
    sql_path = OUTPUT_DIR / f"hit_target_fixes_{ts}.sql"

    report = {
        "run_at": now.isoformat() + "Z",
        "predictions_db": str(PRED_DB),
        "price_history_db": str(PRICE_DB),
        "closed_statuses_queried": list(CLOSED_STATUSES),
        "total_checked": total,
        "matches": n_match,
        "mismatches": n_mismatch,
        "insufficient_data": n_insuf,
        "mismatch_rate_pct": round(n_mismatch / total * 100.0, 2) if total else 0.0,
        "match_rate_pct": round(n_match / total * 100.0, 2) if total else 0.0,
        "insufficient_rate_pct": round(n_insuf / total * 100.0, 2) if total else 0.0,
        "mismatches_by_type": mismatches_by_type,
        "anomalies": anomalies,
        "top_mismatches": top_mismatches,
        "all_mismatches": mismatches,
        "all_insufficient_data": insufficient,
    }
    json_path.write_text(json.dumps(report, indent=2, default=str), encoding="utf-8")
    print()
    print(f"[4/4] Wrote JSON report: {json_path}")

    # ----- write SQL fixes (commented out) -----
    lines: List[str] = []
    lines.append("-- ============================================================")
    lines.append("-- hit_target reconciliation — suggested UPDATE statements")
    lines.append("-- ============================================================")
    lines.append(f"-- Generated: {now.isoformat()}Z")
    lines.append(f"-- Source DBs: {PRED_DB.name} + {PRICE_DB.name}")
    lines.append(
        f"-- Total checked: {total}  |  Mismatches: {n_mismatch}  "
        f"|  Insufficient data: {n_insuf}"
    )
    lines.append("--")
    lines.append(
        "-- IMPORTANT: every UPDATE is COMMENTED OUT. Review each one and"
    )
    lines.append(
        "-- uncomment individually before applying. Setting actual_return=NULL"
    )
    lines.append(
        "-- forces the reviewer to recompute the correct return — do not"
    )
    lines.append("-- blindly apply."
    )
    lines.append("-- ============================================================")
    lines.append("")

    # Sort mismatches: largest |return| first
    sorted_mm = sorted(mismatches, key=mismatch_sort_key, reverse=True)
    for m in sorted_mm:
        ret = m.get("actual_return_recorded")
        ret_s = f"{ret:+.2f}%" if ret is not None else "n/a"
        lines.append(
            f"-- MISMATCH: prediction id={m['id']} ticker={m['ticker']} "
            f"date={m['prediction_date']}"
        )
        lines.append(
            f"-- Recorded: {m['recorded_status']} "
            f"(actual_return={ret_s})"
        )
        lines.append(
            f"-- Actual:   {m['actual_status']} "
            f"(max_high={m['max_high_in_window']:.4f}, "
            f"min_low={m['min_low_in_window']:.4f}, "
            f"target={m['target_price']:.4f}, "
            f"stop={m['stop_loss']:.4f}, "
            f"rows_in_window={m['price_rows_in_window']})"
        )
        lines.append("-- Suggested fix:")
        lines.append(build_suggested_update(m["id"], m["actual_status"]))
        lines.append("")

    sql_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"[4/4] Wrote SQL fixes : {sql_path}")

    # ----- close connections -----
    pred_conn.close()
    price_conn.close()

    # ----- final stdout summary line -----
    print()
    print("=" * 72)
    print(
        f"DONE. checked={total}  match={n_match} ({pct(n_match, total)})  "
        f"mismatch={n_mismatch} ({pct(n_mismatch, total)})  "
        f"insufficient={n_insuf}"
    )
    print("=" * 72)
    return 0


if __name__ == "__main__":
    sys.exit(main())
