"""
Correlation Filter - Sector & Asset Correlation Control
فلتر الارتباط - التحكم في ارتباط القطاعات والأصول

Prevents over-exposure to correlated assets:
- Max 2 stocks from same sector
- Max 3 stocks from same industry
- Tracks portfolio correlation

@version 1.0.0
@authorM2yDevelopers Team
"""

from typing import Dict, List, Optional, Set, Tuple
from dataclasses import dataclass
from enum import Enum
from collections import defaultdict


class CorrelationLevel(Enum):
    NONE = 'none'
    LOW = 'low'
    MEDIUM = 'medium'
    HIGH = 'high'
    CRITICAL = 'critical'


@dataclass
class CorrelationWarning:
    """تحذير ارتباط"""
    ticker: str
    correlated_with: List[str]
    correlation_type: str  # 'sector', 'industry', 'asset_class'
    correlation_value: float
    message: str
    message_ar: str


@dataclass
class PortfolioCorrelationState:
    """حالة ارتباط المحفظة"""
    total_positions: int
    sector_distribution: Dict[str, int]
    industry_distribution: Dict[str, int]
    correlation_level: CorrelationLevel
    blocked_sectors: List[str]
    warnings: List[CorrelationWarning]


# ==================== SECTOR MAPPING ====================

# قطاعات البورصة المصرية
EGX_SECTORS = {
    'Financials': {
        'industries': ['Banks', 'Insurance', 'Investment Services', 'Financial Services'],
        'correlation_group': 'financial',
        'max_positions': 2
    },
    'Basic Materials': {
        'industries': ['Chemicals', 'Construction Materials', 'Metals & Mining'],
        'correlation_group': 'materials',
        'max_positions': 2
    },
    'Real Estate': {
        'industries': ['Real Estate Development', 'Real Estate Services'],
        'correlation_group': 'realestate',
        'max_positions': 2
    },
    'Consumer Goods': {
        'industries': ['Food Products', 'Household Products', 'Personal Products'],
        'correlation_group': 'consumer',
        'max_positions': 3
    },
    'Industrials': {
        'industries': ['Construction', 'Electrical Equipment', 'Machinery'],
        'correlation_group': 'industrial',
        'max_positions': 2
    },
    'Healthcare': {
        'industries': ['Healthcare Providers', 'Pharmaceuticals', 'Biotechnology'],
        'correlation_group': 'healthcare',
        'max_positions': 2
    },
    'Energy': {
        'industries': ['Oil & Gas', 'Petrochemicals', 'Alternative Energy'],
        'correlation_group': 'energy',
        'max_positions': 2
    },
    'Telecommunications': {
        'industries': ['Telecom Services', 'Wireless Communications'],
        'correlation_group': 'telecom',
        'max_positions': 2
    },
    'Technology': {
        'industries': ['Software', 'IT Services', 'Electronics'],
        'correlation_group': 'tech',
        'max_positions': 2
    },
    'Utilities': {
        'industries': ['Electric Utilities', 'Gas Utilities', 'Water Utilities'],
        'correlation_group': 'utilities',
        'max_positions': 2
    },
    'Consumer Services': {
        'industries': ['Retail', 'Hotels & Resorts', 'Restaurants'],
        'correlation_group': 'services',
        'max_positions': 3
    },
    'Food & Beverage': {
        'industries': ['Beverages', 'Food Processing', 'Agriculture'],
        'correlation_group': 'fnb',
        'max_positions': 2
    },
}

# أسهم مرتبطة ببعض (ارتباط خاص)
CORRELATED_PAIRS = {
    # البنوك
    ('COMI', 'HRHO'): 0.85,  # CIB و بنك الإسكان
    ('COMI', 'CIEB'): 0.80,  # CIB و كريدي أجريكول
    ('HRHO', 'CIEB'): 0.75,
    
    # العقارات
    ('TMGH', 'PHDC'): 0.70,  # طلعت مصطفى و بالم هيلز
    ('TMGH', 'MNHD'): 0.65,
    ('PHDC', 'MNHD'): 0.75,
    
    # الحديد والصلب
    ('ESRS', 'ESGH'): 0.90,  # حديد عز
    ('IRON', 'ESRS'): 0.70,
    
    # الأسمدة
    ('ABUK', 'SKPC'): 0.75,  # أبو قير و سيدى كرير
    ('ABUK', 'MFPC'): 0.70,
    
    # الاتصالات
    ('ETEL', 'FWRY'): 0.50,  # مصر للاتصالات و فوري
}

