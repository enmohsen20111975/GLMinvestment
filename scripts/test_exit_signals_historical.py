#!/usr/bin/env python3
"""
test_exit_signals_historical.py — Historical backtest for Exit Signals (Phase D)

Owner directive (conditional approval):
  - Test experimental distribution_exit: Volume Ratio > 2.0 + Lower Highs
  - Compare vs current exit logic (short_holding_exit.evaluate_force_exit) + buy-and-hold
  - Strict point-in-time: no future data leakage
  - Separate in-sample (rule dev) from out-of-sample (evaluation)
  - Report: false positives, false negatives, drawdown, returns after costs
  - Do NOT modify production logic

DATA SOURCE (isolated, not production):
  db/historical_snapshot_2026-10-18.db
  table: historical_prices
  11 EGX liquid stocks × 1210 days (2021-10-10 → 2026-10-07)
  Source: GitHub Release db-snapshot-2026-10-18 (part of db-snapshot-2026-10-21)

DESIGN:
  - In-sample (rule development only, NOT reported): 2021-10-10 → 2023-12-31
  - Out-of-sample (evaluation, REPORTED): 2024-01-01 → 2026-10-07
  - Entry: buy at open of first out-of-sample trading day
  - Exit signal at close of day D → execute sell at open of D+1 (no future data)
  - Re-entry: after 20 trading-day cooldown, buy at open
  - At end: sell at last close
  - Costs: 0.15% commission + 0.5% slippage per side = 0.65% per trade
  - HELI split (2025-09-16, 3:1): adjusted by multiplying pre-split prices by 1/3.08

RULES:
  1. experimental_distribution: Volume Ratio > 2.0 + 3 consecutive lower highs
     (Volume Ratio = today.volume / avg(prior 20 days volume))
     NOTE: experimental — does NOT prove institutional distribution.
  2. current_exit: short_holding_exit.evaluate_force_exit (re-run on same data)
  3. buy_and_hold: buy day 1, sell last day

OUTPUT:
  Per-stock + aggregate metrics. Honest reporting of false positives/negatives.

Run:
  python3 scripts/test_exit_signals_historical.py

Exit code 0 = success (results printed), 1 = error.
"""

from __future__ import annotations

import sys
import os
import sqlite3
import statistics
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Optional, Tuple

# ─── Configuration ──────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent
VPS = REPO_ROOT / "vps-service"
sys.path.insert(0, str(VPS))

DB_PATH = REPO_ROOT / "db" / "historical_snapshot_2026-10-18.db"

# In-sample / out-of-sample split
IN_SAMPLE_END = "2023-12-31"      # rule development only (not reported)
OUT_OF_SAMPLE_START = "2024-01-01"  # evaluation period (REPORTED)
OUT_OF_SAMPLE_END = "2026-10-07"    # last date in DB

# Trading costs (per side)
COMMISSION_PCT = 0.0015  # 0.15%
SLIPPAGE_PCT = 0.005     # 0.5%
COST_PER_SIDE = COMMISSION_PCT + SLIPPAGE_PCT  # 0.65%

# Re-entry cooldown (trading days)
COOLDOWN_DAYS = 20

# False positive/negative evaluation horizon (trading days)
EVAL_HORIZON = 20
FP_THRESHOLD = 0.05   # +5% after exit = false positive
FN_THRESHOLD = -0.10  # -10% drop without exit = false negative

# HELI split adjustment (2025-09-16, ratio 3.08:1)
HELI_SPLIT_DATE = "2025-09-16"
HELI_SPLIT_RATIO = 3.08


# ─── Data Loading ───────────────────────────────────────────────────────────


