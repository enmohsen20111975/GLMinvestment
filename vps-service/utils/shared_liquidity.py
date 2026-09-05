"""
shared_liquidity.py — DYNAMIC-LIQUIDITY-V2 (2026-09-04)
=======================================================
المرجع الموحّد لحد السيولة الأدنى المبني على سعر السهم.

قرار المالك (2026-09-04):
  "الحد الثابت 500K/3M بـ يرفض explosive movers شرعيين. نخلي الحد ديناميكي
   حسب سعر السهم: < 5 → 80K, 5-15 → 200K, > 15 → 400K."

شروط الحماية الإلزامية:
  1. turnover == 0 → ارفض فوري (pump-and-dump guard)
  2. volume_surge_bypass: volume_5d > 1.5× avg_20d + السعر فوق MA20
     → سمح بالدخول بـ position size صغير (2-3%)
  3. سيولة قليلة بدون علامة تجميع → ارفض

الاستخدام:
  from utils.shared_liquidity import (
      dynamic_min_turnover,
      has_volume_surge,
      should_reject_by_liquidity,
      LIQUIDITY_BYPASS_POSITION_SIZE,
  )

  threshold = dynamic_min_turnover(price)
  bypass = has_volume_surge(volumes, closes)
"""

from __future__ import annotations
from typing import List, Optional, Tuple


# ─── العتبات الجديدة (DECISION 2026-09-04) ──────────────────────────────────
# بناءً على تحليل 407 سهم EGX + 42 explosive mover على 60 يوم.
# الـ sweet spots اللي طلعت من محاكاة thresholds:
#   - low_price  (<5 EGP):   80K  (killed 2/10 بدلاً من 3 بالـ 500K)
#   - mid_price  (5-15 EGP): 200K (killed 1/8 بدلاً من 4 بالـ 3M)
#   - high_price (>15 EGP):  400K (killed 2/21 بدلاً من 7 بالـ 3M)
DYNAMIC_TURNOVER_THRESHOLDS = {
    'low_price':   80_000,    # price < 5 EGP
    'mid_price':  200_000,    # 5 ≤ price ≤ 15 EGP
    'high_price': 400_000,    # price > 15 EGP
}

# ─── شروط الحماية ──────────────────────────────────────────────────────────
# 1. Pump-and-dump guard: لو turnover = 0 → ارفض فوري (لا تجاوز)
PUMP_AND_DUMP_TURNOVER_FLOOR = 0.0

# 2. Volume surge bypass: لو volume_5d > 1.5× avg_20d + السعر فوق MA20
#    → سمح بالدخول بـ position size صغير (2-3%)
VOLUME_SURGE_RATIO = 1.5          # × متوسط 20d
VOLUME_SURGE_LOOKBACK = 5         # آخر 5 شموع
VOLUME_BASE_LOOKBACK = 20         # متوسط 20 شموع
VOLUME_SURGE_MA_PERIOD = 20       # MA20 للسعر
LIQUIDITY_BYPASS_POSITION_SIZE = 0.025   # 2.5% (في وسط الـ 2-3% المقترح)
LIQUIDITY_BYPASS_THRESHOLD_REDUCTION = 0.5   # خفّض الـ threshold لـ 50%

# 3. Dead market ceiling: لو السوق كله ميت → ارفع لـ 700K (موجود بالفعل في الكود القديم)
DEAD_MARKET_CEILING = 700_000

# ─── PHASE-1: EXPLOSIVE SURGE PATH (2026-09-04) ────────────────────────────
# قرار المالك: مسار خاص لصيد الأسهم الانفجارية اللي بتطير من السيولة القليلة.
# الشروط (كلها مع بعض):
#   1. volume surge ≥ 2.5× (أقوى من الـ bypass العادي 1.5×)
#   2. السعر فوق SMA20
#   3. انضغاط سابق: range 20 يوم (قبل الـ surge) < 18%
# النتيجة: سمح بالدخول حتى لو السيولة المطلقة قليلة (بس turnover > 0)
# Position size: 2% فقط (أقل من الـ bypass العادي 2.5%)
EXPLOSIVE_SURGE_VOLUME_RATIO = 2.5      # × متوسط 20d (أقوى من bypass العادي)
EXPLOSIVE_SURGE_LOOKBACK = 5            # آخر 5 شموع للـ surge
EXPLOSIVE_SURGE_BASE = 20               # متوسط 20 شموع
EXPLOSIVE_SURGE_SMA_PERIOD = 20         # SMA20 للسعر
EXPLOSIVE_SURGE_RANGE_MAX_PCT = 18.0    # range 20 يوم < 18% (انضغاط)
EXPLOSIVE_SURGE_RANGE_WINDOW = 20       # عدد شموع الـ range (قبل الـ surge)
EXPLOSIVE_SURGE_POSITION_SIZE = 0.02    # 2% فقط (أقل من bypass العادي)


