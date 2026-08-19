#!/usr/bin/env python3
"""
Crypto Confluence Engine V2
===========================
محرك التقاء العملات الرقمية - الإصدار الثاني

الأوزان محسّنة بناءً على نتائج الاختبار:
- VWAP: 63.6% → volume: 0.35 (الأقوى)
- Stochastic: 55.2% → momentum: 0.25
- EMA Cross: 53% → trend: 0.20
- Bollinger: 48% → volatility: 0.10 (ضعيف)
- Fear & Greed: لم يُختبر → sentiment: 0.10

Author:M2yDevelopers Team
Version: 2.0.0 - Optimized Weights
"""

import os
import json
import requests
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict
from pathlib import Path

# Import safe HTTP client with retry logic
try:
    from core.http_client import safe_get
    HTTP_CLIENT_AVAILABLE = True
except ImportError:
    HTTP_CLIENT_AVAILABLE = False
    safe_get = requests.get

# ============================================================================
# CONFIGURATION - OPTIMIZED WEIGHTS
# ============================================================================

# Based on validation results (May 2025)
# Updated with Fear & Greed validation (57.8% accuracy)
CRYPTO_WEIGHTS_V2 = {
    'volume': 0.35,      # VWAP 63.6% - الأقوى
    'momentum': 0.25,    # Stochastic 55.2%
    'trend': 0.20,       # EMA Cross 53%
    'volatility': 0.10,  # Bollinger 48% - ضعيف
    'sentiment': 0.10,   # Fear & Greed 57.8% - متوسط
}

# Signal thresholds
BUY_THRESHOLD = 0.20
SELL_THRESHOLD = -0.20

# Indicator thresholds
RSI_OVERSOLD = 30
RSI_OVERBOUGHT = 70
STOCH_OVERSOLD = 20
STOCH_OVERBOUGHT = 80

# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class IndicatorSignal:
    """إشارة مؤشر فردية"""
    name: str
    value: float
    signal: float  # +1 bullish, -1 bearish, 0 neutral
    weight: float
    confidence: float
    details: Dict[str, Any]

@dataclass
class CryptoConfluenceSignal:
    """إشارة التقاء شاملة"""
    symbol: str
    current_price: float
    timestamp: str
    
    # Individual signals
    signals: Dict[str, IndicatorSignal]
    
    # Weighted score
    weighted_score: float
    raw_score: float
    
    # Final signal
    signal: str  # BUY, SELL, HOLD
    confidence: float
    
    # Price levels
    entry_price: float
    target_price: float
    stop_loss: float
    support_levels: List[float]
    resistance_levels: List[float]
    
    # Risk metrics
    risk_reward_ratio: float
    max_drawdown_estimate: float
    
    # Explanations
    bullish_reasons: List[str]
    bearish_reasons: List[str]
    warnings: List[str]


# ============================================================================
# TECHNICAL INDICATORS
# ============================================================================

