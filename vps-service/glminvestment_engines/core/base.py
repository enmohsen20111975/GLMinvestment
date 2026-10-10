"""
core/base.py — أنواع البيانات الموحدة لكل المحركات
===================================================
كل engine يرجّع EngineResult فيه Signal + RiskPlan (اختياري).
التوحيد ده يخلي الـ Confluence Engine يقدر يخلط نتائجهم بسهولة.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional


class SignalType(str, Enum):
    """نوع الإشارة — مرتبة من الأقوى شراءً للأقوى تجنباً."""
    STRONG_BUY = "STRONG_BUY"      # 3+ استراتيجيات متفقة
    BUY = "BUY"                    # 2 استراتيجية متفقة على الأقل
    NEUTRAL = "NEUTRAL"            # لا شراء ولا بيع — انتظر
    AVOID = "AVOID"                # تجنب — شروط سلبية
    STRONG_AVOID = "STRONG_AVOID"  # رفض قاطع — مخاطرة عالية


class Timeframe(str, Enum):
    DAILY = "1D"
    WEEKLY = "1W"
    MONTHLY = "1M"


@dataclass(frozen=True)
class TakeProfitTier:
    """مستوى جني أرباح — فلسفة Mark Douglas البيع التدريجي."""
    price: float
    fraction: float          # نسبة المركز اللي تتبيع (0.0 - 1.0)
    label: str               # "Tier 1 (1R)", "Tier 2 (2R)", "Trailing"
    reason: str = ""

    def __post_init__(self) -> None:
        if not 0.0 < self.fraction <= 1.0:
            raise ValueError(f"fraction must be in (0, 1], got {self.fraction}")


@dataclass(frozen=True)
class RiskPlan:
    """خطة المخاطر الكاملة لأي صفقة — ناتج ATR Risk Engine."""
    entry_price: float
    stop_loss: float
    position_size_pct: float         # نسبة من رأس المال (e.g. 0.02 = 2%)
    shares: Optional[int] = None     # عدد الأسهم المحسوب (اختياري)
    risk_per_share: float = 0.0      # entry - stop (موجب للشراء)
    risk_reward_ratio: float = 0.0   # R:R للمستهدف الأول
    take_profit_tiers: tuple[TakeProfitTier, ...] = field(default_factory=tuple)
    trailing_stop_method: str = "atr"  # "atr" | "donchian_low" | "sma20"

    @property
    def risk_amount_per_share(self) -> float:
        """المبلغ المعرض للخسارة لكل سهم."""
        return abs(self.entry_price - self.stop_loss)


@dataclass(frozen=True)
class Signal:
    """إشارة من محرك تحليلي واحد."""
    signal_type: SignalType
    confidence: float                 # 0.0 - 1.0
    engine_name: str                  # "atr_risk", "stage2", "vcp", ...
    reason: str                       # تفسير بشري
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class EngineResult:
    """الناتج الكامل لأي محرك — Signal + RiskPlan اختياري."""
    symbol: str
    signal: Signal
    risk_plan: Optional[RiskPlan] = None
    timestamp: datetime = field(default_factory=datetime.utcnow)
    timeframe: Timeframe = Timeframe.DAILY

    def to_dict(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "signal_type": self.signal.signal_type.value,
            "confidence": round(self.signal.confidence, 4),
            "engine": self.signal.engine_name,
            "reason": self.signal.reason,
            "metadata": self.signal.metadata,
            "has_risk_plan": self.risk_plan is not None,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class Position:
    """تمثيل صفقة مفتوحة — للحسابات اللاحقة (trailing, take-profit)."""
    symbol: str
    entry_price: float
    entry_date: datetime
    stop_loss: float
    shares: int
    risk_per_share: float
    remaining_fraction: float = 1.0    # كم باقي من المركز (1.0 = كامل)
    realized_profit: float = 0.0
    highest_price_since_entry: float = 0.0  # للـ trailing

    def update_high(self, current_high: float) -> None:
        """حدّث أعلى سعر منذ الدخول — يُستخدم للـ trailing stop."""
        if current_high > self.highest_price_since_entry:
            self.highest_price_since_entry = current_high
