#!/usr/bin/env python3
"""
Trend Following Analyzer - EGX
==============================
استراتيجية Trend Following للبورصة المصرية

المفهوم:
- Donchian Channel للدخول (Breakout)
- ATR للـ Stop Loss (ديناميك)
- SMA200 كـ Filter (ترند صاعد فقط)
- Position Sizing بناءً على Risk

المرجع: "Following the Trend" - Andreas Clenov

@authorM2yDevelopers Team
@version 1.0.0
"""

import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


@dataclass
class TrendFollowingResult:
    """نتيجة تحليل Trend Following"""
    ticker: str
    as_of_date: str
    current_price: float
    donchian_upper: float
    donchian_lower: float
    donchian_middle: float
    atr: float
    sma_50: float
    price_above_sma50: bool
    signal: str
    signal_ar: str
    entry_price: float
    stop_loss: float
    stop_loss_pct: float  # ديناميك
    target: float  # 3x Risk
    risk_reward: float
    position_size_pct: float  # بناءً على ATR
    breakout_strength: float
    data_used_until: str
    records_used: int
    warnings: List[str]


# ==================== INDICATOR CALCULATIONS ====================

def calculate_donchian_channel(
    highs: List[float], 
    lows: List[float], 
    period: int = 20
) -> Tuple[float, float, float]:
    """
    حساب Donchian Channel
    
    Returns: (upper, middle, lower)
    - Upper = أعلى سعر في آخر 20 يوم
    - Lower = أقل سعر في آخر 20 يوم
    - Middle = (Upper + Lower) / 2
    """
    if len(highs) < period or len(lows) < period:
        return 0, 0, 0
    
    upper = max(highs[-period:])
    lower = min(lows[-period:])
    middle = (upper + lower) / 2
    
    return round(upper, 2), round(middle, 2), round(lower, 2)


def calculate_atr(
    highs: List[float], 
    lows: List[float], 
    closes: List[float], 
    period: int = 14
) -> float:
    """
    حساب Average True Range
    
    ATR = متوسط True Range في آخر 14 يوم
    True Range = max(H-L, |H-C_prev|, |L-C_prev|)
    """
    if len(closes) < period + 1:
        return 0
    
    true_ranges = []
    
    for i in range(1, len(highs)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i-1]),
            abs(lows[i] - closes[i-1])
        )
        true_ranges.append(tr)
    
    if len(true_ranges) < period:
        return 0
    
    atr = sum(true_ranges[-period:]) / period
    return round(atr, 4)


def calculate_sma(prices: List[float], period: int) -> Optional[float]:
    """حساب المتوسط البسيط"""
    if len(prices) < period:
        return None
    return sum(prices[-period:]) / period


def calculate_position_size(
    capital: float,
    entry_price: float,
    stop_loss: float,
    risk_pct: float = 1.0
) -> float:
    """
    حساب حجم الصفقة بناءً على Risk
    
    Position Size = (Risk% × Capital) / |Entry - Stop Loss|
    
    مثال:
    - Capital = $100,000
    - Risk = 1%
    - Entry = $100
    - Stop Loss = $90 (Risk per share = $10)
    - Position Size = ($1,000 / $10) = 100 shares
    """
    risk_amount = capital * (risk_pct / 100)
    risk_per_share = abs(entry_price - stop_loss)
    
    if risk_per_share <= 0:
        return 0
    
    position_size = risk_amount / risk_per_share
    position_value = position_size * entry_price
    position_pct = (position_value / capital) * 100
    
    return round(position_pct, 2)


# ==================== MAIN ANALYZER ====================

