"""
test_risk_profile.py — اختبارات الـ RiskProfile dataclass (Phase 5 Task 1)
============================================================================

الموضوع:
    الـ RiskProfile (في analyzers/risk_adaptive.py) بيـ auto-derive الـ direction
    من الـ signal في __post_init__، وبعدين بيصحّح الـ target/stop لو معكوسين.

    لازم نتأكد إن:
      1. SELL family signals (SELL/STRONG_SELL/REDUCE/SHORT/WEAK_SELL/BEARISH/UNDERWEIGHT)
         بتحوّل direction → 'SHORT'.
      2. BUY family signals (BUY/STRONG_BUY/ACCUMULATE/WEAK_BUY/BULLISH/OVERWEIGHT)
         بتحوّل direction → 'LONG'.
      3. LONG + target تحت entry → الـ __post_init__ بيصحّحه فوق (entry * 1.05).
      4. LONG + stop فوق entry → بيصحّحه تحت (entry * 0.95).
      5. SHORT + target فوق entry → بيصحّحه تحت (entry * 0.95).
      6. SHORT + stop تحت entry → بيصحّحه فوق (entry * 1.05).
      7. الـ warnings بتتكتب لما يحصل تصحيح.

التشغيل:
    cd vps-service && python3 -m pytest tests/test_risk_profile.py -v
"""
from __future__ import annotations

import pytest

from analyzers.risk_adaptive import RiskProfile, SELL_SIGNALS, _direction_from_signal


# ---------------------------------------------------------------------------
# Helper: بناء RiskProfile بأقل الـ args الممكنة
# ---------------------------------------------------------------------------

def _make_risk_profile(
    signal: str = 'BUY',
    entry_price: float = 100.0,
    target_price: float | None = None,
    stop_loss_price: float | None = None,
    direction: str = 'LONG',
    risk_reward_ratio: float = 2.0,
    **overrides,
) -> RiskProfile:
    """ابني RiskProfile بـ defaults معقولة (position sizing + ATR-based stops)."""
    # اشتق القيم الافتراضية من الـ entry
    if target_price is None:
        target_price = entry_price * 1.05  # فوق بـ 5% (LONG)
    if stop_loss_price is None:
        stop_loss_price = entry_price * 0.95  # تحت بـ 5% (LONG)

    defaults = {
        'signal': signal,
        'entry_price': entry_price,
        'position_size_pct': 5.0,
        'max_shares': 100,
        'stop_loss_price': stop_loss_price,
        'stop_loss_pct': 0.05,
        'stop_type': 'FIXED',
        'target_price': target_price,
        'target_pct': 0.05,
        'risk_reward_ratio': risk_reward_ratio,
        'time_stop_days': 14,
        'volatility_adjustment': 1.0,
        'liquidity_adjustment': 1.0,
        'warnings': [],
        'direction': direction,
    }
    defaults.update(overrides)
    return RiskProfile(**defaults)


# ---------------------------------------------------------------------------
# 1) Direction auto-derivation from signal
# ---------------------------------------------------------------------------

@pytest.mark.parametrize('signal', sorted(SELL_SIGNALS))
def test_sell_family_signals_become_short(signal: str):
    """كل إشارات البيع المُعرَّفة لازم تحوّل direction → 'SHORT'."""
    # حتى لو caller بعت direction='LONG' بالغلط مع signal='SELL'
    rp = _make_risk_profile(
        signal=signal,
        entry_price=100.0,
        target_price=95.0,    # تحت (بيع)
        stop_loss_price=105.0,  # فوق (بيع)
        direction='LONG',  # غلط عمدًا — الـ __post_init__ لازم يصحّحه
    )
    assert rp.direction == 'SHORT', (
        f"signal={signal!r} must set direction='SHORT', got {rp.direction!r}"
    )


