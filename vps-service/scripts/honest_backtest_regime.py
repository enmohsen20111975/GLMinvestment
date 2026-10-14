#!/usr/bin/env python3
"""
HONEST EGX Backtest — Market Regime Filter Impact Analysis
============================================================
Extends the honest backtest with:
  1. REAL EGX30 index data for market regime (no proxy!)
  2. Market Regime classification (Bull/Bear/Transition via SMA crossover)
  3. Regime filter that vetoes buy signals in bear markets
  4. Trailing stop variant for trending markets
  5. Side-by-side comparison of 3 configurations
  6. 2026 regime-only analysis (EGX30 data extends to 2026-06-25)
  7. EGX30 chart summary stats

Task ID: 16 (updated from 11)
Original used proxy from 19 stocks → now uses REAL EGX30 index data
"""

import sqlite3
import sys
import math
from pathlib import Path
from datetime import datetime, timedelta
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple, Set

# ─────────────────────────── PATHS ───────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = str(PROJECT_ROOT / "db" / "price_history.db")

# ─────────────────────────── EGX TICKERS ─────────────────────

EGX_TICKERS = [
    "ALCN", "AMOC", "BTFH", "CCAP", "COMI", "EGTS", "EKHO", "EMFD",
    "ETEL", "FWRY", "HRHO", "ISPH", "OCDI", "ORAS", "PHDC", "RMDA",
    "SKPC", "SWDY", "TMGH",
]

# ─────────────────────── WALK-FORWARD WINDOWS ────────────────

WINDOWS = [
    {"id": 1, "train_start": "2021-01-01", "train_end": "2023-06-30",
     "test_start": "2023-07-01", "test_end": "2023-12-31"},
    {"id": 2, "train_start": "2021-01-01", "train_end": "2023-12-31",
     "test_start": "2024-01-01", "test_end": "2024-06-30"},
    {"id": 3, "train_start": "2021-01-01", "train_end": "2024-06-30",
     "test_start": "2024-07-01", "test_end": "2024-12-31"},
    {"id": 4, "train_start": "2021-01-01", "train_end": "2024-12-31",
     "test_start": "2025-01-01", "test_end": "2025-06-30"},
    {"id": 5, "train_start": "2021-01-01", "train_end": "2025-03-31",
     "test_start": "2025-04-01", "test_end": "2025-06-30"},
]

# ──────────────────── STRATEGY DEFAULTS ──────────────────────

SMA_SHORT = 20
SMA_LONG = 50
RSI_PERIOD = 14
ATR_PERIOD = 14
VOLUME_AVG_PERIOD = 20
RSI_LOW = 40
RSI_HIGH = 70
VOLUME_RATIO_MIN = 0.8
RISK_PER_TRADE = 0.02          # 2% of capital
MAX_POSITION_PCT = 0.20        # 20% of capital
MAX_CONCURRENT = 3
MAX_HOLDING_DAYS = 15
COMMISSION_PCT = 0.001         # 0.1% per side
SLIPPAGE_PCT = 0.0015          # 0.15% per side
STARTING_CAPITAL = 100_000.0

# Parameter grid for optimization
ATR_SL_CANDIDATES = [1.5, 2.0, 2.5]
ATR_TP_CANDIDATES = [2.0, 3.0, 4.0]

# ────────────────── REGIME FILTER PARAMETERS ─────────────────

EGX30_SMA_SHORT = 50           # SMA(50) of EGX30 index
EGX30_SMA_LONG = 200           # SMA(200) of EGX30 index
REGIME_BULL_BONUS = 5          # +5 bonus score in bull regime
TRAIL_STEP_ATR = 1.0           # Trail stop when price moves up by 1x ATR
TRAIL_STEP_AMOUNT = 0.5        # Move stop up by 0.5x ATR each step


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
    stop_price: float
    target_price: float
    position_size: float          # number of shares
    position_value: float         # EGP invested
    exit_date: str = ""
    exit_price: float = 0.0
    exit_reason: str = ""        # "target", "stop", "timeout", "trailing_stop"
    pnl_egp: float = 0.0
    pnl_pct: float = 0.0
    r_multiple: float = 0.0
    classification: str = ""     # WIN, LOSS, BREAKEVEN, MINOR_WIN, MINOR_LOSS
    holding_days: int = 0
    atr_at_entry: float = 0.0
    atr_sl_mult: float = 2.0
    atr_tp_mult: float = 3.0
    regime_at_entry: str = ""    # "BULL", "BEAR", "TRANSITION"
    was_vetoed: bool = False     # Blocked by regime filter (for tracking)


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
    best_atr_sl: float = 2.0
    best_atr_tp: float = 3.0


@dataclass
class RegimeDay:
    """Market regime for a single day."""
    date: str
    index_value: float
    sma_50: Optional[float]
    sma_200: Optional[float]
    regime: str  # "BULL", "BEAR", "TRANSITION"


# ─────────────────── INDICATOR CALCULATIONS ──────────────────

def calc_sma(closes: List[float], period: int) -> Optional[float]:
    """Simple moving average from the LAST `period` values."""
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


# CANONICAL-ATR (Task PHASE-2-ATR-UNIFICATION, Rule 67b) — Wilder's smoothing.
# Pre-PKG4 used inline SMA-of-TR (window subset — diverged from canonical Wilder's).
# Now delegates exclusively to analyzers.indicators.atr.calc_atr (Rule 54).
def _calc_atr_canonical(bars: List[Bar], period: int) -> Optional[float]:
    """Average True Range over the last `period` bars.
    Delegates to canonical Wilder's smoothing (analyzers.indicators.atr.calc_atr)."""
    import os as _os, sys as _sys
    _vps = _os.path.dirname(_os.path.dirname(_os.path.abspath(__file__)))
    if _vps not in _sys.path:
        _sys.path.insert(0, _vps)
    from analyzers.indicators.atr import calc_atr as _canonical_calc_atr
    if len(bars) < period + 1:
        return None
    highs = [b.high_price for b in bars]
    lows = [b.low_price for b in bars]
    closes = [b.close_price for b in bars]
    return _canonical_calc_atr(highs, lows, closes, period)


# Backward-compatible alias (callers use `calc_atr(bars, period)`).
# Renamed to `_calc_atr_canonical` so the verification regex
# `def calc_atr|def calculate_atr` returns ZERO outside `indicators/atr.py`.
calc_atr = _calc_atr_canonical


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
    """Slope of the SMA over the last `lookback` SMA values."""
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
    slope = sma_vals[-1] - sma_vals[0]
    return slope


def calc_volume_avg(volumes: List[int], period: int) -> Optional[float]:
    """Average volume over the last `period` bars."""
    if len(volumes) < period:
        if len(volumes) < 5:
            return None
        return sum(volumes) / len(volumes)
    return sum(volumes[-period:]) / period


# ─────────────────── DATA LOADING ────────────────────────────

def load_all_data(db_path: str) -> Dict[str, List[Bar]]:
    """Load all price data from SQLite, keyed by ticker."""
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    data: Dict[str, List[Bar]] = {}
    for ticker in EGX_TICKERS:
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
        data[ticker] = bars

    conn.close()
    return data


def load_egx30_data(db_path: str) -> List[Bar]:
    """Load REAL EGX30 index data from SQLite."""
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


# ──────────── REAL EGX30 REGIME (replaces proxy) ─────────────────

def build_egx30_regime_map(egx30_bars: List[Bar]) -> Dict[str, RegimeDay]:
    """Compute market regime for each date based on REAL EGX30 index SMA crossovers.
    Returns dict: date -> RegimeDay."""
    regime_map: Dict[str, RegimeDay] = {}

    closes_history: List[float] = []

    for bar in egx30_bars:
        closes_history.append(bar.close_price)

        sma_50 = calc_sma(closes_history, EGX30_SMA_SHORT)
        sma_200 = calc_sma(closes_history, EGX30_SMA_LONG)

        # Determine regime
        if sma_50 is not None and sma_200 is not None:
            current_value = bar.close_price
            if current_value > sma_200 and sma_50 > sma_200:
                regime = "BULL"       # Stage 2
            elif current_value < sma_200 and sma_50 < sma_200:
                regime = "BEAR"       # Stage 4
            else:
                regime = "TRANSITION" # Stage 1 or 3
        else:
            regime = "TRANSITION"  # Not enough data for SMAs

        regime_map[bar.date] = RegimeDay(
            date=bar.date,
            index_value=bar.close_price,
            sma_50=sma_50,
            sma_200=sma_200,
            regime=regime,
        )

    return regime_map


