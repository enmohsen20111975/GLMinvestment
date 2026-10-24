"""
fibonacci.py — حساب مستويات فيبوناتشي (Phase 9.1 — Strangler Pattern V2)
=========================================================================

اتسحب من master_analyzer.py (lines 634-670).

Author: برافو (Phase 9.1 — Strangler Pattern V2)
"""
from __future__ import annotations

from typing import Optional, Dict


def _calc_fibonacci_levels(closes, highs, lows, lookback=30) -> Optional[Dict]:
    """حساب مستويات فيبوناتشي (0%, 23.6%, 38.2%, 50%, 61.8%, 78.6%, 100%).

    يحدد آخر swing high/low خلال آخر `lookback` شمعة ثم يحسب المستويات بينهما.
    لو مفيش بيانات كافية → يرجع None.
    المستويات تُحسب نسبةً للاتجاه (up/down):
      - لو close[-1] > midpoint → uptrend: low=0%, high=100%
      - عكسه → downtrend: high=0%, low=100%
    """
    n = len(closes)
    if n < 5 or not highs or not lows:
        return None
    window = min(lookback, n)
    sub_highs = highs[-window:]
    sub_lows = lows[-window:]
    swing_high = max(sub_highs) if sub_highs else None
    swing_low = min(sub_lows) if sub_lows else None
    if swing_high is None or swing_low is None or swing_high <= swing_low:
        return None

    diff = swing_high - swing_low
    last_close = closes[-1]
    direction = 'up' if last_close >= (swing_high + swing_low) / 2.0 else 'down'

    fib_ratios = [0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0]
    levels = {}
    for r in fib_ratios:
        if direction == 'up':
            price = swing_high - diff * r
        else:
            price = swing_low + diff * r
        levels[f'{int(r * 1000) / 10}%'] = round(price, 4)
    levels['swing_high'] = round(swing_high, 4)
    levels['swing_low'] = round(swing_low, 4)
    levels['direction'] = direction
    levels['lookback_window'] = window
    return levels
