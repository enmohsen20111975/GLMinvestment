"""
Dynamic Target Engine (محرك المستهدفات الديناميكي)
====================================================
حساب نقاط الدخول والخروج بناءً على التحليل الفني والشموع اليابانية

القاعدة الذهبية: "مفيش target = entry * 1.10 تاني"
كل سهم له دعم ومقاومة حقيقيين من الشموع.
الوقف على الدعم، الهدف على المقاومة، R/R يتحسب من المسافة الحقيقية.

4 طبقات لوقف الخسارة:
  1. دعم فني (أولوية قصوى)
  2. أدنى سعر أخير (Swing Low 20 شمعة)
  3. ATR (Average True Range)
  4. Fallback (لو مفيش بيانات)

5 طبقات للمستهدف:
  1. مقاومة فنية (أولوية قصوى)
  2. أعلى سعر أخير (Swing High 20 شمعة)
  3. Fibonacci Extension (1.618)
  4. ATR-based Target
  5. R/R Validation

إشارات الخروج من القمة ("قمة الخول"):
  - Shooting Star عند المقاومة (40%)
  - Bearish Engulfing (35%)
  - Evening Star (35%)
  - RSI > 75 (25%)
  - Volume Divergence (30%)
  - Bearish Divergence MACD (25%)

إشارات الدخول من القاع:
  - Hammer عند الدعم (35%)
  - Bullish Engulfing (30%)
  - Morning Star (30%)
  - RSI < 25 (25%)
  - Bullish Divergence (25%)
  - Volume Spike (20%)

Author: دليل الاستثمار
Version: 1.0.0
"""

from __future__ import annotations

import sqlite3
import os
import math
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field

from analyzers.indicators.atr import calc_atr as _canonical_calc_atr

# DYNAMIC-SYSTEM-001: إعدادات ديناميكية + سياق السوق
try:
    from analyzers.engine_settings import (
        get_setting, get_dynamic_atr_stop_mult, get_dynamic_min_rr,
    )
    from analyzers.dynamic_context_engine import get_dynamic_context
    _DYNAMIC_AVAILABLE = True
except ImportError:
    _DYNAMIC_AVAILABLE = False

    def get_setting(key, default=None):
        return float(default) if default is not None else 0.0

    def get_dynamic_atr_stop_mult(stock_volatility_pct=0.0):
        return 1.5

    def get_dynamic_min_rr(market_regime='range'):
        return 1.5

    def get_dynamic_context(ticker, use_cache=True):
        return None


# ==================== CONFIG ====================

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_PRICE_HISTORY_DB = os.environ.get(
    "PRICE_HISTORY_DB",
    str(_PROJECT_ROOT / "db" / "price_history.db"),
)
DEFAULT_STOCKS_DB = os.environ.get(
    "DATABASE_PATH",
    str(_PROJECT_ROOT / "db" / "stocks.db"),
)

# Validation rules
MAX_STOP_PCT = 0.15      # Stop wider than 15% = reject (too risky)
MIN_STOP_PCT = 0.003     # Stop tighter than 0.3% = reject (noise)
MIN_TARGET_PCT = 0.005   # Target less than 0.5% = reject

# Default persona parameters
PERSONA_PARAMS = {
    'conservative': {
        'atr_stop_mult': 2.0,     # Wider ATR stop for safety
        'atr_target_mult': 2.5,   # Conservative target
        'support_buffer': 0.98,   # 2% below support
        'resistance_buffer': 0.95, # 5% before resistance
        'min_rr': 2.0,           # Minimum R:R for investor
        'default_stop_pct': 0.05, # 5% default
    },
    'cautious': {
        'atr_stop_mult': 1.8,
        'atr_target_mult': 2.2,
        'support_buffer': 0.98,
        'resistance_buffer': 0.96,
        'min_rr': 1.8,
        'default_stop_pct': 0.06,
    },
    'balanced': {
        'atr_stop_mult': 1.5,
        'atr_target_mult': 2.0,
        'support_buffer': 0.97,
        'resistance_buffer': 0.97,
        'min_rr': 1.5,
        'default_stop_pct': 0.08,
    },
    'active_trader': {
        'atr_stop_mult': 1.5,
        'atr_target_mult': 1.8,
        'support_buffer': 0.97,
        'resistance_buffer': 0.98,
        'min_rr': 1.5,
        'default_stop_pct': 0.07,
    },
    'adventurer': {
        'atr_stop_mult': 1.5,
        'atr_target_mult': 1.5,
        'support_buffer': 0.99,
        'resistance_buffer': 0.99,
        'min_rr': 1.5,
        'default_stop_pct': 0.10,
    },
    'gambler': {
        'atr_stop_mult': 1.5,
        'atr_target_mult': 1.5,
        'support_buffer': 0.99,
        'resistance_buffer': 1.00,
        'min_rr': 1.5,
        'default_stop_pct': 0.12,
    },
    'hedger': {
        'atr_stop_mult': 2.0,
        'atr_target_mult': 2.0,
        'support_buffer': 0.97,
        'resistance_buffer': 0.95,
        'min_rr': 2.0,
        'default_stop_pct': 0.05,
    },
}


# ==================== DATA STRUCTURES ====================

@dataclass
class ExitSignal:
    """إشارة خروج واحدة"""
    signal: str
    score: float
    triggered: bool
    detail: str = ''


@dataclass
class EntrySignal:
    """إشارة دخول واحدة"""
    signal: str
    score: float
    triggered: bool
    detail: str = ''


@dataclass
class DynamicTargetResult:
    """نتيجة حساب المستهدفات الديناميكية"""
    # Core results
    entry_price: float = 0.0
    stop_loss: float = 0.0
    stop_pct: float = 0.0
    stop_basis: str = 'DEFAULT'     # support_level, swing_low, atr, fallback
    stop_detail: str = ''

    target_price: float = 0.0
    target_pct: float = 0.0
    target_basis: str = 'DEFAULT'   # resistance_level, swing_high, fibonacci, atr, rr_enforced
    target_detail: str = ''

    risk_reward: float = 0.0
    rr_valid: bool = False

    # Technical data used
    atr_14: float = 0.0
    support_level: float = 0.0
    resistance_level: float = 0.0
    swing_low: float = 0.0
    swing_high: float = 0.0

    # Candlestick context
    candlestick_context: str = ''   # at_support, at_resistance, middle
    candlestick_pattern: str = ''
    candlestick_strength: float = 0.0

    # Exit/Entry signals
    exit_signals: List[ExitSignal] = field(default_factory=list)
    entry_signals: List[EntrySignal] = field(default_factory=list)
    exit_score: float = 0.0
    recommendation: str = ''        # BUY, REDUCE, TAKE_PROFIT, etc.

    # Trend-following specific fields
    trailing_stop_price: float = 0.0
    atr_sl_mult: float = 0.0
    atr_trail_mult: float = 0.0
    trailing_stop_atr_mult: float = 0.0
    initial_stop_atr_mult: float = 0.0
    max_holding_days: int = 0
    exit_type: str = 'target'          # 'target' for mean_reversion, 'trailing_stop' for trend_following
    is_trend_following: bool = False
    breakout_confirmed: Optional[bool] = None  # None for mean_reversion, True/False for trend_following
    rr_label: str = ''                 # e.g. "Open (Trailing Stop)" for trend_following

    # Method trace
    calculation_trace: List[str] = field(default_factory=list)


# ==================== ATR CALCULATION ====================

def calculate_atr(highs: List[float], lows: List[float], closes: List[float],
                  period: int = 14) -> float:
    """حساب ATR من الشموع اليابانية.

    BRAVO UNIFY: delegates to canonical analyzers.indicators.atr.calc_atr (Wilder's smoothing).
    Keeps backward-compat fallback (0.0) on insufficient data.
    """
    if len(closes) < period + 1:
        return 0.0
    # filter invalid rows
    valid = [(h, l, c) for h, l, c in zip(highs, lows, closes) if h > 0 and l > 0 and c > 0]
    if len(valid) < 2:
        return 0.0
    v_highs, v_lows, v_closes = (list(t) for t in zip(*valid))
    atr = _canonical_calc_atr(v_highs, v_lows, v_closes, period=period)
    return atr if atr is not None else 0.0


# ==================== SWING DETECTION ====================

def find_swing_low(prices: List[float], period: int = 20) -> float:
    """أدنى سعر في آخر `period` شمعة"""
    if not prices:
        return 0.0
    recent = prices[-period:] if len(prices) >= period else prices
    valid = [p for p in recent if p > 0]
    return min(valid) if valid else 0.0


def find_swing_high(prices: List[float], period: int = 20) -> float:
    """أعلى سعر في آخر `period` شمعة"""
    if not prices:
        return 0.0
    recent = prices[-period:] if len(prices) >= period else prices
    valid = [p for p in recent if p > 0]
    return max(valid) if valid else 0.0


# ==================== FIBONACCI EXTENSION ====================

def calculate_fibonacci_extension(swing_low: float, swing_high: float,
                                   level: float = 0.618) -> float:
    """
    حساب Fibonacci Extension
    المعيار: من آخر swing (low → high)
    1.618 extension = swing_high + (swing_range × 0.618)
    """
    if swing_low <= 0 or swing_high <= 0 or swing_high <= swing_low:
        return 0.0
    swing_range = swing_high - swing_low
    return swing_high + (swing_range * level)