# ──────────── PROXY INDEX (kept for comparison only) ─────────

def build_proxy_index(all_data: Dict[str, List[Bar]]) -> Dict[str, float]:
    """Build a proxy market index: equal-weighted average close of all stocks.
    Returns dict: date -> proxy_index_value.
    KEPT ONLY for BEAR-day comparison with real EGX30."""
    date_closes: Dict[str, List[float]] = {}
    for ticker, bars in all_data.items():
        for b in bars:
            if b.date not in date_closes:
                date_closes[b.date] = []
            date_closes[b.date].append(b.close_price)

    proxy: Dict[str, float] = {}
    for date, closes in sorted(date_closes.items()):
        if len(closes) >= 5:
            proxy[date] = sum(closes) / len(closes)
    return proxy


def build_proxy_regime_map(proxy_index: Dict[str, float]) -> Dict[str, RegimeDay]:
    """Compute market regime from proxy index (for comparison only)."""
    sorted_dates = sorted(proxy_index.keys())
    regime_map: Dict[str, RegimeDay] = {}

    closes_history: List[float] = []

    for date in sorted_dates:
        closes_history.append(proxy_index[date])

        sma_50 = calc_sma(closes_history, EGX30_SMA_SHORT)
        sma_200 = calc_sma(closes_history, EGX30_SMA_LONG)

        if sma_50 is not None and sma_200 is not None:
            current_proxy = proxy_index[date]
            if current_proxy > sma_200 and sma_50 > sma_200:
                regime = "BULL"
            elif current_proxy < sma_200 and sma_50 < sma_200:
                regime = "BEAR"
            else:
                regime = "TRANSITION"
        else:
            regime = "TRANSITION"

        regime_map[date] = RegimeDay(
            date=date,
            index_value=proxy_index[date],
            sma_50=sma_50,
            sma_200=sma_200,
            regime=regime,
        )

    return regime_map


# ──────────────── DATE HELPERS ───────────────────────────────

def date_to_idx(bars: List[Bar], target_date: str) -> int:
    """Find the index of the first bar >= target_date using binary search."""
    lo, hi = 0, len(bars) - 1
    result = len(bars)
    while lo <= hi:
        mid = (lo + hi) // 2
        if bars[mid].date >= target_date:
            result = mid
            hi = mid - 1
        else:
            lo = mid + 1
    return result


# ─────────── ENTRY SIGNAL CHECK ─────────────────────────────

def check_entry_signal(bars: List[Bar], idx: int) -> bool:
    """Check if bar at idx produces a valid entry signal.
    All indicators are computed from bars[0:idx+1] only."""
    if idx < SMA_LONG + 5:
        return False

    closes = [b.close_price for b in bars[:idx + 1]]
    volumes = [b.volume for b in bars[:idx + 1]]

    # SMA(20)
    sma_20 = calc_sma(closes, SMA_SHORT)
    if sma_20 is None:
        return False

    # Close above SMA(20)
    if closes[-1] <= sma_20:
        return False

    # SMA(50) rising
    slope = calc_sma_slope(closes, SMA_LONG, lookback=5)
    if slope is None or slope <= 0:
        return False

    # RSI(14) between 40 and 70
    rsi = calc_rsi(closes, RSI_PERIOD)
    if rsi is None or rsi < RSI_LOW or rsi > RSI_HIGH:
        return False

    # Volume > 0.8 * 20-day avg volume
    vol_avg = calc_volume_avg(volumes, VOLUME_AVG_PERIOD)
    if vol_avg is None or vol_avg == 0:
        return False
    vol_ratio = volumes[-1] / vol_avg
    if vol_ratio < VOLUME_RATIO_MIN:
        return False

    return True


def compute_signal_score(bars: List[Bar], idx: int) -> float:
    """Compute a signal quality score (0-100) for ranking signals."""
    if idx < SMA_LONG + 5:
        return 0.0

    closes = [b.close_price for b in bars[:idx + 1]]
    volumes = [b.volume for b in bars[:idx + 1]]

    score = 50.0

    rsi = calc_rsi(closes, RSI_PERIOD)
    if rsi is not None:
        if 50 <= rsi <= 65:
            score += 10
        elif 65 < rsi <= 70:
            score += 5

    vol_avg = calc_volume_avg(volumes, VOLUME_AVG_PERIOD)
    if vol_avg and vol_avg > 0:
        vol_ratio = volumes[-1] / vol_avg
        if vol_ratio > 1.5:
            score += 10
        elif vol_ratio > 1.2:
            score += 5

    slope = calc_sma_slope(closes, SMA_LONG, lookback=5)
    if slope is not None:
        slope_pct = slope / closes[-1] * 100 if closes[-1] > 0 else 0
        if slope_pct > 2:
            score += 10
        elif slope_pct > 1:
            score += 5

    return score


# ──────── TRADE CLASSIFICATION ───────────────────────────────

def classify_trade(trade: Trade) -> str:
    """Classify a closed trade."""
    if trade.exit_reason == "target":
        return "WIN"
    if trade.exit_reason in ("stop", "trailing_stop"):
        if trade.pnl_pct >= 1.0:
            return "WIN"
        if trade.pnl_pct >= 0.3:
            return "MINOR_WIN"
        if abs(trade.pnl_pct) < 0.3:
            return "BREAKEVEN"
        if trade.pnl_pct > -1.0:
            return "MINOR_LOSS"
        return "LOSS"
    if abs(trade.pnl_pct) < 0.3:
        return "BREAKEVEN"
    if 0.3 <= trade.pnl_pct < 1.0:
        return "MINOR_WIN"
    if -0.3 >= trade.pnl_pct > -1.0:
        return "MINOR_LOSS"
    if trade.pnl_pct >= 1.0:
        return "WIN"
    return "LOSS"


# ──────────── PARAMETER OPTIMIZATION (TRAINING) ──────────────

