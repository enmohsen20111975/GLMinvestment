"""
Position Manager v1.0.0
=======================
فن إدارة المراكز المفتوحة — العقل الإداري للمستثمر الخبير.

فلسفة المدير:
"لما تقول شراء، لازم تقول بيع. لما السعر يتحرك، لازم تدير الموقف."
- لا تترك التوقع معلقاً بلا متابعة
- كل يوم، افحص كل توقع نشط واعطِ توصية إدارة واضحة
- المستثمر الذكي يدير مخاطره، لا ينتظر فقط

توصيات الإدارة السبع:
1. HOLD (انتظر)           — السعر في النطاق الطبيعي، اصبر
2. TRAILING_STOP (رفع الوقف) — السعر صعد، ارفع الستوب لحماية الأرباح
3. TAKE_PROFIT_T1 (بيع جزء) — وصل لـ T1، بع 50% واحتفظ بالباقي
4. TAKE_PROFIT_T2 (بيع كامل) — وصل لـ T2، بع الكل
5. ADD (زود)              — السعر قرب الدخول والفرصة ما زالت قوية
6. REDUCE (خفّض)           — السعر نزل تحت support، خفّض 30%
7. EXIT (بيع فوري)        — ضرب الوقف أو انعكس الترند بقوة

لكل توصية:
- action: الإجراء
- reason_ar: السبب بالعربي
- new_stop: الستوب الجديد (لو applicable)
- target_progress: نسبة التقدم نحو الهدف (0-100%)
- holding_days: عدد أيام الاحتفاظ
- urgency: low | medium | high
- suggested_size_pct: نسبة المركز المقترحة (0-100% من الحجم الأصلي)

Usage:
    from analyzers.position_manager import manage_position
    advice = manage_position(prediction_row, current_price, indicators)
"""

from typing import Dict, Any, Optional
from datetime import datetime


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _safe_pct(numerator: float, denominator: float) -> float:
    try:
        return (numerator / denominator * 100) if denominator else 0
    except (ZeroDivisionError, TypeError):
        return 0


def _calc_target_progress(entry: float, target: float, current: float, signal: str = 'BUY') -> float:
    """
    نسبة التقدم نحو الهدف (0-100%).
    - BUY: entry → target صعود
    - SELL: entry → target هبوط
    """
    if not entry or not target or not current:
        return 0
    try:
        if signal in ('SELL', 'REDUCE'):
            # For SELL, target < entry
            total_move = entry - target
            current_move = entry - current
        else:
            total_move = target - entry
            current_move = current - entry
        if total_move <= 0:
            return 0
        return _clamp((current_move / total_move) * 100, 0, 200)  # cap at 200% (overshot)
    except Exception:
        return 0


def _calc_current_return(entry: float, current: float, signal: str = 'BUY') -> float:
    """نسبة الربح/الخسارة الحالية (للـ BUY: positive إذا current > entry)."""
    if not entry or not current:
        return 0
    try:
        if signal in ('SELL', 'REDUCE'):
            return ((entry - current) / entry) * 100
        return ((current - entry) / entry) * 100
    except Exception:
        return 0


def _holding_days(prediction_date: str) -> int:
    """عدد الأيام منذ تاريخ التوقع."""
    try:
        d = datetime.strptime(prediction_date[:10], '%Y-%m-%d')
        return max(0, (datetime.now() - d).days)
    except Exception:
        return 0


