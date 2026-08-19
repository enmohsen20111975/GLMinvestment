# DEPRECATED: This route is not registered in lightweight_server.py
"""
Enhanced EGX System v2 - Backtest API
======================================
نظام التداول المحسن مع 11 عامل

المالك: المستخدم
التاريخ: مايو 2026

القاعدة الذهبية:
- الـ Candlestick Pattern إلزامى للـ BUY
- بدون نموذج شمعي إيجابي = SKIP

v2 Improvements:
- R:R Ratio = 2.0 (was 1.5)
- Tighter stops (5-10% instead of 5-15%)
- Stricter BUY conditions (min candle score = 20)
- RSI check for BUY: must be < 65

Author: دليل الاستثمار
"""

from flask import Blueprint, jsonify, request
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import sqlite3
import json
import math

# Create Blueprint
kimi_bp = Blueprint('kimi_backtest', __name__, url_prefix='/api/kimi')

# Database path
try:
    from config import DATABASE_PATH
except ImportError:
    import os
    from pathlib import Path
    _base_dir = Path(__file__).parent.parent.parent.resolve()
    DATABASE_PATH = os.environ.get('DATABASE_PATH', str(_base_dir / 'db' / 'stocks.db'))


# ============================================================================
# ENHANCED SYSTEM - 11 FACTORS
# ============================================================================

# Factor 1: Personas (الشخصيات)
PERSONAS = {
    'conservative': {'name': 'المحافظ', 'risk_pct': 2, 'rr': 2.0, 'sectors': ['Utilities', 'Banks'], 'frequency': 'monthly'},
    'balanced': {'name': 'المتوازن', 'risk_pct': 3, 'rr': 1.5, 'sectors': ['Utilities', 'Banks', 'Real Estate'], 'frequency': 'weekly'},
    'trader': {'name': 'المضارب', 'risk_pct': 5, 'rr': 1.0, 'sectors': ['Utilities', 'Banks', 'Real Estate', 'Services'], 'frequency': 'daily'},
    'risk_taker': {'name': 'المغامر', 'risk_pct': 7, 'rr': 0.8, 'sectors': ['All', 'Crypto'], 'frequency': 'intraday'},
}

# Factor 2: Sectors (القطاعات)
SECTOR_SCORES = {
    'Banks': {'score': 15, 'type': 'defensive'},
    'Real Estate': {'score': 10, 'type': 'interest_sensitive'},
    'Services': {'score': 5, 'type': 'cyclical'},
    'Industrials': {'score': 0, 'type': 'neutral'},
    'Technology': {'score': -5, 'type': 'high_volatility'},
    'Tourism': {'score': -10, 'type': 'seasonal_risk'},
}

# Factor 3: EGX30 Market Status
EGX30_STATUS = {
    'bull_trend': {'score': 10, 'condition': 'above_ma50_ma200'},
    'bear_trend': {'score': -15, 'condition': 'below_ma50_ma200'},
    'consolidation': {'score': 0, 'condition': 'range_bound'},
    'breakout_up': {'score': 20, 'condition': 'new_20day_high'},
    'breakdown': {'score': -25, 'condition': 'new_20day_low'},
}

# Factor 4: USD/EGP Status
USD_EGP_STATUS = {
    'stable': {'score': 5, 'change': '<1%'},
    'rising': {'score': -10, 'change': '1-3%'},
    'falling': {'score': 15, 'change': 'negative'},
}

# Factor 5: CBE Decisions
CBE_DECISIONS = {
    'rate_cut': {'score': 15, 'impact': 'growth_stimulus'},
    'rate_hike': {'score': -10, 'impact': 'inflation_control'},
    'hold': {'score': 5, 'impact': 'stability'},
}

# Factor 6: Candlestick Patterns (إلزامى للـ BUY)
CANDLESTICK_PATTERNS = {
    'hammer': {'score': 30, 'type': 'bullish_reversal', 'mandatory': True},
    'morning_star': {'score': 35, 'type': 'bullish_reversal', 'mandatory': True},
    'bullish_engulfing': {'score': 25, 'type': 'bullish_reversal', 'mandatory': True},
    'doji': {'score': 5, 'type': 'indecision', 'mandatory': False},
    'shooting_star': {'score': -25, 'type': 'bearish_reversal', 'mandatory': False},
    'evening_star': {'score': -30, 'type': 'bearish_reversal', 'mandatory': False},
    'bearish_engulfing': {'score': -25, 'type': 'bearish_reversal', 'mandatory': False},
    'inverted_hammer': {'score': 15, 'type': 'potential_bullish', 'mandatory': False},
}

# Factor 7: Liquidity (جديد!)
LIQUIDITY_LEVELS = {
    'very_high': {'score': 10, 'daily_volume': 1000000, 'spread': '<0.5%'},
    'high': {'score': 5, 'daily_volume': 500000, 'spread': '0.5-1%'},
    'medium': {'score': 0, 'daily_volume': 100000, 'spread': '1-2%'},
    'low': {'score': -15, 'daily_volume': 0, 'spread': '>2%'},
}

