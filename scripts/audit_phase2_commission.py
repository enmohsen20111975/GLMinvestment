#!/usr/bin/env python3
"""
PHASE 2.2 + 2.3 — Commission + Slippage Scenarios Audit (READ-ONLY)
===================================================================
Goal: Stress-test the trading Edge against realistic EGX trading costs.

EGX commission structure (research-based):
  - Brokerage fee:   ~0.15% (15 bps) per trade
  - Stamp duty:      0.05%  (sell-side only)
  - Total round-trip: ~0.30% – 0.35%

Scenarios:
  - NO_COST     : 0%   commission, 0%   slippage  (baseline = what we measure today)
  - BASE_COST   : 0.30% round-trip commission + 0.10% round-trip slippage
                  (commission 0.15% entry + 0.15% exit; slippage 0.05% per side)
  - STRESS_COST : 0.50% round-trip commission + 0.30% round-trip slippage
                  (commission 0.25% entry + 0.25% exit; slippage 0.15% per side)

Per scenario:
  * Apply the SAME quality filter as PHASE 2.1:
      - entry_price > 0
      - ticker clean (non-empty, no spaces, length <= 12)
      - market known (not UNKNOWN / not empty)
      - dedup on (ticker, prediction_date, morning_bell, ROUND(entry_price,6))
        keeping the lowest id (preserves channel separation done in PHASE 0.4)
  * Compute the cost-adjusted return:
      adjusted_return = raw_return - total_cost_pct
      where total_cost_pct = commission_round_trip + slippage_round_trip
  * HARD cap: ABS(adjusted_return) <= 50
  * KPIs per slice (all / balanced (morning_bell=0) / morning_bell (=1)):
      n_valid, Win Rate, Profit Factor, Expectancy, avg_win, avg_loss,
      max_loss, max_win, gross_profit, gross_loss

Delta analysis:
  * NO_COST → BASE_COST  (pf_delta, exp_delta)
  * BASE_COST → STRESS_COST (pf_delta, exp_delta)
  * Verdict: Edge survives if PF(scenario) >= 1.0

Rules:
  - READ-ONLY on DB (mode=ro URI).
  - Dataset MD5 (zip snapshot): 0947bdf6c2eff1a75ff8af6c3e576ed8
  - engine: python3 + sqlite3.

Output: scripts/audit_phase2_commission.json
"""
from __future__ import annotations

import json
import math
import os
import sqlite3
import hashlib
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Paths & constants
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
DB_PATH = ROOT / "db" / "predictions.db"
DATA_ZIP = ROOT / "data" / "active_databases_20260817_full.zip"
OUT_PATH = ROOT / "scripts" / "audit_phase2_commission.json"

EXPECTED_ZIP_MD5 = "0947bdf6c2eff1a75ff8af6c3e576ed8"
HARD_CAP = 50.0
MAX_RETURN_RATIO = 5.0  # exit/entry sanity (matches PHASE 0.4)

# Scenario definitions: (commission_round_trip, slippage_round_trip) in percent
SCENARIOS: Dict[str, Dict[str, float]] = {
    "NO_COST":     {"commission_rt_pct": 0.00, "slippage_rt_pct": 0.00},
    "BASE_COST":   {"commission_rt_pct": 0.30, "slippage_rt_pct": 0.10},
    "STRESS_COST": {"commission_rt_pct": 0.50, "slippage_rt_pct": 0.30},
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def md5_file(path: Path) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def connect_ro(path: Path) -> sqlite3.Connection:
    if not path.exists():
        raise FileNotFoundError(path)
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True)