# ==================== EXIT SIGNALS (قمة الخول) ====================

def calculate_exit_signals(
    entry_price: float,
    current_price: float,
    resistance: float,
    rsi: float = None,
    volume: float = None,
    volume_sma_20: float = None,
    macd_histogram: float = None,
    prev_macd_histogram: float = None,
    candlestick_pattern: str = '',
    candlestick_direction: str = '',
    candlestick_at_resistance: bool = False,
    high_20: float = None,
) -> Tuple[List[ExitSignal], float]:
    """
    حساب إشارات الخروج من القمة ("قمة الخول")
    القمة اللي فيها "الخوّال" بيشتروا = وقت الخروج للمحترف.

    Returns: (exit_signals_list, exit_score)
    Score >= 60 → REDUCE / TAKE_PROFIT
    """
    signals = []
    exit_score = 0.0

    if not current_price or current_price <= 0:
        return signals, exit_score

    # 1. شمعة انعكاس هابط عند المقاومة (Shooting Star / Bearish Engulfing / Evening Star)
    if candlestick_at_resistance and candlestick_direction == 'BEARISH':
        if candlestick_pattern in ('SHOOTING_STAR',):
            score = 40
            signals.append(ExitSignal(
                signal='shooting_star_at_resistance',
                score=score,
                triggered=True,
                detail=f'Shooting Star عند مقاومة {resistance:.2f}'
            ))
            exit_score += score
        elif candlestick_pattern in ('BEARISH_ENGULFING',):
            score = 35
            signals.append(ExitSignal(
                signal='bearish_engulfing',
                score=score,
                triggered=True,
                detail='ابتلاع هابط — إشارة انعكاس قوية'
            ))
            exit_score += score
        elif candlestick_pattern in ('EVENING_STAR',):
            score = 35
            signals.append(ExitSignal(
                signal='evening_star',
                score=score,
                triggered=True,
                detail='نجمة مساء — إشارة انعكاس هابط'
            ))
            exit_score += score
        else:
            # Generic bearish candle at resistance
            signals.append(ExitSignal(
                signal='bearish_candle_at_resistance',
                score=0,
                triggered=False,
                detail=f'شمعة هابطة عند المقاومة لكن مش نمط معروف'
            ))
    else:
        signals.append(ExitSignal(
            signal='bearish_reversal_at_resistance',
            score=0,
            triggered=False,
            detail='مفيش شمعة انعكاس هابط عند المقاومة'
        ))

    # 2. RSI extreme overbought
    if rsi is not None:
        if rsi > 75:
            score = 25
            signals.append(ExitSignal(
                signal='rsi_overbought',
                score=score,
                triggered=True,
                detail=f'RSI = {rsi:.1f} — تشبع شرائي شديد'
            ))
            exit_score += score
        elif rsi > 70:
            signals.append(ExitSignal(
                signal='rsi_high',
                score=0,
                triggered=False,
                detail=f'RSI = {rsi:.1f} — تشبع شرائي لكن مش شديد'
            ))
        else:
            signals.append(ExitSignal(
                signal='rsi_overbought',
                score=0,
                triggered=False,
                detail=f'RSI = {rsi:.1f} — طبيعي'
            ))

    # 3. Volume Divergence (price new high + volume below average)
    if high_20 and current_price >= high_20 * 0.99:
        if volume is not None and volume_sma_20 is not None and volume_sma_20 > 0:
            vol_ratio = volume / volume_sma_20
            if vol_ratio < 0.8:
                score = 30
                signals.append(ExitSignal(
                    signal='volume_divergence',
                    score=score,
                    triggered=True,
                    detail=f'سعر عند قمة لكن حجم السيولة {vol_ratio:.1f}× المتوسط — انخفاض'
                ))
                exit_score += score
            else:
                signals.append(ExitSignal(
                    signal='volume_divergence',
                    score=0,
                    triggered=False,
                    detail=f'حجم السيولة طبيعي ({vol_ratio:.1f}×)'
                ))
        else:
            signals.append(ExitSignal(
                signal='volume_divergence',
                score=0,
                triggered=False,
                detail='مفيش بيانات حجم كافية'
            ))
    else:
        signals.append(ExitSignal(
            signal='volume_divergence',
            score=0,
            triggered=False,
            detail='السعر مش عند قمة'
        ))

    # 4. Bearish MACD Divergence (price higher + MACD histogram lower)
    if macd_histogram is not None and prev_macd_histogram is not None:
        if high_20 and current_price >= high_20 * 0.98:
            if macd_histogram < prev_macd_histogram and macd_histogram < 0:
                score = 25
                signals.append(ExitSignal(
                    signal='bearish_macd_divergence',
                    score=score,
                    triggered=True,
                    detail='MACD diverges bearish — سعر أعلى + MACD أقل'
                ))
                exit_score += score
            else:
                signals.append(ExitSignal(
                    signal='bearish_macd_divergence',
                    score=0,
                    triggered=False,
                    detail='مفيش Divergence في MACD'
                ))
        else:
            signals.append(ExitSignal(
                signal='bearish_macd_divergence',
                score=0,
                triggered=False,
                detail='السعر مش عند قمة كافية لـ MACD divergence'
            ))
    else:
        signals.append(ExitSignal(
            signal='bearish_macd_divergence',
            score=0,
            triggered=False,
            detail='مفيش بيانات MACD كافية'
        ))

    # 5. Proximity to resistance
    if resistance and resistance > 0 and current_price > 0:
        distance_pct = ((resistance - current_price) / current_price) * 100
        if distance_pct < 2.0:
            score = 20
            signals.append(ExitSignal(
                signal='resistance_proximity',
                score=score,
                triggered=True,
                detail=f'على بعد {distance_pct:.1f}% من المقاومة ({resistance:.2f})'
            ))
            exit_score += score
        else:
            signals.append(ExitSignal(
                signal='resistance_proximity',
                score=0,
                triggered=False,
                detail=f'المقاومة بعيدة ({distance_pct:.1f}%)'
            ))
    else:
        signals.append(ExitSignal(
            signal='resistance_proximity',
            score=0,
            triggered=False,
            detail='مفيش مقاومة محددة'
        ))

    return signals, exit_score


# ==================== ENTRY SIGNALS ====================

def calculate_entry_signals(
    entry_price: float,
    support: float,
    rsi: float = None,
    volume: float = None,
    volume_sma_20: float = None,
    candlestick_pattern: str = '',
    candlestick_direction: str = '',
    candlestick_at_support: bool = False,
) -> Tuple[List[EntrySignal], float]:
    """
    حساب إشارات الدخول من القاع

    Returns: (entry_signals_list, entry_score)
    """
    signals = []
    entry_score = 0.0

    # 1. Hammer عند الدعم
    if candlestick_at_support and candlestick_direction == 'BULLISH':
        if candlestick_pattern == 'HAMMER':
            score = 35
            signals.append(EntrySignal(
                signal='hammer_at_support',
                score=score,
                triggered=True,
                detail=f'مطرقة عند دعم {support:.2f} — إشارة صعود قوية'
            ))
            entry_score += score
        elif candlestick_pattern == 'BULLISH_ENGULFING':
            score = 30
            signals.append(EntrySignal(
                signal='bullish_engulfing',
                score=score,
                triggered=True,
                detail='ابتلاع صاعد — إشارة انعكاس صاعدة'
            ))
            entry_score += score
        elif candlestick_pattern == 'MORNING_STAR':
            score = 30
            signals.append(EntrySignal(
                signal='morning_star',
                score=score,
                triggered=True,
                detail='نجمة صباح — إشارة صعود قوية'
            ))
            entry_score += score
        else:
            signals.append(EntrySignal(
                signal='bullish_candle_at_support',
                score=0,
                triggered=False,
                detail='شمعة صاعدة عند الدعم لكن مش نمط معروف'
            ))
    else:
        signals.append(EntrySignal(
            signal='bullish_reversal_at_support',
            score=0,
            triggered=False,
            detail='مفيش شمعة انعكاس صاعد عند الدعم'
        ))

    # 2. RSI oversold
    if rsi is not None:
        if rsi < 25:
            score = 25
            signals.append(EntrySignal(
                signal='rsi_oversold',
                score=score,
                triggered=True,
                detail=f'RSI = {rsi:.1f} — تشبع بيعي شديد'
            ))
            entry_score += score
        elif rsi < 30:
            signals.append(EntrySignal(
                signal='rsi_low',
                score=0,
                triggered=False,
                detail=f'RSI = {rsi:.1f} — تشبع بيعي خفيف'
            ))
        else:
            signals.append(EntrySignal(
                signal='rsi_oversold',
                score=0,
                triggered=False,
                detail=f'RSI = {rsi:.1f} — طبيعي'
            ))

    # 3. Volume Spike (volume > 1.5× average)
    if volume is not None and volume_sma_20 is not None and volume_sma_20 > 0:
        vol_ratio = volume / volume_sma_20
        if vol_ratio > 1.5:
            score = 20
            signals.append(EntrySignal(
                signal='volume_spike',
                score=score,
                triggered=True,
                detail=f'حجم السيولة {vol_ratio:.1f}× المتوسط — اهتمام قوي'
            ))
            entry_score += score
        else:
            signals.append(EntrySignal(
                signal='volume_spike',
                score=0,
                triggered=False,
                detail=f'حجم السيولة طبيعي ({vol_ratio:.1f}×)'
            ))
    else:
        signals.append(EntrySignal(
            signal='volume_spike',
            score=0,
            triggered=False,
            detail='مفيش بيانات حجم كافية'
        ))

    return signals, entry_score


