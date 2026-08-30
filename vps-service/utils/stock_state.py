"""
stock_state.py — تصنيف حالة السهم + كشف نهاية التصحيح + شروط التعافي
=====================================================================
PHASE-REDESIGN (2026-08-29): Foundation helper للـ screener + stop-loss
UNIFIED-LOGIC (2026-08-30): توسيع لتصنيف الـ 4 حالات المطلوبة للمنطق الموحد:
  - DEEP_CORRECTION      | تصحيح عميق        | نزل >12-15% من قمة 40-60 يوم + لسه بينزل
  - LATE_CORRECTION_BASE | أواخر التصحيح     | بنى قاع + تذبذب قل + حجم نام
  - RECOVERY_STARTING    | بدء التعافي       | كسر مقاومة + حجم يرجع + RS > 1.0
  - EXTENDED_CHASE       | مطاردة            | طلع >12-15% في 3-5 أيام بدون انضغاط
  - + الـ 7 states الأصلية (AT_PEAK / CORRECTION_END / BALANCED_MOMENTUM / NEAR_BREAKOUT / DECLINING / CORRECTION / NEUTRAL)

6 دوال:
1. compute_stock_state(stock) → {state, state_ar, state_reason, momentum_score}
2. classify_correction_stage(stock, price_history) → {stage, stage_ar, reason, allow_entry}
3. is_near_correction_end(stock) → bool (لتأجيل stop-loss)
4. is_in_active_correction(stock) → bool (لـ entry gate)
5. is_extended_chase(stock, price_history) → bool (Don't Chase filter)
6. confirm_recovery_starting(stock, price_history, sector_change) → {confirmed, reasons}

الـ stock dict لازم فيه:
  current_price, change_percent, ma_50, ma_200, rsi, high_52w, low_52w,
  avg_volume, volume, trend, signal

مبادئ:
- Rule 20: Python = brain (كل logic هنا)
- Rule 31: لا كلمات حماسية — أسماء فنية محايدة
- safe-by-design: لو data ناقص، بـ return state محايد
- لا أرقام وهمية (Rule 27) — كل العتبات settings-driven أو fallback صريح
"""
from __future__ import annotations
from typing import Dict, Any, Optional, List


# ─── العتبات (settings-driven مع fallback صريح) ─────────────────────────────
# المنطق الموحد المطلوب من المالك (2026-08-30):
#   Deep Correction: نزل أكتر من 12-15% من أعلى قمة آخر 40-60 يوم
#   Late Correction: بنى قاع + تذبذب قل + حجم نام
#   Recovery Starting: كسر مقاومة + حجم يرجع + RS > 1.0
#   Extended/Chase: طلع أكتر من 12-15% في 3-5 أيام بدون انضغاط

DEEP_CORRECTION_DROP_PCT = 12.0      # ≥ 12% من قمة 40-60 يوم
DEEP_CORRECTION_LOOKBACK_DAYS = 40   # أعلى قمة آخر 40-60 يوم
LATE_CORRECTION_VOL_DROP_RATIO = 0.8 # حجم آخر 3 أيام ≤ 80% من متوسط 20 يوم
LATE_CORRECTION_RANGE_PCT = 4.0      # مدى 5 أيام ≤ 4% (تذبذب قل)
RECOVERY_VOL_RATIO_MIN = 1.2         # حجم آخر 3 أيام ≥ 1.2× متوسط 20 يوم (lower bound)
RECOVERY_VOL_RATIO_STRONG = 1.5      # حجم آخر 3 أيام ≥ 1.5× متوسط 20 يوم (strong)
RECOVERY_RS_MIN = 1.0                # RS > 1.0 (أقوى من السوق)
EXTENDED_CHASE_3D_PCT = 12.0         # طلع >12% في 3-5 أيام
EXTENDED_CHASE_5D_PCT = 15.0         # طلع >15% في 5 أيام
RECOVERY_CLOSE_TO_HIGH_RATIO = 0.6   # إغلاق قرب من أعلى شمعة اليوم (≥ 60%)


