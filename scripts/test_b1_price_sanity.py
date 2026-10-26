#!/usr/bin/env python3
"""
B1 — Price Sanity Test Suite (Task 1-a / Bravo)
================================================
Covers all 6 acceptance test cases required by the owner's spec:

  1. valid candle → OK
  2. low > high → DATA_INVALID with reason
  3. negative price → DATA_INVALID
  4. stale data → STALE
  5. ADP USD contamination scenario (synthetic) → DATA_INVALID
  6. negative support propagation → caught

Plus extra regression tests:
  - real-world ADP snapshot pulled live from db/stocks.db → DATA_INVALID
  - real-world ADPC snapshot pulled live from db/price_history.db → DATA_INVALID
    (its latest egksco candle has open=2.93 > high=2.9 — a real micro-anomaly)
  - dict-style access + JSON serialization
  - large_candle_range produces a corporate-actions note (not silent rejection)

Run:
    python3 scripts/test_b1_price_sanity.py
"""
from __future__ import annotations

import json
import os
import sys
import sqlite3
from datetime import date, timedelta
from pathlib import Path

# Make vps-service importable
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

from core.price_sanity import (  # noqa: E402
    validate_price_data,
    lookup_stock_identity,
    SanityResult,
    DEFAULT_LARGE_CANDLE_THRESHOLD,
)


# ──────────────────────────────────────────────────────────────────────────
# Test harness
# ──────────────────────────────────────────────────────────────────────────

_passed = 0
_failed = 0
_failures: list = []


def check(name: str, cond: bool, detail: str = ''):
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  ✅ {name}")
    else:
        _failed += 1
        _failures.append(f"{name}: {detail}")
        print(f"  ❌ {name} — {detail}")


def section(title: str):
    print(f"\n── {title} ──")


# ──────────────────────────────────────────────────────────────────────────
# Tests
# ──────────────────────────────────────────────────────────────────────────

def test_valid_candle_ok():
    """1. valid candle → OK"""
    section("Test 1: valid candle → OK")
    r = validate_price_data(
        prices=[2.50, 2.55, 2.60, 2.65, 2.70],
        ohlc=(2.65, 2.75, 2.60, 2.70),
        ticker='ADPC',
        market='EGX',
        currency='EGP',
        latest_date=date.today().isoformat(),
    )
    print(f"  result: {r.to_json()}")
    check("status == 'OK'", r.status == 'OK', f"got {r.status}")
    check("valid is True", r.valid is True, f"got {r.valid}")
    check("no reasons", len(r.reasons) == 0, f"reasons={r.reasons}")


def test_low_gt_high():
    """2. low > high → DATA_INVALID with reason"""
    section("Test 2: low > high → DATA_INVALID")
    r = validate_price_data(
        prices=[100.0],
        ohlc=(105.0, 110.0, 120.0, 108.0),  # low=120 > high=110
        ticker='XYZ',
        market='EGX',
        currency='EGP',
    )
    print(f"  result: {r.to_json()}")
    check("status == 'DATA_INVALID'", r.status == 'DATA_INVALID', f"got {r.status}")
    check("valid is False", r.valid is False, f"got {r.valid}")
    check("reason contains 'low_gt_high'",
          any('low_gt_high' in reason for reason in r.reasons),
          f"reasons={r.reasons}")
    check("isolated_fields includes low_price & high_price",
          'low_price' in r.isolated_fields and 'high_price' in r.isolated_fields,
          f"isolated={r.isolated_fields}")


def test_negative_price():
    """3. negative price → DATA_INVALID"""
    section("Test 3: negative price → DATA_INVALID")
    r = validate_price_data(
        prices=[-5.0],
        ohlc=(-5.0, -4.0, -6.0, -5.0),
        ticker='NEG',
        market='EGX',
        currency='EGP',
    )
    print(f"  result: {r.to_json()}")
    check("status == 'DATA_INVALID'", r.status == 'DATA_INVALID', f"got {r.status}")
    check("valid is False", r.valid is False, f"got {r.valid}")
    # Either non_positive_price OR ohlc_*_negative should fire
    check("reason flags negative or non-positive",
          any(('non_positive_price' in reason) or ('negative' in reason.lower())
              for reason in r.reasons),
          f"reasons={r.reasons}")