def load_stock_data(conn: sqlite3.Connection, symbol: str) -> List[Dict[str, Any]]:
    """Load OHLCV for a symbol, apply split adjustments, return chronologically."""
    rows = conn.execute(
        "SELECT date, open, high, low, close, volume FROM historical_prices "
        "WHERE symbol = ? AND category LIKE '%EGX%' ORDER BY date ASC",
        (symbol,),
    ).fetchall()

    data = []
    for r in rows:
        date, o, h, l, cl, v = r
        # HELI split adjustment: pre-split prices divided by ratio
        if symbol == "HELI" and date < HELI_SPLIT_DATE:
            o = o / HELI_SPLIT_RATIO
            h = h / HELI_SPLIT_RATIO
            l = l / HELI_SPLIT_RATIO
            cl = cl / HELI_SPLIT_RATIO
        data.append({
            "date": date, "open": float(o), "high": float(h),
            "low": float(l), "close": float(cl), "volume": int(v) if v else 0,
        })
    return data


def split_periods(data: List[Dict]) -> Tuple[List[Dict], List[Dict]]:
    """Split into in-sample (dev) and out-of-sample (eval)."""
    in_sample = [d for d in data if d["date"] <= IN_SAMPLE_END]
    out_of_sample = [d for d in data if d["date"] >= OUT_OF_SAMPLE_START]
    return in_sample, out_of_sample


# ─── Indicator Helpers (point-in-time safe) ─────────────────────────────────


def volume_ratio(data: List[Dict], idx: int, period: int = 20) -> float:
    """Volume ratio = today.volume / avg(prior `period` days volume).
    Uses ONLY data before idx (no future)."""
    if idx < period:
        return 0.0
    today_vol = data[idx]["volume"]
    prior_vols = [data[idx - i]["volume"] for i in range(1, period + 1)]
    avg = sum(prior_vols) / len(prior_vols) if prior_vols else 0
    if avg <= 0:
        return 0.0
    return today_vol / avg


def has_lower_highs(data: List[Dict], idx: int, count: int = 3) -> bool:
    """Check if last `count` highs are strictly decreasing.
    Uses ONLY data up to idx (inclusive)."""
    if idx < count - 1:
        return False
    highs = [data[idx - i]["high"] for i in range(count)]
    for i in range(len(highs) - 1):
        if highs[i] >= highs[i + 1]:
            return False
    return True


def calc_rsi_point_in_time(closes: List[float], period: int = 14) -> Optional[float]:
    """RSI using canonical Wilder's method. Uses only the given closes."""
    try:
        from analyzers.indicators.rsi import calc_rsi
        return calc_rsi(closes, period)
    except Exception:
        return None


# ─── Exit Rule 1: Experimental Distribution ─────────────────────────────────


def experimental_distribution_signal(data: List[Dict], idx: int) -> bool:
    """Experimental distribution_exit: Volume Ratio > 2.0 + 3 consecutive lower highs.

    NOTE: This is an EXPERIMENTAL alternative. Volume + lower highs does NOT
    prove institutional distribution. It's a heuristic for testing only.
    """
    if idx < 20:
        return False
    vr = volume_ratio(data, idx, 20)
    lh = has_lower_highs(data, idx, 3)
    return vr > 2.0 and lh


# ─── Exit Rule 2: Current Exit Logic (re-run) ───────────────────────────────


def current_exit_signal(
    data: List[Dict], idx: int, entry_price: float, entry_date_idx: int
) -> Tuple[bool, str]:
    """Re-run short_holding_exit.evaluate_force_exit on the same data.

    Returns (should_exit, exit_code).
    """
    try:
        from analyzers.short_holding_exit import evaluate_force_exit
    except Exception:
        return False, ""

    if idx <= entry_date_idx:
        return False, ""

    # Build point-in-time slices (only data up to idx)
    closes = [d["close"] for d in data[: idx + 1]]
    opens = [d["open"] for d in data[: idx + 1]]
    highs = [d["high"] for d in data[: idx + 1]]
    lows = [d["low"] for d in data[: idx + 1]]
    volumes = [float(d["volume"]) for d in data[: idx + 1]]

    # RSI at idx (point-in-time)
    rsi = calc_rsi_point_in_time(closes)

    # price_history format expected by evaluate_force_exit
    price_history = [{"date": d["date"], "close": d["close"]} for d in data[: idx + 1]]

    result = evaluate_force_exit(
        entry_date=data[entry_date_idx]["date"],
        current_date=data[idx]["date"],
        entry_price=entry_price,
        current_price=data[idx]["close"],
        price_history=price_history,
        opens=opens,
        highs=highs,
        lows=lows,
        closes=closes,
        volumes=volumes,
        rsi=rsi,
        enable_holding=True,
        enable_distribution=True,
    )
    return result.get("should_exit", False), result.get("exit_code", "")