class TechnicalIndicators:
    """حساب المؤشرات الفنية"""
    
    @staticmethod
    def calculate_vwap(highs: List[float], lows: List[float], 
                       closes: List[float], volumes: List[float]) -> Optional[float]:
        """Volume Weighted Average Price"""
        if len(closes) < 20 or not volumes:
            return None
        
        # VWAP = Sum(Price * Volume) / Sum(Volume)
        typical_prices = [(h + l + c) / 3 for h, l, c in zip(highs, lows, closes)]
        vwap = sum(tp * v for tp, v in zip(typical_prices[-20:], volumes[-20:])) / sum(volumes[-20:])
        return round(vwap, 4)
    
    @staticmethod
    def calculate_ema(prices: List[float], period: int) -> Optional[float]:
        """Exponential Moving Average"""
        if len(prices) < period:
            return None
        
        multiplier = 2 / (period + 1)
        ema = sum(prices[:period]) / period
        
        for price in prices[period:]:
            ema = (price - ema) * multiplier + ema
        
        return round(ema, 4)
    
    @staticmethod
    def calculate_stochastic(highs: List[float], lows: List[float], 
                            closes: List[float], k_period: int = 14) -> Optional[Tuple[float, float]]:
        """Stochastic Oscillator - Returns %K and %D"""
        if len(closes) < k_period + 3:
            return None
        
        # %K = (Close - Lowest Low) / (Highest High - Lowest Low) * 100
        recent_highs = highs[-k_period:]
        recent_lows = lows[-k_period:]
        
        highest_high = max(recent_highs)
        lowest_low = min(recent_lows)
        
        if highest_high == lowest_low:
            return (50.0, 50.0)  # Avoid division by zero
        
        k_values = []
        for i in range(-k_period, 0):
            high_n = max(highs[i-k_period+k_period:i+1] if i >= -k_period+k_period else highs[i-k_period+k_period:])
            low_n = min(lows[i-k_period+k_period:i+1] if i >= -k_period+k_period else lows[i-k_period+k_period:])
            
            if high_n == low_n:
                k_values.append(50.0)
            else:
                k = ((closes[i] - low_n) / (high_n - low_n)) * 100
                k_values.append(k)
        
        k = k_values[-1]
        d = sum(k_values[-3:]) / 3  # 3-period SMA of %K
        
        return (round(k, 2), round(d, 2))
    
    @staticmethod
    def calculate_bollinger(prices: List[float], period: int = 20) -> Optional[Dict]:
        """Bollinger Bands"""
        if len(prices) < period:
            return None
        
        sma = sum(prices[-period:]) / period
        variance = sum((p - sma) ** 2 for p in prices[-period:]) / period
        std_dev = variance ** 0.5
        
        return {
            'upper': round(sma + (2 * std_dev), 4),
            'middle': round(sma, 4),
            'lower': round(sma - (2 * std_dev), 4),
            'current': prices[-1],
            'width': round((2 * std_dev) / sma * 100, 2) if sma > 0 else 0
        }
    
    @staticmethod
    def calculate_macd(prices: List[float]) -> Optional[Dict]:
        """MACD Indicator"""
        if len(prices) < 26:
            return None
        
        ema_12 = TechnicalIndicators.calculate_ema(prices, 12)
        ema_26 = TechnicalIndicators.calculate_ema(prices, 26)
        
        if ema_12 is None or ema_26 is None:
            return None
        
        macd_line = ema_12 - ema_26
        
        # Simplified signal line (9-period EMA of MACD would be better)
        # For now, use a simple approximation
        signal_line = macd_line * 0.85
        
        histogram = macd_line - signal_line
        
        return {
            'macd': round(macd_line, 4),
            'signal': round(signal_line, 4),
            'histogram': round(histogram, 4),
            'trend': 'bullish' if histogram > 0 else 'bearish'
        }


# ============================================================================
# CRYPTO CONFLUENCE ENGINE
# ============================================================================

