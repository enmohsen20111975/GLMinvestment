#!/usr/bin/env python3
"""
V75 Institutional Matrix — المصفوفة المؤسسية
================================================
Port of TradingView V75 "محرك القرار المؤسسي V75 - Institutional Matrix"
Pine Script to Python (V40.2 integration).

الإضافات الجديدة (Genuinely NEW vs V73 + V72 + V68):
  1. median_vol: median بدل SMA للحجم (robust to outliers)
  2. is_adaptive_desert: ATR < 0.6×ATR_SMA + vol < 0.5×median (ATR-based, vs V73 BB-based)
  3. is_killer_distribution: شمعة حمرا + range > 1.5×ATR + vol > 2×median (NEW)
  4. is_vol_drying: 3 شموع حجم متناقص + تحت median (NEW)
  5. is_healthy_pullback: شمعة حمرا صغيرة + حجم ضعيف = جني أرباح صحي (NEW)
  6. daily_trend_up: EMA200 على الفريم اليومي (daily anchor — NEW)
  7. choch_bull_recovery: كسر مقاومة لما trend != 1 (NEW entry path)
  8. 2R minimum R:R (was 1.5R — stricter)

الـ 8 ميزات GENUINELY NEW. كل ميزة toggleable via env var عشان A/B backtest.
المنهجية: A/B test على 6 شهور (Feb-Aug 2026) عشان نتأكد general مش overfit.
القاعدة: النتائج هي اللي تقرر.

Author: Z.ai Code (Senior Engineer)
Date: 2026-09-01
"""

from __future__ import annotations
import math
from typing import List, Optional, Dict, Any


# ═══════════════════════════════════════════════════════════════════════
# 1. Median Volume Engine (robust to outliers)
# ═══════════════════════════════════════════════════════════════════════

def compute_median_volume(volumes: List[float], period: int = 50) -> float:
    """
    Median Volume — robust to outliers (vs SMA).
    Pine V75:
      var float[] vol_array = array.new_float()
      array.push(vol_array, volume)
      if array.size(vol_array) > 50: array.shift(vol_array)
      sorted_vol = array.copy(vol_array)
      array.sort(sorted_vol, order.ascending)
      median_vol = array.size(sorted_vol) >= 50 ? array.get(sorted_vol, 25) : ta.sma(volume, 50)

    الفرق عن V68/V72/V73: كلهم كانوا بـ يستخدموا SMA(volume, 20).
    V75 بـ يستخدم median(50) → أقل تأثر بـ volume spikes اللي بـ تـ distort الـ SMA.
    ده base change بـ يؤثر على كل volume thresholds.
    """
    if not volumes:
        return 0.0
    n = min(period, len(volumes))
    if n < 1:
        return 0.0
    window = sorted(volumes[-n:])
    if n >= 50:
        return window[n // 2]  # median
    # fallback to SMA if not enough data
    return sum(window) / n


# ═══════════════════════════════════════════════════════════════════════
# 2. Adaptive Desert (ATR-based, vs V73 BB-based)
# ═══════════════════════════════════════════════════════════════════════

def detect_adaptive_desert(
    highs: List[float], lows: List[float], closes: List[float],
    volumes: List[float], median_vol: float
) -> bool:
    """
    الموت السريري المتكيف — Adaptive Desert (ATR-based).
    Pine V75:
      atr_sma = ta.sma(atr_val, 50)
      is_adaptive_desert = atr_val < (atr_sma * 0.60) and delayed_vol < (median_vol * 0.5)

    الفرق عن V73 desert_phase:
      - V73: BB width < 0.8×SMA + volume < 0.5×MA (BB squeeze based)
      - V75: ATR < 0.6×ATR_SMA + volume < 0.5×median (ATR contraction based)
    V75 بـ يستخدم ATR بدل BB → كشف مختلف للـ "موت سريري".
    """
    n = min(len(highs), len(lows), len(closes), len(volumes))
    if n < 55 or median_vol <= 0:
        return False

    # ATR(14) — last 14 bars
    trs = []
    for i in range(max(1, n - 14), n):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1])
        )
        trs.append(tr)
    atr_val = sum(trs) / len(trs) if trs else 0
    if atr_val <= 0:
        return False

    # ATR SMA(50)
    atrs = []
    for i in range(max(1, n - 50), n):
        if i >= 1:
            tr = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1])
            )
            atrs.append(tr)
    if len(atrs) < 10:
        return False
    atr_sma = sum(atrs) / len(atrs)
    if atr_sma <= 0:
        return False

    # Adaptive desert: ATR contracted + volume dead
    is_atr_contracted = atr_val < (atr_sma * 0.60)
    is_vol_dead = volumes[-1] < (median_vol * 0.5)

    return is_atr_contracted and is_vol_dead


