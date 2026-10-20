"""
BRAVO STAGE-8 — Integration Test Suite
========================================
اختبارات شاملة للـ unification اللي اتعمل في المراحل 0-7.

تغطي:
1. Canonical indicators (RSI, ATR, Bollinger, MFI, ADX, VWAP, Volume Profile, SMA, EMA, MACD)
2. Engine unification shims (engine/ → engines/, glminvestment_engines/engines/ → engines/)
3. Core unification shim (telegram/database.py → telegram/telegram_db.py)
4. Quant canonical (fair_value, position_sizing, risk_reward, backtest_stats)
5. Rule 67 compliance (no new inline indicators)

Usage:
    python3 tests/unit/test_bravo_unification.py
"""
import sys
import os
from pathlib import Path

# Setup path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

passed = 0
failed = 0


def check(name, condition, details=""):
    global passed, failed
    if condition:
        passed += 1
        print(f"  ✅ {name}")
    else:
        failed += 1
        print(f"  ❌ {name} {details}")


def test_canonical_indicators():
    """1. Canonical indicators — import + basic computation."""
    print("\n=== 1. Canonical Indicators ===")
    try:
        from analyzers.indicators import (
            calc_rsi, calc_atr, calc_srsi, sma, ema, macd,
            calc_bollinger, calc_bollinger_series,
            calc_mfi, calc_adx, calc_vwap, calc_vwap_premium, calc_volume_profile
        )
        check("import all 13 canonical functions", True)

        closes = [100, 102, 101, 103, 105, 104, 106, 108, 107, 109,
                  111, 110, 112, 114, 113, 115, 117, 116, 118, 120]
        highs = [c + 1 for c in closes]
        lows = [c - 1 for c in closes]
        volumes = [1000 * (1 + i * 0.05) for i in range(len(closes))]

        rsi = calc_rsi(closes, 14)
        check("RSI returns value", rsi is not None)
        check("RSI in [0, 100]", rsi is not None and 0 <= rsi <= 100)
        check("RSI > 50 (uptrend)", rsi is not None and rsi > 50)

        atr = calc_atr(highs, lows, closes, 14)
        check("ATR returns value", atr is not None)
        check("ATR > 0", atr is not None and atr > 0)

        bb = calc_bollinger(closes, 20, 2.0)
        check("Bollinger returns dict", bb is not None)
        if bb:
            check("Bollinger upper > middle > lower",
                  bb['upper'] > bb['middle'] > bb['lower'])
            check("Bollinger %b in [0, 100]", 0 <= bb['percent_b'] <= 100)

        mfi = calc_mfi(highs, lows, closes, volumes, 14)
        check("MFI returns value", mfi is not None)
        check("MFI in [0, 100]", mfi is not None and 0 <= mfi <= 100)

        closes_long = [100 + i * 0.5 for i in range(40)]
        highs_long = [c + 1 for c in closes_long]
        lows_long = [c - 1 for c in closes_long]
        adx = calc_adx(highs_long, lows_long, closes_long, 14)
        check("ADX returns dict", adx is not None)
        if adx:
            check("ADX has adx/plus_di/minus_di",
                  set(adx.keys()) == {'adx', 'plus_di', 'minus_di'})

        vwap = calc_vwap(highs, lows, closes, volumes)
        check("VWAP returns value", vwap is not None)
        check("VWAP > 0", vwap is not None and vwap > 0)

        vp = calc_volume_profile(closes, volumes, bins=10)
        check("Volume Profile returns dict", vp is not None)
        if vp:
            check("VP has poc/vah/val", all(k in vp for k in ['poc', 'vah', 'val']))

        s20 = sma(closes, 20)
        check("SMA(20) = mean", abs(s20 - sum(closes) / 20) < 0.01)

        e12 = ema(closes, 12)
        check("EMA(12) returns value", e12 is not None)

        # MACD needs 35+ bars
        closes_macd = [100 + i * 0.5 + (i % 3) for i in range(50)]
        m = macd(closes_macd)
        check("MACD returns dict", m is not None)
        if m:
            check("MACD has line/signal/histogram",
                  all(k in m for k in ['line', 'signal', 'histogram']))

    except Exception as e:
        check("canonical indicators import", False, str(e))


def test_engine_shims():
    """2. Engine unification shims."""
    print("\n=== 2. Engine Unification Shims ===")
    try:
        # canonical location
        from engines.flow_system import FlowSystemEngine
        check("engines.flow_system.FlowSystemEngine (canonical)", True)

        # old path via shim
        from engine.flow_system import FlowSystemEngine as FSE2
        check("engine.flow_system.FlowSystemEngine (shim)", True)
        check("shim re-exports same object", FlowSystemEngine is FSE2)

        # canonical atr_risk_engine
        from engines.atr_risk_engine import ATRRiskConfig
        check("engines.atr_risk_engine.ATRRiskConfig (canonical)", True)

        # old path via package shim
        from glminvestment_engines.engines import analyze_atr_risk, detect_vcp
        check("glminvestment_engines.engines.analyze_atr_risk (package shim)", True)

        # backtest_engine (was always in engines/)
        from engines.backtest_engine import calc_sma, calc_bollinger_bands
        check("engines.backtest_engine.calc_sma (was always here)", True)

    except Exception as e:
        check("engine shims", False, str(e))
        import traceback
        traceback.print_exc()


