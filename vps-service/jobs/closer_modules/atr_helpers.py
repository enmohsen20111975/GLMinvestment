"""
atr_helpers.py — حساب ATR عند الدخول (Phase 9.1 — Strangler Pattern V2)
==========================================================================

اتسحب من daily_closer.py (lines 533-570).

Author: برافو (Phase 9.1 — Strangler Pattern V2)
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional


def compute_atr_at_entry(closer, ticker: str, entry_date: str, period: int = 14) -> float:
    """Compute ATR at entry time from price history.

    Extracted from DailyCloser._compute_atr_at_entry.

    Args:
        closer: DailyCloser instance (for get_price_history access)
        ticker: رمز السهم
        entry_date: تاريخ الدخول (YYYY-MM-DD)
        period: فترة ATR (default 14)

    Returns:
        ATR value at entry time, or 0.0 if unavailable
    """
    try:
        from analyzers.indicators.atr import calc_atr as _canonical_calc_atr

        # Fetch 50 days before entry for ATR calculation
        lookback_date = (datetime.strptime(entry_date, '%Y-%m-%d') - timedelta(days=60)).strftime('%Y-%m-%d')
        prices = closer.get_price_history(ticker, lookback_date, entry_date)

        if len(prices) < period + 1:
            return 0.0

        highs = [float(p.get('high', 0) or 0) for p in prices]
        lows = [float(p.get('low', 0) or 0) for p in prices]
        closes = [float(p.get('close', 0) or 0) for p in prices]
        # filter invalid rows
        valid = [(h, l, c) for h, l, c in zip(highs, lows, closes) if h > 0 and l > 0 and c > 0]
        if len(valid) < period + 1:
            return 0.0
        v_highs, v_lows, v_closes = (list(t) for t in zip(*valid))
        atr = _canonical_calc_atr(v_highs, v_lows, v_closes, period=period)
        return atr if atr is not None else 0.0

    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Error computing ATR at entry for {ticker}: {e}")
        return 0.0
