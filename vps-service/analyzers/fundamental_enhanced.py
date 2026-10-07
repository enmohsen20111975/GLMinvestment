"""
Enhanced Fundamental Analyzer
==============================
التحليل الأساسي المحسن للسوق المصري

التحسينات:
1. المزيد من المؤشرات المالية
2. أوزان ديناميكية حسب القطاع
3. تحليل الاتجاه الربحي
4. تقييم جودة الأرباح
5. تحليل المخاطر المالية

Author: دليل الاستثمار (Phase 2 - Enhanced)
"""

from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, asdict
import sqlite3
from datetime import datetime


# ============================================================================
# SECTOR BENCHMARKS - EGX SPECIFIC (Updated 2026)
# ============================================================================

SECTOR_BENCHMARKS = {
    'Financial Services': {
        'pe_median': 18.0,
        'pe_low': 12.0,      # Cheap
        'pe_high': 25.0,     # Expensive
        'pb_median': 1.8,
        'roe_median': 18.0,
        'roe_good': 20.0,
        'roe_excellent': 25.0,
        'dividend_yield_median': 5.0,
        'debt_to_equity_max': 3.0,  # Banks have higher D/E
        'current_ratio_min': 0.8,
    },
    'Telecommunications': {
        'pe_median': 22.0,
        'pe_low': 15.0,
        'pe_high': 30.0,
        'pb_median': 2.5,
        'roe_median': 15.0,
        'roe_good': 18.0,
        'roe_excellent': 22.0,
        'dividend_yield_median': 6.0,
        'debt_to_equity_max': 1.5,
        'current_ratio_min': 1.0,
    },
    'Real Estate': {
        'pe_median': 12.0,
        'pe_low': 8.0,
        'pe_high': 18.0,
        'pb_median': 1.0,
        'roe_median': 12.0,
        'roe_good': 15.0,
        'roe_excellent': 20.0,
        'dividend_yield_median': 3.0,
        'debt_to_equity_max': 2.0,
        'current_ratio_min': 1.2,
    },
    'Basic Materials': {
        'pe_median': 15.0,
        'pe_low': 10.0,
        'pe_high': 20.0,
        'pb_median': 1.5,
        'roe_median': 20.0,
        'roe_good': 25.0,
        'roe_excellent': 30.0,
        'dividend_yield_median': 3.0,
        'debt_to_equity_max': 1.0,
        'current_ratio_min': 1.5,
    },
    'Industrials': {
        'pe_median': 20.0,
        'pe_low': 14.0,
        'pe_high': 28.0,
        'pb_median': 1.5,
        'roe_median': 15.0,
        'roe_good': 18.0,
        'roe_excellent': 22.0,
        'dividend_yield_median': 2.5,
        'debt_to_equity_max': 1.0,
        'current_ratio_min': 1.2,
    },
    'Energy': {
        'pe_median': 18.0,
        'pe_low': 12.0,
        'pe_high': 25.0,
        'pb_median': 1.2,
        'roe_median': 22.0,
        'roe_good': 25.0,
        'roe_excellent': 30.0,
        'dividend_yield_median': 4.0,
        'debt_to_equity_max': 1.5,
        'current_ratio_min': 1.0,
    },
    'Consumer Defensive': {
        'pe_median': 25.0,
        'pe_low': 18.0,
        'pe_high': 35.0,
        'pb_median': 2.0,
        'roe_median': 12.0,
        'roe_good': 15.0,
        'roe_excellent': 20.0,
        'dividend_yield_median': 3.0,
        'debt_to_equity_max': 1.0,
        'current_ratio_min': 1.2,
    },
    'Technology': {
        'pe_median': 25.0,
        'pe_low': 18.0,
        'pe_high': 40.0,
        'pb_median': 3.0,
        'roe_median': 10.0,
        'roe_good': 15.0,
        'roe_excellent': 20.0,
        'dividend_yield_median': 1.0,
        'debt_to_equity_max': 0.5,
        'current_ratio_min': 1.5,
    },
    'Healthcare': {
        'pe_median': 20.0,
        'pe_low': 14.0,
        'pe_high': 28.0,
        'pb_median': 2.0,
        'roe_median': 10.0,
        'roe_good': 15.0,
        'roe_excellent': 20.0,
        'dividend_yield_median': 2.0,
        'debt_to_equity_max': 1.0,
        'current_ratio_min': 1.2,
    },
    'Diversified': {
        'pe_median': 20.0,
        'pe_low': 14.0,
        'pe_high': 28.0,
        'pb_median': 1.5,
        'roe_median': 15.0,
        'roe_good': 18.0,
        'roe_excellent': 22.0,
        'dividend_yield_median': 3.0,
        'debt_to_equity_max': 1.5,
        'current_ratio_min': 1.0,
    },
    'Utilities': {
        'pe_median': 15.0,
        'pe_low': 10.0,
        'pe_high': 20.0,
        'pb_median': 1.0,
        'roe_median': 10.0,
        'roe_good': 12.0,
        'roe_excellent': 15.0,
        'dividend_yield_median': 5.0,
        'debt_to_equity_max': 2.0,
        'current_ratio_min': 0.8,
    },
    'DEFAULT': {
        'pe_median': 20.0,
        'pe_low': 14.0,
        'pe_high': 28.0,
        'pb_median': 1.5,
        'roe_median': 15.0,
        'roe_good': 18.0,
        'roe_excellent': 22.0,
        'dividend_yield_median': 3.0,
        'debt_to_equity_max': 1.0,
        'current_ratio_min': 1.0,
    }
}