# Factor 8: Seasonality
SEASONALITY_SCORES = {
    1: 10,   # January - January Effect
    2: 5,    # February - momentum continuation
    3: 0,    # March - neutral
    4: 5,    # April - Q1 reports
    5: -5,   # May - Sell in May
    6: -10,  # June - FY end
    7: 0,    # July - Ramadan usually
    8: -5,   # August - vacation season
    9: -10,  # September - September Effect
    10: 5,   # October - season start
    11: 10,  # November - best EGX month
    12: 5,   # December - Window Dressing
}

# Factor 9: News Keywords
NEWS_KEYWORDS = {
    'أرباح قياسية': {'weight': 20, 'type': 'positive'},
    'زيادة رأس المال': {'weight': 10, 'type': 'positive'},
    'توزيعات نقدية': {'weight': 15, 'type': 'positive'},
    'خسائر': {'weight': -20, 'type': 'negative'},
    'تحقيق': {'weight': -15, 'type': 'negative'},
    'تجميد نشاط': {'weight': -25, 'type': 'very_negative'},
}

# ============================================================================
# CONSTANTS - v2 IMPROVED (Now configurable via admin settings)
# ============================================================================

# Default values - can be overridden via admin API
DEFAULT_PARAMS = {
    'rsi_overbought': 70,
    'rsi_extreme_high': 85,
    'rsi_oversold': 30,
    'min_risk_reward': 1.8,
    'min_score_for_signal': 75,
    'min_candle_score': 20,
    'max_rsi_for_buy': 65,
    'stop_loss_min_pct': 5.0,
    'stop_loss_max_pct': 10.0,
    'target_multiplier': 1.8,
}


def get_backtest_params():
    """
    الحصول على معاملات الـ Backtest من الإعدادات.
    يمكن تعديلها من Admin Panel.
    """
    try:
        # Try to import from admin_routes
        from api.admin_routes import get_backtest_params as get_params
        params = get_params()
        if params:
            return params
    except:
        pass
    
    return DEFAULT_PARAMS.copy()


# Dynamic parameters (loaded from admin settings)
def _get_param(key, default=None):
    """الحصول على معامل من الإعدادات."""
    params = get_backtest_params()
    return params.get(key, default if default else DEFAULT_PARAMS.get(key))


# ============================================================================
# TECHNICAL CALCULATIONS
# ============================================================================

def calculate_rsi(prices: List[float], period: int = 14) -> float:
    """حساب RSI"""
    if len(prices) < period + 1:
        return 50.0
    
    gains = []
    losses = []
    
    for i in range(1, len(prices)):
        change = prices[i] - prices[i-1]
        if change > 0:
            gains.append(change)
            losses.append(0)
        else:
            gains.append(0)
            losses.append(abs(change))
    
    if len(gains) < period:
        return 50.0
    
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    
    if avg_loss == 0:
        return 100.0
    
    rs = avg_gain / avg_loss
    rsi = 100 - (100 / (1 + rs))
    
    return round(rsi, 2)


def calculate_sma(prices: List[float], period: int) -> float:
    """حساب المتوسط المتحرك"""
    if len(prices) < period:
        return prices[-1] if prices else 0
    return sum(prices[-period:]) / period


def calculate_ema(prices: List[float], period: int) -> float:
    """حساب EMA"""
    if len(prices) < period:
        return prices[-1] if prices else 0
    
    multiplier = 2 / (period + 1)
    ema = sum(prices[:period]) / period  # Start with SMA
    
    for price in prices[period:]:
        ema = (price - ema) * multiplier + ema
    
    return ema


def calculate_atr(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> float:
    """حساب ATR (Average True Range)"""
    if len(closes) < period + 1:
        # Fallback: use high-low range
        if highs and lows:
            return (max(highs[-5:]) - min(lows[-5:])) / 5 if len(highs) >= 5 else (highs[-1] - lows[-1]) / 2
        return 0.0
    
    true_ranges = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i-1]),
            abs(lows[i] - closes[i-1])
        )
        true_ranges.append(tr)
    
    if len(true_ranges) < period:
        return sum(true_ranges) / len(true_ranges) if true_ranges else 0
    
    return sum(true_ranges[-period:]) / period


