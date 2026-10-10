"""
Fundamental Analyzer
====================
Fundamental Analysis Engine for Stocks.

Features:
- P/E Ratio Analysis
- ROE (Return on Equity)
- EPS (Earnings Per Share)
- Profit Margins
- Debt Ratios
- Dividend Yield Analysis

Author: دليل الاستثمار
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict


@dataclass
class FundamentalMetrics:
    """Data class for fundamental metrics."""
    pe_ratio: Optional[float] = None
    pb_ratio: Optional[float] = None
    ps_ratio: Optional[float] = None
    roe: Optional[float] = None
    roa: Optional[float] = None
    eps: Optional[float] = None
    dividend_yield: Optional[float] = None
    profit_margin: Optional[float] = None
    debt_to_equity: Optional[float] = None
    current_ratio: Optional[float] = None
    quick_ratio: Optional[float] = None
    free_cash_flow: Optional[float] = None
    market_cap: Optional[float] = None
    book_value: Optional[float] = None
    
    def to_dict(self) -> Dict:
        return {k: v for k, v in asdict(self).items() if v is not None}


class FundamentalAnalyzer:
    """
    Fundamental Analysis Engine.
    
    Usage:
        analyzer = FundamentalAnalyzer()
        metrics = analyzer.analyze(stock_data)
        score, buy_reasons, sell_reasons = analyzer.get_fundamental_score(metrics)
    """
    
    def __init__(self):
        pass
    
    def analyze(self, stock_data: Dict) -> FundamentalMetrics:
        """
        Extract fundamental metrics from stock data.
        
        Args:
            stock_data: Dict containing stock fundamental data
            
        Returns:
            FundamentalMetrics dataclass
        """
        return FundamentalMetrics(
            pe_ratio=stock_data.get('pe_ratio'),
            pb_ratio=stock_data.get('pb_ratio'),
            ps_ratio=stock_data.get('ps_ratio'),
            roe=stock_data.get('roe'),
            roa=stock_data.get('roa'),
            eps=stock_data.get('eps'),
            dividend_yield=stock_data.get('dividend_yield'),
            profit_margin=stock_data.get('profit_margin'),
            debt_to_equity=stock_data.get('debt_to_equity'),
            current_ratio=stock_data.get('current_ratio'),
            quick_ratio=stock_data.get('quick_ratio'),
            free_cash_flow=stock_data.get('free_cash_flow'),
            market_cap=stock_data.get('market_cap'),
            book_value=stock_data.get('book_value_per_share')
        )
    
    def get_fundamental_score(self, metrics: FundamentalMetrics) -> Tuple[int, List[str], List[str]]:
        """
        Calculate fundamental score and reasons.
        
        Returns:
            Tuple of (score, buy_reasons, sell_reasons)
        """
        score = 0
        buy_reasons = []
        sell_reasons = []
        
        # P/E Ratio Analysis
        if metrics.pe_ratio:
            if metrics.pe_ratio < 10:
                score += 2
                buy_reasons.append(f"P/E منخفض ({metrics.pe_ratio:.1f}) - سهم رخيص")
            elif metrics.pe_ratio < 20:
                score += 1
                buy_reasons.append(f"P/E معقول ({metrics.pe_ratio:.1f})")
            elif metrics.pe_ratio > 40:
                score -= 1
                sell_reasons.append(f"P/E مرتفع ({metrics.pe_ratio:.1f}) - سهم غالي")
        
        # ROE Analysis
        if metrics.roe:
            if metrics.roe > 20:
                score += 2
                buy_reasons.append(f"ROE ممتاز ({metrics.roe:.1f}%)")
            elif metrics.roe > 10:
                score += 1
                buy_reasons.append(f"ROE جيد ({metrics.roe:.1f}%)")
            elif metrics.roe < 5:
                score -= 1
                sell_reasons.append(f"ROE منخفض ({metrics.roe:.1f}%)")
        
        # Dividend Yield
        if metrics.dividend_yield and metrics.dividend_yield > 0:
            if metrics.dividend_yield > 5:
                score += 1
                buy_reasons.append(f"عائد توزيعات عالي ({metrics.dividend_yield:.1f}%)")
            elif metrics.dividend_yield > 2:
                score += 1
                buy_reasons.append(f"عائد توزيعات جيد ({metrics.dividend_yield:.1f}%)")
        
        # Debt to Equity
        if metrics.debt_to_equity:
            if metrics.debt_to_equity < 0.5:
                score += 1
                buy_reasons.append("ديون منخفضة مقارنة بالحقوق")
            elif metrics.debt_to_equity > 2:
                score -= 1
                sell_reasons.append("ديون مرتفعة مقارنة بالحقوق")
        
        # Profit Margin
        if metrics.profit_margin:
            if metrics.profit_margin > 20:
                score += 1
                buy_reasons.append(f"هامش ربح عالي ({metrics.profit_margin:.1f}%)")
            elif metrics.profit_margin < 5:
                score -= 1
                sell_reasons.append(f"هامش ربح منخفض ({metrics.profit_margin:.1f}%)")
        
        return score, buy_reasons, sell_reasons
    
    def get_valuation_signal(self, pe_ratio: Optional[float], sector_avg_pe: float = 15) -> str:
        """Get valuation signal based on P/E ratio."""
        if not pe_ratio:
            return "UNKNOWN"
        
        if pe_ratio < sector_avg_pe * 0.7:
            return "UNDERVALUED"
        elif pe_ratio > sector_avg_pe * 1.3:
            return "OVERVALUED"
        return "FAIR_VALUE"
    
    def analyze_dividend(self, dividend_yield: Optional[float], payout_ratio: Optional[float] = None) -> Dict:
        """Analyze dividend sustainability."""
        if not dividend_yield or dividend_yield <= 0:
            return {
                'has_dividend': False,
                'sustainability': 'N/A',
                'signal': 'NO_DIVIDEND'
            }
        
        sustainability = "GOOD"
        if dividend_yield > 7:
            sustainability = "HIGH_RISK"  # Might be unsustainable
        elif dividend_yield > 5:
            sustainability = "EXCELLENT"
        
        return {
            'has_dividend': True,
            'yield': dividend_yield,
            'sustainability': sustainability,
            'signal': 'INCOME_STOCK' if dividend_yield > 3 else 'GROWTH_STOCK'
        }
