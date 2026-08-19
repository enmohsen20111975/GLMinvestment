"""
test_sector_intelligence.py — اختبارات ذكاء القطاعات (Phase 8 Task D)
=====================================================================

الموضوع:
    دوال الـ Sector Intelligence في `core/opportunity_quality.py` (اللي اتعملت
    في CL7 — C2 Sector Heat + P6 Sector Role). لازم نتأكد إن:

      1. compute_sector_heat_map() بيصنّف القطاع "سخن" (avg_chg≥1% AND ≥60%
         صاعد AND n≥3) و"ميت" (avg_chg≤-1% AND ≤25% صاعد AND n≥3) و"محايد".
      2. classify_sector_roles() بيرتّب الأسهم جوه القطاع: top 1/3 = leader،
         bottom 1/3 = laggard، الباقي mid.
      3. القائد في قطاع ساخن بياخد boost موجب (يُقوّي فرصة المضارب) — analogous
         to gambler_opportunity = 1.
      4. المتأخر في قطاع ميت بياخد penalty سالب (يُضعف فرصة المضارب) — analogous
         to gambler_opportunity = 0 (الـ veto اللي بيحصل WRITE-time في
         background_analyzer بـ يحوّل is_gambler 1→0 بيعتمد على ده).
      5. القطاعات junk (Diversified / غير مصنف / N/A) بتتتجاهل.

الـ functions اللي تحت الاختبار (كلها pure — مفيش DB):
    - compute_sector_heat_map(fundamentals_batch)
    - classify_sector_roles(fundamentals_batch)
    - apply_sector_boost_to_gambler_rank(rank, sector, heat_map)
    - apply_sector_role_to_gambler_rank(rank, role, sector_status)
    - get_sector_heat_status(sector, heat_map)

التشغيل:
    cd vps-service && python3 -m pytest tests/test_sector_intelligence.py -v
"""
from __future__ import annotations

import pytest

from core.opportunity_quality import (
    SECTOR_HEAT_BOOST,
    SECTOR_HEAT_DEAD_AVG_CHG,
    SECTOR_HEAT_DEAD_RISING_RATIO,
    SECTOR_HEAT_EXCLUDE,
    SECTOR_HEAT_MIN_AVG_CHG,
    SECTOR_HEAT_MIN_RISING_RATIO,
    SECTOR_HEAT_MIN_SIZE,
    SECTOR_HEAT_PENALTY,
    SECTOR_ROLE_LAGGARD_PENALTY_DEAD,
    SECTOR_ROLE_LEADER_BOOST_HOT,
    apply_sector_boost_to_gambler_rank,
    apply_sector_role_to_gambler_rank,
    classify_sector_roles,
    compute_sector_heat_map,
    get_sector_heat_status,
)


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures: synthetic fundamentals batches
# ─────────────────────────────────────────────────────────────────────────────

def _fund(ticker: str, sector: str, change_1d: float, volume: float = 100_000.0) -> dict:
    """صنع fund dict بسيط بالحقول اللي بتستهلكها دوال القطاعات."""
    return {
        "ticker": ticker,
        "sector": sector,
        "change_1d": change_1d,
        "volume": volume,
    }


@pytest.fixture
def hot_sector_batch() -> dict:
    """قطاع أدوية سخن: 4 أسهم كلهم صاعدون +1.5% → avg=1.5%, rising_ratio=1.0."""
    return {
        "PHARM1": _fund("PHARM1", "Pharmaceuticals", 1.5),
        "PHARM2": _fund("PHARM2", "Pharmaceuticals", 1.8),
        "PHARM3": _fund("PHARM3", "Pharmaceuticals", 1.2),
        "PHARM4": _fund("PHARM4", "Pharmaceuticals", 1.5),
    }


@pytest.fixture
def dead_sector_batch() -> dict:
    """قطاع بنوك ميت: 4 أسهم كلهم هابطون -1.5% → avg=-1.5%, rising_ratio=0.0."""
    return {
        "BANK1": _fund("BANK1", "Banks", -1.5),
        "BANK2": _fund("BANK2", "Banks", -1.8),
        "BANK3": _fund("BANK3", "Banks", -1.2),
        "BANK4": _fund("BANK4", "Banks", -1.5),
    }