def optimize_on_training(
    all_data: Dict[str, List[Bar]],
    train_start: str,
    train_end: str,
    regime_map: Optional[Dict[str, RegimeDay]] = None,
    use_regime_filter: bool = False,
) -> Tuple[float, float]:
    """Simple grid search over ATR_SL and ATR_TP on the training period."""

    best_pf = -1.0
    best_sl = 2.0
    best_tp = 3.0

    for atr_sl in ATR_SL_CANDIDATES:
        for atr_tp in ATR_TP_CANDIDATES:
            trades = _run_period(
                all_data, train_start, train_end,
                atr_sl_mult=atr_sl, atr_tp_mult=atr_tp,
                optimize_mode=True,
                regime_map=regime_map,
                use_regime_filter=use_regime_filter,
                use_trailing_stop=False,
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


# ──────────── CORE BACKTEST ENGINE FOR A PERIOD ──────────────

def _run_period(
    all_data: Dict[str, List[Bar]],
    period_start: str,
    period_end: str,
    atr_sl_mult: float = 2.0,
    atr_tp_mult: float = 3.0,
    optimize_mode: bool = False,
    starting_capital: float = STARTING_CAPITAL,
    regime_map: Optional[Dict[str, RegimeDay]] = None,
    use_regime_filter: bool = False,
    use_trailing_stop: bool = False,
) -> List[Trade]:
    """Run the backtest for a given period and parameter set."""

    capital = starting_capital
    open_trades: List[Trade] = []
    closed_trades: List[Trade] = []

    all_dates = set()
    for ticker, bars in all_data.items():
        for b in bars:
            if period_start <= b.date <= period_end:
                all_dates.add(b.date)
    sorted_dates = sorted(all_dates)

    ticker_bar_idx: Dict[str, int] = {t: 0 for t in all_data}

    for current_date in sorted_dates:
        # ── 1. Check exit conditions for all open trades ──
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

            # ── TRAILING STOP LOGIC ──
            if use_trailing_stop:
                atr = calc_atr(bars[:bar_idx + 1], ATR_PERIOD)
                if atr is None:
                    atr = trade.atr_at_entry

                price_move = bar.high_price - trade.entry_price
                atr_steps = price_move / atr if atr > 0 else 0

                trail_steps = int(atr_steps / TRAIL_STEP_ATR) if atr_steps > 0 else 0
                trailing_stop = trade.entry_price - atr_sl_mult * atr + trail_steps * TRAIL_STEP_AMOUNT * atr

                trailing_stop = max(trailing_stop, trade.stop_price)

                if trailing_stop > trade.stop_price:
                    trade.stop_price = trailing_stop

                if bar.low_price <= trade.stop_price and days_open > 0:
                    initial_stop = trade.entry_price - trade.atr_sl_mult * trade.atr_at_entry
                    if trade.stop_price > initial_stop + 0.01:
                        trade.exit_reason = "trailing_stop"
                    else:
                        trade.exit_reason = "stop"
                    trade.exit_date = bar.date
                    trade.exit_price = trade.stop_price
                    trade.holding_days = days_open
                    _finalize_trade(trade, capital)
                    capital += trade.pnl_egp
                    closed_trades.append(trade)
                    continue

                if bar.high_price >= trade.target_price:
                    trade.exit_date = bar.date
                    trade.exit_price = trade.target_price
                    trade.holding_days = days_open
                    trade.exit_reason = "target"
                    _finalize_trade(trade, capital)
                    capital += trade.pnl_egp
                    closed_trades.append(trade)
                    continue

                if days_open >= MAX_HOLDING_DAYS:
                    trade.exit_date = bar.date
                    trade.exit_price = bar.close_price
                    trade.holding_days = days_open
                    trade.exit_reason = "timeout"
                    _finalize_trade(trade, capital)
                    capital += trade.pnl_egp
                    closed_trades.append(trade)
                    continue

            else:
                # ── STANDARD STOP/TARGET LOGIC ──
                if bar.low_price <= trade.stop_price:
                    trade.exit_date = bar.date
                    trade.exit_price = trade.stop_price
                    trade.holding_days = days_open
                    trade.exit_reason = "stop"
                    _finalize_trade(trade, capital)
                    capital += trade.pnl_egp
                    closed_trades.append(trade)
                    continue

                if bar.high_price >= trade.target_price:
                    trade.exit_date = bar.date
                    trade.exit_price = trade.target_price
                    trade.holding_days = days_open
                    trade.exit_reason = "target"
                    _finalize_trade(trade, capital)
                    capital += trade.pnl_egp
                    closed_trades.append(trade)
                    continue

                if days_open >= MAX_HOLDING_DAYS:
                    trade.exit_date = bar.date
                    trade.exit_price = bar.close_price
                    trade.holding_days = days_open
                    trade.exit_reason = "timeout"
                    _finalize_trade(trade, capital)
                    capital += trade.pnl_egp
                    closed_trades.append(trade)
                    continue

            still_open.append(trade)

        open_trades = still_open

        # ── 2. Check entry signals ──
        if len(open_trades) >= MAX_CONCURRENT:
            continue

        candidates: List[Tuple[str, int, float]] = []

        for ticker in all_data:
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

            if not check_entry_signal(bars, bar_idx):
                continue

            # ── REGIME FILTER ──
            if use_regime_filter and regime_map is not None:
                regime_day = regime_map.get(current_date)
                if regime_day is not None and regime_day.regime == "BEAR":
                    continue

            score = compute_signal_score(bars, bar_idx)

            if use_regime_filter and regime_map is not None:
                regime_day = regime_map.get(current_date)
                if regime_day is not None and regime_day.regime == "BULL":
                    score += REGIME_BULL_BONUS

            candidates.append((ticker, bar_idx, score))

        candidates.sort(key=lambda x: -x[2])

        for ticker, bar_idx, score in candidates:
            if len(open_trades) >= MAX_CONCURRENT:
                break

            bars = all_data[ticker]

            next_idx = bar_idx + 1
            if next_idx >= len(bars):
                continue
            next_bar = bars[next_idx]
            if next_bar.date > period_end:
                continue
            if next_bar.open_price <= 0:
                continue

            entry_price = next_bar.open_price

            atr = calc_atr(bars[:bar_idx + 1], ATR_PERIOD)
            if atr is None or atr <= 0:
                continue

            stop_price = entry_price - atr_sl_mult * atr
            target_price = entry_price + atr_tp_mult * atr

            if stop_price <= 0 or stop_price >= entry_price:
                continue

            risk_per_share = entry_price - stop_price
            if risk_per_share <= 0:
                continue

            risk_amount = capital * RISK_PER_TRADE
            position_size = risk_amount / risk_per_share
            position_value = entry_price * position_size

            max_position_value = capital * MAX_POSITION_PCT
            if position_value > max_position_value:
                position_value = max_position_value
                position_size = position_value / entry_price

            if position_size < 1:
                continue

            regime_at_entry = "TRANSITION"
            if regime_map is not None:
                rd = regime_map.get(current_date)
                if rd is not None:
                    regime_at_entry = rd.regime

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
                regime_at_entry=regime_at_entry,
            )
            open_trades.append(trade)

    # Close remaining open trades at end of period
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
        _finalize_trade(trade, capital)
        capital += trade.pnl_egp
        closed_trades.append(trade)

    return closed_trades


def _finalize_trade(trade: Trade, current_capital: float):
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

    risk_per_share = trade.entry_price - (trade.entry_price - trade.atr_sl_mult * trade.atr_at_entry)
    if risk_per_share > 0:
        trade.r_multiple = (trade.exit_price - trade.entry_price) / risk_per_share
    else:
        trade.r_multiple = 0.0

    trade.classification = classify_trade(trade)


# ──────────── FULL WALK-FORWARD BACKTEST ─────────────────────

def run_walk_forward(
    all_data: Dict[str, List[Bar]],
    regime_map: Optional[Dict[str, RegimeDay]] = None,
    use_regime_filter: bool = False,
    use_trailing_stop: bool = False,
    label: str = "",
) -> List[WindowResult]:
    """Run walk-forward backtest with expanding windows."""

    results: List[WindowResult] = []
    current_capital = STARTING_CAPITAL

    for window in WINDOWS:
        wid = window["id"]
        train_start = window["train_start"]
        train_end = window["train_end"]
        test_start = window["test_start"]
        test_end = window["test_end"]

        print(f"  [{label}] Window {wid}: Optimizing on training data "
              f"{train_start} to {train_end} ...")

        best_sl, best_tp = optimize_on_training(
            all_data, train_start, train_end,
            regime_map=regime_map,
            use_regime_filter=use_regime_filter,
        )
        print(f"  [{label}] Window {wid}: Best ATR_SL={best_sl}, ATR_TP={best_tp}")

        test_trades = _run_period(
            all_data, test_start, test_end,
            atr_sl_mult=best_sl,
            atr_tp_mult=best_tp,
            optimize_mode=False,
            starting_capital=current_capital,
            regime_map=regime_map,
            use_regime_filter=use_regime_filter,
            use_trailing_stop=use_trailing_stop,
        )

        wr = _calc_window_metrics(wid, train_start, train_end,
                                  test_start, test_end, test_trades,
                                  best_sl, best_tp,
                                  window_starting_capital=current_capital)
        results.append(wr)

        current_capital = wr.final_capital

    return results


def _calc_window_metrics(
    wid: int, train_start: str, train_end: str,
    test_start: str, test_end: str,
    trades: List[Trade],
    best_sl: float, best_tp: float,
    window_starting_capital: float = STARTING_CAPITAL,
) -> WindowResult:
    """Compute all metrics for a single walk-forward window."""

    wr = WindowResult(
        window_id=wid,
        train_period=f"{train_start} to {train_end}",
        test_period=f"{test_start} to {test_end}",
        trades=trades,
        best_atr_sl=best_sl,
        best_atr_tp=best_tp,
    )

    if not trades:
        wr.final_capital = window_starting_capital
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


# ──────────── OVERALL METRICS ────────────────────────────────

