#!/usr/bin/env python3
"""
Monitoring Plan
================
Module #8 of the BagHolder Rescue framework.

Builds a monitoring plan with:
  - Watch list (what to monitor)
  - Review frequency (daily/weekly/biweekly)
  - Triggers (when to review)
  - Escalation rules (when to escalate)
"""

from __future__ import annotations
from dataclasses import dataclass, field, asdict
from datetime import datetime, timedelta
from typing import List, Dict, Any


@dataclass
class MonitoringPlan:
    watch_list_ar: List[str] = field(default_factory=list)
    review_frequency: str = "weekly"  # daily / weekly / biweekly
    triggers_ar: List[str] = field(default_factory=list)
    escalation_ar: str = ""
    next_review_date: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def build_monitoring_plan(
    positions: List[Dict[str, Any]],
    market_regime: str,
) -> MonitoringPlan:
    """
    Args:
        positions: list of dicts with 'ticker' and 'classification' keys
        market_regime: RISK_ON / RISK_OFF / SIDEWAYS / NARROW_RALLY / EXTREME_FEAR / UNKNOWN
    """
    watch_list = [
        "مستويات المؤشرات الرئيسية (EGX30/70/100) والاتساع",
        "سعر كل سهم محدد مقابل متوسطاته وحجمه",
        "أي إفصاح جوهري (أرباح، دين، زيادة رأس مال، مشاكل)",
        "تغيرات في صافي تعاملات الأجانب",
    ]

    # Review frequency
    if market_regime in ("EXTREME_FEAR", "RISK_OFF"):
        frequency = "daily"
    elif any(p.get("classification") == "D" for p in positions):
        frequency = "weekly"
    else:
        frequency = "biweekly"

    triggers = [
        "مؤشرات السوق كسرت مستويات دعم مهمة أو اتحسنت بشكل مستدام",
        "السهم المحدد نزل نسبة إضافية معينة أو طلع وثبت",
        "ظهر إفصاح جوهري (أرباح، دين، زيادة رأس مال، نزاع، تغيير إدارة)",
        "السيولة على السهم اختفت أو زادت بشكل غير طبيعي",
        "العميل احتاج الفلوس فجأة",
    ]

    # Escalation
    d_positions = [p["ticker"] for p in positions if p.get("classification") == "D"]
    if d_positions:
        escalation = (
            f"مراقبة لصيقة لـ {', '.join(d_positions)} (تصنيف D). "
            "استعداد للبيع فوراً لو ظهرت مشكلة جوهرية."
        )
    else:
        escalation = "مراجعة أسبوعية + إفصاح ربع سنوي"

    # Next review date
    days_map = {"daily": 1, "weekly": 7, "biweekly": 14}
    next_days = days_map.get(frequency, 7)
    next_date = (datetime.now() + timedelta(days=next_days)).strftime("%Y-%m-%d")

    return MonitoringPlan(
        watch_list_ar=watch_list,
        review_frequency=frequency,
        triggers_ar=triggers,
        escalation_ar=escalation,
        next_review_date=next_date,
    )
