"""
Timing Analyzer
===============
Timing Analysis Engine for optimal entry/exit.

Features:
- Market Session Detection
- Best Hours for Trading
- Weekly Patterns
- Seasonal Patterns

Author: دليل الاستثمار
"""

from typing import Dict, List, Optional
from dataclasses import dataclass, asdict
from datetime import datetime, timedelta
from enum import Enum


class MarketSession(Enum):
    PRE_MARKET = "PRE_MARKET"
    MARKET_OPEN = "MARKET_OPEN"
    MARKET_CLOSE = "MARKET_CLOSE"
    AFTER_HOURS = "AFTER_HOURS"
    WEEKEND = "WEEKEND"
    HOLIDAY = "HOLIDAY"


@dataclass
class TimingAnalysis:
    """Data class for timing analysis."""
    current_hour_utc: int = 0
    current_session: str = "UNKNOWN"
    day_of_week: int = 0
    day_name: str = ""
    month: int = 0
    
    # Best times
    best_buy_hours: List[int] = None
    best_sell_hours: List[int] = None
    
    # Scores
    timing_score: int = 0
    timing_recommendation: str = "NEUTRAL"
    
    def to_dict(self) -> Dict:
        result = asdict(self)
        return result


class TimingAnalyzer:
    """
    Timing Analysis Engine.
    
    Usage:
        analyzer = TimingAnalyzer()
        timing = analyzer.analyze()  # For stocks (EGX)
        timing = analyzer.analyze(asset_type='CRYPTO')  # For crypto
    """
    
    def __init__(self):
        # Best trading hours for EGX (Cairo time, converted to UTC)
        # EGX hours: 10:15 AM - 2:30 PM Cairo (UTC+2)
        self.best_buy_hours_stock = [8, 9, 10, 12]  # UTC
        self.best_sell_hours_stock = [11, 12, 13]   # UTC
        
        # Crypto patterns (24/7 but has patterns)
        self.best_buy_hours_crypto = [2, 3, 4, 14, 15, 22, 23]  # UTC - calmer hours
        self.best_sell_hours_crypto = [8, 9, 13, 14, 20, 21]    # UTC - volatile hours
        
        # Weekly patterns (0=Monday, 6=Sunday)
        self.best_buy_days = [0, 1, 4]  # Mon, Tue, Fri
        self.best_sell_days = [3, 4]    # Thu, Fri
    
    def analyze(self, asset_type: str = "STOCK") -> TimingAnalysis:
        """
        Perform timing analysis.
        
        Args:
            asset_type: "STOCK" or "CRYPTO"
            
        Returns:
            TimingAnalysis dataclass
        """
        now = datetime.utcnow()
        
        timing = TimingAnalysis(
            current_hour_utc=now.hour,
            current_session=self._get_market_session(now, asset_type),
            day_of_week=now.weekday(),
            day_name=now.strftime("%A"),
            month=now.month
        )
        
        # Set best hours based on asset type
        if asset_type.upper() == "CRYPTO":
            timing.best_buy_hours = self.best_buy_hours_crypto
            timing.best_sell_hours = self.best_sell_hours_crypto
        else:
            timing.best_buy_hours = self.best_buy_hours_stock
            timing.best_sell_hours = self.best_sell_hours_stock
        
        # Calculate timing score
        timing.timing_score = self._calculate_score(timing, asset_type)
        timing.timing_recommendation = self._get_recommendation(timing)
        
        return timing
    
    def _get_market_session(self, dt: datetime, asset_type: str) -> str:
        """Get current market session."""
        if asset_type.upper() == "CRYPTO":
            return "24/7"
        
        # Check weekend (Saturday=5, Sunday=6)
        if dt.weekday() >= 5:
            return "WEEKEND"
        
        hour = dt.hour
        
        # EGX Market Hours (UTC)
        # Pre-market: before 8:15 UTC
        # Open: 8:15 - 12:30 UTC
        # After hours: after 12:30 UTC
        
        if hour < 8:
            return "PRE_MARKET"
        elif 8 <= hour < 12:
            return "MARKET_OPEN"
        elif hour == 12:
            return "MARKET_CLOSE"
        else:
            return "AFTER_HOURS"
    
    def _calculate_score(self, timing: TimingAnalysis, asset_type: str) -> int:
        """Calculate timing score (-5 to +5)."""
        score = 0
        
        # Hour-based scoring
        if timing.current_hour_utc in timing.best_buy_hours:
            score += 2
        elif timing.current_hour_utc in timing.best_sell_hours:
            score -= 1
        
        # Day-based scoring
        if timing.day_of_week in self.best_buy_days:
            score += 1
        elif timing.day_of_week in self.best_sell_days:
            score -= 1
        
        # Session scoring (for stocks)
        if asset_type.upper() == "STOCK":
            if timing.current_session == "MARKET_OPEN":
                score += 1  # Active trading
            elif timing.current_session == "WEEKEND":
                score -= 2  # Market closed
        
        # Month patterns
        if timing.month in [12, 1]:  # Year end / beginning
            score += 1  # Often bullish
        elif timing.month in [9, 10]:  # September/October
            score -= 1  # Often bearish
        
        return score
    
    def _get_recommendation(self, timing: TimingAnalysis) -> str:
        """Get timing recommendation."""
        if timing.timing_score >= 3:
            return "EXCELLENT_TIMING"
        elif timing.timing_score >= 1:
            return "GOOD_TIMING"
        elif timing.timing_score <= -3:
            return "POOR_TIMING"
        return "NEUTRAL_TIMING"
    
    def get_best_trading_time(self, asset_type: str = "STOCK") -> Dict:
        """Get best trading times for today."""
        timing = self.analyze(asset_type)
        
        return {
            'current_session': timing.current_session,
            'timing_score': timing.timing_score,
            'recommendation': timing.timing_recommendation,
            'best_buy_hours': timing.best_buy_hours,
            'best_sell_hours': timing.best_sell_hours,
            'current_hour_utc': timing.current_hour_utc,
            'is_good_time_to_buy': timing.timing_score >= 1,
            'is_good_time_to_sell': timing.timing_score <= -1
        }
    
    def is_market_open(self, asset_type: str = "STOCK") -> bool:
        """Check if market is currently open."""
        timing = self.analyze(asset_type)
        return timing.current_session in ["MARKET_OPEN", "24/7"]