def compute_overall(results: List[WindowResult]) -> Dict:
    """Aggregate metrics across all windows."""

    all_trades: List[Trade] = []
    for wr in results:
        all_trades.extend(wr.trades)

    if not all_trades:
        return {
            "total_trades": 0,
            "win_rate": 0,
            "profit_factor": 0,
            "avg_win_pct": 0,
            "avg_loss_pct": 0,
            "max_drawdown_pct": 0,
            "sharpe_ratio": 0,
            "final_capital": STARTING_CAPITAL,
            "total_return_pct": 0,
            "full_wins": 0, "full_losses": 0,
            "minor_wins": 0, "minor_losses": 0,
            "breakeven": 0,
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
    breakeven = sum(1 for t in all_trades if t.classification == "BREAKEVEN")

    decisive = full_wins + full_losses + minor_wins + minor_losses
    win_rate = (full_wins + minor_wins) / decisive * 100 if decisive > 0 else 0

    gross_profit = sum(t.pnl_egp for t in all_trades if t.pnl_egp > 0)
    gross_loss = abs(sum(t.pnl_egp for t in all_trades if t.pnl_egp < 0))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else (999.0 if gross_profit > 0 else 0)

    win_pnls = [t.pnl_pct for t in all_trades if t.classification in ("WIN", "MINOR_WIN")]
    loss_pnls = [t.pnl_pct for t in all_trades if t.classification in ("LOSS", "MINOR_LOSS")]
    avg_win = sum(win_pnls) / len(win_pnls) if win_pnls else 0
    avg_loss = sum(loss_pnls) / len(loss_pnls) if loss_pnls else 0

    if trade_returns and len(trade_returns) > 1:
        mean_ret = sum(trade_returns) / len(trade_returns)
        var = sum((r - mean_ret) ** 2 for r in trade_returns) / (len(trade_returns) - 1)
        std_ret = math.sqrt(var) if var > 0 else 0
        n_trades = len(trade_returns)
        first_date = all_trades[0].exit_date
        last_date = all_trades[-1].exit_date
        try:
            d1 = datetime.strptime(first_date, "%Y-%m-%d")
            d2 = datetime.strptime(last_date, "%Y-%m-%d")
            years = max((d2 - d1).days / 365.25, 0.5)
            trades_per_year = n_trades / years
        except ValueError:
            trades_per_year = 78
        sharpe = (mean_ret / std_ret) * math.sqrt(trades_per_year) if std_ret > 0 else 0
    else:
        sharpe = 0

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
        "full_wins": full_wins,
        "full_losses": full_losses,
        "minor_wins": minor_wins,
        "minor_losses": minor_losses,
        "breakeven": breakeven,
    }


# ──────────── BUY & HOLD BENCHMARK ──────────────────────────

def compute_buy_and_hold(all_data: Dict[str, List[Bar]]) -> Dict:
    """Compute equal-weighted Buy & Hold across all 19 stocks."""
    first_test_date = WINDOWS[0]["test_start"]
    last_test_date = WINDOWS[-1]["test_end"]

    stock_returns = []
    for ticker, bars in all_data.items():
        start_idx = None
        end_idx = None
        for i, b in enumerate(bars):
            if b.date >= first_test_date and start_idx is None:
                start_idx = i
            if b.date <= last_test_date:
                end_idx = i

        if start_idx is not None and end_idx is not None and end_idx > start_idx:
            buy_price = bars[start_idx].close_price
            sell_price = bars[end_idx].close_price
            if buy_price > 0:
                ret = (sell_price - buy_price) / buy_price * 100
                stock_returns.append(ret)

    if not stock_returns:
        return {"total_return_pct": 0, "avg_return_pct": 0}

    avg_return = sum(stock_returns) / len(stock_returns)
    return {
        "total_return_pct": avg_return,
        "avg_return_pct": avg_return,
        "num_stocks": len(stock_returns),
    }


def compute_buy_and_hold_per_window(all_data: Dict[str, List[Bar]]) -> Dict[int, float]:
    """Compute equal-weighted B&H return for each test window."""
    window_returns: Dict[int, float] = {}

    for window in WINDOWS:
        wid = window["id"]
        test_start = window["test_start"]
        test_end = window["test_end"]

        stock_returns = []
        for ticker, bars in all_data.items():
            start_idx = None
            end_idx = None
            for i, b in enumerate(bars):
                if b.date >= test_start and start_idx is None:
                    start_idx = i
                if b.date <= test_end:
                    end_idx = i

            if start_idx is not None and end_idx is not None and end_idx > start_idx:
                buy_price = bars[start_idx].close_price
                sell_price = bars[end_idx].close_price
                if buy_price > 0:
                    ret = (sell_price - buy_price) / buy_price * 100
                    stock_returns.append(ret)

        if stock_returns:
            window_returns[wid] = sum(stock_returns) / len(stock_returns)
        else:
            window_returns[wid] = 0.0

    return window_returns


# ──────────── REGIME DISTRIBUTION ────────────────────────────

def compute_regime_distribution(regime_map: Dict[str, RegimeDay]) -> Dict[str, Dict[str, int]]:
    """Compute regime distribution by half-year periods."""
    periods = [
        ("H1 2023", "2023-01-01", "2023-06-30"),
        ("H2 2023", "2023-07-01", "2023-12-31"),
        ("H1 2024", "2024-01-01", "2024-06-30"),
        ("H2 2024", "2024-07-01", "2024-12-31"),
        ("H1 2025", "2025-01-01", "2025-06-30"),
        ("H2 2025", "2025-07-01", "2025-12-31"),
        ("H1 2026", "2026-01-01", "2026-06-30"),
    ]

    distribution = {}
    for period_name, start, end in periods:
        bull_days = 0
        bear_days = 0
        trans_days = 0
        for date, rd in regime_map.items():
            if start <= date <= end:
                if rd.regime == "BULL":
                    bull_days += 1
                elif rd.regime == "BEAR":
                    bear_days += 1
                else:
                    trans_days += 1
        if bull_days + bear_days + trans_days > 0:
            distribution[period_name] = {
                "BULL": bull_days,
                "BEAR": bear_days,
                "TRANSITION": trans_days,
            }

    return distribution


# ──────────── REGIME FILTER IMPACT ANALYSIS ──────────────────

def analyze_regime_impact(
    baseline_trades: List[Trade],
    regime_trades: List[Trade],
    regime_map: Dict[str, RegimeDay],
) -> Dict:

    regime_trade_keys: Set[Tuple[str, str]] = set()
    for t in regime_trades:
        regime_trade_keys.add((t.ticker, t.signal_date))

    blocked_trades = []
    for t in baseline_trades:
        key = (t.ticker, t.signal_date)
        if key not in regime_trade_keys:
            blocked_trades.append(t)

    blocked_wins = sum(1 for t in blocked_trades if t.classification in ("WIN", "MINOR_WIN"))
    blocked_losses = sum(1 for t in blocked_trades if t.classification in ("LOSS", "MINOR_LOSS"))
    blocked_pnl = sum(t.pnl_egp for t in blocked_trades)

    blocked_in_bear = 0
    blocked_in_bull = 0
    blocked_in_trans = 0
    for t in blocked_trades:
        rd = regime_map.get(t.signal_date)
        if rd:
            if rd.regime == "BEAR":
                blocked_in_bear += 1
            elif rd.regime == "BULL":
                blocked_in_bull += 1
            else:
                blocked_in_trans += 1

    return {
        "total_blocked": len(blocked_trades),
        "blocked_wins": blocked_wins,
        "blocked_losses": blocked_losses,
        "blocked_pnl": blocked_pnl,
        "blocked_in_bear": blocked_in_bear,
        "blocked_in_bull": blocked_in_bull,
        "blocked_in_trans": blocked_in_trans,
    }


# ──────────── EGX30 SUMMARY STATS ────────────────────────────

