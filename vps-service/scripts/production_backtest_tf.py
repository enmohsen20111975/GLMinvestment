#!/usr/bin/env python3
"""
Production Backtest — Trend-Following + EGX30 Regime Filter
============================================================
Backtest the ACTUAL production SniperFilter + MarketRegimeEngine + DynamicTargetEngine
logic against historical data from price_history.db.

Task ID: 31

Uses production classes:
  - MarketRegimeEngine (from engines/market_regime.py) for EGX30 regime detection
  - SniperFilter logic (from analyzers/sniper_filter.py) for 6-gate sequential filter
  - DynamicTargetEngine parameters (from analyzers/dynamic_target_engine.py) for trailing stops

Gate Logic (replicated from production SniperFilter v3.0):
  Gate 0: EGX30 Regime — Stage 4 (Bear) = REJECT
  Gate 1: Liquidity — Volume >= 500K OR Value >= 2M EGP
  Gate 2: Trend — Price > SMA-50 AND ADX > 25 AND SMA-20 > SMA-50
  Gate 3: Breakout — Price > 55-day Donchian high OR within 2% of it
  Gate 4: Risk/Reward — ATR×SL_mult/Entry < 15% AND ATR×trail_mult/Entry > 5%
  Gate 5: Confirmation — Bullish candle + Volume >= 1.5x avg

Exit Logic (from DynamicTargetEngine trend_following mode):
  - Initial stop = entry - ATR(14) × 3.0
  - Trailing stop = highest_close - ATR(14) × 3.0
  - Trail never moves down
  - Exit at next day's open when trailing stop breached
  - Max holding = 60 days
  - Transaction cost = 0.5% round trip

Data available: 2025-01-09 to 2026-06-10 (750+ EGX stocks + EGX30 index 2021-2026)
"""

import sqlite3
import sys
import math
import logging
from pathlib import Path
from datetime import datetime
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Tuple
from collections import defaultdict

# ─────────────────────────── PATHS ───────────────────────────

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_PATH = str(PROJECT_ROOT / "db" / "price_history.db")

# Add vps-service to path for production imports
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

# ──────────────────── BACKTEST PARAMETERS ──────────────────────

# From production SniperFilter
SL_MULT = 2.0        # Stop-loss = ATR × SL_MULT (Gate 4 risk check)
TRAIL_MULT = 3.0     # Trailing stop room = ATR × TRAIL_MULT (Gate 4 trail check)
ATR_PERIOD = 14
ADX_PERIOD = 14
SMA20_PERIOD = 20
SMA50_PERIOD = 50
DONCHIAN_PERIOD = 55
VOLUME_AVG_PERIOD = 20
VOLUME_SPIKE_MIN = 1.5    # Gate 5 confirmation
LIQUIDITY_VOL_MIN = 500_000
LIQUIDITY_VAL_MIN = 2_000_000

# From production DynamicTargetEngine trend_following mode
TF_SL_MULT = 3.0         # ATR × 3.0 for initial stop (matches production)
TF_TRAIL_MULT = 3.0      # ATR × 3.0 for trailing stop
TF_MAX_HOLDING_DAYS = 60
TF_TRANSACTION_COST = 0.005  # 0.5% round trip

# Risk management
TF_RISK_PER_TRADE = 0.02
TF_MAX_CONCURRENT = 5
TF_MAX_POSITION_PCT = 0.20

# Capital
STARTING_CAPITAL = 100_000.0

# ──────────────────── WALK-FORWARD WINDOWS ─────────────────────
# Data: 2025-01-09 to 2026-06-10
# Need ~70 trading days warmup for indicators
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

# Full period (no train/test split)
FULL_START = "2025-04-15"
FULL_END = "2026-06-10"

# ─────────────────────── DATA CLASSES ────────────────────────

@dataclass
class Bar:
    date: str
    open_price: float
    high_price: float
    low_price: float
    close_price: float
    volume: float

@dataclass
class Trade:
    ticker: str
    entry_date: str
    exit_date: str
    entry_price: float
    exit_price: float
    shares: int
    pnl: float
    pnl_pct: float
    holding_days: int
    exit_type: str          # 'trailing_stop', 'initial_stop', 'timeout', 'max_hold'
    r_multiple: float
    regime_stage: int
    regime_name: str
    gates_passed: int
    atr_at_entry: float
    initial_stop: float
    final_trail: float

@dataclass
class GateRejection:
    ticker: str
    date: str
    gate_failed: str
    gate_number: int


# ═══════════════════════════════════════════════════════════════
#  DATA LOADING
# ═══════════════════════════════════════════════════════════════

def load_egx30_component_tickers(db_path: str) -> List[str]:
    """Load EGX30 component tickers from DB, or use hardcoded list"""
    # Try data_engine.db first
    try:
        conn = sqlite3.connect(str(PROJECT_ROOT / "db" / "data_engine.db"))
        rows = conn.execute(
            "SELECT DISTINCT symbol FROM stocks WHERE market='مصر' ORDER BY symbol"
        ).fetchall()
        conn.close()
        if rows:
            return [r[0] for r in rows]
    except Exception:
        pass

    # Use known EGX30 components
    return [
        "COMI", "ISPH", "ETEL", "AMOC", "FWRY", "HRHO", "SWDY", "ORHD",
        "EMFD", "MFPC", "ALCN", "EGCH", "HELI", "OCDI", "EKHO", "MNHD",
        "TMGH", "SKPC", "SPMD",
    ]


def load_all_tickers_with_data(db_path: str, min_bars: int = 200) -> List[str]:
    """Load all tickers that have sufficient data"""
    conn = sqlite3.connect(db_path)
    rows = conn.execute(f"""
        SELECT ticker, COUNT(*) as cnt
        FROM price_history
        WHERE close_price > 0 AND high_price > 0 AND low_price > 0
        AND ticker NOT IN ('EGX30', 'EG30X', 'EGX30ETF')
        AND ticker NOT LIKE 'EGB%'
        AND ticker NOT LIKE 'EGT%'
        AND date >= '2025-01-01'
        GROUP BY ticker
        HAVING cnt >= ?
        ORDER BY cnt DESC
    """, (min_bars,)).fetchall()
    conn.close()
    return [r[0] for r in rows]


