"""Minimal 3-stage pipeline: Liquidity + Trend + Risk."""
from .config import TARGET_PCT, STOP_PCT

def run_pipeline(candles, i, ticker):
    """3-stage pipeline. Returns (entry, target, stop) or None."""
    day = candles[i]
    
    # Stage 1: Liquidity — volume must be above average
    if day['vol_ma20'] is None or day['vol_ma20'] == 0:
        return None
    if day['volume'] < day['vol_ma20'] * 0.8:
        return None
    
    # Stage 2: Trend — close above SMA50
    if day['sma50'] is None:
        return None
    if day['close'] <= day['sma50']:
        return None
    
    # Stage 3: Risk — set target/stop
    entry = day['close']
    target = entry * (1 + TARGET_PCT / 100)
    stop = entry * (1 - STOP_PCT / 100)
    
    return (entry, target, stop)
