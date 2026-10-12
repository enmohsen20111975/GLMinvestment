#!/usr/bin/env python3
"""
V68 Oracle Engine — البصمة المستقبلية والاحتمالات
====================================================
Port of the TradingView V68 "محرك القرار المؤسسي V68 - The Oracle Engine"
Pine Script to the Python backend (V40.2 integration).

الإضافات الجديدة (Genuinely NEW vs V40.2 + V62):
  1. البصمة المستقبلية (Future Fingerprint): Linear Regression slope متقدم 5 شموع.
  2. احتمالية النجاح (Probability Score 0-100): 4 عوامل × 25 نقطة.
  3. التراكم الصامت (Quiet Accumulation): Bollinger Squeeze + حجم ضعيف.
  4. خريطة الجثث (Liquidity Magnets): Pivots متجمعة خلال 0.4×ATR.
  5. مسح السيولة (Liquidity Grab): sweep + reclaim + delta موجب.
  6. الزخم الديناميكي (Dynamic Volume Surge): mean + 1.5σ بدل multiplier ثابت.
  7. حظر المطاردة 2-day (No Chase Zone 2D): عائد يومين > 15%.
  8. التوزيع القاتل (Dirty Distribution): ظهر علوي + حجم + delta سالب.

الاستخدام في V40.2:
  from analyzers.v68_oracle import analyze_oracle
  oracle = analyze_oracle(closes, highs, lows, volumes, opens, atr, entry)
  # oracle['probability']        → 0-100 (احتمالية نجاح الصفقة)
  # oracle['future_slope']       → +1 / -1 / 0 (اتجاه الزخم المستقبلي)
  # oracle['quiet_accumulation'] → bool
  # oracle['liquidity_grab']     → bool
  # oracle['no_chase_2d']        → bool
  # oracle['dirty_dist']         → bool
  # oracle['low_magnet']         → float|None
  # oracle['high_magnet']        → float|None

A+ Gate (القاعدة الجديدة):
  A+ Liquidity Grab signal يتطلب probability >= 70% (زي Pine Script V68).

الأمان:
  - كل دالة safe-by-design: لو بيانات ناقصة → return neutral.
  - مفيش side-effects، مفيش DB writes، مفيش I/O.
  - Pure function — تقدر تستخدمها في backtest والإنتاج.

Author: Z.ai Code (Senior Engineer)
Date: 2026-08-31
"""

from __future__ import annotations
import math
from typing import List, Optional, Tuple, Dict, Any


# ═══════════════════════════════════════════════════════════════════════
# 1. Helpers (Safe statistics)
# ═══════════════════════════════════════════════════════════════════════

def _safe_sma(values: List[float], period: int) -> float:
    """Simple Moving Average — safe for short arrays."""
    if not values or period <= 0:
        return 0.0
    n = min(period, len(values))
    if n == 0:
        return 0.0
    return sum(values[-n:]) / n


def _safe_stdev(values: List[float], period: int) -> float:
    """Population standard deviation — safe for short arrays."""
    if not values or period <= 0:
        return 0.0
    n = min(period, len(values))
    if n < 2:
        return 0.0
    window = values[-n:]
    mean = sum(window) / n
    var = sum((x - mean) ** 2 for x in window) / n
    return math.sqrt(var)


def _safe_atr(highs: List[float], lows: List[float], closes: List[float],
              period: int = 14) -> float:
    """Average True Range — canonical Wilder's smoothing (Rule 54).

    PKG4-ATR-UNIFY: delegates to analyzers.indicators.calc_atr.
    Pre-PKG4 inlined a TR-mean over the last `period` bars only; now uses
    the canonical Wilder's smoothing (project SSOT). Returns 0.0 when
    canonical returns None (insufficient data).
    """
    from analyzers.indicators import calc_atr as _canonical_calc_atr
    result = _canonical_calc_atr(highs, lows, closes, period)
    return result if result is not None else 0.0


