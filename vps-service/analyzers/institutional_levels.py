#!/usr/bin/env python3
"""
institutional_levels.py — حساب المستويات المؤسسية للسيولة + Falling Knife Guard
=================================================================================
Task BRAVO-P0-QUANT-LOGIC-NO-FALLING-KNIFE (Owner Directive 2026-10-13)

موديول كنسي (canonical) لحساب مستويات السيولة المؤسسية من بيانات الشموع اليومية.

المستويات المحسوبة:
  1. Fibonacci Levels    — مستويات فيبوناتشي (آخر swing high/low في الـ 50 شمعة الأخيرة)
  2. Pivot Points        — نقاط البيفوت الكلاسيكية (بناءً على آخر شمعة مكتملة)
  3. Order Blocks        — آخر 3 مناطق أوردر بلوك (3 شموع متتالية قبل انعكاس قوي)
  4. Fair Value Gaps     — آخر 3 فجوات قيمة عادلة (FVG)
  5. Falling Knife Guard — منع توليد أهداف شراء للأسهم الهابطة (Step 1)

الالتزام بالقواعد:
  - Rule 20 (PYTHON = BRAIN): كل الحسابات في Python — لا JavaScript.
  - Rule 27 (NO-FAKE-DATA): لو الـ candles < 10 → نُرجع None (لا اختلاع).
  - Rule 67 (ROOT-CAUSE-FIRST): لا قيم افتراضية — فقط ما يُحسب من البيانات.

Public API:
  compute_institutional_levels(candles: List[Dict]) -> Dict[str, Any] | None
  detect_falling_knife(candles: List[Dict], ma50: float = None, ma200: float = None) -> Dict
  compute_radar_markers(ticker, candles, stocks_db_path) -> List[Dict]
  compute_chart_zones(candles, institutional_levels) -> List[Dict]
  compute_prediction_ray(ticker, stocks_db_path, predictions_db_path) -> Dict | None
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def _to_float(v: Any, default: float = 0.0) -> float:
    """تحويل آمن لأي قيمة إلى float."""
    if v is None:
        return default
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace('\u202f', '').replace('\xa0', '').replace(' ', '').replace(',', '')
    if not s:
        return default
    mult = 1.0
    try:
        if s.endswith(('k', 'K')):
            mult, s = 1e3, s[:-1]
        elif s.endswith(('m', 'M')):
            mult, s = 1e6, s[:-1]
        elif s.endswith(('b', 'B')):
            mult, s = 1e9, s[:-1]
        return float(s) * mult
    except (ValueError, TypeError):
        return default


def _candle_date(c: Dict[str, Any]) -> str:
    """استخراج التاريخ من شمعة."""
    for k in ('date', 'price_date', 'timestamp', 'datetime'):
        v = c.get(k)
        if v:
            s = str(v)
            return s[:10] if len(s) >= 10 else s
    return ''


def _candle_ohlc(c: Dict[str, Any]) -> Tuple[float, float, float, float]:
    """استخراج (open, high, low, close) من شمعة كـ floats.

    Task BRAVO-P0-QUANT-LOGIC: يدعم fallback لـ close_price/open_price إلخ
    لو الـ close الأساسي NULL (مشكلة شائعة في stock_daily_prices).
    """
    o = _to_float(c.get('open') or c.get('open_price'))
    h = _to_float(c.get('high') or c.get('high_price'))
    l = _to_float(c.get('low') or c.get('low_price'))
    cl = _to_float(c.get('close') or c.get('close_price'))
    if h < max(o, l, cl) and h > 0:
        h = max(o, l, cl, h)
    if l > min(o, h, cl) and l > 0:
        l = min(o, h, cl, l)
    return o, h, l, cl


# ─────────────────────────────────────────────────────────────────────────────
# 1) Fibonacci Levels — آخر swing high/low في الـ 50 شمعة الأخيرة
# ─────────────────────────────────────────────────────────────────────────────
def _compute_fibonacci(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """حساب مستويات فيبوناتشي من آخر swing high/low."""
    n = len(candles)
    if n < 5:
        return {}

    lookback = min(50, n)
    recent = candles[-lookback:]
    highs = [_candle_ohlc(c)[1] for c in recent]
    lows = [_candle_ohlc(c)[2] for c in recent]

    swing_high = max(highs) if highs else 0
    swing_low = min(lows) if lows else 0

    if swing_high <= 0 or swing_low <= 0 or swing_high <= swing_low:
        return {}

    diff = swing_high - swing_low
    # تحديد الاتجاه: لو آخر close قريب من swing_high → uptrend، لو قريب من swing_low → downtrend
    last_close = _candle_ohlc(candles[-1])[3]
    trend = 'up' if last_close > (swing_high + swing_low) / 2 else 'down'

    levels = {
        '0.382': round(swing_high - diff * 0.382, 4),
        '0.5': round(swing_high - diff * 0.5, 4),
        '0.618': round(swing_high - diff * 0.618, 4),
        '0.786': round(swing_high - diff * 0.786, 4),
    }

    return {
        'swing_high': round(swing_high, 4),
        'swing_low': round(swing_low, 4),
        'trend': trend,
        'levels': levels,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 2) Pivot Points (Classic) — بناءً على آخر شمعة مكتملة
# ─────────────────────────────────────────────────────────────────────────────
def _compute_pivots(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """حساب نقاط الارتكاز الكلاسيكية."""
    if len(candles) < 2:
        return {}

    # آخر شمعة مكتملة (قبل الأخيرة)
    last = candles[-2]
    o, h, l, c = _candle_ohlc(last)
    if h <= 0 or l <= 0:
        return {}

    pivot = (h + l + c) / 3
    r1 = 2 * pivot - l
    s1 = 2 * pivot - h
    r2 = pivot + (h - l)
    s2 = pivot - (h - l)

    return {
        'P': round(pivot, 4),
        'R1': round(r1, 4),
        'R2': round(r2, 4),
        'S1': round(s1, 4),
        'S2': round(s2, 4),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 3) Order Blocks — آخر 3 مناطق أوردر بلوك
# ─────────────────────────────────────────────────────────────────────────────
def _compute_order_blocks(candles: List[Dict[str, Any]], max_blocks: int = 3) -> List[Dict[str, Any]]:
    """حساب مناطق الأوردر بلوك (3 شموع متتالية قبل انعكاس قوي)."""
    n = len(candles)
    if n < 5:
        return []

    blocks: List[Dict[str, Any]] = []
    i = 0
    while i < n - 4 and len(blocks) < max_blocks:
        c0 = candles[i]
        c1 = candles[i + 1]
        c2 = candles[i + 2]
        c3 = candles[i + 3]

        _o0, h0, l0, _cl0 = _candle_ohlc(c0)
        _o1, h1, l1, _cl1 = _candle_ohlc(c1)
        _o2, h2, l2, cl2 = _candle_ohlc(c2)
        _o3, h3, l3, cl3 = _candle_ohlc(c3)

        # Bullish OB: 3 شموع هابطة ثم شمعة صاعدة قوية
        if cl0 < _o0 and cl1 < _o1 and cl2 < _o2 and cl3 > _o3:
            move = cl3 - l3
            if move > 0 and (h0 - l0) > 0 and move / (h0 - l0) > 1.2:
                block_high = max(h0, h1, h2)
                block_low = min(l0, l1, l2)
                blocks.append({
                    'start_date': _candle_date(c0),
                    'end_date': _candle_date(c2),
                    'high': round(float(block_high), 4),
                    'low': round(float(block_low), 4),
                    'type': 'bullish',
                })
                i += 4
                continue

        # Bearish OB: 3 شموع صاعدة ثم شمعة هابطة قوية
        if cl0 > _o0 and cl1 > _o1 and cl2 > _o2 and cl3 < _o3:
            move = h3 - cl3
            if move > 0 and (h0 - l0) > 0 and move / (h0 - l0) > 1.2:
                block_high = max(h0, h1, h2)
                block_low = min(l0, l1, l2)
                blocks.append({
                    'start_date': _candle_date(c0),
                    'end_date': _candle_date(c2),
                    'high': round(float(block_high), 4),
                    'low': round(float(block_low), 4),
                    'type': 'bearish',
                })
                i += 4
                continue
        i += 1

    return blocks[-max_blocks:][::-1] if len(blocks) > max_blocks else blocks[::-1]


# ─────────────────────────────────────────────────────────────────────────────
# 4) Fair Value Gaps (FVG) — آخر 3 فجوات قيمة عادلة
# ─────────────────────────────────────────────────────────────────────────────
def _compute_fvgs(candles: List[Dict[str, Any]], max_gaps: int = 3) -> List[Dict[str, Any]]:
    """حساب فجوات القيمة العادلة."""
    n = len(candles)
    if n < 3:
        return []

    gaps: List[Dict[str, Any]] = []
    for i in range(2, n):
        _o0, _h0, l0, _c0 = _candle_ohlc(candles[i - 2])
        _o1, _h1, _l1, _c1 = _candle_ohlc(candles[i - 1])
        _o2, h2, l2, _c2 = _candle_ohlc(candles[i])

        if l2 > h0 and h0 > 0:
            gaps.append({
                'date': _candle_date(candles[i]),
                'type': 'bullish',
                'top': round(float(l2), 4),
                'bottom': round(float(h0), 4),
            })
        elif h2 < l0 and h2 > 0:
            gaps.append({
                'date': _candle_date(candles[i]),
                'type': 'bearish',
                'top': round(float(l0), 4),
                'bottom': round(float(h2), 4),
            })

    return gaps[-max_gaps:][::-1] if len(gaps) > max_gaps else gaps[::-1]


# ─────────────────────────────────────────────────────────────────────────────
# 5) Falling Knife Guard (Step 1 — Owner Directive)
# ─────────────────────────────────────────────────────────────────────────────
def detect_falling_knife(
    candles: List[Dict[str, Any]],
    ma50: Optional[float] = None,
    ma200: Optional[float] = None,
) -> Dict[str, Any]:
    """اكتشاف السكاكين الساقطة — منع توليد أهداف شراء للأسهم الهابطة.

    القاعدة (Owner Directive):
      إذا كان السعر الحالي أدنى من متوسط 50 يوماً بأكثر من 5%،
      ومتوسط 50 أدنى من متوسط 200، أو مؤشر الاتجاه العام Downtrend:
        - يُمنع منعاً باتاً اعتبار القمم السابقة كـ target_price للشراء.
        - targets_available = False
        - entry_price = None, target_price = None, risk_reward = None
        - القمم السابقة = مقاومات فنية للتصريف (Resistance / Exit Zones).

    Returns:
        {
            'is_falling_knife': bool,
            'reason': str,
            'price_vs_ma50_pct': float,
            'ma50_below_ma200': bool,
            'targets_available': bool,  # False لو falling knife
            'resistance_zones': List[float],  # القمم كـ مقاومات تصريف
        }
    """
    result: Dict[str, Any] = {
        'is_falling_knife': False,
        'reason': '',
        'price_vs_ma50_pct': 0.0,
        'ma50_below_ma200': False,
        'targets_available': True,
        'resistance_zones': [],
    }

    if not candles or len(candles) < 5:
        return result

    # السعر الحالي = آخر close
    last_close = _candle_ohlc(candles[-1])[3]
    if last_close <= 0:
        return result

    # حساب MA50 لو لم يُمرر
    if ma50 is None or ma50 <= 0:
        lookback50 = min(50, len(candles))
        closes50 = [_candle_ohlc(c)[3] for c in candles[-lookback50:]]
        ma50 = sum(closes50) / len(closes50) if closes50 else 0

    # حساب MA200 لو لم يُمرر
    if ma200 is None or ma200 <= 0:
        lookback200 = min(200, len(candles))
        closes200 = [_candle_ohlc(c)[3] for c in candles[-lookback200:]]
        ma200 = sum(closes200) / len(closes200) if closes200 else 0

    if ma50 <= 0:
        return result

    price_vs_ma50_pct = ((last_close - ma50) / ma50) * 100
    ma50_below_ma200 = (ma200 > 0 and ma50 < ma200)

    result['price_vs_ma50_pct'] = round(price_vs_ma50_pct, 2)
    result['ma50_below_ma200'] = ma50_below_ma200

    # شروط Falling Knife:
    # 1. السعر أدنى من MA50 بأكثر من 5%
    # 2. + MA50 أدنى من MA200 (downtrend مؤكد) OR اتجاه هابط من الـ candles
    is_below_ma50 = price_vs_ma50_pct < -5.0
    is_downtrend = ma50_below_ma200

    # فحص إضافي: هل الـ candles في هبوط متواصل؟ (آخر 10 شموع)
    if len(candles) >= 10:
        recent_closes = [_candle_ohlc(c)[3] for c in candles[-10:]]
        if len(recent_closes) >= 2:
            roc_10d = ((recent_closes[-1] - recent_closes[0]) / recent_closes[0]) * 100 if recent_closes[0] > 0 else 0
            if roc_10d < -5.0:
                is_downtrend = True

    if is_below_ma50 and is_downtrend:
        result['is_falling_knife'] = True
        result['reason'] = f'Falling Knife: price {price_vs_ma50_pct:.1f}% below MA50 + downtrend (MA50<MA200: {ma50_below_ma200})'
        result['targets_available'] = False

        # القمم السابقة = مقاومات تصريف (NOT targets)
        lookback = min(50, len(candles))
        recent_highs = [_candle_ohlc(c)[1] for c in candles[-lookback:]]
        # أعلى 3 قمم كـ مقاومات
        sorted_highs = sorted(set(recent_highs), reverse=True)[:3]
        result['resistance_zones'] = [round(h, 4) for h in sorted_highs if h > last_close]

    return result


# ─────────────────────────────────────────────────────────────────────────────
# 6) Radar Markers — إشارات صانع السوق من radar_signal_tracking
# ─────────────────────────────────────────────────────────────────────────────
SIGNAL_TYPE_TO_MARKER = {
    'quiet_accumulation_strong': {
        'position': 'belowBar', 'color': '#089981', 'shape': 'arrowUp',
        'text': 'صانع السوق', 'label_ar': 'تجميع قوي',
    },
    'B_quiet_accumulation_strong': {
        'position': 'belowBar', 'color': '#089981', 'shape': 'arrowUp',
        'text': 'صانع السوق', 'label_ar': 'تجميع قوي (B)',
    },
    'pre_surge': {
        'position': 'aboveBar', 'color': '#eab308', 'shape': 'arrowDown',
        'text': 'فخ صعود', 'label_ar': 'اختراق مبكر',
    },
    'A_pre_surge': {
        'position': 'aboveBar', 'color': '#eab308', 'shape': 'arrowDown',
        'text': 'فخ صعود', 'label_ar': 'اختراق مبكر (A)',
    },
    'explosive_surge': {
        'position': 'belowBar', 'color': '#3b82f6', 'shape': 'circle',
        'text': 'امتصاص', 'label_ar': 'انفجار سيولي',
    },
    'D_explosive_surge': {
        'position': 'belowBar', 'color': '#3b82f6', 'shape': 'circle',
        'text': 'امتصاص', 'label_ar': 'انفجار سيولي (D)',
    },
}


def compute_radar_markers(
    ticker: str,
    candles: List[Dict[str, Any]],
    stocks_db_path: str,
) -> List[Dict[str, Any]]:
    """ابنِ قائمة markers من radar_signal_tracking للـ ticker.

    Rule 27: فقط الإشارات الحقيقية المسجّلة في DB — لا اختلاع.
    """
    if not ticker or not candles:
        return []

    import sqlite3
    markers: List[Dict[str, Any]] = []

    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(stocks_db_path, writable=False)
        cur = conn.cursor()
        rows = cur.execute(
            """SELECT signal_date, signal_type, entry_price, status
               FROM radar_signal_tracking
               WHERE ticker = ? AND signal_date IS NOT NULL
               ORDER BY signal_date ASC""",
            (ticker.upper().strip().split('.')[0],),
        ).fetchall()
        conn.close()

        if not rows:
            return []

        candle_dates = {_candle_date(c): True for c in candles}

        for signal_date, signal_type, entry_price, status in rows:
            style = SIGNAL_TYPE_TO_MARKER.get(signal_type)
            if not style:
                continue
            if signal_date not in candle_dates:
                continue
            if status == 'REJECTED_BY_AI_GATEKEEPER':
                continue

            markers.append({
                'time': signal_date,
                'position': style['position'],
                'color': style['color'],
                'shape': style['shape'],
                'text': style['text'],
                'signal_type': signal_type,
                'label_ar': style['label_ar'],
                'entry_price': float(entry_price) if entry_price else None,
                'status': status,
            })

        return markers
    except Exception:
        return []


# ─────────────────────────────────────────────────────────────────────────────
# 7) Zones — مناطق الطلب والعرض من Order Blocks + Fibonacci
# ─────────────────────────────────────────────────────────────────────────────
def compute_chart_zones(
    candles: List[Dict[str, Any]],
    institutional_levels: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """ابنِ قائمة zones من Order Blocks + Fibonacci."""
    if not candles or len(candles) < 10:
        return []

    if institutional_levels is None:
        institutional_levels = compute_institutional_levels(candles)

    if not institutional_levels:
        return []

    zones: List[Dict[str, Any]] = []

    for ob in (institutional_levels.get('order_blocks') or []):
        ob_type = ob.get('type', '')
        zone_type = 'order_block_demand' if ob_type == 'bullish' else 'order_block_supply'
        label = 'منطقة طلب (Order Block)' if ob_type == 'bullish' else 'منطقة عرض (Order Block)'
        zones.append({
            'zone_type': zone_type,
            'price_high': float(ob.get('high', 0)),
            'price_low': float(ob.get('low', 0)),
            'label': label,
            'source_date': ob.get('end_date', ''),
            'color': '#089981' if ob_type == 'bullish' else '#f23645',
        })

    fib = institutional_levels.get('fibonacci') or {}
    fib_levels = fib.get('levels') or {}
    swing_high = float(fib.get('swing_high', 0))
    swing_low = float(fib.get('swing_low', 0))
    if swing_high > 0 and swing_low > 0:
        golden_618 = fib_levels.get('0.618')
        golden_500 = fib_levels.get('0.5')
        if golden_618 and golden_500:
            zones.append({
                'zone_type': 'fibonacci_golden_pocket',
                'price_high': float(max(golden_618, golden_500)),
                'price_low': float(min(golden_618, golden_500)),
                'label': 'جيب ذهبي (Golden Pocket 0.5-0.618)',
                'source_date': '',
                'color': '#a855f7',
            })

    return zones


# ─────────────────────────────────────────────────────────────────────────────
# 8) Prediction Ray — خط الهدف ووقف الخسارة من التوقع الكنسي
# ─────────────────────────────────────────────────────────────────────────────
def compute_prediction_ray(
    ticker: str,
    stocks_db_path: str,
    predictions_db_path: str = '',
) -> Optional[Dict[str, Any]]:
    """اقرأ أحدث توقع للـ ticker من predictions.db وارجع entry/target/stop."""
    if not ticker:
        return None

    import sqlite3
    import os

    if not predictions_db_path:
        predictions_db_path = os.path.join(
            os.path.dirname(os.path.dirname(os.path.dirname(stocks_db_path))),
            'db', 'predictions.db'
        )

    if not os.path.exists(predictions_db_path):
        return None

    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(predictions_db_path, writable=False)
        cur = conn.cursor()
        row = cur.execute(
            """SELECT ticker, signal, entry_price, target_price, stop_loss,
                      prediction_date
               FROM predictions
               WHERE ticker = ?
               ORDER BY prediction_date DESC, id DESC
               LIMIT 1""",
            (ticker.upper().strip().split('.')[0],),
        ).fetchone()
        conn.close()

        if not row:
            return None

        _ticker, signal, entry_price, target_price, stop_loss, pred_date = row
        if not entry_price or entry_price <= 0:
            return None

        return {
            'entry_price': float(entry_price),
            'target_price': float(target_price) if target_price else None,
            'stop_loss_price': float(stop_loss) if stop_loss else None,
            'signal': signal,
            'prediction_date': pred_date,
        }
    except Exception:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────
def compute_institutional_levels(candles: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """حساب المستويات المؤسسية للسيولة من بيانات الشموع.

    Args:
        candles: قائمة شموع بترتيب زمني تصاعدي (أقدم أولًا).

    Returns:
        dict بالمستويات الأربعة، أو None لو الـ candles < 10 (Rule 27):
        {
            "fibonacci":      {"swing_high", "swing_low", "trend", "levels": {...}},
            "pivots":         {"P", "R1", "R2", "S1", "S2"},
            "order_blocks":   [{start_date, end_date, high, low, type}, ...],
            "fair_value_gaps":[{date, type, top, bottom}, ...]
        }
    """
    if not candles or len(candles) < 10:
        return None

    try:
        return {
            'fibonacci': _compute_fibonacci(candles),
            'pivots': _compute_pivots(candles),
            'order_blocks': _compute_order_blocks(candles, max_blocks=3),
            'fair_value_gaps': _compute_fvgs(candles, max_gaps=3),
        }
    except Exception:
        return None