@pytest.fixture
def mixed_batch(hot_sector_batch, dead_sector_batch) -> dict:
    """batch فيه قطاع ساخن + قطاع ميت + قطاع محايد + قطاعات junk."""
    neutral = {
        "TECH1": _fund("TECH1", "Technology", 0.3),
        "TECH2": _fund("TECH2", "Technology", -0.2),
        "TECH3": _fund("TECH3", "Technology", 0.1),
    }
    junk = {
        "JUNK1": _fund("JUNK1", "Diversified", 5.0),     # junk — يجب تجاهله
        "JUNK2": _fund("JUNK2", "غير مصنف", -5.0),       # junk — يجب تجاهله
        "JUNK3": _fund("JUNK3", "", 5.0),                # junk — يجب تجاهله
        "JUNK4": _fund("JUNK4", None, 5.0),              # junk — يجب تجاهله
    }
    return {**hot_sector_batch, **dead_sector_batch, **neutral, **junk}


# ─────────────────────────────────────────────────────────────────────────────
# 1) compute_sector_heat_map — التصنيف الأساسي
# ─────────────────────────────────────────────────────────────────────────────

def test_hot_sector_classification(hot_sector_batch):
    """قطاع كله صاعد +1.5% لازم يتصنّف 'hot' مع boost = +SECTOR_HEAT_BOOST."""
    heat = compute_sector_heat_map(hot_sector_batch)
    assert "Pharmaceuticals" in heat
    info = heat["Pharmaceuticals"]
    assert info["status"] == "hot", f"expected hot, got {info['status']}"
    assert info["n"] == 4
    assert info["avg_chg"] >= SECTOR_HEAT_MIN_AVG_CHG
    assert info["rising_ratio"] >= SECTOR_HEAT_MIN_RISING_RATIO
    assert info["boost"] == pytest.approx(SECTOR_HEAT_BOOST)


def test_dead_sector_classification(dead_sector_batch):
    """قطاع كله هابط -1.5% لازم يتصنّف 'dead' مع boost = -SECTOR_HEAT_PENALTY."""
    heat = compute_sector_heat_map(dead_sector_batch)
    assert "Banks" in heat
    info = heat["Banks"]
    assert info["status"] == "dead", f"expected dead, got {info['status']}"
    assert info["n"] == 4
    assert info["avg_chg"] <= SECTOR_HEAT_DEAD_AVG_CHG
    assert info["rising_ratio"] <= SECTOR_HEAT_DEAD_RISING_RATIO
    assert info["boost"] == pytest.approx(-SECTOR_HEAT_PENALTY)


def test_neutral_sector_classification():
    """قطاع مختلط (بعض الصاعد وبعض الهابط) لازم يتصنّف 'neutral' مع boost=0."""
    batch = {
        "T1": _fund("T1", "Tech", 0.5),
        "T2": _fund("T2", "Tech", -0.3),
        "T3": _fund("T3", "Tech", 0.1),
    }
    heat = compute_sector_heat_map(batch)
    info = heat["Tech"]
    assert info["status"] == "neutral"
    assert info["boost"] == 0.0


def test_small_sector_is_neutral():
    """قطاع أقل من SECTOR_HEAT_MIN_SIZE (n<3) لازم يفضل neutral."""
    batch = {
        "L1": _fund("L1", "Tiny", 5.0),   # بس 2 سهم — مش قطاع إحصائي
        "L2": _fund("L2", "Tiny", 5.0),
    }
    heat = compute_sector_heat_map(batch)
    assert heat["Tiny"]["status"] == "neutral"
    assert heat["Tiny"]["boost"] == 0.0


def test_junk_sectors_excluded(mixed_batch):
    """القطاعات junk (Diversified/غير مصنف/''/None) مش بتظهر في الـ heat_map."""
    heat = compute_sector_heat_map(mixed_batch)
    # القطاعات الحقيقية موجودة
    assert "Pharmaceuticals" in heat
    assert "Banks" in heat
    assert "Technology" in heat
    # القطاعات junk مش موجودة
    assert "Diversified" not in heat
    assert "غير مصنف" not in heat
    assert "" not in heat
    # JUNK4 (None sector) مش بيضيف قطاع
    assert None not in heat


