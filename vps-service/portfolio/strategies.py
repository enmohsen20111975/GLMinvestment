"""
Entry Strategies
================
استراتيجيات الدخول والتجميع

بناءً على PORTFOLIO_STRATEGY_BIBLE_v1.0.md - الفصل الأول

الاستراتيجيات:
1. Planned Scale-In - التجميع التدريجي المُخطط
2. Level-Based Accumulation - التجميع على المستويات
3. Pyramiding Up - الهرم الصاعد (إضافة للرابح)
4. Three-Zone Hunt - الصيد في 3 مناطق
"""

from dataclasses import dataclass, field
from typing import Optional, List, Dict, Literal
from datetime import datetime
from enum import Enum
import math


class StrategyType(str, Enum):
    """أنواع الاستراتيجيات"""
    PLANNED_SCALE_IN = "planned_scale_in"       # تجميع تدريجي مخطط
    LEVEL_BASED = "level_based"                 # تجميع على مستويات
    PYRAMID_UP = "pyramid_up"                   # هرم صاعد
    THREE_ZONE = "three_zone"                   # صيد 3 مناطق
    ALL_IN = "all_in"                           # دخول كامل (غير محبذ)


@dataclass
class LotPlan:
    """خطة دفعة واحدة"""
    lot_id: int
    trigger_price: float
    trigger_condition: str
    budget_pct: float
    budget_amount: float
    shares: int
    stop_loss: float
    target: float
    status: str = "pending"  # pending, executed, skipped
    
    def to_dict(self) -> dict:
        return {
            "lot_id": self.lot_id,
            "trigger_price": round(self.trigger_price, 4),
            "trigger_condition": self.trigger_condition,
            "budget_pct": round(self.budget_pct, 1),
            "budget_amount": round(self.budget_amount, 2),
            "shares": self.shares,
            "stop_loss": round(self.stop_loss, 4),
            "target": round(self.target, 4),
            "status": self.status
        }


@dataclass
class StrategyResult:
    """نتيجة الاستراتيجية"""
    strategy_type: StrategyType
    ticker: str
    current_price: float
    max_budget: float
    lots: List[LotPlan]
    average_price_target: float
    total_shares: int
    overall_stop: float
    targets: Dict[str, float]
    rules: List[str]
    warnings: List[str]
    
    def to_dict(self) -> dict:
        return {
            "strategy_type": self.strategy_type.value,
            "ticker": self.ticker,
            "current_price": round(self.current_price, 4),
            "max_budget": round(self.max_budget, 2),
            "lots": [lot.to_dict() for lot in self.lots],
            "average_price_target": round(self.average_price_target, 4),
            "total_shares": self.total_shares,
            "overall_stop": round(self.overall_stop, 4),
            "targets": {k: round(v, 4) for k, v in self.targets.items()},
            "rules": self.rules,
            "warnings": self.warnings
        }


