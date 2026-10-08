"""
canonical_signal.py — مصدر واحد لكل المقاييس الفنية (Rule: CANONICAL-CALCULATIONS)
=================================================================================

Problem (Task CALC-AUDIT-1 + CALC-DUP-1):
- 3 شاشات (توقعات / تحليل شامل / رادار السيولة) بتعطي 3 نتائج مختلفة لنفس السهم
- السبب: كل شاشة بتحسب الـ metrics من مكان مختلف بصيغة مختلفة
- 9 أماكن بتحسب "accumulation" بـ 7 صيغ مختلفة
- 3 أماكن بتحسب "buy_pressure" (واحدة فيها hardcoded 85/40!)
- 4 taxonomies مختلفة لـ "phase" كلها مسمّاة "phase"
- 13+ مكان بيصنّف signal بـ 6 thresholds مختلفة

Solution: هذا الملف هو المصدر الواحد (canonical source) للـ 5 metrics:
1. classify_accumulation(buy_pct) → 'تجميع قوي' / 'تصريف قوي' / ...
2. classify_signal(master_score) → 'STRONG_BUY' / 'BUY' / 'HOLD' / ...
3. classify_volume_ratio(entry_vol, avg_vol) → number (capped at 50)
4. classify_stock_phase(...) → 'تجميع' / 'تصاعد' / 'توزيع' / 'تخفيض'
5. classify_money_flow(buy_pct, sell_pct) → '🟢 سيولة داخلة' / '🔴 سيولة خارجة'

كل الشاشات (frontend + backend + Python analyzers + APIs) لازم تستورد من هنا.
"""
from __future__ import annotations

from typing import Optional, Tuple


# ============================================================================
# 1) SIGNAL CLASSIFICATION (master_score → STRONG_BUY / BUY / HOLD / SELL)
# ============================================================================
# Canonical thresholds — single source of truth
# Used by:
#   - src/app/api/unified/route.ts (was duplicated at lines 110-117 + 283-290)
#   - vps-service/analyzers/master_analyzer.py (THRESHOLDS dict at line 495)
#   - All prediction generators
# DO NOT change without updating all callers.

SIGNAL_THRESHOLDS = {
    'STRONG_BUY': 78,   # master_score >= 78
    'BUY':       65,    # master_score >= 65
    'ACCUMULATE': 55,   # master_score >= 55
    # HOLD: 40 <= score < 55
    'REDUCE':    40,    # master_score >= 40
    # SELL: 25 <= score < 40
    'STRONG_SELL': 25,  # master_score < 25
}


def classify_signal(master_score: float | int | None) -> str:
    """تصنيف الإشارة بناءً على master_score — مصدر واحد.

    Args:
        master_score: 0-100

    Returns:
        'STRONG_BUY' / 'BUY' / 'ACCUMULATE' / 'HOLD' / 'REDUCE' / 'SELL' / 'STRONG_SELL'
    """
    if master_score is None:
        return 'HOLD'
    s = float(master_score)
    if s >= SIGNAL_THRESHOLDS['STRONG_BUY']:
        return 'STRONG_BUY'
    if s >= SIGNAL_THRESHOLDS['BUY']:
        return 'BUY'
    if s >= SIGNAL_THRESHOLDS['ACCUMULATE']:
        return 'ACCUMULATE'
    if s >= SIGNAL_THRESHOLDS['REDUCE']:
        return 'HOLD'
    if s >= SIGNAL_THRESHOLDS['STRONG_SELL']:
        return 'SELL'
    return 'STRONG_SELL'


def signal_ar(signal: str) -> str:
    """ترجمة الإشارة للعربية — مصدر واحد."""
    return {
        'STRONG_BUY':  'شراء قوي',
        'BUY':         'شراء',
        'ACCUMULATE':  'تجميع',
        'HOLD':        'انتظار',
        'REDUCE':      'تخفيض',
        'SELL':        'بيع',
        'STRONG_SELL': 'بيع قوي',
    }.get(signal, 'انتظار')


# ============================================================================
# 2) ACCUMULATION / DISTRIBUTION (buy_pct → label)
# ============================================================================
# FIX (Task CALC-DUP-1): قبل كده كان فيه 9 صيغ مختلفة لـ "تجميع/تصريف".
# الصيغة دي كانت بتعدّ أيام الإغلاق الأخضر vs الأحمر في 10 أيام — طريقة خاطئة
# لأنها بتعمل "تصريف قوي" لما buy_pct=75% (تناقض واضح للعميل).
#
# Canonical: نستخدم buy_pct من compute_money_flow كمصدر وحيد.

ACCUMULATION_THRESHOLDS = {
    'STRONG_ACCUMULATION': 70,  # buy_pct >= 70%
    'ACCUMULATION':        60,  # buy_pct >= 60%
    'LIGHT_ACCUMULATION':  55,  # buy_pct >= 55%
    'NEUTRAL':             45,  # 45% <= buy_pct < 55%
    'LIGHT_DISTRIBUTION':  40,  # 40% <= buy_pct < 45%
    'DISTRIBUTION':        30,  # 30% <= buy_pct < 40%
    # STRONG_DISTRIBUTION: buy_pct < 30%
}