def classify_price_bucket(price: float) -> str:
    """تصنيف سعر السهم لـ bucket."""
    if price <= 0:
        return 'unknown'
    if price < 5:
        return 'low_price'
    if price <= 15:
        return 'mid_price'
    return 'high_price'


def dynamic_min_turnover(price: float, market_dead: bool = False) -> int:
    """حد السيولة الأدنى المبني على سعر السهم.

    القواعد (DECISION 2026-09-04):
      - price < 5      → 80K
      - 5 ≤ price ≤ 15 → 200K
      - price > 15     → 400K

    استثناء:
      - لو السوق كله ميت (market_dead=True) → ارفع لـ 700K
        (تجنّب أسهم تربية الدجاج في سوق راكد).

    Args:
        price: سعر السهم الحالي.
        market_dead: هل السوق كله ميت؟ (turnover اليوم < 70% من المتوسط)

    Returns:
        الحد الأدنى للـ turnover بالـ EGP.
    """
    if market_dead:
        return DEAD_MARKET_CEILING

    bucket = classify_price_bucket(price)
    if bucket == 'unknown':
        # لو السعر مش معروف، استخدم الحد الأعلى (احتياط)
        return DYNAMIC_TURNOVER_THRESHOLDS['high_price']
    return DYNAMIC_TURNOVER_THRESHOLDS[bucket]


def has_volume_surge(
    volumes: List[float],
    closes: List[float] = None,
    surge_ratio: float = VOLUME_SURGE_RATIO,
    surge_lookback: int = VOLUME_SURGE_LOOKBACK,
    base_lookback: int = VOLUME_BASE_LOOKBACK,
    ma_period: int = VOLUME_SURGE_MA_PERIOD,
) -> Tuple[bool, str]:
    """فحص هل فيه volume surge + السعر فوق MA20.

    الشرط:
      - volume_5d / avg_20d ≥ 1.5
      - close > MA20 (إذا توفرت closes)

    Returns:
        (True/False, reason)
    """
    if not volumes or len(volumes) < base_lookback:
        return False, f'بيانات حجم غير كافية ({len(volumes) if volumes else 0} < {base_lookback})'

    recent_vol = volumes[-surge_lookback:]
    recent_avg = sum(recent_vol) / len(recent_vol)
    base_vol = volumes[-base_lookback:]
    base_avg = sum(base_vol) / len(base_vol)

    if base_avg <= 0:
        return False, 'متوسط الحجم = 0'

    ratio = recent_avg / base_avg
    if ratio < surge_ratio:
        return False, f'volume_surge_ratio={ratio:.2f} < {surge_ratio}'

    # فحص السعر فوق MA20 (لو توفر closes)
    if closes and len(closes) >= ma_period:
        ma20 = sum(closes[-ma_period:]) / ma_period
        last_close = closes[-1]
        if last_close <= ma20:
            return False, f'السعر {last_close:.2f} تحت MA20 {ma20:.2f} — لا يوجد تأكيد تجميع'

    return True, f'volume_surge_ratio={ratio:.2f} ≥ {surge_ratio} + السعر فوق MA20'


