"""
stock_state.py — تحديد حالة السهم + كشف نهاية التصحيح
=====================================================
PHASE-REDESIGN (2026-08-29): Foundation helper للـ screener + stop-loss

3 دوال:
1. compute_stock_state(stock) → {state, state_ar, state_reason, momentum_score}
2. is_near_correction_end(stock) → bool (لتأجيل stop-loss)
3. is_in_active_correction(stock) → bool (لـ entry gate)

الـ stock dict لازم فيه:
  current_price, change_percent, ma_50, ma_200, rsi, high_52w, low_52w,
  avg_volume, volume, trend, signal

مبادئ:
- Rule 20: Python = brain (كل logic هنا)
- Rule 31: لا كلمات حماسية — أسماء فنية محايدة
- safe-by-design: لو data ناقص، بـ return state محايد
"""
from __future__ import annotations
from typing import Dict, Any, Optional


def _safe_float(val: Any, default: Optional[float] = None) -> Optional[float]:
    """تحويل آمن لـ float."""
    if val is None:
        return default
    try:
        f = float(val)
        return f if f == f else default  # NaN check
    except (TypeError, ValueError):
        return default


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


def get_state_color(state: str) -> str:
    """لون badge للحالة."""
    return STATE_COLORS.get(state, 'gray')


def get_state_order(state: str) -> int:
    """ترتيب الحالة (لـ sort)."""
    return STATE_ORDER.get(state, 99)
