#!/usr/bin/env python3
"""
Averaging Simulator
===================
Module #6 of the BagHolder Rescue framework.

Calculates 5 injection scenarios (10k/20k/30k/50k/70k) and for each
computes the new average, breakeven, and ±10%/±20% price outcomes.

Rule: "تخفيض نسبة الخسارة مش معناه نجاح. ممكن النسبة تقل والخسارة
بالجنيه تفضل زي ما هي أو تزيد."
"""

from __future__ import annotations
from dataclasses import dataclass, asdict
from typing import Dict, List, Any


@dataclass
class PriceOutcome:
    price: float
    profit_egp: float
    profit_pct: float


@dataclass
class AveragingScenario:
    injection_amount: int
    current_shares: int
    current_avg: float
    new_shares_bought: int
    new_avg: float
    new_total_invested: float
    new_loss_pct: float
    new_loss_egp: float
    breakeven_price: float
    pct_rise_needed_for_breakeven: float
    if_down_10pct: PriceOutcome
    if_down_20pct: PriceOutcome
    if_up_10pct: PriceOutcome
    if_up_20pct: PriceOutcome
    warning_ar: str
    is_recommended: bool = False

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["if_down_10pct"] = asdict(self.if_down_10pct)
        d["if_down_20pct"] = asdict(self.if_down_20pct)
        d["if_up_10pct"] = asdict(self.if_up_10pct)
        d["if_up_20pct"] = asdict(self.if_up_20pct)
        return d


def simulate_averaging_grid(
    current_shares: int,
    current_avg: float,
    current_price: float,
    injection_amounts: List[int] = None,
    classification: str = "A",
    regime: str = "RISK_ON",
) -> Dict[str, AveragingScenario]:
    """
    Returns dict keyed by str(injection_amount) → AveragingScenario.

    is_recommended is True only if classification == A and regime in
    (RISK_ON, SIDEWAYS, NARROW_RALLY).
    """
    if injection_amounts is None:
        injection_amounts = [10000, 20000, 30000, 50000, 70000]

    # Safety: no division by zero
    if current_price <= 0 or current_shares < 0:
        return {}

    allow_injection = classification == "A" and regime in ("RISK_ON", "SIDEWAYS", "NARROW_RALLY")

    result: Dict[str, AveragingScenario] = {}

    for injection in injection_amounts:
        if injection <= 0:
            continue

        new_shares = int(injection // current_price)
        total_shares = current_shares + new_shares

        if total_shares == 0:
            continue

        new_avg = (current_shares * current_avg + new_shares * current_price) / total_shares
        new_total_invested = current_shares * current_avg + injection
        new_market_value = total_shares * current_price
        new_loss_egp = new_market_value - new_total_invested
        new_loss_pct = (new_loss_egp / new_total_invested * 100) if new_total_invested > 0 else 0
        breakeven = new_avg
        pct_rise = ((breakeven - current_price) / current_price * 100) if current_price > 0 else 0

        # ±10% / ±20% price scenarios after injection
        down10 = current_price * 0.90
        down20 = current_price * 0.80
        up10 = current_price * 1.10
        up20 = current_price * 1.20

        def outcome(price: float) -> PriceOutcome:
            pnl_egp = (price - new_avg) * total_shares
            pnl_pct = (pnl_egp / new_total_invested * 100) if new_total_invested > 0 else 0
            return PriceOutcome(
                price=round(price, 2),
                profit_egp=round(pnl_egp, 2),
                profit_pct=round(pnl_pct, 2),
            )

        # Warning logic
        if pct_rise > 50:
            warning = (
                f"⚠️ لازم السهم يطلع {pct_rise:.1f}% عشان توصل breakeven. "
                "احتمال ضعيف على المدى القصير. متضخش."
            )
        elif pct_rise > 25:
            warning = (
                f"⚠️ لازم السهم يطلع {pct_rise:.1f}% عشان توصل breakeven. "
                "صعب لكن ممكن على مدى طويل."
            )
        elif new_shares > current_shares and current_shares > 0:
            warning = "⚠️ المركز هيكون أكبر من الأصلي. خطر تركيز."
        else:
            warning = "السيناريو ضمن الحدود المعقولة، بس مفيش ضمان."

        scenario = AveragingScenario(
            injection_amount=injection,
            current_shares=current_shares,
            current_avg=round(current_avg, 4),
            new_shares_bought=new_shares,
            new_avg=round(new_avg, 4),
            new_total_invested=round(new_total_invested, 2),
            new_loss_pct=round(new_loss_pct, 2),
            new_loss_egp=round(new_loss_egp, 2),
            breakeven_price=round(breakeven, 4),
            pct_rise_needed_for_breakeven=round(pct_rise, 2),
            if_down_10pct=outcome(down10),
            if_down_20pct=outcome(down20),
            if_up_10pct=outcome(up10),
            if_up_20pct=outcome(up20),
            warning_ar=warning,
            is_recommended=allow_injection,
        )
        result[str(injection)] = scenario

    return result
