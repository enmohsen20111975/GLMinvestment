#!/usr/bin/env python3
"""test_wyckoff_accumulation.py — GLM5.3-S1-WYCKOFF verification suite.

Tests detect_wyckoff_accumulation() against the 4 canonical Wyckoff phases
plus the Wash Trading filter. All synthetic fixtures are constructed here
(no DB reads required) — they exercise pure-Python logic; production runs
will pass real OHLCV from stocks.db per Rule 27 (NO-FAKE-DATA).

Run:
    python3 scripts/test_wyckoff_accumulation.py
"""
from __future__ import annotations
import sys
from pathlib import Path

# Make `utils.shared_liquidity` importable from this script's location.
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

from utils.shared_liquidity import detect_wyckoff_accumulation  # noqa: E402

PASS = "\033[92m✓ PASS\033[0m"
FAIL = "\033[91m✗ FAIL\033[0m"

_passed = 0
_failed = 0


def _check(name: str, cond: bool, extra: str = "") -> None:
    global _passed, _failed
    if cond:
        _passed += 1
        print(f"  {PASS} {name} {extra}")
    else:
        _failed += 1
        print(f"  {FAIL} {name} {extra}")


# ============================================================================
# Fixture 1: B_CAUSE — tight range + low volume + VSA (up-day vol > down-day vol)
# ============================================================================
def test_b_cause_phase():
    print("\n[FIXTURE 1] B_CAUSE — tight range + low volume + rising VSA pattern")

    # 40 days total. First 30 days: stable at 10.0 with volume 10000.
    # Last 10 days: tight pattern (9.75–9.99) with low volume.
    # Up days get 6000 vol, down days get 4000 vol (avg = 5000 < 0.7× avg_20d).
    closes = [10.0] * 30
    volumes = [10000] * 30
    highs = [10.02] * 30
    lows = [9.98] * 30

    pattern = [9.75, 9.95, 9.78, 9.98, 9.80, 9.97, 9.82, 9.99, 9.85, 9.75]
    for i, c in enumerate(pattern):
        closes.append(c)
        highs.append(c + 0.05)
        lows.append(c - 0.05)
        if i > 0 and c > pattern[i - 1]:
            volumes.append(6000)  # up day — higher volume
        else:
            volumes.append(4000)  # down day — lower volume

    is_signal, reason, details = detect_wyckoff_accumulation(closes, volumes, highs, lows)

    # avg_20d_vol = (10000×10 + 46000) / 20 = 7300
    # last 10 day avg vol = 4600 → ratio = 0.63 → below 0.7 ✓
    # range_pct (last 10d) = (9.99-9.75)/9.75*100 = 2.46% → below 5% ✓
    # VSA: avg_up_vol=6000 > avg_down_vol=4000 → confirmed ✓
    # last_close=9.75, lower_third ≈ 9.81 → in_support_zone ✓
    phases = [p["phase"] for p in details["phases_detected"]]
    _check(
        "B_CAUSE detected",
        "B_CAUSE" in phases,
        f"phases_detected={phases}",
    )
    _check(
        "phase field is B_CAUSE or higher (C_SPRING/D_SOS)",
        details["phase"] in ("B_CAUSE", "C_SPRING", "D_SOS"),
        f"phase={details['phase']}",
    )
    _check(
        "VSA confirmed (up_vol > down_vol)",
        details["vsa_confirmed"],
        f"up={details['avg_up_volume']} down={details['avg_down_volume']}",
    )
    _check(
        "last close is in support zone",
        details["in_support_zone"],
        f"close={closes[-1]} lower_third={details['lower_third']}",
    )
    _check(
        "wash trade NOT detected",
        not details["wash_trade_detected"],
        f"wash={details['wash_trade_detected']}",
    )
    _check(
        "signal is launched (in_support_zone + VSA)",
        is_signal,
        f"reason={reason[:80]}...",
    )