def test_empty_batch_returns_empty_map():
    """batch فاضي → heat_map فاضي."""
    assert compute_sector_heat_map({}) == {}
    assert compute_sector_heat_map(None) == {}


# ─────────────────────────────────────────────────────────────────────────────
# 2) classify_sector_roles — leader / mid / laggard
# ─────────────────────────────────────────────────────────────────────────────

def test_classify_roles_hot_sector(hot_sector_batch):
    """في قطاع 4 أسهم: top 1 = leader، bottom 1 = laggard، الوسط = mid.

    third = max(1, 4//3) = 1. leader = index 0 (أعلى change_1d)،
    laggard = index >= 4-1 = index 3 (أقل change_1d).
    """
    roles = classify_sector_roles(hot_sector_batch)
    # رتّب يدوياً للتحقق
    sorted_tickers = sorted(
        hot_sector_batch.items(), key=lambda kv: kv[1]["change_1d"], reverse=True
    )
    leader = sorted_tickers[0][0]    # PHARM2 (+1.8%)
    laggard = sorted_tickers[-1][0]  # PHARM3 (+1.2%)
    assert roles[leader] == "leader"
    assert roles[laggard] == "laggard"
    # الوسط mid
    for t, _ in sorted_tickers[1:-1]:
        assert roles[t] == "mid"


def test_classify_roles_dead_sector(dead_sector_batch):
    """نفس منطق leader/laggard بـ تتطبّق على القطاع الميت."""
    roles = classify_sector_roles(dead_sector_batch)
    sorted_tickers = sorted(
        dead_sector_batch.items(), key=lambda kv: kv[1]["change_1d"], reverse=True
    )
    # أعلى change_1d = BANK3 (-1.2%) = leader، أقل = BANK2 (-1.8%) = laggard
    assert roles[sorted_tickers[0][0]] == "leader"
    assert roles[sorted_tickers[-1][0]] == "laggard"


def test_classify_roles_small_sector_all_mid():
    """قطاع أقل من SECTOR_HEAT_MIN_SIZE → الكل 'mid' (مفيش إحصائية)."""
    batch = {
        "S1": _fund("S1", "Small", 3.0),
        "S2": _fund("S2", "Small", 1.0),
    }
    roles = classify_sector_roles(batch)
    assert roles["S1"] == "mid"
    assert roles["S2"] == "mid"


# ─────────────────────────────────────────────────────────────────────────────
# 3) apply_sector_boost_to_gambler_rank — الـ heat boost/penalty
# ─────────────────────────────────────────────────────────────────────────────

def test_hot_boost_increases_rank(hot_sector_batch):
    """سهم في قطاع سخن → rank بيتضرب في (1 + 0.15) → أعلى."""
    heat = compute_sector_heat_map(hot_sector_batch)
    original = 100.0
    boosted, delta = apply_sector_boost_to_gambler_rank(original, "Pharmaceuticals", heat)
    assert delta == pytest.approx(SECTOR_HEAT_BOOST)
    assert boosted == pytest.approx(original * (1 + SECTOR_HEAT_BOOST))
    assert boosted > original  # تأكيد: التعديل موجب


def test_dead_penalty_decreases_rank(dead_sector_batch):
    """سهم في قطاع ميت → rank بيتضرب في (1 - 0.10) → أقل."""
    heat = compute_sector_heat_map(dead_sector_batch)
    original = 100.0
    boosted, delta = apply_sector_boost_to_gambler_rank(original, "Banks", heat)
    assert delta == pytest.approx(-SECTOR_HEAT_PENALTY)
    assert boosted == pytest.approx(original * (1 - SECTOR_HEAT_PENALTY))
    assert boosted < original  # تأكيد: التعديل سالب


def test_neutral_no_change():
    """قطاع محايد → delta=0، rank بدون تغيير."""
    heat = {"Tech": {"status": "neutral", "boost": 0.0}}
    boosted, delta = apply_sector_boost_to_gambler_rank(100.0, "Tech", heat)
    assert delta == 0.0
    assert boosted == 100.0


