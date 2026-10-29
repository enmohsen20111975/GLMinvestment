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
import statistics


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
#   1. volume surge ≥ 2.0× (أقوى من الـ bypass العادي 1.5×)
#   2. السعر فوق SMA20
#   3. انضغاط سابق: range 20 يوم (قبل الـ surge) < 18%
# النتيجة: سمح بالدخول حتى لو السيولة المطلقة قليلة (بس turnover > 0)
# Position size: 2% فقط (أقل من الـ bypass العادي 2.5%)
EXPLOSIVE_SURGE_VOLUME_RATIO = 2.8      # AUDIT-FIX: 2.8× (كان 1.7 — مش انفجار حقيقي)
EXPLOSIVE_SURGE_LOOKBACK = 5            # آخر 5 شموع للـ surge
EXPLOSIVE_SURGE_BASE = 20               # متوسط 20 شموع
EXPLOSIVE_SURGE_SMA_PERIOD = 20         # SMA20 للسعر
EXPLOSIVE_SURGE_RANGE_MAX_PCT = 11.0    # AUDIT-FIX: 11% (كان 18 — مش ضغط حقيقي)
EXPLOSIVE_SURGE_RANGE_WINDOW = 20       # عدد شموع الـ range (قبل الـ surge)
EXPLOSIVE_SURGE_POSITION_SIZE = 0.02    # 2% فقط (أقل من bypass العادي)



def liquidity_intensity(turnover: float, market_cap: float) -> float:
    """AUDIT-FIX (2026-10-29): Liquidity Intensity = turnover / market_cap × 100.

    مش كل الأسهم بتتداول بنفس السيولة النسبية. سهم كابيتال 400M بيتداول 300K
    مش زي سهم كابيتال 12B بيتداول 300K. ده بـ يفرّق.

    Thresholds لـ EGX:
      ≥ 0.45%  → سيولة عالية
      0.15-0.45% → مقبولة
      0.05-0.15% → ضعيفة (position size أقل)
      < 0.05%  → ارفض إلا لو explosive حقيقي

    Returns:
        float (نسبة مئوية) أو None لو market_cap غير متاح.
    """
    if market_cap is None or market_cap <= 0:
        return None
    return (turnover / market_cap) * 100


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
    # BRAVO-FIX-F3-v2 (2026-10-25): non-overlapping baseline, NO fallback.
    required_len = surge_lookback + base_lookback
    if not volumes or len(volumes) < required_len:
        return False, (
            f'بيانات حجم غير كافية للـ non-overlap ({len(volumes) if volumes else 0} < {required_len}) '
            f'— مطلوب {surge_lookback} (recent) + {base_lookback} (base) = {required_len} جلسة'
        )

    recent_vol = volumes[-surge_lookback:]
    recent_avg = sum(recent_vol) / len(recent_vol)
    base_vol = volumes[-(surge_lookback + base_lookback):-surge_lookback]
    if len(base_vol) < base_lookback:
        return False, (
            f'base_vol أقصر من المطلوب ({len(base_vol)} < {base_lookback}) — رفض لمنع الانحياز'
        )
    base_avg = sum(base_vol) / len(base_vol) if base_vol else 0

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
      1. volume surge ≥ 2.0× متوسط 20d (أقوى من الـ bypass العادي 1.5×)
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

    # 1. Volume surge — BRAVO-EXPLOSIVE-MULTIDAY (2026-10-28):
    # قبل كده: avg(last 5) >= 2.0× → فات ETEL (يوم 27 كان 1.54× بس، يوم 28 مات)
    # دلوقتي: max(last 3) >= 1.7× + تأكيد سعري (price > SMA20)
    # ده بيـ catch الـ surges اللي بتحصل وتنطفض بسرعة في EGX.
    recent_vol = volumes[-surge_lookback:]
    recent_3 = volumes[-3:] if len(volumes) >= 3 else recent_vol
    recent_peak = max(recent_3) if recent_3 else 0
    # base = الـ 20 شمعة قبل الـ surge (مش شامله الـ surge نفسه)
    base_vol = volumes[-(surge_lookback + base_lookback):-surge_lookback]
    if len(base_vol) < base_lookback:
        base_vol = volumes[-base_lookback:]
    base_avg = sum(base_vol) / len(base_vol) if base_vol else 0

    if base_avg <= 0:
        return False, 'متوسط الحجم 20d = 0', details

    # BRAVO-EXPLOSIVE-MULTIDAY: vol_ratio = max(last 3) / base_avg
    vol_ratio = recent_peak / base_avg
    recent_avg = sum(recent_vol) / len(recent_vol)
    details['vol_ratio'] = round(vol_ratio, 2)
    details['vol_ratio_avg5'] = round(recent_avg / base_avg, 2)
    details['vol_peak_3d'] = round(recent_peak, 0)

    if vol_ratio < surge_ratio:
        return False, f'vol_surge {vol_ratio:.2f} < {surge_ratio} (max last 3d / base 20d)', details

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
      3. EXPLOSIVE_SURGE (2.0× + SMA20 + range<18%) → اقبل بـ position size 2%
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
        # بس لو فيه explosive_surge signals (vol ≥ 2.0× بس range مش منضغط أو price تحت SMA20)
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


# ============================================================================
# PHASE-2: QUIET ACCUMULATION — رادار الميكرز (2026-09-05)
# ============================================================================
# قرار المالك: نصطاد مرحلة التجميع الهادئ (مش الانفجار).
# الميكرز بيجمع بهدوء أيام قبل ما يولع السهم. لو امسكنا المرحلة دي → R:R ممتاز.

# ─── العتبات (مبنية على إشارات الميكرز) ──────────────────────────────────
# 1. حجم أعلى من المتوسط بشكل متكرر (مش يوم واحد)
QUIET_ACCUM_LOOKBACK = 10            # فحص آخر 10 أيام
QUIET_ACCUM_VOLUME_DAYS_HIGH = 4     # AUDIT-FIX: 4 من 10 (كان 3 — ضوضاء)
QUIET_ACCUM_VOLUME_RATIO_MIN = 1.35  # AUDIT-FIX: 1.35× (كان 1.1 — ضوضاء)

