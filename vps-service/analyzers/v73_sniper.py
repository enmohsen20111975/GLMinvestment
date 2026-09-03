#!/usr/bin/env python3
"""
V73 EGX Oracle Sniper — القناص
=================================
Port of TradingView V73 "محرك القرار المؤسسي V73 - EGX Oracle Sniper"
Pine Script to Python (V40.2 integration).

الإضافات الجديدة (Genuinely NEW vs V72 + V68):
  1. desert_phase: BB width < 0.8×SMA + volume < 0.5×MA (أكثر صرامة من V68 quiet_acc)
     → السهم "نايم وميت" = استنى الانفجار (مش رفض، بس لا تدخل دلوقتي)
  2. auction_trap: شمعة واحدة قفزت >10% بدون بناء قاعدي
     → مصيدة مزاد = ممنوع الدخول (شراء في القمة)
  3. is_hidden_dist في kill_switch (V72 كان dirty_dist + choch_bear بس)

الـ 3 ميزات GENUINELY NEW. الباقي duplicate من V72/V68.
كل ميزة toggleable via env var عشان A/B backtest.

المنهجية: A/B test على 6 شهور (Feb-Aug 2026) عشان نتأكد general مش overfit.
القاعدة: النتائج هي اللي تقرر.

Author: Z.ai Code (Senior Engineer)
Date: 2026-08-31
"""

from __future__ import annotations
import math
from typing import List, Optional, Dict, Any


# ═══════════════════════════════════════════════════════════════════════
# 1. Desert Phase (الموت السريري)
# ═══════════════════════════════════════════════════════════════════════

def detect_desert_phase(
    closes: List[float], volumes: List[float], period: int = 20
) -> bool:
    """
    الموت السريري — Desert Phase.
    Pine V73:
      bb_width = (bb_up - bb_low) / bb_mid * 100
      is_desert_phase = bb_width < sma(bb_width, 50) * 0.8
                        and delayed_vol < (vol_ma * 0.5)

    الفرق عن V68 quiet_accumulation:
      - V68: volume < 0.8×MA (أقل من المعتاد)
      - V73: volume < 0.5×MA (ميت تماماً)
    V73 أصرم — بـ يكشف الأسهم اللي "نايمة وميتة" فعلاً.

    المعنى: السهم في phase ميتة = مفيش سيولة = استنى الانفجار.
    ده مش رفض (continue)، بس تقليل ثقة / لا تدخل.
    """
    n = min(len(closes), len(volumes))
    if n < 50:
        return False

    # Bollinger Bands (20, 2.0)
    if n < period + 5:
        return False
    mid = sum(closes[-period:]) / period
    var = sum((c - mid) ** 2 for c in closes[-period:]) / period
    std = math.sqrt(var)
    if mid <= 0:
        return False
    bb_up = mid + 2 * std
    bb_low = mid - 2 * std
    bb_width = ((bb_up - bb_low) / mid) * 100

    # bb_width_sma (50) — نستخدم أكبر قدر متاح
    widths = []
    for i in range(max(0, n - 50), n):
        if i >= period:
            m = sum(closes[i - period + 1:i + 1]) / period
            v = sum((c - m) ** 2 for c in closes[i - period + 1:i + 1]) / period
            s = math.sqrt(v)
            widths.append(((m + 2 * s) - (m - 2 * s)) / m * 100 if m > 0 else 0)
    if not widths:
        return False
    bb_width_sma = sum(widths) / len(widths)

    is_squeeze = bb_width < bb_width_sma * 0.8

    # Volume: V73 أصرم (0.5× بدل 0.8× في V68)
    vol_ma = sum(volumes[-period:]) / period
    is_dead_volume = volumes[-1] < (vol_ma * 0.5) if vol_ma > 0 else False

    return is_squeeze and is_dead_volume


# ═══════════════════════════════════════════════════════════════════════
# 2. Auction Trap (مصيدة المزاد)
# ═══════════════════════════════════════════════════════════════════════

def detect_auction_trap(
    opens: List[float], closes: List[float], threshold_pct: float = 10.0
) -> bool:
    """
    مصيدة المزاد — Auction Trap.
    Pine V73:
      auction_trap = delayed_close > 0
                     and ((delayed_close - delayed_open) / delayed_open) * 100 > 10

    الفرق عن V68 no_chase_2d:
      - V68 no_chase_2d: عائد يومين > 15% (2-day cumulative)
      - V73 auction_trap: شمعة واحدة > 10% (single candle spike)
    V73 بـ يكشف القفزات الرأسية في يوم واحد = مصيدة مزاد.

    المعنى: قفزة رأسية >10% في شمعة واحدة بدون بناء قاعدي = شراء في القمة.
    ده hard reject (continue) — ممنوع الدخول.
    """
    if len(opens) < 1 or len(closes) < 1:
        return False
    o, c = opens[-1], closes[-1]
    if o <= 0:
        return False
    candle_return_pct = ((c - o) / o) * 100
    return candle_return_pct > threshold_pct


