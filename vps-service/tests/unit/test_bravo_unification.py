"""
BRAVO STAGE-8 — Integration Test Suite (pytest-compatible)
============================================================
اختبارات شاملة للـ unification اللي اتعمل في المراحل 0-7.

pytest-compatible: كل test function بـ يستخدم `assert` حقيقية (مش print).

تغطي:
1. Canonical indicators (RSI, ATR, Bollinger, MFI, ADX, VWAP, Volume Profile, SMA, EMA, MACD)
2. Engine unification shims (engine/ → engines/, glminvestment_engines/engines/ → engines/)
3. Core unification shim (telegram/database.py → telegram/telegram_db.py)
4. Quant canonical (fair_value, position_sizing, risk_reward, backtest_stats)
5. Rule 67 compliance (no new inline indicators)
6. Delegation consistency (canonical = delegated results)

Usage:
    python3 -m pytest tests/unit/test_bravo_unification.py -v
"""
import sys
import os
from pathlib import Path

# Setup path
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))


# ============================================================================
# 1. Canonical Indicators
# ============================================================================

def test_canonical_indicators_import():
    """كل الـ 13 canonical functions لازم تكون importable + callable."""
    from analyzers.indicators import (
        calc_rsi, calc_atr, calc_srsi, sma, ema, macd,
        calc_bollinger, calc_bollinger_series,
        calc_mfi, calc_adx, calc_vwap, calc_vwap_premium, calc_volume_profile
    )
    for func in [calc_rsi, calc_atr, calc_srsi, sma, ema, macd,
                 calc_bollinger, calc_bollinger_series,
                 calc_mfi, calc_adx, calc_vwap, calc_vwap_premium, calc_volume_profile]:
        assert callable(func), f"{func.__name__} is not callable"


def test_canonical_indicators_computation():
    """كل الـ canonical functions بترجع قيم صحيحة على بيانات اختبار."""
    from analyzers.indicators import (
        calc_rsi, calc_atr, sma, ema, macd,
        calc_bollinger, calc_mfi, calc_adx, calc_vwap, calc_volume_profile,
    )
    closes = [100, 102, 101, 103, 105, 104, 106, 108, 107, 109,
              111, 110, 112, 114, 113, 115, 117, 116, 118, 120]
    highs = [c + 1 for c in closes]
    lows = [c - 1 for c in closes]
    volumes = [1000 * (1 + i * 0.05) for i in range(len(closes))]

    # RSI
    rsi = calc_rsi(closes, 14)
    assert rsi is not None, "RSI returned None"
    assert 0 <= rsi <= 100, f"RSI out of range: {rsi}"
    assert rsi > 50, f"RSI should be > 50 on uptrend, got {rsi}"

    # ATR
    atr = calc_atr(highs, lows, closes, 14)
    assert atr is not None, "ATR returned None"
    assert atr > 0, f"ATR should be > 0, got {atr}"

    # Bollinger
    bb = calc_bollinger(closes, 20, 2.0)
    assert bb is not None, "Bollinger returned None"
    assert bb['upper'] > bb['middle'] > bb['lower'], \
        f"Bollinger order wrong: {bb}"
    assert 0 <= bb['percent_b'] <= 100, f"Bollinger %b out of range: {bb['percent_b']}"

    # MFI
    mfi = calc_mfi(highs, lows, closes, volumes, 14)
    assert mfi is not None, "MFI returned None"
    assert 0 <= mfi <= 100, f"MFI out of range: {mfi}"
    assert mfi > 50, f"MFI should be > 50 on uptrend+rising volume, got {mfi}"

    # ADX (need longer data — 2×period = 28 bars)
    closes_long = [100 + i * 0.5 for i in range(40)]
    highs_long = [c + 1 for c in closes_long]
    lows_long = [c - 1 for c in closes_long]
    adx = calc_adx(highs_long, lows_long, closes_long, 14)
    assert adx is not None, "ADX returned None"
    assert set(adx.keys()) == {'adx', 'plus_di', 'minus_di'}, f"ADX keys wrong: {set(adx.keys())}"
    assert 0 <= adx['adx'] <= 100, f"ADX out of range: {adx['adx']}"
    assert adx['plus_di'] > adx['minus_di'], \
        f"+DI should be > -DI on uptrend: {adx}"

    # VWAP
    vwap = calc_vwap(highs, lows, closes, volumes)
    assert vwap is not None, "VWAP returned None"
    assert vwap > 0, f"VWAP should be > 0, got {vwap}"
    expected_vwap = sum(((highs[i]+lows[i]+closes[i])/3) * volumes[i]
                        for i in range(len(closes))) / sum(volumes)
    assert abs(vwap - expected_vwap) < 0.01, f"VWAP mismatch: {vwap} vs {expected_vwap}"

    # Volume Profile
    vp = calc_volume_profile(closes, volumes, bins=10)
    assert vp is not None, "Volume Profile returned None"
    assert all(k in vp for k in ['poc', 'vah', 'val']), f"VP missing keys: {set(vp.keys())}"
    assert min(closes) <= vp['poc'] <= max(closes), f"POC out of range: {vp['poc']}"
    assert vp['vah'] >= vp['val'], f"VAH < VAL: {vp}"

    # SMA
    s20 = sma(closes, 20)
    assert s20 is not None, "SMA returned None"
    assert abs(s20 - sum(closes) / 20) < 0.01, f"SMA mismatch: {s20} vs {sum(closes)/20}"

    # EMA
    e12 = ema(closes, 12)
    assert e12 is not None, "EMA returned None"

    # MACD (needs 35+ bars)
    closes_macd = [100 + i * 0.5 + (i % 3) for i in range(50)]
    m = macd(closes_macd)
    assert m is not None, "MACD returned None"
    assert all(k in m for k in ['line', 'signal', 'histogram']), f"MACD keys: {set(m.keys())}"
    assert abs(m['histogram'] - (m['line'] - m['signal'])) < 0.01, "MACD histogram mismatch"