def classify_accumulation(buy_pct: float | int | None) -> str:
    """تصنيف التجميع/التصريف بناءً على buy_pct — مصدر واحد.

    Args:
        buy_pct: 0-100 (نسبة شراء من إجمالي التداول)

    Returns:
        'تجميع قوي' / 'تجميع' / 'تجميع خفيف' / 'محايد'
        / 'تصريف خفيف' / 'تصريف' / 'تصريف قوي'
    """
    if buy_pct is None:
        return 'محايد'
    b = float(buy_pct)
    if b >= ACCUMULATION_THRESHOLDS['STRONG_ACCUMULATION']:
        return 'تجميع قوي'
    if b >= ACCUMULATION_THRESHOLDS['ACCUMULATION']:
        return 'تجميع'
    if b >= ACCUMULATION_THRESHOLDS['LIGHT_ACCUMULATION']:
        return 'تجميع خفيف'
    if b >= ACCUMULATION_THRESHOLDS['NEUTRAL']:
        return 'محايد'
    if b >= ACCUMULATION_THRESHOLDS['LIGHT_DISTRIBUTION']:
        return 'تصريف خفيف'
    if b >= ACCUMULATION_THRESHOLDS['DISTRIBUTION']:
        return 'تصريف'
    return 'تصريف قوي'


# ============================================================================
# 3) MONEY FLOW STATE (buy_pct + sell_pct → emoji label)
# ============================================================================

def classify_money_flow(buy_pct: float | int | None,
                         sell_pct: float | int | None,
                         net_flow_egp: float | int | None = None) -> str:
    """تصنيف حالة السيولة — مصدر واحد.

    Args:
        buy_pct: نسبة الشراء (0-100)
        sell_pct: نسبة البيع (0-100)
        net_flow_egp: صافي التدفق بالنقد (optional، لو موجود بنستخدمه للتأكيد)

    Returns:
        '🟢 سيولة داخلة قوية' / '🟢 سيولة داخلة' / '🟡 سيولة متوازنة'
        / '🔴 سيولة خارجة' / '🔴 سيولة خارجة قوية'
    """
    if buy_pct is None or sell_pct is None:
        return '🟡 سيولة متوازنة'
    b = float(buy_pct)
    s = float(sell_pct)
    diff = b - s  # الفرق بين الشراء والبيع

    if diff >= 25:
        return '🟢 سيولة داخلة قوية'
    if diff >= 10:
        return '🟢 سيولة داخلة'
    if diff >= -10:
        return '🟡 سيولة متوازنة'
    if diff >= -25:
        return '🔴 سيولة خارجة'
    return '🔴 سيولة خارجة قوية'


# ============================================================================
# 4) VOLUME RATIO (entry_vol / avg_20d_vol — capped at 50)
# ============================================================================
# FIX (Task CALC-DUP-1): كان فيه 3 صيغ مختلفة لـ volume_ratio:
# - live_price.py: avg_volume_20 (uncapped)
# - phase1a_common.py: entry_vol/avg_vol capped 50
# - radar-alerts.ts: 10d_avg/20d_avg (metric مختلف أصلاً)
#
# Canonical: entry_vol / avg_20d_vol، capped at 50 (تجنّب القيم المتطرفة)

def classify_volume_ratio(entry_volume: float | int | None,
                           avg_volume_20d: float | int | None) -> Optional[float]:
    """حساب نسبة الحجم — مصدر واحد.

    Args:
        entry_volume: حجم يوم الدخول
        avg_volume_20d: متوسط حجم 20 يوم

    Returns:
        ratio (float) capped at 50.0 — أو None لو المدخلات غير صالحة
    """
    if entry_volume is None or avg_volume_20d is None:
        return None
    try:
        v = float(entry_volume)
        avg = float(avg_volume_20d)
        if avg <= 0:
            return None
        ratio = v / avg
        # Cap at 50 (تجنّب القيم المتطرفة من شركات صغيرة بأيام أرباح مثلاً)
        return min(ratio, 50.0)
    except (TypeError, ValueError):
        return None


# ============================================================================
# 5) STOCK PHASE (تجميع / تصاعد / توزيع / تخفيض)
# ============================================================================
# FIX (Task CALC-DUP-1): كان فيه 4 taxonomies مختلفة لـ "phase":
# - stock_state.py: correction-depth (NO_CORRECTION/EARLY_DROP/...)
# - entry_gate.py: MA50/MA200 (DOWNTREND/PULLBACK/UPTREND/...)
# - maestro_orchestrator.py: regime (تجميع/تصاعد/توزيع/تخفيض)  ← ده الصح
# - chart_routes.py: news (تجميع/تصريف/محايد/غير محدد)
#
# Canonical: نستخدم regime taxonomy (تجميع/تصاعد/توزيع/تخفيض)

