#!/usr/bin/env python3
"""
Candle Probability Engine (محرك احتمالات الشمعة)
=================================================
Port of the TradingView V26 "Maestro Probability Matrix" indicator to the
Python backend.

المنطق الرياضي:
  - بيبص على الشمعة السابقة (خضرا ولا حمرا)
  - بيحسب كم مرة السهم كسر الـ High أو الـ Low بتاع الشمعة السابقة بنسب
    معينة (Step 0%, 1%, 2%)
  - لو الشمعة السابقة خضرا:
      * كم مرة كسر الـ High بنسبة 0%, 1%, 2%؟ → احتمالات الصعود
      * كم مرة كسر الـ Low  بنسبة 0%, 1%, 2%؟ → احتمالات النزول
  - بيقسمهم على إجمالي الشموع الخضرا ويطلع نسبة مئوية

المخرجات:
  {
    "up_prob": 65.5,        # احتمال الصعود %
    "dn_prob": 34.5,        # احتمال النزول %
    "bias": "صاعد",          # صاعد | هابط | محايد
    "bias_color": "#16a34a", # لون CSS
    "bias_emoji": "🟢",
    "prev_candle": "خضراء",  # لون الشمعة السابقة
    "break_high_0pct": 45.2, # احتمال كسر الهاي بـ 0%
    "break_high_1pct": 30.1,
    "break_high_2pct": 18.5,
    "break_low_0pct":  25.0,
    "break_low_1pct":  12.3,
    "break_low_2pct":   8.0,
    "total_green": 60,
    "total_red": 40,
    "sample_size": 100,
    "confidence": "متوسطة"   # ثقة في التوقع
  }

الأمان:
  - فلتر القسمة على صفر (لو مفيش شموع خضرا أو حمرا)
  - حد أدنى للعينات (20 شمعة) عشان النتيجة تكون معبرة

Author: M2yDevelopers Team
@version 1.0.0
"""

from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
import math


# ============================================================================
# ثوابت الإعداد
# ============================================================================
PERC_STEP = 1.0          # نسبة الخطوة (1%)
MIN_SAMPLES = 20         # أقل عدد شموع للثقة في النتيجة
LOOKBACK_DEFAULT = 100   # عدد الشموع اللي بنتفرج عليها افتراضياً