def load_all_data(db_path: str, tickers: List[str] = None) -> Dict[str, List[Bar]]:
    """Load all price data for specified tickers from price_history.db"""
    conn = sqlite3.connect(db_path)
    data = {}

    if tickers is None:
        tickers = load_all_tickers_with_data(db_path)

    for ticker in tickers:
        rows = conn.execute(
            "SELECT date, open_price, high_price, low_price, close_price, volume "
            "FROM price_history WHERE ticker=? ORDER BY date ASC",
            (ticker,)
        ).fetchall()
        if rows:
            bars = []
            for r in rows:
                bars.append(Bar(
                    date=r[0],
                    open_price=float(r[1] or 0),
                    high_price=float(r[2] or 0),
                    low_price=float(r[3] or 0),
                    close_price=float(r[4] or 0),
                    volume=float(r[5] or 0),
                ))
            bars = [b for b in bars if b.close_price > 0 and b.high_price > 0 and b.low_price > 0]
            if len(bars) >= 70:  # Need at least 70 bars for indicators
                data[ticker] = bars

    conn.close()
    return data


def load_egx30_data(db_path: str) -> List[Bar]:
    """Load EGX30 index data for regime detection"""
    conn = sqlite3.connect(db_path)
    rows = conn.execute(
        "SELECT date, open_price, high_price, low_price, close_price, volume "
        "FROM price_history WHERE ticker IN ('EGX30', 'EG30X') ORDER BY date ASC"
    ).fetchall()
    conn.close()

    bars = []
    for r in rows:
        bars.append(Bar(
            date=r[0],
            open_price=float(r[1] or 0),
            high_price=float(r[2] or 0),
            low_price=float(r[3] or 0),
            close_price=float(r[4] or 0),
            volume=float(r[5] or 0),
        ))
    return [b for b in bars if b.close_price > 0]


# ═══════════════════════════════════════════════════════════════
#  PRODUCTION REPLICATE: MARKET REGIME ENGINE
# ═══════════════════════════════════════════════════════════════

def get_regime_at_date(egx30_bars: List[Bar], as_of_date: str) -> Tuple[int, str]:
    """
    Replicate MarketRegimeEngine.get_regime(as_of_date) logic.
    Returns (stage, stage_name).
    Stage 4 = Bear Market → no trading allowed.
    """
    subset = [b for b in egx30_bars if b.date <= as_of_date]
    if len(subset) < 210:
        return 1, "Consolidation"

    closes = [b.close_price for b in subset]
    current_price = closes[-1]

    sma200 = sum(closes[-200:]) / 200
    sma50 = sum(closes[-50:]) / 50

    lookback = 20
    if len(closes) >= 200 + lookback:
        current_sma200 = sum(closes[-200:]) / 200
        past_sma200 = sum(closes[-200 - lookback:-lookback]) / 200
        slope_200 = (current_sma200 - past_sma200) / past_sma200 if past_sma200 > 0 else 0
    else:
        slope_200 = 0

    SLOPE_BULL_THRESHOLD = 0.002
    SLOPE_BEAR_THRESHOLD = -0.002

    if current_price > sma200 and sma50 > sma200 and slope_200 > SLOPE_BULL_THRESHOLD:
        return 2, "Bull Market"
    if current_price < sma200 and slope_200 < SLOPE_BEAR_THRESHOLD:
        return 4, "Bear Market"
    if current_price > sma200:
        return 3, "Distribution"
    return 1, "Consolidation"


# ═══════════════════════════════════════════════════════════════
#  PRODUCTION REPLICATE: SNIPER FILTER (6-GATE LOGIC)
# ═══════════════════════════════════════════════════════════════

def compute_sma(closes: List[float], period: int) -> Optional[float]:
    if len(closes) < period:
        return None
    return sum(closes[-period:]) / period


def compute_atr(highs: List[float], lows: List[float], closes: List[float],
                period: int = 14) -> Optional[float]:
    if len(highs) < period + 1:
        return None

    tr_list = []
    for i in range(1, len(highs)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1])
        )
        tr_list.append(tr)

    if len(tr_list) < period:
        return None

    atr = sum(tr_list[:period]) / period
    for i in range(period, len(tr_list)):
        atr = (atr * (period - 1) + tr_list[i]) / period

    return round(atr, 4)


def compute_adx(highs: List[float], lows: List[float], closes: List[float],
                period: int = 14) -> Optional[float]:
    if len(highs) < period * 2 + 1:
        return None

    plus_dm_list = []
    minus_dm_list = []
    tr_list = []

    for i in range(1, len(highs)):
        high_diff = highs[i] - highs[i - 1]
        low_diff = lows[i - 1] - lows[i]

        plus_dm = high_diff if high_diff > low_diff and high_diff > 0 else 0
        minus_dm = low_diff if low_diff > high_diff and low_diff > 0 else 0

        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1])
        )

        plus_dm_list.append(plus_dm)
        minus_dm_list.append(minus_dm)
        tr_list.append(tr)

    if len(tr_list) < period:
        return None

    def wilder_smooth(data, p):
        smoothed = [sum(data[:p])]
        for i in range(p, len(data)):
            smoothed.append(smoothed[-1] - smoothed[-1] / p + data[i])
        return smoothed

    atr_smoothed = wilder_smooth(tr_list, period)
    plus_dm_smoothed = wilder_smooth(plus_dm_list, period)
    minus_dm_smoothed = wilder_smooth(minus_dm_list, period)

    dx_values = []
    for i in range(len(atr_smoothed)):
        if atr_smoothed[i] > 0:
            plus_di = 100 * plus_dm_smoothed[i] / atr_smoothed[i]
            minus_di = 100 * minus_dm_smoothed[i] / atr_smoothed[i]
            di_sum = plus_di + minus_di
            if di_sum > 0:
                dx = 100 * abs(plus_di - minus_di) / di_sum
                dx_values.append(dx)

    if len(dx_values) < period:
        return None

    adx = sum(dx_values[:period]) / period
    for i in range(period, len(dx_values)):
        adx = (adx * (period - 1) + dx_values[i]) / period

    return round(adx, 2)


