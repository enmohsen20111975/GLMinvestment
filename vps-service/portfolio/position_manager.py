"""
Position Manager
================
مدير المركز الواحد

بناءً على PORTFOLIO_STRATEGY_BIBLE_v1.0.md - الفصل الأول والثاني

المهام:
- إدارة الدفعات (Lots) داخل المركز الواحد
- حساب المتوسط المرجح
- متابعة الستوبات الجزئية
- تقييم R:R الحالي
"""

from dataclasses import dataclass, field
from typing import Optional, List, Literal
from datetime import datetime, timedelta
from enum import Enum
import math

from .stop_manager import StopLossManager, StopType


class PositionState(str, Enum):
    """حالات المركز"""
    PLANNED = "planned"           # مخطط (لم يدخل بعد)
    ACTIVE = "active"             # نشط
    ACCUMULATING = "accumulating" # في مرحلة تجميع
    PROFIT_TAKING = "profit_taking"  # في مرحلة جني أرباح
    CLOSING = "closing"           # في مرحلة إغلاق
    CLOSED = "closed"             # مغلق
    STOPPED = "stopped"           # أُغلق بالستوب


class TradingPattern(str, Enum):
    """أنماط التداول البشرية"""
    HUNTER = "hunter"        # الصيّاد - Swing Trading (5-30 يوم)
    FARMER = "farmer"        # المزارع - Position Trading (3-12 شهر)
    SNIPER = "sniper"        # القناص - Momentum (1-5 أيام)
    LAWYER = "lawyer"        # المحامي - Event-Driven
    GUARD = "guard"          # الحارس - Hedging


@dataclass
class PositionLot:
    """دفعة واحدة داخل المركز"""
    lot_id: int
    entry_price: float
    shares: int
    entry_date: datetime
    stop_loss: float
    target_price: float
    status: str = "active"  # active, partial_exit, closed
    
    def get_value(self) -> float:
        """قيمة الدفعة"""
        return self.entry_price * self.shares
    
    def get_current_value(self, current_price: float) -> float:
        """القيمة الحالية"""
        return current_price * self.shares
    
    def get_return_pct(self, current_price: float) -> float:
        """العائد百分比"""
        return ((current_price - self.entry_price) / self.entry_price) * 100
    
    def get_risk_amount(self) -> float:
        """مبلغ المخاطرة"""
        return (self.entry_price - self.stop_loss) * self.shares
    
    def to_dict(self) -> dict:
        return {
            "lot_id": self.lot_id,
            "entry_price": self.entry_price,
            "shares": self.shares,
            "entry_date": self.entry_date.isoformat(),
            "stop_loss": self.stop_loss,
            "target_price": self.target_price,
            "status": self.status,
            "value": self.get_value(),
            "risk_amount": self.get_risk_amount()
        }


@dataclass
class PositionMetrics:
    """مقاييس المركز"""
    total_shares: int
    weighted_avg_price: float
    total_value: float
    current_value: float
    total_return_pct: float
    total_risk: float
    current_risk_reward: float
    days_held: int
    max_lots_allowed: int
    current_lots: int
    
    def to_dict(self) -> dict:
        return {
            "total_shares": self.total_shares,
            "weighted_avg_price": round(self.weighted_avg_price, 4),
            "total_value": round(self.total_value, 2),
            "current_value": round(self.current_value, 2),
            "total_return_pct": round(self.total_return_pct, 2),
            "total_risk": round(self.total_risk, 2),
            "current_risk_reward": round(self.current_risk_reward, 2),
            "days_held": self.days_held,
            "max_lots_allowed": self.max_lots_allowed,
            "current_lots": self.current_lots
        }