def detect_candlestick_pattern(open_prices: List[float], high_prices: List[float], 
                                low_prices: List[float], close_prices: List[float]) -> Dict:
    """
    كشف نموذج الشمعة اليابانية - v2 مع عتبات أعلى
    
    Returns:
        Dict with pattern name, score, and type
    """
    if len(close_prices) < 3:
        return {'pattern': None, 'score': 0, 'type': 'none'}
    
    # Get last 3 candles
    o1, o2, o3 = open_prices[-3], open_prices[-2], open_prices[-1]
    h1, h2, h3 = high_prices[-3], high_prices[-2], high_prices[-1]
    l1, l2, l3 = low_prices[-3], low_prices[-2], low_prices[-1]
    c1, c2, c3 = close_prices[-3], close_prices[-2], close_prices[-1]
    
    body1 = abs(c1 - o1)
    body2 = abs(c2 - o2)
    body3 = abs(c3 - o3)
    
    avg_body = (body1 + body2 + body3) / 3 if (body1 + body2 + body3) > 0 else 0.01
    
    # ========== BULLISH PATTERNS ==========
    
    # Hammer: small body at top, long lower shadow (2.5x body minimum for v2)
    lower_shadow = min(o3, c3) - l3
    if body3 < avg_body * 0.5 and lower_shadow > body3 * 2.5:
        return {'pattern': 'hammer', 'score': 30, 'type': 'bullish', 'mandatory': True}
    
    # Bullish Engulfing: previous bearish, current bullish and engulfs
    if c2 < o2 and c3 > o3 and c3 > o2 and o3 < c2 and body3 > avg_body:
        return {'pattern': 'bullish_engulfing', 'score': 25, 'type': 'bullish', 'mandatory': True}
    
    # Morning Star: bearish, small body, bullish with strong close
    if len(close_prices) >= 3:
        first_bearish = c1 < o1
        small_middle = body2 < avg_body * 0.3
        bullish_close = c3 > o3
        strong_recovery = (c3 - o3) > avg_body * 1.2
        if first_bearish and small_middle and bullish_close and strong_recovery:
            return {'pattern': 'morning_star', 'score': 35, 'type': 'bullish', 'mandatory': True}
    
    # Inverted Hammer: small body at bottom, long upper shadow
    upper_shadow = h3 - max(o3, c3)
    if body3 < avg_body * 0.5 and upper_shadow > body3 * 2:
        return {'pattern': 'inverted_hammer', 'score': 15, 'type': 'potential_bullish', 'mandatory': False}
    
    # ========== BEARISH PATTERNS ==========
    
    # Bearish Engulfing
    if c2 > o2 and c3 < o3 and c3 < o2 and o3 > c2:
        return {'pattern': 'bearish_engulfing', 'score': -25, 'type': 'bearish', 'mandatory': False}
    
    # Evening Star
    if len(close_prices) >= 3:
        first_bullish = c1 > o1
        small_middle = body2 < avg_body * 0.3
        bearish_close = c3 < o3
        if first_bullish and small_middle and bearish_close:
            return {'pattern': 'evening_star', 'score': -30, 'type': 'bearish', 'mandatory': False}
    
    # Doji: open ~= close
    if abs(c3 - o3) < avg_body * 0.1:
        return {'pattern': 'doji', 'score': 5, 'type': 'indecision', 'mandatory': False}
    
    return {'pattern': None, 'score': 0, 'type': 'none', 'mandatory': False}


def calculate_liquidity_score(volume: float, avg_volume: float) -> int:
    """حساب درجة السيولة"""
    if volume >= 1000000:
        return 10
    elif volume >= 500000:
        return 5
    elif volume >= 100000:
        return 0
    else:
        return -15


def calculate_seasonality_score(date: datetime) -> int:
    """حساب درجة الموسمية"""
    return SEASONALITY_SCORES.get(date.month, 0)


# ============================================================================
# ENHANCED SIGNAL GENERATION - v2
# ============================================================================

def calculate_target_stop_enhanced(
    entry_price: float, 
    signal: str,
    rsi: float, 
    atr: float,
    volatility: float,
    persona_rr: float = None  # Now dynamic
) -> Tuple[float, float, float]:
    """
    حساب الهدف والوقف - النسخة المحسنة v3
    
    PROVEN PARAMETERS from Walk-Forward Backtest:
    - stop_loss_pct = 10%
    - target_pct = 8%
    - These can be overridden via admin settings
    """
    # التحقق من وجود قيم ثابتة من الإعدادات
    fixed_stop_loss = _get_param('stop_loss_pct', None)  # قيمة ثابتة من Walk-Forward
    fixed_target = _get_param('target_pct', None)  # قيمة ثابتة من Walk-Forward
    
    # لو فيه قيم ثابتة، استخدمها مباشرة
    if fixed_stop_loss and fixed_target:
        stop_pct = fixed_stop_loss
        target_pct = fixed_target
    else:
        # الطريقة القديمة - حساب ديناميكي
        if persona_rr is None:
            persona_rr = _get_param('min_risk_reward', 1.8)
        stop_loss_min = _get_param('stop_loss_min_pct', 5.0)
        stop_loss_max = _get_param('stop_loss_max_pct', 10.0)
        
        # Calculate stop percentage - TIGHTER in v2
        if atr > 0:
            stop_atr = atr * 1.5  # Reduced from 2.0
            stop_pct_atr = (stop_atr / entry_price) * 100
        else:
            stop_pct_atr = 0
        
        # Volatility-based stop - tighter
        if volatility > 5:
            stop_pct_vol = min(stop_loss_max, volatility * 1.2)
        elif volatility > 3:
            stop_pct_vol = min(stop_loss_max * 0.8, volatility * 1.0)
        elif volatility > 0:
            stop_pct_vol = max(stop_loss_min, volatility * 0.8)
        else:
            stop_pct_vol = stop_loss_min + 1  # Default
        
        # Use the higher of the two, with MIN and MAX from settings
        stop_pct = max(stop_loss_min, stop_pct_atr, stop_pct_vol)
        stop_pct = min(stop_loss_max, stop_pct)
        
        # Target with R/R from settings
        target_pct = stop_pct * persona_rr
    
    if signal == 'BUY':
        target = entry_price * (1 + target_pct / 100)
        stop = entry_price * (1 - stop_pct / 100)
    else:  # SELL
        target = entry_price * (1 - target_pct / 100)
        stop = entry_price * (1 + stop_pct / 100)
    
    return round(target, 3), round(stop, 3), round(target_pct / stop_pct, 2) if stop_pct > 0 else 1.0


