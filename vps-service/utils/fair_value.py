"""
utils/fair_value.py — Canonical Fair Value Calculations
========================================================
**Rule 67 — CALCULATION-CANONICAL**: ده المصدر الوحيد لحساب القيمة العادلة في المشروع.

في نوعين من fair_value:

1. **Fundamental Fair Value** (calc_fundamental_fair_value):
   - Primary: max(PE × EPS, book_value_per_share × 1.5)
   - Fallback 1: derive bvps from pb_ratio → bvps × 1.5
   - Fallback 2: ma_200 as long-term fair value proxy
   - الاستخدام: valuation screens (screener, stock analysis)

2. **VWAP-based Fair Value** (calc_vwap_fair_value):
   - fair_value = sum(typical_price × volume) / sum(volume)
   - fair_premium = ((close - fair_value) / fair_value) × 100
   - الاستخدام: backtest engines, maker state detection

السبب: كان فيه 3+ inline implementations مختلفة (api/stocks.py + engines/
backtest_engine.py + analyzers/persona_investor.py) بـ APIs ومنطق مختلف.
ده كارثة في تحديد القيمة العادلة.

المرجعية:
  - Rule 67 (00-CONSTITUTION.md)
  - Documentation/ENGINEERING_AUDIT_REPORT.md (Bug #10: fair_value no canonical)

الاستخدام:
  from utils.fair_value import calc_fundamental_fair_value, calc_vwap_fair_value
  fv = calc_fundamental_fair_value(pe_ratio=15, eps=2.5, book_value_per_share=20)
  fv, premium = calc_vwap_fair_value(highs, lows, closes, volumes, period=100)
"""
from __future__ import annotations
from typing import Optional, Tuple, List


def _to_float(val) -> Optional[float]:
    """Convert لـ float مع None fallback."""
    if val is None:
        return None
    try:
        f = float(val)
        return f if f == f else None  # NaN check
    except (ValueError, TypeError):
        return None


def calc_fundamental_fair_value(
    pe_ratio: Optional[float] = None,
    eps: Optional[float] = None,
    book_value_per_share: Optional[float] = None,
    current_price: Optional[float] = None,
    pb_ratio: Optional[float] = None,
    ma_200: Optional[float] = None,
) -> Optional[float]:
    """حساب Fundamental Fair Value (canonical).

    Primary: max(PE × EPS, book_value_per_share × 1.5)
    Fallbacks:
      1. derive bvps from pb_ratio → bvps × 1.5
      2. ma_200 as long-term fair value proxy

    Args:
        pe_ratio: P/E ratio
        eps: Earnings Per Share
        book_value_per_share: Book Value Per Share
        current_price: current stock price (for pb_ratio fallback)
        pb_ratio: Price/Book ratio (for bvps derivation)
        ma_200: 200-day Moving Average (long-term fair value proxy)

    Returns:
        Fair value (float) أو None لو مفيش بيانات كافية. Rounded لـ 4 أرقام.
    """
    pe = _to_float(pe_ratio)
    eps_v = _to_float(eps)
    bvps = _to_float(book_value_per_share)
    cp = _to_float(current_price)
    pb = _to_float(pb_ratio)
    ma2 = _to_float(ma_200)

    pe_estimate = (pe * eps_v) if (pe and pe > 0 and eps_v and eps_v > 0) else None
    bv_estimate = (bvps * 1.5) if (bvps and bvps > 0) else None
    pb_estimate = None
    if bv_estimate is None and pb and pb > 0 and cp and cp > 0:
        derived_bvps = cp / pb
        pb_estimate = derived_bvps * 1.5
    ma_estimate = ma2 if (ma2 and ma2 > 0) else None

    candidates = [v for v in (pe_estimate, bv_estimate, pb_estimate, ma_estimate)
                  if v is not None and v > 0]
    if not candidates:
        return None
    # BRAVO FIX: استخدم median بدل max — max بيـ magnify الـ outliers (PE عالي = fair_value مبالغ)
    # median أكثر conservative + representative للقيمة العادلة الحقيقية
    import statistics
    return round(statistics.median(candidates), 4)


def calc_upside_percent(fair_value: Optional[float],
                        current_price: Optional[float]) -> Optional[float]:
    """حساب upside_percent = ((fair_value - current_price) / current_price) × 100.

    Args:
        fair_value: القيمة العادلة
        current_price: السعر الحالي

    Returns:
        upside % (float) أو None. rounded لـ 2 رقم.
        - positive → السهم تحت القيمة العادلة (فرصة شراء)
        - negative → السهم فوق القيمة العادلة (غالٍ)
    """
    fv = _to_float(fair_value)
    cp = _to_float(current_price)
    if fv is None or cp is None or cp == 0:
        return None
    return round((fv - cp) / cp * 100, 2)


def calc_vwap_fair_value(
    highs: List[float],
    lows: List[float],
    closes: List[float],
    volumes: List[float],
    period: int = 100,
) -> Tuple[float, float]:
    """حساب VWAP-based Fair Value (canonical) — للـ backtest engines.

    fair_value = sum(typical_price × volume) / sum(volume)
    fair_premium = ((close - fair_value) / fair_value) × 100

    Args:
        highs: قمم الأسعار
        lows: قيعان الأسعار
        closes: إغلاقات الأسعار
        volumes: أحجام التداول
        period: فترة الحساب (default: 100)

    Returns:
        (fair_value, fair_premium):
        - fair_value: VWAP-based fair value
        - fair_premium: مدى بُعد السعر عن fair_value %
        Rule 27 (NO-FAKE-DATA): لو مفيش بيانات أو volume=0 → بيرجّع (None, None).
    """
    if not closes or not highs or not lows or not volumes:
        return None, None

    n = min(period, len(closes))
    if n == 0:
        return None, None

    # ناخد آخر n بار
    h_slice = highs[-n:]
    l_slice = lows[-n:]
    c_slice = closes[-n:]
    v_slice = volumes[-n:]

    total_vol = sum(v_slice)
    if total_vol <= 0:
        return None, None

    typical_prices = [(h_slice[i] + l_slice[i] + c_slice[i]) / 3 for i in range(n)]
    weighted = sum(typical_prices[i] * v_slice[i] for i in range(n))

    fv = weighted / total_vol
    if fv <= 0:
        return None, None
    premium = ((closes[-1] - fv) / fv) * 100

    return round(fv, 4), round(premium, 4)
