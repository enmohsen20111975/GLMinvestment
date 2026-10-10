"""
test_v20_fusion.py — اختبارات الـ V20 Fusion Engine (Phase 5 Task 1)
======================================================================

الموضوع:
    الـ FusionEngineV20 (في analyzers/fusion_engine.py) بيحسب:
      1. Fusion Score (0-100) — score لازم يكون بين 0 و 100.
      2. Risk Profile (1.5R / 3.0R) — entry + sl + tp1 (1.5R) + tp2 (3.0R).

    لازم نتأكد إن:
      - الـ score bounded بين 0 و 100 (حتى لو كل الـ signals شغّالة).
      - الـ LONG risk: sl < entry < tp1 < tp2.
      - الـ SHORT risk: tp2 < tp1 < entry < sl.
      - الـ R:R ratio = 1.5 لـ tp1 و 3.0 لـ tp2.
      - الـ score_to_signal() بيـ map صح (≥70 → STRONG_BUY, ≥50 → ACCUMULATE, else WAIT).

التشغيل:
    cd vps-service && python3 -m pytest tests/test_v20_fusion.py -v
"""
from __future__ import annotations

import random
from typing import List

import pytest

# الـ fusion engine بيستخدم pandas/numpy لو متاحين. الاختبار لازم يـ skip
# لو الـ deps مش موجودة (HAS_PANDAS = False).
pd = pytest.importorskip('pandas')
np = pytest.importorskip('numpy')

from analyzers.fusion_engine import FusionEngineV20, calculate_fusion_metrics


# ---------------------------------------------------------------------------
# Helpers: توليد OHLCV عشوائي (mock data)
# ---------------------------------------------------------------------------

def _make_ohlcv(n: int = 150, base_price: float = 100.0, seed: int = 42) -> List[dict]:
    """ولّد n شمعة OHLCV عشوائية بس realistic (random walk)."""
    rng = random.Random(seed)
    candles: List[dict] = []
    price = base_price
    for i in range(n):
        # random walk بـ volatility ~2%
        drift = rng.uniform(-0.02, 0.025)
        open_p = price
        close_p = max(0.5, price * (1.0 + drift))
        high_p = max(open_p, close_p) * (1.0 + rng.uniform(0.0, 0.015))
        low_p = min(open_p, close_p) * (1.0 - rng.uniform(0.0, 0.015))
        vol = rng.randint(10000, 500000)
        candles.append({
            'open': round(open_p, 4),
            'high': round(high_p, 4),
            'low': round(low_p, 4),
            'close': round(close_p, 4),
            'volume': vol,
            'date': f'2026-01-{i + 1:02d}',
        })
        price = close_p
    return candles


@pytest.fixture
def ohlcv_150() -> List[dict]:
    """150 شمعة OHLCV (كافية لكل الـ calculations)."""
    return _make_ohlcv(n=150, base_price=100.0, seed=42)


@pytest.fixture
def fusion_engine(ohlcv_150) -> FusionEngineV20:
    """FusionEngineV20 جاهز بالـ 150 شمعة."""
    return FusionEngineV20(ohlcv_150)


# ---------------------------------------------------------------------------
# 1) Fusion Score bounded 0-100
# ---------------------------------------------------------------------------

def test_fusion_score_within_bounds_with_all_signals(fusion_engine: FusionEngineV20):
    """حتى لو كل الـ signals شغّالة (trend + BOS + vol + RSI + BB)،
    الـ score لازم يكون بين 0 و 100."""
    score, bb_data, fair_value, fair_premium, risk = fusion_engine.calculate_fusion_score(
        smc_data={'broke_resist': True, 'sweep_low': True, 'active_ob_low': 95.0},
        rsi=62.0,
        vol_ratio=1.5,
        trend_up=True,
        atr_val=1.5,
        current_price=100.0,
    )
    assert 0.0 <= score <= 100.0, f"score={score} must be within [0, 100]"
    # مع trend_up (+30) + BOS (+40) + vol (+15) + RSI (+15)، الـ score لازم يكون عالي
    assert score >= 70.0, f"with all bullish signals, score should be ≥ 70, got {score}"


def test_fusion_score_zero_with_no_signals(fusion_engine: FusionEngineV20):
    """من غير أي signals (no trend, no SMC, no vol, RSI محايد)،
    الـ score لازم يكون قريب من 0 (الـ premium penalty ممكن يخفضه تحت 0 بس بنـ clamp)."""
    score, _, _, _, _ = fusion_engine.calculate_fusion_score(
        smc_data={},  # لا BOS ولا sweep
        rsi=50.0,  # خارج الـ healthy range (50-75 strict)
        vol_ratio=1.0,  # متوسط
        trend_up=False,  # لا اتجاه
        atr_val=1.5,
        current_price=100.0,
    )
    assert 0.0 <= score <= 100.0
    # من غير trend + من غير SMC، الـ score لازم يكون منخفض
    # (ممكن ياخد +10 لو BB trend صاعد، أو +15 لو في_pocket، بس عموماً < 50)
    assert score < 50.0, f"without signals, score should be low (< 50), got {score}"


