#!/usr/bin/env python3
"""
Technical Analyzer — CLI wrapper for /api/stocks/technical
===========================================================
Computes technical indicators for a given ticker by reading price
history from data_engine.db or stocks.db / price_history.db.

Usage:
    python3 technical_analyzer.py --ticker COMI

Output: JSON with RSI, MACD, Bollinger Bands, Stochastic, ATR, OBV,
        VWAP, Moving Averages, and market regime detection.
"""

import argparse
import json
import math
import os
import sqlite3
import sys
from typing import List, Optional, Dict, Any


# ──────────────────────────────────────────────────────────
# Database helpers
# ──────────────────────────────────────────────────────────

def _find_db(name: str) -> Optional[str]:
    """Find a database file relative to the project root."""
    candidates = [
        os.path.join(os.getcwd(), "db", name),
        os.path.join(os.getcwd(), name),
        os.path.join(os.path.dirname(__file__), "..", "..", "db", name),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


def _get_price_history(ticker: str) -> List[Dict[str, Any]]:
    """Read price history — delegates to data.prices (single source of truth).

    Returns list of daily candles (oldest first) with keys:
        date, open, high, low, close, volume
    """
    # PHASE 1 (v3.50.0): delegate to data.prices — single source of truth
    from data.prices import load_price_history
    return load_price_history(ticker, limit=365)


# ──────────────────────────────────────────────────────────
# Indicator computations
# ──────────────────────────────────────────────────────────

def _sma(data: List[float], period: int) -> Optional[float]:
    if len(data) < period:
        return None
    return round(sum(data[-period:]) / period, 4)


def _ema(data: List[float], period: int) -> Optional[float]:
    if len(data) < period:
        return None
    k = 2 / (period + 1)
    ema_val = sum(data[:period]) / period
    for price in data[period:]:
        ema_val = (price - ema_val) * k + ema_val
    return round(ema_val, 4)


def _stddev(data: List[float], period: int) -> Optional[float]:
    if len(data) < period:
        return None
    slice_ = data[-period:]
    mean = sum(slice_) / period
    variance = sum((x - mean) ** 2 for x in slice_) / period
    return round(math.sqrt(variance), 4)


def calc_rsi(closes: List[float], period: int = 14) -> Optional[float]:
    if len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [d if d > 0 else 0 for d in deltas]
    losses = [-d if d < 0 else 0 for d in deltas]

    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period

    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period

    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - 100 / (1 + rs), 2)


def calc_macd(closes: List[float]) -> Optional[Dict[str, float]]:
    if len(closes) < 35:
        return None
    ema12 = _ema(closes, 12)
    ema26 = _ema(closes, 26)
    if ema12 is None or ema26 is None:
        return None

    # Compute MACD line series for signal line
    k12, k26 = 2 / 13, 2 / 27
    ema12_val = sum(closes[:12]) / 12
    ema26_val = sum(closes[:26]) / 26
    macd_line_series = []
    for i, price in enumerate(closes):
        if i >= 11:
            ema12_val = (price - ema12_val) * k12 + ema12_val
        if i >= 25:
            ema26_val = (price - ema26_val) * k26 + ema26_val
        if i >= 25:
            macd_line_series.append(ema12_val - ema26_val)

    if not macd_line_series:
        return None

    # Signal line = 9-period EMA of MACD line
    signal = _ema(macd_line_series, 9)
    macd_line = macd_line_series[-1] if macd_line_series else 0
    signal_val = signal if signal else 0

    return {
        "line": round(macd_line, 4),
        "signal": round(signal_val, 4),
        "histogram": round(macd_line - signal_val, 4),
    }


def calc_bollinger(closes: List[float], period: int = 20) -> Optional[Dict[str, float]]:
    if len(closes) < period:
        return None
    middle = _sma(closes, period)
    sd = _stddev(closes, period)
    if middle is None or sd is None:
        return None
    return {
        "upper": round(middle + 2 * sd, 4),
        "middle": round(middle, 4),
        "lower": round(middle - 2 * sd, 4),
    }


