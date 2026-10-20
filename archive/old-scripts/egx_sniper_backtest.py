#!/usr/bin/env python3
"""
egx_sniper_backtest.py — EGX Sniper Backtest Engine v2.0
=========================================================
اختبار تجريبي شامل لمحرك القناص على بيانات البورصة المصرية (EGX)

التحسينات عن v1 (الذي كان على بيانات تداول):
  1. ✅ بيانات EGX مش تداول — بيانات البورصة المصرية
  2. ✅ وقف ATR مش وقف ثابت — يتحسب من التقلب الفعلي
  3. ✅ Trailing Stop — حماية الأرباح
  4. ✅ Walk-Forward Test — تدريب على 2021-2024، اختبار على 2025
  5. ✅ تحليل Profit Factor — فهم ليه النظام خسران

Strategy Variants Tested:
  A. Stop = support*0.98 (الأصلي)
  B. Stop = ATR*1.5 (مقترح) 
  C. Stop = ATR*2.0 + Trailing (أفضل)
  D. Stop = ATR*2.0 + Trailing + R/R≥2.5 (محافظ)

Usage:
  python3 scripts/egx_backtest/egx_sniper_backtest.py
  python3 scripts/egx_backtest/egx_sniper_backtest.py --quick
"""

from __future__ import annotations

import sqlite3
import math
import sys
import os
import time
import json
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from datetime import datetime

# ============================================================================
# CONFIGURATION
# ============================================================================

_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent.parent
PRICE_HISTORY_DB = str(_PROJECT_ROOT / 'db' / 'price_history.db')
RESULTS_DIR = Path(__file__).resolve().parent / 'results'

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
class TradeResult:
    """Result of a single trade."""
    ticker: str
    entry_date: str
    entry_price: float
    stop_loss: float
    target: float
    risk_reward: float
    exit_date: str
    exit_price: float
    exit_reason: str  # 'target', 'stop', 'trailing_stop', 'expired'
    return_pct: float
    holding_days: int
    max_favorable: float  # MFE - max profit%
    max_adverse: float    # MAE - max loss%
    gates_passed: int
    strategy_variant: str
    atr_at_entry: float


@dataclass
class StrategyResult:
    """Results for one strategy variant."""
    variant: str
    description: str
    total_trades: int
    winners: int
    losers: int
    expired: int
    win_rate: float
    avg_winner_pct: float
    avg_loser_pct: float
    profit_factor: float
    avg_return_pct: float
    max_drawdown_pct: float
    sharpe_ratio: float
    calmar_ratio: float
    avg_holding_days: float
    avg_mfe: float
    avg_mae: float
    picks_per_day: float
    trades: List[TradeResult] = field(default_factory=list)


# ============================================================================
# TECHNICAL CALCULATOR (Standalone - no external deps)
# ============================================================================

