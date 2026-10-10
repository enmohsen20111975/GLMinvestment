"""
Portfolio Heat Calculator
=========================
حاسبة حرارة المحفظة

بناءً على PORTFOLIO_STRATEGY_BIBLE_v1.0.md - الفصل الثالث

المفهوم:
Portfolio Heat = مجموع (Position_Size × Distance_to_Stop) / Portfolio_Value

القواعد:
- Portfolio Heat <= 6% → آمن
- Portfolio Heat 6-10% → حذر
- Portfolio Heat 10-15% → خطر
- Portfolio Heat > 15% → قنبلة
"""

from dataclasses import dataclass, field
from typing import Optional, List, Dict, Literal
from datetime import datetime
from enum import Enum
import math


class HeatLevel(str, Enum):
    """مستويات حرارة المحفظة"""
    SAFE = "safe"           # <= 6%
    CAUTION = "caution"     # 6-10%
    DANGER = "danger"       # 10-15%
    CRITICAL = "critical"   # > 15%


class RebalanceTrigger(str, Enum):
    """محفزات إعادة التوازن"""
    HEAT_EXCEEDED = "heat_exceeded"
    MONTHLY = "monthly"
    PERFORMANCE = "performance"
    MACRO_CHANGE = "macro_change"
    DRAWdown = "drawdown"


@dataclass
class PositionHeat:
    """حرارة المركز الواحد"""
    ticker: str
    position_value: float
    stop_loss_pct: float
    heat_contribution: float  # كنسبة من المحفظة
    heat_amount: float        # كمية المخاطرة بالجنيه
    
    def to_dict(self) -> dict:
        return {
            "ticker": self.ticker,
            "position_value": round(self.position_value, 2),
            "stop_loss_pct": round(self.stop_loss_pct, 2),
            "heat_contribution_pct": round(self.heat_contribution * 100, 4),
            "heat_amount": round(self.heat_amount, 2)
        }


@dataclass
class PortfolioState:
    """حالة المحفظة الكاملة"""
    total_value: float
    cash_value: float
    invested_value: float
    peak_value: float
    current_drawdown_pct: float
    total_heat: float
    heat_level: HeatLevel
    positions_heat: List[PositionHeat]
    allocations: Dict[str, float]
    diversification_score: float
    warnings: List[str]
    recommendations: List[str]
    
    def to_dict(self) -> dict:
        return {
            "total_value": round(self.total_value, 2),
            "cash_value": round(self.cash_value, 2),
            "cash_pct": round((self.cash_value / self.total_value) * 100, 2) if self.total_value > 0 else 0,
            "invested_value": round(self.invested_value, 2),
            "peak_value": round(self.peak_value, 2),
            "current_drawdown_pct": round(self.current_drawdown_pct, 2),
            "total_heat_pct": round(self.total_heat * 100, 2),
            "heat_level": self.heat_level.value,
            "positions_heat": [p.to_dict() for p in self.positions_heat],
            "allocations": {k: round(v * 100, 2) for k, v in self.allocations.items()},
            "diversification_score": round(self.diversification_score, 2),
            "warnings": self.warnings,
            "recommendations": self.recommendations
        }