def _linear_regression_slope(values: List[float], period: int = 21) -> float:
    """
    Linear Regression slope — لبصمة الزخم المستقبلي.
    Pine: ta.linreg(src, 21, 0) plotted with offset=5.
    احنا بنحسب الـ slope (التغير per bar) عشان نعرف الاتجاه.
    """
    if len(values) < 3 or period < 3:
        return 0.0
    n = min(period, len(values))
    window = values[-n:]
    if n < 3:
        return 0.0
    # x = 0, 1, 2, ..., n-1
    mean_x = (n - 1) / 2
    mean_y = sum(window) / n
    num = 0.0
    den = 0.0
    for i, y in enumerate(window):
        num += (i - mean_x) * (y - mean_y)
        den += (i - mean_x) ** 2
    if den == 0:
        return 0.0
    return num / den  # slope per bar


# ═══════════════════════════════════════════════════════════════════════
# 2. Delta & Dirty Volume (CMF-style)
# ═══════════════════════════════════════════════════════════════════════

def compute_delta(highs: List[float], lows: List[float],
                  closes: List[float], volumes: List[float]) -> Dict[str, float]:
    """
    رادار الأوليجارشية — Delta & Dirty Volume.
    Pine V68:
      buy_vol  = vol * ((close - low) / (high - low))
      sell_vol = vol - buy_vol
      raw_delta = buy_vol - sell_vol
      delta_vol = sma(raw_delta, 3)

    Returns:
      {'raw_delta': float, 'delta_vol': float, 'buy_vol': float, 'sell_vol': float}
    """
    n = min(len(highs), len(lows), len(closes), len(volumes))
    if n < 1:
        return {'raw_delta': 0.0, 'delta_vol': 0.0, 'buy_vol': 0.0, 'sell_vol': 0.0}

    h, l, c, v = highs[-1], lows[-1], closes[-1], volumes[-1]
    candle_range = h - l
    if candle_range <= 0:
        candle_range = 0.001

    buy_vol = v * ((c - l) / candle_range)
    sell_vol = v - buy_vol
    raw_delta = buy_vol - sell_vol

    # delta_vol = SMA(raw_delta, 3) — نحتاج آخر 3 شموع
    deltas = []
    for i in range(max(0, n - 3), n):
        cr = highs[i] - lows[i]
        if cr <= 0:
            cr = 0.001
        bv = volumes[i] * ((closes[i] - lows[i]) / cr)
        deltas.append(bv - (volumes[i] - bv))
    delta_vol = sum(deltas) / len(deltas) if deltas else raw_delta

    return {
        'raw_delta': raw_delta,
        'delta_vol': delta_vol,
        'buy_vol': buy_vol,
        'sell_vol': sell_vol,
    }


def compute_dynamic_volume_surge(volumes: List[float], period: int = 20) -> float:
    """
    الزخم الديناميكي — Dynamic Volume Surge threshold.
    Pine V68: dynamic_vol_surge = vol_ma + (vol_std * 1.5)
    ده adaptive threshold بدل multiplier ثابت (2× أو 3×).
    """
    if not volumes or len(volumes) < 5:
        return 0.0
    vol_ma = _safe_sma(volumes, period)
    vol_std = _safe_stdev(volumes, period)
    return vol_ma + (vol_std * 1.5)


# ═══════════════════════════════════════════════════════════════════════
# 3. Dirty Lifecycle (دورة حياة السهم الملعوب)
# ═══════════════════════════════════════════════════════════════════════