# ---------------------------------------------------------------------------
# Main: manage_position
# ---------------------------------------------------------------------------
def manage_position(
    prediction: Dict,
    current_price: float,
    indicators: Optional[Dict] = None,
    market_open: bool = True,
) -> Dict:
    """
    يحسب توصية إدارة لمركز مفتوح (توقع نشط).

    Args:
        prediction: dict with at least:
            - id, ticker, signal, signal_type, entry_price, target_price, target_price_2,
              stop_loss, prediction_date, persona, highest_price_reached, lowest_price_reached,
              trailing_stop_atr_mult, atr_at_entry
        current_price: السعر الحالي للسهم
        indicators: مؤشرات فنية حديثة (اختياري — يحسن القرار)
        market_open: هل السوق مفتوح الآن؟ (يؤثر على urgency)

    Returns:
        {
            'prediction_id': int,
            'ticker': str,
            'action': 'HOLD' | 'TRAILING_STOP' | 'TAKE_PROFIT_T1' | 'TAKE_PROFIT_T2' |
                      'ADD' | 'REDUCE' | 'EXIT',
            'action_ar': str (الإجراء بالعربي),
            'reason_ar': str (السبب),
            'new_stop': float | None,
            'new_target': float | None,
            'current_return_pct': float,
            'target_progress_pct': float,
            'holding_days': int,
            'urgency': 'low' | 'medium' | 'high',
            'suggested_size_pct': float (0-100),
            'emoji': str,
        }
    """
    indicators = indicators or {}
    pred_id = prediction.get('id')
    ticker = prediction.get('ticker', '')
    signal = prediction.get('signal', 'BUY') or 'BUY'
    signal_type = prediction.get('signal_type', signal) or signal
    entry = float(prediction.get('entry_price') or 0)
    target = float(prediction.get('target_price') or 0)
    target_2 = float(prediction.get('target_price_2') or 0)
    stop = float(prediction.get('stop_loss') or 0)
    pred_date = prediction.get('prediction_date', '')
    persona = prediction.get('persona', 'balanced')
    highest_reached = float(prediction.get('highest_price_reached') or entry)
    lowest_reached = float(prediction.get('lowest_price_reached') or entry)
    atr_mult = float(prediction.get('trailing_stop_atr_mult') or 2.5)
    atr_at_entry = float(prediction.get('atr_at_entry') or 0)

    h_days = _holding_days(pred_date)
    current_return = _calc_current_return(entry, current_price, signal)
    progress = _calc_target_progress(entry, target, current_price, signal)

    # ----- Logic: حدد الإجراء المناسب -----
    action = 'HOLD'
    action_ar = 'انتظر'
    reason_ar = 'السعر في النطاق الطبيعي، اصبر على الموقف'
    new_stop = None
    new_target = None
    urgency = 'low'
    suggested_size_pct = 100  # default: keep full position
    emoji = '⏳'

    # For BUY signals (long position)
    is_long = signal not in ('SELL', 'REDUCE')

    if not current_price or current_price <= 0:
        return {
            'prediction_id': pred_id, 'ticker': ticker,
            'action': 'HOLD', 'action_ar': 'انتظر',
            'reason_ar': 'لا يوجد سعر حالي متاح',
            'new_stop': None, 'new_target': None,
            'current_return_pct': 0, 'target_progress_pct': 0,
            'holding_days': h_days, 'urgency': 'low',
            'suggested_size_pct': 100, 'emoji': '❓',
        }

    # ---- 1. CHECK STOP LOSS HIT ----
    if is_long and stop > 0 and current_price <= stop:
        action = 'EXIT'
        action_ar = 'بيع فوري'
        reason_ar = f'السعر ضرب الوقف ({stop:.2f}). اخرج فوراً لحماية رأس المال.'
        urgency = 'high'
        suggested_size_pct = 0
        emoji = '🛑'
    elif (not is_long) and stop > 0 and current_price >= stop:
        action = 'EXIT'
        action_ar = 'تغطية فورية'
        reason_ar = f'السعر تجاوز الوقف ({stop:.2f}). اخرج من المركز المبيع.'
        urgency = 'high'
        suggested_size_pct = 0
        emoji = '🛑'

    # ---- 2. CHECK T2 HIT (target_price_2) — الهدف الثاني ----
    elif target_2 > 0 and is_long and current_price >= target_2:
        action = 'TAKE_PROFIT_T2'
        action_ar = 'بيع كامل'
        reason_ar = f'السعر وصل لـ T2 ({target_2:.2f}). حققت الهدف الكامل — بع الكل.'
        urgency = 'high'
        suggested_size_pct = 0
        emoji = '🎯'
    elif target_2 > 0 and (not is_long) and current_price <= target_2:
        action = 'TAKE_PROFIT_T2'
        action_ar = 'تغطية كاملة'
        reason_ar = f'السعر وصل لـ T2 ({target_2:.2f}). حققت الهدف الكامل.'
        urgency = 'high'
        suggested_size_pct = 0
        emoji = '🎯'

    # ---- 3. CHECK T1 HIT (target_price) — الهدف الأول ----
    elif target > 0 and is_long and current_price >= target:
        action = 'TAKE_PROFIT_T1'
        action_ar = 'بيع جزء (50%)'
        reason_ar = (
            f'وصلت لـ T1 ({target:.2f}). بع 50% واحتفظ بالباقي للـ T2. '
            f'ارفع الوقف إلى نقطة الدخول ({entry:.2f}) لحماية الأرباح.'
        )
        new_stop = entry  # breakeven
        urgency = 'medium'
        suggested_size_pct = 50
        emoji = '💰'
    elif target > 0 and (not is_long) and current_price <= target:
        action = 'TAKE_PROFIT_T1'
        action_ar = 'تغطية جزئية (50%)'
        reason_ar = (
            f'وصلت لـ T1 ({target:.2f}). غطّ 50% واحتفظ بالباقي للـ T2. '
            f'ارفع الوقف إلى نقطة الدخول.'
        )
        new_stop = entry
        urgency = 'medium'
        suggested_size_pct = 50
        emoji = '💰'

    # ---- 4. TRAILING STOP — السعر صعد بشكل جيد ----
    # V39.2: Trailing stop activates at 3% gain (was 5%) — unified with backtest
    elif is_long and current_price > entry and highest_reached > entry:
        gain_pct = ((highest_reached - entry) / entry) * 100 if entry > 0 else 0
        if gain_pct >= 3:
            # V39.2: Lock in 50% of gain, move stop to break-even+1% after 3%
            locked_gain = (highest_reached - entry) * 0.5
            proposed_stop = entry + locked_gain
            # Don't lower the existing stop
            if proposed_stop > stop:
                action = 'TRAILING_STOP'
                action_ar = 'ارفع الوقف'
                reason_ar = (
                    f'السعر صعد {gain_pct:.1f}% من الدخول. '
                    f'ارفع الوقف إلى {proposed_stop:.2f} لحماية نصف الأرباح.'
                )
                new_stop = round(proposed_stop, 4)
                urgency = 'medium'
                suggested_size_pct = 100
                emoji = '📈'

    # ---- 5. ADD — السعر قرب الدخول والزخم ما زال قوياً ----
    # V39.2: Scale-in requires TWO conditions:
    #   A. Maker State = Accumulation (already enforced in V39.1)
    #   B. Price proximity: near Bullish Order Block OR within -3% of entry (no chasing!)
    elif is_long and 0 < h_days <= 3 and abs(current_return) < 2:
        # Check if momentum is still bullish
        rsi = indicators.get('rsi', 50)
        trend = indicators.get('trend', 'NEUTRAL')
        maker_state = indicators.get('maker_state', '')  # absorption/accumulation
        is_accumulation = maker_state in ('absorption', 'accumulation')

        # V39.2: Price proximity check — no chasing!
        # Price must be near entry (-3% or less away) OR near a Bullish Order Block
        near_entry = current_return >= -3.0  # within -3% of entry = pullback (good)
        bullish_ob = indicators.get('bullish_order_block', None)  # SMC Bullish OB price level
        near_order_block = False
        if bullish_ob and bullish_ob > 0 and entry > 0:
            # Price must be within the OB zone (between OB bottom and OB top + 1%)
            ob_top = float(indicators.get('ob_top', bullish_ob))
            ob_bottom = float(indicators.get('ob_bottom', bullish_ob))
            near_order_block = ob_bottom <= current_price <= (ob_top * 1.01)

        can_add = is_accumulation and (near_entry or near_order_block)

        if trend == 'BULLISH' and 45 <= rsi <= 65 and can_add:
            action = 'ADD'
            action_ar = 'زود المركز'
            if near_order_block:
                reason_ar = (
                    f'السهم رجع للـ Order Block و الميكرز بيجمع. '
                    f'فرصة تعزيز ممتازة عشان الحيتان بلمون.'
                )
            else:
                reason_ar = (
                    f'السعر ما زال قرب نقطة الدخول ({entry:.2f}) والزخم صاعد والميكرز بيجمع. '
                    f'فرصة لتعزيز المركز قبل الانطلاق.'
                )
            urgency = 'low'
            suggested_size_pct = 130  # add 30%
            emoji = '➕'
        elif trend == 'BULLISH' and 45 <= rsi <= 65 and not can_add:
            # Can't add — price too far from entry / no OB / no accumulation
            action = 'HOLD'
            action_ar = 'انتظر'
            if not is_accumulation:
                reason_ar = 'الميكرز مش بيجمع — الإضافة محتاجة تجميع مؤسسي.'
            elif not near_entry and not near_order_block:
                reason_ar = f'السهم طالع بعيد عن الدخول ({current_return:+.1f}%) — ممنوع الإضافة (Chasing).'
            emoji = '⚠️'

    # ---- 6. REDUCE — السعر نزل تحت support / إشارة ضعف ----
    elif is_long and current_return < -3:
        rsi = indicators.get('rsi', 50)
        trend = indicators.get('trend', 'NEUTRAL')
        if trend == 'BEARISH' or rsi < 35:
            action = 'REDUCE'
            action_ar = 'خفّض المركز'
            reason_ar = (
                f'السعر نزل {abs(current_return):.1f}% والترند انعكس. '
                f'خفّض 30% من المركز لتقليل المخاطرة.'
            )
            urgency = 'high'
            suggested_size_pct = 70
            emoji = '⚠️'

    # ---- 7. EXPIRED — احتفظنا طويلاً بلا نتيجة ----
    elif h_days >= 14 and abs(current_return) < 5:
        action = 'EXIT'
        action_ar = 'إغلاق'
        reason_ar = (
            f'مرت {h_days} يوم بلا حركة واضحة ({current_return:+.1f}%). '
            f'أغلق المركز وحرّر رأس المال لفرص أفضل.'
        )
        urgency = 'medium'
        suggested_size_pct = 0
        emoji = '⏰'

    # ---- Default HOLD ----
    else:
        # Reason varies based on progress
        if progress >= 50:
            reason_ar = f'السعر في منتصف الطريق للهدف ({progress:.0f}%). اصبر، الترقب إيجابي.'
            emoji = '📊'
        elif progress >= 25:
            reason_ar = f'السعر يتحرك نحو الهدف ({progress:.0f}%). استمر في المتابعة.'
            emoji = '✅'
        elif current_return > 0:
            reason_ar = f'المركز رابح {current_return:+.1f}%. اصبر حتى يصل للهدف.'
            emoji = '✅'
        else:
            reason_ar = f'المركز في مرحلة ترقب ({current_return:+.1f}%). لا حاجة لتحرك الآن.'
            emoji = '⏳'

    return {
        'prediction_id': pred_id,
        'ticker': ticker,
        'signal': signal,
        'action': action,
        'action_ar': action_ar,
        'reason_ar': reason_ar,
        'new_stop': new_stop,
        'new_target': new_target,
        'current_return_pct': round(current_return, 2),
        'target_progress_pct': round(progress, 1),
        'holding_days': h_days,
        'urgency': urgency,
        'suggested_size_pct': suggested_size_pct,
        'emoji': emoji,
        'current_price': current_price,
        'entry_price': entry,
        'target_price': target,
        'target_price_2': target_2,
        'stop_loss': stop,
        'prediction_date': pred_date,
        'highest_price_reached': highest_reached,
        'lowest_price_reached': lowest_reached,
        'market': prediction.get('market', 'EGX'),
        'persona': persona,
        'confidence': prediction.get('confidence', 0),
        'master_score': prediction.get('master_score', 0),
        'atr_at_entry': atr_at_entry,
    }


