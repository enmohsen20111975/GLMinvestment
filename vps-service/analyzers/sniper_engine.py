"""
SniperEngine — محرك القناص الموحد
====================================
يحل محل المحركات الثلاثة المتضاربة:
  1. MasterAnalyzer
  2. CoreScoringEngine
  3. SmartConfluenceEngine

فلسفة المحرك: "قناص مش رشاش" — تصويب دقيق على الأسهم اللي فعلاً تستاهل.

المكونات:
  - مؤشرات فنية صحيحة (RSI Wilder, MACD EMA-9, ATR, Bollinger, SMA, VWAP)
  - نقاط الدعم/المقاومة الحقيقية (من Swing Pivots)
  - تحليل السيولة وجودة الحجم
  - درجة أساسية (P/E, ROE, Piotroski)
  - حالة السوق (Market Regime)
  - أنماط الشموع اليابانية
  - 5 بوابات جودة (Gates) — لازم تعدي كلهم أو معظمهم

معادلة التسجيل:
  sniper_score = (
      technical_score * 0.25 +
      sr_position_score * 0.25 +
      volume_quality_score * 0.15 +
      fundamental_score * 0.20 +
      market_regime_score * 0.10 +
      candlestick_score * 0.05
  ) * liquidity_multiplier

Author: دليل الاستثمار
Version: 2.0.0 (Trend-Following)
"""

from __future__ import annotations

import os
import sqlite3
import math
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Tuple, Any
from dataclasses import dataclass, field, asdict

# ---------------------------------------------------------------------------
# Optional imports — try/except with fallback
# ---------------------------------------------------------------------------
try:
    from analyzers.dynamic_target_engine import DynamicTargetEngine
    _HAS_DYNAMIC_TARGET = True
except ImportError:
    _HAS_DYNAMIC_TARGET = False

try:
    from analyzers.support_resistance_calculator import calculate_support_resistance
    _HAS_SR_CALCULATOR = True
except ImportError:
    _HAS_SR_CALCULATOR = False

try:
    from analyzers.candlestick import CandlestickAnalyzer, CandleData
    _HAS_CANDLESTICK = True
except ImportError:
    _HAS_CANDLESTICK = False

try:
    from analyzers.liquidity_filter import LiquidityFilter
    _HAS_LIQUIDITY_FILTER = True
except ImportError:
    _HAS_LIQUIDITY_FILTER = False

try:
    from analyzers.regime_detector import RegimeDetector
    _HAS_REGIME_DETECTOR = True
except ImportError:
    _HAS_REGIME_DETECTOR = False


# ============================================================================
# PATH CONFIGURATION — relative ONLY, no /home/z/ or /root/
# ============================================================================

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
STOCKS_DB = str(_PROJECT_ROOT / 'db' / 'stocks.db')
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')
PREDICTIONS_DB = os.environ.get('PREDICTIONS_DB', str(_PROJECT_ROOT / 'db' / 'predictions.db'))


# ============================================================================
# SIGNAL TRANSLATION
# ============================================================================

SIGNAL_AR = {
    'STRONG_BUY': 'شراء قوي',
    'BUY': 'شراء',
    'HOLD': 'احتفاظ',
    'REDUCE': 'تخفيض',
    'SELL': 'بيع',
}


# ============================================================================
# SNIPER RESULT DATACLASS
# ============================================================================

@dataclass
class SniperResult:
    """نتيجة تحليل SniperEngine — كل البيانات في مكان واحد."""
    ticker: str
    market: str
    timestamp: str

    # Scores
    sniper_score: float            # 0-100 combined
    technical_score: float         # 0-100
    sr_position_score: float       # 0-100
    volume_quality_score: float    # 0-100
    fundamental_score: float       # 0-100
    market_regime_score: float     # 0-100
    candlestick_score: float       # 0-100
    liquidity_multiplier: float    # 0.5-1.0
    smc_score: float = 0.0         # 0-100 Smart Money Concepts
    smc_detail: str = ''

    # Indicators
    rsi: float = 0.0
    macd: Dict = field(default_factory=dict)
    atr: float = 0.0
    bollinger: Dict = field(default_factory=dict)
    sma: Dict = field(default_factory=dict)
    vwap: float = 0.0

    # S/R
    support: Optional[float] = None
    resistance: Optional[float] = None
    price_vs_sr: str = ''               # 'at_support', 'mid_range', 'at_resistance', 'breakout'

    # Volume
    volume_ratio: float = 0.0
    liquidity_rating: str = ''          # 'high', 'medium', 'low'

    # Candlestick
    candlestick_pattern: str = ''
    candlestick_direction: str = ''     # 'bullish', 'bearish', 'neutral'

    # Trade params
    entry_price: float = 0.0
    stop_loss: float = 0.0
    target_price: float = 0.0
    risk_reward: float = 0.0

    # Signal
    signal: str = ''                    # 'STRONG_BUY', 'BUY', 'HOLD', 'REDUCE', 'SELL'
    signal_ar: str = ''
    confidence: float = 0.0              # 0-100

    # Warnings
    warnings: List[str] = field(default_factory=list)
    warnings_ar: List[str] = field(default_factory=list)

    # Gate results (for sniper filter)
    gate_1_liquidity: bool = False
    gate_2_trend: bool = False
    gate_3_sr: bool = False
    gate_4_rr: bool = False
    gate_5_confirmation: bool = False
    gates_passed: int = 0              # 0-5

    # Trend-Following fields
    market_regime: str = 'unknown'
    donchian_score: float = 0.0
    trailing_stop_atr_mult: float = 3.0
    initial_stop_atr_mult: float = 3.0

    def to_dict(self) -> Dict:
        return asdict(self)


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def _safe_float(val: Any, default: float = 0.0) -> float:
    """Safely convert a value to float, stripping common suffixes including M/K/B."""
    if val is None:
        return default
    try:
        s = str(val).replace('%', '').replace(',', '').replace('SAR', '').replace('EGP', '').strip()
        if not s:
            return default
        # Handle M (millions), K (thousands), B (billions) suffixes
        multipliers = {'M': 1_000_000, 'K': 1_000, 'B': 1_000_000_000}
        for suffix, mult in multipliers.items():
            if s.upper().endswith(suffix):
                num_part = s[:-1].strip()
                return float(num_part) * mult if num_part else default
        return float(s)
    except (ValueError, TypeError):
        return default


def _conn(db_path: str) -> sqlite3.Connection:
    """Create a SQLite connection with row factory."""
    c = sqlite3.connect(db_path, timeout=15.0)
    c.row_factory = sqlite3.Row
    return c


# ============================================================================
# SNIPER ENGINE
# ============================================================================

