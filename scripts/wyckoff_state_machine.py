#!/usr/bin/env python3
"""
wyckoff_state_machine.py — آلة حالة وايكوف الحقيقية بـ Volume Profile.

الـ framework (مبني على research محسن):
  - مش if/else + fallback = "سلة مهملات"
  - State Machine بـ transitions واضحة
  - Volume Profile يـحدد الـ ranges الحقيقية (POC + volume nodes)
  - vol_trend (accumulating/distributing) بـ يؤكد الـ phase

الـ states:
  1. STOPPING_ACTION    — selling climax (price falling + high volume + at low node)
  2. SPRING             — false breakdown (lower low + low volume)
  3. ACCUMULATION       — range with vol_trend=accumulating (NEW — مش fallback)
  4. MARKUP_START       — breakout above range high + volume surge
  5. MARKUP_MID         — higher highs + higher lows + OBV rising
  6. DISTRIBUTION_START — at range high + volume but no advance + vol_trend=distributing
  7. DISTRIBUTION_MID   — range with vol_trend=distributing
  8. RANGE              — neutral range (price bouncing between 2 nodes + neutral vol)

الـ transitions (state machine):
  STOPPING_ACTION → SPRING → ACCUMULATION → MARKUP_START → MARKUP_MID → DISTRIBUTION_START → DISTRIBUTION_MID → STOPPING_ACTION
  (cycle كامل)
"""
from __future__ import annotations
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass


@dataclass
class WyckoffContext:
    """نتيجة آلة الحالة."""
    phase: str           # الـ phase الحالي
    confidence: float    # 0-1 (ثقة في الـ phase)
    range_high: float    # مقاومة النطاق (من volume nodes)
    range_low: float     # دعم النطاق
    poc: float           # Point of Control (أعلى volume node)
    in_range: bool       # هل السعر جوه النطاق؟
    distance_to_resist: float  # % من السعر لـ resistance
    distance_to_support: float # % من السعر لـ support
    vol_trend: str       # accumulating/distributing/neutral
    reason: str          # شرح القرار