def apply_sniper_filter(
    bars: List[Bar],
    as_of_idx: int,
    regime_stage: int,
    # Relaxed mode parameters
    relaxed: bool = False,
    min_gates: int = 6,
    vol_spike_min: float = VOLUME_SPIKE_MIN,
    adx_min: float = 25,
) -> Tuple[bool, int, str, Dict]:
    """
    Apply the production 6-gate SniperFilter logic to historical data.
    Returns (passed, gates_passed, fail_reason, indicators_dict).

    If relaxed=True, passes with min_gates or more (instead of requiring all 6).
    """
    subset = bars[:as_of_idx + 1]
    if len(subset) < 60:
        return False, 0, "insufficient_data", {}

    closes = [b.close_price for b in subset]
    highs = [b.high_price for b in subset]
    lows = [b.low_price for b in subset]
    volumes = [b.volume for b in subset]
    opens = [b.open_price for b in subset]

    current_price = closes[-1]
    current_volume = volumes[-1]
    current_value = current_price * current_volume

    # Compute indicators
    sma20 = compute_sma(closes, SMA20_PERIOD)
    sma50 = compute_sma(closes, SMA50_PERIOD)
    adx = compute_adx(highs, lows, closes, ADX_PERIOD)
    atr = compute_atr(highs, lows, closes, ATR_PERIOD)

    if len(highs) >= DONCHIAN_PERIOD:
        donchian_high = max(highs[-DONCHIAN_PERIOD:])
    elif len(highs) > 0:
        donchian_high = max(highs)
    else:
        donchian_high = None

    if len(volumes) >= VOLUME_AVG_PERIOD:
        vol_avg = sum(volumes[-VOLUME_AVG_PERIOD:]) / VOLUME_AVG_PERIOD
        volume_ratio = volumes[-1] / vol_avg if vol_avg > 0 else 1.0
    else:
        volume_ratio = 1.0

    if len(opens) >= 1:
        candlestick = 'bullish' if closes[-1] > opens[-1] else ('bearish' if closes[-1] < opens[-1] else 'neutral')
    else:
        candlestick = 'neutral'

    indicators = {
        'price': current_price, 'sma20': sma20, 'sma50': sma50,
        'adx': adx, 'atr': atr, 'donchian_high': donchian_high,
        'volume_ratio': round(volume_ratio, 2), 'volume': current_volume,
        'candlestick': candlestick,
    }

    gates_passed = 0

    # ── Gate 0: EGX30 Regime ──
    if regime_stage == 4:
        return False, 0, "egx30_regime", indicators
    gates_passed = 1

    # ── Gate 1: Liquidity ──
    if not (current_volume >= LIQUIDITY_VOL_MIN or current_value >= LIQUIDITY_VAL_MIN):
        return False, 1, "liquidity", indicators
    gates_passed = 2

    # ── Gate 2: Trend (Price > SMA-50 AND ADX > threshold AND SMA-20 > SMA-50) ──
    above_sma50 = True
    if sma50 and sma50 > 0:
        above_sma50 = current_price > sma50

    adx_strong = True
    if adx is not None:
        adx_strong = adx > adx_min

    golden_alignment = True
    if sma20 and sma50 and sma20 > 0 and sma50 > 0:
        golden_alignment = sma20 > sma50

    if not (above_sma50 and adx_strong and golden_alignment):
        if gates_passed < min_gates:
            return False, 2, "trend", indicators
    else:
        gates_passed = 3

    # ── Gate 3: Breakout (Donchian 55-day) ──
    sr_pass = False
    if donchian_high and donchian_high > 0 and current_price > 0:
        if current_price > donchian_high:
            sr_pass = True
        else:
            dist_pct = ((donchian_high - current_price) / current_price) * 100
            if dist_pct <= 2.0:
                sr_pass = True

    if not sr_pass:
        if gates_passed < min_gates:
            return False, 3, "sr_position", indicators
    else:
        gates_passed = 4

    # ── Gate 4: Risk/Reward (ATR-based) ──
    rr_pass = True
    if atr and atr > 0 and current_price > 0:
        risk_pct = (atr * SL_MULT) / current_price * 100
        trail_room_pct = (atr * TRAIL_MULT) / current_price * 100
        rr_pass = risk_pct < 15.0 and trail_room_pct > 5.0

    if not rr_pass:
        if gates_passed < min_gates:
            return False, 4, "risk_reward", indicators
    else:
        gates_passed = 5

    # ── Gate 5: Confirmation (Bullish + Volume spike) ──
    conf_pass = candlestick == 'bullish' and volume_ratio >= vol_spike_min

    if conf_pass:
        gates_passed = 6

    # Determine if passed
    if gates_passed >= min_gates:
        return True, gates_passed, "", indicators
    else:
        return False, gates_passed, "confirmation", indicators


# ═══════════════════════════════════════════════════════════════
#  POSITION MANAGEMENT & EXIT LOGIC
# ═══════════════════════════════════════════════════════════════

@dataclass
class OpenPosition:
    ticker: str
    entry_date: str
    entry_idx: int
    entry_price: float
    shares: int
    initial_stop: float
    trailing_stop: float
    highest_close: float
    atr_at_entry: float
    regime_stage: int
    regime_name: str
    gates_passed: int
    holding_days: int = 0


def check_exit(pos: OpenPosition, today_bar: Bar, today_idx: int, bars: List[Bar]) -> Optional[str]:
    """
    Check if position should be exited today.
    Exit logic from DynamicTargetEngine trend_following mode.
    """
    pos.holding_days += 1

    if pos.holding_days >= TF_MAX_HOLDING_DAYS:
        return "timeout"

    # Update highest close
    if today_bar.close_price > pos.highest_close:
        pos.highest_close = today_bar.close_price

    # Recalculate trailing stop (using entry ATR, matching production)
    new_trail = pos.highest_close - (pos.atr_at_entry * TF_TRAIL_MULT)
    if new_trail > pos.trailing_stop:
        pos.trailing_stop = new_trail

    # Check trailing stop breach (using low price)
    if today_bar.low_price <= pos.trailing_stop:
        return "trailing_stop"

    # Check initial stop
    if today_bar.low_price <= pos.initial_stop:
        return "initial_stop"

    return None


def calculate_exit_price(pos: OpenPosition, exit_bar: Bar, exit_type: str) -> float:
    """Calculate actual exit price based on exit type."""
    if exit_type == "trailing_stop":
        # If gapped below, use open; otherwise use stop price
        if exit_bar.open_price <= pos.trailing_stop:
            return exit_bar.open_price
        return pos.trailing_stop
    elif exit_type == "initial_stop":
        if exit_bar.open_price <= pos.initial_stop:
            return exit_bar.open_price
        return pos.initial_stop
    elif exit_type == "timeout":
        return exit_bar.close_price
    return exit_bar.close_price


# ═══════════════════════════════════════════════════════════════
#  BACKTEST ENGINE
# ═══════════════════════════════════════════════════════════════

