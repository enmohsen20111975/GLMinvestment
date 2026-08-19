"""
Technical Analyzer - Weighted Version
=====================================
التحليل الفني بالأوزان المرجحة

القاعدة الذهبية: لا تجمع النقاط ببساطة - اضرب كل مؤشر في وزنه

Features:
- Weighted Scoring System
- EGX-specific weights
- Volume Profile Analysis
- Trend Alignment Score

Author: دليل الاستثمار (Based on Kemi's Analysis)
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime
import math


# ============================================================================
# WEIGHTS CONFIGURATION - EGX SPECIFIC
# ============================================================================

TECHNICAL_WEIGHTS = {
    # المؤشرات الرئيسية (70% من الـ Technical Score)
    'volume_profile': 0.25,      # السيولة هي الملك
    'trend_alignment': 0.20,     # SMA20/50/200
    'rsi': 0.15,                 # RSI
    
    # المؤشرات الثانوية (20%)
    'macd': 0.10,
    'bollinger': 0.10,
    
    # المؤشرات التكميلية (10%)
    'stochastic': 0.05,
    'williams_r': 0.05,
    'adx': 0.10,                 # قوة الاتجاه مهمة
}

# للتأكد أن المجموع = 1.0
assert abs(sum(TECHNICAL_WEIGHTS.values()) - 1.0) < 0.01, "Weights must sum to 1.0"


@dataclass
class TechnicalIndicators:
    """Data class for all technical indicators with weights."""
    # Moving Averages
    sma_20: Optional[float] = None
    sma_50: Optional[float] = None
    sma_200: Optional[float] = None
    ema_12: Optional[float] = None
    ema_26: Optional[float] = None
    
    # Oscillators
    rsi: Optional[float] = None
    rsi_signal: Optional[str] = None
    stochastic_k: Optional[float] = None
    williams_r: Optional[float] = None
    
    # MACD
    macd: Optional[float] = None
    macd_signal_line: Optional[float] = None
    macd_histogram: Optional[float] = None
    macd_trend: Optional[str] = None
    
    # Bollinger Bands
    bb_upper: Optional[float] = None
    bb_middle: Optional[float] = None
    bb_lower: Optional[float] = None
    bb_position: Optional[str] = None
    
    # Trend
    adx: Optional[float] = None
    trend_direction: Optional[str] = None
    
    # Volume
    volume_sma: Optional[float] = None
    volume_ratio: Optional[float] = None
    
    # Support/Resistance
    support_level: Optional[float] = None
    resistance_level: Optional[float] = None
    
    # Weighted Scores
    weighted_score: float = 50.0
    raw_score: float = 0.0
    overall_signal: str = "HOLD"
    data_points: int = 0
    
    def to_dict(self) -> Dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


class TechnicalAnalyzerWeighted:
    """
    محلل فني بالأوزان المرجحة
    
    Usage:
        analyzer = TechnicalAnalyzerWeighted()
        indicators = analyzer.analyze(prices, volumes)
        print(f"Weighted Score: {indicators.weighted_score}")
        print(f"Signal: {indicators.overall_signal}")
    """
    
    # Score thresholds (0-100 scale) - Updated to match master_analyzer
    THRESHOLDS = {
        'STRONG_BUY': 65,
        'BUY': 55,
        'ACCUMULATE': 48,
        'HOLD': 35,
        'REDUCE': 28,
        'SELL': 20,
        'STRONG_SELL': 10,
    }
    
    def __init__(self, weights: Dict[str, float] = None):
        self.weights = weights or TECHNICAL_WEIGHTS
    
    # =========================================================================
    # MOVING AVERAGES
    # =========================================================================
    
    def sma(self, prices: List[float], period: int) -> Optional[float]:
        """Simple Moving Average."""
        if len(prices) < period:
            return None
        return round(sum(prices[-period:]) / period, 4)
    
    def ema(self, prices: List[float], period: int) -> Optional[float]:
        """Exponential Moving Average."""
        if len(prices) < period:
            return None
        
        multiplier = 2 / (period + 1)
        ema_value = sum(prices[:period]) / period
        
        for price in prices[period:]:
            ema_value = (price - ema_value) * multiplier + ema_value
        
        return round(ema_value, 4)
    
    # =========================================================================
    # OSCILLATORS
    # =========================================================================
    
    def rsi(self, prices: List[float], period: int = 14) -> Optional[float]:
        """Relative Strength Index."""
        if len(prices) < period + 1:
            return None
        
        deltas = [prices[i] - prices[i-1] for i in range(1, len(prices))]
        gains = [d if d > 0 else 0 for d in deltas]
        losses = [-d if d < 0 else 0 for d in deltas]
        
        avg_gain = sum(gains[-period:]) / period
        avg_loss = sum(losses[-period:]) / period
        
        if avg_loss == 0:
            return 100.0
        
        rs = avg_gain / avg_loss
        return round(100 - (100 / (1 + rs)), 2)
    
    # =========================================================================
    # MACD
    # =========================================================================
    
    def macd(self, prices: List[float]) -> Optional[Dict]:
        """MACD Indicator."""
        if len(prices) < 26:
            return None
        
        ema_12 = self.ema(prices, 12)
        ema_26 = self.ema(prices, 26)
        
        if ema_12 is None or ema_26 is None:
            return None
        
        macd_line = ema_12 - ema_26
        signal_line = macd_line * 0.9  # Simplified
        histogram = macd_line - signal_line
        
        if histogram > 0:
            trend = "BULLISH"
        elif histogram < 0:
            trend = "BEARISH"
        else:
            trend = "NEUTRAL"
        
        return {
            'macd': round(macd_line, 4),
            'signal': round(signal_line, 4),
            'histogram': round(histogram, 4),
            'trend': trend
        }
    
    # =========================================================================
    # BOLLINGER BANDS
    # =========================================================================
    
    def bollinger_bands(self, prices: List[float], period: int = 20) -> Optional[Dict]:
        """Bollinger Bands."""
        if len(prices) < period:
            return None
        
        recent = prices[-period:]
        sma_value = sum(recent) / period
        variance = sum((p - sma_value) ** 2 for p in recent) / period
        std_dev = variance ** 0.5
        
        upper = sma_value + (2 * std_dev)
        lower = sma_value - (2 * std_dev)
        
        current_price = prices[-1]
        if current_price >= upper:
            position = "UPPER"
        elif current_price <= lower:
            position = "LOWER"
        else:
            position = "MIDDLE"
        
        return {
            'upper': round(upper, 4),
            'middle': round(sma_value, 4),
            'lower': round(lower, 4),
            'position': position
        }
    
    # =========================================================================
    # WEIGHTED SCORING
    # =========================================================================
    
    def _calculate_weighted_score(
        self,
        prices: List[float],
        volumes: List[float] = None
    ) -> Tuple[float, Dict[str, float]]:
        """
        حساب النقاط المرجحة
        
        Returns:
            Tuple[float, Dict]: (weighted_score, individual_scores)
        """
        scores = {}
        current_price = prices[-1] if prices else 0
        
        # 1. Volume Profile (25%)
        if volumes and len(volumes) >= 20:
            avg_volume = sum(volumes[-20:]) / 20
            current_volume = volumes[-1]
            volume_ratio = current_volume / avg_volume if avg_volume > 0 else 0
            
            if volume_ratio > 2.0:
                scores['volume_profile'] = 85  # Very high volume
            elif volume_ratio > 1.5:
                scores['volume_profile'] = 70
            elif volume_ratio > 1.0:
                scores['volume_profile'] = 55
            else:
                scores['volume_profile'] = 40  # Low volume
        else:
            scores['volume_profile'] = 50  # Neutral
        
        # 2. Trend Alignment (20%)
        sma_20 = self.sma(prices, 20)
        sma_50 = self.sma(prices, 50)
        sma_200 = self.sma(prices, 200) if len(prices) >= 200 else None
        
        if sma_20 and sma_50:
            if current_price > sma_20 > sma_50:
                scores['trend_alignment'] = 80  # Strong uptrend
            elif current_price > sma_20 or current_price > sma_50:
                scores['trend_alignment'] = 60  # Moderate
            elif current_price < sma_20 < sma_50:
                scores['trend_alignment'] = 20  # Strong downtrend
            else:
                scores['trend_alignment'] = 40  # Sideways
        else:
            scores['trend_alignment'] = 50
        
        # 3. RSI (15%)
        rsi_value = self.rsi(prices)
        if rsi_value:
            if rsi_value <= 30:
                scores['rsi'] = 85  # Oversold - buy signal
            elif rsi_value <= 40:
                scores['rsi'] = 70
            elif rsi_value >= 70:
                scores['rsi'] = 15  # Overbought - sell signal
            elif rsi_value >= 60:
                scores['rsi'] = 30
            else:
                scores['rsi'] = 50  # Neutral
        else:
            scores['rsi'] = 50
        
        # 4. MACD (10%)
        macd_data = self.macd(prices)
        if macd_data:
            if macd_data['trend'] == "BULLISH":
                scores['macd'] = 70
            elif macd_data['trend'] == "BEARISH":
                scores['macd'] = 30
            else:
                scores['macd'] = 50
        else:
            scores['macd'] = 50
        
        # 5. Bollinger Bands (10%)
        bb = self.bollinger_bands(prices)
        if bb:
            if bb['position'] == "LOWER":
                scores['bollinger'] = 75  # Near lower - potential buy
            elif bb['position'] == "UPPER":
                scores['bollinger'] = 25  # Near upper - potential sell
            else:
                scores['bollinger'] = 50
        else:
            scores['bollinger'] = 50
        
        # 6. Stochastic (5%)
        # Calculate Stochastic if we have enough data
        if len(prices) >= 14:
            lowest_low = min(prices[-14:])
            highest_high = max(prices[-14:])
            if highest_high > lowest_low:
                stoch_k = (current_price - lowest_low) / (highest_high - lowest_low) * 100
                if stoch_k <= 20:
                    scores['stochastic'] = 80  # Oversold
                elif stoch_k <= 30:
                    scores['stochastic'] = 65
                elif stoch_k >= 80:
                    scores['stochastic'] = 20  # Overbought
                elif stoch_k >= 70:
                    scores['stochastic'] = 35
                else:
                    scores['stochastic'] = 50
            else:
                scores['stochastic'] = 50
        else:
            scores['stochastic'] = 50
        
        # 7. Williams %R (5%)
        if len(prices) >= 14:
            highest_high = max(prices[-14:])
            lowest_low = min(prices[-14:])
            if highest_high > lowest_low:
                will_r = (highest_high - current_price) / (highest_high - lowest_low) * -100
                if will_r <= -80:
                    scores['williams_r'] = 80  # Oversold
                elif will_r <= -70:
                    scores['williams_r'] = 65
                elif will_r >= -20:
                    scores['williams_r'] = 20  # Overbought
                elif will_r >= -30:
                    scores['williams_r'] = 35
                else:
                    scores['williams_r'] = 50
            else:
                scores['williams_r'] = 50
        else:
            scores['williams_r'] = 50
        
        # 8. ADX (10%) - Trend strength
        if len(prices) >= 20:
            # Simplified ADX calculation
            up_moves = [prices[i] - prices[i-1] for i in range(-19, 0)]
            down_moves = [prices[i-1] - prices[i] for i in range(-19, 0)]
            
            plus_dm = sum(1 for m in up_moves if m > 0) / 20
            minus_dm = sum(1 for m in down_moves if m > 0) / 20
            
            adx_value = abs(plus_dm - minus_dm) * 100
            
            if adx_value > 40:
                scores['adx'] = 75  # Strong trend
            elif adx_value > 25:
                scores['adx'] = 60
            elif adx_value > 15:
                scores['adx'] = 45
            else:
                scores['adx'] = 30  # Weak trend
        else:
            scores['adx'] = 50
        
        # Calculate weighted average
        total_weight = 0
        weighted_sum = 0
        
        for indicator, score in scores.items():
            weight = self.weights.get(indicator, 0.05)
            weighted_sum += score * weight
            total_weight += weight
        
        weighted_score = weighted_sum / total_weight if total_weight > 0 else 50
        
        return round(weighted_score, 2), scores
    
    def _get_signal_from_score(self, score: float) -> str:
        """تحويل النقاط إلى إشارة"""
        if score >= self.THRESHOLDS['STRONG_BUY']:
            return "STRONG_BUY"
        elif score >= self.THRESHOLDS['BUY']:
            return "BUY"
        elif score >= self.THRESHOLDS['ACCUMULATE']:
            return "ACCUMULATE"
        elif score >= self.THRESHOLDS['HOLD']:
            return "HOLD"
        elif score >= self.THRESHOLDS['REDUCE']:
            return "REDUCE"
        elif score >= self.THRESHOLDS['SELL']:
            return "SELL"
        else:
            return "STRONG_SELL"
    
    # =========================================================================
    # MAIN ANALYSIS
    # =========================================================================
    
    def analyze(self, prices: List[float], volumes: List[float] = None) -> TechnicalIndicators:
        """
        Perform complete technical analysis with weighted scoring.
        
        Args:
            prices: List of close prices (oldest first)
            volumes: Optional list of volumes
            
        Returns:
            TechnicalIndicators with weighted score
        """
        indicators = TechnicalIndicators()
        indicators.data_points = len(prices)
        
        if len(prices) < 20:
            indicators.weighted_score = 50
            indicators.overall_signal = "INSUFFICIENT_DATA"
            return indicators
        
        current_price = prices[-1]
        
        # Calculate indicators
        indicators.sma_20 = self.sma(prices, 20)
        indicators.sma_50 = self.sma(prices, 50) if len(prices) >= 50 else None
        indicators.sma_200 = self.sma(prices, 200) if len(prices) >= 200 else None
        indicators.ema_12 = self.ema(prices, 12)
        indicators.ema_26 = self.ema(prices, 26)
        
        indicators.rsi = self.rsi(prices)
        if indicators.rsi:
            if indicators.rsi <= 30:
                indicators.rsi_signal = "OVERSOLD"
            elif indicators.rsi >= 70:
                indicators.rsi_signal = "OVERBOUGHT"
            else:
                indicators.rsi_signal = "NEUTRAL"
        
        macd_data = self.macd(prices)
        if macd_data:
            indicators.macd = macd_data['macd']
            indicators.macd_signal_line = macd_data['signal']
            indicators.macd_histogram = macd_data['histogram']
            indicators.macd_trend = macd_data['trend']
        
        bb = self.bollinger_bands(prices)
        if bb:
            indicators.bb_upper = bb['upper']
            indicators.bb_middle = bb['middle']
            indicators.bb_lower = bb['lower']
            indicators.bb_position = bb['position']
        
        # Volume analysis
        if volumes and len(volumes) >= 20:
            indicators.volume_sma = sum(volumes[-20:]) / 20
            indicators.volume_ratio = volumes[-1] / indicators.volume_sma if indicators.volume_sma > 0 else 0
        
        # Support/Resistance
        if len(prices) >= 20:
            indicators.support_level = min(prices[-20:])
            indicators.resistance_level = max(prices[-20:])
        
        # Trend direction
        if indicators.sma_20 and indicators.sma_50:
            if current_price > indicators.sma_20 > indicators.sma_50:
                indicators.trend_direction = "UPTREND"
            elif current_price < indicators.sma_20 < indicators.sma_50:
                indicators.trend_direction = "DOWNTREND"
            else:
                indicators.trend_direction = "SIDEWAYS"
        
        # Calculate weighted score
        indicators.weighted_score, _ = self._calculate_weighted_score(prices, volumes)
        indicators.overall_signal = self._get_signal_from_score(indicators.weighted_score)
        
        return indicators
    
    def generate_prediction(self, prices: List[float], symbol: str) -> Dict:
        """Generate trading prediction."""
        if len(prices) < 50:
            return {
                "symbol": symbol,
                "signal": "INSUFFICIENT_DATA",
                "confidence": 0,
                "weighted_score": 50,
                "reason": f"Need at least 50 data points, got {len(prices)}"
            }
        
        indicators = self.analyze(prices)
        
        return {
            "symbol": symbol,
            "signal": indicators.overall_signal,
            "confidence": min(50 + abs(indicators.weighted_score - 50), 95),
            "weighted_score": indicators.weighted_score,
            "current_price": round(prices[-1], 4),
            "indicators": {
                "rsi": indicators.rsi,
                "rsi_signal": indicators.rsi_signal,
                "macd_trend": indicators.macd_trend,
                "trend_direction": indicators.trend_direction,
                "sma_20": indicators.sma_20,
                "sma_50": indicators.sma_50,
            },
            "timestamp": datetime.now().isoformat()
        }
