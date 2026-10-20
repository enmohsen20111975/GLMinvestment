"""
analyzers/indicators/vwap.py — Canonical VWAP (Volume Weighted Average Price)
=============================================================================
**Rule 67 — CALCULATION-CANONICAL**: ده المصدر الوحيد لحساب VWAP في المشروع.

الصيغة:
  typical_price[i] = (high[i] + low[i] + close[i]) / 3
  cumulative_typical × volume = sum(typical_price[i] × volume[i])
  cumulative_volume = sum(volume[i])
  VWAP = cumulative_typical_volume / cumulative_volume

السبب: كان فيه 6 implementations مختلفة (analyzers/support_resistance_calculator.py
+ analyzers/sniper_engine.py + analyzers/expert_quality_gate.py + analyzers/
volume_profile.py + analyzers/fusion_engine.py). كل واحدة بـ تحسب VWAP بطريقة
مختلفة (بعضها session-based، بعضها rolling، بعضها simple). ده كارثة في تحديد
السعر العادل.

المرجعية:
  - Rule 67 (00-CONSTITUTION.md)

الاستخدام:
  from analyzers.indicators import calc_vwap
  vwap = calc_vwap(highs, lows, closes, volumes)
  # أو rolling:
  vwap = calc_vwap(highs, lows, closes, volumes, period=20)
"""
from __future__ import annotations
from typing import Optional, List


def calc_vwap(highs: List[float], lows: List[float], closes: List[float],
              volumes: List[float], period: Optional[int] = None) -> Optional[float]:
    """حساب VWAP (Volume Weighted Average Price) — canonical.

    Args:
        highs: قمم الأسعار (آخرها في النهاية)
        lows: قيعان الأسعار (آخرها في النهاية)
        closes: إغلاقات الأسعار (آخرها في النهاية)
        volumes: أحجام التداول (آخرها في النهاية)
        period: لو None → VWAP للجلسة كاملة (cumulative).
                لو int → rolling VWAP آخر `period` بار.

    Returns:
        قيمة VWAP (float) أو None لو البيانات غير كافية.
        القيمة rounded لـ 4 أرقام عشرية.

    Notes:
        - VWAP = sum(typical_price × volume) / sum(volume)
        - typical_price = (high + low + close) / 3
        - لو cumulative_volume == 0 → بـ يرجّع None.
        - rolling mode: بياخد آخر `period` بار بس.
    """
    if not closes or not highs or not lows or not volumes:
        return None

    min_len = min(len(highs), len(lows), len(closes), len(volumes))
    if min_len == 0:
        return None

    highs = highs[-min_len:]
    lows = lows[-min_len:]
    closes = closes[-min_len:]
    volumes = volumes[-min_len:]

    if period is not None:
        if period <= 0:
            return None  # invalid period
        if min_len < period:
            return None
        highs = highs[-period:]
        lows = lows[-period:]
        closes = closes[-period:]
        volumes = volumes[-period:]

    cumulative_tpv = 0.0  # sum of typical_price × volume
    cumulative_volume = 0.0
    for i in range(len(closes)):
        typical_price = (highs[i] + lows[i] + closes[i]) / 3
        cumulative_tpv += typical_price * volumes[i]
        cumulative_volume += volumes[i]

    if cumulative_volume == 0:
        return None

    return round(cumulative_tpv / cumulative_volume, 4)


def calc_vwap_premium(closes: List[float], vwap: float) -> Optional[float]:
    """حساب VWAP Premium (مدى بُعد السعر عن VWAP) — canonical.

    Args:
        closes: إغلاقات الأسعار (آخرها في النهاية)
        vwap: قيمة VWAP المحسوبة مسبقاً

    Returns:
        VWAP premium % (float) أو None.
        - premium > 0 → السعر فوق VWAP (ضغط شرائي)
        - premium < 0 → السعر تحت VWAP (ضغط بيعي)
        القيمة rounded لـ 2 أرقام عشرية.
    """
    if not closes or vwap is None or vwap == 0:
        return None
    return round((closes[-1] - vwap) / vwap * 100, 2)