class CryptoConfluenceEngine:
    """
    محرك التقاء العملات الرقمية
    
    يجمع إشارات من مؤشرات متعددة بأوزان محسّنة:
    - Volume (VWAP): 35%
    - Momentum (Stochastic): 25%
    - Trend (EMA Cross): 20%
    - Volatility (Bollinger): 10%
    - Sentiment (Fear & Greed): 10%
    """
    
    def __init__(self, weights: Dict = None):
        self.weights = weights or CRYPTO_WEIGHTS_V2
        self.fear_greed_cache = None
        self.fear_greed_cache_time = None
        
        print(f"[CRYPTO_CONFLUENCE] Initialized with weights:")
        for k, v in self.weights.items():
            print(f"  {k}: {v*100:.0f}%")
    
    def _get_fear_greed(self) -> Optional[Dict]:
        """Get Fear & Greed Index with caching"""
        # Cache for 1 hour
        if self.fear_greed_cache and self.fear_greed_cache_time:
            if datetime.now() - self.fear_greed_cache_time < timedelta(hours=1):
                return self.fear_greed_cache
        
        try:
            response = safe_get('https://api.alternative.me/fng/?limit=1', timeout=10, raise_for_status=False)
            if response.status_code == 200:
                data = response.json()
                if 'data' in data and len(data['data']) > 0:
                    self.fear_greed_cache = {
                        'value': int(data['data'][0]['value']),
                        'classification': data['data'][0]['value_classification']
                    }
                    self.fear_greed_cache_time = datetime.now()
                    return self.fear_greed_cache
        except Exception as e:
            print(f"[CRYPTO_CONFLUENCE] Fear & Greed error: {e}")
        
        return None
    
    def _calculate_volume_signal(self, closes: List[float], highs: List[float], 
                                 lows: List[float], volumes: List[float]) -> IndicatorSignal:
        """Calculate VWAP signal (63.6% accuracy)"""
        vwap = TechnicalIndicators.calculate_vwap(highs, lows, closes, volumes)
        current_price = closes[-1]
        
        signal = 0
        confidence = 0.5
        details = {'vwap': vwap, 'price': current_price}
        
        if vwap:
            # Price above VWAP = bullish
            price_vs_vwap = (current_price - vwap) / vwap
            
            if price_vs_vwap > 0.02:  # 2% above VWAP
                signal = 1
                confidence = 0.7
                details['status'] = 'above_vwap_bullish'
            elif price_vs_vwap < -0.02:  # 2% below VWAP
                signal = -1
                confidence = 0.7
                details['status'] = 'below_vwap_bearish'
            else:
                signal = 0
                confidence = 0.6
                details['status'] = 'near_vwap_neutral'
        
        return IndicatorSignal(
            name='VWAP',
            value=vwap or 0,
            signal=signal,
            weight=self.weights['volume'],
            confidence=confidence,
            details=details
        )
    
    def _calculate_momentum_signal(self, highs: List[float], lows: List[float], 
                                   closes: List[float]) -> IndicatorSignal:
        """Calculate Stochastic signal (55.2% accuracy)"""
        stoch = TechnicalIndicators.calculate_stochastic(highs, lows, closes)
        
        signal = 0
        confidence = 0.5
        details = {'k': None, 'd': None}
        
        if stoch:
            k, d = stoch
            details['k'] = k
            details['d'] = d
            
            # Oversold = bullish signal (buy the dip)
            if k < STOCH_OVERSOLD and d < STOCH_OVERSOLD:
                signal = 1
                confidence = 0.75
                details['status'] = 'oversold_bullish'
            # Overbought = bearish signal
            elif k > STOCH_OVERBOUGHT and d > STOCH_OVERBOUGHT:
                signal = -1
                confidence = 0.75
                details['status'] = 'overbought_bearish'
            # Bullish crossover
            elif k > d and k < 50:
                signal = 0.5
                confidence = 0.6
                details['status'] = 'bullish_crossover'
            # Bearish crossover
            elif k < d and k > 50:
                signal = -0.5
                confidence = 0.6
                details['status'] = 'bearish_crossover'
            else:
                signal = 0
                confidence = 0.5
                details['status'] = 'neutral'
        
        return IndicatorSignal(
            name='Stochastic',
            value=stoch[0] if stoch else 50,
            signal=signal,
            weight=self.weights['momentum'],
            confidence=confidence,
            details=details
        )
    
    def _calculate_trend_signal(self, closes: List[float]) -> IndicatorSignal:
        """Calculate EMA Cross signal (53% accuracy)"""
        ema_9 = TechnicalIndicators.calculate_ema(closes, 9)
        ema_21 = TechnicalIndicators.calculate_ema(closes, 21)
        
        signal = 0
        confidence = 0.5
        details = {'ema_9': ema_9, 'ema_21': ema_21}
        
        if ema_9 and ema_21:
            # EMA 9 above EMA 21 = bullish
            diff = (ema_9 - ema_21) / ema_21
            
            if ema_9 > ema_21:
                signal = 1
                confidence = min(0.5 + abs(diff) * 10, 0.8)
                details['status'] = 'bullish_trend'
            elif ema_9 < ema_21:
                signal = -1
                confidence = min(0.5 + abs(diff) * 10, 0.8)
                details['status'] = 'bearish_trend'
            else:
                signal = 0
                confidence = 0.5
                details['status'] = 'neutral'
            
            details['diff_percent'] = round(diff * 100, 2)
        
        return IndicatorSignal(
            name='EMA_Cross',
            value=ema_9 or 0,
            signal=signal,
            weight=self.weights['trend'],
            confidence=confidence,
            details=details
        )
    
    def _calculate_volatility_signal(self, closes: List[float]) -> IndicatorSignal:
        """Calculate Bollinger Bands signal (48% accuracy - low weight)"""
        bb = TechnicalIndicators.calculate_bollinger(closes)
        current_price = closes[-1]
        
        signal = 0
        confidence = 0.4  # Lower confidence due to 48% accuracy
        details = {'upper': None, 'middle': None, 'lower': None}
        
        if bb:
            details['upper'] = bb['upper']
            details['middle'] = bb['middle']
            details['lower'] = bb['lower']
            details['width'] = bb['width']
            
            # Price below lower band = potential bounce (but risky)
            if current_price < bb['lower']:
                signal = 0.5  # Reduced signal due to low accuracy
                confidence = 0.45
                details['status'] = 'below_lower_potential_bounce'
            # Price above upper band = potential pullback
            elif current_price > bb['upper']:
                signal = -0.5
                confidence = 0.45
                details['status'] = 'above_upper_potential_pullback'
            else:
                signal = 0
                confidence = 0.4
                details['status'] = 'within_bands'
        
        return IndicatorSignal(
            name='Bollinger',
            value=bb['width'] if bb else 0,
            signal=signal,
            weight=self.weights['volatility'],
            confidence=confidence,
            details=details
        )
    
    def _calculate_sentiment_signal(self) -> IndicatorSignal:
        """
        Calculate Fear & Greed signal based on VALIDATED data.
        
        IMPORTANT: The conventional wisdom is WRONG!
        - "Extreme Fear" is NOT a reliable buy signal (50.9% only)
        - "Fear" zone (21-40) is the BEST buy zone (57.8%)
        - "Extreme Greed" is NOT a reliable sell signal (48.6%)
        
        Validated on 1000 days of data (May 2026)
        """
        fg = self._get_fear_greed()
        
        signal = 0
        confidence = 0.5
        details = {'value': None, 'classification': None}
        
        if fg:
            value = fg['value']
            details['value'] = value
            details['classification'] = fg['classification']
            
            # Based on actual validation results:
            # - Extreme Fear (0-20): 50.9% up next week = NOT reliable
            # - Fear (21-40): 57.8% up next week = BEST BUY ZONE
            # - Neutral (41-60): 56.5% up = Good
            # - Greed (61-80): 56.1% up = Still bullish!
            # - Extreme Greed (81-100): 48.6% up = Slightly bearish
            
            if value <= 20:
                # Extreme Fear - NOT reliable buy (only 50.9%)
                signal = 0.25  # Slight bullish, low confidence
                confidence = 0.45  # Low confidence
                details['status'] = 'extreme_fear_weak_buy'
                details['note'] = 'Only 50.9% accuracy - not reliable'
            elif value <= 40:
                # Fear - BEST BUY ZONE (57.8% accuracy)
                signal = 1
                confidence = 0.65
                details['status'] = 'fear_best_buy_zone'
                details['note'] = '57.8% accuracy - best buy zone'
            elif value <= 60:
                # Neutral - Good (56.5%)
                signal = 0.5
                confidence = 0.55
                details['status'] = 'neutral_slight_buy'
                details['note'] = '56.5% accuracy - slight bullish'
            elif value <= 80:
                # Greed - Still bullish! (56.1%)
                signal = 0.25
                confidence = 0.55
                details['status'] = 'greed_still_bullish'
                details['note'] = '56.1% accuracy - momentum continues'
            else:
                # Extreme Greed - Slightly bearish (48.6%)
                signal = -0.5
                confidence = 0.50
                details['status'] = 'extreme_greed_caution'
                details['note'] = '48.6% accuracy - slight sell signal'
        
        return IndicatorSignal(
            name='Fear_Greed',
            value=fg['value'] if fg else 50,
            signal=signal,
            weight=self.weights['sentiment'],
            confidence=confidence,
            details=details
        )
    
    def analyze(self, symbol: str, ohlcv: List[Dict]) -> CryptoConfluenceSignal:
        """
        Analyze a cryptocurrency with confluence method.
        
        Args:
            symbol: Crypto symbol (e.g., 'BTC')
            ohlcv: List of OHLCV candles with keys: open, high, low, close, volume, timestamp
            
        Returns:
            CryptoConfluenceSignal with all analysis results
        """
        if len(ohlcv) < 30:
            return self._insufficient_data_signal(symbol, ohlcv)
        
        # Extract price data
        closes = [c['close'] for c in ohlcv]
        highs = [c['high'] for c in ohlcv]
        lows = [c['low'] for c in ohlcv]
        volumes = [c.get('volume', 0) for c in ohlcv]
        current_price = closes[-1]
        
        # Calculate all signals
        signals = {
            'volume': self._calculate_volume_signal(closes, highs, lows, volumes),
            'momentum': self._calculate_momentum_signal(highs, lows, closes),
            'trend': self._calculate_trend_signal(closes),
            'volatility': self._calculate_volatility_signal(closes),
            'sentiment': self._calculate_sentiment_signal()
        }
        
        # Calculate weighted score
        weighted_score = sum(s.signal * s.weight for s in signals.values())
        raw_score = sum(s.signal for s in signals.values())
        
        # Calculate confidence
        confidence = sum(s.confidence * s.weight for s in signals.values())
        
        # Determine final signal
        if weighted_score >= BUY_THRESHOLD:
            final_signal = 'BUY'
        elif weighted_score <= SELL_THRESHOLD:
            final_signal = 'SELL'
        else:
            final_signal = 'HOLD'
        
        # Calculate price levels
        support_levels = self._calculate_support_levels(lows, closes)
        resistance_levels = self._calculate_resistance_levels(highs, closes)
        
        entry_price = current_price
        target_price = resistance_levels[0] if resistance_levels else current_price * 1.05
        stop_loss = support_levels[0] if support_levels else current_price * 0.95
        
        # Risk metrics
        risk_reward = (target_price - entry_price) / (entry_price - stop_loss) if (entry_price - stop_loss) > 0 else 0
        
        # Generate reasons
        bullish_reasons = []
        bearish_reasons = []
        warnings = []
        
        for name, sig in signals.items():
            if sig.signal > 0:
                bullish_reasons.append(f"{sig.name}: {sig.details.get('status', 'bullish')}")
            elif sig.signal < 0:
                bearish_reasons.append(f"{sig.name}: {sig.details.get('status', 'bearish')}")
            
            if sig.confidence < 0.5:
                warnings.append(f"⚠️ {sig.name} has low confidence ({sig.confidence:.0%})")
        
        return CryptoConfluenceSignal(
            symbol=symbol,
            current_price=current_price,
            timestamp=datetime.now().isoformat(),
            signals=signals,
            weighted_score=round(weighted_score, 3),
            raw_score=round(raw_score, 2),
            signal=final_signal,
            confidence=round(confidence, 2),
            entry_price=round(entry_price, 2),
            target_price=round(target_price, 2),
            stop_loss=round(stop_loss, 2),
            support_levels=[round(s, 2) for s in support_levels[:3]],
            resistance_levels=[round(r, 2) for r in resistance_levels[:3]],
            risk_reward_ratio=round(risk_reward, 2),
            max_drawdown_estimate=round((entry_price - stop_loss) / entry_price * 100, 2),
            bullish_reasons=bullish_reasons,
            bearish_reasons=bearish_reasons,
            warnings=warnings
        )
    
    def _calculate_support_levels(self, lows: List[float], closes: List[float]) -> List[float]:
        """Calculate support levels"""
        recent_lows = sorted(lows[-30:])[:5]
        return list(set(recent_lows))
    
    def _calculate_resistance_levels(self, highs: List[float], closes: List[float]) -> List[float]:
        """Calculate resistance levels"""
        recent_highs = sorted(highs[-30:], reverse=True)[:5]
        return list(set(recent_highs))
    
    def _insufficient_data_signal(self, symbol: str, ohlcv: List[Dict]) -> CryptoConfluenceSignal:
        """Return signal for insufficient data"""
        current_price = ohlcv[-1]['close'] if ohlcv else 0
        
        return CryptoConfluenceSignal(
            symbol=symbol,
            current_price=current_price,
            timestamp=datetime.now().isoformat(),
            signals={},
            weighted_score=0,
            raw_score=0,
            signal='HOLD',
            confidence=0,
            entry_price=current_price,
            target_price=current_price,
            stop_loss=current_price,
            support_levels=[],
            resistance_levels=[],
            risk_reward_ratio=0,
            max_drawdown_estimate=0,
            bullish_reasons=[],
            bearish_reasons=[],
            warnings=['⚠️ بيانات غير كافية للتحليل']
        )
    
    def to_dict(self, signal: CryptoConfluenceSignal) -> Dict:
        """Convert signal to dictionary"""
        return {
            'symbol': signal.symbol,
            'current_price': signal.current_price,
            'timestamp': signal.timestamp,
            'signal': signal.signal,
            'confidence': signal.confidence,
            'weighted_score': signal.weighted_score,
            'raw_score': signal.raw_score,
            'entry_price': signal.entry_price,
            'target_price': signal.target_price,
            'stop_loss': signal.stop_loss,
            'support_levels': signal.support_levels,
            'resistance_levels': signal.resistance_levels,
            'risk_reward_ratio': signal.risk_reward_ratio,
            'max_drawdown_estimate': signal.max_drawdown_estimate,
            'bullish_reasons': signal.bullish_reasons,
            'bearish_reasons': signal.bearish_reasons,
            'warnings': signal.warnings,
            'indicators': {
                name: {
                    'value': sig.value,
                    'signal': sig.signal,
                    'weight': sig.weight,
                    'confidence': sig.confidence,
                    'details': sig.details
                }
                for name, sig in signal.signals.items()
            }
        }


