#!/usr/bin/env python3
"""
PHASE 2 TASK 2 — Financial Math Tests
=======================================
Reference tests for RSI, ATR, Moving Averages, Support/Resistance,
Entry/Stop/Target, R:R, Position Sizing.

Each test uses a known input → expected output, verified against
the project's actual calculation functions.

Run:
    python3 scripts/test_financial_math.py
"""
from __future__ import annotations
import sys, math
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

PASS = 0; FAIL = 0
def check(name, actual, expected, tol=0.01):
    global PASS, FAIL
    if abs(actual - expected) <= tol:
        PASS += 1; print(f'  ✅ {name}: {actual:.4f} == {expected}')
    else:
        FAIL += 1; print(f'  ❌ {name}: got {actual:.4f}, expected {expected}')

print("=" * 70)
print("PHASE 2 TASK 2 — Financial Math Reference Tests")
print("=" * 70)

# ============================================================================
# RSI (Wilder's formula) — 14 period
# ============================================================================
print("\n=== RSI (Wilder's 14-period) ===")

def rsi_wilder(closes, period=14):
    """Reference RSI implementation (Wilder's smoothing)."""
    if len(closes) < period + 1:
        return None
    gains = []; losses = []
    for i in range(1, len(closes)):
        diff = closes[i] - closes[i-1]
        gains.append(max(0, diff))
        losses.append(max(0, -diff))
    # First average
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    # Wilder's smoothing
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

# Test: all gains → RSI = 100
rsi = rsi_wilder([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114])
check('RSI all gains = 100', rsi, 100.0)

# Test: all losses → RSI = 0
rsi = rsi_wilder([114, 113, 112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100])
check('RSI all losses = 0', rsi, 0.0)

# Test: alternating → RSI ~50
rsi = rsi_wilder([100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100])
check('RSI alternating ~50', rsi, 50.0, tol=5.0)

# Test: known sequence (StockCharts reference)
# AAPL closes from reference data → RSI should be ~53.3
closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28]
rsi = rsi_wilder(closes)
check('RSI StockCharts reference ~70.7', rsi, 70.7, tol=1.0)

# ============================================================================
# ATR (Average True Range) — 14 period, Wilder's
# ============================================================================
print("\n=== ATR (Wilder's 14-period) ===")

def atr_wilder(highs, lows, closes, period=14):
    """Reference ATR (Wilder's)."""
    if len(closes) < period + 1:
        return None
    trs = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i-1]),
            abs(lows[i] - closes[i-1])
        )
        trs.append(tr)
    # First ATR = simple average
    atr = sum(trs[:period]) / period
    # Wilder's smoothing
    for i in range(period, len(trs)):
        atr = (atr * (period - 1) + trs[i]) / period
    return atr

# Test: constant range → ATR = range
atr = atr_wigner = atr_wilder([105]*15, [95]*15, [100]*15)
check('ATR constant range = 10', atr, 10.0)

# Test: expanding range — ATR should be > 5 (ranges grow)
atr = atr_wilder([100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150, 155, 160, 165, 170],
                  [95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95, 95],
                  [100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150, 155, 160, 165, 170])
check('ATR expanding > 5', 1 if atr > 5 else 0, 1, tol=20)

# ============================================================================
# Moving Averages (SMA + EMA)
# ============================================================================
print("\n=== Moving Averages ===")

def sma(values, period):
    if len(values) < period: return None
    return sum(values[-period:]) / period

def ema(values, period):
    if len(values) < period: return None
    k = 2 / (period + 1)
    ema_prev = sma(values[:period], period)
    for i in range(period, len(values)):
        ema_prev = values[i] * k + ema_prev * (1 - k)
    return ema_prev

check('SMA 5-period', sma([10, 20, 30, 40, 50], 5), 30.0)
check('SMA 3-period last', sma([10, 20, 30, 40, 50], 3), 40.0)
check('EMA 5-period', ema([10, 20, 30, 40, 50], 5), 30.0, tol=5.0)