def test_fusion_score_clamped_to_100_max(fusion_engine: FusionEngineV20):
    """لو الـ score تجاوز 100 (محال نظرياً بس لو فيه bonus items)،
    الـ clamp لازم يثبّته عند 100."""
    # max possible: 30 (trend) + 40 (BOS) + 15 (vol) + 15 (RSI) + 10 (premium)
    # + 10 (BB) + 15 (pocket) = 135 → clamp to 100
    score, _, _, _, _ = fusion_engine.calculate_fusion_score(
        smc_data={'broke_resist': True, 'sweep_low': False, 'active_ob_low': 95.0},
        rsi=60.0,
        vol_ratio=2.0,
        trend_up=True,
        atr_val=1.5,
        current_price=100.0,
    )
    assert score <= 100.0


# ---------------------------------------------------------------------------
# 2) Risk Profile (LONG) — entry + sl + tp1 (1.5R) + tp2 (3.0R)
# ---------------------------------------------------------------------------

def test_long_risk_profile_structure(fusion_engine: FusionEngineV20):
    """LONG risk profile: sl < entry < tp1 < tp2 + R:R = 1.5 و 3.0."""
    entry_price = 100.0
    atr = 1.5
    score, _, _, _, risk = fusion_engine.calculate_fusion_score(
        smc_data={'active_ob_low': 95.0},  # OB تحت entry
        rsi=60.0,
        vol_ratio=1.3,
        trend_up=True,
        atr_val=atr,
        current_price=entry_price,
    )
    assert risk['direction'] == 'LONG'
    assert risk['entry'] == pytest.approx(entry_price, abs=0.01)
    # LONG: sl تحت entry
    assert risk['sl'] < risk['entry'], \
        f"LONG sl ({risk['sl']}) must be < entry ({risk['entry']})"
    # tp1 و tp2 فوق entry
    assert risk['tp1'] > risk['entry']
    assert risk['tp2'] > risk['entry']
    assert risk['tp2'] > risk['tp1']
    # R:R ratios
    assert risk['rr_ratio_tp1'] == pytest.approx(1.5, abs=0.05), \
        f"tp1 R:R should be ~1.5, got {risk['rr_ratio_tp1']}"
    assert risk['rr_ratio_tp2'] == pytest.approx(3.0, abs=0.05), \
        f"tp2 R:R should be ~3.0, got {risk['rr_ratio_tp2']}"


def test_long_risk_with_order_block_stop(fusion_engine: FusionEngineV20):
    """لو فيه active_ob_low، الـ sl لازم يكون تحت الـ OB (sl = ob - atr*0.5)."""
    entry_price = 100.0
    ob_low = 95.0
    atr = 1.5
    expected_sl = ob_low - (atr * 0.5)  # 94.25
    _, _, _, _, risk = fusion_engine.calculate_fusion_score(
        smc_data={'active_ob_low': ob_low},
        rsi=60.0,
        vol_ratio=1.3,
        trend_up=True,
        atr_val=atr,
        current_price=entry_price,
    )
    assert risk['sl'] == pytest.approx(expected_sl, abs=0.01), \
        f"LONG sl should be ob_low - atr*0.5 = {expected_sl}, got {risk['sl']}"


def test_long_risk_with_atr_fallback_stop(fusion_engine: FusionEngineV20):
    """لو مفيش OB، الـ sl لازم يكون entry - atr*1.5 (fallback)."""
    entry_price = 100.0
    atr = 2.0
    expected_sl = entry_price - (atr * 1.5)  # 97.0
    _, _, _, _, risk = fusion_engine.calculate_fusion_score(
        smc_data={},  # مفيش OB
        rsi=60.0,
        vol_ratio=1.3,
        trend_up=True,
        atr_val=atr,
        current_price=entry_price,
    )
    assert risk['sl'] == pytest.approx(expected_sl, abs=0.01), \
        f"LONG sl fallback should be entry - atr*1.5 = {expected_sl}, got {risk['sl']}"


# ---------------------------------------------------------------------------
# 3) Risk Profile (SHORT) — direction-aware via signal
# ---------------------------------------------------------------------------

