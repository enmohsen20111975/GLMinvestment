"""
breakout_signal.py — Breakout signal detector (20-day high breakout).

Strategy (proven in scripts/trend_following_test.py — Test PF=4.47, p-value=0.0%):
  - close[i] > max(high[i-20:i]) → breakout confirmed
  - Liquidity filter: avg_vol_20 * close >= 5M EGP
  - Regime filter: BULL + RANGE only (skip BEAR)

Integration: daily_predictor بـ يستخدمه كـ signal source إضافي (fusion mode).
  - لو V40.2 قال BUY + breakout → evidence boost (+2)
  - لو V40.2 قال HOLD/WAIT + breakout → override لـ BUY (breakout confirmation)
  - لو مفيش breakout → V40.2 زي ما هو

Config (matches trend_following_test.py — proven parameters):
  LOOKBACK_HIGH = 20
  MIN_TURNOVER_EGP = 5,000,000
  SL_PCT = 3.0
  TARGET_PCT = 10.0

Author: BRAVO-QUANT — 2026-10-19
"""
from typing import Optional, Dict, Any, List


# ═══════════════════════════════════════════════════════════════════════
# Config (matches trend_following_test.py — proven parameters)
# ═══════════════════════════════════════════════════════════════════════
LOOKBACK_HIGH = 20
MIN_TURNOVER_EGP = 5_000_000
SL_PCT = 3.0
TARGET_PCT = 10.0
HOLDING_DAYS = 5


def calc_regime(closes: List[float], idx: int) -> str:
    """
    Classify market regime: BULL / BEAR / RANGE (Point-in-Time — uses closes[:idx+1] only).

    Logic (matches trend_following_test.py):
      - BULL: ma20 > ma50 * 1.02 AND roc20 > 2
      - BEAR: ma20 < ma50 * 0.98 AND roc20 < -2
      - RANGE: otherwise
    """
    if idx < 50 or len(closes) <= idx:
        return 'RANGE'
    try:
        ma20 = sum(closes[idx-20:idx+1]) / 21
        ma50 = sum(closes[idx-50:idx+1]) / 51
        roc20 = ((closes[idx] - closes[idx-20]) / closes[idx-20] * 100
                 if idx >= 20 and closes[idx-20] > 0 else 0)
        if ma20 > ma50 * 1.02 and roc20 > 2:
            return 'BULL'
        elif ma20 < ma50 * 0.98 and roc20 < -2:
            return 'BEAR'
        return 'RANGE'
    except Exception:
        return 'RANGE'


def detect_breakout(closes: List[float],
                    highs: List[float],
                    lows: List[float],
                    volumes: List[float],
                    idx: int) -> Optional[Dict[str, Any]]:
    """
    Detect 20-day high breakout at index idx (Point-in-Time — no lookahead).

    Args:
        closes: list of close prices (full history up to current day)
        highs: list of high prices
        lows: list of low prices (unused here but kept for API symmetry)
        volumes: list of volumes
        idx: current day index (closes[idx] = today's close)

    Returns:
        dict with breakout info if breakout detected, else None:
        {
            'breakout': True,
            'high_20': float,       # the 20-day high that was broken
            'close': float,         # today's close (the breakout candle)
            'regime': str,          # BULL / RANGE
            'turnover': float,      # avg 20-day turnover (EGP)
            'avg_vol_20': float,    # avg 20-day volume
            'sl': float,            # suggested stop (3% below close)
            'target': float,        # suggested target (10% above close)
            'rr': float,            # risk/reward ratio (10/3 ≈ 3.33)
        }
    """
    if idx < LOOKBACK_HIGH or idx >= len(closes):
        return None
    if len(highs) <= idx or len(volumes) <= idx:
        return None

    try:
        high_20 = max(highs[idx-LOOKBACK_HIGH:idx])
        close = float(closes[idx])
        if close <= 0:
            return None

        # Breakout condition: close > 20-day high
        if close <= high_20:
            return None

        # Liquidity filter: avg 20-day turnover >= 5M EGP
        vol_slice = volumes[max(0, idx-20):idx]
        avg_vol_20 = sum(vol_slice) / max(1, len(vol_slice))
        turnover = avg_vol_20 * close
        if turnover < MIN_TURNOVER_EGP:
            return None

        # Regime filter: skip BEAR
        regime = calc_regime(closes, idx)
        if regime == 'BEAR':
            return None

        sl = close * (1 - SL_PCT / 100)
        target = close * (1 + TARGET_PCT / 100)
        rr = (TARGET_PCT / SL_PCT) if SL_PCT > 0 else 0

        return {
            'breakout': True,
            'high_20': float(high_20),
            'close': close,
            'regime': regime,
            'turnover': float(turnover),
            'avg_vol_20': float(avg_vol_20),
            'sl': float(sl),
            'target': float(target),
            'rr': float(rr),
        }
    except Exception:
        return None


def fuse_with_v402(signal: str,
                   entry: float,
                   target: float,
                   stop: float,
                   evidence: int,
                   proofs: Dict[str, Any],
                   breakout: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Fuse breakout signal with V40.2 signal (fusion mode).

    Logic:
      - لو breakout None → رجّع كل حاجة زي ما هي (V40.2 only)
      - لو breakout detected:
          * لو signal في (BUY, STRONG_BUY, INSTITUTIONAL_BUY) → evidence += 2 (boost)
          * لو signal مش BUY → override signal = 'BUY' + entry/target/stop = breakout values
          * سجّل breakout info في proofs['breakout']

    Returns:
        dict: {
            'signal': str,       # possibly overridden
            'entry': float,      # possibly overridden
            'target': float,     # possibly overridden
            'stop': float,       # possibly overridden
            'evidence': int,     # possibly boosted
            'proofs': dict,      # with 'breakout' key added
            'fused': bool,       # True if breakout influenced the signal
        }
    """
    if breakout is None:
        return {
            'signal': signal,
            'entry': entry,
            'target': target,
            'stop': stop,
            'evidence': evidence,
            'proofs': proofs,
            'fused': False,
        }

    # Add breakout to proofs
    new_proofs = dict(proofs) if proofs else {}
    new_proofs['breakout'] = {
        'high_20': breakout['high_20'],
        'close': breakout['close'],
        'regime': breakout['regime'],
        'turnover': breakout['turnover'],
        'rr': breakout['rr'],
    }

    _new_signal = signal
    _new_entry = entry
    _new_target = target
    _new_stop = stop
    _new_evidence = evidence
    _fused = False

    if signal in ('BUY', 'STRONG_BUY', 'INSTITUTIONAL_BUY'):
        # Boost: breakout confirms V40.2 buy
        _new_evidence = evidence + 2
        _fused = True
    else:
        # Override: breakout promotes non-buy to BUY
        _new_signal = 'BUY'
        _new_entry = breakout['close']
        _new_target = breakout['target']
        _new_stop = breakout['sl']
        _new_evidence = max(evidence, 3)  # breakout = 3 evidence (proven signal)
        _fused = True

    return {
        'signal': _new_signal,
        'entry': _new_entry,
        'target': _new_target,
        'stop': _new_stop,
        'evidence': _new_evidence,
        'proofs': new_proofs,
        'fused': _fused,
    }