def calc_stochastic(highs: List[float], lows: List[float], closes: List[float],
                    period: int = 14, d_period: int = 3) -> Optional[Dict[str, float]]:
    """Stochastic Oscillator (%K, %D)
    
    %K = (Close - Low_N) / (High_N - Low_N) * 100
    %D = SMA(d_period) of %K values
    """
    if len(closes) < period:
        return None
    
    # حساب %K لآخر d_period فترات
    k_values = []
    for i in range(d_period):
        idx = -(d_period - i)
        if abs(idx) > len(closes):
            continue
        end_idx = None if idx == 0 else idx + 1 if idx < 0 else idx + 1
        window_highs = highs[-(period + d_period - 1 - i):(len(highs) - (d_period - 1 - i)) if (d_period - 1 - i) > 0 else None]
        window_lows = lows[-(period + d_period - 1 - i):(len(lows) - (d_period - 1 - i)) if (d_period - 1 - i) > 0 else None]
        window_closes_idx = len(closes) - (d_period - 1 - i) if (d_period - 1 - i) > 0 else len(closes)
        
        if window_highs is None or len(window_highs) < period:
            continue
        
        highest = max(window_highs)
        lowest = min(window_lows) if window_lows is not None else min(window_highs)
        
        close_idx = window_closes_idx - 1
        if close_idx < 0 or close_idx >= len(closes):
            continue
        
        if highest == lowest:
            k_values.append(50.0)
        else:
            k_val = ((closes[close_idx] - lowest) / (highest - lowest)) * 100
            k_values.append(k_val)
    
    if not k_values:
        # Fallback: single %K calculation
        recent_highs = highs[-period:]
        recent_lows = lows[-period:]
        highest = max(recent_highs)
        lowest = min(recent_lows)
        if highest == lowest:
            return {"k": 50.0, "d": 50.0}
        k = ((closes[-1] - lowest) / (highest - lowest)) * 100
        d = k  # لا توجد بيانات كافية لحساب %D
        return {"k": round(k, 2), "d": round(d, 2)}
    
    k = k_values[-1]
    d = sum(k_values) / len(k_values)  # SMA(d_period) للـ %K
    
    return {"k": round(k, 2), "d": round(d, 2)}


def calc_atr(highs: List[float], lows: List[float], closes: List[float],
             period: int = 14) -> Optional[float]:
    if len(closes) < 2:
        return None
    trs = []
    for i in range(1, len(closes)):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)
    if len(trs) < period:
        return round(sum(trs) / len(trs), 4) if trs else None
    atr = sum(trs[:period]) / period
    for i in range(period, len(trs)):
        atr = (atr * (period - 1) + trs[i]) / period
    return round(atr, 4)


def calc_obv(closes: List[float], volumes: List[float]) -> Optional[float]:
    if len(closes) < 2 or len(volumes) < 2:
        return None
    obv = 0.0
    for i in range(1, len(closes)):
        if closes[i] > closes[i - 1]:
            obv += volumes[i]
        elif closes[i] < closes[i - 1]:
            obv -= volumes[i]
    return round(obv, 2)


def calc_vwap(highs: List[float], lows: List[float], closes: List[float],
              volumes: List[float]) -> Optional[float]:
    cum_tpv = 0.0
    cum_vol = 0.0
    for h, l, c, v in zip(highs, lows, closes, volumes):
        tp = (h + l + c) / 3
        cum_tpv += tp * v
        cum_vol += v
    return round(cum_tpv / cum_vol, 4) if cum_vol > 0 else None