@dataclass
class EnhancedFundamentalMetrics:
    """Data class for enhanced fundamental metrics."""
    # Basic metrics
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
    book_value_per_share: Optional[float] = None
    market_cap: Optional[float] = None
    beta: Optional[float] = None
    sector: Optional[str] = None
    
    # Derived metrics
    pe_vs_sector: Optional[float] = None  # P/E relative to sector median
    roe_vs_sector: Optional[float] = None
    peg_ratio: Optional[float] = None  # P/E to growth ratio (estimated)
    
    # Scores (0-100)
    valuation_score: float = 50.0      # P/E, P/B, P/S
    profitability_score: float = 50.0   # ROE, ROA, Margins
    financial_health_score: float = 50.0  # Debt, Current Ratio
    dividend_score: float = 50.0       # Dividend yield and sustainability
    
    # Overall
    weighted_score: float = 50.0
    confidence: float = 50.0  # Based on data availability
    
    buy_reasons: List[str] = None
    sell_reasons: List[str] = None
    warnings: List[str] = None
    
    def to_dict(self) -> Dict:
        result = asdict(self)
        if self.buy_reasons is None:
            result['buy_reasons'] = []
        if self.sell_reasons is None:
            result['sell_reasons'] = []
        if self.warnings is None:
            result['warnings'] = []
        return result