def run_backtest(
    all_data: Dict[str, List[Bar]],
    egx30_bars: List[Bar],
    start_date: str,
    end_date: str,
    starting_capital: float = STARTING_CAPITAL,
    min_gates: int = 6,
    vol_spike_min: float = VOLUME_SPIKE_MIN,
    adx_min: float = 25,
    relaxed: bool = False,
) -> Tuple[List[Trade], List[GateRejection], Dict]:
    """
    Run the production-replicated backtest over the specified date range.
    """
    capital = starting_capital
    open_positions: List[OpenPosition] = []
    closed_trades: List[Trade] = []
    gate_rejections: List[GateRejection] = []

    # Build date set from all available data
    all_dates = set()
    for ticker, bars in all_data.items():
        for b in bars:
            if start_date <= b.date <= end_date:
                all_dates.add(b.date)
    trading_dates = sorted(all_dates)

    # Build per-ticker date→index maps
    ticker_date_idx: Dict[str, Dict[str, int]] = {}
    for ticker, bars in all_data.items():
        ticker_date_idx[ticker] = {b.date: i for i, b in enumerate(bars)}

    gate_counts = defaultdict(int)
    regime_blocked_days = 0
    equity_curve = [capital]

    for date in trading_dates:
        # ── STEP 1: Check exits for open positions ──
        still_open = []
        for pos in open_positions:
            if date not in ticker_date_idx.get(pos.ticker, {}):
                still_open.append(pos)
                continue

            idx = ticker_date_idx[pos.ticker][date]
            today_bar = all_data[pos.ticker][idx]
            exit_type = check_exit(pos, today_bar, idx, all_data[pos.ticker])

            if exit_type:
                exit_price = calculate_exit_price(pos, today_bar, exit_type)
                exit_price_adj = exit_price * (1 - TF_TRANSACTION_COST / 2)

                pnl = (exit_price_adj - pos.entry_price) * pos.shares
                pnl_pct = (exit_price_adj - pos.entry_price) / pos.entry_price * 100

                risk_per_share = pos.entry_price - pos.initial_stop
                r_multiple = (exit_price_adj - pos.entry_price) / risk_per_share if risk_per_share > 0 else 0

                trade = Trade(
                    ticker=pos.ticker,
                    entry_date=pos.entry_date,
                    exit_date=date,
                    entry_price=pos.entry_price,
                    exit_price=round(exit_price_adj, 4),
                    shares=pos.shares,
                    pnl=round(pnl, 2),
                    pnl_pct=round(pnl_pct, 2),
                    holding_days=pos.holding_days,
                    exit_type=exit_type,
                    r_multiple=round(r_multiple, 3),
                    regime_stage=pos.regime_stage,
                    regime_name=pos.regime_name,
                    gates_passed=pos.gates_passed,
                    atr_at_entry=pos.atr_at_entry,
                    initial_stop=round(pos.initial_stop, 4),
                    final_trail=round(pos.trailing_stop, 4),
                )
                closed_trades.append(trade)
                capital += pnl
            else:
                still_open.append(pos)

        open_positions = still_open

        # ── STEP 2: Get EGX30 regime ──
        regime_stage, regime_name = get_regime_at_date(egx30_bars, date)

        if regime_stage == 4:
            regime_blocked_days += 1
            equity_curve.append(capital)
            continue

        # ── STEP 3: Scan for new entries ──
        if len(open_positions) >= TF_MAX_CONCURRENT:
            equity_curve.append(capital)
            continue

        for ticker in sorted(all_data.keys()):
            if len(open_positions) >= TF_MAX_CONCURRENT:
                break

            if any(p.ticker == ticker for p in open_positions):
                continue

            if date not in ticker_date_idx.get(ticker, {}):
                continue

            idx = ticker_date_idx[ticker][date]
            if idx < 60:
                continue

            passed, gates_passed, fail_reason, indicators = apply_sniper_filter(
                all_data[ticker], idx, regime_stage,
                relaxed=relaxed, min_gates=min_gates,
                vol_spike_min=vol_spike_min, adx_min=adx_min,
            )

            if not passed:
                gate_counts[fail_reason] += 1
                gate_rejections.append(GateRejection(
                    ticker=ticker, date=date, gate_failed=fail_reason, gate_number=gates_passed
                ))
                continue

            # ── ENTRY ──
            entry_price = all_data[ticker][idx].close_price * (1 + TF_TRANSACTION_COST / 2)

            atr_val = indicators.get('atr', 0)
            if atr_val and atr_val > 0:
                initial_stop = entry_price - (atr_val * TF_SL_MULT)
            else:
                initial_stop = entry_price * 0.92

            risk_per_share = entry_price - initial_stop
            if risk_per_share <= 0:
                continue

            risk_amount = capital * TF_RISK_PER_TRADE
            shares = int(risk_amount / risk_per_share)

            max_shares = int((capital * TF_MAX_POSITION_PCT) / entry_price)
            shares = min(shares, max_shares)

            if shares <= 0:
                continue

            pos = OpenPosition(
                ticker=ticker,
                entry_date=date,
                entry_idx=idx,
                entry_price=entry_price,
                shares=shares,
                initial_stop=initial_stop,
                trailing_stop=initial_stop,
                highest_close=entry_price,
                atr_at_entry=atr_val if atr_val else entry_price * 0.04,
                regime_stage=regime_stage,
                regime_name=regime_name,
                gates_passed=gates_passed,
            )
            open_positions.append(pos)

        # Update equity curve
        mtm_capital = capital
        for pos in open_positions:
            if date in ticker_date_idx.get(pos.ticker, {}):
                idx = ticker_date_idx[pos.ticker][date]
                current_price = all_data[pos.ticker][idx].close_price
                mtm_capital += (current_price - pos.entry_price) * pos.shares
        equity_curve.append(mtm_capital)

    # Close remaining positions
    for pos in open_positions:
        ticker = pos.ticker
        if ticker in all_data and all_data[ticker]:
            last_bar = all_data[ticker][-1]
            exit_price = last_bar.close_price * (1 - TF_TRANSACTION_COST / 2)
            pnl = (exit_price - pos.entry_price) * pos.shares
            pnl_pct = (exit_price - pos.entry_price) / pos.entry_price * 100
            risk_per_share = pos.entry_price - pos.initial_stop
            r_multiple = (exit_price - pos.entry_price) / risk_per_share if risk_per_share > 0 else 0

            trade = Trade(
                ticker=pos.ticker, entry_date=pos.entry_date, exit_date=last_bar.date,
                entry_price=pos.entry_price, exit_price=round(exit_price, 4),
                shares=pos.shares, pnl=round(pnl, 2), pnl_pct=round(pnl_pct, 2),
                holding_days=pos.holding_days, exit_type="end_of_test",
                r_multiple=round(r_multiple, 3), regime_stage=pos.regime_stage,
                regime_name=pos.regime_name, gates_passed=pos.gates_passed,
                atr_at_entry=pos.atr_at_entry, initial_stop=round(pos.initial_stop, 4),
                final_trail=round(pos.trailing_stop, 4),
            )
            closed_trades.append(trade)
            capital += pnl

    stats = compute_stats(closed_trades, equity_curve, starting_capital, len(trading_dates), regime_blocked_days, gate_counts)
    return closed_trades, gate_rejections, stats


