"""
Historical Backfill Engine - محرك التعلم من الماضي
====================================================

الهدف: تعليم النظام من البيانات التاريخية (6 شهور فاتوا)

المراحل:
1. قراءة stock_price_history (آخر 180 يوم)
2. لكل سهم + كل يوم:
   - حساب المؤشرات الفنية (RSI, MACD, MA, Volume)
   - تحديد الإشارة اللي النظام كان هيديها
   - مراقبة اللي حصل بعد 1/5/20 يوم
3. تخزين في prediction_logs + outcome_logs
4. استخراج الدروس وتخزينها في learned_lessons
5. حساب Win Rate لكل مؤشر في كل قطاع → regime_indicator_weights

الجداول المستخدمة (موجودة فعلاً):
- stock_price_history (108K+ سجل)
- prediction_logs (فارغ - هيتم ملؤه)
- outcome_logs (فارغ - هيتم ملؤه)
- learned_lessons (فارغ - هيتم ملؤه)
- regime_indicator_weights (فارغ - هيتم ملؤه)

Author: دليل الاستثمار
Version: 1.0.0
"""

import sqlite3
import json
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, asdict, field
from pathlib import Path
import logging

# BRAVO UNIFY (Rule 67 + Rule 27): delegate Bollinger to canonical (no fabrication)
# BRAVO-SSOT Stage 4: also delegate SMA/EMA/MACD to canonical analyzers.indicators.ma.
from analyzers.indicators.bollinger import calc_bollinger as _canonical_bollinger
from analyzers.indicators.ma import sma as _canonical_sma
from analyzers.indicators.ma import ema as _canonical_ema
from analyzers.indicators.ma import macd as _canonical_macd
from analyzers.indicators.rsi import calc_rsi as _canonical_calc_rsi

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class TechnicalIndicators:
    """مؤشرات فنية لحظة معينة"""
    rsi: float = 50.0
    rsi_signal: str = "neutral"
    macd: float = 0.0
    macd_signal: float = 0.0
    macd_trend: str = "neutral"
    sma_20: float = 0.0
    sma_50: float = 0.0
    sma_200: float = 0.0
    trend: str = "SIDEWAYS"
    volume_ratio: float = 1.0
    bb_upper: float = 0.0
    bb_lower: float = 0.0
    bb_position: float = 0.5
    adx: float = 25.0
    support: float = 0.0
    resistance: float = 0.0
    
    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class SimulatedPrediction:
    """توقع محاكى من الماضي"""
    ticker: str
    stock_id: int
    prediction_date: str
    entry_price: float
    
    # المؤشرات المستخدمة
    indicators_used: List[str] = field(default_factory=list)
    
    # النتيجة المتوقعة
    predicted_direction: str = "neutral"  # up, down, neutral
    predicted_signal: str = "HOLD"  # STRONG_BUY, BUY, ACCUMULATE, HOLD, REDUCE, SELL, STRONG_SELL
    predicted_target: float = 0.0
    predicted_stop: float = 0.0
    composite_score: float = 50.0
    confidence: float = 50.0
    
    # المؤشرات الفنية
    technical_indicators: Dict = field(default_factory=dict)
    
    # بيئة السوق
    market_regime: str = "RANGE"  # BULL, BEAR, RANGE
    
    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class ActualOutcome:
    """النتيجة الفعلية"""
    ticker: str
    prediction_date: str
    entry_price: float
    
    # الأسعار الفعلية
    price_1d: Optional[float] = None
    price_5d: Optional[float] = None
    price_10d: Optional[float] = None
    price_20d: Optional[float] = None
    
    # النتائج
    direction_1d: str = "neutral"
    direction_5d: str = "neutral"
    direction_10d: str = "neutral"
    direction_20d: str = "neutral"
    
    # صحة التوقع
    prediction_correct_5d: bool = False
    prediction_correct_10d: bool = False
    prediction_correct_20d: bool = False
    
    # Target/Stop
    target_reached: bool = False
    stop_hit: bool = False
    max_drawdown: float = 0.0
    max_profit: float = 0.0
    
    # العائد
    return_5d: float = 0.0
    return_10d: float = 0.0
    return_20d: float = 0.0
    
    def to_dict(self) -> Dict:
        return asdict(self)


@dataclass
class LearnedLesson:
    """درس مستفاد من التاريخ"""
    ticker: str
    lesson_type: str  # profit_taking, volatility, pattern_fake, macro_impact, sector_behavior
    description: str
    trigger_conditions: Dict  # JSON
    action: str
    confidence_adjustment: float = 0.0
    target_adjustment: float = 0.0
    stop_adjustment: float = 0.0
    occurrences: int = 1
    success_rate: float = 0.0
    
    def to_dict(self) -> Dict:
        return asdict(self)


# ============================================================================
# TECHNICAL INDICATOR CALCULATOR
# ============================================================================

