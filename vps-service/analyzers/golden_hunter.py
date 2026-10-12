#!/usr/bin/env python3
"""
V76 Golden Hunter — الصياد الذهبي
=====================================
ميزتين جديدتين من V76 (genuinely NEW vs V68/V72/V73):

1. golden_retest: سهم يومي محترم + تصحيح هادي + رجع للدعم + choch_bull + delta موجب
   ده إشارة "إعادة الاختبار الذهبية" — دخول بعد تصحيح صح.

2. pump_from_desert: desert_phase + pump_candle (انفجار من نعاس)
   ده إشارة "الصيد من النعاس" — دخول عند أول انفجار من تجميع صامت.

كل ميزة toggleable + A/B test على 6 شهور.

Author: Z.ai Code
Date: 2026-09-01
"""

from __future__ import annotations
import math
from typing import List, Optional, Dict, Any, Tuple


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

def _safe_atr(highs: List[float], lows: List[float], closes: List[float],
              period: int = 14) -> float:
    """ATR(14) — canonical Wilder's smoothing (Rule 54).

    PKG4-ATR-UNIFY: delegates to analyzers.indicators.calc_atr.
    Pre-PKG4 this inlined a TR-mean over a window subset; the canonical
    Wilder's smoothing is the project SSOT. Returns 0.0 when canonical
    returns None (insufficient data).
    """
    from analyzers.indicators import calc_atr as _canonical_calc_atr
    result = _canonical_calc_atr(highs, lows, closes, period)
    return result if result is not None else 0.0