# ==================== MAIN ENGINE ====================

class DynamicTargetEngine:
    """
    محرك المستهدفات الديناميكي
    
    Usage:
        engine = DynamicTargetEngine()
        result = engine.calculate(
            ticker='COMI',
            entry_price=132.1,
            persona='balanced',
        )
        print(f"Stop: {result.stop_loss} ({result.stop_basis})")
        print(f"Target: {result.target_price} ({result.target_basis})")
        print(f"Exit Score: {result.exit_score}")
    """

    def __init__(self, price_history_db: str = None, stocks_db: str = None):
        self.price_history_db = price_history_db or DEFAULT_PRICE_HISTORY_DB
        self.stocks_db = stocks_db or DEFAULT_STOCKS_DB

    def calculate(
        self,
        ticker: str,
        entry_price: float,
        score: float = 50,
        persona: str = 'balanced',
        # Mode: "mean_reversion" (default) or "trend_following"
        mode: str = 'mean_reversion',
        sl_mult: float = 3.0,
        trail_mult: float = 3.0,
        # Pre-calculated values (skip DB lookups if provided)
        support: float = None,
        resistance: float = None,
        atr: float = None,
        atr_pct: float = None,
        high_30d: float = None,
        low_30d: float = None,
        volatility: float = 3.0,
        # Price data (skip DB lookups if provided)
        price_history: List[Dict] = None,
        # Technical indicators for exit/entry signals
        rsi: float = None,
        volume: float = None,
        volume_sma_20: float = None,
        macd_histogram: float = None,
        prev_macd_histogram: float = None,
        bb_lower: float = None,
        bb_upper: float = None,
        # Candlestick context
        candlestick_pattern: str = '',
        candlestick_direction: str = '',
        # Zone context
        zone: str = None,
    ) -> DynamicTargetResult:
        """
        حساب نقاط الدخول والخروج بناءً على التحليل الفني والشموع اليابانية
        
        الأولوية:
        - Stop: دعم → Swing Low → ATR → Fallback
        - Target: مقاومة → Swing High → Fibonacci → ATR → R/R Validation
        """
        trace = []
        result = DynamicTargetResult(entry_price=entry_price)

        if not entry_price or entry_price <= 0:
            return result

        # Get persona params
        ptype = persona if persona in PERSONA_PARAMS else 'balanced'
        params = PERSONA_PARAMS[ptype]

        # ========================================
        # STEP 0: Gather data from price history
        # ========================================
        if price_history is None:
            price_history = self._load_price_history(ticker)

        # Calculate S/R if not provided
        if support is None or resistance is None:
            sr_data = self._calculate_support_resistance(ticker, price_history)
            if sr_data:
                if support is None:
                    support = sr_data.get('support', 0)
                if resistance is None:
                    resistance = sr_data.get('resistance', 0)
                if zone is None:
                    zone = sr_data.get('zone', 'middle')
                trace.append(f"S/R: support={support:.2f}, resistance={resistance:.2f}, zone={zone}")

        # Calculate ATR if not provided
        if atr is None:
            atr = self._calculate_atr_from_history(price_history)
        if atr_pct is None and atr and entry_price > 0:
            atr_pct = (atr / entry_price) * 100

        # Calculate swing low/high from last 20 candles
        lows = [float(r.get('low_price', 0)) for r in price_history[-20:]] if price_history else []
        highs = [float(r.get('high_price', 0)) for r in price_history[-20:]] if price_history else []
        closes = [float(r.get('close_price', 0)) for r in price_history] if price_history else []

        swing_low = find_swing_low(lows, period=20) if lows else 0
        swing_high = find_swing_high(highs, period=20) if highs else 0

        # 30d high/low
        if high_30d is None or low_30d is None:
            high_30d_calc, low_30d_calc = self._calculate_30d_range(price_history)
            if high_30d is None:
                high_30d = high_30d_calc
            if low_30d is None:
                low_30d = low_30d_calc

        # Determine candlestick context
        candlestick_at_support = False
        candlestick_at_resistance = False
        if support and support > 0 and entry_price > 0:
            dist_to_support_pct = ((entry_price - support) / entry_price) * 100
            if dist_to_support_pct <= 3.0:
                candlestick_at_support = True
        if resistance and resistance > 0 and entry_price > 0:
            dist_to_resistance_pct = ((resistance - entry_price) / entry_price) * 100
            if dist_to_resistance_pct <= 3.0:
                candlestick_at_resistance = True

        # Set candlestick context
        if candlestick_at_support:
            result.candlestick_context = 'at_support'
        elif candlestick_at_resistance:
            result.candlestick_context = 'at_resistance'
        else:
            result.candlestick_context = 'middle'

        result.candlestick_pattern = candlestick_pattern
        result.atr_14 = atr or 0
        # ══════════════════════════════════════════════════════════
        # تحقق من معقولية قيم الدعم والمقاومة والـ Swing بالنسبة لسعر الدخول
        # لو أي قيمة بعيدة جداً عن سعر الدخول، بنلغيها عشان متسببش مستهدف خرافي
        # ══════════════════════════════════════════════════════════
        if support and support > 0 and support < entry_price * 0.5:
            # الدعم أقل من 50% من سعر الدخول — مش منطقي
            trace.append(f"⚠️ Support {support:.2f} < entry*0.5 ({entry_price*0.5:.2f}) — تم إلغاء الدعم")
            support = 0
        if resistance and resistance > 0 and resistance > entry_price * 3.0:
            # المقاومة أكتر من 3 أضعاف سعر الدخول — مش منطقي
            trace.append(f"⚠️ Resistance {resistance:.2f} > entry*3.0 ({entry_price*3.0:.2f}) — تم إلغاء المقاومة")
            resistance = 0
        if swing_high and swing_high > 0 and swing_high > entry_price * 3.0:
            # أعلى سوينج أكتر من 3 أضعاف سعر الدخول — مش منطقي
            trace.append(f"⚠️ Swing High {swing_high:.2f} > entry*3.0 ({entry_price*3.0:.2f}) — تم إلغاء Swing High")
            swing_high = 0
        if swing_low and swing_low > 0 and swing_low < entry_price * 0.5:
            # أدنى سوينج أقل من 50% من سعر الدخول — مش منطقي
            trace.append(f"⚠️ Swing Low {swing_low:.2f} < entry*0.5 ({entry_price*0.5:.2f}) — تم إلغاء Swing Low")
            swing_low = 0

        result.support_level = support or 0
        result.resistance_level = resistance or 0
        result.swing_low = swing_low
        result.swing_high = swing_high

        # ══════════════════════════════════════════════════════════
        # TREND-FOLLOWING MODE: Trailing Stop Logic
        # When mode="trend_following", use ATR-based trailing stop
        # instead of the 4-layer stop / 5-layer target system.
        # ══════════════════════════════════════════════════════════
        if mode == 'trend_following':
            trace.append(f"📊 MODE: TREND FOLLOWING (sl_mult={sl_mult}, trail_mult={trail_mult})")
            result.is_trend_following = True
            result.exit_type = 'trailing_stop'

            # --- Stop Loss: entry - ATR(14) × sl_mult ---
            if atr and atr > 0:
                stop_loss = entry_price - (atr * sl_mult)
                result.stop_basis = 'atr_trailing'
                result.stop_detail = f'ATR(14)={atr:.2f} × {sl_mult} = {atr*sl_mult:.2f} تحت الدخول'
                trace.append(f"TF STOP: entry({entry_price:.2f}) - ATR×{sl_mult}({atr*sl_mult:.2f}) = {stop_loss:.2f}")
            else:
                # Fallback if no ATR available
                stop_loss = entry_price * 0.92  # 8% default
                result.stop_basis = 'fallback'
                result.stop_detail = 'مفيش ATR — وقف افتراضي 8%'
                trace.append(f"TF STOP (fallback): {stop_loss:.2f} (8%)")

            # Ensure stop is below entry
            if stop_loss >= entry_price:
                stop_loss = entry_price * 0.92

            actual_stop_pct = (entry_price - stop_loss) / entry_price

            # --- Target: NO FIXED TARGET. Placeholder = entry × 2 ---
            target_price = entry_price * 2.0
            result.target_basis = 'trailing_stop_open'
            result.target_detail = 'مفيش مستهدف ثابت — Trailing Stop يتحرك مع السعر'
            trace.append(f"TF TARGET (placeholder): entry×2 = {target_price:.2f} (no fixed target)")

            # --- Trailing Stop Calculation ---
            # Initial trailing stop = stop_loss
            # As price moves up: new_trail = highest_close - ATR(14) × trail_mult
            # Trailing stop NEVER moves down
            trailing_stop_price = stop_loss  # initial value

            if price_history and atr and atr > 0:
                # Find highest close in price history for trailing stop calc
                hist_closes = [float(r.get('close_price', 0)) for r in price_history if r.get('close_price')]
                if hist_closes:
                    highest_close = max(hist_closes)
                    new_trail = highest_close - (atr * trail_mult)
                    # Trailing stop never moves below initial stop
                    trailing_stop_price = max(stop_loss, new_trail)
                    trace.append(f"TF TRAILING: highest_close={highest_close:.2f}, "
                                 f"new_trail={new_trail:.2f}, final_trail={trailing_stop_price:.2f}")
                else:
                    trace.append(f"TF TRAILING: no close data, using initial stop {trailing_stop_price:.2f}")
            else:
                trace.append(f"TF TRAILING: no price_history/ATR, using initial stop {trailing_stop_price:.2f}")

            result.trailing_stop_price = round(trailing_stop_price, 2)
            result.atr_sl_mult = sl_mult
            result.atr_trail_mult = trail_mult
            result.trailing_stop_atr_mult = 3.0
            result.initial_stop_atr_mult = 3.0
            result.max_holding_days = 60

            # --- Donchian Breakout Validation ---
            # Check if close > 55-day high from price_history
            breakout_confirmed = None
            if price_history and len(price_history) >= 55:
                # Get the high of the last 55 days (excluding today)
                lookback_highs = [float(r.get('high_price', 0)) for r in price_history[-55:] if r.get('high_price')]
                if lookback_highs:
                    high_55d = max(lookback_highs)
                    current_close = entry_price  # using entry_price as current close
                    breakout_confirmed = current_close > high_55d
                    trace.append(f"TF DONCHIAN: 55d high={high_55d:.2f}, close={current_close:.2f}, "
                                 f"breakout={'YES' if breakout_confirmed else 'NO'}")
                    if not breakout_confirmed:
                        trace.append(f"⚠️ No Donchian breakout — close {current_close:.2f} ≤ 55d high {high_55d:.2f}")
            else:
                if price_history:
                    # Less than 55 days of data — use what we have
                    all_highs = [float(r.get('high_price', 0)) for r in price_history if r.get('high_price')]
                    if all_highs:
                        high_avail = max(all_highs)
                        breakout_confirmed = entry_price > high_avail
                        trace.append(f"TF DONCHIAN (partial {len(price_history)}d): high={high_avail:.2f}, "
                                     f"breakout={'YES' if breakout_confirmed else 'NO'}")
                else:
                    trace.append(f"TF DONCHIAN: no price history data available")

            result.breakout_confirmed = breakout_confirmed

            # --- Final calculations ---
            actual_target_pct = (target_price - entry_price) / entry_price

            result.stop_loss = round(stop_loss, 2)
            result.stop_pct = round(actual_stop_pct * 100, 1)
            result.target_price = round(target_price, 2)
            result.target_pct = round(actual_target_pct * 100, 1)

            # R/R is open-ended for trend following
            risk = entry_price - stop_loss
            reward = target_price - entry_price
            risk_reward = reward / risk if risk > 0 else 0
            # Rule 54: استخدم canonical compute_risk_reward
            try:
                from utils.risk_reward import compute_risk_reward
                risk_reward = compute_risk_reward(entry_price, target_price, stop_loss, fallback=risk_reward)
            except Exception:
                pass  # keep inline risk_reward computed above
            result.risk_reward = round(risk_reward, 2)
            result.rr_valid = True  # open-ended, always valid
            result.rr_label = 'Open (Trailing Stop)'

            # --- Skip resistance cap for trend following ---
            # (no resistance-based target cap)

            # Jump to exit/entry signals
            # (we skip STEP 1-4 mean reversion and go straight to signals)
            trace.append(f"→ TF Final: stop={result.stop_loss:.2f}, trail={result.trailing_stop_price:.2f}, "
                         f"target_placeholder={result.target_price:.2f}, breakout={result.breakout_confirmed}")

            # ========================================
            # STEP 5 (TF): Exit Signals
            # ========================================
            current_volume = volume
            if current_volume is None and price_history:
                last_row = price_history[-1] if price_history else {}
                current_volume = float(last_row.get('volume', 0)) if last_row.get('volume') else None

            if volume_sma_20 is None and price_history:
                recent_vols = [float(r.get('volume', 0)) for r in price_history[-20:] if r.get('volume')]
                if recent_vols:
                    volume_sma_20 = sum(recent_vols) / len(recent_vols)

            exit_signals, exit_score = calculate_exit_signals(
                entry_price=entry_price,
                current_price=entry_price,
                resistance=resistance or 0,
                rsi=rsi,
                volume=current_volume,
                volume_sma_20=volume_sma_20,
                macd_histogram=macd_histogram,
                prev_macd_histogram=prev_macd_histogram,
                candlestick_pattern=candlestick_pattern,
                candlestick_direction=candlestick_direction,
                candlestick_at_resistance=candlestick_at_resistance,
                high_20=swing_high if swing_high > 0 else None,
            )
            result.exit_signals = exit_signals
            result.exit_score = exit_score

            # ========================================
            # STEP 6 (TF): Entry Signals
            # ========================================
            entry_signals, entry_score = calculate_entry_signals(
                entry_price=entry_price,
                support=support or 0,
                rsi=rsi,
                volume=current_volume,
                volume_sma_20=volume_sma_20,
                candlestick_pattern=candlestick_pattern,
                candlestick_direction=candlestick_direction,
                candlestick_at_support=candlestick_at_support,
            )
            result.entry_signals = entry_signals

            # ========================================
            # STEP 7 (TF): Recommendation
            # ========================================
            if not breakout_confirmed:
                result.recommendation = 'CAUTIOUS'
                trace.append(f"⚠️ No breakout confirmed → CAUTIOUS")
            elif exit_score >= 60:
                result.recommendation = 'REDUCE'
                trace.append(f"🚨 EXIT SCORE {exit_score}≥60 → REDUCE / TAKE_PROFIT")
            elif exit_score >= 40:
                result.recommendation = 'CAUTIOUS'
                trace.append(f"⚠️ EXIT SCORE {exit_score}≥40 → CAUTIOUS")
            elif entry_score >= 50:
                result.recommendation = 'STRONG_BUY'
                trace.append(f"✅ ENTRY SCORE {entry_score}≥50 → STRONG_BUY")
            elif entry_score >= 30:
                result.recommendation = 'BUY'
                trace.append(f"✅ ENTRY SCORE {entry_score}≥30 → BUY")
            else:
                result.recommendation = 'HOLD'

            result.calculation_trace = trace
            return result

        # ══════════════════════════════════════════════════════════
        # MEAN-REVERSION MODE (default): Original 4-layer stop / 5-layer target
        # ══════════════════════════════════════════════════════════
        result.exit_type = 'target'

        # ========================================
        # STEP 1: Calculate STOP LOSS — 4 layers
        # Priority: Support → Swing Low → ATR → Fallback
        # ========================================
        stop_candidates = []

        # Layer 1: دعم فني (أولوية قصوى)
        if support and support > 0 and support < entry_price:
            buffer = params['support_buffer']  # e.g., 0.97 = 3% below support
            support_stop = support * buffer
            support_stop_pct = (entry_price - support_stop) / entry_price
            if MIN_STOP_PCT <= support_stop_pct <= MAX_STOP_PCT:
                stop_candidates.append((
                    support_stop,
                    'support_level',
                    1.0,  # confidence
                    f'أقرب دعم عند {support:.2f}, buffer {(1-buffer)*100:.0f}%'
                ))
                trace.append(f"L1 SUPPORT stop: {support_stop:.2f} ({support_stop_pct*100:.1f}%)")

        # Layer 2: أدنى سعر أخير (Swing Low 20 شمعة)
        if swing_low and swing_low > 0 and swing_low < entry_price:
            swing_low_stop = swing_low * 0.99  # 1% below swing low
            swing_low_stop_pct = (entry_price - swing_low_stop) / entry_price
            if MIN_STOP_PCT <= swing_low_stop_pct <= MAX_STOP_PCT:
                stop_candidates.append((
                    swing_low_stop,
                    'swing_low',
                    0.9,
                    f'Swing Low آخر 20 شمعة = {swing_low:.2f}, buffer 1%'
                ))
                trace.append(f"L2 SWING_LOW stop: {swing_low_stop:.2f} ({swing_low_stop_pct*100:.1f}%)")

        # Layer 3: ATR (Average True Range)
        # DYNAMIC-SYSTEM-001: مضاعف ATR ديناميكي — بيتحرك حسب تذبذب السهم.
        # سهم هادي (< 2%) → atr*1.0. سهم صاخب (> 6%) → atr*2.5. بينهم → interpolation.
        # ده بيمنع إن الوقف يضرب بسهولة في الأسهم الصاخبة، ويخلّيه قريب في الهادي.
        if atr and atr > 0 and entry_price > 0:
            # احسب تذبذب السهم من الـ context (لو متاح)
            _ctx = get_dynamic_context(ticker) if _DYNAMIC_AVAILABLE and ticker else None
            _stock_vol = _ctx.dynamic_volatility if _ctx else 0.0
            # الـ dynamic mult بياخد override من الأدمن عبر get_dynamic_atr_stop_mult
            atr_mult = get_dynamic_atr_stop_mult(_stock_vol) if _stock_vol > 0 else params['atr_stop_mult']
            atr_stop = entry_price - (atr_mult * atr)
            atr_stop_pct = (entry_price - atr_stop) / entry_price
            _max_stop = get_setting('max_stop_pct', default=MAX_STOP_PCT)
            _min_stop = get_setting('min_stop_pct', default=MIN_STOP_PCT)
            if _min_stop <= atr_stop_pct <= _max_stop:
                stop_candidates.append((
                    atr_stop,
                    'atr',
                    0.85,
                    f'ATR(14)={atr:.2f}, ×{atr_mult:.2f} (ديناميكي, تذبذب={_stock_vol:.1f}%) = {atr_mult*atr:.2f} تحت الدخول'
                ))
                trace.append(f"L3 ATR stop: {atr_stop:.2f} ({atr_stop_pct*100:.1f}%) mult={atr_mult:.2f}")
        elif atr_pct and atr_pct > 0:
            _ctx = get_dynamic_context(ticker) if _DYNAMIC_AVAILABLE and ticker else None
            _stock_vol = _ctx.dynamic_volatility if _ctx else atr_pct
            atr_mult = get_dynamic_atr_stop_mult(_stock_vol) if _stock_vol > 0 else params['atr_stop_mult']
            atr_stop_pct = atr_pct * atr_mult / 100.0
            _max_stop = get_setting('max_stop_pct', default=MAX_STOP_PCT)
            _min_stop = get_setting('min_stop_pct', default=MIN_STOP_PCT)
            if _min_stop <= atr_stop_pct <= _max_stop:
                stop_candidates.append((
                    entry_price * (1 - atr_stop_pct),
                    'atr_pct',
                    0.85,
                    f'ATR%={atr_pct:.1f}%, ×{atr_mult:.2f} (ديناميكي)'
                ))
                trace.append(f"L3 ATR% stop: {entry_price*(1-atr_stop_pct):.2f} ({atr_stop_pct*100:.1f}%) mult={atr_mult:.2f}")

        # Layer 4: Fallback (لو مفيش بيانات)
        default_stop_pct = params['default_stop_pct']
        fallback_stop = entry_price * (1 - default_stop_pct)
        stop_candidates.append((
            fallback_stop,
            'fallback',
            0.3,
            f'مفيش بيانات فنية — وقف افتراضي {default_stop_pct*100:.0f}%'
        ))
        trace.append(f"L4 FALLBACK stop: {fallback_stop:.2f} ({default_stop_pct*100:.1f}%)")

        # Choose best stop: highest confidence first, then tightest (closest to entry)
        if stop_candidates:
            stop_candidates.sort(key=lambda x: (-x[2], -x[0]))  # highest confidence, then closest to entry
            stop_loss = stop_candidates[0][0]
            result.stop_basis = stop_candidates[0][1]
            result.stop_detail = stop_candidates[0][3]
            trace.append(f"→ Selected stop: {stop_loss:.2f} via {result.stop_basis}")
        else:
            stop_loss = entry_price * 0.92
            result.stop_basis = 'fallback'
            result.stop_detail = '8% افتراضي'

        # Score adjustment: tighter stop for high confidence signals
        actual_stop_pct = (entry_price - stop_loss) / entry_price
        if score >= 70:
            tighter_stop = entry_price - (entry_price - stop_loss) * 0.85
            new_stop_pct = (entry_price - tighter_stop) / entry_price
            if new_stop_pct >= MIN_STOP_PCT:
                stop_loss = tighter_stop
                result.stop_basis += '+tight'
                trace.append(f"Score {score}≥70 → Tightened stop to {stop_loss:.2f}")
        elif score < 48:
            wider_stop = entry_price - (entry_price - stop_loss) * 1.2
            new_stop_pct = (entry_price - wider_stop) / entry_price
            if new_stop_pct <= MAX_STOP_PCT:
                stop_loss = wider_stop
                result.stop_basis += '+wide'
                trace.append(f"Score {score}<48 → Widened stop to {stop_loss:.2f}")

        # Candlestick pattern adjustment for stop
        if candlestick_pattern and candlestick_direction == 'BULLISH' and candlestick_at_support:
            # Bullish reversal at support → can use tighter stop
            tighter = entry_price - (entry_price - stop_loss) * 0.9
            if (entry_price - tighter) / entry_price >= MIN_STOP_PCT:
                stop_loss = tighter
                result.stop_basis += '+candle'
                trace.append(f"Bullish candle at support → Tightened stop to {stop_loss:.2f}")
        elif candlestick_pattern and candlestick_direction == 'BEARISH' and candlestick_at_resistance:
            # Bearish at resistance → wider stop (or exit signal)
            wider = entry_price - (entry_price - stop_loss) * 1.15
            if (entry_price - wider) / entry_price <= MAX_STOP_PCT:
                stop_loss = wider
                result.stop_basis += '+bearish'
                trace.append(f"Bearish candle at resistance → Widened stop to {stop_loss:.2f}")

        # Ensure stop is below entry
        if stop_loss >= entry_price:
            stop_loss = entry_price * (1 - default_stop_pct)

        actual_stop_pct = (entry_price - stop_loss) / entry_price

        # ========================================
        # STEP 2: Calculate TARGET — 5 layers
        # Priority: Resistance → Swing High → Fibonacci → ATR → R/R Validation
        # ========================================
        target_candidates = []
        # DYNAMIC-SYSTEM-001: min_rr ديناميكي بناءً على حالة السوق.
        # bull → 2.0 (نطمع أكتر). bear → 1.5 (نسارع للخروج). range → 1.2.
        # لو الأدمن غيّر القيمة في اللوحة، بتقرأ من engine_settings.
        _ctx_for_rr = get_dynamic_context(ticker) if _DYNAMIC_AVAILABLE and ticker else None
        _market_regime = _ctx_for_rr.market_regime if _ctx_for_rr else 'range'
        min_rr = get_dynamic_min_rr(_market_regime)
        # لو الـ dynamic رجّع أقل من الـ persona default، ناخذ الأعلى (احترام للـ persona)
        min_rr = max(min_rr, params['min_rr'])

        # Score-based R:R adjustment (احتفظ بالسلوك القديم)
        if score >= 70:
            min_rr = max(min_rr, 2.5)
        elif score >= 55:
            min_rr = max(min_rr, 2.0)

        # 🔥 MOMENTUM TARGET ESCALATION (P14 — أغسطس 2026)
        # أسهم الزخم اللحظي (Pump) بتطير 10%-20% في يوم. الأهداف العادية (1.5R/3R)
        # صغيرة جداً على الأسهم دي. لو السهم عنده volume_spike (vol_ratio >= 2.0)
        # نرفع الـ R/R لـ 4.0 عشان نكسب من الـ Pump كله.
        _momentum_target = False
        if volume is not None and volume_sma_20 is not None and volume_sma_20 > 0:
            _vol_ratio_mom = volume / volume_sma_20
            if _vol_ratio_mom >= 2.0:
                min_rr = max(min_rr, 4.0)
                _momentum_target = True
                trace.append(
                    f"🔥 MOMENTUM TARGET: vol_ratio={_vol_ratio_mom:.1f}x ≥ 2.0 → "
                    f"min_rr escalated to 4.0 (1:4 R/R لالتقاط الـ Pump)"
                )

        # Layer 1: مقاومة فنية (أولوية قصوى)
        if resistance and resistance > entry_price:
            buffer = params['resistance_buffer']  # e.g., 0.98 = 2% before resistance
            resistance_target = resistance * buffer
            resistance_target_pct = (resistance_target - entry_price) / entry_price
            rr_from_resistance = resistance_target_pct / actual_stop_pct if actual_stop_pct > 0 else 0
            if rr_from_resistance >= 0.8:  # At least 0.8:1 (will be validated later)
                target_candidates.append((
                    resistance_target,
                    'resistance_level',
                    1.0,
                    f'أقرب مقاومة عند {resistance:.2f}, buffer {(1-buffer)*100:.0f}%'
                ))
                trace.append(f"L1 RESISTANCE target: {resistance_target:.2f} ({resistance_target_pct*100:.1f}%, R:R={rr_from_resistance:.1f})")

        # Layer 2: أعلى سعر أخير (Swing High 20 شمعة)
        if swing_high and swing_high > entry_price:
            swing_high_target = swing_high * 0.99  # 1% below swing high
            swing_high_target_pct = (swing_high_target - entry_price) / entry_price
            if swing_high_target_pct >= 0.005:
                target_candidates.append((
                    swing_high_target,
                    'swing_high',
                    0.85,
                    f'Swing High آخر 20 شمعة = {swing_high:.2f}, buffer 1%'
                ))
                trace.append(f"L2 SWING_HIGH target: {swing_high_target:.2f} ({swing_high_target_pct*100:.1f}%)")

        # Layer 3: Fibonacci Extension (1.618)
        if swing_low > 0 and swing_high > 0 and swing_high > swing_low:
            fib_target = calculate_fibonacci_extension(swing_low, swing_high, level=0.618)
            if fib_target > entry_price:
                fib_target_pct = (fib_target - entry_price) / entry_price
                if fib_target_pct >= 0.005:
                    target_candidates.append((
                        fib_target,
                        'fibonacci_1618',
                        0.8,
                        f'Fibonacci 1.618 extension = {fib_target:.2f} (swing {swing_low:.2f}→{swing_high:.2f})'
                    ))
                    trace.append(f"L3 FIBONACCI target: {fib_target:.2f} ({fib_target_pct*100:.1f}%)")

        # Layer 4: ATR-based Target
        if atr and atr > 0:
            atr_target_mult = params['atr_target_mult']
            atr_target = entry_price + (atr_target_mult * atr)
            atr_target_pct = (atr_target - entry_price) / entry_price
            if atr_target_pct >= 0.005:
                target_candidates.append((
                    atr_target,
                    'atr_target',
                    0.75,
                    f'ATR × {atr_target_mult} = {atr_target_mult*atr:.2f} فوق الدخول'
                ))
                trace.append(f"L4 ATR target: {atr_target:.2f} ({atr_target_pct*100:.1f}%)")

        # Layer 5: R/R Validation — enforce minimum R:R
        rr_enforced_target = entry_price + (entry_price - stop_loss) * min_rr
        rr_target_pct = (rr_enforced_target - entry_price) / entry_price
        if rr_target_pct >= 0.005:
            target_candidates.append((
                rr_enforced_target,
                'rr_enforced',
                0.7,
                f'R:R ≥ {min_rr}:1 enforced = {rr_enforced_target:.2f}'
            ))
            trace.append(f"L5 R/R target ({min_rr}:1): {rr_enforced_target:.2f} ({rr_target_pct*100:.1f}%)")

        # Choose best target
        if target_candidates:
            # Prefer: resistance > fibonacci > swing_high > atr > rr_enforced (by confidence)
            # But also ensure minimum R:R
            target_candidates.sort(key=lambda x: (-x[2], -x[0]))

            # First try the highest confidence target
            target_price = target_candidates[0][0]
            result.target_basis = target_candidates[0][1]
            result.target_detail = target_candidates[0][3]

            # Check if it meets minimum R:R
            actual_target_pct = (target_price - entry_price) / entry_price
            actual_rr = actual_target_pct / actual_stop_pct if actual_stop_pct > 0 else 0

            if actual_rr < min_rr:
                # Try other candidates that meet min R:R
                found = False
                for tc in target_candidates:
                    tc_pct = (tc[0] - entry_price) / entry_price
                    tc_rr = tc_pct / actual_stop_pct if actual_stop_pct > 0 else 0
                    if tc_rr >= min_rr:
                        target_price = tc[0]
                        result.target_basis = tc[1]
                        result.target_detail = tc[3]
                        found = True
                        break

                if not found:
                    # None meet min R:R — enforce it
                    # Try adjusting stop tighter first if it's wider than 5%
                    if actual_stop_pct > 0.05:
                        adjusted_stop = entry_price - (actual_target_pct / min_rr) * entry_price
                        adjusted_stop_pct = (entry_price - adjusted_stop) / entry_price
                        if adjusted_stop_pct >= MIN_STOP_PCT:
                            stop_loss = adjusted_stop
                            result.stop_basis += '+rr_adjusted'
                            actual_stop_pct = adjusted_stop_pct
                            trace.append(f"Adjusted stop tighter for R:R: {stop_loss:.2f}")
                        else:
                            # Can't tighten further, use enforced target
                            target_price = rr_enforced_target
                            result.target_basis = 'rr_enforced'
                            result.target_detail = f'R:R {min_rr}:1 enforced'
                    else:
                        target_price = rr_enforced_target
                        result.target_basis = 'rr_enforced'
                        result.target_detail = f'R:R {min_rr}:1 enforced'

            trace.append(f"→ Selected target: {target_price:.2f} via {result.target_basis}")
        else:
            target_price = entry_price * 1.10
            result.target_basis = 'fallback'
            result.target_detail = '10% افتراضي'

        # Ensure target is above entry
        if target_price <= entry_price:
            target_price = entry_price + (entry_price - stop_loss) * min_rr

        # ══════════════════════════════════════════════════════════
        # حد أقصى للمستهدف — مفيش سهم بيصعد أكتر من 200% كمستهدف منطقي
        # لو الهدف أكتر من 3 أضعاف سعر الدخول، نحدده عند 3x
        # 🔥 MOMENTUM (P14): أسهم الزخم بتطير أكتر — نرفع السقف لـ 5x
        # ══════════════════════════════════════════════════════════
        _max_mult = 5.0 if _momentum_target else 3.0
        max_target_price = entry_price * _max_mult
        if target_price > max_target_price:
            trace.append(f"⚠️ Target {target_price:.2f} > entry*{_max_mult} ({max_target_price:.2f}) — تم تحديد الهدف عند {_max_mult}x")
            target_price = max_target_price
            result.target_basis = 'hard_capped'
            result.target_detail = f'تم تحديد المستهدف عند {(_max_mult-1)*100:.0f}% (حد أقصى) — كان {result.target_detail}'

        # ========================================
        # STEP 3: Final calculations
        # ========================================
        actual_target_pct = (target_price - entry_price) / entry_price
        actual_stop_pct = (entry_price - stop_loss) / entry_price

        risk = entry_price - stop_loss
        reward = target_price - entry_price
        risk_reward = reward / risk if risk > 0 else 0
        # Rule 54: استخدم canonical compute_risk_reward
        try:
            from utils.risk_reward import compute_risk_reward
            risk_reward = compute_risk_reward(entry_price, target_price, stop_loss, fallback=risk_reward)
        except Exception:
            pass  # keep inline risk_reward computed above

        result.stop_loss = round(stop_loss, 2)
        result.stop_pct = round(actual_stop_pct * 100, 1)
        result.target_price = round(target_price, 2)
        result.target_pct = round(actual_target_pct * 100, 1)
        result.risk_reward = round(risk_reward, 2)
        result.rr_valid = risk_reward >= min_rr

        # ========================================
        # STEP 4: Validation Rules
        # ========================================
        # Rule: Stop wider than 15% = reject (too risky)
        if actual_stop_pct > MAX_STOP_PCT:
            trace.append(f"⚠️ Stop {actual_stop_pct*100:.1f}% > 15% —高风险")
            result.stop_detail += ' [تحذير: وقف واسع جداً]'

        # Rule: Target above resistance × 1.02 = adjust to resistance
        if resistance and resistance > 0 and target_price > resistance * 1.02:
            trace.append(f"⚠️ Target {target_price:.2f} > resistance × 1.02 — adjusting")
            adjusted_target = resistance * 0.98
            if adjusted_target > entry_price:
                target_price = adjusted_target
                result.target_price = round(target_price, 2)
                result.target_pct = round(((target_price - entry_price) / entry_price) * 100, 1)
                result.target_basis = 'resistance_capped'
                result.target_detail = f'تم تعديل الهدف للمقاومة ({resistance:.2f})'

        # Rule: ATR/entry > 5% = high volatility, widen stop
        if atr and entry_price > 0 and (atr / entry_price) > 0.05:
            trace.append(f"⚠️ ATR/entry = {atr/entry_price*100:.1f}% > 5% — high volatility")
            # Use ATR × 2 for stop instead
            if result.stop_basis.startswith('support') or result.stop_basis.startswith('swing'):
                # Keep the better stop but add warning
                result.stop_detail += ' [تذبذب عالي]'

        # ══════════════════════════════════════════════════════════
        # حد أقصى نهائي لنسبة المستهدف — لو أكتر من 200% نحدده
        # مستهدف 200% (3x سعر الدخول) هو أقصى حد منطقي
        # 🔥 MOMENTUM (P14): أسهم الزخم — نرفع السقف لـ 400% (5x)
        # نعيد حساب R/R بعد التحديد
        # ══════════════════════════════════════════════════════════
        _max_pct = 400.0 if _momentum_target else 200.0
        if result.target_pct > _max_pct:
            trace.append(f"⚠️ target_pct {result.target_pct:.1f}% > {_max_pct}% — تم تحديد المستهدف عند {_max_pct}%")
            target_price = entry_price * (_max_mult if _momentum_target else 3.0)
            result.target_price = round(target_price, 2)
            result.target_pct = _max_pct
            # إعادة حساب R/R بعد التحديد
            risk = entry_price - stop_loss
            reward = target_price - entry_price
            risk_reward = reward / risk if risk > 0 else 0
            # Rule 54: استخدم canonical compute_risk_reward
            try:
                from utils.risk_reward import compute_risk_reward
                risk_reward = compute_risk_reward(entry_price, target_price, stop_loss, fallback=risk_reward)
            except Exception:
                pass  # keep inline risk_reward computed above
            result.risk_reward = round(risk_reward, 2)
            result.rr_valid = risk_reward >= min_rr
            if result.target_basis != 'hard_capped':
                result.target_basis = 'pct_capped'
                result.target_detail = f'تم تحديد النسبة عند {_max_pct}% (حد أقصى نهائي) — كان {result.target_detail}'

        # ========================================
        # STEP 5: Exit Signals (قمة الخول)
        # ========================================
        current_volume = volume
        if current_volume is None and price_history:
            last_row = price_history[-1] if price_history else {}
            current_volume = float(last_row.get('volume', 0)) if last_row.get('volume') else None

        # Calculate volume SMA 20 if not provided
        if volume_sma_20 is None and price_history:
            recent_vols = [float(r.get('volume', 0)) for r in price_history[-20:] if r.get('volume')]
            if recent_vols:
                volume_sma_20 = sum(recent_vols) / len(recent_vols)

        exit_signals, exit_score = calculate_exit_signals(
            entry_price=entry_price,
            current_price=entry_price,
            resistance=resistance or 0,
            rsi=rsi,
            volume=current_volume,
            volume_sma_20=volume_sma_20,
            macd_histogram=macd_histogram,
            prev_macd_histogram=prev_macd_histogram,
            candlestick_pattern=candlestick_pattern,
            candlestick_direction=candlestick_direction,
            candlestick_at_resistance=candlestick_at_resistance,
            high_20=swing_high if swing_high > 0 else None,
        )
        result.exit_signals = exit_signals
        result.exit_score = exit_score

        # ========================================
        # STEP 6: Entry Signals
        # ========================================
        entry_signals, entry_score = calculate_entry_signals(
            entry_price=entry_price,
            support=support or 0,
            rsi=rsi,
            volume=current_volume,
            volume_sma_20=volume_sma_20,
            candlestick_pattern=candlestick_pattern,
            candlestick_direction=candlestick_direction,
            candlestick_at_support=candlestick_at_support,
        )
        result.entry_signals = entry_signals

        # ========================================
        # STEP 7: Recommendation
        # ========================================
        if exit_score >= 60:
            result.recommendation = 'REDUCE'
            trace.append(f"🚨 EXIT SCORE {exit_score}≥60 → REDUCE / TAKE_PROFIT")
        elif exit_score >= 40:
            result.recommendation = 'CAUTIOUS'
            trace.append(f"⚠️ EXIT SCORE {exit_score}≥40 → CAUTIOUS")
        elif entry_score >= 50:
            result.recommendation = 'STRONG_BUY'
            trace.append(f"✅ ENTRY SCORE {entry_score}≥50 → STRONG_BUY")
        elif entry_score >= 30:
            result.recommendation = 'BUY'
            trace.append(f"✅ ENTRY SCORE {entry_score}≥30 → BUY")
        else:
            result.recommendation = 'HOLD'

        result.calculation_trace = trace
        return result

    # ==================== DATA LOADING ====================

    def _load_price_history(self, ticker: str, days: int = 90) -> List[Dict]:
        """Load price history from DB"""
        try:
            db_path = self.price_history_db
            if not os.path.exists(db_path):
                return []

            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.get_connection(db_path, writable=False)
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute(
                """
                SELECT date, open_price, high_price, low_price, close_price, volume
                FROM price_history
                WHERE ticker = ?
                ORDER BY date DESC
                LIMIT ?
                """,
                (ticker.upper(), int(days)),
            )
            rows = [dict(r) for r in cur.fetchall()]
            conn.close()
            rows.reverse()  # oldest → newest
            return rows
        except Exception as e:
            print(f"[DynamicTargetEngine] Price history DB error for {ticker}: {e}")
            return []

    def _calculate_support_resistance(self, ticker: str, price_history: List[Dict] = None) -> Optional[Dict]:
        """Calculate S/R using the dedicated calculator"""
        try:
            from analyzers.support_resistance_calculator import calculate_support_resistance
            sr = calculate_support_resistance(ticker, db_path=self.price_history_db)
            if sr:
                return sr
        except ImportError:
            pass
        except Exception as e:
            print(f"[DynamicTargetEngine] S/R calculator error: {e}")

        # Fallback: calculate from price history
        if price_history and len(price_history) >= 30:
            return self._calculate_sr_from_history(price_history)

        return None

    def _calculate_sr_from_history(self, rows: List[Dict], lookback: int = 5) -> Optional[Dict]:
        """Calculate S/R from price history using swing detection"""
        if not rows or len(rows) < 30:
            return None

        current_price = float(rows[-1].get("close_price", 0))
        if current_price <= 0:
            return None

        # Detect swing highs
        swing_highs = []
        n = len(rows)
        for i in range(lookback, n - lookback):
            center_high = float(rows[i].get("high_price", 0))
            if center_high <= 0:
                continue
            is_max = True
            for j in range(i - lookback, i + lookback + 1):
                if j == i:
                    continue
                other_high = float(rows[j].get("high_price", 0))
                if other_high >= center_high:
                    is_max = False
                    break
            if is_max:
                swing_highs.append(center_high)

        # Detect swing lows
        swing_lows = []
        for i in range(lookback, n - lookback):
            center_low = float(rows[i].get("low_price", 0))
            if center_low <= 0:
                continue
            is_min = True
            for j in range(i - lookback, i + lookback + 1):
                if j == i:
                    continue
                other_low = float(rows[j].get("low_price", 0))
                if other_low <= center_low:
                    is_min = False
                    break
            if is_min:
                swing_lows.append(center_low)

        supports_below = sorted([s for s in swing_lows if 0 < s < current_price],
                                key=lambda x: current_price - x)
        resistances_above = sorted([r for r in swing_highs if r > current_price],
                                   key=lambda x: x - current_price)

        support = supports_below[0] if supports_below else 0.0
        resistance = resistances_above[0] if resistances_above else 0.0

        # ══════════════════════════════════════════════════════════
        # تحقق من معقولية الدعم والمقاومة بالنسبة للسعر الحالي
        # لو الدعم أو المقاومة بعيدين جداً عن السعر، يبقى في خطأ بيانات
        # الدعم لازم يكون أكبر من 50% من السعر الحالي
        # المقاومة لازم تكون أقل من ضعف السعر الحالي
        # ══════════════════════════════════════════════════════════
        if support > 0 and support < current_price * 0.5:
            # الدعم أقل من 50% تحت السعر — بيانات مش واقعية (مثلاً بعد تقسيم سهم)
            support = 0.0
        if resistance > 0 and resistance > current_price * 2.0:
            # المقاومة أكتر من ضعف السعر — بيانات مش واقعية
            resistance = 0.0

        # Zone
        if support > 0 and (current_price - support) / support < 0.05:
            zone = 'near_support'
        elif resistance > 0 and (resistance - current_price) / current_price < 0.05:
            zone = 'near_resistance'
        elif not supports_below and resistances_above:
            zone = 'breakdown'
        elif supports_below and not resistances_above:
            zone = 'breakout'
        else:
            zone = 'middle'

        return {
            'support': round(support, 4),
            'resistance': round(resistance, 4),
            'zone': zone,
            'current_price': round(current_price, 4),
        }

    def _calculate_atr_from_history(self, price_history: List[Dict], period: int = 14) -> float:
        """Calculate ATR from price history.

        BRAVO UNIFY: transitively delegates to canonical analyzers.indicators.atr.calc_atr
        via calculate_atr (Wilder's smoothing).
        """
        if not price_history or len(price_history) < period + 1:
            return 0.0

        highs = [float(r.get('high_price', 0)) for r in price_history if r.get('high_price')]
        lows = [float(r.get('low_price', 0)) for r in price_history if r.get('low_price')]
        closes = [float(r.get('close_price', 0)) for r in price_history if r.get('close_price')]

        return calculate_atr(highs, lows, closes, period)

    def _calculate_30d_range(self, price_history: List[Dict]) -> Tuple[Optional[float], Optional[float]]:
        """Calculate 30-day high and low"""
        if not price_history:
            return None, None

        recent = price_history[-30:] if len(price_history) >= 30 else price_history
        highs = [float(r.get('high_price', 0)) for r in recent if r.get('high_price', 0)]
        lows = [float(r.get('low_price', 0)) for r in recent if r.get('low_price', 0)]

        return (max(highs) if highs else None), (min(lows) if lows else None)


