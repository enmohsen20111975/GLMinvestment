"""
Stop Loss Manager
=================
مدير أنواع الستوبات المختلفة

بناءً على PORTFOLIO_STRATEGY_BIBLE_v1.0.md - الفصل الثاني

أنواع الستوبات:
1. Time Stop - ستوب زمني
2. Volatility Stop (ATR-Based) - ستوب التقلبات
3. Trailing Stop (Chandelier Exit) - ستوب متحرك
4. Tiered Exit Stop - ستوب جزئي متدرج
5. Portfolio Heat Stop - ستوب على مستوى المحفظة
"""

from dataclasses import dataclass, field
from typing import Optional, List, Literal
from datetime import datetime, timedelta
from enum import Enum
import math

try:
    from analyzers.engine_settings import get_setting as _get_setting
except ImportError:
    def _get_setting(key, default=None):
        return default


class StopType(str, Enum):
    """أنواع الستوبات"""
    TIME = "time"                         # ستوب زمني
    VOLATILITY = "volatility"             # ستوب تقلبات (ATR)
    TRAILING = "trailing"                 # ستوب متحرك
    TIERED = "tiered"                     # ستوب متدرج
    PORTFOLIO_HEAT = "portfolio_heat"     # ستوب حرارة المحفظة
    FIXED = "fixed"                       # ستوب ثابت
    BREAK_EVEN = "break_even"             # ستوب نقطة التعادل


@dataclass
class StopResult:
    """نتيجة حساب الستوب"""
    stop_type: StopType
    stop_price: float
    distance_pct: float
    triggered: bool
    message: str
    message_ar: str
    details: dict = field(default_factory=dict)
    
    def to_dict(self) -> dict:
        return {
            "stop_type": self.stop_type.value,
            "stop_price": round(self.stop_price, 4),
            "distance_pct": round(self.distance_pct, 2),
            "triggered": self.triggered,
            "message": self.message,
            "message_ar": self.message_ar,
            "details": self.details
        }


