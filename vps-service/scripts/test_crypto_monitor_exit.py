#!/usr/bin/env python3
"""
V40.4 Phase 3 — Crypto 24/7 Monitor & Exit Test (Directive §6 Phase 3.2)
=========================================================================
سكربت محاكاة حركة سعرية لحظية لزوج BTCUSDT للتحقق من:
  1. الخروج الجزئي عند 1.8R (50% من المركز).
  2. رفع الوقف لنقطة الدخول (breakeven) بعد الهدف الأول.
  3. الـ Trailing Stop (Highest - 2.0 * ATR) عند التراجع.
  4. سقف الخسارة الصارم (-10%) كحزام أمان.

لا يعتمد على شبكة حقيقية — يستخدم mock لـ _fetch_live_price.
"""
from __future__ import annotations

import os
import sys
import sqlite3
import tempfile
from pathlib import Path
from datetime import datetime

SCRIPT_DIR = Path(__file__).resolve().parent
VPS_SERVICE_DIR = SCRIPT_DIR.parent
if str(VPS_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(VPS_SERVICE_DIR))

from jobs.crypto_lab_scheduler import (
    CryptoLabScheduler,
    CRYPTO_HARD_LOSS_CEILING_PCT,
    CRYPTO_PARTIAL_EXIT_R,
    CRYPTO_PARTIAL_EXIT_PCT,
    CRYPTO_TRAILING_ATR_MULT,
    CRYPTO_LAB_INTERVAL_SECONDS,
)


def _make_temp_scheduler(price_sequence):
    """Create a CryptoLabScheduler backed by a temp DB + mock price fetcher.

    ``price_sequence`` is a list of (symbol, price) tuples that the mock
    _fetch_live_price will return on successive calls.
    """
    tmp_db = tempfile.NamedTemporaryFile(suffix='.db', delete=False, prefix='crypto_test_')
    tmp_db.close()

    # Create the scheduler WITHOUT calling __init__ (to avoid engine loading),
    # then set only the attributes we need.
    sched = CryptoLabScheduler.__new__(CryptoLabScheduler)
    sched.predictions_db = tmp_db.name
    sched.data_engine_db = ''  # no data_engine — _fetch_atr returns 0
    sched.last_error = None
    sched.last_results = {}
    sched.last_run = None
    sched.running = False
    sched._thread = None
    sched._fusion_engine_cls = None
    sched._smc_calculate = None

    # Ensure the predictions table exists (with V40.4 columns)
    sched._ensure_predictions_table()

    # Mock the live price fetcher — returns the next price in the sequence
    price_iter = iter(price_sequence)

    def mock_fetch_live_price(symbol):
        try:
            sym, price = next(price_iter)
            return price
        except StopIteration:
            return None
    sched._fetch_live_price = mock_fetch_live_price

    # Mock ATR (return a fixed small value so trailing is deterministic)
    sched._fetch_atr = lambda symbol, period=14: 500.0  # $500 ATR

    return sched, tmp_db.name


def _insert_position(sched, symbol, entry, target, stop):
    """Insert a fake open position into the test DB."""
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn = db_manager.connection(sched.predictions_db, writable=True).__enter__()
    cur = conn.cursor()
    cur.execute('''
        INSERT INTO crypto_predictions_log
            (symbol, signal, entry_price, target_price, stop_loss,
             highest_price, remaining_pct, status, created_at)
        VALUES (?, 'BUY', ?, ?, ?, ?, 1.0, 'open', ?)
    ''', (symbol, entry, target, stop, entry,
          datetime.utcnow().isoformat() + 'Z'))
    conn.commit()
    pos_id = cur.lastrowid
    conn.close()
    return pos_id


