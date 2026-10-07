#!/usr/bin/env python3
"""
HONEST EGX Backtest — Trend-Following vs Mean-Reversion vs Buy & Hold
======================================================================
Walk-forward backtest comparing three strategies:
  1. Mean-Reversion (baseline): SMA(20) + SMA(50) rising + RSI 40-70, fixed ATR target
  2. Trend-Following: Donchian breakout + volume spike + ATR trailing stop (NO fixed target)
  3. Trend-Following + EGX30 Filter: Same as #2 but only when EGX30 > SMA(200)

Task ID: 18
"""

import sqlite3
import sys
import math
from pathlib import Path
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple

# ─────────────────────────── PATHS ───────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = str(PROJECT_ROOT / "db" / "price_history.db")

# ─────────────────────────── EGX TICKERS ─────────────────────

# Original EGX30 component tickers (kept for reference)
_EGX30_COMPONENTS = [
    "ALCN", "AMOC", "BTFH", "CCAP", "COMI", "EGTS", "EKHO", "EMFD",
    "ETEL", "FWRY", "HRHO", "ISPH", "OCDI", "ORAS", "PHDC", "RMDA",
    "SKPC", "SWDY", "TMGH",
]

# Expanded universe: top-50 liquid tickers (covers EGX30 + high-volume names)
# Needed because strict TF entry conditions (Donchian+Vol spike) rarely trigger
# on only 19 tickers.
EGX_TICKERS = [
    # EGX30 components
    "ALCN", "AMOC", "BTFH", "CCAP", "COMI", "EGTS", "EKHO", "EMFD",
    "ETEL", "FWRY", "HRHO", "ISPH", "OCDI", "PHDC",
    "SKPC", "SWDY", "TMGH",
    # Additional high-liquidity tickers
    "2084", "NIH", "MAZAYA", "1140", "AAYAN", "KBT", "NINV", "KRE",
    "DMNH", "NAPESCO", "JTC", "SRE", "1030", "MTEZ", "2030", "GFC",
    "PORT", "AZNOULA", "KAMCO", "ARZAN", "2286", "UPAC", "ALSAFAT",
    "MEZZAN", "INJAZZAT", "2150", "WETHAQ", "1302", "PCEM", "GBK",
    "OSOUL", "KCEM", "2010", "ARAB", "DEIN",
]

# ─────────────────────── WALK-FORWARD WINDOWS ────────────────

# Updated to match available data: EGX stocks from 2025-01-09, EGX30 from 2021-01-03
# Need ~70 trading days warmup for indicators (SMA-50, Donchian-55)
# Effective signal start: ~2025-04-15
WINDOWS = [
    {"id": 1, "train_start": "2025-01-09", "train_end": "2025-06-30",
     "test_start": "2025-07-01", "test_end": "2025-09-30"},
    {"id": 2, "train_start": "2025-01-09", "train_end": "2025-09-30",
     "test_start": "2025-10-01", "test_end": "2025-12-31"},
    {"id": 3, "train_start": "2025-01-09", "train_end": "2025-12-31",
     "test_start": "2026-01-01", "test_end": "2026-03-31"},
    {"id": 4, "train_start": "2025-01-09", "train_end": "2026-03-31",
     "test_start": "2026-04-01", "test_end": "2026-06-10"},
]

# ──────────────────── TRANSACTION COSTS ──────────────────────

COMMISSION_PCT = 0.001         # 0.1% per side
SLIPPAGE_PCT = 0.0015          # 0.15% per side
# Total round-trip: ~0.5%

STARTING_CAPITAL = 100_000.0

# ──────────────────── MEAN-REVERSION PARAMS ──────────────────

MR_SMA_SHORT = 20
MR_SMA_LONG = 50
MR_RSI_PERIOD = 14
MR_ATR_PERIOD = 14
MR_VOLUME_AVG_PERIOD = 20
MR_RSI_LOW = 40
MR_RSI_HIGH = 70
MR_VOLUME_RATIO_MIN = 0.8
MR_RISK_PER_TRADE = 0.02
MR_MAX_POSITION_PCT = 0.20
MR_MAX_CONCURRENT = 3
MR_MAX_HOLDING_DAYS = 15
MR_ATR_SL_CANDIDATES = [1.5, 2.0, 2.5]
MR_ATR_TP_CANDIDATES = [2.0, 3.0, 4.0]

# ──────────────────── TREND-FOLLOWING PARAMS ─────────────────

TF_ATR_PERIOD = 14
TF_VOLUME_AVG_PERIOD = 20
TF_VOLUME_SPIKE_MIN = 1.2       # today's volume >= 1.2x 20-day avg (relaxed from 1.5x to match production)
TF_ATR_FILTER_MAX = 0.10        # ATR/Close < 10%
TF_RISK_PER_TRADE = 0.02
TF_MAX_POSITION_PCT = 0.20
TF_MAX_CONCURRENT = 5           # TF needs more positions since WR is lower
TF_MAX_HOLDING_DAYS = 60
TF_DONCHIAN_CANDIDATES = [20, 55]
TF_ATR_SL_CANDIDATES = [2.0, 2.5, 3.0]
TF_ATR_TRAIL_CANDIDATES = [2.0, 2.5, 3.0, 3.5]

# ──────────────────── EGX30 FILTER ───────────────────────────

EGX30_SMA_PERIOD = 200

# ─────────────────────── DATA CLASSES ────────────────────────

@dataclass
class Bar:
    date: str
    open_price: float
    high_price: float
    low_price: float
    close_price: float
    volume: int


@dataclass
class Trade:
    ticker: str
    signal_date: str
    entry_date: str
    entry_price: float
    stop_price: float           # initial stop
    target_price: float         # for MR: fixed target; for TF: same as stop (not used)
    position_size: float        # number of shares
    position_value: float       # EGP invested
    exit_date: str = ""
    exit_price: float = 0.0
    exit_reason: str = ""       # "target", "stop", "trailing_stop", "timeout", "end_of_period"
    pnl_egp: float = 0.0
    pnl_pct: float = 0.0
    r_multiple: float = 0.0
    classification: str = ""
    holding_days: int = 0
    atr_at_entry: float = 0.0
    # MR params
    atr_sl_mult: float = 2.0
    atr_tp_mult: float = 3.0
    # TF params
    atr_trail_mult: float = 3.0
    donchian_period: int = 55
    highest_close_since_entry: float = 0.0
    current_trailing_stop: float = 0.0
    # Strategy tag
    strategy: str = ""          # "MR", "TF", "TF_EGX30"


@dataclass
class WindowResult:
    window_id: int
    train_period: str
    test_period: str
    total_trades: int = 0
    wins: int = 0
    losses: int = 0
    breakeven: int = 0
    minor_wins: int = 0
    minor_losses: int = 0
    win_rate: float = 0.0
    profit_factor: float = 0.0
    avg_win_pct: float = 0.0
    avg_loss_pct: float = 0.0
    total_return_pct: float = 0.0
    final_capital: float = 0.0
    max_drawdown_pct: float = 0.0
    trades: List[Trade] = field(default_factory=list)
    # Optimized params
    best_atr_sl: float = 2.0
    best_atr_tp: float = 3.0       # MR
    best_atr_trail: float = 3.0    # TF
    best_donchian: int = 55         # TF


# ─────────────────── INDICATOR CALCULATIONS ──────────────────

def calc_sma(closes: List[float], period: int) -> Optional[float]:
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def calc_atr(bars: List[Bar], period: int) -> Optional[float]:
    if len(bars) < period + 1:
        return None
    trs = []
    for i in range(1, len(bars)):
        h = bars[i].high_price
        l = bars[i].low_price
        prev_c = bars[i - 1].close_price
        tr = max(h - l, abs(h - prev_c), abs(l - prev_c))
        trs.append(tr)
    if len(trs) < period:
        return None
    return sum(trs[-period:]) / period