class PlannedScaleInStrategy:
    """
    استراتيجية التجميع التدريجي المُخطط
    
    القواعد الذهبية:
    1. لا تضع أكثر من 25% في الدفعة الأولى
    2. كل دفعة بسعر أقل 3-5% على الأقل
    3. الحجم يزيد في الأسعار المنخفضة (بحد أقصى 2x)
    4. لكل دفعة Stop Loss خاص
    5. إذا كسر السعر أقل مستوى → إلغاء الدفعات المتبقية
    6. الحد الأقصى 4 دفعات
    """
    
    MAX_LOTS = 4
    MAX_FIRST_LOT_PCT = 25.0
    MIN_STEP_DOWN_PCT = 3.0
    STEP_DOWN_PCT = 5.0
    
    def plan(
        self,
        ticker: str,
        current_price: float,
        max_budget: float,
        target_average_pct: float = 8.0,
        stop_loss_pct: float = 8.0
    ) -> StrategyResult:
        """تخطيط التجميع التدريجي"""
        
        lots = []
        budget_allocation = [0.20, 0.30, 0.30, 0.20]  # توزيع الميزانية
        step_downs = [0, 5, 10, 15]  # نسب النزول
        
        total_shares = 0
        total_cost = 0
        
        for i, (budget_pct, step_down) in enumerate(zip(budget_allocation, step_downs)):
            price = current_price * (1 - step_down / 100)
            budget = max_budget * (budget_pct / 100)
            shares = int(budget / price)
            stop = price * (1 - stop_loss_pct / 100)
            target = price * 1.15
            
            lot = LotPlan(
                lot_id=i + 1,
                trigger_price=price,
                trigger_condition=f"{'Initial entry' if i == 0 else f'Price drops {step_down}%'}",
                budget_pct=budget_pct * 100,
                budget_amount=budget,
                shares=shares,
                stop_loss=stop,
                target=target
            )
            lots.append(lot)
            
            total_shares += shares
            total_cost += price * shares
        
        avg_price = total_cost / total_shares if total_shares > 0 else current_price
        
        return StrategyResult(
            strategy_type=StrategyType.PLANNED_SCALE_IN,
            ticker=ticker,
            current_price=current_price,
            max_budget=max_budget,
            lots=lots,
            average_price_target=avg_price,
            total_shares=total_shares,
            overall_stop=lots[-1].stop_loss,  # Stop عند آخر دفعة
            targets={
                "target_1": avg_price * 1.10,
                "target_2": avg_price * 1.20,
                "target_3": avg_price * 1.35
            },
            rules=[
                f"أقصى دفعة أولى: {self.MAX_FIRST_LOT_PCT}% من الميزانية",
                f"كل دفعة بسعر أقل {self.MIN_STEP_DOWN_PCT}% على الأقل",
                "الحجم يزيد في الأسعار المنخفضة (بحد أقصى 2x)",
                "لكل دفعة Stop Loss خاص",
                "إذا كسر السعر آخر مستوى → لا دفعة جديدة + مراجعة"
            ],
            warnings=[
                "لا تدخل الدفعة التالية قبل تنفيذ الحالية",
                "إذا نزل أكثر من 25% → ألغِ كل الدفعات المتبقية"
            ]
        )


class PyramidUpStrategy:
    """
    استراتيجية الهرم الصاعد (إضافة للرابح)
    
    القواعد:
    1. الدفعة الجديدة = نفس حجم الدفعة الأولى أو أقل
    2. الستوب الجديد = دخول الدفعة الجديدة - 5%
    3. اجني 30-50% من الربح قبل إضافة دفعة جديدة
    4. الحد الأقصى 3 دفعات صاعدة
    5. الدفعة الجديدة فقط إذا كسر قمة جديدة + حجم مرتفع
    """
    
    MAX_LOTS = 3
    ADD_LEVELS = [1.10, 1.20, 1.35]  # +10%, +20%, +35%
    
    def plan(
        self,
        ticker: str,
        entry_price: float,
        base_shares: int,
        current_price: float = None
    ) -> StrategyResult:
        """تخطيط الهرم الصاعد"""
        
        current_price = current_price or entry_price
        
        # الدفعة الأولى (الأساس)
        base_value = entry_price * base_shares
        lots = [
            LotPlan(
                lot_id=1,
                trigger_price=entry_price,
                trigger_condition="Initial position",
                budget_pct=100,
                budget_amount=base_value,
                shares=base_shares,
                stop_loss=entry_price * 0.92,
                target=entry_price * 1.10
            )
        ]
        
        # الدفعات الصاعدة المحتملة
        for i, level in enumerate(self.ADD_LEVELS):
            add_price = entry_price * level
            # الحجم يقل مع كل دفعة صاعدة
            size_multiplier = [0.8, 0.6, 0.4][i]
            add_shares = int(base_shares * size_multiplier)
            
            lot = LotPlan(
                lot_id=i + 2,
                trigger_price=add_price,
                trigger_condition=f"+{(level-1)*100:.0f}% with volume confirmation",
                budget_pct=size_multiplier * 100,
                budget_amount=add_price * add_shares,
                shares=add_shares,
                stop_loss=add_price * 0.95,
                target=add_price * 1.10
            )
            lots.append(lot)
        
        return StrategyResult(
            strategy_type=StrategyType.PYRAMID_UP,
            ticker=ticker,
            current_price=current_price,
            max_budget=sum(l.budget_amount for l in lots),
            lots=lots,
            average_price_target=entry_price,
            total_shares=base_shares + sum(l.shares for l in lots[1:]),
            overall_stop=entry_price * 0.92,
            targets={
                "target_1": entry_price * 1.10,
                "target_2": entry_price * 1.20,
                "target_3": entry_price * 1.35
            },
            rules=[
                "اجني 30-50% من الربح قبل إضافة دفعة جديدة",
                "الدفعة الجديدة فقط عند اختراق قمة + حجم مرتفع",
                "ارفع الستوب للدفعات السابقة عند كل إضافة",
                "الحد الأقصى 3 دفعات صاعدة"
            ],
            warnings=[
                "⚠️ لا تضاعف الحجم في الرابح - هذا الجشع",
                "⚠️ جني جزئي قبل كل إضافة"
            ]
        )