class PortfolioHeatCalculator:
    """حاسبة حرارة المحفظة"""
    
    # حدود من PORTFOLIO_STRATEGY_BIBLE
    SAFE_HEAT_LIMIT = 0.06       # 6%
    CAUTION_HEAT_LIMIT = 0.10    # 10%
    DANGER_HEAT_LIMIT = 0.15     # 15%
    
    # حدود التنويع
    SECTOR_ALLOCATION_LIMITS = {
        "banks": {"min": 0.10, "max": 0.30},
        "real_estate": {"min": 0.05, "max": 0.20},
        "industry": {"min": 0.05, "max": 0.20},
        "food": {"min": 0.05, "max": 0.15},
        "tech": {"min": 0.0, "max": 0.15},
        "energy": {"min": 0.0, "max": 0.15},
        "gold": {"min": 0.10, "max": 0.25},
        "crypto": {"min": 0.0, "max": 0.20},
        "cash": {"min": 0.10, "max": 0.40}
    }
    
    def __init__(
        self,
        portfolio_value: float,
        cash: float = 0,
        peak_value: Optional[float] = None
    ):
        self.portfolio_value = portfolio_value
        self.cash = cash
        self.peak_value = peak_value or portfolio_value
        self.positions: List[Dict] = []
    
    def add_position(
        self,
        ticker: str,
        value: float,
        stop_loss_pct: float,
        sector: str = "unknown",
        correlation_group: Optional[str] = None
    ):
        """إضافة مركز للحساب"""
        self.positions.append({
            "ticker": ticker,
            "value": value,
            "stop_loss_pct": stop_loss_pct,
            "sector": sector,
            "correlation_group": correlation_group or sector
        })
    
    def calculate_heat(self) -> PortfolioState:
        """حساب حرارة المحفظة الكاملة"""
        
        positions_heat = []
        total_heat = 0
        total_invested = sum(p["value"] for p in self.positions)
        
        # حساب حرارة كل مركز
        for pos in self.positions:
            heat_amount = pos["value"] * (pos["stop_loss_pct"] / 100)
            heat_contribution = heat_amount / self.portfolio_value
            
            positions_heat.append(PositionHeat(
                ticker=pos["ticker"],
                position_value=pos["value"],
                stop_loss_pct=pos["stop_loss_pct"],
                heat_contribution=heat_contribution,
                heat_amount=heat_amount
            ))
            
            total_heat += heat_contribution
        
        # تحديد مستوى الحرارة
        if total_heat <= self.SAFE_HEAT_LIMIT:
            heat_level = HeatLevel.SAFE
        elif total_heat <= self.CAUTION_HEAT_LIMIT:
            heat_level = HeatLevel.CAUTION
        elif total_heat <= self.DANGER_HEAT_LIMIT:
            heat_level = HeatLevel.DANGER
        else:
            heat_level = HeatLevel.CRITICAL
        
        # حساب السحب
        drawdown = ((self.peak_value - self.portfolio_value) / self.peak_value) * 100 if self.peak_value > 0 else 0
        
        # حساب التوزيع
        allocations = self._calculate_allocations()
        
        # حساب نقاط التنويع
        diversification_score = self._calculate_diversification_score()
        
        # التحققات والتحذيرات
        warnings = self._generate_warnings(total_heat, heat_level, drawdown, allocations)
        recommendations = self._generate_recommendations(total_heat, heat_level, drawdown)
        
        return PortfolioState(
            total_value=self.portfolio_value,
            cash_value=self.cash,
            invested_value=total_invested,
            peak_value=self.peak_value,
            current_drawdown_pct=drawdown,
            total_heat=total_heat,
            heat_level=heat_level,
            positions_heat=positions_heat,
            allocations=allocations,
            diversification_score=diversification_score,
            warnings=warnings,
            recommendations=recommendations
        )
    
    def _calculate_allocations(self) -> Dict[str, float]:
        """حساب توزيع المحفظة"""
        allocations = {"cash": self.cash / self.portfolio_value if self.portfolio_value > 0 else 0}
        
        sector_totals = {}
        for pos in self.positions:
            sector = pos["sector"]
            sector_totals[sector] = sector_totals.get(sector, 0) + pos["value"]
        
        for sector, total in sector_totals.items():
            allocations[sector] = total / self.portfolio_value if self.portfolio_value > 0 else 0
        
        return allocations
    
    def _calculate_diversification_score(self) -> float:
        """
        حساب نقاط التنويع (0-100)
        
        المعايير:
        - عدد القطاعات المختلفة
        - التوازن بين القطاعات
        - عدم التركيز في قطاع واحد
        """
        allocations = self._calculate_allocations()
        invested_allocations = {k: v for k, v in allocations.items() if k != "cash" and v > 0}
        
        if not invested_allocations:
            return 100  # كلها كاش
        
        # 1. عدد القطاعات (أكثر = أفضل)
        num_sectors = len(invested_allocations)
        sector_score = min(num_sectors * 15, 40)  # حتى 40 نقطة
        
        # 2. التوازن (الأقرب للتساوي = أفضل)
        values = list(invested_allocations.values())
        if len(values) > 1:
            mean_val = sum(values) / len(values)
            variance = sum((v - mean_val) ** 2 for v in values) / len(values)
            balance_score = max(0, 30 - variance * 100)  # حتى 30 نقطة
        else:
            balance_score = 0
        
        # 3. عدم التركيز
        max_allocation = max(invested_allocations.values()) if invested_allocations else 0
        concentration_score = max(0, 30 - (max_allocation * 100))  # حتى 30 نقطة
        
        return sector_score + balance_score + concentration_score
    
    def _generate_warnings(
        self,
        total_heat: float,
        heat_level: HeatLevel,
        drawdown: float,
        allocations: Dict[str, float]
    ) -> List[str]:
        """توليد التحذيرات"""
        warnings = []
        
        # تحذيرات الحرارة
        if heat_level == HeatLevel.CRITICAL:
            warnings.append(f"🔴 حرارة المحفظة حرجة ({total_heat*100:.1f}%)! تخفيف إجباري مطلوب.")
        elif heat_level == HeatLevel.DANGER:
            warnings.append(f"🟠 حرارة المحفظة عالية ({total_heat*100:.1f}%). لا صفقات جديدة.")
        elif heat_level == HeatLevel.CAUTION:
            warnings.append(f"🟡 حرارة المحفظة مرتفعة ({total_heat*100:.1f}%). حذّر.")
        
        # تحذيرات السحب
        if drawdown >= 20:
            warnings.append(f"🔴 سحب كبير ({drawdown:.1f}%)! وقف تداولي مطلوب.")
        elif drawdown >= 15:
            warnings.append(f"🟠 سحب ملحوظ ({drawdown:.1f}%). تخفيف المراكز المضاربية.")
        elif drawdown >= 10:
            warnings.append(f"🟡 سحب متوسط ({drawdown:.1f}%). مراجعة الستوبات.")
        
        # تحذيرات التركز
        for sector, alloc in allocations.items():
            if sector in self.SECTOR_ALLOCATION_LIMITS:
                limits = self.SECTOR_ALLOCATION_LIMITS[sector]
                if alloc > limits["max"]:
                    warnings.append(f"🟠 تركز زائد في {sector} ({alloc*100:.1f}% > {limits['max']*100:.1f}% max)")
        
        # تحذير النقد
        cash_pct = allocations.get("cash", 0)
        if cash_pct > 0.50:
            warnings.append(f"💰 نسبة نقد عالية ({cash_pct*100:.1f}%). فرص ضائعة.")
        elif cash_pct < 0.05:
            warnings.append(f"⚠️ نسبة نقد منخفضة جداً ({cash_pct*100:.1f}%). لا مرونة.")
        
        return warnings
    
    def _generate_recommendations(
        self,
        total_heat: float,
        heat_level: HeatLevel,
        drawdown: float
    ) -> List[str]:
        """توليد التوقعات"""
        recommendations = []
        
        if heat_level == HeatLevel.CRITICAL:
            recommendations.append("بيع 40% من أكبر مركزين فوراً")
            recommendations.append("زيادة Gold إلى 25% للحماية")
        elif heat_level == HeatLevel.DANGER:
            recommendations.append("رفع الستوبات على كل المراكز")
            recommendations.append("لا دخول جديد حتى تنخفض الحرارة")
        elif heat_level == HeatLevel.CAUTION:
            recommendations.append("تقليل أحجام الصفقات الجديدة")
            recommendations.append("مراجعة الستوبات يومياً")
        
        if drawdown >= 15:
            recommendations.append("قاعدة الـ 3: وقف تداولي 3 أيام")
            recommendations.append("مراجعة الاستراتيجية")
        
        if not recommendations:
            recommendations.append("المحفظة في وضع جيد. استمر في الخطط.")
        
        return recommendations
    
    def check_new_position_allowed(
        self,
        new_position_value: float,
        new_stop_loss_pct: float
    ) -> Dict:
        """التحقق من إمكانية فتح مركز جديد"""
        
        # حساب الحرارة الجديدة
        new_heat = (new_position_value * (new_stop_loss_pct / 100)) / self.portfolio_value
        current_state = self.calculate_heat()
        projected_heat = current_state.total_heat + new_heat
        
        allowed = projected_heat <= self.CAUTION_HEAT_LIMIT  # لا نتخطى 10%
        
        return {
            "allowed": allowed,
            "current_heat": round(current_state.total_heat * 100, 2),
            "new_heat_contribution": round(new_heat * 100, 4),
            "projected_heat": round(projected_heat * 100, 2),
            "reason": "within_limits" if allowed else "would_exceed_caution_limit",
            "suggestion": None if allowed else f"قلل الحجم إلى {self._calculate_max_position(new_stop_loss_pct):.0f} جنيه"
        }
    
    def _calculate_max_position(self, stop_loss_pct: float) -> float:
        """حساب أقصى حجم مسموح لمركز جديد"""
        current_state = self.calculate_heat()
        available_heat = self.CAUTION_HEAT_LIMIT - current_state.total_heat
        max_position = (available_heat * self.portfolio_value) / (stop_loss_pct / 100)
        return max(0, max_position)
    
    def suggest_rebalancing(
        self,
        target_allocations: Optional[Dict[str, float]] = None,
        macro_regime: str = "neutral"
    ) -> Dict:
        """اقتراح إعادة التوازن"""
        
        current = self.calculate_heat()
        current_allocations = current.allocations
        
        # الأهداف حسب الماكرو
        if not target_allocations:
            if macro_regime == "risk_on":
                target_allocations = {
                    "egx": 0.55, "crypto": 0.25, "gold": 0.10, "cash": 0.10
                }
            elif macro_regime == "risk_off":
                target_allocations = {
                    "egx": 0.25, "crypto": 0.10, "gold": 0.25, "cash": 0.40
                }
            else:
                target_allocations = {
                    "egx": 0.40, "crypto": 0.15, "gold": 0.15, "cash": 0.30
                }
        
        # حساب الفروقات
        rebalance_actions = []
        for asset, target in target_allocations.items():
            current_val = current_allocations.get(asset, 0)
            deviation = target - current_val
            
            if abs(deviation) > 0.05:  # أكثر من 5% انحراف
                action = "buy" if deviation > 0 else "sell"
                amount = abs(deviation) * self.portfolio_value
                
                rebalance_actions.append({
                    "asset": asset,
                    "action": action,
                    "action_ar": "شراء" if action == "buy" else "بيع",
                    "current_pct": round(current_val * 100, 1),
                    "target_pct": round(target * 100, 1),
                    "deviation_pct": round(deviation * 100, 1),
                    "amount": round(amount, 2)
                })
        
        return {
            "current_allocations": {k: round(v*100, 1) for k, v in current_allocations.items()},
            "target_allocations": {k: round(v*100, 1) for k, v in target_allocations.items()},
            "macro_regime": macro_regime,
            "actions_needed": rebalance_actions,
            "total_rebalance_amount": round(sum(a["amount"] for a in rebalance_actions), 2)
        }


__all__ = [
    'PortfolioHeatCalculator', 'PortfolioState', 'PositionHeat', 
    'HeatLevel', 'RebalanceTrigger'
]
