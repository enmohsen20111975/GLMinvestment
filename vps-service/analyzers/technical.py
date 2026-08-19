"""
Technical Analyzer
==================
Technical Analysis Engine for Stocks and Crypto.

Features:
- Moving Averages (SMA, EMA)
- Oscillators (RSI, Stochastic, CCI, Williams %R)
- MACD
- Bollinger Bands
- Support & Resistance
- ADX (Trend Strength)
- Volume Analysis

Author: دليل الاستثمار
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime
import math


@dataclass
class TechnicalIndicators:
    """Data class for all technical indicators."""
    # Moving Averages
    sma_5: Optional[float] = None
    sma_10: Optional[float] = None
    sma_20: Optional[float] = None
    sma_50: Optional[float] = None
    sma_100: Optional[float] = None
    sma_200: Optional[float] = None
    ema_12: Optional[float] = None
    ema_26: Optional[float] = None
    
    # Oscillators
    rsi: Optional[float] = None
    rsi_signal: Optional[str] = None
    stochastic_k: Optional[float] = None
    stochastic_d: Optional[float] = None
    williams_r: Optional[float] = None
    cci: Optional[float] = None
    
    # MACD
    macd: Optional[float] = None
    macd_signal_line: Optional[float] = None
    macd_histogram: Optional[float] = None
    macd_trend: Optional[str] = None
    
    # Bollinger Bands
    bb_upper: Optional[float] = None
    bb_middle: Optional[float] = None
    bb_lower: Optional[float] = None
    bb_width: Optional[float] = None
    bb_position: Optional[str] = None
    
    # Support/Resistance
    support_level: Optional[float] = None
    resistance_level: Optional[float] = None
    pivot_point: Optional[float] = None
    
    # Trend
    adx: Optional[float] = None
    trend_strength: Optional[str] = None
    trend_direction: Optional[str] = None
    
    # Volume
    volume_sma: Optional[float] = None
    volume_ratio: Optional[float] = None
    
    # Overall
    overall_signal: str = "HOLD"
    signal_score: int = 0
    data_points: int = 0
    
    def to_dict(self) -> Dict:
        """Convert to dictionary, excluding None values."""
        return {k: v for k, v in asdict(self).items() if v is not None}


class TechnicalAnalyzer:
    """
    Technical Analysis Engine.
    
    Usage:
        analyzer = TechnicalAnalyzer()
        indicators = analyzer.analyze(prices, volumes)
        signal = analyzer.get_signal(indicators)
    """
    
    def __init__(self):
        self.rsi_oversold = 30
        self.rsi_overbought = 70
    
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
    
    def calculate_all_mas(self, prices: List[float]) -> Dict[str, Optional[float]]:
        """Calculate all moving averages."""
        return {
            'sma_5': self.sma(prices, 5),
            'sma_10': self.sma(prices, 10),
            'sma_20': self.sma(prices, 20),
            'sma_50': self.sma(prices, 50) if len(prices) >= 50 else None,
            'sma_100': self.sma(prices, 100) if len(prices) >= 100 else None,
            'sma_200': self.sma(prices, 200) if len(prices) >= 200 else None,
            'ema_12': self.ema(prices, 12),
            'ema_26': self.ema(prices, 26),
        }
    
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
        rsi_value = 100 - (100 / (1 + rs))
        
        return round(rsi_value, 2)
    
    def rsi_signal(self, rsi_value: float) -> str:
        """Get RSI signal."""
        if rsi_value <= self.rsi_oversold:
            return "OVERSOLD"
        elif rsi_value >= self.rsi_overbought:
            return "OVERBOUGHT"
        return "NEUTRAL"
    
    def stochastic(self, prices: List[float], period: int = 14) -> Optional[Tuple[float, float]]:
        """Stochastic Oscillator (%K, %D)."""
        if len(prices) < period:
            return None
        
        recent = prices[-period:]
        highest = max(recent)
        lowest = min(recent)
        
        if highest == lowest:
            return None
        
        k = ((prices[-1] - lowest) / (highest - lowest)) * 100
        d = k * 0.9  # Simplified %D
        
        return round(k, 2), round(d, 2)
    
    def williams_r(self, prices: List[float], period: int = 14) -> Optional[float]:
        """Williams %R."""
        if len(prices) < period:
            return None
        
        recent = prices[-period:]
        highest = max(recent)
        lowest = min(recent)
        
        if highest == lowest:
            return None
        
        wr = ((highest - prices[-1]) / (highest - lowest)) * -100
        return round(wr, 2)
    
    def cci(self, prices: List[float], period: int = 20) -> Optional[float]:
        """Commodity Channel Index."""
        if len(prices) < period:
            return None
        
        recent = prices[-period:]
        sma_value = sum(recent) / period
        mean_dev = sum(abs(p - sma_value) for p in recent) / period
        
        if mean_dev == 0:
            return None
        
        cci_value = (prices[-1] - sma_value) / (0.015 * mean_dev)
        return round(cci_value, 2)
    
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
        signal_line = macd_line * 0.9  # Simplified signal
        histogram = macd_line - signal_line
        
        if histogram > 0 and macd_line > signal_line:
            trend = "BULLISH"
        elif histogram < 0 and macd_line < signal_line:
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
            'width': round((upper - lower) / sma_value * 100, 2) if sma_value else 0,
            'position': position
        }
    
    # =========================================================================
    # SUPPORT & RESISTANCE
    # =========================================================================
    
    def support_resistance(self, prices: List[float], window: int = 20) -> Optional[Dict]:
        """Calculate support and resistance levels."""
        if len(prices) < window:
            return None
        
        recent = prices[-window:]
        support = min(recent)
        resistance = max(recent)
        pivot = (support + resistance + prices[-1]) / 3
        
        return {
            'support': round(support, 4),
            'resistance': round(resistance, 4),
            'pivot': round(pivot, 4)
        }
    
    # =========================================================================
    # ADX (Trend Strength)
    # =========================================================================
    
    def adx(self, prices: List[float], period: int = 14) -> Optional[float]:
        """Average Directional Index (Simplified)."""
        if len(prices) < period * 2:
            return None
        
        # Simplified ADX calculation
        recent = prices[-period:]
        prev = prices[-period*2:-period]
        
        if not prev:
            return None
        
        current_range = max(recent) - min(recent)
        prev_range = max(prev) - min(prev)
        
        if prev_range == 0:
            return None
        
        strength = abs(current_range - prev_range) / prev_range * 100
        return min(round(strength, 2), 100)
    
    # =========================================================================
    # VOLUME ANALYSIS
    # =========================================================================
    
    def volume_analysis(self, volumes: List[float], period: int = 20) -> Optional[Dict]:
        """Analyze volume."""
        if len(volumes) < period:
            return None
        
        from numbers import Number
        numeric_volumes = [float(v) if isinstance(v, Number) or (isinstance(v, str) and v.replace('.', '', 1).replace('-', '', 1).isdigit()) else 0.0 for v in volumes]
        volume_sma = sum(numeric_volumes[-period:]) / period
        current_volume = numeric_volumes[-1]
        
        ratio = current_volume / volume_sma if volume_sma > 0 else 0
        
        return {
            'volume_sma': round(volume_sma, 0),
            'volume_ratio': round(ratio, 2),
            'signal': 'HIGH' if ratio > 1.5 else 'LOW' if ratio < 0.5 else 'NORMAL'
        }
    
    # =========================================================================
    # MAIN ANALYSIS
    # =========================================================================
    
    def analyze(self, prices: List[float], volumes: List[float] = None) -> TechnicalIndicators:
        """
        Perform complete technical analysis.
        
        Args:
            prices: List of close prices (oldest first)
            volumes: Optional list of volumes
            
        Returns:
            TechnicalIndicators dataclass with all indicators
        """
        indicators = TechnicalIndicators()
        indicators.data_points = len(prices)
        
        if len(prices) < 20:
            return indicators
        
        # Moving Averages
        mas = self.calculate_all_mas(prices)
        indicators.sma_5 = mas['sma_5']
        indicators.sma_10 = mas['sma_10']
        indicators.sma_20 = mas['sma_20']
        indicators.sma_50 = mas['sma_50']
        indicators.sma_100 = mas['sma_100']
        indicators.sma_200 = mas['sma_200']
        indicators.ema_12 = mas['ema_12']
        indicators.ema_26 = mas['ema_26']
        
        # RSI
        indicators.rsi = self.rsi(prices)
        if indicators.rsi:
            indicators.rsi_signal = self.rsi_signal(indicators.rsi)
        
        # MACD
        macd_data = self.macd(prices)
        if macd_data:
            indicators.macd = macd_data['macd']
            indicators.macd_signal_line = macd_data['signal']
            indicators.macd_histogram = macd_data['histogram']
            indicators.macd_trend = macd_data['trend']
        
        # Bollinger Bands
        bb = self.bollinger_bands(prices)
        if bb:
            indicators.bb_upper = bb['upper']
            indicators.bb_middle = bb['middle']
            indicators.bb_lower = bb['lower']
            indicators.bb_width = bb['width']
            indicators.bb_position = bb['position']
        
        # Support/Resistance
        sr = self.support_resistance(prices)
        if sr:
            indicators.support_level = sr['support']
            indicators.resistance_level = sr['resistance']
            indicators.pivot_point = sr['pivot']
        
        # ADX
        indicators.adx = self.adx(prices)
        if indicators.adx:
            indicators.trend_strength = "STRONG" if indicators.adx > 25 else "WEAK"
        
        # Stochastic
        stoch = self.stochastic(prices)
        if stoch:
            indicators.stochastic_k, indicators.stochastic_d = stoch
        
        # Volume
        if volumes and len(volumes) > 20:
            vol_data = self.volume_analysis(volumes)
            if vol_data:
                indicators.volume_sma = vol_data['volume_sma']
                indicators.volume_ratio = vol_data['volume_ratio']
        
        # Calculate overall signal and score
        score = self._calculate_score(indicators, prices[-1] if prices else 0)
        indicators.signal_score = score
        indicators.overall_signal = self._get_signal_from_score(score)
        
        # Determine trend direction
        if indicators.sma_20 and indicators.sma_50:
            current_price = prices[-1]
            if current_price > indicators.sma_20 > indicators.sma_50:
                indicators.trend_direction = "UPTREND"
            elif current_price < indicators.sma_20 < indicators.sma_50:
                indicators.trend_direction = "DOWNTREND"
            else:
                indicators.trend_direction = "SIDEWAYS"
        
        return indicators
    
    def _calculate_score(self, indicators: TechnicalIndicators, current_price: float) -> int:
        """Calculate technical score from -10 to +10."""
        score = 0
        
        # RSI (+/- 2)
        if indicators.rsi:
            if indicators.rsi <= 30:
                score += 2  # Oversold - buy signal
            elif indicators.rsi <= 40:
                score += 1
            elif indicators.rsi >= 70:
                score -= 2  # Overbought - sell signal
            elif indicators.rsi >= 60:
                score -= 1
        
        # MACD (+/- 1)
        if indicators.macd_trend == "BULLISH":
            score += 1
        elif indicators.macd_trend == "BEARISH":
            score -= 1
        
        # Moving Averages (+/- 2)
        if indicators.sma_20 and indicators.sma_50:
            if current_price > indicators.sma_20 > indicators.sma_50:
                score += 2  # Bullish alignment
            elif current_price < indicators.sma_20 < indicators.sma_50:
                score -= 2  # Bearish alignment
        
        # Bollinger Bands (+/- 1)
        if indicators.bb_position == "LOWER":
            score += 1  # Near lower band - potential buy
        elif indicators.bb_position == "UPPER":
            score -= 1  # Near upper band - potential sell
        
        # Support/Resistance
        if indicators.support_level and indicators.resistance_level:
            dist_to_support = (current_price - indicators.support_level) / current_price * 100
            dist_to_resistance = (indicators.resistance_level - current_price) / current_price * 100
            
            if dist_to_support < 2:
                score += 1  # Near support
            elif dist_to_resistance < 2:
                score -= 1  # Near resistance
        
        # Volume
        if indicators.volume_ratio:
            if indicators.volume_ratio > 1.5:
                score += 1  # High volume confirms trend
            elif indicators.volume_ratio < 0.5:
                score -= 1  # Low volume - weak interest
        
        return score
    
    def _get_signal_from_score(self, score: int) -> str:
        """Convert score to signal."""
        if score >= 5:
            return "STRONG_BUY"
        elif score >= 2:
            return "BUY"
        elif score <= -5:
            return "STRONG_SELL"
        elif score <= -2:
            return "SELL"
        return "HOLD"
    
    # =========================================================================
    # PREDICTION
    # =========================================================================
    
    def generate_prediction(self, prices: List[float], symbol: str) -> Dict:
        """
        Generate trading prediction based on technical analysis.
        
        Args:
            prices: List of close prices
            symbol: Stock symbol
            
        Returns:
            Dict with prediction details
        """
        if len(prices) < 50:
            return {
                "symbol": symbol,
                "signal": "INSUFFICIENT_DATA",
                "confidence": 0,
                "reason": f"Need at least 50 data points, got {len(prices)}"
            }
        
        indicators = self.analyze(prices)
        
        signals = []
        current_price = prices[-1]
        
        # RSI Signal
        if indicators.rsi:
            if indicators.rsi <= 30:
                signals.append({"indicator": "RSI", "signal": "BUY", "value": indicators.rsi, "reason": "Oversold"})
            elif indicators.rsi >= 70:
                signals.append({"indicator": "RSI", "signal": "SELL", "value": indicators.rsi, "reason": "Overbought"})
        
        # MACD Signal
        if indicators.macd_trend:
            signals.append({"indicator": "MACD", "signal": "BUY" if indicators.macd_trend == "BULLISH" else "SELL", "trend": indicators.macd_trend})
        
        # MA Signal
        if indicators.sma_20 and indicators.sma_50:
            if current_price > indicators.sma_20 > indicators.sma_50:
                signals.append({"indicator": "MA_Cross", "signal": "BUY", "reason": "Bullish alignment"})
            elif current_price < indicators.sma_20 < indicators.sma_50:
                signals.append({"indicator": "MA_Cross", "signal": "SELL", "reason": "Bearish alignment"})
        
        # Price targets
        recent_high = max(prices[-20:])
        recent_low = min(prices[-20:])
        
        return {
            "symbol": symbol,
            "signal": indicators.overall_signal,
            "confidence": min(50 + abs(indicators.signal_score) * 5, 95),
            "score": indicators.signal_score,
            "signals": signals,
            "current_price": round(current_price, 4),
            "targets": {
                "support": round(indicators.support_level or recent_low, 4),
                "resistance": round(indicators.resistance_level or recent_high, 4),
                "stop_loss": round((indicators.support_level or recent_low) * 0.98, 4),
                "take_profit": round((indicators.resistance_level or recent_high) * 1.02, 4)
            },
            "indicators": indicators.to_dict(),
            "timestamp": datetime.now().isoformat()
        }