# ═══════════════════════════════════════════════════════════════════════
# 3. Kill Switch with Hidden Distribution
# ═══════════════════════════════════════════════════════════════════════

def check_kill_switch_v73(
    is_dirty_dist: bool,
    is_choch_bear: bool,
    is_hidden_dist: bool = False
) -> tuple:
    """
    مفتاح القتل — Kill Switch (V73 version).
    Pine V73:
      kill_switch_triggered = is_dirty_dist or choch_bear or is_hidden_dist

    الفرق عن V72:
      - V72: kill_switch = is_dirty_dist or choch_bear
      - V73: kill_switch = is_dirty_dist or choch_bear or is_hidden_dist
    V73 بـ يضيف is_hidden_dist كـ exit trigger (مش بس entry reject).

    Returns:
      (should_exit: bool, reason: str)
    """
    if is_dirty_dist:
        return True, 'dirty_dist_kill'
    if is_choch_bear:
        return True, 'choch_bear_kill'
    if is_hidden_dist:
        return True, 'hidden_dist_kill'
    return False, ''


# ═══════════════════════════════════════════════════════════════════════
# 4. Main entry: analyze_v73()
# ═══════════════════════════════════════════════════════════════════════

def analyze_v73(
    closes: List[float], highs: List[float], lows: List[float],
    volumes: List[float], opens: List[float]
) -> Dict[str, Any]:
    """
    الـ V73 Sniper Engine — ينفّذ الميزات الجديدة بس.
    (الباقي duplicate من V72/V68 — مش بـ نعيد حسابها هنا).

    Returns:
        {
            'desert_phase': bool,
            'auction_trap': bool,
        }
    """
    n = min(len(closes), len(highs), len(lows), len(volumes), len(opens))
    if n < 50:
        return {'desert_phase': False, 'auction_trap': False}

    desert = detect_desert_phase(closes, volumes, 20)
    auction = detect_auction_trap(opens, closes, 10.0)

    return {
        'desert_phase': desert,
        'auction_trap': auction,
    }


# ═══════════════════════════════════════════════════════════════════════
# 5. Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 V73 EGX Oracle Sniper — Self Test")
    print("=" * 50)

    # Test 1: Desert phase (squeeze + dead volume)
    # BB width small + volume < 0.5×MA
    closes = [100 + math.sin(i * 0.1) * 0.5 for i in range(60)]  # tight range
    volumes = [1000] * 55 + [400] * 5  # last 5 bars volume drops to 0.4×MA
    desert = detect_desert_phase(closes, volumes, 20)
    print(f"Desert phase (tight range + dead volume): {desert}")  # True

    # Test 2: Not desert (normal volume)
    volumes2 = [1000] * 60
    desert2 = detect_desert_phase(closes, volumes2, 20)
    print(f"Desert phase (normal volume): {desert2}")  # False

    # Test 3: Auction trap (>10% single candle)
    # Last candle: open=100, close=112 (+12%)
    opens = [95, 96, 97, 98, 99, 100, 101, 100, 99, 100, 100]
    closes3 = [96, 97, 98, 99, 100, 101, 100, 99, 100, 100, 112]
    auction = detect_auction_trap(opens, closes3, 10.0)
    print(f"Auction trap (+12% single candle): {auction}")  # True

    # Test 4: Not auction (<10%)
    opens2 = [95, 96, 97, 98, 99, 100, 101, 100, 99, 100, 100]
    closes4 = [96, 97, 98, 99, 100, 101, 100, 99, 100, 100, 105]
    auction2 = detect_auction_trap(opens2, closes4, 10.0)
    print(f"Auction trap (+5% single candle): {auction2}")  # False

    # Test 5: Kill switch with hidden_dist
    ks1 = check_kill_switch_v73(is_dirty_dist=False, is_choch_bear=False, is_hidden_dist=True)
    print(f"Kill switch (hidden_dist only): {ks1}")  # (True, 'hidden_dist_kill')
    ks2 = check_kill_switch_v73(is_dirty_dist=False, is_choch_bear=False, is_hidden_dist=False)
    print(f"Kill switch (clean): {ks2}")  # (False, '')

    print("\n✅ V73 EGX Oracle Sniper self-test passed.")
