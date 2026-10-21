"""
core/real_liquidity_radar.py — محرك السيولة اللحظية الواقعي
================================================================
**BRAVO-OPERATIONAL**: محرك سيولة واقعي بقراءة OHLCV حقيقية.

المعادلات الإلزامية:
1. Wick Anatomy (تشريح الذيل)
2. Dryness Ratio (نسبة الجفاف)
3. Effort vs Result (مجهود vs نتيجة — من intraday)
4. Intraday Low Trajectory (مسار القيعان اللحظية)

التصنيف الإلزامي (حالة واحدة فقط لكل سهم):
- ACCUMULATION_CONFIRMED (امتصاص حقيقي)
- DRY_EXPLOSION_READY (جفاف عطش قبل انفجار)
- DIRTY_DISTRIBUTION (تصريف مكشوف)
- SUSPICIOUS_WATCH (مشبوه / مراقبة)
- FALLING_KNIFE (سكين ساقطة - حظر تام)

Usage:
    from core.real_liquidity_radar import analyze_liquidity
    result = analyze_liquidity(ticker, daily_data, intraday_data=None)
"""
from __future__ import annotations

import logging
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


@dataclass
class LiquidityResult:
    """نتيجة محرك السيولة الواقعي."""
    ticker: str
    classification: str  # ACCUMULATION_CONFIRMED | DRY_EXPLOSION_READY | DIRTY_DISTRIBUTION | SUSPICIOUS_WATCH | FALLING_KNIFE
    confidence: float = 0.0  # 0-100

    # Wick Anatomy
    upper_wick_pct: float = 0.0
    lower_wick_pct: float = 0.0
    close_location: float = 0.0  # 0=low, 1=high

    # Dryness
    daily_dryness: float = 1.0  # vol / sma(vol, 20)
    contraction: bool = False  # ATR(5) < ATR(20)

    # Effort vs Result (intraday)
    effort_ratio: Optional[float] = None  # delta_vol / |delta_price|
    effort_signal: str = ''  # 'buying_pressure' | 'selling_pressure' | 'neutral'

    # Intraday Low Trajectory
    low_trajectory: str = ''  # 'HIGHER_LOWS' | 'LOWER_LOWS' | 'FLAT' | 'N/A'

    # MLR (Maximum Loss Ratio) — for rescue engine
    mlr: float = 0.0  # 0=safe, 1=catastrophic

    # Human-readable reason
    reason_ar: str = ''


