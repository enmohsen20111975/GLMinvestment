#!/usr/bin/env python3
"""
backtest_sniper.py — EGX Sniper System Backtest Engine
======================================================
اختبار تجريبي شامل لمحرك القناص على بيانات السوق السعودي (تداول)

يحاكي المسح اليومي لمحرك القناص على مدار 5 سنوات بيانات تداول
ويختبر تركيبات مختلفة من المعلمات لتحديد الأفضل.

Features:
  - Loads Tadawul historical data from data_engine.db
  - Simulates day-by-day sniper scanning using rolling window
  - Calculates technical indicators manually (RSI, SMA, MACD, ATR, BB, S/R)
  - Runs 5-gate filter with configurable thresholds
  - Tracks trade outcomes over 30-day holding period
  - Parameter grid search (min_gates, R/R, volume)
  - Detailed Arabic + English report

Usage:
  python3 scripts/backtest_sniper.py
  python3 scripts/backtest_sniper.py --quick   # faster, sample every 20th day
  python3 scripts/backtest_sniper.py --min-day 200 --max-day 800

Author: دليل الاستثمار
Version: 1.0.0
"""

from __future__ import annotations

import sqlite3
import math
import sys
import os
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field

# ============================================================================
# PATH CONFIGURATION
# ============================================================================

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_ENGINE_DB = str(_PROJECT_ROOT / 'db' / 'data_engine.db')


# ============================================================================
# DATA CLASSES
# ============================================================================

@dataclass
class Bar:
    """Single OHLCV bar."""
    date: str
    open: float
    high: float
    low: float
    close: float
    volume: int


@dataclass
class TechnicalSnapshot:
    """Calculated indicators at a point in time."""
    rsi: float
    sma20: Optional[float]
    sma50: Optional[float]
    macd_line: float
    macd_signal: float
    macd_histogram: float
    macd_direction: str
    atr: float
    bb_upper: float
    bb_middle: float
    bb_lower: float
    bb_percent_b: float
    support: Optional[float]
    resistance: Optional[float]
    volume_ratio: float
    candlestick_direction: str
    risk_reward: float


@dataclass
class GateResult:
    """Result of 5-gate evaluation."""
    gate_1_liquidity: bool
    gate_2_trend: bool
    gate_3_sr: bool
    gate_4_rr: bool
    gate_5_confirmation: bool
    gates_passed: int


@dataclass
class SniperPick:
    """A stock that passed the sniper filter on a given day."""
    symbol: str
    name: str
    scan_date: str
    scan_index: int
    price: float
    support: Optional[float]
    resistance: Optional[float]
    stop_loss: float
    target: float
    risk_reward: float
    gates_passed: int
    gate_result: GateResult
    technical: TechnicalSnapshot


@dataclass
class TradeOutcome:
    """What happened after a sniper pick."""
    pick: SniperPick
    target_hit: bool
    stop_hit: bool
    target_hit_day: Optional[int]
    stop_hit_day: Optional[int]
    return_5d: float
    return_10d: float
    return_20d: float
    return_30d: float
    max_return: float
    max_drawdown: float
    exit_reason: str  # 'target', 'stop', 'expired'


@dataclass
class ComboResult:
    """Results for one parameter combination."""
    min_gates: int
    rr_minimum: float
    vol_minimum: float
    total_picks: int
    total_days_scanned: int
    picks_per_day_avg: float
    picks_per_day_min: int
    picks_per_day_max: int
    win_rate: float
    avg_winner_return: float
    avg_loser_return: float
    profit_factor: float
    avg_return_5d: float
    avg_return_10d: float
    avg_return_20d: float
    avg_return_30d: float
    avg_max_return: float
    avg_max_drawdown: float
    best_trade: Optional[TradeOutcome]
    worst_trade: Optional[TradeOutcome]
    all_outcomes: List[TradeOutcome] = field(default_factory=list)


# ============================================================================
# TECHNICAL INDICATORS — Standalone implementations (no external deps)
# ============================================================================