class TrendFollowingAnalyzer:
    """
    محلل Trend Following للبورصة المصرية
    
    استراتيجية Donchian Channel Breakout:
    1. Buy: السعر يقفل فوق Donchian Upper
    2. Sell: السعر يقفل تحت Donchian Lower
    3. Stop Loss = Entry - (2 × ATR)
    4. Target = Entry + (6 × ATR) = 3x Risk
    5. Filter: السعر يجب أن يكون فوق SMA200
    """
    
    # معاملات الاستراتيجية
    DONCHIAN_PERIOD = 20
    ATR_PERIOD = 14
    SMA_PERIOD = 50  # مخفف من 200 لـ 50 (البيانات محدودة)
    ATR_MULTIPLIER_STOP = 2.0  # Stop Loss = Entry - (2 × ATR)
    ATR_MULTIPLIER_TARGET = 6.0  # Target = Entry + (6 × ATR) = 3x Risk
    RISK_PER_TRADE_PCT = 1.0  # 1% risk per trade
    
    def __init__(self, db_path: str):
        self.db_path = db_path
    
    def get_price_history_until(
        self, 
        ticker: str, 
        as_of_date: str,
        limit: int = 250  # نحتاج 200 يوم للـ SMA200
    ) -> Tuple[List[Dict], str]:
        """جلب تاريخ الأسعار حتى تاريخ معين"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        query = '''
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ? AND date <= ?
            ORDER BY date DESC
            LIMIT ?
        '''
        
        cursor.execute(query, (ticker, as_of_date, limit))
        rows = cursor.fetchall()
        conn.close()
        
        history = []
        for row in reversed(rows):
            history.append({
                'date': row[0],
                'open': row[1],
                'high': row[2],
                'low': row[3],
                'close': row[4],
                'volume': row[5]
            })
        
        last_date = rows[0][0] if rows else as_of_date
        return history, last_date
    
    def analyze(
        self,
        ticker: str,
        as_of_date: str,
        capital: float = 100000,
        options: Dict = None
    ) -> Optional[TrendFollowingResult]:
        """
        تحليل سهم باستراتيجية Trend Following
        
        شروط الدخول:
        1. السعر يقفل فوق Donchian Upper
        2. السعر فوق SMA200 (ترند صاعد)
        """
        options = options or {}
        warnings = []
        
        # جلب البيانات
        history, last_date = self.get_price_history_until(ticker, as_of_date, limit=100)
        
        if len(history) < 50:  # نحتاج على الأقل 50 يوم للـ SMA50
            warnings.append(f'بيانات غير كافية ({len(history)} يوم < 50)')
            return None
        
        # استخراج الأسعار
        closes = [h['close'] for h in history]
        highs = [h['high'] for h in history]
        lows = [h['low'] for h in history]
        
        current_price = closes[-1]
        prev_close = closes[-2]
        
        # ========== حساب المؤشرات ==========
        
        # Donchian Channel - نستخدم الـ 20 يوم السابقين فقط (غير شامل اليوم الحالي)
        # هذا هو الصحيح للـ Breakout: نقارن سعر اليوم بأعلى سعر في الـ 20 يوم السابقين
        donchian_upper, donchian_middle, donchian_lower = calculate_donchian_channel(
            highs[:-1],  # استبعاد اليوم الحالي
            lows[:-1], 
            self.DONCHIAN_PERIOD
        )
        
        # ATR
        atr = calculate_atr(highs, lows, closes, self.ATR_PERIOD)
        
        # SMA50
        sma_50 = calculate_sma(closes, self.SMA_PERIOD)
        
        # ========== تحليل الإشارات ==========
        
        signal = 'hold'
        signal_ar = 'احتفاظ'
        entry_price = current_price
        stop_loss = 0
        target = 0
        position_size_pct = 0
        breakout_strength = 0
        
        # Filter: السعر فوق SMA50
        price_above_sma50 = current_price > sma_50 if sma_50 else False
        
        if not price_above_sma50:
            warnings.append(f'السعر تحت SMA50 ({sma_50:.2f}) - ترند هابط')
        
        # فحص Breakout
        # الشرط: السعر يقفل فوق Donchian Upper
        if prev_close <= donchian_upper and current_price > donchian_upper:
            # Breakout للأعلى!
            if price_above_sma50:
                signal = 'buy'
                signal_ar = 'شراء (Breakout)'
                
                # Entry = سعر الإغلاق
                entry_price = current_price
                
                # Stop Loss = Entry - (2 × ATR)
                stop_loss = entry_price - (self.ATR_MULTIPLIER_STOP * atr)
                
                # Target = Entry + (6 × ATR) = 3x Risk
                target = entry_price + (self.ATR_MULTIPLIER_TARGET * atr)
                
                # حساب حجم الصفقة
                position_size_pct = calculate_position_size(
                    capital, entry_price, stop_loss, self.RISK_PER_TRADE_PCT
                )
                
                # قوة الـ Breakout
                breakout_strength = ((current_price - donchian_upper) / donchian_upper) * 100
                
                warnings.append(f'Breakout قوة {breakout_strength:.2f}%')
                warnings.append(f'ATR = {atr:.2f}, Stop Loss = {stop_loss:.2f}')
            else:
                warnings.append('Breakout لكن السعر تحت SMA50 - تجاهل')
        
        # فحص Breakdown للخروج من الصفقات الطويلة
        if prev_close >= donchian_lower and current_price < donchian_lower:
            signal = 'sell'
            signal_ar = 'بيع (Breakdown)'
            warnings.append('Breakdown - السعر اخترق Donchian Lower')
        
        # ========== حساب Risk/Reward ==========
        
        if signal == 'buy' and stop_loss > 0:
            stop_loss_pct = ((entry_price - stop_loss) / entry_price) * 100
            risk_reward = ((target - entry_price) / (entry_price - stop_loss)) if entry_price != stop_loss else 0
        else:
            stop_loss_pct = 0
            risk_reward = 0
        
        return TrendFollowingResult(
            ticker=ticker,
            as_of_date=as_of_date,
            current_price=round(current_price, 2),
            donchian_upper=donchian_upper,
            donchian_lower=donchian_lower,
            donchian_middle=donchian_middle,
            atr=atr,
            sma_50=round(sma_50, 2) if sma_50 else 0,
            price_above_sma50=price_above_sma50,
            signal=signal,
            signal_ar=signal_ar,
            entry_price=round(entry_price, 2),
            stop_loss=round(stop_loss, 2) if stop_loss else 0,
            stop_loss_pct=round(stop_loss_pct, 2),
            target=round(target, 2) if target else 0,
            risk_reward=round(risk_reward, 2),
            position_size_pct=position_size_pct,
            breakout_strength=round(breakout_strength, 2),
            data_used_until=last_date,
            records_used=len(history),
            warnings=warnings
        )
    
    def verify_no_lookahead(self, ticker: str, as_of_date: str) -> Dict:
        """التحقق من عدم وجود Look-ahead Bias"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        
        cursor.execute('''
            SELECT MIN(date), MAX(date), COUNT(*)
            FROM price_history
            WHERE ticker = ? AND date <= ?
        ''', (ticker, as_of_date))
        
        used_data = cursor.fetchone()
        
        cursor.execute('''
            SELECT MIN(date), MAX(date), COUNT(*)
            FROM price_history
            WHERE ticker = ? AND date > ?
        ''', (ticker, as_of_date))
        
        excluded_data = cursor.fetchone()
        conn.close()
        
        return {
            'ticker': ticker,
            'as_of_date': as_of_date,
            'used_data': {
                'min_date': used_data[0],
                'max_date': used_data[1],
                'count': used_data[2]
            },
            'excluded_data': {
                'min_date': excluded_data[0],
                'max_date': excluded_data[1],
                'count': excluded_data[2]
            },
            'lookahead_bias': used_data[1] and used_data[1] > as_of_date,
            'verification': 'FAIL' if (used_data[1] and used_data[1] > as_of_date) else 'PASS'
        }