def test_canonical_indicators_edge_cases():
    """الـ canonical functions بترجع None على بيانات غير كافية."""
    from analyzers.indicators import (
        calc_rsi, calc_atr, calc_bollinger, calc_mfi, calc_adx,
        calc_vwap, calc_volume_profile,
    )
    assert calc_rsi([], 14) is None, "RSI([]) should be None"
    assert calc_rsi([1, 2], 14) is None, "RSI(short) should be None"
    assert calc_atr([], [], [], 14) is None, "ATR([]) should be None"
    assert calc_bollinger([1, 2, 3], 20) is None, "Bollinger(short) should be None"
    assert calc_mfi([1], [1], [1], [1], 14) is None, "MFI(short) should be None"
    assert calc_adx([1, 2], [1, 2], [1, 2], 14) is None, "ADX(short) should be None"
    assert calc_vwap([], [], [], []) is None, "VWAP([]) should be None"
    assert calc_volume_profile([], []) is None, "VolumeProfile([]) should be None"


# ============================================================================
# 2. Engine Unification Shims
# ============================================================================

def test_engine_shims_canonical_imports():
    """الـ canonical imports من engines/ بـ تشتغل."""
    from engines.flow_system import FlowSystemEngine
    from engines.atr_risk_engine import ATRRiskConfig
    from engines.backtest_engine import calc_sma, calc_bollinger_bands
    assert FlowSystemEngine is not None
    assert ATRRiskConfig is not None
    assert callable(calc_sma)
    assert callable(calc_bollinger_bands)


def test_engine_shims_backward_compat():
    """الـ old imports (engine.X, glminvestment_engines.engines) بـ تشتغل عبر shims."""
    # old path via shim
    from engine.flow_system import FlowSystemEngine as FSE_old
    from engines.flow_system import FlowSystemEngine as FSE_canonical
    assert FSE_old is FSE_canonical, "engine shim should re-export same object"

    # glminvestment_engines.engines package shim
    from glminvestment_engines.engines import analyze_atr_risk, detect_vcp
    assert callable(analyze_atr_risk), "analyze_atr_risk not callable"
    assert callable(detect_vcp), "detect_vcp not callable"


# ============================================================================
# 3. Telegram Database Shim
# ============================================================================

def test_telegram_shim():
    """telegram/database.py shim بـ re-export من telegram_db.py."""
    from telegram.telegram_db import db_manager
    from telegram.database import db_manager as dm2
    assert db_manager is dm2, "telegram shim should re-export same object"


# ============================================================================
# 4. Quant Canonical Functions
# ============================================================================