def generate_signal_enhanced(
    prices: List[float], 
    highs: List[float], 
    lows: List[float],
    opens: List[float] = None,
    volumes: List[float] = None,
    current_date: datetime = None
) -> Dict:
    """
    توليد إشارة التداول - النسخة المحسنة v2
    
    Parameters now loaded from admin settings!
    """
    # Load dynamic parameters
    rsi_oversold = _get_param('rsi_oversold', 30)
    rsi_overbought = _get_param('rsi_overbought', 70)
    rsi_extreme_high = _get_param('rsi_extreme_high', 85)
    min_score_for_signal = _get_param('min_score_for_signal', 75)
    min_candle_score = _get_param('min_candle_score', 20)
    max_rsi_for_buy = _get_param('max_rsi_for_buy', 65)
    
    if len(prices) < 50:
        return {
            'signal': 'SKIP',
            'score': 0,
            'target': 0,
            'stop': 0,
            'rr': 0,
            'rsi': 50,
            'reason': 'INSUFFICIENT_DATA'
        }
    
    current_date = current_date or datetime.now()
    current_price = prices[-1]
    
    # ========== TECHNICAL INDICATORS ==========
    rsi = calculate_rsi(prices)
    sma_20 = calculate_sma(prices, 20)
    sma_50 = calculate_sma(prices, 50)
    ema_20 = calculate_ema(prices, 20)
    
    atr = calculate_atr(highs, lows, prices)
    
    returns = [(prices[i] - prices[i-1]) / prices[i-1] * 100 
               for i in range(max(1, len(prices)-20), len(prices))]
    volatility = (sum(r**2 for r in returns) / len(returns)) ** 0.5 if returns else 3.0
    
    # ========== CANDLESTICK PATTERN ==========
    if opens and len(opens) >= 3:
        candle_pattern = detect_candlestick_pattern(opens, highs, lows, prices)
    else:
        estimated_opens = [prices[i-1] if i > 0 else prices[0] for i in range(len(prices))]
        candle_pattern = detect_candlestick_pattern(estimated_opens, highs, lows, prices)
    
    candle_score = candle_pattern.get('score', 0)
    candle_type = candle_pattern.get('type', 'none')
    
    # ========== TREND DETECTION ==========
    is_uptrend = current_price > sma_50
    is_strong_uptrend = current_price > sma_20 > sma_50
    is_downtrend = current_price < sma_50
    
    # ========== FACTOR CALCULATION ==========
    score = 50.0
    factors = {'base': 50}
    
    # RSI CONTRIBUTION - using dynamic thresholds
    if rsi <= rsi_oversold:
        score += 25
        factors['rsi'] = 25
    elif rsi <= 40:
        score += 15
        factors['rsi'] = 15
    elif rsi >= rsi_extreme_high:
        score -= 35
        factors['rsi'] = -35
    elif rsi >= rsi_overbought:
        score -= 25
        factors['rsi'] = -25
    elif rsi >= 60:
        score -= 10
        factors['rsi'] = -10
    else:
        factors['rsi'] = 0
    
    # TREND CONTRIBUTION
    if is_strong_uptrend:
        score += 15
        factors['trend'] = 15
    elif is_uptrend:
        score += 5
        factors['trend'] = 5
    elif is_downtrend:
        score -= 20
        factors['trend'] = -20
    else:
        factors['trend'] = 0
    
    # SEASONALITY
    seasonality_score = calculate_seasonality_score(current_date)
    score += seasonality_score
    factors['seasonality'] = seasonality_score
    
    # LIQUIDITY
    if volumes and len(volumes) > 0:
        avg_volume = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else sum(volumes) / len(volumes)
        liquidity_score = calculate_liquidity_score(volumes[-1] if volumes else 0, avg_volume)
    else:
        liquidity_score = 0
    score += liquidity_score
    factors['liquidity'] = liquidity_score
    
    # CANDLESTICK
    score += candle_score
    factors['candlestick'] = candle_score
    
    # ========== SIGNAL DETERMINATION ==========
    
    # 1. SELL: RSI > extreme high
    if rsi >= rsi_extreme_high:
        signal = 'SELL'
        score = min(score, 40)
        reason = f"RSI={rsi:.1f} > {rsi_extreme_high} = Extreme overbought"
        target, stop, rr = calculate_target_stop_enhanced(
            current_price, 'SELL', rsi, atr, volatility
        )
    
    # 2. BUY: STRICT CONDITIONS (using dynamic params)
    elif score >= min_score_for_signal and is_uptrend:
        # MANDATORY: Bullish candlestick
        if candle_type == 'bullish' and candle_score >= min_candle_score:
            # RSI must be below threshold
            if rsi < max_rsi_for_buy:
                signal = 'BUY'
                reason = f"Uptrend + {candle_pattern.get('pattern')} (score={candle_score})"
                target, stop, rr = calculate_target_stop_enhanced(
                    current_price, 'BUY', rsi, atr, volatility
                )
            else:
                signal = 'SKIP'
                reason = f"RSI={rsi:.1f} >= {max_rsi_for_buy} (too high for BUY)"
                target, stop, rr = 0, 0, 0
        else:
            signal = 'SKIP'
            reason = f"No bullish candle (type={candle_type}, score={candle_score} < {min_candle_score})"
            target, stop, rr = 0, 0, 0
    
    # 3. SKIP
    else:
        signal = 'SKIP'
        target, stop, rr = 0, 0, 0
        
        if not is_uptrend:
            reason = "Not in uptrend"
        elif candle_score < min_candle_score:
            reason = f"Candle score={candle_score} < {min_candle_score}"
        else:
            reason = f"Score={score:.0f} < {min_score_for_signal}"
    
    return {
        'signal': signal,
        'score': round(score, 2),
        'target': target,
        'stop': stop,
        'rr': rr,
        'rsi': rsi,
        'volatility': round(volatility, 2),
        'atr': round(atr, 3),
        'is_uptrend': is_uptrend,
        'candle_pattern': candle_pattern.get('pattern'),
        'candle_score': candle_score,
        'factors': factors,
        'reason': reason,
        'params_used': {
            'min_score_for_signal': min_score_for_signal,
            'min_candle_score': min_candle_score,
            'max_rsi_for_buy': max_rsi_for_buy,
            'rsi_extreme_high': rsi_extreme_high,
        }
    }


