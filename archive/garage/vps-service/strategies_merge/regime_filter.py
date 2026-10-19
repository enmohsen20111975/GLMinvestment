"""
Regime-filtered strategy wrappers.

Each function takes a base strategy module + a per-ticker dataframe that has
already been enriched with `above_ma50` and `market_above_ma50` columns,
and returns trades — but ONLY entries where the regime filter passes.

Two filter modes:
  - "stock":  entry only if stock close > stock MA50 (per-stock regime)
  - "market": entry only if market proxy > market MA50 (market-wide regime)
  - "both":   both conditions must hold (strictest)
"""

from __future__ import annotations
import pandas as pd
from .common import Trade, simulate_exit


def run_with_regime(base_module, g: pd.DataFrame, mode: str = "both") -> list[Trade]:
    """Run a base strategy's find_entry_signals, then filter by regime."""
    signals = base_module.find_entry_signals(g)
    trades: list[Trade] = []
    n = len(g)
    for idx in signals:
        if idx >= n:
            continue
        row = g.iloc[idx]
        # regime filter
        if mode in ("stock", "both"):
            if not bool(row.get("above_ma50", False)):
                continue
        if mode in ("market", "both"):
            if not bool(row.get("market_above_ma50", False)):
                continue
        t = simulate_exit(g, idx)
        if t is not None:
            trades.append(t)
    return trades