def analyze_liquidity(
    ticker: str,
    daily_data: List[Dict],  # [{date, open, high, low, close, volume}, ...] (oldest first)
    intraday_data: Optional[List[Dict]] = None,  # [{timestamp, price, volume}, ...] (last 3 hours)
) -> LiquidityResult:
    """تحليل سيولة سهم واحد وإرجاع التصنيف الإلزامي.

    Args:
        ticker: رمز السهم
        daily_data: بيانات يومية (آخر 20-30 يوم) — oldest first
        intraday_data: بيانات لحظية (آخر 3 ساعات) — optional

    Returns:
        LiquidityResult with classification + all metrics
    """
    result = LiquidityResult(ticker=ticker, classification='SUSPICIOUS_WATCH')

    if not daily_data or len(daily_data) < 5:
        result.reason_ar = 'بيانات غير كافية للتحليل'
        return result

    # ── 1. Wick Anatomy (تشريح الذيل) ──────────────────────────
    today = daily_data[-1]
    o = float(today.get('open', 0) or today.get('open_price', 0) or 0)
    h = float(today.get('high', 0) or today.get('high_price', 0) or 0)
    l = float(today.get('low', 0) or today.get('low_price', 0) or 0)
    c = float(today.get('close', 0) or today.get('close_price', 0) or 0)
    v = float(today.get('volume', 0) or 0)

    range_hl = h - l + 1e-6
    body_high = max(o, c)
    body_low = min(o, c)

    result.upper_wick_pct = round(((h - body_high) / range_hl) * 100, 2)
    result.lower_wick_pct = round(((body_low - l) / range_hl) * 100, 2)
    result.close_location = round(((c - l) / range_hl) * 100, 2)

    # ── 2. Dryness Ratio (نسبة الجفاف) ─────────────────────────
    volumes = [float(d.get('volume', 0) or 0) for d in daily_data]
    closes = [float(d.get('close', 0) or d.get('close_price', 0) or 0) for d in daily_data]
    highs = [float(d.get('high', 0) or d.get('high_price', 0) or 0) for d in daily_data]
    lows = [float(d.get('low', 0) or d.get('low_price', 0) or 0) for d in daily_data]

    sma_vol_20 = sum(volumes[-20:]) / min(20, len(volumes)) if volumes else 1
    result.daily_dryness = round(v / sma_vol_20 if sma_vol_20 > 0 else 0, 2)

    # ATR(5) vs ATR(20) — contraction
    if len(closes) >= 21:
        tr_list = []
        for i in range(1, len(daily_data)):
            _h = highs[i]
            _l = lows[i]
            _pc = closes[i - 1]
            tr = max(_h - _l, abs(_h - _pc), abs(_l - _pc))
            tr_list.append(tr)
        atr_5 = sum(tr_list[-5:]) / min(5, len(tr_list)) if len(tr_list) >= 5 else 0
        atr_20 = sum(tr_list[-20:]) / min(20, len(tr_list)) if len(tr_list) >= 1 else 0
        result.contraction = atr_5 < atr_20 if atr_20 > 0 else False
    else:
        result.contraction = False

    # ── 3. Effort vs Result (من intraday) ──────────────────────
    if intraday_data and len(intraday_data) >= 3:
        # آخر 3 ساعات
        recent = intraday_data[-3:]
        delta_vol = float(recent[-1].get('volume', 0) or 0) - float(recent[0].get('volume', 0) or 0)
        delta_price = float(recent[-1].get('price', 0) or 0) - float(recent[0].get('price', 0) or 0)
        result.effort_ratio = round(delta_vol / (abs(delta_price) + 1e-6), 2)

        if delta_vol > 0 and delta_price > 0:
            result.effort_signal = 'buying_pressure'
        elif delta_vol > 0 and delta_price < 0:
            result.effort_signal = 'selling_pressure'
        else:
            result.effort_signal = 'neutral'
    else:
        result.effort_signal = 'N/A'

    # ── 4. Intraday Low Trajectory ─────────────────────────────
    if intraday_data and len(intraday_data) >= 6:
        # خذ آخر 6 قيعان لحظية
        recent_lows = [float(d.get('price', 0) or 0) for d in intraday_data[-6:]]
        higher_lows = all(recent_lows[i] >= recent_lows[i - 1] * 0.998 for i in range(1, len(recent_lows)))
        lower_lows = all(recent_lows[i] <= recent_lows[i - 1] * 1.002 for i in range(1, len(recent_lows)))

        if higher_lows:
            result.low_trajectory = 'HIGHER_LOWS'
        elif lower_lows:
            result.low_trajectory = 'LOWER_LOWS'
        else:
            result.low_trajectory = 'FLAT'
    else:
        result.low_trajectory = 'N/A'

    # ── 5. MLR (Maximum Loss Ratio) ────────────────────────────
    # MLR = مدى انهيار السهم من أعلى قمة في 20 يوم
    if len(highs) >= 20:
        peak_20 = max(highs[-20:])
        current = closes[-1]
        result.mlr = round((peak_20 - current) / peak_20, 4) if peak_20 > 0 else 0
    else:
        result.mlr = 0

    # ── 6. التصنيف الإلزامي (حالة واحدة فقط) ───────────────────
    chg_1d = ((c - o) / o * 100) if o > 0 else 0

    # FALLING_KNIFE: سكين ساقطة — حظر تام
    # شروط: نزول > 3% + volume surge + lower lows + MLR >= 0.15
    if chg_1d < -3.0 and result.daily_dryness > 1.5 and result.low_trajectory == 'LOWER_LOWS':
        result.classification = 'FALLING_KNIFE'
        result.confidence = 85.0
        result.reason_ar = 'السهم بيقع فيه بيع تقيل وقيعان لحظية متناقلة — سكين ساقطة. ابعد فوراً.'
        return result

    if result.mlr >= 0.15 and chg_1d < -2.0:
        result.classification = 'FALLING_KNIFE'
        result.confidence = 80.0
        result.reason_ar = f'السهم نزل {result.mlr*100:.0f}% من قمة 20 يوم — سكين ساقطة. ابعد.'
        return result

    # DIRTY_DISTRIBUTION: تصريف مكشوف
    # شروط: upper_wick عالي + volume > avg + close في النصف السفلي
    if result.upper_wick_pct > 40 and result.daily_dryness > 1.3 and result.close_location < 40:
        result.classification = 'DIRTY_DISTRIBUTION'
        result.confidence = 75.0
        result.reason_ar = 'تصريف مكشوف — ذيل علوي طويل + حجم مرتفع + إغلاق ضعيف. الحيتان بتبيع.'
        return result

    if result.effort_signal == 'selling_pressure' and result.daily_dryness > 1.5:
        result.classification = 'DIRTY_DISTRIBUTION'
        result.confidence = 70.0
        result.reason_ar = 'تصريف لحظي — مجهود بيعي قوي في آخر 3 ساعات.'
        return result

    # ACCUMULATION_CONFIRMED: امتصاص حقيقي
    # شروط: lower_wick عالي + close قرب القمة + volume هادي (مش طفران)
    if result.lower_wick_pct > 30 and result.close_location > 60 and 0.8 <= result.daily_dryness <= 1.5:
        result.classification = 'ACCUMULATION_CONFIRMED'
        result.confidence = 80.0
        result.reason_ar = 'امتصاص حقيقي — ذيل سفلي طويل + إغلاق قوي + حجم متوازن. الميكر بيجمع.'
        return result

    if result.contraction and result.close_location > 55 and result.daily_dryness < 1.2:
        result.classification = 'ACCUMULATION_CONFIRMED'
        result.confidence = 72.0
        result.reason_ar = 'تجميع هادئ — انكماش تذبذب + إغلاق في النصف العلوي + حجم منخفض.'
        return result

    # DRY_EXPLOSION_READY: جفاف عطش قبل انفجار
    # شروط: contraction + volume هابط + close مستقر
    if result.contraction and result.daily_dryness < 0.7 and abs(chg_1d) < 2.0:
        result.classification = 'DRY_EXPLOSION_READY'
        result.confidence = 68.0
        result.reason_ar = 'جفاف عطش — تقلص حجم + انكماش تذبذب. السهم جاهز للانفجار.'
        return result

    # SUSPICIOUS_WATCH: مشبوه / مراقبة (default)
    result.classification = 'SUSPICIOUS_WATCH'
    result.confidence = 50.0
    parts = []
    if result.close_location > 50:
        parts.append('إغلاق في النصف العلوي')
    else:
        parts.append('إغلاق ضعيف')
    if result.contraction:
        parts.append('تذبذب منكمش')
    if result.daily_dryness < 0.8:
        parts.append('حجم منخفض')
    result.reason_ar = f'مراقبة — {". ".join(parts)}.'
    return result