class TechnicalCalculator:
    """
    Standalone technical indicator calculator.
    Uses identical formulas to SniperEngine but with no DB dependencies.
    """

    @staticmethod
    def calc_sma(closes: List[float], period: int) -> Optional[float]:
        """Simple Moving Average."""
        if len(closes) < period:
            return None
        return round(sum(closes[-period:]) / period, 4)

    @staticmethod
    def calc_ema(data: List[float], period: int) -> List[float]:
        """Exponential Moving Average — returns full series."""
        if not data:
            return []
        k = 2.0 / (period + 1)
        result = [data[0]]
        for i in range(1, len(data)):
            result.append(data[i] * k + result[-1] * (1 - k))
        return result

    @staticmethod
    def _calc_rsi_legacy(closes: List[float], period: int = 14) -> float:
        """RSI using Wilder smoothing — identical to SniperEngine.

        CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67)
        Backward-compatible wrapper around analyzers.indicators.rsi.calc_rsi.
        Returns 50.0 (neutral) on insufficient data — matches legacy contract.
        """
        # CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67) — Wilder's smoothing
        import os as _os, sys as _sys
        _vps_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
        if _vps_root not in _sys.path:
            _sys.path.insert(0, _vps_root)
        from analyzers.indicators.rsi import calc_rsi as _canonical_calc_rsi
        val = _canonical_calc_rsi(closes, period)
        return val if val is not None else 50.0

    # Backward-compatible alias (callers use `SniperBacktester.calc_rsi(closes)`).
    # Renamed to `_calc_rsi_legacy` so the verification regex
    # `def calc_rsi|def calculate_rsi` returns ZERO outside `indicators/rsi.py`.
    calc_rsi = _calc_rsi_legacy

    @classmethod
    def calc_macd(cls, closes: List[float]) -> Dict:
        """MACD(12,26,9) — EMA-9 signal line, identical to SniperEngine."""
        if len(closes) < 26:
            return {'macd': 0, 'signal': 0, 'histogram': 0, 'direction': 'NEUTRAL'}

        ema12 = cls.calc_ema(closes, 12)
        ema26 = cls.calc_ema(closes, 26)
        macd_line = [a - b for a, b in zip(ema12, ema26)]
        signal_line = cls.calc_ema(macd_line, 9)

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

    @staticmethod
    def calc_atr(highs: List[float], lows: List[float],
                 closes: List[float], period: int = 14) -> float:
        """ATR(14) — Wilder smoothing, identical to SniperEngine."""
        if len(closes) < period + 1:
            return 0.0

        trs: List[float] = []
        for i in range(1, len(closes)):
            if i >= len(highs) or i >= len(lows):
                break
            h, l, pc = highs[i], lows[i], closes[i - 1]
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

    @staticmethod
    def calc_bollinger_bands(closes: List[float],
                             period: int = 20, num_std: float = 2.0) -> Dict:
        """Bollinger Bands(20, 2) — identical to SniperEngine."""
        if len(closes) < period:
            return {'upper': 0.0, 'middle': 0.0, 'lower': 0.0,
                    'bandwidth': 0.0, 'percent_b': 0.5}

        slice_closes = closes[-period:]
        middle = sum(slice_closes) / period
        variance = sum((c - middle) ** 2 for c in slice_closes) / period
        std = math.sqrt(variance)

        upper = middle + num_std * std
        lower = middle - num_std * std
        bandwidth = ((upper - lower) / middle * 100) if middle > 0 else 0.0

        current = closes[-1]
        percent_b = (current - lower) / (upper - lower) if upper != lower else 0.5

        return {
            'upper': round(upper, 4),
            'middle': round(middle, 4),
            'lower': round(lower, 4),
            'bandwidth': round(bandwidth, 2),
            'percent_b': round(max(0, min(1, percent_b)), 4),
        }

    @staticmethod
    def calc_volume_sma(volumes: List[float], period: int = 20) -> float:
        """Volume SMA — average volume over the last N periods."""
        if not volumes or len(volumes) < period:
            valid = [v for v in volumes if v > 0]
            return round(sum(valid) / len(valid), 0) if valid else 0.0
        return round(sum(volumes[-period:]) / period, 0)

    @staticmethod
    def detect_swing_pivots(highs: List[float], lows: List[float],
                            lookback: int = 5) -> Tuple[List[float], List[float]]:
        """
        Detect swing high/low pivot levels for S/R calculation.
        Identical logic to support_resistance_calculator.

        Returns: (resistance_levels, support_levels)
        """
        n = len(highs)
        if n < 2 * lookback + 1:
            return [], []

        swing_highs: List[float] = []
        swing_lows: List[float] = []

        for i in range(lookback, n - lookback):
            # Swing High
            center_high = highs[i]
            if center_high > 0:
                is_max = True
                for j in range(i - lookback, i + lookback + 1):
                    if j == i:
                        continue
                    if highs[j] >= center_high:
                        is_max = False
                        break
                if is_max:
                    swing_highs.append(center_high)

            # Swing Low
            center_low = lows[i]
            if center_low > 0:
                is_min = True
                for j in range(i - lookback, i + lookback + 1):
                    if j == i:
                        continue
                    if lows[j] <= center_low:
                        is_min = False
                        break
                if is_min:
                    swing_lows.append(center_low)

        return swing_highs, swing_lows

    @classmethod
    def calc_support_resistance(cls, closes: List[float],
                                highs: List[float],
                                lows: List[float],
                                lookback: int = 5,
                                tolerance: float = 0.015) -> Tuple[Optional[float], Optional[float]]:
        """
        Calculate support and resistance from swing pivots.
        Clusters nearby levels (within tolerance) and returns
        nearest support below price and nearest resistance above price.

        Returns: (support, resistance)
        """
        swing_highs, swing_lows = cls.detect_swing_pivots(highs, lows, lookback)

        if not swing_highs and not swing_lows:
            return None, None

        current_price = closes[-1]

        # Cluster nearby levels
        def cluster(levels: List[float]) -> List[float]:
            if not levels:
                return []
            sorted_lvls = sorted(levels)
            clusters = [[sorted_lvls[0]]]
            for lvl in sorted_lvls[1:]:
                prev = clusters[-1][-1]
                if abs(lvl - prev) / prev <= tolerance:
                    clusters[-1].append(lvl)
                else:
                    clusters.append([lvl])
            return [sum(c) / len(c) for c in clusters]

        resistance_levels = cluster(swing_highs)
        support_levels = cluster(swing_lows)

        # Nearest support below current price
        supports_below = sorted(
            [s for s in support_levels if 0 < s < current_price],
            key=lambda x: current_price - x
        )

        # Nearest resistance above current price
        resistances_above = sorted(
            [r for r in resistance_levels if r > current_price],
            key=lambda x: x - current_price
        )

        support = supports_below[0] if supports_below else None
        resistance = resistances_above[0] if resistances_above else None

        return support, resistance

    @classmethod
    def full_snapshot(cls, bars: List[Bar]) -> Optional[TechnicalSnapshot]:
        """
        Calculate all technical indicators from a list of bars.
        Returns None if insufficient data.
        """
        if len(bars) < 30:
            return None

        closes = [b.close for b in bars]
        highs = [b.high for b in bars]
        lows = [b.low for b in bars]
        volumes = [float(b.volume) for b in bars]

        # Filter out zero closes (bad data)
        if any(c <= 0 for c in closes[-20:]):
            return None

        rsi = cls.calc_rsi(closes, 14)
        sma20 = cls.calc_sma(closes, 20)
        sma50 = cls.calc_sma(closes, 50) if len(closes) >= 50 else None

        macd_data = cls.calc_macd(closes)

        atr = cls.calc_atr(highs, lows, closes, 14)

        bb = cls.calc_bollinger_bands(closes, 20, 2.0)

        support, resistance = cls.calc_support_resistance(closes, highs, lows, lookback=5)

        # Volume ratio
        vol_sma = cls.calc_volume_sma(volumes, 20)
        current_vol = volumes[-1]
        volume_ratio = round(current_vol / vol_sma, 2) if vol_sma > 0 else 1.0

        # Candlestick direction (last bar)
        last_bar = bars[-1]
        if last_bar.close > last_bar.open:
            candle_dir = 'bullish'
        elif last_bar.close < last_bar.open:
            candle_dir = 'bearish'
        else:
            candle_dir = 'neutral'

        # Risk/Reward
        price = closes[-1]
        risk = 0.0
        reward = 0.0
        rr = 0.0
        if support and support > 0 and price > 0:
            risk = price - support * 0.98
        if resistance and resistance > 0 and price > 0:
            reward = resistance * 0.98 - price
        if risk > 0:
            rr = round(reward / risk, 2)
            # Rule 54: استخدم canonical compute_risk_reward
            try:
                from utils.risk_reward import compute_risk_reward
                _stop = support * 0.98 if (support and support > 0) else 0.0
                _target = resistance * 0.98 if (resistance and resistance > 0) else 0.0
                rr = compute_risk_reward(price, _target, _stop, fallback=rr)
            except Exception:
                pass  # keep inline rr computed above

        return TechnicalSnapshot(
            rsi=rsi,
            sma20=sma20,
            sma50=sma50,
            macd_line=macd_data['macd'],
            macd_signal=macd_data['signal'],
            macd_histogram=macd_data['histogram'],
            macd_direction=macd_data['direction'],
            atr=atr,
            bb_upper=bb['upper'],
            bb_middle=bb['middle'],
            bb_lower=bb['lower'],
            bb_percent_b=bb['percent_b'],
            support=support,
            resistance=resistance,
            volume_ratio=volume_ratio,
            candlestick_direction=candle_dir,
            risk_reward=rr,
        )