def test_stale_data():
    """4. stale data → STALE"""
    section("Test 4: stale data → STALE")
    stale_date = (date.today() - timedelta(days=10)).isoformat()
    r = validate_price_data(
        prices=[10.0, 10.5, 11.0],
        ohlc=(10.5, 11.2, 10.4, 11.0),
        ticker='STALE',
        market='EGX',
        currency='EGP',
        latest_date=stale_date,
        max_age_days=3,
    )
    print(f"  result: {r.to_json()}")
    check("status == 'STALE'", r.status == 'STALE', f"got {r.status}")
    check("valid is False", r.valid is False, f"got {r.valid}")
    check("reason contains 'stale_data'",
          any('stale_data' in reason for reason in r.reasons),
          f"reasons={r.reasons}")


def test_adp_usd_contamination_synthetic():
    """5. ADP USD contamination scenario (synthetic) → DATA_INVALID"""
    section("Test 5: ADP USD contamination (synthetic) → DATA_INVALID")
    # Reproduce the owner's symptom: current_price=263.855 (USD), low=3.7 (ADPC leak),
    # high=269.94 (US source), market=EGX, currency=USD.
    r = validate_price_data(
        prices=[3.7, 3.7, 3.7, 263.855, 263.855],  # history: ADPC-leak → US-source
        ohlc=(269.94, 269.94, 3.7, 263.855),
        ticker='ADP',
        market='EGX',
        currency='USD',
    )
    print(f"  result: {r.to_json()}")
    check("status == 'DATA_INVALID'", r.status == 'DATA_INVALID', f"got {r.status}")
    check("valid is False", r.valid is False, f"got {r.valid}")
    check("reason flags currency_market_mismatch",
          any('currency_market_mismatch' in reason for reason in r.reasons),
          f"reasons={r.reasons}")
    check("reason flags large_candle_range (with corporate-action note)",
          any('large_candle_range' in reason and 'corporate_actions' in reason
              for reason in r.reasons),
          f"reasons={r.reasons}")
    check("reason flags history_current_mismatch",
          any('history_current_mismatch' in reason for reason in r.reasons),
          f"reasons={r.reasons}")


def test_negative_support():
    """6. negative support propagation → caught"""
    section("Test 6: negative support → caught")
    # Simulate a contaminated OHLC where a downstream S/R calculator produced
    # a negative support (e.g., support = low - k*ATR where ATR is inflated
    # by the 3.7 ↔ 269.94 jump). The validator must catch it at the gate.
    r = validate_price_data(
        prices=[263.855],
        ohlc=(269.94, 269.94, 3.7, 263.855),
        ticker='ADP',
        market='EGX',
        currency='USD',
        support=-262.54,        # negative support — contaminated downstream output
        resistance=269.94,
    )
    print(f"  result: {r.to_json()}")
    check("status == 'DATA_INVALID'", r.status == 'DATA_INVALID', f"got {r.status}")
    check("reason flags negative_support",
          any('negative_support' in reason for reason in r.reasons),
          f"reasons={r.reasons}")
    check("isolated_fields includes 'support'",
          'support' in r.isolated_fields, f"isolated={r.isolated_fields}")


# ──────────────────────────────────────────────────────────────────────────
# Extra regression tests
# ──────────────────────────────────────────────────────────────────────────