# 2. ضغط شراء متكرر: الـ close قريب من الـ high
QUIET_ACCUM_BUY_PRESSURE_DAYS = 5    # AUDIT-FIX: 5 من 10 (كان 4)
QUIET_ACCUM_CLOSE_TO_HIGH_PCT = 75.0 # تخفيف: close >= 75% (كان 80%)

# 3. العرض بيختفي: الـ range ضيق والحجم مش واطي
QUIET_ACCUM_RANGE_MAX_PCT = 9.0      # AUDIT-FIX: 9% (كان 14 — واسع أوه في EGX)
QUIET_ACCUM_AVG_VOL_RATIO_MIN = 0.85 # AUDIT-FIX: 85% (كان 70 — سهل)

# 4. السعر لسه مش طالع بقوة (مش انفجار)
QUIET_ACCUM_ROC_10D_MAX = 12.0      # تخفيف: ROC 10d < 12% (كان 10%)

# 5. مفيش توزيع واضح (مفيش بيع قوي)
QUIET_ACCUM_DIST_DAYS_MAX = 3       # تخفيف: على الأكثر 3 أيام distribution (كان 2)

# عدد الإشارات اللازمة (من 6 شروط) — تخفيف لـ 4/6
QUIET_ACCUMULATION_MIN_SIGNALS = 5   # تشديد رجع لـ 5/6 (كان 4 — خرب الدقة)

# Position size
QUIET_ACCUMULATION_POSITION_SIZE = 0.015  # 1.5% (قرار المالك 2026-09-05 — paper mode)

# ─── PHASE-3: PRE-SURGE — طبقة ما قبل الانفجار (الأولوية القصوى) ──────
# الشروط (محتاجين 3 من 4 على الأقل):
#   1. الحجم بيزيد تدريج على 5-10 أيام (مش قفزة واحدة)
#   2. الـ range اليومي صغير (السهم محبوس)
#   3. عدد أيام الشراء > عدد أيام البيع في آخر 7 أيام
#   4. السعر فوق أو قريب جداً من متوسط 10 أو 20 يوم
PRE_SURGE_LOOKBACK = 10              # فحص آخر 10 أيام
PRE_SURGE_MIN_SIGNALS = 3            # 3 من 4 إشارات
PRE_SURGE_VOLUME_GRADIENT_MIN = 0.15 # volume gradient ≥ 15% (نسبة الزيادة من أول لآخر يوم)
PRE_SURGE_RANGE_MAX_PCT = 10.0       # range 10d < 10% (محبوس)
PRE_SURGE_BUY_DAYS_MIN = 4          # 4 من 7 أيام شراء
PRE_SURGE_MA_PROXIMITY_PCT = 3.0    # خلال 3% من MA10/MA20
PRE_SURGE_POSITION_SIZE = 0.015     # 1.5% (أصغر حجم — أعلى مخاطرة)