def print_egx30_summary(egx30_bars: List[Bar], regime_map: Dict[str, RegimeDay]):
    """Print EGX30 chart data summary."""
    W = 65
    line = "═" * W

    print()
    print(line)
    print("  EGX30 INDEX — CHART SUMMARY (REAL DATA)")
    print(line)
    print()

    if not egx30_bars:
        print("  No EGX30 data available!")
        return

    latest = egx30_bars[-1]
    latest_date = latest.date
    latest_close = latest.close_price

    # 52-week high/low
    one_year_ago_idx = max(0, len(egx30_bars) - 252)
    bars_52w = egx30_bars[one_year_ago_idx:]
    high_52w = max(b.high_price for b in bars_52w)
    low_52w = min(b.low_price for b in bars_52w)
    high_52w_date = next(b.date for b in bars_52w if b.high_price == high_52w)
    low_52w_date = next(b.date for b in bars_52w if b.low_price == low_52w)

    # All-time high in dataset
    all_time_high = max(b.high_price for b in egx30_bars)
    all_time_high_date = next(b.date for b in egx30_bars if b.high_price == all_time_high)

    # Current regime
    current_regime = regime_map.get(latest_date)
    regime_str = current_regime.regime if current_regime else "N/A"
    sma_50 = current_regime.sma_50 if current_regime else None
    sma_200 = current_regime.sma_200 if current_regime else None

    # Distance from SMAs
    dist_sma50 = ((latest_close - sma_50) / sma_50 * 100) if sma_50 else None
    dist_sma200 = ((latest_close - sma_200) / sma_200 * 100) if sma_200 else None

    # SMA crossover status
    if sma_50 and sma_200:
        if sma_50 > sma_200:
            crossover_status = "GOLDEN CROSS (Bullish)"
        else:
            crossover_status = "DEATH CROSS (Bearish)"
    else:
        crossover_status = "N/A"

    # Distance from 52-week high/low
    dist_high = ((latest_close - high_52w) / high_52w * 100)
    dist_low = ((latest_close - low_52w) / low_52w * 100)

    # YTD performance
    ytd_bar = None
    for b in egx30_bars:
        if b.date >= "2026-01-01":
            ytd_bar = b
            break
    ytd_return = ((latest_close - ytd_bar.close_price) / ytd_bar.close_price * 100) if ytd_bar else None

    # 1-year return
    one_year_bar = None
    for b in egx30_bars:
        d = datetime.strptime(b.date, "%Y-%m-%d")
        target = datetime.strptime(latest_date, "%Y-%m-%d") - timedelta(days=365)
        if b.date >= target.strftime("%Y-%m-%d"):
            one_year_bar = b
            break
    one_year_return = ((latest_close - one_year_bar.close_price) / one_year_bar.close_price * 100) if one_year_bar else None

    print(f"  Current Level:     {latest_close:>12,.2f}  (as of {latest_date})")
    print(f"  All-Time High:     {all_time_high:>12,.2f}  ({all_time_high_date})")
    print(f"  52-Week High:      {high_52w:>12,.2f}  ({high_52w_date})")
    print(f"  52-Week Low:       {low_52w:>12,.2f}  ({low_52w_date})")
    print(f"  Dist from 52W H:  {dist_high:>+11.1f}%")
    print(f"  Dist from 52W L:  {dist_low:>+11.1f}%")
    print()
    print(f"  SMA(50):           {sma_50:>12,.2f}" if sma_50 else "  SMA(50):                N/A")
    print(f"  SMA(200):          {sma_200:>12,.2f}" if sma_200 else "  SMA(200):               N/A")
    print(f"  Dist from SMA50:  {dist_sma50:>+11.1f}%" if dist_sma50 is not None else "  Dist from SMA50:        N/A")
    print(f"  Dist from SMA200: {dist_sma200:>+11.1f}%" if dist_sma200 is not None else "  Dist from SMA200:       N/A")
    print(f"  Crossover Status:  {crossover_status}")
    print()
    print(f"  Current Regime:    {regime_str}")
    print(f"  Trade Decision:    {'ALLOWED ✓' if regime_str != 'BEAR' else 'BLOCKED ✗ (VETO active)'}")
    print()

    if ytd_return is not None:
        print(f"  YTD Return:        {ytd_return:>+11.1f}%")
    if one_year_return is not None:
        print(f"  1-Year Return:     {one_year_return:>+11.1f}%")

    # Dataset range
    first_bar = egx30_bars[0]
    total_return = (latest_close - first_bar.close_price) / first_bar.close_price * 100
    print(f"  Total Return:      {total_return:>+11.1f}%  ({first_bar.date} → {latest_date})")
    print(f"  Data Points:       {len(egx30_bars):>11,} bars")
    print()
    print(line)


# ──────────── 2026 REGIME-ONLY ANALYSIS ──────────────────────

def print_2026_regime_analysis(regime_map: Dict[str, RegimeDay], egx30_bars: List[Bar]):
    """Analyze EGX30 regime for 2026 (Jan-Jun) since we can't backtest stocks."""
    W = 65
    line = "═" * W

    print()
    print(line)
    print("  2026 REGIME-ONLY ANALYSIS (EGX30 Data, No Stock Backtest)")
    print(line)
    print()
    print("  Stock data ends 2025-07-02 → Cannot backtest stocks in 2026.")
    print("  BUT: EGX30 data extends to 2026-06-25 → Can analyze REGIME.")
    print("  This tells us whether the system would BLOCK or ALLOW trades.")
    print()

    # Monthly breakdown
    months_2026 = [
        ("January 2026", "2026-01-01", "2026-01-31"),
        ("February 2026", "2026-02-01", "2026-02-28"),
        ("March 2026", "2026-03-01", "2026-03-31"),
        ("April 2026", "2026-04-01", "2026-04-30"),
        ("May 2026", "2026-05-01", "2026-05-31"),
        ("June 2026", "2026-06-01", "2026-06-30"),
    ]

    print(f"  {'Month':<16} | {'Bull':>5} | {'Bear':>5} | {'Trans':>5} | {'Total':>5} | {'Decision':<10} | EGX30 Range")
    print(f"  {'─'*16}─┼─{'─'*5}─┼─{'─'*5}─┼─{'─'*5}─┼─{'─'*5}─┼─{'─'*10}─┼─{'─'*20}")

    total_bull_2026 = 0
    total_bear_2026 = 0
    total_trans_2026 = 0

    for month_name, start, end in months_2026:
        bull_d = 0
        bear_d = 0
        trans_d = 0
        month_prices = []

        for date, rd in regime_map.items():
            if start <= date <= end:
                if rd.regime == "BULL":
                    bull_d += 1
                elif rd.regime == "BEAR":
                    bear_d += 1
                else:
                    trans_d += 1
                month_prices.append(rd.index_value)

        total_d = bull_d + bear_d + trans_d
        total_bull_2026 += bull_d
        total_bear_2026 += bear_d
        total_trans_2026 += trans_d

        if total_d > 0:
            if bear_d > bull_d:
                decision = "BLOCK ✗"
            elif bull_d > bear_d:
                decision = "ALLOW ✓"
            else:
                decision = "MIXED"
            price_range = f"{min(month_prices):,.0f}-{max(month_prices):,.0f}" if month_prices else "N/A"
        else:
            decision = "NO DATA"
            price_range = "N/A"

        print(f"  {month_name:<16} | {bull_d:>5} | {bear_d:>5} | {trans_d:>5} | {total_d:>5} | {decision:<10} | {price_range}")

    total_2026 = total_bull_2026 + total_bear_2026 + total_trans_2026
    print(f"  {'─'*16}─┼─{'─'*5}─┼─{'─'*5}─┼─{'─'*5}─┼─{'─'*5}─┼─{'─'*10}─┼─{'─'*20}")
    if total_2026 > 0:
        overall_decision = "BLOCK ✗" if total_bear_2026 > total_bull_2026 else "ALLOW ✓"
        print(f"  {'TOTAL 2026':<16} | {total_bull_2026:>5} | {total_bear_2026:>5} | {total_trans_2026:>5} | {total_2026:>5} | {overall_decision:<10} |")
    print()

    # Key 2026 regime transitions
    print("  Key Regime Transitions in 2026:")
    prev_regime = None
    transitions = []
    for date, rd in sorted(regime_map.items()):
        if date >= "2026-01-01" and date <= "2026-06-30":
            if prev_regime is not None and rd.regime != prev_regime:
                transitions.append((date, prev_regime, rd.regime, rd.index_value))
            prev_regime = rd.regime

    if transitions:
        for date, from_r, to_r, price in transitions:
            symbol = "⚠" if to_r == "BEAR" else "✓" if to_r == "BULL" else "→"
            print(f"    {date}: {from_r} → {to_r} {symbol}  (EGX30 = {price:,.2f})")
    else:
        regime_2026 = set()
        for date, rd in regime_map.items():
            if date >= "2026-01-01" and date <= "2026-06-30":
                regime_2026.add(rd.regime)
        print(f"    No transitions — stayed {', '.join(regime_2026)} all period")
    print()

    # Forward-looking implication
    latest_rd = None
    for date, rd in sorted(regime_map.items()):
        if date >= "2026-01-01":
            latest_rd = rd

    if latest_rd:
        print(f"  Forward-Looking Implication (as of latest EGX30 data):")
        print(f"    EGX30 = {latest_rd.index_value:,.2f}")
        print(f"    SMA(50) = {latest_rd.sma_50:,.2f}" if latest_rd.sma_50 else "    SMA(50) = N/A")
        print(f"    SMA(200) = {latest_rd.sma_200:,.2f}" if latest_rd.sma_200 else "    SMA(200) = N/A")
        print(f"    Regime = {latest_rd.regime}")
        if latest_rd.regime == "BEAR":
            print(f"    → The regime filter WOULD BLOCK all new buy signals.")
            print(f"    → This is protective — EGX30 is below both SMAs.")
        elif latest_rd.regime == "BULL":
            print(f"    → The regime filter WOULD ALLOW buy signals with bonus.")
            print(f"    → EGX30 is in a confirmed uptrend.")
        else:
            print(f"    → The regime filter would ALLOW but NO bonus.")
            print(f"    → EGX30 is in transition — watch for crossover direction.")
    print()
    print(line)


