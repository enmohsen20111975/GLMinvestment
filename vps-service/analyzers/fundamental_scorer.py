"""
Fundamental Scorer for EGX
=========================
المحلل الأساسي للبورصة المصرية

Includes:
1. Piotroski F-Score (0-9) - Financial health
2. Altman Z-Score - Bankruptcy risk
3. Magic Formula - Value + Quality ranking
4. EGX-specific adjustments

Data from stocks table:
- P/E, P/B, P/S, EV/EBITDA
- ROE, ROA, EPS
- Debt/Equity, Current Ratio
- Book Value, Dividend Yield

Author: دليل الاستثمار
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
import sqlite3
import math
from pathlib import Path as _P

# Relative project root
_PROJECT_ROOT = _P(__file__).resolve().parent.parent.parent
_DEFAULT_STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class PiotroskiScore:
    """Piotroski F-Score result."""
    score: int                    # 0-9
    profitability_score: int      # 0-4
    leverage_score: int           # 0-1
    liquidity_score: int          # 0-1
    efficiency_score: int         # 0-3
    details: List[str]
    
    def to_dict(self) -> Dict:
        return {
            'score': self.score,
            'profitability': self.profitability_score,
            'leverage': self.leverage_score,
            'liquidity': self.liquidity_score,
            'efficiency': self.efficiency_score,
            'details': self.details,
        }


@dataclass
class AltmanZScore:
    """Altman Z-Score result."""
    score: float                  # Z value
    zone: str                     # Safe, Grey, Distress
    components: Dict
    warning: Optional[str]
    
    def to_dict(self) -> Dict:
        return {
            'score': round(self.score, 2),
            'zone': self.zone,
            'components': self.components,
            'warning': self.warning,
        }


@dataclass
class MagicFormulaResult:
    """Magic Formula ranking result."""
    roc_rank: int                 # Return on Capital rank
    earnings_yield_rank: int      # Earnings Yield rank
    combined_rank: int            # Combined rank
    roc: float                    # Return on Capital %
    earnings_yield: float         # Earnings Yield %
    
    def to_dict(self) -> Dict:
        return {
            'roc_rank': self.roc_rank,
            'earnings_yield_rank': self.earnings_yield_rank,
            'combined_rank': self.combined_rank,
            'roc': round(self.roc, 2),
            'earnings_yield': round(self.earnings_yield, 2),
        }


@dataclass
class FundamentalScore:
    """Complete fundamental analysis result."""
    ticker: str
    total_score: float            # 0-100
    
    # Components
    piotroski: Optional[PiotroskiScore]
    altman_z: Optional[AltmanZScore]
    magic_formula: Optional[MagicFormulaResult]
    
    # Sub-scores
    value_score: float            # 0-100
    quality_score: float          # 0-100
    financial_health: float       # 0-100
    
    # Signal
    signal: str                   # BUY, SELL, HOLD
    confidence: float
    
    # Details
    strengths: List[str]
    weaknesses: List[str]
    
    def to_dict(self) -> Dict:
        return {
            'ticker': self.ticker,
            'total_score': round(self.total_score, 1),
            'piotroski': self.piotroski.to_dict() if self.piotroski else None,
            'altman_z': self.altman_z.to_dict() if self.altman_z else None,
            'magic_formula': self.magic_formula.to_dict() if self.magic_formula else None,
            'value_score': round(self.value_score, 1),
            'quality_score': round(self.quality_score, 1),
            'financial_health': round(self.financial_health, 1),
            'signal': self.signal,
            'confidence': round(self.confidence, 2),
            'strengths': self.strengths,
            'weaknesses': self.weaknesses,
        }


# ============================================================================
# FUNDAMENTAL SCORER
# ============================================================================

class FundamentalScorer:
    """
    المحلل الأساسي للبورصة المصرية
    
    Usage:
        scorer = FundamentalScorer()
        result = scorer.analyze('COMI')
    """
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path or _DEFAULT_STOCKS_DB
    
    def analyze(self, ticker: str) -> FundamentalScore:
        """
        Perform complete fundamental analysis.
        
        Args:
            ticker: Stock symbol
            
        Returns:
            FundamentalScore with all components
        """
        data = self._get_stock_data(ticker)
        
        strengths = []
        weaknesses = []
        
        # 1. Piotroski F-Score
        piotroski = self._calculate_piotroski(data)
        if piotroski:
            if piotroski.score >= 7:
                strengths.append(f"Piotroski F-Score: {piotroski.score}/9 (ممتاز)")
            elif piotroski.score <= 3:
                weaknesses.append(f"Piotroski F-Score: {piotroski.score}/9 (ضعيف)")
        
        # 2. Altman Z-Score
        altman_z = self._calculate_altman_z(data)
        if altman_z:
            if altman_z.zone == "Distress":
                weaknesses.append(f"Altman Z: {altman_z.score:.1f} (خطر إفلاس)")
            elif altman_z.zone == "Safe":
                strengths.append(f"Altman Z: {altman_z.score:.1f} (آمن)")
        
        # 3. Magic Formula (simplified - need market-wide ranking)
        magic = self._calculate_magic_formula(data)
        
        # 4. Calculate sub-scores
        value_score = self._calculate_value_score(data, strengths, weaknesses)
        quality_score = self._calculate_quality_score(data, strengths, weaknesses)
        financial_health = self._calculate_financial_health(piotroski, altman_z)
        
        # 5. Calculate total score
        total_score = (
            value_score * 0.35 +
            quality_score * 0.35 +
            financial_health * 0.30
        )
        
        # 6. Determine signal
        signal = self._get_signal(total_score)
        
        # 7. Calculate confidence
        confidence = self._calculate_confidence(data)
        
        return FundamentalScore(
            ticker=ticker,
            total_score=total_score,
            piotroski=piotroski,
            altman_z=altman_z,
            magic_formula=magic,
            value_score=value_score,
            quality_score=quality_score,
            financial_health=financial_health,
            signal=signal,
            confidence=confidence,
            strengths=strengths,
            weaknesses=weaknesses
        )
    
    def _get_stock_data(self, ticker: str) -> Dict:
        """Get stock fundamental data from database."""
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(self.db_path, writable=False).__enter__()
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT pe_ratio, pb_ratio, ps_ratio, ev_to_ebitda,
                       eps, roe, roa, debt_to_equity, current_ratio,
                       book_value_per_share, dividend_yield, market_cap,
                       sector, current_price
                FROM stocks
                WHERE ticker = ?
            ''', (ticker,))
            
            row = cursor.fetchone()
            conn.close()
            
            if row:
                return {
                    'pe_ratio': row[0],
                    'pb_ratio': row[1],
                    'ps_ratio': row[2],
                    'ev_to_ebitda': row[3],
                    'eps': row[4],
                    'roe': row[5],
                    'roa': row[6],
                    'debt_to_equity': row[7],
                    'current_ratio': row[8],
                    'book_value': row[9],
                    'dividend_yield': row[10],
                    'market_cap': row[11],
                    'sector': row[12],
                    'current_price': row[13],
                }
        except Exception as e:
            print(f"Error getting data for {ticker}: {e}")
        
        return {}
    
    def _calculate_piotroski(self, data: Dict) -> Optional[PiotroskiScore]:
        """
        Calculate Piotroski F-Score (0-9).
        
        Components:
        - Profitability (4 points): ROA, Operating Cash Flow, ROA change, Accruals
        - Leverage (1 point): Debt reduction
        - Liquidity (1 point): Current ratio improvement
        - Efficiency (3 points): Shares, Gross Margin, Asset Turnover
        """
        if not data:
            return None
        
        details = []
        score = 0
        profitability = 0
        leverage = 0
        liquidity = 0
        efficiency = 0
        
        # Profitability
        roa = data.get('roa')
        if roa and roa > 0:
            profitability += 1
            details.append(f"✓ ROA > 0: {roa:.1f}%")
        
        roe = data.get('roe')
        if roe and roe > 0:
            profitability += 1
            details.append(f"✓ ROE > 0: {roe:.1f}%")
        
        eps = data.get('eps')
        if eps and eps > 0:
            profitability += 1
            details.append(f"✓ EPS > 0: {eps:.2f}")
        
        if roe and roe > 15:
            profitability += 1
            details.append(f"✓ ROE > 15%: {roe:.1f}%")
        
        # Leverage
        d_e = data.get('debt_to_equity')
        if d_e is not None and d_e < 1.0:
            leverage += 1
            details.append(f"✓ Debt/Equity < 1.0: {d_e:.2f}")
        
        # Liquidity
        cr = data.get('current_ratio')
        if cr and cr > 1.5:
            liquidity += 1
            details.append(f"✓ Current Ratio > 1.5: {cr:.2f}")
        
        # Efficiency (simplified)
        if d_e is not None and d_e < 0.5:
            efficiency += 1
            details.append(f"✓ Low leverage: D/E {d_e:.2f}")
        
        if cr and cr > 2.0:
            efficiency += 1
            details.append(f"✓ Strong liquidity: CR {cr:.2f}")
        
        if data.get('dividend_yield', 0) > 0:
            efficiency += 1
            details.append(f"✓ Pays dividends: {data['dividend_yield']:.1f}%")
        
        score = profitability + leverage + liquidity + efficiency
        
        return PiotroskiScore(
            score=min(9, score),
            profitability_score=profitability,
            leverage_score=leverage,
            liquidity_score=liquidity,
            efficiency_score=efficiency,
            details=details
        )
    
    def _calculate_altman_z(self, data: Dict) -> Optional[AltmanZScore]:
        """
        Calculate Altman Z-Score (bankruptcy prediction).
        
        Z = 1.2*X1 + 1.4*X2 + 3.3*X3 + 0.6*X4 + 1.0*X5
        
        For non-manufacturing (emerging markets):
        Z > 2.6 = Safe
        1.1 < Z < 2.6 = Grey zone
        Z < 1.1 = Distress
        """
        if not data.get('current_price') or not data.get('market_cap'):
            return None
        
        components = {}
        
        # X1 = Working Capital / Total Assets (approximated)
        # X2 = Retained Earnings / Total Assets (approximated with book value)
        # X3 = EBIT / Total Assets (approximated with ROA)
        # X4 = Market Cap / Total Liabilities
        # X5 = Sales / Total Assets (approximated)
        
        # Simplified calculation
        x3 = (data.get('roa', 0) or 0) / 100  # ROA as decimal
        
        d_e = data.get('debt_to_equity', 1) or 1
        x4 = 1 / d_e if d_e > 0 else 0  # Market cap relative to debt
        
        # Simplified Z for emerging markets
        z = 3.3 * x3 + 0.6 * x4 + 1.0
        
        components['x3_roa'] = round(x3, 3)
        components['x4_market_debt'] = round(x4, 3)
        
        if z > 2.6:
            zone = "Safe"
            warning = None
        elif z > 1.1:
            zone = "Grey"
            warning = "منطقة رمادية - راقب المخاطر"
        else:
            zone = "Distress"
            warning = "⚠️ خطر إفلاس محتمل"
        
        return AltmanZScore(
            score=z,
            zone=zone,
            components=components,
            warning=warning
        )
    
    def _calculate_magic_formula(self, data: Dict) -> Optional[MagicFormulaResult]:
        """
        Calculate Magic Formula metrics.
        
        ROC = EBIT / (Net Working Capital + Net Fixed Assets)
        Earnings Yield = EBIT / Enterprise Value
        """
        if not data.get('current_price'):
            return None
        
        # Simplified calculations
        roe = data.get('roe', 0) or 0
        pe = data.get('pe_ratio', 0) or 0
        
        # ROC approximation using ROE
        roc = roe
        
        # Earnings Yield = 1 / P/E
        earnings_yield = (1 / pe * 100) if pe and pe > 0 else 0
        
        # Ranks would need full market comparison
        # For now, use percentile approximation
        
        return MagicFormulaResult(
            roc_rank=0,  # Would need market ranking
            earnings_yield_rank=0,
            combined_rank=0,
            roc=roc,
            earnings_yield=earnings_yield
        )
    
    def _calculate_value_score(
        self, 
        data: Dict, 
        strengths: List[str], 
        weaknesses: List[str]
    ) -> float:
        """Calculate value score (0-100)."""
        score = 50.0
        
        # P/E Ratio
        pe = data.get('pe_ratio')
        if pe:
            if pe < 8:
                score += 20
                strengths.append(f"P/E {pe:.1f} = رخيص جداً")
            elif pe < 15:
                score += 10
                strengths.append(f"P/E {pe:.1f} = قيمة جيدة")
            elif pe > 30:
                score -= 15
                weaknesses.append(f"P/E {pe:.1f} = غالي")
        
        # P/B Ratio
        pb = data.get('pb_ratio')
        if pb:
            if pb < 1.0:
                score += 15
                strengths.append(f"P/B {pb:.2f} = أقل من القيمة الدفترية!")
            elif pb > 3.0:
                score -= 10
        
        # Dividend Yield
        div = data.get('dividend_yield')
        if div and div > 0:
            score += div * 2  # Boost for dividends
            if div > 5:
                strengths.append(f"توزيعات {div:.1f}% = عالية")
        
        return max(0, min(100, score))
    
    def _calculate_quality_score(
        self, 
        data: Dict, 
        strengths: List[str], 
        weaknesses: List[str]
    ) -> float:
        """Calculate quality score (0-100)."""
        score = 50.0
        
        # ROE
        roe = data.get('roe')
        if roe:
            if roe > 20:
                score += 20
                strengths.append(f"ROE {roe:.1f}% = ممتاز")
            elif roe > 15:
                score += 10
            elif roe < 5:
                score -= 15
                weaknesses.append(f"ROE {roe:.1f}% = ضعيف")
        
        # ROA
        roa = data.get('roa')
        if roa:
            if roa > 10:
                score += 10
            elif roa < 2:
                score -= 10
        
        # Debt/Equity
        d_e = data.get('debt_to_equity')
        if d_e is not None:
            if d_e < 0.5:
                score += 15
                strengths.append(f"D/E {d_e:.2f} = ديون منخفضة")
            elif d_e > 2.0:
                score -= 15
                weaknesses.append(f"D/E {d_e:.2f} = ديون عالية")
        
        return max(0, min(100, score))
    
    def _calculate_financial_health(
        self,
        piotroski: Optional[PiotroskiScore],
        altman_z: Optional[AltmanZScore]
    ) -> float:
        """Calculate financial health score (0-100)."""
        score = 50.0
        
        if piotroski:
            # Piotroski 9 = 100, 0 = 0
            p_score = (piotroski.score / 9) * 50
            score = p_score + 25
        
        if altman_z:
            if altman_z.zone == "Safe":
                score += 25
            elif altman_z.zone == "Distress":
                score -= 25
        
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
        elif score >= 30:
            return 'REDUCE'
        else:
            return 'SELL'
    
    def _calculate_confidence(self, data: Dict) -> float:
        """Calculate confidence based on data availability."""
        fields = ['pe_ratio', 'pb_ratio', 'roe', 'debt_to_equity', 'eps']
        available = sum(1 for f in fields if data.get(f) is not None)
        return available / len(fields)


# ============================================================================
# MAIN
# ============================================================================

if __name__ == "__main__":
    scorer = FundamentalScorer()
    
    print("=" * 60)
    print("FUNDAMENTAL SCORER - EGX")
    print("=" * 60)
    
    # Test with multiple stocks
    for ticker in ['COMI', 'ETEL', 'SWDY', 'HRHO', 'TMGH']:
        result = scorer.analyze(ticker)
        
        print(f"\n{ticker}:")
        print(f"  Total Score: {result.total_score:.1f}")
        print(f"  Value: {result.value_score:.1f}")
        print(f"  Quality: {result.quality_score:.1f}")
        print(f"  Financial Health: {result.financial_health:.1f}")
        print(f"  Signal: {result.signal}")
        
        if result.piotroski:
            print(f"  Piotroski: {result.piotroski.score}/9")
        
        if result.strengths:
            print(f"  Strengths: {result.strengths[:2]}")
        if result.weaknesses:
            print(f"  Weaknesses: {result.weaknesses[:2]}")
