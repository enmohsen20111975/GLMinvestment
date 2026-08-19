#!/usr/bin/env python3
"""
PHASE 2.5 — Profit Concentration Test (READ-ONLY)
==================================================
Goal: Determine whether trading profit is distributed across many trades or
concentrated in a few (single-stock / single-trade dominance).

Quality filter (matches PHASE 0.4 / PHASE 1.3):
    - entry_price > 0
    - ticker clean (no spaces, length <= 12)
    - market known (not UNKNOWN / empty)
    - dedup on (ticker, prediction_date, ROUND(entry_price,4), morning_bell)
      keeping MAX(id) (latest version of the same prediction)
    - |exit/entry| <= 5x  (exit = target_price if hit_target=1, stop_loss if
      hit_stop=1)

Return formula (PHASE 1.3 spec, conservative — no fabrication):
    - hit_target=1 -> (target - entry) / entry * 100
    - hit_stop=1   -> (stop  - entry) / entry * 100
    - else         -> None  (expired without a definitive hit)

HARD cap: ABS(return) <= 50

total_profit = sum(positive returns)

Output: scripts/audit_phase2_concentration.json
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import sqlite3
from collections import defaultdict
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Paths & constants
# ---------------------------------------------------------------------------
PROJECT_ROOT = "/home/z/my-project"
DB_PATH = os.path.join(PROJECT_ROOT, "db", "predictions.db")
ZIP_PATH = os.path.join(PROJECT_ROOT, "data",
                        "active_databases_20260817_full.zip")
OUT_JSON = os.path.join(PROJECT_ROOT, "scripts",
                        "audit_phase2_concentration.json")

EXPECTED_MD5 = "0947bdf6c2eff1a75ff8af6c3e576ed8"
HARD_CAP = 50.0
MAX_RETURN_RATIO = 5.0
ENTRY_ROUND = 4


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def connect_ro(path: str) -> sqlite3.Connection:
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


def md5_of_file(path: str) -> Optional[str]:
    if not os.path.exists(path):
        return None
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _float(v: Any) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(f):
        return None
    return f


def ticker_clean(t: Optional[str]) -> bool:
    if not t:
        return False
    s = str(t).strip()
    if not s:
        return False
    if " " in s:
        return False
    if len(s) > 12:
        return False
    return True


def market_known(m: Optional[str]) -> bool:
    if m is None:
        return False
    s = str(m).strip().upper()
    if not s or s == "UNKNOWN":
        return False
    return True


# ---------------------------------------------------------------------------
# Trade return computation (matches PHASE 1.3 spec)
# ---------------------------------------------------------------------------
def compute_return(row: Dict[str, Any]) -> Dict[str, Any]:
    """Compute trade return following the conservative PHASE 1.3 formula.

    Returns a dict with:
        actual_return  (float | None)  -- None when no definitive hit
        exit_used      (float | None)  -- target_price or stop_loss used
        valid          (bool)          -- False when excluded by quality filter
        exclusion_reason (str | None)
        capped         (bool)          -- True when |return| was clamped to 50
    """
    ticker = (row.get("ticker") or "").strip().upper()
    market = (row.get("market") or "UNKNOWN").strip().upper()
    entry = _float(row.get("entry_price"))
    target = _float(row.get("target_price"))
    stop = _float(row.get("stop_loss"))
    hit_target = int(row.get("hit_target") or 0)
    hit_stop = int(row.get("hit_stop") or 0)

    result: Dict[str, Any] = {
        "actual_return": None,
        "exit_used": None,
        "valid": True,
        "exclusion_reason": None,
        "capped": False,
    }

    # Quality filter
    if not entry or entry <= 0:
        result["valid"] = False
        result["exclusion_reason"] = "entry_price_zero"
        return result
    if not ticker_clean(ticker):
        result["valid"] = False
        result["exclusion_reason"] = "ticker_invalid"
        return result
    if not market_known(market):
        result["valid"] = False
        result["exclusion_reason"] = "market_unknown"
        return result

    raw_ret: Optional[float] = None
    exit_used: Optional[float] = None

    # hit_target -> target
    if hit_target == 1 and target and target > 0:
        raw_ret = (target - entry) / entry * 100
        exit_used = target
    # hit_stop -> stop
    elif hit_stop == 1 and stop and stop > 0:
        raw_ret = (stop - entry) / entry * 100
        exit_used = stop
    # else: no fabrication
    if raw_ret is None:
        return result

    # |exit/entry| <= 5x sanity
    if exit_used is not None and entry > 0:
        if abs(exit_used / entry) > MAX_RETURN_RATIO:
            result["valid"] = False
            result["exclusion_reason"] = "exit_price_unrealistic"
            return result

    # HARD cap |return| <= 50
    result["capped"] = abs(raw_ret) > HARD_CAP
    result["actual_return"] = max(-HARD_CAP, min(HARD_CAP, raw_ret))
    result["exit_used"] = exit_used
    return result


# ---------------------------------------------------------------------------
# Concentration analysis
# ---------------------------------------------------------------------------
def concentration_analysis(trades: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Compute profit concentration metrics for a list of trade dicts.

    Each trade dict must contain 'actual_return' (float | None) and
    'valid' (bool) keys as produced by compute_return().
    """
    measured = [t for t in trades
                if t["valid"] and t["actual_return"] is not None]
    winners = [t for t in measured if t["actual_return"] > 0]
    losers = [t for t in measured if t["actual_return"] < 0]
    total_profit = sum(t["actual_return"] for t in winners)
    total_loss = sum(t["actual_return"] for t in losers)

    n_measured = len(measured)
    n_winners = len(winners)
    n_losers = len(losers)

    # Sort winners by return descending (top contributors first)
    sorted_winners = sorted(
        winners, key=lambda t: t["actual_return"], reverse=True)

    def top_n_pct(n: int) -> float:
        if total_profit <= 0:
            return 0.0
        top_n = sorted_winners[:n]
        s = sum(t["actual_return"] for t in top_n)
        return round((s / total_profit) * 100, 4)

    top1_pct = top_n_pct(1)
    top3_pct = top_n_pct(3)
    top5_pct = top_n_pct(5)
    top10_pct = top_n_pct(10)

    # Pareto: smallest N (winners, sorted desc) to reach 80% of total_profit
    if total_profit <= 0 or n_winners == 0:
        pareto_n = 0
        pareto_pct = 0.0
    else:
        cum = 0.0
        pareto_n = 0
        target_80 = 0.80 * total_profit
        for t in sorted_winners:
            cum += t["actual_return"]
            pareto_n += 1
            if cum >= target_80:
                break
        # Pareto pct relative to ALL measured trades (Pareto inputs = trades)
        pareto_pct = round((pareto_n / n_measured) * 100, 4) if n_measured else 0.0

    # Sample top winner tickers for transparency
    top_winner_meta = [
        {
            "id": int(t.get("id")),
            "ticker": (t.get("ticker") or "").strip().upper(),
            "morning_bell": int(t.get("morning_bell") or 0),
            "prediction_date": t.get("prediction_date"),
            "return_pct": round(t["actual_return"], 4),
        }
        for t in sorted_winners[:10]
    ]

    return {
        "n_measured": n_measured,
        "n_winners": n_winners,
        "n_losers": n_losers,
        "total_profit": round(total_profit, 4),
        "total_loss": round(total_loss, 4),
        "top1_contribution_pct": top1_pct,
        "top3_contribution_pct": top3_pct,
        "top5_contribution_pct": top5_pct,
        "top10_contribution_pct": top10_pct,
        "pareto_80pct_from_n_trades": pareto_n,
        "pareto_80pct_from_pct_trades": pareto_pct,
        "top_winner_meta": top_winner_meta,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> int:
    zip_md5 = md5_of_file(ZIP_PATH)
    md5_match = (zip_md5 == EXPECTED_MD5)

    conn = connect_ro(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Load all predictions
    cur.execute("""
        SELECT id, ticker, market, persona, morning_bell, status,
               entry_price, target_price, stop_loss, exit_price,
               actual_exit_price, actual_return, hit_target, hit_stop,
               prediction_date
        FROM predictions
    """)
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()

    n_raw = len(rows)

    # Dedup: (ticker, prediction_date, ROUND(entry_price,4), morning_bell)
    # keeping MAX(id) (latest version).
    dedup_keep_ids: Dict[Tuple[str, str, float, int], int] = {}
    for r in rows:
        ent = _float(r.get("entry_price")) or 0.0
        key = (
            (r.get("ticker") or "").strip().upper(),
            r.get("prediction_date") or "",
            round(ent, ENTRY_ROUND),
            int(r.get("morning_bell") or 0),
        )
        rid = int(r["id"])
        prev = dedup_keep_ids.get(key)
        if prev is None or rid > prev:
            dedup_keep_ids[key] = rid

    keep_ids_set = set(dedup_keep_ids.values())
    rows_dedup = [r for r in rows if int(r["id"]) in keep_ids_set]
    n_after_dedup = len(rows_dedup)
    n_dropped_dup = n_raw - n_after_dedup

    # Compute return per trade
    for r in rows_dedup:
        r.update(compute_return(r))

    # Bucket breakdown
    excluded = [r for r in rows_dedup if not r["valid"]]
    exclusion_breakdown: Dict[str, int] = defaultdict(int)
    for r in excluded:
        exclusion_breakdown[r.get("exclusion_reason") or "unknown"] += 1

    null_returns = [r for r in rows_dedup
                    if r["valid"] and r["actual_return"] is None]
    measured = [r for r in rows_dedup
                if r["valid"] and r["actual_return"] is not None]

    # Overall concentration
    overall = concentration_analysis(rows_dedup)

    # Per-channel concentration
    balanced_rows = [r for r in rows_dedup
                     if int(r.get("morning_bell") or 0) == 0]
    morning_bell_rows = [r for r in rows_dedup
                         if int(r.get("morning_bell") or 0) == 1]
    balanced_stats = concentration_analysis(balanced_rows)
    morning_bell_stats = concentration_analysis(morning_bell_rows)

    # Per-ticker profit
    ticker_profit: Dict[str, float] = defaultdict(float)
    ticker_n_trades: Dict[str, int] = defaultdict(int)
    ticker_n_wins: Dict[str, int] = defaultdict(int)
    for r in measured:
        tk = (r.get("ticker") or "").strip().upper()
        ret = r["actual_return"]
        if ret is None:
            continue
        ticker_n_trades[tk] += 1
        if ret > 0:
            ticker_profit[tk] += ret
            ticker_n_wins[tk] += 1

    sorted_tickers = sorted(ticker_profit.items(),
                            key=lambda kv: kv[1], reverse=True)
    top_tickers_list: List[Dict[str, Any]] = []
    for tk, prof in sorted_tickers[:10]:
        pct = (prof / overall["total_profit"] * 100
               if overall["total_profit"] > 0 else 0.0)
        top_tickers_list.append({
            "ticker": tk,
            "profit": round(prof, 4),
            "pct": round(pct, 4),
            "n_trades": ticker_n_trades.get(tk, 0),
            "n_winning_trades": ticker_n_wins.get(tk, 0),
        })

    top3_tickers_combined_pct = round(
        sum(t["pct"] for t in top_tickers_list[:3]), 4)

    # Single-ticker dominance test
    single_ticker_dominant = bool(
        top_tickers_list and top_tickers_list[0]["pct"] >= 25.0
    )

    # Verdict
    top1 = overall["top1_contribution_pct"]
    top3 = overall["top3_contribution_pct"]
    top5 = overall["top5_contribution_pct"]
    top10 = overall["top10_contribution_pct"]
    pareto_pct = overall["pareto_80pct_from_pct_trades"]

    # Heuristic:
    #   CONCENTRATED  : top1 >= 25% OR top3 >= 60% OR single ticker >= 25%
    #   DISTRIBUTED   : top1 <= 10% AND top10 <= 60% AND pareto_pct >= 30%
    #   MODERATELY    : otherwise
    if top1 >= 25 or top3 >= 60 or single_ticker_dominant:
        verdict = "CONCENTRATED"
        next_phase = False  # risk: too few trades drive the P&L
    elif top1 <= 10 and top10 <= 60 and pareto_pct >= 30:
        verdict = "DISTRIBUTED"
        next_phase = True
    else:
        verdict = "MODERATELY_CONCENTRATED"
        next_phase = True  # proceed but flag

    report = {
        "audit": "PHASE-2.5-Profit-Concentration",
        "db_path": DB_PATH,
        "dataset_zip": ZIP_PATH,
        "dataset_md5_expected": EXPECTED_MD5,
        "dataset_md5_observed": zip_md5,
        "dataset_md5_match": md5_match,
        "rules": {
            "hard_cap_abs_return": HARD_CAP,
            "max_return_ratio": MAX_RETURN_RATIO,
            "return_formula": (
                "hit_target=(target-entry)/entry*100 | "
                "hit_stop=(stop-entry)/entry*100 | "
                "expired_no_hit=None"
            ),
            "dedup_key": (
                "(ticker, prediction_date, ROUND(entry_price,4), "
                "morning_bell) keeping MAX(id)"
            ),
            "total_profit_def": "sum(positive returns)",
        },
        "n_raw_predictions": n_raw,
        "n_after_dedup": n_after_dedup,
        "n_dropped_duplicates": n_dropped_dup,
        "n_measured": overall["n_measured"],
        "n_winners": overall["n_winners"],
        "n_losers": overall["n_losers"],
        "n_excluded": len(excluded),
        "n_null_returns": len(null_returns),
        "exclusion_breakdown": dict(exclusion_breakdown),
        "total_profit": overall["total_profit"],
        "total_loss": overall["total_loss"],
        "top1_contribution_pct": overall["top1_contribution_pct"],
        "top3_contribution_pct": overall["top3_contribution_pct"],
        "top5_contribution_pct": overall["top5_contribution_pct"],
        "top10_contribution_pct": overall["top10_contribution_pct"],
        "pareto_80pct_from_n_trades": overall["pareto_80pct_from_n_trades"],
        "pareto_80pct_from_pct_trades": overall["pareto_80pct_from_pct_trades"],
        "by_channel": {
            "balanced": balanced_stats,
            "morning_bell": morning_bell_stats,
        },
        "top_tickers": top_tickers_list,
        "top3_tickers_combined_pct": top3_tickers_combined_pct,
        "single_ticker_dominant": single_ticker_dominant,
        "verdict": verdict,
        "status": "PASS",
        "next_phase_allowed": next_phase,
    }

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)

    # -----------------------------------------------------------------
    # Console summary
    # -----------------------------------------------------------------
    print("=" * 78)
    print("PHASE 2.5 — PROFIT CONCENTRATION TEST")
    print("=" * 78)
    print(f"Dataset MD5: {zip_md5} "
          f"(expected {EXPECTED_MD5}, match={md5_match})")
    print(f"n_raw={n_raw} | n_after_dedup={n_after_dedup} "
          f"| n_dropped_dup={n_dropped_dup}")
    print(f"n_measured={overall['n_measured']} "
          f"| n_winners={overall['n_winners']} "
          f"| n_losers={overall['n_losers']} "
          f"| n_null_returns={len(null_returns)} "
          f"| n_excluded={len(excluded)}")
    if exclusion_breakdown:
        print(f"exclusion_breakdown={dict(exclusion_breakdown)}")
    print(f"Total profit: {overall['total_profit']:.4f} "
          f"| Total loss: {overall['total_loss']:.4f}")
    print()
    print("Overall concentration:")
    print(f"  Top 1  contribution: {overall['top1_contribution_pct']:.2f}%")
    print(f"  Top 3  contribution: {overall['top3_contribution_pct']:.2f}%")
    print(f"  Top 5  contribution: {overall['top5_contribution_pct']:.2f}%")
    print(f"  Top 10 contribution: {overall['top10_contribution_pct']:.2f}%")
    print(f"  Pareto: 80% of profit from "
          f"{overall['pareto_80pct_from_n_trades']} trades "
          f"({overall['pareto_80pct_from_pct_trades']:.2f}% of measured)")
    print()
    print("Per-channel:")
    print(f"  balanced     : profit={balanced_stats['total_profit']:.4f} "
          f"n={balanced_stats['n_measured']} "
          f"top1={balanced_stats['top1_contribution_pct']:.2f}% "
          f"top3={balanced_stats['top3_contribution_pct']:.2f}% "
          f"top5={balanced_stats['top5_contribution_pct']:.2f}% "
          f"top10={balanced_stats['top10_contribution_pct']:.2f}% "
          f"pareto_n={balanced_stats['pareto_80pct_from_n_trades']} "
          f"pareto_pct={balanced_stats['pareto_80pct_from_pct_trades']:.2f}%")
    print(f"  morning_bell : profit={morning_bell_stats['total_profit']:.4f} "
          f"n={morning_bell_stats['n_measured']} "
          f"top1={morning_bell_stats['top1_contribution_pct']:.2f}% "
          f"top3={morning_bell_stats['top3_contribution_pct']:.2f}% "
          f"top5={morning_bell_stats['top5_contribution_pct']:.2f}% "
          f"top10={morning_bell_stats['top10_contribution_pct']:.2f}% "
          f"pareto_n={morning_bell_stats['pareto_80pct_from_n_trades']} "
          f"pareto_pct={morning_bell_stats['pareto_80pct_from_pct_trades']:.2f}%")
    print()
    print("Top tickers:")
    for t in top_tickers_list[:5]:
        print(f"  {t['ticker']:8s} profit={t['profit']:8.4f}  "
              f"pct={t['pct']:6.2f}%  "
              f"n_trades={t['n_trades']}  "
              f"n_wins={t['n_winning_trades']}")
    print(f"Top 3 tickers combined: {top3_tickers_combined_pct:.2f}%")
    print(f"Single-ticker dominant (>=25%): {single_ticker_dominant}")
    print()
    print(f"VERDICT: {verdict}")
    print(f"STATUS: {report['status']}")
    print(f"NEXT_PHASE_ALLOWED: {next_phase}")
    print(f"Report: {OUT_JSON}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