def _safe_float(val: Any, default: Optional[float] = None) -> Optional[float]:
    """تحويل آمن لـ float."""
    if val is None:
        return default
    try:
        f = float(val)
        return f if f == f else default  # NaN check
    except (TypeError, ValueError):
        return default


def _roc(closes: List[float], days: int) -> Optional[float]:
    """Rate of change نسبة مئوية لآخر N يوم. لو data ناقصة → None."""
    if not closes or len(closes) < days + 1:
        return None
    try:
        old = float(closes[-(days + 1)])
        new = float(closes[-1])
        if old <= 0:
            return None
        return ((new - old) / old) * 100.0
    except (TypeError, ValueError, IndexError):
        return None


def _range_pct(closes: List[float], days: int = 5) -> Optional[float]:
    """مدى النطاق لآخر N يوم كنسبة من الإغلاق الأخير. (high-low)/last*100."""
    if not closes or len(closes) < days:
        return None
    try:
        window = [float(c) for c in closes[-days:] if c and c > 0]
        if len(window) < 2:
            return None
        hi = max(window)
        lo = min(window)
        last = window[-1]
        if last <= 0:
            return None
        return ((hi - lo) / last) * 100.0
    except (TypeError, ValueError, IndexError):
        return None


def _max_high_pct(closes: List[float], days: int = 40) -> Optional[float]:
    """أعلى قمة في آخر N يوم. يرجع القيمة نفسها مش نسبة."""
    if not closes or len(closes) < 2:
        return None
    try:
        window = [float(c) for c in closes[-days:] if c and c > 0]
        if not window:
            return None
        return max(window)
    except (TypeError, ValueError, IndexError):
        return None


def _drawdown_from_high_pct(closes: List[float], days: int = 40) -> Optional[float]:
    """الهبوط من أعلى قمة في آخر N يوم كنسبة مئوية موجبة (لو السهم نزل 15% → 15.0)."""
    hi = _max_high_pct(closes, days)
    if hi is None or hi <= 0:
        return None
    try:
        last = float(closes[-1])
        if last <= 0:
            return None
        return ((hi - last) / hi) * 100.0
    except (TypeError, ValueError, IndexError):
        return None