# ============================================================================
# Fixture 2: CHURNING_WASH_TRADE — doji + huge volume
# ============================================================================
def test_churning_wash_trade():
    print("\n[FIXTURE 2] CHURNING_WASH_TRADE — doji candle + volume > 3× avg_20d")

    # 30 days, all closes 10.0 (every candle is doji: open==close==high==low==10.0)
    # Volumes: 25 days at 10000, 4 days at 5000, last day at 35000
    # avg_20d_vol = (10000×15 + 5000×4 + 35000×1) / 20 = 205000/20 = 10250
    # last day vol_ratio = 35000 / 10250 = 3.41 → > 3× ✓
    # doji: body=0, range=0 → body_pct=0 → doji ✓
    closes = [10.0] * 30
    highs = [10.0] * 30
    lows = [10.0] * 30
    volumes = [10000] * 25 + [5000] * 4 + [35000]

    is_signal, reason, details = detect_wyckoff_accumulation(closes, volumes, highs, lows)

    phases = [p["phase"] for p in details["phases_detected"]]
    _check(
        "CHURNING_WASH_TRADE detected",
        "CHURNING_WASH_TRADE" in phases,
        f"phases_detected={phases}",
    )
    _check(
        "phase field = CHURNING_WASH_TRADE",
        details["phase"] == "CHURNING_WASH_TRADE",
        f"phase={details['phase']}",
    )
    _check(
        "wash_trade_detected flag = True",
        details["wash_trade_detected"],
        f"wash={details['wash_trade_detected']}",
    )
    _check(
        "signal is REJECTED (wash trade cancels accumulation)",
        not is_signal,
        f"is_signal={is_signal}",
    )
    _check(
        "reason mentions CHURNING_WASH_TRADE",
        "CHURNING_WASH_TRADE" in reason,
        f"reason={reason[:80]}...",
    )


# ============================================================================
# Fixture 3: A_SC — Selling Climax + Automatic Rally
# ============================================================================
def test_a_sc_phase():
    print("\n[FIXTURE 3] A_SC — Selling Climax (drop >3% + volume >1.8×) + AR")

    # 30 days. First 25 days stable at 10.0, vol=10000.
    # Day 26: drop to 9.50 (-5%) with volume 20000 (2× avg_20d=10000) → SC
    # Day 27: rebound to 9.70 with volume 15000 (< SC vol) → AR
    # Rest stable to keep lookback clean.
    closes = [10.0] * 25 + [9.50, 9.70, 9.70, 9.70, 9.70]
    volumes = [10000] * 25 + [20000, 15000, 10000, 10000, 10000]
    highs = [10.02] * 25 + [10.02, 9.85, 9.75, 9.75, 9.75]
    lows = [9.98] * 25 + [9.45, 9.55, 9.65, 9.65, 9.65]

    is_signal, reason, details = detect_wyckoff_accumulation(closes, volumes, highs, lows)

    phases = [p["phase"] for p in details["phases_detected"]]
    _check(
        "A_SC phase detected (SC + AR)",
        "A_SC" in phases,
        f"phases_detected={phases}",
    )
    _check(
        "phase field is A_SC or higher (no wash/sos override)",
        details["phase"] in ("A_SC", "B_CAUSE", "C_SPRING", "D_SOS"),
        f"phase={details['phase']}",
    )


# ============================================================================
# Fixture 4: C_SPRING — Spring / Shakeout
# ============================================================================
def test_c_spring_phase():
    print("\n[FIXTURE 4] C_SPRING — false break below support + close back above")

    # 30 days. First 25 days stable at 10.0 (lows=9.98, highs=10.02).
    # → support = 9.98 (from first 25 days of lookback).
    # Day 27 (in spring window): low=9.60 (< 9.98×0.97=9.6906) but close=10.05 (> support)
    closes = [10.0] * 25 + [10.0, 10.05, 10.05, 10.05, 10.05]
    volumes = [10000] * 30  # uniform volume to avoid Phase B / Wash interference
    highs = [10.02] * 25 + [10.02, 10.10, 10.10, 10.10, 10.10]
    lows = [9.98] * 25 + [9.98, 9.60, 9.95, 9.95, 9.95]  # day 27 has spring low

    is_signal, reason, details = detect_wyckoff_accumulation(closes, volumes, highs, lows)

    phases = [p["phase"] for p in details["phases_detected"]]
    _check(
        "C_SPRING phase detected",
        "C_SPRING" in phases,
        f"phases_detected={phases}",
    )