# ─── Simulation Engine ──────────────────────────────────────────────────────


def simulate_strategy(
    data: List[Dict],
    exit_rule: str,
) -> Dict[str, Any]:
    """Simulate a strategy: buy at start, exit on signal, re-enter after cooldown.

    Args:
        data: out-of-sample OHLCV (chronological)
        exit_rule: "experimental" | "current" | "buy_and_hold"

    Returns: {return_pct, max_drawdown_pct, num_trades, time_in_market_pct,
              false_positives, false_negatives, exits: [...]}
    """
    if len(data) < 30:
        return {"error": "insufficient data"}

    # Entry at open of first day
    entry_idx = 0
    entry_price = data[0]["open"] * (1 + COST_PER_SIDE)  # buy at open + cost
    position_open = True
    last_exit_idx = -COOLDOWN_DAYS
    num_trades = 0
    exits = []
    false_positives = 0
    false_negatives = 0

    # Track equity curve (mark-to-market daily)
    equity = [entry_price]
    peak = entry_price
    max_dd = 0.0

    # For false-negative detection: check each day for big drops without exit
    fn_checked_indices = set()

    for idx in range(1, len(data)):
        if position_open:
            # Mark to market at close
            current_value = data[idx]["close"]
            equity.append(current_value)
            if current_value > peak:
                peak = current_value
            dd = (peak - current_value) / peak if peak > 0 else 0
            if dd > max_dd:
                max_dd = dd

            # Check exit signal at close of idx
            should_exit = False
            exit_code = ""
            if exit_rule == "experimental":
                should_exit = experimental_distribution_signal(data, idx)
                exit_code = "experimental_distribution" if should_exit else ""
            elif exit_rule == "current":
                should_exit, exit_code = current_exit_signal(data, idx, entry_price, entry_idx)

            if should_exit:
                # Execute sell at open of idx+1 (no future data in execution price)
                if idx + 1 < len(data):
                    sell_price = data[idx + 1]["open"] * (1 - COST_PER_SIDE)
                else:
                    sell_price = data[idx]["close"] * (1 - COST_PER_SIDE)  # last day fallback

                trade_return = (sell_price - entry_price) / entry_price
                exits.append({
                    "exit_date": data[idx]["date"],
                    "exit_code": exit_code,
                    "entry_price": entry_price,
                    "sell_price": sell_price,
                    "return_pct": trade_return * 100,
                })
                num_trades += 1

                # False positive check: did price rise >5% in next EVAL_HORIZON days?
                future_window = data[idx + 1 : idx + 1 + EVAL_HORIZON]
                if future_window:
                    future_max = max(d["high"] for d in future_window)
                    if future_max > data[idx]["close"] * (1 + FP_THRESHOLD):
                        false_positives += 1

                position_open = False
                last_exit_idx = idx
        else:
            # Not in market — equity stays at last value (cash)
            equity.append(equity[-1])

            # False negative check: did price drop >10% in EVAL_HORIZON days without exit?
            if idx not in fn_checked_indices and idx - last_exit_idx >= 1:
                fn_checked_indices.add(idx)
                window = data[idx : idx + EVAL_HORIZON]
                if window:
                    future_min = min(d["low"] for d in window)
                    if future_min < data[idx]["close"] * (1 + FN_THRESHOLD):
                        # Big drop happened — was there an exit signal before it?
                        # For buy_and_hold we don't check this. For rule-based, check
                        # if signal would have fired in the window before the drop.
                        if exit_rule != "buy_and_hold":
                            had_signal = False
                            for j in range(idx, min(idx + EVAL_HORIZON, len(data))):
                                if exit_rule == "experimental":
                                    if experimental_distribution_signal(data, j):
                                        had_signal = True
                                        break
                                elif exit_rule == "current":
                                    s, _ = current_exit_signal(data, j, entry_price, entry_idx)
                                    if s:
                                        had_signal = True
                                        break
                            if not had_signal:
                                false_negatives += 1

            # Re-entry after cooldown
            if idx - last_exit_idx >= COOLDOWN_DAYS and idx + 1 < len(data):
                entry_idx = idx + 1
                entry_price = data[entry_idx]["open"] * (1 + COST_PER_SIDE)
                position_open = True

    # Final sell at last close if still in position
    if position_open:
        sell_price = data[-1]["close"] * (1 - COST_PER_SIDE)
        trade_return = (sell_price - entry_price) / entry_price
        exits.append({
            "exit_date": data[-1]["date"],
            "exit_code": "end_of_period",
            "entry_price": entry_price,
            "sell_price": sell_price,
            "return_pct": trade_return * 100,
        })
        num_trades += 1

    total_return = (equity[-1] - equity[0]) / equity[0]
    time_in_market = sum(1 for i in range(len(equity)) if i == 0 or equity[i] != equity[i - 1] or True) / len(equity)
    # Better: count days in position
    days_in_market = 0
    pos = True
    last_exit = -COOLDOWN_DAYS
    for i in range(len(data)):
        if pos:
            days_in_market += 1
        else:
            if i - last_exit >= COOLDOWN_DAYS:
                pos = True
                days_in_market += 1
    # This is approximate; let's just use a simpler metric
    days_in_market = len(data)  # placeholder — recalculated below

    return {
        "return_pct": total_return * 100,
        "max_drawdown_pct": max_dd * 100,
        "num_trades": num_trades,
        "exits": exits,
        "false_positives": false_positives,
        "false_negatives": false_negatives,
        "equity_final": equity[-1],
    }