class ThreeZoneHuntStrategy:
    """
    استراتيجية الصيد في 3 مناطق
    
    للأسواق الهابطة أو الجانبية
    
    Zone 1: الصيد السريع (+-2%) - 15% من الميزانية - 1-3 أيام
    Zone 2: الصيد المتوسط (-5% إلى -8%) - 35% من الميزانية - 5-10 أيام
    Zone 3: الصيد العميق (-10% إلى -15%) - 50% من الميزانية - 15-30 يوم
    """
    
    def plan(
        self,
        ticker: str,
        current_price: float,
        max_budget: float
    ) -> StrategyResult:
        """تخطيط الصيد في 3 مناطق"""
        
        zones = [
            {
                "name": "Zone 1 - Quick Hunt",
                "name_ar": "المنطقة 1 - الصيد السريع",
                "price_offset": 0,  # السعر الحالي
                "budget_pct": 15,
                "stop_pct": 3,
                "target_pct": 5,
                "duration": "1-3 days",
                "duration_ar": "1-3 أيام"
            },
            {
                "name": "Zone 2 - Medium Hunt",
                "name_ar": "المنطقة 2 - الصيد المتوسط",
                "price_offset": -6.5,  # متوسط -5% إلى -8%
                "budget_pct": 35,
                "stop_pct": 3,
                "target_pct": 10,
                "duration": "5-10 days",
                "duration_ar": "5-10 أيام"
            },
            {
                "name": "Zone 3 - Deep Hunt",
                "name_ar": "المنطقة 3 - الصيد العميق",
                "price_offset": -12.5,  # متوسط -10% إلى -15%
                "budget_pct": 50,
                "stop_pct": 5,
                "target_pct": 20,
                "duration": "15-30 days",
                "duration_ar": "15-30 يوم"
            }
        ]
        
        lots = []
        for i, zone in enumerate(zones):
            price = current_price * (1 + zone["price_offset"] / 100)
            budget = max_budget * (zone["budget_pct"] / 100)
            shares = int(budget / price)
            stop = price * (1 - zone["stop_pct"] / 100)
            target = price * (1 + zone["target_pct"] / 100)
            
            lot = LotPlan(
                lot_id=i + 1,
                trigger_price=price,
                trigger_condition=f"{zone['name_ar']} - {zone['duration_ar']}",
                budget_pct=zone["budget_pct"],
                budget_amount=budget,
                shares=shares,
                stop_loss=stop,
                target=target
            )
            lot._zone_info = zone  # إضافة معلومات المنطقة
            lots.append(lot)
        
        return StrategyResult(
            strategy_type=StrategyType.THREE_ZONE,
            ticker=ticker,
            current_price=current_price,
            max_budget=max_budget,
            lots=lots,
            average_price_target=current_price * 0.94,  # متوسط الدخول
            total_shares=sum(l.shares for l in lots),
            overall_stop=lots[2].stop_loss,  # Stop المنطقة 3
            targets={
                "target_1": current_price * 1.05,
                "target_2": current_price * 1.10,
                "target_3": current_price * 1.20
            },
            rules=[
                "لا تدخل Zone 2 قبل الخروج من Zone 1 (ربح أو خسارة)",
                "لا تدخل Zone 3 قبل الخروج من Zone 2",
                "إذا Zone 1 خسارة → لا Zone 2 ولا 3. المركز 'ميت'",
                "Zone 2: يجب أن يكون السعر قد ارتد من هذه المنطقة في آخر 20 يوم",
                "Zone 3: RSI < 30 + حجم تجميع + دعم تاريخي"
            ],
            warnings=[
                "⚠️ انتظر تأكيد الارتداد في كل منطقة",
                "⚠️ إذا كسر السعر -15% دون تأكيد → ألغِ Zone 3"
            ]
        )