# ============================================================================
# Fixture 5: D_SOS — Sign of Strength
# ============================================================================
def test_d_sos_phase():
    print("\n[FIXTURE 5] D_SOS — green candle >+2% + volume >1.8× + close > midpoint")

    # 30 days. First 29 days stable at 10.0 with volume 10000 (avg_20d=10000).
    # Day 30: close=10.30 (+3% from 10.0), volume=20000 (2× avg_20d).
    # Midpoint of range (9.98-10.32) = 10.15. close=10.30 > 10.15 ✓
    closes = [10.0] * 29 + [10.30]
    volumes = [10000] * 29 + [20000]
    highs = [10.02] * 29 + [10.32]
    lows = [9.98] * 29 + [10.00]

    is_signal, reason, details = detect_wyckoff_accumulation(closes, volumes, highs, lows)

    phases = [p["phase"] for p in details["phases_detected"]]
    _check(
        "D_SOS phase detected",
        "D_SOS" in phases,
        f"phases_detected={phases}",
    )
    # Note: D_SOS triggers wash_trade check too (vol 2× < 3× so no wash).
    # Final phase priority: D_SOS > earlier phases.
    _check(
        "phase field is D_SOS (highest priority over earlier phases)",
        details["phase"] == "D_SOS",
        f"phase={details['phase']}",
    )


# ============================================================================
# Fixture 6: Insufficient data — early return with phase=NONE
# ============================================================================
def test_insufficient_data():
    print("\n[FIXTURE 6] Insufficient data — < 25 days returns phase=NONE")

    closes = [10.0] * 20
    volumes = [10000] * 20

    is_signal, reason, details = detect_wyckoff_accumulation(closes, volumes)

    _check(
        "signal rejected on insufficient data",
        not is_signal,
        f"is_signal={is_signal}",
    )
    _check(
        "phase = NONE",
        details["phase"] == "NONE",
        f"phase={details['phase']}",
    )


# ============================================================================
# Fixture 7: Phase A without AR — should NOT register A_SC (AR is required)
# ============================================================================
def test_sc_without_ar():
    print("\n[FIXTURE 7] SC without AR — A_SC should NOT trigger")

    # 30 days. Day 26: drop -5% with volume 2× avg (SC conditions met)
    # Day 27: another drop (NO rally) → AR condition fails.
    closes = [10.0] * 25 + [9.50, 9.30, 9.30, 9.30, 9.30]
    volumes = [10000] * 25 + [20000, 20000, 10000, 10000, 10000]
    highs = [10.02] * 25 + [10.02, 9.55, 9.35, 9.35, 9.35]
    lows = [9.98] * 25 + [9.45, 9.25, 9.25, 9.25, 9.25]

    is_signal, reason, details = detect_wyckoff_accumulation(closes, volumes, highs, lows)
    phases = [p["phase"] for p in details["phases_detected"]]
    _check(
        "A_SC NOT detected (AR missing)",
        "A_SC" not in phases,
        f"phases_detected={phases}",
    )


def main() -> int:
    print("=" * 72)
    print("GLM5.3-S1-WYCKOFF — Wyckoff Accumulation Verification Suite")
    print("=" * 72)

    test_b_cause_phase()
    test_churning_wash_trade()
    test_a_sc_phase()
    test_c_spring_phase()
    test_d_sos_phase()
    test_insufficient_data()
    test_sc_without_ar()

    print("\n" + "=" * 72)
    print(f"RESULT: {_passed} passed, {_failed} failed")
    print("=" * 72)
    return 1 if _failed else 0


if __name__ == "__main__":
    sys.exit(main())
