"""
analyzers/indicators/mfi.py — Canonical MFI (Money Flow Index)
==============================================================
**Rule 67 — CALCULATION-CANONICAL**: ده المصدر الوحيد لحساب MFI في المشروع.

الصيغة:
  typical_price[i] = (high[i] + low[i] + close[i]) / 3
  raw_money_flow[i] = typical_price[i] × volume[i]
  لو typical_price[i] > typical_price[i-1] → positive flow
  لو typical_price[i] < typical_price[i-1] → negative flow
  لو typical_price[i] == typical_price[i-1] → neutral (مش بيحسب في أي طرف)
  sum_positive = sum(positive flows over period)
  sum_negative = sum(negative flows over period)
  money_ratio = sum_positive / sum_negative
  MFI = 100 - 100 / (1 + money_ratio)

السبب: MFI هو RSI المُعدّل بالحجم (volume-weighted RSI). كان فيه implementation
واحد بس (analyzers/quant_overdrive.py::calculate_smfi). لازم canonical عشان أي
محرك جديد يستخدمه يبقى متسق.

المرجعية:
  - Rule 67 (00-CONSTITUTION.md)
  - Gene Quong & Avrum Soudack (1989) — MFI original paper

الاستخدام:
  from analyzers.indicators import calc_mfi
  mfi = calc_mfi(highs, lows, closes, volumes, period=14)
"""
from __future__ import annotations
from typing import Optional, List


def calc_mfi(highs: List[float], lows: List[float], closes: List[float],
             volumes: List[float], period: int = 14) -> Optional[float]:
    """حساب MFI (Money Flow Index) — canonical.

    Args:
        highs: قمم الأسعار (آخرها في النهاية)
        lows: قيعان الأسعار (آخرها في النهاية)
        closes: إغلاقات الأسعار (آخرها في النهاية)
        volumes: أحجام التداول (آخرها في النهاية)
        period: فترة MFI (default: 14 — Quong & Soudack standard)

    Returns:
        قيمة MFI (0-100) أو None لو البيانات غير كافية.
        القيمة rounded لـ 2 أرقام عشرية.

    Notes:
        - MFI = 100 - 100 / (1 + money_ratio)
        - لو sum_negative == 0 → بـ يرجّع 100.0 (أعلى ضغط شرائي)
        - لو sum_positive == 0 → بـ يرجّع 0.0 (أعلى ضغط بيعي)
        - لو len(data) < period + 1 → بـ يرجّع None
        - MFI > 80 → overbought, MFI < 20 → oversold
    """
    if not closes or len(closes) < period + 1:
        return None
    if not highs or not lows or not volumes:
        return None

    # ضمان إن كل القوائم بنفس الطول
    min_len = min(len(highs), len(lows), len(closes), len(volumes))
    highs = highs[-min_len:]
    lows = lows[-min_len:]
    closes = closes[-min_len:]
    volumes = volumes[-min_len:]

    if len(closes) < period + 1:
        return None

    # Typical prices
    typical_prices = [
        (highs[i] + lows[i] + closes[i]) / 3
        for i in range(len(closes))
    ]

    # Raw money flows
    raw_flows = [typical_prices[i] * volumes[i] for i in range(len(closes))]

    # Positive / negative flows over last `period` changes
    positive_flow = 0.0
    negative_flow = 0.0
    # نأخذ آخر `period` فترات (من i-period إلى i-1 مقارنة بـ i)
    for i in range(len(typical_prices) - period, len(typical_prices)):
        if i < 1:
            continue
        if typical_prices[i] > typical_prices[i - 1]:
            positive_flow += raw_flows[i]
        elif typical_prices[i] < typical_prices[i - 1]:
            negative_flow += raw_flows[i]
        # neutral → لا يحسب في أي طرف

    if negative_flow == 0:
        return 100.0
    if positive_flow == 0:
        return 0.0

    money_ratio = positive_flow / negative_flow
    return round(100 - 100 / (1 + money_ratio), 2)