class PositionManager:
    """مدير المركز الواحد"""
    
    # حدود من PORTFOLIO_STRATEGY_BIBLE
    MAX_LOTS = 4  # الحد الأقصى للدفعات
    MIN_STEP_DOWN_PCT = 3.0  # أقل نسبة نزول بين الدفعات
    MAX_FIRST_LOT_PCT = 25.0  # أقصى نسبة للدفعة الأولى
    # P4-PROBING-LOT: أول لوت = استطلاع (25% بس من الحجم المخصص).
    # فلسفة ليفرمور: اشتري 10% (استطلاع) → لو طلع أضف → لو نزل قطع.
    # اللوت التاني ممنوع يكون بنفس سعر الدخول (لازي لازم تأكيد اختراق أو رجوع لـ OB).
    PROBING_LOT_1_PCT = 25.0  # الدفعة الأولى = 25% فقط (استطلاع)
    CONFIRM_LOT_2_PCT = 30.0  # الدفعة التانية = 30% (بعد تأكيد)
    
    def __init__(
        self,
        ticker: str,
        persona_type: str = "balanced",
        trading_pattern: TradingPattern = TradingPattern.HUNTER,
        max_budget: float = 100000.0,
        portfolio_value: float = 500000.0
    ):
        self.ticker = ticker
        self.persona_type = persona_type
        self.trading_pattern = trading_pattern
        self.max_budget = max_budget
        self.portfolio_value = portfolio_value
        
        self.lots: List[PositionLot] = []
        self.state = PositionState.PLANNED
        self.stop_manager = StopLossManager()
        
        # أهداف وستوبات
        self.overall_stop: Optional[float] = None
        self.target_1: Optional[float] = None
        self.target_2: Optional[float] = None
        self.target_3: Optional[float] = None
        
        # تتبع
        self.highest_price: float = 0
        self.lowest_price: float = float('inf')
        self.created_at = datetime.now()
        
        # Journal
        self.actions: List[dict] = []
    
    def plan_entry(
        self,
        entry_price: float,
        stop_loss_pct: float = 5.0,
        target_pct: float = 20.0,
        support_levels: Optional[List[float]] = None
    ) -> dict:
        """
        تخطيط الدخول
        
        يحدد:
        - حجم الدفعات المخططة
        - أسعار الدخول المحتملة
        - الستوبات الجزئية
        - الأهداف
        """
        self.overall_stop = entry_price * (1 - stop_loss_pct / 100)
        # V41: Dynamic targets instead of fixed +10%/+20%
        # Use target_pct parameter if provided (>0), otherwise compute dynamically
        if target_pct > 0 and target_pct != 20.0:
            # Caller provided custom target — use it
            self.target_1 = entry_price * (1 + target_pct / 200)  # T1 = half of target_pct
            self.target_2 = entry_price * (1 + target_pct / 100)  # T2 = full target_pct
        else:
            # Default: still +10%/+20% as baseline, but SmartExitEngine can override
            self.target_1 = entry_price * 1.10  # +10% baseline
            self.target_2 = entry_price * 1.20  # +20% baseline
        self.target_3 = None  # V39.2+V41: No ceiling — trailing stop protects profits on runners
        
        # حساب الدفعات المخططة
        lots_plan = self._calculate_lots_plan(entry_price, support_levels)
        
        self._log_action("plan_entry", {
            "entry_price": entry_price,
            "stop_loss_pct": stop_loss_pct,
            "target_pct": target_pct,
            "lots_plan": lots_plan
        })
        
        return {
            "ticker": self.ticker,
            "entry_price": entry_price,
            "overall_stop": self.overall_stop,
            "targets": {
                "target_1": self.target_1,
                "target_2": self.target_2,
                "target_3": self.target_3
            },
            "lots_plan": lots_plan,
            "max_budget": self.max_budget,
            "trading_pattern": self.trading_pattern.value,
            "message": "خطة الدخول جاهزة. انتظر إشارة الدخول."
        }
    
    def plan_smart_entry(
        self,
        entry_price: float,
        stop_loss_pct: float = 5.0,
        atr: float = 0.0,
        momentum_score: float = 50.0,
        sector_momentum: float = 0.0,
        market_regime: str = "neutral",
        stock_typical_move_15d: float = 5.0,
        is_breakout: bool = False,
        volume_ratio: float = 1.0,
        support_levels: Optional[List[float]] = None
    ) -> dict:
        """
        V41: تخطيط دخول ذكي بأهداف ديناميكية
        
        بدل +10%/+20% ثابتة، بيحسب أهداف بناءً على:
        - ATR (تقلب السهم)
        - زخم السهم والقطاع
        - نوع الحركة (اختراق ولا عادي)
        """
        from .smart_exit_engine import SmartExitEngine
        engine = SmartExitEngine()
        
        dynamic_targets = engine.compute_dynamic_targets(
            entry_price=entry_price,
            atr=atr,
            momentum_score=momentum_score,
            sector_momentum=sector_momentum,
            market_regime=market_regime,
            stock_typical_move_15d=stock_typical_move_15d,
            is_breakout=is_breakout,
            volume_ratio=volume_ratio,
        )
        
        # تطبيق الأهداف الديناميكية
        self.overall_stop = entry_price * (1 - stop_loss_pct / 100)
        self.target_1 = dynamic_targets["target_1"]
        self.target_2 = dynamic_targets["target_2"]
        self.target_3 = dynamic_targets["target_3"]
        
        lots_plan = self._calculate_lots_plan(entry_price, support_levels)
        
        self._log_action("plan_smart_entry", {
            "entry_price": entry_price,
            "stop_loss_pct": stop_loss_pct,
            "dynamic_targets": dynamic_targets,
            "lots_plan": lots_plan
        })
        
        return {
            "ticker": self.ticker,
            "entry_price": entry_price,
            "overall_stop": self.overall_stop,
            "targets": {
                "target_1": self.target_1,
                "target_2": self.target_2,
                "target_3": self.target_3,
                "t1_pct": dynamic_targets["t1_pct"],
                "t2_pct": dynamic_targets["t2_pct"],
                "is_dynamic": True,
                "reason": dynamic_targets["reason"],
            },
            "trailing_activation": dynamic_targets["trailing_activation_pct"],
            "t1_exit_fraction": dynamic_targets["t1_exit_fraction"],
            "lots_plan": lots_plan,
            "max_budget": self.max_budget,
            "trading_pattern": self.trading_pattern.value,
            "message": f"خطة دخول ذكية: T1=+{dynamic_targets['t1_pct']:.1f}%, T2=+{dynamic_targets['t2_pct']:.1f}%. {dynamic_targets['reason']}"
        }

    
    def _calculate_lots_plan(
        self,
        entry_price: float,
        support_levels: Optional[List[float]] = None
    ) -> dict:
        """حساب خطة الدفعات
        
        P4-PROBING-LOT: أول لوت = استطلاع (25% بس).
        فلسفة ليفرمور: اشتري كمية صغيرة → لو طلع أضف → لو نزل قطع.
        اللوت التاني ممنوع يكون بنفس سعر الدخول، لازم يكون بعد تأكيد اختراق.
        """
        
        if support_levels and len(support_levels) >= 3:
            # Level-Based Accumulation
            lots = [
                {"lot_id": 1, "price": entry_price, "pct": self.PROBING_LOT_1_PCT, "trigger": "probing_lot (استطلاع)"},
                {"lot_id": 2, "price": support_levels[0], "pct": self.CONFIRM_LOT_2_PCT, "trigger": f"confirm_1 ({support_levels[0]}) — بعد تأكيد الاختراق"},
                {"lot_id": 3, "price": support_levels[1], "pct": 30, "trigger": f"support_2 ({support_levels[1]})"},
                {"lot_id": 4, "price": support_levels[2], "pct": 15, "trigger": f"support_3 ({support_levels[2]})"}
            ]
        else:
            # Planned Scale-In (Percentage-Based)
            # P4: Lot 1 = 25% (استطلاع), Lot 2 = 30% (بعد تأكيد اختراق)
            lots = [
                {"lot_id": 1, "price": entry_price, "pct": self.PROBING_LOT_1_PCT, "trigger": "probing_lot (استطلاع)"},
                {"lot_id": 2, "price": entry_price * 0.95, "pct": self.CONFIRM_LOT_2_PCT, "trigger": "-5% (بعد تأكيد الاختراق)"},
                {"lot_id": 3, "price": entry_price * 0.90, "pct": 30, "trigger": "-10%"},
                {"lot_id": 4, "price": entry_price * 0.85, "pct": 15, "trigger": "-15%"}
            ]
        
        # حساب الحجم لكل دفعة
        for lot in lots:
            lot["budget"] = self.max_budget * (lot["pct"] / 100)
            lot["shares"] = int(lot["budget"] / lot["price"])
            lot["stop"] = lot["price"] * 0.95  # -5% for each lot
        
        return {
            "method": "level_based" if support_levels else "percentage_based",
            "lots": lots,
            "avg_price_target": sum(l["price"] * l["pct"] for l in lots) / 100
        }
    
    def add_lot(
        self,
        entry_price: float,
        shares: int,
        stop_loss: Optional[float] = None,
        target: Optional[float] = None,
        bullish_order_block: Optional[float] = None,
        ob_top: Optional[float] = None,
        ob_bottom: Optional[float] = None,
        maker_state: Optional[str] = None,
    ) -> dict:
        """إضافة دفعة جديدة للمركز
        
        Phase 2 (V40): Scale-in Guards — لا chasing!
        - الشرط A: الميكرز بيجمع (maker_state في absorption/accumulation)
        - الشرط B: السعر قرب الدخول (within -3%) OR قرب Bullish Order Block
        - لو السهم طالع بعيد عن الدخول ومفيش OB → ممنوع الإضافة
        """
        
        # التحقق من الحدود
        if len(self.lots) >= self.MAX_LOTS:
            return {
                "success": False,
                "error": f"Maximum lots reached ({self.MAX_LOTS})",
                "error_ar": f"وصلت للحد الأقصى من الدفعات ({self.MAX_LOTS})"
            }
        
        # ── Phase 2 (V40): Scale-in Anti-Chasing Guard ──
        # لما يكون فيه دفعات سابقة (scale-in مش أول دخول):
        # لازم السعر يكون قرب الدخول أو قرب Bullish OB + الميكرز بيجمع
        # P4-PROBING-LOT: اللوت التاني ممنوع يكون بنفس سعر الدخول — لازم تأكيد اختراق
        if self.lots and entry_price >= self.lots[-1].entry_price:
            # السعر أعلى من آخر دفعة — محتاج نتحقق
            _first_entry = self.lots[0].entry_price
            _pct_from_entry = ((entry_price - _first_entry) / _first_entry) * 100 if _first_entry > 0 else 0

            # P4: Lot 2 ممنوع يكون بنفس سعر الدخول (لازم تأكيد اختراق أو رجوع لـ OB)
            if len(self.lots) == 1 and abs(_pct_from_entry) < 0.5:
                return {
                    "success": False,
                    "error": f"Probing Lot rule: Lot 2 cannot be at same price as Lot 1 (need breakout confirmation)",
                    "error_ar": "قاعدة الاستطلاع: اللوت التاني مش ممكن يكون بنفس سعر الدخول — لازم تأكيد اختراق أو رجوع لمنطقة طلب (OB)"
                }

            _near_entry = _pct_from_entry <= 3.0  # within +3% of original entry (pullback OK)
            
            # Check near Bullish Order Block
            _near_ob = False
            if bullish_order_block and bullish_order_block > 0:
                _ob_t = float(ob_top or bullish_order_block)
                _ob_b = float(ob_bottom or bullish_order_block)
                _near_ob = _ob_b <= entry_price <= (_ob_t * 1.01)
            
            # Check maker state = accumulation
            _is_accumulation = maker_state in ('absorption', 'accumulation') if maker_state else True
            
            # Block if: price too far AND no OB AND no accumulation
            if not _near_entry and not _near_ob:
                return {
                    "success": False,
                    "error": f"Chasing blocked: price {entry_price:.2f} is +{_pct_from_entry:.1f}% from entry (max +3%)",
                    "error_ar": f"ممنوع الإضافة (Chasing): السعر {entry_price:.2f} طالع +{_pct_from_entry:.1f}% عن الدخول — لازم يكون قرب الـ Order Block أو ضمن -3%"
                }
            
            if not _is_accumulation and not _near_ob:
                return {
                    "success": False,
                    "error": "Scale-in blocked: no institutional accumulation detected",
                    "error_ar": "ممنوع الإضافة: الميكرز مش بيجمع — لازم يكون فيه تجميع مؤسسي أو رجوع للـ Order Block"
                }
        
        # حساب الستوب
        if not stop_loss:
            stop_result = self.stop_manager.calculate_fixed_stop(entry_price)
            stop_loss = stop_result.stop_price
        
        lot = PositionLot(
            lot_id=len(self.lots) + 1,
            entry_price=entry_price,
            shares=shares,
            entry_date=datetime.now(),
            stop_loss=stop_loss,
            target_price=target or entry_price * 1.15
        )
        
        self.lots.append(lot)
        self.state = PositionState.ACTIVE if len(self.lots) == 1 else PositionState.ACCUMULATING
        
        self._log_action("add_lot", lot.to_dict())
        
        return {
            "success": True,
            "lot": lot.to_dict(),
            "metrics": self.get_metrics(entry_price).to_dict(),
            "message": f"تمت إضافة الدفعة {lot.lot_id}"
        }
    
    def get_metrics(self, current_price: float) -> PositionMetrics:
        """حساب مقاييس المركز الحالية"""
        
        if not self.lots:
            return PositionMetrics(
                total_shares=0,
                weighted_avg_price=0,
                total_value=0,
                current_value=0,
                total_return_pct=0,
                total_risk=0,
                current_risk_reward=0,
                days_held=0,
                max_lots_allowed=self.MAX_LOTS,
                current_lots=0
            )
        
        # حساب المتوسط المرجح
        total_shares = sum(lot.shares for lot in self.lots if lot.status == "active")
        total_cost = sum(lot.entry_price * lot.shares for lot in self.lots if lot.status == "active")
        weighted_avg = total_cost / total_shares if total_shares > 0 else 0
        
        # تحديث أعلى وأدنى سعر
        self.highest_price = max(self.highest_price, current_price)
        self.lowest_price = min(self.lowest_price, current_price)
        
        # حساب المخاطر
        total_risk = sum(
            (lot.entry_price - lot.stop_loss) * lot.shares 
            for lot in self.lots 
            if lot.status == "active"
        )
        
        # حساب R:R
        if self.target_1 and self.overall_stop:
            potential_profit = (self.target_1 - weighted_avg) * total_shares
            potential_loss = (weighted_avg - self.overall_stop) * total_shares
            risk_reward = potential_profit / potential_loss if potential_loss > 0 else 0
        else:
            risk_reward = 0
        
        # الأيام
        first_entry = min(lot.entry_date for lot in self.lots)
        days_held = (datetime.now() - first_entry).days
        
        return PositionMetrics(
            total_shares=total_shares,
            weighted_avg_price=weighted_avg,
            total_value=total_cost,
            current_value=current_price * total_shares,
            total_return_pct=((current_price - weighted_avg) / weighted_avg) * 100 if weighted_avg > 0 else 0,
            total_risk=total_risk,
            current_risk_reward=risk_reward,
            days_held=days_held,
            max_lots_allowed=self.MAX_LOTS,
            current_lots=len([l for l in self.lots if l.status == "active"])
        )
    
    def check_stops(self, current_price: float, atr: Optional[float] = None) -> dict:
        """فحص كل الستوبات"""
        
        triggered_stops = []
        
        for lot in self.lots:
            if lot.status != "active":
                continue
            
            if current_price <= lot.stop_loss:
                triggered_stops.append({
                    "lot_id": lot.lot_id,
                    "stop_price": lot.stop_loss,
                    "triggered": True,
                    "action": "exit_lot",
                    "message": f"Stop loss triggered for lot {lot.lot_id} at {lot.stop_loss}"
                })
        
        # فحص الستوب الزمني
        metrics = self.get_metrics(current_price)
        if self.lots:
            time_check = self.stop_manager.calculate_time_stop(
                self.lots[0].entry_price,
                self.lots[0].entry_date,
                current_price
            )

            if time_check and time_check.triggered:
                triggered_stops.append({
                    "lot_id": "all",
                    "stop_type": "time_stop",
                    "triggered": True,
                    "action": "exit_all",
                    "message": time_check.message_ar
                })
        
        # فحص Trailing Stop
        if atr and self.highest_price > 0:
            trailing = self.stop_manager.calculate_trailing_stop(
                self.highest_price, atr, current_price,
                self.lots[0].entry_price if self.lots else current_price
            )
            if trailing.triggered:
                triggered_stops.append({
                    "lot_id": "all",
                    "stop_type": "trailing_stop",
                    "triggered": True,
                    "action": "exit_all",
                    "message": trailing.message_ar
                })
        
        return {
            "ticker": self.ticker,
            "current_price": current_price,
            "triggered_stops": triggered_stops,
            "action_required": len(triggered_stops) > 0,
            "metrics": metrics.to_dict()
        }
    
    def partial_exit(
        self,
        shares_to_sell: int,
        current_price: float,
        reason: str = "profit_taking"
    ) -> dict:
        """خروج جزئي (جني أرباح)"""
        
        remaining = shares_to_sell
        sold_from_lots = []
        total_profit = 0
        
        # بيع من أحدث الدفعات أولاً (LIFO) للرابح
        # أو من أقدم الدفعات (FIFO) للخاسر
        sorted_lots = sorted(
            [l for l in self.lots if l.status == "active"],
            key=lambda x: x.entry_price,
            reverse=(current_price > self.get_metrics(current_price).weighted_avg_price)
        )
        
        for lot in sorted_lots:
            if remaining <= 0:
                break
            
            if lot.shares >= remaining:
                sold = remaining
                lot.shares -= remaining
                remaining = 0
            else:
                sold = lot.shares
                remaining -= lot.shares
                lot.shares = 0
                lot.status = "closed"
            
            profit = (current_price - lot.entry_price) * sold
            total_profit += profit
            
            sold_from_lots.append({
                "lot_id": lot.lot_id,
                "shares_sold": sold,
                "entry_price": lot.entry_price,
                "exit_price": current_price,
                "profit": profit
            })
        
        self._log_action("partial_exit", {
            "shares_sold": shares_to_sell - remaining,
            "price": current_price,
            "reason": reason,
            "profit": total_profit
        })
        
        return {
            "success": True,
            "shares_sold": shares_to_sell - remaining,
            "total_profit": round(total_profit, 2),
            "sold_from_lots": sold_from_lots,
            "remaining_metrics": self.get_metrics(current_price).to_dict()
        }
    
    def close_position(
        self,
        current_price: float,
        reason: str = "manual"
    ) -> dict:
        """إغلاق المركز بالكامل"""
        
        total_shares = sum(lot.shares for lot in self.lots if lot.status == "active")
        total_cost = sum(lot.entry_price * lot.shares for lot in self.lots if lot.status == "active")
        total_value = current_price * total_shares
        profit = total_value - total_cost
        profit_pct = (profit / total_cost) * 100 if total_cost > 0 else 0
        
        # إغلاق كل الدفعات
        for lot in self.lots:
            if lot.status == "active":
                lot.status = "closed"
        
        self.state = PositionState.CLOSED if reason != "stop_loss" else PositionState.STOPPED
        
        self._log_action("close_position", {
            "price": current_price,
            "reason": reason,
            "profit": profit,
            "profit_pct": profit_pct
        })
        
        return {
            "success": True,
            "ticker": self.ticker,
            "exit_price": current_price,
            "total_shares": total_shares,
            "profit": round(profit, 2),
            "profit_pct": round(profit_pct, 2),
            "reason": reason,
            "lots_summary": [lot.to_dict() for lot in self.lots]
        }
    
    def _log_action(self, action: str, details: dict):
        """تسجيل الإجراء"""
        self.actions.append({
            "timestamp": datetime.now().isoformat(),
            "action": action,
            "details": details
        })
    
    def to_dict(self, current_price: float = 0) -> dict:
        """تحويل لـ dictionary"""
        metrics = self.get_metrics(current_price) if current_price > 0 else None
        
        return {
            "ticker": self.ticker,
            "persona_type": self.persona_type,
            "trading_pattern": self.trading_pattern.value,
            "state": self.state.value,
            "max_budget": self.max_budget,
            "overall_stop": self.overall_stop,
            "targets": {
                "target_1": self.target_1,
                "target_2": self.target_2,
                "target_3": self.target_3
            },
            "lots": [lot.to_dict() for lot in self.lots],
            "metrics": metrics.to_dict() if metrics else None,
            "highest_price": self.highest_price,
            "lowest_price": self.lowest_price,
            "created_at": self.created_at.isoformat(),
            "actions_count": len(self.actions)
        }


__all__ = [
    'PositionManager', 'PositionState', 'PositionLot', 
    'PositionMetrics', 'TradingPattern'
]