# ==================== CONVENIENCE FUNCTION ====================

def calculate_dynamic_targets(
    ticker: str,
    entry_price: float,
    score: float = 50,
    persona: str = 'balanced',
    mode: str = 'mean_reversion',
    sl_mult: float = 3.0,
    trail_mult: float = 3.0,
    support: float = None,
    resistance: float = None,
    atr: float = None,
    atr_pct: float = None,
    high_30d: float = None,
    low_30d: float = None,
    volatility: float = 3.0,
    rsi: float = None,
    volume: float = None,
    volume_sma_20: float = None,
    macd_histogram: float = None,
    prev_macd_histogram: float = None,
    bb_lower: float = None,
    bb_upper: float = None,
    candlestick_pattern: str = '',
    candlestick_direction: str = '',
    zone: str = None,
) -> Dict:
    """
    Convenience function for calculating dynamic targets.
    Returns a dict compatible with the existing risk_profile format + new fields.
    """
    engine = DynamicTargetEngine()
    result = engine.calculate(
        ticker=ticker,
        entry_price=entry_price,
        score=score,
        persona=persona,
        mode=mode,
        sl_mult=sl_mult,
        trail_mult=trail_mult,
        support=support,
        resistance=resistance,
        atr=atr,
        atr_pct=atr_pct,
        high_30d=high_30d,
        low_30d=low_30d,
        volatility=volatility,
        rsi=rsi,
        volume=volume,
        volume_sma_20=volume_sma_20,
        macd_histogram=macd_histogram,
        prev_macd_histogram=prev_macd_histogram,
        bb_lower=bb_lower,
        bb_upper=bb_upper,
        candlestick_pattern=candlestick_pattern,
        candlestick_direction=candlestick_direction,
        zone=zone,
    )

    # P43-TARGET-DIRECTION-VALIDATION: نتأكد إن target/stop بيتوافقوا مع direction التوصية.
    # المشكلة: الـ Engine ممكن يطلّع target < entry (لو resistance تحت entry_price)
    # والتوصية BUY — ده انقلاب منطقي. النتيجة: الصفقة بتتقفل TARGET_HIT في نفس اليوم
    # لأن السعر بيعرج تحت entry بسهولة.
    # الحل: نصحح القيم المعكوسة + نسجل warning.
    direction_warnings = []
    direction_validated = True
    rec = (result.recommendation or '').upper()
    is_buy_rec = rec in ('BUY', 'STRONG_BUY', 'ACCUMULATE')
    is_sell_rec = rec in ('REDUCE', 'SELL', 'STRONG_SELL')
    MIN_TARGET_PCT = 0.05  # 5% upside minimum لـ BUY
    MIN_STOP_PCT = 0.05    # 5% downside minimum لـ BUY

    if is_buy_rec and entry_price > 0:
        # BUY: target لازم يكون فوق entry، stop لازم يكون تحت entry
        if result.target_price <= entry_price:
            old_target = result.target_price
            # صحح: استخدم max(target الحالي, entry × 1.05)
            corrected_target = round(entry_price * (1 + MIN_TARGET_PCT), 2)
            result.target_price = corrected_target
            result.target_pct = MIN_TARGET_PCT * 100
            if not result.target_basis or result.target_basis == 'fallback':
                result.target_basis = 'direction_corrected'
                result.target_detail = f'تصحيح اتجاه — كان {old_target} ≤ entry {entry_price}'
            direction_warnings.append(
                f'Target {old_target} ≤ entry {entry_price} for BUY → corrected to {corrected_target} (+5%)'
            )
            direction_validated = False
        if result.stop_loss >= entry_price:
            old_stop = result.stop_loss
            # صحح: استخدم min(stop الحالي, entry × 0.95)
            corrected_stop = round(entry_price * (1 - MIN_STOP_PCT), 2)
            result.stop_loss = corrected_stop
            result.stop_pct = MIN_STOP_PCT * 100
            if not result.stop_basis or result.stop_basis == 'fallback':
                result.stop_basis = 'direction_corrected'
                result.stop_detail = f'تصحيح اتجاه — كان {old_stop} ≥ entry {entry_price}'
            direction_warnings.append(
                f'Stop {old_stop} ≥ entry {entry_price} for BUY → corrected to {corrected_stop} (-5%)'
            )
            direction_validated = False
        # أعِد حساب R/R بعد التصحيح
        risk = entry_price - result.stop_loss
        reward = result.target_price - entry_price
        if risk > 0:
            result.risk_reward = round(reward / risk, 2)
            # Rule 54: استخدم canonical compute_risk_reward
            try:
                from utils.risk_reward import compute_risk_reward
                result.risk_reward = compute_risk_reward(entry_price, result.target_price, result.stop_loss, fallback=result.risk_reward)
            except Exception:
                pass  # keep inline risk_reward computed above
            result.rr_valid = result.risk_reward >= 1.0
    elif is_sell_rec and entry_price > 0:
        # SELL/REDUCE: target لازم يكون تحت entry، stop لازم يكون فوق entry
        if result.target_price >= entry_price:
            old_target = result.target_price
            corrected_target = round(entry_price * (1 - MIN_TARGET_PCT), 2)
            result.target_price = corrected_target
            result.target_pct = MIN_TARGET_PCT * 100
            direction_warnings.append(
                f'Target {old_target} ≥ entry {entry_price} for SELL → corrected to {corrected_target} (-5%)'
            )
            direction_validated = False
        if result.stop_loss <= entry_price:
            old_stop = result.stop_loss
            corrected_stop = round(entry_price * (1 + MIN_STOP_PCT), 2)
            result.stop_loss = corrected_stop
            result.stop_pct = MIN_STOP_PCT * 100
            direction_warnings.append(
                f'Stop {old_stop} ≤ entry {entry_price} for SELL → corrected to {corrected_stop} (+5%)'
            )
            direction_validated = False
        risk = result.stop_loss - entry_price
        reward = entry_price - result.target_price
        if risk > 0:
            result.risk_reward = round(reward / risk, 2)
            # Rule 54: استخدم canonical compute_risk_reward (SELL-aware)
            try:
                from utils.risk_reward import compute_risk_reward
                result.risk_reward = compute_risk_reward(entry_price, result.target_price, result.stop_loss, fallback=result.risk_reward)
            except Exception:
                pass  # keep inline risk_reward computed above
            result.rr_valid = result.risk_reward >= 1.0

    return {
        # Core
        'target_price': result.target_price,
        'target_pct': result.target_pct,
        'target_basis': result.target_basis,
        'target_detail': result.target_detail,
        'stop_loss': result.stop_loss,
        'stop_pct': result.stop_pct,
        'stop_basis': result.stop_basis,
        'stop_detail': result.stop_detail,
        'risk_reward': result.risk_reward,
        'rr_valid': result.rr_valid,
        'entry_price': result.entry_price,
        'recommendation': result.recommendation,

        # Technical data
        'atr_14': result.atr_14,
        'support_level': result.support_level,
        'resistance_level': result.resistance_level,
        'swing_low': result.swing_low,
        'swing_high': result.swing_high,

        # Candlestick
        'candlestick_context': result.candlestick_context,
        'candlestick_pattern': result.candlestick_pattern,
        'candlestick_strength': result.candlestick_strength,

        # Exit/Entry signals
        'exit_score': result.exit_score,
        'exit_signals': [
            {'signal': s.signal, 'score': s.score, 'triggered': s.triggered, 'detail': s.detail}
            for s in result.exit_signals
        ],
        'entry_signals': [
            {'signal': s.signal, 'score': s.score, 'triggered': s.triggered, 'detail': s.detail}
            for s in result.entry_signals
        ],

        # Trace
        'calculation_trace': result.calculation_trace,

        # Trend-following specific fields
        'trailing_stop_price': result.trailing_stop_price,
        'atr_sl_mult': result.atr_sl_mult,
        'atr_trail_mult': result.atr_trail_mult,
        'trailing_stop_atr_mult': result.trailing_stop_atr_mult,
        'initial_stop_atr_mult': result.initial_stop_atr_mult,
        'max_holding_days': result.max_holding_days,
        'exit_type': result.exit_type,
        'is_trend_following': result.is_trend_following,
        'breakout_confirmed': result.breakout_confirmed,
        'rr_label': result.rr_label,

        # Legacy compatibility
        'stop_method': result.stop_basis,
        'target_method': result.target_basis,
        'zone': zone or result.candlestick_context,

        # P43-TARGET-DIRECTION-VALIDATION
        'direction_validated': direction_validated,
        'direction_warnings': direction_warnings,
    }