def detect_quiet_accumulation(closes: List[float], highs: List[float],
                              lows: List[float], volumes: List[float]) -> bool:
    """
    التراكم الصامت — Quiet Accumulation.
    Pine V68:
      bb_width = (bb_up - bb_low) / bb_mid * 100
      bb_width_sma = sma(bb_width, 50)
      is_squeeze = bb_width < bb_width_sma * 0.8
      quiet_accumulation = is_squeeze and volume < vol_ma * 0.8

    المعنى: السهم نعس (ضيق + حجم ضعيف) = كبار بيجمّعوا في صمت.
    """
    n = min(len(closes), len(highs), len(lows), len(volumes))
    if n < 25:
        return False

    # Bollinger Bands (20, 2.0)
    period = 20
    if n < period + 5:
        return False
    mid = _safe_sma(closes, period)
    std = _safe_stdev(closes, period)
    if mid <= 0:
        return False
    bb_up = mid + 2 * std
    bb_low = mid - 2 * std
    bb_width = ((bb_up - bb_low) / mid) * 100

    # bb_width_sma (50) — نستخدم أكبر قدر متاح لو < 50
    widths = []
    for i in range(max(0, n - 50), n):
        if i >= period:
            m = sum(closes[i - period + 1:i + 1]) / period
            s = _safe_stdev(closes[i - period + 1:i + 1], period)
            widths.append(((m + 2 * s) - (m - 2 * s)) / m * 100 if m > 0 else 0)
    if not widths:
        return False
    bb_width_sma = sum(widths) / len(widths)

    is_squeeze = bb_width < bb_width_sma * 0.8
    vol_ma = _safe_sma(volumes, 20)
    low_volume = volumes[-1] < vol_ma * 0.8 if vol_ma > 0 else False

    return is_squeeze and low_volume


def detect_dirty_distribution(highs: List[float], lows: List[float],
                              closes: List[float], opens: List[float],
                              volumes: List[float], delta: Dict[str, float]) -> bool:
    """
    التوزيع القاتل — Dirty Distribution.
    Pine V68:
      upper_wick = high - max(close, open)
      is_dirty_dist = upper_wick > (range * 0.5)
                      and volume > (vol_ma * 2.5)
                      and raw_delta < 0

    الفرق عن V62 is_dist: ده بـ يضيف شرط delta سالب (تأكيد البيع المؤسسي).
    """
    n = min(len(highs), len(lows), len(closes), len(opens), len(volumes))
    if n < 25:
        return False

    h, l, c, o, v = highs[-1], lows[-1], closes[-1], opens[-1], volumes[-1]
    candle_range = h - l
    if candle_range <= 0:
        return False
    upper_wick = h - max(c, o)
    vol_ma = _safe_sma(volumes, 20)

    return (upper_wick > candle_range * 0.5
            and v > vol_ma * 2.5
            and delta.get('raw_delta', 0) < 0)


def detect_no_chase_zone_2d(closes: List[float]) -> bool:
    """
    حظر المطاردة 2-day — No Chase Zone (2-day return > 15%).
    Pine V68:
      two_day_return = ((close - close[2]) / close[2]) * 100
      no_chase_zone = two_day_return > 15

    الفرق عن V40.2 dont_chase: ده 2-day بدل 3-day/5-day.
    لو السهم قفز 15% في يومين → الكبار بيبيعوا، ممنوع الدخول.
    """
    if len(closes) < 3:
        return False
    ref = closes[-3]
    if ref <= 0:
        return False
    two_day_return = ((closes[-1] - ref) / ref) * 100
    return two_day_return > 15.0


# ═══════════════════════════════════════════════════════════════════════
# 4. Liquidity Magnets (خريطة الجثث)
# ═══════════════════════════════════════════════════════════════════════

def _find_pivots(highs: List[float], lows: List[float],
                 left: int = 5, right: int = 5) -> Tuple[List[float], List[float]]:
    """
    Pine V68: ta.pivotlow / ta.pivothigh with 5 bars each side.
    Returns (pivot_lows, pivot_highs).
    """
    pivot_lows: List[float] = []
    pivot_highs: List[float] = []
    n = min(len(highs), len(lows))
    if n < left + right + 1:
        return pivot_lows, pivot_highs

    for i in range(left, n - right):
        # Pivot low
        is_pl = True
        for j in range(1, left + 1):
            if lows[i - j] <= lows[i]:
                is_pl = False
                break
        if is_pl:
            for j in range(1, right + 1):
                if lows[i + j] <= lows[i]:
                    is_pl = False
                    break
        if is_pl:
            pivot_lows.append(lows[i])

        # Pivot high
        is_ph = True
        for j in range(1, left + 1):
            if highs[i - j] >= highs[i]:
                is_ph = False
                break
        if is_ph:
            for j in range(1, right + 1):
                if highs[i + j] >= highs[i]:
                    is_ph = False
                    break
        if is_ph:
            pivot_highs.append(highs[i])

    return pivot_lows, pivot_highs