# ---------------------------------------------------------------------------
# Raw trade extraction (identical to PHASE 0.4 baseline)
# ---------------------------------------------------------------------------
def load_predictions(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    """Load predictions with channel + price columns.

    Returns the list of rows (dicts). No filtering / capping yet.
    """
    cur = conn.execute(
        """
        SELECT id, ticker, prediction_date, market, persona, morning_bell, status,
               entry_price, target_price, stop_loss,
               exit_price, actual_exit_price, actual_return,
               hit_target, hit_stop
        FROM predictions
        ORDER BY id ASC
        """
    )
    rows = []
    cols = [d[0] for d in cur.description]
    for r in cur.fetchall():
        rows.append(dict(zip(cols, r)))
    return rows


def apply_quality_filter(rows: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """Apply quality filter (entry>0, ticker clean, market known).

    Returns (kept_rows, exclusion_breakdown).
    """
    kept: List[Dict[str, Any]] = []
    excl: Dict[str, int] = {
        "entry_price_zero": 0,
        "ticker_invalid": 0,
        "market_unknown": 0,
    }
    for r in rows:
        ticker = str(r.get("ticker") or "").strip().upper()
        market = str(r.get("market") or "UNKNOWN").upper()
        entry = _float(r.get("entry_price"))

        if not entry or entry <= 0:
            excl["entry_price_zero"] += 1
            continue
        if not ticker or " " in ticker or len(ticker) > 12:
            excl["ticker_invalid"] += 1
            continue
        if not market or market == "UNKNOWN":
            excl["market_unknown"] += 1
            continue
        kept.append(r)
    return kept, excl


def apply_dedup(rows: List[Dict[str, Any]]) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    """Dedup on (ticker, prediction_date, morning_bell, ROUND(entry_price,6)).

    Keeps the LOWEST id per key (preserves channel separation).
    """
    seen: Dict[Tuple, int] = {}
    for r in rows:
        key = (
            str(r.get("ticker") or "").strip().upper(),
            str(r.get("prediction_date") or ""),
            int(r.get("morning_bell") or 0),
            round(_float(r.get("entry_price")) or 0.0, 6),
        )
        rid = int(r.get("id"))
        if key not in seen or rid < seen[key]:
            # We need to keep the row itself; first pass: record lowest id per key
            seen[key] = rid

    kept: List[Dict[str, Any]] = []
    removed = 0
    for r in rows:
        key = (
            str(r.get("ticker") or "").strip().upper(),
            str(r.get("prediction_date") or ""),
            int(r.get("morning_bell") or 0),
            round(_float(r.get("entry_price")) or 0.0, 6),
        )
        if int(r.get("id")) == seen[key]:
            kept.append(r)
        else:
            removed += 1
    return kept, {"dedup_removed": removed, "dedup_keys": len(seen)}


def compute_raw_return(row: Dict[str, Any]) -> Tuple[Optional[float], Optional[str]]:
    """Compute raw return (%) for a predictions-table row.

    Same priority as PHASE 0.4 BACKTEST-FULL-001:
      1. actual_return field
      2. exit_price (or actual_exit_price)
      3. hit_target=1 -> (target-entry)/entry*100
      4. hit_stop=1   -> (stop-entry)/entry*100
      5. expired no hit -> None (no fabrication)

    Returns (raw_return_pct_or_None, exit_used_or_None_or_None).
    """
    entry = _float(row.get("entry_price"))
    target = _float(row.get("target_price"))
    stop = _float(row.get("stop_loss"))
    exit_price = _float(row.get("exit_price")) or _float(row.get("actual_exit_price"))
    actual_return_field = _float(row.get("actual_return"))
    hit_target = int(row.get("hit_target") or 0)
    hit_stop = int(row.get("hit_stop") or 0)

    raw_ret = None
    exit_used = None

    if actual_return_field is not None:
        raw_ret = actual_return_field
        exit_used = entry * (1 + raw_ret / 100) if entry else None
    if raw_ret is None and exit_price and exit_price > 0:
        raw_ret = ((exit_price - entry) / entry) * 100
        exit_used = exit_price
    if raw_ret is None and hit_target == 1 and target and target > 0:
        raw_ret = ((target - entry) / entry) * 100
        exit_used = target
    if raw_ret is None and hit_stop == 1 and stop and stop > 0:
        raw_ret = ((stop - entry) / entry) * 100
        exit_used = stop
    return raw_ret, exit_used


# ---------------------------------------------------------------------------
# KPI engine
# ---------------------------------------------------------------------------
def compute_kpis(adjusted_returns: List[float]) -> Dict[str, Any]:
    """Compute KPIs from a list of *already cost-adjusted* returns (%).

    HARD cap: ABS(adjusted_return) <= HARD_CAP (50).
    """
    # HARD cap
    capped = [max(-HARD_CAP, min(HARD_CAP, r)) for r in adjusted_returns]
    n = len(capped)

    if n == 0:
        return {
            "n_valid": 0,
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "expectancy": 0.0,
            "avg_win": 0.0,
            "avg_loss": 0.0,
            "max_loss": 0.0,
            "max_win": 0.0,
            "gross_profit": 0.0,
            "gross_loss": 0.0,
            "n_wins": 0,
            "n_losses": 0,
            "hard_capped_count": 0,
        }

    wins = [r for r in capped if r > 0]
    losses = [r for r in capped if r < 0]

    gross_profit = sum(wins)
    gross_loss_amount = sum(abs(r) for r in losses)
    if gross_loss_amount > 0:
        pf = gross_profit / gross_loss_amount
    elif gross_profit > 0:
        pf = float("inf")
    else:
        pf = 0.0

    avg_win = gross_profit / len(wins) if wins else 0.0
    avg_loss = -(gross_loss_amount / len(losses)) if losses else 0.0
    expectancy = sum(capped) / n
    max_loss = min(losses) if losses else 0.0
    max_win = max(wins) if wins else 0.0
    hard_capped = sum(1 for r in adjusted_returns if abs(r) > HARD_CAP)

    return {
        "n_valid": n,
        "win_rate": round((len(wins) / n) * 100, 4),
        "profit_factor": round(pf, 4) if pf != float("inf") else None,
        "expectancy": round(expectancy, 4),
        "avg_win": round(avg_win, 4),
        "avg_loss": round(avg_loss, 4),
        "max_loss": round(max_loss, 4),
        "max_win": round(max_win, 4),
        "gross_profit": round(gross_profit, 4),
        "gross_loss": round(gross_loss_amount, 4),
        "n_wins": len(wins),
        "n_losses": len(losses),
        "hard_capped_count": hard_capped,
    }


# ---------------------------------------------------------------------------
# Per-scenario runner
# ---------------------------------------------------------------------------
def run_scenario(qualifying_rows: List[Dict[str, Any]],
                 commission_rt: float, slippage_rt: float) -> Dict[str, Any]:
    """For each scenario, compute adjusted_return = raw_ret - total_cost_pct
    and KPIs per slice (all / balanced / morning_bell).
    """
    total_cost_pct = commission_rt + slippage_rt

    per_slice: Dict[str, List[float]] = {"all": [], "balanced": [], "morning_bell": []}
    n_no_return = 0  # expired no hit (no fabricated return)
    n_unrealistic_exit = 0  # |exit/entry| > MAX_RETURN_RATIO

    for r in qualifying_rows:
        raw_ret, exit_used = compute_raw_return(r)
        if raw_ret is None:
            n_no_return += 1
            continue
        if exit_used:
            entry = _float(r.get("entry_price")) or 0.0
            if entry > 0 and abs(exit_used / entry) > MAX_RETURN_RATIO:
                n_unrealistic_exit += 1
                continue
        adjusted = raw_ret - total_cost_pct
        per_slice["all"].append(adjusted)
        if int(r.get("morning_bell") or 0) == 1:
            per_slice["morning_bell"].append(adjusted)
        else:
            per_slice["balanced"].append(adjusted)

    return {
        "commission_rt_pct": commission_rt,
        "slippage_rt_pct": slippage_rt,
        "total_cost_pct": round(total_cost_pct, 4),
        "n_no_return_expired": n_no_return,
        "n_unrealistic_exit": n_unrealistic_exit,
        "all": compute_kpis(per_slice["all"]),
        "balanced": compute_kpis(per_slice["balanced"]),
        "morning_bell": compute_kpis(per_slice["morning_bell"]),
    }


# ---------------------------------------------------------------------------
# Delta analysis
# ---------------------------------------------------------------------------
def safe_delta(a: Optional[float], b: Optional[float]) -> Optional[float]:
    if a is None or b is None:
        return None
    return round(a - b, 4)


def delta(scenario_a: Dict[str, Any], scenario_b: Dict[str, Any]) -> Dict[str, Any]:
    """Compute PF and Expectancy deltas between scenario A and B (A -> B).

    Top-level pf_delta / exp_delta correspond to the 'all' slice (per the
    user's spec), with per-slice breakdown included for completeness.
    """
    out: Dict[str, Any] = {}
    for slice_ in ("all", "balanced", "morning_bell"):
        k_a = scenario_a[slice_]
        k_b = scenario_b[slice_]
        out[slice_] = {
            "pf_delta": safe_delta(k_b.get("profit_factor"), k_a.get("profit_factor")),
            "exp_delta": safe_delta(k_b.get("expectancy"), k_a.get("expectancy")),
            "wr_delta": safe_delta(k_b.get("win_rate"), k_a.get("win_rate")),
        }
    # Top-level (per user spec) = "all" slice deltas
    out["pf_delta"] = out["all"]["pf_delta"]
    out["exp_delta"] = out["all"]["exp_delta"]
    out["wr_delta"] = out["all"]["wr_delta"]
    return out


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    zip_md5 = md5_file(DATA_ZIP) if DATA_ZIP.exists() else "MISSING"
    db_md5 = md5_file(DB_PATH)

    conn = connect_ro(DB_PATH)
    try:
        raw_rows = load_predictions(conn)
    finally:
        conn.close()

    n_raw = len(raw_rows)

    # quality filter
    filtered, excl_breakdown = apply_quality_filter(raw_rows)
    # dedup
    deduped, dedup_meta = apply_dedup(filtered)

    qualifying = deduped

    # Per scenario
    scenarios_out: Dict[str, Any] = {}
    for name, params in SCENARIOS.items():
        scenarios_out[name] = run_scenario(
            qualifying,
            commission_rt=params["commission_rt_pct"],
            slippage_rt=params["slippage_rt_pct"],
        )

    # Deltas
    deltas = {
        "NO_COST_to_BASE_COST": delta(scenarios_out["NO_COST"], scenarios_out["BASE_COST"]),
        "BASE_COST_to_STRESS_COST": delta(scenarios_out["BASE_COST"], scenarios_out["STRESS_COST"]),
        "NO_COST_to_STRESS_COST": delta(scenarios_out["NO_COST"], scenarios_out["STRESS_COST"]),
    }

    # Verdict: edge survives BASE_COST / STRESS_COST?
    verdict = {
        "edge_survives_base_cost": {
            "all": (scenarios_out["BASE_COST"]["all"].get("profit_factor") or 0) >= 1.0,
            "balanced": (scenarios_out["BASE_COST"]["balanced"].get("profit_factor") or 0) >= 1.0,
            "morning_bell": (scenarios_out["BASE_COST"]["morning_bell"].get("profit_factor") or 0) >= 1.0,
        },
        "edge_survives_stress_cost": {
            "all": (scenarios_out["STRESS_COST"]["all"].get("profit_factor") or 0) >= 1.0,
            "balanced": (scenarios_out["STRESS_COST"]["balanced"].get("profit_factor") or 0) >= 1.0,
            "morning_bell": (scenarios_out["STRESS_COST"]["morning_bell"].get("profit_factor") or 0) >= 1.0,
        },
    }

    # NEXT_PHASE_ALLOWED: edge survives BASE_COST on the "all" slice
    # (this is the minimum bar — if even BASE_COST kills PF<1.0 on aggregate,
    #  the strategy is not robust to realistic EGX costs).
    next_phase_allowed = bool(verdict["edge_survives_base_cost"]["all"])

    report = {
        "audit": "PHASE-2.2+2.3-Commission-Slippage",
        "engine": "python3 + sqlite3 (READ-ONLY URI)",
        "audit_timestamp_utc": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat().replace("+00:00", "Z"),
        "dataset_zip": str(DATA_ZIP),
        "dataset_md5_expected": EXPECTED_ZIP_MD5,
        "dataset_md5_observed": zip_md5,
        "dataset_md5_match": zip_md5 == EXPECTED_ZIP_MD5,
        "db_path": str(DB_PATH),
        "db_md5": db_md5,
        "rules": {
            "hard_cap_abs_return": HARD_CAP,
            "max_return_ratio": MAX_RETURN_RATIO,
            "return_formula": "actual_return | exit_price | hit_target=(t-e)/e*100 | hit_stop=(s-e)/e*100 | expired=None",
            "adjusted_return_formula": "raw_return - (commission_round_trip_pct + slippage_round_trip_pct)",
            "dedup_key": "(ticker, prediction_date, morning_bell, ROUND(entry_price,6)) -> lowest id",
        },
        "scenarios_def": SCENARIOS,
        "filter_pipeline": {
            "n_raw": n_raw,
            "exclusion_breakdown": excl_breakdown,
            "dedup_meta": dedup_meta,
            "n_after_quality_filter": len(filtered),
            "n_after_dedup": len(deduped),
            "n_qualifying_for_kpi": len(qualifying),
        },
        "scenarios": scenarios_out,
        "delta": deltas,
        "verdict": verdict,
        "next_phase_allowed": next_phase_allowed,
    }

    OUT_PATH.write_text(json.dumps(report, indent=2, ensure_ascii=False, default=str))
    print(f"[OK] Wrote {OUT_PATH}")
    print(f"Dataset ZIP md5: {zip_md5} (expected: {EXPECTED_ZIP_MD5}) match={zip_md5 == EXPECTED_ZIP_MD5}")
    print(f"DB md5:          {db_md5}")
    print(f"n_raw={n_raw} | after quality={len(filtered)} | after dedup={len(deduped)}")
    print()
    for name in SCENARIOS:
        s = scenarios_out[name]
        print(f"=== {name} (total_cost={s['total_cost_pct']}%) ===")
        for slice_ in ("all", "balanced", "morning_bell"):
            k = s[slice_]
            pf = k.get("profit_factor")
            pf_str = f"{pf:.4f}" if isinstance(pf, (int, float)) else "inf"
            print(f"  {slice_:>12}: n={k['n_valid']:>3} WR={k['win_rate']:>6.2f}%  PF={pf_str:>7}  "
                  f"Exp={k['expectancy']:>7.4f}  avg_win={k['avg_win']:>7.4f}  "
                  f"avg_loss={k['avg_loss']:>7.4f}  max_loss={k['max_loss']:>7.4f}  "
                  f"max_win={k['max_win']:>7.4f}")
        print()
    print("=== Deltas ===")
    for d_name, d_val in deltas.items():
        print(f"  {d_name}:")
        for slice_ in ("all", "balanced", "morning_bell"):
            v = d_val[slice_]
            print(f"    {slice_:>12}: pf_delta={v['pf_delta']!s:>8}  exp_delta={v['exp_delta']!s:>8}")
    print()
    print(f"Edge survives BASE_COST   (all): {verdict['edge_survives_base_cost']['all']}")
    print(f"Edge survives STRESS_COST (all): {verdict['edge_survives_stress_cost']['all']}")
    print(f"NEXT_PHASE_ALLOWED = {next_phase_allowed}")


if __name__ == "__main__":
    main()
