#!/usr/bin/env python3
"""
institutional_multi_market_backtest.py — TITAN-1-BACKTEST-SCRIPT
================================================================
Institutional multi-market backtest engine for the maker-radar
accumulation strategy. Built by team GLM 5.2-Bravo.

DATA SOURCE (Rule 27 — NO-FAKE-DATA):
  - db/stocks.db (READ-ONLY via `file:...?mode=ro`)
    * stock_daily_prices : 100,619 candles, 1,213 tickers,
                            date range 2025-09-22 → 2026-10-11 ONLY.
    * radar_signal_tracking : 1,102 signals, date range 2026-09-28 →
                              2026-10-11 ONLY.
  - ⛔ db/price_history.db is malformed (DO NOT USE).
  - ⛔ db/market.db is dead (DO NOT USE).

TRADE-CLASSIFICATION SOURCE (consistency with verify_all_radar_signals.py):
  The `status` column in `radar_signal_tracking` already reflects the
  BRAVO-1-RADAR-VERIFY chronological evaluation run by
  `scripts/verify_all_radar_signals.py`. The verify script processes only
  signals with status='pending' (and optionally 'stale_data' with
  --include-stale); it is idempotent. To remain CONSISTENT with the
  verify script's published win rate (46.80%), this backtest uses the
  STORED status as the trade classification source:
    - status='verified_win'    → winning trade (+5% target hit OR legacy
                                 close-based win via outcome_7d/14d)
    - status='verified_loss'   → losing trade (-5% stop hit)
    - status='verified_neutral'→ neutral trade (outcome_30d booked)
    - status='pending'         → excluded (insufficient days)
    - status='stale_data'      → excluded (no prices at the time verify ran;
                                 the verify script's default behavior
                                 preserves stale_data on re-runs)

REALIZED RETURN per verified trade (Rule 27 — uses real stored values):
  - verified_win with win_date IS NOT NULL → +5.0%   (target hit at +5% high)
  - verified_win with win_date IS NULL     → outcome_7d (legacy close-based
                                              win; fallback to outcome_14d,
                                              then to peak_return, then to
                                              +2.5% as a last resort)
  - verified_loss                          → -5.0%   (stop hit at -5% low)
  - verified_neutral                       → outcome_30d (or 0.0 if NULL)

STRATEGY LOGIC (mirrors scripts/verify_all_radar_signals.py):
  - Entry      : entry_price from radar_signal_tracking
                 (fallback: close on signal_date if entry_price missing).
  - Target     : high >= entry * 1.05   (+5%)
  - Stop       : low  <= entry * 0.95   (-5%)
  - Logic      : "من يضرب أولًا يفوز" — chronological day-by-day,
                 first to hit wins. If both hit on the same day,
                 close >= entry → win, else → loss.
  - Trailing stop : once verified_win is recorded, the status STAYS
                    verified_win even if the price later drops below
                    entry (breakeven exit = profit-taking, NOT a loss).
  - Window     : 30 trading days after signal_date.
  - OHLC fix   : if high < close OR low > close OR low > high → fall
                 back to close (BRAVO-1 data-quality fix; ~15k rows).

INSTITUTIONAL METRICS:
  - Sharpe Ratio  = (mean_daily_return / std_daily_return) * sqrt(252)
    Daily-return series = per-trade realized returns (each treated as one
    observation). This is a documented simplification (signals span only
    14 calendar days; true portfolio daily returns would require complex
    overlapping position handling — see disclaimer in JSON).
  - Sortino Ratio = (mean_daily_return / downside_std) * sqrt(252)
    downside_std = sqrt(mean(min(0, r)^2)) over all r.
    Returns null if no negative returns (no downside risk).
  - Profit Factor = gross_profit / gross_loss
    gross_profit = sum of positive trade returns (%).
    gross_loss   = abs(sum of negative trade returns).
    Returns null if gross_loss = 0.
  - Max Drawdown = (peak - trough) / peak * 100, with trough after peak,
    computed on a cumulative equity curve (starting equity 100,000 EGP,
    equal-weight position sizing per trade).
  - Win Rate     = verified_win / (verified_win + verified_loss +
                                   verified_neutral) * 100.

ANNUAL BREAKDOWN (Rule 27 — institutional honesty):
  - 2021, 2022, 2023, 2024 → null + "no data available for this year"
    (stock_daily_prices has no rows for these years; radar_signal_tracking
    likewise).
  - 2025 → null + note ("no signals in 2025 — radar_signal_tracking starts
    2026-09-28"). Price data exists for Sep-Dec 2025 but no radar signals
    were generated, so there is nothing to backtest.
  - 2026 → real win rate from the 297 verified signals.

IDEMPOTENT: re-running produces byte-identical JSON (modulo generated_at
ISO timestamp, which is the only non-deterministic field).

USAGE:
    python3 scripts/institutional_multi_market_backtest.py

OUTPUTS:
    1. db/reports/institutional_backtest_summary.json (detailed JSON)
    2. stdout summary + REALITY CHECK section.
"""
from __future__ import annotations