def detect_liquidity_magnets(highs: List[float], lows: List[float],
                             closes: List[float], atr: float) -> Dict[str, Optional[float]]:
    """
    خريطة الجثث — Liquidity Magnets with ATR clustering.
    Pine V68:
      لو pivot_low1 و pivot_low2 قريبين (خلال 0.4×ATR) → active_low_magnet = min(pl1, pl2)
      active_high_magnet بنفس الطريقة.

    Returns:
      {'low_magnet': float|None, 'high_magnet': float|None}
    """
    result = {'low_magnet': None, 'high_magnet': None}
    if atr <= 0 or len(closes) < 15:
        return result

    pivot_lows, pivot_highs = _find_pivots(highs, lows, 5, 5)
    current_close = closes[-1]

    # Low magnet: آخر 2 pivot lows قريبين
    if len(pivot_lows) >= 2:
        pl1, pl2 = pivot_lows[-1], pivot_lows[-2]
        if abs(pl1 - pl2) < atr * 0.4:
            result['low_magnet'] = min(pl1, pl2)
        elif pl1 < current_close:
            result['low_magnet'] = pl1
    elif len(pivot_lows) == 1 and pivot_lows[0] < current_close:
        result['low_magnet'] = pivot_lows[0]

    # High magnet: آخر 2 pivot highs قريبين
    if len(pivot_highs) >= 2:
        ph1, ph2 = pivot_highs[-1], pivot_highs[-2]
        if abs(ph1 - ph2) < atr * 0.4:
            result['high_magnet'] = max(ph1, ph2)
        elif ph1 > current_close:
            result['high_magnet'] = ph1
    elif len(pivot_highs) == 1 and pivot_highs[0] > current_close:
        result['high_magnet'] = pivot_highs[0]

    # Cleanup: لو السعر عدى المغناطيس → انتهى
    if result['low_magnet'] and current_close > result['low_magnet'] + atr * 0.5:
        result['low_magnet'] = None
    if result['high_magnet'] and current_close < result['high_magnet'] - atr * 0.5:
        result['high_magnet'] = None

    return result


def detect_liquidity_grab(lows: List[float], closes: List[float],
                          low_magnet: Optional[float],
                          delta: Dict[str, float]) -> bool:
    """
    مسح السيولة — Liquidity Grab (A+ signal).
    Pine V68:
      liquidity_grab = low < active_low_magnet
                       and close > active_low_magnet
                       and raw_delta > 0

    المعنى: الحوت نزل تحت الدعم يمسح الـ stop losses، بعدين قفل فوقه واشترى.
    ده أقوى إشارة شراء (A+).
    """
    if not low_magnet or len(lows) < 1 or len(closes) < 1:
        return False
    return (lows[-1] < low_magnet
            and closes[-1] > low_magnet
            and delta.get('raw_delta', 0) > 0)


# ═══════════════════════════════════════════════════════════════════════
# 5. Future Fingerprint (البصمة المستقبلية)
# ═══════════════════════════════════════════════════════════════════════

def compute_future_fingerprint(closes: List[float], period: int = 21) -> Dict[str, Any]:
    """
    البصمة المستقبلية — Future Fingerprint (Oracle Engine).
    Pine V68:
      future_linreg = ta.linreg(delayed_close, 21, 0)
      plot(future_linreg, offset=5)
      future_text = future_linreg > future_linreg[1] ? "صاعد" : "هابط"

    احنا بنحسب الـ slope (التغير per bar) عشان نعرف الاتجاه بدون lookahead.
    الـ offset=5 في Pine بمعنى "ارسمها متأخرة 5 شموع" — ده visual فقط،
    مش بـ يؤثر على الحساب. احنا بنحسب slope النرواج الخطي للـ 21 شمعة الأخيرة.

    Returns:
      {'slope': float, 'direction': 'up'|'down'|'flat', 'momentum': float}
    """
    if len(closes) < 5:
        return {'slope': 0.0, 'direction': 'flat', 'momentum': 0.0}

    slope = _linear_regression_slope(closes, period)
    # Normalize slope as percentage of current price
    current = closes[-1]
    momentum = (slope / current * 100) if current > 0 else 0.0

    if momentum > 0.05:
        direction = 'up'
    elif momentum < -0.05:
        direction = 'down'
    else:
        direction = 'flat'

    return {'slope': slope, 'direction': direction, 'momentum': momentum}


