"""
Dividend Checker for EGX
========================
فاحص توزيعات الأرباح

Based on DividendCalendar table with 50 EGX dividend records.

Key insights:
- Price drops ~2-5% on ex-dividend date
- Recovery takes ~10-15 days
- Avoid buying 5 days before ex-dividend
- Good entry 10-12 days after ex-dividend

Author: دليل الاستثمار
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
import sqlite3
from datetime import datetime, date, timedelta
from pathlib import Path as _P

# Relative project root
_PROJECT_ROOT = _P(__file__).resolve().parent.parent.parent
_DEFAULT_STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class DividendInfo:
    """Dividend information."""
    ticker: str
    ex_dividend_date: str
    dividend_amount: float
    dividend_yield: float
    days_to_ex: int               # Days until ex-dividend
    status: str                   # APPROACHING, PASSED, NONE


@dataclass
class DividendScore:
    """Dividend analysis result."""
    ticker: str
    
    # Current dividend status
    has_upcoming_dividend: bool
    days_to_ex_dividend: int
    
    # Timing recommendation
    timing_signal: str            # AVOID, WAIT, GOOD_ENTRY, NEUTRAL
    expected_price_drop: float    # %
    expected_recovery_days: int
    
    # Score
    dividend_score: float         # 0-100
    signal: str
    confidence: float
    
    # Details
    recommendation: str
    
    def to_dict(self) -> Dict:
        return {
            'ticker': self.ticker,
            'has_upcoming_dividend': self.has_upcoming_dividend,
            'days_to_ex_dividend': self.days_to_ex_dividend,
            'timing_signal': self.timing_signal,
            'expected_price_drop': round(self.expected_price_drop, 2),
            'expected_recovery_days': self.expected_recovery_days,
            'dividend_score': round(self.dividend_score, 1),
            'signal': self.signal,
            'confidence': round(self.confidence, 2),
            'recommendation': self.recommendation,
        }


# ============================================================================
# DIVIDEND CHECKER
# ============================================================================

class DividendChecker:
    """
    فاحص توزيعات الأرباح
    
    Usage:
        checker = DividendChecker()
        result = checker.analyze('COMI')
    """
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path or _DEFAULT_STOCKS_DB
        
        # Known dividend behavior for EGX stocks
        self.dividend_stocks = {
            'COMI': {'avg_yield': 4.5, 'frequency': 'annual'},
            'ETEL': {'avg_yield': 5.2, 'frequency': 'annual'},
            'SWDY': {'avg_yield': 2.8, 'frequency': 'annual'},
            'HRHO': {'avg_yield': 3.5, 'frequency': 'annual'},
            'TMGH': {'avg_yield': 2.0, 'frequency': 'annual'},
            'ABUK': {'avg_yield': 3.8, 'frequency': 'annual'},
            'CIEB': {'avg_yield': 4.0, 'frequency': 'annual'},
            'AMOC': {'avg_yield': 5.5, 'frequency': 'annual'},
        }
    
    def analyze(
        self, 
        ticker: str, 
        analysis_date: date = None
    ) -> DividendScore:
        """
        Analyze dividend timing for a stock.
        
        Args:
            ticker: Stock symbol
            analysis_date: Date to analyze (default: today)
            
        Returns:
            DividendScore
        """
        if analysis_date is None:
            analysis_date = date.today()
        
        if isinstance(analysis_date, datetime):
            analysis_date = analysis_date.date()
        
        # Get upcoming dividend
        upcoming = self._get_upcoming_dividend(ticker, analysis_date)
        
        # Check past dividend for recovery timing
        past = self._get_recent_dividend(ticker, analysis_date)
        
        # Calculate timing
        if upcoming:
            days_to_ex = upcoming['days_to_ex']
            has_dividend = True
            
            # Determine timing signal
            if days_to_ex <= 5:
                timing_signal = 'AVOID'
                recommendation = f"⚠️ تجنب الشراء - توزيع بعد {days_to_ex} يوم. السعر هينزل ~{upcoming.get('expected_drop', 3):.1f}%"
                score = 30
            elif days_to_ex <= 10:
                timing_signal = 'WAIT'
                recommendation = f"⏳ استنى {days_to_ex} يوم للتوزيع، أدخل بعده بـ 10 أيام"
                score = 40
            else:
                timing_signal = 'NEUTRAL'
                recommendation = f"📅 توزيع قريب بعد {days_to_ex} يوم"
                score = 50
        else:
            has_dividend = False
            days_to_ex = 999
            
            # Check if recently passed dividend
            if past and past.get('days_since', 999) <= 15:
                days_since = past['days_since']
                if days_since >= 10:
                    timing_signal = 'GOOD_ENTRY'
                    recommendation = f"✅ وقت ممتاز للدخول - مر {days_since} يوم على التوزيع"
                    score = 70
                else:
                    timing_signal = 'WAIT'
                    recommendation = f"⏳ استنى {10 - days_since} يوم للارتداد"
                    score = 50
            else:
                timing_signal = 'NEUTRAL'
                recommendation = "لا يوجد توزيعات قريبة"
                score = 50
        
        # Get dividend info
        div_info = self.dividend_stocks.get(ticker, {})
        
        # Calculate expected values
        expected_drop = div_info.get('avg_yield', 3) * 0.8  # ~80% of yield drops
        recovery_days = 10  # Average recovery
        
        # Determine signal
        signal = self._get_signal(score)
        
        # Calculate confidence
        confidence = 0.7 if ticker in self.dividend_stocks else 0.5
        
        return DividendScore(
            ticker=ticker,
            has_upcoming_dividend=has_dividend,
            days_to_ex_dividend=days_to_ex if has_dividend else -1,
            timing_signal=timing_signal,
            expected_price_drop=expected_drop,
            expected_recovery_days=recovery_days,
            dividend_score=score,
            signal=signal,
            confidence=confidence,
            recommendation=recommendation
        )
    
    def _get_upcoming_dividend(
        self, 
        ticker: str, 
        current_date: date
    ) -> Optional[Dict]:
        """Get upcoming dividend for a stock."""
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(self.db_path, writable=False)
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT ex_dividend_date, dividend_amount, dividend_yield_pct
                FROM DividendCalendar
                WHERE ticker = ?
                AND date(ex_dividend_date) >= date(?)
                ORDER BY ex_dividend_date ASC
                LIMIT 1
            ''', (ticker, current_date.isoformat()))
            
            row = cursor.fetchone()
            conn.close()
            
            if row:
                ex_date = datetime.strptime(row[0], '%Y-%m-%d').date()
                days_to_ex = (ex_date - current_date).days
                
                return {
                    'ex_dividend_date': row[0],
                    'dividend_amount': row[1],
                    'dividend_yield': row[2],
                    'days_to_ex': days_to_ex,
                    'expected_drop': (row[2] or 3) * 0.8,
                }
        except Exception as e:
            pass
        
        return None
    
    def _get_recent_dividend(
        self, 
        ticker: str, 
        current_date: date
    ) -> Optional[Dict]:
        """Get most recent past dividend."""
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(self.db_path, writable=False)
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT ex_dividend_date, dividend_amount
                FROM DividendCalendar
                WHERE ticker = ?
                AND date(ex_dividend_date) < date(?)
                ORDER BY ex_dividend_date DESC
                LIMIT 1
            ''', (ticker, current_date.isoformat()))
            
            row = cursor.fetchone()
            conn.close()
            
            if row:
                ex_date = datetime.strptime(row[0], '%Y-%m-%d').date()
                days_since = (current_date - ex_date).days
                
                return {
                    'ex_dividend_date': row[0],
                    'dividend_amount': row[1],
                    'days_since': days_since,
                }
        except:
            pass
        
        return None
    
    def _get_signal(self, score: float) -> str:
        """Convert score to signal."""
        if score >= 65:
            return 'BUY'
        elif score >= 50:
            return 'HOLD'
        elif score >= 35:
            return 'WAIT'
        else:
            return 'AVOID'
    
    def get_upcoming_dividends(self, days: int = 30) -> List[Dict]:
        """Get all upcoming dividends in next N days."""
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(self.db_path, writable=False)
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT ticker, ex_dividend_date, dividend_amount, dividend_yield_pct
                FROM DividendCalendar
                WHERE date(ex_dividend_date) >= date('now')
                AND date(ex_dividend_date) <= date('now', '+' || ? || ' days')
                ORDER BY ex_dividend_date ASC
            ''', (str(days),))
            
            rows = cursor.fetchall()
            conn.close()
            
            results = []
            for row in rows:
                results.append({
                    'ticker': row[0],
                    'ex_dividend_date': row[1],
                    'dividend_amount': row[2],
                    'dividend_yield': row[3],
                })
            
            return results
        except:
            return []


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    checker = DividendChecker()
    
    print("=" * 60)
    print("DIVIDEND CHECKER")
    print("=" * 60)
    
    for ticker in ['COMI', 'ETEL', 'SWDY', 'TMGH']:
        result = checker.analyze(ticker)
        print(f"\n{ticker}:")
        print(f"  Upcoming: {result.has_upcoming_dividend}")
        print(f"  Timing: {result.timing_signal}")
        print(f"  Score: {result.dividend_score}")
        print(f"  Recommendation: {result.recommendation}")
    
    # Get upcoming dividends
    print("\n" + "=" * 60)
    print("UPCOMING DIVIDENDS (30 days)")
    print("=" * 60)
    upcoming = checker.get_upcoming_dividends(30)
    for div in upcoming[:5]:
        print(f"  {div['ticker']}: {div['ex_dividend_date']} - {div.get('dividend_yield', 0):.1f}%")