def detect_quiet_accumulation(
    closes: List[float],
    volumes: List[float],
    highs: List[float] = None,
    lows: List[float] = None,
    regime: str = 'NORMAL',
) -> Tuple[bool, str, dict]:
    """PHASE-2: كشف مرحلة التجميع الهادئ (Quiet Accumulation).

    الميكرز بيجمع بهدوء أيام قبل ما يولع السهم. الإشارات:
      1. حجم أعلى من المتوسط بشكل متكرر
      2. ضغط شراء متكرر (close قريب من high)
      3. انضغاط سعري (range 10d < 12%)
      4. الحجم مش واطي (avg_10d ≥ 80% من avg_20d)
      5. مش انفجار (ROC 10d < 10%)
      6. مفيش توزيع (توزيع منخفض)

    ملاحظة: تتكيف القواعد ديناميكياً مع وضع السوق (Market Regime):
      - في وضع DEFENSIVE (شح سيولة وهبوط السوق): تتكيف عتبات ضغط الشراء والحجم.

    Task IMPROVEMENT-21-2026-10-07: فلتر الاتجاه العام
      - لو السهم نزل > 12% في 20 يوم → مش تجميع (ده هبوط)
      - لو السهم نزل > 8% في 10 يوم → مش تجميع (ده هبوط حاد)
      - التجميع الحقيقي بيحصل قرب القاع أو في نطاق ضيق صاعد، مش في سهم نازل 17%

    Returns:
        (is_quiet_accumulation, reason, details)
    """
    is_defensive = str(regime).upper() == 'DEFENSIVE'
    details = {
        'signal_count': 0,
        'signals_met': [],
        'signals_failed': [],
        'regime': regime,
    }

    # lookback = 18 يوم (توازن بين البدري والدقة)
    needed = 18
    if not closes or len(closes) < needed or not volumes or len(volumes) < needed:
        return False, f'بيانات غير كافية ({len(closes) if closes else 0} < {needed})', details

    # ── Task IMPROVEMENT-21: فلتر الاتجاه العام (Trend Filter) ──
    # لو السهم نازل بشدة → مش تجميع، ده هبوط
    # FIX (2026-10-29): >= 21 → >= 20 (نفس الـ bug اللي في compute_money_flow)
    if len(closes) >= 20 and closes[-20] > 0:
        roc_20d = (closes[-1] - closes[-20]) / closes[-20] * 100
        if roc_20d < -12.0:
            details['signals_failed'].append(f'0.trend_filter(ROC20={roc_20d:.1f}% < -12% = هبوط قوي)')
            return False, f'هبوط قوي (ROC20={roc_20d:.1f}%) — مش تجميع', details
    if len(closes) >= 11 and closes[-11] > 0:
        roc_10d = (closes[-1] - closes[-11]) / closes[-11] * 100
        if roc_10d < -8.0:
            details['signals_failed'].append(f'0.trend_filter(ROC10={roc_10d:.1f}% < -8% = هبوط حاد)')
            return False, f'هبوط حاد (ROC10={roc_10d:.1f}%) — مش تجميع', details

    # فلتر سيولة أدنى + استبعاد pump + RS (نفس اللي في Pre-Surge)
    avg_20_vol_qa = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else (sum(volumes) / len(volumes) if volumes else 0)
    last_close_qa = closes[-1]
    avg_turnover_qa = avg_20_vol_qa * last_close_qa
    if avg_turnover_qa < 50_000:
        return False, f'سيولة ميتة', details
    if len(closes) >= 2 and closes[-2] > 0:
        last_move_qa = (closes[-1] - closes[-2]) / closes[-2] * 100
        if last_move_qa > 50 and volumes[-1] < avg_20_vol_qa * 0.3:
            return False, 'pump مشبوه', details
    if len(closes) >= 11 and closes[-11] > 0:
        roc_qa = (closes[-1] - closes[-11]) / closes[-11] * 100
        min_roc_cutoff = -8.0 if is_defensive else -5.0
        if roc_qa < min_roc_cutoff:
            return False, f'ضعف نسبي (ROC10={roc_qa:.1f}% < {min_roc_cutoff}%)', details

    last_10_closes = closes[-10:]
    last_10_volumes = volumes[-10:]
    # avg_20_vol: لو مفيش 20 يوم، استخدم اللي متاح
    if len(volumes) >= 20:
        avg_20_vol = sum(volumes[-20:]) / 20
    else:
        avg_20_vol = sum(volumes) / len(volumes) if volumes else 0
    avg_10_vol = sum(last_10_volumes) / 10

    # 1. حجم أعلى من المتوسط بشكل متكرر
    vol_days_high_req = QUIET_ACCUM_VOLUME_DAYS_HIGH  # AUDIT-FIX: لا تخفيض في DEFENSIVE
    if avg_20_vol > 0:
        days_high_vol = sum(1 for v in last_10_volumes if v >= avg_20_vol * QUIET_ACCUM_VOLUME_RATIO_MIN)
        signal1 = days_high_vol >= vol_days_high_req
        details['days_high_volume'] = days_high_vol
        details['avg_20_vol'] = round(avg_20_vol, 0)
        if signal1:
            details['signals_met'].append(f'1.volume_high_recurring({days_high_vol}/{vol_days_high_req})')
        else:
            details['signals_failed'].append(f'1.volume_high_recurring({days_high_vol}/{vol_days_high_req})')

    # 2. ضغط شراء متكرر: close قريب من high
    if highs and lows and len(highs) >= 10 and len(lows) >= 10:
        last_10_highs = highs[-10:]
        last_10_lows = lows[-10:]
    else:
        last_10_highs = [max(closes[i], closes[i-1]) if i > 0 else closes[i] for i in range(-10, 0)]
        last_10_lows = [min(closes[i], closes[i-1]) if i > 0 else closes[i] for i in range(-10, 0)]

    buy_pressure_days = 0
    for i in range(10):
        h, l, c = last_10_highs[i], last_10_lows[i], last_10_closes[i]
        if h > l:
            close_pct = (c - l) / (h - l) * 100
            if close_pct >= QUIET_ACCUM_CLOSE_TO_HIGH_PCT:
                buy_pressure_days += 1
    buy_pressure_req = QUIET_ACCUM_BUY_PRESSURE_DAYS  # AUDIT-FIX: لا تخفيض في DEFENSIVE
    signal2 = buy_pressure_days >= buy_pressure_req
    details['buy_pressure_days'] = buy_pressure_days
    if signal2:
        details['signals_met'].append(f'2.buy_pressure({buy_pressure_days}/{buy_pressure_req})')
    else:
        details['signals_failed'].append(f'2.buy_pressure({buy_pressure_days}/{buy_pressure_req})')

    # 3. انضغاط سعري (range 10d < 12%)
    min_10 = min(last_10_closes)
    max_10 = max(last_10_closes)
    if min_10 > 0:
        range_pct = (max_10 - min_10) / min_10 * 100
    else:
        range_pct = 0
    signal3 = range_pct < QUIET_ACCUM_RANGE_MAX_PCT
    details['range_10d_pct'] = round(range_pct, 2)
    if signal3:
        details['signals_met'].append(f'3.compressed({range_pct:.1f}%<{QUIET_ACCUM_RANGE_MAX_PCT}%)')
    else:
        details['signals_failed'].append(f'3.compressed({range_pct:.1f}%≥{QUIET_ACCUM_RANGE_MAX_PCT}%)')

    # 4. الحجم مش واطي (avg_10d ≥ 80% من avg_20d)
    if avg_20_vol > 0:
        vol_ratio = avg_10_vol / avg_20_vol
        signal4 = vol_ratio >= QUIET_ACCUM_AVG_VOL_RATIO_MIN
        details['avg_vol_ratio'] = round(vol_ratio, 2)
        if signal4:
            details['signals_met'].append(f'4.volume_not_low({vol_ratio:.2f}≥{QUIET_ACCUM_AVG_VOL_RATIO_MIN})')
        else:
            details['signals_failed'].append(f'4.volume_not_low({vol_ratio:.2f}<{QUIET_ACCUM_AVG_VOL_RATIO_MIN})')

    # 5. مش انفجار (ROC 10d < 10%)
    if len(closes) >= 11 and closes[-11] > 0:
        roc_10d = (closes[-1] - closes[-11]) / closes[-11] * 100
        signal5 = roc_10d < QUIET_ACCUM_ROC_10D_MAX
        details['roc_10d'] = round(roc_10d, 2)
        if signal5:
            details['signals_met'].append(f'5.not_explosive({roc_10d:+.1f}%<{QUIET_ACCUM_ROC_10D_MAX}%)')
        else:
            details['signals_failed'].append(f'5.not_explosive({roc_10d:+.1f}%≥{QUIET_ACCUM_ROC_10D_MAX}%)')

    # 6. مفيش توزيع واضح
    dist_days_max = 3 if is_defensive else QUIET_ACCUM_DIST_DAYS_MAX
    dist_days = 0
    for i in range(10):
        h, l, c, v = last_10_highs[i], last_10_lows[i], last_10_closes[i], last_10_volumes[i]
        if h > l and avg_20_vol > 0:
            mid = (h + l) / 2
            if c < mid and v > avg_20_vol:
                dist_days += 1
    signal6 = dist_days <= dist_days_max
    details['distribution_days'] = dist_days
    if signal6:
        details['signals_met'].append(f'6.no_distribution({dist_days}≤{dist_days_max})')
    else:
        details['signals_failed'].append(f'6.no_distribution({dist_days}>{dist_days_max})')

    # احسب النتيجة النهائية
    details['signal_count'] = len(details['signals_met'])
    is_quiet = details['signal_count'] >= QUIET_ACCUMULATION_MIN_SIGNALS

    if is_quiet:
        reason = (
            f'🎯 QUIET_ACCUMULATION — {details["signal_count"]}/6 إشارات. '
            f'متجمعة: {", ".join(details["signals_met"])}. '
            f'⚠️ position size 2% (QUIET_ACCUMULATION_POSITION_SIZE)'
        )
    else:
        reason = f'مش quiet accumulation — {details["signal_count"]}/6 إشارات فقط'

    return is_quiet, reason, details