# العملات الرقمية المترابطة
CRYPTO_CORRELATION_GROUPS = {
    'bitcoin_family': ['BTC', 'BCH', 'BSV'],
    'ethereum_family': ['ETH', 'ETC'],
    'defi_tokens': ['UNI', 'AAVE', 'COMP', 'MKR'],
    'layer1': ['SOL', 'ADA', 'AVAX', 'DOT', 'ATOM'],
    'meme_coins': ['DOGE', 'SHIB', 'PEPE', 'FLOKI'],
    'stablecoins': ['USDT', 'USDC', 'DAI', 'BUSD'],
}


class CorrelationFilter:
    """فلتر الارتباط"""
    
    def __init__(
        self,
        max_same_sector: int = 2,
        max_same_industry: int = 1,
        max_correlated_pairs: int = 1
    ):
        self.max_same_sector = max_same_sector
        self.max_same_industry = max_same_industry
        self.max_correlated_pairs = max_correlated_pairs
        self.portfolio: List[Dict] = []
    
    def add_position(self, ticker: str, sector: str, industry: str = None):
        """إضافة مركز للمحفظة"""
        self.portfolio.append({
            'ticker': ticker,
            'sector': sector,
            'industry': industry or sector
        })
    
    def remove_position(self, ticker: str):
        """إزالة مركز من المحفظة"""
        self.portfolio = [p for p in self.portfolio if p['ticker'] != ticker]
    
    def can_add_position(
        self,
        ticker: str,
        sector: str,
        industry: str = None
    ) -> Tuple[bool, List[CorrelationWarning]]:
        """
        هل يمكن إضافة هذا المركز؟
        
        Returns:
            (can_add, warnings)
        """
        warnings = []
        can_add = True
        
        # 1. فحص القطاع
        same_sector = [p for p in self.portfolio if p['sector'] == sector]
        if len(same_sector) >= self.max_same_sector:
            can_add = False
            warnings.append(CorrelationWarning(
                ticker=ticker,
                correlated_with=[p['ticker'] for p in same_sector],
                correlation_type='sector',
                correlation_value=0.7,
                message=f'Max {self.max_same_sector} positions allowed in {sector}',
                message_ar=f'الحد الأقصى {self.max_same_sector} أسهم في قطاع {sector}'
            ))
        
        # 2. فحص الصناعة
        if industry:
            same_industry = [p for p in self.portfolio if p.get('industry') == industry]
            if len(same_industry) >= self.max_same_industry:
                can_add = False
                warnings.append(CorrelationWarning(
                    ticker=ticker,
                    correlated_with=[p['ticker'] for p in same_industry],
                    correlation_type='industry',
                    correlation_value=0.8,
                    message=f'Max {self.max_same_industry} positions allowed in {industry}',
                    message_ar=f'الحد الأقصى {self.max_same_industry} أسهم في صناعة {industry}'
                ))
        
        # 3. فحص الأزواج المترابطة
        for pos in self.portfolio:
            pair = tuple(sorted([ticker, pos['ticker']]))
            if pair in CORRELATED_PAIRS:
                corr = CORRELATED_PAIRS[pair]
                if corr >= 0.7:
                    can_add = False
                    warnings.append(CorrelationWarning(
                        ticker=ticker,
                        correlated_with=[pos['ticker']],
                        correlation_type='pair',
                        correlation_value=corr,
                        message=f'High correlation ({corr:.0%}) with {pos["ticker"]}',
                        message_ar=f'ارتباط عالي ({corr:.0%}) مع {pos["ticker"]}'
                    ))
        
        return can_add, warnings
    
    def get_best_in_sector(
        self,
        candidates: List[Dict],
        sector: str
    ) -> Optional[Dict]:
        """
        اختيار أفضل سهم في القطاع
        
        Args:
            candidates: قائمة الأسهم المرشحة
            sector: القطاع
        
        Returns:
            أفضل سهم أو None
        """
        sector_candidates = [c for c in candidates if c.get('sector') == sector]
        
        if not sector_candidates:
            return None
        
        # ترتيب حسب الدرجة
        sector_candidates.sort(key=lambda x: x.get('maestro_score', 0), reverse=True)
        
        # فحص كل مرشح
        for candidate in sector_candidates:
            can_add, _ = self.can_add_position(
                candidate['ticker'],
                candidate['sector'],
                candidate.get('industry')
            )
            if can_add:
                return candidate
        
        return None
    
    def get_portfolio_state(self) -> PortfolioCorrelationState:
        """الحصول على حالة الارتباط للمحفظة"""
        # توزيع القطاعات
        sector_dist = defaultdict(int)
        for pos in self.portfolio:
            sector_dist[pos['sector']] += 1
        
        # توزيع الصناعات
        industry_dist = defaultdict(int)
        for pos in self.portfolio:
            industry_dist[pos.get('industry', pos['sector'])] += 1
        
        # تحديد القطاعات المحظورة
        blocked_sectors = [
            sector for sector, count in sector_dist.items()
            if count >= self.max_same_sector
        ]
        
        # تحديد مستوى الارتباط
        max_sector_concentration = max(sector_dist.values()) if sector_dist else 0
        total = len(self.portfolio)
        
        if max_sector_concentration >= 4:
            level = CorrelationLevel.CRITICAL
        elif max_sector_concentration >= 3:
            level = CorrelationLevel.HIGH
        elif max_sector_concentration >= 2:
            level = CorrelationLevel.MEDIUM
        elif max_sector_concentration >= 1:
            level = CorrelationLevel.LOW
        else:
            level = CorrelationLevel.NONE
        
        # جمع التحذيرات
        warnings = []
        for sector, count in sector_dist.items():
            if count >= self.max_same_sector:
                tickers = [p['ticker'] for p in self.portfolio if p['sector'] == sector]
                warnings.append(CorrelationWarning(
                    ticker='PORTFOLIO',
                    correlated_with=tickers,
                    correlation_type='sector',
                    correlation_value=count / total if total > 0 else 0,
                    message=f'Over-exposed to {sector} sector ({count} positions)',
                    message_ar=f'تركيز عالي في قطاع {sector} ({count} أسهم)'
                ))
        
        return PortfolioCorrelationState(
            total_positions=total,
            sector_distribution=dict(sector_dist),
            industry_distribution=dict(industry_dist),
            correlation_level=level,
            blocked_sectors=blocked_sectors,
            warnings=warnings
        )
    
    def filter_signals(
        self,
        signals: List[Dict]
    ) -> Tuple[List[Dict], List[CorrelationWarning]]:
        """
        فلترة الإشارات لتجنب الارتباط
        
        Args:
            signals: قائمة الإشارات المرشحة
        
        Returns:
            (filtered_signals, warnings)
        """
        filtered = []
        all_warnings = []
        
        # ترتيب حسب الدرجة
        signals = sorted(signals, key=lambda x: x.get('maestro_score', 0), reverse=True)
        
        for signal in signals:
            ticker = signal.get('ticker')
            sector = signal.get('sector', 'Unknown')
            industry = signal.get('industry')
            
            can_add, warnings = self.can_add_position(ticker, sector, industry)
            
            if can_add:
                filtered.append(signal)
                # إضافة مؤقتاً للفلترة
                self.add_position(ticker, sector, industry)
            else:
                all_warnings.extend(warnings)
        
        # إزالة الإضافات المؤقتة
        self.portfolio = []
        
        return filtered, all_warnings