# ============================================================================
# PHASE-1: EXPLOSIVE SURGE PATH — صيد الأسهم الانفجارية (2026-09-04)
# ============================================================================
def is_explosive_surge(
    volumes: List[float],
    closes: List[float] = None,
    surge_ratio: float = EXPLOSIVE_SURGE_VOLUME_RATIO,
    surge_lookback: int = EXPLOSIVE_SURGE_LOOKBACK,
    base_lookback: int = EXPLOSIVE_SURGE_BASE,
    sma_period: int = EXPLOSIVE_SURGE_SMA_PERIOD,
    range_max_pct: float = EXPLOSIVE_SURGE_RANGE_MAX_PCT,
    range_window: int = EXPLOSIVE_SURGE_RANGE_WINDOW,
) -> Tuple[bool, str, dict]:
    """PHASE-1: مسار صيد الأسهم الانفجارية.

    قرار المالك (2026-09-04): مسار خاص لصيد الأسهم اللي بتطير من السيولة القليلة.
    الشروط (كلها مع بعض):
      1. volume surge ≥ 2.5× متوسط 20d (أقوى من الـ bypass العادي 1.5×)
      2. السعر فوق SMA20
      3. انضغاط سابق: range 20 يوم (قبل الـ surge) < 18%

    لو كلها متحققة → سمح بالدخول حتى لو السيولة المطلقة قليلة (بس turnover > 0).
    Position size: 2% فقط.

    Returns:
        (is_explosive, reason, details)
        is_explosive: True لو كل الشروط متحققة
        reason: وصف
        details: dict فيه vol_ratio, sma20, range_pct, etc.
    """
    details = {
        'vol_ratio': 0.0,
        'sma20': None,
        'price_vs_sma20': None,
        'range_pct': None,
        'range_compressed': None,
    }

    if not volumes or len(volumes) < base_lookback + surge_lookback:
        return False, f'بيانات حجم غير كافية ({len(volumes) if volumes else 0} < {base_lookback + surge_lookback})', details

    # 1. Volume surge ≥ 2.5×
    recent_vol = volumes[-surge_lookback:]
    recent_avg = sum(recent_vol) / len(recent_vol)
    # base = الـ 20 شمعة قبل الـ surge (مش شامله الـ surge نفسه)
    base_vol = volumes[-(surge_lookback + base_lookback):-surge_lookback]
    if len(base_vol) < base_lookback:
        base_vol = volumes[-base_lookback:]
    base_avg = sum(base_vol) / len(base_vol) if base_vol else 0

    if base_avg <= 0:
        return False, 'متوسط الحجم 20d = 0', details

    vol_ratio = recent_avg / base_avg
    details['vol_ratio'] = round(vol_ratio, 2)

    if vol_ratio < surge_ratio:
        return False, f'vol_surge {vol_ratio:.2f} < {surge_ratio} (مطلوب ≥ 2.5×)', details

    # 2. السعر فوق SMA20
    if not closes or len(closes) < sma_period:
        return False, f'بيانات سعر غير كافية لـ SMA{sma_period}', details

    sma20 = sum(closes[-sma_period:]) / sma_period
    last_close = closes[-1]
    details['sma20'] = round(sma20, 4)
    details['price_vs_sma20'] = round(last_close - sma20, 4)

    if last_close <= sma20:
        return False, f'السعر {last_close:.2f} ≤ SMA20 {sma20:.2f}', details

    # 3. انضغاط سابق: range 20 يوم (قبل الـ surge) < 18%
    # ناخذ الـ 20 شمعة قبل آخر 5 شموع (الـ surge)
    if len(closes) < range_window + surge_lookback:
        # fallback: نستخدم آخر 20 شمعة (بما فيها الـ surge — أقل دقة)
        pre_window = closes[-range_window:] if len(closes) >= range_window else closes
    else:
        pre_window = closes[-(range_window + surge_lookback):-surge_lookback]

    if len(pre_window) < 5:
        return False, 'بيانات غير كافية لحساب الـ range', details

    min_price = min(pre_window)
    max_price = max(pre_window)
    if min_price <= 0:
        return False, 'سعر صفري في النافذة', details

    range_pct = (max_price - min_price) / min_price * 100.0
    details['range_pct'] = round(range_pct, 2)
    details['range_compressed'] = range_pct < range_max_pct

    if range_pct >= range_max_pct:
        return False, f'range {range_pct:.1f}% ≥ {range_max_pct}% (مش منضغط)', details

    # كل الشروط متحققة → EXPLOSIVE SURGE!
    return True, (
        f'🔥 EXPLOSIVE_SURGE — vol {vol_ratio:.2f}× ≥ {surge_ratio} + سعر فوق SMA20 '
        f'({last_close:.2f} > {sma20:.2f}) + range منضغط ({range_pct:.1f}% < {range_max_pct}%). '
        f'⚠️ position size 2% (EXPLOSIVE_SURGE_POSITION_SIZE)'
    ), details