def classify_stock_phase(buy_pct: float | int | None,
                          roc_10d: float | int | None = None,
                          roc_30d: float | int | None = None) -> str:
    """تصنيف فترة السهم — مصدر واحد (regime-based).

    القواعد:
    - تجميع: buy_pct >= 60% + roc_10d ضعيف (-3% إلى +5%) → السهم بيتجمَّع بهدوء
    - تصاعد: buy_pct >= 55% + roc_10d > +5% → السهم بيتصاعد بحجم شراء
    - توزيع: buy_pct <= 40% + roc_10d > -3% → السهم بيتوزّع (بيع بقوة بسعر مستقر)
    - تخفيض: buy_pct <= 40% + roc_10d < -3% → السهم بينخفض بحجم بيع

    Args:
        buy_pct: نسبة الشراء (0-100)
        roc_10d: تغير السعر في 10 أيام (percentage)
        roc_30d: تغير السعر في 30 يوم (optional)

    Returns:
        'تجميع' / 'تصاعد' / 'توزيع' / 'تخفيض' / 'محايد'
    """
    if buy_pct is None:
        return 'محايد'
    b = float(buy_pct)
    r10 = float(roc_10d) if roc_10d is not None else 0.0

    if b >= 60 and -3 <= r10 <= 5:
        return 'تجميع'  # شراء قوي + سعر مستقر = تجميع هادئ
    if b >= 55 and r10 > 5:
        return 'تصاعد'  # شراء قوي + سعر بيرتفع = تصاعد
    if b <= 40 and r10 > -3:
        return 'توزيع'  # بيع قوي + سعر لسه مستقر = توزيع
    if b <= 40 and r10 < -3:
        return 'تخفيض'  # بيع قوي + سعر بينزل = تخفيض
    return 'محايد'


def phase_ar(phase: str) -> str:
    """ترجمة الفترة للعربية — مصدر واحد."""
    return phase  # الـ labels بالفعل عربية في canonical


# ============================================================================
# SELF-TEST — للتأكد إن الـ functions بتشتغل صح
# ============================================================================
if __name__ == '__main__':
    print('=== canonical_signal.py self-test ===\n')

    # Test 1: classify_signal
    assert classify_signal(80) == 'STRONG_BUY'
    assert classify_signal(70) == 'BUY'
    assert classify_signal(60) == 'ACCUMULATE'
    assert classify_signal(50) == 'HOLD'
    assert classify_signal(35) == 'SELL'
    assert classify_signal(20) == 'STRONG_SELL'
    assert classify_signal(None) == 'HOLD'
    print('✅ classify_signal: OK')

    # Test 2: classify_accumulation
    assert classify_accumulation(75) == 'تجميع قوي'  # ETCL case: buy_pct=75.7 → تجميع قوي (مش تصريف)
    assert classify_accumulation(65) == 'تجميع'
    assert classify_accumulation(58) == 'تجميع خفيف'
    assert classify_accumulation(50) == 'محايد'
    assert classify_accumulation(42) == 'تصريف خفيف'
    assert classify_accumulation(35) == 'تصريف'
    assert classify_accumulation(20) == 'تصريف قوي'
    print('✅ classify_accumulation: OK')

    # Test 3: classify_money_flow
    assert classify_money_flow(75, 25) == '🟢 سيولة داخلة قوية'
    assert classify_money_flow(60, 40) == '🟢 سيولة داخلة'
    assert classify_money_flow(50, 50) == '🟡 سيولة متوازنة'
    assert classify_money_flow(40, 60) == '🔴 سيولة خارجة'
    assert classify_money_flow(25, 75) == '🔴 سيولة خارجة قوية'
    print('✅ classify_money_flow: OK')

    # Test 4: classify_volume_ratio
    assert classify_volume_ratio(200, 100) == 2.0
    assert classify_volume_ratio(10000, 100) == 50.0  # capped
    assert classify_volume_ratio(100, 0) is None  # div by zero
    assert classify_volume_ratio(None, 100) is None
    print('✅ classify_volume_ratio: OK')

    # Test 5: classify_stock_phase
    assert classify_stock_phase(65, 1) == 'تجميع'   # شراء قوي + سعر مستقر
    assert classify_stock_phase(60, 10) == 'تصاعد'  # شراء قوي + سعر بيرتفع
    assert classify_stock_phase(35, 1) == 'توزيع'   # بيع قوي + سعر مستقر
    assert classify_stock_phase(35, -5) == 'تخفيض'  # بيع قوي + سعر بينزل
    assert classify_stock_phase(50, 0) == 'محايد'
    print('✅ classify_stock_phase: OK')

    print('\n=== All canonical_signal tests passed ===')
    print('\n--- ETCL case validation ---')
    print(f'ETCL buy_pct=75.7%, roc_10d=-2% → accumulation = {classify_accumulation(75.7)}')
    print(f'ETCL buy_pct=75.7%, sell_pct=24.3% → money_flow = {classify_money_flow(75.7, 24.3)}')
    print(f'ETCL buy_pct=75.7%, roc_10d=-2% → phase = {classify_stock_phase(75.7, -2)}')
    print(f'\nالنتيجة: كل الشاشات لازم تقول "تجميع قوي" + "🟢 سيولة داخلة قوية" + "تجميع"')
