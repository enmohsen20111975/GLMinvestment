"""
Seasonality-First Confluence Engine
===================================
محرك التوحيد الموسمي - النظام الجديد للبورصة المصرية

Why Seasonality-First?
- Traditional Technical Indicators FAIL on EGX (all < 50% accuracy)
- Seasonality patterns VALIDATED on 24 stocks, 36,869 records
- Fundamental data available for 100+ stocks

Weights:
- Seasonality: 35% (March Effect, Thursday Effect, January Effect, etc.)
- Fundamental: 30% (Piotroski + Altman + Magic Formula)
- Sector Relative: 20% (Stock vs Sector performance)
- Dividend: 15% (Dividend Calendar timing)

NO TECHNICAL INDICATORS USED!

Author: دليل الاستثمار
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
from datetime import datetime, date
import sqlite3
import json
import sys
import os
from pathlib import Path as _P

# Relative project root
_PROJECT_ROOT = _P(__file__).resolve().parent.parent.parent
_DEFAULT_STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from analyzers.seasonality_scorer import SeasonalityScorer, SeasonalityScore
from analyzers.fundamental_scorer import FundamentalScorer, FundamentalScore
from analyzers.sector_relative import SectorRelativeAnalyzer, SectorRelativeScore
from analyzers.dividend_checker import DividendChecker, DividendScore


# ============================================================================
# WEIGHTS - SEASONALITY FIRST
# ============================================================================

WEIGHTS = {
    'seasonality': 0.35,    # EGX-validated patterns
    'fundamental': 0.30,    # Piotroski + Altman + Value
    'sector_relative': 0.20, # Stock vs Sector
    'dividend': 0.15,       # Dividend timing
}

# Minimum confidence to generate signal
MIN_CONFIDENCE = 0.50


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class ConfluenceSignal:
    """Complete confluence signal result."""
    ticker: str
    signal: str                    # STRONG_BUY, BUY, ACCUMULATE, HOLD, REDUCE, SELL
    signal_ar: str                 # Arabic translation
    confidence: float              # 0-1
    
    # Scores
    total_score: float             # 0-100
    seasonality_score: float
    fundamental_score: float
    sector_score: float
    dividend_score: float
    
    # Weights used
    weights: Dict
    
    # Details
    seasonality_details: Dict
    fundamental_details: Dict
    sector_details: Dict
    dividend_details: Dict
    
    # Recommendations
    recommendations: List[str]
    warnings: List[str]
    
    # Risk
    risk_level: str
    suggested_position_pct: float
    
    # Metadata
    timestamp: str
    version: str = "seasonality-first-v1"
    
    def to_dict(self) -> Dict:
        return asdict(self)


# ============================================================================
# SEASONALITY-FIRST ENGINE
# ============================================================================

class SeasonalityFirstEngine:
    """
    محرك التوحيد الموسمي
    
    NO TECHNICAL INDICATORS - Uses EGX-validated patterns.
    
    Usage:
        engine = SeasonalityFirstEngine()
        signal = engine.analyze('COMI')
    """
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path or _DEFAULT_STOCKS_DB
        self.weights = WEIGHTS
        
        # Initialize sub-analyzers
        self.seasonality = SeasonalityScorer()
        self.fundamental = FundamentalScorer(db_path)
        self.sector = SectorRelativeAnalyzer(db_path)
        self.dividend = DividendChecker(db_path)
    
    def analyze(
        self, 
        ticker: str, 
        analysis_date: date = None
    ) -> Optional[ConfluenceSignal]:
        """
        Perform complete analysis using Seasonality-First approach.
        
        Args:
            ticker: Stock symbol
            analysis_date: Date to analyze (default: today)
            
        Returns:
            ConfluenceSignal or None if data insufficient
        """
        if analysis_date is None:
            analysis_date = date.today()
        
        # 1. Seasonality Analysis (35%)
        seasonality_result = self.seasonality.analyze(ticker, analysis_date)
        seasonality_score = self._normalize_score(seasonality_result.total_score)
        seasonality_details = seasonality_result.to_dict()
        
        # 2. Fundamental Analysis (30%)
        fundamental_result = self.fundamental.analyze(ticker)
        fundamental_score = fundamental_result.total_score
        fundamental_details = fundamental_result.to_dict()
        
        # 3. Sector Relative Analysis (20%)
        sector_result = self.sector.analyze(ticker)
        sector_score = sector_result.relative_score
        sector_details = sector_result.to_dict()
        
        # 4. Dividend Analysis (15%)
        dividend_result = self.dividend.analyze(ticker, analysis_date)
        dividend_score = dividend_result.dividend_score
        dividend_details = dividend_result.to_dict()
        
        # 5. Calculate Weighted Total Score
        total_score = (
            seasonality_score * self.weights['seasonality'] +
            fundamental_score * self.weights['fundamental'] +
            sector_score * self.weights['sector_relative'] +
            dividend_score * self.weights['dividend']
        )
        
        # 6. Calculate Confidence
        confidence = self._calculate_confidence(
            seasonality_result,
            fundamental_result,
            sector_result,
            dividend_result
        )
        
        # Filter low confidence signals
        if confidence < MIN_CONFIDENCE:
            return None
        
        # 7. Determine Signal
        signal = self._get_signal(total_score)
        signal_ar = self._get_signal_arabic(signal)
        
        # 8. Collect Recommendations and Warnings
        recommendations = []
        warnings = []
        
        recommendations.extend(seasonality_result.recommendations)
        warnings.extend(seasonality_result.warnings)
        
        if fundamental_result.strengths:
            recommendations.extend([f"✅ {s}" for s in fundamental_result.strengths[:2]])
        if fundamental_result.weaknesses:
            warnings.extend([f"⚠️ {w}" for w in fundamental_result.weaknesses[:2]])
        
        if dividend_result.recommendation:
            recommendations.append(dividend_result.recommendation)
        
        # 9. Calculate Risk
        risk_level, position_pct = self._calculate_risk(
            total_score,
            fundamental_score,
            seasonality_score
        )
        
        return ConfluenceSignal(
            ticker=ticker,
            signal=signal,
            signal_ar=signal_ar,
            confidence=round(confidence, 2),
            total_score=round(total_score, 1),
            seasonality_score=round(seasonality_score, 1),
            fundamental_score=round(fundamental_score, 1),
            sector_score=round(sector_score, 1),
            dividend_score=round(dividend_score, 1),
            weights=self.weights,
            seasonality_details=seasonality_details,
            fundamental_details=fundamental_details,
            sector_details=sector_details,
            dividend_details=dividend_details,
            recommendations=recommendations[:5],
            warnings=warnings[:3],
            risk_level=risk_level,
            suggested_position_pct=position_pct,
            timestamp=datetime.now().isoformat()
        )
    
    def _normalize_score(self, score: float) -> float:
        """Normalize score from -100/100 to 0/100."""
        return (score + 100) / 2
    
    def _calculate_confidence(
        self,
        seasonality: SeasonalityScore,
        fundamental: FundamentalScore,
        sector: SectorRelativeScore,
        dividend: DividendScore
    ) -> float:
        """Calculate overall confidence."""
        # Weighted confidence
        confidence = (
            seasonality.confidence * self.weights['seasonality'] +
            fundamental.confidence * self.weights['fundamental'] +
            sector.confidence * self.weights['sector_relative'] +
            dividend.confidence * self.weights['dividend']
        )
        
        # Boost if multiple signals align
        scores = [
            seasonality.total_score,
            fundamental.total_score,
            sector.relative_score,
            dividend.dividend_score
        ]
        
        positive = sum(1 for s in scores if s > 55)
        negative = sum(1 for s in scores if s < 45)
        
        if positive >= 3:
            confidence += 0.10
        elif negative >= 3:
            confidence += 0.10
        
        return min(0.95, confidence)
    
    def _get_signal(self, score: float) -> str:
        """Convert score to signal."""
        if score >= 70:
            return 'STRONG_BUY'
        elif score >= 60:
            return 'BUY'
        elif score >= 55:
            return 'ACCUMULATE'
        elif score >= 45:
            return 'HOLD'
        elif score >= 35:
            return 'REDUCE'
        elif score >= 25:
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
    
    def _calculate_risk(
        self,
        total_score: float,
        fundamental_score: float,
        seasonality_score: float
    ) -> Tuple[str, float]:
        """Calculate risk level and position size."""
        # Base position on score strength
        if total_score >= 65:
            position_pct = 5.0
            risk = "LOW"
        elif total_score >= 55:
            position_pct = 3.0
            risk = "MEDIUM"
        else:
            position_pct = 1.0
            risk = "HIGH"
        
        # Adjust for fundamental quality
        if fundamental_score < 40:
            position_pct *= 0.5
            risk = "HIGH"
        
        # Adjust for negative seasonality
        if seasonality_score < 40:
            position_pct *= 0.5
            risk = "HIGH"
        
        return risk, round(position_pct, 1)
    
    def scan_market(self, tickers: List[str] = None, limit: int = 20) -> List[ConfluenceSignal]:
        """
        Scan market for best opportunities.
        
        Args:
            tickers: List of tickers to scan (default: all available)
            limit: Maximum results to return
            
        Returns:
            List of ConfluenceSignal sorted by score
        """
        if tickers is None:
            tickers = self._get_all_tickers()
        
        results = []
        
        for ticker in tickers:
            try:
                signal = self.analyze(ticker)
                if signal and signal.signal not in ['HOLD', 'STRONG_SELL']:
                    results.append(signal)
            except Exception as e:
                continue
        
        # Sort by total score descending
        results.sort(key=lambda x: x.total_score, reverse=True)
        
        return results[:limit]
    
    def _get_all_tickers(self) -> List[str]:
        """Get all tickers from database."""
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(self.db_path, writable=False).__enter__()
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT ticker FROM stocks 
                WHERE is_active = 1 OR is_active IS NULL
                ORDER BY ticker
            ''')
            
            tickers = [row[0] for row in cursor.fetchall()]
            conn.close()
            return tickers
        except:
            return []


# ============================================================================
# PAPER TRADING INTEGRATION
# ============================================================================

class PaperTradingV2:
    """
    Paper Trading for Seasonality-First Engine.
    """
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path or _DEFAULT_STOCKS_DB
        self.engine = SeasonalityFirstEngine(db_path or _DEFAULT_STOCKS_DB)
        self._ensure_table()
    
    def _ensure_table(self):
        """Ensure paper_trades_seasonality table exists."""
        try:
            # Phase 7.1: migrated to db_manager (writable=True)
            from core.db_manager import db_manager
            conn = db_manager.connection(self.db_path, writable=True).__enter__()
            cursor = conn.cursor()
            
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS paper_trades_seasonality (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    ticker TEXT NOT NULL,
                    signal TEXT NOT NULL,
                    confidence REAL,
                    total_score REAL,
                    seasonality_score REAL,
                    fundamental_score REAL,
                    sector_score REAL,
                    dividend_score REAL,
                    entry_price REAL,
                    entry_date TEXT,
                    exit_price REAL,
                    exit_date TEXT,
                    return_pct REAL,
                    correct INTEGER,
                    status TEXT DEFAULT 'OPEN',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            
            conn.commit()
            conn.close()
        except Exception as e:
            print(f"Error creating table: {e}")
    
    def record_signal(self, signal: ConfluenceSignal, entry_price: float):
        """Record a signal to paper trading."""
        try:
            # Phase 7.1: migrated to db_manager (writable=True)
            from core.db_manager import db_manager
            conn = db_manager.connection(self.db_path, writable=True).__enter__()
            cursor = conn.cursor()
            
            cursor.execute('''
                INSERT INTO paper_trades_seasonality (
                    ticker, signal, confidence, total_score,
                    seasonality_score, fundamental_score, sector_score, dividend_score,
                    entry_price, entry_date
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                signal.ticker,
                signal.signal,
                signal.confidence,
                signal.total_score,
                signal.seasonality_score,
                signal.fundamental_score,
                signal.sector_score,
                signal.dividend_score,
                entry_price,
                datetime.now().strftime('%Y-%m-%d')
            ))
            
            conn.commit()
            conn.close()
            return True
        except Exception as e:
            print(f"Error recording: {e}")
            return False
    
    def get_stats(self) -> Dict:
        """Get paper trading statistics."""
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(self.db_path, writable=False).__enter__()
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT 
                    COUNT(*) as total,
                    SUM(CASE WHEN correct = 1 THEN 1 ELSE 0 END) as correct,
                    AVG(return_pct) as avg_return
                FROM paper_trades_seasonality
                WHERE status = 'CLOSED'
            ''')
            
            row = cursor.fetchone()
            conn.close()
            
            if row and row[0] > 0:
                return {
                    'total_trades': row[0],
                    'correct': row[1],
                    'accuracy': round(row[1] / row[0] * 100, 1) if row[0] > 0 else 0,
                    'avg_return': round(row[2], 2) if row[2] else 0
                }
            
            return {'total_trades': 0, 'accuracy': 0}
        except:
            return {'total_trades': 0, 'accuracy': 0}


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    print("=" * 70)
    print("SEASONALITY-FIRST CONFLUENCE ENGINE")
    print("=" * 70)
    print("NO Technical Indicators - EGX Validated Patterns Only")
    print()
    
    engine = SeasonalityFirstEngine()
    
    # Test with multiple stocks
    print("ANALYZING EGX STOCKS...")
    print("-" * 70)
    
    test_tickers = ['COMI', 'ETEL', 'SWDY', 'HRHO', 'TMGH', 'ABUK', 'CIEB']
    
    for ticker in test_tickers:
        result = engine.analyze(ticker)
        
        if result:
            print(f"\n{ticker}: {result.signal} ({result.signal_ar})")
            print(f"  Total Score: {result.total_score}")
            print(f"  Confidence: {result.confidence:.0%}")
            print(f"  Seasonality: {result.seasonality_score} | Fundamental: {result.fundamental_score}")
            print(f"  Sector: {result.sector_score} | Dividend: {result.dividend_score}")
            print(f"  Risk: {result.risk_level} | Position: {result.suggested_position_pct}%")
            
            if result.warnings:
                print(f"  ⚠️  {result.warnings[0]}")
            if result.recommendations:
                print(f"  💡 {result.recommendations[0]}")
    
    # Scan for best opportunities
    print("\n" + "=" * 70)
    print("TOP OPPORTUNITIES (Market Scan)")
    print("=" * 70)
    
    top_signals = engine.scan_market(limit=10)
    
    for i, sig in enumerate(top_signals, 1):
        print(f"{i}. {sig.ticker}: {sig.signal} ({sig.total_score})")
    
    # Show weights
    print("\n" + "=" * 70)
    print("WEIGHTS CONFIGURATION")
    print("=" * 70)
    for component, weight in WEIGHTS.items():
        print(f"  {component:20s}: {weight:.0%}")
