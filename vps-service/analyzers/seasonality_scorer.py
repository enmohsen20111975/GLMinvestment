"""
Seasonality Scorer for EGX
==========================
مقياس الموسمية للبورصة المصرية

Based on real data analysis:
- 24 EGX stocks
- 36,869 historical records
- 5+ years of data

Discovered Patterns:
- March Effect: Worst month (13/17 stocks showed negative)
- Thursday Effect: Best day (+0.25% to +0.53% avg)
- Monday Effect: Worst day
- January Effect: Rally month (+0.24% to +0.54% for 8 stocks)
- Ramadan Effect: -5% average for some stocks
- NO Summer Weakness in EGX (contrary to US)

Author: دليل الاستثمار
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from datetime import datetime, date
import json


# ============================================================================
# SEASONALITY PATTERNS - EGX Specific (Validated)
# ============================================================================

# Monthly effects (discovered from 24 stocks analysis)
MONTHLY_EFFECTS = {
    1: {'name': 'January Effect', 'adjustment': +0.10, 'confidence': 0.75, 'description': 'رالي يناير'},
    2: {'name': 'Neutral', 'adjustment': 0.00, 'confidence': 0.50, 'description': 'شهر محايد'},
    3: {'name': 'March Effect', 'adjustment': -0.15, 'confidence': 0.85, 'description': 'أسوأ شهر في EGX'},
    4: {'name': 'Slight Negative', 'adjustment': -0.03, 'confidence': 0.55, 'description': 'تأثير سلبي خفيف'},
    5: {'name': 'Slight Positive', 'adjustment': +0.02, 'confidence': 0.55, 'description': 'تأثير إيجابي خفيف'},
    6: {'name': 'Summer Start', 'adjustment': +0.03, 'confidence': 0.60, 'description': 'بداية الصيف - إيجابي في EGX'},
    7: {'name': 'Summer Peak', 'adjustment': +0.05, 'confidence': 0.65, 'description': 'قمة الصيف - لا يوجد ضعف في EGX'},
    8: {'name': 'Summer End', 'adjustment': +0.02, 'confidence': 0.55, 'description': 'نهاية الصيف'},
    9: {'name': 'Neutral', 'adjustment': 0.00, 'confidence': 0.50, 'description': 'شهر محايد'},
    10: {'name': 'Q4 Start', 'adjustment': +0.03, 'confidence': 0.55, 'description': 'بداية الربع الرابع'},
    11: {'name': 'November Rally', 'adjustment': +0.05, 'confidence': 0.65, 'description': 'رالي نوفمبر'},
    12: {'name': 'December Effect', 'adjustment': +0.05, 'confidence': 0.70, 'description': 'تأثير ديسمبر الإيجابي'},
}

# Weekday effects (discovered from analysis)
# NOTE: Python date.weekday() → 0=Monday,1=Tuesday,2=Wednesday,3=Thursday,
#       4=Friday, 5=Saturday, 6=Sunday.
# EGX trading week = Sunday(6) → Thursday(3). Friday(4) & Saturday(5) are
# WEEKEND (market closed) and must NEVER receive a seasonality adjustment.
WEEKDAY_EFFECTS = {
    6: {'name': 'Sunday Start', 'adjustment': -0.05, 'confidence': 0.65, 'description': 'بداية الأسبوع - سلبي'},
    0: {'name': 'Monday Effect', 'adjustment': -0.10, 'confidence': 0.80, 'description': 'أسوأ يوم تداول'},
    1: {'name': 'Neutral', 'adjustment': 0.00, 'confidence': 0.50, 'description': 'يوم محايد'},
    2: {'name': 'Wednesday Rally', 'adjustment': +0.03, 'confidence': 0.60, 'description': 'رالي الأربعاء'},
    3: {'name': 'Thursday Effect', 'adjustment': +0.10, 'confidence': 0.85, 'description': 'أحسن يوم تداول'},
    # 4 (Friday) & 5 (Saturday) intentionally omitted — EGX closed.
}
# EGX weekend days (Python weekday() index): Friday=4, Saturday=5
EGX_WEEKEND_DAYS = {4, 5}

# Stock-specific seasonality (discovered from analysis)
STOCK_SPECIFIC_SEASONALITY = {
    # January Rally stocks
    'ABUK': {'january_boost': +0.15},
    'COMI': {'january_boost': +0.12},
    'SKPC': {'january_boost': +0.10},
    'JUFO': {'january_boost': +0.08},
    'TMGH': {'january_boost': +0.12},
    'CIEB': {'january_boost': +0.10},
    'HRHO': {'january_boost': +0.10},
    'ETEL': {'january_boost': +0.08},
    
    # Ramadan-affected stocks
    'SWDY': {'ramadan_penalty': -0.15},
    'CIEB': {'ramadan_penalty': -0.12},
    'HRHO': {'ramadan_penalty': -0.10},
    'TMGH': {'ramadan_penalty': -0.08},
    'AMER': {'ramadan_penalty': -0.10},
    'ETEL': {'ramadan_penalty': -0.08},
    
    # Summer Strength stocks (contrary to US pattern)
    'ESRS': {'summer_boost': +0.10},
    'PHDC': {'summer_boost': +0.08},
    'HELI': {'summer_boost': +0.08},
    'HRHO': {'summer_boost': +0.05},
}

# Ramadan dates (approximate - needs yearly update)
RAMADAN_PERIODS = {
    2024: {'start': '2024-03-11', 'end': '2024-04-09'},
    2025: {'start': '2025-03-01', 'end': '2025-03-30'},
    2026: {'start': '2026-02-18', 'end': '2026-03-19'},
}


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class SeasonalityScore:
    """Seasonality analysis result."""
    total_score: float          # -100 to +100
    monthly_score: float        # Monthly contribution
    weekday_score: float        # Weekday contribution
    ramadan_adjustment: float   # Ramadan effect
    stock_specific: float       # Stock-specific adjustments
    
    signal: str                 # BUY, SELL, HOLD
    confidence: float           # 0-1
    
    warnings: List[str]         # Seasonality warnings
    recommendations: List[str]  # Trading recommendations
    
    def to_dict(self) -> Dict:
        return {
            'total_score': self.total_score,
            'monthly_score': self.monthly_score,
            'weekday_score': self.weekday_score,
            'ramadan_adjustment': self.ramadan_adjustment,
            'stock_specific': self.stock_specific,
            'signal': self.signal,
            'confidence': self.confidence,
            'warnings': self.warnings,
            'recommendations': self.recommendations,
        }


# ============================================================================
# SEASONALITY SCORER
# ============================================================================

class SeasonalityScorer:
    """
    مقياس الموسمية للبورصة المصرية
    
    Calculates seasonality score based on validated EGX patterns.
    
    Usage:
        scorer = SeasonalityScorer()
        score = scorer.analyze('COMI', datetime.now())
    """
    
    def __init__(self):
        self.monthly_effects = MONTHLY_EFFECTS
        self.weekday_effects = WEEKDAY_EFFECTS
        self.stock_specific = STOCK_SPECIFIC_SEASONALITY
        self.ramadan_periods = RAMADAN_PERIODS
    
    def analyze(
        self, 
        ticker: str, 
        analysis_date: date = None
    ) -> SeasonalityScore:
        """
        Analyze seasonality for a stock on a given date.
        
        Args:
            ticker: Stock symbol
            analysis_date: Date to analyze (default: today)
            
        Returns:
            SeasonalityScore with all components
        """
        if analysis_date is None:
            analysis_date = date.today()
        
        if isinstance(analysis_date, datetime):
            analysis_date = analysis_date.date()
        
        warnings = []
        recommendations = []
        
        # 1. Monthly Effect
        monthly = self._calculate_monthly_effect(analysis_date.month, warnings, recommendations)
        
        # 2. Weekday Effect
        weekday = self._calculate_weekday_effect(analysis_date.weekday(), warnings, recommendations)
        
        # 3. Ramadan Effect
        ramadan = self._calculate_ramadan_effect(ticker, analysis_date, warnings)
        
        # 4. Stock-Specific Seasonality
        stock_specific = self._calculate_stock_specific(ticker, analysis_date.month, recommendations)
        
        # 5. Calculate Total Score (-100 to +100)
        total = (monthly + weekday + ramadan + stock_specific) * 100
        
        # 6. Determine Signal
        signal = self._get_signal(total)
        
        # 7. Calculate Confidence
        confidence = self._calculate_confidence(monthly, weekday, ramadan)
        
        return SeasonalityScore(
            total_score=round(total, 1),
            monthly_score=round(monthly * 100, 1),
            weekday_score=round(weekday * 100, 1),
            ramadan_adjustment=round(ramadan * 100, 1),
            stock_specific=round(stock_specific * 100, 1),
            signal=signal,
            confidence=round(confidence, 2),
            warnings=warnings,
            recommendations=recommendations
        )
    
    def _calculate_monthly_effect(
        self, 
        month: int, 
        warnings: List[str], 
        recommendations: List[str]
    ) -> float:
        """Calculate monthly effect (-0.15 to +0.10)."""
        effect = self.monthly_effects.get(month, {'adjustment': 0, 'confidence': 0.5})
        
        if month == 3:
            warnings.append("⚠️ تأثير مارس: أسوأ شهر في EGX")
            recommendations.append("تجنب الدخول في مارس")
        elif month == 1:
            recommendations.append("✅ تأثير يناير: شهر جيد للدخول")
        elif month in [11, 12]:
            recommendations.append("✅ رالي نهاية العام")
        
        return effect['adjustment']
    
    def _calculate_weekday_effect(
        self, 
        weekday: int, 
        warnings: List[str], 
        recommendations: List[str]
    ) -> float:
        """Calculate weekday effect (-0.10 to +0.10).
        
        EGX is CLOSED on Friday (4) & Saturday (5) — these days must return 0
        and never trigger a seasonality warning/recommendation.
        """
        # EGX weekend guard: Friday(4) & Saturday(5) are non-trading days
        if weekday in EGX_WEEKEND_DAYS:
            return 0.0
        
        effect = self.weekday_effects.get(weekday, {'adjustment': 0, 'confidence': 0.5})
        
        if weekday == 0:  # Monday
            warnings.append("⚠️ تأثير الاثنين: أسوأ يوم تداول")
            recommendations.append("ادخل يوم الأربعاء بدل الاثنين")
        elif weekday == 3:  # Thursday
            recommendations.append("✅ تأثير الخميس: أحسن يوم تداول")
        elif weekday == 2:  # Wednesday
            recommendations.append("💡 ادخل الأربعاء لتكسب الخميس")
        elif weekday == 6:  # Sunday
            recommendations.append("💡 بداية الأسبوع - ترقب فرص الأربعاء/الخميس")
        
        return effect['adjustment']
    
    def _calculate_ramadan_effect(
        self, 
        ticker: str, 
        analysis_date: date, 
        warnings: List[str]
    ) -> float:
        """Calculate Ramadan effect."""
        year = analysis_date.year
        
        if year not in self.ramadan_periods:
            return 0
        
        ramadan = self.ramadan_periods[year]
        start = datetime.strptime(ramadan['start'], '%Y-%m-%d').date()
        end = datetime.strptime(ramadan['end'], '%Y-%m-%d').date()
        
        if start <= analysis_date <= end:
            warnings.append("🌙 رمضان: سيولة أقل متوقعة")
            
            # Check if stock is affected
            stock_info = self.stock_specific.get(ticker, {})
            penalty = stock_info.get('ramadan_penalty', -0.05)
            return penalty
        
        return 0
    
    def _calculate_stock_specific(
        self, 
        ticker: str, 
        month: int, 
        recommendations: List[str]
    ) -> float:
        """Calculate stock-specific seasonality."""
        stock_info = self.stock_specific.get(ticker, {})
        adjustment = 0
        
        # January boost
        if month == 1 and 'january_boost' in stock_info:
            boost = stock_info['january_boost']
            adjustment += boost
            recommendations.append(f"✅ {ticker} في رالي يناير (+{boost*100:.0f}%)")
        
        # Summer boost
        if month in [6, 7, 8] and 'summer_boost' in stock_info:
            boost = stock_info['summer_boost']
            adjustment += boost
            recommendations.append(f"☀️ {ticker} قوي في الصيف (+{boost*100:.0f}%)")
        
        return adjustment
    
    def _get_signal(self, score: float) -> str:
        """Convert score to signal."""
        if score >= 15:
            return 'STRONG_BUY'
        elif score >= 8:
            return 'BUY'
        elif score >= 3:
            return 'ACCUMULATE'
        elif score >= -3:
            return 'HOLD'
        elif score >= -8:
            return 'REDUCE'
        elif score >= -15:
            return 'SELL'
        else:
            return 'STRONG_SELL'
    
    def _calculate_confidence(
        self, 
        monthly: float, 
        weekday: float, 
        ramadan: float
    ) -> float:
        """Calculate confidence based on pattern strength."""
        # Higher confidence when multiple patterns align
        base_confidence = 0.6
        
        # Monthly pattern confidence
        month_idx = datetime.now().month
        monthly_conf = self.monthly_effects.get(month_idx, {}).get('confidence', 0.5)
        
        # Weekday pattern confidence
        weekday_idx = datetime.now().weekday()
        weekday_conf = self.weekday_effects.get(weekday_idx, {}).get('confidence', 0.5)
        
        # Combine
        confidence = (base_confidence + monthly_conf + weekday_conf) / 3
        
        # Boost if patterns align in same direction
        if monthly > 0 and weekday > 0:
            confidence += 0.1
        elif monthly < 0 and weekday < 0:
            confidence += 0.1
        
        return min(0.95, max(0.4, confidence))
    
    def get_best_trading_days(self, month: int = None) -> Dict:
        """Get best trading days for a month."""
        if month is None:
            month = datetime.now().month
        
        month_effect = self.monthly_effects.get(month, {})
        
        return {
            'month': month,
            'month_name': month_effect.get('name', 'Neutral'),
            'month_adjustment': month_effect.get('adjustment', 0),
            'best_day': 'Thursday',
            'worst_day': 'Monday',
            'recommendation': 'Enter Wednesday, exit Thursday' if month_effect.get('adjustment', 0) >= 0 else 'Avoid or reduce exposure'
        }
    
    def get_monthly_forecast(self) -> List[Dict]:
        """Get seasonality forecast for all months."""
        forecast = []
        
        for month in range(1, 13):
            effect = self.monthly_effects.get(month, {})
            forecast.append({
                'month': month,
                'month_name': datetime(2024, month, 1).strftime('%B'),
                'adjustment': effect.get('adjustment', 0),
                'signal': 'BUY' if effect.get('adjustment', 0) > 0 else ('SELL' if effect.get('adjustment', 0) < 0 else 'HOLD'),
                'confidence': effect.get('confidence', 0.5),
                'description': effect.get('description', '')
            })
        
        return forecast


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    scorer = SeasonalityScorer()
    
    print("=" * 60)
    print("SEASONALITY SCORER - EGX Validated")
    print("=" * 60)
    
    # Test with COMI
    result = scorer.analyze('COMI')
    
    print(f"\nTicker: COMI")
    print(f"Total Score: {result.total_score}")
    print(f"Monthly: {result.monthly_score}")
    print(f"Weekday: {result.weekday_score}")
    print(f"Ramadan: {result.ramadan_adjustment}")
    print(f"Signal: {result.signal}")
    print(f"Confidence: {result.confidence}")
    print(f"\nWarnings: {result.warnings}")
    print(f"Recommendations: {result.recommendations}")
    
    # Test March (worst month)
    from datetime import datetime
    print("\n" + "=" * 60)
    print("MARCH ANALYSIS (Worst Month)")
    print("=" * 60)
    march_date = date(2025, 3, 15)  # Saturday (weekday 5, but March)
    result_march = scorer.analyze('COMI', march_date)
    print(f"Score: {result_march.total_score}")
    print(f"Warnings: {result_march.warnings}")
    
    # Test January (best month for many stocks)
    print("\n" + "=" * 60)
    print("JANUARY ANALYSIS (Rally Month)")
    print("=" * 60)
    jan_date = date(2025, 1, 15)
    result_jan = scorer.analyze('ABUK', jan_date)
    print(f"Score: {result_jan.total_score}")
    print(f"Recommendations: {result_jan.recommendations}")
    
    # Monthly forecast
    print("\n" + "=" * 60)
    print("MONTHLY FORECAST")
    print("=" * 60)
    forecast = scorer.get_monthly_forecast()
    for f in forecast:
        signal_icon = "✅" if f['signal'] == 'BUY' else ("❌" if f['signal'] == 'SELL' else "➖")
        print(f"{f['month']:2d}. {f['month_name']:12s} {signal_icon} {f['adjustment']:+.0%} ({f['description']})")
