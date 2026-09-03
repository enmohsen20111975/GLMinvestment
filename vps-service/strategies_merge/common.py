"""
Shared backtest primitives: indicators, structural exit, trade metrics.

Design rules (to keep "numbers are the judge" honest):
- All strategies share the SAME exit engine and SAME metrics. The ONLY thing
  that differs across strategies is the ENTRY condition.
- Entry is evaluated on day t using info available at CLOSE of day t.
- Execution: enter at OPEN of day t+1 (no lookahead — you can't trade on the close).
- Exit is evaluated intraday/next-open: we check day t+1.. for exit triggers.
- No parameter is tuned per strategy; only entry differs.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Optional
import pandas as pd
import numpy as np


# ---------------------------------------------------------------- indicators
def attach_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """Add columns needed by all strategies: rolling high, drawdown, RSI, volume ratio, recent gain."""
    out = df.sort_values(["ticker", "date"]).reset_index(drop=True).copy()

    def per_ticker(g: pd.DataFrame) -> pd.DataFrame:
        g = g.copy()
        g["roll_high_20"] = g["close"].rolling(20, min_periods=5).max()
        g["dist_from_high"] = (g["close"] - g["roll_high_20"]) / g["roll_high_20"]  # negative
        g["drawdown_pct"] = g["dist_from_high"] * 100.0  # e.g. -12.3
        # RSI(14)
        delta = g["close"].diff()
        gain = delta.clip(lower=0.0)
        loss = -delta.clip(upper=0.0)
        avg_gain = gain.ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
        avg_loss = loss.ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
        rs = avg_gain / avg_loss.replace(0.0, np.nan)
        g["rsi_14"] = 100.0 - (100.0 / (1.0 + rs))
        g["rsi_14"] = g["rsi_14"].fillna(50.0)
        # volume ratio vs 20d mean
        g["vol_mean_20"] = g["volume"].rolling(20, min_periods=5).mean()
        g["vol_ratio"] = g["volume"] / g["vol_mean_20"].replace(0.0, np.nan)
        g["vol_ratio"] = g["vol_ratio"].fillna(1.0)
        # recent gain (5-day)
        g["gain_5d"] = (g["close"] / g["close"].shift(5) - 1.0) * 100.0
        # short-term momentum confirmation (2-day)
        g["gain_2d"] = (g["close"] / g["close"].shift(2) - 1.0) * 100.0
        # 20d MA for breakdown detection
        g["ma_20"] = g["close"].rolling(20, min_periods=5).mean()
        # MA50 — regime filter: close > MA50 = bullish, close < MA50 = bearish
        g["ma_50"] = g["close"].rolling(50, min_periods=20).mean()
        g["above_ma50"] = (g["close"] > g["ma_50"]).fillna(False)
        # MA200 for long-term trend (if available)
        g["ma_200"] = g["close"].rolling(200, min_periods=50).mean()
        g["above_ma200"] = (g["close"] > g["ma_200"]).fillna(False)
        return g

    out = out.groupby("ticker", group_keys=False).apply(per_ticker)
    return out


# ---------------------------------------------------------------- market regime
def compute_market_proxy(df: pd.DataFrame) -> pd.DataFrame:
    """Build a market-level proxy index from the universe.
    Equal-weighted daily return of all tickers, then cumulative = market index.
    Returns a dataframe with date, market_close, market_ma50, market_above_ma50.
    """
    # pivot to date x ticker close
    pivot = df.pivot_table(index="date", columns="ticker", values="close")
    # daily returns
    daily_ret = pivot.pct_change()
    # equal-weighted market return = mean of available tickers per day
    market_ret = daily_ret.mean(axis=1).fillna(0.0)
    # cumulative index starting at 100
    market_close = (1.0 + market_ret).cumprod() * 100.0
    market_df = pd.DataFrame({
        "date": market_close.index,
        "market_close": market_close.values,
    })
    market_df["market_ma50"] = market_df["market_close"].rolling(50, min_periods=20).mean()
    market_df["market_above_ma50"] = (market_df["market_close"] > market_df["market_ma50"]).fillna(False)
    return market_df


def attach_market_regime(df: pd.DataFrame, market_df: pd.DataFrame) -> pd.DataFrame:
    """Attach market regime columns (market_above_ma50) to per-ticker df by date."""
    out = df.merge(market_df[["date", "market_close", "market_ma50", "market_above_ma50"]],
                   on="date", how="left")
    out["market_above_ma50"] = out["market_above_ma50"].fillna(False)
    return out


# ---------------------------------------------------------------- trades
@dataclass
class Trade:
    ticker: str
    entry_date: pd.Timestamp
    entry_price: float
    exit_date: pd.Timestamp
    exit_price: float
    exit_reason: str
    holding_days: int

    @property
    def return_pct(self) -> float:
        if self.entry_price <= 0:
            return 0.0
        return (self.exit_price / self.entry_price - 1.0) * 100.0


# ---------------------------------------------------------------- exit engine
STOP_LOSS_PCT = -7.0           # hard stop
TAKE_PROFIT_PCT = 12.0         # take profit
EARLY_DROP_DAYS = 3            # if down >5% within first 3 days -> early drop exit
EARLY_DROP_PCT = -5.0
BREAKDOWN_MA_DROP_PCT = -3.0   # close >3% below MA20 -> structural breakdown
MAX_HOLD_DAYS = 25             # safety cap (review alert), NOT the primary exit


def simulate_exit(
    g: pd.DataFrame,
    entry_idx: int,
) -> Optional[Trade]:
    """Given a per-ticker dataframe (sorted by date) and an entry signal at row `entry_idx`,
    execute the trade: enter at NEXT open, exit by structural rules. Returns Trade or None.
    """
    n = len(g)
    fill_idx = entry_idx + 1
    if fill_idx >= n:
        return None
    entry_price = float(g.iloc[fill_idx]["open"])
    entry_date = pd.Timestamp(g.iloc[fill_idx]["date"])
    if entry_price <= 0:
        return None

    # iterate forward from fill day
    exit_idx = None
    exit_reason = "open"

    for i in range(fill_idx, min(fill_idx + MAX_HOLD_DAYS, n)):
        row = g.iloc[i]
        close = float(row["close"])
        low = float(row["low"])
        high = float(row["high"])
        ma20 = row.get("ma_20", np.nan)
        day_offset = i - fill_idx

        # 1) stop loss (intraday low)
        if low <= entry_price * (1.0 + STOP_LOSS_PCT / 100.0):
            exit_idx = i
            exit_reason = "stop_loss"
            break
        # 2) take profit (intraday high)
        if high >= entry_price * (1.0 + TAKE_PROFIT_PCT / 100.0):
            exit_idx = i
            exit_reason = "take_profit"
            break
        # 3) early drop within first EARLY_DROP_DAYS
        if day_offset < EARLY_DROP_DAYS:
            ret_since_entry = (close / entry_price - 1.0) * 100.0
            if ret_since_entry <= EARLY_DROP_PCT:
                exit_idx = i
                exit_reason = "early_drop"
                break
        # 4) structural breakdown vs MA20
        if not pd.isna(ma20):
            if close < ma20 * (1.0 + BREAKDOWN_MA_DROP_PCT / 100.0):
                exit_idx = i
                exit_reason = "breakdown"
                break
        # 5) distribution: 3 consecutive lower closes with rising volume
        if i >= fill_idx + 3:
            c0 = float(g.iloc[i - 2]["close"]); c1 = float(g.iloc[i - 1]["close"]); c2 = close
            v0 = float(g.iloc[i - 2]["volume"]); v1 = float(g.iloc[i - 1]["volume"]); v2 = float(row["volume"])
            if c0 > c1 > c2 and v0 < v1 < v2:
                exit_idx = i
                exit_reason = "distribution"
                break

    if exit_idx is None:
        exit_idx = min(fill_idx + MAX_HOLD_DAYS - 1, n - 1)
        exit_reason = "review_alert"

    exit_row = g.iloc[exit_idx]
    # use close of exit day (conservative; could use stop/target price for sl/tp)
    if exit_reason == "stop_loss":
        exit_price = entry_price * (1.0 + STOP_LOSS_PCT / 100.0)
    elif exit_reason == "take_profit":
        exit_price = entry_price * (1.0 + TAKE_PROFIT_PCT / 100.0)
    else:
        exit_price = float(exit_row["close"])
    exit_date = pd.Timestamp(exit_row["date"])
    holding = int(exit_idx - fill_idx)

    return Trade(
        ticker=str(g.iloc[0]["ticker"]),
        entry_date=entry_date,
        entry_price=entry_price,
        exit_date=exit_date,
        exit_price=exit_price,
        exit_reason=exit_reason,
        holding_days=max(holding, 1),
    )


# ---------------------------------------------------------------- metrics
def compute_metrics(trades: list[Trade], label: str) -> dict:
    if not trades:
        return {
            "strategy": label,
            "trades": 0,
            "win_rate_pct": 0.0,
            "avg_return_pct": 0.0,
            "total_return_pct": 0.0,
            "max_drawdown_pct": 0.0,
            "profit_factor": 0.0,
            "avg_holding_days": 0.0,
            "wins": 0,
            "losses": 0,
        }
    rets = np.array([t.return_pct for t in trades])
    wins = rets[rets > 0]
    losses = rets[rets <= 0]
    gross_win = wins.sum() if len(wins) else 0.0
    gross_loss = abs(losses.sum()) if len(losses) else 0.0
    profit_factor = (gross_win / gross_loss) if gross_loss > 0 else float("inf") if gross_win > 0 else 0.0

    # equity curve: compound each trade sequentially (assume full-capital redeployment)
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    for r in rets:
        equity *= (1.0 + r / 100.0)
        peak = max(peak, equity)
        dd = (equity / peak - 1.0) * 100.0
        max_dd = min(max_dd, dd)
    total_return = (equity - 1.0) * 100.0

    return {
        "strategy": label,
        "trades": len(trades),
        "wins": int(len(wins)),
        "losses": int(len(losses)),
        "win_rate_pct": round(float(len(wins)) / len(trades) * 100.0, 2),
        "avg_return_pct": round(float(rets.mean()), 2),
        "total_return_pct": round(float(total_return), 2),
        "max_drawdown_pct": round(float(max_dd), 2),
        "profit_factor": round(float(profit_factor), 2) if profit_factor != float("inf") else 999.99,
        "avg_holding_days": round(float(np.mean([t.holding_days for t in trades])), 1),
    }


def exit_reason_breakdown(trades: list[Trade]) -> dict:
    out: dict[str, int] = {}
    for t in trades:
        out[t.exit_reason] = out.get(t.exit_reason, 0) + 1
    return out
