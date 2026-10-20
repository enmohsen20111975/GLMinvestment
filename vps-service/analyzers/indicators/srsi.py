"""
analyzers/indicators/srsi.py — Canonical Stochastic RSI (SRSI)
=================================================================
**Rule 67 — CALCULATION-CANONICAL**: ده المصدر الوحيد لحساب SRSI في المشروع.

SRSI = Stochastic RSI — بيطبّق صيغة Stochastic على قيم RSI (مش على الأسعار مباشرة).

الصيغة (Chande & Kroll 1994):
  1. احسب RSI لكل نقطة (Wilder's smoothing — من canonical rsi.py)
  2. %K = (RSI_current - min(RSI, period)) / (max(RSI, period) - min(RSI, period)) × 100
  3. %D = SMA(%K, smooth_period)

المدى: 0-100
  - Overbought: %K > 80 أو %D > 80
  - Oversold: %K < 20 أو %D < 20
  - Cross %K فوق %D = إشارة صعود
  - Cross %K تحت %D = إشارة هبوط

الفرق عن RSI:
  - RSI بيقيس قوة الزخم (momentum strength)
  - SRSI بيقيس موقع RSI ضمن مداه الأخير (relative position)
  - SRSI أكثر حساسية = إشارات أكتر (وأخطاء أكتر)
  - RSI أدق في الـ trending markets، SRSI أدق في الـ ranging markets

المرجعية:
  - Rule 67 (00-CONSTITUTION.md)
  - Chande, T. & Kroll, S. (1994). The New Technical Trader
  - النسخة TS: src/lib/analysis-engine.ts (لو موجودة)

الاستخدام:
  from analyzers.indicators import calc_srsi
  srsi = calc_srsi(closes, period=14, smooth_k=3, smooth_d=3)
"""
from __future__ import annotations
from typing import Optional, List, Dict
from .rsi import calc_rsi


def _rsi_series(closes: List[float], period: int = 14) -> List[float]:
    """حساب RSI لكل نقطة في السلسلة (مش بس آخر قيمة)."""
    if len(closes) < period + 1:
        return []
    rsi_values: List[float] = []
    for i in range(period + 1, len(closes) + 1):
        slice_closes = closes[:i]
        rsi = calc_rsi(slice_closes, period)
        if rsi is not None:
            rsi_values.append(rsi)
    return rsi_values


def calc_srsi(closes: List[float], period: int = 14,
              smooth_k: int = 3, smooth_d: int = 3) -> Optional[Dict[str, float]]:
    """حساب Stochastic RSI (SRSI) — canonical.

    Args:
        closes: إغلاقات الأسعار (آخرها في النهاية)
        period: فترة RSI + Stochastic (default: 14)
        smooth_k: فترة تنعيم %K (default: 3)
        smooth_d: فترة تنعيم %D (default: 3)

    Returns:
        dict: {k: float, d: float} أو None لو البيانات غير كافية.
        - k: قيمة %K (0-100)
        - d: قيمة %D (SMA of %K)
        القيم rounded لـ 2 أرقام عشرية.

    Notes:
        - بـ يستخدم canonical calc_rsi (Wilder's) لحساب RSI series
        - %K = (RSI - min(RSI,period)) / (max(RSI,period) - min(RSI,period)) × 100
        - %D = SMA(%K, smooth_d)
        - لو max == min (RSI ثابت) → %K = 0 (محايد)
    """
    if not closes or len(closes) < period * 2 + 1:
        return None

    # 1. احسب RSI series (Wilder's — من canonical)
    rsi_values = _rsi_series(closes, period)
    if len(rsi_values) < period:
        return None

    # 2. احسب %K series
    k_values: List[float] = []
    for i in range(period - 1, len(rsi_values)):
        rsi_window = rsi_values[i - period + 1: i + 1]
        if len(rsi_window) < period:
            continue
        rsi_current = rsi_values[i]
        rsi_min = min(rsi_window)
        rsi_max = max(rsi_window)
        if rsi_max == rsi_min:
            # RSI ثابت → %K = 0 (محايد)
            k_values.append(0.0)
        else:
            k = ((rsi_current - rsi_min) / (rsi_max - rsi_min)) * 100
            k_values.append(round(k, 2))

    if not k_values:
        return None

    # 3. تنعيم %K (SMA)
    if len(k_values) >= smooth_k:
        smoothed_k: List[float] = []
        for i in range(smooth_k - 1, len(k_values)):
            avg = sum(k_values[i - smooth_k + 1: i + 1]) / smooth_k
            smoothed_k.append(round(avg, 2))
    else:
        smoothed_k = k_values

    if not smoothed_k:
        return None

    # 4. %D = SMA(%K, smooth_d)
    if len(smoothed_k) >= smooth_d:
        d_window = smoothed_k[-smooth_d:]
        d_val = round(sum(d_window) / smooth_d, 2)
    else:
        d_val = round(sum(smoothed_k) / len(smoothed_k), 2)

    k_val = smoothed_k[-1]

    return {
        'k': k_val,
        'd': d_val,
    }
