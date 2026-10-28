#!/usr/bin/env python3
"""
Liquidity Allocator
===================
Module #7 of the BagHolder Rescue framework.

Decides how much of the available cash should be injected based on:
  - Market regime
  - Number of A-classified positions
  - Available cash amount

Rule: "متفترضش إنك لازم تستثمر كل السيولة."
"""

from __future__ import annotations
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import List, Dict, Any


class LiquidityRecommendation(str, Enum):
    HOLD_ALL_CASH = "HOLD_ALL_CASH"
    LIMITED_INJECTION = "LIMITED_INJECTION"
    DUAL_INJECTION = "DUAL_INJECTION"
    LARGE_INJECTION = "LARGE_INJECTION"


@dataclass
class LiquidityAllocation:
    recommendation: LiquidityRecommendation
    max_injection_pct: float
    max_injection_egp: float
    reasoning_ar: str
    candidates: List[str] = field(default_factory=list)
    warnings_ar: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["recommendation"] = self.recommendation.value
        return d


def allocate_liquidity(
    available_cash: float,
    positions: List[Dict[str, Any]],
    market_regime: str,
) -> LiquidityAllocation:
    """
    Args:
        available_cash: EGP available for investment
        positions: list of dicts with 'ticker' and 'classification' keys
        market_regime: RISK_ON / RISK_OFF / SIDEWAYS / NARROW_RALLY / EXTREME_FEAR / UNKNOWN
    """
    a_candidates = [p["ticker"] for p in positions if p.get("classification") == "A"]
    warnings: List[str] = []
    recommendation: LiquidityRecommendation
    max_pct: float
    reasoning: str

    if market_regime in ("EXTREME_FEAR", "RISK_OFF"):
        recommendation = LiquidityRecommendation.HOLD_ALL_CASH
        max_pct = 0
        reasoning = (
            "السوق في وضع تصفية أو خوف حاد. السيولة دلوقتي سلاح. "
            "لو ضختها في الوقت الغلط هتحولها لخسارة إضافية."
        )
        warnings.append("القرار الافتراضي في السوق الضعيف = حماية السيولة.")
        warnings.append("التنويع في أسهم وحشة بيزود الخسارة مش بيقللها.")

    elif market_regime == "SIDEWAYS" and len(a_candidates) > 0:
        recommendation = LiquidityRecommendation.LIMITED_INJECTION
        max_pct = 20
        reasoning = "السوق عرضي. ممكن ضخ محدود في سهم A واحد بس، بحد أقصى 20%."

    elif market_regime == "RISK_ON" and len(a_candidates) >= 3 and available_cash > 100_000:
        recommendation = LiquidityRecommendation.LARGE_INJECTION
        max_pct = 60
        reasoning = (
            "حالة نادرة: سوق مستقر + فرص واضحة متعددة. ضخ كبير (بحد أقصى 60%) "
            "ممكن بس مع تحمل عالٍ وأفق زمني طويل."
        )
        warnings.append("حتى في الحالة دي، متوصيش بـ 100%.")

    elif market_regime == "RISK_ON" and len(a_candidates) >= 2:
        recommendation = LiquidityRecommendation.DUAL_INJECTION
        max_pct = 40
        reasoning = (
            "السوق في وضع مخاطرة إيجابي. ممكن توزيع على سهمين A، "
            "بحد أقصى 40% من السيولة."
        )

    elif market_regime == "RISK_ON" and len(a_candidates) == 1:
        recommendation = LiquidityRecommendation.LIMITED_INJECTION
        max_pct = 25
        reasoning = "السوق إيجابي بس فيه سهم A واحد واضح. ضخ محدود بحد أقصى 25%."

    else:
        recommendation = LiquidityRecommendation.HOLD_ALL_CASH
        max_pct = 0
        reasoning = "مفيش أسهم بتصنيف A في المحفظة. السيولة تتفضل محتفظ بيها."
        warnings.append("متوزعش على أسهم كتير ضعيفة عشان \"تنوع\".")

    if not a_candidates:
        warnings.append("مفيش أسهم تستحق دراسة زيادة في المحفظة الحالية.")

    warnings.append("مفيش ضمان إن أي سهم من دول هيرجع لمتوسطك.")

    return LiquidityAllocation(
        recommendation=recommendation,
        max_injection_pct=max_pct,
        max_injection_egp=round(available_cash * max_pct / 100, 2),
        reasoning_ar=reasoning,
        candidates=a_candidates,
        warnings_ar=warnings,
    )