class SniperEngine:
    """
    SniperEngine — محرك القناص الموحد

    Usage:
        engine = SniperEngine()
        result = engine.analyze('COMI', market='EGX')
        if result and result.gates_passed >= 4:
            print(f"{result.ticker}: {result.signal} (score={result.sniper_score:.1f})")

        # Scan entire market
        results = engine.scan_market(market='EGX', min_gates=4)
    """

    # Signal thresholds
    STRONG_BUY_THRESHOLD = 75
    BUY_THRESHOLD = 60
    HOLD_THRESHOLD = 45
    REDUCE_THRESHOLD = 30

    def __init__(self):
        self.stocks_db = STOCKS_DB
        self.price_history_db = PRICE_HISTORY_DB
        self.data_engine_db = DATA_ENGINE_DB
        self.predictions_db = PREDICTIONS_DB

        # Optional sub-engines
        self._dynamic_target_engine = None
        if _HAS_DYNAMIC_TARGET:
            try:
                self._dynamic_target_engine = DynamicTargetEngine()
            except Exception:
                self._dynamic_target_engine = None

        self._liquidity_filter = None
        if _HAS_LIQUIDITY_FILTER:
            try:
                self._liquidity_filter = LiquidityFilter(self.stocks_db)
            except Exception:
                self._liquidity_filter = None

    # ====================================================================
    # TECHNICAL INDICATORS — CORRECT implementations, no shortcuts
    # ====================================================================

    def calc_rsi(self, closes: List[float], period: int = 14) -> float:
        """
        RSI(14) — Standard Wilder smoothing.

        The correct implementation uses exponential (Wilder) smoothing
        for avg_gain and avg_loss, NOT simple average of last N periods.
        """
        if len(closes) < period + 1:
            return 50.0

        deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
        gains = [d if d > 0 else 0 for d in deltas]
        losses = [-d if d < 0 else 0 for d in deltas]

        avg_gain = sum(gains[:period]) / period
        avg_loss = sum(losses[:period]) / period

        if avg_loss == 0:
            return 100.0

        for i in range(period, len(deltas)):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period

        rs = avg_gain / avg_loss if avg_loss != 0 else 100.0
        return round(100 - (100 / (1 + rs)), 2)

    def calc_ema(self, data: List[float], period: int) -> List[float]:
        """Calculate Exponential Moving Average."""
        if not data:
            return []
        k = 2 / (period + 1)
        result = [data[0]]
        for i in range(1, len(data)):
            result.append(data[i] * k + result[-1] * (1 - k))
        return result

    def calc_macd(self, closes: List[float]) -> Dict:
        """
        MACD(12,26,9) — CORRECT implementation with EMA-9 signal line.

        The signal line is the EMA-9 of the MACD line, NOT macd*0.9 or any
        other shortcut. This is the standard definition.
        """
        if len(closes) < 26:
            return {'macd': 0, 'signal': 0, 'histogram': 0, 'direction': 'NEUTRAL'}

        ema12 = self.calc_ema(closes, 12)
        ema26 = self.calc_ema(closes, 26)
        macd_line = [a - b for a, b in zip(ema12, ema26)]
        signal_line = self.calc_ema(macd_line, 9)  # EMA-9 of MACD line

        macd_val = macd_line[-1]
        sig_val = signal_line[-1]
        hist = macd_val - sig_val

        if macd_val > sig_val and hist > 0:
            direction = 'BULLISH'
        elif macd_val < sig_val and hist < 0:
            direction = 'BEARISH'
        else:
            direction = 'NEUTRAL'

        return {
            'macd': round(macd_val, 4),
            'signal': round(sig_val, 4),
            'histogram': round(hist, 4),
            'direction': direction,
        }

    def calc_atr(self, highs: List[float], lows: List[float],
                 closes: List[float], period: int = 14) -> float:
        """
        ATR(14) — Average True Range with Wilder smoothing.

        True Range = max(H-L, |H-prevC|, |L-prevC|)
        """
        if len(closes) < period + 1:
            return 0.0

        trs: List[float] = []
        for i in range(1, len(closes)):
            if i >= len(highs) or i >= len(lows):
                break
            h = highs[i]
            l = lows[i]
            pc = closes[i - 1]
            if h <= 0 or l <= 0 or pc <= 0:
                continue
            tr = max(h - l, abs(h - pc), abs(l - pc))
            trs.append(tr)

        if len(trs) < period:
            return round(sum(trs) / len(trs), 4) if trs else 0.0

        atr = sum(trs[:period]) / period
        for i in range(period, len(trs)):
            atr = (atr * (period - 1) + trs[i]) / period

        return round(atr, 4)

    def calc_bollinger_bands(self, closes: List[float],
                             period: int = 20, num_std: float = 2.0) -> Dict:
        """
        Bollinger Bands(20, 2) — SMA-20 ± 2 standard deviations.
        """
        if len(closes) < period:
            return {
                'upper': 0.0, 'middle': 0.0, 'lower': 0.0,
                'bandwidth': 0.0, 'percent_b': 0.5,
            }

        slice_closes = closes[-period:]
        middle = sum(slice_closes) / period
        variance = sum((c - middle) ** 2 for c in slice_closes) / period
        std = math.sqrt(variance)

        upper = middle + num_std * std
        lower = middle - num_std * std
        bandwidth = ((upper - lower) / middle * 100) if middle > 0 else 0.0

        current = closes[-1]
        if upper != lower:
            percent_b = (current - lower) / (upper - lower)
        else:
            percent_b = 0.5

        return {
            'upper': round(upper, 4),
            'middle': round(middle, 4),
            'lower': round(lower, 4),
            'bandwidth': round(bandwidth, 2),
            'percent_b': round(max(0, min(1, percent_b)), 4),
        }

    def calc_sma(self, closes: List[float], periods: List[int] = None) -> Dict:
        """
        SMA — Simple Moving Averages (default: 20, 50, 200).
        """
        if periods is None:
            periods = [20, 50, 200]

        result: Dict[str, Optional[float]] = {}
        for p in periods:
            if len(closes) >= p:
                result[f'sma{p}'] = round(sum(closes[-p:]) / p, 4)
            else:
                result[f'sma{p}'] = None
        return result

    def calc_vwap(self, highs: List[float], lows: List[float],
                  closes: List[float], volumes: List[float]) -> float:
        """
        VWAP — Volume Weighted Average Price.

        Uses available data (typical price × volume) / total volume.
        """
        if not closes or not volumes or len(closes) != len(volumes):
            return 0.0

        cumulative_tp_vol = 0.0
        cumulative_vol = 0.0

        for i in range(len(closes)):
            vol = volumes[i] if i < len(volumes) else 0
            if vol <= 0:
                continue
            h = highs[i] if i < len(highs) else closes[i]
            l = lows[i] if i < len(lows) else closes[i]
            typical_price = (h + l + closes[i]) / 3.0
            cumulative_tp_vol += typical_price * vol
            cumulative_vol += vol

        if cumulative_vol == 0:
            return closes[-1] if closes else 0.0

        return round(cumulative_tp_vol / cumulative_vol, 4)

    def calc_volume_sma(self, volumes: List[float], period: int = 20) -> float:
        """Volume SMA — average volume over the last N periods."""
        if not volumes or len(volumes) < period:
            valid = [v for v in volumes if v > 0]
            return round(sum(valid) / len(valid), 0) if valid else 0.0
        return round(sum(volumes[-period:]) / period, 0)

    # ====================================================================
    # CANDLESTICK PATTERN DETECTION
    # ====================================================================

    def detect_candlestick_patterns(
        self,
        opens: List[float],
        highs: List[float],
        lows: List[float],
        closes: List[float],
    ) -> Tuple[str, str, float]:
        """
        Detect candlestick patterns from the last 3 candles.

        Returns: (pattern_name, direction, score)
          - pattern_name: e.g. 'HAMMER', 'BULLISH_ENGULFING', 'NONE'
          - direction: 'bullish', 'bearish', 'neutral'
          - score: 0-100 (contribution to sniper_score)
        """
        n = len(closes)
        if n < 3 or len(opens) < 3 or len(highs) < 3 or len(lows) < 3:
            return 'NONE', 'neutral', 50.0

        # Use last 3 candles
        c3_o, c3_h, c3_l, c3_c = opens[-3], highs[-3], lows[-3], closes[-3]
        c2_o, c2_h, c2_l, c2_c = opens[-2], highs[-2], lows[-2], closes[-2]
        c1_o, c1_h, c1_l, c1_c = opens[-1], highs[-1], lows[-1], closes[-1]

        # ---- SINGLE CANDLE PATTERNS ----

        # Doji (indecision)
        c1_body = abs(c1_c - c1_o)
        c1_range = c1_h - c1_l
        if c1_range > 0 and c1_body / c1_range < 0.1:
            return 'DOJI', 'neutral', 50.0

        # Hammer (bullish reversal)
        c1_upper_shadow = c1_h - max(c1_o, c1_c)
        c1_lower_shadow = min(c1_o, c1_c) - c1_l
        if c1_body > 0 and c1_lower_shadow >= c1_body * 2 and c1_upper_shadow < c1_body * 0.5:
            return 'HAMMER', 'bullish', 75.0

        # Shooting Star (bearish reversal)
        if c1_body > 0 and c1_upper_shadow >= c1_body * 2 and c1_lower_shadow < c1_body * 0.5:
            return 'SHOOTING_STAR', 'bearish', 25.0

        # ---- DOUBLE CANDLE PATTERNS ----

        # Bullish Engulfing
        c2_body = c2_c - c2_o  # negative = bearish
        if (c2_c < c2_o and  # Previous is bearish
                c1_c > c1_o and  # Current is bullish
                c1_o < c2_c and  # Current opens below prev close
                c1_c > c2_o):    # Current closes above prev open
            return 'BULLISH_ENGULFING', 'bullish', 80.0

        # Bearish Engulfing
        if (c2_c > c2_o and  # Previous is bullish
                c1_c < c1_o and  # Current is bearish
                c1_o > c2_c and  # Current opens above prev close
                c1_c < c2_o):    # Current closes below prev open
            return 'BEARISH_ENGULFING', 'bearish', 20.0

        # ---- TRIPLE CANDLE PATTERNS ----

        c3_body = abs(c3_c - c3_o)
        c2_body_abs = abs(c2_c - c2_o)

        # Morning Star (bullish reversal)
        if (c3_c < c3_o and  # First candle bearish
                c2_body_abs < c3_body * 0.3 and  # Second candle small
                c1_c > c1_o and  # Third candle bullish
                c1_c > (c3_o + c3_c) / 2):  # Third closes above middle of first
            return 'MORNING_STAR', 'bullish', 85.0

        # Evening Star (bearish reversal)
        if (c3_c > c3_o and  # First candle bullish
                c2_body_abs < c3_body * 0.3 and  # Second candle small
                c1_c < c1_o and  # Third candle bearish
                c1_c < (c3_o + c3_c) / 2):  # Third closes below middle of first
            return 'EVENING_STAR', 'bearish', 15.0

        # No pattern detected — score based on candle direction
        if c1_c > c1_o:
            return 'NONE', 'bullish', 55.0
        elif c1_c < c1_o:
            return 'NONE', 'bearish', 45.0
        else:
            return 'NONE', 'neutral', 50.0

    # ====================================================================
    # SCORING COMPONENTS
    # ====================================================================

    def _calc_technical_score(
        self,
        rsi: float,
        macd: Dict,
        sma: Dict,
        bollinger: Dict,
        atr: float,
        price: float,
        donchian_score: float = 50.0,
    ) -> float:
        """
        Technical Score (0-100) from RSI + MACD + SMA + Bollinger + ATR + Donchian.

        Components:
          - RSI contribution: 0-25
          - MACD contribution: 0-25
          - SMA trend: 0-25
          - Bollinger position: 0-15
          - ATR volatility bonus: 0-10
          - Donchian breakout: 0-7
        """
        score = 0.0

        # RSI (0-25) — Trend-Following: buy trending, not oversold
        if rsi < 30:
            rsi_score = 2    # Downtrend — avoid
        elif rsi < 40:
            rsi_score = 6    # Below neutral — weak
        elif rsi < 50:
            rsi_score = 10   # Slightly below neutral
        elif rsi < 60:
            rsi_score = 16   # Above neutral — trending
        elif rsi < 70:
            rsi_score = 22   # Strong uptrend — best zone
        elif rsi < 80:
            rsi_score = 8    # Overbought but still up — caution
        else:
            rsi_score = 5    # Deeply overbought — exhaustion
        score += rsi_score

        # MACD (0-25)
        macd_dir = macd.get('direction', 'NEUTRAL')
        hist = macd.get('histogram', 0)
        if macd_dir == 'BULLISH':
            macd_score = 20 + min(5, abs(hist) * 1000)  # Up to 25
        elif macd_dir == 'BEARISH':
            macd_score = 5
        else:
            macd_score = 12
        score += min(25, macd_score)

        # SMA trend (0-25)
        sma20 = sma.get('sma20')
        sma50 = sma.get('sma50')
        sma200 = sma.get('sma200')
        if sma20 and sma50 and price > 0:
            if price > sma20 > sma50:
                sma_score = 25   # Strong uptrend
            elif price > sma20:
                sma_score = 18   # Above short-term MA
            elif price > sma50:
                sma_score = 12   # Above medium-term MA
            else:
                sma_score = 5    # Below both MAs
        elif sma20 and price > sma20:
            sma_score = 15
        else:
            sma_score = 8
        if sma200 and price > sma200:
            sma_score = min(25, sma_score + 3)  # Bonus for above 200
        score += sma_score

        # Bollinger position (0-15) — Trend-Following: breakout above upper = best
        percent_b = bollinger.get('percent_b', 0.5)
        if percent_b < 0.0:
            bb_score = 3    # Below lower band — breakdown
        elif percent_b < 0.2:
            bb_score = 5    # Near lower band — weak
        elif percent_b < 0.4:
            bb_score = 7
        elif percent_b < 0.6:
            bb_score = 8    # Middle — within bands
        elif percent_b < 0.8:
            bb_score = 8    # Within bands — trending
        elif percent_b < 1.0:
            bb_score = 10   # Near upper band — strength
        else:
            bb_score = 13   # Above upper band — momentum breakout!
        score += bb_score

        # ATR volatility bonus (0-10)
        if atr > 0 and price > 0:
            atr_pct = (atr / price) * 100
            # Good volatility range: 1-4% daily
            if 1.0 <= atr_pct <= 4.0:
                atr_score = 8
            elif 0.5 <= atr_pct < 1.0:
                atr_score = 5    # Low vol — less opportunity
            elif 4.0 < atr_pct <= 6.0:
                atr_score = 6    # Higher vol — more risk
            else:
                atr_score = 3    # Extreme or very low
        else:
            atr_score = 3
        score += atr_score

        # Donchian breakout bonus (0-7)
        donchian_contribution = donchian_score * 7 / 100
        score += donchian_contribution

        return round(max(0, min(100, score)), 1)

    def _calc_sr_position_score(
        self,
        price: float,
        support: Optional[float],
        resistance: Optional[float],
    ) -> Tuple[float, str]:
        """
        S/R Position Score (0-100) — Trend-Following: breakouts are best.

        Returns: (score, price_vs_sr_label)

        Scoring (Trend-Following):
          - Breakout above resistance: 90-100 (best — momentum breakout)
          - At resistance (within 2%): 50-60 (consolidating near breakout)
          - Mid-range: 40-50
          - At support (within 2%): 30-40 (neutral — may bounce but not trending)
          - Below support (breakdown): 0-20 (worst)
        """
        if not price or price <= 0:
            return 40.0, 'mid_range'

        # No S/R data
        if (support is None or support <= 0) and (resistance is None or resistance <= 0):
            return 40.0, 'mid_range'

        has_support = support is not None and support > 0
        has_resistance = resistance is not None and resistance > 0

        # Price below all detected support levels (breakdown)
        if has_support and price < support:
            dist_from_support = ((support - price) / support) * 100
            if dist_from_support <= 2:
                return 20.0, 'mid_range'  # Just below support
            else:
                return 5.0, 'mid_range'   # Well below support — breakdown

        # Price above all detected resistance levels (breakout!) — BEST in trend-following
        if has_resistance and price > resistance:
            dist_from_resistance = ((price - resistance) / resistance) * 100
            if dist_from_resistance <= 2:
                score = 90 + (2.0 - dist_from_resistance) * 5  # 90-100
                return round(min(100, score), 1), 'breakout'
            else:
                return 95.0, 'breakout'   # Strong breakout

        # Both S/R present and price is between them
        if has_support and has_resistance:
            total_range = resistance - support
            if total_range <= 0:
                return 40.0, 'mid_range'

            position = (price - support) / total_range  # 0 = at support, 1 = at resistance

            dist_to_support_pct = ((price - support) / price) * 100
            dist_to_resistance_pct = ((resistance - price) / price) * 100

            # At support (within 2%) — neutral in trend-following
            if dist_to_support_pct <= 2.0:
                score = 30 + (2.0 - dist_to_support_pct) * 5   # 30-40
                return round(min(100, score), 1), 'at_support'

            # At resistance (within 2%) — consolidating near breakout
            if dist_to_resistance_pct <= 2.0:
                score = 50 + (2.0 - dist_to_resistance_pct) * 5  # 50-60
                return round(max(0, score), 1), 'at_resistance'

            # Mid-range: linear interpolation (support=30, resistance=60)
            score = 30 + (position * 30)
            return round(max(0, min(100, score)), 1), 'mid_range'

        # Only support known
        if has_support:
            dist_to_support_pct = ((price - support) / price) * 100
            if dist_to_support_pct <= 2.0:
                return 35.0, 'at_support'
            elif dist_to_support_pct <= 5.0:
                return 40.0, 'mid_range'
            else:
                return 45.0, 'mid_range'

        # Only resistance known
        if has_resistance:
            dist_to_resistance_pct = ((resistance - price) / price) * 100
            if dist_to_resistance_pct <= 2.0:
                return 55.0, 'at_resistance'
            elif dist_to_resistance_pct <= 5.0:
                return 50.0, 'mid_range'
            else:
                return 40.0, 'mid_range'

        return 40.0, 'mid_range'

    def _calc_volume_quality_score(
        self,
        price: float,
        vwap: float,
        volume: float,
        volume_sma: float,
        closes: List[float],
        volumes: List[float],
    ) -> Tuple[float, float, str, float]:
        """
        Volume Quality Score (0-100).

        Components:
          - VWAP position: price above VWAP is bullish
          - Volume SMA ratio: current vs average volume
          - Liquidity quality

        Returns: (score, volume_ratio, liquidity_rating, liquidity_multiplier)
        """
        score = 50.0

        # Volume ratio
        volume_ratio = 1.0
        if volume_sma and volume_sma > 0 and volume > 0:
            volume_ratio = volume / volume_sma
        elif volume > 0:
            volume_ratio = 1.0

        # VWAP position (0-35)
        if vwap > 0 and price > 0:
            vwap_diff_pct = ((price - vwap) / vwap) * 100
            if vwap_diff_pct > 2:
                vwap_score = 30   # Strongly above VWAP
            elif vwap_diff_pct > 0:
                vwap_score = 25   # Above VWAP
            elif vwap_diff_pct > -2:
                vwap_score = 18   # Slightly below VWAP
            else:
                vwap_score = 8    # Well below VWAP
        else:
            vwap_score = 17
        score = vwap_score

        # Volume SMA ratio (0-35)
        if volume_ratio >= 2.0:
            vol_score = 35   # Volume spike ≥ 2x
        elif volume_ratio >= 1.5:
            vol_score = 30   # Above average
        elif volume_ratio >= 1.0:
            vol_score = 22   # Normal
        elif volume_ratio >= 0.5:
            vol_score = 12   # Below average
        else:
            vol_score = 5    # Very low
        score += vol_score

        # Liquidity quality (0-30) + liquidity rating + multiplier
        if volume >= 5_000_000:
            liq_score = 30
            liquidity_rating = 'high'
            liquidity_multiplier = 1.0
        elif volume >= 1_000_000:
            liq_score = 25
            liquidity_rating = 'high'
            liquidity_multiplier = 1.0
        elif volume >= 300_000:
            liq_score = 18
            liquidity_rating = 'medium'
            liquidity_multiplier = 0.9
        elif volume >= 100_000:
            liq_score = 10
            liquidity_rating = 'low'
            liquidity_multiplier = 0.7
        else:
            liq_score = 3
            liquidity_rating = 'low'
            liquidity_multiplier = 0.5
        score += liq_score

        return round(max(0, min(100, score)), 1), round(volume_ratio, 2), liquidity_rating, liquidity_multiplier

    def _calc_fundamental_score(
        self,
        stock_data: Optional[Dict],
    ) -> float:
        """
        Fundamental Score (0-100) from stocks.db data.

        Components:
          - P/E ratio (0-30)
          - ROE (0-25)
          - Dividend yield (0-20)
          - Piotroski-like score (0-25)
        """
        if not stock_data:
            return 40.0  # Default middle score when no data

        score = 0.0

        # P/E ratio (0-30)
        pe = _safe_float(stock_data.get('pe_ratio'))
        if pe > 0:
            if pe < 8:
                pe_score = 28
            elif pe < 12:
                pe_score = 25
            elif pe < 20:
                pe_score = 20
            elif pe < 30:
                pe_score = 12
            elif pe < 50:
                pe_score = 6
            else:
                pe_score = 3
        else:
            pe_score = 10  # No P/E — neutral
        score += pe_score

        # ROE (0-25)
        roe = _safe_float(stock_data.get('roe'))
        if roe > 0:
            if roe > 25:
                roe_score = 24
            elif roe > 20:
                roe_score = 22
            elif roe > 15:
                roe_score = 18
            elif roe > 10:
                roe_score = 14
            elif roe > 5:
                roe_score = 8
            else:
                roe_score = 4
        else:
            roe_score = 8
        score += roe_score

        # Dividend yield (0-20)
        div_yield = _safe_float(stock_data.get('dividend_yield'))
        if div_yield > 0:
            if div_yield > 7:
                div_score = 18
            elif div_yield > 5:
                div_score = 16
            elif div_yield > 3:
                div_score = 13
            elif div_yield > 1:
                div_score = 8
            else:
                div_score = 4
        else:
            div_score = 5
        score += div_score

        # Piotroski-like quick score (0-25)
        # Based on: positive ROA, positive operating cash flow, growing ROA,
        #            lower leverage, higher liquidity, no dilution
        piotroski = 0
        roa = _safe_float(stock_data.get('roa'))
        if roa > 0:
            piotroski += 4
        if roe > 15:
            piotroski += 4
        net_margin = _safe_float(stock_data.get('net_margin'))
        if net_margin > 10:
            piotroski += 4
        debt_to_equity = _safe_float(stock_data.get('debt_to_equity'))
        if 0 < debt_to_equity < 1.0:
            piotroski += 3
        elif debt_to_equity == 0:
            piotroski += 2
        current_ratio = _safe_float(stock_data.get('current_ratio'))
        if current_ratio > 1.5:
            piotroski += 3
        elif current_ratio > 1.0:
            piotroski += 1

        # Map piotroski (0-18 range) to score (0-25)
        piotroski_score = min(25, round(piotroski * 25 / 18, 1))
        score += piotroski_score

        return round(max(0, min(100, score)), 1)

    def _calc_market_regime_score(
        self,
        closes: List[float],
        sma: Dict,
        market_change: float = 0.0,
    ) -> float:
        """
        Market Regime Score (0-100) — What direction is the market?

        Uses:
          - Price vs SMA-50 and SMA-200
          - Recent price momentum
          - Market change percentage
        """
        score = 50.0

        # Trend based on SMA alignment
        sma50 = sma.get('sma50')
        sma200 = sma.get('sma200')

        if sma50 and sma200:
            if sma50 > sma200:
                score += 15   # Golden cross / uptrend
            else:
                score -= 10   # Death cross / downtrend
        elif sma50:
            current = closes[-1] if closes else 0
            if current > sma50:
                score += 10
            else:
                score -= 5

        # Price momentum (last 20 days)
        if len(closes) >= 20:
            price_20d_ago = closes[-20]
            if price_20d_ago > 0:
                momentum = ((closes[-1] - price_20d_ago) / price_20d_ago) * 100
                if momentum > 10:
                    score += 15
                elif momentum > 5:
                    score += 10
                elif momentum > 0:
                    score += 5
                elif momentum > -5:
                    score -= 5
                elif momentum > -10:
                    score -= 10
                else:
                    score -= 15

        # Market change factor
        if market_change > 0.5:
            score += 5
        elif market_change < -0.3:
            score -= 10
        elif market_change < -1.0:
            score -= 15

        return round(max(0, min(100, score)), 1)

    # ====================================================================
    # DONCHIAN BREAKOUT DETECTION
    # ====================================================================

    def _calc_donchian_score(
        self,
        closes: List[float],
        highs: List[float],
        lows: List[float],
        period: int = 55,
    ) -> Tuple[float, float, float]:
        """
        Donchian Breakout Score (0-100).

        Calculates 55-day high and low.
        Returns: (score, upper_channel, lower_channel)

        Scoring:
          - Close > 55-day high: 90-100 (breakout!)
          - Close within 5% of 55-day high: 60-80 (near breakout)
          - Close < 55-day low: 0 (breakdown)
          - Otherwise: scaled 20-50
        """
        if len(closes) < period or len(highs) < period or len(lows) < period:
            return 50.0, 0.0, 0.0

        recent_highs = highs[-period:]
        recent_lows = lows[-period:]
        upper_channel = max(recent_highs)
        lower_channel = min(recent_lows)
        current = closes[-1]

        if upper_channel <= 0:
            return 50.0, round(upper_channel, 4), round(lower_channel, 4)

        if current > upper_channel:
            # Breakout above 55-day high!
            breakout_pct = ((current - upper_channel) / upper_channel) * 100
            score = min(100, 90 + breakout_pct * 2)  # 90-100+
        elif current >= upper_channel * 0.95:
            # Within 5% of 55-day high — near breakout
            proximity = (current / upper_channel - 0.95) / 0.05  # 0-1
            score = 60 + proximity * 20  # 60-80
        elif current < lower_channel:
            # Below 55-day low — breakdown
            score = 0
        else:
            # Middle range
            if upper_channel != lower_channel:
                position = (current - lower_channel) / (upper_channel - lower_channel)
            else:
                position = 0.5
            score = 20 + position * 30  # 20-50

        return round(max(0, min(100, score)), 1), round(upper_channel, 4), round(lower_channel, 4)

    # ====================================================================
    # EGX30 MARKET REGIME GATE
    # ====================================================================

    def _check_egx30_regime(self) -> Tuple[str, bool]:
        """
        Check EGX30 market regime using SMA(200).

        Loads EGX30 price history from price_history.db and calculates SMA(200).
        If EGX30 < SMA(200): bearish regime → force HOLD on all signals.

        Returns: (regime_label, is_bullish)
          - If EGX30 >= SMA(200): ('bullish', True)
          - If EGX30 < SMA(200): ('bearish', False)
          - If data unavailable: ('unknown', True)  — default to allow signals
        """
        try:
            prices = self._fetch_price_history('EGX30', limit=250)
            if not prices or len(prices) < 200:
                return 'unknown', True  # Default to allow signals

            closes = [_safe_float(p.get('close')) for p in prices]
            closes = [c for c in closes if c > 0]

            if len(closes) < 200:
                return 'unknown', True

            sma200 = sum(closes[-200:]) / 200
            current = closes[-1]

            if current >= sma200:
                return 'bullish', True
            else:
                return 'bearish', False
        except Exception:
            return 'unknown', True

    # ====================================================================
    # GATE EVALUATIONS — 5 gates for sniper filter
    # ====================================================================

    def _evaluate_gate_liquidity(
        self,
        volume: float,
        value_traded: float,
    ) -> bool:
        """
        Gate 1: Liquidity — daily volume ≥ 2M shares OR value traded ≥ 5M.
        """
        if volume >= 2_000_000:
            return True
        if value_traded >= 5_000_000:
            return True
        # Fallback: volume * price estimate
        return False

    def _evaluate_gate_trend(
        self,
        price: float,
        sma20: Optional[float],
        market_change: float,
    ) -> bool:
        """
        Gate 2: Trend — price above SMA-20 AND market not down > -0.3%.
        """
        above_sma20 = True
        if sma20 and sma20 > 0:
            above_sma20 = price > sma20

        market_ok = market_change >= -0.3
        return above_sma20 and market_ok

    def _evaluate_gate_sr(
        self,
        price: float,
        support: Optional[float],
        resistance: Optional[float],
    ) -> bool:
        """
        Gate 3: S/R — within 2% of support OR breakout confirmed (+0.5% above resistance).
        """
        if support and support > 0 and price > 0:
            dist_to_support_pct = ((price - support) / price) * 100
            if dist_to_support_pct <= 2.0:
                return True

        if resistance and resistance > 0 and price > 0:
            dist_above_resistance_pct = ((price - resistance) / resistance) * 100
            if dist_above_resistance_pct >= 0.5:
                return True  # Confirmed breakout

        return False

    def _evaluate_gate_rr(
        self,
        rr_ratio: float,
        persona: str = 'balanced',
    ) -> bool:
        """
        Gate 4: R/R — risk/reward ≥ 2.0 for all personas.
        """
        if persona in ('conservative', 'cautious', 'hedger'):
            return rr_ratio >= 2.0
        elif persona in ('gambler', 'adventurer'):
            return rr_ratio >= 2.0
        else:
            return rr_ratio >= 2.0  # balanced, active_trader

    def _evaluate_gate_confirmation(
        self,
        candlestick_direction: str,
        volume_ratio: float,
    ) -> bool:
        """
        Gate 5: Confirmation — bullish candlestick + volume spike ≥ 1.5x.
        """
        if candlestick_direction == 'bullish' and volume_ratio >= 1.5:
            return True
        return False

    # ====================================================================
    # DATA FETCHING
    # ====================================================================

    def _fetch_price_history(self, ticker: str, limit: int = 250) -> List[Dict]:
        """
        Fetch price data — delegates to data.prices (single source of truth).

        Returns list of dicts (oldest first) with keys:
          date, open, high, low, close, volume
        """
        # PHASE 1 (v3.50.0): delegate to data.prices — single source of truth
        from data.prices import load_price_history
        return load_price_history(ticker, limit)

    def _fetch_stock_data(self, ticker: str) -> Optional[Dict]:
        """
        Fetch stock fundamental data from stocks.db.
        """
        # 1) Try stocks.db
        try:
            conn = _conn(self.stocks_db)
            row = conn.execute(
                "SELECT ticker, name, market, sector, current_price, "
                "pe_ratio, pb_ratio, roe, roa, net_margin, debt_to_equity, "
                "current_ratio, dividend_yield, volume, market_cap "
                "FROM stocks WHERE ticker=?",
                (ticker.upper(),),
            ).fetchone()
            conn.close()
            if row:
                return dict(row)
        except Exception:
            pass

        # 2) Try data_engine.db
        try:
            conn = _conn(self.data_engine_db)
            row = conn.execute(
                "SELECT symbol as ticker, name, market, sector, price as current_price, "
                "volume, market_cap FROM stocks WHERE symbol=?",
                (ticker,),
            ).fetchone()
            conn.close()
            if row:
                result = dict(row)
                # Try to get more fundamental data
                try:
                    conn2 = _conn(self.data_engine_db)
                    val_row = conn2.execute(
                        "SELECT * FROM tab_valuation WHERE ticker=?", (ticker,)  # PILLAR-2.5: tab_* uses ticker PK
                    ).fetchone()
                    prof_row = conn2.execute(
                        "SELECT * FROM tab_profitability WHERE ticker=?", (ticker,)  # PILLAR-2.5: tab_* uses ticker PK
                    ).fetchone()
                    div_row = conn2.execute(
                        "SELECT * FROM tab_dividends WHERE ticker=?", (ticker,)  # PILLAR-2.5: tab_* uses ticker PK
                    ).fetchone()
                    conn2.close()
                    if val_row:
                        result['pe_ratio'] = _safe_float(dict(val_row).get('pe_ratio'))
                        result['pb_ratio'] = _safe_float(dict(val_row).get('pb_ratio'))
                    if prof_row:
                        pd = dict(prof_row)
                        result['roe'] = _safe_float(pd.get('roe'))
                        result['roa'] = _safe_float(pd.get('roa'))
                        result['net_margin'] = _safe_float(pd.get('net_margin'))
                    if div_row:
                        dd = dict(div_row)
                        result['dividend_yield'] = _safe_float(dd.get('dividend_yield'))
                except Exception:
                    pass
                return result
        except Exception:
            pass

        return None

    def _fetch_support_resistance(self, ticker: str) -> Optional[Dict]:
        """
        Fetch support/resistance levels using the support_resistance_calculator.
        """
        if _HAS_SR_CALCULATOR:
            try:
                sr = calculate_support_resistance(ticker)
                if sr and sr.get('is_fresh'):
                    return sr
                # Even if not fresh, still use it
                if sr:
                    return sr
            except Exception:
                pass
        return None

    def _get_market_stocks(self, market: str = 'EGX') -> List[Dict]:
        """
        Get all stocks for a given market.
        """
        stocks: List[Dict] = []

        # 1) Try data_engine.db
        try:
            conn = _conn(self.data_engine_db)
            # Map market code to Arabic name used in DB
            market_map = {
                'EGX': 'مصر', 'TADAWUL': 'السعودية', 'KSE': 'الكويت',
                'QSE': 'قطر', 'CRYPTO': 'العملات الرقمية',
            }
            db_market = market_map.get(market, market)
            rows = conn.execute(
                "SELECT symbol, name, market FROM stocks WHERE market=? ORDER BY symbol",
                (db_market,),
            ).fetchall()
            conn.close()
            if rows:
                stocks = [dict(r) for r in rows]
                return stocks
        except Exception:
            pass

        # 2) Try stocks.db
        try:
            conn = _conn(self.stocks_db)
            rows = conn.execute(
                "SELECT ticker as symbol, name, market FROM stocks WHERE market=? ORDER BY ticker",
                (market.upper(),),
            ).fetchall()
            conn.close()
            if rows:
                stocks = [dict(r) for r in rows]
                return stocks
        except Exception:
            pass

        # 3) Try price_history.db (distinct tickers)
        try:
            conn = _conn(self.price_history_db)
            rows = conn.execute(
                "SELECT DISTINCT ticker as symbol FROM price_history ORDER BY ticker"
            ).fetchall()
            conn.close()
            if rows:
                stocks = [dict(r) for r in rows]
                return stocks
        except Exception:
            pass

        return stocks

    # ====================================================================
    # MAIN ANALYSIS METHOD
    # ====================================================================

    def analyze(
        self,
        ticker: str,
        market: str = 'EGX',
        persona: str = 'balanced',
    ) -> Optional[SniperResult]:
        """
        Analyze a single stock and return a SniperResult.

        Steps:
          1. Fetch price data from price_history.db
          2. Fetch stock data from stocks.db
          3. Calculate all technical indicators
          4. Calculate S/R position
          5. Calculate volume quality
          6. Calculate fundamental score (from stocks.db)
          7. Determine market regime
          8. Detect candlestick patterns
          9. Calculate sniper_score
         10. Calculate entry/stop/target using DynamicTargetEngine if available
         11. Return SniperResult
        """
        warnings: List[str] = []
        warnings_ar: List[str] = []
        now = datetime.utcnow().isoformat() + 'Z'

        # ---- Step 1: Fetch price data ----
        prices = self._fetch_price_history(ticker, limit=250)
        
        # If insufficient price history, try using pre-computed data from stocks.db
        if not prices or len(prices) < 15:
            precomputed = self._analyze_from_precomputed(ticker, market, persona)
            if precomputed:
                return precomputed
            return None

        closes = [_safe_float(p.get('close')) for p in prices]
        opens = [_safe_float(p.get('open')) for p in prices]
        highs = [_safe_float(p.get('high')) for p in prices]
        lows = [_safe_float(p.get('low')) for p in prices]
        volumes = [_safe_float(p.get('volume')) for p in prices]

        # Filter out zero closes
        if not closes or closes[-1] <= 0:
            return None

        current_price = closes[-1]
        current_volume = volumes[-1] if volumes else 0

        # ---- Step 2: Fetch stock data ----
        stock_data = self._fetch_stock_data(ticker)

        # ---- Step 3: Calculate technical indicators ----
        rsi = self.calc_rsi(closes)
        macd = self.calc_macd(closes)
        atr = self.calc_atr(highs, lows, closes)
        bollinger = self.calc_bollinger_bands(closes)
        sma = self.calc_sma(closes)
        vwap = self.calc_vwap(highs, lows, closes, volumes)

        # ---- Step 3b: Calculate Donchian breakout score ----
        donchian_score, donchian_upper, donchian_lower = self._calc_donchian_score(
            closes, highs, lows
        )

        # ---- Step 4: Calculate S/R position ----
        sr_data = self._fetch_support_resistance(ticker)
        support = None
        resistance = None
        if sr_data:
            support = sr_data.get('support')
            resistance = sr_data.get('resistance')

        # Fallback: compute S/R from price history if calculator unavailable
        if support is None or resistance is None:
            fallback_support, fallback_resistance = self._compute_simple_sr(closes, highs, lows)
            if support is None:
                support = fallback_support
            if resistance is None:
                resistance = fallback_resistance

        sr_position_score, price_vs_sr = self._calc_sr_position_score(
            current_price, support, resistance
        )

        # ---- Step 5: Calculate volume quality ----
        volume_sma = self.calc_volume_sma(volumes)
        value_traded = current_volume * current_price if current_volume > 0 else 0

        volume_quality_score, volume_ratio, liquidity_rating, liquidity_multiplier = \
            self._calc_volume_quality_score(
                current_price, vwap, current_volume, volume_sma, closes, volumes
            )

        # ---- Step 6: Calculate fundamental score ----
        fundamental_score = self._calc_fundamental_score(stock_data)

        # ---- Step 7: Determine market regime ----
        # Try to get market index change
        market_change = self._get_market_change(market)
        market_regime_score = self._calc_market_regime_score(closes, sma, market_change)

        # ---- Step 8: Detect candlestick patterns ----
        candlestick_pattern, candlestick_direction, candlestick_score = \
            self.detect_candlestick_patterns(opens, highs, lows, closes)

        # ---- Step 9: Calculate sniper_score ----
        raw_score = (
            self._calc_technical_score(rsi, macd, sma, bollinger, atr, current_price, donchian_score) * 0.25 +
            sr_position_score * 0.25 +
            volume_quality_score * 0.15 +
            fundamental_score * 0.20 +
            market_regime_score * 0.10 +
            candlestick_score * 0.05
        )
        sniper_score = round(raw_score * liquidity_multiplier, 1)
        sniper_score = max(0, min(100, sniper_score))

        # Recalculate technical score for result (already computed inside sniper_score)
        technical_score = self._calc_technical_score(rsi, macd, sma, bollinger, atr, current_price, donchian_score)

        # ---- Step 10: Calculate entry/stop/target ----
        entry_price = current_price
        stop_loss = 0.0
        target_price = 0.0
        risk_reward = 0.0

        # Use DynamicTargetEngine if available
        trail_mult = 3.0
        sl_mult = 2.5
        if self._dynamic_target_engine:
            try:
                dt_result = self._dynamic_target_engine.calculate(
                    ticker=ticker,
                    entry_price=current_price,
                    persona=persona,
                    support=support,
                    resistance=resistance,
                    atr=atr,
                    rsi=rsi,
                    volume=current_volume,
                    volume_sma_20=volume_sma,
                    macd_histogram=macd.get('histogram'),
                    candlestick_pattern=candlestick_pattern,
                    candlestick_direction=candlestick_direction,
                    zone=price_vs_sr,
                )
                stop_loss = dt_result.stop_loss
                target_price = dt_result.target_price
                risk_reward = dt_result.risk_reward
                # Still compute persona-based trail/sl multipliers
                _, _, _, trail_mult, sl_mult = self._compute_default_targets(
                    current_price, support, resistance, atr, persona
                )
            except Exception:
                stop_loss, target_price, risk_reward, trail_mult, sl_mult = self._compute_default_targets(
                    current_price, support, resistance, atr, persona
                )
        else:
            stop_loss, target_price, risk_reward, trail_mult, sl_mult = self._compute_default_targets(
                current_price, support, resistance, atr, persona
            )

        # ---- Step 11: Determine signal ----
        signal = self._determine_signal(sniper_score, rsi, candlestick_direction, persona, donchian_score)

        # ---- EGX30 Market Regime Gate ----
        market_regime_label, egx30_bullish = self._check_egx30_regime() if market == 'EGX' else ('unknown', True)
        if not egx30_bullish:
            signal = 'HOLD'
            warnings.append('EGX30 below SMA(200) — bearish market regime')
            warnings_ar.append('مؤشر EGX30 أقل من SMA(200) — نظام سوق هابط')

        # Confidence based on score consistency and gates
        confidence = self._calc_confidence(
            sniper_score, technical_score, sr_position_score, volume_quality_score
        )

        # ---- Evaluate 5 Gates ----
        gate_1 = self._evaluate_gate_liquidity(current_volume, value_traded)
        gate_2 = self._evaluate_gate_trend(current_price, sma.get('sma20'), market_change)
        gate_3 = self._evaluate_gate_sr(current_price, support, resistance)
        gate_4 = self._evaluate_gate_rr(risk_reward, persona)
        gate_5 = self._evaluate_gate_confirmation(candlestick_direction, volume_ratio)
        gates_passed = sum([gate_1, gate_2, gate_3, gate_4, gate_5])

        # ---- Warnings ----
        if current_volume < 100_000:
            warnings.append('Very low volume — may be hard to exit position')
            warnings_ar.append('سيولة ضعيفة جداً — صعوبة في الخروج من الصفقة')
        if rsi > 75:
            warnings.append('RSI overbought — still trending up but watch for reversal')
            warnings_ar.append('RSI تشبع شرائي — لسه صاعد لكن احذر الانعكاس')
        if rsi < 25:
            warnings.append('RSI oversold — downtrend, avoid buying')
            warnings_ar.append('RSI تشبع بيعي — اتجاه هابط، تجنب الشراء')
        if atr > 0 and current_price > 0 and (atr / current_price) > 0.05:
            warnings.append('High volatility — wider stops recommended')
            warnings_ar.append('تذبذب عالي — يُنصح بوقف أوسع')
        if risk_reward < 1.0 and risk_reward > 0:
            warnings.append('Risk/Reward below 1.0 — negative expectancy trade')
            warnings_ar.append('نسبة ربح/خسارة أقل من 1 — صفقة توقعها سلبي')
        if not gate_1:
            warnings.append('Failed liquidity gate')
            warnings_ar.append('لم يجتز بوابة السيولة')

        # ---- Build result ----
        result = SniperResult(
            ticker=ticker,
            market=market,
            timestamp=now,
            sniper_score=sniper_score,
            technical_score=technical_score,
            sr_position_score=sr_position_score,
            volume_quality_score=volume_quality_score,
            fundamental_score=fundamental_score,
            market_regime_score=market_regime_score,
            candlestick_score=candlestick_score,
            liquidity_multiplier=liquidity_multiplier,
            rsi=rsi,
            macd=macd,
            atr=atr,
            bollinger=bollinger,
            sma=sma,
            vwap=vwap,
            support=support,
            resistance=resistance,
            price_vs_sr=price_vs_sr,
            volume_ratio=volume_ratio,
            liquidity_rating=liquidity_rating,
            candlestick_pattern=candlestick_pattern,
            candlestick_direction=candlestick_direction,
            entry_price=round(entry_price, 4),
            stop_loss=round(stop_loss, 4),
            target_price=round(target_price, 4),
            risk_reward=round(risk_reward, 2),
            signal=signal,
            signal_ar=SIGNAL_AR.get(signal, signal),
            confidence=confidence,
            warnings=warnings,
            warnings_ar=warnings_ar,
            gate_1_liquidity=gate_1,
            gate_2_trend=gate_2,
            gate_3_sr=gate_3,
            gate_4_rr=gate_4,
            gate_5_confirmation=gate_5,
            gates_passed=gates_passed,
            market_regime=market_regime_label,
            donchian_score=donchian_score,
            trailing_stop_atr_mult=trail_mult,
            initial_stop_atr_mult=sl_mult,
        )

        return result

    # ====================================================================
    # PRE-COMPUTED DATA FALLBACK
    # ====================================================================

    def _analyze_from_precomputed(
        self,
        ticker: str,
        market: str = 'EGX',
        persona: str = 'balanced',
    ) -> Optional[SniperResult]:
        """
        Fallback analysis using pre-computed indicators from stocks.db.
        Used when historical price data is insufficient for full calculation.
        """
        try:
            conn = _conn(self.stocks_db)
            # Use column names that actually exist in stocks.db
            row = conn.execute(
                "SELECT ticker, current_price, rsi, support, resistance, "
                "ma_50, ma_200, volume, avg_volume, pe_ratio, roe, roa, "
                "profit_margin, debt_to_equity, current_ratio, dividend_yield, "
                "signal, trend, change_percent, high_52w, low_52w, close, "
                "open_price, high_price, low_price, market_cap "
                "FROM stocks WHERE ticker=? AND market=?",
                (ticker.upper(), market.upper()),
            ).fetchone()
            conn.close()
            if not row:
                return None
        except Exception:
            return None

        d = dict(row)
        # Map profit_margin to net_margin for _calc_fundamental_score
        if 'profit_margin' in d and 'net_margin' not in d:
            d['net_margin'] = d['profit_margin']

        current_price = _safe_float(d.get('current_price') or d.get('close'), 0)
        if current_price <= 0:
            return None

        now = datetime.utcnow().isoformat() + 'Z'
        warnings = ['Analysis based on pre-computed data (insufficient price history)']
        warnings_ar = ['تحليل بناءً على بيانات مسبقة (بيانات تاريخية غير كافية)']

        # Build indicators from pre-computed data
        rsi = _safe_float(d.get('rsi'), 50)
        support = _safe_float(d.get('support'), 0) or None
        resistance = _safe_float(d.get('resistance'), 0) or None
        # Sanity check: support must be below current price, resistance above
        if support and support >= current_price:
            support = None
        if resistance and resistance <= current_price:
            resistance = None
        sma50 = _safe_float(d.get('ma_50'), 0) or None
        sma200 = _safe_float(d.get('ma_200'), 0) or None
        volume = _safe_float(d.get('volume'), 0)
        avg_volume = _safe_float(d.get('avg_volume'), 0)
        change_pct = _safe_float(d.get('change_percent'), 0)

        # Build indicator dicts
        macd = {'macd': 0, 'signal': 0, 'histogram': 0, 'direction': 'NEUTRAL'}
        bollinger = {'upper': 0, 'middle': 0, 'lower': 0, 'bandwidth': 0, 'percent_b': 0.5}
        sma = {}
        if sma50: sma['sma50'] = sma50
        if sma200: sma['sma200'] = sma200
        if not sma: sma = {'sma50': None, 'sma200': None}

        # Calculate scores from pre-computed data (Trend-Following)
        technical_score = 50.0
        if rsi < 30: technical_score -= 10   # Downtrend — avoid
        elif rsi < 40: technical_score -= 5   # Below neutral — weak
        elif 50 <= rsi <= 70: technical_score += 15  # Trending — best zone
        elif rsi > 70: technical_score += 5   # Overbought but still up
        if sma50 and current_price > sma50: technical_score += 10
        elif sma50: technical_score -= 5
        if sma200 and current_price > sma200: technical_score += 5

        sr_position_score, price_vs_sr = self._calc_sr_position_score(current_price, support, resistance)

        volume_ratio = volume / avg_volume if avg_volume > 0 else 1.0
        liquidity_rating = 'high' if volume >= 1_000_000 else ('medium' if volume >= 300_000 else 'low')
        liquidity_multiplier = 1.0 if volume >= 1_000_000 else (0.9 if volume >= 300_000 else 0.7)
        volume_quality_score = 50.0
        if volume_ratio >= 1.5: volume_quality_score += 15
        if current_price > 0 and sma50 and current_price > sma50: volume_quality_score += 10
        if volume >= 1_000_000: volume_quality_score += 15

        fundamental_score = self._calc_fundamental_score(d)
        market_regime_score = 50.0
        if change_pct > 0: market_regime_score += 10
        elif change_pct < -1: market_regime_score -= 10

        # Simple candlestick direction from change
        candlestick_direction = 'bullish' if change_pct > 0 else ('bearish' if change_pct < 0 else 'neutral')
        candlestick_pattern = 'NONE'
        candlestick_score = 55 if candlestick_direction == 'bullish' else (45 if candlestick_direction == 'bearish' else 50)

        # Calculate sniper_score
        raw_score = (
            technical_score * 0.25 +
            sr_position_score * 0.25 +
            volume_quality_score * 0.15 +
            fundamental_score * 0.20 +
            market_regime_score * 0.10 +
            candlestick_score * 0.05
        )
        sniper_score = round(raw_score * liquidity_multiplier, 1)
        sniper_score = max(0, min(100, sniper_score))

        # Calculate entry/stop/target
        entry_price = current_price
        stop_loss, target_price, risk_reward, trail_mult, sl_mult = self._compute_default_targets(
            current_price, support, resistance, 0, persona
        )

        # Donchian score — not available from precomputed data
        donchian_score = 50.0

        # EGX30 Market Regime Gate
        market_regime_label, egx30_bullish = self._check_egx30_regime() if market == 'EGX' else ('unknown', True)
        if not egx30_bullish:
            warnings.append('EGX30 below SMA(200) — bearish market regime')
            warnings_ar.append('مؤشر EGX30 أقل من SMA(200) — نظام سوق هابط')

        # Determine signal
        signal = self._determine_signal(sniper_score, rsi, candlestick_direction, persona, donchian_score)
        if not egx30_bullish:
            signal = 'HOLD'
        confidence = self._calc_confidence(sniper_score, technical_score, sr_position_score, volume_quality_score)

        # Evaluate gates
        value_traded = volume * current_price
        gate_1 = self._evaluate_gate_liquidity(volume, value_traded)
        gate_2 = self._evaluate_gate_trend(current_price, sma.get('sma20') or sma50, change_pct)
        gate_3 = self._evaluate_gate_sr(current_price, support, resistance)
        gate_4 = self._evaluate_gate_rr(risk_reward, persona)
        gate_5 = self._evaluate_gate_confirmation(candlestick_direction, volume_ratio)
        gates_passed = sum([gate_1, gate_2, gate_3, gate_4, gate_5])

        return SniperResult(
            ticker=ticker, market=market, timestamp=now,
            sniper_score=sniper_score, technical_score=technical_score,
            sr_position_score=sr_position_score, volume_quality_score=volume_quality_score,
            fundamental_score=fundamental_score, market_regime_score=market_regime_score,
            candlestick_score=candlestick_score, liquidity_multiplier=liquidity_multiplier,
            rsi=rsi, macd=macd, atr=0, bollinger=bollinger, sma=sma, vwap=0,
            support=support, resistance=resistance, price_vs_sr=price_vs_sr,
            volume_ratio=volume_ratio, liquidity_rating=liquidity_rating,
            candlestick_pattern=candlestick_pattern, candlestick_direction=candlestick_direction,
            entry_price=round(entry_price, 4), stop_loss=round(stop_loss, 4),
            target_price=round(target_price, 4), risk_reward=round(risk_reward, 2),
            signal=signal, signal_ar=SIGNAL_AR.get(signal, signal),
            confidence=confidence, warnings=warnings, warnings_ar=warnings_ar,
            gate_1_liquidity=gate_1, gate_2_trend=gate_2, gate_3_sr=gate_3,
            gate_4_rr=gate_4, gate_5_confirmation=gate_5, gates_passed=gates_passed,
            market_regime=market_regime_label,
            donchian_score=donchian_score,
            trailing_stop_atr_mult=trail_mult,
            initial_stop_atr_mult=sl_mult,
        )

    # ====================================================================
    # MARKET SCAN
    # ====================================================================

    def scan_market(
        self,
        market: str = 'EGX',
        persona: str = 'balanced',
        min_gates: int = 4,
    ) -> List[SniperResult]:
        """
        Scan all stocks in a market and return only those passing min_gates gates.

        Steps:
          1. Get all stocks for market
          2. Analyze each one
          3. Filter by min_gates
          4. Sanity filter: sane prices + realistic R/R
          5. Sort by sniper_score descending
          6. Return top results
        """
        stocks = self._get_market_stocks(market)
        results: List[SniperResult] = []

        for stock in stocks:
            ticker = stock.get('symbol') or stock.get('ticker', '')
            if not ticker:
                continue

            try:
                result = self.analyze(ticker, market=market, persona=persona)
                if result and result.gates_passed >= min_gates:
                    # Sanity filter — القناص مابيصطدش أسهم فاسدة
                    # 1. سعر الدخول لازم يكون > 1 ج.م (بلاش penny stocks)
                    if result.entry_price < 1.0:
                        continue
                    # 2. R/R لازم يكون واقعي (0.5 - 10.0) — بلاش R/R = 500
                    if result.risk_reward < 0.5 or result.risk_reward > 10.0:
                        continue
                    # 3. وقف الخسارة لازم يكون أقل من الدخول (للشراء)
                    if result.stop_loss >= result.entry_price and result.signal in ('BUY', 'STRONG_BUY', 'HOLD', 'ACCUMULATE'):
                        continue
                    # 4. الهدف لازم يكون أعلى من الدخول (للشراء)
                    if result.target_price <= result.entry_price and result.signal in ('BUY', 'STRONG_BUY', 'HOLD', 'ACCUMULATE'):
                        continue
                    results.append(result)
            except Exception:
                continue

        # Sort by sniper_score descending
        results.sort(key=lambda r: r.sniper_score, reverse=True)

        # Deduplicate by ticker — keep the best score only
        seen = set()
        unique_results = []
        for r in results:
            if r.ticker not in seen:
                seen.add(r.ticker)
                unique_results.append(r)

        return unique_results

    # ====================================================================
    # HELPER METHODS
    # ====================================================================

    def _compute_simple_sr(
        self,
        closes: List[float],
        highs: List[float],
        lows: List[float],
        lookback: int = 50,
    ) -> Tuple[Optional[float], Optional[float]]:
        """
        Fallback S/R computation when support_resistance_calculator is unavailable.
        Uses recent swing lows as support, recent swing highs as resistance.
        """
        if len(closes) < 20:
            return None, None

        current_price = closes[-1]

        # Find support: lowest low in recent range below current price
        recent_lows = [l for l in lows[-lookback:] if 0 < l < current_price]
        support = min(recent_lows) if recent_lows else None

        # Find resistance: highest high in recent range above current price
        recent_highs = [h for h in highs[-lookback:] if h > current_price]
        resistance = max(recent_highs) if recent_highs else None

        return support, resistance

    def _compute_default_targets(
        self,
        price: float,
        support: Optional[float],
        resistance: Optional[float],
        atr: float,
        persona: str = 'balanced',
    ) -> Tuple[float, float, float, float, float]:
        """
        Compute default entry/stop/target with ATR trailing stop (Trend-Following).

        No resistance cap — targets are ATR-based and can run high.
        Target = entry + ATR × TP_mult (uncapped).

        Persona targets:
          - Conservative: SL=3.0×ATR, Trail=3.5×ATR, TP=5.0×ATR
          - Balanced:     SL=2.5×ATR, Trail=3.0×ATR, TP=4.0×ATR
          - Aggressive:   SL=2.0×ATR, Trail=2.5×ATR, TP=3.5×ATR

        Returns: (stop_loss, target_price, risk_reward, trailing_stop_atr_mult, initial_stop_atr_mult)
        """
        if price <= 0:
            return 0.0, 0.0, 0.0, 3.0, 3.0

        # Persona-based ATR multipliers
        persona_params = {
            'conservative': {'sl_mult': 3.0, 'trail_mult': 3.5, 'tp_mult': 5.0},
            'cautious':     {'sl_mult': 3.0, 'trail_mult': 3.5, 'tp_mult': 5.0},
            'balanced':     {'sl_mult': 2.5, 'trail_mult': 3.0, 'tp_mult': 4.0},
            'active_trader':{'sl_mult': 2.5, 'trail_mult': 3.0, 'tp_mult': 4.0},
            'adventurer':   {'sl_mult': 2.0, 'trail_mult': 2.5, 'tp_mult': 3.5},
            'gambler':      {'sl_mult': 2.0, 'trail_mult': 2.5, 'tp_mult': 3.5},
            'hedger':       {'sl_mult': 3.0, 'trail_mult': 3.5, 'tp_mult': 5.0},
            'investor':     {'sl_mult': 3.0, 'trail_mult': 3.5, 'tp_mult': 5.0},
        }

        params = persona_params.get(persona, persona_params['balanced'])
        sl_mult = params['sl_mult']
        trail_mult = params['trail_mult']
        tp_mult = params['tp_mult']

        # Stop loss: ATR-based (primary), support-based (secondary)
        stop_loss = 0.0
        if atr > 0:
            stop_loss = price - (sl_mult * atr)  # Persona-based ATR stop
        elif support and support > 0 and support < price:
            stop_loss = support * 0.98  # 2% below support (fallback)
        else:
            stop_loss = price * 0.92  # 8% default

        # Ensure stop is not too far or too tight
        stop_pct = (price - stop_loss) / price
        if stop_pct > 0.15:
            stop_loss = price * 0.85
        elif stop_pct < 0.005:
            stop_loss = price * 0.97

        # Target price: ATR-based, NO resistance cap (Trend-Following)
        risk = price - stop_loss
        if atr > 0:
            target_price = price + (atr * tp_mult)  # Uncapped ATR target
        elif risk > 0:
            target_price = price + (2.5 * risk)  # 2.5:1 R/R fallback
        else:
            target_price = price * 1.10  # 10% default

        # Calculate risk/reward
        reward = target_price - price
        risk_reward = round(reward / risk, 2) if risk > 0 else 0.0
        # Rule 54: استخدم canonical compute_risk_reward
        try:
            from utils.risk_reward import compute_risk_reward
            risk_reward = compute_risk_reward(price, target_price, stop_loss, fallback=risk_reward)
        except Exception:
            pass  # keep inline risk_reward computed above

        return round(stop_loss, 4), round(target_price, 4), risk_reward, trail_mult, sl_mult

    def _determine_signal(
        self,
        sniper_score: float,
        rsi: float,
        candlestick_direction: str,
        persona: str = 'balanced',
        donchian_score: float = 50.0,
    ) -> str:
        """
        Determine the trading signal based on sniper_score, persona, and overrides.

        Trend-Following overrides:
          - RSI < 25 → force HOLD (downtrend)
          - RSI 50-70 + Donchian breakout → boost signal

        Persona-adjusted thresholds:
          - conservative/cautious: harder to trigger BUY (higher thresholds)
          - gambler/adventurer: easier to trigger BUY (lower thresholds)
          - balanced: default thresholds
        """
        # Persona-adjusted thresholds
        persona_thresholds = {
            'conservative': {'strong_buy': 80, 'buy': 70, 'hold': 50, 'reduce': 35},
            'cautious':     {'strong_buy': 78, 'buy': 68, 'hold': 48, 'reduce': 33},
            'balanced':     {'strong_buy': 75, 'buy': 60, 'hold': 45, 'reduce': 30},
            'active_trader':{'strong_buy': 72, 'buy': 55, 'hold': 40, 'reduce': 28},
            'adventurer':   {'strong_buy': 70, 'buy': 52, 'hold': 38, 'reduce': 25},
            'gambler':      {'strong_buy': 65, 'buy': 50, 'hold': 35, 'reduce': 22},
            'hedger':       {'strong_buy': 80, 'buy': 70, 'hold': 50, 'reduce': 35},
            'investor':     {'strong_buy': 78, 'buy': 68, 'hold': 48, 'reduce': 33},
        }

        t = persona_thresholds.get(persona, persona_thresholds['balanced'])
        strong_buy_t = t['strong_buy']
        buy_t = t['buy']
        hold_t = t['hold']
        reduce_t = t['reduce']

        if sniper_score >= strong_buy_t:
            signal = 'STRONG_BUY'
        elif sniper_score >= buy_t:
            signal = 'BUY'
        elif sniper_score >= hold_t:
            signal = 'HOLD'
        elif sniper_score >= reduce_t:
            signal = 'REDUCE'
        else:
            signal = 'SELL'

        # Trend-Following RSI overrides
        if rsi < 25:
            # Deeply oversold = downtrend — force HOLD
            signal = 'HOLD'

        # Donchian breakout boost: RSI 50-70 + Donchian breakout → boost signal
        if 50 <= rsi <= 70 and donchian_score >= 90:
            if signal == 'HOLD':
                signal = 'BUY'
            elif signal == 'BUY':
                signal = 'STRONG_BUY'

        return signal

    def _calc_confidence(
        self,
        sniper_score: float,
        technical_score: float,
        sr_position_score: float,
        volume_quality_score: float,
    ) -> float:
        """
        Calculate confidence level (0-100).

        Confidence is higher when the sub-scores agree with each other.
        """
        base = min(95, max(20, sniper_score))

        # Check agreement between sub-scores
        scores = [technical_score, sr_position_score, volume_quality_score]
        if scores:
            avg = sum(scores) / len(scores)
            variance = sum((s - avg) ** 2 for s in scores) / len(scores)
            std = math.sqrt(variance)
            # Low variance = high agreement = higher confidence
            # High variance = conflicting signals = lower confidence
            if std < 10:
                base = min(95, base + 5)
            elif std > 25:
                base = max(20, base - 10)

        return round(max(0, min(100, base)), 1)

    def _get_market_change(self, market: str) -> float:
        """
        Get the market index daily change percentage.

        Attempts to find a benchmark index in data_engine.db.
        Falls back to 0.0 if unavailable.
        """
        # Common market index symbols
        index_symbols = {
            'EGX': ['EGX30', 'EGX70', 'EGX100'],
            'TADAWUL': ['TASI', 'Tadawul All Share'],
            'KSE': ['KSE100'],
            'QSE': ['QSE'],
        }

        symbols = index_symbols.get(market, [])

        for symbol in symbols:
            try:
                conn = _conn(self.data_engine_db)
                row = conn.execute(
                    "SELECT change_percent FROM stocks WHERE symbol=? LIMIT 1",
                    (symbol,),
                ).fetchone()
                conn.close()
                if row:
                    return _safe_float(row['change_percent'], 0.0)
            except Exception:
                continue

            try:
                conn = _conn(self.data_engine_db)
                market_map = {
                    'EGX': 'مصر', 'TADAWUL': 'السعودية', 'KSE': 'الكويت',
                    'QSE': 'قطر',
                }
                db_market = market_map.get(market, market)
                row = conn.execute(
                    "SELECT change_percent FROM historical_data "
                    "WHERE symbol=? AND market=? ORDER BY date DESC LIMIT 1",
                    (symbol, db_market),
                ).fetchone()
                conn.close()
                if row:
                    return _safe_float(row['change_percent'], 0.0)
            except Exception:
                continue

        return 0.0


# ============================================================================
# GLOBAL INSTANCE (convenience)
# ============================================================================

_engine: Optional[SniperEngine] = None


def get_sniper_engine() -> SniperEngine:
    """Get or create the global SniperEngine instance."""
    global _engine
    if _engine is None:
        _engine = SniperEngine()
    return _engine