def get_sector_for_ticker(ticker: str) -> str:
    """الحصول على قطاع السهم"""
    # هذا يجب أن يأتي من قاعدة البيانات
    # هنا مجرد مثال
    sector_map = {
        'COMI': 'Financials',
        'HRHO': 'Financials',
        'CIEB': 'Financials',
        'ETEL': 'Telecommunications',
        'TMGH': 'Real Estate',
        'PHDC': 'Real Estate',
        'MNHD': 'Real Estate',
        'ESRS': 'Basic Materials',
        'ABUK': 'Basic Materials',
        'SKPC': 'Energy',
        'JUFO': 'Food & Beverage',
        'SWDY': 'Industrials',
    }
    return sector_map.get(ticker, 'Unknown')


def calculate_portfolio_correlation(
    positions: List[Dict],
    price_history: Dict[str, List[float]]
) -> float:
    """
    حساب معامل ارتباط المحفظة الكلي
    
    Args:
        positions: قائمة المراكز
        price_history: تاريخ الأسعار لكل سهم
    
    Returns:
        متوسط معامل الارتباط
    """
    import statistics
    
    tickers = [p['ticker'] for p in positions]
    
    if len(tickers) < 2:
        return 0.0
    
    # حساب العوائد
    returns = {}
    for ticker in tickers:
        if ticker in price_history:
            prices = price_history[ticker]
            returns[ticker] = [
                (prices[i] - prices[i-1]) / prices[i-1]
                for i in range(1, len(prices))
                if prices[i-1] != 0
            ]
    
    # حساب الارتباطات
    correlations = []
    tickers_with_data = list(returns.keys())
    
    for i, t1 in enumerate(tickers_with_data):
        for t2 in tickers_with_data[i+1:]:
            r1, r2 = returns[t1], returns[t2]
            min_len = min(len(r1), len(r2))
            
            if min_len < 10:
                continue
            
            r1, r2 = r1[:min_len], r2[:min_len]
            
            # معامل ارتباط بيرسون
            mean1, mean2 = statistics.mean(r1), statistics.mean(r2)
            
            numerator = sum((a - mean1) * (b - mean2) for a, b in zip(r1, r2))
            denom1 = sum((a - mean1) ** 2 for a in r1) ** 0.5
            denom2 = sum((b - mean2) ** 2 for b in r2) ** 0.5
            
            if denom1 > 0 and denom2 > 0:
                corr = numerator / (denom1 * denom2)
                correlations.append(corr)
    
    return statistics.mean(correlations) if correlations else 0.0


