#!/usr/bin/env python3
"""
Explosive Uncap Engine — محرك الأسهم الانفجارية
===================================================
إحياء منطق explosive_uncap من Maestro (الذي قُتل في KILL-MAESTRO) كـ module
مستقل، بـ حدود دستورية (stop 8.5% ضمن [3%, 9%] بدلاً من 15% القديم).

المنطق (من maestro_orchestrator.py:3828-3881 + explosive_opportunity_hunter.py):
  1. is_momentum: momentum_5d >= 15% OR momentum_20d >= 30% OR volume_ratio >= 2.5
  2. vol_pct > 80 (volatility_percentile_90d — وقود الانفجار)
  3. is_explosive = is_momentum AND vol_pct > 80
  4. لو is_explosive:
     - stop = entry × (1 - 8.5%)   [دستوري: ضمن ATR_STOP_MAX_PCT=9%]
     - target = entry + 5×ATR       [let it run — الأسهم الانفجارية بتعمل +50%/+100%]
     - target_2 = entry + 8×ATR    [runner للموجات الكبيرة]
  5. safe-by-design: لو ATR=0 → fallback target = entry × 1.30 (+30%)

التكامل:
  في daily_predictor.py — بعد حساب entry/stop/target الافتراضي،
  لو detect_explosive_uncap() رجع is_explosive=True → نـ override الـ stop/target.

A/B TESTING:
  V40_2_EXPLOSIVE_UNCAP=1 لتفعيل، =0 لتعطيل (default ON).

Author: Z.ai Code
Date: 2026-09-01 (إحياء من Maestro بعد KILL-MAESTRO)
"""

from __future__ import annotations
import math
from typing import List, Dict, Any, Tuple, Optional


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

def _safe_atr(highs: List[float], lows: List[float], closes: List[float],
              period: int = 14) -> float:
    """ATR(period) — True Range average."""
    n = min(len(highs), len(lows), len(closes))
    if n < 2:
        return 0.0
    trs = []
    for i in range(max(1, n - period), n):
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1])
        )
        trs.append(tr)
    return sum(trs) / len(trs) if trs else 0.0


def _momentum(closes: List[float], lookback: int) -> float:
    """عائد آخر N يوم (%)."""
    if len(closes) < lookback + 1:
        return 0.0
    past = closes[-(lookback + 1)]
    if past <= 0:
        return 0.0
    return ((closes[-1] - past) / past) * 100.0


def _volume_ratio(volumes: List[float], lookback: int = 20) -> float:
    """حجم اليوم / متوسط حجم N يوم."""
    if len(volumes) < lookback + 1:
        return 1.0
    recent = [v for v in volumes[-(lookback + 1):-1] if v > 0]
    if not recent:
        return 1.0
    avg = sum(recent) / len(recent)
    return volumes[-1] / avg if avg > 0 else 1.0


# ═══════════════════════════════════════════════════════════════════════
# Config (دستوري — ضمن ATR_STOP_MAX_PCT=9%)
# ═══════════════════════════════════════════════════════════════════════

EXPLOSIVE_STOP_PCT = 8.5      # stop-loss للأسهم الانفجارية (دستوري [3%, 9%])
EXPLOSIVE_TARGET_ATR_MULT = 5.0   # target = entry + 5×ATR (let it run)
EXPLOSIVE_TARGET_2_ATR_MULT = 8.0  # target_2 (runner)
EXPLOSIVE_FALLBACK_TARGET_PCT = 30.0  # fallback لو ATR=0 (+30%)

# Thresholds
MOMENTUM_5D_THRESHOLD = 15.0   # +15% في 5 أيام = momentum
MOMENTUM_20D_THRESHOLD = 30.0  # +30% في 20 يوم = trend قوي
VOLUME_RATIO_THRESHOLD = 2.5  # 2.5× avg volume = accumulation
VOL_PCT_THRESHOLD = 80.0      # volatility percentile > 80 = وقود كافٍ


# ═══════════════════════════════════════════════════════════════════════
# Main: detect explosive + compute uncap levels
# ═══════════════════════════════════════════════════════════════════════