def compute_stats(
    trades: List[Trade],
    equity_curve: List[float],
    starting_capital: float,
    total_days: int,
    regime_blocked_days: int,
    gate_counts: Dict[str, int],
) -> Dict:
    if not trades:
        return {
            'total_trades': 0, 'wins': 0, 'losses': 0, 'win_rate': 0,
            'profit_factor': 0, 'total_return_pct': 0, 'max_drawdown_pct': 0,
            'sharpe_ratio': 0, 'avg_holding_days': 0, 'avg_r_multiple': 0,
            'avg_win_pct': 0, 'avg_loss_pct': 0, 'capital_end': starting_capital,
            'exit_type_counts': {}, 'regime_blocked_days': regime_blocked_days,
            'total_days': total_days, 'gate_rejections': dict(gate_counts),
        }

    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]

    total_wins = sum(t.pnl for t in wins)
    total_losses = abs(sum(t.pnl for t in losses))

    win_rate = len(wins) / len(trades) * 100 if trades else 0
    profit_factor = total_wins / total_losses if total_losses > 0 else float('inf')

    capital_end = starting_capital + sum(t.pnl for t in trades)
    total_return_pct = (capital_end - starting_capital) / starting_capital * 100

    max_dd = 0
    peak = equity_curve[0] if equity_curve else starting_capital
    for val in equity_curve:
        if val > peak:
            peak = val
        dd = (peak - val) / peak * 100
        if dd > max_dd:
            max_dd = dd

    daily_returns = []
    for i in range(1, len(equity_curve)):
        if equity_curve[i - 1] > 0:
            daily_returns.append(equity_curve[i] / equity_curve[i - 1] - 1)

    if len(daily_returns) > 1:
        avg_return = sum(daily_returns) / len(daily_returns)
        std_return = math.sqrt(sum((r - avg_return) ** 2 for r in daily_returns) / (len(daily_returns) - 1))
        sharpe = (avg_return / std_return) * math.sqrt(252) if std_return > 0 else 0
    else:
        sharpe = 0

    avg_holding_days = sum(t.holding_days for t in trades) / len(trades)
    avg_r = sum(t.r_multiple for t in trades) / len(trades)
    avg_win_pct = sum(t.pnl_pct for t in wins) / len(wins) if wins else 0
    avg_loss_pct = sum(t.pnl_pct for t in losses) / len(losses) if losses else 0

    exit_counts = defaultdict(int)
    for t in trades:
        exit_counts[t.exit_type] += 1

    return {
        'total_trades': len(trades),
        'wins': len(wins),
        'losses': len(losses),
        'win_rate': round(win_rate, 1),
        'profit_factor': round(profit_factor, 2) if profit_factor != float('inf') else 999,
        'total_return_pct': round(total_return_pct, 1),
        'max_drawdown_pct': round(max_dd, 2),
        'sharpe_ratio': round(sharpe, 2),
        'avg_holding_days': round(avg_holding_days, 1),
        'avg_r_multiple': round(avg_r, 3),
        'avg_win_pct': round(avg_win_pct, 2),
        'avg_loss_pct': round(avg_loss_pct, 2),
        'capital_end': round(capital_end, 2),
        'exit_type_counts': dict(exit_counts),
        'regime_blocked_days': regime_blocked_days,
        'total_days': total_days,
        'gate_rejections': dict(gate_counts),
    }


# ═══════════════════════════════════════════════════════════════
#  PRODUCTION ENGINE VERIFICATION
# ═══════════════════════════════════════════════════════════════

def verify_against_production(egx30_bars: List[Bar]):
    """Verify backtest regime logic matches production MarketRegimeEngine."""
    try:
        from engines.market_regime import MarketRegimeEngine
        engine = MarketRegimeEngine()
        test_dates = ['2023-07-01', '2024-01-15', '2024-06-30', '2024-12-31',
                      '2025-01-15', '2025-06-30', '2025-12-31', '2026-03-01']

        print("\n  Verifying regime logic against production MarketRegimeEngine:")
        all_match = True
        for d in test_dates:
            prod_result = engine.get_regime(as_of_date=d)
            bt_stage, bt_name = get_regime_at_date(egx30_bars, d)
            match = prod_result.stage == bt_stage
            if not match:
                all_match = False
            status = "✓" if match else "✗"
            print(f"    {d}: Production=Stage {prod_result.stage} ({prod_result.stage_name}) | "
                  f"Backtest=Stage {bt_stage} ({bt_name}) {status}")

        if all_match:
            print("  ✓ All regime calculations match production!")
        else:
            print("  ✗ Some regime calculations differ")
    except ImportError as e:
        print(f"  ⚠ Could not import MarketRegimeEngine: {e}")


# ═══════════════════════════════════════════════════════════════
#  REPORTING
# ═══════════════════════════════════════════════════════════════

def print_stats_block(stats: Dict, label: str = ""):
    """Print a stats block."""
    if label:
        print(f"  ── {label} ──")
    print(f"  Total Trades: {stats['total_trades']}")
    print(f"  Win Rate: {stats['win_rate']:.1f}% ({stats['wins']}W / {stats['losses']}L)")
    print(f"  Profit Factor: {stats['profit_factor']:.2f}")
    print(f"  Total Return: {stats['total_return_pct']:+.1f}%")
    print(f"  Max Drawdown: {stats['max_drawdown_pct']:.2f}%")
    print(f"  Sharpe Ratio: {stats['sharpe_ratio']:.2f}")
    print(f"  Avg Holding Days: {stats['avg_holding_days']:.1f}")
    print(f"  Avg R-Multiple: {stats['avg_r_multiple']:.3f}")
    print(f"  Avg Win: {stats['avg_win_pct']:+.2f}% | Avg Loss: {stats['avg_loss_pct']:.2f}%")
    print(f"  Capital End: {stats['capital_end']:,.2f} EGP")


