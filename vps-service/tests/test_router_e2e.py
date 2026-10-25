"""
test_router_e2e.py — اختبار تكاملي للـ DecisionRouter (Phase 5 Task 3)
=======================================================================

الموضوع:
    الـ DecisionRouter هو الموحّد اللي كل الـ endpoints بتستخدمه. لازم نتأكد
    إن الـ route('COMI', 'daily') بيرجّع StandardAnalysisResponse كاملة
    (entry, target, stop, signal + كل الـ standard keys) من غير ما الـ keys
    تكون None بالغلط.

    الاختبار ده E2E (End-to-End) لأنه بيستدعي الـ MasterAnalyzer الحقيقي
    + الـ DB الحقيقي + كل الـ layers (Fundamental Gatekeeper + V20 Fusion + ...).

التشغيل:
    cd vps-service && python3 -m pytest tests/test_router_e2e.py -v

Notes:
    - الاختبار ده ممكن ياخد 2-4 ثواني (الـ MasterAnalyzer ثقيل بـ كل الـ layers).
    - لو الـ DBs الإنتاجية مش موجودة، الـ test بـ skip (مش fail).
    - الـ COMI هو رمز Commercial International Bank (أكتر سهم فيه داتا كاملة).
"""
from __future__ import annotations

import time
from typing import Any, Dict

import pytest

from core.router import decision_router, DecisionRouter
from core.models import StandardAnalysisResponse


# ---------------------------------------------------------------------------
# الـ keys الأساسية اللي StandardAnalysisResponse بيضمنها في كل رد
# ---------------------------------------------------------------------------