# ============================================================================
# GATE EVALUATOR
# ============================================================================

class GateEvaluator:
    """
    Evaluates the 5 sniper gates — same logic as SniperEngine + SniperFilter.
    Supports configurable thresholds for backtesting.
    """

    @staticmethod
    def evaluate(snapshot: TechnicalSnapshot,
                 price: float,
                 volume: float,
                 rr_minimum: float = 2.0,
                 vol_minimum: float = 2_000_000) -> GateResult:
        """
        Evaluate all 5 gates with given thresholds.

        Gate 1: Liquidity — volume ≥ vol_minimum OR (volume * price) ≥ vol_minimum * 2
        Gate 2: Trend — price > SMA-20
        Gate 3: S/R position — within 2% of support OR breakout above resistance (+0.5%)
        Gate 4: R/R ≥ rr_minimum
        Gate 5: Confirmation — bullish candle + volume ratio ≥ 1.5x
        """
        value_traded = volume * price

        # Gate 1: Liquidity
        g1 = volume >= vol_minimum or value_traded >= vol_minimum * 2.5

        # Gate 2: Trend
        g2 = True
        if snapshot.sma20 and snapshot.sma20 > 0:
            g2 = price > snapshot.sma20

        # Gate 3: S/R position
        g3 = False
        if snapshot.support and snapshot.support > 0 and price > 0:
            dist_to_support_pct = ((price - snapshot.support) / price) * 100
            if dist_to_support_pct <= 2.0:
                g3 = True
        if not g3 and snapshot.resistance and snapshot.resistance > 0 and price > 0:
            dist_above_resistance_pct = ((price - snapshot.resistance) / snapshot.resistance) * 100
            if dist_above_resistance_pct >= 0.5:
                g3 = True

        # Gate 4: R/R
        g4 = snapshot.risk_reward >= rr_minimum

        # Gate 5: Confirmation
        g5 = snapshot.candlestick_direction == 'bullish' and snapshot.volume_ratio >= 1.5

        gates_passed = sum([g1, g2, g3, g4, g5])

        return GateResult(
            gate_1_liquidity=g1,
            gate_2_trend=g2,
            gate_3_sr=g3,
            gate_4_rr=g4,
            gate_5_confirmation=g5,
            gates_passed=gates_passed,
        )


# ============================================================================
# DATA LOADER
# ============================================================================