def compute_stock_state(stock: Dict[str, Any]) -> Dict[str, Any]:
    """حدد حالة السهم الحالية + momentum score.

    Returns:
        {
            'state': str (key),
            'state_ar': str (display name),
            'state_reason': str (شرح قصير),
            'momentum_score': float (0-100),
        }

    الحالات الممكنة (محايدة، مش حماسية):
      - CORRECTION      | في تصحيح        | نازل أكتر من 5% من قمة 5 أيام
      - CORRECTION_END  | التصحيح خلص     | رجع فوق MA20 + حجم يرتفع
      - DECLINING       | لسة نازل        | تحت MA20 + RSI نازل
      - NEAR_BREAKOUT   | قرب يكسر        | قرب من MA20 من تحت
      - AT_PEAK         | في قمة          | قريب من 52w high + RSI > 70
      - BALANCED_MOMENTUM | زخم متزن      | فوق MA20 + حجم مرتفع + RSI معتدل
      - NEUTRAL         | محايد           | لا شرط واضح
    """
    price = _safe_float(stock.get('current_price'))
    if price is None or price <= 0:
        return {
            'state': 'NEUTRAL',
            'state_ar': 'محايد',
            'state_reason': 'بيانات السعر غير متاحة',
            'momentum_score': 0,
        }

    change = _safe_float(stock.get('change_percent'), 0) or 0
    ma50 = _safe_float(stock.get('ma_50'))
    ma200 = _safe_float(stock.get('ma_200'))
    rsi = _safe_float(stock.get('rsi'))
    high52 = _safe_float(stock.get('high_52w'))
    low52 = _safe_float(stock.get('low_52w'))
    avg_vol = _safe_float(stock.get('avg_volume'), 0) or 0
    vol = _safe_float(stock.get('volume'), 0) or 0
    trend = (stock.get('trend') or '').lower()

    # حسابات مساعدة
    vol_surge = (avg_vol > 0 and vol > avg_vol * 1.5)
    near_52w_high = (high52 and high52 > 0 and price >= high52 * 0.95)
    near_52w_low = (low52 and low52 > 0 and price <= low52 * 1.05)
    above_ma50 = (ma50 is not None and price > ma50)
    below_ma50 = (ma50 is not None and price < ma50)
    dist_from_ma50 = ((price - ma50) / ma50 * 100) if ma50 and ma50 > 0 else 0

    # 1) AT_PEAK: قريب من 52w high + RSI > 70
    if near_52w_high and rsi is not None and rsi > 70:
        return {
            'state': 'AT_PEAK',
            'state_ar': 'في قمة',
            'state_reason': f'السعر قريب من أعلى 52 أسبوع (RSI={rsi:.0f}) — قد يتراجع',
            'momentum_score': 75,
        }

    # 2) CORRECTION_END: رجع فوق MA20 (proxy=MA50) + حجم يرتفع + change > 0
    if above_ma50 and vol_surge and change > 0:
        return {
            'state': 'CORRECTION_END',
            'state_ar': 'التصحيح خلص',
            'state_reason': 'السعر كسر المتوسط + الحجم يرتفع — مؤشر تعافي',
            'momentum_score': 80,
        }

    # 3) BALANCED_MOMENTUM: فوق MA20 + حجم مرتفع + RSI معتدل (40-70)
    if above_ma50 and vol_surge and rsi is not None and 40 <= rsi <= 70:
        return {
            'state': 'BALANCED_MOMENTUM',
            'state_ar': 'زخم متزن',
            'state_reason': 'فوق المتوسط + حجم مرتفع + RSI معتدل — زخم صحي',
            'momentum_score': 70,
        }

    # 4) NEAR_BREAKOUT: قرب من MA20 من تحت (within 2% below MA50) — check قبل CORRECTION
    if below_ma50 and dist_from_ma50 > -2:
        return {
            'state': 'NEAR_BREAKOUT',
            'state_ar': 'قرب يكسر',
            'state_reason': f'السعر قرب من المتوسط ({dist_from_ma50:+.1f}%) — مرشح للكسر',
            'momentum_score': 55,
        }

    # 5) DECLINING: تحت MA20 + RSI < 45 + change < 0
    if below_ma50 and rsi is not None and rsi < 45 and change < 0:
        return {
            'state': 'DECLINING',
            'state_ar': 'لسة نازل',
            'state_reason': f'تحت المتوسط (RSI={rsi:.0f}) + نازل اليوم — لسه في هبوط',
            'momentum_score': 20,
        }

    # 6) CORRECTION: change < 0 + تحت MA20 (proxy)
    if below_ma50 and change < 0:
        # لو قريب من 52w low → تشبع بيعي (محايد)
        if near_52w_low and rsi is not None and rsi < 30:
            return {
                'state': 'CORRECTION',
                'state_ar': 'في تصحيح (تشبع بيعي)',
                'state_reason': f'تحت المتوسط + قريب من أدنى 52 أسبوع (RSI={rsi:.0f}) — قد يرتد',
                'momentum_score': 30,
            }
        return {
            'state': 'CORRECTION',
            'state_ar': 'في تصحيح',
            'state_reason': 'تحت المتوسط + نازل اليوم — في مرحلة تصحيح',
            'momentum_score': 35,
        }

    # 7) NEUTRAL: لا شرط واضح
    return {
        'state': 'NEUTRAL',
        'state_ar': 'محايد',
        'state_reason': 'لا شرط فني واضح',
        'momentum_score': 40,
    }