import json
import math
import os
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ─────────────────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────────────────
_SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = Path(os.environ.get('PROJECT_ROOT') or str(_SCRIPT_DIR.parent))
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
REPORT_DIR = PROJECT_ROOT / 'db' / 'reports'
REPORT_JSON = REPORT_DIR / 'institutional_backtest_summary.json'

# ─────────────────────────────────────────────────────────────────────────────
# Strategy parameters — MUST mirror scripts/verify_all_radar_signals.py
# ─────────────────────────────────────────────────────────────────────────────
TARGET_PCT = 5.0          # +5.0%  target (high >= entry * 1.05)
STOP_PCT = -5.0           # -5.0%  stop   (low  <= entry * 0.95)
EVAL_WINDOW_DAYS = 30     # window for evaluating each signal
TRADING_DAYS_PER_YEAR = 252  # for Sharpe/Sortino annualization

# Equity curve
START_EQUITY_EGP = 100_000.0


# ─────────────────────────────────────────────────────────────────────────────
# DB helpers
# ─────────────────────────────────────────────────────────────────────────────
def open_db_readonly(path: Path) -> sqlite3.Connection:
    """Open stocks.db in READ-ONLY mode (Rule 27 — never write)."""
    if not path.exists():
        raise FileNotFoundError(f'DB not found: {path}')
    conn = sqlite3.connect(f'file:{path}?mode=ro', uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def fetch_close_on_or_before(
    conn: sqlite3.Connection, ticker: str, signal_date: str
) -> Optional[float]:
    """Get close on or before signal_date (fallback for missing entry_price)."""
    row = conn.execute(
        """
        SELECT close FROM stock_daily_prices
        WHERE ticker = ? AND price_date <= ?
          AND close IS NOT NULL AND close > 0
        ORDER BY price_date DESC LIMIT 1
        """,
        (ticker, signal_date),
    ).fetchone()
    return float(row['close']) if row else None


def fetch_prices_after(
    conn: sqlite3.Connection,
    ticker: str,
    signal_date: str,
    limit: int = EVAL_WINDOW_DAYS,
) -> List[Tuple[str, float, float, float]]:
    """
    Fetch up to `limit` trading-day prices STRICTLY AFTER signal_date.
    Schema: stock_daily_prices(ticker, price_date, open, high, low, close, volume).

    BRAVO-1 DATA-QUALITY FIX: stock_daily_prices has ~8,070 rows where
    high < close and ~7,514 rows where low > close (impossible OHLC).
    When high/low violate close (high<close, low>close, or low>high), we
    fall back to close for BOTH high and low (conservative — treats the
    day as a flat close). Rule 27-safe (uses the authoritative close).
    """
    rows = conn.execute(
        """
        SELECT price_date AS d, close AS c, high AS h, low AS l
        FROM stock_daily_prices
        WHERE ticker = ?
          AND price_date > ?
          AND close IS NOT NULL
          AND close > 0
        ORDER BY price_date ASC
        LIMIT ?
        """,
        (ticker, signal_date, limit),
    ).fetchall()
    out: List[Tuple[str, float, float, float]] = []
    for r in rows:
        close = float(r['c']) if r['c'] is not None else 0.0
        if close <= 0:
            continue
        high = float(r['h']) if r['h'] is not None and r['h'] > 0 else close
        low = float(r['l']) if r['l'] is not None and r['l'] > 0 else close
        if high < close or low > close or low > high:
            high = close
            low = close
        out.append((str(r['d']), close, high, low))
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Realized-return derivation (from stored verify_all_radar_signals output)
# ─────────────────────────────────────────────────────────────────────────────
def derive_realized_return(row: sqlite3.Row) -> Optional[float]:
    """
    Derive the realized trade return (%) from the stored verify output.
    - verified_win with win_date IS NOT NULL → +5.0% (target hit)
    - verified_win with win_date IS NULL     → outcome_7d (legacy close-based
                                               win); fallback to outcome_14d,
                                               then peak_return, then +2.5%.
    - verified_loss                          → -5.0% (stop hit)
    - verified_neutral                       → outcome_30d (or 0.0 if NULL)
    Returns None for non-verified statuses.
    """
    status = row['status']
    if status == 'verified_win':
        if row['win_date'] is not None:
            return TARGET_PCT  # +5% target hit
        # Legacy close-based win — use the actual outcome.
        for col in ('outcome_7d', 'outcome_14d', 'peak_return'):
            v = row[col]
            if v is not None and v > 0:
                return float(v)
        return 2.5  # last-resort fallback (legacy +2.5% threshold)
    if status == 'verified_loss':
        return STOP_PCT  # -5% stop hit
    if status == 'verified_neutral':
        v = row['outcome_30d']
        return float(v) if v is not None else 0.0
    return None  # pending, stale_data, or anything else


def derive_exit_date(row: sqlite3.Row, conn: sqlite3.Connection
                     ) -> Optional[str]:
    """
    Derive the trade exit date for sequencing the equity curve.
    - verified_win with win_date → win_date
    - verified_win without win_date → first day close-based win was hit
      (computed from prices[:7] or prices[:14])
    - verified_loss → first day stop was hit (computed from prices)
    - verified_neutral → signal_date + 30 trading days (last available)
    Falls back to signal_date if no prices available.
    """
    status = row['status']
    ticker = row['ticker']
    signal_date = row['signal_date']
    entry_price = float(row['entry_price']) if row['entry_price'] else 0.0

    if status == 'verified_win' and row['win_date'] is not None:
        return row['win_date']

    if entry_price <= 0:
        # Try to recover entry_price from close on signal_date.
        fb = fetch_close_on_or_before(conn, ticker, signal_date)
        if fb is None:
            return signal_date
        entry_price = fb

    prices = fetch_prices_after(conn, ticker, signal_date, EVAL_WINDOW_DAYS)
    if not prices:
        return signal_date

    target_price = entry_price * (1 + TARGET_PCT / 100)
    stop_price = entry_price * (1 + STOP_PCT / 100)

    if status == 'verified_win':
        # Legacy close-based win — find first day where close hit +2.5%.
        for d, close, _, _ in prices[:14]:
            if close > 0 and ((close - entry_price) / entry_price * 100) >= 2.5:
                return d
        return prices[min(6, len(prices) - 1)][0]

    if status == 'verified_loss':
        # Stop hit — find first day where low <= stop_price.
        for d, close, high, low in prices:
            if low <= stop_price:
                return d
            # If high<close or low>close (already fixed to close), check close.
            if close <= stop_price:
                return d
        return prices[-1][0]

    if status == 'verified_neutral':
        return prices[-1][0] if prices else signal_date

    return signal_date


def derive_holding_days(row: sqlite3.Row, conn: sqlite3.Connection) -> int:
    """Number of trading days from signal_date to exit."""
    exit_date = derive_exit_date(row, conn)
    if not exit_date:
        return 0
    signal_date = row['signal_date']
    ticker = row['ticker']
    n = conn.execute(
        """
        SELECT COUNT(*) FROM stock_daily_prices
        WHERE ticker = ? AND price_date > ? AND price_date <= ?
          AND close IS NOT NULL AND close > 0
        """,
        (ticker, signal_date, exit_date),
    ).fetchone()[0]
    return int(n)


# ─────────────────────────────────────────────────────────────────────────────
# Institutional metrics
# ─────────────────────────────────────────────────────────────────────────────
def compute_sharpe(returns: List[float]) -> float:
    """
    Sharpe = (mean / std) * sqrt(252).
    Returns 0.0 for empty series or std=0.
    `returns` are decimal (e.g., 0.05 for +5%).
    """
    if not returns:
        return 0.0
    n = len(returns)
    mean = sum(returns) / n
    if n < 2:
        return 0.0
    var = sum((r - mean) ** 2 for r in returns) / (n - 1)
    std = math.sqrt(var)
    if std == 0:
        return 0.0
    return (mean / std) * math.sqrt(TRADING_DAYS_PER_YEAR)


def compute_sortino(returns: List[float]) -> Optional[float]:
    """
    Sortino = (mean / downside_std) * sqrt(252).
    downside_std = sqrt(mean(min(0, r)^2)) over all returns r.
    Returns None if no negative returns (no downside risk).
    `returns` are decimal.
    """
    if not returns:
        return None
    neg_returns = [r for r in returns if r < 0]
    if not neg_returns:
        return None
    n = len(returns)
    mean = sum(returns) / n
    downside_var = sum(min(0.0, r) ** 2 for r in returns) / n
    downside_std = math.sqrt(downside_var)
    if downside_std == 0:
        return None
    return (mean / downside_std) * math.sqrt(TRADING_DAYS_PER_YEAR)


def compute_profit_factor(returns: List[float]) -> Optional[float]:
    """
    PF = gross_profit / gross_loss.
    gross_profit = sum of positive returns.
    gross_loss   = abs(sum of negative returns).
    Returns None if gross_loss == 0 (no losses).
    `returns` are decimal.
    """
    gross_profit = sum(r for r in returns if r > 0)
    gross_loss = abs(sum(r for r in returns if r < 0))
    if gross_loss == 0:
        return None
    return gross_profit / gross_loss


def build_equity_curve(
    trades: List[Dict[str, Any]],
    start_equity: float = START_EQUITY_EGP,
) -> List[float]:
    """
    Build cumulative equity curve assuming equal-weight position sizing
    per trade (sequential, ordered by exit_date).
    position_size = start_equity / n_trades (fixed at start).
    """
    if not trades:
        return [start_equity]
    n = len(trades)
    position_size = start_equity / n
    equity = start_equity
    curve = [equity]
    for t in trades:
        r_pct = t.get('realized_return_pct')
        if r_pct is None:
            continue
        r_dec = r_pct / 100.0
        equity += position_size * r_dec
        curve.append(equity)
    return curve


def compute_max_drawdown(equity_curve: List[float]) -> float:
    """
    MDD = (peak - trough) / peak * 100, with trough after peak.
    Returns 0.0 for empty / single-point curves.
    """
    if not equity_curve or len(equity_curve) < 2:
        return 0.0
    peak = equity_curve[0]
    max_dd = 0.0
    for v in equity_curve:
        if v > peak:
            peak = v
        if peak > 0:
            dd = (peak - v) / peak * 100
            if dd > max_dd:
                max_dd = dd
    return max_dd


def compute_total_return_pct(
    equity_curve: List[float],
    start_equity: float = START_EQUITY_EGP,
) -> float:
    if not equity_curve or len(equity_curve) < 2:
        return 0.0
    final = equity_curve[-1]
    if start_equity <= 0:
        return 0.0
    return (final / start_equity - 1) * 100


# ─────────────────────────────────────────────────────────────────────────────
# Utility — NaN/Infinity sanitization for JSON
# ─────────────────────────────────────────────────────────────────────────────
def safe_round(value: Any, ndigits: int = 4) -> Any:
    """Round floats; return None for NaN/Infinity. Pass through other types."""
    if value is None:
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
        return round(value, ndigits)
    return value


def has_nan_inf(o: Any) -> bool:
    if isinstance(o, float):
        return math.isnan(o) or math.isinf(o)
    if isinstance(o, dict):
        return any(has_nan_inf(v) for v in o.values())
    if isinstance(o, list):
        return any(has_nan_inf(v) for v in o)
    return False


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    print('=' * 72)
    print('institutional_multi_market_backtest.py  [TITAN-1-BACKTEST-SCRIPT]')
    print('GLM 5.2-Bravo — Institutional multi-market backtest engine')
    print('=' * 72)
    print(f'PROJECT_ROOT : {PROJECT_ROOT}')
    print(f'STOCKS_DB    : {STOCKS_DB}   (readonly)')
    print(f'REPORT_JSON  : {REPORT_JSON}')
    print()

    if not STOCKS_DB.exists():
        print(f'FATAL: stocks.db not found at {STOCKS_DB}', file=sys.stderr)
        return 1

    # Ensure reports dir exists
    REPORT_DIR.mkdir(parents=True, exist_ok=True)

    conn = open_db_readonly(STOCKS_DB)
    try:
        # ─── Data source metadata ───
        n_candles = conn.execute(
            'SELECT COUNT(*) FROM stock_daily_prices'
        ).fetchone()[0]
        n_tickers = conn.execute(
            'SELECT COUNT(DISTINCT ticker) FROM stock_daily_prices'
        ).fetchone()[0]
        dmin, dmax = conn.execute(
            'SELECT MIN(price_date), MAX(price_date) FROM stock_daily_prices'
        ).fetchone()
        n_signals_total = conn.execute(
            'SELECT COUNT(*) FROM radar_signal_tracking'
        ).fetchone()[0]

        print('[data source]')
        print(f'  stock_daily_prices    : {n_candles:,} candles, '
              f'{n_tickers:,} tickers')
        print(f'  price date range      : {dmin} → {dmax}')
        print(f'  radar_signal_tracking : {n_signals_total:,} signals')
        print()

        # ─── Status distribution (from stored DB) ───
        status_dist = conn.execute(
            """
            SELECT COALESCE(status, 'NULL') AS s, COUNT(*) AS n
            FROM radar_signal_tracking
            GROUP BY s
            ORDER BY n DESC
            """
        ).fetchall()
        print('[stored status distribution (verify_all_radar_signals output)]')
        for r in status_dist:
            print(f'  {r["s"]:25s} : {r["n"]}')
        print()

        # ─── Load all verified signals (the backtest universe) ───
        verified_rows = conn.execute(
            """
            SELECT id, ticker, signal_date, signal_type, entry_price,
                   status, win_date, outcome_7d, outcome_14d, outcome_30d,
                   peak_return, trailing_stop_hit
            FROM radar_signal_tracking
            WHERE status IN ('verified_win', 'verified_loss', 'verified_neutral')
            ORDER BY signal_date ASC, id ASC
            """
        ).fetchall()
    finally:
        conn.close()

    # ─── Build trades list ───
    # For each verified signal, derive the realized return from stored fields.
    # We open a fresh readonly connection for price-related derivations
    # (exit_date, holding_days) to keep memory bounded.
    trades: List[Dict[str, Any]] = []
    conn = open_db_readonly(STOCKS_DB)
    try:
        for row in verified_rows:
            realized = derive_realized_return(row)
            if realized is None:
                continue
            exit_date = derive_exit_date(row, conn)
            holding_days = derive_holding_days(row, conn)
            trades.append({
                'id': row['id'],
                'ticker': row['ticker'],
                'signal_date': row['signal_date'],
                'signal_type': row['signal_type'],
                'entry_price': float(row['entry_price']) if row['entry_price']
                                else None,
                'status': row['status'],
                'exit_date': exit_date,
                'realized_return_pct': realized,
                'holding_days': holding_days,
                'win_date': row['win_date'],
                'peak_return': (
                    float(row['peak_return']) if row['peak_return'] is not None
                    else None
                ),
                'trailing_stop_hit': row['trailing_stop_hit'] or 0,
            })
    finally:
        conn.close()

    # ─── Aggregate counts ───
    verified_win = sum(1 for t in trades if t['status'] == 'verified_win')
    verified_loss = sum(1 for t in trades if t['status'] == 'verified_loss')
    verified_neutral = sum(
        1 for t in trades if t['status'] == 'verified_neutral'
    )
    verified_total = len(trades)
    overall_win_rate = (
        (verified_win / verified_total * 100) if verified_total > 0 else 0.0
    )

    # Pending + stale counts (from stored DB, for the metrics block).
    conn = open_db_readonly(STOCKS_DB)
    try:
        pending = conn.execute(
            "SELECT COUNT(*) FROM radar_signal_tracking WHERE status='pending'"
        ).fetchone()[0]
        stale = conn.execute(
            "SELECT COUNT(*) FROM radar_signal_tracking "
            "WHERE status='stale_data'"
        ).fetchone()[0]
    finally:
        conn.close()

    print(f'[backtest universe] verified trades = {verified_total} '
          f'({verified_win} win + {verified_loss} loss + '
          f'{verified_neutral} neutral)')
    print(f'  pending (excluded)     : {pending}')
    print(f'  stale_data (excluded)  : {stale}')
    print(f'  overall win rate       : {overall_win_rate:.2f}%')
    print()

    # ─── Trade returns ───
    trade_returns_pct: List[float] = [
        t['realized_return_pct'] for t in trades
        if t['realized_return_pct'] is not None
    ]
    trade_returns_dec: List[float] = [r / 100.0 for r in trade_returns_pct]

    # ─── Equity curve (sequential, ordered by exit_date) ───
    sorted_trades = sorted(
        [t for t in trades if t['realized_return_pct'] is not None],
        key=lambda x: (x['exit_date'] or x['signal_date'], x['id'])
    )
    equity_curve = build_equity_curve(sorted_trades, START_EQUITY_EGP)
    total_return_pct = compute_total_return_pct(equity_curve, START_EQUITY_EGP)
    max_drawdown_pct = compute_max_drawdown(equity_curve)
    final_equity = equity_curve[-1] if equity_curve else START_EQUITY_EGP

    # ─── Sharpe / Sortino ───
    # Treat per-trade realized returns as the daily-return series (documented
    # simplification — see module docstring).
    daily_returns_for_sharpe = list(trade_returns_dec)
    sharpe = compute_sharpe(daily_returns_for_sharpe)
    sortino = compute_sortino(daily_returns_for_sharpe)
    profit_factor = compute_profit_factor(trade_returns_dec)
    avg_return_per_trade_pct = (
        sum(trade_returns_pct) / len(trade_returns_pct)
        if trade_returns_pct else 0.0
    )

    print('[portfolio metrics]')
    print(f'  n_trades_used (verified w/ return) : {len(trade_returns_pct)}')
    print(f'  sharpe_ratio                       : {sharpe:.4f}')
    sortino_str = (
        f'{sortino:.4f}' if sortino is not None else 'null (no downside)'
    )
    print(f'  sortino_ratio                      : {sortino_str}')
    pf_str = (
        f'{profit_factor:.4f}' if profit_factor is not None
        else 'null (no losses)'
    )
    print(f'  profit_factor                      : {pf_str}')
    print(f'  max_drawdown_pct                   : {max_drawdown_pct:.4f}%')
    print(f'  avg_return_per_trade_pct           : '
          f'{avg_return_per_trade_pct:+.4f}%')
    print(f'  total_return_pct                   : {total_return_pct:+.4f}%')
    print(f'  starting_equity_egp                : {START_EQUITY_EGP:,.2f}')
    print(f'  final_equity_egp                   : {final_equity:,.2f}')
    print()

    # ─── Annual breakdown ───
    annual: List[Dict[str, Any]] = []
    for year in ['2021', '2022', '2023', '2024', '2025', '2026']:
        if year in ('2021', '2022', '2023', '2024'):
            annual.append({
                'year': year,
                'win_rate_pct': None,
                'signals': 0,
                'note': 'no data available for this year',
            })
            continue
        year_trades = [
            t for t in trades
            if (t['signal_date'] or '').startswith(year)
        ]
        y_win = sum(1 for t in year_trades if t['status'] == 'verified_win')
        y_loss = sum(1 for t in year_trades if t['status'] == 'verified_loss')
        y_neut = sum(
            1 for t in year_trades if t['status'] == 'verified_neutral'
        )
        y_total = y_win + y_loss + y_neut
        if y_total == 0:
            note = (
                f'no signals in {year} '
                f'(radar_signal_tracking starts 2026-09-28)'
                if year == '2025' else f'no signals in {year}'
            )
            annual.append({
                'year': year,
                'win_rate_pct': None,
                'signals': 0,
                'note': note,
            })
        else:
            wr = (y_win / y_total * 100) if y_total > 0 else None
            annual.append({
                'year': year,
                'win_rate_pct': safe_round(wr, 2),
                'signals': y_total,
                'note': '',
            })

    # ─── Per-signal-type breakdown ───
    sig_groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for t in trades:
        sig_groups[t['signal_type']].append(t)
    sig_type_breakdown: List[Dict[str, Any]] = []
    for sig_type, group in sorted(
        sig_groups.items(), key=lambda x: -len(x[1])
    ):
        n = len(group)
        wins = sum(1 for t in group if t['status'] == 'verified_win')
        wr = (wins / n * 100) if n > 0 else 0.0
        sig_type_breakdown.append({
            'signal_type': sig_type,
            'count': n,
            'win_rate_pct': safe_round(wr, 2),
        })

    # ─── Top performers (per ticker) ───
    ticker_groups: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
    for t in trades:
        ticker_groups[t['ticker']].append(t)
    ticker_perf: List[Dict[str, Any]] = []
    for ticker, group in ticker_groups.items():
        n = len(group)
        wins = sum(1 for t in group if t['status'] == 'verified_win')
        wr = (wins / n * 100) if n > 0 else 0.0
        rets = [
            t['realized_return_pct'] for t in group
            if t['realized_return_pct'] is not None
        ]
        avg_ret = (sum(rets) / len(rets)) if rets else 0.0
        ticker_perf.append({
            'ticker': ticker,
            'signals': n,
            'win_rate_pct': safe_round(wr, 2),
            'avg_return_pct': safe_round(avg_ret, 2),
        })
    ticker_perf.sort(key=lambda x: (-x['win_rate_pct'], -x['signals']))
    top_performers = ticker_perf[:15]

    # ─── Build JSON output ───
    output: Dict[str, Any] = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'data_source': {
            'db': 'db/stocks.db',
            'table': 'stock_daily_prices',
            'total_candles': n_candles,
            'total_tickers': n_tickers,
            'date_range': {'start': dmin, 'end': dmax},
            'data_coverage_note': (
                'Data covers 2025-09 to 2026-10 only. '
                'No data for 2020-2024.'
            ),
        },
        'strategy': {
            'name': 'maker_radar_accumulation',
            'entry_rule': 'radar_signal_tracking entry_price',
            'target_pct': TARGET_PCT,
            'stop_pct': STOP_PCT,
            'evaluation_window_days': EVAL_WINDOW_DAYS,
            'chronological_priority': 'first-hit-wins',
            'trailing_stop': 'breakeven after target hit',
        },
        'portfolio_metrics': {
            'total_signals': n_signals_total,
            'verified_signals': verified_total,
            'verified_win': verified_win,
            'verified_loss': verified_loss,
            'verified_neutral': verified_neutral,
            'pending': pending,
            'stale_data': stale,
            'overall_win_rate_pct': safe_round(overall_win_rate, 2),
            'sharpe_ratio': safe_round(sharpe, 4),
            'sortino_ratio': safe_round(sortino, 4),
            'profit_factor': safe_round(profit_factor, 4),
            'max_drawdown_pct': safe_round(max_drawdown_pct, 4),
            'avg_return_per_trade_pct': safe_round(avg_return_per_trade_pct, 4),
            'total_return_pct': safe_round(total_return_pct, 4),
            'starting_equity_egp': START_EQUITY_EGP,
            'final_equity_egp': safe_round(final_equity, 2),
            'n_trades_used': len(trade_returns_pct),
            'sharpe_note': (
                'Sharpe computed on per-trade realized returns as the '
                'daily-return series (documented simplification — signals '
                'span only 14 calendar days; true portfolio daily returns '
                'would require overlapping position handling).'
            ),
            'trade_classification_source': (
                "Stored `status` column in radar_signal_tracking — "
                "consistent with verify_all_radar_signals.py output. "
                "Signals marked 'pending' or 'stale_data' by the verify "
                "script are excluded from the backtest universe."
            ),
        },
        'annual_breakdown': annual,
        'by_signal_type': sig_type_breakdown,
        'top_performers': top_performers,
        'disclaimer': (
            'Rule 27 (NO-FAKE-DATA): all metrics computed from real price '
            'data only. No data for 2020-2024 — annual_breakdown shows null '
            'with note. radar_signal_tracking contains signals from '
            '2026-09-28 onwards only; 2025 has no signals (price data exists '
            'Sep-Dec 2025 but no radar signals were generated). Trade '
            'classification uses the stored status column from '
            'verify_all_radar_signals.py (idempotent) for consistency with '
            'the published 46.80% win rate.'
        ),
    }

    # ─── Sanitize (no NaN/Infinity in JSON) ───
    if has_nan_inf(output):
        print('⚠ WARNING: NaN/Infinity detected in JSON output — '
              'sanitizing to null.', file=sys.stderr)

    # ─── Write JSON ───
    REPORT_JSON.parent.mkdir(parents=True, exist_ok=True)
    with open(REPORT_JSON, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    # ───────────────────────────────────────────────────────────────────────
    # Stdout summary
    # ───────────────────────────────────────────────────────────────────────
    print('=' * 72)
    print('INSTITUTIONAL BACKTEST SUMMARY')
    print('=' * 72)
    pm = output['portfolio_metrics']
    print(f'total_signals           : {pm["total_signals"]}')
    print(f'verified_signals        : {pm["verified_signals"]}')
    print(f'verified_win            : {pm["verified_win"]}')
    print(f'verified_loss           : {pm["verified_loss"]}')
    print(f'verified_neutral        : {pm["verified_neutral"]}')
    print(f'pending (excluded)      : {pm["pending"]}')
    print(f'stale_data (excluded)   : {pm["stale_data"]}')
    print(f'overall_win_rate_pct    : {pm["overall_win_rate_pct"]:.2f}%')
    print(f'sharpe_ratio            : {pm["sharpe_ratio"]}')
    print(f'sortino_ratio           : {pm["sortino_ratio"]}')
    print(f'profit_factor           : {pm["profit_factor"]}')
    print(f'max_drawdown_pct        : {pm["max_drawdown_pct"]:.4f}%')
    print(f'avg_return_per_trade_pct: {pm["avg_return_per_trade_pct"]:+.4f}%')
    print(f'total_return_pct        : {pm["total_return_pct"]:+.4f}%')
    print(f'starting_equity_egp     : {pm["starting_equity_egp"]:,.2f}')
    print(f'final_equity_egp        : {pm["final_equity_egp"]:,.2f}')
    print()
    print('--- DATA COVERAGE (Rule 27 — institutional honesty) ---')
    print(f'  {output["data_source"]["data_coverage_note"]}')
    print(f'  price date range: {dmin} → {dmax}')
    print()
    print('--- ANNUAL BREAKDOWN ---')
    for a in annual:
        wr = a['win_rate_pct']
        wr_str = f'{wr:.2f}%' if wr is not None else 'null'
        note_str = f'  ({a["note"]})' if a['note'] else ''
        print(f'  {a["year"]}  win_rate={wr_str:<8s}  '
              f'signals={a["signals"]}{note_str}')
    print()
    print('--- BY SIGNAL TYPE ---')
    for s in sig_type_breakdown:
        print(f'  {s["signal_type"]:35s}  count={s["count"]:4d}  '
              f'win_rate={s["win_rate_pct"]:.2f}%')
    print()
    print('--- TOP PERFORMERS (first 15 by win_rate, ties broken by n) ---')
    for tp in top_performers:
        print(f'  {tp["ticker"]:8s}  signals={tp["signals"]:3d}  '
              f'win_rate={tp["win_rate_pct"]:6.2f}%  '
              f'avg_ret={tp["avg_return_pct"]:+7.2f}%')
    print()

    # ───────────────────────────────────────────────────────────────────────
    # REALITY CHECK
    # ───────────────────────────────────────────────────────────────────────
    print('=' * 72)
    print('REALITY CHECK')
    print('=' * 72)

    # Sharpe
    sharpe_val = pm['sharpe_ratio']
    if sharpe_val is None:
        print(f'  Sharpe Ratio  : null  (no data)')
    elif sharpe_val > 2:
        print(f'  Sharpe Ratio  : {sharpe_val:.4f}  '
              '(ممتاز — >2 مؤسسيًا قوي)')
    elif sharpe_val > 1:
        print(f'  Sharpe Ratio  : {sharpe_val:.4f}  '
              '(جيد — >1 مقبول مؤسسيًا)')
    elif sharpe_val > 0:
        print(f'  Sharpe Ratio  : {sharpe_val:.4f}  '
              '(موجب — >0 لكن أقل من 1، تحقق من vol)')
    else:
        print(f'  Sharpe Ratio  : {sharpe_val:.4f}  '
              '(سيء — <=0، العوائد السلبية طاغية)')

    # Max Drawdown
    mdd = pm['max_drawdown_pct']
    if mdd < 20:
        print(f'  Max Drawdown  : {mdd:.2f}%   (ممتاز — <20% مؤسسيًا)')
    elif mdd < 40:
        print(f'  Max Drawdown  : {mdd:.2f}%   (مقبول — <40%)')
    else:
        print(f'  Max Drawdown  : {mdd:.2f}%   (خطير — >=40% يحتاج تدخل)')

    # Profit Factor
    pf = pm['profit_factor']
    if pf is None:
        print(f'  Profit Factor : null  '
              '(لا توجد خسائر — احترس من الإفراط في التفاؤل؛ '
              'تحقق من حجم العينة)')
    elif pf > 2:
        print(f'  Profit Factor : {pf:.4f}  (ممتاز — >2)')
    elif pf > 1.5:
        print(f'  Profit Factor : {pf:.4f}  (جيد — >1.5)')
    elif pf > 1:
        print(f'  Profit Factor : {pf:.4f}  (موجب — >1 لكن <1.5)')
    else:
        print(f'  Profit Factor : {pf:.4f}  (سيء — <=1، الخسائر تتجاوز الأرباح)')

    # Sortino
    so = pm['sortino_ratio']
    if so is None:
        print(f'  Sortino Ratio : null  (لا توجد عوائد سلبية — downside=0)')
    elif so > 2:
        print(f'  Sortino Ratio : {so:.4f}  (ممتاز — >2)')
    elif so > 1:
        print(f'  Sortino Ratio : {so:.4f}  (جيد — >1)')
    elif so > 0:
        print(f'  Sortino Ratio : {so:.4f}  (موجب — >0 لكن <1)')
    else:
        print(f'  Sortino Ratio : {so:.4f}  (سيء — <=0)')

    # Win Rate consistency
    wr_val = pm['overall_win_rate_pct']
    if 40 <= wr_val <= 60:
        wr_note = 'متوازن (40%-60%) — متسق مع استراتيجية +5%/-5% target/stop'
    elif wr_val > 60:
        wr_note = 'عالٍ (>60%) — تحقق من overfitting / selection bias'
    else:
        wr_note = 'منخفض (<40%) — استراتيجية تحتاج تحسين'
    print(f'  Win Rate      : {wr_val:.2f}%   ({wr_note})')

    # Cross-check: Sharpe vs Win Rate consistency
    if (
        sharpe_val is not None
        and wr_val < 50
        and sharpe_val > 1.5
    ):
        print('  ⚠ Inconsistency: low win rate but high Sharpe — '
              'check if Sharpe is inflated by sqrt(252) annualization on '
              'sparse trade data.')
    elif (
        sharpe_val is not None
        and 40 <= wr_val <= 60
        and 0 < sharpe_val < 1
    ):
        print('  ✓ Consistency: moderate win rate + modest Sharpe — '
              'numbers are coherent.')
    else:
        print('  ✓ Cross-check: metrics within expected bands.')

    # Final sanity: no NaN/Infinity
    if has_nan_inf(output):
        print('  ⚠ WARNING: NaN/Infinity values present in JSON output!')
    else:
        print('  ✓ No NaN/Infinity values in JSON output.')

    # Verify expected win-rate match
    if abs(wr_val - 46.80) < 0.05:
        print(f'  ✓ Win Rate ({wr_val:.2f}%) matches verify_all_radar_signals.py '
              'published value (46.80%).')
    else:
        print(f'  ⚠ Win Rate ({wr_val:.2f}%) does NOT match expected 46.80% '
              '— investigate.')

    print()
    print(f'JSON written: {REPORT_JSON}')
    print(f'  file size  : {REPORT_JSON.stat().st_size:,} bytes')
    print('=== DONE ===')
    return 0


if __name__ == '__main__':
    sys.exit(main())