# ============================================================================
# PHASE-3: PRE-SURGE — طبقة ما قبل الانفجار (الأولوية القصوى)
# ============================================================================
def detect_pre_surge(
    closes: List[float],
    volumes: List[float],
    highs: List[float] = None,
    lows: List[float] = None,
    regime: str = 'NORMAL',
) -> Tuple[bool, str, dict]:
    """PHASE-3: كشف مرحلة ما قبل الانفجار (Pre-Surge).

    السهم لسه مش طار، بس فيه علامات تجميع مبكر. امسكه قبل الحركة.

    الشروط (محتاجين 3 من 4):
      1. الحجم بيزيد تدريج على 5-10 أيام (volume gradient ≥ 15%)
      2. الـ range اليومي صغير (range 10d < 10% — محبوس)
      3. عدد أيام الشراء المتماسكة في آخر 7 أيام (تتكيّف ديناميكياً مع وضع السوق)
      4. السعر فوق أو قريب جداً من MA10/MA20 (within 3%)

    تكييف وضع السوق (REGIME-ADAPTIVE):
      - في وضع DEFENSIVE (شح سيولة وهبوط المؤشر):
        الميكر يجمع بهدوء على هبوط، لذا شرط أيام الشراء يصبح 2 من 7 بدلاً من 4.
        السهم الذي يحقق تماسكاً وتدرج حجم في السوق الهابط هو أقوى إشارة تجميع حقيقية.

    Returns:
        (is_pre_surge, reason, details)
    """
    is_defensive = str(regime).upper() == 'DEFENSIVE'
    details = {
        'signal_count': 0,
        'signals_met': [],
        'signals_failed': [],
        'regime': regime,
    }

    # lookback = 18 يوم (توازن)
    needed = 18
    if not closes or len(closes) < needed or not volumes or len(volumes) < needed:
        return False, f'بيانات غير كافية ({len(closes) if closes else 0} < {needed})', details

    # فلتر سيولة أدنى + استبعاد pump (قرار المالك 2026-09-05)
    avg_20_vol_check = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else (sum(volumes) / len(volumes) if volumes else 0)
    last_close_check = closes[-1]
    avg_turnover_check = avg_20_vol_check * last_close_check
    # شرط سيولة أدنى: turnover ≥ 50K EGP (مش أسهم ميتة)
    if avg_turnover_check < 50_000:
        return False, f'سيولة ميتة (turnover {avg_turnover_check:.0f} < 50K)', details
    # استبعاد pump: لو آخر شمعة طلعت +50% مع سيولة شبه صفر → مش حقيقي
    if len(closes) >= 2 and closes[-2] > 0:
        last_move = (closes[-1] - closes[-2]) / closes[-2] * 100
        last_vol = volumes[-1] if volumes else 0
        if last_move > 50 and last_vol < avg_20_vol_check * 0.3:
            return False, f'pump مشبوه (move +{last_move:.0f}% + volume واطي)', details
    # فلتر قوة نسبية: في DEFENSIVE يسمح بهبوط طفيف حتى -8% تماشياً مع هبوط السوق
    if len(closes) >= 11 and closes[-11] > 0:
        roc_10d_rs = (closes[-1] - closes[-11]) / closes[-11] * 100
        min_rs_cutoff = -8.0 if is_defensive else -5.0
        if roc_10d_rs < min_rs_cutoff:
            return False, f'ضعف نسبي واضح (ROC10={roc_10d_rs:.1f}% < {min_rs_cutoff}%)', details

    last_10_closes = closes[-10:]
    last_10_volumes = volumes[-10:]
    last_7_closes = closes[-7:]
    last_7_volumes = volumes[-7:]

    # proxy highs/lows لو مش متاحة
    if highs and lows and len(highs) >= 10 and len(lows) >= 10:
        last_10_highs = highs[-10:]
        last_10_lows = lows[-10:]
    else:
        last_10_highs = [max(closes[i], closes[i-1]) if i > 0 else closes[i] for i in range(-10, 0)]
        last_10_lows = [min(closes[i], closes[i-1]) if i > 0 else closes[i] for i in range(-10, 0)]

    # 1. الحجم بيزيد تدريج (volume gradient)
    early_5_vol = sum(last_10_volumes[:5]) / 5
    late_5_vol = sum(last_10_volumes[5:]) / 5
    if early_5_vol > 0:
        vol_gradient = (late_5_vol - early_5_vol) / early_5_vol
    else:
        vol_gradient = 0
    signal1 = vol_gradient >= PRE_SURGE_VOLUME_GRADIENT_MIN
    details['volume_gradient'] = round(vol_gradient * 100, 1)
    if signal1:
        details['signals_met'].append(f'1.volume_gradient(+{vol_gradient*100:.1f}%≥{PRE_SURGE_VOLUME_GRADIENT_MIN*100}%)')
    else:
        details['signals_failed'].append(f'1.volume_gradient(+{vol_gradient*100:.1f}%<{PRE_SURGE_VOLUME_GRADIENT_MIN*100}%)')

    # 2. range اليومي صغير (محبوس)
    min_10 = min(last_10_closes)
    max_10 = max(last_10_closes)
    if min_10 > 0:
        range_pct = (max_10 - min_10) / min_10 * 100
    else:
        range_pct = 0
    signal2 = range_pct < PRE_SURGE_RANGE_MAX_PCT
    details['range_10d_pct'] = round(range_pct, 2)
    if signal2:
        details['signals_met'].append(f'2.range_compressed({range_pct:.1f}%<{PRE_SURGE_RANGE_MAX_PCT}%)')
    else:
        details['signals_failed'].append(f'2.range_compressed({range_pct:.1f}%≥{PRE_SURGE_RANGE_MAX_PCT}%)')

    # 3. أيام الشراء في آخر 7 أيام (متكيفة مع الريجيم)
    buy_days = 0
    for i in range(-7, 0):
        if i == -7:
            continue
        prev_c = closes[i-1] if i-1 >= -len(closes) else closes[i]
        if closes[i] > prev_c:
            buy_days += 1
    buy_days_min = 2 if is_defensive else PRE_SURGE_BUY_DAYS_MIN
    signal3 = buy_days >= buy_days_min
    details['buy_days_7'] = buy_days
    if signal3:
        details['signals_met'].append(f'3.buy_days({buy_days}/7≥{buy_days_min})')
    else:
        details['signals_failed'].append(f'3.buy_days({buy_days}/7<{buy_days_min})')

    # 4. السعر فوق أو قريب جداً من MA10/MA20
    ma10 = sum(closes[-10:]) / 10
    last_close = closes[-1]
    if ma10 > 0:
        dist_from_ma = abs(last_close - ma10) / ma10 * 100
    else:
        dist_from_ma = 100
    signal4 = dist_from_ma <= PRE_SURGE_MA_PROXIMITY_PCT
    details['distance_from_ma10_pct'] = round(dist_from_ma, 2)
    if signal4:
        details['signals_met'].append(f'4.near_ma10({dist_from_ma:.1f}%≤{PRE_SURGE_MA_PROXIMITY_PCT}%)')
    else:
        details['signals_failed'].append(f'4.near_ma10({dist_from_ma:.1f}%>{PRE_SURGE_MA_PROXIMITY_PCT}%)')

    # احسب النتيجة
    details['signal_count'] = len(details['signals_met'])
    is_pre_surge = details['signal_count'] >= PRE_SURGE_MIN_SIGNALS

    if is_pre_surge:
        reason = (
            f'🚀 PRE_SURGE — {details["signal_count"]}/4 إشارات (regime:{regime}). '
            f'متجمعة: {", ".join(details["signals_met"])}. '
            f'⚠️ position size 1.5% (PRE_SURGE_POSITION_SIZE)'
        )
    else:
        reason = f'مش pre-surge — {details["signal_count"]}/4 إشارات فقط (regime:{regime})'

    return is_pre_surge, reason, details