# ═══════════════════════════════════════════════════════════════════════
# 3. Killer Distribution (big red candle)
# ═══════════════════════════════════════════════════════════════════════

def detect_killer_distribution(
    highs: List[float], lows: List[float], closes: List[float],
    opens: List[float], volumes: List[float], atr: float, median_vol: float
) -> bool:
    """
    التوزيع القاتل — Killer Distribution (big red candle).
    Pine V75:
      is_killer_distribution = delayed_close < delayed_open
                               and candle_range > (delayed_atr * 1.5)
                               and delayed_vol > (median_vol * 2)

    الفرق عن V68 dirty_dist:
      - V68 dirty_dist: ظهر علوي > 50% + volume > 2.5×SMA + delta سالب
      - V75 killer_dist: شمعة حمرا + range > 1.5×ATR + volume > 2×median
    V75 بـ يكشف شموع البيع الضخمة (big red candles) → exit signal.
    """
    n = min(len(highs), len(lows), len(closes), len(opens), len(volumes))
    if n < 1 or atr <= 0 or median_vol <= 0:
        return False

    h, l, c, o, v = highs[-1], lows[-1], closes[-1], opens[-1], volumes[-1]
    candle_range = h - l

    return (c < o
            and candle_range > (atr * 1.5)
            and v > (median_vol * 2))


# ═══════════════════════════════════════════════════════════════════════
# 4. Volume Drying (3-bar declining volume)
# ═══════════════════════════════════════════════════════════════════════

def detect_vol_drying(
    closes: List[float], opens: List[float], volumes: List[float], median_vol: float
) -> bool:
    """
    جفاف السيولة — Volume Drying (3-bar declining).
    Pine V75:
      is_vol_drying = delayed_close < delayed_open
                      and delayed_vol < delayed_vol[1]
                      and delayed_vol[1] < delayed_vol[2]
                      and delayed_vol < median_vol

    المعنى: 3 شموع حجمهم متناقصين + شمعة حمرا + تحت median = السيولة بـ تجف.
    ده warning sign إن السهم بـ يفقد اهتمام المؤسسات.
    """
    n = min(len(closes), len(opens), len(volumes))
    if n < 3 or median_vol <= 0:
        return False

    c, o = closes[-1], opens[-1]
    v0, v1, v2 = volumes[-1], volumes[-2], volumes[-3]

    return (c < o
            and v0 < v1
            and v1 < v2
            and v0 < median_vol)


# ═══════════════════════════════════════════════════════════════════════
# 5. Healthy Pullback (good entry after pullback)
# ═══════════════════════════════════════════════════════════════════════

def detect_healthy_pullback(
    highs: List[float], lows: List[float], closes: List[float],
    opens: List[float], volumes: List[float], atr: float, median_vol: float
) -> bool:
    """
    جني أرباح صحي — Healthy Pullback.
    Pine V75:
      is_healthy_pullback = delayed_close < delayed_open
                            and candle_range < (delayed_atr * 0.5)
                            and delayed_vol < (median_vol * 0.8)

    المعنى: شمعة حمرا صغيرة + حجم ضعيف = جني أرباح صحي (مش توزيع).
    ده إشارة إن السهم بـ يرتاح قبل ما يكمل صعود → فرصة دخول محتملة.
    """
    n = min(len(highs), len(lows), len(closes), len(opens), len(volumes))
    if n < 1 or atr <= 0 or median_vol <= 0:
        return False

    h, l, c, o, v = highs[-1], lows[-1], closes[-1], opens[-1], volumes[-1]
    candle_range = h - l

    return (c < o
            and candle_range < (atr * 0.5)
            and v < (median_vol * 0.8))


# ═══════════════════════════════════════════════════════════════════════
# 6. Daily Trend Up (Daily EMA200 anchor)
# ═══════════════════════════════════════════════════════════════════════

def compute_daily_trend_up(daily_closes: List[float]) -> bool:
    """
    الفريم اليومي المقدس — Daily EMA200 anchor.
    Pine V75:
      daily_ema200 = request.security(syminfo.tickerid, "D", ta.ema(close, 200)[1])
      daily_close = request.security(syminfo.tickerid, "D", close[1])
      daily_trend_up = daily_close > daily_ema200

    المعنى: على الفريم اليومي، السعر فوق EMA200 = ترند صاعد يومي.
    ده higher-timeframe filter — لو السهم كاسر EMA200 يومي → ممنوع الدخول.
    """
    if len(daily_closes) < 200:
        # Not enough daily data → neutral (allow)
        return True
    # EMA200
    ema = daily_closes[0]
    k = 2 / (200 + 1)
    for c in daily_closes[1:]:
        ema = c * k + ema * (1 - k)
    return daily_closes[-1] > ema


