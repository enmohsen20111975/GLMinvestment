"""
Risk Manager - Adaptive Version
===============================
إدارة المخاطر المرنة

القاعدة الذهبية: Stop Loss مرن حسب Signal + Volatility + Liquidity

Features:
- Adaptive Stop Loss based on signal strength
- Volatility-adjusted stops
- Liquidity-aware position sizing
- Risk profile for each signal type
- R:R validation (minimum 1.5 for any trade)
- Penny stock rejection (price < 1.00 EGP)

CRITICAL RULES:
- R:R < 1.5 = REJECT (no professional trader accepts less)
- Target MUST be above entry price
- Stop Loss MUST be below entry price
- Penny stocks (price < 1.00 EGP) = EXCLUDED

Author: دليل الاستثمار (Based on Kemi's Analysis)
Updated: Fixed R:R calculation bugs + Target calculation bugs
"""

from typing import Dict, Literal, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum


class SignalStrength(Enum):
    """قوة الإشارة"""
    STRONG_BUY = "STRONG_BUY"
    BUY = "BUY"
    ACCUMULATE = "ACCUMULATE"
    HOLD = "HOLD"
    REDUCE = "REDUCE"
    SELL = "SELL"
    STRONG_SELL = "STRONG_SELL"


class LiquidityLevel(Enum):
    """مستوى السيولة"""
    HIGHLY_LIQUID = "HIGHLY_LIQUID"
    LIQUID = "LIQUID"
    ILLIQUID = "ILLIQUID"
    EXCLUDED = "EXCLUDED"
    HIGH = "HIGH"
    WEAK = "WEAK"
    MODERATE = "MODERATE"


# إشارات البيع (SHORT direction) — أي إشارة من دي بتخلي direction='SHORT'
SELL_SIGNALS = {'SELL', 'STRONG_SELL', 'REDUCE', 'SHORT', 'WEAK_SELL', 'BEARISH', 'UNDERWEIGHT'}


def _direction_from_signal(signal: str) -> Literal['LONG', 'SHORT']:
    """استنتج الاتجاه (LONG/SHORT) من نص الإشارة. افتراضي LONG."""
    if not signal:
        return 'LONG'
    return 'SHORT' if str(signal).upper().strip() in SELL_SIGNALS else 'LONG'


