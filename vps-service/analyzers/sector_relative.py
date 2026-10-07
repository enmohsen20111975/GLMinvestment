"""
Sector Relative Analyzer for EGX
================================
محلل الأداء النسبي للقطاعات

Compares stock performance to:
1. Its sector average
2. EGX30 index
3. Sector momentum

Updated: 2025-01-29 - Using Official 18 Sectors from EGX
Author: دليل الاستثمار
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path as _Path
import sys

# Relative project root
_PROJECT_ROOT = _Path(__file__).resolve().parent.parent.parent
_DEFAULT_STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')

# Import official sectors
sys.path.insert(0, str(_Path(__file__).parent.parent))
from data.egx_official_sectors import EGX_OFFICIAL_SECTORS, STOCK_SECTORS


# ============================================================================
# SECTOR DEFINITIONS - OFFICIAL EGX (18 SECTORS)
# ============================================================================

# Official Arabic sector names
EGX_SECTORS_AR = list(EGX_OFFICIAL_SECTORS.keys())

# Sector weights based on market cap importance (estimated)
SECTOR_WEIGHTS = {
    'بنوك': 0.20,  # Banks - High importance
    'عقارات': 0.15,  # Real Estate
    'خدمات مالية غير مصرفية': 0.12,  # Non-banking Financial
    'اتصالات و اعلام و تكنولوجيا المعلومات': 0.10,  # Telecom & IT
    'موارد أساسية': 0.10,  # Basic Resources
    'أغذية و مشروبات و تبغ': 0.08,  # Food & Beverages
    'مواد البناء': 0.07,  # Building Materials
    'رعاية صحية و ادوية': 0.05,  # Healthcare
    'مقاولات و إنشاءات هندسية': 0.05,  # Construction
    'طاقة وخدمات مساندة': 0.03,  # Energy
    'سياحة وترفيه': 0.02,  # Tourism
    'منسوجات و سلع معمرة': 0.01,  # Textiles
    'تجارة و موزعون': 0.01,  # Trade
    'خدمات و منتجات صناعية وسيارات': 0.01,  # Industrial Services
    'خدمات تعليمية': 0.005,  # Education
    'ورق ومواد تعبئة و تغليف': 0.005,  # Paper & Packaging
    'خدمات النقل والشحن': 0.005,  # Transport
    'مرافق': 0.005,  # Utilities
}


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class SectorRelativeScore:
    """Sector relative analysis result."""
    ticker: str
    sector: str
    
    # Relative to sector
    vs_sector_pe: float            # % difference from sector P/E
    vs_sector_roe: float           # % difference from sector ROE
    sector_rank: int               # Rank within sector
    
    # Sector momentum
    sector_momentum: str           # BULLISH, BEARISH, NEUTRAL
    sector_strength: float         # 0-100
    
    # Overall
    relative_score: float          # 0-100
    signal: str
    confidence: float
    
    def to_dict(self) -> Dict:
        return {
            'ticker': self.ticker,
            'sector': self.sector,
            'vs_sector_pe': round(self.vs_sector_pe, 1),
            'vs_sector_roe': round(self.vs_sector_roe, 1),
            'sector_rank': self.sector_rank,
            'sector_momentum': self.sector_momentum,
            'sector_strength': round(self.sector_strength, 1),
            'relative_score': round(self.relative_score, 1),
            'signal': self.signal,
            'confidence': round(self.confidence, 2),
        }


# ============================================================================
# SECTOR RELATIVE ANALYZER
# ============================================================================

class SectorRelativeAnalyzer:
    """
    محلل الأداء النسبي للقطاعات
    
    Usage:
        analyzer = SectorRelativeAnalyzer()
        result = analyzer.analyze('COMI')
    """
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path or _DEFAULT_STOCKS_DB
        self._build_sector_lookup()
    
    def _build_sector_lookup(self):
        """Build ticker to sector lookup from database."""
        self.ticker_to_sector = {}
        self.sector_tickers = {}  # sector -> [tickers]
        
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT ticker, sector 
                FROM stocks 
                WHERE is_active = 1 AND sector IS NOT NULL
            ''')
            
            for row in cursor.fetchall():
                ticker, sector = row[0], row[1]
                self.ticker_to_sector[ticker] = sector
                
                if sector not in self.sector_tickers:
                    self.sector_tickers[sector] = []
                self.sector_tickers[sector].append(ticker)
            
            conn.close()
            
        except Exception as e:
            print(f"Error building sector lookup: {e}")
    
    def get_all_sectors(self) -> List[str]:
        """Get list of all sectors."""
        return list(self.sector_tickers.keys())
    
    def get_stocks_in_sector(self, sector: str) -> List[str]:
        """Get all stocks in a sector."""
        return self.sector_tickers.get(sector, [])
    
    def analyze(self, ticker: str) -> SectorRelativeScore:
        """
        Analyze stock relative to its sector.
        
        Args:
            ticker: Stock symbol
            
        Returns:
            SectorRelativeScore
        """
        # Get stock data
        stock_data = self._get_stock_data(ticker)
        
        # Determine sector
        sector = self._get_sector(ticker, stock_data)
        
        # Get sector stats
        sector_stats = self._get_sector_stats(sector)
        
        # Calculate relative metrics
        vs_sector_pe = self._calc_vs_sector(
            stock_data.get('pe_ratio'),
            sector_stats.get('avg_pe')
        )
        
        vs_sector_roe = self._calc_vs_sector(
            stock_data.get('roe'),
            sector_stats.get('avg_roe')
        )
        
        # Calculate sector rank
        sector_rank = self._get_sector_rank(ticker, sector)
        
        # Determine sector momentum
        sector_momentum, sector_strength = self._get_sector_momentum(sector)
        
        # Calculate overall score
        relative_score = self._calculate_relative_score(
            vs_sector_pe, vs_sector_roe, sector_strength, sector_rank
        )
        
        # Determine signal
        signal = self._get_signal(relative_score)
        
        # Calculate confidence
        confidence = self._calculate_confidence(stock_data, sector_stats)
        
        return SectorRelativeScore(
            ticker=ticker,
            sector=sector,
            vs_sector_pe=vs_sector_pe,
            vs_sector_roe=vs_sector_roe,
            sector_rank=sector_rank,
            sector_momentum=sector_momentum,
            sector_strength=sector_strength,
            relative_score=relative_score,
            signal=signal,
            confidence=confidence
        )
    
    def _get_stock_data(self, ticker: str) -> Dict:
        """Get stock data from database."""
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT pe_ratio, roe, sector, current_price, previous_close
                FROM stocks
                WHERE ticker = ?
            ''', (ticker,))
            
            row = cursor.fetchone()
            conn.close()
            
            if row:
                return {
                    'pe_ratio': row[0],
                    'roe': row[1],
                    'sector': row[2],
                    'current_price': row[3],
                    'previous_close': row[4],
                }
        except:
            pass
        
        return {}
    
    def _get_sector(self, ticker: str, stock_data: Dict) -> str:
        """Get sector for a stock."""
        # First check DB
        if stock_data.get('sector'):
            return stock_data['sector']
        
        # Then check our lookup
        return self.ticker_to_sector.get(ticker, 'Unknown')
    
    def _get_sector_stats(self, sector: str) -> Dict:
        """Get average stats for a sector."""
        sector_tickers = self.sector_tickers.get(sector, [])
        
        if not sector_tickers:
            return {}
        
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            placeholders = ','.join(['?' for _ in sector_tickers])
            
            cursor.execute(f'''
                SELECT 
                    AVG(pe_ratio) as avg_pe,
                    AVG(roe) as avg_roe,
                    AVG(debt_to_equity) as avg_de,
                    COUNT(*) as count
                FROM stocks
                WHERE ticker IN ({placeholders})
                AND pe_ratio IS NOT NULL
            ''', sector_tickers)
            
            row = cursor.fetchone()
            conn.close()
            
            if row:
                return {
                    'avg_pe': row[0],
                    'avg_roe': row[1],
                    'avg_de': row[2],
                    'count': row[3],
                }
        except:
            pass
        
        return {}
    
    def _calc_vs_sector(self, value: Optional[float], sector_avg: Optional[float]) -> float:
        """Calculate percentage difference from sector average."""
        if value is None or sector_avg is None or sector_avg == 0:
            return 0
        
        return ((value - sector_avg) / sector_avg) * 100
    
    def _get_sector_rank(self, ticker: str, sector: str) -> int:
        """Get rank within sector (1 = best)."""
        sector_tickers = self.sector_tickers.get(sector, [])
        
        if not sector_tickers or ticker not in sector_tickers:
            return 0
        
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            placeholders = ','.join(['?' for _ in sector_tickers])
            
            # Rank by ROE (higher = better)
            cursor.execute(f'''
                SELECT ticker, roe
                FROM stocks
                WHERE ticker IN ({placeholders})
                AND roe IS NOT NULL
                ORDER BY roe DESC
            ''', sector_tickers)
            
            rows = cursor.fetchall()
            conn.close()
            
            for i, row in enumerate(rows):
                if row[0] == ticker:
                    return i + 1
            
        except:
            pass
        
        return 0
    
    def _get_sector_momentum(self, sector: str) -> Tuple[str, float]:
        """Determine sector momentum."""
        sector_tickers = self.sector_tickers.get(sector, [])
        
        if not sector_tickers:
            return 'NEUTRAL', 50
        
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            placeholders = ','.join(['?' for _ in sector_tickers])
            
            # Calculate average price change
            cursor.execute(f'''
                SELECT AVG(change_percent) as avg_change
                FROM stocks
                WHERE ticker IN ({placeholders})
            ''', sector_tickers)
            
            row = cursor.fetchone()
            conn.close()
            
            if row and row[0]:
                avg_change = row[0]
                
                if avg_change > 3:
                    return 'BULLISH', 70
                elif avg_change > 1:
                    return 'BULLISH', 60
                elif avg_change < -3:
                    return 'BEARISH', 30
                elif avg_change < -1:
                    return 'BEARISH', 40
        
        except:
            pass
        
        return 'NEUTRAL', 50
    
    def _calculate_relative_score(
        self,
        vs_pe: float,
        vs_roe: float,
        sector_strength: float,
        rank: int
    ) -> float:
        """Calculate overall relative score."""
        score = 50.0
        
        # Better P/E than sector (lower is better)
        if vs_pe < -20:
            score += 15  # Much cheaper
        elif vs_pe < -10:
            score += 10
        elif vs_pe > 20:
            score -= 10  # Much more expensive
        
        # Better ROE than sector
        if vs_roe > 20:
            score += 15
        elif vs_roe > 10:
            score += 10
        elif vs_roe < -20:
            score -= 10
        
        # Sector momentum
        if sector_strength > 60:
            score += 10
        elif sector_strength < 40:
            score -= 10
        
        # Rank
        if rank == 1:
            score += 15
        elif rank <= 3:
            score += 10
        elif rank >= 5:
            score -= 5
        
        return max(0, min(100, score))
    
    def _get_signal(self, score: float) -> str:
        """Convert score to signal."""
        if score >= 70:
            return 'STRONG_BUY'
        elif score >= 60:
            return 'BUY'
        elif score >= 50:
            return 'ACCUMULATE'
        elif score >= 40:
            return 'HOLD'
        else:
            return 'SELL'
    
    def _calculate_confidence(self, stock_data: Dict, sector_stats: Dict) -> float:
        """Calculate confidence based on data quality."""
        confidence = 0.5
        
        if stock_data.get('pe_ratio'):
            confidence += 0.15
        if stock_data.get('roe'):
            confidence += 0.15
        if sector_stats.get('avg_pe'):
            confidence += 0.10
        if sector_stats.get('count', 0) >= 3:
            confidence += 0.10
        
        return min(0.95, confidence)


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    analyzer = SectorRelativeAnalyzer()
    
    print("=" * 60)
    print("SECTOR RELATIVE ANALYZER")
    print("=" * 60)
    
    for ticker in ['COMI', 'ETEL', 'TMGH', 'SWDY']:
        result = analyzer.analyze(ticker)
        print(f"\n{ticker} ({result.sector}):")
        print(f"  vs Sector P/E: {result.vs_sector_pe:+.1f}%")
        print(f"  vs Sector ROE: {result.vs_sector_roe:+.1f}%")
        print(f"  Sector Rank: {result.sector_rank}")
        print(f"  Sector Momentum: {result.sector_momentum}")
        print(f"  Score: {result.relative_score:.1f}")
        print(f"  Signal: {result.signal}")
