"""
core/stock_rescue_engine.py — محرك إنقاذ السهم المحبوس
=======================================================
**BRAVO-OPERATIONAL**: لما يطلب المستخدم فحص سهم محبوس فيه بسعر شراء قديم.

المنطق:
- لو السهم FALLING_KNIFE أو MLR >= 0.85: نصيحة إعدام فورية.
- لو السهم لمس دعم وجفاف (Golden Dip): حساب نقطة التبريد المثالية + TP1 (+6.5%)
  لتقليل الخسارة والهروب في خلال 5 أيام.

Usage:
    from core.stock_rescue_engine import rescue_stock
    result = rescue_stock(ticker, buy_price, shares, daily_data, liquidity_result)
"""
from __future__ import annotations

import logging
from typing import List, Dict, Optional
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class RescueResult:
    """نتيجة محرك الإنقاذ."""
    ticker: str
    action: str  # 'KILL' | 'GOLDEN_DIP_RECOVERY' | 'HOLD_WAIT'
    current_price: float = 0.0
    buy_price: float = 0.0
    shares: float = 0.0
    loss_pct: float = 0.0  # نسبة الخسارة الحالية
    mlr: float = 0.0

    # للـ GOLDEN_DIP_RECOVERY فقط
    tp1_price: Optional[float] = None  # هدف التبريد (+6.5% من السعر الحالي)
    tp1_from_buy: Optional[float] = None  # TP1 كنسبة من سعر الشراء
    cooling_target: Optional[str] = None  # نقطة التبريد المثالية
    max_hold_days: int = 5
    trailing_stop_pct: float = 2.5

    # النصيحة بالعربي
    advice_ar: str = ''


def rescue_stock(
    ticker: str,
    buy_price: float,
    shares: float,
    daily_data: List[Dict],
    liquidity_result=None,  # LiquidityResult from real_liquidity_radar
) -> RescueResult:
    """فحص سهم محبوس وإعطاء نصيحة إنقاذ.

    Args:
        ticker: رمز السهم
        buy_price: سعر الشراء القديم
        shares: عدد الأسهم
        daily_data: بيانات يومية [{date, open, high, low, close, volume}, ...]
        liquidity_result: نتيجة محرك السيولة (optional)

    Returns:
        RescueResult with action + advice
    """
    if not daily_data or len(daily_data) < 5:
        return RescueResult(
            ticker=ticker, action='HOLD_WAIT', buy_price=buy_price,
            shares=shares, advice_ar='بيانات غير كافية لتحليل الإنقاذ.'
        )

    current_price = float(daily_data[-1].get('close', 0) or daily_data[-1].get('close_price', 0) or 0)
    if current_price <= 0:
        return RescueResult(
            ticker=ticker, action='HOLD_WAIT', buy_price=buy_price,
            shares=shares, advice_ar='سعر غير صالح.'
        )

    loss_pct = ((current_price - buy_price) / buy_price * 100) if buy_price > 0 else 0
    mlr = 0.0
    classification = ''
    if liquidity_result:
        mlr = liquidity_result.mlr
        classification = liquidity_result.classification

    result = RescueResult(
        ticker=ticker, action='HOLD_WAIT',
        current_price=round(current_price, 2),
        buy_price=round(buy_price, 2),
        shares=shares,
        loss_pct=round(loss_pct, 2),
        mlr=mlr,
    )

    # ── Case 1: FALLING_KNIFE or MLR >= 0.85 → إعدام فوري ──
    if classification == 'FALLING_KNIFE' or mlr >= 0.85:
        result.action = 'KILL'
        loss_amount = (buy_price - current_price) * shares
        result.advice_ar = (
            f"اخرج كاش واقطع الخسارة فوراً. "
            f"السهم في مسار هبوط حاد (MLR={mlr*100:.0f}%). "
            f"خسارتك الحالية: {loss_pct:.1f}% ({loss_amount:,.0f} جنيه). "
            f"الانتظار هيزيد الخسارة."
        )
        return result

    # ── Case 2: Golden Dip — لمس دعم + جفاف ──
    # شروط: السهم نزل تحت سعر الشراء بس لمس دعم + جفاف (DRY_EXPLOSION_READY or ACCUMULATION)
    is_golden_dip = (
        loss_pct < 0  # تحت سعر الشراء
        and classification in ('DRY_EXPLOSION_READY', 'ACCUMULATION_CONFIRMED')
    )

    if is_golden_dip:
        # حساب نقطة التبريد المثالية
        tp1_price = round(current_price * 1.065, 2)  # +6.5% من السعر الحالي
        tp1_from_buy_pct = ((tp1_price - buy_price) / buy_price * 100) if buy_price > 0 else 0

        result.action = 'GOLDEN_DIP_RECOVERY'
        result.tp1_price = tp1_price
        result.tp1_from_buy = round(tp1_from_buy_pct, 2)
        result.max_hold_days = 5
        result.trailing_stop_pct = 2.5
        result.cooling_target = (
            f"التبريد المثالي: بيع 50% عند {tp1_price} جنيه "
            f"(يرفع السعر {((tp1_price - current_price) / current_price * 100):.1f}% من الحالي، "
            f"ويعوض {tp1_from_buy_pct:.1f}% من سعر الشراء)"
        )

        if tp1_from_buy_pct >= 0:
            result.advice_ar = (
                f"السهم لمس دعم وفي حالة جفاف (Golden Dip). "
                f"فرصة تبريد: بيع نص الكمية عند {tp1_price} جنيه "
                f"(+6.5% من السعر الحالي). "
                f"ده هيغطي خسارتك ويطلعك رابح {tp1_from_buy_pct:.1f}% من سعر الشراء. "
                f"مدة الانتظار: 5 أيام تداول كحد أقصى. "
                f"وقف متحرك 2.5% تحت أعلى سعر."
            )
        else:
            # لو TP1 لسه تحت سعر الشراء → تقليل خسارة مش تعويض كامل
            result.advice_ar = (
                f"السهم لمس دعم وفي حالة جفاف (Golden Dip). "
                f"فرصة تقليل خسارة: بيع نص الكمية عند {tp1_price} جنيه "
                f"(+6.5% من السعر الحالي، لسه تحت سعر شرائك بـ {abs(tp1_from_buy_pct):.1f}%). "
                f"ده هيقلل خسارتك. "
                f"مدة الانتظار: 5 أيام تداول كحد أقصى."
            )
        return result

    # ── Case 3: HOLD_WAIT — لا إنقاذ ولا إعدام ──
    if loss_pct < 0:
        result.advice_ar = (
            f"السهم محبوس بخسارة {loss_pct:.1f}% بس مش في مسار هبوط حاد. "
            f"استنى تحسن الإشارات الفنية."
        )
    else:
        result.advice_ar = (
            f"السهم رابح {loss_pct:.1f}% من سعر الشراء. "
            f"فكر تأخذ ربحك."
        )
    return result