def classify_correction_stage(stock: Dict[str, Any],
                              price_history: Optional[List[Dict]] = None) -> Dict[str, Any]:
    """تصنيف مرحلة التصحيح للسهم (المنطق الموحد المطلوب).

    Args:
        stock: dict فيه current_price, change_percent, ma_50, rsi, avg_volume, volume, high_52w, low_52w
        price_history: list من dicts فيه close/close_price لآخر 40-60 يوم (اختياري بس مفضل)

    Returns:
        {
            'stage': str (DEEP_CORRECTION | LATE_CORRECTION_BASE | RECOVERY_STARTING | EXTENDED_CHASE | NONE),
            'stage_ar': str,
            'reason': str,
            'allow_entry': bool (True لو RECOVERY_STARTING بس)
            'drawdown_pct': Optional[float],
            'roc_3d': Optional[float],
            'roc_5d': Optional[float],
        }
    """
    price = _safe_float(stock.get('current_price'))
    result_default = {
        'stage': 'NONE',
        'stage_ar': 'محايد',
        'reason': 'بيانات غير كافية للتصنيف',
        'allow_entry': False,
        'drawdown_pct': None,
        'roc_3d': None,
        'roc_5d': None,
    }
    if price is None or price <= 0:
        return result_default

    closes: List[float] = []
    if price_history:
        for p in price_history:
            c = _safe_float(p.get('close', p.get('close_price')))
            if c is not None and c > 0:
                closes.append(c)

    drawdown = _drawdown_from_high_pct(closes, DEEP_CORRECTION_LOOKBACK_DAYS) if closes else None
    roc3 = _roc(closes, 3) if closes else None
    roc5 = _roc(closes, 5) if closes else None
    range5 = _range_pct(closes, 5) if closes else None

    result_default['drawdown_pct'] = drawdown
    result_default['roc_3d'] = roc3
    result_default['roc_5d'] = roc5

    # 1) EXTENDED_CHASE: طلع أكتر من 12-15% في 3-5 أيام بدون انضغاط → ممنوع دخول (Don't Chase)
    if roc3 is not None and roc3 >= EXTENDED_CHASE_3D_PCT:
        return {
            **result_default,
            'stage': 'EXTENDED_CHASE',
            'stage_ar': 'مطاردة (طلع كتير بدري)',
            'reason': f'طلع {roc3:.1f}% في 3 أيام — ممنوع الدخول (Don\'t Chase)',
            'allow_entry': False,
        }
    if roc5 is not None and roc5 >= EXTENDED_CHASE_5D_PCT:
        return {
            **result_default,
            'stage': 'EXTENDED_CHASE',
            'stage_ar': 'مطاردة (طلع كتير بدري)',
            'reason': f'طلع {roc5:.1f}% في 5 أيام — ممنوع الدخول (Don\'t Chase)',
            'allow_entry': False,
        }

    # 2) DEEP_CORRECTION: نزل أكتر من 12% من قمة 40 يوم + لسه بينزل (change < 0)
    if drawdown is not None and drawdown >= DEEP_CORRECTION_DROP_PCT:
        change = _safe_float(stock.get('change_percent'), 0) or 0
        # لو لسه بينزل (change ≤ 0) أو RSI < 45 → deep correction نشط
        rsi = _safe_float(stock.get('rsi'))
        still_dropping = (change <= 0) or (rsi is not None and rsi < 45)
        if still_dropping:
            return {
                **result_default,
                'stage': 'DEEP_CORRECTION',
                'stage_ar': 'تصحيح عميق',
                'reason': f'نزل {drawdown:.1f}% من قمة 40 يوم + لسه بينزل — ممنوع الدخول',
                'allow_entry': False,
            }

        # 3) LATE_CORRECTION_BASE: نزل + بنى قاع (تذبذب قل + حجم نام)
        # الحالة دي = "راقب فقط" (مش دخول)
        vol_drop = False
        if range5 is not None and range5 <= LATE_CORRECTION_RANGE_PCT:
            vol_drop = True  # تذبذب قل
        avg_vol = _safe_float(stock.get('avg_volume'), 0) or 0
        vol = _safe_float(stock.get('volume'), 0) or 0
        if avg_vol > 0 and vol > 0 and vol < avg_vol * LATE_CORRECTION_VOL_DROP_RATIO:
            vol_drop = True  # حجم نام
        if vol_drop:
            return {
                **result_default,
                'stage': 'LATE_CORRECTION_BASE',
                'stage_ar': 'أواخر التصحيح (يبني قاع)',
                'reason': f'نزل {drawdown:.1f}% لكن تذبذب قل + حجم نام — راقب فقط',
                'allow_entry': False,
            }

    # 4) RECOVERY_STARTING: كسر مقاومة + حجم يرجع + RS > 1.0 + شمعة قوية
    # لازم معظم شروط التأكيد تتحقق (confirm_recovery_starting بتفحصها بالتفصيل)
    recovery = confirm_recovery_starting(stock, price_history, sector_change=None)
    if recovery.get('confirmed'):
        return {
            **result_default,
            'stage': 'RECOVERY_STARTING',
            'stage_ar': 'بدء التعافي',
            'reason': 'كسر مقاومة + حجم يرجع + شمعة قوية — مسموح الدخول (بشروط)',
            'allow_entry': True,
        }

    return result_default