def test_boost_unknown_sector_no_change(hot_sector_batch):
    """قطاع مش في الـ heat_map → بدون تغيير."""
    heat = compute_sector_heat_map(hot_sector_batch)
    boosted, delta = apply_sector_boost_to_gambler_rank(100.0, "UnknownSector", heat)
    assert delta == 0.0
    assert boosted == 100.0


def test_get_sector_heat_status(hot_sector_batch, dead_sector_batch):
    """get_sector_heat_status helper بيرجّع الحالة كـ string."""
    heat = {**compute_sector_heat_map(hot_sector_batch),
            **compute_sector_heat_map(dead_sector_batch)}
    assert get_sector_heat_status("Pharmaceuticals", heat) == "hot"
    assert get_sector_heat_status("Banks", heat) == "dead"
    assert get_sector_heat_status("DoesNotExist", heat) == "neutral"


# ─────────────────────────────────────────────────────────────────────────────
# 4) apply_sector_role_to_gambler_rank — الـ role boost/penalty
# ─────────────────────────────────────────────────────────────────────────────

def test_leader_in_hot_gets_positive_role_boost():
    """leader + hot → +SECTOR_ROLE_LEADER_BOOST_HOT (موجب)."""
    original = 100.0
    adjusted, delta = apply_sector_role_to_gambler_rank(original, "leader", "hot")
    assert delta == pytest.approx(SECTOR_ROLE_LEADER_BOOST_HOT)
    assert adjusted > original


def test_laggard_in_dead_gets_negative_role_penalty():
    """laggard + dead → -SECTOR_ROLE_LAGGARD_PENALTY_DEAD (سالب)."""
    original = 100.0
    adjusted, delta = apply_sector_role_to_gambler_rank(original, "laggard", "dead")
    assert delta == pytest.approx(SECTOR_ROLE_LAGGARD_PENALTY_DEAD)
    assert adjusted < original


def test_mid_role_no_change():
    """mid → بدون تغيير (مهما كان sector_status)."""
    for status in ("hot", "dead", "neutral"):
        adjusted, delta = apply_sector_role_to_gambler_rank(100.0, "mid", status)
        assert delta == 0.0
        assert adjusted == 100.0


def test_neutral_status_no_change():
    """neutral sector → بدون تغيير (مهما كان role)."""
    for role in ("leader", "mid", "laggard"):
        adjusted, delta = apply_sector_role_to_gambler_rank(100.0, role, "neutral")
        assert delta == 0.0


# ─────────────────────────────────────────────────────────────────────────────
# 5) السيناريو المتكامل: leader-in-hot vs laggard-in-dead
#    (التمثيل الصادق لـ "gambler_opportunity = 1" vs "= 0")
# ─────────────────────────────────────────────────────────────────────────────

def test_leader_in_hot_strengthens_gambler_opportunity(mixed_batch):
    """السيناريو الذهبي: قائد في قطاع ساخن.

    الـ Sector Intelligence بـ يطبّق boost موجب على gambler_rank_score:
        heat boost  = +15%  (rank *= 1.15)
        role boost  = +5%   (rank *= 1.05)
    النتيجة: rank النهائي أعلى من الأصلي بـ ~20.8% → فرصة المضارب «مُقوّاة»
    (analogous to gambler_opportunity = 1). ده الـ signal اللي بـ يخلي الـ
    background_analyzer يحتفظ بـ is_gambler=1 ويـ rank السهم أعلى في الـ picks.
    """
    heat = compute_sector_heat_map(mixed_batch)
    roles = classify_sector_roles(mixed_batch)

    # لقّي القائد في قطاع الأدوية
    pharma_leader = None
    for ticker, role in roles.items():
        if mixed_batch[ticker]["sector"] == "Pharmaceuticals" and role == "leader":
            pharma_leader = ticker
            break
    assert pharma_leader is not None, "should find a leader in Pharmaceuticals"

    base_rank = 100.0
    after_heat, heat_delta = apply_sector_boost_to_gambler_rank(
        base_rank, "Pharmaceuticals", heat
    )
    after_role, role_delta = apply_sector_role_to_gambler_rank(
        after_heat, "leader", get_sector_heat_status("Pharmaceuticals", heat)
    )

    assert heat_delta > 0, "leader in hot must get positive heat boost"
    assert role_delta > 0, "leader in hot must get positive role boost"
    assert after_role > base_rank, "net effect must STRENGTHEN the gambler opportunity"
    # التقريب: 100 × 1.15 × 1.05 = 120.75
    assert after_role == pytest.approx(120.75, rel=0.01)