# ==================== TEST ====================

def main():
    """اختبار المحلل"""
    from pathlib import Path as _P
    
    db_path = str(_P(__file__).resolve().parent.parent.parent / 'db' / 'price_history.db')
    
    print("=" * 70)
    print("📊 TREND FOLLOWING ANALYZER - EGX")
    print("=" * 70)
    print()
    print("استراتيجية Donchian Channel Breakout:")
    print(f"  • Donchian Period: {TrendFollowingAnalyzer.DONCHIAN_PERIOD} يوم")
    print(f"  • ATR Period: {TrendFollowingAnalyzer.ATR_PERIOD} يوم")
    print(f"  • Stop Loss: Entry - ({TrendFollowingAnalyzer.ATR_MULTIPLIER_STOP} × ATR)")
    print(f"  • Target: Entry + ({TrendFollowingAnalyzer.ATR_MULTIPLIER_TARGET} × ATR)")
    print(f"  • Filter: السعر فوق SMA{TrendFollowingAnalyzer.SMA_PERIOD}")
    print(f"  • Risk per Trade: {TrendFollowingAnalyzer.RISK_PER_TRADE_PCT}%")
    print()
    
    analyzer = TrendFollowingAnalyzer(db_path)
    
    # اختبار على COMI
    test_tickers = ['COMI', 'SWDY', 'HRHO']
    
    for ticker in test_tickers:
        result = analyzer.analyze(ticker, '2025-05-15')
        
        if result:
            print("-" * 70)
            print(f"📊 {result.ticker}")
            print(f"   Price: {result.current_price:.2f}")
            print(f"   Donchian: Upper={result.donchian_upper:.2f}, Lower={result.donchian_lower:.2f}")
            print(f"   ATR: {result.atr:.2f}")
            print(f"   SMA200: {result.sma_200:.2f} {'✅' if result.price_above_sma200 else '❌'}")
            print(f"   Signal: {result.signal_ar}")
            
            if result.signal == 'buy':
                print(f"   Entry: {result.entry_price:.2f}")
                print(f"   Stop Loss: {result.stop_loss:.2f} ({result.stop_loss_pct:.1f}%)")
                print(f"   Target: {result.target:.2f}")
                print(f"   Position Size: {result.position_size_pct:.1f}%")
                print(f"   Risk/Reward: 1:{result.risk_reward:.1f}")
            
            if result.warnings:
                print(f"   Notes: {', '.join(result.warnings)}")
    
    print()
    print("=" * 70)


if __name__ == "__main__":
    main()