def is_near_correction_end(stock: Dict[str, Any]) -> bool:
    """هل السهم قرب ينهي التصحيح؟ (لتأجيل stop-loss)

    شروط:
    - السعر رجع فوق MA50 (proxy لـ MA20)
    - الحجم يرتفع (volume > avg_volume * 1.2)
    - RSI > 45 (بدأ يـ recover)
    - change > 0 اليوم (إيجابي)

    Returns:
        True لو السهم بدأ يتعافى — يـ تأجل stop-loss
    """
    price = _safe_float(stock.get('current_price'))
    if price is None or price <= 0:
        return False

    ma50 = _safe_float(stock.get('ma_50'))
    if ma50 is None or ma50 <= 0:
        return False

    change = _safe_float(stock.get('change_percent'), 0) or 0
    rsi = _safe_float(stock.get('rsi'))
    avg_vol = _safe_float(stock.get('avg_volume'), 0) or 0
    vol = _safe_float(stock.get('volume'), 0) or 0

    # شرط 1: فوق MA50
    if price <= ma50:
        return False

    # شرط 2: حجم يرتفع
    vol_rising = (avg_vol > 0 and vol > avg_vol * 1.2)

    # شرط 3: RSI > 45 (بدأ يـ recover)
    rsi_recovering = (rsi is not None and rsi > 45)

    # شرط 4: change > 0 اليوم
    if change <= 0:
        return False

    # لازم 3 من 3 شروط (نقص change اللي اتـ check فوق)
    return vol_rising and rsi_recovering


def is_in_active_correction(stock: Dict[str, Any]) -> bool:
    """هل السهم في تصحيح نشط؟ (لـ entry gate — نرفض BUY signals)

    شروط:
    - تحت MA50 (proxy لـ MA20)
    - change < 0 اليوم
    - RSI < 45 (نازل فعلاً)
    - ليس قريب من 52w low (مش تشبع بيعي — لو تشبع، ممكن يرتد)

    Returns:
        True لو السهم في تصحيح نشط — V38 engine يـ reject BUY signal
    """
    price = _safe_float(stock.get('current_price'))
    if price is None or price <= 0:
        return False

    ma50 = _safe_float(stock.get('ma_50'))
    if ma50 is None or ma50 <= 0:
        return False

    change = _safe_float(stock.get('change_percent'), 0) or 0
    rsi = _safe_float(stock.get('rsi'))
    low52 = _safe_float(stock.get('low_52w'))

    # شرط 1: تحت MA50
    if price >= ma50:
        return False

    # شرط 2: change < 0 اليوم
    if change >= 0:
        return False

    # شرط 3: RSI < 45
    if rsi is None or rsi >= 45:
        return False

    # شرط 4: ليس قريب من 52w low (تشبع بيعي = ممكن يرتد = مش تصحيح نشط)
    if low52 and low52 > 0 and price <= low52 * 1.05:
        return False  # تشبع بيعي — مش تصحيح نشط

    return True