def should_reject_by_liquidity(
    avg_turnover: float,
    current_price: float,
    volumes: List[float] = None,
    closes: List[float] = None,
    market_dead: bool = False,
) -> Tuple[bool, str, bool, float, bool]:
    """قرار الرفض/القبول بناءً على السيولة — DYNAMIC-LIQUIDITY-V2 + PHASE-1 EXPLOSIVE SURGE.

    Returns:
        (rejected, reason, bypass_activated, effective_threshold, explosive_surge_activated)

    rejected: True لو السهم يُرفض
    reason: وصف القرار
    bypass_activated: True لو الـ volume_surge_bypass اشتغل (position size 2.5%)
    effective_threshold: الحد الفعلي المستخدم
    explosive_surge_activated: True لو الـ EXPLOSIVE_SURGE path اشتغل (position size 2%)

    أولوية الفحص:
      1. turnover=0 → ارفض (pump-and-dump guard)
      2. turnover ≥ dynamic threshold → اقبل عادي
      3. EXPLOSIVE_SURGE (2.5× + SMA20 + range<18%) → اقبل بـ position size 2%
         (حتى لو turnover < 50% threshold — ده أقوى من bypass العادي)
      4. VOLUME_SURGE_BYPASS (1.5× + MA20) + turnover ≥ 50% threshold → اقبل بـ 2.5%
      5. else → ارفض
    """
    # 1. Pump-and-dump guard — ارفض فوري لو turnover = 0
    if avg_turnover <= PUMP_AND_DUMP_TURNOVER_FLOOR:
        return (
            True,
            f'🚨 pump-and-dump guard — turnover=0 (لا توجد سيولة إطلاقاً)',
            False,
            0.0,
            False,
        )

    # 2. احسب الـ threshold الديناميكي
    threshold = dynamic_min_turnover(current_price, market_dead=market_dead)

    # 3. لو فوق الـ threshold → اقبل عادي
    if avg_turnover >= threshold:
        return (
            False,
            f'سيولة كافية — turnover={avg_turnover:,.0f} ≥ {threshold:,} ({classify_price_bucket(current_price)})',
            False,
            float(threshold),
            False,
        )

    # 4. PHASE-1: فحص EXPLOSIVE_SURGE path أولاً (أقوى، position size أصغر)
    #    لو تحقق → اقبل بـ 2% حتى لو turnover < 50% threshold
    explosive, explosive_reason, explosive_details = is_explosive_surge(volumes, closes)
    if explosive:
        return (
            False,
            explosive_reason,
            False,           # bypass_activated = False (مش الـ bypass العادي)
            float(threshold), # threshold الأصلي (مش المخفّض)
            True,            # explosive_surge_activated = True
        )

    # 5. لو تحت الـ threshold → فحص volume surge bypass العادي
    bypass, bypass_reason = has_volume_surge(volumes, closes)
    if bypass:
        # خفّض الـ threshold لـ 50% (DECISION 2026-09-04)
        reduced_threshold = threshold * LIQUIDITY_BYPASS_THRESHOLD_REDUCTION
        if avg_turnover >= reduced_threshold:
            return (
                False,
                f'🔥 VOLUME_SURGE_BYPASS — turnover={avg_turnover:,.0f} ≥ {reduced_threshold:,.0f} (50% من {threshold:,}). '
                f'السبب: {bypass_reason}. ⚠️ استخدم position size 2.5% (LIQUIDITY_BYPASS_POSITION_SIZE)',
                True,
                float(reduced_threshold),
                False,
            )
        # حتى الـ bypass ما قدرش — turnover أقل من 50% من threshold
        # بس لو فيه explosive_surge signals (vol ≥ 2.5× بس range مش منضغط أو price تحت SMA20)
        # نرفض بأمان
        return (
            True,
            f'🚨 سيولة ميتة — turnover={avg_turnover:,.0f} < {reduced_threshold:,.0f} (حتى بعد تخفيض 50% لـ bypass). '
            f'باس: {bypass_reason}. explosive: {explosive_reason}',
            False,
            float(reduced_threshold),
            False,
        )

    # 6. سيولة قليلة بدون أي علامة تجميع → ارفض
    return (
        True,
        f'🚨 سيولة ميتة — turnover={avg_turnover:,.0f} < {threshold:,} ({classify_price_bucket(current_price)}) '
        f'بدون volume surge. bypass: {bypass_reason}. explosive: {explosive_reason}',
        False,
        float(threshold),
        False,
    )


def position_size_for_liquidity_bypass(bypass_activated: bool, default_pct: float = 0.08, explosive_surge_activated: bool = False) -> float:
    """لو الـ bypass اشتغل → position size 2.5% | لو explosive → 2%."""
    if explosive_surge_activated:
        return EXPLOSIVE_SURGE_POSITION_SIZE
    if bypass_activated:
        return LIQUIDITY_BYPASS_POSITION_SIZE
    return default_pct


__all__ = [
    'DYNAMIC_TURNOVER_THRESHOLDS',
    'PUMP_AND_DUMP_TURNOVER_FLOOR',
    'VOLUME_SURGE_RATIO',
    'LIQUIDITY_BYPASS_POSITION_SIZE',
    'LIQUIDITY_BYPASS_THRESHOLD_REDUCTION',
    'DEAD_MARKET_CEILING',
    'EXPLOSIVE_SURGE_VOLUME_RATIO',
    'EXPLOSIVE_SURGE_POSITION_SIZE',
    'EXPLOSIVE_SURGE_RANGE_MAX_PCT',
    'classify_price_bucket',
    'dynamic_min_turnover',
    'has_volume_surge',
    'is_explosive_surge',
    'should_reject_by_liquidity',
    'position_size_for_liquidity_bypass',
]
