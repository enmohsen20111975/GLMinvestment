"""
Strategy D — MERGED-STRICT (the fix attempt).

The naive Merged (Strategy C) FAILED on the data because it loosened the WHEN
thresholds (vol_ratio>=1.20, gain_2d>=1.5 vs Correction's vol_ratio>=1.30,
gain_2d>=1.0), letting DEADCAT bounces through.

Merged-Strict holds the thresholds IDENTICAL to Correction, and isolates the ONE
variable the merge is actually about: TEMPORAL SEPARATION.
  - WHERE (day t): drawdown <= -10% AND > -22%   [identical to Correction]
  - WHEN  (day t..t+10): gain_2d >= 1.0 AND vol_ratio >= 1.30 AND rsi in [30,62]
                          [identical to Correction, but allowed on a DIFFERENT day]

Question this answers: if Merged-Strict still loses, the temporal separation itself
is the problem (confirmations that come a day late are already weak). If it wins,
the merge idea works — the naive version just had bad thresholds.
"""

from __future__ import annotations
import pandas as pd
from .common import Trade, simulate_exit

DEEP_CORRECTION_PCT = 10.0
PANIC_PCT = 22.0
WINDOW = 10
GAIN_2D_MIN = 1.0            # SAME as Correction
VOL_RATIO_MIN = 1.30         # SAME as Correction
RSI_FLOOR = 30.0             # SAME as Correction
RSI_CEILING = 62.0           # SAME as Correction
COOLDOWN = 8                 # SAME as Correction


def find_entry_signals(g: pd.DataFrame) -> list[int]:
    signals: list[int] = []
    n = len(g)
    i = 20
    while i < n:
        row = g.iloc[i]
        dd = float(row["drawdown_pct"])
        if dd <= -DEEP_CORRECTION_PCT and dd > -PANIC_PCT:
            confirmed_at = None
            for j in range(i + 1, min(i + 1 + WINDOW, n)):
                r = g.iloc[j]
                if float(r["drawdown_pct"]) <= -PANIC_PCT:
                    break
                gain_2d = float(r["gain_2d"])
                vol_ratio = float(r["vol_ratio"])
                rsi = float(r["rsi_14"])
                if gain_2d >= GAIN_2D_MIN and vol_ratio >= VOL_RATIO_MIN and RSI_FLOOR <= rsi <= RSI_CEILING:
                    confirmed_at = j
                    break
            if confirmed_at is not None:
                signals.append(confirmed_at)
                i = confirmed_at + COOLDOWN
                continue
        i += 1
    return signals


def run(g: pd.DataFrame) -> list[Trade]:
    trades: list[Trade] = []
    for idx in find_entry_signals(g):
        t = simulate_exit(g, idx)
        if t is not None:
            trades.append(t)
    return trades