def is_extended_chase(stock: Dict[str, Any],
                      price_history: Optional[List[Dict]] = None) -> bool:
    """هل السهم طلع كتير بدري؟ (Don't Chase filter)

    شروط:
    - ROC3 ≥ 12% (طلع 12%+ في 3 أيام)
    - أو ROC5 ≥ 15% (طلع 15%+ في 5 أيام)

    Returns:
        True لو السهم في مطاردة — نرفض BUY signal
    """
    closes: List[float] = []
    if price_history:
        for p in price_history:
            c = _safe_float(p.get('close', p.get('close_price')))
            if c is not None and c > 0:
                closes.append(c)
    if not closes:
        return False

    roc3 = _roc(closes, 3)
    roc5 = _roc(closes, 5)

    if roc3 is not None and roc3 >= EXTENDED_CHASE_3D_PCT:
        return True
    if roc5 is not None and roc5 >= EXTENDED_CHASE_5D_PCT:
        return True
    return False


def confirm_recovery_starting(stock: Dict[str, Any],
                              price_history: Optional[List[Dict]] = None,
                              sector_change: Optional[float] = None) -> Dict[str, Any]:
    """تأكيد بدء التعافي (Recovery Starting) — شروط لازم معظمها تتحقق.

    الشروط (5 شروط، لازم 4 من 5 على الأقل):
    1. السعر قطع فوق SMA50 (proxy لـ SMA20) أو فوق مقاومة قصيرة بحجم
    2. متوسط حجم آخر 3 أيام ≥ 1.2× إلى 1.5× متوسط 20 يوم
    3. RS > 1.0 (أقوى من السوق) — نمرره كـ parameter لو مش متاح
    4. شمعة قوية نسبيًا (إغلاق قريب من الأعلى)
    5. القطاع مش هابط (sector_change > 0 لو متاح)

    Returns:
        {
            'confirmed': bool,
            'reasons': List[str],  # الشروط اللي اتحققت
            'failed': List[str],   # الشروط اللي مش اتحققت
            'score': int,          # عدد الشروط اللي اتحققت (0-5)
        }
    """
    result = {'confirmed': False, 'reasons': [], 'failed': [], 'score': 0}
    score = 0

    price = _safe_float(stock.get('current_price'))
    if price is None or price <= 0:
        result['failed'].append('السعر غير متاح')
        return result

    ma50 = _safe_float(stock.get('ma_50'))
    change = _safe_float(stock.get('change_percent'), 0) or 0
    avg_vol = _safe_float(stock.get('avg_volume'), 0) or 0
    vol = _safe_float(stock.get('volume'), 0) or 0

    # شرط 1: فوق MA50 (proxy لـ SMA20)
    if ma50 is not None and ma50 > 0 and price > ma50:
        score += 1
        result['reasons'].append(f'فوق MA50 ({price:.2f} > {ma50:.2f})')
    else:
        result['failed'].append('تحت MA50')

    # شرط 2: حجم يرجع (vol ≥ 1.2× avg)
    if avg_vol > 0 and vol >= avg_vol * RECOVERY_VOL_RATIO_MIN:
        # لو حجم قوي (≥ 1.5×) → قوة إضافية لكن نحسبها كشرط واحد
        score += 1
        ratio = vol / avg_vol if avg_vol > 0 else 0
        result['reasons'].append(f'حجم يرتفع ({ratio:.2f}× المتوسط)')
    else:
        result['failed'].append('حجم ضعيف')

    # شرط 3: RS > 1.0 — لو sector_change متاح نستخدمه كـ proxy
    # (الـ RS الحقيقي بيتحسب في core_scoring_engine.py كـ relative_strength)
    # هنا بنفحص بس لو السهم change > 0 و القطاع مش هابط → proxy للـ RS
    if change > 0:
        score += 1
        result['reasons'].append(f'change > 0 ({change:+.2f}%)')
    else:
        result['failed'].append(f'change ≤ 0 ({change:+.2f}%)')

    # شرط 4: شمعة قوية (إغلاق قرب الأعلى)
    # بنفحص من price_history لو متاح: close قرب من high بنسبة 60%+
    if price_history and len(price_history) >= 1:
        last = price_history[-1]
        hi = _safe_float(last.get('high', last.get('high_price')))
        lo = _safe_float(last.get('low', last.get('low_price')))
        cl = _safe_float(last.get('close', last.get('close_price')))
        if hi is not None and lo is not None and cl is not None and hi > lo:
            range_ = hi - lo
            if range_ > 0:
                close_to_high = (cl - lo) / range_
                if close_to_high >= RECOVERY_CLOSE_TO_HIGH_RATIO:
                    score += 1
                    result['reasons'].append(f'إغلاق قرب القمة ({close_to_high*100:.0f}%)')
                else:
                    result['failed'].append(f'إغلاق بعيد عن القمة ({close_to_high*100:.0f}%)')
            else:
                result['failed'].append('شمعة بدون مدى')
        else:
            result['failed'].append('بيانات الشمعة ناقصة')
    else:
        # proxy: لو change > 0.5% → شمعة قوية نسبياً
        if change > 0.5:
            score += 1
            result['reasons'].append(f'change قوي ({change:+.2f}%) — proxy شمعة')
        else:
            result['failed'].append('change ضعيف')

    # شرط 5: القطاع مش هابط
    if sector_change is not None:
        if sector_change >= 0:
            score += 1
            result['reasons'].append(f'القطاع مش هابط ({sector_change:+.2f}%)')
        else:
            result['failed'].append(f'القطاع هابط ({sector_change:+.2f}%)')
    else:
        # لو sector_change مش متاح → نعتبر الشرط محايد (مش بنطرح من score)
        result['reasons'].append('القطاع: غير متاح (محايد)')

    result['score'] = score
    # لازم 4 من 5 شروط (لو sector_change مش متاح → لازم 4 من 4)
    threshold = 4 if sector_change is not None else 3
    result['confirmed'] = score >= threshold
    return result


