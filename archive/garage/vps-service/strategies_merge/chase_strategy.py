"""
Strategy B — Chase-only (momentum).

Logic (mirrors prior session's strict_entry_filters ACCEPT path for accumulation):
- WHERE: stock is near its highs (dist_from_high within -8%, i.e. NOT late/corrected).
- WHEN: 5-day gain >= GAIN_5D_MIN (momentum confirmed) AND volume ratio >= VOL_RATIO_MIN.
- Reject if RSI > 78 (overbought/late) or dist_from_high <= -8% (corrected, not momentum).

This is the "ride confirmed momentum near highs" strategy.
"""

from __future__ import annotations
import pandas as pd
from .common import Trade, simulate_exit

GAIN_5D_MIN = 8.0             # 5-day gain >= 8% (momentum). Prior session used 15%; we relax slightly.
DIST_FROM_HIGH_MAX = -2.0     # must be within 2% of 20d high (near highs)
DIST_FROM_HIGH_MIN = -8.0     # reject if corrected more than 8% (that's Correction's job)
VOL_RATIO_MIN = 1.15          # volume confirmation
RSI_CEILING = 78.0
RSI_FLOOR = 50.0


def find_entry_signals(g: pd.DataFrame) -> list[int]:
    signals: list[int] = []
    n = len(g)
    last_signal = -999
    for i in range(20, n):
        row = g.iloc[i]
        dist = float(row["dist_from_high"]) * 100.0  # -2.0..0 typical near highs
        gain_5d = float(row["gain_5d"])
        vol_ratio = float(row["vol_ratio"])
        rsi = float(row["rsi_14"])

        if dist < DIST_FROM_HIGH_MIN:
            continue  # too corrected -> Chase's job isn't here
        if dist > DIST_FROM_HIGH_MAX:
            continue  # at/above high — chasing the very top, reject
        if gain_5d < GAIN_5D_MIN:
            continue  # no momentum
        if vol_ratio < VOL_RATIO_MIN:
            continue
        if rsi > RSI_CEILING or rsi < RSI_FLOOR:
            continue
        if i - last_signal < 8:
            continue
        signals.append(i)
        last_signal = i
    return signals


def run(g: pd.DataFrame) -> list[Trade]:
    trades: list[Trade] = []
    for idx in find_entry_signals(g):
        t = simulate_exit(g, idx)
        if t is not None:
            trades.append(t)
    return trades