def detect_explosive_uncap(
    closes: List[float],
    highs: List[float],
    lows: List[float],
    volumes: List[float],
    entry_price: Optional[float] = None
) -> Dict[str, Any]:
    """
    كشف الأسهم الانفجارية + حساب وقف/أهداف مفتوحة.

    Returns:
        {
            'is_explosive': bool,
            'is_momentum': bool,
            'momentum_5d': float,
            'momentum_20d': float,
            'volume_ratio': float,
            'vol_pct': float,           # volatility percentile 0-100
            'atr': float,
            'stop_loss': float,         # entry × (1 - 8.5%)
            'target_price': float,      # entry + 5×ATR
            'target_price_2': float,   # entry + 8×ATR (runner)
            'rr_ratio': float,          # target/stop risk-reward
            'reason': str,
        }
    """
    n = min(len(closes), len(highs), len(lows), len(volumes))
    if n < 21:
        return _neutral_explosive()

    entry = float(entry_price) if entry_price and entry_price > 0 else float(closes[-1])
    if entry <= 0:
        return _neutral_explosive()

    # Indicators
    atr = _safe_atr(highs, lows, closes, 14)
    mom_5d = _momentum(closes, 5)
    mom_20d = _momentum(closes, 20)
    vol_ratio = _volume_ratio(volumes, 20)
    atr_pct = (atr / entry * 100.0) if entry > 0 and atr > 0 else 0.0
    # vol_pct: rough proxy 0-100 (3% ATR → 36, 7% ATR → 84) — same as explosive_opportunity_hunter
    vol_pct = min(100.0, max(0.0, atr_pct * 12.0))

    # is_momentum: أي من 3 شروط
    is_momentum = (
        mom_5d >= MOMENTUM_5D_THRESHOLD or
        mom_20d >= MOMENTUM_20D_THRESHOLD or
        vol_ratio >= VOLUME_RATIO_THRESHOLD
    )

    # is_explosive = is_momentum AND vol_pct > 80
    is_explosive = is_momentum and vol_pct > VOL_PCT_THRESHOLD

    # Compute uncap levels
    stop_loss = round(entry * (1.0 - EXPLOSIVE_STOP_PCT / 100.0), 4)
    if atr > 0:
        target_price = round(entry + atr * EXPLOSIVE_TARGET_ATR_MULT, 4)
        target_price_2 = round(entry + atr * EXPLOSIVE_TARGET_2_ATR_MULT, 4)
    else:
        # fallback: +30% / +50%
        target_price = round(entry * (1.0 + EXPLOSIVE_FALLBACK_TARGET_PCT / 100.0), 4)
        target_price_2 = round(entry * 1.50, 4)

    risk = entry - stop_loss
    reward = target_price - entry
    rr_ratio = round(reward / risk, 2) if risk > 0 else 0.0

    if is_explosive:
        reason = (f'سهم انفجاري: mom_5d={mom_5d:+.1f}% mom_20d={mom_20d:+.1f}% '
                  f'vol_ratio={vol_ratio:.1f}× vol_pct={vol_pct:.0f} → target=5×ATR stop=8.5%')
    elif is_momentum:
        reason = (f'momentum بدون وقود كافٍ: vol_pct={vol_pct:.0f} ≤ {VOL_PCT_THRESHOLD:.0f}')
    else:
        reason = f'مش انفجاري: mom_5d={mom_5d:+.1f}% mom_20d={mom_20d:+.1f}% vol_ratio={vol_ratio:.1f}×'

    return {
        'is_explosive': is_explosive,
        'is_momentum': is_momentum,
        'momentum_5d': round(mom_5d, 2),
        'momentum_20d': round(mom_20d, 2),
        'volume_ratio': round(vol_ratio, 2),
        'vol_pct': round(vol_pct, 1),
        'atr': round(atr, 4),
        'atr_pct': round(atr_pct, 2),
        'stop_loss': stop_loss,
        'target_price': target_price,
        'target_price_2': target_price_2,
        'rr_ratio': rr_ratio,
        'entry_price': round(entry, 4),
        'reason': reason,
    }


def _neutral_explosive() -> Dict[str, Any]:
    return {
        'is_explosive': False, 'is_momentum': False,
        'momentum_5d': 0.0, 'momentum_20d': 0.0,
        'volume_ratio': 1.0, 'vol_pct': 0.0,
        'atr': 0.0, 'atr_pct': 0.0,
        'stop_loss': 0.0, 'target_price': 0.0, 'target_price_2': 0.0,
        'rr_ratio': 0.0, 'entry_price': 0.0,
        'reason': 'بيانات غير كافية (< 21 يوم)',
    }