# ==================== CLI ====================

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python3 dynamic_target_engine.py <TICKER> [score] [persona]")
        print("Example: python3 dynamic_target_engine.py COMI 65 balanced")
        sys.exit(1)

    _ticker = sys.argv[1]
    _score = float(sys.argv[2]) if len(sys.argv) > 2 else 50
    _persona = sys.argv[3] if len(sys.argv) > 3 else 'balanced'

    # Get current price from DB
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(DEFAULT_STOCKS_DB, writable=False)
        cur = conn.cursor()
        cur.execute('SELECT current_price FROM stocks WHERE ticker = ?', (_ticker.upper(),))
        row = cur.fetchone()
        conn.close()
        _price = row[0] if row and row[0] else 0
    except Exception:
        _price = 0

    if _price <= 0:
        print(f"❌ لا يوجد سعر حالى لـ {_ticker}")
        sys.exit(1)

    print(f"\n📊 Dynamic Target Engine — {_ticker}")
    print(f"   Entry Price: {_price:.2f}")
    print(f"   Score: {_score}")
    print(f"   Persona: {_persona}")
    print()

    result = calculate_dynamic_targets(
        ticker=_ticker,
        entry_price=_price,
        score=_score,
        persona=_persona,
    )

    print(f"🛡️  Stop Loss: {result['stop_loss']:.2f} ({result['stop_pct']:.1f}%) via {result['stop_basis']}")
    print(f"   Detail: {result['stop_detail']}")
    print(f"🎯 Target:    {result['target_price']:.2f} ({result['target_pct']:.1f}%) via {result['target_basis']}")
    print(f"   Detail: {result['target_detail']}")
    print(f"📊 R:R:       {result['risk_reward']:.1f}:1 (valid={result['rr_valid']})")
    print(f"📍 Context:   {result['candlestick_context']}")
    print(f"📈 Support:   {result['support_level']:.2f} | Resistance: {result['resistance_level']:.2f}")
    print(f"📉 Swing Low: {result['swing_low']:.2f} | Swing High: {result['swing_high']:.2f}")
    print(f"📐 ATR(14):   {result['atr_14']:.2f}")
    print(f"🚨 Exit Score: {result['exit_score']:.0f}")

    if result['exit_signals']:
        print("\n🚪 Exit Signals:")
        for s in result['exit_signals']:
            icon = '✅' if s['triggered'] else '⬜'
            print(f"   {icon} {s['signal']}: {s['score']}pts — {s['detail']}")

    if result['entry_signals']:
        print("\n🚀 Entry Signals:")
        for s in result['entry_signals']:
            icon = '✅' if s['triggered'] else '⬜'
            print(f"   {icon} {s['signal']}: {s['score']}pts — {s['detail']}")

    if result['calculation_trace']:
        print("\n📋 Calculation Trace:")
        for line in result['calculation_trace']:
            print(f"   {line}")
