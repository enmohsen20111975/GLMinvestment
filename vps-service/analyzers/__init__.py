"""
Analyzers Module
================
All analysis engines for stocks and crypto.

Golden Rules Applied:
1. Liquidity First - liquidity_filter.py
2. Session Dynamics - session_timing.py (not "best hours")
3. Weighted Technical - technical_weighted.py
4. Sector-Relative Fundamentals - fundamental_relative.py
5. Adaptive Risk - risk_adaptive.py
6. Master Analysis - master_analyzer.py (THE BRAIN)

Legacy Modules (kept for compatibility):
- technical: Technical Analysis (simple scoring)
- fundamental: Fundamental Analysis (absolute thresholds)
- timing: Timing Analysis (hourly)
- patterns: Pattern Recognition
- fibonacci: Fibonacci Analysis
- candlestick: Candlestick Patterns
- risk: Risk Management (fixed stop loss)

New Modules (Kemi's Improvements):
- liquidity_filter: First step before any analysis
- session_timing: Session dynamics (Opening/Main/Closing)
- technical_weighted: Weighted technical scoring
- fundamental_relative: Sector-relative fundamental analysis
- risk_adaptive: Adaptive stop loss based on signal/volatility/liquidity
- master_analyzer: Unified scoring and decision making
"""

# Legacy analyzers (keep for backward compatibility)
from .technical import TechnicalAnalyzer
from .fundamental import FundamentalAnalyzer
from .timing import TimingAnalyzer
from .patterns import PatternRecognitionEngine
from .fibonacci import FibonacciAnalyzer
from .candlestick import CandlestickAnalyzer
from .risk import RiskManager

# New analyzers (Kemi's improvements)
from .liquidity_filter import LiquidityFilter, LiquidityLevel, check_liquidity_first
from .session_timing import SessionTimingAnalyzer, SessionPhase, get_current_session
from .technical_weighted import TechnicalAnalyzerWeighted, TECHNICAL_WEIGHTS
from .fundamental_relative import FundamentalAnalyzerRelative, SECTOR_MEDIANS
from .risk_adaptive import RiskManagerAdaptive, calculate_trade_risk
from .master_analyzer import MasterAnalyzer, MASTER_WEIGHTS, THRESHOLDS

__all__ = [
    # Legacy
    'TechnicalAnalyzer',
    'FundamentalAnalyzer',
    'TimingAnalyzer',
    'PatternRecognitionEngine',
    'FibonacciAnalyzer',
    'CandlestickAnalyzer',
    'RiskManager',
    # New
    'LiquidityFilter',
    'LiquidityLevel',
    'check_liquidity_first',
    'SessionTimingAnalyzer',
    'SessionPhase',
    'get_current_session',
    'TechnicalAnalyzerWeighted',
    'TECHNICAL_WEIGHTS',
    'FundamentalAnalyzerRelative',
    'SECTOR_MEDIANS',
    'RiskManagerAdaptive',
    'calculate_trade_risk',
    'MasterAnalyzer',
    'MASTER_WEIGHTS',
    'THRESHOLDS',
]