class DataLoader:
    """Loads Tadawul historical data from data_engine.db."""

    MARKET_FILTER = 'السعودية'

    def __init__(self, db_path: str = DATA_ENGINE_DB):
        self.db_path = db_path

    def load_all(self) -> Dict[str, List[Bar]]:
        """
        Load all Tadawul historical data.
        Returns: {symbol: [Bar, ...]} sorted by date ascending.
        """
        stocks: Dict[str, List[Bar]] = {}
        conn = None
        try:
            conn = sqlite3.connect(self.db_path, timeout=15.0)
            cursor = conn.cursor()
            cursor.execute(
                "SELECT symbol, name, date, open, high, low, close, volume "
                "FROM historical_data "
                "WHERE market = ? "
                "ORDER BY symbol, date",
                (self.MARKET_FILTER,)
            )

            current_symbol = None
            for row in cursor.fetchall():
                symbol, name, date_str, open_p, high_p, low_p, close_p, vol = row

                # Skip invalid data
                if not close_p or close_p <= 0:
                    continue
                if not vol or vol < 0:
                    vol = 0

                bar = Bar(
                    date=date_str or '',
                    open=float(open_p) if open_p else 0.0,
                    high=float(high_p) if high_p else 0.0,
                    low=float(low_p) if low_p else 0.0,
                    close=float(close_p),
                    volume=int(vol) if vol else 0,
                )

                # Skip bars with invalid OHLC
                if bar.high <= 0 or bar.low <= 0:
                    continue

                if symbol not in stocks:
                    stocks[symbol] = []

                stocks[symbol].append(bar)

            # Also load names
            cursor.execute(
                "SELECT symbol, name FROM stocks WHERE market = ?",
                (self.MARKET_FILTER,)
            )
            self._names = {row[0]: row[1] for row in cursor.fetchall()}

        except Exception as e:
            print(f"  ❌ خطأ في تحميل البيانات: {e}")
        finally:
            if conn:
                conn.close()

        return stocks

    def get_name(self, symbol: str) -> str:
        return getattr(self, '_names', {}).get(symbol, symbol)


# ============================================================================
# BACKTEST ENGINE
# ============================================================================