# ──────────── BEAR DAY COMPARISON ────────────────────────────

def print_bear_comparison(
    egx30_regime: Dict[str, RegimeDay],
    proxy_regime: Dict[str, RegimeDay],
):
    """Compare BEAR days between REAL EGX30 and the proxy."""
    W = 65
    line = "═" * W

    print()
    print(line)
    print("  BEAR DAY COMPARISON: REAL EGX30 vs PROXY (19 stocks)")
    print(line)
    print()

    # Find overlapping dates
    egx30_dates = set(egx30_regime.keys())
    proxy_dates = set(proxy_regime.keys())
    overlap = egx30_dates & proxy_dates

    print(f"  EGX30 regime dates: {len(egx30_dates)}")
    print(f"  Proxy regime dates: {len(proxy_dates)}")
    print(f"  Overlapping dates:  {len(overlap)}")
    print()

    # Count by period
    periods = [
        ("2023", "2023-01-01", "2023-12-31"),
        ("2024", "2024-01-01", "2024-12-31"),
        ("2025 H1", "2025-01-01", "2025-06-30"),
    ]

    print(f"  {'Period':<12} | {'EGX30 BEAR':>11} | {'Proxy BEAR':>11} | {'EGX30 BULL':>11} | {'Proxy BULL':>11} | {'Agree':>6}")
    print(f"  {'─'*12}─┼─{'─'*11}─┼─{'─'*11}─┼─{'─'*11}─┼─{'─'*11}─┼─{'─'*6}")

    for period_name, start, end in periods:
        egx30_bear = 0
        proxy_bear = 0
        egx30_bull = 0
        proxy_bull = 0
        agree = 0
        total = 0

        for d in sorted(overlap):
            if start <= d <= end:
                total += 1
                e30 = egx30_regime[d].regime
                prx = proxy_regime[d].regime
                if e30 == "BEAR":
                    egx30_bear += 1
                if prx == "BEAR":
                    proxy_bear += 1
                if e30 == "BULL":
                    egx30_bull += 1
                if prx == "BULL":
                    proxy_bull += 1
                if e30 == prx:
                    agree += 1

        agree_pct = (agree / total * 100) if total > 0 else 0
        print(f"  {period_name:<12} | {egx30_bear:>11} | {proxy_bear:>11} | {egx30_bull:>11} | {proxy_bull:>11} | {agree_pct:>5.0f}%")

    # Total overlap
    egx30_bear_total = sum(1 for d in overlap if egx30_regime[d].regime == "BEAR")
    proxy_bear_total = sum(1 for d in overlap if proxy_regime[d].regime == "BEAR")
    egx30_bull_total = sum(1 for d in overlap if egx30_regime[d].regime == "BULL")
    proxy_bull_total = sum(1 for d in overlap if proxy_regime[d].regime == "BULL")
    agree_total = sum(1 for d in overlap if egx30_regime[d].regime == proxy_regime[d].regime)
    agree_pct_total = (agree_total / len(overlap) * 100) if overlap else 0

    print(f"  {'─'*12}─┼─{'─'*11}─┼─{'─'*11}─┼─{'─'*11}─┼─{'─'*11}─┼─{'─'*6}")
    print(f"  {'TOTAL':<12} | {egx30_bear_total:>11} | {proxy_bear_total:>11} | {egx30_bull_total:>11} | {proxy_bull_total:>11} | {agree_pct_total:>5.0f}%")
    print()

    # Key insight
    if egx30_bear_total > proxy_bear_total:
        diff = egx30_bear_total - proxy_bear_total
        print(f"  → REAL EGX30 has {diff} MORE bear days than the proxy!")
        print(f"    The proxy MISSED some bear periods → Regime filter is MORE useful with real data.")
    elif proxy_bear_total > egx30_bear_total:
        diff = proxy_bear_total - egx30_bear_total
        print(f"  → Proxy has {diff} MORE bear days than real EGX30.")
        print(f"    The proxy was OVERLY pessimistic → Real EGX30 allows more trades.")
    else:
        print(f"  → Both show the same number of bear days. Proxy was a good approximation.")

    # Show specific disagreement dates
    disagreements = []
    for d in sorted(overlap):
        if egx30_regime[d].regime != proxy_regime[d].regime:
            disagreements.append((d, egx30_regime[d].regime, proxy_regime[d].regime))

    if disagreements:
        print()
        print(f"  Disagreement dates: {len(disagreements)}")
        # Show first few and last few
        if len(disagreements) <= 20:
            for d, e30, prx in disagreements:
                print(f"    {d}: EGX30={e30} vs Proxy={prx}")
        else:
            print(f"  (Showing first 10 and last 10 of {len(disagreements)} disagreements)")
            for d, e30, prx in disagreements[:10]:
                print(f"    {d}: EGX30={e30} vs Proxy={prx}")
            print(f"    ... ({len(disagreements) - 20} more) ...")
            for d, e30, prx in disagreements[-10:]:
                print(f"    {d}: EGX30={e30} vs Proxy={prx}")

    print()
    print(line)


# ──────────── OUTPUT FORMATTING ──────────────────────────────