def _get_position(sched, pos_id):
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(sched.predictions_db, writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT * FROM crypto_predictions_log WHERE id = ?", (pos_id,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None


def test_partial_exit_at_1_8R() -> bool:
    """(Directive §6 Phase 3.2) Price reaches 1.8R → partial exit 50% + breakeven."""
    print("\n[1] Partial exit at 1.8R + breakeven stop")
    # Entry=100k, Stop=95k → risk=5k. 1.8R target = 100k + 5k*1.8 = 109k
    entry, stop, target = 100_000.0, 95_000.0, 115_000.0
    # Price sequence: one tick at 109.5k (just above 1.8R = 109k)
    sched, db_path = _make_temp_scheduler([('BTC', 109_500.0)])
    pos_id = _insert_position(sched, 'BTC', entry, target, stop)

    result = sched.monitor_and_exit()
    pos = _get_position(sched, pos_id)

    print(f"  Position: entry=${entry:,.0f} stop=${stop:,.0f} risk=${entry-stop:,.0f}")
    print(f"  1.8R level = ${entry + (entry-stop)*CRYPTO_PARTIAL_EXIT_R:,.0f}")
    print(f"  Price tick = $109,500 → triggered partial exit")
    print(f"  Result: exit_type={pos['exit_type']} remaining={pos['remaining_pct']} "
          f"status={pos['status']} stop={pos['stop_loss']} return={pos['actual_return']}")

    assert pos['exit_type'] == 'partial_target', f"expected partial_target, got {pos['exit_type']}"
    assert abs(pos['remaining_pct'] - 0.5) < 1e-6, f"remaining should be 0.5, got {pos['remaining_pct']}"
    assert pos['status'] == 'partial', f"status should be partial, got {pos['status']}"
    # Breakeven: stop moved to entry
    assert abs(pos['stop_loss'] - entry) < 1e-6, f"stop should be breakeven={entry}, got {pos['stop_loss']}"
    assert pos['actual_return'] > 0, "partial exit should have positive return"
    print("  → PASS: partial exit 50% + breakeven stop triggered at 1.8R")

    os.unlink(db_path)
    return True


def test_trailing_stop_after_partial() -> bool:
    """(Directive §6 Phase 3.2) After partial, price drops below trailing → full exit."""
    print("\n[2] Trailing stop fires after partial exit")
    entry, stop, target = 100_000.0, 95_000.0, 120_000.0
    # Sequence: 109.5k (partial), then 112k (new high), then 110k (below trailing)
    # Trailing = 112k - 2.0 * 500 (ATR) = 111k. Price 110k < 111k → trailing exit.
    sched, db_path = _make_temp_scheduler([
        ('BTC', 109_500.0),  # tick 1: partial exit
        ('BTC', 112_000.0),  # tick 2: update highest
        ('BTC', 110_000.0),  # tick 3: trailing stop fires
    ])
    pos_id = _insert_position(sched, 'BTC', entry, target, stop)

    # Tick 1: partial exit
    sched.monitor_and_exit()
    pos = _get_position(sched, pos_id)
    assert pos['status'] == 'partial', f"tick1: status should be partial, got {pos['status']}"
    print(f"  Tick 1 (price=$109,500): partial exit → status={pos['status']} highest=${pos['highest_price']:,.0f}")

    # Tick 2: price rises to 112k → update highest
    sched.monitor_and_exit()
    pos = _get_position(sched, pos_id)
    assert abs(pos['highest_price'] - 112_000.0) < 1e-6, f"tick2: highest should be 112k, got {pos['highest_price']}"
    print(f"  Tick 2 (price=$112,000): highest updated → highest=${pos['highest_price']:,.0f}")

    # Tick 3: price drops to 110k → trailing stop fires
    sched.monitor_and_exit()
    pos = _get_position(sched, pos_id)
    trailing_level = 112_000.0 - CRYPTO_TRAILING_ATR_MULT * 500.0
    print(f"  Tick 3 (price=$110,000): trailing level=${trailing_level:,.0f} → "
          f"exit_type={pos['exit_type']} status={pos['status']} remaining={pos['remaining_pct']}")
    assert pos['exit_type'] == 'trailing', f"tick3: expected trailing, got {pos['exit_type']}"
    assert pos['status'] == 'closed', f"tick3: status should be closed, got {pos['status']}"
    assert abs(pos['remaining_pct']) < 1e-6, f"tick3: remaining should be 0, got {pos['remaining_pct']}"
    print("  → PASS: trailing stop closed the remaining 50% at $110k")

    os.unlink(db_path)
    return True


def test_hard_loss_ceiling() -> bool:
    """(Directive §6 Phase 3.2) Price drops -10% → hard loss ceiling fires immediately."""
    print("\n[3] Hard loss ceiling (-10%) fires before stop/target")
    entry, stop, target = 100_000.0, 92_000.0, 115_000.0
    # Price at 89k = -11% from entry → below -10% ceiling (90k)
    sched, db_path = _make_temp_scheduler([('BTC', 89_000.0)])
    pos_id = _insert_position(sched, 'BTC', entry, target, stop)

    sched.monitor_and_exit()
    pos = _get_position(sched, pos_id)

    ceiling = entry * (1 + CRYPTO_HARD_LOSS_CEILING_PCT / 100.0)
    print(f"  Entry=${entry:,.0f} hard ceiling=${ceiling:,.0f} price=$89,000")
    print(f"  Result: exit_type={pos['exit_type']} status={pos['status']} return={pos['actual_return']}")

    assert pos['exit_type'] == 'hard_loss', f"expected hard_loss, got {pos['exit_type']}"
    assert pos['status'] == 'closed', f"status should be closed, got {pos['status']}"
    assert pos['actual_return'] < 0, "hard loss should have negative return"
    print("  → PASS: hard loss ceiling closed position at -11%")

    os.unlink(db_path)
    return True


def test_stop_loss_hit() -> bool:
    """(Directive §6 Phase 3.2) Price hits stop_loss → exit at stop."""
    print("\n[4] Stop loss hit (price <= stop_loss)")
    entry, stop, target = 100_000.0, 95_000.0, 115_000.0
    sched, db_path = _make_temp_scheduler([('BTC', 94_500.0)])
    pos_id = _insert_position(sched, 'BTC', entry, target, stop)

    sched.monitor_and_exit()
    pos = _get_position(sched, pos_id)

    print(f"  Entry=${entry:,.0f} stop=${stop:,.0f} price=$94,500")
    print(f"  Result: exit_type={pos['exit_type']} exit_price={pos['exit_price']} status={pos['status']}")

    assert pos['exit_type'] == 'stop', f"expected stop, got {pos['exit_type']}"
    assert abs(pos['exit_price'] - stop) < 1e-6, f"exit_price should be stop={stop}, got {pos['exit_price']}"
    assert pos['status'] == 'closed'
    print("  → PASS: stop loss closed position at $95k")

    os.unlink(db_path)
    return True


def test_target_hit() -> bool:
    """(Directive §6 Phase 3.2) Price hits target → exit at target (full)."""
    print("\n[5] Target hit (price >= target_price)")
    entry, stop, target = 100_000.0, 95_000.0, 108_000.0
    # Price 108.5k >= target 108k AND >= 1.8R (109k)? No, 108.5k < 109k.
    # So target fires first (priority 3) before partial (priority 4).
    sched, db_path = _make_temp_scheduler([('BTC', 108_500.0)])
    pos_id = _insert_position(sched, 'BTC', entry, target, stop)

    sched.monitor_and_exit()
    pos = _get_position(sched, pos_id)

    print(f"  Entry=${entry:,.0f} target=${target:,.0f} price=$108,500")
    print(f"  Result: exit_type={pos['exit_type']} exit_price={pos['exit_price']} status={pos['status']}")

    assert pos['exit_type'] == 'target', f"expected target, got {pos['exit_type']}"
    assert abs(pos['exit_price'] - target) < 1e-6, f"exit_price should be target={target}, got {pos['exit_price']}"
    assert pos['status'] == 'closed'
    print("  → PASS: target closed position at $108k")

    os.unlink(db_path)
    return True


def test_interval_is_5min() -> bool:
    """(Directive §4.2) Scheduler interval = 5 minutes (300s)."""
    print("\n[6] Scheduler interval = 5 minutes (V40.4 §4.2)")
    assert CRYPTO_LAB_INTERVAL_SECONDS == 300, (
        f"interval should be 300s (5 min), got {CRYPTO_LAB_INTERVAL_SECONDS}"
    )
    print(f"  CRYPTO_LAB_INTERVAL_SECONDS = {CRYPTO_LAB_INTERVAL_SECONDS}s = {CRYPTO_LAB_INTERVAL_SECONDS // 60} min")
    print("  → PASS: interval is 5 minutes")
    return True


def main() -> int:
    print("=" * 70)
    print("🚀 V40.4 Phase 3 — Crypto 24/7 Monitor & Exit Test")
    print("=" * 70)
    print(f"Params: hard_loss={CRYPTO_HARD_LOSS_CEILING_PCT}% partial@{CRYPTO_PARTIAL_EXIT_R}R "
          f"({CRYPTO_PARTIAL_EXIT_PCT*100:.0f}%) trailing={CRYPTO_TRAILING_ATR_MULT}*ATR")

    tests = [
        test_interval_is_5min,
        test_partial_exit_at_1_8R,
        test_trailing_stop_after_partial,
        test_hard_loss_ceiling,
        test_stop_loss_hit,
        test_target_hit,
    ]

    passed = 0
    failed = 0
    for t in tests:
        try:
            if t():
                passed += 1
        except AssertionError as exc:
            failed += 1
            print(f"\n  ✗ FAIL [{t.__name__}]: {exc}")
        except Exception as exc:
            failed += 1
            print(f"\n  ✗ ERROR [{t.__name__}]: {type(exc).__name__}: {exc}")

    print("\n" + "=" * 70)
    print(f"RESULTS: {passed} passed, {failed} failed (of {len(tests)} tests)")
    print("=" * 70)
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
