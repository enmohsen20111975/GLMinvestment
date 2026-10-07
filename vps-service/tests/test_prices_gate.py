"""
test_prices_gate.py — اختبارات بوابة الأسعار (Phase 8 Task D)
==============================================================

الموضوع:
    `data/prices.py::load_price_history` هي THE single source of truth لقراءة
    تاريخ الأسعار (PHASE 1). لازم نتأكد إنها "آمنة بالكامل" — أي مدخل سيئ أو
    سهم مش موجود بترجّع `[]` بدون ما تعمل Crash (لا exception، لا traceback).

    ده حرج لأن المحركات بـ تستدعيها في batch (50+ سهم)؛ لو سهم واحد بـ يكسرها،
    الـ batch كله بيقف → "analyzed=0" → شاشة فاضية.

الـ functions اللي تحت الاختبار:
    - load_price_history(ticker, limit)
    - load_closes(ticker, limit)
    - get_latest_price(ticker)
    - clear_cache() / get_cache_stats()

التشغيل:
    cd vps-service && python3 -m pytest tests/test_prices_gate.py -v
"""
from __future__ import annotations

import pytest

from data import prices as prices_mod
from data.prices import (
    clear_cache,
    get_cache_stats,
    get_latest_price,
    load_closes,
    load_price_history,
)


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(autouse=True)
def _reset_price_cache():
    """امسح الـ LRU cache قبل كل test عشان نضمن isolation.

    load_price_history بـ cache النتايج per (ticker, limit) لـ 5 دقايق.
    لو سيبناها، test ممكن يشوف نتيجة test سابق (false positive).
    """
    clear_cache()
    yield
    clear_cache()


# ─────────────────────────────────────────────────────────────────────────────
# 1) المداخل السيئة (fast paths) — ترجّع [] فوراً بدون DB
# ─────────────────────────────────────────────────────────────────────────────

def test_empty_string_ticker_returns_empty_list():
    """load_price_history('') لازم ترجّع [] بدون ما تفتح DB."""
    result = load_price_history("", limit=10)
    assert result == []
    assert isinstance(result, list)


def test_none_ticker_returns_empty_list():
    """load_price_history(None) لازم ترجّع [] بدون crash."""
    result = load_price_history(None, limit=10)
    assert result == []
    assert isinstance(result, list)


def test_whitespace_ticker_does_not_crash():
    """ticker مسافات بس — الـ normalize بـ يطلّع string فاضي بعد strip."""
    # ملاحظة: '  ' بعد upper+strip بـ يبقى '' مش None، بس الـ canonical load
    # بـ يتعامل معاه. المهم: مفيش exception.
    result = load_price_history("   ", limit=5)
    assert isinstance(result, list)


# ─────────────────────────────────────────────────────────────────────────────
# 2) سهم مش موجود في الـ DB — ترجّع [] بدون crash (المطلب الأساسي)
# ─────────────────────────────────────────────────────────────────────────────

def test_nonexistent_ticker_returns_empty_list_no_crash():
    """سهم مش موجود في price_history.db ولا stocks.db لازم يرجّع [].

    ده جوهر المطلب: «لو السهم مش موجود، الدالة بترجّع [] من غير ما تعمل Crash».
    الـ canonical load بـ يجرب master_analyzer.load_merged_history (اللي بـ يقرأ
    price_history.db)؛ لو مفيش rows بترجّع []. الفallback بـ يقرأ stock_daily_prices
    وبردو بترجّع []. مفيش exception بيتسرّب للـ caller.
    """
    result = load_price_history("NONEXISTENT_TICKER_XYZ_999", limit=10)
    assert result == [], f"expected [], got {result!r}"
    assert isinstance(result, list)


def test_nonexistent_ticker_does_not_raise():
    """تأكيد إضافي: مفيش exception بيتسرّب مهما كان السهم غريب."""
    for weird_ticker in ("ZZZZZZ", "9999", "NOT.A.STOCK", "أبجد"):
        try:
            res = load_price_history(weird_ticker, limit=5)
        except Exception as e:  # pragma: no cover
            pytest.fail(f"load_price_history({weird_ticker!r}) raised {type(e).__name__}: {e}")
        assert isinstance(res, list)


def test_load_closes_nonexistent_returns_empty():
    """load_closes لسهم مش موجود لازم ترجّع [] (list of floats فاضي)."""
    closes = load_closes("NONEXISTENT_TICKER_XYZ_999", limit=10)
    assert closes == []
    assert isinstance(closes, list)


def test_get_latest_price_nonexistent_returns_none():
    """get_latest_price لسهم مش موجود لازم ترجّع None (مش [] ولا exception)."""
    latest = get_latest_price("NONEXISTENT_TICKER_XYZ_999")
    assert latest is None


# ─────────────────────────────────────────────────────────────────────────────
# 3) سلوك الـ limit + الـ cache
# ─────────────────────────────────────────────────────────────────────────────

def test_limit_is_clamped_to_min_1():
    """limit=0 أو سالب بـ يتـ clamp لـ 1 (ما بيتكسرش)."""
    # مفيش crash — حتى لو الـ ticker مش موجود
    res = load_price_history("NONEXISTENT_TICKER_XYZ_999", limit=0)
    assert isinstance(res, list)
    res_neg = load_price_history("NONEXISTENT_TICKER_XYZ_999", limit=-5)
    assert isinstance(res_neg, list)


def test_clear_cache_resets_stats():
    """clear_cache بتصفّر الإحصائيات."""
    # إ_trigger cache miss
    load_price_history("NONEXISTENT_TICKER_XYZ_999", limit=5)
    stats_before = get_cache_stats()
    assert stats_before["misses"] >= 1
    # امسح
    clear_cache()
    stats_after = get_cache_stats()
    assert stats_after["size"] == 0
    assert stats_after["hits"] == 0
    assert stats_after["misses"] == 0


def test_cache_hit_on_repeat_call():
    """نداءين بنفس (ticker, limit) → التاني من الـ cache (hit)."""
    ticker = "NONEXISTENT_TICKER_XYZ_999"
    load_price_history(ticker, limit=10)  # miss
    load_price_history(ticker, limit=10)  # hit
    stats = get_cache_stats()
    assert stats["hits"] >= 1, f"expected at least 1 cache hit, got stats={stats}"


# ─────────────────────────────────────────────────────────────────────────────
# 4) عقد العودة: دايماً list of dicts بالـ schema الموحّد (لو فيه داتا)
# ─────────────────────────────────────────────────────────────────────────────

def test_returned_rows_have_consistent_keys_when_data_exists():
    """لو فيه داتا (سهم حقيقي)، كل row لازم يكون dict فيه: date/open/high/low/close/volume.

    نستخدم سهم محتمل يكون موجود في price_history.db. لو الـ DB فاضي (ساندبوكس)
    بنـ skip — الـ test ده بيتحقق من الـ schema بس لما فيه داتا فعلية.
    """
    # جرّب عدة tickers شائعة — أي واحد يرجّع داتا يكفي للتحقق من الـ schema
    candidates = ["COMI", "HRHO", "SWDY", "ETEL", "TMGQ"]
    found = None
    for t in candidates:
        res = load_price_history(t, limit=3)
        if res:
            found = res
            break
    if not found:
        pytest.skip("price_history.db has no data for common tickers (sandbox) — schema check skipped")

    row = found[0]
    assert isinstance(row, dict)
    for key in ("date", "open", "high", "low", "close", "volume"):
        assert key in row, f"row missing key {key!r}: {row!r}"
    assert isinstance(row["close"], (int, float))
    assert isinstance(row["volume"], int)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
