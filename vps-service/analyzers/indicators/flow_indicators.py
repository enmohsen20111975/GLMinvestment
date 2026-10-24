"""
vps-service/analyzers/indicators/flow_indicators.py
====================================================
Canonical implementations for:
  - CMF (Chaikin Money Flow) — 20-day
  - OBV (On-Balance Volume)
  - POC position check (price vs Point of Control)

These are used by liquidity_radar_v2 as mandatory filters (DeepSeek audit 2026-10-22):
  "رادار السيولة قد لا يفرّق بين التجميع والتصريف بدقة كافية"

Rule 67 — CALCULATION-CANONICAL: هذا هو المصدر الوحيد لحساب CMF + OBV في المشروع.
"""
from __future__ import annotations
from typing import List, Dict, Optional, Tuple
import math


def calc_cmf(highs: List[float], lows: List[float], closes: List[float],
             volumes: List[float], period: int = 20) -> Optional[float]:
    """Chaikin Money Flow (CMF) — canonical.

    Formula:
      MFM = ((close - low) - (high - close)) / (high - low)
      Money Flow Volume = MFM × volume
      CMF = sum(MFV, period) / sum(volume, period)

    Range: -1 to +1
      - CMF > 0 → accumulation (buying pressure dominant)
      - CMF < 0 → distribution (selling pressure dominant)
      - CMF > 0.1 → strong accumulation
      - CMF < -0.1 → strong distribution

    Args:
        highs: list of high prices
        lows: list of low prices
        closes: list of close prices
        volumes: list of volumes
        period: lookback period (default 20)

    Returns:
        float: CMF value (-1 to +1), or None if insufficient data.
    """
    n = min(len(highs), len(lows), len(closes), len(volumes))
    if n < period:
        return None

    # Use last `period` bars
    mfv_sum = 0.0
    vol_sum = 0.0

    for i in range(n - period, n):
        high = highs[i]
        low = lows[i]
        close = closes[i]
        vol = volumes[i]

        if vol <= 0:
            continue

        range_val = high - low
        if range_val <= 0:
            mfm = 0.0  # doji → neutral
        else:
            mfm = ((close - low) - (high - close)) / range_val

        mfv_sum += mfm * vol
        vol_sum += vol

    if vol_sum <= 0:
        return None

    return round(mfv_sum / vol_sum, 4)


def calc_obv(closes: List[float], volumes: List[float]) -> Optional[List[float]]:
    """On-Balance Volume (OBV) — canonical.

    Formula:
      if close[i] > close[i-1]: OBV[i] = OBV[i-1] + volume[i]
      if close[i] < close[i-1]: OBV[i] = OBV[i-1] - volume[i]
      if close[i] == close[i-1]: OBV[i] = OBV[i-1]

    OBV trend:
      - Rising OBV = accumulation (smart money buying)
      - Falling OBV = distribution (smart money selling)
      - Flat OBV = equilibrium

    Args:
        closes: list of close prices (oldest first, latest at end)
        volumes: list of volumes

    Returns:
        List[float]: OBV series (same length as input), or None if insufficient data.
    """
    n = min(len(closes), len(volumes))
    if n < 2:
        return None

    obv = [0.0] * n
    obv[0] = volumes[0]

    for i in range(1, n):
        if closes[i] > closes[i - 1]:
            obv[i] = obv[i - 1] + volumes[i]
        elif closes[i] < closes[i - 1]:
            obv[i] = obv[i - 1] - volumes[i]
        else:
            obv[i] = obv[i - 1]

    return obv


def obv_trend(obv_series: List[float], lookback: int = 20) -> str:
    """Determine OBV trend direction.

    Args:
        obv_series: full OBV series (from calc_obv)
        lookback: number of bars to check trend (default 20)

    Returns:
        'rising' | 'falling' | 'flat'
    """
    if not obv_series or len(obv_series) < lookback:
        return 'flat'

    recent = obv_series[-lookback:]
    start_val = recent[0]
    end_val = recent[-1]

    if start_val <= 0:
        return 'rising' if end_val > 0 else 'flat'

    change_pct = (end_val - start_val) / abs(start_val) * 100

    if change_pct > 5:
        return 'rising'
    elif change_pct < -5:
        return 'falling'
    else:
        return 'flat'