def test_quant_fair_value():
    """utils/fair_value.py — calc_fundamental_fair_value + calc_upside_percent + calc_vwap_fair_value."""
    from utils.fair_value import (
        calc_fundamental_fair_value, calc_upside_percent, calc_vwap_fair_value
    )
    # fundamental: median(PE×EPS, BV×1.5) = median(37.5, 30.0) = 33.75
    # (BRAVO FIX: changed from max to median per Jimmy's review — max was magnifying outliers)
    fv = calc_fundamental_fair_value(pe_ratio=15, eps=2.5, book_value_per_share=20)
    assert fv == 33.75, f"fair_value: expected 33.75 (median), got {fv}"

    # ma_200 fallback (single candidate → median = the value itself)
    fv2 = calc_fundamental_fair_value(pe_ratio=None, eps=None, book_value_per_share=None, ma_200=150)
    assert fv2 == 150.0, f"ma_200 fallback: expected 150, got {fv2}"

    # upside
    upside = calc_upside_percent(fair_value=120, current_price=100)
    assert upside == 20.0, f"upside: expected 20, got {upside}"

    # vwap fair_value
    highs = [101, 103, 102, 104, 106]
    lows = [99, 101, 100, 102, 104]
    closes = [100, 102, 101, 103, 105]
    volumes = [1000, 1100, 900, 1200, 1500]
    fv_vwap, premium = calc_vwap_fair_value(highs, lows, closes, volumes, period=5)
    assert fv_vwap is not None, "vwap fair_value should not be None"
    assert fv_vwap > 0, f"vwap fair_value should be > 0, got {fv_vwap}"

    # Rule 27 (NO-FAKE-DATA): empty data → (None, None) not (0.0, 0.0)
    fv_empty, prem_empty = calc_vwap_fair_value([], [], [], [], period=5)
    assert fv_empty is None, f"empty data should return None, got {fv_empty}"
    assert prem_empty is None, f"empty data premium should return None, got {prem_empty}"


def test_quant_position_sizing():
    """utils/position_sizing.py — calculate_risk_based_position + calculate_kelly_position."""
    from utils.position_sizing import (
        calculate_risk_based_position, calculate_kelly_position
    )
    # risk-based (with 25% cap)
    result = calculate_risk_based_position(capital=10000, entry=100, stop=94, risk_pct=2.0)
    assert result is not None, "position sizing returned None"
    assert result['position_pct'] == 25.0, f"position_pct should be 25 (capped), got {result['position_pct']}"
    assert result['risk_per_share'] == 6.0, f"risk_per_share should be 6, got {result['risk_per_share']}"

    # invalid (stop >= entry for BUY)
    invalid = calculate_risk_based_position(capital=10000, entry=100, stop=105, risk_pct=2.0)
    assert invalid is None, "invalid position should return None"

    # Kelly: 60% WR, 2:1 R:R, Half Kelly
    # Kelly % = 0.6 - (1-0.6)/2.0 = 0.6 - 0.2 = 0.4 → 40%
    # Half Kelly = 20%
    kelly = calculate_kelly_position(win_rate=0.6, win_loss_ratio=2.0, capital=10000, kelly_fraction=0.5)
    assert kelly is not None, "Kelly returned None"
    assert abs(kelly['kelly_pct'] - 40.0) < 0.1, f"Kelly %: expected 40, got {kelly['kelly_pct']}"
    assert abs(kelly['position_pct'] - 20.0) < 0.1, f"Kelly position_pct: expected 20, got {kelly['position_pct']}"

    # BRAVO FIX (Jimmy issue #1): kelly position_size = shares (not value) when entry provided
    kelly_with_entry = calculate_kelly_position(
        win_rate=0.6, win_loss_ratio=2.0, capital=10000,
        kelly_fraction=0.5, entry=100
    )
    assert kelly_with_entry is not None
    # position_value = 10000 × 20% = 2000, position_size (shares) = 2000 / 100 = 20
    assert kelly_with_entry['position_value'] == 2000.0
    assert kelly_with_entry['position_size'] == 20.0, \
        f"kelly position_size should be shares (20), got {kelly_with_entry['position_size']}"

    # without entry → position_size = position_value (backward compat)
    kelly_no_entry = calculate_kelly_position(
        win_rate=0.6, win_loss_ratio=2.0, capital=10000, kelly_fraction=0.5
    )
    assert kelly_no_entry['position_size'] == kelly_no_entry['position_value']


def test_no_fake_data_fallbacks():
    """Rule 27 (NO-FAKE-DATA) — fallbacks بـ return None مش fabricated values."""
    from analyzers.enhanced_indicators import EnhancedIndicators
    from analyzers.core_scoring_engine import calc_bollinger as cse_bb
    from engines.backtest_engine import calc_bollinger_bands

    ei = EnhancedIndicators()

    # insufficient data → None (not fabricated values)
    short_closes = [100, 102, 101]  # only 3 bars, need 20

    # enhanced_indicators
    bb_ei = ei.calc_bollinger(short_closes, 20, 2.0)
    assert bb_ei[0] is None, f"enhanced_indicators Bollinger should return None, got {bb_ei}"

    atr_ei = ei.calc_atr([101], [99], [100], 14)
    assert atr_ei is None, f"enhanced_indicators ATR should return None, got {atr_ei}"

    adx_ei = ei.calc_adx([101], [99], [100], 14)
    assert adx_ei[0] is None, f"enhanced_indicators ADX should return None, got {adx_ei}"

    # core_scoring_engine
    upper, mid, lower = cse_bb(short_closes, 20)
    assert upper is None, f"core_scoring_engine Bollinger should return None, got {(upper, mid, lower)}"

    # backtest_engine
    mid_s, upper_s, lower_s = calc_bollinger_bands(short_closes, 20, 2.0)
    # first 19 entries should be None (not fabricated)
    assert mid_s[0] is None, f"backtest_engine Bollinger[0] should be None, got {mid_s[0]}"


