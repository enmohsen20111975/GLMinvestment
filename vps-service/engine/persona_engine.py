"""
Investor Persona Engine
=======================
محرك الشخصيات المستثمرة - 7 شخصيات مختلفة

بناءً على ANALYSIS_STRATEGY_BIBLE_v1.0.md

الاستخدام:
    from engine.persona_engine import PersonaEngine, InvestorPersona
    
    engine = PersonaEngine()
    persona = engine.get_persona('balanced')
    adjusted_threshold = persona.get_adjusted_threshold(65)
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Literal
from enum import Enum


class PersonaType(str, Enum):
    """أنواع الشخصيات السبع"""
    CONSERVATIVE = "conservative"           # المحافظ
    CAUTIOUS = "cautious"                   # المتوسط الحذر
    BALANCED = "balanced"                   # المتوازن
    ACTIVE_TRADER = "active_trader"         # المضارب المنتظم
    ADVENTURER = "adventurer"               # المغامر
    GAMBLER = "gambler"                     # المقامر المحسن
    HEDGER = "hedger"                       # المتحوط المؤسسي


@dataclass
class RiskParameters:
    """معاملات المخاطر"""
    max_position_pct: float          # أقصى نسبة للصفقة الواحدة
    default_stop_loss_pct: float     # Stop Loss الافتراضي
    default_target_pct: float        # Target الافتراضي
    time_stop_days: int              # Time Stop بالأيام
    leverage_allowed: float          # الرافعة المسموحة
    daily_loss_limit_pct: float      # حد الخسارة اليومي
    
    # توزيع المحفظة
    egx_allocation: float = 0.0
    crypto_allocation: float = 0.0
    gold_allocation: float = 0.0
    forex_allocation: float = 0.0
    cash_allocation: float = 0.0


@dataclass
class DecisionThresholds:
    """عتبات القرار"""
    strong_buy: int      # >= X
    buy: int             # >= X
    accumulate: int      # >= X
    hold_low: int        # X - Y
    hold_high: int       # X - Y
    reduce: int          # X - Y
    sell: int            # <= X
    strong_sell: int     # <= X


@dataclass
class PersonaScoringWeights:
    """أوزان النقاط الخاصة بكل شخصية - تحدد كيف يحسب master_score"""
    technical: float = 0.20
    fundamental: float = 0.30
    timing: float = 0.10
    ai_pattern: float = 0.20
    sentiment: float = 0.10
    market_regime: float = 0.10


@dataclass
class PersonaTargetConfig:
    """إعدادات الهدف والوقف الخاصة بكل شخصية"""
    target_pct: float = 0.10       # نسبة الهدف الافتراضية
    stop_pct: float = 0.08         # نسبة الوقف الافتراضية
    time_horizon_days: int = 45    # أفق الاستثمار بالأيام
    min_holding_days: int = 7      # أقل مدة احتفاظ
    max_holding_days: int = 90     # أقصى مدة احتفاظ


@dataclass
class InvestorPersona:
    """شخصية المستثمر الكاملة"""
    persona_type: PersonaType
    name_ar: str
    name_en: str
    emoji: str
    risk_tolerance: int  # 1-10
    
    description: str
    goal: str
    time_horizon: str
    preferred_assets: List[str]
    crypto_allowed: bool
    crypto_max_pct: float
    
    risk_params: RiskParameters
    thresholds: DecisionThresholds
    
    # أوزان النقاط الخاصة بالشخصية
    scoring_weights: PersonaScoringWeights = field(default_factory=PersonaScoringWeights)
    
    # إعدادات الهدف والوقف الخاصة بالشخصية
    target_config: PersonaTargetConfig = field(default_factory=PersonaTargetConfig)
    
    # مفتاح الترتيب: ما الذي نرتب به النتائج؟
    sort_primary: str = 'adjusted_score'  # adjusted_score, fundamental_score, technical_score
    
    # توزيع الأهداف المتدرج
    target_1_sell_pct: float = 0.0
    target_2_sell_pct: float = 0.0
    target_3_sell_pct: float = 0.0
    
    # Stop Loss حسب فصل الأصول
    stop_loss_egx: float = 0.0
    stop_loss_crypto: float = 0.0
    stop_loss_gold: float = 0.0
    stop_loss_forex: float = 0.0
    
    # Time Stop حسب فصل الأصول
    time_stop_egx: int = 0
    time_stop_crypto: int = 0
    time_stop_gold: int = 0
    time_stop_forex: int = 0
    
    # حساسية الماكرو
    macro_sensitivity: float = 0.0
    
    # قواعد خاصة
    special_rules: List[str] = field(default_factory=list)
    
    def get_adjusted_threshold(self, base_score: float) -> float:
        """تعديل الدرجة بناءً على الشخصية
        
        الشخصيات المحافظة: تخفض الدرجة (تحتاج درجة أعلى للشراء)
        الشخصيات العدوانية: ترفع الدرجة (تقبل درجة أقل للشراء)
        """
        # Multiplier > 1 means easier to trigger BUY (aggressive personas)
        # Multiplier < 1 means harder to trigger BUY (conservative personas)
        multiplier_map = {
            PersonaType.CONSERVATIVE: 0.85,     # أصعب - يحتاج درجة أعلى
            PersonaType.CAUTIOUS: 0.92,         # أصعب قليلاً
            PersonaType.BALANCED: 1.0,          # بدون تعديل
            PersonaType.ACTIVE_TRADER: 1.05,    # أسهل قليلاً
            PersonaType.ADVENTURER: 1.10,       # أسهل
            PersonaType.GAMBLER: 1.15,          # أسهل كثيراً - يقبل مخاطر أعلى
            PersonaType.HEDGER: 0.90            # أصعب - يتحوط
        }
        multiplier = multiplier_map.get(self.persona_type, 1.0)
        return base_score * multiplier
    
    def get_signal(self, master_score: float) -> str:
        """تحويل Master Score إلى إشارة باستخدام عتبات الشخصية"""
        adjusted = self.get_adjusted_threshold(master_score)
        
        # FIXED: Use persona-specific thresholds instead of hardcoded values
        # Each persona has its own DecisionThresholds that should be respected
        if adjusted >= self.thresholds.strong_buy:
            return "STRONG_BUY"
        elif adjusted >= self.thresholds.buy:
            return "BUY"
        elif adjusted >= self.thresholds.accumulate:
            return "ACCUMULATE"
        elif adjusted >= self.thresholds.hold_low:
            return "HOLD"
        elif adjusted >= self.thresholds.reduce:
            return "REDUCE"
        elif adjusted >= self.thresholds.sell:
            return "SELL"
        else:
            return "STRONG_SELL"
    
    def recalculate_score(self, technical_score: float, fundamental_score: float,
                          timing_score: float, ai_pattern_score: float,
                          sentiment_score: float, market_regime_score: float) -> float:
        """إعادة حساب master_score بأوزان الشخصية الخاصة"""
        w = self.scoring_weights
        score = (
            technical_score * w.technical +
            fundamental_score * w.fundamental +
            timing_score * w.timing +
            ai_pattern_score * w.ai_pattern +
            sentiment_score * w.sentiment +
            market_regime_score * w.market_regime
        )
        return max(0, min(100, score))
    
    def calculate_persona_targets(self, entry_price: float, score: float,
                                   support: float = None, resistance: float = None,
                                   volatility: float = 3.0, atr: float = None,
                                   atr_pct: float = None, high_30d: float = None,
                                   low_30d: float = None, bb_lower: float = None,
                                   bb_upper: float = None, zone: str = None,
                                   candlestick_pattern: str = None,
                                   candlestick_direction: str = None,
                                   ticker: str = None,
                                   rsi: float = None,
                                   volume: float = None,
                                   volume_sma_20: float = None,
                                   macd_histogram: float = None,
                                   prev_macd_histogram: float = None,
                                   swing_low: float = None,
                                   swing_high: float = None) -> dict:
        """حساب الهدف والوقف حسب الشخصية — بناءً على التحليل الفنى والشموع اليابانية
        
        القاعدة الذهبية: "مفيش target = entry * 1.10 تاني"
        كل سهم له دعم ومقاومة حقيقيين من الشموع.
        الوقف على الدعم، الهدف على المقاومة، R/R يتحسب من المسافة الحقيقية.
        
        الأولوية:
        1. نقاط الدعم والمقاومة من التحليل الفنى (أهم عامل)
        2. أنماط الشموع اليابانية (candlestick patterns) + سياقها (at support? at resistance?)
        3. ATR من الشموع اليابانية (أقيس تقلب حقيقي)
        4. Swing Low/High آخر 20 شمعة
        5. Fibonacci Extension (1.618)
        6. إشارات الخروج من القمة ("قمة الخول")
        7. إشارات الدخول من القاع
        8. الشخصية تحدد ATR multiplier + R:R minimum + support/resistance buffer
        """
        if not entry_price or entry_price <= 0:
            return {
                'target_price': 0.0, 'target_pct': 0.0,
                'stop_loss': 0.0, 'stop_pct': 0.0,
                'risk_reward': 0.0, 'entry_price': 0.0,
                'time_horizon_days': self.target_config.time_horizon_days,
            }
        
        tc = self.target_config
        ptype = self.persona_type.value if hasattr(self.persona_type, 'value') else str(self.persona_type)
        
        # ========================================
        # PRIMARY: Use Dynamic Target Engine
        # ========================================
        # The new engine implements the full 4-layer stop + 5-layer target
        # + Fibonacci + exit/entry signals + persona-specific parameters
        try:
            from analyzers.dynamic_target_engine import DynamicTargetEngine
            
            engine = DynamicTargetEngine()
            result = engine.calculate(
                ticker=ticker or 'UNKNOWN',
                entry_price=entry_price,
                score=score,
                persona=ptype,
                support=support,
                resistance=resistance,
                atr=atr,
                atr_pct=atr_pct,
                high_30d=high_30d,
                low_30d=low_30d,
                volatility=volatility,
                rsi=rsi,
                volume=volume,
                volume_sma_20=volume_sma_20,
                macd_histogram=macd_histogram,
                prev_macd_histogram=prev_macd_histogram,
                bb_lower=bb_lower,
                bb_upper=bb_upper,
                candlestick_pattern=candlestick_pattern or '',
                candlestick_direction=candlestick_direction or '',
                zone=zone,
            )
            
            return {
                'target_price': result.target_price,
                'target_pct': result.target_pct,
                'target_basis': result.target_basis,
                'target_detail': result.target_detail,
                'stop_loss': result.stop_loss,
                'stop_pct': result.stop_pct,
                'stop_basis': result.stop_basis,
                'stop_detail': result.stop_detail,
                'risk_reward': result.risk_reward,
                'rr_valid': result.rr_valid,
                'entry_price': result.entry_price,
                'stop_method': result.stop_basis,     # Legacy compat
                'target_method': result.target_basis,  # Legacy compat
                'candlestick_pattern': candlestick_pattern or '',
                'candlestick_context': result.candlestick_context,
                'zone': zone or result.candlestick_context,
                'atr_14': result.atr_14,
                'support_level': result.support_level,
                'resistance_level': result.resistance_level,
                'swing_low': result.swing_low,
                'swing_high': result.swing_high,
                'exit_score': result.exit_score,
                'exit_signals': [
                    {'signal': s.signal, 'score': s.score, 'triggered': s.triggered, 'detail': s.detail}
                    for s in result.exit_signals
                ],
                'entry_signals': [
                    {'signal': s.signal, 'score': s.score, 'triggered': s.triggered, 'detail': s.detail}
                    for s in result.entry_signals
                ],
                'recommendation': result.recommendation,
                'time_horizon_days': tc.time_horizon_days,
            }
        except ImportError:
            pass  # Fall through to legacy calculation
        except Exception as e:
            print(f"[PersonaEngine] DynamicTargetEngine error: {e}")
            pass  # Fall through to legacy calculation
        
        # ========================================
        # FALLBACK: Legacy calculation (if dynamic engine not available)
        # ========================================
        # Collect stop candidates from different methods
        stop_candidates = []
        
        # Method 1: Support-based stop (HIGHEST PRIORITY)
        if support and support > 0 and support < entry_price:
            support_stop_pct = (entry_price - support * 0.97) / entry_price
            if 0.005 <= support_stop_pct <= 0.15:
                stop_candidates.append((support_stop_pct, 'SUPPORT', 1.0))
        
        # Method 2: Low 30-day price level
        if low_30d and low_30d > 0 and low_30d < entry_price:
            low_stop_pct = (entry_price - low_30d * 0.98) / entry_price
            if 0.005 <= low_stop_pct <= 0.15:
                stop_candidates.append((low_stop_pct, 'LOW_30D', 0.8))
        
        # Method 3: ATR-based stop
        if atr and atr > 0:
            atr_stop_pct = (1.5 * atr) / entry_price
            if 0.005 <= atr_stop_pct <= 0.15:
                stop_candidates.append((atr_stop_pct, 'ATR', 0.9))
        elif atr_pct and atr_pct > 0:
            atr_stop_pct = atr_pct * 1.5 / 100.0
            if 0.005 <= atr_stop_pct <= 0.15:
                stop_candidates.append((atr_stop_pct, 'ATR_PCT', 0.9))
        
        # Method 4: Bollinger Band lower band
        if bb_lower and bb_lower > 0 and bb_lower < entry_price:
            bb_stop_pct = (entry_price - bb_lower * 0.99) / entry_price
            if 0.005 <= bb_stop_pct <= 0.15:
                stop_candidates.append((bb_stop_pct, 'BOLLINGER', 0.65))
        
        # Method 5: Volatility-based stop (FALLBACK)
        if volatility <= 0:
            volatility = 3.0
        vol_stop_pct = volatility * 1.2 / 100.0
        vol_stop_pct = max(0.005, min(0.15, vol_stop_pct))
        stop_candidates.append((vol_stop_pct, 'VOLATILITY', 0.5))
        
        # Choose best stop
        stop_candidates.sort(key=lambda x: (-x[2], x[0]))
        base_stop_pct = stop_candidates[0][0]
        stop_method = stop_candidates[0][1]
        
        # Legacy persona multipliers
        persona_mults = {
            'conservative':  {'stop_mult': 0.8,  'target_mult': 1.8},
            'cautious':      {'stop_mult': 0.9,  'target_mult': 2.0},
            'balanced':      {'stop_mult': 1.0,  'target_mult': 2.2},
            'active_trader': {'stop_mult': 1.1,  'target_mult': 2.5},
            'adventurer':    {'stop_mult': 1.3,  'target_mult': 2.8},
            'gambler':       {'stop_mult': 1.5,  'target_mult': 3.0},
            'hedger':        {'stop_mult': 0.7,  'target_mult': 1.5},
        }
        
        mults = persona_mults.get(ptype, {'stop_mult': 1.0, 'target_mult': 2.0})
        
        stop_pct = base_stop_pct * mults['stop_mult']
        target_pct = stop_pct * mults['target_mult']
        
        # ========================================
        # STEP 3: Score-based adjustments
        # ========================================
        # High confidence → tighter stop, higher target (better R:R)
        # Low confidence → wider stop, lower target (worse R:R)
        if score >= 70:
            stop_pct *= 0.85       # Tighter stop
            target_pct *= 1.15     # Higher target
        elif score >= 55:
            pass  # Keep as-is
        else:
            stop_pct *= 1.2        # Wider stop
            target_pct *= 0.85     # Lower target
        
        # ========================================
        # STEP 3.5: Candlestick pattern adjustments
        # ========================================
        # If a bullish candlestick pattern is detected, adjust confidence
        if candlestick_pattern and candlestick_direction == 'BULLISH':
            # Bullish candlestick near support → stronger signal → can use tighter stop
            stop_pct *= 0.9   # Tighter stop
            target_pct *= 1.1  # Higher target
        elif candlestick_pattern and candlestick_direction == 'BEARISH':
            # Bearish candlestick → weaker long signal → wider stop
            stop_pct *= 1.15  # Wider stop
        
        # Zone-based adjustment
        if zone == 'near_support':
            # Near support → tighter stop possible
            stop_pct *= 0.9
        elif zone == 'near_resistance':
            # Near resistance → be cautious
            target_pct *= 0.9
        
        # Clamp final values
        stop_pct = max(0.005, min(0.25, stop_pct))
        target_pct = max(0.01, min(0.60, target_pct))
        
        # Calculate prices
        target_price = entry_price * (1 + target_pct)
        stop_loss = entry_price * (1 - stop_pct)
        
        # ========================================
        # STEP 4: Override with actual S/R price levels
        # ========================================
        # Support for stop loss — use actual price level, not percentage
        if support and support < entry_price:
            support_stop = support * 0.95
            # Only use support stop if it gives a better (tighter) stop than calculated
            if support_stop > stop_loss:  # Closer to entry = tighter stop
                stop_loss = support_stop
                stop_method = 'SUPPORT_PRICE'
        
        # Resistance as target guidance
        # If resistance is above entry, it's a valid partial target
        # But we DON'T cap the target at resistance if R:R would be bad
        # Instead, resistance becomes a "take partial profit" level
        resistance_partial = None
        target_method = 'RR'
        if resistance and resistance > entry_price:
            resistance_target_pct = (resistance * 0.98 - entry_price) / entry_price
            if resistance_target_pct > 0:
                resistance_partial = resistance * 0.98
                # Only cap target at resistance if R:R is still >= 1.5
                calculated_rr = target_pct / stop_pct if stop_pct > 0 else 0
                resistance_rr = resistance_target_pct / stop_pct if stop_pct > 0 else 0
                if resistance_rr >= 1.5:
                    # Resistance gives good R:R — use it as target
                    target_price = min(target_price, resistance * 0.98)
                    target_method = 'RESISTANCE'
                # Otherwise keep the calculated target (better R:R)
        
        # High 30d as extended target reference
        if high_30d and high_30d > entry_price:
            high_target_pct = (high_30d * 0.98 - entry_price) / entry_price
            if high_target_pct > target_pct and high_target_pct <= 0.40:
                # 30d high offers more room — use it if R:R is good
                high_rr = high_target_pct / stop_pct if stop_pct > 0 else 0
                if high_rr >= 2.0:
                    target_price = max(target_price, entry_price * (1 + high_target_pct * 0.8))
                    target_method = 'HIGH_30D'
        
        # Bollinger Band upper as target reference
        if bb_upper and bb_upper > entry_price:
            bb_target_pct = (bb_upper * 1.01 - entry_price) / entry_price
            if 0.01 <= bb_target_pct <= 0.40:
                # Use BB upper as minimum target if it's better than calculated
                if bb_target_pct > target_pct * 0.8:
                    target_price = max(target_price, entry_price * (1 + bb_target_pct * 0.9))
                    if target_method == 'RR':
                        target_method = 'BOLLINGER'
        
        # Ensure stop is below entry and target is above
        if stop_loss >= entry_price:
            stop_loss = entry_price * (1 - stop_pct)
        if target_price <= entry_price:
            target_price = entry_price * (1 + target_pct)
        
        # Recalculate actual percentages
        if entry_price > 0:
            actual_target_pct = (target_price - entry_price) / entry_price
            actual_stop_pct = (entry_price - stop_loss) / entry_price
        else:
            actual_target_pct = target_pct
            actual_stop_pct = stop_pct
        
        # Risk-Reward Ratio
        risk = entry_price - stop_loss
        reward = target_price - entry_price
        # Rule 54: استخدم canonical compute_risk_reward
        try:
            from utils.risk_reward import compute_risk_reward
            risk_reward = compute_risk_reward(entry_price, target_price, stop_loss, fallback=0.0)
        except Exception:
            risk_reward = reward / risk if risk > 0 else 0
        
        return {
            'target_price': round(target_price, 2),
            'target_pct': round(actual_target_pct * 100, 1),
            'target_basis': target_method.lower(),
            'target_detail': f'Legacy calculation via {target_method}',
            'stop_loss': round(stop_loss, 2),
            'stop_pct': round(actual_stop_pct * 100, 1),
            'stop_basis': stop_method.lower(),
            'stop_detail': f'Legacy calculation via {stop_method}',
            'risk_reward': round(risk_reward, 2),
            'rr_valid': risk_reward >= 1.5,
            'entry_price': entry_price,
            'stop_method': stop_method,
            'target_method': target_method,
            'candlestick_pattern': candlestick_pattern or '',
            'candlestick_context': 'at_support' if zone == 'near_support' else ('at_resistance' if zone == 'near_resistance' else 'middle'),
            'zone': zone or '',
            'atr_14': atr or 0,
            'support_level': support or 0,
            'resistance_level': resistance or 0,
            'swing_low': swing_low or low_30d or 0,
            'swing_high': swing_high or high_30d or 0,
            'exit_score': 0,
            'exit_signals': [],
            'entry_signals': [],
            'recommendation': '',
            'time_horizon_days': tc.time_horizon_days,
        }
    
    def get_stop_loss(self, asset_class: str) -> float:
        """الحصول على Stop Loss حسب فصل الأصول"""
        stop_map = {
            'egx': self.stop_loss_egx,
            'crypto': self.stop_loss_crypto,
            'gold': self.stop_loss_gold,
            'forex': self.stop_loss_forex
        }
        return stop_map.get(asset_class.lower(), self.risk_params.default_stop_loss_pct)
    
    def get_time_stop(self, asset_class: str) -> int:
        """الحصول على Time Stop حسب فصل الأصول"""
        time_map = {
            'egx': self.time_stop_egx,
            'crypto': self.time_stop_crypto,
            'gold': self.time_stop_gold,
            'forex': self.time_stop_forex
        }
        return time_map.get(asset_class.lower(), self.risk_params.time_stop_days)
    
    def to_dict(self) -> dict:
        """تحويل لـ dictionary"""
        return {
            "persona_type": self.persona_type.value,
            "name_ar": self.name_ar,
            "name_en": self.name_en,
            "emoji": self.emoji,
            "risk_tolerance": self.risk_tolerance,
            "description": self.description,
            "goal": self.goal,
            "time_horizon": self.time_horizon,
            "preferred_assets": self.preferred_assets,
            "crypto_allowed": self.crypto_allowed,
            "crypto_max_pct": self.crypto_max_pct,
            "scoring_weights": {
                "technical": self.scoring_weights.technical,
                "fundamental": self.scoring_weights.fundamental,
                "timing": self.scoring_weights.timing,
                "ai_pattern": self.scoring_weights.ai_pattern,
                "sentiment": self.scoring_weights.sentiment,
                "market_regime": self.scoring_weights.market_regime,
            },
            "target_config": {
                "target_pct": self.target_config.target_pct,
                "stop_pct": self.target_config.stop_pct,
                "time_horizon_days": self.target_config.time_horizon_days,
                "min_holding_days": self.target_config.min_holding_days,
                "max_holding_days": self.target_config.max_holding_days,
            },
            "sort_primary": self.sort_primary,
            "risk_params": {
                "max_position_pct": self.risk_params.max_position_pct,
                "default_stop_loss_pct": self.risk_params.default_stop_loss_pct,
                "default_target_pct": self.risk_params.default_target_pct,
                "time_stop_days": self.risk_params.time_stop_days,
                "leverage_allowed": self.risk_params.leverage_allowed,
                "daily_loss_limit_pct": self.risk_params.daily_loss_limit_pct,
                "allocations": {
                    "egx": self.risk_params.egx_allocation,
                    "crypto": self.risk_params.crypto_allocation,
                    "gold": self.risk_params.gold_allocation,
                    "forex": self.risk_params.forex_allocation,
                    "cash": self.risk_params.cash_allocation
                }
            },
            "thresholds": {
                "strong_buy": self.thresholds.strong_buy,
                "buy": self.thresholds.buy,
                "accumulate": self.thresholds.accumulate,
                "hold_range": [self.thresholds.hold_low, self.thresholds.hold_high],
                "reduce": self.thresholds.reduce,
                "sell": self.thresholds.sell,
                "strong_sell": self.thresholds.strong_sell
            },
            "target_distribution": {
                "target_1": self.target_1_sell_pct,
                "target_2": self.target_2_sell_pct,
                "target_3": self.target_3_sell_pct
            },
            "stop_loss_by_asset": {
                "egx": self.stop_loss_egx,
                "crypto": self.stop_loss_crypto,
                "gold": self.stop_loss_gold,
                "forex": self.stop_loss_forex
            },
            "time_stop_by_asset": {
                "egx": self.time_stop_egx,
                "crypto": self.time_stop_crypto,
                "gold": self.time_stop_gold,
                "forex": self.time_stop_forex
            },
            "macro_sensitivity": self.macro_sensitivity,
            "special_rules": self.special_rules
        }


class PersonaEngine:
    """محرك الشخصيات المستثمرة"""
    
    def __init__(self):
        self._personas = self._create_all_personas()
    
    def _create_all_personas(self) -> Dict[PersonaType, InvestorPersona]:
        """إنشاء كل الشخصيات"""
        personas = {}
        
        # 1. المحافظ (Conservative)
        personas[PersonaType.CONSERVATIVE] = InvestorPersona(
            persona_type=PersonaType.CONSERVATIVE,
            name_ar="المحافظ",
            name_en="The Conservative",
            emoji="🛡️",
            risk_tolerance=2,
            description="حماية رأس المال أولاً",
            goal="عائد 5-8% سنوياً مع حماية رأس المال",
            time_horizon="6-12 شهر",
            preferred_assets=["EGX Banks", "EGX Real Estate", "Gold", "USD/EGP"],
            crypto_allowed=False,
            crypto_max_pct=0.0,
            risk_params=RiskParameters(
                max_position_pct=3.0,
                default_stop_loss_pct=6.0,
                default_target_pct=12.0,
                time_stop_days=90,
                leverage_allowed=0.0,
                daily_loss_limit_pct=1.0,
                egx_allocation=0.65,
                crypto_allocation=0.0,
                gold_allocation=0.20,
                forex_allocation=0.0,
                cash_allocation=0.15
            ),
            thresholds=DecisionThresholds(
                strong_buy=85, buy=75, accumulate=60,
                hold_low=40, hold_high=60, reduce=25,
                sell=25, strong_sell=10
            ),
            scoring_weights=PersonaScoringWeights(
                technical=0.15, fundamental=0.40, timing=0.10,
                ai_pattern=0.10, sentiment=0.10, market_regime=0.15
            ),
            target_config=PersonaTargetConfig(
                target_pct=0.12, stop_pct=0.06, time_horizon_days=180,
                min_holding_days=60, max_holding_days=365
            ),
            sort_primary='fundamental_score',
            target_1_sell_pct=0.50, target_2_sell_pct=0.30, target_3_sell_pct=0.20,
            stop_loss_egx=6.0, stop_loss_crypto=0.0, stop_loss_gold=5.0, stop_loss_forex=0.0,
            time_stop_egx=90, time_stop_crypto=0, time_stop_gold=60, time_stop_forex=0,
            macro_sensitivity=0.1,
            special_rules=["no_crypto", "banks_and_realestate_only"]
        )
        
        # 2. المتوسط الحذر (Cautious)
        personas[PersonaType.CAUTIOUS] = InvestorPersona(
            persona_type=PersonaType.CAUTIOUS,
            name_ar="المتوسط الحذر",
            name_en="The Cautious Average",
            emoji="🐢",
            risk_tolerance=4,
            description="عائد معقول مع حذر",
            goal="عائد 10-15% سنوياً مع قبول خسارة 5%",
            time_horizon="3-6 أشهر",
            preferred_assets=["EGX Diversified", "Gold", "BTC (limited)"],
            crypto_allowed=True,
            crypto_max_pct=5.0,
            risk_params=RiskParameters(
                max_position_pct=5.0,
                default_stop_loss_pct=8.0,
                default_target_pct=15.0,
                time_stop_days=60,
                leverage_allowed=0.0,
                daily_loss_limit_pct=2.0,
                egx_allocation=0.55,
                crypto_allocation=0.05,
                gold_allocation=0.20,
                forex_allocation=0.0,
                cash_allocation=0.20
            ),
            thresholds=DecisionThresholds(
                strong_buy=80, buy=70, accumulate=55,
                hold_low=35, hold_high=55, reduce=20,
                sell=20, strong_sell=10
            ),
            scoring_weights=PersonaScoringWeights(
                technical=0.20, fundamental=0.35, timing=0.10,
                ai_pattern=0.15, sentiment=0.10, market_regime=0.10
            ),
            target_config=PersonaTargetConfig(
                target_pct=0.10, stop_pct=0.08, time_horizon_days=90,
                min_holding_days=30, max_holding_days=180
            ),
            sort_primary='fundamental_score',
            target_1_sell_pct=0.40, target_2_sell_pct=0.35, target_3_sell_pct=0.25,
            stop_loss_egx=8.0, stop_loss_crypto=10.0, stop_loss_gold=6.0, stop_loss_forex=4.0,
            time_stop_egx=60, time_stop_crypto=30, time_stop_gold=45, time_stop_forex=30,
            macro_sensitivity=0.2,
            special_rules=["btc_only_for_crypto"]
        )
        
        # 3. المتوازن (Balanced)
        personas[PersonaType.BALANCED] = InvestorPersona(
            persona_type=PersonaType.BALANCED,
            name_ar="المتوازن",
            name_en="The Balanced",
            emoji="⚖️",
            risk_tolerance=5,
            description="توازن بين العائد والمخاطر",
            goal="عائد 15-25% سنوياً",
            time_horizon="1-3 أشهر",
            preferred_assets=["EGX", "BTC", "ETH", "Gold"],
            crypto_allowed=True,
            crypto_max_pct=15.0,
            risk_params=RiskParameters(
                max_position_pct=7.0,
                default_stop_loss_pct=10.0,
                default_target_pct=20.0,
                time_stop_days=45,
                leverage_allowed=0.0,
                daily_loss_limit_pct=3.0,
                egx_allocation=0.50,
                crypto_allocation=0.15,
                gold_allocation=0.15,
                forex_allocation=0.05,
                cash_allocation=0.15
            ),
            thresholds=DecisionThresholds(
                strong_buy=80, buy=65, accumulate=50,
                hold_low=30, hold_high=50, reduce=20,
                sell=20, strong_sell=10
            ),
            scoring_weights=PersonaScoringWeights(
                technical=0.25, fundamental=0.25, timing=0.10,
                ai_pattern=0.20, sentiment=0.10, market_regime=0.10
            ),
            target_config=PersonaTargetConfig(
                target_pct=0.10, stop_pct=0.10, time_horizon_days=45,
                min_holding_days=14, max_holding_days=90
            ),
            sort_primary='adjusted_score',
            target_1_sell_pct=0.30, target_2_sell_pct=0.40, target_3_sell_pct=0.30,
            stop_loss_egx=10.0, stop_loss_crypto=12.0, stop_loss_gold=7.0, stop_loss_forex=5.0,
            time_stop_egx=45, time_stop_crypto=21, time_stop_gold=30, time_stop_forex=21,
            macro_sensitivity=0.3,
            special_rules=[]
        )
        
        # 4. المضارب المنتظم (Active Trader)
        personas[PersonaType.ACTIVE_TRADER] = InvestorPersona(
            persona_type=PersonaType.ACTIVE_TRADER,
            name_ar="المضارب المنتظم",
            name_en="The Active Trader",
            emoji="🎯",
            risk_tolerance=6,
            description="تداول نشط مع انضباط",
            goal="عائد 25-40% سنوياً",
            time_horizon="1-4 أسابيع",
            preferred_assets=["EGX Mid-cap", "Crypto Top 10", "Gold"],
            crypto_allowed=True,
            crypto_max_pct=25.0,
            risk_params=RiskParameters(
                max_position_pct=8.0,
                default_stop_loss_pct=10.0,
                default_target_pct=18.0,
                time_stop_days=25,
                leverage_allowed=0.0,
                daily_loss_limit_pct=4.0,
                egx_allocation=0.40,
                crypto_allocation=0.25,
                gold_allocation=0.10,
                forex_allocation=0.10,
                cash_allocation=0.15
            ),
            thresholds=DecisionThresholds(
                strong_buy=75, buy=60, accumulate=45,
                hold_low=25, hold_high=45, reduce=15,
                sell=15, strong_sell=5
            ),
            scoring_weights=PersonaScoringWeights(
                technical=0.35, fundamental=0.20, timing=0.10,
                ai_pattern=0.20, sentiment=0.10, market_regime=0.05
            ),
            target_config=PersonaTargetConfig(
                target_pct=0.08, stop_pct=0.10, time_horizon_days=25,
                min_holding_days=3, max_holding_days=30
            ),
            sort_primary='technical_score',
            target_1_sell_pct=0.25, target_2_sell_pct=0.35, target_3_sell_pct=0.40,
            stop_loss_egx=10.0, stop_loss_crypto=15.0, stop_loss_gold=8.0, stop_loss_forex=6.0,
            time_stop_egx=25, time_stop_crypto=14, time_stop_gold=21, time_stop_forex=14,
            macro_sensitivity=0.4,
            special_rules=["no_leverage_egx"]
        )
        
        # 5. المغامر (Adventurer)
        personas[PersonaType.ADVENTURER] = InvestorPersona(
            persona_type=PersonaType.ADVENTURER,
            name_ar="المغامر",
            name_en="The Adventurer",
            emoji="🎲",
            risk_tolerance=7,
            description="مخاطر عالية مقابل عوائد كبيرة",
            goal="عائد 40-70% سنوياً",
            time_horizon="1 أسبوع - 1 شهر",
            preferred_assets=["Crypto Altcoins", "EGX Small caps", "Forex"],
            crypto_allowed=True,
            crypto_max_pct=40.0,
            risk_params=RiskParameters(
                max_position_pct=10.0,
                default_stop_loss_pct=12.0,
                default_target_pct=25.0,
                time_stop_days=20,
                leverage_allowed=1.0,
                daily_loss_limit_pct=5.0,
                egx_allocation=0.30,
                crypto_allocation=0.40,
                gold_allocation=0.05,
                forex_allocation=0.15,
                cash_allocation=0.10
            ),
            thresholds=DecisionThresholds(
                strong_buy=70, buy=55, accumulate=40,
                hold_low=20, hold_high=40, reduce=10,
                sell=10, strong_sell=5
            ),
            scoring_weights=PersonaScoringWeights(
                technical=0.45, fundamental=0.10, timing=0.10,
                ai_pattern=0.20, sentiment=0.10, market_regime=0.05
            ),
            target_config=PersonaTargetConfig(
                target_pct=0.06, stop_pct=0.12, time_horizon_days=14,
                min_holding_days=2, max_holding_days=20
            ),
            sort_primary='technical_score',
            target_1_sell_pct=0.20, target_2_sell_pct=0.30, target_3_sell_pct=0.50,
            stop_loss_egx=12.0, stop_loss_crypto=18.0, stop_loss_gold=10.0, stop_loss_forex=8.0,
            time_stop_egx=20, time_stop_crypto=10, time_stop_gold=14, time_stop_forex=10,
            macro_sensitivity=0.5,
            special_rules=["limited_leverage_crypto"]
        )
        
        # 6. المقامر المحسن (Gambler)
        personas[PersonaType.GAMBLER] = InvestorPersona(
            persona_type=PersonaType.GAMBLER,
            name_ar="المقامر المحسن",
            name_en="The Calculated Gambler",
            emoji="🔥",
            risk_tolerance=9,
            description="مخاطر عالية جداً مع وعي",
            goal="عائد 70-150% سنوياً (أو خسارة كبيرة)",
            time_horizon="1-7 أيام",
            preferred_assets=["Crypto Meme", "Crypto Futures", "Forex High Vol"],
            crypto_allowed=True,
            crypto_max_pct=60.0,
            risk_params=RiskParameters(
                max_position_pct=15.0,
                default_stop_loss_pct=15.0,
                default_target_pct=30.0,
                time_stop_days=10,
                leverage_allowed=2.0,
                daily_loss_limit_pct=5.0,
                egx_allocation=0.15,
                crypto_allocation=0.60,
                gold_allocation=0.0,
                forex_allocation=0.15,
                cash_allocation=0.10
            ),
            thresholds=DecisionThresholds(
                strong_buy=65, buy=50, accumulate=35,
                hold_low=15, hold_high=35, reduce=5,
                sell=5, strong_sell=0
            ),
            scoring_weights=PersonaScoringWeights(
                technical=0.50, fundamental=0.10, timing=0.05,
                ai_pattern=0.20, sentiment=0.10, market_regime=0.05
            ),
            target_config=PersonaTargetConfig(
                target_pct=0.04, stop_pct=0.08, time_horizon_days=5,
                min_holding_days=1, max_holding_days=7
            ),
            sort_primary='technical_score',
            target_1_sell_pct=0.15, target_2_sell_pct=0.25, target_3_sell_pct=0.60,
            stop_loss_egx=15.0, stop_loss_crypto=25.0, stop_loss_gold=0.0, stop_loss_forex=10.0,
            time_stop_egx=10, time_stop_crypto=7, time_stop_gold=0, time_stop_forex=7,
            macro_sensitivity=0.6,
            special_rules=["warning_popup_required", "daily_loss_limit_enforced", "max_leverage_2x_crypto"]
        )
        
        # 7. المتحوط المؤسسي (Hedger)
        personas[PersonaType.HEDGER] = InvestorPersona(
            persona_type=PersonaType.HEDGER,
            name_ar="المتحوط المؤسسي",
            name_en="The Hedger",
            emoji="🏛️",
            risk_tolerance=3,
            description="حماية من التضخم وانهيار العملة",
            goal="حماية قيمة المدخرات",
            time_horizon="1-3 سنوات",
            preferred_assets=["Gold", "USD/EGP", "EGX Dividend", "BTC (hedge)"],
            crypto_allowed=True,
            crypto_max_pct=10.0,
            risk_params=RiskParameters(
                max_position_pct=8.0,
                default_stop_loss_pct=10.0,
                default_target_pct=25.0,
                time_stop_days=180,
                leverage_allowed=0.0,
                daily_loss_limit_pct=2.0,
                egx_allocation=0.25,
                crypto_allocation=0.10,
                gold_allocation=0.30,
                forex_allocation=0.25,
                cash_allocation=0.10
            ),
            thresholds=DecisionThresholds(
                strong_buy=80, buy=70, accumulate=60,
                hold_low=40, hold_high=60, reduce=30,
                sell=30, strong_sell=15
            ),
            scoring_weights=PersonaScoringWeights(
                technical=0.10, fundamental=0.35, timing=0.05,
                ai_pattern=0.10, sentiment=0.15, market_regime=0.25
            ),
            target_config=PersonaTargetConfig(
                target_pct=0.15, stop_pct=0.10, time_horizon_days=180,
                min_holding_days=90, max_holding_days=365
            ),
            sort_primary='fundamental_score',
            target_1_sell_pct=0.30, target_2_sell_pct=0.30, target_3_sell_pct=0.40,
            stop_loss_egx=10.0, stop_loss_crypto=15.0, stop_loss_gold=12.0, stop_loss_forex=8.0,
            time_stop_egx=180, time_stop_crypto=90, time_stop_gold=120, time_stop_forex=60,
            macro_sensitivity=-0.2,
            special_rules=["inverse_macro_behavior", "dividend_focus"]
        )
        
        return personas
    
    def get_persona(self, persona_type: str) -> Optional[InvestorPersona]:
        """الحصول على شخصية معينة"""
        try:
            if isinstance(persona_type, str):
                persona_type = PersonaType(persona_type.lower())
            return self._personas.get(persona_type)
        except ValueError:
            return None
    
    def get_all_personas(self) -> List[InvestorPersona]:
        """الحصول على كل الشخصيات"""
        return list(self._personas.values())
    
    def get_all_personas_dict(self) -> Dict[str, dict]:
        """الحصول على كل الشخصيات كـ dictionary"""
        return {pt.value: p.to_dict() for pt, p in self._personas.items()}


# إنشاء instance عام
persona_engine = PersonaEngine()


__all__ = [
    'PersonaEngine', 'PersonaType', 'InvestorPersona',
    'RiskParameters', 'DecisionThresholds', 'persona_engine',
    'PersonaScoringWeights', 'PersonaTargetConfig'
]