def test_laggard_in_dead_weakens_gambler_opportunity(mixed_batch):
    """السيناريو الذهبي: متأخر في قطاع ميت.

    الـ Sector Intelligence بـ يطبّق penalty سالب على gambler_rank_score:
        heat penalty = -10% (rank *= 0.90)
        role penalty  = -5%  (rank *= 0.95)
    النتيجة: rank النهائي أقل من الأصلي بـ ~14.5% → فرصة المضارب «مُضعَفة».
    ده الـ signal اللي بـ يفعّل الـ veto في background_analyzer
    (_apply_sector_veto_to_persona_flags): is_gambler 1→0 لـ laggard-in-dead.
    (analogous to gambler_opportunity = 0)
    """
    heat = compute_sector_heat_map(mixed_batch)
    roles = classify_sector_roles(mixed_batch)

    # لقّي المتأخر في قطاع البنوك
    bank_laggard = None
    for ticker, role in roles.items():
        if mixed_batch[ticker]["sector"] == "Banks" and role == "laggard":
            bank_laggard = ticker
            break
    assert bank_laggard is not None, "should find a laggard in Banks"

    base_rank = 100.0
    after_heat, heat_delta = apply_sector_boost_to_gambler_rank(
        base_rank, "Banks", heat
    )
    after_role, role_delta = apply_sector_role_to_gambler_rank(
        after_heat, "laggard", get_sector_heat_status("Banks", heat)
    )

    assert heat_delta < 0, "laggard in dead must get negative heat penalty"
    assert role_delta < 0, "laggard in dead must get negative role penalty"
    assert after_role < base_rank, "net effect must WEAKEN the gambler opportunity"
    # التقريب: 100 × 0.90 × 0.95 = 85.5
    assert after_role == pytest.approx(85.5, rel=0.01)


def test_leader_in_hot_stronger_than_laggard_in_dead(mixed_batch):
    """مقارنة مباشرة: rank leader-in-hot لازم يكون أعلى بكتير من laggard-in-dead.

    ده البرهان الكمّي إن Sector Intelligence بـ يفصل بين الفرص القوية والضعيفة
    — وهو جوهر "المضارب الذكي بيفضّل قائد قطاع ساخن وبيتجنّب متأخر قطاع ميت".
    """
    heat = compute_sector_heat_map(mixed_batch)
    roles = classify_sector_roles(mixed_batch)

    base_rank = 100.0

    # leader-in-hot
    leader_ticker = next(
        t for t, r in roles.items()
        if mixed_batch[t]["sector"] == "Pharmaceuticals" and r == "leader"
    )
    lh_heat, _ = apply_sector_boost_to_gambler_rank(base_rank, "Pharmaceuticals", heat)
    leader_rank, _ = apply_sector_role_to_gambler_rank(
        lh_heat, "leader", get_sector_heat_status("Pharmaceuticals", heat)
    )

    # laggard-in-dead
    laggard_ticker = next(
        t for t, r in roles.items()
        if mixed_batch[t]["sector"] == "Banks" and r == "laggard"
    )
    ld_heat, _ = apply_sector_boost_to_gambler_rank(base_rank, "Banks", heat)
    laggard_rank, _ = apply_sector_role_to_gambler_rank(
        ld_heat, "laggard", get_sector_heat_status("Banks", heat)
    )

    assert leader_rank > laggard_rank, (
        f"leader-in-hot ({leader_rank:.2f}) must outrank laggard-in-dead "
        f"({laggard_rank:.2f}) — the whole point of sector intelligence"
    )
    # الفجوة كبيرة (مثلاً > 30 نقطة على base 100)
    assert (leader_rank - laggard_rank) > 30.0


if __name__ == "__main__":
    # السماح بالتشغيل المباشر: python3 tests/test_sector_intelligence.py
    pytest.main([__file__, "-v"])