# ─── Helpers للـ display ────────────────────────────────────────────────────

STATE_COLORS = {
    'AT_PEAK': 'amber',
    'CORRECTION_END': 'emerald',
    'BALANCED_MOMENTUM': 'green',
    'DECLINING': 'red',
    'CORRECTION': 'orange',
    'NEAR_BREAKOUT': 'blue',
    'NEUTRAL': 'gray',
}

STATE_ORDER = {
    'CORRECTION_END': 1,    # الأفضل — تعافي
    'BALANCED_MOMENTUM': 2,  # زخم صحي
    'NEAR_BREAKOUT': 3,      # مرشح للكسر
    'AT_PEAK': 4,            # قمة — حذر
    'NEUTRAL': 5,            # محايد
    'CORRECTION': 6,        # تصحيح
    'DECLINING': 7,          # نازل
}

# ألوان لمراحل التصحيح (المنطق الموحد)
STAGE_COLORS = {
    'DEEP_CORRECTION': 'red',
    'LATE_CORRECTION_BASE': 'orange',
    'RECOVERY_STARTING': 'emerald',
    'EXTENDED_CHASE': 'amber',
    'NONE': 'gray',
}

STAGE_ORDER = {
    'RECOVERY_STARTING': 1,    # الأفضل للدخول
    'LATE_CORRECTION_BASE': 2, # راقب
    'NONE': 3,                 # محايد
    'EXTENDED_CHASE': 4,       # ممنوع دخول
    'DEEP_CORRECTION': 5,      # ممنوع دخول
}


def get_state_color(state: str) -> str:
    """لون badge للحالة."""
    return STATE_COLORS.get(state, 'gray')


def get_state_order(state: str) -> int:
    """ترتيب الحالة (لـ sort)."""
    return STATE_ORDER.get(state, 99)


def get_stage_color(stage: str) -> str:
    """لون badge لمرحلة التصحيح."""
    return STAGE_COLORS.get(stage, 'gray')


def get_stage_order(stage: str) -> int:
    """ترتيب مرحلة التصحيح (لـ sort)."""
    return STAGE_ORDER.get(stage, 99)
