"""
analyzers/indicators/rsi.py — Canonical RSI (Relative Strength Index)
======================================================================
**Rule 67 — CALCULATION-CANONICAL**: ده المصدر الوحيد لحساب RSI في المشروع.

الصيغة: **Wilder's smoothing** (مش SMA)
  delta[i] = close[i] - close[i-1]
  gain[i] = delta if delta > 0 else 0
  loss[i] = -delta if delta < 0 else 0
  avg_gain = (avg_gain × (period-1) + gain) / period  ← Wilder's
  avg_loss = (avg_loss × (period-1) + loss) / period  ← Wilder's
  RS = avg_gain / avg_loss
  RSI = 100 - 100 / (1 + RS)

السبب: Wilder's smoothing بـ يعطي RSI أبطأ في التغيّر وأكثر استقراراً.
SMA (sum(gains[-14:])/14) بـ يعطي RSI أسرع في التغيّر — ده غلط.

المرجعية:
  - Rule 67 (00-CONSTITUTION.md)
  - Documentation/ENGINEERING_AUDIT_REPORT.md (Bug #1: RSI Wilder vs SMA — 10-20 نقطة فرق)
  - النسخة الأصلية: analyzers/technical_analyzer.py:81 (Wilder's — الصحيحة)

الاستخدام:
  from analyzers.indicators import calc_rsi
  rsi = calc_rsi(closes, period=14)
"""
from __future__ import annotations
from typing import Optional, List


def calc_rsi(closes: List[float], period: int = 14) -> Optional[float]:
    """حساب RSI بصيغة Wilder's smoothing (canonical).

    Args:
        closes: إغلاقات الأسعار (آخرها في النهاية)
        period: فترة RSI (default: 14 — Wilder's standard)

    Returns:
        قيمة RSI (0-100) أو None لو البيانات غير كافية.
        القيمة rounded لـ 2 أرقام عشرية.

    Notes:
        - Wilder's smoothing: `avg_gain = (avg_gain × (period-1) + gain) / period`
        - لو avg_loss == 0 → بـ يرجّع 100.0 (أعلى قوة شرائية)
        - لو len(closes) < period + 1 → بـ يرجّع None
    """
    if not closes or len(closes) < period + 1:
        return None

    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [d if d > 0 else 0 for d in deltas]
    losses = [-d if d < 0 else 0 for d in deltas]

    # Initial average = SMA of first `period` gains/losses
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    # Wilder's smoothing (canonical)
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - 100 / (1 + rs), 2)
