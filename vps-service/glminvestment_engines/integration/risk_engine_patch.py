"""
integration/risk_engine_patch.py — استبدال الوقف الثابت بالـ ATR
=================================================================
الهدف: استبدال stop_loss الثابت (-8% للمضارب، -12% للمستثمر)
       بوقف ديناميكي مبني على ATR.

لما ده مهم:
    -8% وقف على سهم ATR=1% → وقف بعيد جداً (مخاطرة زايدة)
    -8% وقف على سهم ATR=5% → وقف مضغوط جداً (هيتضرب بلا سبب)
    ATR بيحل المشكلة: الوقف = entry - (multiplier × ATR)

طريقة الاستخدام:
    في الـ code اللي بيأنشئ الصفقة، بدّل:
        stop_loss = entry * (1 - 0.08)  # ثابت
    بـ:
        from engines.atr_risk_engine import compute_risk_plan
        plan = compute_risk_plan(df, entry, persona, account_size)
        stop_loss = plan.stop_loss
        position_size = plan.shares  # بدل ما تخمّن الحجم
"""
from __future__ import annotations

from typing import Optional

import pandas as pd

from ..engines.atr_risk_engine import compute_risk_plan, ATRRiskConfig
from ..engines.take_profit_tiers import (
    evaluate_position, position_from_risk_plan, TakeProfitConfig,
)
from ..core.base import RiskPlan, Position


# ──────────────────────────────────────────────────────────────────────────
# عند إنشاء صفقة جديدة — استبدال الوقف الثابت
# ──────────────────────────────────────────────────────────────────────────

def create_trade_with_atr(
    df: pd.DataFrame,
    symbol: str,
    entry_price: float,
    persona: str,           # "scalper" | "investor"
    account_size: float,
    config: Optional[ATRRiskConfig] = None,
) -> dict:
    """
    أنشئ صفقة بخطة مخاطر ATR كاملة.

    BEFORE:
        trade = {
            'symbol': symbol,
            'entry': entry_price,
            'stop_loss': entry_price * 0.92,   # -8% ثابت
            'shares': 100,                      # حجم ثابت
            'persona': persona,
        }

    AFTER:
        trade = create_trade_with_atr(df, symbol, entry_price, persona, account_size)
        # trade فيه: entry, stop_loss (ديناميكي), shares (محسوب),
        #           take_profit_tiers (1R/2R/3R), risk_per_share, ...
    """
    plan = compute_risk_plan(df, entry_price, persona, account_size, config)

    return {
        "symbol": symbol,
        "entry_price": plan.entry_price,
        "stop_loss": round(plan.stop_loss, 4),
        "stop_pct": round((plan.entry_price - plan.stop_loss) / plan.entry_price, 4),
        "shares": plan.shares,
        "position_size_pct": round(plan.position_size_pct, 4),
        "risk_per_share": round(plan.risk_per_share, 4),
        "risk_reward_ratio": plan.risk_reward_ratio,
        "take_profit_tiers": [
            {
                "label": t.label,
                "price": round(t.price, 4),
                "fraction": round(t.fraction, 4),
                "reason": t.reason,
            }
            for t in plan.take_profit_tiers
        ],
        "trailing_method": plan.trailing_stop_method,
        "persona": persona,
        # احتفظ بالـ plan object للـ position management بعدين
        "_risk_plan": plan,
    }


# ──────────────────────────────────────────────────────────────────────────
# إدارة الصفقة بعد الفتح — Take Profit Tiers
# ──────────────────────────────────────────────────────────────────────────

def check_open_position(
    trade: dict,
    df: pd.DataFrame,
    entry_date,
    config: Optional[TakeProfitConfig] = None,
) -> dict:
    """
    فحص صفقة مفتوحة — هل نبيع جزء؟ نحدّث الوقف؟ نخرج؟

    يُستدعى في كل دورة من background_analyzer لكل صفقة مفتوحة.

    Returns:
        dict بـ: action, sell_fraction, new_stop, target_price, reason
    """
    plan: RiskPlan = trade.get("_risk_plan")
    if plan is None:
        return {
            "action": "ERROR",
            "reason": "trade._risk_plan not found — use create_trade_with_atr() first",
        }

    # أنشئ Position object (أو استخدم cached version)
    position = position_from_risk_plan(plan, trade["symbol"], entry_date, trade.get("shares"))

    # قيّم القرار
    decision = evaluate_position(position, df, config)

    return {
        "action": decision.action.value,
        "sell_fraction": decision.sell_fraction,
        "new_stop_loss": decision.new_stop_loss,
        "target_price": decision.target_price,
        "reason": decision.reason,
        "metadata": decision.metadata,
    }


# ──────────────────────────────────────────────────────────────────────────
# Quick migration helper — للـ code القديم اللي بيستخدم stop_loss ثابت
# ──────────────────────────────────────────────────────────────────────────

def migrate_fixed_stop_to_atr(
    old_trade: dict,
    df: pd.DataFrame,
    account_size: float,
) -> dict:
    """
    رحّل صفقة قديمة (وقف ثابت) لـ ATR risk plan.

    useful لو عندك صفقات مفتوحة بالوقف القديم وعايز تحوّلها.
    """
    entry = old_trade["entry_price"]
    symbol = old_trade.get("symbol", "UNKNOWN")
    persona = old_trade.get("persona", "investor")

    new_plan = compute_risk_plan(df, entry, persona, account_size)

    # خد الوقف الأضيق (الأكثر تحفظاً) من القديم والجديد
    old_stop = old_trade.get("stop_loss", entry * 0.88)
    new_stop = max(old_stop, new_plan.stop_loss)  # أقرب للدخول = أأمن

    return {
        **old_trade,
        "stop_loss": round(new_stop, 4),
        "stop_pct": round((entry - new_stop) / entry, 4),
        "take_profit_tiers": [
            {"label": t.label, "price": round(t.price, 4), "fraction": round(t.fraction, 4)}
            for t in new_plan.take_profit_tiers
        ],
        "_risk_plan": new_plan,
        "migrated_from_fixed": True,
        "old_stop_loss": old_stop,
    }