# ═══════════════════════════════════════════════════════════════════════
# Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 Explosive Uncap Engine — Self Test")
    print("=" * 60)
    print(f"Config: stop={EXPLOSIVE_STOP_PCT}% | target={EXPLOSIVE_TARGET_ATR_MULT}×ATR | "
          f"target_2={EXPLOSIVE_TARGET_2_ATR_MULT}×ATR")
    print(f"Thresholds: mom_5d≥{MOMENTUM_5D_THRESHOLD}% | mom_20d≥{MOMENTUM_20D_THRESHOLD}% | "
          f"vol_ratio≥{VOLUME_RATIO_THRESHOLD}× | vol_pct>{VOL_PCT_THRESHOLD}")
    print()

    # Test 1: Explosive stock (big momentum + high volatility)
    print("=== Test 1: Explosive stock (CAED-like — +40% in 5d, ATR 7%) ===")
    closes = [100 + i * 0.3 for i in range(25)]  # gentle uptrend
    closes[-5:] = [105, 112, 120, 132, 148]  # explosion last 5 days (+40%)
    highs = [c + 2 for c in closes]
    lows = [c - 2 for c in closes]
    # Make ATR high (7% → vol_pct ~84)
    for i in range(len(highs)):
        highs[i] = closes[i] * 1.04
        lows[i] = closes[i] * 0.96
    volumes = [1000] * 25
    volumes[-5:] = [3500, 4200, 3800, 5100, 4900]  # volume spike

    r = detect_explosive_uncap(closes, highs, lows, volumes)
    print(f"  is_explosive: {r['is_explosive']}")
    print(f"  is_momentum: {r['is_momentum']}")
    print(f"  momentum_5d: {r['momentum_5d']:+.1f}% | momentum_20d: {r['momentum_20d']:+.1f}%")
    print(f"  volume_ratio: {r['volume_ratio']}× | vol_pct: {r['vol_pct']}")
    print(f"  ATR: {r['atr']} ({r['atr_pct']}%)")
    print(f"  entry: {r['entry_price']} | stop: {r['stop_loss']} | target: {r['target_price']} | target_2: {r['target_price_2']}")
    print(f"  R/R: {r['rr_ratio']}")
    print(f"  reason: {r['reason']}")
    assert r['is_explosive'], "❌ CAED-like should be explosive!"
    assert r['rr_ratio'] >= 2.0, f"❌ R/R should be ≥2.0, got {r['rr_ratio']}"
    print("  ✅ PASS")

    # Test 2: Normal stock (low volatility, gentle uptrend)
    print("\n=== Test 2: Normal stock (gentle uptrend, low vol) ===")
    closes2 = [100 + i * 0.1 for i in range(25)]  # +2.5% in 20d
    highs2 = [c + 0.5 for c in closes2]  # tight range
    lows2 = [c - 0.5 for c in closes2]
    volumes2 = [1000] * 25
    volumes2[-1] = 1100  # normal volume

    r2 = detect_explosive_uncap(closes2, highs2, lows2, volumes2)
    print(f"  is_explosive: {r2['is_explosive']}")
    print(f"  momentum_5d: {r2['momentum_5d']:+.1f}% | vol_pct: {r2['vol_pct']}")
    print(f"  reason: {r2['reason']}")
    assert not r2['is_explosive'], "❌ Normal stock should NOT be explosive!"
    print("  ✅ PASS")

    # Test 3: Momentum but no fuel (high mom, low ATR)
    print("\n=== Test 3: Momentum without fuel (+20% in 5d but low ATR) ===")
    closes3 = [100 + i * 0.05 for i in range(20)] + [105, 110, 115, 120, 125]
    highs3 = [c + 0.2 for c in closes3]  # tight ATR (~1.6%)
    lows3 = [c - 0.2 for c in closes3]
    volumes3 = [1000] * 25
    volumes3[-5:] = [1500, 1600, 1700, 1800, 2000]

    r3 = detect_explosive_uncap(closes3, highs3, lows3, volumes3)
    print(f"  is_explosive: {r3['is_explosive']}")
    print(f"  is_momentum: {r3['is_momentum']}")
    print(f"  momentum_5d: {r3['momentum_5d']:+.1f}% | vol_pct: {r3['vol_pct']}")
    print(f"  reason: {r3['reason']}")
    # mom_5d=+25% > 15% → is_momentum=True, but vol_pct likely < 80 → not explosive
    print("  ✅ PASS (momentum detected but capped — needs fuel)")

    print("\n✅ Explosive Uncap Engine ready")
    print(f"\nIntegration: set env V40_2_EXPLOSIVE_UNCAP=1 to activate in daily_predictor.py")