@dataclass
class RiskProfile:
    """ملف المخاطر الكامل (Type-Safe — direction-aware).

    الـ direction بتتحدد من الـ signal تلقائياً في __post_init__:
      - SELL/STRONG_SELL/REDUCE/SHORT/WEAK_SELL/BEARISH → 'SHORT'
      - أي حاجة تانية (BUY/STRONG_BUY/ACCUMULATE/HOLD/...) → 'LONG'

    validation الـ __post_init__ بيصحّح الأرقام المعكوسة:
      - LONG + target <= entry → target = entry * 1.05 (فوق)
      - LONG + stop  >= entry → stop  = entry * 0.95 (تحت)
      - SHORT + target >= entry → target = entry * 0.95 (تحت) ← ده كان الـ bug
      - SHORT + stop  <= entry → stop  = entry * 1.05 (فوق) ← ده كان الـ bug
    """
    signal: str
    entry_price: float

    # Position Sizing
    position_size_pct: float      # % of portfolio
    max_shares: int

    # Stop Loss
    stop_loss_price: float
    stop_loss_pct: float
    stop_type: str                # 'FIXED', 'TRAILING', 'VOLATILITY_BASED'

    # Take Profit
    target_price: float
    target_pct: float
    risk_reward_ratio: float

    # Time
    time_stop_days: int           # Maximum holding period

    # Adjustments
    volatility_adjustment: float
    liquidity_adjustment: float

    # Warnings
    warnings: list = field(default_factory=list)

    # Direction (Phase 8 — Type-Safe Risk Profile)
    # بيتعمله auto-derive من الـ signal في __post_init__، لكن ممكن يتـ override صراحة.
    direction: Literal['LONG', 'SHORT'] = 'LONG'

    def __post_init__(self):
        """
        Phase 8 — Type-Safe Risk Profile validation.

        بيـ auto-derive الـ direction من الـ signal (لو الـ caller ما حددش direction صراحة)،
        وبعدين بيصحّح الـ target/stop لو معكوسين بالنسبة للاتجاه.
        """
        # 1) Auto-derive direction من الـ signal (لو الـ default 'LONG' مش matching)
        derived = _direction_from_signal(self.signal)
        # لو الـ direction اللي جاي من بره مش matching الـ signal، نثق في الـ signal
        # (الـ caller ممكن يبعت direction='LONG' بالغلط مع signal='SELL')
        if derived != self.direction:
            # لو الـ signal واضح (SELL family) → override لـ SHORT
            # لو الـ signal محايد (HOLD/empty) → سيب الـ direction اللي جاي
            sig_upper = str(self.signal).upper().strip() if self.signal else ''
            if sig_upper in SELL_SIGNALS:
                self.direction = 'SHORT'
            elif sig_upper in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'WEAK_BUY', 'BULLISH', 'OVERWEIGHT'):
                self.direction = 'LONG'
            # else: سيب الـ direction زي ما هو (HOLD/unknown)

        # 2) صحّح الـ target/stop المعكوس relative to direction
        # لاحظ: بنعدّل القيم مباشرة (مش بنرفع exception) عشان الـ pipeline ما يوقفش.
        if self.entry_price > 0:
            if self.direction == 'SHORT':
                # SHORT: target لازم يكون UNDER entry، stop لازم يكون OVER entry
                if self.target_price >= self.entry_price:
                    old = self.target_price
                    self.target_price = round(self.entry_price * 0.95, 4)
                    self.warnings.append(
                        f"⚠️ [RiskProfile] SHORT target كان فوق الدخول ({old:.2f} ≥ {self.entry_price:.2f}) — تم تصحيحه لـ {self.target_price:.2f}"
                    )
                if self.stop_loss_price <= self.entry_price:
                    old = self.stop_loss_price
                    self.stop_loss_price = round(self.entry_price * 1.05, 4)
                    self.warnings.append(
                        f"⚠️ [RiskProfile] SHORT stop كان تحت الدخول ({old:.2f} ≤ {self.entry_price:.2f}) — تم تصحيحه لـ {self.stop_loss_price:.2f}"
                    )
            else:
                # LONG: target لازم يكون OVER entry، stop لازم يكون UNDER entry
                if self.target_price <= self.entry_price:
                    old = self.target_price
                    self.target_price = round(self.entry_price * 1.05, 4)
                    self.warnings.append(
                        f"⚠️ [RiskProfile] LONG target كان تحت الدخول ({old:.2f} ≤ {self.entry_price:.2f}) — تم تصحيحه لـ {self.target_price:.2f}"
                    )
                if self.stop_loss_price >= self.entry_price:
                    old = self.stop_loss_price
                    self.stop_loss_price = round(self.entry_price * 0.95, 4)
                    self.warnings.append(
                        f"⚠️ [RiskProfile] LONG stop كان فوق الدخول ({old:.2f} ≥ {self.entry_price:.2f}) — تم تصحيحه لـ {self.stop_loss_price:.2f}"
                    )

    def is_valid_trade(self) -> bool:
        """
        التحقق من صلاحية الصفقة (direction-aware).

        LONG: target > entry, stop < entry, R:R ≥ 1.5
        SHORT: target < entry, stop > entry, R:R ≥ 1.5
        """
        # Check R:R
        if self.risk_reward_ratio < RiskManagerAdaptive.MIN_RISK_REWARD:
            return False

        if self.direction == 'SHORT':
            # SHORT: target under entry, stop over entry
            if self.target_price >= self.entry_price:
                return False
            if self.stop_loss_price <= self.entry_price:
                return False
        else:
            # LONG: target over entry, stop under entry
            if self.target_price <= self.entry_price:
                return False
            if self.stop_loss_price >= self.entry_price:
                return False

        # Check position size
        if self.position_size_pct <= 0 or self.max_shares <= 0:
            return False

        return True

    def get_rejection_reason(self) -> str:
        """سبب الرفض لو الصفقة مش صالحة (direction-aware)."""
        if self.risk_reward_ratio < RiskManagerAdaptive.MIN_RISK_REWARD:
            return f"R:R = {self.risk_reward_ratio:.2f} < {RiskManagerAdaptive.MIN_RISK_REWARD} (غير مقبول)"
        if self.direction == 'SHORT':
            if self.target_price >= self.entry_price:
                return f"SHORT: الهدف ({self.target_price:.2f}) فوق سعر الدخول ({self.entry_price:.2f}) — لازم يكون تحت"
            if self.stop_loss_price <= self.entry_price:
                return f"SHORT: الستوب ({self.stop_loss_price:.2f}) تحت سعر الدخول ({self.entry_price:.2f}) — لازم يكون فوق"
        else:
            if self.target_price <= self.entry_price:
                return f"الهدف ({self.target_price:.2f}) تحت سعر الدخول ({self.entry_price:.2f})"
            if self.stop_loss_price >= self.entry_price:
                return f"الستوب ({self.stop_loss_price:.2f}) فوق سعر الدخول ({self.entry_price:.2f})"
        if self.position_size_pct <= 0:
            return "حجم الصفقة = 0"
        return "غير معروف"

    def to_dict(self) -> Dict:
        return {
            'signal': self.signal,
            'direction': self.direction,
            'entry_price': round(self.entry_price, 4),
            'position_size_pct': round(self.position_size_pct, 1),
            'max_shares': self.max_shares,
            'stop_loss_price': round(self.stop_loss_price, 4),
            'stop_loss_pct': round(self.stop_loss_pct * 100, 1),
            'stop_type': self.stop_type,
            'target_price': round(self.target_price, 4),
            'target_pct': round(self.target_pct * 100, 1),
            'risk_reward_ratio': round(self.risk_reward_ratio, 2),
            'time_stop_days': self.time_stop_days,
            'volatility_adjustment': round(self.volatility_adjustment * 100, 1),
            'liquidity_adjustment': round(self.liquidity_adjustment * 100, 1),
            'warnings': self.warnings,
            'is_valid_trade': self.is_valid_trade(),
        }


