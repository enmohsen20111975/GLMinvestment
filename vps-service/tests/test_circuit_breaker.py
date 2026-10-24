"""
test_circuit_breaker.py — اختبارات الـ CircuitBreaker (Phase 5 Task 1)
========================================================================

الموضوع:
    الـ CircuitBreaker (Phase 4 Task 1) بياخد 3 حالات:
        CLOSED → OPEN → HALF_OPEN → CLOSED | OPEN

    لازم نتأكد إن:
      1. الـ initial state = CLOSED.
      2. الـ failures تحت الـ threshold بتفضل CLOSED.
      3. الـ threshold (5 failures) بيفتح الـ circuit → OPEN.
      4. الـ OPEN بيرفض الطلبات (Fail Fast) ويرفع CircuitOpenError.
      5. بعد الـ cool-down بيتحوّل لـ HALF_OPEN.
      6. الـ HALF_OPEN probe success → CLOSED.
      7. الـ HALF_OPEN probe failure → OPEN (reset cool-down).
      8. الـ Registry بيـ pre-register الـ 4 sources المعروفة.
      9. الـ reset() بيرجّع الـ circuit لـ CLOSED.

التشغيل:
    cd vps-service && python3 -m pytest tests/test_circuit_breaker.py -v
"""
from __future__ import annotations

import time

import pytest