def check_price_vs_poc(current_price: float, poc: float, vah: float, val: float) -> Dict[str, any]:
    """Check price position relative to Volume Profile (POC/VAH/VAL).

    Logic (per DeepSeek audit):
      - price < POC + volume rising → accumulation (smart money buying below POC)
      - price > POC + volume rising + failed breakout → distribution (selling into strength)
      - price within Value Area → neutral / consolidating

    Args:
        current_price: latest close
        poc: Point of Control
        vah: Value Area High
        val: Value Area Low

    Returns:
        dict: {
            'position': 'below_poc' | 'at_poc' | 'above_poc' | 'in_value_area',
            'signal': 'accumulation_hint' | 'distribution_hint' | 'neutral',
            'reason': str,
        }
    """
    if current_price <= 0 or poc <= 0:
        return {'position': 'unknown', 'signal': 'neutral', 'reason': 'insufficient data'}

    # Price below Value Area Low → below accumulation zone
    if current_price < val:
        return {
            'position': 'below_poc',
            'signal': 'accumulation_hint',
            'reason': f'price ({current_price:.2f}) < VAL ({val:.2f}) — smart money may be accumulating below POC ({poc:.2f})',
        }

    # Price within Value Area (VAL to VAH)
    if val <= current_price <= vah:
        if current_price < poc:
            return {
                'position': 'below_poc',
                'signal': 'accumulation_hint',
                'reason': f'price ({current_price:.2f}) below POC ({poc:.2f}) within Value Area — accumulation zone',
            }
        elif current_price > poc:
            return {
                'position': 'above_poc',
                'signal': 'distribution_hint',
                'reason': f'price ({current_price:.2f}) above POC ({poc:.2f}) within Value Area — distribution risk',
            }
        else:
            return {
                'position': 'at_poc',
                'signal': 'neutral',
                'reason': f'price ({current_price:.2f}) at POC ({poc:.2f}) — equilibrium',
            }

    # Price above Value Area High → above distribution zone
    if current_price > vah:
        return {
            'position': 'above_poc',
            'signal': 'distribution_hint',
            'reason': f'price ({current_price:.2f}) > VAH ({vah:.2f}) — above POC ({poc:.2f}), distribution risk if volume fails to break resistance',
        }

    return {'position': 'unknown', 'signal': 'neutral', 'reason': 'edge case'}


# ============================================================================
# COMBINED FLOW ASSESSMENT — used by liquidity_radar_v2
# ============================================================================

