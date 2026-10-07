#!/usr/bin/env python3
"""
Fair Value Calculator
=====================
حاسبة القيمة العادلة للأسهم

القيمة العادلة = السعر الحقيقي للسهم بناءً على التحليل الأساسي

الطرق المستخدمة:
1. P/E + ROE Method (مضاعف الربحية + العائد على حقوق المساهمين)
2. P/B + ROE Method (مضاعف القيمة الدفترية)
3. DCF Simplified (خصم التدفقات النقدية - مبسط)
4. Gordon Growth Model (للأسهم الموزعة للأرباح)

Author: دليل الاستثمار
Version: 1.0.0
"""

import sqlite3
from typing import Dict, Optional, Tuple
from dataclasses import dataclass
from pathlib import Path


# ============================================================================
# SECTOR BENCHMARKS - معايير القطاعات
# ============================================================================

SECTOR_PE_BENCHMARKS = {
    # EGX Sectors
    'Banks': {'fair_pe': 12, 'fair_pb': 1.5, 'min_roe': 15},
    'Financial Services': {'fair_pe': 15, 'fair_pb': 2.0, 'min_roe': 12},
    'Telecommunications': {'fair_pe': 12, 'fair_pb': 1.5, 'min_roe': 15},
    'Real Estate': {'fair_pe': 10, 'fair_pb': 1.0, 'min_roe': 10},
    'Basic Materials': {'fair_pe': 10, 'fair_pb': 1.2, 'min_roe': 12},
    'Industrials': {'fair_pe': 15, 'fair_pb': 1.5, 'min_roe': 12},
    'Energy': {'fair_pe': 8, 'fair_pb': 1.0, 'min_roe': 10},
    'Utilities': {'fair_pe': 12, 'fair_pb': 1.2, 'min_roe': 8},
    'Healthcare': {'fair_pe': 18, 'fair_pb': 2.0, 'min_roe': 12},
    'Consumer Goods': {'fair_pe': 20, 'fair_pb': 2.5, 'min_roe': 15},
    'Technology': {'fair_pe': 25, 'fair_pb': 3.0, 'min_roe': 15},
    
    # Default
    'Default': {'fair_pe': 15, 'fair_pb': 1.5, 'min_roe': 12}
}

# Market risk premiums
MARKET_RISK_PREMIUM = {
    'EGX': 0.12,        # Egypt - Higher risk
    'TADAWUL': 0.08,    # Saudi - Lower risk
    'KSE': 0.10,        # Kuwait
    'QSE': 0.10,        # Qatar
    'CRYPTO': 0.20      # Crypto - High risk
}

# Risk-free rates (approximate)
RISK_FREE_RATE = {
    'EGX': 0.20,        # Egypt Treasury Bills ~20%
    'TADAWUL': 0.05,    # Saudi ~5%
    'KSE': 0.04,        # Kuwait ~4%
    'QSE': 0.05,        # Qatar ~5%
    'CRYPTO': 0.05      # US Treasury as baseline
}


# ============================================================================
# DATA CLASS
# ============================================================================

@dataclass
class FairValueResult:
    """نتيجة حساب القيمة العادلة"""
    symbol: str
    market: str
    current_price: float
    
    # Fair Value Estimates
    fv_pe_method: Optional[float] = None      # Fair Value by P/E method
    fv_pb_method: Optional[float] = None      # Fair Value by P/B method
    fv_dcf_method: Optional[float] = None     # Fair Value by DCF
    fv_gordon_method: Optional[float] = None  # Fair Value by Gordon Model
    
    # Weighted Average Fair Value
    fair_value: Optional[float] = None
    upside_percent: Optional[float] = None    # (FV - Price) / Price * 100
    
    # Confidence & Signals
    confidence: float = 50.0
    signal: str = 'HOLD'  # UNDERVALUED, FAIR, OVERVALUED
    
    # Details
    pe_ratio: Optional[float] = None
    pb_ratio: Optional[float] = None
    roe: Optional[float] = None
    eps: Optional[float] = None
    book_value: Optional[float] = None
    sector: Optional[str] = None
    
    # Reasoning
    reasons: list = None
    
    def __post_init__(self):
        if self.reasons is None:
            self.reasons = []


# ============================================================================
# FAIR VALUE CALCULATOR
# ============================================================================

