"""
engines/take_profit_tiers.py — جني الأرباح التدريجي
=====================================================
المصدر: Mark Douglas — "Trading in the Zone" + "The Disciplined Trader"

الفلسفة:
    دوجلاس بيقول: "التداول لعبة احتمالات." تنفيذ الآلة بلا مشاعر.
    لما السعر يتحرك لصالحك:
      1) بِع ثلث المركز بمجرد ما توصل 1R (مخاطرة واحدة) ← "free trade"
      2) حرّك الوقف لـ breakeven ← مفيش خسارة ممكنة بعد كده
      3) بِع ثلث ثاني عند 2R ← تأمين الربح
      4) الباقي (ثلث) سيبه يركض بـ trailing stop ← للهدف الكبير

    السيكولوجيا: لما تاخد جزء من الربح، عقلك يهدا، وتبقى قادر
    تسيب الباقي يتحرك بدون توتر. ده سر الـ "Zone".

    محرك ده بيشتغل على الصفقات المفتوحة (position management)،
    مش إشارات دخول. بيقرر: HOLD / SELL_TIER / TRAIL / EXIT.

ملاحظة:
    الـ tiers الأصلية بتنشاء في ATR Risk Engine عند الدخول.
    المحرك ده بينفّذها وقت التشغيل بناءً على السعر الحالي.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from enum import Enum
from typing import Optional

import pandas as pd

from core.base import Position, RiskPlan, TakeProfitTier
from core.indicators import atr, donchian_channels


# ──────────────────────────────────────────────────────────────────────────
# Action types
# ──────────────────────────────────────────────────────────────────────────

class PositionAction(str, Enum):
    """الإجراء المطلوب على صفقة مفتوحة."""
    HOLD = "HOLD"                      # امسك — لسه مبوصلش لـ tier
    SELL_TIER_1 = "SELL_TIER_1"        # بِع ثلث عند 1R + حرّك الوقف لـ BE
    SELL_TIER_2 = "SELL_TIER_2"        # بِع ثلث عند 2R
    UPDATE_TRAILING = "UPDATE_TRAILING"  # حدّث الوقف المتحرك للثلث الأخير
    EXIT_STOP = "EXIT_STOP"            # خرج على الوقف (خسارة)
    EXIT_TARGET = "EXIT_TARGET"        # خرج على الهدف النهائي
    EXIT_FINAL = "EXIT_FINAL"          # أغلق كل المركز الباقي


@dataclass
class ManagementDecision:
    """قرار إدارة الصفقة."""
    action: PositionAction
    sell_fraction: float           # نسبة المركز للبيع (0 = لا شيء)
    new_stop_loss: Optional[float] = None  # الوقف الجديد (لو اتحدّث)
    target_price: Optional[float] = None   # السعر المطلوب للبيع (للـ tiers)
    reason: str = ""
    metadata: dict = None

    def __post_init__(self) -> None:
        if self.metadata is None:
            self.metadata = {}


@dataclass(frozen=True)
class TakeProfitConfig:
    """إعدادات إدارة جني الأرباح."""
    atr_period: int = 14
    trailing_atr_multiplier: float = 2.5  # الوقف المتحرك = highest - 2.5×ATR
    donchian_exit_period: int = 10        # خروج لو كسر أدنى 10 يوم
    # الحد الأدنى للربح قبل تحريك الوقف لـ breakeven
    breakeven_trigger_r: float = 1.0      # عند 1R حرّك الوقف لـ BE
    # الهدف النهائي (لو السعر وصل، أغلق كل شيء)
    final_target_r: float = 3.0           # عند 3R اغلق الباقي


# ──────────────────────────────────────────────────────────────────────────
# Core management function
# ──────────────────────────────────────────────────────────────────────────

def evaluate_position(
    position: Position,
    df: pd.DataFrame,
    config: Optional[TakeProfitConfig] = None,
) -> ManagementDecision:
    """
    قيّم صفقة مفتوحة وقرر الإجراء المطلوب.

    Args:
        position: الصفقة المفتوحة (entry, stop, remaining_fraction, ...)
        df: OHLCV DataFrame محدّث
        config: إعدادات

    Returns:
        ManagementDecision بـ: action, sell_fraction, new_stop_loss, reason
    """
    cfg = config or TakeProfitConfig()

    if len(df) < cfg.atr_period + 1:
        return ManagementDecision(
            action=PositionAction.HOLD,
            sell_fraction=0.0,
            reason="بيانات غير كافية للحكم",
        )

    # السعر الحالي + بيانات السوق
    current_close = float(df["close"].iloc[-1])
    current_high = float(df["high"].iloc[-1])
    current_low = float(df["low"].iloc[-1])

    # حدّث أعلى سعر منذ الدخول
    position.update_high(current_high)

    # الـ R = المخاطرة لكل سهم (entry - stop الأصلي)
    r_value = position.risk_per_share
    if r_value <= 0:
        return ManagementDecision(
            action=PositionAction.HOLD,
            sell_fraction=0.0,
            reason="risk_per_share غير صالح",
        )

    # الربح الحالي بالـ R
    profit_r = (current_close - position.entry_price) / r_value

    # ── 1) فحص الوقف (خسارة) ──
    if current_low <= position.stop_loss:
        return ManagementDecision(
            action=PositionAction.EXIT_STOP,
            sell_fraction=position.remaining_fraction,
            new_stop_loss=position.stop_loss,
            reason=(
                f"السعر لمس الوقف ({position.stop_loss:.4f}). "
                f"خرج بالكامل. خسارة = {r_value:.4f} للسهم."
            ),
            metadata={"exit_price": position.stop_loss, "profit_r": -1.0},
        )

    # ── 2) الهدف النهائي (3R) — أغلق كل شيء ──
    final_target = position.entry_price + cfg.final_target_r * r_value
    if current_close >= final_target and position.remaining_fraction > 0.0:
        return ManagementDecision(
            action=PositionAction.EXIT_FINAL,
            sell_fraction=position.remaining_fraction,
            target_price=final_target,
            reason=(
                f"السعر وصل الهدف النهائي ({cfg.final_target_r}R = {final_target:.4f}). "
                f"أغلق الباقي ({position.remaining_fraction:.0%})."
            ),
            metadata={"exit_price": final_target, "profit_r": cfg.final_target_r},
        )

    # ── 3) Tier 1: بيع ثلث عند 1R + تحريك الوقف لـ breakeven ──
    #    يشتغل بس لما المركز لسه كامل (remaining > 2/3) — يعني ما بعناش Tier 1 قبل كده.
    tier1_price = position.entry_price + cfg.breakeven_trigger_r * r_value
    if (current_close >= tier1_price
            and position.remaining_fraction > 2.0 / 3.0 + 0.01):
        return ManagementDecision(
            action=PositionAction.SELL_TIER_1,
            sell_fraction=1.0 / 3.0,
            new_stop_loss=position.entry_price,  # حرّك الوقف لـ breakeven
            target_price=tier1_price,
            reason=(
                f"وصلنا 1R ({tier1_price:.4f}). بِع ثلث المركز + "
                f"حرّك الوقف لـ breakeven ({position.entry_price:.4f}). "
                f"الباقي = trade مجاني."
            ),
            metadata={"tier": 1, "profit_r": 1.0, "new_remaining": 2.0 / 3.0},
        )

    # ── 4) Tier 2: بيع ثلث عند 2R ──
    #    يشتغل لما المركز = ثلثين (بعد Tier 1) وقبل ما يبقى ثلث (قبل Tier 3).
    tier2_price = position.entry_price + 2.0 * r_value
    if (current_close >= tier2_price
            and position.remaining_fraction > 1.0 / 3.0 + 0.01
            and position.remaining_fraction <= 2.0 / 3.0 + 0.01):
        return ManagementDecision(
            action=PositionAction.SELL_TIER_2,
            sell_fraction=1.0 / 3.0,
            target_price=tier2_price,
            reason=(
                f"وصلنا 2R ({tier2_price:.4f}). بِع ثلث ثاني — تأمين الربح. "
                f"الباقي = ثلث بـ trailing stop."
            ),
            metadata={"tier": 2, "profit_r": 2.0, "new_remaining": 1.0 / 3.0},
        )

    # ── 5) Trailing stop للثلث الأخير ──
    if position.remaining_fraction <= 1.0 / 3.0 + 0.01 and position.highest_price_since_entry > 0:
        atr_value = float(atr(df, cfg.atr_period).iloc[-1])
        if not math.isnan(atr_value) and atr_value > 0:
            # الوقف المتحرك = أعلى سعر - (multiplier × ATR)
            trailing_stop = position.highest_price_since_entry - cfg.trailing_atr_multiplier * atr_value
            # الوقف ما يرجّعش لورا (ratchet up only)
            new_stop = max(position.stop_loss, trailing_stop)

            # كمان فحص خروج دونشيان (أدنى 10 يوم)
            dc = donchian_channels(df, exit_period=cfg.donchian_exit_period)
            dc_exit = float(dc["dc_exit_low"].iloc[-1])
            if not math.isnan(dc_exit):
                # لو دونشيان أعلى من الـ ATR trailing، استخدمه (أكثر تحفظاً)
                new_stop = max(new_stop, dc_exit)

            if new_stop > position.stop_loss:
                return ManagementDecision(
                    action=PositionAction.UPDATE_TRAILING,
                    sell_fraction=0.0,
                    new_stop_loss=new_stop,
                    reason=(
                        f"تحديث الوقف المتحرك: {position.stop_loss:.4f} → {new_stop:.4f} "
                        f"(highest={position.highest_price_since_entry:.4f}, "
                        f"ATR={atr_value:.4f}, DC_exit={dc_exit:.4f}). "
                        f"سيب الباقي يركض."
                    ),
                    metadata={
                        "trailing_method": "atr+donchian",
                        "atr": round(atr_value, 4),
                        "highest": round(position.highest_price_since_entry, 4),
                    },
                )

    # ── 6) HOLD — لسه مبوصلش لـ tier ──
    return ManagementDecision(
        action=PositionAction.HOLD,
        sell_fraction=0.0,
        reason=(
            f"امسك. الربح الحالي = {profit_r:.2f}R. "
            f"Tier 1 عند {tier1_price:.4f} ({1.0 - profit_r:.2f}R للمتبقي)."
        ),
        metadata={"current_profit_r": round(profit_r, 3)},
    )


# ──────────────────────────────────────────────────────────────────────────
# Helper: create Position from RiskPlan (at entry time)
# ──────────────────────────────────────────────────────────────────────────

def position_from_risk_plan(
    plan: RiskPlan,
    symbol: str,
    entry_date,
    shares: Optional[int] = None,
) -> Position:
    """
    أنشئ Position من RiskPlan (عند تنفيذ الدخول).

    Args:
        plan: خطة المخاطر من ATR Risk Engine
        symbol: رمز السهم
        entry_date: تاريخ الدخول
        shares: عدد الأسهم (لو None، يستخدم plan.shares)
    """
    actual_shares = shares if shares is not None else (plan.shares or 0)
    return Position(
        symbol=symbol,
        entry_price=plan.entry_price,
        entry_date=entry_date,
        stop_loss=plan.stop_loss,
        shares=actual_shares,
        risk_per_share=plan.risk_per_share,
        remaining_fraction=1.0,
        highest_price_since_entry=plan.entry_price,
    )