@pytest.mark.parametrize('signal', ['BUY', 'STRONG_BUY', 'ACCUMULATE', 'WEAK_BUY', 'BULLISH', 'OVERWEIGHT'])
def test_buy_family_signals_become_long(signal: str):
    """كل إشارات الشراء لازم تحوّل direction → 'LONG'."""
    rp = _make_risk_profile(
        signal=signal,
        entry_price=100.0,
        target_price=105.0,    # فوق (شراء)
        stop_loss_price=95.0,  # تحت (شراء)
        direction='LONG',
    )
    assert rp.direction == 'LONG', (
        f"signal={signal!r} must set direction='LONG', got {rp.direction!r}"
    )


def test_hold_signal_keeps_explicit_direction():
    """HOLD (محايد) ما يغيّرش الـ direction اللي اتمرّر صراحة."""
    rp = _make_risk_profile(
        signal='HOLD',
        direction='LONG',
        target_price=105.0,
        stop_loss_price=95.0,
    )
    assert rp.direction == 'LONG'


def test_direction_from_signal_helper():
    """الـ helper function بيرجّع 'SHORT' للـ SELL family و 'LONG' لأي حاجة تانية."""
    for s in SELL_SIGNALS:
        assert _direction_from_signal(s) == 'SHORT'
    assert _direction_from_signal('BUY') == 'LONG'
    assert _direction_from_signal('') == 'LONG'
    assert _direction_from_signal('HOLD') == 'LONG'


# ---------------------------------------------------------------------------
# 2) LONG branch: __post_init__ corrects inverted values
# ---------------------------------------------------------------------------

def test_long_inverted_target_gets_corrected_above():
    """LONG + target <= entry → الـ __post_init__ بيحط target فوق (entry * 1.05)."""
    rp = _make_risk_profile(
        signal='BUY',
        entry_price=100.0,
        target_price=90.0,   # معكوس (تحت)
        stop_loss_price=95.0,  # صح (تحت)
        direction='LONG',
    )
    assert rp.target_price == pytest.approx(105.0, abs=0.01), \
        f"LONG target must be corrected to entry*1.05=105.0, got {rp.target_price}"
    assert rp.target_price > rp.entry_price
    # لازم يتكتب warning
    assert any('LONG target' in w for w in rp.warnings), \
        f"Expected a warning about LONG target correction, got: {rp.warnings}"


def test_long_inverted_stop_gets_corrected_below():
    """LONG + stop >= entry → الـ __post_init__ بيحط stop تحت (entry * 0.95)."""
    rp = _make_risk_profile(
        signal='BUY',
        entry_price=100.0,
        target_price=105.0,  # صح (فوق)
        stop_loss_price=110.0,  # معكوس (فوق)
        direction='LONG',
    )
    assert rp.stop_loss_price == pytest.approx(95.0, abs=0.01), \
        f"LONG stop must be corrected to entry*0.95=95.0, got {rp.stop_loss_price}"
    assert rp.stop_loss_price < rp.entry_price
    assert any('LONG stop' in w for w in rp.warnings)


def test_long_correct_values_are_unchanged():
    """LONG + target فوق + stop تحت → ما يتعدّلش حاجة (مفيش warnings)."""
    rp = _make_risk_profile(
        signal='BUY',
        entry_price=100.0,
        target_price=110.0,
        stop_loss_price=95.0,
        direction='LONG',
    )
    assert rp.target_price == 110.0
    assert rp.stop_loss_price == 95.0
    assert not any('RiskProfile' in w for w in rp.warnings)


# ---------------------------------------------------------------------------
# 3) SHORT branch: __post_init__ corrects inverted values
# ---------------------------------------------------------------------------

