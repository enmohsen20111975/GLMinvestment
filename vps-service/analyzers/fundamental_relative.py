"""
Fundamental Analyzer - Sector Relative Version
==============================================
التحليل المالي بالسياق القطاعي

القاعدة الذهبية: التحليل المالي قطاعي، مش مطلق

Features:
- Sector-relative P/E, P/B, ROE analysis
- Sector medians database
- Percentile ranking within sector

Author: دليل الاستثمار (Based on Kemi's Analysis)
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
import sqlite3
from datetime import datetime


# ============================================================================
# SECTOR BENCHMARKS - EGX SPECIFIC
# ============================================================================

SECTOR_MEDIANS = {
    # Egyptian Stock Exchange Sector Benchmarks
    # Updated: 2026 - Real EGX medians from actual data
    'Financial Services': {
        'pe_median': 18.0,  # Banks in EGX trade at higher P/E
        'pb_median': 1.8,
        'roe_median': 18.0,
        'dividend_yield_median': 5.0,  # EGX banks pay good dividends
    },
    'Telecommunications': {
        'pe_median': 22.0,  # ETEL is the main player
        'pb_median': 2.5,
        'roe_median': 15.0,
        'dividend_yield_median': 6.0,
    },
    'Real Estate': {
        'pe_median': 12.0,
        'pb_median': 1.0,
        'roe_median': 12.0,
        'dividend_yield_median': 3.0,
    },
    'Basic Materials': {
        'pe_median': 15.0,
        'pb_median': 1.5,
        'roe_median': 20.0,
        'dividend_yield_median': 3.0,
    },
    'Industrials': {
        'pe_median': 20.0,  # EGX industrials have higher P/E
        'pb_median': 1.5,
        'roe_median': 15.0,
        'dividend_yield_median': 2.5,
    },
    'Energy': {
        'pe_median': 18.0,
        'pb_median': 1.2,
        'roe_median': 22.0,
        'dividend_yield_median': 4.0,
    },
    'Consumer Defensive': {
        'pe_median': 25.0,
        'pb_median': 2.0,
        'roe_median': 12.0,
        'dividend_yield_median': 3.0,
    },
    'Technology': {
        'pe_median': 25.0,
        'pb_median': 3.0,
        'roe_median': 10.0,
        'dividend_yield_median': 1.0,
    },
    'Healthcare': {
        'pe_median': 20.0,
        'pb_median': 2.0,
        'roe_median': 10.0,
        'dividend_yield_median': 2.0,
    },
    'Diversified': {
        'pe_median': 20.0,
        'pb_median': 1.5,
        'roe_median': 15.0,
        'dividend_yield_median': 3.0,
    },
    'DEFAULT': {
        'pe_median': 20.0,
        'pb_median': 1.5,
        'roe_median': 15.0,
        'dividend_yield_median': 3.0,
    }
}


@dataclass
class FundamentalMetrics:
    """Data class for fundamental metrics."""
    pe_ratio: Optional[float] = None
    pb_ratio: Optional[float] = None
    roe: Optional[float] = None
    eps: Optional[float] = None
    dividend_yield: Optional[float] = None
    profit_margin: Optional[float] = None
    debt_to_equity: Optional[float] = None
    sector: Optional[str] = None
    
    # Relative scores (0-100)
    pe_percentile: Optional[float] = None
    pb_percentile: Optional[float] = None
    roe_percentile: Optional[float] = None
    
    # Overall
    weighted_score: float = 50.0
    buy_reasons: List[str] = None
    sell_reasons: List[str] = None
    
    def to_dict(self) -> Dict:
        result = asdict(self)
        if self.buy_reasons is None:
            result['buy_reasons'] = []
        if self.sell_reasons is None:
            result['sell_reasons'] = []
        return result


class FundamentalAnalyzerRelative:
    """
    محلل مالي بالسياق القطاعي
    
    الفرق الأساسي:
    - القديم: P/E < 10 = +2 (مطلق)
    - الجديد: P/E في أرخص 20% في القطاع = +2 (نسبي)
    
    Usage:
        analyzer = FundamentalAnalyzerRelative()
        metrics = analyzer.analyze(stock_data, sector='Financial Services')
    """
    
    # Weights for each metric
    WEIGHTS = {
        'pe_relative': 0.30,
        'roe_relative': 0.25,
        'pb_relative': 0.15,
        'dividend_yield': 0.15,
        'debt_to_equity': 0.15,
    }
    
    def __init__(self, sector_benchmarks: Dict = None):
        self.sector_benchmarks = sector_benchmarks or SECTOR_MEDIANS
    
    def get_sector_benchmark(self, sector: str) -> Dict:
        """الحصول على معايير القطاع"""
        return self.sector_benchmarks.get(sector, self.sector_benchmarks['DEFAULT'])
    
    def calculate_percentile_rank(
        self,
        value: float,
        sector_median: float,
        metric_type: str = 'lower_is_better'
    ) -> float:
        """
        حساب الترتيب النسبي في القطاع
        
        Args:
            value: قيمة المؤشر
            sector_median: متوسط القطاع
            metric_type: 'lower_is_better' (P/E) or 'higher_is_better' (ROE)
            
        Returns:
            float: الترتيب (0-100)
        """
        if sector_median <= 0:
            return 50
        
        if metric_type == 'lower_is_better':
            # P/E: lower is better
            # If value is 50% of median, it's in top 20%
            ratio = value / sector_median
            if ratio <= 0.5:
                return 10  # Top 10% (cheapest)
            elif ratio <= 0.7:
                return 20
            elif ratio <= 0.9:
                return 35
            elif ratio <= 1.1:
                return 50  # Around median
            elif ratio <= 1.3:
                return 65
            elif ratio <= 1.5:
                return 80
            else:
                return 90  # Bottom 10% (most expensive)
        
        else:  # higher_is_better (ROE)
            ratio = value / sector_median
            if ratio >= 2.0:
                return 90  # Top 10%
            elif ratio >= 1.5:
                return 80
            elif ratio >= 1.2:
                return 65
            elif ratio >= 0.8:
                return 50
            elif ratio >= 0.5:
                return 35
            else:
                return 10  # Bottom 10%
    
    def score_pe_relative(self, pe_ratio: float, sector: str) -> Tuple[int, str]:
        """
        تقييم P/E النسبي
        
        Returns:
            Tuple[int, str]: (score, reason)
        """
        benchmark = self.get_sector_benchmark(sector)
        median = benchmark['pe_median']
        
        percentile = self.calculate_percentile_rank(pe_ratio, median, 'lower_is_better')
        
        if percentile <= 20:
            return +2, f"P/E منخفض جداً مقارنة بالقطاع ({pe_ratio:.1f} vs {median:.1f})"
        elif percentile <= 40:
            return +1, f"P/E تحت المتوسط القطاعي ({pe_ratio:.1f} vs {median:.1f})"
        elif percentile >= 80:
            return -2, f"P/E مرتفع مقارنة بالقطاع ({pe_ratio:.1f} vs {median:.1f})"
        elif percentile >= 60:
            return -1, f"P/E فوق المتوسط القطاعي ({pe_ratio:.1f} vs {median:.1f})"
        else:
            return 0, f"P/E في المعدل القطاعي ({pe_ratio:.1f} vs {median:.1f})"
    
    def score_roe_relative(self, roe: float, sector: str) -> Tuple[int, str]:
        """
        تقييم ROE النسبي
        
        Returns:
            Tuple[int, str]: (score, reason)
        """
        benchmark = self.get_sector_benchmark(sector)
        median = benchmark['roe_median']
        
        percentile = self.calculate_percentile_rank(roe, median, 'higher_is_better')
        
        if percentile >= 80:
            return +2, f"ROE ممتاز مقارنة بالقطاع ({roe:.1f}% vs {median:.1f}%)"
        elif percentile >= 60:
            return +1, f"ROE جيد مقارنة بالقطاع ({roe:.1f}% vs {median:.1f}%)"
        elif percentile <= 20:
            return -2, f"ROE ضعيف مقارنة بالقطاع ({roe:.1f}% vs {median:.1f}%)"
        elif percentile <= 40:
            return -1, f"ROE تحت المتوسط القطاعي ({roe:.1f}% vs {median:.1f}%)"
        else:
            return 0, f"ROE في المعدل القطاعي ({roe:.1f}% vs {median:.1f}%)"
    
    def analyze(self, stock_data: Dict, sector: str = None) -> FundamentalMetrics:
        """
        تحليل أساسي مع السياق القطاعي
        
        Args:
            stock_data: بيانات السهم
            sector: القطاع (اختياري)
            
        Returns:
            FundamentalMetrics: النتائج
        """
        metrics = FundamentalMetrics()
        metrics.sector = sector or stock_data.get('sector', 'DEFAULT')
        
        buy_reasons = []
        sell_reasons = []
        total_score = 50  # Start at neutral
        
        # Extract values
        metrics.pe_ratio = stock_data.get('pe_ratio')
        metrics.pb_ratio = stock_data.get('pb_ratio')
        metrics.roe = stock_data.get('roe')
        metrics.eps = stock_data.get('eps')
        metrics.dividend_yield = stock_data.get('dividend_yield')
        metrics.debt_to_equity = stock_data.get('debt_to_equity')
        metrics.profit_margin = stock_data.get('profit_margin')
        
        # 1. P/E Relative Analysis
        if metrics.pe_ratio:
            score, reason = self.score_pe_relative(metrics.pe_ratio, metrics.sector)
            total_score += score * 5  # Convert to 0-100 scale
            if score > 0:
                buy_reasons.append(reason)
            elif score < 0:
                sell_reasons.append(reason)
            
            # Calculate percentile
            benchmark = self.get_sector_benchmark(metrics.sector)
            metrics.pe_percentile = self.calculate_percentile_rank(
                metrics.pe_ratio, benchmark['pe_median'], 'lower_is_better'
            )
        
        # 2. ROE Relative Analysis
        if metrics.roe:
            score, reason = self.score_roe_relative(metrics.roe, metrics.sector)
            total_score += score * 4
            if score > 0:
                buy_reasons.append(reason)
            elif score < 0:
                sell_reasons.append(reason)
            
            benchmark = self.get_sector_benchmark(metrics.sector)
            metrics.roe_percentile = self.calculate_percentile_rank(
                metrics.roe, benchmark['roe_median'], 'higher_is_better'
            )
        
        # 3. Dividend Yield
        if metrics.dividend_yield and metrics.dividend_yield > 0:
            benchmark = self.get_sector_benchmark(metrics.sector)
            if metrics.dividend_yield > benchmark['dividend_yield_median'] * 1.5:
                total_score += 5
                buy_reasons.append(f"عائد توزيعات عالي ({metrics.dividend_yield:.1f}%)")
            elif metrics.dividend_yield > benchmark['dividend_yield_median']:
                total_score += 3
                buy_reasons.append(f"عائد توزيعات جيد ({metrics.dividend_yield:.1f}%)")
        
        # 4. Debt/Equity
        if metrics.debt_to_equity:
            if metrics.debt_to_equity < 0.5:
                total_score += 5
                buy_reasons.append("ديون منخفضة مقارنة بالحقوق")
            elif metrics.debt_to_equity > 2:
                total_score -= 5
                sell_reasons.append("ديون مرتفعة مقارنة بالحقوق")
        
        # 5. Profit Margin
        if metrics.profit_margin:
            if metrics.profit_margin > 20:
                total_score += 3
                buy_reasons.append(f"هامش ربح عالي ({metrics.profit_margin:.1f}%)")
            elif metrics.profit_margin < 5:
                total_score -= 3
                sell_reasons.append(f"هامش ربح منخفض ({metrics.profit_margin:.1f}%)")
        
        # Finalize
        metrics.weighted_score = max(0, min(100, total_score))
        metrics.buy_reasons = buy_reasons
        metrics.sell_reasons = sell_reasons
        
        return metrics
    
    def get_fundamental_score(self, stock_data: Dict, sector: str = None) -> Tuple[float, List[str], List[str]]:
        """
        الحصول على النتيجة والأسباب
        
        Returns:
            Tuple: (score, buy_reasons, sell_reasons)
        """
        metrics = self.analyze(stock_data, sector)
        return metrics.weighted_score, metrics.buy_reasons or [], metrics.sell_reasons or []


def get_sector_pe_median(sector: str) -> float:
    """الحصول على متوسط P/E للقطاع"""
    return SECTOR_MEDIANS.get(sector, SECTOR_MEDIANS['DEFAULT'])['pe_median']