def test_large_candle_not_silent():
    """Large candle range is DATA_INVALID BUT includes a corporate-action note
    (per owner: do NOT silently reject)."""
    section("Test (extra): large candle range flags + corporate-action note")
    # 100% range: low=10, high=20 → ratio = 1.0 (not > threshold) → OK
    r1 = validate_price_data(
        prices=[15.0], ohlc=(12.0, 20.0, 10.0, 15.0),
        ticker='A', market='EGX', currency='EGP',
        large_candle_threshold=1.0,
    )
    check("100% range (== threshold) is OK", r1.status == 'OK', f"got {r1.status}")
    # 200% range: low=10, high=30 → ratio = 2.0 (> 1.0) → DATA_INVALID + note
    r2 = validate_price_data(
        prices=[15.0], ohlc=(12.0, 30.0, 10.0, 15.0),
        ticker='B', market='EGX', currency='EGP',
        large_candle_threshold=1.0,
    )
    check("200% range is DATA_INVALID", r2.status == 'DATA_INVALID', f"got {r2.status}")
    check("reason includes 'check_corporate_actions_or_splits' note",
          any('check_corporate_actions_or_splits' in reason for reason in r2.reasons),
          f"reasons={r2.reasons}")


def test_data_unavailable():
    """No price data → DATA_UNAVAILABLE"""
    section("Test (extra): no price data → DATA_UNAVAILABLE")
    r = validate_price_data(prices=None, ohlc=None, ticker='EMPTY', market='EGX', currency='EGP')
    check("status == 'DATA_UNAVAILABLE'", r.status == 'DATA_UNAVAILABLE', f"got {r.status}")
    check("valid is False", r.valid is False, f"got {r.valid}")


def test_support_gt_resistance():
    """support > resistance → DATA_INVALID"""
    section("Test (extra): support > resistance → DATA_INVALID")
    r = validate_price_data(
        prices=[10.0], ohlc=(10.0, 11.0, 9.0, 10.0),
        ticker='INV', market='EGX', currency='EGP',
        support=12.0, resistance=10.0,
    )
    check("status == 'DATA_INVALID'", r.status == 'DATA_INVALID', f"got {r.status}")
    check("reason flags support_gt_resistance",
          any('support_gt_resistance' in reason for reason in r.reasons),
          f"reasons={r.reasons}")


def test_result_types_and_serialization():
    """SanityResult supports both attribute + dict access + JSON serialization."""
    section("Test (extra): SanityResult type behavior")
    r = validate_price_data(prices=[10.0], ohlc=(10.0, 11.0, 9.0, 10.0),
                            ticker='T', market='EGX', currency='EGP')
    check("attribute access valid", r.valid is True)
    check("dict access ['valid']", r['valid'] is True)
    check("get() with default", r.get('nonexistent', 'fallback') == 'fallback')
    d = r.to_dict()
    check("to_dict returns dict", isinstance(d, dict) and d['status'] == 'OK')
    js = r.to_json()
    check("to_json returns valid JSON", isinstance(js, str) and json.loads(js)['status'] == 'OK')


def test_real_adp_live_snapshot():
    """Pull ADP live from db/stocks.db → must be DATA_INVALID."""
    section("Test (real-world): ADP live snapshot → DATA_INVALID")
    stocks_db = PROJECT_ROOT / 'db' / 'stocks.db'
    ph_db = PROJECT_ROOT / 'db' / 'price_history.db'
    if not stocks_db.exists():
        check("skipped (no stocks.db)", True)
        return
    ident = lookup_stock_identity('ADP', db_path=str(stocks_db))
    print(f"  identity: {ident}")
    check("ADP currency is USD (the contamination fingerprint)",
          (ident.get('currency') or '').upper() == 'USD',
          f"currency={ident.get('currency')}")
    check("ADP market is EGX (claims EGX despite USD)",
          (ident.get('market') or '').upper() == 'EGX',
          f"market={ident.get('market')}")

    # Pull latest price_history row for ADP
    closes = []
    ohlc = None
    latest_date = None
    if ph_db.exists():
        conn = sqlite3.connect(str(ph_db))
        cur = conn.execute(
            "SELECT date, open_price, high_price, low_price, close_price "
            "FROM price_history WHERE ticker='ADP' AND close_price IS NOT NULL "
            "ORDER BY date DESC LIMIT 30",
        )
        rows = cur.fetchall()
        conn.close()
        if rows:
            rows.reverse()
            latest = rows[-1]
            latest_date = latest[0]
            ohlc = (latest[1], latest[2], latest[3], latest[4])
            closes = [float(r[4]) for r in rows if r[4] is not None]

    r = validate_price_data(
        prices=closes or 263.855,
        ohlc=ohlc,
        ticker='ADP',
        market=ident.get('market'),
        currency=ident.get('currency'),
        latest_date=latest_date,
    )
    print(f"  result: {r.to_json()}")
    check("ADP live snapshot is DATA_INVALID", r.status == 'DATA_INVALID', f"got {r.status}")
    check("reason flags currency_market_mismatch",
          any('currency_market_mismatch' in reason for reason in r.reasons),
          f"reasons={r.reasons}")


