"""
analyzers/indicators/atr.py — Canonical ATR (Average True Range)
================================================================
**Rule 67 — CALCULATION-CANONICAL**: ده المصدر الوحيد لحساب ATR في المشروع.

الصيغة: **Wilder's smoothing** (مش SMA)
  TR[i] = max(high[i] - low[i], |high[i] - close[i-1]|, |low[i] - close[i-1]|)
  ATR = (ATR_prev × (period-1) + TR) / period  ← Wilder's smoothing

السبب: Wilder's smoothing بـ يعطي قيم ATR أبطأ في التغيّر وأكثر استقراراً.
SMA (sum/TR_count) بـ يعطي قيم أسرع في التغيّر — ده غلط.

المرجعية:
  - Rule 67 (00-CONSTITUTION.md)
  - Documentation/ENGINEERING_AUDIT_REPORT.md (Bug #1: ATR Wilder vs SMA)
  - النسخة الأصلية: analyzers/technical_analyzer.py:206 (Wilder's — الصحيحة)

الاستخدام:
  from analyzers.indicators import calc_atr
  atr = calc_atr(highs, lows, closes, period=14)
"""
from __future__ import annotations
from typing import Optional, List


def calc_atr(highs: List[float], lows: List[float], closes: List[float],
             period: int = 14) -> Optional[float]:
    """حساب ATR بصيغة Wilder's smoothing (canonical).

    Args:
        highs: قمم الأسعار (آخرها في النهاية)
        lows: قيعان الأسعار (آخرها في النهاية)
        closes: إغلاقات الأسعار (آخرها في النهاية)
        period: فترة ATR (default: 14 — Wilder's standard)

    Returns:
        قيمة ATR (float) أو None لو البيانات غير كافية.
        القيمة rounded لـ 4 أرقام عشرية.

    Notes:
        - Wilder's smoothing: `atr = (atr × (period-1) + tr) / period`
        - لو البيانات أقل من period، بـ يرجّع متوسط TR المتاح.
        - لو مفيش بيانات كافية (len < 2)، بـ يرجّع None.
    """
    if not closes or len(closes) < 2:
        return None
    if not highs or not lows:
        return None
    # ضمان إن كل القوائم بنفس الطول
    min_len = min(len(highs), len(lows), len(closes))
    highs = highs[-min_len:]
    lows = lows[-min_len:]
    closes = closes[-min_len:]

    trs: List[float] = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)

    if not trs:
        return None
    if len(trs) < period:
        # لو البيانات أقل من period، نرجّع متوسط المتاح
        return round(sum(trs) / len(trs), 4)

    # Wilder's smoothing (canonical)
    atr = sum(trs[:period]) / period
    for i in range(period, len(trs)):
        atr = (atr * (period - 1) + trs[i]) / period
    return round(atr, 4)
