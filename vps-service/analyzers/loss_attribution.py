#!/usr/bin/env python3
"""
Loss Attribution Engine
=======================
Module #4 of the BagHolder Rescue framework.

Separates the cause of a stock's price drop into 6 categories:
  - MARKET_WIDE              → الهبوط مرتبط بالسوق العام
  - COMPANY_SPECIFIC          → مشكلة خاصة بالشركة
  - OVERVALUATION_CORRECTION  → التقييم كان مبالغ فيه
  - LIQUIDITY_PRESSURE        → ضعف سيولة + ضغط بيع
  - MIXED                     → خليط من الأسباب
  - UNCLEAR                   → لا يمكن التحديد

Rule 27 (NO-FAKE-DATA): لو الـ input ناقص → UNCLEAR + confidence=0.
"""

from __future__ import annotations
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Optional, List, Dict, Any


class LossCause(str, Enum):
    MARKET_WIDE = "MARKET_WIDE"
    COMPANY_SPECIFIC = "COMPANY_SPECIFIC"
    OVERVALUATION_CORRECTION = "OVERVALUATION_CORRECTION"
    LIQUIDITY_PRESSURE = "LIQUIDITY_PRESSURE"
    MIXED = "MIXED"
    UNCLEAR = "UNCLEAR"


class CatalystStatus(str, Enum):
    PRESENT = "PRESENT"
    WEAK = "WEAK"
    ABSENT = "ABSENT"
    UNCLEAR = "UNCLEAR"  # default when no forward-looking data


@dataclass
class LossAttribution:
    primary_cause: LossCause
    market_contribution_pct: Optional[float] = None
    company_contribution_pct: Optional[float] = None
    valuation_contribution_pct: Optional[float] = None
    liquidity_contribution_pct: Optional[float] = None
    recovery_catalyst_12_24m: CatalystStatus = CatalystStatus.UNCLEAR
    catalyst_notes_ar: str = ""
    confidence: float = 0.0  # 0-1

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["primary_cause"] = self.primary_cause.value
        d["recovery_catalyst_12_24m"] = self.recovery_catalyst_12_24m.value
        return d