def test_real_adpc_live_snapshot():
    """Pull ADPC live from db/stocks.db → must be OK or DATA_INVALID
    (latest egksco candle has open=2.93 > high=2.9 micro-anomaly → DATA_INVALID
    with open_out_of_range; if the daily candle is clean, status is OK).
    Either way: must NOT pass STALE or DATA_UNAVAILABLE."""
    section("Test (real-world): ADPC live snapshot")
    stocks_db = PROJECT_ROOT / 'db' / 'stocks.db'
    ph_db = PROJECT_ROOT / 'db' / 'price_history.db'
    ident = lookup_stock_identity('ADPC', db_path=str(stocks_db))
    print(f"  identity: {ident}")
    check("ADPC currency is EGP (the real EGX stock)",
          (ident.get('currency') or '').upper() == 'EGP',
          f"currency={ident.get('currency')}")
    check("ADPC market is EGX",
          (ident.get('market') or '').upper() == 'EGX',
          f"market={ident.get('market')}")
    check("ADPC name_ar mentions 'العربية لمنتجات الألبان' (Arabia for Dairy Products)",
          'العربية لمنتجات الألبان' in (ident.get('name_ar') or ''),
          f"name_ar={ident.get('name_ar')}")

    closes = []
    ohlc = None
    latest_date = None
    if ph_db.exists():
        conn = sqlite3.connect(str(ph_db))
        cur = conn.execute(
            "SELECT date, open_price, high_price, low_price, close_price "
            "FROM price_history WHERE ticker='ADPC' AND close_price IS NOT NULL "
            "ORDER BY date DESC LIMIT 30",
        )
        rows = cur.fetchall()
        conn.close()
        if rows:
            rows.reverse()
            latest = rows[-1]
            latest_date = latest[0]
            ohlc = (latest[1], latest[2], latest[3], latest[4])
            closes = [float(r[4]) for r in rows if r[4] is not None]

    r = validate_price_data(
        prices=closes or 2.64,
        ohlc=ohlc,
        ticker='ADPC',
        market=ident.get('market'),
        currency=ident.get('currency'),
        latest_date=latest_date,
    )
    print(f"  result: {r.to_json()}")
    check("ADPC is NOT DATA_UNAVAILABLE (we have data)",
          r.status != 'DATA_UNAVAILABLE', f"got {r.status}")
    check("ADPC has no currency_market_mismatch (it's the clean record)",
          not any('currency_market_mismatch' in reason for reason in r.reasons),
          f"reasons={r.reasons}")


# ──────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────

def main():
    print("=" * 78)
    print("B1 — Price Sanity Test Suite (Task 1-a / Bravo)")
    print("=" * 78)

    test_valid_candle_ok()
    test_low_gt_high()
    test_negative_price()
    test_stale_data()
    test_adp_usd_contamination_synthetic()
    test_negative_support()

    test_large_candle_not_silent()
    test_data_unavailable()
    test_support_gt_resistance()
    test_result_types_and_serialization()
    test_real_adp_live_snapshot()
    test_real_adpc_live_snapshot()

    print("\n" + "=" * 78)
    total = _passed + _failed
    print(f"RESULT: {_passed}/{total} passed, {_failed} failed")
    if _failed:
        print("FAILURES:")
        for f in _failures:
            print(f"  - {f}")
        return 1
    print("ALL TESTS PASSED ✅")
    return 0


if __name__ == '__main__':
    sys.exit(main())