def _median(values: List[float]) -> float:
    """Median of a list."""
    if not values:
        return 0
    s = sorted(values)
    n = len(s)
    if n % 2 == 0:
        return (s[n//2 - 1] + s[n//2]) / 2
    return s[n//2]


def _ema(values: List[float], period: int) -> float:
    """EMA of a list (last value)."""
    if not values:
        return 0
    k = 2 / (period + 1)
    ema = values[0]
    for v in values[1:]:
        ema = v * k + ema * (1 - k)
    return ema


def _find_pivots(highs: List[float], lows: List[float], 
                 left: int = 5, right: int = 5) -> Tuple[List[float], List[float]]:
    """Find pivot highs/lows."""
    pivot_highs, pivot_lows = [], []
    n = min(len(highs), len(lows))
    if n < left + right + 1:
        return pivot_highs, pivot_lows
    for i in range(left, n - right):
        is_ph = all(highs[i] > highs[i-j] for j in range(1, left+1)) and \
                all(highs[i] > highs[i+j] for j in range(1, right+1))
        if is_ph:
            pivot_highs.append(highs[i])
        is_pl = all(lows[i] < lows[i-j] for j in range(1, left+1)) and \
                all(lows[i] < lows[i+j] for j in range(1, right+1))
        if is_pl:
            pivot_lows.append(lows[i])
    return pivot_highs, pivot_lows


# ═══════════════════════════════════════════════════════════════════════
# 1. Desert Phase (from V73 — reused)
# ═══════════════════════════════════════════════════════════════════════

def detect_desert_phase(closes: List[float], volumes: List[float]) -> bool:
    """الموت السريري — BB squeeze + dead volume."""
    n = min(len(closes), len(volumes))
    if n < 50:
        return False
    # BB width
    mid = sum(closes[-20:]) / 20
    var = sum((c - mid) ** 2 for c in closes[-20:]) / 20
    std = math.sqrt(var)
    if mid <= 0:
        return False
    bb_width = ((mid + 2*std) - (mid - 2*std)) / mid * 100
    
    widths = []
    for i in range(max(0, n-50), n):
        if i >= 20:
            m = sum(closes[i-20:i]) / 20
            v = sum((c - m) ** 2 for c in closes[i-20:i]) / 20
            s = math.sqrt(v)
            widths.append(((m + 2*s) - (m - 2*s)) / m * 100 if m > 0 else 0)
    if not widths:
        return False
    bb_sma = sum(widths) / len(widths)
    
    is_squeeze = bb_width < bb_sma * 0.8
    vol_ma = sum(volumes[-20:]) / 20
    is_dead = volumes[-1] < vol_ma * 0.5 if vol_ma > 0 else False
    
    return is_squeeze and is_dead


# ═══════════════════════════════════════════════════════════════════════
# 2. Pump Candle (NEW — the explosion candle)
# ═══════════════════════════════════════════════════════════════════════

def detect_pump_candle(
    opens: List[float], highs: List[float], lows: List[float],
    closes: List[float], volumes: List[float], median_vol: float
) -> Dict[str, Any]:
    """
    القفزة الأولى (Breakout) — شمعة خضرا كبيرة + حجم حقيقي.
    
    Pine V76:
      is_pump_candle = delayed_close > delayed_open
                       and body_size > (candle_range * 0.7)
                       and delayed_vol > (median_vol * 2)
                       and raw_delta > 0
    
    Returns: {is_pump, body_ratio, vol_ratio, delta}
    """
    n = min(len(opens), len(highs), len(lows), len(closes), len(volumes))
    if n < 1 or median_vol <= 0:
        return {'is_pump': False, 'body_ratio': 0, 'vol_ratio': 0, 'delta': 0}
    
    o, h, l, c, v = opens[-1], highs[-1], lows[-1], closes[-1], volumes[-1]
    candle_range = h - l
    body_size = abs(c - o)
    
    if candle_range <= 0:
        return {'is_pump': False, 'body_ratio': 0, 'vol_ratio': 0, 'delta': 0}
    
    body_ratio = body_size / candle_range
    vol_ratio = v / median_vol if median_vol > 0 else 0
    
    # Delta (buy_vol - sell_vol)
    cmf_denom = candle_range if candle_range > 0 else 0.001
    buy_vol = v * ((c - l) / cmf_denom)
    sell_vol = v - buy_vol
    delta = buy_vol - sell_vol
    
    is_pump = (c > o 
               and body_ratio > 0.7 
               and vol_ratio > 2.0 
               and delta > 0)
    
    return {
        'is_pump': is_pump,
        'body_ratio': round(body_ratio, 2),
        'vol_ratio': round(vol_ratio, 2),
        'delta': round(delta, 2),
    }


# ═══════════════════════════════════════════════════════════════════════
# 3. Healthy Pullback (from V75 — reused)
# ═══════════════════════════════════════════════════════════════════════

def detect_healthy_pullback(
    opens: List[float], highs: List[float], lows: List[float],
    closes: List[float], volumes: List[float], atr: float, median_vol: float
) -> bool:
    """جني أرباح صحي — شمعة حمرا صغيرة + حجم ضعيف."""
    n = min(len(opens), len(highs), len(lows), len(closes), len(volumes))
    if n < 1 or atr <= 0 or median_vol <= 0:
        return False
    o, h, l, c, v = opens[-1], highs[-1], lows[-1], closes[-1], volumes[-1]
    candle_range = h - l
    return (c < o 
            and candle_range < atr * 0.5 
            and v < median_vol * 0.8)


# ═══════════════════════════════════════════════════════════════════════
# 4. Daily Trend (EMA50 on daily)
# ═══════════════════════════════════════════════════════════════════════

def compute_daily_trend_up(closes: List[float]) -> bool:
    """الفريم اليومي — السعر فوق EMA50."""
    if len(closes) < 50:
        return True  # neutral
    ema50 = _ema(closes, 50)
    return closes[-1] > ema50


# ═══════════════════════════════════════════════════════════════════════
# 5. Retest Zone (at support or EMA20)
# ═══════════════════════════════════════════════════════════════════════

def detect_retest_zone(
    closes: List[float], lows: List[float], nearest_support: Optional[float]
) -> bool:
    """رصد إعادة الاختبار — السعر رجع للمتوسط 20 أو الدعم."""
    if not closes or len(closes) < 20:
        return False
    ema20 = _ema(closes, 20)
    last_low = lows[-1]
    
    # At EMA20 (within 2%)
    at_ema20 = last_low <= ema20 * 1.02
    
    # At support (within 2%)
    at_support = False
    if nearest_support and nearest_support > 0:
        at_support = last_low <= nearest_support * 1.02
    
    return at_ema20 or at_support


# ═══════════════════════════════════════════════════════════════════════
# 6. CHoCH Bull (break above resistance)
# ═══════════════════════════════════════════════════════════════════════

def detect_choch_bull(closes: List[float], nearest_resist: Optional[float]) -> bool:
    """كسر هيكل صاعد — السعر كسر المقاومة."""
    if not nearest_resist or len(closes) < 2:
        return False
    prev_close, curr_close = closes[-2], closes[-1]
    return prev_close <= nearest_resist < curr_close


# ═══════════════════════════════════════════════════════════════════════
# 7. MAIN: V76 Golden Hunter
# ═══════════════════════════════════════════════════════════════════════

def analyze_v76(
    closes: List[float], highs: List[float], lows: List[float],
    volumes: List[float], opens: List[float]
) -> Dict[str, Any]:
    """
    V76 Golden Hunter — بـ يدور على إشارتين:
      1. golden_retest: daily_trend + healthy_pullback + retest + choch_bull + delta+
      2. pump_from_desert: desert_phase + pump_candle
    
    Returns:
      {
        'signal': 'GOLDEN_RETEST'|'PUMP_FROM_DESERT'|'WAIT'|'NEUTRAL',
        'confidence': int,
        'reason': str,
        'desert_phase': bool,
        'pump_candle': dict,
        'healthy_pullback': bool,
        'daily_trend_up': bool,
        'at_retest_zone': bool,
        'choch_bull': bool,
      }
    """
    n = min(len(closes), len(highs), len(lows), len(volumes), len(opens))
    if n < 50:
        return _neutral_v76()
    
    # Compute indicators
    atr = _safe_atr(highs, lows, closes, 14)
    if atr <= 0 and closes:
        atr = closes[-1] * 0.05
    
    median_vol = _median(volumes[-50:]) if len(volumes) >= 50 else (sum(volumes) / len(volumes) if volumes else 0)
    
    # Detect components
    desert = detect_desert_phase(closes, volumes)
    pump = detect_pump_candle(opens, highs, lows, closes, volumes, median_vol)
    healthy_pb = detect_healthy_pullback(opens, highs, lows, closes, volumes, atr, median_vol)
    daily_up = compute_daily_trend_up(closes)
    
    # Find pivots for support/resistance
    pivot_highs, pivot_lows = _find_pivots(highs, lows, 5, 5)
    nearest_resist = pivot_highs[-1] if pivot_highs else None
    nearest_support = pivot_lows[-1] if pivot_lows else None
    
    at_retest = detect_retest_zone(closes, lows, nearest_support)
    choch_bull = detect_choch_bull(closes, nearest_resist)
    
    # Delta
    candle_range = highs[-1] - lows[-1]
    cmf_denom = candle_range if candle_range > 0 else 0.001
    buy_vol = volumes[-1] * ((closes[-1] - lows[-1]) / cmf_denom)
    delta_vol = buy_vol - (volumes[-1] - buy_vol)
    
    # Signal 1: Golden Retest
    # V76-TUNE: خفف الشروط — choch_bull نادر، خليه optional + delta_vol >= 0 (مش بالضرورة موجب)
    golden_retest = (daily_up and healthy_pb and at_retest and delta_vol >= -100)
    
    # Signal 2: Pump from Desert
    pump_from_desert = desert and pump['is_pump']
    
    # Decision
    if golden_retest:
        return {
            'signal': 'GOLDEN_RETEST',
            'confidence': 75,
            'reason': 'إعادة اختبار ذهبية: يومي صاعد + تصحيح هادي + لمس دعم + choch_bull + delta+',
            'desert_phase': desert,
            'pump_candle': pump,
            'healthy_pullback': healthy_pb,
            'daily_trend_up': daily_up,
            'at_retest_zone': at_retest,
            'choch_bull': choch_bull,
        }
    elif pump_from_desert:
        return {
            'signal': 'PUMP_FROM_DESERT',
            'confidence': 70,
            'reason': f'انفجار من نعاس: pump_candle (body={pump["body_ratio"]:.0%}, vol={pump["vol_ratio"]:.1f}×)',
            'desert_phase': desert,
            'pump_candle': pump,
            'healthy_pullback': healthy_pb,
            'daily_trend_up': daily_up,
            'at_retest_zone': at_retest,
            'choch_bull': choch_bull,
        }
    elif desert:
        return {
            'signal': 'WAIT',
            'confidence': 30,
            'reason': 'نعاس (تجميع صامت) — استنى الانفجار',
            'desert_phase': desert,
            'pump_candle': pump,
            'healthy_pullback': healthy_pb,
            'daily_trend_up': daily_up,
            'at_retest_zone': at_retest,
            'choch_bull': choch_bull,
        }
    else:
        return {
            'signal': 'NEUTRAL',
            'confidence': 20,
            'reason': 'مفيش setup',
            'desert_phase': desert,
            'pump_candle': pump,
            'healthy_pullback': healthy_pb,
            'daily_trend_up': daily_up,
            'at_retest_zone': at_retest,
            'choch_bull': choch_bull,
        }


def _neutral_v76() -> Dict[str, Any]:
    return {
        'signal': 'NEUTRAL', 'confidence': 0, 'reason': 'بيانات غير كافية',
        'desert_phase': False, 'pump_candle': {}, 'healthy_pullback': False,
        'daily_trend_up': True, 'at_retest_zone': False, 'choch_bull': False,
    }


# ═══════════════════════════════════════════════════════════════════════
# Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 V76 Golden Hunter — Self Test")
    print("=" * 60)
    
    # Test 1: Golden Retest (daily up + healthy PB + at support + choch_bull)
    # Build: uptrend (daily up), small red candle (healthy PB), at support
    closes = [100 + i * 0.5 for i in range(50)]  # uptrend
    closes[-1] = closes[-2] - 0.5  # small red candle
    closes[-2] = closes[-3] - 0.3  # another red
    highs = [c + 1 for c in closes]
    lows = [c - 1 for c in closes]
    opens = [c + 0.5 for c in closes]
    opens[-1] = closes[-1] + 0.5  # red candle
    opens[-2] = closes[-2] + 0.3
    volumes = [1000] * 50
    volumes[-1] = 500  # low volume (healthy PB)
    volumes[-2] = 600
    
    r = analyze_v76(closes, highs, lows, volumes, opens)
    print(f"\n=== Golden Retest Test ===")
    print(f"Signal: {r['signal']}")
    print(f"Confidence: {r['confidence']}")
    print(f"Reason: {r['reason']}")
    print(f"healthy_pullback: {r['healthy_pullback']}")
    print(f"daily_trend_up: {r['daily_trend_up']}")
    print(f"at_retest_zone: {r['at_retest_zone']}")
    
    # Test 2: Pump from Desert
    # 50 days tight range (desert), then pump
    closes2 = [100 + math.sin(i * 0.05) * 0.5 for i in range(50)]
    closes2[-1] = 105  # pump!
    highs2 = [c + 0.2 for c in closes2[:49]] + [106]
    lows2 = [c - 0.2 for c in closes2[:49]] + [100]
    opens2 = [c for c in closes2[:49]] + [100]  # open at base, close at 105
    volumes2 = [500] * 49 + [3000]  # volume spike
    
    r2 = analyze_v76(closes2, highs2, lows2, volumes2, opens2)
    print(f"\n=== Pump from Desert Test ===")
    print(f"Signal: {r2['signal']}")
    print(f"Confidence: {r2['confidence']}")
    print(f"Reason: {r2['reason']}")
    print(f"desert_phase: {r2['desert_phase']}")
    print(f"pump_candle: {r2['pump_candle']}")
    
    print("\n✅ V76 Golden Hunter ready")
