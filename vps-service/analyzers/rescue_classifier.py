#!/usr/bin/env python3
"""
Rescue Classifier
=================
Module #5 of the BagHolder Rescue framework.

Classifies each position into one of 5 categories:
  A                   → احتفاظ أو زيادة محدودة
  B                   → احتفاظ بدون زيادة
  C                   → تخفيض تدريجي
  D                   → خروج أو مراقبة لصيقة
  INSUFFICIENT_DATA   → لا يمكن التقييم

The classification combines:
  - Fundamental score (0-30) from fundamental_scorer.py
  - Loss attribution (Module #4)
  - Market regime (Module #1)
  - Current price + P/E ratio
"""

from __future__ import annotations
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Tuple, Dict, Any


class StockClassification(str, Enum):
    A = "A"
    B = "B"
    C = "C"
    D = "D"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"


@dataclass
class FundamentalScore:
    total_score: int = 0  # 0-30
    verdict: str = "بيانات ناقصة"  # قوي / متوسط / ضعيف / عالي المخاطرة / بيانات ناقصة


@dataclass
class LossAttributionInput:
    primary_cause: str  # LossCause value


def classify_position(
    fundamental_score: FundamentalScore,
    loss_attribution_primary: str,
    market_regime: str,
    current_price: float,
    pe_ratio: float,
    liquidity_score: int = 3,  # 0-3 from fundamental scorer
) -> Tuple[StockClassification, str]:
    """
    Returns (classification, arabic_reason).

    Rules (first match wins):
      1. INSUFFICIENT_DATA → if fundamental_score.total_score == 0
      2. D → weak fundamentals + low liquidity (vol < 10K)
      3. C → weak fundamentals OR company-specific loss
      4. B → medium fundamentals OR strong but overvalued (PE > 25)
      5. A → strong fundamentals + reasonable valuation + market-driven loss
      6. Default → B
    """
    # Rule 1: INSUFFICIENT_DATA
    if fundamental_score.total_score == 0 or fundamental_score.verdict == "بيانات ناقصة":
        return (
            StockClassification.INSUFFICIENT_DATA,
            "البيانات الأساسية غير كافية للتقييم. لا يمكن التصنيف بدقة. "
            "يُنصح بمراجعة يدوية للإفصاحات.",
        )

    is_strong = fundamental_score.verdict == "قوي"
    is_medium = fundamental_score.verdict == "متوسط"
    is_weak = fundamental_score.verdict in ("ضعيف", "عالي المخاطرة")

    is_reasonable_valuation = pe_ratio > 0 and pe_ratio < 20
    is_overvalued_even_after_drop = pe_ratio > 25

    is_market_driven = loss_attribution_primary in ("MARKET_WIDE", "MIXED", "UNCLEAR")
    is_company_specific = loss_attribution_primary == "COMPANY_SPECIFIC"

    has_low_liquidity = liquidity_score == 0

    # Rule 2: D — weak + low liquidity
    if is_weak and has_low_liquidity:
        return (
            StockClassification.D,
            "مشكلة جوهرية + سيولة شبه معدومة + بيانات ضعيفة. "
            "خروج محتمل أو مراقبة لصيقة جدًا مع استعداد للبيع.",
        )

    # Rule 3: C — weak fundamentals OR company-specific
    if is_weak or is_company_specific:
        return (
            StockClassification.C,
            "ضعف واضح في الأساسيات أو مشكلة خاصة بالشركة. "
            "تخفيض تدريجي أفضل من الزيادة.",
        )

    # Rule 4: B — medium fundamentals OR strong but overvalued
    if is_medium or (is_strong and is_overvalued_even_after_drop):
        return (
            StockClassification.B,
            "جودة مقبولة لكن التقييم لسة مش رخيص أو المحفز مش واضح. "
            "احتفاظ من غير زيادة.",
        )

    # Rule 5: A — strong + reasonable valuation + market-driven
    if is_strong and is_reasonable_valuation and is_market_driven:
        return (
            StockClassification.A,
            "أساسيات قوية + تقييم مقبول بعد الهبوط + الخسارة غالباً مرتبطة بالسوق. "
            "يُسمح بالاحتفاظ أو زيادة محدودة جدًا.",
        )

    # Rule 6: default
    return (
        StockClassification.B,
        "تصنيف افتراضي — يحتاج مراجعة يدوية أعمق.",
    )
