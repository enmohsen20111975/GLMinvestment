"""
engines/atr_risk_engine.py — إدارة المخاطر بالـ ATR
===================================================
المصدر: Welles Wilder (مخترع ATR) + Michael Covel (Trend Following)

الفلسفة:
    الوقف الثابت (-8%) غلط لأنه:
      - ضيق جداً لسهم متقلب → يتضرب قبل ما يتحرك
      - واسع جداً لسهم هادي → مخاطرة زايدة بلا داعي

    الحل: الوقف = entry - (multiplier × ATR)
      - ATR بيقيس التقلب الحقيقي (شامل الفجوات)
      - multiplier أكبر = وقف أوسع = يتحمل الضجيج بس مخاطرة أكبر

قواعد الـ Persona:
    scalper  → multiplier = 2.0 (وقف ضيق، صفقات سريعة)
    investor → multiplier = 3.0 (وقف واسع، يتحمل التذبذب)

Covel الأصلي بيقترح 4× ATR بس ده واسع جداً على EGX (سيولة أقل).
خلّينا 3× للمستثمر و 2× للمضارب — أمثل لمصر.

Position Sizing:
    حجم الصفقة = (رأس المال × نسبة المخاطرة) / المخاطرة لكل سهم
    - مخاطرة افتراضية: 2% من رأس المال لكل صفقة (1% للمضارب عشان كثرة الصفقات)
    - ده يخليك تفضل في السوق حتى بعد 10 خسارة ورا بعض
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Optional

import pandas as pd

from core.base import (
    EngineResult, RiskPlan, Signal, SignalType, TakeProfitTier, Timeframe,
)
from core.indicators import atr


# ──────────────────────────────────────────────────────────────────────────
# Config
# ──────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class ATRRiskConfig:
    """إعدادات محرك المخاطر — قابلة للتعديل حسب الـ persona."""
    atr_period: int = 14
    # مضاعف الـ ATR لكل persona
    scalper_multiplier: float = 2.0
    investor_multiplier: float = 3.0
    # نسبة المخاطرة من رأس المال لكل صفقة
    scalper_risk_pct: float = 0.01    # 1% (صفقات كتير)
    investor_risk_pct: float = 0.02   # 2% (صفقات أقل)
    # حدود الأمان
    max_stop_pct: float = 0.15        # أقصى وقف 15% (نتجنب وقف 30% لسهم متقلب جداً)
    min_stop_pct: float = 0.03        # أدنى وقف 3% (نتجنب وقف مضغوط بلا معنى)
    # Risk:Reward الأدنى لكل مستوى إشارة
    strong_buy_rr: float = 3.0        # R:R ≥ 3 → STRONG_BUY
    buy_rr: float = 2.0               # R:R ≥ 2 → BUY
    neutral_rr: float = 1.0           # R:R < 1 → NEUTRAL


# ──────────────────────────────────────────────────────────────────────────
# Core function
# ──────────────────────────────────────────────────────────────────────────

def compute_risk_plan(
    df: pd.DataFrame,
    entry_price: float,
    persona: str,
    account_size: float,
    config: Optional[ATRRiskConfig] = None,
) -> RiskPlan:
    """
    احسب خطة المخاطر الكاملة لصفقة محتملة.

    Args:
        df: OHLCV DataFrame (يجب فيه: high, low, close, volume)
        entry_price: سعر الدخول المقترح
        persona: "scalper" | "investor"
        account_size: رأس المال الكلي (جنيه)
        config: إعدادات مخصصة (اختياري)

    Returns:
        RiskPlan فيه: stop_loss, position_size, take_profit_tiers

    Raises:
        ValueError: لو persona غير معروف أو بيانات غير كافية
    """
    if persona not in ("scalper", "investor"):
        raise ValueError(f"persona must be 'scalper' or 'investor', got '{persona}'")

    cfg = config or ATRRiskConfig()

    # 1) احسب ATR الحالي
    atr_series = atr(df, cfg.atr_period)
    atr_value = float(atr_series.iloc[-1])

    if math.isnan(atr_value) or atr_value <= 0:
        raise ValueError(
            f"ATR غير صالح ({atr_value}). تأكد إن فيه بيانات كافية "
            f"(≥ {cfg.atr_period + 1} شمعة)."
        )

    # 2) احسب الوقف الخام
    multiplier = cfg.scalper_multiplier if persona == "scalper" else cfg.investor_multiplier
    raw_stop_distance = multiplier * atr_value
    raw_stop = entry_price - raw_stop_distance  # افتراض صفقة شراء (long)

    # 3) طبّق حدود الأمان
    stop_pct = raw_stop_distance / entry_price
    if stop_pct > cfg.max_stop_pct:
        # وقف واسع جداً → كبّره لـ max_stop_pct
        stop_distance = entry_price * cfg.max_stop_pct
        stop_loss = entry_price - stop_distance
        capped_reason = f"stop capped at {cfg.max_stop_pct:.0%} (raw was {stop_pct:.1%})"
    elif stop_pct < cfg.min_stop_pct:
        # وقف ضيق جداً → وسّعه لـ min_stop_pct
        stop_distance = entry_price * cfg.min_stop_pct
        stop_loss = entry_price - stop_distance
        capped_reason = f"stop floored at {cfg.min_stop_pct:.0%} (raw was {stop_pct:.1%})"
    else:
        stop_distance = raw_stop_distance
        stop_loss = raw_stop
        capped_reason = None

    risk_per_share = entry_price - stop_loss  # موجب للشراء

    # 4) احسب حجم المركز (position sizing)
    risk_pct = cfg.scalper_risk_pct if persona == "scalper" else cfg.investor_risk_pct
    risk_amount = account_size * risk_pct
    shares = int(risk_amount / risk_per_share) if risk_per_share > 0 else 0
    position_size_pct = (shares * entry_price) / account_size if account_size > 0 else 0.0

    # 5) Take Profit Tiers (فلسفة Mark Douglas — بيع تدريجي)
    #    Tier 1: 1R — بيع 1/3 وحرّك الوقف لـ breakeven
    #    Tier 2: 2R — بيع 1/3 ثانية
    #    Tier 3: 3R+ — الباقي بـ trailing stop
    tier1_price = entry_price + 1.0 * risk_per_share
    tier2_price = entry_price + 2.0 * risk_per_share
    tier3_price = entry_price + 3.0 * risk_per_share  # الحد الأدنى للهدف الثالث

    tiers = (
        TakeProfitTier(
            price=tier1_price,
            fraction=1.0 / 3.0,
            label="Tier 1 (1R)",
            reason="بيع ثلث المركز + حرّك الوقف ل breakeven",
        ),
        TakeProfitTier(
            price=tier2_price,
            fraction=1.0 / 3.0,
            label="Tier 2 (2R)",
            reason="بيع ثلث ثاني — تأمين الربح",
        ),
        TakeProfitTier(
            price=tier3_price,
            fraction=1.0 / 3.0,
            label="Tier 3 (3R+ trailing)",
            reason="الباقي بـ trailing stop — اتركه للهدف الكبير",
        ),
    )

    # 6) R:R للمستهدف الأول المعقول (Tier 2 = 2R)
    rr_ratio = 2.0  # بالتعريف (Tier 2)

    return RiskPlan(
        entry_price=entry_price,
        stop_loss=stop_loss,
        position_size_pct=position_size_pct,
        shares=shares,
        risk_per_share=risk_per_share,
        risk_reward_ratio=rr_ratio,
        take_profit_tiers=tiers,
        trailing_stop_method="atr",
    )


# ──────────────────────────────────────────────────────────────────────────
# Engine entry point
# ──────────────────────────────────────────────────────────────────────────

def analyze(
    df: pd.DataFrame,
    symbol: str,
    entry_price: float,
    persona: str,
    account_size: float,
    config: Optional[ATRRiskConfig] = None,
) -> EngineResult:
    """
    نقطة الدخول الرئيسية لمحرك المخاطر.

    بيرجّع EngineResult فيه:
      - Signal (بناءً على R:R)
      - RiskPlan (الوقف + الحجم + الـ tiers)
    """
    cfg = config or ATRRiskConfig()

    try:
        plan = compute_risk_plan(df, entry_price, persona, account_size, cfg)
    except ValueError as e:
        return EngineResult(
            symbol=symbol,
            signal=Signal(
                signal_type=SignalType.AVOID,
                confidence=0.0,
                engine_name="atr_risk",
                reason=f"لا يمكن حساب خطة المخاطر: {e}",
                metadata={"error": str(e)},
            ),
        )

    # حدد نوع الإشارة بناءً على جودة الـ R:R
    # ملاحظة: الـ R:R هنا = 2 بالتعريف (Tier 2)، فالإشارة الأصلية دايماً BUY.
    # اللي بيفرق هو نسبة المخاطرة لكل سهم مقابل ATR:
    #   - لو stop_pct ضمن نطاق صحي (3%-10%) → ثقة أعلى
    #   - لو محتاج cap (مفتوح جداً أو مضغوط) → ثقة أقل
    stop_pct = plan.risk_amount_per_share / plan.entry_price

    if stop_pct <= 0.10:
        confidence = 0.85
        signal_type = SignalType.STRONG_BUY
        reason = (
            f"وقف صحي {stop_pct:.1%} (ATR={cfg.atr_period}). "
            f"R:R=2. حجم المركز={plan.position_size_pct:.1%}."
        )
    elif stop_pct <= 0.15:
        confidence = 0.65
        signal_type = SignalType.BUY
        reason = (
            f"وقف مقبول {stop_pct:.1%} (سهم متقلب نسبياً). "
            f"R:R=2. حجم المركز={plan.position_size_pct:.1%}."
        )
    else:
        confidence = 0.30
        signal_type = SignalType.NEUTRAL
        reason = (
            f"وقف واسع {stop_pct:.1%} (سهم متقلب جداً). "
            f"المخاطرة عالية — يُفضّل انتظار تقلص أقل."
        )

    return EngineResult(
        symbol=symbol,
        signal=Signal(
            signal_type=signal_type,
            confidence=confidence,
            engine_name="atr_risk",
            reason=reason,
            metadata={
                "stop_loss": round(plan.stop_loss, 4),
                "stop_pct": round(stop_pct, 4),
                "position_size_pct": round(plan.position_size_pct, 4),
                "shares": plan.shares,
                "tier1": round(plan.take_profit_tiers[0].price, 4),
                "tier2": round(plan.take_profit_tiers[1].price, 4),
                "tier3": round(plan.take_profit_tiers[2].price, 4),
                "persona": persona,
            },
        ),
        risk_plan=plan,
        timeframe=Timeframe.DAILY,
    )