def test_short_inverted_target_gets_corrected_below():
    """SHORT + target >= entry → الـ __post_init__ بيحط target تحت (entry * 0.95)."""
    rp = _make_risk_profile(
        signal='SELL',
        entry_price=100.0,
        target_price=110.0,  # معكوس (فوق) — ده كان الـ bug
        stop_loss_price=105.0,  # صح (فوق)
        direction='SHORT',
    )
    assert rp.target_price == pytest.approx(95.0, abs=0.01), \
        f"SHORT target must be corrected to entry*0.95=95.0, got {rp.target_price}"
    assert rp.target_price < rp.entry_price
    assert any('SHORT target' in w for w in rp.warnings)


def test_short_inverted_stop_gets_corrected_above():
    """SHORT + stop <= entry → الـ __post_init__ بيحط stop فوق (entry * 1.05)."""
    rp = _make_risk_profile(
        signal='SELL',
        entry_price=100.0,
        target_price=95.0,  # صح (تحت)
        stop_loss_price=90.0,  # معكوس (تحت) — ده كان الـ bug
        direction='SHORT',
    )
    assert rp.stop_loss_price == pytest.approx(105.0, abs=0.01), \
        f"SHORT stop must be corrected to entry*1.05=105.0, got {rp.stop_loss_price}"
    assert rp.stop_loss_price > rp.entry_price
    assert any('SHORT stop' in w for w in rp.warnings)


def test_short_correct_values_are_unchanged():
    """SHORT + target تحت + stop فوق → ما يتعدّلش حاجة."""
    rp = _make_risk_profile(
        signal='SELL',
        entry_price=100.0,
        target_price=90.0,
        stop_loss_price=105.0,
        direction='SHORT',
    )
    assert rp.target_price == 90.0
    assert rp.stop_loss_price == 105.0
    assert not any('RiskProfile' in w for w in rp.warnings)


# ---------------------------------------------------------------------------
# 4) is_valid_trade() reflects direction
# ---------------------------------------------------------------------------

def test_is_valid_trade_long_with_good_rr():
    """LONG trade بـ R:R ≥ 1.5 + target فوق + stop تحت = valid."""
    rp = _make_risk_profile(
        signal='BUY',
        entry_price=100.0,
        target_price=110.0,
        stop_loss_price=95.0,
        risk_reward_ratio=2.0,
        direction='LONG',
    )
    assert rp.is_valid_trade() is True


def test_is_valid_trade_rejects_low_rr():
    """R:R < 1.5 = reject (مفيش trader محترف يقبل أقل)."""
    rp = _make_risk_profile(
        signal='BUY',
        entry_price=100.0,
        target_price=102.0,  # R:R ضعيف
        stop_loss_price=98.0,
        risk_reward_ratio=1.0,
        direction='LONG',
    )
    assert rp.is_valid_trade() is False


# ---------------------------------------------------------------------------
# 5) Edge: entry_price = 0 (skip validation gracefully)
# ---------------------------------------------------------------------------

def test_zero_entry_skips_validation():
    """لو entry_price=0، الـ __post_init__ ما يصحّحش (ما يرفعش exception)."""
    rp = _make_risk_profile(
        signal='BUY',
        entry_price=0.0,
        target_price=0.0,
        stop_loss_price=0.0,
        direction='LONG',
    )
    # ما يرفعش exception + القيم زي ما هي
    assert rp.entry_price == 0.0
    assert rp.target_price == 0.0
    assert rp.stop_loss_price == 0.0


# ---------------------------------------------------------------------------
# 6) to_dict() serializes properly
# ---------------------------------------------------------------------------

def test_to_dict_contains_all_fields():
    """to_dict() لازم يرجّع كل الـ fields الأساسية."""
    rp = _make_risk_profile(
        signal='BUY',
        entry_price=100.0,
        target_price=110.0,
        stop_loss_price=95.0,
        direction='LONG',
    )
    d = rp.to_dict()
    assert 'signal' in d
    assert 'direction' in d
    assert 'entry_price' in d
    assert 'stop_loss_price' in d
    assert 'target_price' in d
    assert 'risk_reward_ratio' in d
    assert d['direction'] == 'LONG'