# ---------------------------------------------------------------------------
# Batch: manage_all_active
# ---------------------------------------------------------------------------
def manage_all_active(active_predictions: list, price_lookup_fn=None) -> list:
    """
    يدير كل التوقعات النشطة دفعة واحدة.

    Args:
        active_predictions: list of prediction dicts (status='active' or 'PENDING')
        price_lookup_fn: callable(ticker) -> (current_price, indicators_dict)

    Returns:
        list of management advice dicts (sorted by urgency desc)
    """
    if not active_predictions:
        return []

    results = []
    for pred in active_predictions:
        ticker = pred.get('ticker', '')
        try:
            if price_lookup_fn:
                price, ind = price_lookup_fn(ticker)
            else:
                price = float(pred.get('current_price') or pred.get('entry_price') or 0)
                ind = {}
            advice = manage_position(pred, price, ind)
            results.append(advice)
        except Exception as e:
            results.append({
                'prediction_id': pred.get('id'),
                'ticker': ticker,
                'action': 'HOLD',
                'action_ar': 'انتظر',
                'reason_ar': f'خطأ في تحميل البيانات: {e}',
                'urgency': 'low',
                'emoji': '❓',
                'current_return_pct': 0,
                'target_progress_pct': 0,
                'holding_days': 0,
                'suggested_size_pct': 100,
            })

    # Sort by urgency: high → medium → low
    urgency_order = {'high': 0, 'medium': 1, 'low': 2}
    results.sort(key=lambda x: urgency_order.get(x.get('urgency', 'low'), 3))
    return results


# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------
if __name__ == '__main__':
    # Test 1: HIT T1
    pred1 = {
        'id': 1, 'ticker': 'TEST1', 'signal': 'BUY', 'signal_type': 'BUY',
        'entry_price': 100, 'target_price': 110, 'target_price_2': 120,
        'stop_loss': 95, 'prediction_date': '2026-08-01',
        'persona': 'balanced', 'highest_price_reached': 110,
    }
    r1 = manage_position(pred1, 110.5)
    print(f"Test 1 (T1 hit): {r1['action']} {r1['emoji']} — {r1['action_ar']}")
    print(f"  reason: {r1['reason_ar'][:80]}")
    print(f"  new_stop: {r1['new_stop']}, size: {r1['suggested_size_pct']}%")

    # Test 2: STOP HIT
    pred2 = {**pred1, 'id': 2, 'ticker': 'TEST2'}
    r2 = manage_position(pred2, 94.5)
    print(f"\nTest 2 (stop hit): {r2['action']} {r2['emoji']} — {r2['action_ar']}")

    # Test 3: TRAILING STOP (price up 7%)
    pred3 = {**pred1, 'id': 3, 'ticker': 'TEST3', 'highest_price_reached': 107}
    r3 = manage_position(pred3, 106)
    print(f"\nTest 3 (trailing): {r3['action']} {r3['emoji']} — {r3['action_ar']}")
    print(f"  new_stop: {r3['new_stop']}")

    # Test 4: HOLD (price stable)
    pred4 = {**pred1, 'id': 4, 'ticker': 'TEST4', 'highest_price_reached': 102}
    r4 = manage_position(pred4, 101)
    print(f"\nTest 4 (hold): {r4['action']} {r4['emoji']} — {r4['action_ar']}")
    print(f"  progress: {r4['target_progress_pct']}%, return: {r4['current_return_pct']}%")

    # Test 5: REDUCE (price down 4% + bearish)
    pred5 = {**pred1, 'id': 5, 'ticker': 'TEST5', 'lowest_price_reached': 96}
    r5 = manage_position(pred5, 96, indicators={'trend': 'BEARISH', 'rsi': 32})
    print(f"\nTest 5 (reduce): {r5['action']} {r5['emoji']} — {r5['action_ar']}")