class EntryStrategies:
    """مدير استراتيجيات الدخول"""
    
    def __init__(self):
        self.planned_scale_in = PlannedScaleInStrategy()
        self.pyramid_up = PyramidUpStrategy()
        self.three_zone = ThreeZoneHuntStrategy()
    
    def get_strategy(
        self,
        strategy_type: StrategyType
    ):
        """الحصول على استراتيجية معينة"""
        strategies = {
            StrategyType.PLANNED_SCALE_IN: self.planned_scale_in,
            StrategyType.PYRAMID_UP: self.pyramid_up,
            StrategyType.THREE_ZONE: self.three_zone
        }
        return strategies.get(strategy_type)
    
    def recommend_strategy(
        self,
        current_price: float,
        market_condition: str = "neutral",  # bullish, bearish, neutral, volatile
        risk_tolerance: int = 5,  # 1-10
        holding_period: str = "medium"  # short, medium, long
    ) -> Dict:
        """توقعة بأفضل استراتيجية"""
        
        recommendations = []
        
        # الظروف الصاعدة
        if market_condition == "bullish":
            if risk_tolerance >= 6:
                recommendations.append({
                    "strategy": StrategyType.PYRAMID_UP.value,
                    "reason": "السوق صاعد ومستوى المخاطرة مقبول - استغل الزخم",
                    "reason_ar": "السوق صاعد ومستوى المخاطرة مقبول - استغل الزخم",
                    "priority": 1
                })
            recommendations.append({
                "strategy": StrategyType.PLANNED_SCALE_IN.value,
                "reason": "تجميع تدريجي آمن في السوق الصاعد",
                "reason_ar": "تجميع تدريجي آمن في السوق الصاعد",
                "priority": 2
            })
        
        # الظروف الهابطة
        elif market_condition == "bearish":
            recommendations.append({
                "strategy": StrategyType.THREE_ZONE.value,
                "reason": "السوق هابط - الصيد في مناطق القيمة",
                "reason_ar": "السوق هابط - الصيد في مناطق القيمة",
                "priority": 1
            })
            recommendations.append({
                "strategy": StrategyType.PLANNED_SCALE_IN.value,
                "reason": "تجميع حذر عند الدعوم",
                "reason_ar": "تجميع حذر عند الدعوم",
                "priority": 2
            })
        
        # الظروف الجانبية
        else:
            recommendations.append({
                "strategy": StrategyType.PLANNED_SCALE_IN.value,
                "reason": "السوق جانبي - تجميع تدريجي مثالي",
                "reason_ar": "السوق جانبي - تجميع تدريجي مثالي",
                "priority": 1
            })
            recommendations.append({
                "strategy": StrategyType.THREE_ZONE.value,
                "reason": "السوق جانبي - صيد في نطاقات التذبذب",
                "reason_ar": "السوق جانبي - صيد في نطاقات التذبذب",
                "priority": 2
            })
        
        # ترتيب حسب الأولوية
        recommendations.sort(key=lambda x: x["priority"])
        
        return {
            "market_condition": market_condition,
            "risk_tolerance": risk_tolerance,
            "holding_period": holding_period,
            "recommended": recommendations[0] if recommendations else None,
            "alternatives": recommendations[1:] if len(recommendations) > 1 else []
        }


__all__ = [
    'EntryStrategies', 'PlannedScaleInStrategy', 'PyramidUpStrategy',
    'ThreeZoneHuntStrategy', 'StrategyType', 'LotPlan', 'StrategyResult'
]