# ============================================================================
# PHASE-4: MONEY FLOW — تحليل السيولة الداخلة والخارجة (2026-09-05)
# ============================================================================
# مستوحى من V55 Pine Script — حساب حجم الشراء/البيع التقديري
# buy_vol = volume × ((close - low) / (high - low))
# ده بـ يفصل: الميكرز بـ يشتري بكم vs الناس العادية بـ تبيع بكم

def compute_money_flow(
    closes: List[float],
    volumes: List[float],
    highs: List[float] = None,
    lows: List[float] = None,
) -> dict:
    """PHASE-4: حساب Money Flow التقديري للسهم (نسخة محسّنة — محلل خبير).

    Task IMPROVEMENT-24-2026-10-07: إعادة كتابة كاملة
    المشكلة القديمة: كانت بتنظر لآخر شمعة بس → سهلة التلاعب بحركة يوم واحد
    الحل: تحليل متعدد الطبقات (محلل خبير):

    الطبقة 1: CLV لكل يوم في آخر 5 أيام (مش بس آخر يوم)
    الطبقة 2: اتجاه التدفق (CMF - Chaikin Money Flow على 20 يوم)
    الطبقة 3: تأكيد الحجم (حجم اليوم لازم يكون > متوسط 20 يوم)
    الطبقة 4: فلتر الارتداد الوهمي (لو السهم نازل > 10% في 20 يوم → ارتداد مش شراء)
    الطبقة 5: فلتر الموت السريري (لو حجم اليوم < 50% من المتوسط → مش شراء)
    الطبقة 6: توافق السعر (لو الإغلاق تحت SMA10 → مش شراء قوي)

    المعادلة النهائية (P2-13 FIX — docstring كان غير متطابق مع الكود):
      weighted_buy_pct = (CLV_5d_avg × 0.35) + (CMF × 0.30) + (vol_confirmation × 0.20) + (price_above_sma × 0.15)

    Returns:
        dict فيه: buy_pct, sell_pct, net_flow_egp, money_flow_state, + details
    """
    _default = {
        'buy_pct': 50.0, 'sell_pct': 50.0, 'net_flow_egp': 0,
        'buy_value_m': 0, 'sell_value_m': 0,
        'liquidity_state': 'متوازنة', 'money_flow_state': '⚪ متوازنة',
    }

    if not closes or not volumes or len(closes) < 5:
        return _default

    # ── البيانات الأساسية ──
    last_close = closes[-1]
    last_vol = volumes[-1] if volumes else 0
    last_open = closes[-2] if len(closes) >= 2 else last_close
    last_high = highs[-1] if highs and len(highs) > 0 and highs[-1] else max(last_close, last_open * 1.01)
    last_low = lows[-1] if lows and len(lows) > 0 and lows[-1] else min(last_close, last_open * 0.99)

    # متوسط 20 يوم للحجم
    if len(volumes) >= 20:
        avg_vol_20 = sum(volumes[-20:]) / 20
        vol_std = statistics.stdev(volumes[-20:]) if len(volumes) >= 21 else 0
    else:
        avg_vol_20 = sum(volumes) / len(volumes) if volumes else 1
        vol_std = 0
    vol_ratio = last_vol / avg_vol_20 if avg_vol_20 > 0 else 1.0

    # ── الطبقة 1: CLV لآخر 5 أيام (weighted — اليوم الأخير وزنه أكبر) ──
    clv_weights = [0.10, 0.15, 0.20, 0.25, 0.30]  # أقدم → أحدث
    clv_values = []
    for i in range(-5, 0):
        if abs(i) > len(closes) - 1:
            clv_values.append(0)
            continue
        c = closes[i]
        h = highs[i] if highs and abs(i) <= len(highs) - 1 and highs[i] else c * 1.01
        l = lows[i] if lows and abs(i) <= len(lows) - 1 and lows[i] else c * 0.99
        cr = max(h - l, 0.001)
        clv_d = ((c - l) - (h - c)) / cr
        clv_values.append(max(-1.0, min(1.0, clv_d)))

    # weighted average
    clv_5d_weighted = sum(clv_values[i] * clv_weights[i] for i in range(min(5, len(clv_values)))) / sum(clv_weights[:len(clv_values)])

    # ── الطبقة 2: CMF (Chaikin Money Flow) على 20 يوم ──
    cmf = 0.0
    if len(closes) >= 21 and len(volumes) >= 20:
        mfv_sum = 0
        vol_sum = 0
        for i in range(-20, 0):
            if abs(i) > len(closes) - 1:
                continue
            c = closes[i]
            h = highs[i] if highs and abs(i) <= len(highs) - 1 and highs[i] else c * 1.01
            l = lows[i] if lows and abs(i) <= len(lows) - 1 and lows[i] else c * 0.99
            cr = max(h - l, 0.001)
            clv_d = ((c - l) - (h - c)) / cr
            mfv_sum += clv_d * volumes[i]
            vol_sum += volumes[i]
        cmf = mfv_sum / vol_sum if vol_sum > 0 else 0
        cmf = max(-1.0, min(1.0, cmf))

    # ── الطبقة 3: تأكيد الحجم (vol_ratio → 0..1) ──
    # لو حجم اليوم > 1.5× المتوسط → تأكيد قوي (1.0)
    # لو حجم اليوم < 0.5× المتوسط → مش مؤكد (0.0)
    vol_confirmation = max(0, min(1.0, (vol_ratio - 0.5) / 1.0))

    # ── الطبقة 4: فلتر الارتداد الوهمي ──
    # FIX (2026-10-29): كان >= 21 (بيتطلب 21 يوم) → لو عندنا 20 يوم بس
    # roc_20d بيفضل 0 → الـ trend filter مش بيشتغل → السهم النازل بيتعامل معاه
    # كأنه سهم طالع. الحل: >= 20 + closes[-20].
    roc_20d = 0
    if len(closes) >= 20 and closes[-20] > 0:
        roc_20d = (closes[-1] - closes[-20]) / closes[-20] * 100

    # لو السهم نازل بشدة → الخصم
    trend_penalty = 0
    if roc_20d < -15.0:
        trend_penalty = -25  # خصم 25% (أقوى)
    elif roc_20d < -10.0:
        trend_penalty = -18
    elif roc_20d < -5.0:
        trend_penalty = -10
    elif roc_20d > 10.0:
        trend_penalty = +5  # مكافأة للسهم الصاعد

    # ── الطبقة 5: فلتر الموت السريري ──
    # لو حجم اليوم < 30% من المتوسط → مش شراء (موت سريري)
    is_dead = vol_ratio < 0.3

    # ── الطبقة 6: توافق السعر مع SMA10 ──
    price_above_sma = 0.5  # محايد
    if len(closes) >= 10:
        sma10 = sum(closes[-10:]) / 10
        if last_close > sma10:
            price_above_sma = 1.0  # فوق SMA10 = صعود
        else:
            price_above_sma = 0.0  # تحت SMA10 = هبوط

    # ── الحساب النهائي: weighted buy_pct ──
    import os as _os
    _USE_PINE_FORMULA = _os.environ.get('RADAR_USE_PINE_FORMULA', 'false').lower() == 'true'

    # CLV: -1..1 → 0..100
    clv_score = (clv_5d_weighted + 1) / 2 * 100  # 0..100
    # CMF: -1..1 → 0..100
    cmf_score = (cmf + 1) / 2 * 100  # 0..100
    # vol_confirmation: 0..1 → 0..100
    vol_score = vol_confirmation * 100
    # price_above_sma: 0..1 → 0..100
    sma_score = price_above_sma * 100

    is_today_strong_up = (last_close > closes[-2]) if len(closes) >= 2 else False

    # AUDIT-FIX (2026-10-29): امسحنا الـ branch اللي بـ يعطي 60% وزن لشمعة اليوم.
    # كان غلط: شمعة خضراء واحدة تقدر ترفع buy_pct لفوق 75% حتى لو CMF سلبي + trend هابط.
    # الحل: استخدم دايمًا المعادلة الموزونة + شمعة اليوم وزنها 15% بس.
    _today_clv_score = 50.0  # default neutral
    if len(closes) >= 2:
        _body_range = max(last_high - last_low, 0.0001)
        _today_clv = ((last_close - last_low) - (last_high - last_close)) / _body_range
        _today_clv_score = ((_today_clv + 1) / 2) * 100

    raw_buy_pct = (
        clv_score * 0.25 +          # CLV 5-day weighted
        cmf_score * 0.30 +          # CMF 20-day (الأهم)
        vol_score * 0.20 +          # volume confirmation
        sma_score * 0.10 +          # SMA alignment
        _today_clv_score * 0.15     # شمعة اليوم (15% بس، مش 60%)
    )

    # تطبيق trend penalty
    buy_pct = max(0, min(100, raw_buy_pct + trend_penalty))

    # طبقة الحماية النهائية: لو السهم نازل > 10% → sell > buy
    # شرط: لا يُطبق لو اليوم صاعد بحجم تداول (ارتداد/انفجار شراء حقيقي)
    # FIX (2026-10-29): قبل كده كان cap عند 50% بس → السهم النازل بـ buy=50/sell=50
    # ده غلط — السهم النازل > 10% لازم sell > 55%.
    if roc_20d < -10.0 and not (is_today_strong_up and vol_ratio >= 1.0):
        if roc_20d < -15.0:
            buy_pct = min(buy_pct, 32.0)  # AUDIT-FIX: نازل بشدة → sell=68%
        else:
            buy_pct = min(buy_pct, 42.0)  # AUDIT-FIX: نازل → sell=58%

    # لو ميت سريري → cap عند 40%
    if is_dead:
        buy_pct = min(buy_pct, 38.0)  # AUDIT-FIX: كان 40

    # FIX (2026-10-29): السهم الـ flat (range 10d < 2%) → متوازن (50/50)
    # قبل كده CLV بـ يعطي قيم عشوائية للسهم الـ flat → sell > 50% غلط.
    if len(closes) >= 10:
        min_10 = min(closes[-10:])
        max_10 = max(closes[-10:])
        if min_10 > 0:
            range_10d_pct = (max_10 - min_10) / min_10 * 100
            if range_10d_pct < 2.0 and not is_today_strong_up:
                # سهم flat → متوازن
                buy_pct = 50.0

    sell_pct = 100 - buy_pct

    # ── حساب القيم المالية ──
    buy_vol = last_vol * (buy_pct / 100)
    sell_vol = last_vol * (sell_pct / 100)
    buy_value = buy_vol * last_close
    sell_value = sell_vol * last_close
    net_flow = buy_value - sell_value
    buy_value_m = buy_value / 1_000_000
    sell_value_m = sell_value / 1_000_000

    # ── Volume surge ──
    if len(volumes) >= 20 and vol_std > 0:
        dynamic_vol_level = avg_vol_20 + vol_std * 1.5
        volume_surge = last_vol > dynamic_vol_level
    else:
        volume_surge = vol_ratio >= 1.3
    volume_extreme = vol_ratio >= 2.0

    # ── Liquidity state ──
    if volume_extreme and buy_pct >= 55:
        liquidity_state = 'دخول سيولة قوي'
    elif volume_extreme and sell_pct >= 55:
        liquidity_state = 'خروج سيولة قوي'
    elif volume_surge and buy_pct >= 55:
        liquidity_state = 'دخول سيولة'
    elif volume_surge and sell_pct >= 55:
        liquidity_state = 'خروج سيولة'
    elif vol_ratio > 1.0:
        liquidity_state = 'مرتفعة'
    else:
        liquidity_state = 'عادية'

    # ── Money Flow state ──
    strong_buy = buy_pct >= 60 and vol_ratio >= 1.2 and net_flow > 0
    strong_sell = sell_pct >= 60 and vol_ratio >= 1.2 and net_flow < 0
    mild_buy = buy_pct >= 55 and net_flow > 0
    mild_sell = sell_pct >= 55 and net_flow < 0

    if strong_buy:
        money_flow_state = '🔥 دخول قوي'
    elif strong_sell:
        money_flow_state = '🔥 خروج قوي'
    elif mild_buy:
        money_flow_state = '🟢 سيولة داخلة'
    elif mild_sell:
        money_flow_state = '🔴 سيولة خارجة'
    else:
        money_flow_state = '⚪ متوازنة'

    return {
        'buy_pct': round(buy_pct, 1),
        'sell_pct': round(sell_pct, 1),
        'net_flow_egp': round(net_flow, 0),
        'buy_value_m': round(buy_value_m, 2),
        'sell_value_m': round(sell_value_m, 2),
        'liquidity_state': liquidity_state,
        'money_flow_state': money_flow_state,
        'vol_ratio': round(vol_ratio, 2),
    }