# ============================================================================
# BACKTEST ENGINE
# ============================================================================

class EnhancedBacktest:
    """محرك الـ Backtest المحسن v3 - مع دعم skip_bear_regime و min_volume_ratio"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._market_regime_cache = {}  # Cache for market regime data
    
    def get_market_regime(self, date: str) -> Dict:
        """
        الحصول على حالة السوق (Market Regime) لتاريخ معين.
        
        Returns:
            Dict with regime info: {'regime': 'bull'|'bear'|'neutral', 'score': int}
        """
        # Check cache first
        if date in self._market_regime_cache:
            return self._market_regime_cache[date]
        
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        # محاولة الحصول على بيانات EGX30
        try:
            # البحث عن بيانات المؤشر
            cursor.execute('''
                SELECT sph.close_price, sph.date
                FROM stock_price_history sph
                JOIN stocks s ON sph.stock_id = s.id
                WHERE s.ticker IN ('EGX30', 'CASE30') 
                AND sph.date <= ?
                ORDER BY sph.date DESC
                LIMIT 60
            ''', (date,))
            
            rows = cursor.fetchall()
            
            if len(rows) >= 50:
                prices = [row['close_price'] for row in reversed(rows)]
                
                # حساب المتوسطات
                sma_20 = sum(prices[-20:]) / 20
                sma_50 = sum(prices[-50:]) / 50
                current_price = prices[-1]
                
                # تحديد الاتجاه
                if current_price > sma_20 > sma_50:
                    regime = 'bull'
                    score = 15
                elif current_price < sma_20 < sma_50:
                    regime = 'bear'
                    score = -15
                else:
                    regime = 'neutral'
                    score = 0
            else:
                # لو مفيش بيانات EGX30، نعتبر السوق محايد
                regime = 'neutral'
                score = 0
        except Exception as e:
            regime = 'neutral'
            score = 0
        
        conn.close()
        
        result = {'regime': regime, 'score': score, 'date': date}
        self._market_regime_cache[date] = result
        return result
    
    def get_stock_history(self, ticker: str, start_date: str, end_date: str) -> List[Dict]:
        """الحصول على تاريخ السهم"""
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        
        history = []
        
        cursor.execute("SELECT id FROM stocks WHERE ticker = ?", (ticker,))
        stock_row = cursor.fetchone()
        stock_id = stock_row['id'] if stock_row else None
        
        if stock_id:
            cursor.execute('''
                SELECT date, open_price, high_price, low_price, close_price, volume
                FROM stock_price_history
                WHERE stock_id = ? AND date >= ? AND date <= ?
                ORDER BY date ASC
            ''', (stock_id, start_date, end_date))
        else:
            cursor.execute('''
                SELECT date, open_price, high_price, low_price, close_price, volume
                FROM stock_price_history
                WHERE stock_id = (SELECT id FROM stocks WHERE ticker = ?)
                AND date >= ? AND date <= ?
                ORDER BY date ASC
            ''', (ticker, start_date, end_date))
        
        for row in cursor.fetchall():
            history.append({
                'date': row['date'],
                'open': row['open_price'] or row['close_price'] or 0,
                'high': row['high_price'] or row['close_price'] or 0,
                'low': row['low_price'] or row['close_price'] or 0,
                'close': row['close_price'] or 0,
                'volume': row['volume'] or 0,
            })
        
        conn.close()
        return history
    
    def get_all_tickers(self) -> List[str]:
        """الحصول على كل الرموز"""
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT ticker FROM stocks WHERE is_active = 1 OR is_active IS NULL")
        tickers = [row[0] for row in cursor.fetchall()]
        conn.close()
        return tickers
    
    def find_monday_dates(self, start_year: int, start_month: int, num_weeks: int) -> List[str]:
        """إيجاد تواريخ الاثنين"""
        mondays = []
        date = datetime(start_year, start_month, 1)
        
        while len(mondays) < num_weeks:
            if date.weekday() == 0:  # Monday
                mondays.append(date.strftime('%Y-%m-%d'))
            date += timedelta(days=1)
        
        return mondays
    
    def run_backtest(self, start_year: int = 2026, start_month: int = 1, 
                     num_weeks: int = 8, max_picks_per_week: int = 3) -> Dict:
        """
        تشغيل Backtest - النسخة المحسنة v3
        
        جديد:
        - skip_bear_regime: تخطي إشارات الشراء في السوق الهابط
        - min_volume_ratio: الحد الأدنى لنسبة حجم التداول
        - stop_loss_pct و target_pct: قيم ثابتة من Walk-Forward Backtest
        """
        mondays = self.find_monday_dates(start_year, start_month, num_weeks)
        
        if not mondays:
            return {'success': False, 'error': 'No Mondays found'}
        
        # تحميل المعاملات من الإعدادات
        skip_bear_regime = _get_param('skip_bear_regime', False)
        min_volume_ratio = _get_param('min_volume_ratio', 0)
        stop_loss_pct = _get_param('stop_loss_pct', None)
        target_pct = _get_param('target_pct', None)
        
        print(f"[ENHANCED v3] Parameters: skip_bear={skip_bear_regime}, vol_ratio={min_volume_ratio}, SL={stop_loss_pct}%, TP={target_pct}%")
        
        tickers = self.get_all_tickers()
        print(f"[ENHANCED v3] Found {len(tickers)} tickers")
        
        all_trades = []
        weekly_results = []
        skipped_bear_weeks = 0
        
        for week_num, monday in enumerate(mondays, 1):
            print(f"[ENHANCED v3] Week {week_num}: {monday}")
            
            # التحقق من حالة السوق
            market_regime = self.get_market_regime(monday)
            print(f"  Market Regime: {market_regime['regime']} (score: {market_regime['score']})")
            
            # لو skip_bear_regime مفعّل والسوق هابط، نتخطى إشارات الشراء
            skip_buy_this_week = skip_bear_regime and market_regime['regime'] == 'bear'
            if skip_buy_this_week:
                skipped_bear_weeks += 1
                print(f"  ⚠️ Skipping BUY signals (bear market)")
            
            monday_date = datetime.strptime(monday, '%Y-%m-%d')
            next_monday = (monday_date + timedelta(days=7)).strftime('%Y-%m-%d')
            lookback_date = (monday_date - timedelta(days=365)).strftime('%Y-%m-%d')
            
            signals_found = {'BUY': [], 'SELL': []}
            
            for ticker in tickers:
                try:
                    history = self.get_stock_history(ticker, lookback_date, monday)
                    
                    if len(history) < 50:
                        continue
                    
                    prices = [h['close'] for h in history if h['close'] > 0]
                    highs = [h['high'] for h in history if h['high'] > 0]
                    lows = [h['low'] for h in history if h['low'] > 0]
                    opens = [h['open'] for h in history if h['open'] > 0]
                    volumes = [h['volume'] for h in history if h['volume'] > 0]
                    
                    if not prices or prices[-1] <= 0:
                        continue
                    
                    # التحقق من min_volume_ratio
                    if min_volume_ratio > 0 and volumes:
                        avg_volume = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else sum(volumes) / len(volumes)
                        current_volume = volumes[-1] if volumes else 0
                        volume_ratio = current_volume / avg_volume if avg_volume > 0 else 0
                        
                        if volume_ratio < min_volume_ratio:
                            continue  # تخطي السهم لقلة السيولة
                    
                    signal_data = generate_signal_enhanced(
                        prices, highs, lows, opens, volumes, monday_date
                    )
                    
                    # تخطي إشارات الشراء في السوق الهابط
                    if skip_buy_this_week and signal_data['signal'] == 'BUY':
                        continue
                    
                    if signal_data['signal'] in signals_found:
                        signals_found[signal_data['signal']].append({
                            'ticker': ticker,
                            'score': signal_data['score'],
                            'signal': signal_data['signal'],
                            'entry_price': prices[-1],
                            'target': signal_data['target'],
                            'stop': signal_data['stop'],
                            'rr': signal_data['rr'],
                            'rsi': signal_data['rsi'],
                            'candle_pattern': signal_data.get('candle_pattern'),
                            'candle_score': signal_data.get('candle_score', 0),
                        })
                except Exception as e:
                    continue
            
            # Get top picks: 2 BUY + 1 SELL
            weekly_picks = []
            
            if signals_found['BUY']:
                sorted_buys = sorted(signals_found['BUY'], key=lambda x: x['score'], reverse=True)
                weekly_picks.extend(sorted_buys[:2])
            
            if signals_found['SELL']:
                sorted_sells = sorted(signals_found['SELL'], key=lambda x: x['score'])
                weekly_picks.append(sorted_sells[0])
            
            print(f"  Picks: {len(weekly_picks)} (BUY: {len(signals_found['BUY'])}, SELL: {len(signals_found['SELL'])})")
            
            for pick in weekly_picks:
                ticker = pick['ticker']
                entry_price = pick['entry_price']
                target = pick['target']
                stop = pick['stop']
                signal = pick['signal']
                
                next_week_history = self.get_stock_history(ticker, monday, next_monday)
                
                if not next_week_history:
                    continue
                
                exit_price = next_week_history[-1]['close']
                week_high = max(h['high'] for h in next_week_history if h['high'] > 0)
                week_low = min(h['low'] for h in next_week_history if h['low'] > 0)
                
                if signal == 'BUY':
                    if target > 0 and week_high >= target:
                        result = 'TARGET_HIT'
                        exit_price = target
                    elif stop > 0 and week_low <= stop:
                        result = 'STOP_LOSS'
                        exit_price = stop
                    else:
                        result = 'TIMEOUT'
                    pnl_pct = (exit_price - entry_price) / entry_price * 100
                
                else:  # SELL
                    target_sell = target if target > 0 else entry_price * 0.88
                    stop_sell = stop if stop > 0 else entry_price * 1.08
                    
                    if target_sell > 0 and week_low <= target_sell:
                        result = 'TARGET_HIT'
                        exit_price = target_sell
                    elif stop_sell > 0 and week_high >= stop_sell:
                        result = 'STOP_LOSS'
                        exit_price = stop_sell
                    else:
                        result = 'TIMEOUT'
                    pnl_pct = (entry_price - exit_price) / entry_price * 100
                
                trade = {
                    'week': week_num,
                    'date': monday,
                    'ticker': ticker,
                    'signal': signal,
                    'entry_price': round(entry_price, 3),
                    'target': round(target, 3),
                    'stop': round(stop, 3),
                    'exit_price': round(exit_price, 3),
                    'exit_date': next_week_history[-1]['date'],
                    'result': result,
                    'pnl_pct': round(pnl_pct, 2),
                    'rr': pick['rr'],
                    'rsi': pick['rsi'],
                    'score': pick['score'],
                    'candle_pattern': pick.get('candle_pattern'),
                }
                
                all_trades.append(trade)
            
            weekly_results.append({
                'week': week_num,
                'date': monday,
                'picks': len(weekly_picks),
            })
        
        # Calculate statistics
        if not all_trades:
            return {'success': True, 'all_trades': [], 'statistics': {}}
        
        wins = [t for t in all_trades if t['pnl_pct'] > 0]
        losses = [t for t in all_trades if t['pnl_pct'] <= 0]
        
        total_trades = len(all_trades)
        win_count = len(wins)
        loss_count = len(losses)
        
        win_rate = (win_count / total_trades * 100) if total_trades > 0 else 0
        
        total_profit = sum(t['pnl_pct'] for t in wins) if wins else 0
        total_loss = abs(sum(t['pnl_pct'] for t in losses)) if losses else 0.01
        profit_factor = total_profit / total_loss if total_loss > 0 else 0
        
        avg_win = total_profit / win_count if win_count > 0 else 0
        avg_loss = total_loss / loss_count if loss_count > 0 else 0
        
        # Max Drawdown
        cumulative_pnl = 0
        max_cumulative = 0
        max_drawdown = 0
        
        for trade in all_trades:
            cumulative_pnl += trade['pnl_pct']
            if cumulative_pnl > max_cumulative:
                max_cumulative = cumulative_pnl
            drawdown = max_cumulative - cumulative_pnl
            if drawdown > max_drawdown:
                max_drawdown = drawdown
        
        # By signal type
        by_signal = {}
        for sig in ['BUY', 'SELL']:
            signal_trades = [t for t in all_trades if t['signal'] == sig]
            signal_wins = [t for t in signal_trades if t['pnl_pct'] > 0]
            by_signal[sig] = {
                'total': len(signal_trades),
                'wins': len(signal_wins),
                'win_rate': round(len(signal_wins) / len(signal_trades) * 100, 1) if signal_trades else 0,
                'avg_pnl': round(sum(t['pnl_pct'] for t in signal_trades) / len(signal_trades), 2) if signal_trades else 0,
                'total_pnl': round(sum(t['pnl_pct'] for t in signal_trades), 2) if signal_trades else 0,
            }
        
        # Decision
        if win_rate > 60 and profit_factor > 1.5:
            decision = '✅ ننشر فوراً'
            status = 'PUBLISH_NOW'
        elif win_rate >= 55 and profit_factor >= 1.3:
            decision = '⚠️ ننشر بحذر'
            status = 'PUBLISH_CAUTIOUS'
        elif win_rate >= 50 and profit_factor >= 1.0:
            decision = '❌ نعدل تاني'
            status = 'ADJUST'
        else:
            decision = '❌❌ نراجع النظام كله'
            status = 'OVERHAUL'
        
        return {
            'success': True,
            'version': 'ENHANCED_v3_With_Regime_Filter',
            'all_trades': all_trades,
            'weekly_results': weekly_results,
            'statistics': {
                'total_trades': total_trades,
                'win_rate': round(win_rate, 2),
                'profit_factor': round(profit_factor, 2),
                'wins': win_count,
                'losses': loss_count,
                'avg_win': round(avg_win, 2),
                'avg_loss': round(avg_loss, 2),
                'max_drawdown': round(max_drawdown, 2),
                'by_signal': by_signal,
                'skipped_bear_weeks': skipped_bear_weeks,
            },
            'decision': decision,
            'status': status,
            'params_used': {
                'skip_bear_regime': skip_bear_regime,
                'min_volume_ratio': min_volume_ratio,
                'stop_loss_pct': stop_loss_pct,
                'target_pct': target_pct,
                'weeks_tested': num_weeks,
            }
        }


# ============================================================================
# API ENDPOINTS
# ============================================================================

@kimi_bp.route('/backtest/run', methods=['GET'])
def run_backtest():
    """تشغيل Backtest المحسن v2"""
    try:
        engine = EnhancedBacktest(DATABASE_PATH)
        results = engine.run_backtest()
        return jsonify(results)
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500


@kimi_bp.route('/backtest/run-enhanced', methods=['GET'])
def run_enhanced_backtest():
    """تشغيل Backtest مع معاملات"""
    try:
        start_year = int(request.args.get('year', 2026))
        start_month = int(request.args.get('month', 1))
        num_weeks = int(request.args.get('weeks', 8))
        
        engine = EnhancedBacktest(DATABASE_PATH)
        results = engine.run_backtest(start_year, start_month, num_weeks)
        return jsonify(results)
    except Exception as e:
        import traceback
        return jsonify({
            'success': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }), 500


@kimi_bp.route('/backtest/debug-schema', methods=['GET'])
def debug_schema():
    """فحص هيكل قاعدة البيانات"""
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()
        
        cursor.execute("PRAGMA table_info(stock_price_history)")
        columns = cursor.fetchall()
        
        cursor.execute("SELECT * FROM stock_price_history LIMIT 3")
        sample = cursor.fetchall()
        
        cursor.execute("PRAGMA table_info(stocks)")
        stocks_columns = cursor.fetchall()
        
        cursor.execute("SELECT id, ticker, name FROM stocks LIMIT 5")
        sample_stocks = cursor.fetchall()
        
        conn.close()
        
        return jsonify({
            'success': True,
            'stock_price_history': {
                'columns': [c[1] for c in columns],
                'sample': sample,
            },
            'stocks': {
                'columns': [c[1] for c in stocks_columns],
                'sample': sample_stocks,
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@kimi_bp.route('/backtest/available-dates', methods=['GET'])
def available_dates():
    """فحص البيانات المتاحة"""
    try:
        conn = sqlite3.connect(DATABASE_PATH)
        cursor = conn.cursor()
        
        cursor.execute('SELECT MIN(date), MAX(date), COUNT(*) FROM stock_price_history')
        row = cursor.fetchone()
        
        min_date, max_date, total_records = row if row else (None, None, 0)
        
        cursor.execute('SELECT COUNT(*) FROM stocks WHERE is_active = 1 OR is_active IS NULL')
        stocks_count = cursor.fetchone()[0]
        
        conn.close()
        
        return jsonify({
            'success': True,
            'data_range': {
                'min_date': min_date,
                'max_date': max_date,
                'total_records': total_records,
                'stocks_count': stocks_count,
            },
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500


@kimi_bp.route('/backtest/january-2026', methods=['GET'])
def backtest_january_2026():
    """Backtest على يناير 2026"""
    return run_backtest()


@kimi_bp.route('/backtest/custom', methods=['POST'])
def custom_backtest():
    """Backtest مخصص"""
    try:
        data = request.get_json() or {}
        engine = EnhancedBacktest(DATABASE_PATH)
        results = engine.run_backtest()
        return jsonify(results)
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500