from core.data_source_circuit_breaker import (
    CircuitBreaker,
    CircuitBreakerRegistry,
    CircuitOpenError,
    CircuitState,
    circuit_registry,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def fast_breaker() -> CircuitBreaker:
    """CircuitBreaker بـ thresholds صغيرة عشان الـ tests تخلص بسرعة.

    failure_threshold=3 + cool_down_seconds=1 → الـ test كله أقل من ثانيتين.
    """
    return CircuitBreaker(
        name='test_source',
        failure_threshold=3,
        cool_down_seconds=1,
        half_open_max_calls=1,
    )


@pytest.fixture(autouse=True)
def reset_registry_between_tests():
    """Reset كل الـ breakers في الـ global registry قبل كل test.

    عشان الـ tests ما تتأثرش ببعضها (الـ registry singleton بيتشارك بين الـ tests).
    """
    circuit_registry.reset_all()
    yield
    circuit_registry.reset_all()


# ---------------------------------------------------------------------------
# 1) Initial state = CLOSED
# ---------------------------------------------------------------------------

def test_initial_state_is_closed(fast_breaker: CircuitBreaker):
    """الـ circuit لازم يبدأ CLOSED (كل الطلبات بتمرّ)."""
    assert fast_breaker.state == CircuitState.CLOSED
    assert fast_breaker.is_open() is False
    assert fast_breaker.can_pass() is True
    status = fast_breaker.get_status()
    assert status['state'] == 'closed'
    assert status['is_open'] is False
    assert status['consecutive_failures'] == 0


# ---------------------------------------------------------------------------
# 2) Failures under threshold stay CLOSED
# ---------------------------------------------------------------------------

def test_failures_below_threshold_stay_closed(fast_breaker: CircuitBreaker):
    """threshold=3. لو سجّلنا 2 failures بس، لازم يفضل CLOSED."""
    fast_breaker.record_failure()
    fast_breaker.record_failure()
    assert fast_breaker.state == CircuitState.CLOSED
    assert fast_breaker.is_open() is False
    assert fast_breaker.get_status()['consecutive_failures'] == 2


# ---------------------------------------------------------------------------
# 3) Reaching threshold → OPEN
# ---------------------------------------------------------------------------

def test_threshold_opens_circuit(fast_breaker: CircuitBreaker):
    """3 failures ورا بعض → OPEN (Fail Fast mode)."""
    fast_breaker.record_failure()
    fast_breaker.record_failure()
    assert fast_breaker.state == CircuitState.CLOSED  # لسه
    fast_breaker.record_failure()  # الـ 3rd
    assert fast_breaker.state == CircuitState.OPEN
    assert fast_breaker.is_open() is True
    assert fast_breaker.can_pass() is False
    status = fast_breaker.get_status()
    assert status['state'] == 'open'
    assert status['is_open'] is True
    assert status['consecutive_failures'] == 3


# ---------------------------------------------------------------------------
# 4) OPEN rejects requests (Fail Fast) + CircuitOpenError
# ---------------------------------------------------------------------------

def test_open_circuit_rejects_with_error(fast_breaker: CircuitBreaker):
    """لو OPEN، call() لازم يرفع CircuitOpenError من غير ما يستدعي func."""
    # افتح الـ circuit
    for _ in range(3):
        fast_breaker.record_failure()
    assert fast_breaker.is_open()

    # call() لازم يرفع CircuitOpenError
    sentinel_called = False

    def _should_not_run():
        nonlocal sentinel_called
        sentinel_called = True
        return 'ran'

    with pytest.raises(CircuitOpenError) as exc_info:
        fast_breaker.call(_should_not_run)

    # الـ func ما اتسمّتش (Fail Fast = مفيش HTTP/DB)
    assert sentinel_called is False, "func must NOT be called when OPEN (Fail Fast)"
    # الـ exception فيه اسم الـ breaker + retry_after
    assert 'test_source' in str(exc_info.value)
    assert exc_info.value.breaker_name == 'test_source'
    assert exc_info.value.retry_after_seconds > 0

    # record_rejected بيزوّد الـ counter
    fast_breaker.record_rejected()
    assert fast_breaker.get_status()['stats']['total_rejected'] >= 1


# ---------------------------------------------------------------------------
# 5) After cool-down → HALF_OPEN
# ---------------------------------------------------------------------------

def test_transitions_to_half_open_after_cooldown(fast_breaker: CircuitBreaker):
    """لو OPEN والـ cool-down خلص → HALF_OPEN (probe واحد بس)."""
    for _ in range(3):
        fast_breaker.record_failure()
    assert fast_breaker.state == CircuitState.OPEN

    # استنى الـ cool-down (1 ثانية)
    time.sleep(1.1)
    # الـ state property بيشيك الـ cool-down وبيـ transition لو خلص
    assert fast_breaker.state == CircuitState.HALF_OPEN
    # HALF_OPEN بيسمح بـ probe واحد
    assert fast_breaker.is_open() is False
    assert fast_breaker.can_pass() is True


# ---------------------------------------------------------------------------
# 6) HALF_OPEN probe success → CLOSED
# ---------------------------------------------------------------------------

def test_half_open_probe_success_closes_circuit(fast_breaker: CircuitBreaker):
    """في HALF_OPEN، لو الـ probe نجح → CLOSED."""
    for _ in range(3):
        fast_breaker.record_failure()
    assert fast_breaker.state == CircuitState.OPEN

    time.sleep(1.1)
    assert fast_breaker.state == CircuitState.HALF_OPEN

    # probe ناجح
    result = fast_breaker.call(lambda: 'probe ok')
    assert result == 'probe ok'
    assert fast_breaker.state == CircuitState.CLOSED
    assert fast_breaker.get_status()['consecutive_failures'] == 0


# ---------------------------------------------------------------------------
# 7) HALF_OPEN probe failure → OPEN (reset cool-down)
# ---------------------------------------------------------------------------

def test_half_open_probe_failure_reopens_circuit(fast_breaker: CircuitBreaker):
    """في HALF_OPEN، لو الـ probe فشل → OPEN مع cool-down جديد."""
    for _ in range(3):
        fast_breaker.record_failure()
    assert fast_breaker.state == CircuitState.OPEN

    time.sleep(1.1)
    assert fast_breaker.state == CircuitState.HALF_OPEN

    # probe فاشل (بيـ raise exception)
    with pytest.raises(ValueError):
        fast_breaker.call(lambda: (_ for _ in ()).throw(ValueError('probe failed')))

    assert fast_breaker.state == CircuitState.OPEN
    # الـ cool-down اتـ reset (retry_after > 0)
    assert fast_breaker.retry_after_seconds() > 0


# ---------------------------------------------------------------------------
# 8) Registry pre-registers the 4 known sources
# ---------------------------------------------------------------------------

def test_registry_pre_registers_default_sources():
    """الـ Registry لازم يكون فيه الـ 4 sources المعروفة."""
    names = circuit_registry.list_names()
    assert 'tradingview' in names, "tradingview source must be pre-registered"
    assert 'egksco' in names, "egksco source must be pre-registered"
    assert 'egxpilot' in names, "egxpilot source must be pre-registered"
    assert 'yahoo' in names, "yahoo source must be pre-registered"

    # الـ thresholds المطلوبة من رسالة التوجيه
    tv = circuit_registry.get('tradingview')
    assert tv.failure_threshold == 5
    assert tv.cool_down_seconds == 300
    egksco = circuit_registry.get('egksco')
    assert egksco.failure_threshold == 5
    assert egksco.cool_down_seconds == 300


def test_registry_get_status_returns_all_breakers():
    """get_status() لازم يرجّع كل الـ breakers + count."""
    status = circuit_registry.get_status()
    assert 'total_breakers' in status
    assert 'open_breakers' in status
    assert 'breakers' in status
    assert status['total_breakers'] >= 4
    assert isinstance(status['breakers'], dict)


def test_registry_reset_all_resets_every_breaker():
    """reset_all() لازم يرجّع كل الـ breakers لـ CLOSED."""
    # افتح كذا breaker
    tv = circuit_registry.get('tradingview')
    for _ in range(5):
        tv.record_failure()
    assert tv.is_open()

    count = circuit_registry.reset_all()
    assert count >= 1
    assert tv.state == CircuitState.CLOSED


# ---------------------------------------------------------------------------
# 9) reset() returns to CLOSED
# ---------------------------------------------------------------------------

def test_manual_reset_returns_to_closed(fast_breaker: CircuitBreaker):
    """reset() بيرجّع الـ circuit لـ CLOSED من غير ما يستنى الـ cool-down."""
    for _ in range(3):
        fast_breaker.record_failure()
    assert fast_breaker.state == CircuitState.OPEN

    fast_breaker.reset()
    assert fast_breaker.state == CircuitState.CLOSED
    assert fast_breaker.is_open() is False
    assert fast_breaker.get_status()['consecutive_failures'] == 0


# ---------------------------------------------------------------------------
# 10) Stats accuracy
# ---------------------------------------------------------------------------

def test_stats_are_tracked_correctly(fast_breaker: CircuitBreaker):
    """الـ stats (total_calls, total_successes, total_failures) لازم تتبدّل بدقة."""
    fast_breaker.record_success()
    fast_breaker.record_success()
    fast_breaker.record_failure()
    stats = fast_breaker.get_status()['stats']
    assert stats['total_calls'] == 3
    assert stats['total_successes'] == 2
    assert stats['total_failures'] == 1