@dataclass
class CandleProbabilityResult:
    """نتيجة محرك احتمالات الشمعة"""
    up_prob: float              # احتمال الصعود %
    dn_prob: float              # احتمال النزول %
    bias: str                   # الميل العام (صاعد/هابط/محايد)
    bias_en: str
    bias_color: str             # لون CSS
    bias_emoji: str
    prev_candle: str            # لون الشمعة السابقة (خضراء/حمراء)
    prev_candle_en: str
    break_high_0pct: float
    break_high_1pct: float
    break_high_2pct: float
    break_low_0pct: float
    break_low_1pct: float
    break_low_2pct: float
    total_green: int
    total_red: int
    sample_size: int
    confidence: str             # ثقة (عالية/متوسطة/منخفضة)
    confidence_en: str
    prev_high: Optional[float]
    prev_low: Optional[float]
    target_up_1pct: Optional[float]   # السعر المستهدف للكسر صعوداً 1%
    target_up_2pct: Optional[float]
    target_dn_1pct: Optional[float]   # السعر المستهدف للكسر هبوطاً 1%
    target_dn_2pct: Optional[float]

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================================
# Candle Probability Engine
# ============================================================================
class CandleProbabilityEngine:
    """
    محرك احتمالات الشمعة — Port of TradingView V26 indicator.

    Usage:
        engine = CandleProbabilityEngine()
        result = engine.calculate(history)  # history = list of {open, high, low, close}
    """

    def __init__(self, perc_step: float = PERC_STEP):
        self.perc_step = perc_step

    def calculate(
        self,
        history: List[Dict[str, Any]],
        lookback: int = LOOKBACK_DEFAULT,
    ) -> Optional[CandleProbabilityResult]:
        """
        يحسب احتمالات الشمعة الجاية بناءً على التاريخ.

        Args:
            history: قائمة بشموع [{'open','high','low','close', ...}, ...]
            lookback: عدد الشموع اللي نحسب عليها (من آخرها)

        Returns:
            CandleProbabilityResult أو None لو البيانات غير كافية
        """
        if not history or len(history) < 5:
            return None

        # خد آخر lookback شمعة
        candles = history[-lookback:] if len(history) > lookback else history

        # نأكد إن كل شمعة عندها high, low, close, open
        normalized = []
        for c in candles:
            try:
                o = float(c.get('open', c.get('open_price', 0)))
                h = float(c.get('high', c.get('high_price', 0)))
                l = float(c.get('low', c.get('low_price', 0)))
                cl = float(c.get('close', c.get('close_price', 0)))
                if h <= 0 or l <= 0 or cl <= 0:
                    continue
                normalized.append({'open': o, 'high': h, 'low': l, 'close': cl})
            except (TypeError, ValueError):
                continue

        if len(normalized) < 5:
            return None

        # ── مصفوفة الاحتمالات ────────────────────────────────────────────
        # total_cp[5][0] = إجمالي الشموع الخضرا
        # total_cp[5][1] = إجمالي الشموع الحمرا
        # total_cp[i][0] = عدد مرات كسر الهاي بنسبة i% (للشمعة الخضرا السابقة)
        # total_cp[i][1] = عدد مرات كسر اللو بنسبة i% (للشمعة الحمراء السابقة)
        total_cp = [[0, 0] for _ in range(6)]  # indices 0..5, [5][*] = totals

        sample_size = 0

        # بنلف من الشمعة رقم 1 (لأننا بنتفرج على السابقة)
        for i in range(1, len(normalized)):
            prev = normalized[i - 1]
            curr = normalized[i]

            prev_close = prev['close']
            prev_open = prev['open']
            prev_high = prev['high']
            prev_low = prev['low']
            curr_high = curr['high']
            curr_low = curr['low']

            # نسبة الخطوة بناءً على إغلاق الشمعة السابقة
            step_cp = prev_close * (self.perc_step / 100.0)

            is_green = prev_close >= prev_open
            bucket = 0 if is_green else 1

            total_cp[5][bucket] += 1
            sample_size += 1

            # ── فحوصات كسر الهاي (للشموع الخضرا) ──
            if is_green:
                # ScoreCP(0, 0): كسر الهاي بدون زيادة
                if curr_high > prev_high:
                    total_cp[0][0] += 1
                # ScoreCP(step_cp, 1): كسر الهاي بزيادة 1%
                if curr_high > (prev_high + step_cp):
                    total_cp[1][0] += 1
                # ScoreCP(step_cp * 2, 2): كسر الهاي بزيادة 2%
                if curr_high > (prev_high + step_cp * 2):
                    total_cp[2][0] += 1
                # كسر اللو (احتمال النزول بعد شمعة خضرا)
                if curr_low < prev_low:
                    total_cp[3][0] += 1
                if curr_low < (prev_low - step_cp):
                    total_cp[4][0] += 1

            # ── فحوصات كسر اللو (للشموع الحمرا) ──
            else:
                # كسر اللو بدون زيادة
                if curr_low < prev_low:
                    total_cp[0][1] += 1
                # كسر اللو بزيادة 1%
                if curr_low < (prev_low - step_cp):
                    total_cp[1][1] += 1
                # كسر اللو بزيادة 2%
                if curr_low < (prev_low - step_cp * 2):
                    total_cp[2][1] += 1
                # كسر الهاي (احتمال الصعود بعد شمعة حمراء)
                if curr_high > prev_high:
                    total_cp[3][1] += 1
                if curr_high > (prev_high + step_cp):
                    total_cp[4][1] += 1

        # ── حساب النسب المئوية (مع فلتر القسمة على صفر) ──
        total_green = total_cp[5][0]
        total_red = total_cp[5][1]
        gtotal = total_green + total_red

        if gtotal == 0:
            return None

        # لو الشمعة السابقة خضرا → نحسب احتمال الصعود من كسر الهاي
        # لو الشمعة السابقة حمرا → نحسب احتمال النزول من كسر اللو
        last_candle = normalized[-1]
        last_is_green = last_candle['close'] >= last_candle['open']

        if last_is_green and total_green > 0:
            up_prob = (total_cp[0][0] / total_green) * 100.0
            dn_prob = (total_cp[3][0] / total_green) * 100.0 if total_cp[3][0] > 0 else 0.0
            break_high_0 = (total_cp[0][0] / total_green) * 100.0
            break_high_1 = (total_cp[1][0] / total_green) * 100.0
            break_high_2 = (total_cp[2][0] / total_green) * 100.0
            break_low_0 = (total_cp[3][0] / total_green) * 100.0 if total_cp[3][0] else 0.0
            break_low_1 = (total_cp[4][0] / total_green) * 100.0 if total_cp[4][0] else 0.0
            break_low_2 = 0.0  # not tracked for green bucket
        elif not last_is_green and total_red > 0:
            dn_prob = (total_cp[0][1] / total_red) * 100.0
            up_prob = (total_cp[3][1] / total_red) * 100.0 if total_cp[3][1] > 0 else 0.0
            break_low_0 = (total_cp[0][1] / total_red) * 100.0
            break_low_1 = (total_cp[1][1] / total_red) * 100.0
            break_low_2 = (total_cp[2][1] / total_red) * 100.0
            break_high_0 = (total_cp[3][1] / total_red) * 100.0 if total_cp[3][1] else 0.0
            break_high_1 = (total_cp[4][1] / total_red) * 100.0 if total_cp[4][1] else 0.0
            break_high_2 = 0.0
        else:
            # fallback: متوسط عام
            up_prob = 50.0
            dn_prob = 50.0
            break_high_0 = break_high_1 = break_high_2 = 0.0
            break_low_0 = break_low_1 = break_low_2 = 0.0

        # ── normalize: up + dn = 100% ──
        total = up_prob + dn_prob
        if total > 0:
            up_prob = round((up_prob / total) * 100.0, 1)
            dn_prob = round((dn_prob / total) * 100.0, 1)
        else:
            up_prob = 50.0
            dn_prob = 50.0

        # ── تحديد الميل العام (Bias) ──
        if up_prob > dn_prob + 10:
            bias = 'صاعد'
            bias_en = 'bullish'
            bias_color = '#16a34a'  # green-600
            bias_emoji = '🟢'
        elif dn_prob > up_prob + 10:
            bias = 'هابط'
            bias_en = 'bearish'
            bias_color = '#dc2626'  # red-600
            bias_emoji = '🔴'
        else:
            bias = 'محايد'
            bias_en = 'neutral'
            bias_color = '#ca8a04'  # yellow-600
            bias_emoji = '🟡'

        # ── ثقة التوقع ──
        if sample_size >= MIN_SAMPLES and abs(up_prob - dn_prob) >= 20:
            confidence = 'عالية'
            confidence_en = 'high'
        elif sample_size >= MIN_SAMPLES:
            confidence = 'متوسطة'
            confidence_en = 'medium'
        else:
            confidence = 'منخفضة'
            confidence_en = 'low'

        # ── أسعار هدف الكسر (للعرض على الشارت) ──
        prev_high = last_candle['high']
        prev_low = last_candle['low']
        last_close = last_candle['close']
        step = last_close * (self.perc_step / 100.0)

        return CandleProbabilityResult(
            up_prob=up_prob,
            dn_prob=dn_prob,
            bias=bias,
            bias_en=bias_en,
            bias_color=bias_color,
            bias_emoji=bias_emoji,
            prev_candle='خضراء' if last_is_green else 'حمراء',
            prev_candle_en='green' if last_is_green else 'red',
            break_high_0pct=round(break_high_0, 1),
            break_high_1pct=round(break_high_1, 1),
            break_high_2pct=round(break_high_2, 1),
            break_low_0pct=round(break_low_0, 1),
            break_low_1pct=round(break_low_1, 1),
            break_low_2pct=round(break_low_2, 1),
            total_green=total_green,
            total_red=total_red,
            sample_size=sample_size,
            confidence=confidence,
            confidence_en=confidence_en,
            prev_high=round(prev_high, 4),
            prev_low=round(prev_low, 4),
            target_up_1pct=round(prev_high + step, 4),
            target_up_2pct=round(prev_high + step * 2, 4),
            target_dn_1pct=round(prev_low - step, 4),
            target_dn_2pct=round(prev_low - step * 2, 4),
        )