def attribute_loss(
    loss_pct: float,
    stock_data: Dict[str, Any],
    market_regime: str,
    index_change: Optional[float],
    sector_change: Optional[float] = None,
    price_history: Optional[List[Dict[str, Any]]] = None,
) -> LossAttribution:
    """
    Build a LossAttribution from available data. Never fabricates — if input
    is missing, returns UNCLEAR with confidence=0.

    Args:
        loss_pct: e.g. -25.0 for a 25% loss (negative = loss)
        stock_data: dict with pe_ratio, pb_ratio, volume, avg_volume_20d, etc.
        market_regime: one of RISK_ON / RISK_OFF / SIDEWAYS / NARROW_RALLY /
                       EXTREME_FEAR / UNKNOWN
        index_change: EGX30 daily change % (or None)
        sector_change: sector index daily change % (or None)
        price_history: list of {date, close, volume} dicts (last 90 days, or None)
    """
    # If no loss (or profit), attribution is meaningless
    if loss_pct >= 0:
        return LossAttribution(
            primary_cause=LossCause.UNCLEAR,
            catalyst_notes_ar="السهم مش خسران — لا حاجة لتحليل السبب.",
            confidence=1.0,
        )

    # If we don't even have index data, we can't attribute
    if index_change is None and market_regime == "UNKNOWN":
        return LossAttribution(
            primary_cause=LossCause.UNCLEAR,
            catalyst_notes_ar="بيانات السوق غير متاحة. لا يمكن تحديد سبب الهبوط.",
            confidence=0.0,
        )

    stock_fall = abs(loss_pct)
    market_contribution: Optional[float] = None
    company_contribution: Optional[float] = None
    valuation_contribution: Optional[float] = None
    liquidity_contribution: Optional[float] = None

    # ── Market vs company contribution ──────────────────────────────
    ref_change = index_change if index_change is not None else sector_change
    if ref_change is not None:
        ref_fall = abs(ref_change)
        if ref_fall > 0 and stock_fall > 0:
            if stock_fall > ref_fall * 1.5:
                # Stock fell significantly more than market → company-specific
                market_contribution = round((ref_fall / stock_fall) * 100, 1)
                company_contribution = round(100 - market_contribution, 1)
            else:
                # Stock fell roughly in line with market → market-driven
                market_contribution = 75.0  # majority market-driven
                company_contribution = 25.0
        else:
            # Market rose or flat but stock fell → company-specific
            market_contribution = 0.0
            company_contribution = 100.0
    else:
        # No index data → use regime as a heuristic
        if market_regime in ("RISK_OFF", "EXTREME_FEAR"):
            market_contribution = 60.0
            company_contribution = 40.0
        elif market_regime == "RISK_ON":
            market_contribution = 20.0
            company_contribution = 80.0

    # ── Valuation contribution ──────────────────────────────────────
    pe_ratio = float(stock_data.get("pe_ratio") or 0)
    if pe_ratio > 30 and stock_fall > 15:
        valuation_contribution = 20.0

    # ── Liquidity contribution ─────────────────────────────────────
    volume = float(stock_data.get("volume") or stock_data.get("avg_volume_20d") or 0)
    if price_history and len(price_history) >= 20:
        recent_volumes = [p.get("volume", 0) for p in price_history[-20:]]
        old_volumes = [p.get("volume", 0) for p in price_history[-90:-20]] if len(price_history) >= 90 else []
        if old_volumes:
            avg_recent = sum(recent_volumes) / len(recent_volumes) if recent_volumes else 0
            avg_old = sum(old_volumes) / len(old_volumes)
            if avg_old > 0 and avg_recent < avg_old * 0.3:
                liquidity_contribution = 15.0
    elif volume > 0 and volume < 10000:
        liquidity_contribution = 15.0

    # ── Determine primary cause ─────────────────────────────────────
    contributions: List[tuple] = []
    if market_contribution is not None:
        contributions.append(("MARKET_WIDE", market_contribution))
    if company_contribution is not None:
        contributions.append(("COMPANY_SPECIFIC", company_contribution))
    if valuation_contribution is not None:
        contributions.append(("OVERVALUATION_CORRECTION", valuation_contribution))
    if liquidity_contribution is not None:
        contributions.append(("LIQUIDITY_PRESSURE", liquidity_contribution))

    if not contributions:
        return LossAttribution(
            primary_cause=LossCause.UNCLEAR,
            catalyst_notes_ar="بيانات غير كافية لتحديد سبب الهبوط.",
            confidence=0.0,
        )

    # Sort by contribution descending
    contributions.sort(key=lambda x: x[1], reverse=True)
    top_cause, top_pct = contributions[0]

    # If two causes are close (< 15% diff), use MIXED
    if len(contributions) >= 2:
        second_cause, second_pct = contributions[1]
        if (top_pct - second_pct) < 15 and top_pct > 0:
            primary = LossCause.MIXED
        else:
            primary = LossCause(top_cause)
    else:
        primary = LossCause(top_cause)

    # Confidence: higher if contributions are well-separated
    confidence = min(1.0, top_pct / 100.0 + 0.2)

    # Recovery catalyst — NEVER fabricate; always UNCLEAR without forward data
    catalyst_notes = (
        "لا يمكن تحديد المحفز المستقبلي من البيانات المتاحة. "
        "يتطلب مراجعة يدوية للإفصاحات والأخبار."
    )

    return LossAttribution(
        primary_cause=primary,
        market_contribution_pct=market_contribution,
        company_contribution_pct=company_contribution,
        valuation_contribution_pct=valuation_contribution,
        liquidity_contribution_pct=liquidity_contribution,
        recovery_catalyst_12_24m=CatalystStatus.UNCLEAR,
        catalyst_notes_ar=catalyst_notes,
        confidence=round(confidence, 2),
    )