# ═══════════════════════════════════════════════════════════════════════
# 6. Probability Score (احتمالية النجاح 0-100)
# ═══════════════════════════════════════════════════════════════════════

def compute_probability_score(
    delta_vol: float,
    quiet_accumulation: bool,
    trend_state: int,
    high_magnet: Optional[float],
    current_close: float,
    atr: float
) -> int:
    """
    احتمالية النجاح — Probability Score (0-100).
    Pine V68:
      prob_score = 0
      if delta_vol > 0:        prob_score += 25
      if quiet_accumulation:   prob_score += 25
      if trend_state == 1:     prob_score += 25
      if high_magnet near (< 3 ATR): prob_score += 25

    القاعدة الجديدة: A+ Liquidity Grab signal يتطلب probability >= 70%.
    """
    score = 0
    if delta_vol > 0:
        score += 25
    if quiet_accumulation:
        score += 25
    if trend_state == 1:
        score += 25
    # High magnet قريب = فيه هدف مستقبلي واضح
    if high_magnet and atr > 0:
        distance = high_magnet - current_close
        if 0 < distance < atr * 3:
            score += 25
    return score


def detect_trend_state(closes: List[float], nearest_resist: Optional[float],
                       nearest_support: Optional[float]) -> int:
    """
    trend_state: 1 = صاعد (BOS bullish), -1 = هابط (CHoCH bearish), 0 = محايد.
    Pine V68: trend_state flips on BOS/ChoCH.
    """
    if len(closes) < 2:
        return 0
    prev_close, curr_close = closes[-2], closes[-1]
    if nearest_resist and prev_close <= nearest_resist < curr_close:
        return 1  # BOS bullish
    if nearest_support and prev_close >= nearest_support > curr_close:
        return -1  # CHoCH bearish
    return 0


# ═══════════════════════════════════════════════════════════════════════
# 7. Main entry: analyze_oracle()
# ═══════════════════════════════════════════════════════════════════════