class StopLossManager:
    """مدير الستوبات"""
    
    def __init__(
        self,
        default_stop_pct: float = None,
        max_stop_pct: float = None,
        atr_multiplier: float = None,
        trailing_atr_multiplier: float = None,
        time_stop_days: int = None  # None = read from engine_settings (default 45 days for dead money detection)
    ):
        # FIX: ALL values read from engine_settings — no hardcoded defaults
        self.default_stop_pct = default_stop_pct if default_stop_pct is not None else _get_setting('default_stop_pct', default=5.0)
        self.max_stop_pct = max_stop_pct if max_stop_pct is not None else _get_setting('position_max_stop_pct', default=10.0)
        self.atr_multiplier = atr_multiplier if atr_multiplier is not None else _get_setting('volatility_stop_atr_mult', default=2.5)
        self.trailing_atr_multiplier = trailing_atr_multiplier if trailing_atr_multiplier is not None else _get_setting('trailing_stop_atr_mult', default=2.0)
        self.time_stop_days = time_stop_days if time_stop_days is not None else int(_get_setting('time_stop_days', default=45))
    
    def calculate_fixed_stop(
        self,
        entry_price: float,
        stop_pct: Optional[float] = None
    ) -> StopResult:
        """
        حساب الستوب الثابت
        
        القاعدة: Stop = Entry × (1 - stop_pct/100)
        """
        stop_pct = stop_pct or self.default_stop_pct
        stop_pct = min(stop_pct, self.max_stop_pct)
        stop_price = entry_price * (1 - stop_pct / 100)
        
        return StopResult(
            stop_type=StopType.FIXED,
            stop_price=stop_price,
            distance_pct=stop_pct,
            triggered=False,
            message=f"Fixed stop at {stop_pct}% below entry",
            message_ar=f"ستوب ثابت على بعد {stop_pct}% من الدخول",
            details={"entry_price": entry_price, "stop_pct": stop_pct}
        )
    
    def calculate_time_stop(
        self,
        entry_price: float,
        entry_date: datetime,
        current_price: float,
        current_date: Optional[datetime] = None,
        max_days: Optional[int] = None,
        min_movement_pct: float = 3.0
    ) -> StopResult:
        """
        حساب الستوب الزمني — Dead Money Detector
        
        القاعدة: إذا لم يتحرك السعر ±3% خلال 45 يوم → اخرج (المال المقيد = فرصة ضائعة)
        
        EGX-specific: 45 يوم مش قليل — الأسهم المصرية ممكن تظل نايمة 30 يوم
        وبعدين تطير. لكن 45 يوم بلا حركة = المال مقيد فعلاً.
        """
        # Read from engine_settings if not overridden
        if self.time_stop_days <= 0:
            self.time_stop_days = int(_get_setting('time_stop_days', 45))
        
        if self.time_stop_days <= 0:
            return None

        current_date = current_date or datetime.now()
        max_days = max_days or self.time_stop_days
        
        days_held = (current_date - entry_date).days
        price_change_pct = ((current_price - entry_price) / entry_price) * 100
        
        triggered = False
        message = f"Time stop check: {days_held}/{max_days} days"
        message_ar = f"فحص الستوب الزمني: {days_held}/{max_days} يوم"
        
        if days_held >= max_days and abs(price_change_pct) < min_movement_pct:
            triggered = True
            message = f"Time Stop triggered: {days_held} days with only {price_change_pct:.1f}% movement"
            message_ar = f"الستوب الزمني فعّال: {days_held} يوم بحركة {price_change_pct:.1f}% فقط"
        
        return StopResult(
            stop_type=StopType.TIME,
            stop_price=current_price,  # Exit at current price
            distance_pct=0,
            triggered=triggered,
            message=message,
            message_ar=message_ar,
            details={
                "days_held": days_held,
                "max_days": max_days,
                "price_change_pct": round(price_change_pct, 2),
                "min_movement_required": min_movement_pct
            }
        )
    
    def calculate_volatility_stop(
        self,
        entry_price: float,
        atr: float,
        current_price: Optional[float] = None
    ) -> StopResult:
        """
        حساب الستوب بناءً على التقلبات (ATR-Based)
        
        القاعدة: Stop = Entry - (ATR_Multiplier × ATR)
        
        المنطق: السهم المتقلب يحتاج ستوب أوسع
        """
        current_price = current_price or entry_price
        stop_price = entry_price - (self.atr_multiplier * atr)
        
        # تطبيق الحد الأقصى
        max_stop_price = entry_price * (1 - self.max_stop_pct / 100)
        stop_price = max(stop_price, max_stop_price)
        
        distance_pct = ((entry_price - stop_price) / entry_price) * 100
        
        return StopResult(
            stop_type=StopType.VOLATILITY,
            stop_price=stop_price,
            distance_pct=distance_pct,
            triggered=current_price <= stop_price,
            message=f"ATR-based stop at {distance_pct:.1f}% (ATR: {atr:.2f})",
            message_ar=f"ستوب ATR على بعد {distance_pct:.1f}% (ATR: {atr:.2f})",
            details={
                "atr": atr,
                "atr_multiplier": self.atr_multiplier,
                "entry_price": entry_price
            }
        )
    
    def calculate_trailing_stop(
        self,
        highest_high: float,
        atr: float,
        current_price: float,
        entry_price: float,
        activation_gain_pct: Optional[float] = None
    ) -> StopResult:
        """
        حساب الستوب المتحرك (Chandelier Exit)
        
        القاعدة: Trailing_Stop = Highest_High - (trailing_stop_atr_mult × ATR)
        التفعيل: لو الربح ≥ trailing_stop_activation_gain% → فعّل الستوب المتحرك
        
        المنطق: اترك الربح يركض، اقطعه إذا تراجع
        """
        # V40 FIX: Activation gain read from engine_settings — default lowered from 3.0 to 2.0 for earlier trailing activation
        if activation_gain_pct is None:
            activation_gain_pct = _get_setting('trailing_stop_activation_gain', default=2.0)
        
        gain_pct = ((current_price - entry_price) / entry_price) * 100
        
        # لو الربح مش كافي لتفعيل الستوب المتحرك → رجّع ستوب ثابت
        if gain_pct < activation_gain_pct:
            return StopResult(
                stop_type=StopType.TRAILING,
                stop_price=entry_price * (1 - self.default_stop_pct / 100),
                distance_pct=self.default_stop_pct,
                triggered=False,
                message=f"Trailing stop not active (gain {gain_pct:.1f}% < {activation_gain_pct}% threshold)",
                message_ar=f"الستوب المتحرك مش فعّال (ربح {gain_pct:.1f}% < {activation_gain_pct}%)",
                details={
                    "highest_high": highest_high,
                    "atr": atr,
                    "gain_pct": round(gain_pct, 2),
                    "activation_gain_pct": activation_gain_pct,
                    "active": False
                }
            )
        
        stop_price = highest_high - (self.trailing_atr_multiplier * atr)
        
        # لا ينزل الستوب تحت نقطة الدخول أبداً
        if stop_price < entry_price:
            stop_price = entry_price * 1.01  # Break-even + 1%
        
        distance_from_high = ((highest_high - stop_price) / highest_high) * 100
        distance_from_current = ((current_price - stop_price) / current_price) * 100
        
        triggered = current_price <= stop_price
        
        return StopResult(
            stop_type=StopType.TRAILING,
            stop_price=stop_price,
            distance_pct=distance_from_current,
            triggered=triggered,
            message=f"Trailing stop at {stop_price:.2f} ({distance_from_high:.1f}% from high)",
            message_ar=f"ستوب متحرك عند {stop_price:.2f} ({distance_from_high:.1f}% من القمة)",
            details={
                "highest_high": highest_high,
                "atr": atr,
                "distance_from_high_pct": round(distance_from_high, 2),
                "gain_pct": round(gain_pct, 2),
                "activation_gain_pct": activation_gain_pct,
                "active": True
            }
        )
    
    def calculate_tiered_stop(
        self,
        entry_price: float,
        current_price: float,
        target_1: float,
        target_2: Optional[float] = None,
        target_3: Optional[float] = None,
        initial_stop_pct: Optional[float] = None
    ) -> StopResult:
        """
        حساب الستوب المتدرج
        
        القواعد:
        - قبل Target 1: Entry - tiered_stop_before_t1_pct (من engine_settings، default 8%)
        - بعد Target 1: Break-even + 1%
        - بعد Target 2: Target 1 + 1%
        - بعد Target 3: Trailing على الباقي
        """
        # FIX: Tiered stop thresholds read from engine_settings
        if initial_stop_pct is None:
            initial_stop_pct = _get_setting('tiered_stop_before_t1_pct', default=8.0)
        current_pct = ((current_price - entry_price) / entry_price) * 100
        target_1_pct = ((target_1 - entry_price) / entry_price) * 100
        
        # تحديد المرحلة
        if current_price < target_1:
            # قبل Target 1 — وقف أولي واسع
            stop_price = entry_price * (1 - initial_stop_pct / 100)
            phase = "before_target_1"
            message = f"Initial stop at -{initial_stop_pct}%"
            message_ar = f"الستوب الأولي على -{initial_stop_pct}%"
        elif target_2 and current_price < target_2:
            # بين Target 1 و Target 2 — نقطة تعادل
            stop_price = entry_price * 1.01  # Break-even + 1%
            phase = "after_target_1"
            message = "Break-even + 1% stop (Target 1 hit)"
            message_ar = "ستوب نقطة التعادل + 1% (الهدف 1 تحقق)"
        elif target_3 and current_price < target_3:
            # بين Target 2 و Target 3
            stop_price = target_1 * 1.01
            phase = "after_target_2"
            message = "Target 1 + 1% stop (Target 2 hit)"
            message_ar = "ستوب الهدف 1 + 1% (الهدف 2 تحقق)"
        else:
            # بعد كل الأهداف
            stop_price = (target_2 or target_1) * 1.01
            phase = "after_all_targets"
            message = "Trailing from last target"
            message_ar = "ستوب متحرك من آخر هدف"
        
        distance_pct = ((current_price - stop_price) / current_price) * 100
        triggered = current_price <= stop_price
        
        return StopResult(
            stop_type=StopType.TIERED,
            stop_price=stop_price,
            distance_pct=distance_pct,
            triggered=triggered,
            message=message,
            message_ar=message_ar,
            details={
                "phase": phase,
                "entry_price": entry_price,
                "current_price": current_price,
                "target_1": target_1,
                "target_2": target_2,
                "target_3": target_3,
                "current_return_pct": round(current_pct, 2),
                "initial_stop_pct": initial_stop_pct
            }
        )
    
    def calculate_portfolio_heat_stop(
        self,
        portfolio_value: float,
        position_value: float,
        max_heat_pct: Optional[float] = None
    ) -> StopResult:
        """
        حساب الستوب بناءً على حرارة المحفظة
        
        القاعدة: لا تخسر أكثر من X% من المحفظة في صفقة واحدة
        
        المنطق: الستوب الواسع = المركز الأصغر
        
        FIX: max_heat_pct reads from engine_settings ('max_portfolio_heat_pct') instead of hardcoded 2%
        """
        # FIX: Read portfolio heat from engine_settings instead of hardcoded 2%
        if max_heat_pct is None:
            max_heat_pct = _get_setting('max_portfolio_heat_pct', default=2.0)
        max_loss_amount = portfolio_value * (max_heat_pct / 100)
        max_stop_pct = (max_loss_amount / position_value) * 100
        
        # تطبيق الحد الأقصى
        max_stop_pct = min(max_stop_pct, self.max_stop_pct)
        
        message = f"Max allowed stop: {max_stop_pct:.1f}% (Portfolio heat: {max_heat_pct}%)"
        message_ar = f"أقصى ستوب مسموح: {max_stop_pct:.1f}% (حرارة المحفظة: {max_heat_pct}%)"
        
        return StopResult(
            stop_type=StopType.PORTFOLIO_HEAT,
            stop_price=0,  # Needs entry price to calculate
            distance_pct=max_stop_pct,
            triggered=False,
            message=message,
            message_ar=message_ar,
            details={
                "portfolio_value": portfolio_value,
                "position_value": position_value,
                "max_heat_pct": max_heat_pct,
                "max_loss_amount": max_loss_amount
            }
        )
    
    def calculate_break_even_stop(
        self,
        entry_price: float,
        current_price: float,
        trigger_pct: Optional[float] = None,
        buffer_pct: float = 1.0
    ) -> StopResult:
        """
        حساب ستوب نقطة التعادل
        
        القاعدة: بمجرد أن يصل السهم +X% → رفع الستوب إلى Entry + 1%
        
        المنطق: "لا تدع الربح يتحول لخسارة"
        
        FIX: trigger_pct reads from engine_settings ('breakeven_trigger_pct') instead of hardcoded 7%
        """
        # FIX: Read breakeven trigger from engine_settings instead of hardcoded 7%
        if trigger_pct is None:
            trigger_pct = _get_setting('breakeven_trigger_pct', default=7.0)
        current_return = ((current_price - entry_price) / entry_price) * 100
        
        if current_return >= trigger_pct:
            stop_price = entry_price * (1 + buffer_pct / 100)
            triggered = False
            message = f"Break-even stop active at +{buffer_pct}%"
            message_ar = f"ستوب نقطة التعادل فعّال على +{buffer_pct}%"
        else:
            stop_price = entry_price
            message = f"Break-even stop will activate at +{trigger_pct}%"
            message_ar = f"ستوب التعادل يُفعّل عند +{trigger_pct}%"
        
        return StopResult(
            stop_type=StopType.BREAK_EVEN,
            stop_price=stop_price,
            distance_pct=current_return,
            triggered=current_price <= stop_price,
            message=message,
            message_ar=message_ar,
            details={
                "entry_price": entry_price,
                "current_return": round(current_return, 2),
                "trigger_pct": trigger_pct,
                "buffer_pct": buffer_pct
            }
        )
    
    def calculate_partial_exit(
        self,
        entry_price: float,
        current_price: float,
        stop_loss: float,
        target_1: Optional[float] = None,
        highest_high: Optional[float] = None,
        atr: Optional[float] = None,
    ) -> dict:
        """
        V40: حساب الخروج الجزئي عند أول هدف (Partial Exit at 1.5R).

        الفلسفة: اخروج 50% من المركز عند الوصول لـ 1.5R (أول هدف)،
        وارفع الستوب على الباقي لنقطة التعادل + تفعيل trailing.
        ده بيقلل الـ Max Drawdown ويحمي الأرباح بدري.

        Returns:
            dict فيه:
              - should_partial_exit: bool — هل وصل السعر لـ 1R؟
              - partial_exit_pct: float — نسبة الخروج (50%)
              - partial_exit_price: float — سعر الخروج الجزئي (current_price)
              - remaining_stop: float — الستوب على الباقي (breakeven أو trailing)
              - remaining_stop_type: str — نوع الستوب على الباقي
              - message_ar: str — شرح عربي
              - details: dict
        """
        # اقرأ الإعدادات من engine_settings — Phase C: default موحّد مع engine_settings (1.5).
        # كان 1.0 stale (V40.0 fallback) — التناقض الموثّق في C-explore.
        _partial_at_rr = _get_setting('partial_exit_at_rr', default=1.5)
        _partial_pct = _get_setting('partial_exit_pct', default=50.0)
        _trail_remaining = _get_setting('partial_exit_trail_remaining', default=1.0)

        # حساب 1R (أول هدف = entry + risk)
        risk = entry_price - stop_loss
        if risk <= 0:
            return {
                'should_partial_exit': False,
                'partial_exit_pct': 0.0,
                'partial_exit_price': 0.0,
                'remaining_stop': stop_loss,
                'remaining_stop_type': 'fixed',
                'message_ar': 'وقف غير صالح (risk <= 0)',
                'details': {'risk': risk},
            }

        first_target = entry_price + (risk * _partial_at_rr)
        gain_pct = ((current_price - entry_price) / entry_price) * 100
        should_exit = current_price >= first_target

        # الستوب على الباقي
        if not should_exit:
            # لسه ما وصلناش لـ 1R → الستوب الأصلي
            remaining_stop = stop_loss
            remaining_type = 'fixed'
            msg = f'الخروج الجزئي لم يُفعّل بعد (ربح {gain_pct:.1f}% < 1R)'
        else:
            # وصلنا لـ 1R → اخروج 50% + ارفع الستوب على الباقي
            # الستوب على الباقي = breakeven (entry + 1%) أو trailing لو متاح
            breakeven_stop = entry_price * 1.01

            if _trail_remaining >= 1.0 and highest_high and atr and atr > 0:
                # trailing على الباقي
                trailing_atr_mult = _get_setting('trailing_stop_atr_mult', default=2.0)
                trailing_stop = highest_high - (trailing_atr_mult * atr)
                # FLOOR: الستوب ما ينزلش تحت breakeven
                remaining_stop = max(trailing_stop, breakeven_stop)
                remaining_type = 'trailing'
                msg = (f'✅ خروج جزئي {_partial_pct:.0f}% عند 1R (ربح {gain_pct:.1f}%) '
                       f'+ trailing على الباقي عند {remaining_stop:.2f}')
            else:
                # breakeven فقط
                remaining_stop = breakeven_stop
                remaining_type = 'breakeven'
                msg = (f'✅ خروج جزئي {_partial_pct:.0f}% عند 1R (ربح {gain_pct:.1f}%) '
                       f'+ breakeven على الباقي عند {remaining_stop:.2f}')

        return {
            'should_partial_exit': should_exit,
            'partial_exit_pct': _partial_pct if should_exit else 0.0,
            'partial_exit_price': current_price if should_exit else 0.0,
            'remaining_stop': round(remaining_stop, 4),
            'remaining_stop_type': remaining_type,
            'message_ar': msg,
            'details': {
                'entry_price': entry_price,
                'current_price': current_price,
                'stop_loss': stop_loss,
                'first_target_1r': round(first_target, 4),
                'gain_pct': round(gain_pct, 2),
                'risk': round(risk, 4),
                'partial_at_rr': _partial_at_rr,
                'partial_pct': _partial_pct,
                'trail_remaining_active': _trail_remaining >= 1.0,
            },
        }

    def get_optimal_stop(
        self,
        entry_price: float,
        current_price: float,
        atr: Optional[float] = None,
        highest_high: Optional[float] = None,
        entry_date: Optional[datetime] = None,
        target_1: Optional[float] = None,
        portfolio_value: Optional[float] = None,
        position_value: Optional[float] = None,
        persona_stop_pct: float = 8.0
    ) -> dict:
        """
        الحصول على الستوب الأمثل بناءً على كل المعايير
        """
        stops = []
        
        # 1. Fixed Stop
        fixed = self.calculate_fixed_stop(entry_price, persona_stop_pct)
        stops.append(fixed)
        
        # 2. Volatility Stop (if ATR available)
        if atr:
            vol = self.calculate_volatility_stop(entry_price, atr, current_price)
            stops.append(vol)
        
        # 3. Trailing Stop (if highest high available)
        if highest_high and atr:
            trail = self.calculate_trailing_stop(highest_high, atr, current_price, entry_price)
            stops.append(trail)
        
        # 4. Time Stop (if entry date available)
        if entry_date:
            time_stop = self.calculate_time_stop(entry_price, entry_date, current_price)
            stops.append(time_stop)
        
        # 5. Tiered Stop (if targets available)
        if target_1:
            tiered = self.calculate_tiered_stop(entry_price, current_price, target_1)
            stops.append(tiered)
        
        # 6. Break-even Stop
        breakeven = self.calculate_break_even_stop(entry_price, current_price)
        stops.append(breakeven)
        
        # V39.2: ATR-first stop selection — prefer ATR/volatility stops over fixed stops.
        # If ATR stop is available AND tighter than fixed stop (ATR stop price > fixed stop price), use ATR stop.
        # If ATR stop is NOT available, fall back to fixed stop.
        atr_stop = next((s for s in stops if s.stop_type == StopType.VOLATILITY and s.stop_price > 0), None)
        fixed_stop = next((s for s in stops if s.stop_type == StopType.FIXED and s.stop_price > 0), None)

        if atr_stop and fixed_stop:
            if atr_stop.stop_price >= fixed_stop.stop_price:
                # ATR stop is tighter (closer to current price) — use it
                best_stop = atr_stop
            else:
                # ATR stop is wider — fall back to fixed (more protective)
                best_stop = fixed_stop
        elif atr_stop:
            best_stop = atr_stop
        elif fixed_stop:
            best_stop = fixed_stop
        else:
            # Fallback: pick highest stop from remaining
            active_stops = [s for s in stops if s.stop_price > 0]
            best_stop = max(active_stops, key=lambda s: s.stop_price) if active_stops else fixed
        
        # V40: Partial Exit calculation
        partial_exit = None
        if target_1 and entry_price:
            _sl_for_partial = best_stop.stop_price if best_stop else (entry_price * (1 - self.default_stop_pct / 100))
            partial_exit = self.calculate_partial_exit(
                entry_price=entry_price,
                current_price=current_price,
                stop_loss=_sl_for_partial,
                target_1=target_1,
                highest_high=highest_high,
                atr=atr,
            )

        return {
            "optimal_stop": best_stop.to_dict(),
            "all_stops": [s.to_dict() for s in stops],
            "recommendation": best_stop.message_ar,
            # V40: Partial Exit info
            "partial_exit": partial_exit,
        }


__all__ = ['StopLossManager', 'StopType', 'StopResult']