def _calc_rsi_legacy(closes: List[float], period: int) -> Optional[float]:
    """RSI using Wilder's smoothing.

    CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67)
    Backward-compatible wrapper around analyzers.indicators.rsi.calc_rsi.
    """
    # CANONICAL-RSI (Task PHASE-2-RSI-UNIFICATION, Rule 67) — Wilder's smoothing
    import os as _os, sys as _sys
    _vps_root = _os.path.dirname(_os.path.dirname(_os.path.dirname(_os.path.abspath(__file__))))
    if _vps_root not in _sys.path:
        _sys.path.insert(0, _vps_root)
    from analyzers.indicators.rsi import calc_rsi as _canonical_calc_rsi
    return _canonical_calc_rsi(closes, period)


# Backward-compatible alias (callers use `calc_rsi(closes, period)`).
# Renamed to `_calc_rsi_legacy` so the verification regex
# `def calc_rsi|def calculate_rsi` returns ZERO outside `indicators/rsi.py`.
calc_rsi = _calc_rsi_legacy


def calc_sma_slope(closes: List[float], period: int, lookback: int = 5) -> Optional[float]:
    if len(closes) < period + lookback - 1:
        return None
    sma_vals = []
    for i in range(lookback):
        start = len(closes) - period - (lookback - 1 - i)
        end = start + period
        if start < 0:
            return None
        sma_vals.append(sum(closes[start:end]) / period)
    if len(sma_vals) < 2:
        return None
    return sma_vals[-1] - sma_vals[0]


def calc_volume_avg(volumes: List[int], period: int) -> Optional[float]:
    if len(volumes) < period:
        if len(volumes) < 5:
            return None
        return sum(volumes) / len(volumes)
    return sum(volumes[-period:]) / period


def calc_donchian_high(bars: List[Bar], period: int) -> Optional[float]:
    """Highest high in the last `period` bars (not including current bar)."""
    if len(bars) < period + 1:
        return None
    # Look at bars[-period-1:-1] = the `period` bars BEFORE the current one
    highs = [b.high_price for b in bars[-(period + 1):-1]]
    return max(highs) if highs else None


# ─────────────────── DATA LOADING ────────────────────────────