# ============================================================================
# Singleton accessor
# ============================================================================
_engine_instance: Optional[CandleProbabilityEngine] = None


def get_candle_probability_engine() -> CandleProbabilityEngine:
    """Singleton accessor for the engine."""
    global _engine_instance
    if _engine_instance is None:
        _engine_instance = CandleProbabilityEngine()
    return _engine_instance


def calculate_candle_probabilities(
    history: List[Dict[str, Any]],
    lookback: int = LOOKBACK_DEFAULT,
) -> Optional[Dict[str, Any]]:
    """
    Convenience function: calculate candle probabilities and return as dict.

    This is the main entry point called by chart_routes.py.
    """
    engine = get_candle_probability_engine()
    result = engine.calculate(history, lookback=lookback)
    if result is None:
        return None
    return result.to_dict()


# ============================================================================
# Self-test
# ============================================================================
if __name__ == '__main__':
    # Generate synthetic test data: 60% green candles
    import random
    random.seed(42)
    test_history = []
    price = 30.0
    for i in range(100):
        o = price
        change = random.uniform(-0.03, 0.04)
        c = o * (1 + change)
        h = max(o, c) * (1 + random.uniform(0, 0.01))
        l = min(o, c) * (1 - random.uniform(0, 0.01))
        test_history.append({'open': o, 'high': h, 'low': l, 'close': c})
        price = c

    result = calculate_candle_probabilities(test_history)
    if result:
        print("✅ Candle Probability Engine Test:")
        print(f"   Up: {result['up_prob']}% | Down: {result['dn_prob']}%")
        print(f"   Bias: {result['bias']} {result['bias_emoji']}")
        print(f"   Prev candle: {result['prev_candle']}")
        print(f"   Sample size: {result['sample_size']}")
        print(f"   Confidence: {result['confidence']}")
        print(f"   Break High 0%: {result['break_high_0pct']}%")
        print(f"   Break Low  0%: {result['break_low_0pct']}%")
    else:
        print("❌ Engine returned None")