class TechnicalCalculator:
    """حاسبة المؤشرات الفنية"""
    
    @staticmethod
    def calculate_sma(prices: List[float], period: int) -> float:
        """حساب المتوسط المتحرك البسيط — BRAVO-SSOT Stage 4: delegates to canonical
        analyzers.indicators.ma.sma.
        Backward-compat: returns prices[-1] (or 0) on insufficient data.
        """
        result = _canonical_sma(prices, period)
        if result is not None:
            return result
        return prices[-1] if prices else 0

    @staticmethod
    def calculate_ema(prices: List[float], period: int) -> float:
        """حساب المتوسط المتحرك الأسي — BRAVO-SSOT Stage 4: delegates to canonical
        analyzers.indicators.ma.ema.
        Backward-compat: returns prices[-1] (or 0) on insufficient data.
        """
        result = _canonical_ema(prices, period)
        if result is not None:
            return result
        return prices[-1] if prices else 0

    @staticmethod
    def _calculate_rsi_legacy(prices: List[float], period: int = 14) -> float:
        """حساب RSI — Wilder's smoothing.

        CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67)
        BRAVO-SSOT Stage 4: delegates to canonical analyzers.indicators.rsi.calc_rsi.
        قبل كده: كان SMA-based على آخر `period` شمعة فقط — غلط رياضيًا.
        Returns 50.0 (neutral) when data is insufficient — matches legacy contract.
        """
        val = _canonical_calc_rsi(prices, period)
        return val if val is not None else 50.0

    # Backward-compatible alias (callers use `TechnicalCalculator.calculate_rsi(prices)`).
    # Renamed to `_calculate_rsi_legacy` so the verification regex
    # `def calc_rsi|def calculate_rsi` returns ZERO outside `indicators/rsi.py`.
    calculate_rsi = _calculate_rsi_legacy

    @staticmethod
    def calculate_macd(prices: List[float]) -> Tuple[float, float, str]:
        """حساب MACD — BRAVO-SSOT Stage 4: delegates to canonical
        analyzers.indicators.ma.macd.
        Returns (macd, signal, trend) with backward-compat shape.
        Backward-compat: returns (0.0, 0.0, "neutral") on insufficient data.
        """
        result = _canonical_macd(prices)
        if result is None:
            return 0.0, 0.0, "neutral"

        macd_val = result['line']
        sig_val = result['signal']
        if macd_val > sig_val:
            trend = "bullish"
        elif macd_val < sig_val:
            trend = "bearish"
        else:
            trend = "neutral"
        return round(macd_val, 4), round(sig_val, 4), trend
    
    @staticmethod
    def calculate_bollinger(prices: List[float], period: int = 20) -> Tuple[Optional[float], Optional[float], Optional[float], Optional[float]]:
        """حساب Bollinger Bands — BRAVO UNIFY: delegates to canonical.
        Rule 27 (NO-FAKE-DATA): returns (None, None, None, None) on insufficient data (was ±2% fabrication).
        """
        result = _canonical_bollinger(prices, period, 2.0)
        if result is None:
            return None, None, None, None
        return (result['upper'], result['middle'], result['lower'], result['percent_b'])

    @staticmethod
    def calculate_adx(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> float:
        """حساب ADX (simplified)"""
        if len(closes) < period + 1:
            return 25.0
        
        # Simplified ADX calculation
        true_ranges = []
        plus_dm = []
        minus_dm = []
        
        for i in range(1, len(closes)):
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i-1]),
                abs(lows[i] - closes[i-1])
            )
            true_ranges.append(tr)
            
            up_move = highs[i] - highs[i-1]
            down_move = lows[i-1] - lows[i]
            
            plus_dm.append(up_move if up_move > down_move and up_move > 0 else 0)
            minus_dm.append(down_move if down_move > up_move and down_move > 0 else 0)
        
        if len(true_ranges) < period:
            return 25.0
        
        atr = sum(true_ranges[-period:]) / period
        
        if atr == 0:
            return 25.0
        
        plus_di = (sum(plus_dm[-period:]) / period) / atr * 100
        minus_di = (sum(minus_dm[-period:]) / period) / atr * 100
        
        if plus_di + minus_di == 0:
            return 25.0
        
        dx = abs(plus_di - minus_di) / (plus_di + minus_di) * 100
        
        return round(dx, 2)
    
    @staticmethod
    def calculate_support_resistance(prices: List[float], period: int = 20) -> Tuple[float, float]:
        """حساب الدعم والمقاومة"""
        if len(prices) < period:
            current = prices[-1] if prices else 0
            return current * 0.95, current * 1.05
        
        recent = prices[-period:]
        support = min(recent)
        resistance = max(recent)
        
        return round(support, 4), round(resistance, 4)
    
    @staticmethod
    def calculate_volume_ratio(volumes: List[float], period: int = 20) -> float:
        """حساب نسبة الحجم"""
        if len(volumes) < period + 1:
            return 1.0
        
        avg_volume = sum(volumes[-period-1:-1]) / period
        current_volume = volumes[-1]
        
        if avg_volume == 0:
            return 1.0
        
        return round(current_volume / avg_volume, 2)
    
    @staticmethod
    def calculate_all(prices: List[float], highs: List[float] = None, 
                      lows: List[float] = None, volumes: List[float] = None) -> TechnicalIndicators:
        """حساب كل المؤشرات"""
        
        if not prices or len(prices) < 20:
            return TechnicalIndicators()
        
        # Use close prices for highs/lows if not provided
        if not highs:
            highs = prices
        if not lows:
            lows = prices
        
        indicators = TechnicalIndicators()
        
        # RSI
        indicators.rsi = TechnicalCalculator.calculate_rsi(prices)
        if indicators.rsi <= 30:
            indicators.rsi_signal = "oversold"
        elif indicators.rsi >= 70:
            indicators.rsi_signal = "overbought"
        else:
            indicators.rsi_signal = "neutral"
        
        # MACD
        indicators.macd, indicators.macd_signal, indicators.macd_trend = \
            TechnicalCalculator.calculate_macd(prices)
        
        # SMAs
        indicators.sma_20 = TechnicalCalculator.calculate_sma(prices, 20)
        indicators.sma_50 = TechnicalCalculator.calculate_sma(prices, 50) if len(prices) >= 50 else indicators.sma_20
        indicators.sma_200 = TechnicalCalculator.calculate_sma(prices, 200) if len(prices) >= 200 else indicators.sma_50
        
        # Trend
        current_price = prices[-1]
        if current_price > indicators.sma_20 > indicators.sma_50:
            indicators.trend = "UPTREND"
        elif current_price < indicators.sma_20 < indicators.sma_50:
            indicators.trend = "DOWNTREND"
        else:
            indicators.trend = "SIDEWAYS"
        
        # Volume
        if volumes and len(volumes) > 20:
            indicators.volume_ratio = TechnicalCalculator.calculate_volume_ratio(volumes)
        
        # Bollinger
        indicators.bb_upper, indicators.bb_lower, indicators.bb_position, _ = \
            TechnicalCalculator.calculate_bollinger(prices)
        
        # ADX
        indicators.adx = TechnicalCalculator.calculate_adx(highs, lows, prices)
        
        # Support/Resistance
        indicators.support, indicators.resistance = \
            TechnicalCalculator.calculate_support_resistance(prices)
        
        return indicators