class TechCalc:
    """Standalone technical indicator calculator."""
    
    @staticmethod
    def sma(data: List[float], period: int) -> Optional[float]:
        if len(data) < period:
            return None
        return round(sum(data[-period:]) / period, 4)
    
    @staticmethod
    def ema(data: List[float], period: int) -> List[float]:
        if not data:
            return []
        k = 2.0 / (period + 1)
        result = [data[0]]
        for i in range(1, len(data)):
            result.append(data[i] * k + result[-1] * (1 - k))
        return result
    
    @staticmethod
    def rsi(closes: List[float], period: int = 14) -> float:
        if len(closes) < period + 1:
            return 50.0
        deltas = [closes[i] - closes[i-1] for i in range(1, len(closes))]
        gains = [d if d > 0 else 0.0 for d in deltas]
        losses = [-d if d < 0 else 0.0 for d in deltas]
        avg_gain = sum(gains[:period]) / period
        avg_loss = sum(losses[:period]) / period
        if avg_loss == 0:
            return 100.0
        for i in range(period, len(deltas)):
            avg_gain = (avg_gain * (period - 1) + gains[i]) / period
            avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        if avg_loss == 0:
            return 100.0
        rs = avg_gain / avg_loss
        return round(100.0 - (100.0 / (1.0 + rs)), 2)
    
    @classmethod
    def macd(cls, closes: List[float]) -> Dict:
        if len(closes) < 26:
            return {'macd': 0, 'signal': 0, 'histogram': 0, 'direction': 'NEUTRAL'}
        ema12 = cls.ema(closes, 12)
        ema26 = cls.ema(closes, 26)
        macd_line = [a - b for a, b in zip(ema12, ema26)]
        signal_line = cls.ema(macd_line, 9)
        macd_val = macd_line[-1]
        sig_val = signal_line[-1]
        hist = macd_val - sig_val
        if macd_val > sig_val and hist > 0:
            direction = 'BULLISH'
        elif macd_val < sig_val and hist < 0:
            direction = 'BEARISH'
        else:
            direction = 'NEUTRAL'
        return {'macd': round(macd_val, 4), 'signal': round(sig_val, 4),
                'histogram': round(hist, 4), 'direction': direction}
    
    @staticmethod
    def atr(highs: List[float], lows: List[float], closes: List[float],
            period: int = 14) -> float:
        if len(closes) < period + 1:
            return 0.0
        trs = []
        for i in range(1, len(closes)):
            if i >= len(highs) or i >= len(lows):
                break
            h, l, pc = highs[i], lows[i], closes[i-1]
            if h <= 0 or l <= 0 or pc <= 0:
                continue
            tr = max(h - l, abs(h - pc), abs(l - pc))
            trs.append(tr)
        if len(trs) < period:
            return round(sum(trs) / len(trs), 4) if trs else 0.0
        atr_val = sum(trs[:period]) / period
        for i in range(period, len(trs)):
            atr_val = (atr_val * (period - 1) + trs[i]) / period
        return round(atr_val, 4)
    
    @staticmethod
    def bollinger(closes: List[float], period: int = 20, num_std: float = 2.0) -> Dict:
        if len(closes) < period:
            return {'upper': 0, 'middle': 0, 'lower': 0, 'percent_b': 0.5}
        s = closes[-period:]
        middle = sum(s) / period
        variance = sum((c - middle) ** 2 for c in s) / period
        std = math.sqrt(variance)
        upper = middle + num_std * std
        lower = middle - num_std * std
        current = closes[-1]
        pct_b = (current - lower) / (upper - lower) if upper != lower else 0.5
        return {'upper': round(upper, 4), 'middle': round(middle, 4),
                'lower': round(lower, 4), 'percent_b': round(max(0, min(1, pct_b)), 4)}
    
    @classmethod
    def support_resistance(cls, closes: List[float], highs: List[float],
                           lows: List[float], lookback: int = 5,
                           tolerance: float = 0.015) -> Tuple[Optional[float], Optional[float]]:
        if len(closes) < 2 * lookback + 1:
            return None, None
        
        swing_highs, swing_lows = [], []
        n = len(highs)
        for i in range(lookback, n - lookback):
            ch = highs[i]
            if ch > 0:
                is_max = all(highs[j] < ch for j in range(i-lookback, i+lookback+1) if j != i)
                if is_max:
                    swing_highs.append(ch)
            cl = lows[i]
            if cl > 0:
                is_min = all(lows[j] > cl for j in range(i-lookback, i+lookback+1) if j != i)
                if is_min:
                    swing_lows.append(cl)
        
        if not swing_highs and not swing_lows:
            return None, None
        
        def cluster(levels):
            if not levels:
                return []
            s = sorted(levels)
            clusters = [[s[0]]]
            for lvl in s[1:]:
                if abs(lvl - clusters[-1][-1]) / clusters[-1][-1] <= tolerance:
                    clusters[-1].append(lvl)
                else:
                    clusters.append([lvl])
            return [sum(c)/len(c) for c in clusters]
        
        res_levels = cluster(swing_highs)
        sup_levels = cluster(swing_lows)
        price = closes[-1]
        
        sups = sorted([s for s in sup_levels if 0 < s < price], key=lambda x: price - x)
        ress = sorted([r for r in res_levels if r > price], key=lambda x: x - price)
        
        return (sups[0] if sups else None), (ress[0] if ress else None)


# ============================================================================
# EGX BACKTEST ENGINE v2
# ============================================================================