def assess_flow_quality(candles: List[Dict[str, any]]) -> Dict[str, any]:
    """Combined flow assessment: MFM (existing) + CMF + OBV + POC.

    This is the DEEPSEEK-AUDIT enhancement (2026-10-22):
      "دمج CMF و OBV في liquidity_filter كفلتر إلزامي"

    Args:
        candles: list of {price_date, open, high, low, close, volume}

    Returns:
        dict: {
            'cmf': float | None,        # Chaikin Money Flow (-1 to +1)
            'obv_trend': str,           # 'rising' | 'falling' | 'flat'
            'poc_position': str,        # 'below_poc' | 'at_poc' | 'above_poc'
            'poc_signal': str,          # 'accumulation_hint' | 'distribution_hint' | 'neutral'
            'accumulation_score': int,  # 0-3 (how many signals confirm accumulation)
            'distribution_score': int,  # 0-3 (how many signals confirm distribution)
            'verdict': str,             # 'accumulate' | 'distribute' | 'neutral' | 'insufficient'
            'reason': str,
        }
    """
    if not candles or len(candles) < 20:
        return {
            'cmf': None,
            'obv_trend': 'flat',
            'poc_position': 'unknown',
            'poc_signal': 'neutral',
            'accumulation_score': 0,
            'distribution_score': 0,
            'verdict': 'insufficient',
            'reason': 'insufficient data (< 20 candles)',
        }

    closes = [float(c.get('close', 0)) for c in candles if c.get('close')]
    highs = [float(c.get('high', 0)) for c in candles if c.get('high')]
    lows = [float(c.get('low', 0)) for c in candles if c.get('low')]
    volumes = [float(c.get('volume', 0)) for c in candles if c.get('volume')]

    n = min(len(closes), len(highs), len(lows), len(volumes))
    if n < 20:
        return {
            'cmf': None,
            'obv_trend': 'flat',
            'poc_position': 'unknown',
            'poc_signal': 'neutral',
            'accumulation_score': 0,
            'distribution_score': 0,
            'verdict': 'insufficient',
            'reason': f'insufficient data ({n} < 20)',
        }

    # === CMF ===
    cmf = calc_cmf(highs, lows, closes, volumes, period=20)

    # === OBV ===
    obv_series = calc_obv(closes, volumes)
    obv_dir = obv_trend(obv_series, lookback=20) if obv_series else 'flat'

    # === POC ===
    from analyzers.indicators.volume_profile import calc_volume_profile
    # Use last 60 bars for volume profile (captures recent trading range)
    vp = calc_volume_profile(closes[-60:], volumes[-60:], bins=20)
    poc_pos = 'unknown'
    poc_sig = 'neutral'
    poc_reason = 'no volume profile'
    if vp and closes:
        current_price = closes[-1]
        poc = vp['poc']
        vah = vp['vah']
        val = vp['val']

        # DEEPSEEK-AUDIT-FIX: The POC position is RELATIVE to the recent range.
        # If price is in the LOWER 1/3 of the range (below VAL) → accumulation zone.
        # If price is in the UPPER 1/3 of the range (above VAH) → distribution zone.
        # Within Value Area → neutral (consolidating).
        #
        # This avoids the false signal where a rising stock always shows "above POC"
        # (because POC is the midpoint of the range by definition).

        price_range = vah - val
        if price_range <= 0:
            poc_pos = 'at_poc'
            poc_sig = 'neutral'
            poc_reason = f'flat Value Area — price ({current_price:.2f}) at POC ({poc:.2f})'
        elif current_price > vah:
            poc_pos = 'above_poc'
            poc_sig = 'distribution_hint'
            poc_reason = f'price ({current_price:.2f}) > VAH ({vah:.2f}) — extended above Value Area, distribution risk'
        elif current_price < val:
            poc_pos = 'below_poc'
            poc_sig = 'accumulation_hint'
            poc_reason = f'price ({current_price:.2f}) < VAL ({val:.2f}) — below Value Area, accumulation opportunity'
        else:
            # Within Value Area → check if closer to VAL (accumulation) or VAH (distribution)
            mid_va = (val + vah) / 2
            if current_price < mid_va:
                poc_pos = 'below_poc'
                poc_sig = 'accumulation_hint'
                poc_reason = f'price ({current_price:.2f}) below mid-VA ({mid_va:.2f}) — accumulation zone'
            elif current_price > mid_va:
                poc_pos = 'above_poc'
                poc_sig = 'distribution_hint'
                poc_reason = f'price ({current_price:.2f}) above mid-VA ({mid_va:.2f}) — distribution zone'
            else:
                poc_pos = 'at_poc'
                poc_sig = 'neutral'
                poc_reason = f'price ({current_price:.2f}) at mid-VA ({mid_va:.2f}) — equilibrium'

    # === Scoring ===
    acc_score = 0
    dist_score = 0

    # CMF scoring
    if cmf is not None:
        if cmf > 0.05:
            acc_score += 1
        elif cmf < -0.05:
            dist_score += 1

    # OBV scoring
    if obv_dir == 'rising':
        acc_score += 1
    elif obv_dir == 'falling':
        dist_score += 1

    # POC scoring
    if poc_sig == 'accumulation_hint':
        acc_score += 1
    elif poc_sig == 'distribution_hint':
        dist_score += 1

    # === Verdict ===
    if acc_score >= 2 and dist_score == 0:
        verdict = 'accumulate'
        reason = f'accumulation confirmed (score {acc_score}/3): CMF={cmf}, OBV={obv_dir}, POC={poc_sig}'
    elif dist_score >= 2 and acc_score == 0:
        verdict = 'distribute'
        reason = f'distribution detected (score {dist_score}/3): CMF={cmf}, OBV={obv_dir}, POC={poc_sig}'
    elif acc_score > 0 and dist_score > 0:
        verdict = 'neutral'
        reason = f'mixed signals (acc={acc_score}, dist={dist_score}): CMF={cmf}, OBV={obv_dir}, POC={poc_sig}'
    else:
        verdict = 'neutral'
        reason = f'no clear signal (acc={acc_score}, dist={dist_score}): CMF={cmf}, OBV={obv_dir}, POC={poc_sig}'

    return {
        'cmf': cmf,
        'obv_trend': obv_dir,
        'poc_position': poc_pos,
        'poc_signal': poc_sig,
        'poc_reason': poc_reason,
        'accumulation_score': acc_score,
        'distribution_score': dist_score,
        'verdict': verdict,
        'reason': reason,
    }
