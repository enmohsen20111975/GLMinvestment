"""
Strategy C — MERGED (Correction WHERE + Chase WHEN).

Hypothesis under test:
  Correction tells us WHERE to look (a stock that has corrected enough = cheaper entry,
  not chasing a top). Chase tells us WHEN to pull the trigger (momentum confirmed =
  not catching a falling knife). Combining both should beat each individually:
  fewer trades, higher win rate, better risk-adjusted return.

Implementation:
  Step 1 (WHERE): mark a "correction candidate" on day t when
                  drawdown <= -DEEP_CORRECTION_PCT AND drawdown > -PANIC_PCT.
  Step 2 (WHEN):  within the next WINDOW bars after a candidate, require momentum
                  confirmation: 2-day gain >= GAIN_2D_MIN AND vol_ratio >= VOL_RATIO_MIN
                  AND rsi in [45, 70] (recovering but not overbought).
  Step 3:         enter at confirmation day's CLOSE -> next day OPEN.
  Cooldown:        after entering, no new entry on this ticker for COOLDOWN bars.

This is intentionally NOT just the union of A and B. It is sequential:
  correction FIRST (sets the stage), THEN momentum confirmation (the trigger).
"""

from __future__ import annotations
import pandas as pd
from .common import Trade, simulate_exit

DEEP_CORRECTION_PCT = 10.0    # WHERE: corrected at least 10% from 20d high
PANIC_PCT = 22.0              # reject falling knives
WINDOW = 10                   # how many bars after correction to wait for confirmation
GAIN_2D_MIN = 1.5             # WHEN: 2-day bounce
VOL_RATIO_MIN = 1.20          # WHEN: volume confirmation (slightly looser than A's 1.30)
RSI_FLOOR = 45.0              # recovering
RSI_CEILING = 70.0            # not overbought
COOLDOWN = 10


def find_entry_signals(g: pd.DataFrame) -> list[int]:
    signals: list[int] = []
    n = len(g)
    i = 20
    while i < n:
        row = g.iloc[i]
        dd = float(row["drawdown_pct"])
        # Step 1: correction candidate (WHERE)
        if dd <= -DEEP_CORRECTION_PCT and dd > -PANIC_PCT:
            # Step 2: scan forward window for momentum confirmation (WHEN)
            confirmed_at = None
            for j in range(i + 1, min(i + 1 + WINDOW, n)):
                r = g.iloc[j]
                gain_2d = float(r["gain_2d"])
                vol_ratio = float(r["vol_ratio"])
                rsi = float(r["rsi_14"])
                # if it keeps collapsing, abort this candidate early
                if float(r["drawdown_pct"]) <= -PANIC_PCT:
                    break
                if gain_2d >= GAIN_2D_MIN and vol_ratio >= VOL_RATIO_MIN and RSI_FLOOR <= rsi <= RSI_CEILING:
                    confirmed_at = j
                    break
            if confirmed_at is not None:
                signals.append(confirmed_at)
                i = confirmed_at + COOLDOWN  # cooldown
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