# ============================================================================
# PHASE-4B: LIFE CYCLE — دورة حياة السهم (من V76 Pine Script)
# ============================================================================

def detect_life_cycle(
    closes: List[float],
    volumes: List[float],
    highs: List[float] = None,
    lows: List[float] = None,
) -> str:
    """PHASE-4B: تحديد مرحلة دورة حياة السهم.

    المراحل (من V76 الصياد الذهبي):
      1. نعاس (تجميع صامت): ATR منخفض + حجم ميت
      2. قفزة أولى (انفجار): شمعة خضراء كبيرة + حجم حقيقي
      3. جني أرباح صحي: نزول هادي بحجم ضعيف
      4. توزيع قاتل: نزول قوي بحجم مرعب
      5. تدوير وهمي: حجم ضخم بدون حركة سعرية
      6. عادي: حركة طبيعية
    """
    if not closes or len(closes) < 20 or not volumes or len(volumes) < 20:
        return 'عادي'

    last_close = closes[-1]
    # proxy open (الشمعة السابقة)
    last_open = closes[-2] if len(closes) >= 2 else last_close
    last_high = highs[-1] if highs and len(highs) > 0 else max(last_close, last_open)
    last_low = lows[-1] if lows and len(lows) > 0 else min(last_close, last_open)
    last_vol = volumes[-1]

    # ATR proxy: متوسط المدى اليومي في آخر 14 يوم
    # P1-11 FIX (RADAR-AUDIT-PY B4): atr_sma كان = atr (proxy تالف) → الشرط
    # "atr < atr_sma * 0.6" كان دائمًا False → مرحلة "🟡 نعاس" unreachable.
    # الإصلاح: atr_sma = متوسط مدى الـ 14 يوم السابقة (مستقل عن atr الحالي).
    if len(closes) >= 28:  # نحتاج 14 للـ atr الحالي + 14 للـ atr_sma
        today_ranges = []
        sma_ranges = []
        for i in range(-14, 0):
            if i > -len(closes):
                h = highs[i] if highs and len(highs) > abs(i) else max(closes[i], closes[i-1])
                l = lows[i] if lows and len(lows) > abs(i) else min(closes[i], closes[i-1])
                today_ranges.append(h - l)
        for i in range(-28, -14):
            if i > -len(closes):
                h = highs[i] if highs and len(highs) > abs(i) else max(closes[i], closes[i-1])
                l = lows[i] if lows and len(lows) > abs(i) else min(closes[i], closes[i-1])
                sma_ranges.append(h - l)
        atr = sum(today_ranges) / len(today_ranges) if today_ranges else 0
        atr_sma = sum(sma_ranges) / len(sma_ranges) if sma_ranges else atr
    elif len(closes) >= 14:
        # بيانات كافية للـ atr فقط (fallback: atr_sma = atr — للتوافق الخلفي)
        ranges = []
        for i in range(-14, 0):
            if i > -len(closes):
                h = highs[i] if highs and len(highs) > abs(i) else max(closes[i], closes[i-1])
                l = lows[i] if lows and len(lows) > abs(i) else min(closes[i], closes[i-1])
                ranges.append(h - l)
        atr = sum(ranges) / len(ranges) if ranges else 0
        atr_sma = atr  # fallback (بيانات غير كافية لـ SMA منفصل)
    else:
        atr = max(last_high - last_low, 0.01)
        atr_sma = atr

    # متوسط الحجم
    median_vol = sorted(volumes[-20:])[10] if len(volumes) >= 20 else (sum(volumes) / len(volumes) if volumes else 1)

    candle_range = last_high - last_low
    body_size = abs(last_close - last_open)

    # 1. الموت السريري (نعاس): ATR منخفض + حجم ميت
    if atr < (atr_sma * 0.60) and last_vol < (median_vol * 0.5):
        return '🟡 نعاس'

    # 2. القفزة الأولى (انفجار): شمعة خضراء كبيرة + حجم حقيقي
    is_green = last_close > last_open
    if is_green and body_size > (candle_range * 0.7) and last_vol > (median_vol * 2.0) and last_vol > 0:
        return '🚀 انفجار'

    # 3. جني أرباح صحي: نزول هادي بحجم ضعيف
    is_red = last_close < last_open
    if is_red and candle_range < (atr * 0.5) and last_vol < (median_vol * 0.8):
        return '🟢 جني أرباح'

    # 4. التوزيع القاتل: نزول قوي بحجم مرعب
    if is_red and candle_range > (atr * 1.5) and last_vol > (median_vol * 2.0):
        return '🚨 توزيع قاتل'

    # 5. التدوير الوهمي: حجم ضخم بدون حركة سعرية
    if last_vol > (median_vol * 2.0) and candle_range < (atr * 0.5):
        return '⚠️ تدوير وهمي'

    # 6. Limit Up Trap: لو السهم طلع أكتر من 9.5% في يوم ولكن بدون حجم تداول كافي (فخ سيولة)
    if last_open > 0:
        daily_change = ((last_close - last_open) / last_open) * 100
        if daily_change > 9.5 and last_vol < (median_vol * 1.0):
            return '🚫 حبس (Limit Up)'

    return 'عادي'