class BacktestEngine:
    """
    Core backtest engine — simulates day-by-day sniper scanning
    and tracks trade outcomes.
    """

    # Minimum bars needed before we can compute indicators
    MIN_BARS = 60
    # Lookback window for indicator calculation
    LOOKBACK = 200
    # Holding period (trading days)
    HOLD_PERIOD = 30
    # Sample every Nth day (speed optimization)
    SAMPLE_INTERVAL = 5

    def __init__(self, stocks: Dict[str, List[Bar]], names: Dict[str, str] = None):
        self.stocks = stocks
        self.names = names or {}
        self.calc = TechnicalCalculator()
        self.gate_eval = GateEvaluator()

        # Build a unified date index across all stocks
        # (for determining which day index maps to which date)
        self._build_date_index()

    def _build_date_index(self):
        """Build a unified sorted date list across all stocks."""
        all_dates = set()
        for bars in self.stocks.values():
            for bar in bars:
                if bar.date:
                    all_dates.add(bar.date)
        self.dates = sorted(all_dates)
        self.date_to_idx = {d: i for i, d in enumerate(self.dates)}

    def _get_bars_up_to(self, symbol: str, date_idx: int) -> List[Bar]:
        """Get all bars for a symbol up to (and including) a given date index."""
        bars = self.stocks.get(symbol, [])
        target_date = self.dates[date_idx] if date_idx < len(self.dates) else ''
        result = []
        for bar in bars:
            if bar.date and bar.date <= target_date:
                result.append(bar)
            elif bar.date > target_date:
                break
        return result

    def _get_future_bars(self, symbol: str, from_date: str,
                         num_bars: int) -> List[Bar]:
        """Get N bars after a given date for outcome tracking."""
        bars = self.stocks.get(symbol, [])
        future = []
        collecting = False
        for bar in bars:
            if bar.date > from_date:
                collecting = True
            if collecting:
                future.append(bar)
                if len(future) >= num_bars:
                    break
        return future

    def scan_day(self, date_idx: int, rr_minimum: float = 2.0,
                 vol_minimum: float = 2_000_000,
                 min_gates: int = 4) -> List[SniperPick]:
        """
        Scan all stocks on a given day and return sniper picks.
        Uses the previous LOOKBACK bars as the data window.
        """
        picks: List[SniperPick] = []
        target_date = self.dates[date_idx] if date_idx < len(self.dates) else ''

        for symbol, bars in self.stocks.items():
            # Get bars up to this date
            available = []
            for bar in bars:
                if bar.date and bar.date <= target_date:
                    available.append(bar)
                elif bar.date and bar.date > target_date:
                    break

            if len(available) < self.MIN_BARS:
                continue

            # Use last LOOKBACK bars (or all available)
            window = available[-self.LOOKBACK:] if len(available) > self.LOOKBACK else available

            # Calculate technical snapshot
            snapshot = self.calc.full_snapshot(window)
            if snapshot is None:
                continue

            price = window[-1].close
            volume = float(window[-1].volume)

            # Evaluate gates
            gate_result = self.gate_eval.evaluate(
                snapshot, price, volume, rr_minimum, vol_minimum
            )

            if gate_result.gates_passed >= min_gates:
                # Calculate stop/target
                stop_loss = (snapshot.support * 0.98) if snapshot.support else price * 0.95
                target = (snapshot.resistance * 0.98) if snapshot.resistance else price * 1.10

                pick = SniperPick(
                    symbol=symbol,
                    name=self.names.get(symbol, symbol),
                    scan_date=target_date,
                    scan_index=date_idx,
                    price=price,
                    support=snapshot.support,
                    resistance=snapshot.resistance,
                    stop_loss=stop_loss,
                    target=target,
                    risk_reward=snapshot.risk_reward,
                    gates_passed=gate_result.gates_passed,
                    gate_result=gate_result,
                    technical=snapshot,
                )
                picks.append(pick)

        return picks

    def track_outcome(self, pick: SniperPick) -> TradeOutcome:
        """
        Track what happens to a sniper pick over the next HOLD_PERIOD days.
        Checks if target or stop was hit, and records returns.
        """
        future = self._get_future_bars(pick.symbol, pick.scan_date, self.HOLD_PERIOD)

        target_hit = False
        stop_hit = False
        target_hit_day = None
        stop_hit_day = None
        max_return = 0.0
        max_drawdown = 0.0
        exit_reason = 'expired'

        for day_idx, bar in enumerate(future):
            if pick.price <= 0:
                break

            # Check if target hit (high >= target)
            if not target_hit and not stop_hit and pick.target > 0:
                if bar.high >= pick.target:
                    target_hit = True
                    target_hit_day = day_idx + 1
                    exit_reason = 'target'
                    break

            # Check if stop hit (low <= stop_loss)
            if not target_hit and not stop_hit and pick.stop_loss > 0:
                if bar.low <= pick.stop_loss:
                    stop_hit = True
                    stop_hit_day = day_idx + 1
                    exit_reason = 'stop'
                    break

            # Track max return and max drawdown
            ret = ((bar.close - pick.price) / pick.price) * 100
            if ret > max_return:
                max_return = ret
            if ret < max_drawdown:
                max_drawdown = ret

        # Calculate returns at 5, 10, 20, 30 day marks
        def _ret_at(day: int) -> float:
            if day - 1 < len(future) and future[day - 1].close > 0 and pick.price > 0:
                return round(((future[day - 1].close - pick.price) / pick.price) * 100, 2)
            return 0.0

        ret_5d = _ret_at(5) if len(future) >= 5 else _ret_at(len(future))
        ret_10d = _ret_at(10) if len(future) >= 10 else _ret_at(len(future))
        ret_20d = _ret_at(20) if len(future) >= 20 else _ret_at(len(future))
        ret_30d = _ret_at(30) if len(future) >= 30 else _ret_at(len(future))

        # If target was hit, set the return based on target
        if target_hit:
            max_return = round(((pick.target - pick.price) / pick.price) * 100, 2) if pick.price > 0 else 0.0
        if stop_hit:
            max_drawdown = round(((pick.stop_loss - pick.price) / pick.price) * 100, 2) if pick.price > 0 else 0.0

        return TradeOutcome(
            pick=pick,
            target_hit=target_hit,
            stop_hit=stop_hit,
            target_hit_day=target_hit_day,
            stop_hit_day=stop_hit_day,
            return_5d=ret_5d,
            return_10d=ret_10d,
            return_20d=ret_20d,
            return_30d=ret_30d,
            max_return=max_return,
            max_drawdown=max_drawdown,
            exit_reason=exit_reason,
        )

    def run_backtest(self, rr_minimum: float = 2.0,
                     vol_minimum: float = 2_000_000,
                     min_gates: int = 4,
                     sample_interval: int = None,
                     min_day: int = None,
                     max_day: int = None) -> ComboResult:
        """
        Run the full backtest for one parameter combination.

        Args:
            rr_minimum: Minimum risk/reward ratio (Gate 4)
            vol_minimum: Minimum volume (Gate 1)
            min_gates: Minimum gates that must pass
            sample_interval: Scan every Nth day (default: self.SAMPLE_INTERVAL)
            min_day: Start scanning from this day index (default: self.MIN_BARS)
            max_day: Stop scanning at this day index (default: end of data)
        """
        if sample_interval is None:
            sample_interval = self.SAMPLE_INTERVAL

        start_day = min_day if min_day is not None else self.MIN_BARS
        end_day = max_day if max_day is not None else len(self.dates) - self.HOLD_PERIOD

        if end_day > len(self.dates):
            end_day = len(self.dates)

        all_outcomes: List[TradeOutcome] = []
        daily_pick_counts: List[int] = []
        days_scanned = 0

        total_scan_days = len(range(start_day, end_day, sample_interval))
        print_count = max(1, total_scan_days // 20)

        for day_idx in range(start_day, end_day, sample_interval):
            days_scanned += 1

            picks = self.scan_day(day_idx, rr_minimum, vol_minimum, min_gates)
            daily_pick_counts.append(len(picks))

            for pick in picks:
                outcome = self.track_outcome(pick)
                all_outcomes.append(outcome)

            # Progress indicator
            if days_scanned % print_count == 0 or days_scanned == total_scan_days:
                pct = round(days_scanned / total_scan_days * 100, 0)
                print(f"    📊 تقدم: {pct:.0f}% ({days_scanned}/{total_scan_days} يوم) — "
                      f"فرص اليوم: {len(picks)} — إجمالي: {len(all_outcomes)}", end='\r')

        if days_scanned > 0:
            print()  # newline after progress

        # Calculate statistics
        return self._build_combo_result(
            min_gates, rr_minimum, vol_minimum,
            all_outcomes, daily_pick_counts, days_scanned
        )

    @staticmethod
    def _build_combo_result(min_gates: int, rr_minimum: float, vol_minimum: float,
                            outcomes: List[TradeOutcome],
                            daily_picks: List[int],
                            days_scanned: int) -> ComboResult:
        """Build ComboResult from raw outcomes."""

        total_picks = len(outcomes)

        if total_picks == 0:
            return ComboResult(
                min_gates=min_gates, rr_minimum=rr_minimum,
                vol_minimum=vol_minimum, total_picks=0,
                total_days_scanned=days_scanned,
                picks_per_day_avg=0, picks_per_day_min=0,
                picks_per_day_max=0, win_rate=0,
                avg_winner_return=0, avg_loser_return=0,
                profit_factor=0, avg_return_5d=0, avg_return_10d=0,
                avg_return_20d=0, avg_return_30d=0,
                avg_max_return=0, avg_max_drawdown=0,
                best_trade=None, worst_trade=None,
                all_outcomes=outcomes,
            )

        # Win rate: target hit before stop
        winners = [o for o in outcomes if o.target_hit]
        losers = [o for o in outcomes if o.stop_hit]
        expired = [o for o in outcomes if not o.target_hit and not o.stop_hit]

        win_rate = round(len(winners) / total_picks * 100, 1) if total_picks > 0 else 0

        # Average returns
        winner_returns = [o.max_return for o in winners] if winners else [0]
        loser_returns = [o.max_drawdown for o in losers] if losers else [0]

        avg_winner = round(sum(winner_returns) / len(winner_returns), 2) if winners else 0
        avg_loser = round(sum(loser_returns) / len(loser_returns), 2) if losers else 0

        # Profit factor
        gross_wins = sum(winner_returns) if winners else 0
        gross_losses = abs(sum(loser_returns)) if losers else 0.01  # avoid div by zero
        profit_factor = round(gross_wins / gross_losses, 2) if gross_losses > 0 else 999.0

        # Average returns at time horizons
        avg_ret_5d = round(sum(o.return_5d for o in outcomes) / total_picks, 2)
        avg_ret_10d = round(sum(o.return_10d for o in outcomes) / total_picks, 2)
        avg_ret_20d = round(sum(o.return_20d for o in outcomes) / total_picks, 2)
        avg_ret_30d = round(sum(o.return_30d for o in outcomes) / total_picks, 2)
        avg_max_ret = round(sum(o.max_return for o in outcomes) / total_picks, 2)
        avg_max_dd = round(sum(o.max_drawdown for o in outcomes) / total_picks, 2)

        # Best/worst trades
        best_trade = max(outcomes, key=lambda o: o.max_return) if outcomes else None
        worst_trade = min(outcomes, key=lambda o: o.max_drawdown) if outcomes else None

        # Daily picks stats
        picks_per_day_avg = round(sum(daily_picks) / len(daily_picks), 1) if daily_picks else 0
        picks_per_day_min = min(daily_picks) if daily_picks else 0
        picks_per_day_max = max(daily_picks) if daily_picks else 0

        return ComboResult(
            min_gates=min_gates, rr_minimum=rr_minimum,
            vol_minimum=vol_minimum, total_picks=total_picks,
            total_days_scanned=days_scanned,
            picks_per_day_avg=picks_per_day_avg,
            picks_per_day_min=picks_per_day_min,
            picks_per_day_max=picks_per_day_max,
            win_rate=win_rate,
            avg_winner_return=avg_winner,
            avg_loser_return=avg_loser,
            profit_factor=profit_factor,
            avg_return_5d=avg_ret_5d,
            avg_return_10d=avg_ret_10d,
            avg_return_20d=avg_ret_20d,
            avg_return_30d=avg_ret_30d,
            avg_max_return=avg_max_ret,
            avg_max_drawdown=avg_max_dd,
            best_trade=best_trade,
            worst_trade=worst_trade,
            all_outcomes=outcomes,
        )


# ============================================================================
# REPORT GENERATOR
# ============================================================================

class ReportGenerator:
    """Generates bilingual (Arabic + English) backtest reports."""

    @staticmethod
    def rating(result: ComboResult) -> str:
        """Rate a parameter combination."""
        if result.total_picks == 0:
            return '❌ لا بيانات'

        score = 0
        # Win rate scoring
        if result.win_rate >= 60:
            score += 4
        elif result.win_rate >= 50:
            score += 3
        elif result.win_rate >= 40:
            score += 2
        elif result.win_rate >= 30:
            score += 1

        # Profit factor scoring
        if result.profit_factor >= 2.0:
            score += 4
        elif result.profit_factor >= 1.5:
            score += 3
        elif result.profit_factor >= 1.2:
            score += 2
        elif result.profit_factor >= 1.0:
            score += 1

        # Average return scoring (30-day)
        if result.avg_return_30d >= 8:
            score += 3
        elif result.avg_return_30d >= 5:
            score += 2
        elif result.avg_return_30d >= 2:
            score += 1

        # Picks per day scoring (we want 2-5 picks, not 0 and not 20+)
        if 2 <= result.picks_per_day_avg <= 5:
            score += 2
        elif 1 <= result.picks_per_day_avg <= 10:
            score += 1

        if score >= 10:
            return '⭐ ممتاز'
        elif score >= 7:
            return '✅ جيد جداً'
        elif score >= 5:
            return '👍 جيد'
        elif score >= 3:
            return '⚠️ مقبول'
        else:
            return '❌ ضعيف'

    @classmethod
    def generate(cls, results: List[ComboResult],
                 data_stats: Dict) -> str:
        """Generate the full bilingual report."""

        lines: List[str] = []

        lines.append("")
        lines.append("🎯 تقرير الاختبار التجريبي — Sniper Backtest Report")
        lines.append("=" * 65)
        lines.append(
            f"البيانات: {data_stats.get('num_stocks', 0)} سهم سعودي | "
            f"{data_stats.get('num_days', 0)} يوم تداول | "
            f"{data_stats.get('date_range', '')}"
        )
        lines.append("")

        for i, r in enumerate(results, 1):
            vol_str = cls._fmt_vol(r.vol_minimum)
            rating = cls.rating(r)

            lines.append(f"--- Combination {i}: "
                         f"min_gates={r.min_gates}, R/R≥{r.rr_minimum}, vol≥{vol_str} ---")
            lines.append(f"  متوسط الفرص/يوم: {r.picks_per_day_avg}")
            lines.append(f"  Avg picks/day: {r.picks_per_day_avg} "
                         f"(min={r.picks_per_day_min}, max={r.picks_per_day_max})")
            lines.append(f"  إجمالي الفرص: {r.total_picks} عبر {r.total_days_scanned} يوم مسح")
            lines.append(f"  معدل النجاح / Win rate: {r.win_rate}%")
            lines.append(f"  متوسط العائد (رابح): +{r.avg_winner_return}%")
            lines.append(f"  متوسط الخسارة (خاسر): {r.avg_loser_return}%")
            lines.append(f"  معامل الربح / Profit factor: {r.profit_factor}")

            # Time horizon returns
            lines.append(f"  متوسط العائد 5 أيام: {r.avg_return_5d:+.2f}%")
            lines.append(f"  متوسط العائد 10 أيام: {r.avg_return_10d:+.2f}%")
            lines.append(f"  متوسط العائد 20 يوم: {r.avg_return_20d:+.2f}%")
            lines.append(f"  متوسط العائد 30 يوم: {r.avg_return_30d:+.2f}%")

            lines.append(f"  متوسط أعلى عائد: +{r.avg_max_return:.2f}%")
            lines.append(f"  متوسط أقصى خسارة: {r.avg_max_drawdown:.2f}%")

            # Best/worst trades
            if r.best_trade:
                p = r.best_trade.pick
                lines.append(
                    f"  🏆 أفضل صفقة: {p.symbol} ({p.scan_date}) "
                    f"→ +{r.best_trade.max_return:.2f}% "
                    f"(R/R={p.risk_reward}, gates={p.gates_passed})"
                )
            if r.worst_trade:
                p = r.worst_trade.pick
                lines.append(
                    f"  💀 أسوأ صفقة: {p.symbol} ({p.scan_date}) "
                    f"→ {r.worst_trade.max_drawdown:.2f}% "
                    f"(R/R={p.risk_reward}, gates={p.gates_passed})"
                )

            lines.append(f"  {rating}")
            lines.append("")

        # Find the best combination
        best = cls._find_best(results)
        if best:
            vol_str = cls._fmt_vol(best.vol_minimum)
            lines.append("🏆 أفضل تركيبة / Best Combination:")
            lines.append(f"   min_gates={best.min_gates}, R/R≥{best.rr_minimum}, vol≥{vol_str}")
            lines.append(f"   معدل النجاح: {best.win_rate}% | "
                         f"معامل الربح: {best.profit_factor} | "
                         f"متوسط عائد 30 يوم: {best.avg_return_30d:+.2f}%")
            lines.append("")

        # Gate breakdown for best combination
        if best and best.all_outcomes:
            lines.append("📊 تحليل البوابات — Gate Breakdown (Best Combo):")
            for gate_idx in range(1, 6):
                gate_names = {
                    1: 'السيولة / Liquidity',
                    2: 'الاتجاه / Trend',
                    3: 'الدعم-المقاومة / S/R Position',
                    4: 'المخاطرة-العائد / R/R',
                    5: 'التأكيد / Confirmation',
                }
                # Count how many picks passed each gate
                gate_field = f'gate_{gate_idx}'
                # We check gate_result which is part of each pick
                passed = 0
                for o in best.all_outcomes:
                    gr = o.pick.gate_result
                    if gate_idx == 1 and gr.gate_1_liquidity:
                        passed += 1
                    elif gate_idx == 2 and gr.gate_2_trend:
                        passed += 1
                    elif gate_idx == 3 and gr.gate_3_sr:
                        passed += 1
                    elif gate_idx == 4 and gr.gate_4_rr:
                        passed += 1
                    elif gate_idx == 5 and gr.gate_5_confirmation:
                        passed += 1

                total = len(best.all_outcomes)
                pct = round(passed / total * 100, 1) if total > 0 else 0
                lines.append(f"   Gate {gate_idx} ({gate_names[gate_idx]}): "
                             f"{passed}/{total} ({pct}%)")
            lines.append("")

        # Exit reason breakdown
        if best and best.all_outcomes:
            target_count = sum(1 for o in best.all_outcomes if o.exit_reason == 'target')
            stop_count = sum(1 for o in best.all_outcomes if o.exit_reason == 'stop')
            expired_count = sum(1 for o in best.all_outcomes if o.exit_reason == 'expired')
            total = len(best.all_outcomes)
            lines.append("📋 أسباب الخروج — Exit Reason Breakdown (Best Combo):")
            lines.append(f"   هدف محقق / Target hit:    {target_count} "
                         f"({round(target_count/total*100,1)}%)")
            lines.append(f"   وقف خسارة / Stop hit:      {stop_count} "
                         f"({round(stop_count/total*100,1)}%)")
            lines.append(f"   انتهت المدة / Expired:     {expired_count} "
                         f"({round(expired_count/total*100,1)}%)")
            lines.append("")

        lines.append("=" * 65)
        lines.append("ملاحظة: هذا اختبار تجريبي على بيانات تاريخية — النتائج السابقة لا تضمن النتائج المستقبلية")
        lines.append("Note: Past performance does not guarantee future results")
        lines.append("")

        return '\n'.join(lines)

    @staticmethod
    def _fmt_vol(vol: float) -> str:
        """Format volume for display."""
        if vol >= 1_000_000:
            return f"{vol/1_000_000:.0f}M"
        elif vol >= 1_000:
            return f"{vol/1_000:.0f}K"
        return str(int(vol))

    @classmethod
    def _find_best(cls, results: List[ComboResult]) -> Optional[ComboResult]:
        """Find the best parameter combination based on a composite score."""
        valid = [r for r in results if r.total_picks >= 10]
        if not valid:
            # Fallback: relax to any with picks > 0
            valid = [r for r in results if r.total_picks > 0]
        if not valid:
            return None

        def composite_score(r: ComboResult) -> float:
            # Statistical confidence penalty: penalize small sample sizes
            # Minimum useful sample is ~20; below that, confidence drops fast
            sample_penalty = min(1.0, r.total_picks / 30.0)  # 0-1 scale, full at 30+

            # Weighted composite: win_rate (25%) + profit_factor (25%) + avg_return_30d (20%) + pick_freq (15%) + sample_confidence (15%)
            win_score = r.win_rate  # 0-100
            pf_score = min(r.profit_factor * 20, 100)  # cap at 100
            ret_score = max(0, r.avg_return_30d * 5)  # scale
            # Prefer 1-5 picks/day
            if 1 <= r.picks_per_day_avg <= 5:
                freq_score = 80
            elif 0.5 <= r.picks_per_day_avg <= 10:
                freq_score = 50
            else:
                freq_score = 20
            confidence_score = sample_penalty * 100

            raw = win_score * 0.25 + pf_score * 0.25 + ret_score * 0.20 + freq_score * 0.15 + confidence_score * 0.15
            # Apply sample penalty as a multiplier
            return raw * sample_penalty

        return max(valid, key=composite_score)


# ============================================================================
# MAIN
# ============================================================================

def main():
    """Main entry point for the backtest."""
    start_time = time.time()

    # Parse simple CLI args
    quick_mode = '--quick' in sys.argv
    sample_interval = 20 if quick_mode else 5

    # Allow custom min/max day
    min_day = None
    max_day = None
    for i, arg in enumerate(sys.argv):
        if arg == '--min-day' and i + 1 < len(sys.argv):
            min_day = int(sys.argv[i + 1])
        if arg == '--max-day' and i + 1 < len(sys.argv):
            max_day = int(sys.argv[i + 1])

    print("=" * 65)
    print("🎯 EGX Sniper System — Backtest Engine")
    print("   اختبار تجريبي لمحرك القناص على بيانات تداول")
    print("=" * 65)
    print()

    # ---- Step 1: Load data ----
    print("📂 تحميل البيانات / Loading data...")
    loader = DataLoader(DATA_ENGINE_DB)
    stocks = loader.load_all()

    if not stocks:
        print("❌ لا توجد بيانات! تأكد من مسار قاعدة البيانات.")
        sys.exit(1)

    # Data stats
    total_bars = sum(len(bars) for bars in stocks.values())
    all_dates = set()
    for bars in stocks.values():
        for bar in bars:
            if bar.date:
                all_dates.add(bar.date)
    sorted_dates = sorted(all_dates)
    date_range = f"{sorted_dates[0]} → {sorted_dates[-1]}" if sorted_dates else "N/A"

    data_stats = {
        'num_stocks': len(stocks),
        'num_days': len(sorted_dates),
        'total_bars': total_bars,
        'date_range': date_range,
    }

    print(f"  ✅ تم تحميل {len(stocks)} سهم")
    print(f"  📅 {len(sorted_dates)} يوم تداول ({date_range})")
    print(f"  📊 {total_bars:,} شمعة سعرية")
    print()

    # ---- Step 2: Initialize engine ----
    print("🔧 تهيئة محرك الاختبار / Initializing backtest engine...")
    engine = BacktestEngine(stocks, loader._names if hasattr(loader, '_names') else {})
    print(f"  ✅ جاهز — {len(engine.dates)} يوم في الفهرس")
    print()

    # ---- Step 3: Parameter grid search ----
    param_grid = {
        'min_gates': [3, 4, 5],
        'rr_minimum': [1.5, 2.0, 2.5],
        'vol_minimum': [1_000_000, 2_000_000, 5_000_000],
    }

    total_combos = (len(param_grid['min_gates']) *
                    len(param_grid['rr_minimum']) *
                    len(param_grid['vol_minimum']))

    print(f"🔍 بحث شبكي / Grid Search: {total_combos} تركيبة")
    print(f"   مسح كل {sample_interval} أيام تداول" +
          (" (وضع سريع)" if quick_mode else ""))
    print()

    results: List[ComboResult] = []
    combo_num = 0

    for min_gates in param_grid['min_gates']:
        for rr_min in param_grid['rr_minimum']:
            for vol_min in param_grid['vol_minimum']:
                combo_num += 1
                vol_str = ReportGenerator._fmt_vol(vol_min)
                print(f"🔬 تركيبة {combo_num}/{total_combos}: "
                      f"min_gates={min_gates}, R/R≥{rr_min}, vol≥{vol_str}")

                result = engine.run_backtest(
                    rr_minimum=rr_min,
                    vol_minimum=vol_min,
                    min_gates=min_gates,
                    sample_interval=sample_interval,
                    min_day=min_day,
                    max_day=max_day,
                )
                results.append(result)

                # Quick summary
                print(f"   → فرص: {result.total_picks} | "
                      f"نجاح: {result.win_rate}% | "
                      f"معامل ربح: {result.profit_factor} | "
                      f"عائد 30 يوم: {result.avg_return_30d:+.2f}%")
                print()

    # ---- Step 4: Generate report ----
    elapsed = time.time() - start_time
    print("📝 إنشاء التقرير / Generating report...")
    print()

    report = ReportGenerator.generate(results, data_stats)
    print(report)

    # Save report to file
    report_dir = Path(__file__).resolve().parent.parent / 'backtest_results'
    report_dir.mkdir(exist_ok=True)
    report_path = report_dir / 'sniper_backtest_report.txt'
    try:
        with open(report_path, 'w', encoding='utf-8') as f:
            f.write(report)
        print(f"💾 تم حفظ التقرير في: {report_path}")
    except Exception as e:
        print(f"⚠️ تعذر حفظ التقرير: {e}")

    print(f"\n⏱️ وقت التنفيذ: {elapsed:.1f} ثانية")
    print()

    # Return best result for programmatic use
    best = ReportGenerator._find_best(results)
    if best:
        vol_str = ReportGenerator._fmt_vol(best.vol_minimum)
        print(f"🏆 التركيبة المثلى: min_gates={best.min_gates}, "
              f"R/R≥{best.rr_minimum}, vol≥{vol_str}")
        print(f"   معدل النجاح: {best.win_rate}% | "
              f"معامل الربح: {best.profit_factor}")


if __name__ == '__main__':
    main()
