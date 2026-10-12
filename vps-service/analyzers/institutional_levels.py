#!/usr/bin/env python3
"""
institutional_levels.py — حساب المستويات المؤسسية للسيولة (Task BRAVO-CODEPLOY-B3)
=====================================================================================
موديول كنسي (canonical) لحساب مستويات السيولة المؤسسية من بيانات الشموع اليومية.

المستويات المحسوبة:
  1. Fibonacci Levels    — مستويات فيبوناتشي (آخر swing high/low في الـ 50 شمعة الأخيرة)
  2. Pivot Points        — نقاط البيفوت الكلاسيكية (بناءً على آخر شمعة مكتملة)
  3. Order Blocks        — آخر 3 مناطق أوردر بلوك (3 شموع متتالية قبل انعكاس قوي)
  4. Fair Value Gaps     — آخر 3 فجوات قيمة عادلة (FVG)

الالتزام بالقواعد:
  - Rule 20 (PYTHON = BRAIN): كل الحسابات في Python — لا JavaScript.
  - Rule 27 (NO-FAKE-DATA): لو الـ candles < 10 → نُرجع None (لا اختلاع).
  - Rule 67 (ROOT-CAUSE-FIRST): لا قيم افتراضية — فقط ما يُحسب من البيانات.

Public API:
  compute_institutional_levels(candles: List[Dict]) -> Dict[str, Any] | None
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple


# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────
def _to_float(v: Any, default: float = 0.0) -> float:
    """تحويل آمن لأي قيمة إلى float — يتجاوز الفراغات والـ comma والـ k/M/B suffixes."""
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
    """استخراج التاريخ من شمعة (تتوافق مع مفاتيح date/price_date/timestamp)."""
    for k in ('date', 'price_date', 'timestamp', 'datetime'):
        v = c.get(k)
        if v:
            # أخذ أول 10 أحرف لو الـ timestamp فيه وقت
            s = str(v)
            return s[:10] if len(s) >= 10 else s
    return ''


def _candle_ohlc(c: Dict[str, Any]) -> Tuple[float, float, float, float]:
    """استخراج (open, high, low, close) من شمعة كـ floats."""
    o = _to_float(c.get('open'))
    h = _to_float(c.get('high'))
    l = _to_float(c.get('low'))
    cl = _to_float(c.get('close'))
    # دفاع: high >= low >= 0 — لو في بيانات ناقصة نُصلحها محليًا (لا اختلاع — فقط تطهير)
    if h < max(o, l, cl) and h > 0:
        h = max(o, l, cl, h)
    if l > min(o, h, cl) and l > 0:
        l = min(o, h, cl, l)
    return o, h, l, cl


# ─────────────────────────────────────────────────────────────────────────────
# 1) Fibonacci Levels — آخر swing high/low في الـ 50 شمعة الأخيرة
# ─────────────────────────────────────────────────────────────────────────────
def _compute_fibonacci(candles: List[Dict[str, Any]]) -> Dict[str, Any]:
    """حساب مستويات فيبوناتشي للتراجع/الامتداد.

    المعادلة (حسب توجيهات المهمة B3):
      - اتجاه صاعد (last_close > first_close):  level = swing_low + (swing_high - swing_low) * ratio
      - اتجاه هابط:                              level = swing_high - (swing_high - swing_low) * ratio

    النسب المطلوبة: 0.382, 0.5, 0.618 (Golden Pocket), 0.786
    """
    window = candles[-50:] if len(candles) >= 50 else candles
    if len(window) < 5:
        return {'swing_high': None, 'swing_low': None, 'trend': 'unknown', 'levels': {}}

    # استخراج الـ highs/lows/closes من النافذة
    highs: List[float] = []
    lows: List[float] = []
    closes: List[float] = []
    for c in window:
        _o, h, l, cl = _candle_ohlc(c)
        highs.append(h)
        lows.append(l)
        closes.append(cl)

    swing_high = float(max(highs)) if highs else 0.0
    swing_low = float(min(lows)) if lows else 0.0
    if swing_high <= 0 or swing_low <= 0 or swing_high <= swing_low:
        return {'swing_high': None, 'swing_low': None, 'trend': 'unknown', 'levels': {}}

    # تحديد الاتجاه: لو الإغلاق الأخير > الإغلاق الأول للنافذة → صاعد
    first_close = closes[0] if closes else 0.0
    last_close = closes[-1] if closes else 0.0
    trend = 'up' if last_close > first_close else 'down' if last_close < first_close else 'flat'

    # النسب المطلوبة (0.618 = Golden Pocket)
    ratios = [0.382, 0.5, 0.618, 0.786]
    range_val = swing_high - swing_low
    levels: Dict[str, float] = {}
    for r in ratios:
        if trend == 'down':
            level = swing_high - range_val * r
        else:
            # صاعد أو flat — المعادلة الافتراضية
            level = swing_low + range_val * r
        levels[f'{r}'] = round(float(level), 4)

    return {
        'swing_high': round(swing_high, 4),
        'swing_low': round(swing_low, 4),
        'trend': trend,
        'levels': levels,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 2) Pivot Points (Classic) — بناءً على آخر شمعة يومية مكتملة
# ─────────────────────────────────────────────────────────────────────────────
def _compute_pivots(candles: List[Dict[str, Any]]) -> Dict[str, Optional[float]]:
    """حساب نقاط البيفوت الكلاسيكية:
        P  = (H + L + C) / 3
        R1 = 2*P - L        S1 = 2*P - H
        R2 = P + (H - L)    S2 = P - (H - L)
    """
    if not candles:
        return {'P': None, 'R1': None, 'R2': None, 'S1': None, 'S2': None}

    last = candles[-1]
    _o, h, l, c = _candle_ohlc(last)
    if h <= 0 or l <= 0 or c <= 0:
        return {'P': None, 'R1': None, 'R2': None, 'S1': None, 'S2': None}

    pivot = (h + l + c) / 3.0
    r1 = 2.0 * pivot - l
    s1 = 2.0 * pivot - h
    r2 = pivot + (h - l)
    s2 = pivot - (h - l)
    return {
        'P': round(float(pivot), 4),
        'R1': round(float(r1), 4),
        'R2': round(float(r2), 4),
        'S1': round(float(s1), 4),
        'S2': round(float(s2), 4),
    }


# ─────────────────────────────────────────────────────────────────────────────
# 3) Order Blocks — آخر 3 مناطق أوردر بلوك
# ─────────────────────────────────────────────────────────────────────────────
def _compute_order_blocks(candles: List[Dict[str, Any]], max_blocks: int = 3) -> List[Dict[str, Any]]:
    """البحث عن أوردر بلوك: 3 شموع هابطة/صاعدة متتالية قبل انعكاس قوي.

    تعريف Bullish OB: 3 شموع هابطة متتالية (close < open) → بعدها شمعة صاعدة قوية
                      (close > prev_open بنسبة 1% على الأقل).
        النطاق: (min low, max high) للـ 3 شموع الهابطة.
    تعريف Bearish OB: 3 شموع صاعدة متتالية (close > open) → بعدها شمعة هابطة قوية
                      (close < prev_open بنسبة 1% على الأقل).
        النطاق: (min low, max high) للـ 3 شموع الصاعدة.

    نرجّع آخر `max_blocks` من المناطق (الأحدث أولًا).
    """
    n = len(candles)
    if n < 5:
        return []

    blocks: List[Dict[str, Any]] = []
    # عتبة الانعكاس القوي (1% تغيّر من open السابق)
    strong_move_pct = 0.01

    # نمرّ من الأقدم للأحدث، نجمّع الـ OBs، ثم نُرجع آخر max_blocks
    i = 0
    while i < n - 3:
        # فحص 3 شموع متتالية بنفس الاتجاه
        c0_o, c0_h, c0_l, c0_c = _candle_ohlc(candles[i])
        c1_o, c1_h, c1_l, c1_c = _candle_ohlc(candles[i + 1])
        c2_o, c2_h, c2_l, c2_c = _candle_ohlc(candles[i + 2])

        bearish_run = (c0_c < c0_o) and (c1_c < c1_o) and (c2_c < c2_o)
        bullish_run = (c0_c > c0_o) and (c1_c > c1_o) and (c2_c > c2_o)

        if bearish_run or bullish_run:
            # الشمعة الرابعة (i+3) هي شمعة الانعكاس
            if i + 3 < n:
                rev_o, rev_h, rev_l, rev_c = _candle_ohlc(candles[i + 3])
                # فحص قوة الانعكاس: close_after مقابل open قبل الانعكاس (open of i+3)
                if rev_o > 0:
                    move_pct = (rev_c - rev_o) / rev_o if rev_o > 0 else 0.0
                    if bearish_run and move_pct > strong_move_pct:
                        # Bullish OB بعد شموع هابطة + شمعة صاعدة قوية
                        block_high = max(c0_h, c1_h, c2_h)
                        block_low = min(c0_l, c1_l, c2_l)
                        blocks.append({
                            'start_date': _candle_date(candles[i]),
                            'end_date': _candle_date(candles[i + 2]),
                            'high': round(float(block_high), 4),
                            'low': round(float(block_low), 4),
                            'type': 'bullish',
                        })
                        i += 4  # تخطّي الشموع المستهلكة
                        continue
                    elif bullish_run and move_pct < -strong_move_pct:
                        # Bearish OB بعد شموع صاعدة + شمعة هابطة قوية
                        block_high = max(c0_h, c1_h, c2_h)
                        block_low = min(c0_l, c1_l, c2_l)
                        blocks.append({
                            'start_date': _candle_date(candles[i]),
                            'end_date': _candle_date(candles[i + 2]),
                            'high': round(float(block_high), 4),
                            'low': round(float(block_low), 4),
                            'type': 'bearish',
                        })
                        i += 4
                        continue
        i += 1

    # آخر max_blocks (الأحدث أولًا)
    return blocks[-max_blocks:][::-1] if len(blocks) > max_blocks else blocks[::-1]


# ─────────────────────────────────────────────────────────────────────────────
# 4) Fair Value Gaps (FVG) — آخر 3 فجوات قيمة عادلة
# ─────────────────────────────────────────────────────────────────────────────
def _compute_fvgs(candles: List[Dict[str, Any]], max_gaps: int = 3) -> List[Dict[str, Any]]:
    """حساب فجوات القيمة العادلة (Fair Value Gaps):

    Bullish FVG (i >= 2):  low[i] > high[i-2]  (فجوة صاعدة)
        top    = low[i]
        bottom = high[i-2]
    Bearish FVG (i >= 2):  high[i] < low[i-2]  (فجوة هابطة)
        top    = low[i-2]
        bottom = high[i]

    نرجّع آخر `max_gaps` من الفجوات (الأحدث أولًا).
    """
    n = len(candles)
    if n < 3:
        return []

    gaps: List[Dict[str, Any]] = []
    for i in range(2, n):
        _o0, _h0, _l0, _c0 = _candle_ohlc(candles[i - 2])
        _o1, _h1, _l1, _c1 = _candle_ohlc(candles[i - 1])
        _o2, _h2, _l2, _c2 = _candle_ohlc(candles[i])

        # Bullish FVG: low[i] > high[i-2]
        if _l2 > _h0 and _h0 > 0:
            gaps.append({
                'date': _candle_date(candles[i]),
                'type': 'bullish',
                'top': round(float(_l2), 4),
                'bottom': round(float(_h0), 4),
            })
        # Bearish FVG: high[i] < low[i-2]
        elif _h2 < _l0 and _h2 > 0:
            gaps.append({
                'date': _candle_date(candles[i]),
                'type': 'bearish',
                'top': round(float(_l0), 4),
                'bottom': round(float(_h2), 4),
            })

    # آخر max_gaps (الأحدث أولًا)
    return gaps[-max_gaps:][::-1] if len(gaps) > max_gaps else gaps[::-1]


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────
def compute_institutional_levels(candles: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """حساب المستويات المؤسسية للسيولة من بيانات الشموع.

    Args:
        candles: قائمة شموع بترتيب زمني تصاعدي (أقدم أولًا)، كل عنصر dict يحوي:
            {date, open, high, low, close, volume}

    Returns:
        dict بالمستويات الأربعة، أو None لو الـ candles < 10 (Rule 27 — لا اختلاع):
        {
            "fibonacci":      {"swing_high", "swing_low", "trend", "levels": {"0.382", "0.5", "0.618", "0.786"}},
            "pivots":         {"P", "R1", "R2", "S1", "S2"},
            "order_blocks":   [{start_date, end_date, high, low, type}, ...],
            "fair_value_gaps":[{date, type, top, bottom}, ...]
        }
    """
    # Rule 27 (NO-FAKE-DATA): لو الـ candles < 10 → None (لا اختلاع)
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
        # دفاعي: لو أي حساب فشل، لا نُسقط الـ endpoint كله — نُرجع None صريحًا
        # (الـ caller سيتعامل مع None = "لا توجد مستويات متاحة" — Rule 27)
        return None