class FairValueCalculator:
    """
    حاسبة القيمة العادلة للأسهم
    
    Usage:
        calculator = FairValueCalculator(db_path)
        result = calculator.calculate('COMI', 'EGX')
        print(f"Fair Value: {result.fair_value}")
        print(f"Upside: {result.upside_percent}%")
    """
    
    def __init__(self, db_path: str = None):
        if db_path is None:
            project_root = Path(__file__).parent.parent.parent
            db_path = str(project_root / 'data_engine' / 'data' / 'data_engine.db')
        self.db_path = db_path
    
    def _parse_number(self, val) -> Optional[float]:
        """Parse number from string like '15.5%' or '12.3'"""
        if val is None:
            return None
        if isinstance(val, (int, float)):
            return float(val)
        val = str(val).replace('%', '').replace(',', '').replace('B', '').replace('M', '').strip()
        try:
            return float(val)
        except:
            return None
    
    def _get_fundamental_data(self, symbol: str, market: str) -> Dict:
        """Get fundamental data from database"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        # Get valuation data from data_engine.db
        cursor.execute("""
            SELECT pe_ratio, pb_ratio, ps_ratio, peg_ratio
            FROM tab_valuation
            WHERE symbol = ? AND market = ?
        """, (symbol, market))
        val_row = cursor.fetchone()
        
        # Get profitability data from data_engine.db
        cursor.execute("""
            SELECT roe, roa, net_margin, gross_margin
            FROM tab_profitability
            WHERE symbol = ? AND market = ?
        """, (symbol, market))
        prof_row = cursor.fetchone()
        
        # Get current price from data_engine.stocks or stocks.db
        # First try data_engine.stocks
        cursor.execute("""
            SELECT price FROM stocks 
            WHERE symbol = ?
            LIMIT 1
        """, (symbol,))
        price_row = cursor.fetchone()
        
        current_price = None
        if price_row:
            current_price = self._parse_number(price_row[0])
        
        conn.close()
        
        data = {
            'pe_ratio': self._parse_number(val_row[0]) if val_row else None,
            'pb_ratio': self._parse_number(val_row[1]) if val_row else None,
            'ps_ratio': self._parse_number(val_row[2]) if val_row else None,
            'peg_ratio': self._parse_number(val_row[3]) if val_row else None,
            'roe': self._parse_number(prof_row[0]) if prof_row else None,
            'roa': self._parse_number(prof_row[1]) if prof_row else None,
            'net_margin': self._parse_number(prof_row[2]) if prof_row else None,
            'gross_margin': self._parse_number(prof_row[3]) if prof_row else None,
            'current_price': current_price,
            'sector': 'Financial Services'  # Default sector
        }
        
        return data
    
    def _get_sector_benchmark(self, sector: str) -> Dict:
        """Get sector benchmark values"""
        return SECTOR_PE_BENCHMARKS.get(sector, SECTOR_PE_BENCHMARKS['Default'])
    
    def calculate_pe_method(self, pe: float, eps: float, roe: float, sector: str, current_price: float = None) -> Tuple[Optional[float], float]:
        """
        حساب القيمة العادلة بطريقة P/E + ROE
        
        المنطق:
        - إذا كان ROE > 20%، السهم يستحق P/E أعلى
        - إذا كان ROE < 10%، السهم يستحق P/E أقل
        """
        if not pe or not roe:
            return None, 0
        
        benchmark = self._get_sector_benchmark(sector)
        fair_pe = benchmark['fair_pe']
        min_roe = benchmark['min_roe']
        
        # Adjust fair P/E based on ROE
        if roe > 25:
            fair_pe *= 1.3  # Premium for excellent ROE
        elif roe > 20:
            fair_pe *= 1.15
        elif roe > min_roe:
            fair_pe *= 1.0
        elif roe > min_roe * 0.7:
            fair_pe *= 0.85
        else:
            fair_pe *= 0.7  # Discount for poor ROE
        
        # Calculate fair value
        if eps and eps > 0:
            fair_value = eps * fair_pe
            return fair_value, 0.5  # 50% weight
        
        # If no EPS but we have price and P/E, calculate implied EPS
        if current_price and pe and pe > 0:
            implied_eps = current_price / pe
            fair_value = implied_eps * fair_pe
            return fair_value, 0.5  # 50% weight
        
        return None, 0
    
    def calculate_pb_method(self, pb: float, book_value: float, roe: float, sector: str, current_price: float = None) -> Tuple[Optional[float], float]:
        """
        حساب القيمة العادلة بطريقة P/B + ROE

        المنطق:
        - P/B العادل يعتمد على ROE
        - كلما زاد ROE، زاد P/B العادل
        - P/B = Price / Book Value
        """
        if not pb or not roe:
            return None, 0

        benchmark = self._get_sector_benchmark(sector)
        fair_pb = benchmark['fair_pb']

        # Adjust fair P/B based on ROE
        if roe > 25:
            fair_pb *= 1.4  # Premium for excellent ROE
        elif roe > 20:
            fair_pb *= 1.2
        elif roe > 15:
            fair_pb *= 1.1
        elif roe < 10:
            fair_pb *= 0.8
        elif roe < 5:
            fair_pb *= 0.6  # Discount for poor ROE

        # Calculate fair value
        if book_value and book_value > 0:
            fair_value = book_value * fair_pb
            return fair_value, 0.5  # 50% weight

        # If no book value but we have price and P/B, calculate implied book value
        if current_price and pb and pb > 0:
            implied_book_value = current_price / pb
            fair_value = implied_book_value * fair_pb
            return fair_value, 0.5  # 50% weight

        return None, 0
    
    def calculate_dcf_simplified(self, eps: float, growth_rate: float, market: str, current_price: float = None, pe_ratio: float = None) -> Tuple[Optional[float], float]:
        """
        حساب القيمة العادلة بطريقة DCF المبسطة

        المعادلة:
        FV = EPS × (1 + g) / (r - g)

        حيث:
        - g = معدل النمو المتوقع
        - r = معدل الخصم (risk-free + risk premium)

        هذا النموذج مناسب للشركات ذات النمو المستقر
        """
        # Calculate EPS if not provided
        if (not eps or eps <= 0) and current_price and pe_ratio and pe_ratio > 0:
            eps = current_price / pe_ratio

        if not eps or eps <= 0:
            return None, 0

        # Map market to our keys
        market_key = market
        if 'سعود' in market or 'TADAWUL' in market.upper():
            market_key = 'TADAWUL'
        elif 'مصر' in market or 'EGX' in market.upper():
            market_key = 'EGX'
        elif 'كويت' in market or 'KSE' in market.upper():
            market_key = 'KSE'
        elif 'قطر' in market or 'QSE' in market.upper():
            market_key = 'QSE'

        risk_free = RISK_FREE_RATE.get(market_key, 0.10)
        risk_premium = MARKET_RISK_PREMIUM.get(market_key, 0.12)
        discount_rate = risk_free + risk_premium

        # Growth rate default based on market
        if not growth_rate:
            growth_rate = 0.05  # 5% default growth

        # Sanity check: growth must be less than discount rate
        if growth_rate >= discount_rate:
            growth_rate = discount_rate * 0.4

        try:
            fair_value = eps * (1 + growth_rate) / (discount_rate - growth_rate)
            return fair_value, 0.3  # 30% weight
        except:
            return None, 0
    
    def calculate_gordon_model(self, dividend: float, growth_rate: float, market: str) -> Tuple[Optional[float], float]:
        """
        حساب القيمة العادلة بنموذج جوردون
        
        المعادلة:
        FV = D1 / (r - g)
        
        حيث:
        - D1 = التوزيعة المتوقعة = D0 × (1 + g)
        - r = معدل العائد المطلوب
        - g = معدل نمو التوزيعات
        """
        if not dividend or dividend <= 0:
            return None, 0
        
        risk_free = RISK_FREE_RATE.get(market, 0.10)
        risk_premium = MARKET_RISK_PREMIUM.get(market, 0.12)
        required_return = risk_free + risk_premium
        
        if not growth_rate:
            growth_rate = 0.03  # 3% default dividend growth
        
        # Sanity check
        if growth_rate >= required_return:
            growth_rate = required_return * 0.3
        
        try:
            d1 = dividend * (1 + growth_rate)
            fair_value = d1 / (required_return - growth_rate)
            return fair_value, 0.1  # 10% weight
        except:
            return None, 0
    
    def calculate(self, symbol: str, market: str) -> FairValueResult:
        """
        حساب القيمة العادلة للسهم
        
        Args:
            symbol: رمز السهم
            market: السوق (EGX, TADAWUL, KSE, QSE)
        
        Returns:
            FairValueResult: نتيجة الحساب
        """
        # Get fundamental data
        data = self._get_fundamental_data(symbol, market)
        
        current_price = data.get('current_price', 0)
        if not current_price:
            current_price = 0
        
        result = FairValueResult(
            symbol=symbol,
            market=market,
            current_price=current_price,
            pe_ratio=data.get('pe_ratio'),
            pb_ratio=data.get('pb_ratio'),
            roe=data.get('roe'),
            sector=data.get('sector')
        )
        
        if not data.get('pe_ratio') and not data.get('pb_ratio'):
            result.reasons.append("لا توجد بيانات أساسية كافية")
            result.confidence = 0
            return result
        
        # Calculate Fair Value using different methods
        fv_estimates = []
        total_weight = 0
        
        # 1. P/E Method
        fv_pe, weight_pe = self.calculate_pe_method(
            data['pe_ratio'],
            data.get('eps', 0),
            data['roe'],
            data['sector'],
            current_price
        )
        if fv_pe:
            result.fv_pe_method = fv_pe
            fv_estimates.append((fv_pe, weight_pe))
            total_weight += weight_pe
            result.reasons.append(f"P/E Method: {fv_pe:.2f}")
        
        # 2. P/B Method
        fv_pb, weight_pb = self.calculate_pb_method(
            data['pb_ratio'],
            data.get('book_value', 0),
            data['roe'],
            data['sector'],
            current_price
        )
        if fv_pb:
            result.fv_pb_method = fv_pb
            fv_estimates.append((fv_pb, weight_pb))
            total_weight += weight_pb
            result.reasons.append(f"P/B Method: {fv_pb:.2f}")

        # 3. DCF Simplified Method
        fv_dcf, weight_dcf = self.calculate_dcf_simplified(
            data.get('eps', 0),
            data.get('growth_rate'),  # May be None
            market,
            current_price,
            data['pe_ratio']
        )
        if fv_dcf:
            result.fv_dcf_method = fv_dcf
            fv_estimates.append((fv_dcf, weight_dcf))
            total_weight += weight_dcf
            result.reasons.append(f"DCF Method: {fv_dcf:.2f}")

        # Calculate weighted average fair value
        if fv_estimates and total_weight > 0:
            weighted_fv = sum(fv * w for fv, w in fv_estimates)
            result.fair_value = weighted_fv / total_weight
            
            # Calculate upside/downside
            if current_price > 0:
                result.upside_percent = ((result.fair_value - current_price) / current_price) * 100
                
                # Determine signal
                if result.upside_percent > 20:
                    result.signal = 'UNDERVALUED'
                    result.reasons.append(f"✅ السهم مقيم بأقل من قيمته العادلة بـ {result.upside_percent:.1f}%")
                elif result.upside_percent > 5:
                    result.signal = 'BUY'
                    result.reasons.append(f"📈 السهم مقيم بأقل من قيمته العادلة بـ {result.upside_percent:.1f}%")
                elif result.upside_percent < -20:
                    result.signal = 'OVERVALUED'
                    result.reasons.append(f"⚠️ السهم مقيم بأعلى من قيمته العادلة بـ {abs(result.upside_percent):.1f}%")
                elif result.upside_percent < -5:
                    result.signal = 'SELL'
                    result.reasons.append(f"📉 السهم مقيم بأعلى من قيمته العادلة بـ {abs(result.upside_percent):.1f}%")
                else:
                    result.signal = 'HOLD'
                    result.reasons.append("⚖️ السهم مقيم بقيمته العادلة تقريباً")
            
            # Confidence based on data availability
            result.confidence = min(100, total_weight * 100 + 20)
        
        return result


# ============================================================================
# MAIN
# ============================================================================

if __name__ == '__main__':
    # Test the calculator
    calculator = FairValueCalculator()
    
    print("="*60)
    print("📊 اختبار حاسبة القيمة العادلة")
    print("="*60)
    
    # Test with a sample stock
    result = calculator.calculate('1010', 'السعودية')
    
    print(f"\n🏭 السهم: {result.symbol} ({result.market})")
    print(f"💵 السعر الحالي: {result.current_price}")
    print(f"📈 P/E: {result.pe_ratio}")
    print(f"📊 ROE: {result.roe}%")
    print(f"\n💰 القيمة العادلة: {result.fair_value}")
    print(f"📊 Upside: {result.upside_percent}%")
    print(f"🎯 الإشارة: {result.signal}")
    print(f"📝 الأسباب:")
    for reason in result.reasons:
        print(f"   - {reason}")
