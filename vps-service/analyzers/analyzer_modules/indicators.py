"""
indicators.py — مؤشرات EMA + MACD (Phase 9.1 — Strangler Pattern V2)
=====================================================================

اتسحب من master_analyzer.py:
  - _ema_seeded (EMA array computation)
  - _calc_macd (MACD line/signal/histogram)

Author: برافو (Phase 9.1 — Strangler Pattern V2)
"""
from __future__ import annotations

from typing import List, Tuple, Optional


def _ema_seeded(values, period, _canonical_ema_fn=None):
    """EMA as array — delegates to canonical analyzers.indicators.ma.ema per point."""
    if _canonical_ema_fn is None:
        try:
            from analyzers.indicators.ma import ema as _canonical_ema_fn
        except Exception:
            return [None] * len(values)

    n = len(values)
    if n < period:
        return [None] * n
    result = []
    for i in range(n):
        if i < period - 1:
            result.append(None)
        else:
            val = _canonical_ema_fn(values[:i+1], period)
            result.append(val)
    return result


def _calc_macd(closes, fast=12, slow=26, signal=9, _canonical_macd_fn=None):
    """MACD as arrays — delegates to canonical analyzers.indicators.ma.macd per point."""
    if _canonical_macd_fn is None:
        try:
            from analyzers.indicators.ma import macd as _canonical_macd_fn
        except Exception:
            n = len(closes)
            return [None] * n, [None] * n, [None] * n

    n = len(closes)
    if n < slow + signal:
        return [None] * n, [None] * n, [None] * n
    macd_line = []
    signal_line = []
    histogram = []
    for i in range(n):
        if i < slow + signal - 1:
            macd_line.append(None)
            signal_line.append(None)
            histogram.append(None)
        else:
            result = _canonical_macd_fn(closes[:i+1], fast, slow, signal)
            if result is not None:
                macd_line.append(result.get('line'))
                signal_line.append(result.get('signal'))
                histogram.append(result.get('histogram'))
            else:
                macd_line.append(None)
                signal_line.append(None)
                histogram.append(None)
    return macd_line, signal_line, histogram
