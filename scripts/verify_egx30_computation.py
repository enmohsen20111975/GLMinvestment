#!/usr/bin/env python3
"""
verify_egx30_computation.py — قارن الـ computation بالـ real values.

Owner directive: "انا مديهالك عالشان تقارن النتائج بتاعت الحسابات"
The real historical EGX30 values are a BENCHMARK to verify our computation
is correct. For each date:
  1. Get stock prices for all 31 EGX30 constituents (from price_history.db)
  2. Compute weighted avg change using the real weights (COMI=31.92% etc.)
  3. Chain: index_D = index_D-1 × (1 + weighted_change%)
  4. Compare computed vs real → show difference

If computed matches real for MULTIPLE days → computation is correct.
If not → weights or formula or stock prices are wrong.

Usage:
    python3 scripts/verify_egx30_computation.py
"""
import json
import sqlite3
import sys
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
CANONICAL = PROJECT_ROOT / 'vps-service' / 'data' / 'canonical_indices.json'
PRICE_HISTORY_DB = PROJECT_ROOT / 'db' / 'price_history.db'
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'

# === REAL EGX30 benchmark values (from EGX official — owner provided) ===
# date → close
REAL_EGX30 = {
    "2026-09-22": 54930.89,
    "2026-09-23": 54224.93,
    "2026-09-24": 53776.69,
    "2026-09-27": 53031.69,
    "2026-09-28": 52468.71,
    "2026-09-29": 52297.12,
    "2026-09-30": 51894.83,
    "2026-10-01": 53055.03,
    "2026-10-04": 53911.10,
    "2026-10-05": 53553.41,
    "2026-10-06": 53298.14,
    "2026-10-07": 53265.16,
    "2026-10-11": 52206.70,
    "2026-10-12": 51613.92,
    "2026-10-13": 51265.27,
    "2026-10-14": 51492.83,
    "2026-10-15": 52273.34,
    "2026-10-18": 50896.19,
    "2026-10-19": 51098.83,
    "2026-10-20": 52089.01,
    "2026-10-21": 52854.95,
    "2026-10-22": 51052.26,
}

# Sort dates ascending
DATES = sorted(REAL_EGX30.keys())


def get_constituents():
    """Get EGX30 constituents + weights from canonical_indices.json."""
    d = json.load(open(CANONICAL))
    return d['EGX30']['constituents']


def get_stock_prices():
    """Get close prices for all EGX30 constituents from price_history.db.
    Returns: {ticker: {date: close_price}}
    """
    if not PRICE_HISTORY_DB.exists():
        print(f"✗ price_history.db not found at {PRICE_HISTORY_DB}")
        sys.exit(1)

    conn = sqlite3.connect(str(PRICE_HISTORY_DB))
    prices = {}

    # Check what tables exist
    tables = [r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()]

    # Try price_history table
    if 'price_history' in tables:
        for row in conn.execute(
            "SELECT ticker, date, close_price FROM price_history "
            "WHERE close_price > 0 ORDER BY ticker, date"
        ).fetchall():
            ticker, date, close = row
            if ticker not in prices:
                prices[ticker] = {}
            prices[ticker][str(date)[:10]] = float(close)
    else:
        print(f"✗ price_history table not found. Tables: {tables}")
        conn.close()
        return {}

    conn.close()
    return prices


def verify():
    constituents = get_constituents()
    print(f"EGX30 constituents: {len(constituents)}")
    print(f"COMI weight: {[c['weight'] for c in constituents if c['code']=='COMI'][0]}%")
    print()

    prices = get_stock_prices()
    if not prices:
        print("✗ No stock prices available")
        return

    print(f"Stocks with price data: {len(prices)}")
    print()

    # Check which constituents have price data
    missing = []
    for c in constituents:
        ticker = c['code']
        if ticker not in prices:
            missing.append(f"{ticker} ({c['weight']}%)")
    if missing:
        print(f"⚠ Constituents missing from price_history.db: {missing[:10]}")
    print()

    # Start with the real base (first date)
    prev_date = DATES[0]
    prev_real = REAL_EGX30[prev_date]
    prev_computed = prev_real  # start from the real value

    print(f"{'Date':<12} {'Real':>12} {'Computed':>12} {'Diff':>10} {'Diff%':>8} {'Matched':>8}")
    print("-" * 70)

    total_matched = 0
    total_days = 0
    max_diff_pct = 0

    for i, date in enumerate(DATES):
        real = REAL_EGX30[date]

        if i == 0:
            # First day: use real as base (no computation)
            computed = prev_computed
            matched_str = "BASE"
        else:
            # Compute: index = prev × (1 + weighted_change%)
            total_weight = 0
            weighted_change = 0
            matched = 0

            for c in constituents:
                ticker = c['code']
                weight = c.get('weight', 0)
                if ticker not in prices:
                    continue
                tprices = prices[ticker]
                if date not in tprices or prev_date not in tprices:
                    continue
                today_close = tprices[date]
                prev_close = tprices[prev_date]
                if prev_close <= 0:
                    continue
                change_pct = (today_close - prev_close) / prev_close * 100
                total_weight += weight
                weighted_change += weight * change_pct
                matched += 1

            if total_weight == 0:
                computed = prev_computed  # no data, keep previous
                matched_str = f"{matched}/31 (no data)"
            else:
                avg_change = weighted_change / total_weight
                computed = prev_computed * (1 + avg_change / 100)
                matched_str = f"{matched}/31"

        diff = computed - real
        diff_pct = abs(diff) / real * 100 if real > 0 else 0
        max_diff_pct = max(max_diff_pct, diff_pct)

        status = "✓" if diff_pct < 0.5 else ("⚠" if diff_pct < 2 else "✗")
        print(f"{date:<12} {real:>12,.2f} {computed:>12,.2f} {diff:>+10,.2f} {diff_pct:>7.2f}% {matched_str:>8} {status}")

        if diff_pct < 0.5:
            total_matched += 1
        total_days += 1

        prev_computed = computed
        prev_date = date

    print("-" * 70)
    print(f"\nResults: {total_matched}/{total_days} days within 0.5% of real")
    print(f"Max difference: {max_diff_pct:.2f}%")
    print()
    if total_matched >= total_days * 0.8:
        print("✓ Computation is ACCURATE — weights + formula are correct!")
    elif total_matched >= total_days * 0.5:
        print("⚠ Partially accurate — some weights or stock prices may be off")
    else:
        print("✗ Computation is OFF — need to investigate weights or stock prices")


if __name__ == "__main__":
    verify()
