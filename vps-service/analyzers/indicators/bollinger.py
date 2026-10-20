"""
analyzers/indicators/bollinger.py — Canonical Bollinger Bands
=============================================================
**Rule 67 — CALCULATION-CANONICAL**: ده المصدر الوحيد لحساب Bollinger Bands في المشروع.

الصيغة:
  middle = SMA(closes, period)
  std = standard deviation(closes[-period:])
  upper = middle + std_dev × std
  lower = middle - std_dev × std
  bandwidth = (upper - lower) / middle × 100
  percent_b = (close - lower) / (upper - lower) × 100

السبب: كان فيه 9 implementations مختلفة (engines/backtest_engine.py + engine/
historical_backfill_engine.py + jobs/crypto_lab_scheduler.py + api/chart_routes.py
+ scripts/backtest_sniper.py + scripts/backfill_with_personas.py + scripts/
egx_backtest/egx_sniper_backtest.py + ...). كل واحدة بترجع tuple مختلف. ده
كان بـ يخلق split-brain: نفس السهم بـ يطلع قيم Bollinger مختلفة في صفحات مختلفة.

المرجعية:
  - Rule 67 (00-CONSTITUTION.md)
  - Documentation/ENGINEERING_AUDIT_REPORT.md (Bug #8: Bollinger no canonical)

الاستخدام:
  from analyzers.indicators import calc_bollinger
  bb = calc_bollinger(closes, period=20, std_dev=2.0)
  if bb:
      print(bb['middle'], bb['upper'], bb['lower'], bb['bandwidth'], bb['percent_b'])
"""
from __future__ import annotations
from typing import Optional, List, Dict
import math


def calc_bollinger(closes: List[float], period: int = 20,
                   std_dev: float = 2.0) -> Optional[Dict[str, float]]:
    """حساب Bollinger Bands (canonical) — آخر قيمة.

    Args:
        closes: إغلاقات الأسعار (آخرها في النهاية)
        period: فترة SMA (default: 20 — Bollinger standard)
        std_dev: عدد الانحرافات المعيارية (default: 2.0)

    Returns:
        dict: {middle, upper, lower, bandwidth, percent_b} أو None لو البيانات غير كافية.
        - middle: SMA(closes, period)
        - upper: middle + std_dev × std
        - lower: middle - std_dev × std
        - bandwidth: (upper - lower) / middle × 100  (مدى التذبذب %)
        - percent_b: (close - lower) / (upper - lower) × 100  (موقع السعر %)
        القيم rounded لـ 4 أرقام عشرية.

    Notes:
        - population std (مش sample std) — لأن بناخد آخر `period` قيمة كاملة.
        - لو len(closes) < period → بـ يرجّع None.
        - لو middle == 0 (flat line) → bandwidth = 0, percent_b = 50.
    """
    if not closes or len(closes) < period:
        return None

    window = closes[-period:]
    middle = sum(window) / period
    variance = sum((x - middle) ** 2 for x in window) / period
    std = math.sqrt(variance)

    upper = middle + std_dev * std
    lower = middle - std_dev * std

    bandwidth = 0.0
    if middle != 0:
        bandwidth = (upper - lower) / middle * 100

    percent_b = 50.0
    if (upper - lower) != 0:
        percent_b = (closes[-1] - lower) / (upper - lower) * 100

    return {
        "middle": round(middle, 4),
        "upper": round(upper, 4),
        "lower": round(lower, 4),
        "bandwidth": round(bandwidth, 4),
        "percent_b": round(percent_b, 4),
    }


def calc_bollinger_series(closes: List[float], period: int = 20,
                          std_dev: float = 2.0) -> Optional[Dict[str, List[float]]]:
    """حساب Bollinger Bands (canonical) — series كاملة للرسوم البيانية.

    Args:
        closes: إغلاقات الأسعار (آخرها في النهاية)
        period: فترة SMA (default: 20)
        std_dev: عدد الانحرافات المعيارية (default: 2.0)

    Returns:
        dict: {middle: [...], upper: [...], lower: [...]} أو None لو البيانات غير كافية.
        القوائم بنفس طول closes (الـ NaN يتم تركها None للقيم غير المحسوبة).
    """
    if not closes or len(closes) < period:
        return None

    middle_series: List[Optional[float]] = [None] * len(closes)
    upper_series: List[Optional[float]] = [None] * len(closes)
    lower_series: List[Optional[float]] = [None] * len(closes)

    for i in range(period - 1, len(closes)):
        window = closes[i - period + 1: i + 1]
        mean = sum(window) / period
        variance = sum((x - mean) ** 2 for x in window) / period
        std = math.sqrt(variance)
        middle_series[i] = round(mean, 4)
        upper_series[i] = round(mean + std_dev * std, 4)
        lower_series[i] = round(mean - std_dev * std, 4)

    return {
        "middle": middle_series,
        "upper": upper_series,
        "lower": lower_series,
    }