class EnhancedFundamentalAnalyzer:
    """
    المحلل الأساسي المحسن
    
    التحسينات على المرحلة الثانية:
    1. تقييم منفصل لكل بُعد (التقييم، الربحية، الصحة المالية، التوزيعات)
    2. أوزان ديناميكية حسب القطاع
    3. حساب الثقة بناءً على توفر البيانات
    4. تحذيرات ذكية للمخاطر
    
    Usage:
        analyzer = EnhancedFundamentalAnalyzer(db_path)
        metrics = analyzer.analyze('COMI')
    """
    
    # Dynamic weights based on sector
    SECTOR_WEIGHTS = {
        'Financial Services': {
            'valuation': 0.25,      # Banks: P/B more important than P/E
            'profitability': 0.35,  # ROE is critical for banks
            'financial_health': 0.25,
            'dividend': 0.15,
        },
        'Telecommunications': {
            'valuation': 0.30,
            'profitability': 0.25,
            'financial_health': 0.20,
            'dividend': 0.25,  # Telcos pay good dividends
        },
        'Real Estate': {
            'valuation': 0.35,  # P/B critical for RE
            'profitability': 0.20,
            'financial_health': 0.30,  # Debt is important
            'dividend': 0.15,
        },
        'Technology': {
            'valuation': 0.25,
            'profitability': 0.40,  # Growth is key
            'financial_health': 0.25,
            'dividend': 0.10,  # Tech usually low dividends
        },
        'DEFAULT': {
            'valuation': 0.30,
            'profitability': 0.30,
            'financial_health': 0.25,
            'dividend': 0.15,
        }
    }
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path
        self.sector_benchmarks = SECTOR_BENCHMARKS
    
    def get_sector_benchmark(self, sector: str) -> Dict:
        """Get sector benchmark with fallback to DEFAULT."""
        return self.sector_benchmarks.get(sector, self.sector_benchmarks['DEFAULT'])
    
    def get_sector_weights(self, sector: str) -> Dict:
        """Get sector-specific weights."""
        return self.SECTOR_WEIGHTS.get(sector, self.SECTOR_WEIGHTS['DEFAULT'])
    
    def analyze(self, ticker: str = None, stock_data: Dict = None) -> EnhancedFundamentalMetrics:
        """
        Perform enhanced fundamental analysis.
        
        Args:
            ticker: Stock symbol (will fetch from DB if provided)
            stock_data: Pre-loaded stock data (optional)
            
        Returns:
            EnhancedFundamentalMetrics: Complete analysis results
        """
        metrics = EnhancedFundamentalMetrics()
        
        # Get stock data
        if ticker and stock_data is None:
            stock_data = self._get_stock_data(ticker)
        
        if not stock_data:
            metrics.warnings = ['لا توجد بيانات متاحة']
            return metrics
        
        # Extract basic metrics
        metrics.sector = stock_data.get('sector', 'DEFAULT')
        metrics.pe_ratio = stock_data.get('pe_ratio')
        metrics.pb_ratio = stock_data.get('pb_ratio')
        metrics.ps_ratio = stock_data.get('ps_ratio')
        metrics.roe = stock_data.get('roe')
        metrics.roa = stock_data.get('roa')
        metrics.eps = stock_data.get('eps')
        metrics.dividend_yield = stock_data.get('dividend_yield')
        metrics.profit_margin = stock_data.get('profit_margin')
        metrics.debt_to_equity = stock_data.get('debt_to_equity')
        metrics.current_ratio = stock_data.get('current_ratio')
        metrics.book_value_per_share = stock_data.get('book_value_per_share')
        # FIX (Aug 2026): Sanitize market_cap — scraper may store it as a
        # formatted string like '377.55\u202fM' instead of a raw float.
        # Without this, downstream math (Altman Z, sector-relative) crashes.
        raw_mcap = stock_data.get('market_cap')
        try:
            from core.database import parse_market_cap
            metrics.market_cap = parse_market_cap(raw_mcap)
        except ImportError:
            # Fallback: try direct float, else keep raw value
            try:
                metrics.market_cap = float(raw_mcap) if raw_mcap is not None else None
            except (ValueError, TypeError):
                metrics.market_cap = None
        metrics.beta = stock_data.get('beta')
        
        # Get sector benchmark
        benchmark = self.get_sector_benchmark(metrics.sector)
        weights = self.get_sector_weights(metrics.sector)
        
        buy_reasons = []
        sell_reasons = []
        warnings = []
        
        # ========================================
        # 1. VALUATION SCORE (P/E, P/B, P/S)
        # ========================================
        valuation_score = 50  # Start neutral
        valuation_signals = 0
        valuation_count = 0
        
        # P/E Analysis (Sector-Relative)
        if metrics.pe_ratio and metrics.pe_ratio > 0:
            valuation_count += 1
            metrics.pe_vs_sector = metrics.pe_ratio / benchmark['pe_median']
            
            if metrics.pe_ratio <= benchmark['pe_low']:
                valuation_score += 20
                valuation_signals += 2
                buy_reasons.append(f"P/E منخفض جداً ({metrics.pe_ratio:.1f}x) - سهم رخيص")
            elif metrics.pe_ratio <= benchmark['pe_median']:
                valuation_score += 10
                valuation_signals += 1
                buy_reasons.append(f"P/E تحت المتوسط القطاعي ({metrics.pe_ratio:.1f}x)")
            elif metrics.pe_ratio >= benchmark['pe_high']:
                valuation_score -= 15
                valuation_signals -= 2
                sell_reasons.append(f"P/E مرتفع ({metrics.pe_ratio:.1f}x) - سهم غالي")
            elif metrics.pe_ratio > benchmark['pe_median']:
                valuation_score -= 5
                valuation_signals -= 1
        else:
            warnings.append('P/E غير متاح')
        
        # P/B Analysis
        if metrics.pb_ratio and metrics.pb_ratio > 0:
            valuation_count += 1
            if metrics.pb_ratio < 1.0:
                valuation_score += 15
                valuation_signals += 2
                buy_reasons.append(f"P/B أقل من 1 ({metrics.pb_ratio:.2f}x) - يتداول تحت القيمة الدفترية")
            elif metrics.pb_ratio <= benchmark['pb_median']:
                valuation_score += 8
                valuation_signals += 1
            elif metrics.pb_ratio > benchmark['pb_median'] * 1.5:
                valuation_score -= 10
                valuation_signals -= 1
                sell_reasons.append(f"P/B مرتفع ({metrics.pb_ratio:.2f}x)")
        
        # P/S Analysis (if available)
        if metrics.ps_ratio and metrics.ps_ratio > 0:
            valuation_count += 1
            if metrics.ps_ratio < 1.0:
                valuation_score += 8
                valuation_signals += 1
                buy_reasons.append(f"P/S منخفض ({metrics.ps_ratio:.2f}x)")
        
        # Normalize valuation score
        if valuation_count > 0:
            metrics.valuation_score = max(0, min(100, valuation_score))
        
        # ========================================
        # 2. PROFITABILITY SCORE (ROE, ROA, Margins)
        # ========================================
        profitability_score = 50
        profitability_signals = 0
        
        # ROE Analysis
        if metrics.roe is not None:
            metrics.roe_vs_sector = metrics.roe / benchmark['roe_median'] if benchmark['roe_median'] > 0 else 1
            
            if metrics.roe >= benchmark['roe_excellent']:
                profitability_score += 20
                profitability_signals += 3
                buy_reasons.append(f"ROE ممتاز ({metrics.roe:.1f}%) - أداء استثنائي")
            elif metrics.roe >= benchmark['roe_good']:
                profitability_score += 12
                profitability_signals += 2
                buy_reasons.append(f"ROE جيد جداً ({metrics.roe:.1f}%)")
            elif metrics.roe >= benchmark['roe_median']:
                profitability_score += 5
                profitability_signals += 1
            elif metrics.roe < 5:
                profitability_score -= 15
                profitability_signals -= 2
                sell_reasons.append(f"ROE ضعيف جداً ({metrics.roe:.1f}%)")
            elif metrics.roe < benchmark['roe_median'] * 0.5:
                profitability_score -= 10
                profitability_signals -= 1
        
        # ROA Analysis
        if metrics.roa is not None:
            if metrics.roa >= 10:
                profitability_score += 10
                profitability_signals += 1
                buy_reasons.append(f"ROA قوي ({metrics.roa:.1f}%)")
            elif metrics.roa >= 5:
                profitability_score += 5
            elif metrics.roa < 2:
                profitability_score -= 5
                sell_reasons.append(f"ROA ضعيف ({metrics.roa:.1f}%)")
        
        # Profit Margin (only if we have meaningful data)
        if metrics.profit_margin is not None and metrics.profit_margin != 0:
            if metrics.profit_margin >= 20:
                profitability_score += 10
                profitability_signals += 1
                buy_reasons.append(f"هامش ربح عالي ({metrics.profit_margin:.1f}%)")
            elif metrics.profit_margin >= 10:
                profitability_score += 5
            elif metrics.profit_margin < 5 and metrics.profit_margin > 0:
                profitability_score -= 5
                sell_reasons.append(f"هامش ربح منخفض ({metrics.profit_margin:.1f}%)")
            elif metrics.profit_margin < 0:
                profitability_score -= 15
                profitability_signals -= 2
                sell_reasons.append("الشركة خاسرة - هامش ربح سلبي")
        
        metrics.profitability_score = max(0, min(100, profitability_score))
        
        # ========================================
        # 3. FINANCIAL HEALTH SCORE (Debt, Liquidity)
        # ========================================
        health_score = 50
        health_signals = 0
        
        # Debt to Equity (only if we have meaningful data)
        # Note: 0 could mean "no debt" OR "no data" - we treat small values as positive
        if metrics.debt_to_equity is not None and metrics.debt_to_equity > 0:
            max_debt = benchmark.get('debt_to_equity_max', 1.0)
            
            if metrics.debt_to_equity <= 0.3:
                health_score += 15
                health_signals += 2
                buy_reasons.append("ديون منخفضة جداً - وضع مالي ممتاز")
            elif metrics.debt_to_equity <= 0.5:
                health_score += 10
                health_signals += 1
                buy_reasons.append("ديون منخفضة")
            elif metrics.debt_to_equity <= max_debt:
                health_score += 5
            elif metrics.debt_to_equity > max_debt * 1.5:
                health_score -= 15
                health_signals -= 2
                sell_reasons.append(f"ديون مرتفعة جداً ({metrics.debt_to_equity:.2f}x)")
                warnings.append("مخاطر مالية عالية بسبب الديون")
            elif metrics.debt_to_equity > max_debt:
                health_score -= 8
                health_signals -= 1
                sell_reasons.append(f"ديون أعلى من المعتاد للقطاع ({metrics.debt_to_equity:.2f}x)")
        
        # Current Ratio (Liquidity)
        if metrics.current_ratio is not None:
            min_current = benchmark.get('current_ratio_min', 1.0)
            
            if metrics.current_ratio >= 2.0:
                health_score += 10
                health_signals += 1
                buy_reasons.append(f"سيولة ممتازة (Current Ratio: {metrics.current_ratio:.2f})")
            elif metrics.current_ratio >= min_current:
                health_score += 5
            elif metrics.current_ratio < min_current * 0.5:
                health_score -= 15
                health_signals -= 2
                sell_reasons.append("مشكلة سيولة - قد تواجه صعوبة في الوفاء بالالتزامات")
                warnings.append("Current Ratio منخفض جداً")
            elif metrics.current_ratio < min_current:
                health_score -= 8
                health_signals -= 1
        
        metrics.financial_health_score = max(0, min(100, health_score))
        
        # ========================================
        # 4. DIVIDEND SCORE
        # ========================================
        dividend_score = 50
        dividend_signals = 0
        
        if metrics.dividend_yield is not None and metrics.dividend_yield > 0:
            div_median = benchmark['dividend_yield_median']
            
            if metrics.dividend_yield >= div_median * 1.5:
                dividend_score += 20
                dividend_signals += 2
                buy_reasons.append(f"عائد توزيعات ممتاز ({metrics.dividend_yield:.1f}%)")
            elif metrics.dividend_yield >= div_median:
                dividend_score += 12
                dividend_signals += 1
                buy_reasons.append(f"عائد توزيعات جيد ({metrics.dividend_yield:.1f}%)")
            elif metrics.dividend_yield >= div_median * 0.5:
                dividend_score += 5
            else:
                dividend_score -= 5
            
            # Check if dividend is sustainable (rough estimate)
            if metrics.profit_margin and metrics.profit_margin < 5 and metrics.dividend_yield > 5:
                dividend_score -= 10
                warnings.append("التوزيعات قد لا تكون مستدامة مع هامش ربح منخفض")
        
        metrics.dividend_score = max(0, min(100, dividend_score))
        
        # ========================================
        # 5. CALCULATE WEIGHTED SCORE
        # ========================================
        metrics.weighted_score = (
            metrics.valuation_score * weights['valuation'] +
            metrics.profitability_score * weights['profitability'] +
            metrics.financial_health_score * weights['financial_health'] +
            metrics.dividend_score * weights['dividend']
        )
        
        # ========================================
        # 6. CALCULATE CONFIDENCE
        # ========================================
        # Based on data availability (exclude zeros which likely mean "no data")
        available_metrics = sum([
            1 if metrics.pe_ratio and metrics.pe_ratio > 0 else 0,
            1 if metrics.pb_ratio and metrics.pb_ratio > 0 else 0,
            1 if metrics.roe is not None and metrics.roe != 0 else 0,
            1 if metrics.roa is not None and metrics.roa != 0 else 0,
            1 if metrics.debt_to_equity is not None and metrics.debt_to_equity > 0 else 0,
            1 if metrics.current_ratio is not None and metrics.current_ratio > 0 else 0,
            1 if metrics.dividend_yield is not None and metrics.dividend_yield > 0 else 0,
            1 if metrics.profit_margin is not None and metrics.profit_margin != 0 else 0,
        ])
        
        # Start with 30% base confidence, add up to 70% based on data
        metrics.confidence = min(30 + (available_metrics / 8) * 70, 100)
        
        # Reduce confidence if we have very few buy/sell signals
        total_signals = len(buy_reasons) + len(sell_reasons)
        if total_signals == 0:
            metrics.confidence *= 0.7  # Reduce confidence if no clear signals
        elif total_signals <= 2:
            metrics.confidence *= 0.85
        
        # Finalize
        metrics.buy_reasons = buy_reasons
        metrics.sell_reasons = sell_reasons
        metrics.warnings = warnings
        
        return metrics
    
    def _get_stock_data(self, ticker: str) -> Dict:
        """Get stock data from database."""
        if not self.db_path:
            return {}
        
        try:
            conn = sqlite3.connect(self.db_path)
            cursor = conn.cursor()
            
            cursor.execute('''
                SELECT pe_ratio, pb_ratio, ps_ratio, roe, roa, eps,
                       dividend_yield, profit_margin, debt_to_equity,
                       current_ratio, book_value_per_share, market_cap,
                       beta, sector
                FROM stocks WHERE ticker = ?
            ''', (ticker,))
            
            row = cursor.fetchone()
            conn.close()
            
            if row:
                return {
                    'pe_ratio': row[0],
                    'pb_ratio': row[1],
                    'ps_ratio': row[2],
                    'roe': row[3],
                    'roa': row[4],
                    'eps': row[5],
                    'dividend_yield': row[6],
                    'profit_margin': row[7],
                    'debt_to_equity': row[8],
                    'current_ratio': row[9],
                    'book_value_per_share': row[10],
                    'market_cap': row[11],
                    'beta': row[12],
                    'sector': row[13],
                }
        except Exception as e:
            print(f"[EnhancedFundamentalAnalyzer] Error: {e}")
        
        return {}
    
    def get_fundamental_score(self, ticker: str = None, stock_data: Dict = None) -> Tuple[float, List[str], List[str]]:
        """
        Get fundamental score and reasons.
        
        Returns:
            Tuple: (score, buy_reasons, sell_reasons)
        """
        metrics = self.analyze(ticker, stock_data)
        return metrics.weighted_score, metrics.buy_reasons or [], metrics.sell_reasons or []


def analyze_stock_fundamentals(ticker: str, db_path: str) -> Dict:
    """
    Convenience function for quick analysis.
    
    Args:
        ticker: Stock symbol
        db_path: Database path
        
    Returns:
        Dict: Analysis results
    """
    analyzer = EnhancedFundamentalAnalyzer(db_path)
    metrics = analyzer.analyze(ticker)
    return metrics.to_dict()