# ============================================================================
# PHASE-4C: LIMIT UP TRAP + KILL SWITCH (من V76)
# ============================================================================

def check_limit_up_trap(
    closes: List[float],
    volumes: List[float] = None,
) -> bool:
    """كشف لو السهم محبوس في الحد الأقصى (+9.5% في يوم) بدون تداول وسيولة وهمية."""
    if not closes or len(closes) < 2:
        return False
    last_close = closes[-1]
    prev_close = closes[-2]
    if prev_close <= 0:
        return False
    daily_change = ((last_close - prev_close) / prev_close) * 100
    if daily_change <= 9.5:
        return False
    # لو السهم منفذ تداول عالي وسيولة حقيقية نشطة → ده انفجار شراء وزخم حقيقي مش مصيدة حبس
    if volumes and len(volumes) >= 2:
        last_vol = volumes[-1]
        avg_vol_10d = sum(volumes[-10:]) / len(volumes[-10:]) if len(volumes) >= 10 else (sum(volumes) / len(volumes))
        vol_ratio = last_vol / avg_vol_10d if avg_vol_10d > 0 else 1.0
        # AUDIT-FIX: لازم الحجم يكون ضعيف جدًا + السعر قريب من الحد الأقصى
        # قبل كده: volume ≥ 1× avg → مش فخ (سهل أوي)
        # دلوقتي: volume ≥ 0.6× avg AND change < 9.7% → مش فخ
        if vol_ratio >= 0.6 and daily_change < 9.7:
            return False  # سيولة حقيقية نشطة
    return True