def calc_moving_averages(closes: List[float]) -> Dict[str, Optional[float]]:
    last = closes[-1] if closes else 0
    return {
        "ma5": _sma(closes, 5) if len(closes) >= 5 else round(last, 4),
        "ma10": _sma(closes, 10) if len(closes) >= 10 else round(last, 4),
        "ma20": _sma(closes, 20) if len(closes) >= 20 else round(last, 4),
        "ma50": _sma(closes, 50) if len(closes) >= 50 else None,
        "ma200": _sma(closes, 200) if len(closes) >= 200 else None,
    }


def detect_regime(closes: List[float]) -> str:
    """Detect market regime: BULL, BEAR, or RANGE."""
    if len(closes) < 50:
        return "RANGE"
    s20 = _sma(closes, 20)
    s50 = _sma(closes, 50)
    if s20 is None or s50 is None:
        return "RANGE"
    cp = closes[-1]
    # Compute slope of 20-period SMA over last 10 periods
    recent_s20 = []
    for i in range(max(0, len(closes) - 10), len(closes)):
        val = _sma(closes[: i + 1], 20)
        if val is not None:
            recent_s20.append(val)
    if len(recent_s20) >= 2:
        slope_pct = ((recent_s20[-1] - recent_s20[0]) / recent_s20[0]) * 100
    else:
        slope_pct = 0
    if slope_pct > 2 and cp > s20 and cp > s50 and s20 > s50:
        return "BULL"
    if slope_pct < -2 and cp < s20 and cp < s50 and s20 < s50:
        return "BEAR"
    return "RANGE"


# ──────────────────────────────────────────────────────────
# Main analysis
# ──────────────────────────────────────────────────────────

def analyze_ticker(ticker: str) -> Dict[str, Any]:
    history = _get_price_history(ticker)
    if not history:
        return {"error": f"No price history found for {ticker}", "ticker": ticker}

    closes = []
    highs = []
    lows = []
    volumes = []
    # PROD-HOTFIX (P0-3): volume ممكن يكون نص من TradingView ('792.7 K', '12.74 M').
    # float() بيرمي ValueError على الصيغ دي. نستخدم parse_volume الآمنة.
    try:
        from utils.helpers import parse_volume as _parse_vol
    except Exception:
        def _parse_vol(v):
            try:
                return int(float(v))
            except (TypeError, ValueError):
                return 0
    for row in history:
        c = float(row.get("close", 0))
        if c <= 0:
            continue
        closes.append(c)
        highs.append(float(row.get("high", c)))
        lows.append(float(row.get("low", c)))
        volumes.append(_parse_vol(row.get("volume", 0)))

    if not closes:
        return {"error": f"No valid price data for {ticker}", "ticker": ticker}

    result: Dict[str, Any] = {"ticker": ticker, "data_points": len(closes)}

    # RSI
    rsi = calc_rsi(closes)
    result["rsi"] = rsi

    # MACD
    macd = calc_macd(closes)
    result["macd"] = macd or {"line": 0, "signal": 0, "histogram": 0}

    # Bollinger Bands
    bb = calc_bollinger(closes)
    result["bollinger"] = bb or {"upper": None, "middle": None, "lower": None}

    # Stochastic
    stoch = calc_stochastic(highs, lows, closes)
    result["stochastic"] = stoch or {"k": None, "d": None}

    # ATR
    atr = calc_atr(highs, lows, closes)
    result["atr"] = atr

    # OBV
    obv = calc_obv(closes, volumes)
    result["obv"] = obv

    # VWAP
    vwap = calc_vwap(highs, lows, closes, volumes)
    result["vwap"] = vwap

    # Moving Averages
    mas = calc_moving_averages(closes)
    result["mas"] = mas

    # Market Regime
    result["regime"] = detect_regime(closes)

    return result


# ──────────────────────────────────────────────────────────
# CLI entry point
# ──────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Technical Analyzer CLI")
    parser.add_argument("--ticker", required=True, help="Stock ticker symbol")
    args = parser.parse_args()

    result = analyze_ticker(args.ticker)
    print(json.dumps(result, ensure_ascii=False))