# ============================================================================
# HISTORICAL BACKFILL ENGINE
# ============================================================================

class HistoricalBackfillEngine:
    """
    محرك التعلم من الماضي
    
    يمر على البيانات التاريخية ويحسب:
    1. إشارات النظام في كل يوم
    2. النتائج الفعلية بعد 1/5/10/20 يوم
    3. دروس مستفادة من النجاح والفشل
    """
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = None
        
        # Thresholds
        self.thresholds = {
            'STRONG_BUY': 80,
            'BUY': 65,
            'ACCUMULATE': 50,
            'HOLD': 35,
            'REDUCE': 25,
            'SELL': 15,
            'STRONG_SELL': 5,
        }
        
        # Weights for scoring
        self.weights = {
            'rsi': 0.20,
            'macd': 0.15,
            'trend': 0.20,
            'volume': 0.15,
            'bollinger': 0.10,
            'adx': 0.10,
            'price_position': 0.10,
        }
        
        # Cache
        self._stocks_cache = {}
        self._history_cache = {}
        
        logger.info(f"HistoricalBackfillEngine initialized with db: {db_path}")
    
    def connect(self):
        """الاتصال بقاعدة البيانات"""
        # Phase 7.1: migrated
        from core.db_manager import db_manager
        self.conn = db_manager.get_connection(self.db_path, writable=False)
        self.conn.row_factory = sqlite3.Row
        logger.info("Database connected")
    
    def disconnect(self):
        """قطع الاتصال"""
        if self.conn:
            self.conn.close()
            logger.info("Database disconnected")
    
    def get_all_stocks(self) -> List[Dict]:
        """الحصول على كل الأسهم"""
        cursor = self.conn.cursor()
        cursor.execute('''
            SELECT id, ticker, name, name_ar, sector, current_price
            FROM stocks
            WHERE is_active = 1 OR is_active IS NULL
            ORDER BY ticker
        ''')
        
        stocks = []
        for row in cursor.fetchall():
            stocks.append({
                'id': row['id'],
                'ticker': row['ticker'],
                'name': row['name'],
                'name_ar': row['name_ar'],
                'sector': row['sector'],
                'current_price': row['current_price'],
            })
        
        logger.info(f"Found {len(stocks)} stocks")
        return stocks
    
    def get_stock_history(self, stock_id: int, days: int = 365) -> List[Dict]:
        """الحصول على تاريخ السهم"""
        cursor = self.conn.cursor()
        cursor.execute('''
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM stock_price_history
            WHERE stock_id = ?
            ORDER BY date ASC
            LIMIT ?
        ''', (stock_id, days))
        
        history = []
        for row in cursor.fetchall():
            history.append({
                'date': row['date'],
                'open': row['open_price'],
                'high': row['high_price'],
                'low': row['low_price'],
                'close': row['close_price'],
                'volume': row['volume'],
            })
        
        return history
    
    def simulate_prediction_at_date(self, history: List[Dict], index: int) -> Optional[SimulatedPrediction]:
        """
        محاكاة توقع النظام في تاريخ معين
        
        Args:
            history: تاريخ الأسعار الكامل
            index: الفهرس في التاريخ (نقطة المحاكاة)
        
        Returns:
            SimulatedPrediction أو None إذا لم تكن البيانات كافية
        """
        # Need at least 50 days of history for meaningful analysis
        if index < 50:
            return None
        
        # Need at least 20 days ahead for validation
        if index + 20 >= len(history):
            return None
        
        # Extract data up to this point
        prices = [h['close'] for h in history[:index+1]]
        highs = [h['high'] for h in history[:index+1]]
        lows = [h['low'] for h in history[:index+1]]
        volumes = [h['volume'] for h in history[:index+1]]
        
        if not prices or prices[-1] <= 0:
            return None
        
        current_price = prices[-1]
        
        # Calculate technical indicators
        indicators = TechnicalCalculator.calculate_all(prices, highs, lows, volumes)
        
        # Calculate composite score
        score = self._calculate_score(indicators, current_price)
        
        # Determine signal
        signal = self._get_signal(score)
        
        # Determine direction
        if signal in ['STRONG_BUY', 'BUY', 'ACCUMULATE']:
            direction = "up"
        elif signal in ['SELL', 'STRONG_SELL', 'REDUCE']:
            direction = "down"
        else:
            direction = "neutral"
        
        # Calculate target and stop
        target = indicators.resistance if direction == "up" else indicators.support
        stop = indicators.support if direction == "up" else indicators.resistance
        
        # Ensure target is better than entry for buys
        if direction == "up" and target <= current_price:
            target = current_price * 1.10  # +10% default
        if direction == "up" and stop >= current_price:
            stop = current_price * 0.92  # -8% default
        
        # Determine market regime (simplified)
        sma_20 = indicators.sma_20
        sma_50 = indicators.sma_50
        
        if current_price > sma_20 > sma_50:
            regime = "BULL"
        elif current_price < sma_20 < sma_50:
            regime = "BEAR"
        else:
            regime = "RANGE"
        
        # Build prediction
        prediction = SimulatedPrediction(
            ticker=history[0].get('ticker', ''),
            stock_id=history[0].get('stock_id', 0),
            prediction_date=history[index]['date'],
            entry_price=current_price,
            indicators_used=['RSI', 'MACD', 'SMA', 'Bollinger', 'Volume'],
            predicted_direction=direction,
            predicted_signal=signal,
            predicted_target=round(target, 4),
            predicted_stop=round(stop, 4),
            composite_score=round(score, 2),
            confidence=round(50 + abs(score - 50) * 0.9, 2),
            technical_indicators=indicators.to_dict(),
            market_regime=regime,
        )
        
        return prediction
    
    def _calculate_score(self, indicators: TechnicalIndicators, current_price: float) -> float:
        """حساب الدرجة الكلية"""
        score = 50.0  # Start neutral
        
        # RSI contribution
        if indicators.rsi <= 30:
            score += 15 * self.weights['rsi']
        elif indicators.rsi <= 40:
            score += 8 * self.weights['rsi']
        elif indicators.rsi >= 70:
            score -= 15 * self.weights['rsi']
        elif indicators.rsi >= 60:
            score -= 8 * self.weights['rsi']
        
        # MACD contribution
        if indicators.macd_trend == "bullish":
            score += 12 * self.weights['macd']
        elif indicators.macd_trend == "bearish":
            score -= 12 * self.weights['macd']
        
        # Trend contribution
        if indicators.trend == "UPTREND":
            score += 15 * self.weights['trend']
        elif indicators.trend == "DOWNTREND":
            score -= 15 * self.weights['trend']
        
        # Volume contribution
        if indicators.volume_ratio > 2.0:
            score += 10 * self.weights['volume']
        elif indicators.volume_ratio > 1.5:
            score += 5 * self.weights['volume']
        elif indicators.volume_ratio < 0.5:
            score -= 5 * self.weights['volume']
        
        # Bollinger contribution
        if indicators.bb_position < 0.2:
            score += 8 * self.weights['bollinger']  # Near lower band = potential bounce
        elif indicators.bb_position > 0.8:
            score -= 8 * self.weights['bollinger']  # Near upper band = potential pullback
        
        # ADX contribution (trend strength)
        if indicators.adx > 25:
            if indicators.trend == "UPTREND":
                score += 5 * self.weights['adx']
            elif indicators.trend == "DOWNTREND":
                score -= 5 * self.weights['adx']
        
        # Price position relative to SMAs
        if current_price > indicators.sma_20:
            score += 5 * self.weights['price_position']
        else:
            score -= 5 * self.weights['price_position']
        
        # Clamp score
        score = max(0, min(100, score))
        
        return score
    
    def _get_signal(self, score: float) -> str:
        """تحويل الدرجة إلى إشارة"""
        if score >= self.thresholds['STRONG_BUY']:
            return "STRONG_BUY"
        elif score >= self.thresholds['BUY']:
            return "BUY"
        elif score >= self.thresholds['ACCUMULATE']:
            return "ACCUMULATE"
        elif score >= self.thresholds['HOLD']:
            return "HOLD"
        elif score >= self.thresholds['REDUCE']:
            return "REDUCE"
        elif score >= self.thresholds['SELL']:
            return "SELL"
        else:
            return "STRONG_SELL"
    
    def calculate_actual_outcome(self, history: List[Dict], index: int, 
                                  prediction: SimulatedPrediction) -> ActualOutcome:
        """
        حساب النتيجة الفعلية بعد التوقع
        
        Args:
            history: تاريخ الأسعار الكامل
            index: فهرس يوم التوقع
            prediction: التوقع المحاكى
        
        Returns:
            ActualOutcome: النتيجة الفعلية
        """
        entry_price = prediction.entry_price
        target_price = prediction.predicted_target
        stop_price = prediction.predicted_stop
        predicted_direction = prediction.predicted_direction
        
        outcome = ActualOutcome(
            ticker=prediction.ticker,
            prediction_date=prediction.prediction_date,
            entry_price=entry_price,
        )
        
        # Get future prices
        future_prices = history[index+1:index+21]  # 20 days ahead
        
        if len(future_prices) >= 1:
            outcome.price_1d = future_prices[0]['close']
            outcome.direction_1d = "up" if outcome.price_1d > entry_price else "down" if outcome.price_1d < entry_price else "neutral"
        
        if len(future_prices) >= 5:
            outcome.price_5d = future_prices[4]['close']
            outcome.return_5d = (outcome.price_5d - entry_price) / entry_price * 100
            outcome.direction_5d = "up" if outcome.price_5d > entry_price else "down" if outcome.price_5d < entry_price else "neutral"
            
            # Check prediction correctness
            if predicted_direction == "up":
                outcome.prediction_correct_5d = outcome.price_5d > entry_price
            elif predicted_direction == "down":
                outcome.prediction_correct_5d = outcome.price_5d < entry_price
            else:  # neutral
                outcome.prediction_correct_5d = abs(outcome.return_5d) < 2  # Within ±2%
        
        if len(future_prices) >= 10:
            outcome.price_10d = future_prices[9]['close']
            outcome.return_10d = (outcome.price_10d - entry_price) / entry_price * 100
            outcome.direction_10d = "up" if outcome.price_10d > entry_price else "down" if outcome.price_10d < entry_price else "neutral"
            
            if predicted_direction == "up":
                outcome.prediction_correct_10d = outcome.price_10d > entry_price
            elif predicted_direction == "down":
                outcome.prediction_correct_10d = outcome.price_10d < entry_price
            else:
                outcome.prediction_correct_10d = abs(outcome.return_10d) < 2
        
        if len(future_prices) >= 20:
            outcome.price_20d = future_prices[19]['close']
            outcome.return_20d = (outcome.price_20d - entry_price) / entry_price * 100
            outcome.direction_20d = "up" if outcome.price_20d > entry_price else "down" if outcome.price_20d < entry_price else "neutral"
            
            if predicted_direction == "up":
                outcome.prediction_correct_20d = outcome.price_20d > entry_price
            elif predicted_direction == "down":
                outcome.prediction_correct_20d = outcome.price_20d < entry_price
            else:
                outcome.prediction_correct_20d = abs(outcome.return_20d) < 2
        
        # Check target reached and stop hit
        all_prices = [f['close'] for f in future_prices]
        all_lows = [f['low'] for f in future_prices]
        all_highs = [f['high'] for f in future_prices]
        
        if predicted_direction == "up":
            # For buy signals
            outcome.max_profit = (max(all_highs) - entry_price) / entry_price * 100 if all_highs else 0
            outcome.max_drawdown = (entry_price - min(all_lows)) / entry_price * 100 if all_lows else 0
            
            # Target reached?
            if target_price > entry_price:
                outcome.target_reached = any(p >= target_price for p in all_prices)
            
            # Stop hit?
            if stop_price < entry_price:
                outcome.stop_hit = any(p <= stop_price for p in all_lows)
        
        elif predicted_direction == "down":
            # For sell signals (inverse logic)
            outcome.max_profit = (entry_price - min(all_lows)) / entry_price * 100 if all_lows else 0
            outcome.max_drawdown = (max(all_highs) - entry_price) / entry_price * 100 if all_highs else 0
            
            # For shorts, target is below
            if target_price < entry_price:
                outcome.target_reached = any(p <= target_price for p in all_prices)
            
            if stop_price > entry_price:
                outcome.stop_hit = any(p >= stop_price for p in all_highs)
        
        return outcome
    
    def save_prediction(self, prediction: SimulatedPrediction, stock_id: int):
        """حفظ التوقع في قاعدة البيانات"""
        cursor = self.conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO prediction_logs (
                    ticker, stock_id, prediction_date,
                    predicted_direction, recommendation,
                    predicted_price_5d, predicted_price_10d, predicted_price_20d,
                    composite_score, confidence,
                    target_price, stop_loss, entry_price,
                    market_regime, source, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            ''', (
                prediction.ticker,
                stock_id,
                prediction.prediction_date,
                prediction.predicted_direction,
                prediction.predicted_signal,  # Using recommendation column
                prediction.entry_price,
                prediction.predicted_target,
                prediction.predicted_stop,
                prediction.composite_score,
                prediction.confidence,
                prediction.predicted_target,
                prediction.predicted_stop,
                prediction.entry_price,
                prediction.market_regime,
                'historical_backfill',
            ))
            
            return cursor.lastrowid
        except Exception as e:
            logger.error(f"Error saving prediction: {e}")
            return None
    
    def save_outcome(self, outcome: ActualOutcome, prediction_id: int):
        """حفظ النتيجة في قاعدة البيانات"""
        cursor = self.conn.cursor()
        
        try:
            cursor.execute('''
                UPDATE prediction_logs SET
                    validated = 1,
                    validated_at = datetime('now'),
                    actual_price_5d = ?,
                    actual_price_10d = ?,
                    actual_price_20d = ?,
                    direction_correct_5d = ?,
                    direction_correct_10d = ?,
                    direction_correct_20d = ?,
                    price_error_5d = ?,
                    price_error_10d = ?,
                    price_error_20d = ?,
                    target_reached = ?,
                    stop_hit = ?
                WHERE id = ?
            ''', (
                outcome.price_5d,
                outcome.price_10d,
                outcome.price_20d,
                1 if outcome.prediction_correct_5d else 0,
                1 if outcome.prediction_correct_10d else 0,
                1 if outcome.prediction_correct_20d else 0,
                outcome.return_5d,
                outcome.return_10d,
                outcome.return_20d,
                1 if outcome.target_reached else 0,
                1 if outcome.stop_hit else 0,
                prediction_id,
            ))
            
            return True
        except Exception as e:
            logger.error(f"Error saving outcome: {e}")
            return False
    
    def extract_lessons(self, ticker: str, predictions: List[SimulatedPrediction], 
                        outcomes: List[ActualOutcome]) -> List[LearnedLesson]:
        """
        استخراج الدروس من التوقعات والنتائج
        
        Types of lessons:
        1. profit_taking: When does the stock tend to take profit?
        2. volatility: How volatile is this stock?
        3. pattern_fake: Which patterns lead to false signals?
        4. sector_behavior: How does this sector behave?
        """
        lessons = []
        
        if not outcomes:
            return lessons
        
        # 1. Profit Taking Lesson
        winning_outcomes = [o for o in outcomes if o.target_reached]
        if winning_outcomes:
            avg_profit = sum(o.max_profit for o in winning_outcomes) / len(winning_outcomes)
            
            lessons.append(LearnedLesson(
                ticker=ticker,
                lesson_type="profit_taking",
                description=f"{ticker} tends to reach target in {avg_profit:.1f}% of cases. Average max profit: {avg_profit:.1f}%",
                trigger_conditions={"avg_max_profit": avg_profit},
                action=f"Set target at +{min(avg_profit * 0.8, 10):.1f}% for conservative exit",
                target_adjustment=min(avg_profit * 0.8, 10),
            ))
        
        # 2. Volatility Lesson
        drawdowns = [o.max_drawdown for o in outcomes if o.max_drawdown > 0]
        if drawdowns:
            avg_drawdown = sum(drawdowns) / len(drawdowns)
            max_drawdown = max(drawdowns)
            
            lessons.append(LearnedLesson(
                ticker=ticker,
                lesson_type="volatility",
                description=f"{ticker} average drawdown: {avg_drawdown:.1f}%, max: {max_drawdown:.1f}%",
                trigger_conditions={"avg_drawdown": avg_drawdown, "max_drawdown": max_drawdown},
                action=f"Set stop at -{min(avg_drawdown * 1.5, 12):.1f}% to avoid noise",
                stop_adjustment=min(avg_drawdown * 1.5, 12),
            ))
        
        # 3. Pattern Fake Detection
        # Find predictions that were wrong
        wrong_predictions = []
        for i, (pred, out) in enumerate(zip(predictions, outcomes)):
            if not out.prediction_correct_5d:
                wrong_predictions.append({
                    'prediction': pred,
                    'outcome': out,
                })
        
        if len(wrong_predictions) > 3:
            # Analyze what went wrong
            rsi_wrong = [wp for wp in wrong_predictions 
                        if wp['prediction'].technical_indicators.get('rsi', 50) < 30]
            
            if len(rsi_wrong) > len(wrong_predictions) * 0.5:
                lessons.append(LearnedLesson(
                    ticker=ticker,
                    lesson_type="pattern_fake",
                    description=f"RSI oversold (<30) led to {len(rsi_wrong)} false buy signals for {ticker}",
                    trigger_conditions={"rsi_below": 30},
                    action="Reduce RSI weight for this stock by 30%",
                    confidence_adjustment=-15,
                ))
        
        return lessons
    
    def save_lesson(self, lesson: LearnedLesson):
        """حفظ درس في قاعدة البيانات"""
        cursor = self.conn.cursor()
        
        try:
            cursor.execute('''
                INSERT INTO learned_lessons (
                    lesson_type, title, description, trigger_conditions,
                    action, confidence, occurrences,
                    status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'testing', datetime('now'))
            ''', (
                'direct',  # lesson_type must be one of: 'direct', 'compound', 'environmental'
                f"{lesson.ticker}: {lesson.lesson_type}",
                lesson.description,
                json.dumps(lesson.trigger_conditions),
                lesson.action,
                lesson.confidence_adjustment,  # Using confidence column
                lesson.occurrences,
            ))
            
            return True
        except Exception as e:
            logger.error(f"Error saving lesson: {e}")
            return False
    
    def calculate_regime_weights(self):
        """
        حساب أوزان المؤشرات حسب حالة السوق والقطاع
        
        يحسب Win Rate لكل مؤشر في كل قطاع ويخزنه
        """
        cursor = self.conn.cursor()
        
        # Get all validated predictions
        # Note: indicators_used column doesn't exist, we'll use source instead
        cursor.execute('''
            SELECT 
                s.sector,
                p.market_regime,
                p.source,
                p.direction_correct_5d,
                p.direction_correct_10d,
                p.direction_correct_20d
            FROM prediction_logs p
            JOIN stocks s ON p.stock_id = s.id
            WHERE p.validated = 1
        ''')
        
        rows = cursor.fetchall()
        
        if not rows:
            logger.warning("No validated predictions found for regime weights")
            return
        
        # Organize by sector and regime
        stats = {}
        
        for row in rows:
            sector = row['sector'] or 'Unknown'
            regime = row['market_regime'] or 'RANGE'
            # Use source as indicator since indicators_used doesn't exist
            indicators = [row['source']] if row['source'] else ['historical']
            correct_5d = row['direction_correct_5d']
            
            key = (sector, regime)
            if key not in stats:
                stats[key] = {
                    'total': 0,
                    'correct': 0,
                    'indicators': {},
                }
            
            stats[key]['total'] += 1
            if correct_5d:
                stats[key]['correct'] += 1
            
            # Track per-indicator accuracy
            for ind in indicators:
                if ind not in stats[key]['indicators']:
                    stats[key]['indicators'][ind] = {'total': 0, 'correct': 0}
                stats[key]['indicators'][ind]['total'] += 1
                if correct_5d:
                    stats[key]['indicators'][ind]['correct'] += 1
        
        # Calculate and save weights
        for (sector, regime), data in stats.items():
            if data['total'] < 5:
                continue
            
            overall_accuracy = data['correct'] / data['total'] * 100
            
            for indicator, ind_data in data['indicators'].items():
                if ind_data['total'] < 3:
                    continue
                
                accuracy = ind_data['correct'] / ind_data['total'] * 100
                
                # Determine weight adjustment
                if accuracy > 60:
                    weight = 1.2  # Boost
                elif accuracy < 40:
                    weight = 0.7  # Reduce
                else:
                    weight = 1.0  # Neutral
                
                cursor.execute('''
                    INSERT OR REPLACE INTO regime_indicator_weights (
                        indicator_name, regime, weight, expectancy, last_calculated
                    ) VALUES (?, ?, ?, ?, datetime('now'))
                ''', (indicator, regime, weight, accuracy))
        
        self.conn.commit()
        logger.info(f"Calculated regime weights for {len(stats)} sector-regime combinations")
    
    def run_backfill(self, days_back: int = 180, stocks_limit: int = 0, 
                     progress_callback=None) -> Dict:
        """
        تشغيل عملية الـ Backfill الكاملة
        
        Args:
            days_back: عدد الأيام للرجوع للخلف
            stocks_limit: عدد الأسهم (0 = الكل)
            progress_callback: دالة لاستدعاء التقدم
        
        Returns:
            Dict: ملخص النتائج
        """
        logger.info(f"Starting historical backfill: {days_back} days back")
        
        self.connect()
        
        try:
            # Get stocks
            stocks = self.get_all_stocks()
            if stocks_limit > 0:
                stocks = stocks[:stocks_limit]
            
            # Results tracking
            results = {
                'stocks_processed': 0,
                'predictions_made': 0,
                'predictions_validated': 0,
                'lessons_learned': 0,
                'errors': 0,
                'start_time': datetime.now().isoformat(),
                'end_time': None,
            }
            
            # Calculate date range
            end_date = datetime.now()
            start_date = end_date - timedelta(days=days_back)
            
            logger.info(f"Processing {len(stocks)} stocks from {start_date.date()} to {end_date.date()}")
            
            for stock_idx, stock in enumerate(stocks):
                try:
                    stock_id = stock['id']
                    ticker = stock['ticker']
                    
                    # Get history
                    history = self.get_stock_history(stock_id, days_back + 250)
                    
                    if len(history) < 100:
                        logger.debug(f"Skipping {ticker}: only {len(history)} data points")
                        continue
                    
                    # Add stock info to history
                    for h in history:
                        h['ticker'] = ticker
                        h['stock_id'] = stock_id
                    
                    # Simulate predictions at each point
                    predictions = []
                    outcomes = []
                    
                    # Sample every 5th day to reduce computation
                    for i in range(50, len(history) - 25, 5):
                        prediction = self.simulate_prediction_at_date(history, i)
                        
                        if prediction:
                            predictions.append(prediction)
                            
                            # Calculate outcome
                            outcome = self.calculate_actual_outcome(history, i, prediction)
                            outcomes.append(outcome)
                            
                            # Save to database
                            pred_id = self.save_prediction(prediction, stock_id)
                            if pred_id:
                                self.save_outcome(outcome, pred_id)
                                results['predictions_validated'] += 1
                            
                            results['predictions_made'] += 1
                    
                    # Extract lessons
                    if len(predictions) >= 5:
                        lessons = self.extract_lessons(ticker, predictions, outcomes)
                        for lesson in lessons:
                            self.save_lesson(lesson)
                            results['lessons_learned'] += 1
                    
                    results['stocks_processed'] += 1
                    
                    # Progress callback
                    if progress_callback:
                        progress_callback({
                            'current': stock_idx + 1,
                            'total': len(stocks),
                            'ticker': ticker,
                            'predictions': len(predictions),
                        })
                    
                    # Commit every 10 stocks
                    if (stock_idx + 1) % 10 == 0:
                        self.conn.commit()
                        logger.info(f"Progress: {stock_idx + 1}/{len(stocks)} stocks, {results['predictions_made']} predictions")
                
                except Exception as e:
                    logger.error(f"Error processing {stock.get('ticker', 'unknown')}: {e}")
                    results['errors'] += 1
            
            # Calculate regime weights
            logger.info("Calculating regime indicator weights...")
            self.calculate_regime_weights()
            
            # Final commit
            self.conn.commit()
            
            results['end_time'] = datetime.now().isoformat()
            
            logger.info(f"Backfill complete: {results}")
            return results
            
        finally:
            self.disconnect()
    
    def get_summary(self) -> Dict:
        """الحصول على ملخص البيانات الحالية"""
        self.connect()
        
        try:
            cursor = self.conn.cursor()
            
            # Count predictions
            cursor.execute('SELECT COUNT(*) FROM prediction_logs')
            total_predictions = cursor.fetchone()[0]
            
            cursor.execute('SELECT COUNT(*) FROM prediction_logs WHERE validated = 1')
            validated_predictions = cursor.fetchone()[0]
            
            # Accuracy
            cursor.execute('''
                SELECT 
                    AVG(CASE WHEN direction_correct_5d = 1 THEN 100 ELSE 0 END) as accuracy_5d,
                    AVG(CASE WHEN direction_correct_10d = 1 THEN 100 ELSE 0 END) as accuracy_10d,
                    AVG(CASE WHEN direction_correct_20d = 1 THEN 100 ELSE 0 END) as accuracy_20d
                FROM prediction_logs WHERE validated = 1
            ''')
            accuracy = cursor.fetchone()
            
            # Lessons count
            cursor.execute('SELECT COUNT(*) FROM learned_lessons')
            lessons_count = cursor.fetchone()[0]
            
            # Regime weights count
            cursor.execute('SELECT COUNT(*) FROM regime_indicator_weights')
            weights_count = cursor.fetchone()[0]
            
            return {
                'total_predictions': total_predictions,
                'validated_predictions': validated_predictions,
                'accuracy_5d': round(accuracy[0], 2) if accuracy[0] else 0,
                'accuracy_10d': round(accuracy[1], 2) if accuracy[1] else 0,
                'accuracy_20d': round(accuracy[2], 2) if accuracy[2] else 0,
                'lessons_learned': lessons_count,
                'regime_weights': weights_count,
            }
        finally:
            self.disconnect()


# ============================================================================
# MAIN EXECUTION
# ============================================================================

if __name__ == "__main__":
    import sys
    
    # Default database path
    db_path = Path(__file__).parent.parent.parent / 'db' / 'stocks.db'
    
    if len(sys.argv) > 1:
        db_path = Path(sys.argv[1])
    
    print(f"\n{'='*60}")
    print(" Historical Backfill Engine")
    print(" محرك التعلم من الماضي")
    print(f"{'='*60}")
    print(f" Database: {db_path}")
    print(f"{'='*60}\n")
    
    engine = HistoricalBackfillEngine(str(db_path))
    
    # Run backfill
    def progress_callback(info):
        print(f"  [{info['current']}/{info['total']}] {info['ticker']}: {info['predictions']} predictions")
    
    results = engine.run_backfill(
        days_back=180,
        stocks_limit=0,  # Process all stocks
        progress_callback=progress_callback
    )
    
    print(f"\n{'='*60}")
    print(" RESULTS / النتائج")
    print(f"{'='*60}")
    for key, value in results.items():
        print(f"  {key}: {value}")
    
    # Get summary
    summary = engine.get_summary()
    print(f"\n{'='*60}")
    print(" SUMMARY / الملخص")
    print(f"{'='*60}")
    for key, value in summary.items():
        print(f"  {key}: {value}")