def check_kill_switch(
    closes: List[float],
    volumes: List[float],
    highs: List[float] = None,
    lows: List[float] = None,
) -> Tuple[bool, str]:
    """KILL SWITCH: لو فيه توزيع قاتل → إغلاق فوري.

    Returns:
        (kill_triggered, reason)
    """
    life_cycle = detect_life_cycle(closes, volumes, highs, lows)
    if life_cycle == '🚨 توزيع قاتل':
        return True, 'توزيع قاتل — إغلاق فوري'
    if life_cycle == '🚫 حبس (Limit Up)':
        return True, 'حبس — متدخلش'
    if life_cycle == '⚠️ تدوير وهمي':
        return True, 'تدوير وهمي — احذر'
    return False, ''


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
    # PHASE-2: Quiet Accumulation
    'QUIET_ACCUMULATION_POSITION_SIZE',
    'QUIET_ACCUMULATION_MIN_SIGNALS',
    'detect_quiet_accumulation',
    # PHASE-3: Pre-Surge
    'PRE_SURGE_POSITION_SIZE',
    'PRE_SURGE_MIN_SIGNALS',
    'detect_pre_surge',
    # PHASE-4: Money Flow + Life Cycle + Kill Switch
    'compute_money_flow',
    'detect_life_cycle',
    'check_limit_up_trap',
    'check_kill_switch',
    # Helpers
    'classify_price_bucket',
    'dynamic_min_turnover',
    'has_volume_surge',
    'is_explosive_surge',
    'should_reject_by_liquidity',
    'position_size_for_liquidity_bypass',
]