# ==================== EXAMPLE USAGE ====================

if __name__ == '__main__':
    # مثال
    cf = CorrelationFilter(max_same_sector=2)
    
    # إضافة مراكز
    cf.add_position('COMI', 'Financials', 'Banks')
    cf.add_position('HRHO', 'Financials', 'Banks')
    
    # محاولة إضافة بنك ثالث
    can_add, warnings = cf.can_add_position('CIEB', 'Financials', 'Banks')
    
    print(f"Can add CIEB: {can_add}")
    for w in warnings:
        print(f"  Warning: {w.message_ar}")
    
    # حالة المحفظة
    state = cf.get_portfolio_state()
    print(f"\nPortfolio State:")
    print(f"  Total Positions: {state.total_positions}")
    print(f"  Correlation Level: {state.correlation_level.value}")
    print(f"  Blocked Sectors: {state.blocked_sectors}")
    
    # فلترة إشارات
    signals = [
        {'ticker': 'COMI', 'sector': 'Financials', 'maestro_score': 80},
        {'ticker': 'ETEL', 'sector': 'Telecommunications', 'maestro_score': 75},
        {'ticker': 'TMGH', 'sector': 'Real Estate', 'maestro_score': 70},
        {'ticker': 'HRHO', 'sector': 'Financials', 'maestro_score': 65},
        {'ticker': 'CIEB', 'sector': 'Financials', 'maestro_score': 60},
    ]
    
    filtered, warnings = cf.filter_signals(signals)
    print(f"\nFiltered Signals:")
    for s in filtered:
        print(f"  {s['ticker']}: {s['maestro_score']}")