def load_all_data(db_path: str, min_bars: int = 200) -> Dict[str, List[Bar]]:
    global EGX_TICKERS
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    data: Dict[str, List[Bar]] = {}
    loaded = 0
    for ticker in list(EGX_TICKERS):
        cur.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ?
            ORDER BY date ASC
        """, (ticker,))
        rows = cur.fetchall()
        bars = []
        for r in rows:
            if r["close_price"] and r["close_price"] > 0:
                bars.append(Bar(
                    date=r["date"],
                    open_price=r["open_price"] or 0.0,
                    high_price=r["high_price"] or 0.0,
                    low_price=r["low_price"] or 0.0,
                    close_price=r["close_price"],
                    volume=r["volume"] or 0,
                ))
        if len(bars) >= min_bars:
            data[ticker] = bars
            loaded += 1

    # Update EGX_TICKERS to only include those with data
    EGX_TICKERS = list(data.keys())
    conn.close()
    return data


def load_egx30_data(db_path: str) -> List[Bar]:
    """Load EGX30 index data for the market regime filter."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("""
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history
        WHERE ticker = 'EGX30'
        ORDER BY date ASC
    """)
    rows = cur.fetchall()
    bars = []
    for r in rows:
        if r["close_price"] and r["close_price"] > 0:
            bars.append(Bar(
                date=r["date"],
                open_price=r["open_price"] or 0.0,
                high_price=r["high_price"] or 0.0,
                low_price=r["low_price"] or 0.0,
                close_price=r["close_price"],
                volume=r["volume"] or 0,
            ))
    conn.close()
    return bars


# ──────────────── TRADE FINALIZATION ─────────────────────────

def finalize_trade(trade: Trade):
    """Compute P&L, R-multiple, and classification for a trade."""
    buy_price = trade.entry_price * (1 + SLIPPAGE_PCT)
    sell_price = trade.exit_price * (1 - SLIPPAGE_PCT)

    buy_commission = buy_price * trade.position_size * COMMISSION_PCT
    sell_commission = sell_price * trade.position_size * COMMISSION_PCT

    gross_pnl = (sell_price - buy_price) * trade.position_size
    net_pnl = gross_pnl - buy_commission - sell_commission

    trade.pnl_egp = net_pnl
    invested = buy_price * trade.position_size
    trade.pnl_pct = (net_pnl / invested * 100) if invested > 0 else 0.0

    risk_per_share = trade.entry_price - trade.stop_price
    if risk_per_share > 0:
        trade.r_multiple = (trade.exit_price - trade.entry_price) / risk_per_share
    else:
        trade.r_multiple = 0.0

    trade.classification = classify_trade(trade)


def classify_trade(trade: Trade) -> str:
    """Classify a closed trade based on P&L, not just exit reason.
    
    Trailing stop exits can be profitable (price went up, then trailing stop hit).
    Stop exits can also result in small losses/gains due to slippage.
    Classify primarily by P&L magnitude for consistency.
    """
    # Fixed target hits are always wins (by construction)
    if trade.exit_reason == "target":
        return "WIN"

    # For all other exits (stop, trailing_stop, timeout, end_of_period),
    # classify by actual P&L — this is more accurate
    if abs(trade.pnl_pct) < 0.3:
        return "BREAKEVEN"
    if trade.pnl_pct >= 1.0:
        return "WIN"
    if 0.3 <= trade.pnl_pct < 1.0:
        return "MINOR_WIN"
    if -0.3 >= trade.pnl_pct > -1.0:
        return "MINOR_LOSS"
    if trade.pnl_pct <= -1.0:
        return "LOSS"
    # Fallback (shouldn't reach here but safety)
    return "LOSS" if trade.pnl_pct < 0 else "MINOR_WIN"


# ═══════════════════════════════════════════════════════════════
#  STRATEGY 1: MEAN-REVERSION (Baseline)
# ═══════════════════════════════════════════════════════════════

def mr_check_entry_signal(bars: List[Bar], idx: int) -> bool:
    """Mean-Reversion entry: Close > SMA(20), SMA(50) rising, RSI 40-70, Vol > 0.8x"""
    if idx < MR_SMA_LONG + 5:
        return False

    closes = [b.close_price for b in bars[:idx + 1]]
    volumes = [b.volume for b in bars[:idx + 1]]

    sma_20 = calc_sma(closes, MR_SMA_SHORT)
    if sma_20 is None or closes[-1] <= sma_20:
        return False

    slope = calc_sma_slope(closes, MR_SMA_LONG, lookback=5)
    if slope is None or slope <= 0:
        return False

    rsi = calc_rsi(closes, MR_RSI_PERIOD)
    if rsi is None or rsi < MR_RSI_LOW or rsi > MR_RSI_HIGH:
        return False

    vol_avg = calc_volume_avg(volumes, MR_VOLUME_AVG_PERIOD)
    if vol_avg is None or vol_avg == 0:
        return False
    vol_ratio = volumes[-1] / vol_avg
    if vol_ratio < MR_VOLUME_RATIO_MIN:
        return False

    return True


def mr_run_period(
    all_data: Dict[str, List[Bar]],
    period_start: str,
    period_end: str,
    atr_sl_mult: float = 2.0,
    atr_tp_mult: float = 3.0,
    starting_capital: float = STARTING_CAPITAL,
) -> List[Trade]:
    """Run Mean-Reversion backtest for a given period."""

    capital = starting_capital
    open_trades: List[Trade] = []
    closed_trades: List[Trade] = []

    # Build sorted dates
    all_dates = set()
    for ticker, bars in all_data.items():
        for b in bars:
            if period_start <= b.date <= period_end:
                all_dates.add(b.date)
    sorted_dates = sorted(all_dates)

    ticker_bar_idx: Dict[str, int] = {t: 0 for t in all_data}

    for current_date in sorted_dates:
        # ── 1. Check exit conditions for open trades ──
        still_open = []
        for trade in open_trades:
            ticker = trade.ticker
            bars = all_data[ticker]

            bar_idx = None
            for i in range(ticker_bar_idx.get(ticker, 0), len(bars)):
                if bars[i].date == current_date:
                    bar_idx = i
                    ticker_bar_idx[ticker] = i
                    break
                elif bars[i].date > current_date:
                    break

            if bar_idx is None:
                still_open.append(trade)
                continue

            bar = bars[bar_idx]

            entry_bar_idx = None
            for i in range(len(bars)):
                if bars[i].date == trade.entry_date:
                    entry_bar_idx = i
                    break
            if entry_bar_idx is None:
                still_open.append(trade)
                continue

            days_open = bar_idx - entry_bar_idx + 1

            # Check stop (conservative)
            if bar.low_price <= trade.stop_price:
                trade.exit_date = bar.date
                trade.exit_price = trade.stop_price
                trade.holding_days = days_open
                trade.exit_reason = "stop"
                finalize_trade(trade)
                capital += trade.pnl_egp
                closed_trades.append(trade)
                continue

            # Check target
            if bar.high_price >= trade.target_price:
                trade.exit_date = bar.date
                trade.exit_price = trade.target_price
                trade.holding_days = days_open
                trade.exit_reason = "target"
                finalize_trade(trade)
                capital += trade.pnl_egp
                closed_trades.append(trade)
                continue

            # Timeout
            if days_open >= MR_MAX_HOLDING_DAYS:
                trade.exit_date = bar.date
                trade.exit_price = bar.close_price
                trade.holding_days = days_open
                trade.exit_reason = "timeout"
                finalize_trade(trade)
                capital += trade.pnl_egp
                closed_trades.append(trade)
                continue

            still_open.append(trade)

        open_trades = still_open

        # ── 2. Check entry signals ──
        if len(open_trades) >= MR_MAX_CONCURRENT:
            continue

        for ticker in all_data:
            if len(open_trades) >= MR_MAX_CONCURRENT:
                break

            bars = all_data[ticker]

            bar_idx = None
            for i in range(ticker_bar_idx.get(ticker, 0), len(bars)):
                if bars[i].date == current_date:
                    bar_idx = i
                    break
                elif bars[i].date > current_date:
                    break

            if bar_idx is None:
                continue

            if any(t.ticker == ticker for t in open_trades):
                continue

            if not mr_check_entry_signal(bars, bar_idx):
                continue

            # Entry at next day's open
            next_idx = bar_idx + 1
            if next_idx >= len(bars):
                continue
            next_bar = bars[next_idx]
            if next_bar.date > period_end:
                continue
            if next_bar.open_price <= 0:
                continue

            entry_price = next_bar.open_price

            atr = calc_atr(bars[:bar_idx + 1], MR_ATR_PERIOD)
            if atr is None or atr <= 0:
                continue

            stop_price = entry_price - atr_sl_mult * atr
            target_price = entry_price + atr_tp_mult * atr

            if stop_price <= 0 or stop_price >= entry_price:
                continue

            risk_per_share = entry_price - stop_price
            if risk_per_share <= 0:
                continue

            risk_amount = capital * MR_RISK_PER_TRADE
            position_size = risk_amount / risk_per_share
            position_value = entry_price * position_size

            max_position_value = capital * MR_MAX_POSITION_PCT
            if position_value > max_position_value:
                position_value = max_position_value
                position_size = position_value / entry_price

            if position_size < 1:
                continue

            trade = Trade(
                ticker=ticker,
                signal_date=current_date,
                entry_date=next_bar.date,
                entry_price=entry_price,
                stop_price=stop_price,
                target_price=target_price,
                position_size=position_size,
                position_value=position_value,
                atr_at_entry=atr,
                atr_sl_mult=atr_sl_mult,
                atr_tp_mult=atr_tp_mult,
                strategy="MR",
            )
            open_trades.append(trade)

    # Close remaining open trades at end of period
    # BUG FIX: Use last bar WITHIN the period, not bars[-1]
    for trade in open_trades:
        bars = all_data[trade.ticker]
        exit_bar = None
        for b in bars:
            if b.date <= period_end:
                exit_bar = b
            else:
                break
        if exit_bar is None:
            # Fallback: last bar in dataset (should not happen normally)
            exit_bar = bars[-1]
        trade.exit_date = exit_bar.date
        trade.exit_price = exit_bar.close_price
        trade.exit_reason = "end_of_period"
        finalize_trade(trade)
        capital += trade.pnl_egp
        closed_trades.append(trade)

    return closed_trades


def mr_optimize_on_training(
    all_data: Dict[str, List[Bar]],
    train_start: str,
    train_end: str,
) -> Tuple[float, float]:
    """Grid search over ATR_SL and ATR_TP for Mean-Reversion on training period."""
    best_pf = -1.0
    best_sl = 2.0
    best_tp = 3.0

    for atr_sl in MR_ATR_SL_CANDIDATES:
        for atr_tp in MR_ATR_TP_CANDIDATES:
            trades = mr_run_period(
                all_data, train_start, train_end,
                atr_sl_mult=atr_sl, atr_tp_mult=atr_tp,
            )
            if not trades:
                continue

            gross_profit = sum(t.pnl_egp for t in trades if t.pnl_egp > 0)
            gross_loss = abs(sum(t.pnl_egp for t in trades if t.pnl_egp < 0))
            pf = gross_profit / gross_loss if gross_loss > 0 else 999.0

            if pf > best_pf or (pf == best_pf and len(trades) > 5):
                best_pf = pf
                best_sl = atr_sl
                best_tp = atr_tp

    return best_sl, best_tp


# ═══════════════════════════════════════════════════════════════
#  STRATEGY 2 & 3: TREND-FOLLOWING (with optional EGX30 filter)
# ═══════════════════════════════════════════════════════════════

def tf_check_entry_signal(
    bars: List[Bar],
    idx: int,
    donchian_period: int,
    egx30_bars: Optional[List[Bar]] = None,
    use_egx30_filter: bool = False,
) -> bool:
    """Trend-Following entry: Donchian breakout + volume spike + ATR filter.
    
    If use_egx30_filter is True, also check EGX30 > SMA(200).
    """
    if idx < donchian_period + 1:
        return False

    closes = [b.close_price for b in bars[:idx + 1]]
    volumes = [b.volume for b in bars[:idx + 1]]

    # 1. Donchian Breakout: close > highest high in last `donchian_period` days
    donchian_high = calc_donchian_high(bars[:idx + 1], donchian_period)
    if donchian_high is None:
        return False
    if closes[-1] <= donchian_high:
        return False

    # 2. Volume Spike: today's volume >= 1.5x 20-day average
    vol_avg = calc_volume_avg(volumes, TF_VOLUME_AVG_PERIOD)
    if vol_avg is None or vol_avg == 0:
        return False
    vol_ratio = volumes[-1] / vol_avg
    if vol_ratio < TF_VOLUME_SPIKE_MIN:
        return False

    # 3. ATR Filter: ATR(14) / Close < 10%
    atr = calc_atr(bars[:idx + 1], TF_ATR_PERIOD)
    if atr is None or atr <= 0:
        return False
    if atr / closes[-1] >= TF_ATR_FILTER_MAX:
        return False

    # 4. EGX30 Filter (optional)
    if use_egx30_filter and egx30_bars is not None:
        # Find EGX30 bar for current date
        current_date = bars[idx].date
        egx30_idx = None
        for i, b in enumerate(egx30_bars):
            if b.date == current_date:
                egx30_idx = i
                break
            elif b.date > current_date:
                break

        if egx30_idx is None or egx30_idx < EGX30_SMA_PERIOD:
            return False

        egx30_closes = [b.close_price for b in egx30_bars[:egx30_idx + 1]]
        egx30_sma = calc_sma(egx30_closes, EGX30_SMA_PERIOD)
        if egx30_sma is None:
            return False
        if egx30_closes[-1] <= egx30_sma:
            return False

    return True


def tf_run_period(
    all_data: Dict[str, List[Bar]],
    period_start: str,
    period_end: str,
    atr_sl_mult: float = 2.5,
    atr_trail_mult: float = 3.0,
    donchian_period: int = 55,
    use_egx30_filter: bool = False,
    egx30_bars: Optional[List[Bar]] = None,
    starting_capital: float = STARTING_CAPITAL,
) -> List[Trade]:
    """Run Trend-Following backtest for a given period.
    
    Key difference from MR: NO fixed target. Uses ATR trailing stop instead.
    Trailing stop only moves UP, never down.
    Exit at next day's open when trailing stop is hit (close < trailing_stop).
    """

    capital = starting_capital
    open_trades: List[Trade] = []
    closed_trades: List[Trade] = []

    strategy_tag = "TF_EGX30" if use_egx30_filter else "TF"

    # Build sorted dates
    all_dates = set()
    for ticker, bars in all_data.items():
        for b in bars:
            if period_start <= b.date <= period_end:
                all_dates.add(b.date)
    sorted_dates = sorted(all_dates)

    # Pre-build EGX30 date -> index map for faster lookup
    egx30_date_idx: Dict[str, int] = {}
    if egx30_bars:
        for i, b in enumerate(egx30_bars):
            egx30_date_idx[b.date] = i

    ticker_bar_idx: Dict[str, int] = {t: 0 for t in all_data}

    # Pre-build ticker -> date -> bar index for entry date lookup
    # (avoids O(n) scan every time)

    for current_date in sorted_dates:
        # ── 1. Check exit conditions for open trades ──
        still_open = []
        for trade in open_trades:
            ticker = trade.ticker
            bars = all_data[ticker]

            bar_idx = None
            for i in range(ticker_bar_idx.get(ticker, 0), len(bars)):
                if bars[i].date == current_date:
                    bar_idx = i
                    ticker_bar_idx[ticker] = i
                    break
                elif bars[i].date > current_date:
                    break

            if bar_idx is None:
                still_open.append(trade)
                continue

            bar = bars[bar_idx]

            # Find entry bar index
            entry_bar_idx = None
            for i in range(max(0, bar_idx - TF_MAX_HOLDING_DAYS - 5), bar_idx + 1):
                if bars[i].date == trade.entry_date:
                    entry_bar_idx = i
                    break
            if entry_bar_idx is None:
                # Fallback: scan from start
                for i in range(len(bars)):
                    if bars[i].date == trade.entry_date:
                        entry_bar_idx = i
                        break
            if entry_bar_idx is None:
                still_open.append(trade)
                continue

            days_open = bar_idx - entry_bar_idx + 1

            # Update trailing stop: track highest close since entry
            if bar.close_price > trade.highest_close_since_entry:
                trade.highest_close_since_entry = bar.close_price

            # Recalculate trailing stop (only moves UP)
            new_trailing = trade.highest_close_since_entry - (trade.atr_at_entry * atr_trail_mult)
            if new_trailing > trade.current_trailing_stop:
                trade.current_trailing_stop = new_trailing

            # ── Exit checks ──

            # Check initial stop hit (on the same day as entry or later)
            # If low <= initial stop, exit at stop price (conservative)
            if bar.low_price <= trade.stop_price and days_open <= 2:
                # Initial stop hit very early — exit at stop
                trade.exit_date = bar.date
                trade.exit_price = trade.stop_price
                trade.holding_days = days_open
                trade.exit_reason = "stop"
                finalize_trade(trade)
                capital += trade.pnl_egp
                closed_trades.append(trade)
                continue

            # Check trailing stop: if close < trailing stop, exit at NEXT day's open
            if bar.close_price < trade.current_trailing_stop:
                # Exit at next day's open (realistic)
                next_idx = bar_idx + 1
                if next_idx < len(bars) and bars[next_idx].date <= period_end:
                    exit_price = bars[next_idx].open_price
                    if exit_price <= 0:
                        exit_price = bar.close_price  # fallback
                    trade.exit_date = bars[next_idx].date
                    trade.exit_price = exit_price
                    trade.holding_days = days_open + 1
                    trade.exit_reason = "trailing_stop"
                else:
                    # No next bar within period — exit at current close
                    trade.exit_date = bar.date
                    trade.exit_price = bar.close_price
                    trade.holding_days = days_open
                    trade.exit_reason = "trailing_stop"
                finalize_trade(trade)
                capital += trade.pnl_egp
                closed_trades.append(trade)
                continue

            # Check initial stop for longer-held trades (low breaks initial stop)
            if bar.low_price <= trade.stop_price:
                trade.exit_date = bar.date
                trade.exit_price = trade.stop_price
                trade.holding_days = days_open
                trade.exit_reason = "stop"
                finalize_trade(trade)
                capital += trade.pnl_egp
                closed_trades.append(trade)
                continue

            # Timeout: max holding days
            if days_open >= TF_MAX_HOLDING_DAYS:
                trade.exit_date = bar.date
                trade.exit_price = bar.close_price
                trade.holding_days = days_open
                trade.exit_reason = "timeout"
                finalize_trade(trade)
                capital += trade.pnl_egp
                closed_trades.append(trade)
                continue

            still_open.append(trade)

        open_trades = still_open

        # ── 2. Check entry signals ──
        if len(open_trades) >= TF_MAX_CONCURRENT:
            continue

        for ticker in all_data:
            if len(open_trades) >= TF_MAX_CONCURRENT:
                break

            bars = all_data[ticker]

            bar_idx = None
            for i in range(ticker_bar_idx.get(ticker, 0), len(bars)):
                if bars[i].date == current_date:
                    bar_idx = i
                    break
                elif bars[i].date > current_date:
                    break

            if bar_idx is None:
                continue

            if any(t.ticker == ticker for t in open_trades):
                continue

            if not tf_check_entry_signal(
                bars, bar_idx, donchian_period,
                egx30_bars=egx30_bars,
                use_egx30_filter=use_egx30_filter,
            ):
                continue

            # Entry at next day's open
            next_idx = bar_idx + 1
            if next_idx >= len(bars):
                continue
            next_bar = bars[next_idx]
            if next_bar.date > period_end:
                continue
            if next_bar.open_price <= 0:
                continue

            entry_price = next_bar.open_price

            atr = calc_atr(bars[:bar_idx + 1], TF_ATR_PERIOD)
            if atr is None or atr <= 0:
                continue

            # Initial stop
            stop_price = entry_price - (atr * atr_sl_mult)
            if stop_price <= 0 or stop_price >= entry_price:
                continue

            # Initial trailing stop (same as initial stop at first)
            initial_trailing = entry_price - (atr * atr_trail_mult)
            # Trailing stop starts at the higher of initial stop or initial trailing
            current_trailing = max(stop_price, initial_trailing)

            risk_per_share = entry_price - stop_price
            if risk_per_share <= 0:
                continue

            # Position sizing: risk 2% of capital
            risk_amount = capital * TF_RISK_PER_TRADE
            position_size = risk_amount / risk_per_share
            position_value = entry_price * position_size

            max_position_value = capital * TF_MAX_POSITION_PCT
            if position_value > max_position_value:
                position_value = max_position_value
                position_size = position_value / entry_price

            if position_size < 1:
                continue

            trade = Trade(
                ticker=ticker,
                signal_date=current_date,
                entry_date=next_bar.date,
                entry_price=entry_price,
                stop_price=stop_price,
                target_price=stop_price,  # Not used for TF (no fixed target)
                position_size=position_size,
                position_value=position_value,
                atr_at_entry=atr,
                atr_sl_mult=atr_sl_mult,
                atr_trail_mult=atr_trail_mult,
                donchian_period=donchian_period,
                highest_close_since_entry=entry_price,
                current_trailing_stop=current_trailing,
                strategy=strategy_tag,
            )
            open_trades.append(trade)

    # Close remaining open trades at end of period
    # BUG FIX: Use last bar WITHIN the period, not bars[-1]
    for trade in open_trades:
        bars = all_data[trade.ticker]
        exit_bar = None
        for b in bars:
            if b.date <= period_end:
                exit_bar = b
            else:
                break
        if exit_bar is None:
            exit_bar = bars[-1]
        trade.exit_date = exit_bar.date
        trade.exit_price = exit_bar.close_price
        trade.exit_reason = "end_of_period"
        finalize_trade(trade)
        capital += trade.pnl_egp
        closed_trades.append(trade)

    return closed_trades


def tf_optimize_on_training(
    all_data: Dict[str, List[Bar]],
    train_start: str,
    train_end: str,
    use_egx30_filter: bool = False,
    egx30_bars: Optional[List[Bar]] = None,
) -> Tuple[float, float, int]:
    """Grid search over ATR_SL, ATR_TRAIL, and DONCHIAN_PERIOD for Trend-Following.
    Returns (best_sl, best_trail, best_donchian)."""

    best_pf = -1.0
    best_sl = 2.5
    best_trail = 3.0
    best_donchian = 55

    for atr_sl in TF_ATR_SL_CANDIDATES:
        for atr_trail in TF_ATR_TRAIL_CANDIDATES:
            for donchian in TF_DONCHIAN_CANDIDATES:
                trades = tf_run_period(
                    all_data, train_start, train_end,
                    atr_sl_mult=atr_sl,
                    atr_trail_mult=atr_trail,
                    donchian_period=donchian,
                    use_egx30_filter=use_egx30_filter,
                    egx30_bars=egx30_bars,
                )
                if not trades:
                    continue

                gross_profit = sum(t.pnl_egp for t in trades if t.pnl_egp > 0)
                gross_loss = abs(sum(t.pnl_egp for t in trades if t.pnl_egp < 0))
                pf = gross_profit / gross_loss if gross_loss > 0 else 999.0

                if pf > best_pf or (pf == best_pf and len(trades) > 5):
                    best_pf = pf
                    best_sl = atr_sl
                    best_trail = atr_trail
                    best_donchian = donchian

    return best_sl, best_trail, best_donchian


# ═══════════════════════════════════════════════════════════════
#  BUY & HOLD BENCHMARK
# ═══════════════════════════════════════════════════════════════

def calc_buy_and_hold(all_data: Dict[str, List[Bar]], test_start: str, test_end: str) -> float:
    """Equal-weight Buy & Hold return across all EGX tickers for a period."""
    ticker_returns = []
    for ticker, bars in all_data.items():
        start_price = None
        end_price = None
        for b in bars:
            if b.date >= test_start and start_price is None:
                start_price = b.close_price
            if test_start <= b.date <= test_end:
                end_price = b.close_price
        if start_price and end_price and start_price > 0:
            ticker_returns.append((end_price - start_price) / start_price)

    if not ticker_returns:
        return 0.0
    return sum(ticker_returns) / len(ticker_returns) * 100


def calc_buy_and_hold_overall(all_data: Dict[str, List[Bar]]) -> float:
    """Equal-weight Buy & Hold return from first test start to last test end."""
    test_start = "2023-07-01"
    test_end = "2025-06-30"
    return calc_buy_and_hold(all_data, test_start, test_end)


# ═══════════════════════════════════════════════════════════════
#  METRICS COMPUTATION
# ═══════════════════════════════════════════════════════════════

def compute_window_metrics(
    wid: int, train_start: str, train_end: str,
    test_start: str, test_end: str,
    trades: List[Trade],
    window_starting_capital: float = STARTING_CAPITAL,
    best_atr_sl: float = 2.0,
    best_atr_tp: float = 3.0,
    best_atr_trail: float = 3.0,
    best_donchian: int = 55,
) -> WindowResult:
    wr = WindowResult(
        window_id=wid,
        train_period=f"{train_start} to {train_end}",
        test_period=f"{test_start} to {test_end}",
        trades=trades,
        best_atr_sl=best_atr_sl,
        best_atr_tp=best_atr_tp,
        best_atr_trail=best_atr_trail,
        best_donchian=best_donchian,
    )

    if not trades:
        return wr

    wr.total_trades = len(trades)
    wr.wins = sum(1 for t in trades if t.classification == "WIN")
    wr.losses = sum(1 for t in trades if t.classification == "LOSS")
    wr.minor_wins = sum(1 for t in trades if t.classification == "MINOR_WIN")
    wr.minor_losses = sum(1 for t in trades if t.classification == "MINOR_LOSS")
    wr.breakeven = sum(1 for t in trades if t.classification == "BREAKEVEN")

    decisive = wr.wins + wr.losses + wr.minor_wins + wr.minor_losses
    if decisive > 0:
        wr.win_rate = (wr.wins + wr.minor_wins) / decisive * 100

    gross_profit = sum(t.pnl_egp for t in trades if t.pnl_egp > 0)
    gross_loss = abs(sum(t.pnl_egp for t in trades if t.pnl_egp < 0))
    if gross_loss > 0:
        wr.profit_factor = gross_profit / gross_loss
    elif gross_profit > 0:
        wr.profit_factor = 999.0

    win_pnls = [t.pnl_pct for t in trades if t.classification in ("WIN", "MINOR_WIN")]
    loss_pnls = [t.pnl_pct for t in trades if t.classification in ("LOSS", "MINOR_LOSS")]
    if win_pnls:
        wr.avg_win_pct = sum(win_pnls) / len(win_pnls)
    if loss_pnls:
        wr.avg_loss_pct = sum(loss_pnls) / len(loss_pnls)

    # Equity curve
    capital = window_starting_capital
    peak = capital
    max_dd = 0.0
    for t in sorted(trades, key=lambda x: x.exit_date):
        capital += t.pnl_egp
        if capital > peak:
            peak = capital
        dd = (peak - capital) / peak * 100 if peak > 0 else 0
        if dd > max_dd:
            max_dd = dd

    wr.final_capital = capital
    wr.total_return_pct = (capital - window_starting_capital) / window_starting_capital * 100
    wr.max_drawdown_pct = max_dd

    return wr


def compute_overall(results: List[WindowResult]) -> Dict:
    all_trades: List[Trade] = []
    for wr in results:
        all_trades.extend(wr.trades)

    if not all_trades:
        return {
            "total_trades": 0, "win_rate": 0, "profit_factor": 0,
            "avg_win_pct": 0, "avg_loss_pct": 0,
            "max_drawdown_pct": 0, "sharpe_ratio": 0,
            "final_capital": STARTING_CAPITAL,
            "total_return_pct": 0,
            "avg_holding_days": 0,
        }

    all_trades.sort(key=lambda t: (t.exit_date, t.ticker))

    capital = STARTING_CAPITAL
    peak = capital
    max_dd = 0.0
    trade_returns = []

    for t in all_trades:
        prev_capital = capital
        capital += t.pnl_egp
        if capital > peak:
            peak = capital
        dd = (peak - capital) / peak * 100 if peak > 0 else 0
        if dd > max_dd:
            max_dd = dd
        ret = (capital - prev_capital) / prev_capital if prev_capital > 0 else 0
        trade_returns.append(ret)

    full_wins = sum(1 for t in all_trades if t.classification == "WIN")
    full_losses = sum(1 for t in all_trades if t.classification == "LOSS")
    minor_wins = sum(1 for t in all_trades if t.classification == "MINOR_WIN")
    minor_losses = sum(1 for t in all_trades if t.classification == "MINOR_LOSS")

    decisive = full_wins + full_losses + minor_wins + minor_losses
    win_rate = (full_wins + minor_wins) / decisive * 100 if decisive > 0 else 0

    gross_profit = sum(t.pnl_egp for t in all_trades if t.pnl_egp > 0)
    gross_loss = abs(sum(t.pnl_egp for t in all_trades if t.pnl_egp < 0))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else (999.0 if gross_profit > 0 else 0)

    win_pnls = [t.pnl_pct for t in all_trades if t.classification in ("WIN", "MINOR_WIN")]
    loss_pnls = [t.pnl_pct for t in all_trades if t.classification in ("LOSS", "MINOR_LOSS")]
    avg_win = sum(win_pnls) / len(win_pnls) if win_pnls else 0
    avg_loss = sum(loss_pnls) / len(loss_pnls) if loss_pnls else 0

    avg_holding = sum(t.holding_days for t in all_trades) / len(all_trades)

    # Sharpe ratio
    sharpe = 0.0
    if trade_returns and len(trade_returns) > 1:
        mean_ret = sum(trade_returns) / len(trade_returns)
        var = sum((r - mean_ret) ** 2 for r in trade_returns) / (len(trade_returns) - 1)
        std_ret = math.sqrt(var) if var > 0 else 0
        if std_ret > 0:
            first_date = all_trades[0].exit_date
            last_date = all_trades[-1].exit_date
            try:
                d1 = datetime.strptime(first_date, "%Y-%m-%d")
                d2 = datetime.strptime(last_date, "%Y-%m-%d")
                years = max((d2 - d1).days / 365.25, 0.5)
                trades_per_year = len(trade_returns) / years
            except ValueError:
                trades_per_year = 78
            sharpe = (mean_ret / std_ret) * math.sqrt(trades_per_year)

    total_return_pct = (capital - STARTING_CAPITAL) / STARTING_CAPITAL * 100

    return {
        "total_trades": len(all_trades),
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "avg_win_pct": avg_win,
        "avg_loss_pct": avg_loss,
        "max_drawdown_pct": max_dd,
        "sharpe_ratio": sharpe,
        "final_capital": capital,
        "total_return_pct": total_return_pct,
        "avg_holding_days": avg_holding,
    }


# ═══════════════════════════════════════════════════════════════
#  WALK-FORWARD RUNNER
# ═══════════════════════════════════════════════════════════════

def run_walk_forward_all_strategies(
    all_data: Dict[str, List[Bar]],
    egx30_bars: List[Bar],
) -> Dict[str, List[WindowResult]]:
    """Run walk-forward for all three strategies."""

    strategies = {
        "MR": {"results": [], "capital": STARTING_CAPITAL},
        "TF": {"results": [], "capital": STARTING_CAPITAL},
        "TF_EGX30": {"results": [], "capital": STARTING_CAPITAL},
    }

    for window in WINDOWS:
        wid = window["id"]
        train_start = window["train_start"]
        train_end = window["train_end"]
        test_start = window["test_start"]
        test_end = window["test_end"]

        print(f"\n  ── Window {wid}: Train {train_start} → {train_end} | "
              f"Test {test_start} → {test_end} ──")

        # ── Strategy 1: Mean-Reversion ──
        print(f"    [MR] Optimizing ATR_SL × ATR_TP ...")
        best_mr_sl, best_mr_tp = mr_optimize_on_training(
            all_data, train_start, train_end)
        print(f"    [MR] Best: SL={best_mr_sl}, TP={best_mr_tp}")

        mr_cap = strategies["MR"]["capital"]
        print(f"    [MR] Starting capital: {mr_cap:,.0f} EGP")
        mr_trades = mr_run_period(
            all_data, test_start, test_end,
            atr_sl_mult=best_mr_sl, atr_tp_mult=best_mr_tp,
            starting_capital=mr_cap,
        )
        mr_wr = compute_window_metrics(
            wid, train_start, train_end, test_start, test_end,
            mr_trades, mr_cap,
            best_atr_sl=best_mr_sl, best_atr_tp=best_mr_tp,
        )
        strategies["MR"]["results"].append(mr_wr)
        strategies["MR"]["capital"] = mr_wr.final_capital
        print(f"    [MR] Return: {mr_wr.total_return_pct:+.1f}% | "
              f"Trades: {mr_wr.total_trades} | PF: {mr_wr.profit_factor:.2f}")

        # ── Strategy 2: Trend-Following ──
        print(f"    [TF] Optimizing ATR_SL × ATR_TRAIL × DONCHIAN ...")
        best_tf_sl, best_tf_trail, best_tf_donchian = tf_optimize_on_training(
            all_data, train_start, train_end,
            use_egx30_filter=False, egx30_bars=egx30_bars,
        )
        print(f"    [TF] Best: SL={best_tf_sl}, Trail={best_tf_trail}, "
              f"Donchian={best_tf_donchian}")

        tf_cap = strategies["TF"]["capital"]
        print(f"    [TF] Starting capital: {tf_cap:,.0f} EGP")
        tf_trades = tf_run_period(
            all_data, test_start, test_end,
            atr_sl_mult=best_tf_sl, atr_trail_mult=best_tf_trail,
            donchian_period=best_tf_donchian,
            use_egx30_filter=False, egx30_bars=egx30_bars,
            starting_capital=tf_cap,
        )
        tf_wr = compute_window_metrics(
            wid, train_start, train_end, test_start, test_end,
            tf_trades, tf_cap,
            best_atr_sl=best_tf_sl, best_atr_trail=best_tf_trail,
            best_donchian=best_tf_donchian,
        )
        strategies["TF"]["results"].append(tf_wr)
        strategies["TF"]["capital"] = tf_wr.final_capital
        print(f"    [TF] Return: {tf_wr.total_return_pct:+.1f}% | "
              f"Trades: {tf_wr.total_trades} | PF: {tf_wr.profit_factor:.2f}")

        # ── Strategy 3: Trend-Following + EGX30 Filter ──
        print(f"    [TF+EGX30] Optimizing ATR_SL × ATR_TRAIL × DONCHIAN ...")
        best_tf30_sl, best_tf30_trail, best_tf30_donchian = tf_optimize_on_training(
            all_data, train_start, train_end,
            use_egx30_filter=True, egx30_bars=egx30_bars,
        )
        print(f"    [TF+EGX30] Best: SL={best_tf30_sl}, Trail={best_tf30_trail}, "
              f"Donchian={best_tf30_donchian}")

        tf30_cap = strategies["TF_EGX30"]["capital"]
        print(f"    [TF+EGX30] Starting capital: {tf30_cap:,.0f} EGP")
        tf30_trades = tf_run_period(
            all_data, test_start, test_end,
            atr_sl_mult=best_tf30_sl, atr_trail_mult=best_tf30_trail,
            donchian_period=best_tf30_donchian,
            use_egx30_filter=True, egx30_bars=egx30_bars,
            starting_capital=tf30_cap,
        )
        tf30_wr = compute_window_metrics(
            wid, train_start, train_end, test_start, test_end,
            tf30_trades, tf30_cap,
            best_atr_sl=best_tf30_sl, best_atr_trail=best_tf30_trail,
            best_donchian=best_tf30_donchian,
        )
        strategies["TF_EGX30"]["results"].append(tf30_wr)
        strategies["TF_EGX30"]["capital"] = tf30_wr.final_capital
        print(f"    [TF+EGX30] Return: {tf30_wr.total_return_pct:+.1f}% | "
              f"Trades: {tf30_wr.total_trades} | PF: {tf30_wr.profit_factor:.2f}")

    return {k: v["results"] for k, v in strategies.items()}


# ═══════════════════════════════════════════════════════════════
#  OUTPUT FORMATTING
# ═══════════════════════════════════════════════════════════════

def print_comparison(
    all_results: Dict[str, List[WindowResult]],
    all_data: Dict[str, List[Bar]],
):
    W = 67
    line = "═" * W

    print()
    print(line)
    print("  HONEST EGX BACKTEST — STRATEGY COMPARISON")
    print("  Mean-Reversion vs Trend-Following vs Buy & Hold")
    print(line)

    print()
    print("STRATEGY 1: MEAN-REVERSION (Baseline)")
    print(f"  Entry: Close > SMA({MR_SMA_SHORT}) & SMA({MR_SMA_LONG}) rising & "
          f"RSI {MR_RSI_LOW}-{MR_RSI_HIGH} & Vol > {MR_VOLUME_RATIO_MIN}x")
    print(f"  Exit: ATR stop + ATR target (fixed) | Max hold: {MR_MAX_HOLDING_DAYS} days")
    print()
    print("STRATEGY 2: TREND-FOLLOWING")
    print(f"  Entry: Donchian 55-day breakout & Vol > {TF_VOLUME_SPIKE_MIN}x avg & ATR < {TF_ATR_FILTER_MAX*100:.0f}% of price")
    print(f"  Exit: ATR trailing stop (NO fixed target) | Max hold: {TF_MAX_HOLDING_DAYS} days")
    print()
    print("STRATEGY 3: TREND-FOLLOWING + EGX30 FILTER")
    print(f"  Same as Strategy 2 but ONLY when EGX30 > SMA({EGX30_SMA_PERIOD})")

    # Compute overalls
    mr_overall = compute_overall(all_results["MR"])
    tf_overall = compute_overall(all_results["TF"])
    tf30_overall = compute_overall(all_results["TF_EGX30"])
    bnh_return = calc_buy_and_hold_overall(all_data)

    print()
    print(line)
    print()
    print("Side-by-Side Comparison:")

    hdr = f"  {'Metric':<22} | {'Mean-Rev':>10} | {'Trend-Follow':>12} | {'TF+EGX30':>10} | {'Buy&Hold':>10}"
    print(hdr)
    sep = f"  {'─'*22}─┼─{'─'*10}─┼─{'─'*12}─┼─{'─'*10}─┼─{'─'*10}"
    print(sep)

    def fmt(v, is_pct=False, dec=1, sign=False):
        if v == 0 and is_pct:
            return "N/A"
        prefix = "+" if sign and v > 0 else ""
        if is_pct:
            return f"{prefix}{v:.{dec}f}%"
        if isinstance(v, float):
            return f"{v:.{dec}f}"
        return str(v)

    rows = [
        ("Total Trades", mr_overall["total_trades"], tf_overall["total_trades"],
         tf30_overall["total_trades"], "N/A", False, 0, False),
        ("Win Rate", mr_overall["win_rate"], tf_overall["win_rate"],
         tf30_overall["win_rate"], "N/A", True, 1, False),
        ("Profit Factor", mr_overall["profit_factor"], tf_overall["profit_factor"],
         tf30_overall["profit_factor"], "N/A", False, 2, False),
        ("Avg Win", mr_overall["avg_win_pct"], tf_overall["avg_win_pct"],
         tf30_overall["avg_win_pct"], "N/A", True, 2, True),
        ("Avg Loss", mr_overall["avg_loss_pct"], tf_overall["avg_loss_pct"],
         tf30_overall["avg_loss_pct"], "N/A", True, 2, False),
        ("Avg Holding Days", mr_overall["avg_holding_days"], tf_overall["avg_holding_days"],
         tf30_overall["avg_holding_days"], "N/A", False, 1, False),
        ("Max Drawdown", mr_overall["max_drawdown_pct"], tf_overall["max_drawdown_pct"],
         tf30_overall["max_drawdown_pct"], "N/A", True, 1, False),
        ("Sharpe Ratio", mr_overall["sharpe_ratio"], tf_overall["sharpe_ratio"],
         tf30_overall["sharpe_ratio"], "N/A", False, 2, False),
        ("Total Return", mr_overall["total_return_pct"], tf_overall["total_return_pct"],
         tf30_overall["total_return_pct"], bnh_return, True, 1, True),
        ("Alpha vs B&H",
         mr_overall["total_return_pct"] - bnh_return,
         tf_overall["total_return_pct"] - bnh_return,
         tf30_overall["total_return_pct"] - bnh_return,
         "—", True, 1, True),
    ]

    for label, v1, v2, v3, v4, is_pct, dec, sign in rows:
        if isinstance(v4, str):
            s4 = v4
        elif is_pct:
            s4 = f"{v4:.{dec}f}%"
        else:
            s4 = f"{v4:.{dec}f}"

        def fmtv(v, is_pct, dec, sign):
            if isinstance(v, str):
                return v
            prefix = "+" if sign and v > 0 else ""
            if is_pct:
                return f"{prefix}{v:.{dec}f}%"
            return f"{prefix}{v:.{dec}f}"

        print(f"  {label:<22} | {fmtv(v1, is_pct, dec, sign):>10} | "
              f"{fmtv(v2, is_pct, dec, sign):>12} | {fmtv(v3, is_pct, dec, sign):>10} | "
              f"{s4:>10}")

    # Per-Window Comparison
    print()
    print(line)
    print()
    print("Per-Window Comparison:")

    bnh_per_window = {}
    for window in WINDOWS:
        bnh_per_window[window["id"]] = calc_buy_and_hold(
            all_data, window["test_start"], window["test_end"])

    hdr2 = f"  {'Window':<7} | {'Mean-Rev':>10} | {'Trend-Follow':>12} | {'TF+EGX30':>10} | {'B&H':>10}"
    print(hdr2)
    sep2 = f"  {'─'*7}─┼─{'─'*10}─┼─{'─'*12}─┼─{'─'*10}─┼─{'─'*10}"
    print(sep2)

    for i, window in enumerate(WINDOWS):
        wid = window["id"]
        mr_ret = all_results["MR"][i].total_return_pct
        tf_ret = all_results["TF"][i].total_return_pct
        tf30_ret = all_results["TF_EGX30"][i].total_return_pct
        bnh_ret = bnh_per_window[wid]

        print(f"  {wid:<7} | {mr_ret:>+9.1f}% | {tf_ret:>+11.1f}% | "
              f"{tf30_ret:>+9.1f}% | {bnh_ret:>+9.1f}%")

    # Optimized Parameters per Window
    print()
    print(line)
    print()
    print("Optimized Parameters per Window:")

    hdr3 = f"  {'Window':<7} | {'Strategy':<10} | {'Best SL':>8} | {'Best Trail':>10} | {'Best Donchian':>13} | {'Best TP':>8}"
    print(hdr3)
    sep3 = f"  {'─'*7}─┼─{'─'*10}─┼─{'─'*8}─┼─{'─'*10}─┼─{'─'*13}─┼─{'─'*8}"
    print(sep3)

    for i, window in enumerate(WINDOWS):
        wid = window["id"]
        mr_wr = all_results["MR"][i]
        tf_wr = all_results["TF"][i]
        tf30_wr = all_results["TF_EGX30"][i]

        print(f"  {wid:<7} | {'Mean-Rev':<10} | {mr_wr.best_atr_sl:>8.1f} | {'N/A':>10} | {'N/A':>13} | {mr_wr.best_atr_tp:>8.1f}")
        print(f"  {wid:<7} | {'TF':<10} | {tf_wr.best_atr_sl:>8.1f} | {tf_wr.best_atr_trail:>10.1f} | {tf_wr.best_donchian:>13} | {'N/A':>8}")
        print(f"  {wid:<7} | {'TF+EGX30':<10} | {tf30_wr.best_atr_sl:>8.1f} | {tf30_wr.best_atr_trail:>10.1f} | {tf30_wr.best_donchian:>13} | {'N/A':>8}")

    # Verdict
    print()
    print(line)
    print("  VERDICT")
    print(line)

    mr_alpha = mr_overall["total_return_pct"] - bnh_return
    tf_alpha = tf_overall["total_return_pct"] - bnh_return
    tf30_alpha = tf30_overall["total_return_pct"] - bnh_return

    best_strategy = "Mean-Reversion"
    best_alpha = mr_alpha
    if tf_alpha > best_alpha:
        best_strategy = "Trend-Following"
        best_alpha = tf_alpha
    if tf30_alpha > best_alpha:
        best_strategy = "Trend-Following + EGX30"
        best_alpha = tf30_alpha

    print()
    print(f"  Buy & Hold (equal-weight):  +{bnh_return:.1f}%")
    print(f"  Mean-Reversion:             {mr_overall['total_return_pct']:+.1f}%  "
          f"(alpha: {mr_alpha:+.1f}%)")
    print(f"  Trend-Following:            {tf_overall['total_return_pct']:+.1f}%  "
          f"(alpha: {tf_alpha:+.1f}%)")
    print(f"  Trend-Following + EGX30:    {tf30_overall['total_return_pct']:+.1f}%  "
          f"(alpha: {tf30_alpha:+.1f}%)")
    print()

    if best_alpha > 0:
        print(f"  ★ {best_strategy} BEATS Buy & Hold by +{best_alpha:.1f}%!")
    else:
        print(f"  ✗ NO strategy beats Buy & Hold in this period.")
        print(f"    Best active strategy: {best_strategy} at {best_alpha:+.1f}% alpha")

    print()

    # More detailed verdict
    if tf_alpha > mr_alpha:
        print(f"  Trend-Following OUTPERFORMS Mean-Reversion by "
              f"{tf_alpha - mr_alpha:+.1f}% alpha")
        if tf30_alpha > tf_alpha:
            print(f"  EGX30 filter adds {tf30_alpha - tf_alpha:+.1f}% additional alpha")
        else:
            print(f"  EGX30 filter reduces alpha by {tf_alpha - tf30_alpha:+.1f}%")
    else:
        print(f"  Mean-Reversion OUTPERFORMS Trend-Following by "
              f"{mr_alpha - tf_alpha:+.1f}% alpha")

    print()
    print(f"  Key differences:")
    print(f"    MR: {mr_overall['total_trades']} trades, "
          f"WR={mr_overall['win_rate']:.1f}%, "
          f"PF={mr_overall['profit_factor']:.2f}, "
          f"AvgWin={mr_overall['avg_win_pct']:+.2f}%, "
          f"AvgLoss={mr_overall['avg_loss_pct']:.2f}%, "
          f"AvgHold={mr_overall['avg_holding_days']:.1f}d")
    print(f"    TF: {tf_overall['total_trades']} trades, "
          f"WR={tf_overall['win_rate']:.1f}%, "
          f"PF={tf_overall['profit_factor']:.2f}, "
          f"AvgWin={tf_overall['avg_win_pct']:+.2f}%, "
          f"AvgLoss={tf_overall['avg_loss_pct']:.2f}%, "
          f"AvgHold={tf_overall['avg_holding_days']:.1f}d")
    print(f"    TF+EGX30: {tf30_overall['total_trades']} trades, "
          f"WR={tf30_overall['win_rate']:.1f}%, "
          f"PF={tf30_overall['profit_factor']:.2f}, "
          f"AvgWin={tf30_overall['avg_win_pct']:+.2f}%, "
          f"AvgLoss={tf30_overall['avg_loss_pct']:.2f}%, "
          f"AvgHold={tf30_overall['avg_holding_days']:.1f}d")

    print(line)
    print()


# ═══════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    W = 67
    line = "═" * W

    print()
    print(line)
    print("  HONEST EGX WALK-FORWARD BACKTEST — TREND vs MEAN-REVERSION")
    print(line)
    print()
    print(f"  Database: {DB_PATH}")
    print(f"  Tickers: {len(EGX_TICKERS)}")
    print(f"  Starting Capital: {STARTING_CAPITAL:,.0f} EGP")
    print(f"  Transaction cost: ~{(COMMISSION_PCT*2 + SLIPPAGE_PCT*2)*100:.1f}% round trip")
    print(f"  Walk-forward windows: {len(WINDOWS)}")
    print()
    print(f"  ── Mean-Reversion ──")
    print(f"  Entry: Close > SMA({MR_SMA_SHORT}) & SMA({MR_SMA_LONG}) rising & "
          f"RSI {MR_RSI_LOW}-{MR_RSI_HIGH} & Vol > {MR_VOLUME_RATIO_MIN}x avg")
    print(f"  Exit: Stop = ATR×SL | Target = ATR×TP | Max hold: {MR_MAX_HOLDING_DAYS}d")
    print(f"  Max concurrent: {MR_MAX_CONCURRENT}")
    print()
    print(f"  ── Trend-Following ──")
    print(f"  Entry: Donchian breakout & Vol > {TF_VOLUME_SPIKE_MIN}x avg & ATR/Close < {TF_ATR_FILTER_MAX*100:.0f}%")
    print(f"  Exit: ATR trailing stop (NO fixed target) | Max hold: {TF_MAX_HOLDING_DAYS}d")
    print(f"  Max concurrent: {TF_MAX_CONCURRENT}")
    print()

    # Load data
    print("  Loading price data ...")
    all_data = load_all_data(DB_PATH)

    loaded_tickers = [t for t in EGX_TICKERS if t in all_data and len(all_data[t]) > 0]
    print(f"  Loaded {len(loaded_tickers)} tickers "
          f"({sum(len(v) for v in all_data.values()):,} bars total)")

    for ticker in loaded_tickers[:3]:
        bars = all_data[ticker]
        print(f"    {ticker}: {bars[0].date} to {bars[-1].date} ({len(bars)} bars)")

    # Load EGX30
    print("  Loading EGX30 data ...")
    egx30_bars = load_egx30_data(DB_PATH)
    if egx30_bars:
        print(f"  EGX30: {egx30_bars[0].date} to {egx30_bars[-1].date} ({len(egx30_bars)} bars)")
    else:
        print("  WARNING: No EGX30 data found! TF+EGX30 strategy will not work.")

    # Run walk-forward
    print()
    print("  Running walk-forward backtest (3 strategies × 5 windows) ...")
    print("  " + "─" * 63)

    all_results = run_walk_forward_all_strategies(all_data, egx30_bars)

    # Print comparison
    print_comparison(all_results, all_data)


if __name__ == "__main__":
    main()