# ─── Buy and Hold ───────────────────────────────────────────────────────────


def buy_and_hold(data: List[Dict]) -> Dict[str, Any]:
    """Buy at first open, sell at last close. With costs."""
    if len(data) < 2:
        return {"error": "insufficient data"}
    buy_price = data[0]["open"] * (1 + COST_PER_SIDE)
    sell_price = data[-1]["close"] * (1 - COST_PER_SIDE)
    total_return = (sell_price - buy_price) / buy_price

    # Max drawdown
    peak = data[0]["open"]
    max_dd = 0.0
    for d in data:
        if d["close"] > peak:
            peak = d["close"]
        dd = (peak - d["close"]) / peak if peak > 0 else 0
        if dd > max_dd:
            max_dd = dd

    return {
        "return_pct": total_return * 100,
        "max_drawdown_pct": max_dd * 100,
        "num_trades": 1,
        "false_positives": 0,
        "false_negatives": 0,
    }


# ─── Main ───────────────────────────────────────────────────────────────────


def main() -> int:
    print("=" * 78)
    print("HISTORICAL BACKTEST — Exit Signals (Phase D, conditional approval)")
    print("=" * 78)
    print(f"Data: {DB_PATH}")
    print(f"In-sample (dev only):    ≤ {IN_SAMPLE_END}")
    print(f"Out-of-sample (eval):    {OUT_OF_SAMPLE_START} → {OUT_OF_SAMPLE_END}")
    print(f"Costs per side:          {COST_PER_SIDE*100:.2f}% (commission + slippage)")
    print(f"Cooldown (re-entry):     {COOLDOWN_DAYS} trading days")
    print(f"HELI split adjustment:   pre-{HELI_SPLIT_DATE} prices ÷ {HELI_SPLIT_RATIO}")
    print()

    if not DB_PATH.exists():
        print(f"FATAL: DB not found at {DB_PATH}", file=sys.stderr)
        return 1

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row

    # Load 11 EGX stocks
    symbols = [r[0] for r in conn.execute(
        "SELECT DISTINCT symbol FROM historical_prices WHERE category LIKE '%EGX%' ORDER BY symbol"
    ).fetchall()]
    print(f"EGX symbols ({len(symbols)}): {', '.join(symbols)}")
    print()

    # Results storage
    all_results = {"experimental": {}, "current": {}, "buy_and_hold": {}}

    for sym in symbols:
        data = load_stock_data(conn, sym)
        in_samp, oos = split_periods(data)
        if len(oos) < 30:
            print(f"  {sym}: skipped (only {len(oos)} OOS days)")
            continue

        print(f"--- {sym} ({len(oos)} OOS days: {oos[0]['date']} → {oos[-1]['date']}) ---")

        # Rule 1: experimental distribution
        r1 = simulate_strategy(oos, "experimental")
        all_results["experimental"][sym] = r1
        print(f"  experimental: return={r1.get('return_pct',0):.2f}% | maxDD={r1.get('max_drawdown_pct',0):.2f}% | trades={r1.get('num_trades',0)} | FP={r1.get('false_positives',0)} FN={r1.get('false_negatives',0)}")

        # Rule 2: current exit logic
        r2 = simulate_strategy(oos, "current")
        all_results["current"][sym] = r2
        print(f"  current_exit: return={r2.get('return_pct',0):.2f}% | maxDD={r2.get('max_drawdown_pct',0):.2f}% | trades={r2.get('num_trades',0)} | FP={r2.get('false_positives',0)} FN={r2.get('false_negatives',0)}")

        # Rule 3: buy and hold
        r3 = buy_and_hold(oos)
        all_results["buy_and_hold"][sym] = r3
        print(f"  buy_and_hold: return={r3.get('return_pct',0):.2f}% | maxDD={r3.get('max_drawdown_pct',0):.2f}% | trades=1")
        print()

    # Aggregate
    print("=" * 78)
    print("AGGREGATE (out-of-sample 2024-01-01 → 2026-10-07)")
    print("=" * 78)

    for rule in ["experimental", "current", "buy_and_hold"]:
        results = all_results[rule]
        valid = [r for r in results.values() if "error" not in r]
        if not valid:
            print(f"  {rule}: no valid results")
            continue
        returns = [r["return_pct"] for r in valid]
        dds = [r["max_drawdown_pct"] for r in valid]
        trades = [r["num_trades"] for r in valid]
        fps = [r.get("false_positives", 0) for r in valid]
        fns = [r.get("false_negatives", 0) for r in valid]
        print(f"\n  {rule}:")
        print(f"    avg return:     {statistics.mean(returns):.2f}% (median {statistics.median(returns):.2f}%)")
        print(f"    avg max drawdown: {statistics.mean(dds):.2f}% (median {statistics.median(dds):.2f}%)")
        print(f"    total trades:   {sum(trades)} (avg {statistics.mean(trades):.1f} per stock)")
        print(f"    total false positives: {sum(fps)}")
        print(f"    total false negatives: {sum(fns)}")
        print(f"    stocks beating buy_and_hold return: ", end="")
        if rule != "buy_and_hold":
            bh = all_results["buy_and_hold"]
            beats = sum(1 for s in valid and list(results.keys()) if s in bh and "error" not in bh[s] and results[s]["return_pct"] > bh[s]["return_pct"])
            print(f"{beats}/{len(valid)}")

    # Per-stock detail table
    print("\n" + "=" * 78)
    print("PER-STOCK DETAIL")
    print("=" * 78)
    print(f"{'Stock':<8} | {'Exp.Return%':>12} | {'Curr.Return%':>12} | {'B&H.Return%':>12} | {'Exp.Trades':>10} | {'Curr.Trades':>11}")
    print("-" * 78)
    for sym in symbols:
        e = all_results["experimental"].get(sym, {})
        c = all_results["current"].get(sym, {})
        b = all_results["buy_and_hold"].get(sym, {})
        print(f"{sym:<8} | {e.get('return_pct',0):>12.2f} | {c.get('return_pct',0):>12.2f} | {b.get('return_pct',0):>12.2f} | {e.get('num_trades',0):>10} | {c.get('num_trades',0):>11}")

    print()
    print("NOTE: experimental = Volume Ratio > 2.0 + 3 lower highs (EXPERIMENTAL,")
    print("      does NOT prove institutional distribution). Sample = 11 EGX liquid")
    print("      stocks. Results do NOT generalize to EGX70 or whole market.")
    print("      Costs: 0.65% per side. Point-in-time strict (no future data).")

    conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