def detect_wyckoff_phase(
    closes: List[float],
    highs: List[float],
    lows: List[float],
    volumes: List[float],
    vp_result=None,
) -> WyckoffContext:
    """آلة حالة وايكوف — تشخيص دقيق بـ Volume Profile.

    Args:
        closes/highs/lows/volumes: OHLCV data
        vp_result: VolumeProfileResult (لو موجود، نستخدمه)

    Returns:
        WyckoffContext: phase + confidence + range info
    """
    if not closes or len(closes) < 30:
        return WyckoffContext(
            phase='INSUFFICIENT_DATA', confidence=0.0,
            range_high=0, range_low=0, poc=0,
            in_range=False, distance_to_resist=0, distance_to_support=0,
            vol_trend='neutral', reason='بيانات غير كافية (<30 يوم)'
        )

    current_price = closes[-1]

    # === استخراج بيانات VP ===
    poc = 0.0
    volume_nodes: List[float] = []
    vol_trend = 'neutral'

    if vp_result is not None:
        poc = float(getattr(vp_result, 'poc', 0) or 0)
        volume_nodes = list(getattr(vp_result, 'volume_nodes', []) or [])
        vol_trend = str(getattr(vp_result, 'volume_trend', 'neutral') or 'neutral')

    # لو مفيش VP result، احسب volume nodes يدوياً
    if not volume_nodes:
        volume_nodes = _find_volume_nodes(closes, volumes)

    # POC = النود الأوسط (لو مفيش، نستخدم آخر price)
    if not poc and volume_nodes:
        poc = volume_nodes[len(volume_nodes) // 2]

    # === تحديد النطاق (range) ===
    # النطاق = بين أعلى وأقل volume node
    if len(volume_nodes) >= 2:
        range_high = max(volume_nodes)
        range_low = min(volume_nodes)
    elif len(volume_nodes) == 1:
        range_high = volume_nodes[0] * 1.03
        range_low = volume_nodes[0] * 0.97
    else:
        # fallback: استخدم swing high/low
        range_high = max(highs[-20:]) if len(highs) >= 20 else max(highs)
        range_low = min(lows[-20:]) if len(lows) >= 20 else min(lows)

    # === هل السعر جوه النطاق؟ ===
    range_width = range_high - range_low
    if range_width > 0:
        in_range = range_low * 0.98 <= current_price <= range_high * 1.02
        distance_to_resist = ((range_high - current_price) / current_price) * 100
        distance_to_support = ((current_price - range_low) / current_price) * 100
    else:
        in_range = False
        distance_to_resist = 0
        distance_to_support = 0

    # === مؤشرات السعر ===
    # ROC (Rate of Change)
    roc10 = ((closes[-1] - closes[-10]) / closes[-10] * 100) if len(closes) >= 10 else 0
    roc20 = ((closes[-1] - closes[-20]) / closes[-20] * 100) if len(closes) >= 20 else 0
    roc5 = ((closes[-1] - closes[-5]) / closes[-5] * 100) if len(closes) >= 5 else 0

    # Volume metrics
    vol_avg_20 = sum(volumes[-20:]) / 20 if len(volumes) >= 20 else sum(volumes) / len(volumes)
    vol_avg_5 = sum(volumes[-5:]) / 5 if len(volumes) >= 5 else vol_avg_20
    vol_ratio = vol_avg_5 / vol_avg_20 if vol_avg_20 > 0 else 1.0

    # Swing structure (higher highs / lower lows)
    if len(closes) >= 15:
        recent_high = max(highs[-5:])
        prev_high = max(highs[-10:-5]) if len(highs) >= 10 else recent_high
        recent_low = min(lows[-5:])
        prev_low = min(lows[-10:-5]) if len(lows) >= 10 else recent_low
        making_higher_highs = recent_high > prev_high
        making_lower_lows = recent_low < prev_low
    else:
        making_higher_highs = False
        making_lower_lows = False

    # === الـ State Machine ===
    # الأولوية: من الأخطر للأقل خطورة

    phase = 'RANGE'  # default = neutral range (مش DISTRIBUTION_MID)
    confidence = 0.5
    reason = ''

    # 1. STOPPING_ACTION: selling climax (price falling + high volume + at low node)
    if roc20 < -8 and vol_ratio > 1.3 and current_price <= range_low * 1.02:
        phase = 'STOPPING_ACTION'
        confidence = 0.75
        reason = f'selling climax: roc20={roc20:.1f}% + vol×{vol_ratio:.1f} + at range_low'

    # 2. SPRING: false breakdown (lower low + low volume)
    elif making_lower_lows and vol_ratio < 0.8 and current_price <= range_low * 1.02:
        phase = 'SPRING'
        confidence = 0.65
        reason = f'false breakdown: lower_low + vol×{vol_ratio:.1f} (<0.8) + at range_low'

    # 3. MARKUP_START: breakout above range high + volume surge
    elif current_price > range_high * 1.02 and vol_ratio > 1.3 and roc5 > 2:
        phase = 'MARKUP_START'
        confidence = 0.80
        reason = f'breakout: price>range_high + vol×{vol_ratio:.1f} + roc5={roc5:.1f}%'

    # 4. MARKUP_MID: higher highs + OBV rising (vol_trend accumulating)
    elif making_higher_highs and not making_lower_lows and roc20 > 3 and vol_trend == 'accumulating':
        phase = 'MARKUP_MID'
        confidence = 0.80
        reason = f'trending up: HH + roc20={roc20:.1f}% + vol=accumulating'

    # 5. DISTRIBUTION_START: at range high + volume but no advance + vol_trend=distributing
    elif current_price >= range_high * 0.98 and vol_trend == 'distributing' and abs(roc10) < 3:
        phase = 'DISTRIBUTION_START'
        confidence = 0.70
        reason = f'topping: at range_high + vol=distributing + flat roc10={roc10:.1f}%'

    # 6. DISTRIBUTION_MID: in range + vol_trend=distributing
    elif in_range and vol_trend == 'distributing':
        phase = 'DISTRIBUTION_MID'
        confidence = 0.65
        reason = f'in range + vol=distributing'

    # 7. ACCUMULATION: in range + vol_trend=accumulating (NEW!)
    elif in_range and vol_trend == 'accumulating':
        phase = 'ACCUMULATION'
        confidence = 0.70
        reason = f'in range + vol=accumulating'

    # 8. RANGE: in range + neutral vol (default for in-range stocks)
    elif in_range:
        phase = 'RANGE'
        confidence = 0.55
        reason = f'in range + neutral vol (between {range_low:.2f} and {range_high:.2f})'

    # 9. OUTSIDE_RANGE_UP: price above range but not a clear breakout
    elif current_price > range_high * 1.02:
        phase = 'MARKUP_MID'  # treat as continuation
        confidence = 0.50
        reason = f'above range + no clear breakout signal'

    # 10. OUTSIDE_RANGE_DOWN: price below range but not a spring
    elif current_price < range_low * 0.98:
        phase = 'MARKDOWN'  # new phase
        confidence = 0.60
        reason = f'below range + no spring signal'

    return WyckoffContext(
        phase=phase,
        confidence=confidence,
        range_high=range_high,
        range_low=range_low,
        poc=poc,
        in_range=in_range,
        distance_to_resist=distance_to_resist,
        distance_to_support=distance_to_support,
        vol_trend=vol_trend,
        reason=reason,
    )


def _find_volume_nodes(closes: List[float], volumes: List[float], bins: int = 10) -> List[float]:
    """نسخة من volume_profile._find_volume_nodes (للاستخدام المستقل)."""
    if not closes or not volumes or len(closes) < 5:
        return []
    lo, hi = min(closes), max(closes)
    if hi == lo:
        return [round(lo, 2)]
    step = (hi - lo) / bins
    bin_vols = [0.0] * bins
    bin_centers = [lo + step * (i + 0.5) for i in range(bins)]
    for c, v in zip(closes, volumes):
        idx = int((c - lo) / step)
        if idx >= bins:
            idx = bins - 1
        elif idx < 0:
            idx = 0
        bin_vols[idx] += v
    avg_vol = sum(bin_vols) / bins if bins else 0
    if avg_vol == 0:
        return []
    nodes = [round(bin_centers[i], 2) for i in range(bins) if bin_vols[i] > avg_vol * 1.3]
    return nodes


# ═══════════════════════════════════════════════════════════════════════
# Pattern-Specific Thresholds (per Mohsen's directive)
# ═══════════════════════════════════════════════════════════════════════
PATTERN_THRESHOLDS = {
    'TREND_RIDER':           65,   # strong pattern → high threshold
    'BREAKOUT_RIDER':        60,   # strong but risky
    'SPRING_HUNTER':         55,   # medium
    'VALUE_ACCUMULATOR':     55,   # medium
    'SAFE_HAVEN_LARGE_CAP':  50,   # defensive
    'BEAR_DEFENDER':         45,   # defensive (bear market)
    'BOTTOM_FISHER':         45,   # risky (catching knife)
    'MEAN_REVERSION_RANGE':  40,   # weak pattern → low threshold (or skip)
    'MARKDOWN':              30,   # very defensive
    'ACCUMULATION':          50,   # new
}

# Patterns to SKIP (EXIT patterns)
EXIT_PATTERNS = {'LIQUIDITY_DRAIN_SURVIVOR', 'DISTRIBUTION_EXIT'}


def get_threshold(pattern: str) -> int:
    """احصل على الـ threshold المناسب للـ pattern."""
    return PATTERN_THRESHOLDS.get(pattern, 50)


def is_exit_pattern(pattern: str) -> bool:
    """هل الـ pattern ده EXIT (لازم نـskip)؟"""
    return pattern in EXIT_PATTERNS


if __name__ == '__main__':
    # quick test
    import sys
    sys.path.insert(0, '/home/z/my-project/vps-service')
    from data.prices import load_price_history

    for ticker in ['COMI', 'HRHO', 'SWDY']:
        h = load_price_history(ticker, limit=100)
        if not h:
            print(f"{ticker}: no data")
            continue
        closes = [c['close'] for c in h]
        highs = [c['high'] for c in h]
        lows = [c['low'] for c in h]
        vols = [c['volume'] for c in h]

        ctx = detect_wyckoff_phase(closes, highs, lows, vols)
        print(f"{ticker}: phase={ctx.phase} (conf={ctx.confidence:.2f}) | "
              f"range=[{ctx.range_low:.2f}, {ctx.range_high:.2f}] | "
              f"in_range={ctx.in_range} | vol_trend={ctx.vol_trend} | "
              f"reason: {ctx.reason}")