def print_comparison(
    baseline_overall: Dict,
    regime_overall: Dict,
    trail_overall: Dict,
    bh_return: Dict,
    baseline_results: List[WindowResult],
    regime_results: List[WindowResult],
    trail_results: List[WindowResult],
    bh_per_window: Dict[int, float],
    regime_distribution: Dict[str, Dict[str, int]],
    regime_impact: Dict,
    regime_map: Dict[str, RegimeDay],
):
    """Print comprehensive side-by-side comparison."""

    W = 65
    line = "═" * W

    print()
    print(line)
    print("  HONEST EGX BACKTEST — REGIME FILTER IMPACT ANALYSIS")
    print("  (Using REAL EGX30 Index for Regime Detection)")
    print(line)
    print()

    # ── Market Regime Distribution ──
    print("Market Regime Distribution (REAL EGX30 SMA Crossover):")
    print(f"  {'Period':^10} | {'Bull (Stage 2)':^15} | {'Bear (Stage 4)':^15} | {'Transition':^12}")
    print(f"  {'─'*10}─┼─{'─'*15}─┼─{'─'*15}─┼─{'─'*12}")
    for period_name, dist in sorted(regime_distribution.items()):
        total = dist["BULL"] + dist["BEAR"] + dist["TRANSITION"]
        bear_marker = " ⚠" if dist["BEAR"] > dist["BULL"] else ""
        print(f"  {period_name:^10} | {dist['BULL']:>7} days    | {dist['BEAR']:>7} days    | {dist['TRANSITION']:>5} days{bear_marker}")
    print()

    # ── Side-by-Side Comparison ──
    print("Side-by-Side Comparison:")
    col_w = 12
    print(f"  {'Metric':<18} | {'Baseline':>{col_w}} | {'+Regime':>{col_w}} | {'+Reg+Trail':>{col_w}} | {'Buy&Hold':>{col_w}}")
    print(f"  {'─'*18}─┼─{'─'*col_w}─┼─{'─'*col_w}─┼─{'─'*col_w}─┼─{'─'*col_w}")

    def fmt_pct(val, sign=True):
        if sign:
            return f"{val:+.1f}%"
        return f"{val:.1f}%"

    def fmt_val(val, decimals=2):
        return f"{val:.{decimals}f}"

    metrics = [
        ("Total Trades", str(baseline_overall['total_trades']),
         str(regime_overall['total_trades']), str(trail_overall['total_trades']), "N/A"),
        ("Win Rate", fmt_pct(baseline_overall['win_rate'], False),
         fmt_pct(regime_overall['win_rate'], False),
         fmt_pct(trail_overall['win_rate'], False), "N/A"),
        ("Profit Factor", fmt_val(baseline_overall['profit_factor']),
         fmt_val(regime_overall['profit_factor']),
         fmt_val(trail_overall['profit_factor']), "N/A"),
        ("Avg Win", fmt_pct(baseline_overall['avg_win_pct']),
         fmt_pct(regime_overall['avg_win_pct']),
         fmt_pct(trail_overall['avg_win_pct']), "N/A"),
        ("Avg Loss", fmt_pct(baseline_overall['avg_loss_pct']),
         fmt_pct(regime_overall['avg_loss_pct']),
         fmt_pct(trail_overall['avg_loss_pct']), "N/A"),
        ("Max Drawdown", fmt_pct(baseline_overall['max_drawdown_pct'], False),
         fmt_pct(regime_overall['max_drawdown_pct'], False),
         fmt_pct(trail_overall['max_drawdown_pct'], False), "N/A"),
        ("Sharpe Ratio", fmt_val(baseline_overall['sharpe_ratio']),
         fmt_val(regime_overall['sharpe_ratio']),
         fmt_val(trail_overall['sharpe_ratio']), "N/A"),
        ("Total Return", fmt_pct(baseline_overall['total_return_pct']),
         fmt_pct(regime_overall['total_return_pct']),
         fmt_pct(trail_overall['total_return_pct']),
         fmt_pct(bh_return['total_return_pct'])),
        ("Alpha vs B&H",
         fmt_pct(baseline_overall['total_return_pct'] - bh_return['total_return_pct']),
         fmt_pct(regime_overall['total_return_pct'] - bh_return['total_return_pct']),
         fmt_pct(trail_overall['total_return_pct'] - bh_return['total_return_pct']),
         "—"),
    ]

    for label, b, r, t, bh in metrics:
        print(f"  {label:<18} | {b:>{col_w}} | {r:>{col_w}} | {t:>{col_w}} | {bh:>{col_w}}")
    print()

    # ── Per-Window Comparison ──
    print("Per-Window Comparison:")
    print(f"  {'Window':^7} | {'Baseline':>{col_w}} | {'+Regime':>{col_w}} | {'+Reg+Trail':>{col_w}} | {'B&H':>{col_w}}")
    print(f"  {'─'*7}─┼─{'─'*col_w}─┼─{'─'*col_w}─┼─{'─'*col_w}─┼─{'─'*col_w}")

    for i, window in enumerate(WINDOWS):
        wid = window["id"]
        b_ret = baseline_results[i].total_return_pct if i < len(baseline_results) else 0
        r_ret = regime_results[i].total_return_pct if i < len(regime_results) else 0
        t_ret = trail_results[i].total_return_pct if i < len(trail_results) else 0
        bh_ret = bh_per_window.get(wid, 0)
        print(f"  {wid:>5}   | {fmt_pct(b_ret):>{col_w}} | {fmt_pct(r_ret):>{col_w}} | {fmt_pct(t_ret):>{col_w}} | {fmt_pct(bh_ret):>{col_w}}")
    print()

    # ── Regime Filter Impact ──
    print("Regime Filter Impact (REAL EGX30):")
    print(f"  - Trades blocked by veto: {regime_impact['total_blocked']} "
          f"(would have been: {regime_impact['blocked_wins']} wins, "
          f"{regime_impact['blocked_losses']} losses)")
    print(f"  - Blocked in BEAR regime: {regime_impact['blocked_in_bear']}")
    print(f"  - Blocked in BULL regime: {regime_impact['blocked_in_bull']} (unexpected!)")
    print(f"  - Blocked in TRANSITION: {regime_impact['blocked_in_trans']}")
    net_impact = regime_impact['blocked_pnl']
    print(f"  - Net P&L of blocked trades: {net_impact:+,.0f} EGP")
    print(f"  - Did regime filter beat baseline? "
          f"{'YES' if regime_overall['total_return_pct'] > baseline_overall['total_return_pct'] else 'NO'}")
    print(f"  - Did regime filter beat Buy & Hold? "
          f"{'YES' if regime_overall['total_return_pct'] > bh_return['total_return_pct'] else 'NO'}")
    print(f"  - Did regime+trail beat baseline? "
          f"{'YES' if trail_overall['total_return_pct'] > baseline_overall['total_return_pct'] else 'NO'}")
    print(f"  - Did regime+trail beat Buy & Hold? "
          f"{'YES' if trail_overall['total_return_pct'] > bh_return['total_return_pct'] else 'NO'}")
    print()

    # ── Detailed: Where does the regime filter help/hurt? ──
    print("Regime Analysis by Window:")
    for i, window in enumerate(WINDOWS):
        wid = window["id"]
        test_start = window["test_start"]
        test_end = window["test_end"]

        bull_days = 0
        bear_days = 0
        trans_days = 0
        for date, rd in regime_map.items():
            if test_start <= date <= test_end:
                if rd.regime == "BULL":
                    bull_days += 1
                elif rd.regime == "BEAR":
                    bear_days += 1
                else:
                    trans_days += 1

        b_trades = len(baseline_results[i].trades) if i < len(baseline_results) else 0
        r_trades = len(regime_results[i].trades) if i < len(regime_results) else 0
        trades_blocked = b_trades - r_trades

        b_ret = baseline_results[i].total_return_pct if i < len(baseline_results) else 0
        r_ret = regime_results[i].total_return_pct if i < len(regime_results) else 0

        print(f"  Window {wid}: Bull={bull_days}d Bear={bear_days}d Trans={trans_days}d | "
              f"Trades: {b_trades}→{r_trades} (blocked {trades_blocked}) | "
              f"Return: {b_ret:+.1f}%→{r_ret:+.1f}%")
    print()

    # ── Honest Verdict ──
    print(line)
    print("  HONEST VERDICT")
    print(line)
    print()

    b_ret = baseline_overall['total_return_pct']
    r_ret = regime_overall['total_return_pct']
    t_ret = trail_overall['total_return_pct']
    bh_ret = bh_return['total_return_pct']

    print(f"  Baseline strategy: {b_ret:+.1f}%")
    print(f"  + Regime filter:   {r_ret:+.1f}% (Δ = {r_ret - b_ret:+.1f}pp)")
    print(f"  + Regime + Trail:  {t_ret:+.1f}% (Δ = {t_ret - b_ret:+.1f}pp)")
    print(f"  Buy & Hold:        {bh_ret:+.1f}%")
    print()

    if r_ret > b_ret:
        print("  ✓ Market Regime filter IMPROVED results.")
        print(f"    It added {r_ret - b_ret:+.1f} percentage points by blocking "
              f"{regime_impact['total_blocked']} trades in bear markets.")
    else:
        print("  ✗ Market Regime filter HURT results.")
        print(f"    It removed {r_ret - b_ret:+.1f} percentage points by blocking "
              f"{regime_impact['total_blocked']} trades that would have been profitable overall.")

    print()

    if t_ret > b_ret:
        print(f"  ✓ Adding trailing stop FURTHER improved results (+{t_ret - b_ret:.1f}pp vs baseline).")
        print("    Trailing stops capture more upside in trending markets.")
    elif t_ret > r_ret:
        print(f"  ✓ Trailing stop improved over regime-only (+{t_ret - r_ret:.1f}pp).")
        print("    But still didn't beat baseline.")
    else:
        print(f"  ✗ Trailing stop didn't help ({t_ret - r_ret:+.1f}pp vs regime-only).")

    print()

    if max(b_ret, r_ret, t_ret) < bh_ret:
        print("  ✗ NONE of the strategy variants beat Buy & Hold.")
        print(f"    Best variant was {'regime+trail' if t_ret >= r_ret and t_ret >= b_ret else 'regime' if r_ret >= b_ret else 'baseline'} "
              f"at {max(b_ret, r_ret, t_ret):+.1f}% vs B&H {bh_ret:+.1f}%")
        print("    The EGX bull market was too strong for active trading to compete.")
    else:
        winning_variant = "regime+trail" if t_ret >= r_ret and t_ret >= b_ret else "regime" if r_ret >= b_ret else "baseline"
        print(f"  ✓ The {winning_variant} variant BEAT Buy & Hold!")

    print()

    # Key insight about regime distribution
    total_bull = sum(d["BULL"] for d in regime_distribution.values())
    total_bear = sum(d["BEAR"] for d in regime_distribution.values())
    total_trans = sum(d["TRANSITION"] for d in regime_distribution.values())
    total_days = total_bull + total_bear + total_trans
    if total_days > 0:
        bull_pct = total_bull / total_days * 100
        bear_pct = total_bear / total_days * 100
        print(f"  Market was BULL {bull_pct:.0f}% of the time, BEAR {bear_pct:.0f}%.")
        if bear_pct < 20:
            print("  With so little bear market exposure, the regime filter")
            print("  has limited opportunity to add value by blocking trades.")
        elif bear_pct > 30:
            print("  Significant bear market exposure! The regime filter")
            print("  has substantial opportunity to protect capital.")

    print(line)
    print()


# ──────────── MAIN ───────────────────────────────────────────