class EGXBacktestV2:
    """
    EGX Sniper Backtest Engine v2.0
    =================================
    Improvements over v1:
    1. EGX data (not Tadawul)
    2. ATR-based stops
    3. Trailing stop mechanism
    4. Walk-forward testing
    5. Multiple strategy variants
    """
    
    MIN_BARS = 60
    LOOKBACK = 200
    HOLD_PERIOD = 30
    SAMPLE_INTERVAL = 3  # scan every 3rd day (EGX has fewer stocks)
    
    # Strategy variants
    STRATEGIES = {
        'A': {
            'name': 'Original (support-based)',
            'stop_method': 'support',   # stop = support * 0.98
            'target_method': 'resistance',  # target = resistance * 0.98
            'trailing_stop': False,
            'rr_minimum': 2.0,
            'min_gates': 4,
            'description': 'النظام الأصلي — وقف على الدعم، هدف على المقاومة'
        },
        'B': {
            'name': 'ATR Stop (1.5x)',
            'stop_method': 'atr_1.5',   # stop = price - ATR*1.5
            'target_method': 'atr_3.0', # target = price + ATR*3.0
            'trailing_stop': False,
            'rr_minimum': 2.0,
            'min_gates': 4,
            'description': 'وقف ATR — وقف على 1.5×ATR، هدف على 3×ATR (R/R=2.0)'
        },
        'C': {
            'name': 'ATR Stop (2.0x) + Trailing',
            'stop_method': 'atr_2.0',   # stop = price - ATR*2.0
            'target_method': 'atr_4.0', # target = price + ATR*4.0
            'trailing_stop': True,
            'trailing_activation': 0.03, # activate after 3% profit
            'trailing_distance': 0.015,  # trail by 1.5%
            'rr_minimum': 2.0,
            'min_gates': 4,
            'description': 'وقف ATR 2× + Trailing Stop — حماية الأرباح'
        },
        'D': {
            'name': 'ATR Conservative (2.0x + R/R≥2.5)',
            'stop_method': 'atr_2.0',
            'target_method': 'resistance', # target = resistance * 0.98
            'trailing_stop': True,
            'trailing_activation': 0.02,
            'trailing_distance': 0.01,
            'rr_minimum': 2.5,
            'min_gates': 4,
            'description': 'محافظ — وقف ATR 2×، هدف المقاومة، R/R≥2.5'
        },
        'E': {
            'name': 'Hybrid (ATR stop + Resistance target)',
            'stop_method': 'atr_1.5',
            'target_method': 'resistance',
            'trailing_stop': True,
            'trailing_activation': 0.025,
            'trailing_distance': 0.012,
            'rr_minimum': 2.0,
            'min_gates': 4,
            'description': 'هجين — وقف ATR + هدف المقاومة + Trailing'
        },
    }
    
    def __init__(self, db_path: str = PRICE_HISTORY_DB):
        self.db_path = db_path
        self.stocks: Dict[str, List[Bar]] = {}
        self.dates: List[str] = []
        self.date_to_idx: Dict[str, int] = {}
        
    def load_data(self):
        """Load EGX historical data from price_history.db"""
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        
        c.execute('''
            SELECT ticker, date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE close_price > 0
            ORDER BY ticker, date
        ''')
        
        current_ticker = None
        for row in c.fetchall():
            ticker, date_str, open_p, high_p, low_p, close_p, vol = row
            
            if ticker != current_ticker:
                current_ticker = ticker
                if ticker not in self.stocks:
                    self.stocks[ticker] = []
            
            bar = Bar(
                date=date_str,
                open=float(open_p) if open_p else 0.0,
                high=float(high_p) if high_p else 0.0,
                low=float(low_p) if low_p else 0.0,
                close=float(close_p),
                volume=int(vol) if vol else 0,
            )
            
            if bar.high <= 0 or bar.low <= 0:
                continue
                
            self.stocks[ticker].append(bar)
        
        conn.close()
        
        # Build unified date index
        all_dates = set()
        for bars in self.stocks.values():
            for bar in bars:
                if bar.date:
                    all_dates.add(bar.date)
        self.dates = sorted(all_dates)
        self.date_to_idx = {d: i for i, d in enumerate(self.dates)}
        
        print(f"📊 Loaded EGX data: {len(self.stocks)} stocks, {len(self.dates)} trading days")
        if self.dates:
            print(f"   Period: {self.dates[0]} → {self.dates[-1]}")
    
    def _calc_stop_target(self, strategy: Dict, price: float, support: Optional[float],
                          resistance: Optional[float], atr: float) -> Tuple[float, float]:
        """Calculate stop loss and target based on strategy variant"""
        
        # Stop loss calculation
        stop = 0.0
        if strategy['stop_method'] == 'support':
            stop = (support * 0.98) if support and support > 0 else price * 0.92
        elif strategy['stop_method'] == 'atr_1.5':
            stop = price - atr * 1.5
        elif strategy['stop_method'] == 'atr_2.0':
            stop = price - atr * 2.0
        elif strategy['stop_method'] == 'atr_2.5':
            stop = price - atr * 2.5
        
        # Validate stop: not too wide (> 15%), not too tight (< 1%)
        stop_pct = (price - stop) / price if price > 0 else 0
        if stop_pct > 0.15:
            stop = price * 0.85
        elif stop_pct < 0.01:
            stop = price * 0.97
        
        # Target calculation
        target = 0.0
        if strategy['target_method'] == 'resistance':
            target = (resistance * 0.98) if resistance and resistance > 0 else price * 1.10
        elif strategy['target_method'] == 'atr_3.0':
            target = price + atr * 3.0
        elif strategy['target_method'] == 'atr_4.0':
            target = price + atr * 4.0
        elif strategy['target_method'] == 'atr_5.0':
            target = price + atr * 5.0
        
        # Validate target: not too far (> 50%), at least 2% profit
        target_pct = (target - price) / price if price > 0 else 0
        if target_pct > 0.50:
            target = price * 1.50
        elif target_pct < 0.02:
            target = price * 1.05
        
        return round(stop, 4), round(target, 4)
    
    def _evaluate_gates(self, ticker: str, bars: List[Bar], price: float,
                        volume: float, support: Optional[float], resistance: Optional[float],
                        rr: float, volume_ratio: float, sma20: Optional[float],
                        rr_minimum: float = 2.0, min_gates: int = 4) -> Tuple[int, bool]:
        """Evaluate the 5 sniper gates"""
        closes = [b.close for b in bars]
        last_bar = bars[-1]
        
        # Gate 1: Liquidity (volume ≥ 500K for EGX — lower than Tadawul)
        value_traded = volume * price
        g1 = volume >= 500_000 or value_traded >= 2_000_000
        
        # Gate 2: Trend (price > SMA-20)
        g2 = True
        if sma20 and sma20 > 0:
            g2 = price > sma20
        
        # Gate 3: S/R Position (within 2% of support OR breakout +0.5%)
        g3 = False
        if support and support > 0 and price > 0:
            dist_to_support = ((price - support) / price) * 100
            if dist_to_support <= 2.0:
                g3 = True
        if not g3 and resistance and resistance > 0 and price > 0:
            dist_above_resistance = ((price - resistance) / resistance) * 100
            if dist_above_resistance >= 0.5:
                g3 = True
        
        # Gate 4: R/R
        g4 = rr >= rr_minimum
        
        # Gate 5: Confirmation (bullish candle + volume ≥ 1.3x for EGX)
        candle_bullish = last_bar.close > last_bar.open
        g5 = candle_bullish and volume_ratio >= 1.3
        
        gates = sum([g1, g2, g3, g4, g5])
        passed = gates >= min_gates
        return gates, passed
    
    def _track_trade(self, pick: dict, strategy: Dict) -> TradeResult:
        """Track a trade outcome with trailing stop support"""
        ticker = pick['ticker']
        entry_date = pick['entry_date']
        entry_price = pick['entry_price']
        stop_loss = pick['stop_loss']
        target = pick['target']
        atr_at_entry = pick['atr']
        
        # Get future bars
        bars = self.stocks.get(ticker, [])
        future = []
        collecting = False
        for bar in bars:
            if bar.date > entry_date:
                collecting = True
            if collecting:
                future.append(bar)
                if len(future) >= self.HOLD_PERIOD:
                    break
        
        if not future:
            return None
        
        # Trailing stop state
        trailing_active = False
        current_trailing_stop = stop_loss
        activation_pct = strategy.get('trailing_activation', 0.03)
        trailing_distance = strategy.get('trailing_distance', 0.015)
        
        target_hit = False
        stop_hit = False
        trailing_stop_hit = False
        exit_reason = 'expired'
        exit_price = future[-1].close if future else entry_price
        exit_date = future[-1].date if future else entry_date
        holding_days = 0
        max_favorable = 0.0
        max_adverse = 0.0
        
        for day_idx, bar in enumerate(future):
            if entry_price <= 0:
                break
            
            holding_days = day_idx + 1
            ret_pct = ((bar.close - entry_price) / entry_price) * 100
            if ret_pct > max_favorable:
                max_favorable = ret_pct
            if ret_pct < max_adverse:
                max_adverse = ret_pct
            
            # Check target hit (high >= target)
            if not target_hit and not stop_hit and not trailing_stop_hit:
                if bar.high >= target:
                    target_hit = True
                    exit_reason = 'target'
                    exit_price = target
                    exit_date = bar.date
                    break
            
            # Check trailing stop
            if strategy.get('trailing_stop', False):
                # Activate trailing after profit reaches activation_pct
                high_ret = ((bar.high - entry_price) / entry_price)
                if high_ret >= activation_pct:
                    trailing_active = True
                    # Update trailing stop: highest price minus trailing distance
                    new_trail = bar.high * (1 - trailing_distance)
                    if new_trail > current_trailing_stop:
                        current_trailing_stop = new_trail
                
                if trailing_active and bar.low <= current_trailing_stop:
                    trailing_stop_hit = True
                    exit_reason = 'trailing_stop'
                    exit_price = current_trailing_stop
                    exit_date = bar.date
                    break
            
            # Check fixed stop hit (low <= stop_loss)
            if not target_hit and not stop_hit and not trailing_stop_hit:
                if bar.low <= stop_loss:
                    stop_hit = True
                    exit_reason = 'stop'
                    exit_price = stop_loss
                    exit_date = bar.date
                    break
        
        # If no exit triggered, use last close
        if not target_hit and not stop_hit and not trailing_stop_hit:
            exit_price = future[-1].close if future else entry_price
            exit_date = future[-1].date if future else entry_date
            exit_reason = 'expired'
        
        return_pct = round(((exit_price - entry_price) / entry_price) * 100, 2) if entry_price > 0 else 0
        
        return TradeResult(
            ticker=ticker,
            entry_date=entry_date,
            entry_price=entry_price,
            stop_loss=stop_loss,
            target=target,
            risk_reward=pick['risk_reward'],
            exit_date=exit_date,
            exit_price=exit_price,
            exit_reason=exit_reason,
            return_pct=return_pct,
            holding_days=holding_days,
            max_favorable=round(max_favorable, 2),
            max_adverse=round(max_adverse, 2),
            gates_passed=pick['gates_passed'],
            strategy_variant=strategy['name'],
            atr_at_entry=round(atr_at_entry, 4),
        )
    
    def run_strategy(self, strategy_key: str, train_start: str = None,
                     train_end: str = None, sample_interval: int = None) -> StrategyResult:
        """Run backtest for one strategy variant"""
        strategy = self.STRATEGIES[strategy_key]
        rr_minimum = strategy['rr_minimum']
        min_gates = strategy['min_gates']
        
        if sample_interval is None:
            sample_interval = self.SAMPLE_INTERVAL
        
        # Determine date range
        if not self.dates:
            return None
        
        start_idx = 0
        end_idx = len(self.dates) - self.HOLD_PERIOD
        
        if train_start:
            for i, d in enumerate(self.dates):
                if d >= train_start:
                    start_idx = i
                    break
        if train_end:
            for i, d in enumerate(self.dates):
                if d > train_end:
                    end_idx = i - self.HOLD_PERIOD
                    break
        
        trades: List[TradeResult] = []
        days_scanned = 0
        
        total_days = len(range(start_idx, end_idx, sample_interval))
        print_count = max(1, total_days // 10)
        
        for day_idx in range(start_idx, end_idx, sample_interval):
            days_scanned += 1
            scan_date = self.dates[day_idx]
            
            for ticker, bars in self.stocks.items():
                # Get bars up to scan date
                available = [b for b in bars if b.date <= scan_date]
                if len(available) < self.MIN_BARS:
                    continue
                
                window = available[-self.LOOKBACK:] if len(available) > self.LOOKBACK else available
                
                closes = [b.close for b in window]
                highs = [b.high for b in window]
                lows = [b.low for b in window]
                volumes = [float(b.volume) for b in window]
                
                # Filter bad data
                if any(c <= 0 for c in closes[-20:]):
                    continue
                
                price = closes[-1]
                volume = volumes[-1]
                
                if price <= 0 or volume <= 0:
                    continue
                
                # Calculate indicators
                sma20 = TechCalc.sma(closes, 20)
                rsi = TechCalc.rsi(closes, 14)
                atr = TechCalc.atr(highs, lows, closes, 14)
                macd_data = TechCalc.macd(closes)
                support, resistance = TechCalc.support_resistance(closes, highs, lows)
                
                # Volume ratio
                vol_sma = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else sum(volumes) / len(volumes)
                volume_ratio = round(volume / vol_sma, 2) if vol_sma > 0 else 1.0
                
                # Calculate stop and target
                stop_loss, target = self._calc_stop_target(strategy, price, support, resistance, atr)
                
                # Calculate R/R
                risk = price - stop_loss
                reward = target - price
                rr = round(reward / risk, 2) if risk > 0 else 0
                # Rule 54: استخدم canonical compute_risk_reward
                try:
                    from utils.risk_reward import compute_risk_reward
                    rr = compute_risk_reward(price, target, stop_loss, fallback=rr)
                except Exception:
                    pass  # keep inline rr computed above
                
                # Evaluate gates
                gates_passed, passed = self._evaluate_gates(
                    ticker, window, price, volume, support, resistance,
                    rr, volume_ratio, sma20, rr_minimum, min_gates
                )
                
                if not passed:
                    continue
                
                # Track the trade
                pick = {
                    'ticker': ticker,
                    'entry_date': scan_date,
                    'entry_price': price,
                    'stop_loss': stop_loss,
                    'target': target,
                    'risk_reward': rr,
                    'gates_passed': gates_passed,
                    'atr': atr,
                }
                
                trade = self._track_trade(pick, strategy)
                if trade:
                    trades.append(trade)
            
            # Progress
            if days_scanned % print_count == 0:
                pct = round(days_scanned / total_days * 100, 0)
                print(f"    {strategy['name']}: {pct:.0f}% ({len(trades)} trades)", end='\r')
        
        if days_scanned > 0:
            print()
        
        # Build result
        return self._build_result(strategy, trades, days_scanned)
    
    def _build_result(self, strategy: Dict, trades: List[TradeResult],
                      days_scanned: int) -> StrategyResult:
        """Build strategy result from trade list"""
        if not trades:
            return StrategyResult(
                variant=strategy['name'], description=strategy['description'],
                total_trades=0, winners=0, losers=0, expired=0,
                win_rate=0, avg_winner_pct=0, avg_loser_pct=0,
                profit_factor=0, avg_return_pct=0, max_drawdown_pct=0,
                sharpe_ratio=0, calmar_ratio=0, avg_holding_days=0,
                avg_mfe=0, avg_mae=0, picks_per_day=0, trades=trades
            )
        
        winners = [t for t in trades if t.exit_reason == 'target']
        losers = [t for t in trades if t.exit_reason in ('stop', 'trailing_stop')]
        expired = [t for t in trades if t.exit_reason == 'expired']
        
        # Note: trailing_stop exits can be winners (partial profit locked)
        trailing_winners = [t for t in trades if t.exit_reason == 'trailing_stop' and t.return_pct > 0]
        trailing_losers = [t for t in trades if t.exit_reason == 'trailing_stop' and t.return_pct <= 0]
        
        total_wins = len(winners) + len(trailing_winners)
        total_losses = len([t for t in trades if t.exit_reason == 'stop']) + len(trailing_losers)
        
        win_rate = round(total_wins / len(trades) * 100, 1) if trades else 0
        
        all_winner_returns = [t.return_pct for t in trades if t.return_pct > 0]
        all_loser_returns = [t.return_pct for t in trades if t.return_pct <= 0]
        
        avg_winner = round(sum(all_winner_returns) / len(all_winner_returns), 2) if all_winner_returns else 0
        avg_loser = round(sum(all_loser_returns) / len(all_loser_returns), 2) if all_loser_returns else 0
        
        gross_wins = sum(all_winner_returns) if all_winner_returns else 0
        gross_losses = abs(sum(all_loser_returns)) if all_loser_returns else 0.01
        profit_factor = round(gross_wins / gross_losses, 2) if gross_losses > 0 else 999.0
        
        avg_return = round(sum(t.return_pct for t in trades) / len(trades), 2) if trades else 0
        
        # Max drawdown (cumulative)
        cum_return = 0
        peak = 0
        max_dd = 0
        for t in sorted(trades, key=lambda x: x.entry_date):
            cum_return += t.return_pct
            if cum_return > peak:
                peak = cum_return
            dd = peak - cum_return
            if dd > max_dd:
                max_dd = dd
        
        # Sharpe ratio (simplified)
        returns = [t.return_pct for t in trades]
        if len(returns) > 1:
            avg_ret = sum(returns) / len(returns)
            std_ret = math.sqrt(sum((r - avg_ret) ** 2 for r in returns) / (len(returns) - 1))
            sharpe = round(avg_ret / std_ret * math.sqrt(252 / self.HOLD_PERIOD), 2) if std_ret > 0 else 0
        else:
            sharpe = 0
        
        calmar = round(avg_return / max_dd, 2) if max_dd > 0 else 0
        
        avg_days = round(sum(t.holding_days for t in trades) / len(trades), 1) if trades else 0
        avg_mfe = round(sum(t.max_favorable for t in trades) / len(trades), 2) if trades else 0
        avg_mae = round(sum(t.max_adverse for t in trades) / len(trades), 2) if trades else 0
        ppd = round(len(trades) / days_scanned, 1) if days_scanned > 0 else 0
        
        return StrategyResult(
            variant=strategy['name'],
            description=strategy['description'],
            total_trades=len(trades),
            winners=total_wins,
            losers=total_losses,
            expired=len(expired),
            win_rate=win_rate,
            avg_winner_pct=avg_winner,
            avg_loser_pct=avg_loser,
            profit_factor=profit_factor,
            avg_return_pct=avg_return,
            max_drawdown_pct=round(max_dd, 2),
            sharpe_ratio=sharpe,
            calmar_ratio=calmar,
            avg_holding_days=avg_days,
            avg_mfe=avg_mfe,
            avg_mae=avg_mae,
            picks_per_day=ppd,
            trades=trades,
        )


# ============================================================================
# WALK-FORWARD TEST
# ============================================================================

class WalkForwardTest:
    """Walk-forward testing: train on one period, test on another"""
    
    def __init__(self, engine: EGXBacktestV2):
        self.engine = engine
    
    def run(self, strategy_key: str = 'C'):
        """
        Run walk-forward test:
        - In-Sample: 2021-01-01 → 2024-12-31
        - Out-of-Sample: 2025-01-01 → latest
        """
        print(f"\n{'='*70}")
        print(f"🔬 Walk-Forward Test — Strategy {strategy_key}")
        print(f"{'='*70}")
        
        # In-Sample (Training)
        print(f"\n📈 In-Sample (Training): 2021-01-01 → 2024-12-31")
        is_result = self.engine.run_strategy(
            strategy_key,
            train_start='2021-01-01',
            train_end='2024-12-31',
            sample_interval=3
        )
        
        # Out-of-Sample (Testing)
        print(f"\n📊 Out-of-Sample (Testing): 2025-01-01 → latest")
        oos_result = self.engine.run_strategy(
            strategy_key,
            train_start='2025-01-01',
            train_end='2026-12-31',
            sample_interval=3
        )
        
        # Compare
        self._print_comparison(is_result, oos_result)
        return is_result, oos_result
    
    def _print_comparison(self, is_result: StrategyResult, oos_result: StrategyResult):
        print(f"\n{'='*70}")
        print(f"📊 مقارنة Walk-Forward")
        print(f"{'='*70}")
        print(f"{'Metric':<25} {'In-Sample':>12} {'Out-of-Sample':>12} {'Delta':>10}")
        print(f"{'-'*60}")
        
        metrics = [
            ('Win Rate %', is_result.win_rate, oos_result.win_rate),
            ('Profit Factor', is_result.profit_factor, oos_result.profit_factor),
            ('Avg Return %', is_result.avg_return_pct, oos_result.avg_return_pct),
            ('Avg Winner %', is_result.avg_winner_pct, oos_result.avg_winner_pct),
            ('Avg Loser %', is_result.avg_loser_pct, oos_result.avg_loser_pct),
            ('Max Drawdown %', is_result.max_drawdown_pct, oos_result.max_drawdown_pct),
            ('Sharpe Ratio', is_result.sharpe_ratio, oos_result.sharpe_ratio),
            ('Picks/Day', is_result.picks_per_day, oos_result.picks_per_day),
            ('Total Trades', is_result.total_trades, oos_result.total_trades),
            ('Avg Hold Days', is_result.avg_holding_days, oos_result.avg_holding_days),
        ]
        
        for name, is_val, oos_val in metrics:
            if isinstance(is_val, (int, float)) and isinstance(oos_val, (int, float)):
                delta = oos_val - is_val
                delta_str = f"{delta:+.2f}" if isinstance(delta, float) else f"{delta:+d}"
                print(f"{name:<25} {is_val:>12} {oos_val:>12} {delta_str:>10}")
        
        # Verdict
        if oos_result.profit_factor >= 1.2 and oos_result.win_rate >= 50:
            verdict = "✅ النظام يعمل خارج العينة — يمكن الاعتماد عليه"
        elif oos_result.profit_factor >= 1.0:
            verdict = "⚠️ النظام هش خارج العينة — يحتاج تحسين"
        else:
            verdict = "❌ النظام فشل خارج العينة — overfitting محتمل"
        
        print(f"\n🎯 الحكم: {verdict}")


# ============================================================================
# REPORT GENERATOR
# ============================================================================

def generate_report(results: Dict[str, StrategyResult], output_path: str = None) -> str:
    """Generate comprehensive bilingual report"""
    
    lines = []
    lines.append("")
    lines.append("🎯 تقرير اختبار القناص على EGX — EGX Sniper Backtest Report v2.0")
    lines.append("=" * 75)
    lines.append("البيانات: البورصة المصرية (EGX) — مش تداول!")
    lines.append("")
    
    for key, r in results.items():
        if r is None:
            continue
        
        lines.append(f"--- Strategy {key}: {r.variant} ---")
        lines.append(f"  {r.description}")
        lines.append(f"  {'─'*50}")
        lines.append(f"  إجمالي الصفقات: {r.total_trades}")
        lines.append(f"  رابح / خاسر / منتهي: {r.winners} / {r.losers} / {r.expired}")
        lines.append(f"  معدل النجاح / Win Rate: {r.win_rate}%")
        lines.append(f"  متوسط الربح (رابح): +{r.avg_winner_pct}%")
        lines.append(f"  متوسط الخسارة (خاسر): {r.avg_loser_pct}%")
        lines.append(f"  معامل الربح / Profit Factor: {r.profit_factor}")
        lines.append(f"  متوسط العائد: {r.avg_return_pct:+.2f}%")
        lines.append(f"  أقصى خسارة / Max Drawdown: {r.max_drawdown_pct:.2f}%")
        lines.append(f"  Sharpe Ratio: {r.sharpe_ratio}")
        lines.append(f"  Calmar Ratio: {r.calmar_ratio}")
        lines.append(f"  متوسط فترة الاحتفاظ: {r.avg_holding_days} يوم")
        lines.append(f"  متوسط أعلى ربح (MFE): +{r.avg_mfe}%")
        lines.append(f"  متوسط أقصى خسارة (MAE): {r.avg_mae}%")
        lines.append(f"  فرص/يوم: {r.picks_per_day}")
        
        # Exit reason breakdown
        if r.trades:
            exit_reasons = {}
            for t in r.trades:
                exit_reasons[t.exit_reason] = exit_reasons.get(t.exit_reason, 0) + 1
            lines.append(f"  أسباب الخروج:")
            for reason, count in sorted(exit_reasons.items(), key=lambda x: -x[1]):
                pct = round(count / len(r.trades) * 100, 1)
                lines.append(f"    {reason}: {count} ({pct}%)")
        
        # Rating
        if r.profit_factor >= 1.5 and r.win_rate >= 55:
            rating = '⭐ ممتاز'
        elif r.profit_factor >= 1.2 and r.win_rate >= 50:
            rating = '✅ جيد جداً'
        elif r.profit_factor >= 1.0 and r.win_rate >= 50:
            rating = '👍 جيد'
        elif r.profit_factor >= 0.8:
            rating = '⚠️ مقبول'
        else:
            rating = '❌ ضعيف'
        
        lines.append(f"  التقييم: {rating}")
        lines.append("")
    
    # Find best strategy
    valid = {k: r for k, r in results.items() if r and r.total_trades > 5}
    if valid:
        best_key = max(valid, key=lambda k: valid[k].profit_factor)
        best = valid[best_key]
        lines.append(f"🏆 أفضل استراتيجية: {best_key} — {best.variant}")
        lines.append(f"   PF={best.profit_factor} | WR={best.win_rate}% | Avg={best.avg_return_pct:+.2f}%")
        lines.append(f"   {best.description}")
    
    lines.append("")
    lines.append("=" * 75)
    lines.append("⚠️ ملاحظة: هذا اختبار على بيانات تاريخية — النتائج السابقة لا تضمن المستقبل")
    
    report_text = '\n'.join(lines)
    
    if output_path:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(report_text)
        print(f"📄 Report saved to: {output_path}")
    
    return report_text


# ============================================================================
# PROFIT FACTOR ANALYZER
# ============================================================================

def analyze_profit_factor(results: Dict[str, StrategyResult]) -> str:
    """Deep dive into WHY the system loses money"""
    lines = []
    lines.append("")
    lines.append("🔍 تحليل معامل الربح — Profit Factor Deep Dive")
    lines.append("=" * 60)
    
    for key, r in results.items():
        if not r or not r.trades:
            continue
        
        lines.append(f"\n--- {r.variant} ---")
        
        # Winner vs Loser analysis
        winners = [t for t in r.trades if t.return_pct > 0]
        losers = [t for t in r.trades if t.return_pct <= 0]
        
        if winners:
            avg_win = sum(t.return_pct for t in winners) / len(winners)
            avg_win_mfe = sum(t.max_favorable for t in winners) / len(winners)
            lines.append(f"  📈 الرابحة ({len(winners)}):")
            lines.append(f"     متوسط الربح الفعلي: +{avg_win:.2f}%")
            lines.append(f"     متوسط أعلى ربح (MFE): +{avg_win_mfe:.2f}%")
            lines.append(f"     الفرق (مخزون ربح ضائع): {avg_win_mfe - avg_win:.2f}%")
        
        if losers:
            avg_loss = sum(t.return_pct for t in losers) / len(losers)
            avg_loss_mae = sum(t.max_adverse for t in losers) / len(losers)
            lines.append(f"  📉 الخاسرة ({len(losers)}):")
            lines.append(f"     متوسط الخسارة الفعلية: {avg_loss:.2f}%")
            lines.append(f"     متوسط أقصى خسارة (MAE): {avg_loss_mae:.2f}%")
            
            # How fast are losers stopped out?
            avg_los_days = sum(t.holding_days for t in losers) / len(losers)
            lines.append(f"     متوسط أيام الخسارة: {avg_los_days:.1f} يوم")
            
            # Stop hit analysis
            stop_exits = [t for t in losers if t.exit_reason == 'stop']
            trail_exits = [t for t in losers if t.exit_reason == 'trailing_stop']
            expired_exits = [t for t in losers if t.exit_reason == 'expired']
            lines.append(f"     وقف ثابت: {len(stop_exits)} | وقف متحرك: {len(trail_exits)} | منتهي: {len(expired_exits)}")
        
        # The key ratio
        if winners and losers:
            actual_rr = avg_win / abs(avg_loss) if avg_loss != 0 else 0
            lines.append(f"\n  💡 R/R الفعلي: {actual_rr:.2f}:1")
            if actual_rr < 1.0:
                lines.append(f"     ❌ الربح أقل من الخسارة — ده سبب PF < 1.0")
                lines.append(f"     الحل: إما زوّد الربح (+{abs(avg_win):.2f}% → +{abs(avg_loss):.2f}%)")
                lines.append(f"     أو قلّل الخسارة ({avg_loss:.2f}% → {avg_win:.2f}%)")
            else:
                lines.append(f"     ✅ الربح أكبر من الخسارة — ده اللي المطلوب!")
    
    return '\n'.join(lines)


# ============================================================================
# MAIN
# ============================================================================

def main():
    quick = '--quick' in sys.argv
    walk_forward = '--walk-forward' in sys.argv or '--wf' in sys.argv
    strategy_filter = None
    for arg in sys.argv:
        if arg.startswith('--strategy='):
            strategy_filter = arg.split('=')[1]
    
    print("🎯 EGX Sniper Backtest Engine v2.0")
    print("=" * 50)
    
    # Step 1: Ensure EGX data is available
    engine = EGXBacktestV2()
    engine.load_data()
    
    if not engine.stocks:
        print("❌ لا توجد بيانات EGX! شغّل fetch_egx_data.py أولاً")
        print("   python3 scripts/egx_backtest/fetch_egx_data.py")
        return
    
    # Step 2: Run all strategy variants
    results = {}
    strategies_to_test = [strategy_filter] if strategy_filter else list(EGXBacktestV2.STRATEGIES.keys())
    
    for key in strategies_to_test:
        if key not in EGXBacktestV2.STRATEGIES:
            print(f"⚠️ Unknown strategy: {key}")
            continue
        
        strategy = EGXBacktestV2.STRATEGIES[key]
        print(f"\n🔬 Testing Strategy {key}: {strategy['name']}")
        
        result = engine.run_strategy(key, sample_interval=3 if not quick else 10)
        results[key] = result
    
    # Step 3: Generate reports
    report = generate_report(results, str(RESULTS_DIR / 'egx_backtest_report.txt'))
    print(report)
    
    # Step 4: Profit Factor Analysis
    pf_analysis = analyze_profit_factor(results)
    print(pf_analysis)
    
    # Save PF analysis
    with open(str(RESULTS_DIR / 'pf_analysis.txt'), 'w', encoding='utf-8') as f:
        f.write(pf_analysis)
    
    # Step 5: Walk-Forward Test
    if walk_forward:
        # Find best strategy
        valid = {k: r for k, r in results.items() if r and r.total_trades > 5}
        if valid:
            best_key = max(valid, key=lambda k: valid[k].profit_factor)
            wf = WalkForwardTest(engine)
            wf.run(best_key)
    
    # Step 6: Save JSON results
    json_results = {}
    for key, r in results.items():
        if r:
            json_results[key] = {
                'variant': r.variant,
                'description': r.description,
                'total_trades': r.total_trades,
                'winners': r.winners,
                'losers': r.losers,
                'win_rate': r.win_rate,
                'avg_winner_pct': r.avg_winner_pct,
                'avg_loser_pct': r.avg_loser_pct,
                'profit_factor': r.profit_factor,
                'avg_return_pct': r.avg_return_pct,
                'max_drawdown_pct': r.max_drawdown_pct,
                'sharpe_ratio': r.sharpe_ratio,
                'picks_per_day': r.picks_per_day,
            }
    
    with open(str(RESULTS_DIR / 'egx_backtest_results.json'), 'w', encoding='utf-8') as f:
        json.dump(json_results, f, indent=2, ensure_ascii=False)
    
    print(f"\n✅ النتائج محفوظة في: {RESULTS_DIR}")


if __name__ == '__main__':
    main()
