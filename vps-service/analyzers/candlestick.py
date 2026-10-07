"""
Candlestick Analyzer
====================
Candlestick Pattern Recognition for trading signals.

Features:
- Single candle patterns (Hammer, Doji, etc.)
- Double candle patterns (Engulfing, Harami, etc.)
- Triple candle patterns (Morning/Evening Star)
- Pattern confirmation rules

Author: دليل الاستثمار
"""

from typing import Dict, List, Optional
from dataclasses import dataclass
from enum import Enum


class CandleDirection(Enum):
    BULLISH = "BULLISH"
    BEARISH = "BEARISH"
    NEUTRAL = "NEUTRAL"


@dataclass
class CandleData:
    """Single candle data."""
    open: float
    high: float
    low: float
    close: float
    volume: Optional[float] = None


@dataclass
class CandleSignal:
    """Candlestick pattern signal."""
    pattern_name: str
    pattern_name_ar: str
    signal_direction: str  # BULLISH, BEARISH
    confidence: float
    strength: str  # STRONG, MODERATE, WEAK
    entry_price: float
    stop_loss: float
    target_price: float
    description: str
    confirmation_rules: List[str]
    filter_status: Dict
    risk_reward_ratio: float = 0.0
    # Maestro Human: السياق السعري
    context_desc: str = ""
    strength_label: str = ""  # قوي / متوسط / ضعيف
    # تحليل فنى: موقع الشمعة بالنسبة للدعم/المقاومة
    at_support: bool = False       # الشمعة عند نقطة دعم
    at_resistance: bool = False    # الشمعة عند نقطة مقاومة
    support_level: float = 0.0     # أقرب دعم
    resistance_level: float = 0.0  # أقرب مقاومة
    distance_to_support_pct: float = 0.0   # المسافة للدعم %
    distance_to_resistance_pct: float = 0.0 # المسافة للمقاومة %