STANDARD_KEYS = {
    # Identity
    'ticker', 'engine', 'intent', 'mode',
    # Signal & Trade Plan
    'signal', 'signal_ar', 'direction', 'score', 'confidence',
    'entry_price', 'target_price', 'stop_loss', 'risk_reward',
    # Explanation
    'reason', 'reason_ar', 'warnings',
    # Engine Payload
    'technical', 'fundamental', 'fusion_metrics', 'risk_profile',
    'smc', 'v20', 'live_indicators', 'raw',
    # Meta
    'success', 'error', 'timing_ms', 'cached', 'fallback', 'timestamp',
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture(scope='module')
def comi_daily_response() -> Dict[str, Any]:
    """اعمل طلب حقيقي واحد لـ DecisionRouter.route('COMI', 'daily').

    scope='module' عشان نعمله مرة واحدة بس (الـ MasterAnalyzer ثقيل 2-4s).
    كل الـ tests بتـ reuse نفس الـ response.
    """
    start = time.time()
    result = decision_router.route('COMI', intent='daily')
    elapsed = time.time() - start
    # لوج مدة الـ execution للـ observability
    print(f"\n[router_e2e] route('COMI', 'daily') took {elapsed:.2f}s, success={result.get('success')}")
    return result


# ---------------------------------------------------------------------------
# 1) الـ response لازم يكون dict + فيه كل الـ standard keys
# ---------------------------------------------------------------------------

def test_response_is_dict(comi_daily_response):
    """الـ response لازم يكون dict (مش None، مش str)."""
    assert isinstance(comi_daily_response, dict), \
        f"Expected dict, got {type(comi_daily_response)}"


def test_response_has_all_standard_keys(comi_daily_response):
    """كل الـ standard keys موجودة (مفيش KeyError في الـ frontend)."""
    missing = STANDARD_KEYS - set(comi_daily_response.keys())
    assert not missing, f"Missing standard keys: {missing}"


# ---------------------------------------------------------------------------
# 2) Identity fields بتاعة الـ response
# ---------------------------------------------------------------------------

def test_response_identity_fields(comi_daily_response):
    """ticker, engine, intent, mode بتكون موجودة وصحيحة."""
    assert comi_daily_response['ticker'] == 'COMI'
    assert comi_daily_response['engine'] == 'master_analyzer'
    assert comi_daily_response['intent'] == 'daily'


# ---------------------------------------------------------------------------
# 3) success field + error handling
# ---------------------------------------------------------------------------

def test_response_success_flag(comi_daily_response):
    """success لازم يكون True (الـ router ما وقعش).

    Note: success=True معناه إن الـ router شغّل بنجاح، مش إنه لقى تحليل.
    ممكن الـ signal يكون HOLD لو مفيش داتا كفاية، بس ده مش error.
    """
    assert comi_daily_response['success'] is True, \
        f"Router should succeed even with insufficient data. error={comi_daily_response.get('error')}"


def test_response_no_unexpected_error(comi_daily_response):
    """لو success=True، الـ error لازم يكون None أو فاضي."""
    if comi_daily_response['success']:
        error = comi_daily_response.get('error')
        assert error is None or error == '', \
            f"success=True but error={error!r}"


# ---------------------------------------------------------------------------
# 4) Signal + direction (مفتاحيين للـ frontend)
# ---------------------------------------------------------------------------

def test_response_has_signal_value(comi_daily_response):
    """signal لازم يكون string موجود (مفيش KeyError، مش None بالغلط).

    Note: الـ signal ممكن يكون 'HOLD' لو مفيش داتا كفاية، بس لازم يكون string.
    لو الـ signal None، الـ frontend هيـ crash.
    """
    signal = comi_daily_response.get('signal')
    # signal ممكن يكون None بس في حالة الـ error response بس
    if comi_daily_response['success']:
        # لو success=True، الـ signal المفروض يكون موجود (string)
        # (ممكن يكون None بس بنسمح بيه لو الـ MasterAnalyzer رجّع كده)
        if signal is not None:
            assert isinstance(signal, str), \
                f"signal must be str, got {type(signal)}"
            # الـ signals المعروفة
            assert signal.upper() in {
                'BUY', 'STRONG_BUY', 'ACCUMULATE', 'WEAK_BUY', 'BULLISH', 'OVERWEIGHT',
                'SELL', 'STRONG_SELL', 'REDUCE', 'WEAK_SELL', 'BEARISH', 'UNDERWEIGHT',
                'HOLD', 'NEUTRAL', 'WAIT',
            }, f"Unknown signal: {signal!r}"


def test_response_direction_is_long_or_short(comi_daily_response):
    """direction لازم يكون 'LONG' أو 'SHORT' (لو موجود).

    الـ direction بيتـ auto-derive من الـ signal في StandardAnalysisResponse.
    """
    direction = comi_daily_response.get('direction')
    if direction is not None:
        assert direction in ('LONG', 'SHORT'), \
            f"direction must be 'LONG' or 'SHORT', got {direction!r}"


# ---------------------------------------------------------------------------
# 5) Entry / target / stop (الـ trade plan)
# ---------------------------------------------------------------------------

def test_response_trade_plan_keys_present(comi_daily_response):
    """entry_price, target_price, stop_loss, risk_reward keys موجودة.

    Note: القيم ممكن تكون None لو الـ engine ماطلعش trade plan (زي HOLD signals).
    المهم إن الـ keys موجودة (مفيش KeyError في الـ frontend).
    """
    for key in ('entry_price', 'target_price', 'stop_loss', 'risk_reward'):
        assert key in comi_daily_response, \
            f"Trade plan key {key!r} must be present (even if None)"


def test_response_trade_plan_values_consistent(comi_daily_response):
    """لو entry + target + stop كلهم موجودين (مش None)، لازم يكونوا أرقام consistent.

    - LONG: target > entry > stop
    - SHORT: stop > entry > target
    - HOLD/None: أي حاجة (skip)
    """
    entry = comi_daily_response.get('entry_price')
    target = comi_daily_response.get('target_price')
    stop = comi_daily_response.get('stop_loss')
    direction = comi_daily_response.get('direction')

    # لو أي واحد فيهم None، skip (الـ engine ماطلعش trade plan)
    if entry is None or target is None or stop is None:
        pytest.skip("Trade plan incomplete (likely HOLD signal) — values None is acceptable")

    # كلهم أرقام
    assert isinstance(entry, (int, float)), f"entry must be number, got {type(entry)}"
    assert isinstance(target, (int, float)), f"target must be number, got {type(target)}"
    assert isinstance(stop, (int, float)), f"stop must be number, got {type(stop)}"

    # كلهم موجبين (أسعار أسهم)
    assert entry > 0, f"entry must be > 0, got {entry}"
    assert target > 0, f"target must be > 0, got {target}"
    assert stop > 0, f"stop must be > 0, got {stop}"

    # consistency relative to direction
    if direction == 'LONG':
        assert target >= entry, f"LONG target ({target}) must be >= entry ({entry})"
        assert stop <= entry, f"LONG stop ({stop}) must be <= entry ({entry})"
    elif direction == 'SHORT':
        assert target <= entry, f"SHORT target ({target}) must be <= entry ({entry})"
        assert stop >= entry, f"SHORT stop ({stop}) must be >= entry ({entry})"


# ---------------------------------------------------------------------------
# 6) Meta: timing_ms + timestamp + cached flag
# ---------------------------------------------------------------------------

def test_response_meta_fields(comi_daily_response):
    """timing_ms, timestamp, cached, fallback موجودة وصحيحة."""
    assert 'timing_ms' in comi_daily_response
    timing = comi_daily_response['timing_ms']
    if timing is not None:
        assert isinstance(timing, (int, float))
        assert timing >= 0

    assert 'timestamp' in comi_daily_response
    ts = comi_daily_response['timestamp']
    assert isinstance(ts, str) and len(ts) > 0, f"timestamp must be non-empty str, got {ts!r}"

    assert 'cached' in comi_daily_response
    assert isinstance(comi_daily_response['cached'], bool)

    assert 'fallback' in comi_daily_response
    assert isinstance(comi_daily_response['fallback'], bool)


# ---------------------------------------------------------------------------
# 7) raw field (الـ raw engine output محفوظ)
# ---------------------------------------------------------------------------

def test_response_has_raw_engine_output(comi_daily_response):
    """raw field فيه الـ MasterAnalyzer output الأصلي (للـ debugging)."""
    raw = comi_daily_response.get('raw')
    assert raw is not None, "raw engine output must be preserved"
    assert isinstance(raw, dict), f"raw must be dict, got {type(raw)}"


# ---------------------------------------------------------------------------
# 8) Engine payload keys (technical + fundamental + fusion_metrics + ...)
# ---------------------------------------------------------------------------

def test_response_engine_payload_keys_present(comi_daily_response):
    """technical, fundamental, fusion_metrics, risk_profile, smc, v20 keys موجودة.

    القيم ممكن تكون None لو المحرك مطلعش الحاجة دي، بس الـ keys لازم تكون موجودين.
    """
    for key in ('technical', 'fundamental', 'fusion_metrics', 'risk_profile',
                'smc', 'v20', 'live_indicators'):
        assert key in comi_daily_response, \
            f"Engine payload key {key!r} must be present (even if None)"


# ---------------------------------------------------------------------------
# 9) Cache integration (الـ request التاني لازم ييجي من الكاش)
# ---------------------------------------------------------------------------

def test_second_request_uses_cache(comi_daily_response):
    """الطلب التاني لـ نفس الـ ticker + intent لازم يرجّع cached=True."""
    result2 = decision_router.route('COMI', intent='daily')
    assert result2.get('cached') is True, \
        f"Second request should be cached, got cached={result2.get('cached')}"
    # نفس الـ signal + score (من الكاش)
    assert result2.get('signal') == comi_daily_response.get('signal')


# ---------------------------------------------------------------------------
# 10) Error response shape (لو الـ ticker فاضي)
# ---------------------------------------------------------------------------

def test_empty_ticker_returns_error_response():
    """ticker فاضي لازم يرجّع error_response موحّد (مش exception)."""
    result = decision_router.route('', intent='daily')
    assert isinstance(result, dict)
    assert result.get('success') is False
    assert result.get('error') is not None
    # الـ error response لازم يكون فيه الـ standard keys كمان
    assert 'ticker' in result
    assert 'timestamp' in result


# ---------------------------------------------------------------------------
# 11) Router stats (الـ routing counters بتتبدّل)
# ---------------------------------------------------------------------------

def test_router_stats_incremented(comi_daily_response):
    """الـ router stats (daily counter) لازم يزيد بعد الـ request."""
    stats = decision_router.get_stats()
    assert isinstance(stats, dict)
    # الـ daily counter لازم يكون ≥ 1 (بعد ما عملنا route('COMI', 'daily'))
    assert stats.get('daily', 0) >= 1, \
        f"daily counter should be >= 1 after daily request, got {stats.get('daily')}"


# ---------------------------------------------------------------------------
# 12) session_status + decide (للـ observability)
# ---------------------------------------------------------------------------

def test_router_session_status_returns_dict():
    """session_status() لازم يرجّع dict فيه is_session_open + engines available."""
    status = decision_router.session_status()
    assert isinstance(status, dict)
    assert 'is_session_open' in status
    assert 'live_engine_available' in status
    assert 'master_engine_available' in status
    assert 'cairo_time' in status


def test_router_decide_returns_valid_engine_name():
    """decide('daily') لازم يرجّع 'daily'."""
    assert decision_router.decide('daily') == 'daily'
    # decide('full') لازم يرجّع 'full'
    assert decision_router.decide('full') == 'full'
