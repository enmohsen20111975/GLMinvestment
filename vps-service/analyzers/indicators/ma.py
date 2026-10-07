"""
analyzers/indicators/ma.py — Canonical Moving Averages (SMA + EMA + MACD)
==========================================================================
**Rule 54 — CALCULATION-CANONICAL**: ده المصدر الوحيد لحساب SMA/EMA/MACD في المشروع.

الـ canonical functions:
  - sma(data, period)      — Simple Moving Average = sum(data[-period:]) / period
  - ema(data, period)      — Exponential Moving Average (recursive)
  - macd(closes, 12, 26, 9) — MACD line + signal + histogram

الأسباب:
  - SMA بسيط: sum / period
  - EMA recursive: `ema = (price - ema_prev) × k + ema_prev` where `k = 2 / (period + 1)`
  - MACD = EMA(12) - EMA(26), signal = EMA(MACD, 9)

المرجعية:
  - Rule 54 (00-CONSTITUTION.md)
  - Documentation/ENGINEERING_AUDIT_REPORT.md (Bug #9: SMA200 = EMA200 mislabeled)
  - النسخة الأصلية: analyzers/technical_analyzer.py:56-134 (الصحيحة)

الاستخدام:
  from analyzers.indicators import sma, ema, macd
  s50 = sma(closes, 50)
  e12 = ema(closes, 12)
  m = macd(closes)  # {line, signal, histogram}
"""
from __future__ import annotations
from typing import Optional, List, Dict


def sma(data: List[float], period: int) -> Optional[float]:
    """Simple Moving Average = sum(data[-period:]) / period (canonical).

    Args:
        data: قائمة القيم (آخرها في النهاية)
        period: فترة المتوسط

    Returns:
        قيمة SMA أو None لو البيانات غير كافية. Rounded لـ 4 أرقام.
    """
    if not data or len(data) < period:
        return None
    return round(sum(data[-period:]) / period, 4)


def ema(data: List[float], period: int) -> Optional[float]:
    """Exponential Moving Average — recursive (canonical).

    الصيغة:
      k = 2 / (period + 1)
      ema_initial = SMA(data[:period])
      ema[i] = (data[i] - ema[i-1]) × k + ema[i-1]

    Args:
        data: قائمة القيم (آخرها في النهاية)
        period: فترة EMA

    Returns:
        قيمة EMA الأخيرة أو None لو البيانات غير كافية. Rounded لـ 4 أرقام.
    """
    if not data or len(data) < period:
        return None
    k = 2 / (period + 1)
    # Initial EMA = SMA of first `period` values
    ema_val = sum(data[:period]) / period
    for price in data[period:]:
        ema_val = (price - ema_val) * k + ema_val
    return round(ema_val, 4)


def macd(closes: List[float], fast: int = 12, slow: int = 26,
         signal_period: int = 9) -> Optional[Dict[str, float]]:
    """MACD (Moving Average Convergence Divergence) — canonical.

    الصيغة:
      MACD line = EMA(fast) - EMA(slow)
      Signal line = EMA(MACD line series, signal_period)
      Histogram = MACD - Signal

    Args:
        closes: إغلاقات الأسعار
        fast: فترة EMA السريعة (default: 12)
        slow: فترة EMA البطيئة (default: 26)
        signal_period: فترة EMA للـ signal line (default: 9)

    Returns:
        dict: {line, signal, histogram} أو None لو البيانات غير كافية.
        القيم rounded لـ 4 أرقام.
    """
    if not closes or len(closes) < slow + signal_period:
        return None

    # Compute MACD line series (for signal line calculation)
    k_fast = 2 / (fast + 1)
    k_slow = 2 / (slow + 1)
    ema_fast_val = sum(closes[:fast]) / fast
    ema_slow_val = sum(closes[:slow]) / slow
    macd_line_series: List[float] = []

    for i, price in enumerate(closes):
        if i >= fast - 1:
            ema_fast_val = (price - ema_fast_val) * k_fast + ema_fast_val
        if i >= slow - 1:
            ema_slow_val = (price - ema_slow_val) * k_slow + ema_slow_val
        if i >= slow - 1:
            macd_line_series.append(ema_fast_val - ema_slow_val)

    if not macd_line_series:
        return None

    # Signal line = EMA of MACD line series
    if len(macd_line_series) < signal_period:
        return None

    k_signal = 2 / (signal_period + 1)
    signal_val = sum(macd_line_series[:signal_period]) / signal_period
    for val in macd_line_series[signal_period:]:
        signal_val = (val - signal_val) * k_signal + signal_val

    macd_line = macd_line_series[-1]
    return {
        "line": round(macd_line, 4),
        "signal": round(signal_val, 4),
        "histogram": round(macd_line - signal_val, 4),
    }
