"""
utils/position_sizing.py — Canonical Position Sizing (Risk-Based)
==================================================================
**Rule 67 — CALCULATION-CANONICAL**: ده المصدر الوحيد لحساب حجم المركز في المشروع.

الصيغة (risk-based):
  risk_per_share = entry - stop  (BUY) أو stop - entry (SELL)
  risk_amount = capital × risk_pct / 100
  position_size = risk_amount / risk_per_share
  position_value = position_size × entry
  position_pct = position_value / capital × 100

السبب: كان فيه 10+ inline implementations مختلفة (risk_management_advanced.py +
utils/shared_liquidity.py + api/portfolio_routes.py + api/risk_routes.py + config/
unified_config.py + analyzers/crypto_circuit.py + analyzers/v68_oracle.py + analyzers/
crypto_maestro.py + analyzers/position_sizing.py + analyzers/risk.py). كل واحدة بـ
تحسب حجم المركز بطريقة مختلفة. ده كارثة في إدارة المخاطر.

ملاحظة:
  - analyzers/position_sizing.py لسه موجود بس ده volatility multiplier إضافي
    (مش canonical). بـ يضرب في حجم الصفقة المحسوب من هنا.
  - Rule 19: hard_loss_ceiling = 7% (مش بلمسها هنا).
  - Rule 8: ATR stop في [5%, 9%] (مش بلمسها هنا).

المرجعية:
  - Rule 67 (00-CONSTITUTION.md)
  - Rule 11: engine_settings.py = canonical للعتبات
  - Documentation/ENGINEERING_AUDIT_REPORT.md (Bug #3: position sizing no canonical)

الاستخدام:
  from utils.position_sizing import calculate_risk_based_position
  result = calculate_risk_based_position(
      capital=10000, entry=100, stop=94, risk_pct=2.0
  )
  # result = {position_size, position_value, position_pct, risk_amount, shares}
"""
from __future__ import annotations
from typing import Optional, Dict
import os


def calculate_risk_based_position(
    capital: float,
    entry: float,
    stop: float,
    risk_pct: Optional[float] = None,
    direction: str = "BUY",
    max_position_pct: float = 25.0,
    volatility_multiplier: float = 1.0,
) -> Optional[Dict[str, float]]:
    """حساب حجم المركز بناءً على المخاطرة (canonical).

    Args:
        capital: رأس المال الإجمالي
        entry: سعر الدخول
        stop: سعر وقف الخسارة
        risk_pct: نسبة المخاطرة من رأس المال (default: from engine_settings أو 2.0)
        direction: "BUY" أو "SELL"
        max_position_pct: أقصى نسبة للمركز من رأس المال (default: 25%)
        volatility_multiplier: عامل تقلب (من analyzers/position_sizing.py) — يقلل الحجم لو التقلب عالي

    Returns:
        dict: {position_size, position_value, position_pct, risk_amount, risk_per_share, shares}
        أو None لو البيانات غير صالحة.
        - position_size: عدد الأسهم
        - position_value: قيمة المركز بالمال
        - position_pct: نسبة المركز من رأس المال %
        - risk_amount: المبلغ المخاطر بيه
        - risk_per_share: المخاطرة لكل سهم
        - shares = position_size (alias)
    """
    if capital <= 0 or entry <= 0 or stop <= 0:
        return None

    # risk_pct default from env أو 2.0
    if risk_pct is None:
        risk_pct = float(os.environ.get("V40_2_DEFAULT_RISK_PCT", "2.0"))

    # risk_per_share (BUY: entry > stop, SELL: stop > entry)
    if direction.upper() == "BUY":
        if stop >= entry:
            return None  # invalid: stop must be below entry for BUY
        risk_per_share = entry - stop
    else:  # SELL
        if stop <= entry:
            return None  # invalid: stop must be above entry for SELL
        risk_per_share = stop - entry

    if risk_per_share <= 0:
        return None

    # risk_amount = capital × risk_pct / 100
    risk_amount = capital * risk_pct / 100.0

    # position_size = risk_amount / risk_per_share × volatility_multiplier
    raw_position_size = risk_amount / risk_per_share
    position_size = raw_position_size * volatility_multiplier

    # position_value = position_size × entry
    position_value = position_size * entry

    # position_pct = position_value / capital × 100
    position_pct = position_value / capital * 100.0

    # cap at max_position_pct
    if position_pct > max_position_pct:
        # reduce position_size to respect max_position_pct
        position_value = capital * max_position_pct / 100.0
        position_size = position_value / entry
        position_pct = max_position_pct
        # risk_amount يقلل نسبياً
        risk_amount = position_size * risk_per_share

    return {
        "position_size": round(position_size, 4),
        "position_value": round(position_value, 2),
        "position_pct": round(position_pct, 2),
        "risk_amount": round(risk_amount, 2),
        "risk_per_share": round(risk_per_share, 4),
        "shares": round(position_size, 4),  # alias
    }


def calculate_kelly_position(
    win_rate: float,
    win_loss_ratio: float,
    capital: float,
    kelly_fraction: float = 0.5,
    max_position_pct: float = 25.0,
    entry: Optional[float] = None,
) -> Optional[Dict[str, float]]:
    """حساب حجم المركز بناءً على Kelly Criterion (canonical).

    Kelly % = win_rate - (1 - win_rate) / win_loss_ratio
   Kelly Fraction = Kelly % × kelly_fraction (مثلاً 0.5 = Half Kelly)

    Args:
        win_rate: نسبة الفوز (0-1)
        win_loss_ratio: reward/risk ratio (مثلاً 2.0)
        capital: رأس المال
        kelly_fraction: نسبة Kelly (0.5 = Half Kelly, 1.0 = Full Kelly)
        max_position_pct: أقصى نسبة للمركز
        entry: سعر الدخول (لو متاح — بـ يسمح بحساب position_size كـ shares)

    Returns:
        dict: {kelly_pct, position_pct, position_value, position_size}
        أو None لو البيانات غير صالحة.
        - position_size: قيمة المركز بالمال لو entry=None، عدد الأسهم لو entry متاح.
        - position_value: قيمة المركز بالمال (دائماً).
    """
    if not (0 <= win_rate <= 1) or win_loss_ratio <= 0 or capital <= 0:
        return None

    kelly_pct = win_rate - (1 - win_rate) / win_loss_ratio
    if kelly_pct <= 0:
        return None  # negative edge → no position

    position_pct = kelly_pct * kelly_fraction * 100  # to percentage

    # cap at max_position_pct
    if position_pct > max_position_pct:
        position_pct = max_position_pct

    position_value = capital * position_pct / 100.0

    # position_size: shares لو entry متاح، value لو entry=None
    if entry is not None and entry > 0:
        position_size = position_value / entry
    else:
        position_size = position_value

    return {
        "kelly_pct": round(kelly_pct * 100, 2),
        "position_pct": round(position_pct, 2),
        "position_value": round(position_value, 2),
        "position_size": round(position_size, 4),
    }