def test_short_risk_profile_structure(fusion_engine: FusionEngineV20):
    """SHORT risk profile (via _calculate_risk_profile(signal='SELL')):
    tp2 < tp1 < entry < sl."""
    entry_price = 100.0
    atr = 1.5
    # _calculate_risk_profile بياخد signal مباشرة (مش من calculate_fusion_score)
    risk = fusion_engine._calculate_risk_profile(
        smc_data={'active_ob_high': 105.0},  # OB فوق entry
        atr_val=atr,
        current_price=entry_price,
        signal='SELL',
    )
    assert risk['direction'] == 'SHORT'
    assert risk['entry'] == pytest.approx(entry_price, abs=0.01)
    # SHORT: sl فوق entry
    assert risk['sl'] > risk['entry'], \
        f"SHORT sl ({risk['sl']}) must be > entry ({risk['entry']})"
    # tp1 و tp2 تحت entry
    assert risk['tp1'] < risk['entry']
    assert risk['tp2'] < risk['entry']
    assert risk['tp2'] < risk['tp1']
    # R:R ratios (SHORT: R:R = (entry - tp) / risk_amount)
    assert risk['rr_ratio_tp1'] == pytest.approx(1.5, abs=0.05), \
        f"SHORT tp1 R:R should be ~1.5, got {risk['rr_ratio_tp1']}"
    assert risk['rr_ratio_tp2'] == pytest.approx(3.0, abs=0.05), \
        f"SHORT tp2 R:R should be ~3.0, got {risk['rr_ratio_tp2']}"


# ---------------------------------------------------------------------------
# 4) score_to_signal() mapping
# ---------------------------------------------------------------------------

def test_score_to_signal_mapping():
    """score_to_signal: ≥70 → STRONG_BUY, ≥50 → ACCUMULATE, else WAIT."""
    assert FusionEngineV20.score_to_signal(85.0) == ('STRONG_BUY', 'شراء قوي')
    assert FusionEngineV20.score_to_signal(70.0) == ('STRONG_BUY', 'شراء قوي')
    assert FusionEngineV20.score_to_signal(55.0) == ('ACCUMULATE', 'تجميع')
    assert FusionEngineV20.score_to_signal(50.0) == ('ACCUMULATE', 'تجميع')
    assert FusionEngineV20.score_to_signal(30.0) == ('WAIT', 'انتظار')
    assert FusionEngineV20.score_to_signal(0.0) == ('WAIT', 'انتظار')


# ---------------------------------------------------------------------------
# 5) Convenience function: calculate_fusion_metrics()
# ---------------------------------------------------------------------------

def test_calculate_fusion_metrics_convenience_function(ohlcv_150):
    """calculate_fusion_metrics (module-level) بيرجّع dict فيه كل الـ metrics.

    Note: على عكس calculate_fusion_score (اللي بترجّع tuple)، الـ convenience
    function دي بترجّع dict مرتب (score + signal + bigbeluga + risk + ...).
    """
    result = calculate_fusion_metrics(
        ohlcv=ohlcv_150,
        smc_data={'broke_resist': True, 'active_ob_low': 95.0},
        rsi=62.0,
        vol_ratio=1.5,
        trend_up=True,
        atr_val=1.5,
        current_price=100.0,
    )
    # الـ return: dict فيه score + signal + bigbeluga + risk + ...
    assert isinstance(result, dict)
    assert 'score' in result
    assert 'signal' in result
    assert 'signal_ar' in result
    assert 'bigbeluga' in result
    assert 'risk' in result
    assert 'fair_value' in result
    assert 'fair_premium' in result
    assert 'ready' in result
    # الـ score bounded
    assert 0.0 <= result['score'] <= 100.0
    # الـ signal مأخوذ من score_to_signal
    assert result['signal'] in ('STRONG_BUY', 'ACCUMULATE', 'WAIT')
    # الـ risk فيه entry + sl + tp1 + tp2
    risk = result['risk']
    assert isinstance(risk, dict)
    assert 'entry' in risk
    assert 'sl' in risk
    assert 'tp1' in risk
    assert 'tp2' in risk


# ---------------------------------------------------------------------------
# 6) Empty / minimal data handling (degraded mode)
# ---------------------------------------------------------------------------

def test_engine_handles_empty_ohlcv():
    """لو الـ OHLCV فاضي، الـ engine ما يقعش (degraded mode)."""
    engine = FusionEngineV20([])
    # حتى لو الـ df فاضي، الـ calculate_fusion_score لازم تـ fall back
    score, _, _, _, risk = engine.calculate_fusion_score(
        smc_data={'broke_resist': True},
        rsi=60.0,
        vol_ratio=1.5,
        trend_up=True,
        atr_val=1.5,
        current_price=100.0,
    )
    assert 0.0 <= score <= 100.0
    assert risk['entry'] == 100.0


def test_engine_handles_short_ohlcv():
    """لو الـ OHLCV أقل من 100 شمعة، الـ engine بيـ fall back لـ minimal mode."""
    short_ohlcv = _make_ohlcv(n=30, base_price=50.0, seed=7)
    engine = FusionEngineV20(short_ohlcv)
    score, _, _, _, risk = engine.calculate_fusion_score(
        smc_data={'broke_resist': True},
        rsi=60.0,
        vol_ratio=1.5,
        trend_up=True,
        atr_val=1.0,
        current_price=50.0,
    )
    assert 0.0 <= score <= 100.0
    assert risk['entry'] == 50.0
