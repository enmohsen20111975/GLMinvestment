"""
Confluence Engine v2
====================
محرك التوحيد - النسخة المحسنة

Based on Walk-Forward Analysis results:
- Testing Period: March 2025 - April 2025
- Total Signals: 8,411
- Confluence Accuracy: 50.7%

Updated Weights based on performance:
- MA Cross: 51.5% accuracy → KEEP (highest)
- MACD: 50.4% accuracy → KEEP
- RSI: 48.8% accuracy → REDUCE_WEIGHT
- Fibonacci: 47.6% accuracy → REDUCE_WEIGHT
- Bollinger: 47.5% accuracy → REDUCE_WEIGHT

Author: دليل الاستثمار
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime
import json


# ============================================================================
# WEIGHTS - Updated based on Walk-Forward Analysis
# ============================================================================

# New weights from walk_forward_analysis.py
CONFLUENCE_WEIGHTS_V2 = {
    'ma_cross': 0.22,      # Best performer (51.5%)
    'macd': 0.18,          # Second best (50.4%)
    'rsi': 0.12,           # Reduced (48.8%)
    'fibonacci': 0.10,     # Reduced (47.6%)
    'bollinger': 0.08,     # Reduced (47.5%)
    'volume': 0.10,        # Keep moderate
    'seasonality': 0.12,   # EGX-specific patterns
    'dividend': 0.08,      # Dividend calendar impact
}

# Ensure weights sum to 1.0
assert abs(sum(CONFLUENCE_WEIGHTS_V2.values()) - 1.0) < 0.01, "Weights must sum to 1.0"


# Seasonality adjustments discovered from EGX data
SEASONALITY_WEIGHTS = {
    'monthly': {
        3: -0.15,  # March Effect (أسوأ شهر)
        1: +0.10,  # January Effect
        11: +0.05, # November
        12: +0.05, # December
    },
    'weekday': {
        3: +0.10,  # Thursday (أحسن يوم)
        0: -0.10,  # Monday (أسوأ يوم)
    },
    'ramadan': -0.05,
    'summer': +0.05,  # No Summer Weakness in EGX
}


# ============================================================================
# THRESHOLDS
# ============================================================================

THRESHOLDS = {
    'STRONG_BUY': 80,   # Top 2-4 stocks per month
    'BUY': 65,          # Good entry points
    'ACCUMULATE': 50,   # Gradual buying
    'HOLD': 35,
    'REDUCE': 25,
    'SELL': 15,
    'STRONG_SELL': 5,
}


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class ConfluenceResult:
    """Result of Confluence Analysis."""
    ticker: str
    signal: str
    signal_ar: str
    confidence: float
    master_score: float
    
    # Individual indicator scores
    ma_cross_score: float
    macd_score: float
    rsi_score: float
    fibonacci_score: float
    bollinger_score: float
    volume_score: float
    seasonality_score: float
    dividend_score: float
    
    # Weights used
    weights_used: Dict
    
    # Metadata
    timestamp: str
    
    def to_dict(self) -> Dict:
        return asdict(self)


# ============================================================================
# CONFLUENCE ENGINE
# ============================================================================

class ConfluenceEngine:
    """
    محرك التوحيد - النسخة المحسنة
    
    Combines multiple indicators with Walk-Forward validated weights.
    
    Usage:
        engine = ConfluenceEngine()
        result = engine.calculate_confluence(
            ticker='COMI',
            ma_cross_signal='BUY',
            macd_signal='BUY',
            rsi_signal='HOLD',
            ...
        )
    """
    
    def __init__(self, weights: Dict[str, float] = None):
        """
        Initialize Confluence Engine.
        
        Args:
            weights: Optional custom weights (default: CONFLUENCE_WEIGHTS_V2)
        """
        self.weights = weights or CONFLUENCE_WEIGHTS_V2
        self.thresholds = THRESHOLDS
        self.seasonality_weights = SEASONALITY_WEIGHTS
    
    def calculate_confluence(
        self,
        ticker: str,
        ma_cross_signal: str = 'HOLD',
        macd_signal: str = 'HOLD',
        rsi_signal: str = 'HOLD',
        fibonacci_signal: str = 'HOLD',
        bollinger_signal: str = 'HOLD',
        volume_signal: str = 'HOLD',
        seasonality_signal: str = 'HOLD',
        dividend_signal: str = 'HOLD',
    ) -> ConfluenceResult:
        """
        Calculate confluence signal from all indicators.
        
        Args:
            ticker: Stock symbol
            ma_cross_signal: MA Cross signal (BUY/SELL/HOLD)
            macd_signal: MACD signal
            rsi_signal: RSI signal
            fibonacci_signal: Fibonacci signal
            bollinger_signal: Bollinger Bands signal
            volume_signal: Volume signal
            seasonality_signal: Seasonality signal
            dividend_signal: Dividend calendar signal
            
        Returns:
            ConfluenceResult with combined signal
        """
        signals = {
            'ma_cross': ma_cross_signal,
            'macd': macd_signal,
            'rsi': rsi_signal,
            'fibonacci': fibonacci_signal,
            'bollinger': bollinger_signal,
            'volume': volume_signal,
            'seasonality': seasonality_signal,
            'dividend': dividend_signal,
        }
        
        # Calculate weighted scores
        buy_score = 0.0
        sell_score = 0.0
        total_weight = 0.0
        
        indicator_scores = {}
        
        for indicator, signal in signals.items():
            weight = self.weights.get(indicator, 0.1)
            total_weight += weight
            
            # Convert signal to score
            if signal == 'BUY':
                score = 100
                buy_score += weight
            elif signal == 'SELL':
                score = 0
                sell_score += weight
            else:
                score = 50
            
            indicator_scores[f'{indicator}_score'] = score
        
        # Normalize scores
        buy_pct = buy_score / total_weight if total_weight > 0 else 0
        sell_pct = sell_score / total_weight if total_weight > 0 else 0
        
        # Calculate master score (0-100, where 50 is neutral)
        master_score = 50 + (buy_pct - sell_pct) * 50
        
        # Determine signal
        signal = self._get_signal_from_score(master_score)
        signal_ar = self._get_signal_arabic(signal)
        
        # Calculate confidence
        confidence = min(50 + abs(master_score - 50), 95)
        
        return ConfluenceResult(
            ticker=ticker,
            signal=signal,
            signal_ar=signal_ar,
            confidence=round(confidence, 1),
            master_score=round(master_score, 2),
            ma_cross_score=indicator_scores.get('ma_cross_score', 50),
            macd_score=indicator_scores.get('macd_score', 50),
            rsi_score=indicator_scores.get('rsi_score', 50),
            fibonacci_score=indicator_scores.get('fibonacci_score', 50),
            bollinger_score=indicator_scores.get('bollinger_score', 50),
            volume_score=indicator_scores.get('volume_score', 50),
            seasonality_score=indicator_scores.get('seasonality_score', 50),
            dividend_score=indicator_scores.get('dividend_score', 50),
            weights_used=self.weights,
            timestamp=datetime.now().isoformat()
        )
    
    def apply_seasonality_adjustment(
        self,
        base_score: float,
        current_month: int,
        current_weekday: int,
        is_ramadan: bool = False
    ) -> Tuple[float, str]:
        """
        Apply EGX-specific seasonality adjustments.
        
        Args:
            base_score: The base confluence score
            current_month: Current month (1-12)
            current_weekday: Current weekday (0=Monday, 6=Sunday)
            is_ramadan: Whether currently in Ramadan
            
        Returns:
            Tuple of (adjusted_score, warning_message)
        """
        adjustment = 0.0
        warnings = []
        
        # Monthly adjustment
        monthly_adj = self.seasonality_weights['monthly'].get(current_month, 0)
        adjustment += monthly_adj
        
        if current_month == 3:
            warnings.append("⚠️ March Effect: Historically worst month for EGX")
        
        # Weekday adjustment
        weekday_adj = self.seasonality_weights['weekday'].get(current_weekday, 0)
        adjustment += weekday_adj
        
        if current_weekday == 0:
            warnings.append("⚠️ Monday Effect: Historically worst trading day")
        elif current_weekday == 3:
            warnings.append("✅ Thursday Effect: Historically best trading day")
        
        # Ramadan adjustment
        if is_ramadan:
            adjustment += self.seasonality_weights['ramadan']
            warnings.append("🌙 Ramadan: Lower liquidity expected")
        
        # Apply adjustment (scale to score impact)
        adjusted_score = base_score * (1 + adjustment)
        adjusted_score = max(0, min(100, adjusted_score))
        
        warning_message = " | ".join(warnings) if warnings else None
        
        return round(adjusted_score, 2), warning_message
    
    def get_indicator_recommendations(self) -> Dict:
        """
        Get recommendations for each indicator based on Walk-Forward results.
        
        Returns:
            Dict with recommendations for each indicator
        """
        return {
            'ma_cross': {
                'action': 'KEEP',
                'weight': self.weights['ma_cross'],
                'accuracy': 51.5,
                'reason': 'Best performing indicator in Walk-Forward Analysis'
            },
            'macd': {
                'action': 'KEEP',
                'weight': self.weights['macd'],
                'accuracy': 50.4,
                'reason': 'Second best performer, reliable trend indicator'
            },
            'rsi': {
                'action': 'REDUCE_WEIGHT',
                'weight': self.weights['rsi'],
                'accuracy': 48.8,
                'reason': 'Below 50% threshold, reduce weight from 0.15 to 0.12'
            },
            'fibonacci': {
                'action': 'REDUCE_WEIGHT',
                'weight': self.weights['fibonacci'],
                'accuracy': 47.6,
                'reason': 'Weak performance, reduce weight from 0.15 to 0.10'
            },
            'bollinger': {
                'action': 'REDUCE_WEIGHT',
                'weight': self.weights['bollinger'],
                'accuracy': 47.5,
                'reason': 'Weakest technical indicator, reduce to 0.08'
            },
            'seasonality': {
                'action': 'KEEP',
                'weight': self.weights['seasonality'],
                'accuracy': None,
                'reason': 'EGX-specific patterns validated on 24 stocks'
            },
            'dividend': {
                'action': 'KEEP',
                'weight': self.weights['dividend'],
                'accuracy': None,
                'reason': 'Dividend calendar helps timing entries/exits'
            }
        }
    
    def _get_signal_from_score(self, score: float) -> str:
        """Convert score to signal."""
        if score >= self.thresholds['STRONG_BUY']:
            return 'STRONG_BUY'
        elif score >= self.thresholds['BUY']:
            return 'BUY'
        elif score >= self.thresholds['ACCUMULATE']:
            return 'ACCUMULATE'
        elif score >= self.thresholds['HOLD']:
            return 'HOLD'
        elif score >= self.thresholds['REDUCE']:
            return 'REDUCE'
        elif score >= self.thresholds['SELL']:
            return 'SELL'
        else:
            return 'STRONG_SELL'
    
    def _get_signal_arabic(self, signal: str) -> str:
        """Get Arabic signal name."""
        translations = {
            'STRONG_BUY': 'شراء قوي',
            'BUY': 'شراء',
            'ACCUMULATE': 'تجميع',
            'HOLD': 'احتفاظ',
            'REDUCE': 'تخفيف',
            'SELL': 'بيع',
            'STRONG_SELL': 'بيع قوي',
        }
        return translations.get(signal, signal)


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def get_current_seasonality_signal() -> Tuple[str, float]:
    """
    Get current seasonality signal based on date.
    
    Returns:
        Tuple of (signal_description, adjustment_factor)
    """
    now = datetime.now()
    month = now.month
    weekday = now.weekday()  # 0=Monday, 6=Sunday
    
    adjustments = []
    total_adj = 0.0
    
    # Check monthly effect
    if month == 3:
        adjustments.append("March Effect (أسوأ شهر)")
        total_adj -= 0.15
    elif month == 1:
        adjustments.append("January Effect")
        total_adj += 0.10
    
    # Check weekday effect
    if weekday == 0:  # Monday
        adjustments.append("Monday Effect (أسوأ يوم)")
        total_adj -= 0.10
    elif weekday == 3:  # Thursday
        adjustments.append("Thursday Effect (أحسن يوم)")
        total_adj += 0.10
    
    signal = " | ".join(adjustments) if adjustments else "No significant seasonality"
    
    return signal, total_adj


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    # Example usage
    engine = ConfluenceEngine()
    
    # Example: Calculate confluence for a stock
    result = engine.calculate_confluence(
        ticker='COMI',
        ma_cross_signal='BUY',
        macd_signal='BUY',
        rsi_signal='HOLD',
        fibonacci_signal='HOLD',
        bollinger_signal='SELL',
        volume_signal='BUY',
        seasonality_signal='HOLD',
        dividend_signal='HOLD'
    )
    
    print("=" * 60)
    print("CONFLUENCE ENGINE v2 - Walk-Forward Validated")
    print("=" * 60)
    print(f"Ticker: {result.ticker}")
    print(f"Signal: {result.signal} ({result.signal_ar})")
    print(f"Confidence: {result.confidence}%")
    print(f"Master Score: {result.master_score}")
    print()
    print("Indicator Scores:")
    print(f"  MA Cross: {result.ma_cross_score}")
    print(f"  MACD: {result.macd_score}")
    print(f"  RSI: {result.rsi_score}")
    print(f"  Fibonacci: {result.fibonacci_score}")
    print(f"  Bollinger: {result.bollinger_score}")
    print(f"  Volume: {result.volume_score}")
    print(f"  Seasonality: {result.seasonality_score}")
    print(f"  Dividend: {result.dividend_score}")
    print()
    
    # Print indicator recommendations
    print("=" * 60)
    print("INDICATOR RECOMMENDATIONS")
    print("=" * 60)
    recommendations = engine.get_indicator_recommendations()
    for indicator, rec in recommendations.items():
        print(f"{indicator:12s}: {rec['action']:15s} (weight: {rec['weight']:.2f})")
        print(f"             Reason: {rec['reason']}")