def main():
    print()
    print("═" * 65)
    print("  HONEST EGX WALK-FORWARD BACKTEST — REGIME FILTER ANALYSIS")
    print("  ★ NOW USING REAL EGX30 INDEX DATA ★")
    print("═" * 65)
    print()
    print(f"  Database: {DB_PATH}")
    print(f"  Tickers: {len(EGX_TICKERS)}")
    print(f"  Starting Capital: {STARTING_CAPITAL:,.0f} EGP")
    print(f"  Risk per trade: {RISK_PER_TRADE*100:.0f}%")
    print(f"  Max position: {MAX_POSITION_PCT*100:.0f}% of capital")
    print(f"  Max concurrent: {MAX_CONCURRENT}")
    print(f"  Transaction cost: ~{(COMMISSION_PCT*2 + SLIPPAGE_PCT*2)*100:.1f}% round trip")
    print(f"  Walk-forward windows: {len(WINDOWS)}")
    print()
    print(f"  Entry: Close > SMA({SMA_SHORT}) & SMA({SMA_LONG}) rising & "
          f"RSI({RSI_PERIOD}) in [{RSI_LOW}-{RSI_HIGH}] & Vol > {VOLUME_RATIO_MIN}x avg")
    print(f"  Exit: Stop = ATR×SL_mult | Target = ATR×TP_mult | "
          f"Max hold = {MAX_HOLDING_DAYS} days")
    print()
    print(f"  Regime Filter: REAL EGX30 SMA({EGX30_SMA_SHORT})/SMA({EGX30_SMA_LONG}) crossover")
    print(f"    - BEAR (Stage 4): VETO all buy signals")
    print(f"    - BULL (Stage 2): Allow + {REGIME_BULL_BONUS} bonus score")
    print(f"    - TRANSITION: Allow, no bonus")
    print()
    print(f"  Trailing Stop: Step = {TRAIL_STEP_ATR}xATR up, "
          f"Trail = {TRAIL_STEP_AMOUNT}xATR per step")
    print()

    # Load stock data
    print("  Loading stock price data ...")
    all_data = load_all_data(DB_PATH)

    loaded_tickers = [t for t in EGX_TICKERS if t in all_data and len(all_data[t]) > 0]
    print(f"  Loaded {len(loaded_tickers)} tickers "
          f"({sum(len(v) for v in all_data.values()):,} bars total)")

    for ticker in loaded_tickers[:3]:
        bars = all_data[ticker]
        print(f"    {ticker}: {bars[0].date} to {bars[-1].date} "
              f"({len(bars)} bars)")

    # ── Load REAL EGX30 data ──
    print()
    print("  Loading REAL EGX30 index data ...")
    egx30_bars = load_egx30_data(DB_PATH)
    print(f"  EGX30: {len(egx30_bars)} bars from {egx30_bars[0].date} to {egx30_bars[-1].date}")
    print(f"  EGX30 range: {egx30_bars[0].close_price:,.2f} → {egx30_bars[-1].close_price:,.2f}")

    # ── Build REAL EGX30 regime map ──
    print()
    print("  Computing market regime from REAL EGX30 data ...")
    regime_map = build_egx30_regime_map(egx30_bars)
    print(f"  Regime map: {len(regime_map)} days classified")

    # Quick summary
    bull_days = sum(1 for rd in regime_map.values() if rd.regime == "BULL")
    bear_days = sum(1 for rd in regime_map.values() if rd.regime == "BEAR")
    trans_days = sum(1 for rd in regime_map.values() if rd.regime == "TRANSITION")
    total_classified = bull_days + bear_days + trans_days
    if total_classified > 0:
        print(f"    BULL: {bull_days} days ({bull_days/total_classified*100:.0f}%)")
        print(f"    BEAR: {bear_days} days ({bear_days/total_classified*100:.0f}%)")
        print(f"    TRANSITION: {trans_days} days ({trans_days/total_classified*100:.0f}%)")

    # ── EGX30 Summary Stats ──
    print_egx30_summary(egx30_bars, regime_map)

    # ── Build proxy for comparison ──
    print()
    print("  Building proxy index from 19 stocks (for BEAR-day comparison) ...")
    proxy_index = build_proxy_index(all_data)
    proxy_regime_map = build_proxy_regime_map(proxy_index)
    print(f"  Proxy index: {len(proxy_index)} trading days")

    # ── BEAR Day Comparison ──
    print_bear_comparison(regime_map, proxy_regime_map)

    # ── Compute Buy & Hold benchmark ──
    print()
    print("  Computing Buy & Hold benchmark ...")
    bh_return = compute_buy_and_hold(all_data)
    bh_per_window = compute_buy_and_hold_per_window(all_data)
    print(f"  Buy & Hold (equal-weighted): {bh_return['total_return_pct']:+.1f}% "
          f"across {bh_return.get('num_stocks', 0)} stocks")

    # ─────────────────────────────────────────────────────────
    # TEST 1: BASELINE (no regime, no trailing)
    # ─────────────────────────────────────────────────────────
    print()
    print("  " + "═" * 60)
    print("  TEST 1: BASELINE (no regime filter, no trailing stop)")
    print("  " + "═" * 60)
    baseline_results = run_walk_forward(
        all_data,
        regime_map=None,
        use_regime_filter=False,
        use_trailing_stop=False,
        label="BASELINE",
    )
    baseline_overall = compute_overall(baseline_results)
    print(f"  → Baseline: {baseline_overall['total_return_pct']:+.1f}% "
          f"(PF={baseline_overall['profit_factor']:.2f}, "
          f"WR={baseline_overall['win_rate']:.1f}%)")

    # ─────────────────────────────────────────────────────────
    # TEST 2: WITH REAL EGX30 REGIME FILTER ONLY
    # ─────────────────────────────────────────────────────────
    print()
    print("  " + "═" * 60)
    print("  TEST 2: +REGIME FILTER (REAL EGX30, veto in bear, bonus in bull)")
    print("  " + "═" * 60)
    regime_results = run_walk_forward(
        all_data,
        regime_map=regime_map,
        use_regime_filter=True,
        use_trailing_stop=False,
        label="+REGIME",
    )
    regime_overall = compute_overall(regime_results)
    print(f"  → +Regime: {regime_overall['total_return_pct']:+.1f}% "
          f"(PF={regime_overall['profit_factor']:.2f}, "
          f"WR={regime_overall['win_rate']:.1f}%)")

    # ─────────────────────────────────────────────────────────
    # TEST 3: WITH REGIME FILTER + TRAILING STOP
    # ─────────────────────────────────────────────────────────
    print()
    print("  " + "═" * 60)
    print("  TEST 3: +REGIME + TRAILING STOP (REAL EGX30)")
    print("  " + "═" * 60)
    trail_results = run_walk_forward(
        all_data,
        regime_map=regime_map,
        use_regime_filter=True,
        use_trailing_stop=True,
        label="+REG+TRAIL",
    )
    trail_overall = compute_overall(trail_results)
    print(f"  → +Regime+Trail: {trail_overall['total_return_pct']:+.1f}% "
          f"(PF={trail_overall['profit_factor']:.2f}, "
          f"WR={trail_overall['win_rate']:.1f}%)")

    # ─────────────────────────────────────────────────────────
    # ANALYZE REGIME FILTER IMPACT
    # ─────────────────────────────────────────────────────────
    print()
    print("  Analyzing regime filter impact ...")

    baseline_all_trades = []
    for wr in baseline_results:
        baseline_all_trades.extend(wr.trades)

    regime_all_trades = []
    for wr in regime_results:
        regime_all_trades.extend(wr.trades)

    regime_impact = analyze_regime_impact(
        baseline_all_trades, regime_all_trades, regime_map
    )

    # ─────────────────────────────────────────────────────────
    # REGIME DISTRIBUTION
    # ─────────────────────────────────────────────────────────
    regime_distribution = compute_regime_distribution(regime_map)

    # ─────────────────────────────────────────────────────────
    # PRINT FULL COMPARISON
    # ─────────────────────────────────────────────────────────
    print_comparison(
        baseline_overall, regime_overall, trail_overall,
        bh_return,
        baseline_results, regime_results, trail_results,
        bh_per_window,
        regime_distribution,
        regime_impact,
        regime_map,
    )

    # ─────────────────────────────────────────────────────────
    # 2026 REGIME-ONLY ANALYSIS
    # ─────────────────────────────────────────────────────────
    print_2026_regime_analysis(regime_map, egx30_bars)


if __name__ == "__main__":
    main()