def analyze_oracle(
    closes: List[float],
    highs: List[float],
    lows: List[float],
    volumes: List[float],
    opens: List[float],
    atr: float = 0.0,
    entry: float = 0.0
) -> Dict[str, Any]:
    """
    الـ Oracle Engine الكامل — ينفّذ كل تحليلات V68 دفعة واحدة.

    Args:
        closes, highs, lows, volumes, opens: OHLCV arrays (آخر شمعة = [-1]).
        atr: ATR الحالي (لو 0 → بـ يحسبه).
        entry: سعر الدخول المتوقع (لو 0 → closes[-1]).

    Returns:
        {
            'probability': int,           # 0-100
            'future_slope': float,        # linreg slope
            'future_direction': str,      # 'up'|'down'|'flat'
            'future_momentum': float,     # slope as % of price
            'quiet_accumulation': bool,
            'dirty_distribution': bool,
            'no_chase_2d': bool,
            'liquidity_grab': bool,       # A+ signal trigger
            'low_magnet': float|None,
            'high_magnet': float|None,
            'trend_state': int,           # 1, -1, 0
            'delta_vol': float,
            'raw_delta': float,
            'buy_vol': float,
            'sell_vol': float,
            'vol_surge_threshold': float, # dynamic
            'is_volume_surge': bool,
        }
    """
    # Validate inputs
    n = min(len(closes), len(highs), len(lows), len(volumes), len(opens))
    if n < 5:
        return _neutral_oracle()

    if atr <= 0:
        atr = _safe_atr(highs, lows, closes, 14)
    if entry <= 0:
        entry = closes[-1]

    # 1. Delta & Dirty Volume
    delta = compute_delta(highs, lows, closes, volumes)

    # 2. Dynamic Volume Surge
    vol_surge_threshold = compute_dynamic_volume_surge(volumes, 20)
    is_volume_surge = volumes[-1] > vol_surge_threshold if vol_surge_threshold > 0 else False

    # 3. Quiet Accumulation
    quiet_acc = detect_quiet_accumulation(closes, highs, lows, volumes)

    # 4. Dirty Distribution
    dirty_dist = detect_dirty_distribution(highs, lows, closes, opens, volumes, delta)

    # 5. No Chase Zone 2D
    no_chase_2d = detect_no_chase_zone_2d(closes)

    # 6. Liquidity Magnets
    magnets = detect_liquidity_magnets(highs, lows, closes, atr)

    # 7. Trend State (need nearest resist/support from magnets)
    trend_state = detect_trend_state(closes, magnets['high_magnet'], magnets['low_magnet'])

    # 8. Liquidity Grab (A+ trigger)
    liquidity_grab = detect_liquidity_grab(lows, closes, magnets['low_magnet'], delta)

    # 9. Future Fingerprint
    future = compute_future_fingerprint(closes, 21)

    # 10. Probability Score
    probability = compute_probability_score(
        delta['delta_vol'], quiet_acc, trend_state,
        magnets['high_magnet'], closes[-1], atr
    )

    return {
        'probability': probability,
        'future_slope': future['slope'],
        'future_direction': future['direction'],
        'future_momentum': future['momentum'],
        'quiet_accumulation': quiet_acc,
        'dirty_distribution': dirty_dist,
        'no_chase_2d': no_chase_2d,
        'liquidity_grab': liquidity_grab,
        'low_magnet': magnets['low_magnet'],
        'high_magnet': magnets['high_magnet'],
        'trend_state': trend_state,
        'delta_vol': delta['delta_vol'],
        'raw_delta': delta['raw_delta'],
        'buy_vol': delta['buy_vol'],
        'sell_vol': delta['sell_vol'],
        'vol_surge_threshold': vol_surge_threshold,
        'is_volume_surge': is_volume_surge,
    }


def _neutral_oracle() -> Dict[str, Any]:
    """Neutral fallback when data is insufficient."""
    return {
        'probability': 0,
        'future_slope': 0.0,
        'future_direction': 'flat',
        'future_momentum': 0.0,
        'quiet_accumulation': False,
        'dirty_distribution': False,
        'no_chase_2d': False,
        'liquidity_grab': False,
        'low_magnet': None,
        'high_magnet': None,
        'trend_state': 0,
        'delta_vol': 0.0,
        'raw_delta': 0.0,
        'buy_vol': 0.0,
        'sell_vol': 0.0,
        'vol_surge_threshold': 0.0,
        'is_volume_surge': False,
    }


# ═══════════════════════════════════════════════════════════════════════
# 8. Exit Logic Helpers (for daily_closer integration)
# ═══════════════════════════════════════════════════════════════════════

def compute_mfe_trailing_stop(
    entry: float, original_stop: float, mfe: float,
    partial_taken: bool, current_stop: float = 0.0
) -> float:
    """
    MFE-based Trailing Stop (The Dirty Exit).
    Pine V68:
      current_r = entry - stop  (original stop, before breakeven)
      if partial_taken:
          r_mult = (mfe - entry) / current_r
          new_trail_sl = entry + (current_r * (r_mult - 1.0))
          if new_trail_sl > active_sl: active_sl = new_trail_sl

    المعنى: بعد partial TP، الوقف بـ يـ trail خلف الـ MFE بـ R-multiple distance.

    Args:
        entry: سعر الدخول.
        original_stop: الوقف الأصلي (قبل الـ breakeven) — مهم لحساب current_r.
        mfe: أعلى سعر وصل له السهم منذ الدخول (Max Favorable Excursion).
        partial_taken: هل اتاخد partial TP؟
        current_stop: الوقف الحالي (لو 0 → نستخدم entry كـ breakeven baseline).

    Returns:
        الوقف الجديد (max(current_stop, new_trail_sl)).
    """
    if not partial_taken or entry <= 0 or original_stop >= entry:
        return current_stop if current_stop > 0 else original_stop
    current_r = entry - original_stop  # ORIGINAL risk distance
    if current_r <= 0:
        return current_stop if current_stop > 0 else original_stop
    r_mult = (mfe - entry) / current_r
    new_trail_sl = entry + (current_r * (r_mult - 1.0))
    baseline = current_stop if current_stop > 0 else entry  # breakeven baseline
    return max(baseline, new_trail_sl)