class RiskManagerAdaptive:
    """
    مدير المخاطر المرن
    
    الفرق الأساسي:
    - القديم: Stop = Support × 0.98 (2% تحت الدعم - ضيق جداً)
    - الجديد: Stop = Base ± Volatility ± Liquidity (مرن)
    
    Rules for EGX:
    - لا Stop Loss أضيق من -7% للمضاربة
    - لا Stop Loss أضيق من -12% للاستثمار
    - Stop Loss يزداد 2% إذا السهم متقلب
    - Stop Loss يزداد 3% إذا السيولة ضعيفة
    
    Usage:
        manager = RiskManagerAdaptive(capital=100000)
        profile = manager.calculate_risk_profile(
            signal='BUY',
            entry_price=100,
            support=95,
            resistance=110,
            volatility_20d=4.5,
            liquidity_level='MODERATE'
        )
    """
    
    # Base stop loss by signal type
    BASE_STOP_LOSS = {
        SignalStrength.STRONG_BUY: 0.08,    # -8%
        SignalStrength.BUY: 0.10,           # -10%
        SignalStrength.ACCUMULATE: 0.12,    # -12%
        SignalStrength.HOLD: 0.15,          # -15%
        SignalStrength.REDUCE: 0.05,        # -5% (tight for reducing)
        SignalStrength.SELL: 0.03,          # -3% (very tight for exit)
    }
    
    # Target by signal type
    TARGET_PCT = {
        SignalStrength.STRONG_BUY: 0.20,    # +20%
        SignalStrength.BUY: 0.15,           # +15%
        SignalStrength.ACCUMULATE: 0.25,    # +25% (longer term)
        SignalStrength.HOLD: 0.10,
        SignalStrength.REDUCE: 0.05,
        SignalStrength.SELL: 0.00,          # Exit only
    }
    
    # Time stop by signal type
    TIME_STOP_DAYS = {
        SignalStrength.STRONG_BUY: 25,
        SignalStrength.BUY: 25,
        SignalStrength.ACCUMULATE: 60,      # Longer holding
        SignalStrength.HOLD: 30,
        SignalStrength.REDUCE: 5,
        SignalStrength.SELL: 3,
    }
    
    # Position size by signal type (% of portfolio)
    POSITION_SIZE_PCT = {
        SignalStrength.STRONG_BUY: 10.0,    # 10%
        SignalStrength.BUY: 5.0,            # 5%
        SignalStrength.ACCUMULATE: 3.0,     # 3%
        SignalStrength.HOLD: 0.0,
        SignalStrength.REDUCE: 0.0,
        SignalStrength.SELL: 0.0,
    }
    
    # Minimum stops for EGX
    MIN_STOP_SPECULATION = 0.07   # 7% minimum for swing trades
    MIN_STOP_INVESTMENT = 0.12   # 12% minimum for investments
    
    # CRITICAL: Minimum Risk-Reward Ratio
    MIN_RISK_REWARD = 1.5        # Professional standard: risk 1 to gain 1.5+
    
    # Penny stock threshold
    MIN_STOCK_PRICE = 1.00       # EGX: Stocks under 1 EGP are penny stocks
    
    # Minimum target gain from entry
    MIN_TARGET_GAIN = 0.05       # 5% minimum gain from entry price
    
    def __init__(self, capital: float = 100000, risk_per_trade: float = 2.0):
        """
        Initialize Risk Manager.
        
        Args:
            capital: Total portfolio capital
            risk_per_trade: Maximum risk per trade (%)
        """
        self.capital = capital
        self.risk_per_trade = min(max(risk_per_trade, 0.5), 5.0)  # 0.5-5%
    
    def calculate_risk_profile(
        self,
        signal: str,
        entry_price: float,
        entry_price_max: Optional[float] = None,  # أعلى سعر دخول في الرينج
        support: Optional[float] = None,
        resistance: Optional[float] = None,
        volatility_20d: float = 3.0,
        liquidity_level: str = 'MODERATE',
        is_investment: bool = False,
    ) -> RiskProfile:
        """
        حساب ملف المخاطر الكامل
        
        CRITICAL FIXES:
        - Target MUST be above entry_price_max (not just entry_price)
        - R:R MUST be >= 1.5 (otherwise signal becomes HOLD)
        - Penny stocks (price < 1.00) are rejected
        
        Args:
            signal: نوع الإشارة
            entry_price: سعر الدخول (أقل سعر)
            entry_price_max: أعلى سعر دخول في الرينج (لو موجود)
            support: مستوى الدعم
            resistance: مستوى المقاومة
            volatility_20d: التذبذب خلال 20 يوم (%)
            liquidity_level: مستوى السيولة
            is_investment: هل استثمار طويل الأمد
            
        Returns:
            RiskProfile: ملف المخاطر
        """
        warnings = []
        
        # ========== ZERO PRICE CHECK ==========
        if entry_price <= 0:
            warnings.append("⚠️ سعر السهم غير صالح (0 أو أقل)")
            return RiskProfile(
                signal='HOLD',
                entry_price=0,
                position_size_pct=0.0,
                max_shares=0,
                stop_loss_price=0,
                stop_loss_pct=0.05,
                stop_type='INVALID_PRICE',
                target_price=0,
                target_pct=0.10,
                risk_reward_ratio=0.0,
                time_stop_days=0,
                volatility_adjustment=0.0,
                liquidity_adjustment=0.0,
                warnings=warnings
            )
        
        # ========== PENNY STOCK CHECK ==========
        if entry_price < self.MIN_STOCK_PRICE:
            warnings.append(f"⚠️ سهم قرش (سعر {entry_price:.2f} < {self.MIN_STOCK_PRICE} جنيه) - مرفوض للمضاربة")
            return RiskProfile(
                signal='HOLD',  # Override signal
                entry_price=entry_price,
                position_size_pct=0.0,
                max_shares=0,
                stop_loss_price=entry_price * 0.85,
                stop_loss_pct=0.15,
                stop_type='PENNY_STOCK_REJECTED',
                target_price=entry_price,
                target_pct=0.0,
                risk_reward_ratio=0.0,
                time_stop_days=0,
                volatility_adjustment=0.0,
                liquidity_adjustment=0.0,
                warnings=warnings
            )
        
        # Use entry_price_max if provided, otherwise use entry_price
        effective_entry = entry_price_max if entry_price_max else entry_price
        
        # Convert signal to enum
        try:
            signal_enum = SignalStrength(signal.upper())
        except ValueError:
            signal_enum = SignalStrength.HOLD
        
        # Base stop loss (signal-based, will be adjusted by volatility)
        base_stop = self.BASE_STOP_LOSS.get(signal_enum, 0.15)
        
        # Adjustments
        volatility_adj = 0.0
        liquidity_adj = 0.0
        
        # DYNAMIC VOLATILITY: Base stop from stock's actual price movement
        # volatility_20d = std dev of daily % returns (e.g., 3.0 = 3%/day)
        if volatility_20d > 0:
            # Replace fixed base_stop with volatility-driven stop
            # Stop = 1.2x daily volatility (covers 1+ standard deviation)
            vol_stop = volatility_20d * 1.2 / 100.0  # Convert % to decimal
            # Use the LARGER of signal-based or volatility-based stop
            # This ensures: high-vol stocks get wider stops, low-vol get tighter
            base_stop = max(base_stop, vol_stop)
        
        # Volatility adjustment for extreme cases
        if volatility_20d > 7.0:
            volatility_adj = 0.03
            warnings.append(f"سهم شديد التقلب (+{volatility_20d:.1f}%): Stop Loss أوسع أكثر")
        elif volatility_20d > 5.0:
            volatility_adj = 0.02
            warnings.append(f"سهم متقلب (+{volatility_20d:.1f}%): Stop Loss أوسع")
        
        # Liquidity adjustment (+3% if weak liquidity)
        liquidity_enum = LiquidityLevel(liquidity_level.upper()) if isinstance(liquidity_level, str) else liquidity_level
        if liquidity_enum == LiquidityLevel.WEAK:
            liquidity_adj = 0.03
            warnings.append("سيولة ضعيفة: Stop Loss أوسع لتفادي Slippage")
        elif liquidity_enum == LiquidityLevel.MODERATE:
            liquidity_adj = 0.01
        
        # Calculate final stop loss
        final_stop_pct = base_stop + volatility_adj + liquidity_adj
        
        # Apply minimum for EGX
        if is_investment:
            final_stop_pct = max(final_stop_pct, self.MIN_STOP_INVESTMENT)
        else:
            final_stop_pct = max(final_stop_pct, self.MIN_STOP_SPECULATION)
        
        # ========== Phase 8 — DIRECTION-AWARE TARGET/STOP ==========
        # الـ direction بتتحدد من الـ signal: SELL family → SHORT، غير كده → LONG.
        # LONG: target فوق entry، stop تحت entry (المنطق القديم).
        # SHORT: target تحت entry، stop فوق entry (الـ bug القديم كان بيغفل ده).
        direction = _direction_from_signal(signal)

        if direction == 'SHORT':
            # ----- SHORT branch (SELL/STRONG_SELL/REDUCE/SHORT) -----
            # stop فوق entry (لو السعر طلع against us، نخرج بخسارة)
            stop_from_pct = effective_entry * (1 + final_stop_pct)

            # Consider resistance level كـ stop (لو فيه مقاومة قريبة فوق)
            if resistance and resistance > effective_entry:
                stop_from_resistance = resistance * 1.05  # 5% above resistance
                # Use the more conservative (higher) stop
                stop_loss_price = max(stop_from_pct, stop_from_resistance)
            else:
                stop_loss_price = stop_from_pct

            # Ensure stop is ABOVE entry (SHORT requirement)
            if stop_loss_price <= effective_entry:
                stop_loss_price = effective_entry * (1 + self.MIN_STOP_SPECULATION)
                warnings.append("⚠️ [SHORT] Stop Loss كان تحت سعر الدخول - تم تصحيحه")

            # actual_stop_pct = (stop - entry) / entry (positive for SHORT)
            actual_stop_pct = (stop_loss_price - effective_entry) / effective_entry

            # TARGET: تحت entry (لو السعر نزل لـ target، نكسب)
            min_rr = self.MIN_RISK_REWARD  # 1.5:1
            target_pct = max(actual_stop_pct * min_rr, self.MIN_TARGET_GAIN)

            # Base target UNDER entry
            base_target = effective_entry * (1 - max(target_pct, self.MIN_TARGET_GAIN))

            # Consider support level كـ target (لو فيه دعم قريب تحت)
            if support and 0 < support < effective_entry:
                target_price = max(base_target, support * 1.02)  # 2% above support
            else:
                target_price = base_target

            # CRITICAL: Ensure target is BELOW entry (SHORT requirement)
            if target_price >= effective_entry:
                target_price = effective_entry * (1 - self.MIN_TARGET_GAIN)
                warnings.append("⚠️ [SHORT] الهدف كان فوق سعر الدخول - تم تصحيحه إلى -5%")

            # target_pct as negative (under entry) — keep signed for clarity
            target_pct_signed = (target_price - effective_entry) / effective_entry  # negative

            # RISK-REWARD (SHORT): risk = stop - entry, reward = entry - target
            risk_amount = stop_loss_price - effective_entry   # positive
            reward_amount = effective_entry - target_price     # positive

            if risk_amount <= 0:
                risk_reward = 0.0
                warnings.append("⚠️ [SHORT] خطأ في حساب المخاطرة - Stop Loss تحت الدخول")
            else:
                risk_reward = reward_amount / risk_amount

            # Use signed target_pct for the RiskProfile field (backward compat:
            # الـ dict field بيوصل للـ frontend اللي بيتعامل مع النسبة كـ number)
            target_pct = target_pct_signed
        else:
            # ----- LONG branch (BUY/STRONG_BUY/ACCUMULATE/HOLD/...) — المنطق القديم -----
            # Calculate stop loss price (from effective_entry = max entry price)
            stop_from_pct = effective_entry * (1 - final_stop_pct)

            # Consider support level
            if support and support > 0:
                stop_from_support = support * 0.95  # 5% below support
                # Use the more conservative (lower) stop
                stop_loss_price = min(stop_from_pct, stop_from_support)
            else:
                stop_loss_price = stop_from_pct

            # Ensure stop is below entry
            if stop_loss_price >= effective_entry:
                stop_loss_price = effective_entry * (1 - self.MIN_STOP_SPECULATION)
                warnings.append("⚠️ Stop Loss كان فوق سعر الدخول - تم تصحيحه")

            # Recalculate actual stop percentage
            actual_stop_pct = (effective_entry - stop_loss_price) / effective_entry

            # ========== TARGET CALCULATION FIX (LONG) ==========
            min_rr = self.MIN_RISK_REWARD  # 1.5:1 minimum
            target_pct = max(actual_stop_pct * min_rr, self.MIN_TARGET_GAIN)

            # Base target from entry (above)
            base_target = effective_entry * (1 + max(target_pct, self.MIN_TARGET_GAIN))

            # Consider resistance - but ONLY if it's above entry
            if resistance and resistance > effective_entry:
                target_price = min(base_target, resistance * 0.98)
            else:
                target_price = base_target

            # CRITICAL: Ensure target is above entry
            if target_price <= effective_entry:
                target_price = effective_entry * (1 + self.MIN_TARGET_GAIN)
                warnings.append("⚠️ الهدف كان تحت سعر الدخول - تم تصحيحه إلى +5%")

            # Calculate actual target percentage (positive for LONG)
            target_pct = (target_price - effective_entry) / effective_entry

            # ========== RISK-REWARD CALCULATION (LONG) ==========
            risk_amount = effective_entry - stop_loss_price
            reward_amount = target_price - effective_entry

            # Safety check
            if risk_amount <= 0:
                risk_reward = 0.0
                warnings.append("⚠️ خطأ في حساب المخاطرة - Stop Loss فوق الدخول")
            else:
                risk_reward = reward_amount / risk_amount
        
        # ========== R:R VALIDATION ==========
        # If R:R < 1.5, this is NOT a valid trade
        if risk_reward < self.MIN_RISK_REWARD:
            warnings.append(f"⛔ R:R = {risk_reward:.2f} < {self.MIN_RISK_REWARD} - غير مقبول للمحترفين")
            warnings.append(f"⛔ خاطرة بـ {actual_stop_pct*100:.1f}% عشان تكسب {target_pct*100:.1f}% = انتحار")
            
            # Override signal to HOLD
            original_signal = signal
            signal = 'HOLD'
            warnings.append(f"⛔ الإشارة تغيرت من {original_signal} إلى HOLD بسبب R:R ضعيف")
        
        # Position sizing
        position_size_pct = self.POSITION_SIZE_PCT.get(signal_enum, 0.0)
        
        # Adjust position for risk-reward (only if valid)
        if risk_reward < 1.5 and risk_reward > 0:
            position_size_pct *= 0.5
            warnings.append(f"Risk-Reward ضعيف ({risk_reward:.2f}): تقليل حجم الصفقة")
        
        # Zero position if R:R is invalid
        if risk_reward < self.MIN_RISK_REWARD:
            position_size_pct = 0.0
        
        # Calculate max shares
        risk_amount_egp = self.capital * (self.risk_per_trade / 100)
        max_shares = int(risk_amount_egp / risk_amount) if risk_amount > 0 else 0
        
        # Zero shares if R:R invalid
        if risk_reward < self.MIN_RISK_REWARD:
            max_shares = 0
        
        # Time stop
        time_stop = self.TIME_STOP_DAYS.get(signal_enum, 30)
        
        return RiskProfile(
            signal=signal,
            entry_price=effective_entry,
            position_size_pct=position_size_pct,
            max_shares=max_shares,
            stop_loss_price=stop_loss_price,
            stop_loss_pct=actual_stop_pct,
            stop_type='ADAPTIVE',
            target_price=target_price,
            target_pct=target_pct,
            risk_reward_ratio=risk_reward,
            time_stop_days=time_stop,
            volatility_adjustment=volatility_adj,
            liquidity_adjustment=liquidity_adj,
            warnings=warnings,
            direction=direction,
        )
    
    def suggest_stop_loss(
        self,
        entry_price: float,
        signal: str = 'BUY',
        support: Optional[float] = None,
        volatility: float = 3.0,
        liquidity: str = 'MODERATE'
    ) -> Dict:
        """
        اقتراح Stop Loss فقط
        
        Returns:
            Dict: Stop loss suggestions
        """
        profile = self.calculate_risk_profile(
            signal=signal,
            entry_price=entry_price,
            support=support,
            volatility_20d=volatility,
            liquidity_level=liquidity
        )
        
        return {
            'recommended_stop': round(profile.stop_loss_price, 4),
            'stop_percentage': round(profile.stop_loss_pct * 100, 1),
            'stop_type': profile.stop_type,
            'adjustments': {
                'volatility': round(profile.volatility_adjustment * 100, 1),
                'liquidity': round(profile.liquidity_adjustment * 100, 1),
            },
            'warnings': profile.warnings
        }
    
    def calculate_position_size(
        self,
        entry_price: float,
        stop_loss: float,
        risk_pct: float = None
    ) -> Dict:
        """
        حساب حجم الصفقة
        
        Returns:
            Dict: Position size details
        """
        risk = risk_pct or self.risk_per_trade
        risk_amount = self.capital * (risk / 100)
        sl_distance = abs(entry_price - stop_loss)
        
        if sl_distance <= 0:
            return {
                'shares': 0,
                'position_value': 0,
                'error': 'Invalid stop loss'
            }
        
        shares = int(risk_amount / sl_distance)
        position_value = shares * entry_price
        
        return {
            'shares': shares,
            'position_value': round(position_value, 2),
            'risk_amount': round(risk_amount, 2),
            'risk_per_share': round(sl_distance, 4),
            'formula': f"Shares = ({self.capital:,.0f} × {risk}%) / {sl_distance:.2f} = {shares}"
        }


# Convenience function
def calculate_trade_risk(
    signal: str,
    entry_price: float,
    capital: float = 100000,
    **kwargs
) -> RiskProfile:
    """
    دالة مساعدة لحساب مخاطر الصفقة
    """
    manager = RiskManagerAdaptive(capital=capital)
    return manager.calculate_risk_profile(signal, entry_price, **kwargs)
