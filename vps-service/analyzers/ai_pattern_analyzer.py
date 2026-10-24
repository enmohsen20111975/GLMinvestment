"""
AI Pattern Analyzer
====================
محلل الأنماط بالذكاء الاصطناعي

Phase 3: AI & Sentiment Analysis

Features:
- Candlestick Pattern Recognition
- Chart Pattern Detection (Head & Shoulders, Double Top/Bottom, etc.)
- Support/Resistance Level Detection
- Trend Analysis with ML
- Volume Profile Analysis
- Momentum Pattern Recognition
- Mean Reversion Signals

Author: دليل الاستثمار (Phase 3 - AI Enhancement)
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
import sqlite3
from datetime import datetime
import math


# ============================================================================
# PATTERN CONFIGURATION
# ============================================================================

PATTERN_CONFIG = {
    # Pattern weights (how much each pattern affects score)
    'candlestick_weight': 0.20,
    'chart_pattern_weight': 0.25,
    'support_resistance_weight': 0.20,
    'trend_weight': 0.20,
    'volume_pattern_weight': 0.15,
    
    # Pattern confidence thresholds
    'min_pattern_length': 5,     # Minimum candles for pattern
    'support_tolerance': 0.02,    # 2% tolerance for support/resistance
    'breakout_threshold': 0.03,   # 3% breakout confirmation
}


@dataclass
class PatternResult:
    """Data class for pattern analysis result."""
    ticker: str
    overall_score: float = 50.0  # 0-100 (0=very bearish, 100=very bullish)
    
    # Pattern components
    candlestick_score: float = 50.0
    chart_pattern_score: float = 50.0
    support_resistance_score: float = 50.0
    trend_score: float = 50.0
    volume_pattern_score: float = 50.0
    
    # Detected patterns
    bullish_patterns: List[str] = None
    bearish_patterns: List[str] = None
    
    # Key levels
    support_levels: List[float] = None
    resistance_levels: List[float] = None
    
    # Trend info
    trend_direction: str = 'NEUTRAL'
    trend_strength: float = 50.0
    
    # Score adjustment for master analyzer
    score_adjustment: float = 0.0
    confidence: float = 50.0
    
    def to_dict(self) -> Dict:
        result = asdict(self)
        if self.bullish_patterns is None:
            result['bullish_patterns'] = []
        if self.bearish_patterns is None:
            result['bearish_patterns'] = []
        if self.support_levels is None:
            result['support_levels'] = []
        if self.resistance_levels is None:
            result['resistance_levels'] = []
        return result


class AIPatternAnalyzer:
    """
    محلل الأنماط بالذكاء الاصطناعي
    
    يستخدم تقنيات إحصائية للتعرف على الأنماط:
    1. Candlestick Patterns - أنماط الشموع اليابانية
    2. Chart Patterns - أنماط الرسوم البيانية
    3. Support/Resistance - مستويات الدعم والمقاومة
    4. Trend Analysis - تحليل الاتجاه
    5. Volume Patterns - أنماط الحجم
    
    Usage:
        analyzer = AIPatternAnalyzer(db_path)
        result = analyzer.analyze('COMI', prices, volumes)
    """
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path
        self.config = PATTERN_CONFIG
    
    def analyze(
        self,
        ticker: str,
        prices: List[float] = None,
        volumes: List[float] = None,
        highs: List[float] = None,
        lows: List[float] = None,
        opens: List[float] = None
    ) -> PatternResult:
        """
        Perform AI pattern analysis.
        
        Args:
            ticker: Stock symbol
            prices: Close prices (last 50-100 days)
            volumes: Volume history
            highs: High prices (optional)
            lows: Low prices (optional)
            opens: Open prices (optional)
            
        Returns:
            PatternResult: Complete pattern analysis
        """
        result = PatternResult(ticker=ticker)
        
        bullish_patterns = []
        bearish_patterns = []
        
        # Get price data if not provided
        if prices is None and self.db_path:
            prices, volumes, highs, lows, opens = self._get_price_data(ticker)
        
        if not prices or len(prices) < 10:
            result.bullish_patterns = []
            result.bearish_patterns = []
            return result
        
        # ========================================
        # 1. CANDLESTICK PATTERN ANALYSIS
        # ========================================
        result.candlestick_score = self._analyze_candlestick_patterns(
            prices, highs, lows, opens, bullish_patterns, bearish_patterns
        )
        
        # ========================================
        # 2. CHART PATTERN DETECTION
        # ========================================
        result.chart_pattern_score = self._detect_chart_patterns(
            prices, highs, lows, bullish_patterns, bearish_patterns
        )
        
        # ========================================
        # 3. SUPPORT/RESISTANCE ANALYSIS
        # ========================================
        result.support_resistance_score, result.support_levels, result.resistance_levels = \
            self._analyze_support_resistance(prices, bullish_patterns, bearish_patterns)
        
        # ========================================
        # 4. TREND ANALYSIS
        # ========================================
        result.trend_score, result.trend_direction, result.trend_strength = \
            self._analyze_trend(prices, bullish_patterns, bearish_patterns)
        
        # ========================================
        # 5. VOLUME PATTERN ANALYSIS
        # ========================================
        if volumes and len(volumes) >= 10:
            result.volume_pattern_score = self._analyze_volume_patterns(
                prices, volumes, bullish_patterns, bearish_patterns
            )
        
        # ========================================
        # CALCULATE OVERALL SCORE
        # ========================================
        weights = self.config
        
        result.overall_score = (
            result.candlestick_score * weights['candlestick_weight'] +
            result.chart_pattern_score * weights['chart_pattern_weight'] +
            result.support_resistance_score * weights['support_resistance_weight'] +
            result.trend_score * weights['trend_weight'] +
            result.volume_pattern_score * weights['volume_pattern_weight']
        )
        
        # Calculate score adjustment (-20 to +20)
        result.score_adjustment = (result.overall_score - 50) * 0.4
        
        # Calculate confidence
        result.confidence = self._calculate_confidence(prices, volumes)
        
        # Finalize
        result.bullish_patterns = bullish_patterns
        result.bearish_patterns = bearish_patterns
        
        return result
    
    def _analyze_candlestick_patterns(
        self,
        prices: List[float],
        highs: List[float],
        lows: List[float],
        opens: List[float],
        bullish: List[str],
        bearish: List[str]
    ) -> float:
        """Analyze candlestick patterns."""
        score = 50
        
        if len(prices) < 5:
            return score
        
        # Use close as open/high/low if not provided
        if highs is None:
            highs = [max(prices[max(0, i-1):i+1]) for i in range(len(prices))]
        if lows is None:
            lows = [min(prices[max(0, i-1):i+1]) for i in range(len(prices))]
        if opens is None:
            opens = [prices[max(0, i-1)] for i in range(len(prices))]
        
        # Analyze last 5 candles
        for i in range(max(0, len(prices) - 5), len(prices)):
            if i < 1:
                continue
            
            open_price = opens[i] if i < len(opens) else prices[i-1]
            close_price = prices[i]
            high_price = highs[i] if i < len(highs) else max(open_price, close_price)
            low_price = lows[i] if i < len(lows) else min(open_price, close_price)
            
            body = abs(close_price - open_price)
            total_range = high_price - low_price if high_price > low_price else body
            
            if total_range == 0:
                continue
            
            # Doji pattern (indecision)
            if body / total_range < 0.1:
                if i > 0 and prices[i-1] < prices[i-2] if i > 1 else False:
                    bullish.append("Doji عند الدعم (انعكاس محتمل)")
                    score += 5
                elif i > 0 and prices[i-1] > prices[i-2] if i > 1 else False:
                    bearish.append("Doji عند المقاومة (انعكاس محتمل)")
                    score -= 5
            
            # Hammer / Hanging Man
            lower_shadow = min(open_price, close_price) - low_price
            upper_shadow = high_price - max(open_price, close_price)
            
            if lower_shadow > body * 2 and upper_shadow < body * 0.5:
                if close_price > open_price:  # Bullish hammer
                    bullish.append("Hammer صعودي")
                    score += 8
                elif i > 0 and prices[i-1] < prices[i-2] if i > 1 else False:
                    bullish.append("Hammer عند الدعم")
                    score += 10
            
            # Shooting Star / Inverted Hammer
            if upper_shadow > body * 2 and lower_shadow < body * 0.5:
                if close_price < open_price:
                    bearish.append("Shooting Star هبوطي")
                    score -= 8
                elif i > 0 and prices[i-1] > prices[i-2] if i > 1 else False:
                    bearish.append("Shooting Star عند المقاومة")
                    score -= 10
            
            # Bullish Engulfing
            if i >= 1:
                prev_open = opens[i-1] if i-1 < len(opens) else prices[i-2] if i > 1 else prices[i-1]
                prev_close = prices[i-1]
                
                if (prev_close < prev_open and  # Previous bearish
                    close_price > open_price and  # Current bullish
                    close_price > prev_open and   # Engulfs previous
                    open_price < prev_close):
                    bullish.append("Bullish Engulfing")
                    score += 12
            
            # Bearish Engulfing
            if i >= 1:
                prev_open = opens[i-1] if i-1 < len(opens) else prices[i-2] if i > 1 else prices[i-1]
                prev_close = prices[i-1]
                
                if (prev_close > prev_open and  # Previous bullish
                    close_price < open_price and  # Current bearish
                    close_price < prev_open and   # Engulfs previous
                    open_price > prev_close):
                    bearish.append("Bearish Engulfing")
                    score -= 12
        
        # Morning Star / Evening Star (3-candle patterns)
        if len(prices) >= 3:
            # Morning Star (bullish reversal)
            first_bearish = prices[-3] < opens[-3] if len(opens) >= 3 else False
            second_small = abs(prices[-2] - (opens[-2] if len(opens) >= 2 else prices[-3])) < (highs[-2] - lows[-2]) * 0.3 if len(highs) >= 2 else False
            third_bullish = prices[-1] > (opens[-1] if len(opens) >= 1 else prices[-2])
            
            if first_bearish and second_small and third_bullish:
                bullish.append("Morning Star (انعكاس صعودي)")
                score += 15
            
            # Evening Star (bearish reversal)
            first_bullish = prices[-3] > opens[-3] if len(opens) >= 3 else False
            third_bearish = prices[-1] < (opens[-1] if len(opens) >= 1 else prices[-2])
            
            if first_bullish and second_small and third_bearish:
                bearish.append("Evening Star (انعكاس هبوطي)")
                score -= 15
        
        return max(0, min(100, score))
    
    def _detect_chart_patterns(
        self,
        prices: List[float],
        highs: List[float],
        lows: List[float],
        bullish: List[str],
        bearish: List[str]
    ) -> float:
        """Detect chart patterns."""
        score = 50
        
        if len(prices) < 20:
            return score
        
        # Use prices as highs/lows if not provided
        if highs is None:
            highs = prices
        if lows is None:
            lows = prices
        
        # ========================================
        # Double Top / Double Bottom
        # ========================================
        
        # Find local highs and lows
        local_highs = []
        local_lows = []
        
        for i in range(2, len(prices) - 2):
            # Local high
            if highs[i] > highs[i-1] and highs[i] > highs[i-2] and \
               highs[i] > highs[i+1] and highs[i] > highs[i+2]:
                local_highs.append((i, highs[i]))
            
            # Local low
            if lows[i] < lows[i-1] and lows[i] < lows[i-2] and \
               lows[i] < lows[i+1] and lows[i] < lows[i+2]:
                local_lows.append((i, lows[i]))
        
        # Double Top (bearish)
        if len(local_highs) >= 2:
            last_two_highs = local_highs[-2:]
            if len(last_two_highs) == 2:
                diff = abs(last_two_highs[0][1] - last_two_highs[1][1]) / last_two_highs[0][1]
                if diff < 0.03:  # Within 3%
                    bearish.append("Double Top (نمط هبوطي)")
                    score -= 15
        
        # Double Bottom (bullish)
        if len(local_lows) >= 2:
            last_two_lows = local_lows[-2:]
            if len(last_two_lows) == 2:
                diff = abs(last_two_lows[0][1] - last_two_lows[1][1]) / last_two_lows[0][1]
                if diff < 0.03:
                    bullish.append("Double Bottom (نمط صعودي)")
                    score += 15
        
        # ========================================
        # Head and Shoulders (simplified)
        # ========================================
        if len(local_highs) >= 3:
            # Check for head and shoulders
            shoulders = local_highs[-3:]
            if len(shoulders) == 3:
                left, head, right = shoulders[0][1], shoulders[1][1], shoulders[2][1]
                
                # Head should be higher than both shoulders
                if head > left and head > right:
                    shoulder_diff = abs(left - right) / left
                    if shoulder_diff < 0.05:  # Shoulders roughly equal
                        bearish.append("Head and Shoulders (نمط هبوطي)")
                        score -= 18
        
        # Inverse Head and Shoulders (bullish)
        if len(local_lows) >= 3:
            shoulders = local_lows[-3:]
            if len(shoulders) == 3:
                left, head, right = shoulders[0][1], shoulders[1][1], shoulders[2][1]
                
                if head < left and head < right:
                    shoulder_diff = abs(left - right) / left
                    if shoulder_diff < 0.05:
                        bullish.append("Inverse Head and Shoulders (نمط صعودي)")
                        score += 18
        
        # ========================================
        # Triangle Patterns
        # ========================================
        if len(prices) >= 15:
            recent_highs = [h for _, h in local_highs[-5:]] if len(local_highs) >= 5 else []
            recent_lows = [l for _, l in local_lows[-5:]] if len(local_lows) >= 5 else []
            
            if len(recent_highs) >= 3 and len(recent_lows) >= 3:
                # Descending highs
                descending_highs = all(recent_highs[i] >= recent_highs[i+1] for i in range(len(recent_highs)-1))
                # Ascending lows
                ascending_lows = all(recent_lows[i] <= recent_lows[i+1] for i in range(len(recent_lows)-1))
                
                if descending_highs and ascending_lows:
                    bullish.append("Symmetrical Triangle (انتظار الكسر)")
                    # Neutral pattern, small boost
                    score += 3
                
                # Ascending triangle (bullish)
                if all(abs(recent_highs[i] - recent_highs[0]) / recent_highs[0] < 0.02 for i in range(len(recent_highs))):
                    if ascending_lows:
                        bullish.append("Ascending Triangle (نمط صعودي)")
                        score += 12
                
                # Descending triangle (bearish)
                if all(abs(recent_lows[i] - recent_lows[0]) / recent_lows[0] < 0.02 for i in range(len(recent_lows))):
                    if descending_highs:
                        bearish.append("Descending Triangle (نمط هبوطي)")
                        score -= 12
        
        # ========================================
        # Channel Detection
        # ========================================
        if len(prices) >= 20:
            # Calculate regression line for trend
            x = list(range(len(prices[-20:])))
            y = prices[-20:]
            n = len(x)
            
            sum_x = sum(x)
            sum_y = sum(y)
            sum_xy = sum(x[i] * y[i] for i in range(n))
            sum_x2 = sum(x[i] ** 2 for i in range(n))
            
            slope = (n * sum_xy - sum_x * sum_y) / (n * sum_x2 - sum_x ** 2) if (n * sum_x2 - sum_x ** 2) != 0 else 0
            intercept = (sum_y - slope * sum_x) / n
            
            # Check if prices are in a channel
            deviations = [y[i] - (slope * x[i] + intercept) for i in range(n)]
            std_dev = (sum(d ** 2 for d in deviations) / n) ** 0.5 if n > 0 else 0
            
            # Price near channel boundary
            current_deviation = deviations[-1] if deviations else 0
            
            if std_dev > 0:
                if current_deviation < -std_dev * 1.5:
                    bullish.append("السعر عند الحد السفلي للقناة")
                    score += 8
                elif current_deviation > std_dev * 1.5:
                    bearish.append("السعر عند الحد العلوي للقناة")
                    score -= 8
        
        return max(0, min(100, score))
    
    def _analyze_support_resistance(
        self,
        prices: List[float],
        bullish: List[str],
        bearish: List[str]
    ) -> Tuple[float, List[float], List[float]]:
        """Analyze support and resistance levels."""
        score = 50
        support_levels = []
        resistance_levels = []
        
        if len(prices) < 20:
            return score, support_levels, resistance_levels
        
        current_price = prices[-1]
        
        # Find significant levels using pivot points
        for i in range(5, len(prices) - 5):
            # Check if this is a local extreme
            window = prices[i-5:i+5]
            if prices[i] == max(window):
                # Potential resistance
                resistance_levels.append(prices[i])
            elif prices[i] == min(window):
                # Potential support
                support_levels.append(prices[i])
        
        # Cluster nearby levels
        support_levels = self._cluster_levels(support_levels)
        resistance_levels = self._cluster_levels(resistance_levels)
        
        # Score based on position relative to levels
        nearest_support = None
        nearest_resistance = None
        
        for level in sorted(support_levels, reverse=True):
            if level < current_price:
                nearest_support = level
                break
        
        for level in sorted(resistance_levels):
            if level > current_price:
                nearest_resistance = level
                break
        
        # Calculate distance to levels
        if nearest_support:
            support_distance = (current_price - nearest_support) / current_price * 100
            if support_distance < 2:
                bullish.append("السعر قريب من دعم قوي")
                score += 10
            elif support_distance < 5:
                score += 5
        
        if nearest_resistance:
            resistance_distance = (nearest_resistance - current_price) / current_price * 100
            if resistance_distance < 2:
                bearish.append("السعر قريب من مقاومة قوية")
                score -= 10
            elif resistance_distance < 5:
                score -= 5
        
        # Check for breakout
        if nearest_resistance and current_price > nearest_resistance * 1.02:
            bullish.append(f"كسر مقاومة ({nearest_resistance:.2f})")
            score += 12
        
        if nearest_support and current_price < nearest_support * 0.98:
            bearish.append(f"كسر دعم ({nearest_support:.2f})")
            score -= 12
        
        return max(0, min(100, score)), support_levels, resistance_levels
    
    def _cluster_levels(self, levels: List[float], tolerance: float = 0.02) -> List[float]:
        """Cluster nearby price levels."""
        if not levels:
            return []
        
        levels = sorted(levels)
        clusters = []
        current_cluster = [levels[0]]
        
        for level in levels[1:]:
            if abs(level - current_cluster[-1]) / current_cluster[-1] < tolerance:
                current_cluster.append(level)
            else:
                clusters.append(sum(current_cluster) / len(current_cluster))
                current_cluster = [level]
        
        clusters.append(sum(current_cluster) / len(current_cluster))
        
        return clusters
    
    def _analyze_trend(
        self,
        prices: List[float],
        bullish: List[str],
        bearish: List[str]
    ) -> Tuple[float, str, float]:
        """Analyze trend direction and strength.
        
        🔥 FIXED: Uses percentage returns instead of absolute prices
        This makes analysis independent of price scale
        """
        if len(prices) < 20:
            # NEUTRAL DEFAULT (50.0) — semantic neutral, not fabrication (Rule 27 exception for scoring)
            return 50, 'NEUTRAL', 50
        
        # Calculate percentage returns for trend analysis
        returns = []
        for i in range(1, len(prices)):
            if prices[i-1] > 0:
                ret = (prices[i] - prices[i-1]) / prices[i-1] * 100
                returns.append(ret)
        
        if len(returns) < 19:
            # NEUTRAL DEFAULT (50.0) — semantic neutral, not fabrication (Rule 27 exception for scoring)
            return 50, 'NEUTRAL', 50
        
        # Calculate trend from returns
        avg_return = sum(returns) / len(returns)
        recent_return = sum(returns[-5:]) / 5 if len(returns) >= 5 else avg_return
        
        # Trend score based on returns
        score = 50
        direction = 'NEUTRAL'
        strength = 50
        
        # Average return analysis
        if avg_return > 0.1:  # Positive average return
            score += 10
            direction = 'BULLISH'
        elif avg_return < -0.1:  # Negative average return
            score -= 10
            direction = 'BEARISH'
        
        # Recent momentum
        if recent_return > 0.5:
            score += 8
            bullish.append(f"زخم إيجابي حديث (+{recent_return:.2f}%)")
            strength = 65
        elif recent_return < -0.5:
            score -= 8
            bearish.append(f"زخم سلبي حديث ({recent_return:.2f}%)")
            strength = 35
        
        # Price vs Moving Averages (normalized)
        current_price = prices[-1]
        sma_20 = sum(prices[-20:]) / 20
        sma_50 = sum(prices[-min(50, len(prices)):]) / min(50, len(prices))
        
        # Calculate percentage above/below MA
        pct_above_ma20 = (current_price - sma_20) / sma_20 * 100 if sma_20 > 0 else 0
        
        if pct_above_ma20 > 5:
            score += 10
            bullish.append(f"السعر فوق MA20 بـ {pct_above_ma20:.1f}%")
            strength = 70
        elif pct_above_ma20 < -5:
            score -= 10
            bearish.append(f"السعر تحت MA20 بـ {abs(pct_above_ma20):.1f}%")
            strength = 30
        
        # Golden Cross / Death Cross detection
        if len(prices) >= 50:
            sma_20_prev = sum(prices[-21:-1]) / 20
            sma_50_prev = sum(prices[-51:-1]) / 50 if len(prices) >= 51 else sma_20_prev
            
            if sma_20 > sma_50 and sma_20_prev <= sma_50_prev:
                bullish.append("Golden Cross (إشارة صعودية)")
                score += 12
            elif sma_20 < sma_50 and sma_20_prev >= sma_50_prev:
                bearish.append("Death Cross (إشارة هبوطية)")
                score -= 12
        
        return max(0, min(100, score)), direction, strength
    
    def _analyze_volume_patterns(
        self,
        prices: List[float],
        volumes: List[float],
        bullish: List[str],
        bearish: List[str]
    ) -> float:
        """Analyze volume patterns."""
        score = 50
        
        if len(volumes) < 10:
            return score
        
        avg_volume = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else sum(volumes) / len(volumes)
        recent_volume = sum(volumes[-5:]) / 5
        
        volume_ratio = recent_volume / avg_volume if avg_volume > 0 else 1
        
        # Price change in same period
        price_change = (prices[-1] - prices[-5]) / prices[-5] * 100 if len(prices) >= 5 and prices[-5] > 0 else 0
        
        # High volume with up move = bullish
        if volume_ratio > 1.5 and price_change > 0:
            bullish.append(f"حجم مرتفع مع صعود ({volume_ratio:.1f}x المتوسط)")
            score += 12
        elif volume_ratio > 1.5 and price_change < 0:
            bearish.append(f"حجم مرتفع مع هبوط (ضغط بيعي)")
            score -= 10
        
        # Low volume with up move = weak
        if volume_ratio < 0.7 and price_change > 3:
            bearish.append("صعود بحجم منخفض (صعود ضعيف)")
            score -= 5
        
        # Volume trend
        if len(volumes) >= 20:
            early_vol = sum(volumes[-20:-10]) / 10
            late_vol = sum(volumes[-10:]) / 10
            
            if late_vol > early_vol * 1.3:
                if price_change > 0:
                    bullish.append("زيادة الحجم مع الاتجاه الصعودي")
                    score += 8
            elif late_vol < early_vol * 0.7:
                bearish.append("انخفاض الحجم (قلة الاهتمام)")
                score -= 5
        
        # OBV-like analysis
        if len(prices) >= 10 and len(volumes) >= 10:
            obv = 0
            for i in range(1, min(10, len(prices))):
                if prices[-i] > prices[-i-1]:
                    obv += volumes[-i]
                elif prices[-i] < prices[-i-1]:
                    obv -= volumes[-i]
            
            if obv > sum(volumes[-10:]) * 0.3:
                bullish.append("OBV إيجابي (تدفق أموال)")
                score += 8
            elif obv < -sum(volumes[-10:]) * 0.3:
                bearish.append("OBV سلبي (خروج أموال)")
                score -= 8
        
        return max(0, min(100, score))
    
    def _calculate_confidence(self, prices: List[float], volumes: List[float]) -> float:
        """Calculate confidence in pattern analysis."""
        confidence = 30  # Base confidence
        
        # More data = higher confidence
        if prices and len(prices) >= 100:
            confidence += 25
        elif prices and len(prices) >= 50:
            confidence += 20
        elif prices and len(prices) >= 30:
            confidence += 15
        elif prices and len(prices) >= 15:
            confidence += 10
        
        # Volume data available
        if volumes and len(volumes) >= 20:
            confidence += 15
        elif volumes and len(volumes) >= 10:
            confidence += 10
        
        return min(confidence, 85)
    
    def _get_price_data(self, ticker: str) -> Tuple[List[float], List[float], List[float], List[float], List[float]]:
        """Get price data from database."""
        if not self.db_path:
            return [], [], [], [], []
        
        try:
            from config import PRICE_HISTORY_DB_PATH
        except ImportError:
            from pathlib import Path
            PRICE_HISTORY_DB_PATH = str(Path(self.db_path).parent / 'price_history.db')
        
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(PRICE_HISTORY_DB_PATH, writable=False)
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT close_price, volume, high_price, low_price, open_price
                FROM price_history
                WHERE ticker = ?
                ORDER BY date DESC
                LIMIT 100
            ''', (ticker,))
            
            rows = cursor.fetchall()
            conn.close()
            
            if rows:
                rows = list(reversed(rows))
                closes = [r[0] for r in rows if r[0] is not None]
                volumes = [r[1] for r in rows if r[1] is not None]
                highs = [r[2] for r in rows if r[2] is not None]
                lows = [r[3] for r in rows if r[3] is not None]
                opens = [r[4] for r in rows if r[4] is not None]
                
                return closes, volumes, highs, lows, opens
        
        except Exception as e:
            print(f"[AIPatternAnalyzer] Error getting price data: {e}")
        
        return [], [], [], [], []


def get_pattern_adjustment(ticker: str, prices: List[float], volumes: List[float] = None) -> Tuple[float, List[str], List[str]]:
    """
    Convenience function for quick pattern analysis.
    
    Returns:
        Tuple: (score_adjustment, bullish_patterns, bearish_patterns)
    """
    analyzer = AIPatternAnalyzer()
    result = analyzer.analyze(ticker, prices, volumes)
    return result.score_adjustment, result.bullish_patterns, result.bearish_patterns