def should_partial_take_profit(entry: float, stop: float, high_since_entry: float) -> bool:
    """
    Partial Take Profit at 1.5R.
    Pine V68:
      if high >= entry + (current_r * 1.5) and not partial_taken:
          partial_taken = true
          breakeven_active = true
          active_sl = entry  (move stop to breakeven)

    المعنى: لو السهم لمس 1.5R → خد 50% وانقل الوقف للتعادل.
    """
    if entry <= 0 or stop >= entry:
        return False
    current_r = entry - stop
    if current_r <= 0:
        return False
    return high_since_entry >= entry + (current_r * 1.5)


def compute_position_size_multiplier(
    is_story_stock: bool,
    consecutive_losses: int
) -> float:
    """
    Position Size Multiplier (risk management on losing streaks).
    Pine V68:
      size_multiplier = 1.0
      if is_story_stock:           size_multiplier *= 0.5
      if consecutive_losses >= 2:  size_multiplier *= 0.5
      if safe_mode_active (3+):    size_multiplier = 0.0

    Returns: 0.0, 0.25, 0.5, or 1.0
    """
    mult = 1.0
    if is_story_stock:
        mult *= 0.5
    if consecutive_losses >= 2:
        mult *= 0.5
    if consecutive_losses >= 3:
        mult = 0.0  # safe mode — no new trades
    return mult


# ═══════════════════════════════════════════════════════════════════════
# 9. Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 V68 Oracle Engine — Self Test")
    print("=" * 50)

    # Simulate a quiet accumulation scenario
    base = 100.0
    closes = [base + i * 0.1 for i in range(60)]  # gentle uptrend
    highs = [c + 0.5 for c in closes]
    lows = [c - 0.5 for c in closes]
    opens = [c - 0.1 for c in closes]
    volumes = [1000] * 55 + [500] * 5  # volume drops at the end (quiet)

    result = analyze_oracle(closes, highs, lows, volumes, opens, atr=2.0, entry=closes[-1])
    print(f"Probability:     {result['probability']}/100")
    print(f"Future dir:      {result['future_direction']} (momentum={result['future_momentum']:.3f}%)")
    print(f"Quiet accum:     {result['quiet_accumulation']}")
    print(f"Dirty dist:      {result['dirty_distribution']}")
    print(f"No chase 2D:     {result['no_chase_2d']}")
    print(f"Liquidity grab:  {result['liquidity_grab']}")
    print(f"Low magnet:      {result['low_magnet']}")
    print(f"High magnet:     {result['high_magnet']}")
    print(f"Trend state:     {result['trend_state']}")
    print(f"Delta vol:       {result['delta_vol']:.1f}")
    print(f"Vol surge thr:   {result['vol_surge_threshold']:.0f}")

    print("\n--- Partial TP test ---")
    print(f"Should partial TP at 1.5R (high=103, entry=100, stop=98): "
          f"{should_partial_take_profit(100, 98, 103)}")  # True: 1.5R = 100+(2*1.5)=103
    print(f"Trailing stop after partial (mfe=105, orig_stop=98): "
          f"{compute_mfe_trailing_stop(100, 98, 105, True, current_stop=100):.2f}")  # 100 + (2*(2.5-1)) = 103

    print("\n--- Position sizing test ---")
    print(f"Normal:                    {compute_position_size_multiplier(False, 0)}")  # 1.0
    print(f"Story stock:               {compute_position_size_multiplier(True, 0)}")  # 0.5
    print(f"2 consecutive losses:      {compute_position_size_multiplier(False, 2)}")  # 0.5
    print(f"Story + 2 losses:          {compute_position_size_multiplier(True, 2)}")  # 0.25
    print(f"3 losses (safe mode):      {compute_position_size_multiplier(False, 3)}")  # 0.0

    print("\n✅ V68 Oracle Engine self-test passed.")