class CandlestickAnalyzer:
    """
    Candlestick Pattern Analyzer.
    
    Usage:
        analyzer = CandlestickAnalyzer()
        signals = analyzer.analyze_candles_batch(candles, trend="UPTREND")
    """
    
    def __init__(
        self,
        fibonacci_analyzer=None,
        stochastic_k: float = None,
        stochastic_d: float = None
    ):
        self.fibonacci_analyzer = fibonacci_analyzer
        self.stochastic_k = stochastic_k
        self.stochastic_d = stochastic_d
    
    def analyze_candles_batch(
        self,
        candles: List[CandleData],
        trend: str = "NEUTRAL"
    ) -> List[CandleSignal]:
        """
        Analyze batch of candles for patterns.
        
        Args:
            candles: List of CandleData (oldest first)
            trend: Current trend (UPTREND, DOWNTREND, NEUTRAL)
            
        Returns:
            List of CandleSignal objects
        """
        signals = []
        
        if len(candles) < 3:
            return signals
        
        # Analyze last 3 candles
        current = candles[-1]
        prev = candles[-2]
        prev2 = candles[-3] if len(candles) >= 3 else None
        
        # Single candle patterns
        signal = self._analyze_single_candle(current, trend)
        if signal:
            signals.append(signal)
        
        # Double candle patterns
        signal = self._analyze_double_candle(prev, current, trend)
        if signal:
            signals.append(signal)
        
        # Triple candle patterns
        if prev2:
            signal = self._analyze_triple_candle(prev2, prev, current, trend)
            if signal:
                signals.append(signal)
        
        return signals
    
    def _analyze_single_candle(self, candle: CandleData, trend: str) -> Optional[CandleSignal]:
        """Analyze single candle patterns."""
        body = abs(candle.close - candle.open)
        range_high_low = candle.high - candle.low
        upper_shadow = candle.high - max(candle.open, candle.close)
        lower_shadow = min(candle.open, candle.close) - candle.low
        
        if range_high_low == 0:
            return None
        
        body_ratio = body / range_high_low
        
        # Hammer (bullish reversal)
        if lower_shadow >= body * 2 and upper_shadow < body * 0.5:
            return CandleSignal(
                pattern_name="HAMMER",
                pattern_name_ar="المطرقة",
                signal_direction="BULLISH",
                confidence=0.7 if trend == "DOWNTREND" else 0.5,
                strength="MODERATE",
                entry_price=candle.close,
                stop_loss=candle.low * 0.98,
                target_price=candle.close * 1.03,
                description="Hammer - bullish reversal signal",
                confirmation_rules=["Wait for next candle close above hammer high"],
                filter_status=self._check_filters(candle.close, "BULLISH")
            )
        
        # Shooting Star (bearish reversal)
        if upper_shadow >= body * 2 and lower_shadow < body * 0.5:
            return CandleSignal(
                pattern_name="SHOOTING_STAR",
                pattern_name_ar="النجمة اللامعة",
                signal_direction="BEARISH",
                confidence=0.7 if trend == "UPTREND" else 0.5,
                strength="MODERATE",
                entry_price=candle.close,
                stop_loss=candle.high * 1.02,
                target_price=candle.close * 0.97,
                description="Shooting Star - bearish reversal signal",
                confirmation_rules=["Wait for next candle close below star low"],
                filter_status=self._check_filters(candle.close, "BEARISH")
            )
        
        # Doji (indecision)
        if body_ratio < 0.1:
            return CandleSignal(
                pattern_name="DOJI",
                pattern_name_ar="دوجي",
                signal_direction="NEUTRAL",
                confidence=0.6,
                strength="WEAK",
                entry_price=candle.close,
                stop_loss=candle.high,
                target_price=candle.close,
                description="Doji - market indecision",
                confirmation_rules=["Wait for breakout of doji range"],
                filter_status={'overall_filter_passed': False}
            )
        
        return None
    
    def _analyze_double_candle(
        self,
        prev: CandleData,
        current: CandleData,
        trend: str
    ) -> Optional[CandleSignal]:
        """Analyze double candle patterns."""
        
        # Bullish Engulfing
        if (prev.close < prev.open and  # Previous is bearish
            current.close > current.open and  # Current is bullish
            current.open < prev.close and  # Current opens below prev close
            current.close > prev.open):  # Current closes above prev open
            
            return CandleSignal(
                pattern_name="BULLISH_ENGULFING",
                pattern_name_ar="الابتلاع الصاعد",
                signal_direction="BULLISH",
                confidence=0.8 if trend == "DOWNTREND" else 0.6,
                strength="STRONG",
                entry_price=current.close,
                stop_loss=min(prev.low, current.low) * 0.98,
                target_price=current.close * 1.05,
                description="Bullish Engulfing - strong reversal signal",
                confirmation_rules=["Next candle should be bullish"],
                filter_status=self._check_filters(current.close, "BULLISH"),
                risk_reward_ratio=2.5
            )
        
        # Bearish Engulfing
        if (prev.close > prev.open and  # Previous is bullish
            current.close < current.open and  # Current is bearish
            current.open > prev.close and  # Current opens above prev close
            current.close < prev.open):  # Current closes below prev open
            
            return CandleSignal(
                pattern_name="BEARISH_ENGULFING",
                pattern_name_ar="الابتلاع الهابط",
                signal_direction="BEARISH",
                confidence=0.8 if trend == "UPTREND" else 0.6,
                strength="STRONG",
                entry_price=current.close,
                stop_loss=max(prev.high, current.high) * 1.02,
                target_price=current.close * 0.95,
                description="Bearish Engulfing - strong reversal signal",
                confirmation_rules=["Next candle should be bearish"],
                filter_status=self._check_filters(current.close, "BEARISH"),
                risk_reward_ratio=2.5
            )
        
        return None
    
    def _analyze_triple_candle(
        self,
        c1: CandleData,
        c2: CandleData,
        c3: CandleData,
        trend: str
    ) -> Optional[CandleSignal]:
        """Analyze triple candle patterns."""
        
        # Morning Star (bullish reversal)
        if (c1.close < c1.open and  # First candle bearish
            abs(c2.close - c2.open) < (c1.open - c1.close) * 0.3 and  # Second candle small
            c3.close > c3.open and  # Third candle bullish
            c3.close > (c1.open + c1.close) / 2):  # Third closes above middle of first
            
            return CandleSignal(
                pattern_name="MORNING_STAR",
                pattern_name_ar="نجمة الصباح",
                signal_direction="BULLISH",
                confidence=0.85,
                strength="STRONG",
                entry_price=c3.close,
                stop_loss=min(c1.low, c2.low, c3.low) * 0.98,
                target_price=c3.close * 1.05,
                description="Morning Star - strong bullish reversal",
                confirmation_rules=["Strong bullish signal confirmed"],
                filter_status=self._check_filters(c3.close, "BULLISH"),
                risk_reward_ratio=3.0
            )
        
        # Evening Star (bearish reversal)
        if (c1.close > c1.open and  # First candle bullish
            abs(c2.close - c2.open) < (c1.close - c1.open) * 0.3 and  # Second candle small
            c3.close < c3.open and  # Third candle bearish
            c3.close < (c1.open + c1.close) / 2):  # Third closes below middle of first
            
            return CandleSignal(
                pattern_name="EVENING_STAR",
                pattern_name_ar="نجمة المساء",
                signal_direction="BEARISH",
                confidence=0.85,
                strength="STRONG",
                entry_price=c3.close,
                stop_loss=max(c1.high, c2.high, c3.high) * 1.02,
                target_price=c3.close * 0.95,
                description="Evening Star - strong bearish reversal",
                confirmation_rules=["Strong bearish signal confirmed"],
                filter_status=self._check_filters(c3.close, "BEARISH"),
                risk_reward_ratio=3.0
            )
        
        return None
    
    def _check_filters(self, price: float, direction: str) -> Dict:
        """Check signal against filters."""
        result = {
            'stochastic_filter': False,
            'fibonacci_filter': False,
            'overall_filter_passed': False
        }
        
        # Stochastic filter
        if self.stochastic_d is not None:
            if direction == "BULLISH" and self.stochastic_d < 30:
                result['stochastic_filter'] = True
            elif direction == "BEARISH" and self.stochastic_d > 70:
                result['stochastic_filter'] = True
        else:
            result['stochastic_filter'] = True  # No filter if no data
        
        # Fibonacci filter
        if self.fibonacci_analyzer:
            result['fibonacci_filter'] = True  # Simplified
        else:
            result['fibonacci_filter'] = True
        
        # Overall
        result['overall_filter_passed'] = result['stochastic_filter'] or result['fibonacci_filter']
        
        return result
    
    def get_best_signal(self, signals: List[CandleSignal] = None) -> Optional[CandleSignal]:
        """Get the best signal from list."""
        if not signals:
            return None
        
        # Sort by confidence and filter status
        valid_signals = [s for s in signals if s.signal_direction != "NEUTRAL"]
        if not valid_signals:
            return None
        
        return max(valid_signals, key=lambda s: s.confidence)
    
    def enrich_with_context(self, signal: CandleSignal, candles: List[CandleData], 
                             price_level: str = '', volume_ratio: float = 1.0,
                             market_regime: str = 'SIDEWAYS',
                             support: float = None, resistance: float = None) -> CandleSignal:
        """
        Maestro Human: ربط نمط الشمعة بالسياق السعري
        
        Args:
            signal: الإشارة الأصلية
            candles: قائمة الشموع (لحساب الدعم/المقاومة)
            price_level: وصف مكان السعر (مثلاً: 'عند دعم 15.20')
            volume_ratio: نسبة السيولة للمتوسط
            market_regime: حالة السوق (BULL/BEAR/SIDEWAYS)
            support: مستوى الدعم الفعلي (من S/R Calculator) — لو مش موجود يتحسب من الشموع
            resistance: مستوى المقاومة الفعلي (من S/R Calculator) — لو مش موجود يتحسب من الشموع
        
        Returns:
            CandleSignal مع سياق إضافي + at_support/at_resistance
        """
        if not signal:
            return signal
        
        # حساب الدعم والمقاومة — أولوية: المعطيات الخارجية → من الشموع الأخيرة
        if support is None or support <= 0:
            recent_lows = [c.low for c in candles[-10:] if c.low]
            support = min(recent_lows) if recent_lows else 0
        if resistance is None or resistance <= 0:
            recent_highs = [c.high for c in candles[-10:] if c.high]
            resistance = max(recent_highs) if recent_highs else 0
        current_price = candles[-1].close if candles else 0
        
        # تحديد موقع السعر بالنسبة للدعم/المقاومة
        at_support = False
        at_resistance = False
        dist_to_support_pct = 0.0
        dist_to_resistance_pct = 0.0
        
        if support and support > 0 and current_price > 0:
            dist_to_support_pct = ((current_price - support) / current_price) * 100
            if dist_to_support_pct <= 3.0:  # خلال 3% من الدعم
                at_support = True
        if resistance and resistance > 0 and current_price > 0:
            dist_to_resistance_pct = ((resistance - current_price) / current_price) * 100
            if dist_to_resistance_pct <= 3.0:  # خلال 3% من المقاومة
                at_resistance = True
        
        # تحديث الـ signal ببيانات الدعم/المقاومة
        signal.at_support = at_support
        signal.at_resistance = at_resistance
        signal.support_level = support
        signal.resistance_level = resistance
        signal.distance_to_support_pct = round(dist_to_support_pct, 2)
        signal.distance_to_resistance_pct = round(dist_to_resistance_pct, 2)
        
        # حساب النطاق العرضي
        price_range = resistance - support if resistance > support else current_price
        position_in_range = (current_price - support) / price_range if price_range > 0 else 0.5
        
        # تحديد القوة بناءً على السياق
        strength_label = 'متوسط'
        confidence_boost = 0
        
        pattern = signal.pattern_name
        direction = signal.signal_direction
        
        # === Hammer ===
        if pattern == 'HAMMER':
            if position_in_range < 0.2 and volume_ratio > 1.3:
                strength_label = 'قوي'
                confidence_boost = 0.2
                signal.context_desc = f'Hammer عند دعم {support:.2f}' + (f' ({price_level})' if price_level else '') + f' + السيولة أعلى من المتوسط'
            elif position_in_range > 0.8:
                strength_label = 'ضعيف'
                confidence_boost = -0.1
                signal.context_desc = 'Hammer في منتصف النطاق العرضي — ضعيف'
            else:
                signal.context_desc = f'Hammer عند {current_price:.2f}' + (f' ({price_level})' if price_level else '')
        
        # === Bullish Engulfing ===
        elif pattern == 'BULLISH_ENGULFING':
            # شوف آخر 3 أيام نزول متتالي
            consecutive_down = 0
            for c in reversed(candles[:-1]):
                if c.close < c.open:
                    consecutive_down += 1
                else:
                    break
            
            if consecutive_down >= 3 and market_regime in ['BULL', 'SIDEWAYS']:
                strength_label = 'قوي'
                confidence_boost = 0.15
                signal.context_desc = f'ابتلاع صاعد بعد {consecutive_down} أيام نزول متتالي'
            elif market_regime == 'BULL':
                strength_label = 'متوسط'
                signal.context_desc = 'ابتلاع صاعد في سوق صاعد — استمرار محتمل'
            else:
                signal.context_desc = f'ابتلاع صاعد عند {current_price:.2f}'
        
        # === Bearish Engulfing ===
        elif pattern == 'BEARISH_ENGULFING':
            consecutive_up = 0
            for c in reversed(candles[:-1]):
                if c.close > c.open:
                    consecutive_up += 1
                else:
                    break
            
            if consecutive_up >= 3 and market_regime in ['BEAR', 'SIDEWAYS']:
                strength_label = 'قوي'
                confidence_boost = 0.15
                signal.context_desc = f'ابتلاع هابط بعد {consecutive_up} أيام صعود متتالي'
            elif market_regime == 'BEAR':
                strength_label = 'متوسط'
                signal.context_desc = 'ابتلاع هابط في سوق هابط — استمرار محتمل'
            else:
                signal.context_desc = f'ابتلاع هابط عند {current_price:.2f}'
        
        # === Shooting Star ===
        elif pattern == 'SHOOTING_STAR':
            if position_in_range > 0.8:
                strength_label = 'قوي'
                confidence_boost = 0.15
                signal.context_desc = f'نجمة لامعة قرب مقاومة {resistance:.2f} — تحذير هبوط'
            else:
                signal.context_desc = f'نجمة لامعة عند {current_price:.2f}'
        
        # === Doji ===
        elif pattern == 'DOJI':
            if position_in_range > 0.8:
                strength_label = 'قوي'
                signal.context_desc = f'دوجي عند قمة تاريخية ({resistance:.2f}) — تحذير انعكاس'
            elif position_in_range < 0.2 and volume_ratio > 1.3:
                strength_label = 'متوسط'
                signal.context_desc = 'دوجي عند دعم قوي + سيولة عالية — تردد قبل الصعود'
            else:
                signal.context_desc = 'دوجي — تردد في السوق'
        
        # === Morning Star ===
        elif pattern == 'MORNING_STAR':
            strength_label = 'قوي'
            if position_in_range < 0.3:
                signal.context_desc = f'نجمة صباح قوية عند منطقة دعم {support:.2f}'
            else:
                signal.context_desc = 'نجمة صباح — انعكاس صاعد قوي'
        
        # === Evening Star ===
        elif pattern == 'EVENING_STAR':
            strength_label = 'قوي'
            if position_in_range > 0.7:
                signal.context_desc = f'نجمة مساء قوية عند منطقة مقاومة {resistance:.2f}'
            else:
                signal.context_desc = 'نجمة مساء — انعكاس هابط قوي'
        
        else:
            signal.context_desc = f'{signal.pattern_name} عند {current_price:.2f}'
        
        # تحديث الثقة
        signal.confidence = max(0.1, min(0.95, signal.confidence + confidence_boost))
        signal.strength_label = strength_label
        
        return signal