def test_telegram_shim():
    """3. Core unification — telegram/database.py shim."""
    print("\n=== 3. Telegram Database Shim ===")
    try:
        # canonical
        from telegram.telegram_db import db_manager
        check("telegram.telegram_db.db_manager (canonical)", True)

        # shim
        from telegram.database import db_manager as dm2
        check("telegram.database.db_manager (shim)", True)
        check("shim re-exports same object", db_manager is dm2)

    except Exception as e:
        check("telegram shim", False, str(e))


def test_quant_canonical():
    """4. Quant canonical functions."""
    print("\n=== 4. Quant Canonical Functions ===")
    try:
        from utils.fair_value import (
            calc_fundamental_fair_value, calc_upside_percent, calc_vwap_fair_value
        )
        from utils.position_sizing import (
            calculate_risk_based_position, calculate_kelly_position
        )

        # fundamental fair_value
        fv = calc_fundamental_fair_value(pe_ratio=15, eps=2.5, book_value_per_share=20)
        check("fundamental fair_value = max(PE×EPS, BV×1.5) = 37.5", fv == 37.5)

        upside = calc_upside_percent(fair_value=120, current_price=100)
        check("upside_percent = 20%", upside == 20.0)

        # vwap fair_value
        highs = [101, 103, 102, 104, 106]
        lows = [99, 101, 100, 102, 104]
        closes = [100, 102, 101, 103, 105]
        volumes = [1000, 1100, 900, 1200, 1500]
        fv_vwap, premium = calc_vwap_fair_value(highs, lows, closes, volumes, period=5)
        check("vwap fair_value > 0", fv_vwap > 0)

        # position sizing (with 25% cap)
        result = calculate_risk_based_position(capital=10000, entry=100, stop=94, risk_pct=2.0)
        check("position sizing returns dict", result is not None)
        if result:
            check("position capped at 25%", result['position_pct'] == 25.0)
            check("risk_per_share = 6", result['risk_per_share'] == 6.0)

        # invalid position
        invalid = calculate_risk_based_position(capital=10000, entry=100, stop=105, risk_pct=2.0)
        check("invalid position returns None", invalid is None)

        # Kelly
        kelly = calculate_kelly_position(win_rate=0.6, win_loss_ratio=2.0, capital=10000, kelly_fraction=0.5)
        check("Kelly returns dict", kelly is not None)
        if kelly:
            check("Kelly % = 40%", abs(kelly['kelly_pct'] - 40.0) < 0.1)

    except Exception as e:
        check("quant canonical", False, str(e))
        import traceback
        traceback.print_exc()


def test_rule_67_compliance():
    """5. Rule 67 — no new inline indicators outside canonical."""
    print("\n=== 5. Rule 67 Compliance ===")
    try:
        # run the regression test
        import importlib.util
        spec = importlib.util.spec_from_file_location(
            "test_canonical_compliance",
            ROOT / "tests" / "unit" / "test_canonical_compliance.py"
        )
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        violations = mod.check_no_new_inline()
        check(f"no inline violations (found {len(violations)})", len(violations) == 0,
              f"violations: {violations[:3]}")
    except Exception as e:
        check("Rule 67 compliance", False, str(e))


def test_delegation_consistency():
    """6. Delegation consistency — same results from canonical + delegated."""
    print("\n=== 6. Delegation Consistency ===")
    try:
        from analyzers.indicators.bollinger import calc_bollinger
        from engines.backtest_engine import calc_bollinger_bands
        from analyzers.enhanced_indicators import EnhancedIndicators

        closes = [100, 102, 101, 103, 105, 104, 106, 108, 107, 109,
                  111, 110, 112, 114, 113, 115, 117, 116, 118, 120]

        # canonical
        bb_canonical = calc_bollinger(closes, 20, 2.0)
        # backtest_engine delegated (returns series, take last)
        mid_s, upper_s, lower_s = calc_bollinger_bands(closes, 20, 2.0)
        # enhanced_indicators delegated (returns tuple)
        ei = EnhancedIndicators()
        upper_ei, mid_ei, lower_ei, pct_b_ei = ei.calc_bollinger(closes, 20, 2.0)

        check("canonical middle = backtest_engine last middle",
              abs(bb_canonical['middle'] - mid_s[-1]) < 0.01,
              f"canonical={bb_canonical['middle']}, bt={mid_s[-1]}")
        check("canonical middle = enhanced_indicators middle",
              abs(bb_canonical['middle'] - mid_ei) < 0.01,
              f"canonical={bb_canonical['middle']}, ei={mid_ei}")
        check("canonical upper = enhanced_indicators upper",
              abs(bb_canonical['upper'] - upper_ei) < 0.01)
        check("canonical lower = enhanced_indicators lower",
              abs(bb_canonical['lower'] - lower_ei) < 0.01)

    except Exception as e:
        check("delegation consistency", False, str(e))
        import traceback
        traceback.print_exc()


def main():
    print("=" * 70)
    print("BRAVO STAGE-8 — Integration Test Suite")
    print("Tests the unification work from STAGE-0 through STAGE-7")
    print("=" * 70)

    test_canonical_indicators()
    test_engine_shims()
    test_telegram_shim()
    test_quant_canonical()
    test_rule_67_compliance()
    test_delegation_consistency()

    print("\n" + "=" * 70)
    print(f"RESULT: {passed} passed, {failed} failed")
    print("=" * 70)
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