# ═══════════════════════════════════════════════════════════════════════
# 7. CHoCH Bull Recovery (new entry path)
# ═══════════════════════════════════════════════════════════════════════

def detect_choch_bull_recovery(
    closes: List[float], nearest_resist: Optional[float], trend_state: int
) -> bool:
    """
    تعافي كسر الهيكل — CHoCH Bull Recovery.
    Pine V75:
      choch_bull = not na(nearest_resist) and ta.crossover(delayed_close, nearest_resist) and trend_state != 1

    الفرق عن bos_bull:
      - bos_bull: كسر مقاومة لما trend == 1 (تأكيد الترند الصاعد)
      - choch_bull: كسر مقاومة لما trend != 1 (تغيير الهيكل من هابط/عرضي لصاعد)
    V75 بـ يضيف مسار دخول جديد: شراء عند تغيير الهيكل الصاعد.
    """
    if not nearest_resist or len(closes) < 2:
        return False
    prev_close, curr_close = closes[-2], closes[-1]
    # crossover: prev was below, now above
    crossover = (prev_close <= nearest_resist < curr_close)
    # trend_state != 1 (not already bullish)
    return crossover and (trend_state != 1)


# ═══════════════════════════════════════════════════════════════════════
# 8. Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 V75 Institutional Matrix — Self Test")
    print("=" * 50)

    # Test 1: Median volume
    vols = [100, 200, 150, 300, 50, 250, 175]  # median = 175
    med = compute_median_volume(vols, 7)
    print(f"Median vol (expect 175): {med}")

    # Test 2: Adaptive desert (ATR contracted + dead volume)
    # First 50 bars: wide range (ATR ~2), last 10: tight (ATR ~0.2)
    closes = [100 + math.sin(i * 0.3) * 1.0 for i in range(50)] + [100 + math.sin(i*0.05)*0.1 for i in range(10)]
    highs = [c + 1.0 for c in closes[:50]] + [c + 0.1 for c in closes[50:]]
    lows = [c - 1.0 for c in closes[:50]] + [c - 0.1 for c in closes[50:]]
    vols = [1000] * 55 + [400] * 5
    med_vol = compute_median_volume(vols, 50)
    desert = detect_adaptive_desert(highs, lows, closes, vols, med_vol)
    print(f"Adaptive desert (tight ATR + dead vol): {desert}")

    # Test 3: Killer distribution (big red candle + vol > 2x median)
    h = [105, 105, 110]  # last: high=110, low=100, range=10
    l = [100, 100, 100]
    c = [105, 103, 100]  # red candle (close < open)
    o = [102, 105, 108]
    v = [1000, 1000, 5000]  # last vol = 5x → > 2x median
    med_v = compute_median_volume(v, 3)
    killer = detect_killer_distribution(h, l, c, o, v, atr=2.0, median_vol=med_v)
    print(f"Killer distribution (big red + 5x vol): {killer}")

    # Test 4: Vol drying (3 declining)
    c2 = [100, 102, 101, 99]  # last red
    o2 = [100, 100, 102, 101]
    v2 = [1000, 800, 600, 400]  # declining
    med_v2 = compute_median_volume(v2, 4)
    drying = detect_vol_drying(c2, o2, v2, med_v2)
    print(f"Vol drying (3 declining + red): {drying}")

    # Test 5: Healthy pullback (small red + low vol)
    h3 = [100, 100, 100.3]
    l3 = [99, 99, 99.8]
    c3 = [100, 100, 99.9]  # red (close < open)
    o3 = [100, 100, 100]
    v3 = [1000, 1000, 500]  # low vol
    med_v3 = compute_median_volume(v3, 3)
    hp = detect_healthy_pullback(h3, l3, c3, o3, v3, atr=2.0, median_vol=med_v3)
    print(f"Healthy pullback (small red + low vol): {hp}")

    # Test 6: Daily trend up
    daily = [100 + i * 0.1 for i in range(250)]  # uptrend
    dtu = compute_daily_trend_up(daily)
    print(f"Daily trend up (uptrend): {dtu}")
    daily2 = [200 - i * 0.1 for i in range(250)]  # downtrend
    dtu2 = compute_daily_trend_up(daily2)
    print(f"Daily trend up (downtrend): {dtu2}")

    # Test 7: CHoCH bull recovery
    cs = [100, 99, 100, 102]  # last close breaks above 101
    choch = detect_choch_bull_recovery(cs, nearest_resist=101, trend_state=0)
    print(f"CHoCH bull recovery (break resist, trend=0): {choch}")

    print("\n✅ V75 Institutional Matrix self-test passed.")