def print_full_report(
    full_stats_strict: Dict,
    full_stats_relaxed: Dict,
    full_trades_strict: List[Trade],
    full_trades_relaxed: List[Trade],
    full_rejections: List[GateRejection],
    egx30_bars: List[Bar],
    window_results_strict: Dict,
    window_results_relaxed: Dict,
    all_data: Dict,
):
    W = 78
    line = "═" * W

    print()
    print(line)
    print("  PRODUCTION BACKTEST — TREND-FOLLOWING + EGX30 REGIME FILTER")
    print("  Task ID: 31")
    print(line)
    print()
    print(f"  Database: {DB_PATH}")
    print(f"  Tickers scanned: {len(all_data)} (all EGX stocks with sufficient data)")
    print(f"  Starting Capital: {STARTING_CAPITAL:,.0f} EGP")
    print(f"  Transaction cost: {TF_TRANSACTION_COST*100:.1f}% round trip")
    print(f"  Risk per trade: {TF_RISK_PER_TRADE*100:.0f}% | Max concurrent: {TF_MAX_CONCURRENT}")
    print()
    print(f"  ── Production SniperFilter Gates ──")
    print(f"  Gate 0: EGX30 Regime (Stage 4 = REJECT)")
    print(f"  Gate 1: Liquidity (Vol ≥ {LIQUIDITY_VOL_MIN:,} OR Val ≥ {LIQUIDITY_VAL_MIN:,})")
    print(f"  Gate 2: Trend (Price > SMA-50 + ADX > 25 + SMA-20 > SMA-50)")
    print(f"  Gate 3: Breakout (Price > 55d Donchian OR within 2%)")
    print(f"  Gate 4: Risk/Reward (ATR×{SL_MULT}/Entry < 15% & ATR×{TRAIL_MULT}/Entry > 5%)")
    print(f"  Gate 5: Confirmation (Bullish candle + Vol ≥ {VOLUME_SPIKE_MIN}x avg)")
    print()
    print(f"  ── Exit Logic (DynamicTargetEngine trend_following mode) ──")
    print(f"  Initial stop = Entry - ATR(14) × {TF_SL_MULT}")
    print(f"  Trailing stop = Highest Close - ATR(14) × {TF_TRAIL_MULT}")
    print(f"  Trail never moves down | Max holding: {TF_MAX_HOLDING_DAYS} days")
    print()

    # ══════════════════════════════════════════════════════════════
    # SECTION 1: STRICT PRODUCTION FILTER (6/6 gates required)
    # ══════════════════════════════════════════════════════════════
    print(line)
    print("  SECTION 1: STRICT PRODUCTION FILTER (6/6 Gates Required)")
    print(line)
    print()
    print_stats_block(full_stats_strict, "Strict Filter Results")
    print()

    # ══════════════════════════════════════════════════════════════
    # SECTION 2: RELAXED FILTER (4+/6 gates, lower volume threshold)
    # ══════════════════════════════════════════════════════════════
    print(line)
    print("  SECTION 2: RELAXED FILTER (4+/6 Gates, Vol ≥ 1.2x, ADX > 20)")
    print(line)
    print()
    print_stats_block(full_stats_relaxed, "Relaxed Filter Results")
    print()

    # ══════════════════════════════════════════════════════════════
    # SECTION 3: COMPARISON TABLE
    # ══════════════════════════════════════════════════════════════
    print(line)
    print("  COMPARISON TABLE")
    print(line)
    print()
    print(f"  {'Metric':<22} | {'Previous Standalone':>18} | {'Prod Strict':>12} | {'Prod Relaxed':>12}")
    print(f"  {'─'*22}─┼─{'─'*18}─┼─{'─'*12}─┼─{'─'*12}")
    print(f"  {'Total Return':<22} | {'+37.4%':>18} | {full_stats_strict['total_return_pct']:>+11.1f}% | {full_stats_relaxed['total_return_pct']:>+11.1f}%")
    print(f"  {'Profit Factor':<22} | {'1.53':>18} | {full_stats_strict['profit_factor']:>12.2f} | {full_stats_relaxed['profit_factor']:>12.2f}")
    print(f"  {'Sharpe Ratio':<22} | {'1.27':>18} | {full_stats_strict['sharpe_ratio']:>12.2f} | {full_stats_relaxed['sharpe_ratio']:>12.2f}")
    print(f"  {'Total Trades':<22} | {'N/A':>18} | {full_stats_strict['total_trades']:>12} | {full_stats_relaxed['total_trades']:>12}")
    print(f"  {'Win Rate':<22} | {'N/A':>18} | {full_stats_strict['win_rate']:>11.1f}% | {full_stats_relaxed['win_rate']:>11.1f}%")
    print(f"  {'Max Drawdown':<22} | {'N/A':>18} | {full_stats_strict['max_drawdown_pct']:>11.2f}% | {full_stats_relaxed['max_drawdown_pct']:>11.2f}%")
    print(f"  {'Avg R-Multiple':<22} | {'N/A':>18} | {full_stats_strict['avg_r_multiple']:>12.3f} | {full_stats_relaxed['avg_r_multiple']:>12.3f}")
    print()

    # ══════════════════════════════════════════════════════════════
    # SECTION 4: WALK-FORWARD RESULTS
    # ══════════════════════════════════════════════════════════════
    print(line)
    print("  WALK-FORWARD RESULTS (RELAXED FILTER)")
    print(line)
    print()
    hdr = f"  {'Window':<7} | {'Period':<22} | {'Trades':>6} | {'WR%':>5} | {'PF':>5} | {'Return':>7} | {'Sharpe':>6} | {'MaxDD':>6}"
    print(hdr)
    print(f"  {'─'*7}─┼─{'─'*22}─┼─{'─'*6}─┼─{'─'*5}─┼─{'─'*5}─┼─{'─'*7}─┼─{'─'*6}─┼─{'─'*6}")
    for wid, wr in sorted(window_results_relaxed.items()):
        # Find matching window for period info
        w_info = next((w for w in WINDOWS if w['id'] == wid), None)
        if w_info:
            period = f"{w_info['test_start']} → {w_info['test_end']}"
        else:
            period = "N/A"
        print(f"  {wid:<7} | {period:<22} | {wr['total_trades']:>6} | {wr['win_rate']:>5.1f} | "
              f"{wr['profit_factor']:>5.2f} | {wr['total_return_pct']:>+6.1f}% | "
              f"{wr['sharpe_ratio']:>6.2f} | {wr['max_drawdown_pct']:>5.1f}%")
    print()

    # ══════════════════════════════════════════════════════════════
    # SECTION 5: EGX30 GATE 0 ANALYSIS
    # ══════════════════════════════════════════════════════════════
    print(line)
    print("  EGX30 GATE 0 — REGIME BLOCKING ANALYSIS")
    print(line)
    print()
    trading_dates = [b.date for b in egx30_bars if FULL_START <= b.date <= FULL_END]
    regime_day_counts = defaultdict(int)
    for d in trading_dates:
        stage, name = get_regime_at_date(egx30_bars, d)
        regime_day_counts[f"Stage {stage} ({name})"] += 1

    print(f"  Total trading days: {len(trading_dates)}")
    print(f"  Days blocked by EGX30 Stage 4: {full_stats_relaxed['regime_blocked_days']}")
    print(f"  Days allowed: {len(trading_dates) - full_stats_relaxed['regime_blocked_days']}")
    print()
    print(f"  Regime distribution:")
    for regime, count in sorted(regime_day_counts.items()):
        pct = count / len(trading_dates) * 100 if trading_dates else 0
        print(f"    {regime}: {count} days ({pct:.1f}%)")
    print()

    # ══════════════════════════════════════════════════════════════
    # SECTION 6: EXIT TYPE DISTRIBUTION
    # ══════════════════════════════════════════════════════════════
    print(line)
    print("  EXIT TYPE DISTRIBUTION (Relaxed Filter)")
    print(line)
    print()
    exit_counts = full_stats_relaxed.get('exit_type_counts', {})
    total_trades = max(full_stats_relaxed['total_trades'], 1)
    for etype, count in sorted(exit_counts.items(), key=lambda x: -x[1]):
        pct = count / total_trades * 100
        print(f"  {etype:<20}: {count:>4} trades ({pct:>5.1f}%)")
    print()

    # ══════════════════════════════════════════════════════════════
    # SECTION 7: GATE REJECTION ANALYSIS
    # ══════════════════════════════════════════════════════════════
    print(line)
    print("  GATE REJECTION ANALYSIS (Strict Filter)")
    print(line)
    print()
    gate_rej = full_stats_strict.get('gate_rejections', {})
    total_rejections = sum(gate_rej.values()) if gate_rej else 0
    if total_rejections > 0:
        gate_order = ['egx30_regime', 'liquidity', 'trend', 'sr_position', 'risk_reward', 'confirmation', 'insufficient_data']
        print(f"  Total gate rejections: {total_rejections:,}")
        print()
        print(f"  {'Gate':<20} | {'Rejections':>10} | {'% of Total':>10}")
        print(f"  {'─'*20}─┼─{'─'*10}─┼─{'─'*10}")
        for gate in gate_order:
            if gate in gate_rej:
                count = gate_rej[gate]
                pct = count / total_rejections * 100
                bar = '█' * int(pct / 2)
                print(f"  {gate:<20} | {count:>10,} | {pct:>9.1f}% {bar}")
    print()

    # ══════════════════════════════════════════════════════════════
    # SECTION 8: R-MULTIPLE DISTRIBUTION
    # ══════════════════════════════════════════════════════════════
    print(line)
    print("  R-MULTIPLE ANALYSIS (Relaxed Filter)")
    print(line)
    print()
    trades = full_trades_relaxed
    if trades:
        r_mults = [t.r_multiple for t in trades]
        r_bins = {'< -1.0': 0, '-1.0 to -0.5': 0, '-0.5 to 0': 0, '0 to 0.5': 0,
                  '0.5 to 1.0': 0, '1.0 to 2.0': 0, '2.0 to 3.0': 0, '> 3.0': 0}
        for r in r_mults:
            if r < -1.0: r_bins['< -1.0'] += 1
            elif r < -0.5: r_bins['-1.0 to -0.5'] += 1
            elif r < 0: r_bins['-0.5 to 0'] += 1
            elif r < 0.5: r_bins['0 to 0.5'] += 1
            elif r < 1.0: r_bins['0.5 to 1.0'] += 1
            elif r < 2.0: r_bins['1.0 to 2.0'] += 1
            elif r < 3.0: r_bins['2.0 to 3.0'] += 1
            else: r_bins['> 3.0'] += 1

        print(f"  Avg R-Multiple: {full_stats_relaxed['avg_r_multiple']:.3f}")
        print(f"  Median R-Multiple: {sorted(r_mults)[len(r_mults)//2]:.3f}")
        print(f"  Best R: {max(r_mults):.3f} | Worst R: {min(r_mults):.3f}")
        print()
        print(f"  {'R-Multiple Range':<18} | {'Count':>6} | {'%':>6}")
        print(f"  {'─'*18}─┼─{'─'*6}─┼─{'─'*6}")
        for bin_name, count in r_bins.items():
            pct = count / len(r_mults) * 100
            bar = '█' * int(pct / 2)
            print(f"  {bin_name:<18} | {count:>6} | {pct:>5.1f}% {bar}")
    print()

    # ══════════════════════════════════════════════════════════════
    # SECTION 9: MONTH-BY-MONTH BREAKDOWN
    # ══════════════════════════════════════════════════════════════
    print(line)
    print("  MONTH-BY-MONTH RETURN BREAKDOWN (Relaxed Filter)")
    print(line)
    print()
    if trades:
        monthly_pnl = defaultdict(float)
        monthly_trades = defaultdict(int)
        monthly_wins = defaultdict(int)
        for t in trades:
            month = t.exit_date[:7]
            monthly_pnl[month] += t.pnl
            monthly_trades[month] += 1
            if t.pnl > 0:
                monthly_wins[month] += 1

        print(f"  {'Month':<9} | {'Trades':>6} | {'Wins':>5} | {'WR%':>5} | {'P&L (EGP)':>12} | {'Cumulative':>10}")
        print(f"  {'─'*9}─┼─{'─'*6}─┼─{'─'*5}─┼─{'─'*5}─┼─{'─'*12}─┼─{'─'*10}")

        cum_pnl = 0
        for month in sorted(monthly_pnl.keys()):
            cum_pnl += monthly_pnl[month]
            wr = monthly_wins[month] / monthly_trades[month] * 100 if monthly_trades[month] > 0 else 0
            print(f"  {month:<9} | {monthly_trades[month]:>6} | {monthly_wins[month]:>5} | "
                  f"{wr:>5.1f} | {monthly_pnl[month]:>+12,.2f} | {cum_pnl:>+10,.2f}")
    print()

    # ══════════════════════════════════════════════════════════════
    # SECTION 10: TOP TRADES
    # ══════════════════════════════════════════════════════════════
    print(line)
    print("  TOP 10 BEST & WORST TRADES (Relaxed Filter)")
    print(line)
    print()
    if trades:
        best = sorted(trades, key=lambda t: -t.r_multiple)[:10]
        worst = sorted(trades, key=lambda t: t.r_multiple)[:10]

        print(f"  ── BEST ──")
        print(f"  {'#':>2} | {'Ticker':<8} | {'Entry':<11} | {'Exit':<11} | {'R':>7} | {'P&L%':>7} | {'Days':>4} | {'Exit':<15}")
        print(f"  {'─'*2}─┼─{'─'*8}─┼─{'─'*11}─┼─{'─'*11}─┼─{'─'*7}─┼─{'─'*7}─┼─{'─'*4}─┼─{'─'*15}")
        for i, t in enumerate(best, 1):
            print(f"  {i:>2} | {t.ticker:<8} | {t.entry_date:<11} | {t.exit_date:<11} | "
                  f"{t.r_multiple:>+7.3f} | {t.pnl_pct:>+7.2f} | {t.holding_days:>4} | {t.exit_type:<15}")

        print()
        print(f"  ── WORST ──")
        print(f"  {'#':>2} | {'Ticker':<8} | {'Entry':<11} | {'Exit':<11} | {'R':>7} | {'P&L%':>7} | {'Days':>4} | {'Exit':<15}")
        print(f"  {'─'*2}─┼─{'─'*8}─┼─{'─'*11}─┼─{'─'*11}─┼─{'─'*7}─┼─{'─'*7}─┼─{'─'*4}─┼─{'─'*15}")
        for i, t in enumerate(worst, 1):
            print(f"  {i:>2} | {t.ticker:<8} | {t.entry_date:<11} | {t.exit_date:<11} | "
                  f"{t.r_multiple:>+7.3f} | {t.pnl_pct:>+7.2f} | {t.holding_days:>4} | {t.exit_type:<15}")
    print()

    # ══════════════════════════════════════════════════════════════
    # SECTION 11: REGIME PERFORMANCE
    # ══════════════════════════════════════════════════════════════
    print(line)
    print("  PERFORMANCE BY EGX30 REGIME STAGE (Relaxed Filter)")
    print(line)
    print()
    if trades:
        regime_trades = defaultdict(list)
        for t in trades:
            regime_trades[f"Stage {t.regime_stage} ({t.regime_name})"].append(t)

        print(f"  {'Regime':<25} | {'Trades':>6} | {'WR%':>5} | {'PF':>5} | {'Avg R':>7} | {'P&L':>12}")
        print(f"  {'─'*25}─┼─{'─'*6}─┼─{'─'*5}─┼─{'─'*5}─┼─{'─'*7}─┼─{'─'*12}")
        for regime, rtrades in sorted(regime_trades.items()):
            wins = [t for t in rtrades if t.pnl > 0]
            losses = [t for t in rtrades if t.pnl <= 0]
            wr = len(wins) / len(rtrades) * 100 if rtrades else 0
            total_w = sum(t.pnl for t in wins)
            total_l = abs(sum(t.pnl for t in losses))
            pf = total_w / total_l if total_l > 0 else 999
            avg_r = sum(t.r_multiple for t in rtrades) / len(rtrades) if rtrades else 0
            total_pnl = sum(t.pnl for t in rtrades)
            print(f"  {regime:<25} | {len(rtrades):>6} | {wr:>5.1f} | {pf:>5.2f} | "
                  f"{avg_r:>+7.3f} | {total_pnl:>+12,.2f}")
    print()

    print(line)
    print("  END OF REPORT")
    print(line)