def test_indicator_edge_cases_fixed():
    """BRAVO FIX (Jimmy issues #4 + #5) — edge cases for period=0 + negative bin_idx."""
    from analyzers.indicators import calc_vwap, calc_volume_profile

    closes = [100, 102, 101, 103, 105]
    highs = [c + 1 for c in closes]
    lows = [c - 1 for c in closes]
    volumes = [1000, 1100, 900, 1200, 1500]

    # calc_vwap period=0 → None (not full list)
    vwap_zero = calc_vwap(highs, lows, closes, volumes, period=0)
    assert vwap_zero is None, f"calc_vwap(period=0) should return None, got {vwap_zero}"

    # calc_vwap period=-1 → None
    vwap_neg = calc_vwap(highs, lows, closes, volumes, period=-1)
    assert vwap_neg is None, f"calc_vwap(period=-1) should return None, got {vwap_neg}"

    # calc_volume_profile — normal case (no negative bin_idx)
    vp = calc_volume_profile(closes, volumes, bins=5)
    assert vp is not None, "Volume Profile should work on normal data"
    assert vp['poc'] > 0


# ============================================================================
# 5. Rule 67 Compliance
# ============================================================================

def test_rule_67_compliance():
    """مفيش inline indicator calculations جديدة خارج analyzers/indicators/."""
    # import الـ check function من test_canonical_compliance
    from tests.unit.test_canonical_compliance import check_no_new_inline
    violations = check_no_new_inline()
    assert not violations, (
        f"Found {len(violations)} inline indicator calculation(s) outside "
        f"analyzers/indicators/ (Rule 67 violation):\n"
        + "\n".join(
            f"  {v['file']}:{v['line']} — {v['indicator']}: {v['snippet']}"
            for v in violations[:5]
        )
    )


# ============================================================================
# 6. Delegation Consistency
# ============================================================================

def test_delegation_consistency_bollinger():
    """canonical calc_bollinger = backtest_engine.calc_bollinger_bands = enhanced_indicators.calc_bollinger."""
    from analyzers.indicators.bollinger import calc_bollinger
    from engines.backtest_engine import calc_bollinger_bands
    from analyzers.enhanced_indicators import EnhancedIndicators

    closes = [100, 102, 101, 103, 105, 104, 106, 108, 107, 109,
              111, 110, 112, 114, 113, 115, 117, 116, 118, 120]

    bb_canonical = calc_bollinger(closes, 20, 2.0)
    mid_s, upper_s, lower_s = calc_bollinger_bands(closes, 20, 2.0)
    ei = EnhancedIndicators()
    upper_ei, mid_ei, lower_ei, pct_b_ei = ei.calc_bollinger(closes, 20, 2.0)

    assert abs(bb_canonical['middle'] - mid_s[-1]) < 0.01, \
        f"canonical middle {bb_canonical['middle']} != backtest_engine {mid_s[-1]}"
    assert abs(bb_canonical['middle'] - mid_ei) < 0.01, \
        f"canonical middle {bb_canonical['middle']} != enhanced_indicators {mid_ei}"
    assert abs(bb_canonical['upper'] - upper_ei) < 0.01, \
        f"canonical upper {bb_canonical['upper']} != enhanced_indicators {upper_ei}"
    assert abs(bb_canonical['lower'] - lower_ei) < 0.01, \
        f"canonical lower {bb_canonical['lower']} != enhanced_indicators {lower_ei}"


def test_delegation_consistency_fair_value():
    """engines/backtest_engine.calc_fair_value = utils.fair_value.calc_vwap_fair_value."""
    from engines.backtest_engine import calc_fair_value as bt_fair_value
    from utils.fair_value import calc_vwap_fair_value

    highs = [101, 103, 102, 104, 106, 105, 107, 109, 108, 110]
    lows = [99, 101, 100, 102, 104, 103, 105, 107, 106, 108]
    closes = [100, 102, 101, 103, 105, 104, 106, 108, 107, 109]
    volumes = [1000, 1100, 900, 1200, 1500, 1000, 1300, 1600, 1100, 1400]

    fv_bt, prem_bt = bt_fair_value(highs, lows, closes, volumes, period=10)
    fv_canonical, prem_canonical = calc_vwap_fair_value(highs, lows, closes, volumes, period=10)
    assert fv_bt == fv_canonical, f"fair_value mismatch: bt={fv_bt} vs canonical={fv_canonical}"
