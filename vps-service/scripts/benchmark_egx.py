#!/usr/bin/env python3
"""
Buy-and-Hold Benchmark for EGX 19 Stocks
==========================================
Calculates equal-weighted Buy-and-Hold returns for the same periods
as the walk-forward backtest, enabling a direct strategy vs benchmark comparison.
"""

import sqlite3
from pathlib import Path
from datetime import datetime

# ─────────────────────────── PATHS ───────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = str(PROJECT_ROOT / "db" / "price_history.db")

# ─────────────────────────── EGX TICKERS ─────────────────────

EGX_TICKERS = [
    "ALCN", "AMOC", "BTFH", "CCAP", "COMI", "EGTS", "EKHO", "EMFD",
    "ETEL", "FWRY", "HRHO", "ISPH", "OCDI", "ORAS", "PHDC", "RMDA",
    "SKPC", "SWDY", "TMGH",
]

# ─────────────────────── WALK-FORWARD WINDOWS ────────────────

WINDOWS = [
    {"id": 1, "test_start": "2023-07-01", "test_end": "2023-12-31", "label": "H2 2023"},
    {"id": 2, "test_start": "2024-01-01", "test_end": "2024-06-30", "label": "H1 2024"},
    {"id": 3, "test_start": "2024-07-01", "test_end": "2024-12-31", "label": "H2 2024"},
    {"id": 4, "test_start": "2025-01-01", "test_end": "2025-06-30", "label": "H1 2025"},
    {"id": 5, "test_start": "2025-04-01", "test_end": "2025-06-30", "label": "Q2 2025"},
]

TOTAL_PERIOD = {"start": "2023-07-01", "end": "2025-06-30", "label": "2y"}

# ──────────────────── STRATEGY RETURNS (from walk-forward) ───

STRATEGY_RETURNS = {
    1:  40.5,
    2:  -1.2,
    3:  -1.8,
    4:   4.5,
    5:   3.1,
}
STRATEGY_TOTAL = 46.8

# ─────────────────────── HELPER FUNCTIONS ────────────────────

def get_price_on_or_after(cursor, ticker, target_date):
    """Get the close price on or after the given date (first trading day)."""
    cursor.execute(
        "SELECT close_price FROM price_history "
        "WHERE ticker = ? AND date >= ? AND close_price > 0 "
        "ORDER BY date ASC LIMIT 1",
        (ticker, target_date)
    )
    row = cursor.fetchone()
    return row[0] if row else None


def get_price_on_or_before(cursor, ticker, target_date):
    """Get the close price on or before the given date (last trading day)."""
    cursor.execute(
        "SELECT close_price FROM price_history "
        "WHERE ticker = ? AND date <= ? AND close_price > 0 "
        "ORDER BY date DESC LIMIT 1",
        (ticker, target_date)
    )
    row = cursor.fetchone()
    return row[0] if row else None


def calc_return(cursor, ticker, start_date, end_date):
    """Calculate total return for a single ticker between two dates."""
    start_price = get_price_on_or_after(cursor, ticker, start_date)
    end_price = get_price_on_or_before(cursor, ticker, end_date)

    if start_price and end_price and start_price > 0:
        return ((end_price - start_price) / start_price) * 100.0
    return None


def fmt_pct(val):
    """Format a percentage value with sign."""
    if val is None:
        return "  N/A "
    sign = "+" if val >= 0 else ""
    return f"{sign}{val:.1f}%"


def fmt_pct_padded(val, width=7):
    """Format a percentage value with sign and padding."""
    if val is None:
        return "   N/A ".ljust(width)
    sign = "+" if val >= 0 else ""
    return f"{sign}{val:.1f}%".rjust(width)


# ─────────────────────── MAIN ────────────────────────────────

def main():
    # Connect to DB
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.get_connection(DB_PATH, writable=False)
    cursor = conn.cursor()

    # ────────── Per-Window Returns ──────────
    window_results = {}
    for w in WINDOWS:
        returns = []
        per_ticker = {}
        for ticker in EGX_TICKERS:
            ret = calc_return(cursor, ticker, w["test_start"], w["test_end"])
            per_ticker[ticker] = ret
            if ret is not None:
                returns.append(ret)
        avg = sum(returns) / len(returns) if returns else None
        window_results[w["id"]] = {
            "label": w["label"],
            "avg": avg,
            "per_ticker": per_ticker,
            "n": len(returns),
        }

    # ────────── Total Period Returns ──────────
    total_returns = []
    total_per_ticker = {}
    for ticker in EGX_TICKERS:
        ret = calc_return(cursor, ticker, TOTAL_PERIOD["start"], TOTAL_PERIOD["end"])
        total_per_ticker[ticker] = ret
        if ret is not None:
            total_returns.append(ret)
    total_avg = sum(total_returns) / len(total_returns) if total_returns else None

    conn.close()

    # ────────── Print Results ──────────
    print()
    print("═" * 55)
    print("  BUY & HOLD BENCHMARK (Equal-Weighted 19 EGX Stocks)")
    print("═" * 55)

    print()
    print("Per-Window Comparison:")
    print(f"  {'Window':<7}| {'Period':<13}| {'Buy&Hold':>8} | {'Strategy':>8} | {'Alpha':>8}")
    print("  " + "─" * 51)

    for w in WINDOWS:
        wid = w["id"]
        bh = window_results[wid]["avg"]
        strat = STRATEGY_RETURNS[wid]
        alpha = (bh - strat) * -1 if bh is not None else None  # Alpha = Strategy - B&H
        # Actually alpha = strategy - benchmark, so positive means strategy beat benchmark
        alpha = strat - bh if bh is not None else None
        print(f"  {wid:<7}| {w['label']:<13}| {fmt_pct_padded(bh):>8} | {fmt_pct_padded(strat):>8} | {fmt_pct_padded(alpha):>8}")

    # Total
    alpha_total = STRATEGY_TOTAL - total_avg if total_avg is not None else None
    print("  " + "─" * 51)
    print(f"  {'TOTAL':<7}| {TOTAL_PERIOD['label']:<13}| {fmt_pct_padded(total_avg):>8} | {fmt_pct_padded(STRATEGY_TOTAL):>8} | {fmt_pct_padded(alpha_total):>8}")

    # ────────── Per-Ticker Total Return ──────────
    print()
    print(f"Per-Ticker Total Return ({TOTAL_PERIOD['start'][:7]} to {TOTAL_PERIOD['end'][:7]}):")
    print(f"  {'Ticker':<8}| {'Buy&Hold':>10}")
    print("  " + "─" * 22)

    sorted_tickers = sorted(EGX_TICKERS, key=lambda t: total_per_ticker.get(t) or -9999, reverse=True)
    for ticker in sorted_tickers:
        ret = total_per_ticker.get(ticker)
        print(f"  {ticker:<8}| {fmt_pct(ret):>10}")

    # ────────── Conclusion ──────────
    print()
    if alpha_total is not None:
        if alpha_total > 0:
            verdict = "BEAT"
        else:
            verdict = "FAILED TO BEAT"
        print(f"CONCLUSION:")
        print(f"  Strategy {verdict} Buy & Hold by {abs(alpha_total):.1f}%")
    else:
        print("CONCLUSION: Unable to calculate (missing data)")

    print("═" * 55)
    print()


if __name__ == "__main__":
    main()