# ═══════════════════════════════════════════════════════════════
#  MAIN
# ═══════════════════════════════════════════════════════════════

def main():
    W = 78
    line = "═" * W

    print()
    print(line)
    print("  PRODUCTION BACKTEST — TREND-FOLLOWING + EGX30 REGIME FILTER")
    print("  Task ID: 31")
    print(line)

    # Load data — scan ALL available tickers, not just 19
    print()
    print("  Loading price data ...")
    all_data = load_all_data(DB_PATH)
    egx30_bars = load_egx30_data(DB_PATH)

    loaded_tickers = list(all_data.keys())
    print(f"  Loaded {len(loaded_tickers)} tickers "
          f"({sum(len(v) for v in all_data.values()):,} bars total)")

    for ticker in list(all_data.keys())[:5]:
        bars = all_data[ticker]
        print(f"    {ticker}: {bars[0].date} to {bars[-1].date} ({len(bars)} bars)")
    if len(loaded_tickers) > 5:
        print(f"    ... and {len(loaded_tickers) - 5} more")

    print(f"  EGX30: {egx30_bars[0].date} to {egx30_bars[-1].date} ({len(egx30_bars)} bars)")

    # Verify against production
    verify_against_production(egx30_bars)

    # ── RUN 1: STRICT PRODUCTION FILTER ──
    print()
    print("  ═══ Running STRICT production filter (6/6 gates) ═══")
    full_trades_strict, full_rej_strict, full_stats_strict = run_backtest(
        all_data, egx30_bars,
        start_date=FULL_START, end_date=FULL_END,
        min_gates=6, vol_spike_min=1.5, adx_min=25,
    )
    print(f"  → {full_stats_strict['total_trades']} trades, Return: {full_stats_strict['total_return_pct']:+.1f}%, PF: {full_stats_strict['profit_factor']:.2f}")

    # Walk-forward (strict)
    window_results_strict = {}
    for w in WINDOWS:
        _, _, stats = run_backtest(
            all_data, egx30_bars,
            start_date=w['test_start'], end_date=w['test_end'],
            min_gates=6, vol_spike_min=1.5, adx_min=25,
        )
        window_results_strict[w['id']] = stats
        print(f"  Window {w['id']}: {stats['total_trades']} trades, Return: {stats['total_return_pct']:+.1f}%")

    # ── RUN 2: RELAXED FILTER ──
    print()
    print("  ═══ Running RELAXED filter (4+/6 gates, Vol ≥ 1.2x, ADX > 20) ═══")
    full_trades_relaxed, full_rej_relaxed, full_stats_relaxed = run_backtest(
        all_data, egx30_bars,
        start_date=FULL_START, end_date=FULL_END,
        min_gates=4, vol_spike_min=1.2, adx_min=20, relaxed=True,
    )
    print(f"  → {full_stats_relaxed['total_trades']} trades, Return: {full_stats_relaxed['total_return_pct']:+.1f}%, PF: {full_stats_relaxed['profit_factor']:.2f}")

    # Walk-forward (relaxed)
    window_results_relaxed = {}
    for w in WINDOWS:
        _, _, stats = run_backtest(
            all_data, egx30_bars,
            start_date=w['test_start'], end_date=w['test_end'],
            min_gates=4, vol_spike_min=1.2, adx_min=20, relaxed=True,
        )
        window_results_relaxed[w['id']] = stats
        print(f"  Window {w['id']}: {stats['total_trades']} trades, Return: {stats['total_return_pct']:+.1f}%")

    # Print comprehensive report
    print_full_report(
        full_stats_strict, full_stats_relaxed,
        full_trades_strict, full_trades_relaxed,
        full_rej_strict,
        egx30_bars,
        window_results_strict, window_results_relaxed,
        all_data,
    )


if __name__ == "__main__":
    logging.basicConfig(level=logging.WARNING)
    main()