# ============================================================================
# TESTING
# ============================================================================

def test_confluence_engine():
    """Test the confluence engine with sample data"""
    print("\n" + "="*60)
    print(" Testing Crypto Confluence Engine V2")
    print("="*60)
    
    engine = CryptoConfluenceEngine()
    
    # Generate sample data
    import random
    base_price = 65000  # BTC-like price
    ohlcv = []
    
    for i in range(100):
        change = random.uniform(-0.02, 0.02)
        base_price *= (1 + change)
        high = base_price * (1 + random.uniform(0, 0.01))
        low = base_price * (1 - random.uniform(0, 0.01))
        
        ohlcv.append({
            'timestamp': i,
            'open': base_price,
            'high': high,
            'low': low,
            'close': base_price,
            'volume': random.uniform(1000000, 10000000)
        })
    
    # Analyze
    signal = engine.analyze('BTC', ohlcv)
    
    print(f"\n📊 Results for {signal.symbol}:")
    print(f"   Price: ${signal.current_price:,.2f}")
    print(f"   Signal: {signal.signal}")
    print(f"   Confidence: {signal.confidence:.0%}")
    print(f"   Weighted Score: {signal.weighted_score:.3f}")
    
    print(f"\n📈 Individual Signals:")
    for name, sig in signal.signals.items():
        status = "🟢" if sig.signal > 0 else "🔴" if sig.signal < 0 else "🟡"
        print(f"   {status} {sig.name}: {sig.signal:+.1f} (weight: {sig.weight:.0%}, conf: {sig.confidence:.0%})")
    
    print(f"\n🎯 Price Levels:")
    print(f"   Entry: ${signal.entry_price:,.2f}")
    print(f"   Target: ${signal.target_price:,.2f}")
    print(f"   Stop Loss: ${signal.stop_loss:,.2f}")
    print(f"   R:R Ratio: {signal.risk_reward_ratio:.2f}")
    
    if signal.bullish_reasons:
        print(f"\n✅ Bullish Reasons:")
        for r in signal.bullish_reasons:
            print(f"   • {r}")
    
    if signal.bearish_reasons:
        print(f"\n❌ Bearish Reasons:")
        for r in signal.bearish_reasons:
            print(f"   • {r}")
    
    if signal.warnings:
        print(f"\n⚠️ Warnings:")
        for w in signal.warnings:
            print(f"   {w}")
    
    return signal


if __name__ == '__main__':
    test_confluence_engine()
