"""
Strategy A — Correction-only.

Logic (mirrors the prior session's detect_correction_opportunity / RECOVERY_STARTING):
- WHERE: stock has corrected enough from its 20d high (drawdown <= -DEEP_CORRECTION_PCT).
- WHEN: recovery momentum starting — volume ratio >= VOL_RATIO_MIN AND 2-day gain >= GAIN_2D_MIN.
- Reject if too deep (drawdown <= -PANIC_PCT) -> likely falling knife, skip.

This is the "enter after sufficient correction + early recovery confirmation" strategy.
"""

from __future__ import annotations
import pandas as pd
from .common import Trade, simulate_exit

DEEP_CORRECTION_PCT = 10.0   # drawdown <= -10% from 20d high
PANIC_PCT = 22.0             # too deep -> falling knife, reject
VOL_RATIO_MIN = 1.30         # volume vs 20d mean
GAIN_2D_MIN = 1.0            # 2-day bounce confirmation
RSI_FLOOR = 30.0             # oversold-ish but not dead
RSI_CEILING = 62.0           # not already recovered


def find_entry_signals(g: pd.DataFrame) -> list[int]:
    """Return list of row indices (in this ticker's df) that trigger an entry at that day's CLOSE.
    Execution enters at next day's OPEN inside simulate_exit.
    """
    signals: list[int] = []
    n = len(g)
    # enforce a cooldown so we don't stack entries on consecutive days
    last_signal = -999
    for i in range(20, n):
        row = g.iloc[i]
        dd = float(row["drawdown_pct"])
        vol_ratio = float(row["vol_ratio"])
        gain_2d = float(row["gain_2d"])
        rsi = float(row["rsi_14"])

        if dd > -DEEP_CORRECTION_PCT:
            continue  # not corrected enough (WHERE)
        if dd <= -PANIC_PCT:
            continue  # falling knife — reject
        if vol_ratio < VOL_RATIO_MIN:
            continue  # no volume confirmation
        if gain_2d < GAIN_2D_MIN:
            continue  # no bounce yet
        if rsi < RSI_FLOOR or rsi > RSI_CEILING:
            continue
        if i - last_signal < 8:
            continue  # cooldown 8 bars
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