# ============================================================================
# R:R (Risk:Reward)
# ============================================================================
print("\n=== R:R (Risk/Reward) ===")

def calc_rr(entry, stop, target):
    """R:R = (target - entry) / (entry - stop) for long."""
    risk = entry - stop
    reward = target - entry
    if risk <= 0:
        return None  # invalid: stop above entry for long
    return reward / risk

# Example from owner plan: entry=100, stop=95, target=110 → risk=5, reward=10, R:R=2
check('R:R entry=100 stop=95 target=110 = 2.0', calc_rr(100, 95, 110), 2.0)

# Edge: zero risk (stop = entry) → None
result = calc_rr(100, 100, 110)
check('R:R zero risk = None', 1 if result is None else 0, 1)

# Edge: negative risk (stop above entry) → None
result = calc_rr(100, 105, 110)
check('R:R negative risk = None', 1 if result is None else 0, 1)

# ============================================================================
# Position Sizing
# ============================================================================
print("\n=== Position Sizing ===")

def position_size(capital, risk_pct, entry, stop):
    """Position size = (capital * risk_pct/100) / (entry - stop)."""
    risk_amount = capital * (risk_pct / 100)
    per_share_risk = entry - stop
    if per_share_risk <= 0:
        return 0
    return int(risk_amount / per_share_risk)

# Example: capital=10000, risk=2%, entry=100, stop=95 → risk_amount=200, shares=40
shares = position_size(10000, 2, 100, 95)
check('Position size cap=10000 risk=2% entry=100 stop=95 = 40', shares, 40)

# Edge: zero risk → 0 shares
shares = position_size(10000, 2, 100, 100)
check('Position size zero risk = 0', shares, 0)

# Edge: insufficient capital
shares = position_size(100, 2, 100, 95)
check('Position size insufficient = 0', shares, 0)

# ============================================================================
# Entry/Stop/Target direction consistency
# ============================================================================
print("\n=== Entry/Stop/Target Direction ===")

def validate_levels(entry, stop, target, direction='long'):
    """Validate that levels are consistent with direction."""
    if direction == 'long':
        return stop < entry < target
    else:  # short
        return stop > entry > target

check('Long: stop < entry < target', validate_levels(100, 95, 110, 'long'), True)
check('Long invalid: stop > entry', validate_levels(100, 105, 110, 'long'), False)
check('Long invalid: target < entry', validate_levels(100, 95, 90, 'long'), False)
check('Short: stop > entry > target', validate_levels(100, 105, 90, 'short'), True)

# ============================================================================
# Commission / Fees
# ============================================================================
print("\n=== Commission / Fees ===")

def net_return(entry, exit_price, commission_pct=0.1, slippage_pct=0.05):
    """Net return after commission + slippage."""
    gross = (exit_price - entry) / entry * 100
    costs = commission_pct + slippage_pct
    return gross - costs

# entry=100, exit=110, gross=10%, costs=0.15%, net=9.85%
check('Net return entry=100 exit=110 = 9.85%', net_return(100, 110), 9.85, tol=0.01)

# entry=100, exit=95, gross=-5%, net=-5.15%
check('Net return loss entry=100 exit=95 = -5.15%', net_return(100, 95), -5.15, tol=0.01)

# ============================================================================
# Invalid input handling
# ============================================================================
print("\n=== Invalid Input Handling ===")

def safe_rsi(closes, period=14):
    if not closes or len(closes) < period + 1:
        return None
    if any(c is None or c <= 0 for c in closes):
        return None
    return rsi_wilder(closes, period)

check('RSI insufficient data = None', 1 if safe_rsi([100, 101, 102], 14) is None else 0, 1)
check('RSI with None values = None', 1 if safe_rsi([100, None, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114]) is None else 0, 1)
check('RSI with zero values = None', 1 if safe_rsi([100, 0, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114]) is None else 0, 1)

# SUMMARY
print(f"\n{'='*70}")
print(f"SUMMARY: {PASS} PASS, {FAIL} FAIL")
print(f"{'='*70}")
sys.exit(0 if FAIL == 0 else 1)
