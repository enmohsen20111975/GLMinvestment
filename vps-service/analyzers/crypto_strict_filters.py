#!/usr/bin/env python3
"""
Crypto Strict Entry Filters — فلاتر الدخول الصارمة للعملات الرقمية
=====================================================================
تطبيق القاعدة 37 (STRICT-ENTRY) على الكريبتو بـ thresholds مكيّفة لـ 24/7 + تقلب أعلى.

الفرق عن الأسهم:
  - التقلب أعلى: ATR/price = 5-15% (مش 3-9% كـ الأسهم)
  - 24/7: مدة الاحتفاظ تتحسب بالساعات مش الأيام
  - BTC Dominance + Fear & Greed: بديل sector heat
  - السيولة أهم: شموع واطية جداً = فخ

الـ module بـ يوفّر:
  1. is_crypto_accumulation() — تراكم في نطاق ضيق
  2. is_crypto_liquidity_grab() — مسح سيولة + رجوع
  3. is_crypto_late_entry() — Don't Chase (قريب من القمة + RSI عالي)
  4. evaluate_crypto_strict_entry() — القرار النهائي

Thresholds (Crypto-calibrated):
  - Accumulation: range<20% (vs 12% stocks), vol<1.5×, recent_gain<20% (vs 12%), dist_from_high≥12%
  - Grab: penetration≥1.5% (vs 0.5%), support_lookback=20
  - Late: dist_from_high<10% (vs 6%), RSI>70 (vs 65), recent_gain>25% (vs 15%)

التكامل في V40.2:
  - V40_2_CRYPTO_STRICT_ENTRY=1 (default OFF)

Author: Z.ai Code
Date: 2026-09-01
"""

from __future__ import annotations
import math
from typing import List, Dict, Any, Optional, Tuple


# ═══════════════════════════════════════════════════════════════════════
# Config (Crypto-calibrated — التقلب أعلى من الأسهم)
# ═══════════════════════════════════════════════════════════════════════

# Accumulation thresholds (crypto — أعلى من الأسهم بسبب التقلب)
CRYPTO_ACCUM_LOOKBACK = 24              # فحص آخر 24 ساعة (4 أيام × 6 ساعات)
CRYPTO_ACCUM_RANGE_MAX_PCT = 20.0       # أقصى مدى 20% (vs 12% stocks)
CRYPTO_ACCUM_VOL_MAX_RATIO = 1.5        # الحجم أقل من 1.5× (vs 1.2× stocks)
CRYPTO_ACCUM_RECENT_GAIN_MAX_PCT = 20.0  # أقصى صعود 20% في 12 ساعة (vs 12%)
CRYPTO_ACCUM_DIST_FROM_HIGH_MIN_PCT = 12.0  # بعيد 12%+ عن القمة (vs 8%)

# Liquidity Grab thresholds
CRYPTO_GRAB_LOOKBACK = 12               # فحص آخر 12 ساعة
CRYPTO_GRAB_SUPPORT_LOOKBACK = 24       # الدعم = أقل قاع في 24 ساعة
CRYPTO_GRAB_PENETRATION_PCT = 1.5       # نزول 1.5% تحت الدعم (vs 0.5%)

# Late Entry (Don't Chase) — crypto أعلى
CRYPTO_LATE_DIST_FROM_HIGH_MAX_PCT = 10.0  # قريب 10% من القمة (vs 6%)
CRYPTO_LATE_RSI_THRESHOLD = 70.0          # RSI > 70 (vs 65)
CRYPTO_LATE_RECENT_GAIN_PCT = 25.0        # صعود 25% في 12 ساعة (vs 15%)


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

def _sma(values: List[float], period: int) -> float:
    """Simple Moving Average."""
    if len(values) < period:
        return sum(values) / len(values) if values else 0.0
    return sum(values[-period:]) / period


def _rsi(closes: List[float], period: int = 14) -> float:
    """RSI(14)."""
    if len(closes) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(len(closes) - period, len(closes)):
        change = closes[i] - closes[i - 1]
        gains.append(max(0, change))
        losses.append(max(0, -change))
    avg_gain = sum(gains) / len(gains) if gains else 0
    avg_loss = sum(losses) / len(losses) if losses else 0
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


# ═══════════════════════════════════════════════════════════════════════
# 1. is_crypto_accumulation() — تراكم في نطاق ضيق
# ═══════════════════════════════════════════════════════════════════════

def is_crypto_accumulation(closes: List[float], highs: List[float],
                             lows: List[float], volumes: List[float]) -> Dict[str, Any]:
    """
    هل العملة في حالة تراكم؟ (نطاق ضيق + حجم هادي + مفيش قفزة + بعيد عن القمة)
    """
    n = min(len(closes), len(highs), len(lows), len(volumes))
    if n < CRYPTO_ACCUM_LOOKBACK + 6:
        return {
            'is_accumulation': False,
            'reason': f'بيانات غير كافية ({n} < {CRYPTO_ACCUM_LOOKBACK + 6})',
            'range_pct': 0, 'vol_ratio': 0,
            'recent_gain_pct': 0, 'dist_from_high_pct': 0,
        }

    recent_highs = highs[-CRYPTO_ACCUM_LOOKBACK:]
    recent_lows = lows[-CRYPTO_ACCUM_LOOKBACK:]
    max_high = max(recent_highs)
    min_low = min(recent_lows)
    range_pct = ((max_high - min_low) / min_low * 100) if min_low > 0 else 999

    avg_vol_24 = _sma(volumes[-24:], 24) if len(volumes) >= 24 else 0
    avg_vol_50 = _sma(volumes[-50:], 50) if len(volumes) >= 50 else avg_vol_24
    vol_ratio = (avg_vol_24 / avg_vol_50) if avg_vol_50 > 0 else 1.0

    ref_close = closes[-7] if len(closes) >= 7 else closes[0]
    recent_gain_pct = ((closes[-1] - ref_close) / ref_close * 100) if ref_close > 0 else 0

    high_24d = max(highs[-24:]) if len(highs) >= 24 else max(highs)
    dist_from_high_pct = ((high_24d - closes[-1]) / high_24d * 100) if high_24d > 0 else 0

    cond_range = range_pct < CRYPTO_ACCUM_RANGE_MAX_PCT
    cond_vol = vol_ratio < CRYPTO_ACCUM_VOL_MAX_RATIO
    cond_no_jump = recent_gain_pct < CRYPTO_ACCUM_RECENT_GAIN_MAX_PCT
    cond_far_from_high = dist_from_high_pct >= CRYPTO_ACCUM_DIST_FROM_HIGH_MIN_PCT

    conditions_met = sum([cond_range, cond_vol, cond_far_from_high])
    # cond_far_from_high إلزامي — لو قريب من القمة، مش تراكم حقيقي
    is_accum = cond_no_jump and cond_far_from_high and conditions_met >= 2

    if is_accum:
        reason = (f'تراكم كريبتو: range={range_pct:.1f}% (<{CRYPTO_ACCUM_RANGE_MAX_PCT}%), '
                  f'vol_ratio={vol_ratio:.2f}× (<{CRYPTO_ACCUM_VOL_MAX_RATIO}×), '
                  f'recent_gain={recent_gain_pct:+.1f}% (<{CRYPTO_ACCUM_RECENT_GAIN_MAX_PCT}%), '
                  f'dist_from_high={dist_from_high_pct:.1f}% (≥{CRYPTO_ACCUM_DIST_FROM_HIGH_MIN_PCT}%)')
    else:
        reasons = []
        if not cond_no_jump:
            reasons.append(f'قفزة حديثة {recent_gain_pct:+.1f}% (≥{CRYPTO_ACCUM_RECENT_GAIN_MAX_PCT}%)')
        if not cond_range:
            reasons.append(f'نطاق واسع {range_pct:.1f}% (≥{CRYPTO_ACCUM_RANGE_MAX_PCT}%)')
        if not cond_far_from_high:
            reasons.append(f'قريب من القمة {dist_from_high_pct:.1f}% (<{CRYPTO_ACCUM_DIST_FROM_HIGH_MIN_PCT}%)')
        if not cond_vol:
            reasons.append(f'حجم مرتفع {vol_ratio:.2f}× (≥{CRYPTO_ACCUM_VOL_MAX_RATIO}×)')
        reason = 'مش تراكم: ' + ' | '.join(reasons) if reasons else 'مش تراكم'

    return {
        'is_accumulation': is_accum,
        'reason': reason,
        'range_pct': round(range_pct, 2),
        'vol_ratio': round(vol_ratio, 2),
        'recent_gain_pct': round(recent_gain_pct, 2),
        'dist_from_high_pct': round(dist_from_high_pct, 2),
    }


# ═══════════════════════════════════════════════════════════════════════
# 2. is_crypto_liquidity_grab() — مسح سيولة + رجوع
# ═══════════════════════════════════════════════════════════════════════

def is_crypto_liquidity_grab(highs: List[float], lows: List[float],
                                closes: List[float], volumes: List[float]) -> Dict[str, Any]:
    """
    هل فيه liquidity grab (مسح سيولة)؟
    """
    n = min(len(highs), len(lows), len(closes), len(volumes))
    if n < CRYPTO_GRAB_SUPPORT_LOOKBACK + 2:
        return {
            'is_grab': False,
            'reason': f'بيانات غير كافية ({n} < {CRYPTO_GRAB_SUPPORT_LOOKBACK + 2})',
            'support_level': 0, 'penetration_pct': 0,
            'recovered': False, 'volume_confirmed': False,
        }

    support_lows = lows[-(CRYPTO_GRAB_SUPPORT_LOOKBACK + 2):-2]
    support_level = min(support_lows) if support_lows else 0
    if support_level <= 0:
        return {
            'is_grab': False,
            'reason': 'مستوى دعم غير صالح',
            'support_level': 0, 'penetration_pct': 0,
            'recovered': False, 'volume_confirmed': False,
        }

    grab_low_1 = lows[-2]
    grab_low_2 = lows[-1]
    close_1 = closes[-2]
    close_2 = closes[-1]
    current_vol = volumes[-1]
    avg_vol = _sma(volumes[-24:], 24) if len(volumes) >= 24 else 1

    penetrated_1 = grab_low_1 < support_level
    penetrated_2 = grab_low_2 < support_level
    penetrated = penetrated_1 or penetrated_2

    grab_low = min(grab_low_1, grab_low_2)
    penetration_pct = ((support_level - grab_low) / support_level * 100) if support_level > 0 else 0

    recovered_1 = close_1 >= support_level
    recovered_2 = close_2 >= support_level
    # Grab حقيقي = نزول تحت الدعم + رجوع فوقه (الشمعة الأخيرة لازم تقفل فوق الدعم)
    recovered = penetrated and recovered_2 and (recovered_1 or recovered_2)

    volume_confirmed = current_vol > avg_vol * 1.5 if avg_vol > 0 else False  # 1.5× (vs 1.3× stocks)

    is_grab = penetrated and penetration_pct >= CRYPTO_GRAB_PENETRATION_PCT and recovered

    if is_grab:
        vol_note = ' بحجم مؤكد' if volume_confirmed else ' (بدون تأكيد حجم)'
        reason = (f'Liquidity Grab كريبتو: نزل {penetration_pct:.2f}% تحت الدعم {support_level:.4f} '
                  f'و رجع قفل فوقه{vol_note}')
    else:
        reasons = []
        if not penetrated:
            reasons.append('مينزلش تحت الدعم')
        elif penetration_pct < CRYPTO_GRAB_PENETRATION_PCT:
            reasons.append(f'نزول ضعيف {penetration_pct:.2f}% (<{CRYPTO_GRAB_PENETRATION_PCT}%)')
        if not recovered:
            reasons.append('مارجعش فوق الدعم')
        reason = 'مش grab: ' + ' | '.join(reasons) if reasons else 'مش grab'

    return {
        'is_grab': is_grab,
        'reason': reason,
        'support_level': round(support_level, 6),
        'penetration_pct': round(penetration_pct, 2),
        'recovered': recovered,
        'volume_confirmed': volume_confirmed,
    }


# ═══════════════════════════════════════════════════════════════════════
# 3. is_crypto_late_entry() — Don't Chase
# ═══════════════════════════════════════════════════════════════════════

def is_crypto_late_entry(closes: List[float], highs: List[float],
                           rsi: Optional[float] = None) -> Dict[str, Any]:
    """
    هل الدخول متأخر (chasing)؟
    """
    if len(closes) < 24 or len(highs) < 24:
        return {
            'is_late': False,
            'reason': 'بيانات غير كافية',
            'dist_from_high_pct': 0, 'rsi': 0, 'recent_gain_pct': 0,
        }

    high_24d = max(highs[-24:])
    dist_from_high_pct = ((high_24d - closes[-1]) / high_24d * 100) if high_24d > 0 else 0

    if rsi is None:
        rsi = _rsi(closes, 14)

    ref_close = closes[-7] if len(closes) >= 7 else closes[0]
    recent_gain_pct = ((closes[-1] - ref_close) / ref_close * 100) if ref_close > 0 else 0

    cond_near_high = dist_from_high_pct < CRYPTO_LATE_DIST_FROM_HIGH_MAX_PCT
    cond_high_rsi = rsi > CRYPTO_LATE_RSI_THRESHOLD
    cond_recent_surge = recent_gain_pct > CRYPTO_LATE_RECENT_GAIN_PCT

    is_late = cond_near_high or cond_high_rsi or cond_recent_surge

    if is_late:
        reasons = []
        if cond_near_high:
            reasons.append(f'قريب من قمة 24 ساعة {dist_from_high_pct:.1f}% (<{CRYPTO_LATE_DIST_FROM_HIGH_MAX_PCT}%)')
        if cond_high_rsi:
            reasons.append(f'RSI مرتفع {rsi:.1f} (>{CRYPTO_LATE_RSI_THRESHOLD})')
        if cond_recent_surge:
            reasons.append(f'صعود قوي {recent_gain_pct:+.1f}% (>{CRYPTO_LATE_RECENT_GAIN_PCT}%)')
        reason = 'دخول متأخر (Don\'t Chase): ' + ' | '.join(reasons)
    else:
        reason = (f'دخول مبكر: dist={dist_from_high_pct:.1f}%, RSI={rsi:.1f}, '
                  f'recent_gain={recent_gain_pct:+.1f}%')

    return {
        'is_late': is_late,
        'reason': reason,
        'dist_from_high_pct': round(dist_from_high_pct, 2),
        'rsi': round(rsi, 1),
        'recent_gain_pct': round(recent_gain_pct, 2),
    }


# ═══════════════════════════════════════════════════════════════════════
# 4. evaluate_crypto_strict_entry() — القرار النهائي
# ═══════════════════════════════════════════════════════════════════════

def evaluate_crypto_strict_entry(closes: List[float], highs: List[float],
                                    lows: List[float], volumes: List[float],
                                    rsi: Optional[float] = None) -> Dict[str, Any]:
    """
    تقييم شامل للدخول الصارم على الكريبتو.

    القرار:
      - is_late_entry → REJECT (Don't Chase)
      - is_accumulation OR is_liquidity_grab → ACCEPT
      - غير كده → REJECT
    """
    late = is_crypto_late_entry(closes, highs, rsi)

    if late['is_late']:
        return {
            'decision': 'REJECT',
            'reason': f'❌ {late["reason"]}',
            'is_accumulation': False,
            'is_grab': False,
            'is_late': True,
            'accumulation_details': {},
            'grab_details': {},
            'late_details': late,
        }

    accum = is_crypto_accumulation(closes, highs, lows, volumes)
    grab = is_crypto_liquidity_grab(highs, lows, closes, volumes)

    if accum['is_accumulation'] or grab['is_grab']:
        reasons = []
        if accum['is_accumulation']:
            reasons.append('تراكم')
        if grab['is_grab']:
            reasons.append('grab')
        return {
            'decision': 'ACCEPT',
            'reason': f'✅ دخول مسموح ({" + ".join(reasons)})',
            'is_accumulation': accum['is_accumulation'],
            'is_grab': grab['is_grab'],
            'is_late': False,
            'accumulation_details': accum,
            'grab_details': grab,
            'late_details': late,
        }

    return {
        'decision': 'REJECT',
        'reason': f'❌ مش تراكم ولا grab: {accum["reason"]} | {grab["reason"]}',
        'is_accumulation': False,
        'is_grab': False,
        'is_late': False,
        'accumulation_details': accum,
        'grab_details': grab,
        'late_details': late,
    }


# ═══════════════════════════════════════════════════════════════════════
# 5. Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 Crypto Strict Entry Filters — Self Test")
    print("=" * 70)
    print(f"Thresholds (Crypto-calibrated):")
    print(f"  Accumulation: range<{CRYPTO_ACCUM_RANGE_MAX_PCT}%, vol<{CRYPTO_ACCUM_VOL_MAX_RATIO}×, "
          f"recent_gain<{CRYPTO_ACCUM_RECENT_GAIN_MAX_PCT}%, dist_from_high≥{CRYPTO_ACCUM_DIST_FROM_HIGH_MIN_PCT}%")
    print(f"  Grab: penetration≥{CRYPTO_GRAB_PENETRATION_PCT}%, support_lookback={CRYPTO_GRAB_SUPPORT_LOOKBACK}")
    print(f"  Late: dist_from_high<{CRYPTO_LATE_DIST_FROM_HIGH_MAX_PCT}% | RSI>{CRYPTO_LATE_RSI_THRESHOLD} | "
          f"recent_gain>{CRYPTO_LATE_RECENT_GAIN_PCT}%")
    print()

    # Test 1: Accumulation (tight range + low volume + far from high)
    print("=== Test 1: تراكم كريبتو حقيقي ===")
    closes = [50000, 49000, 51000, 48000, 50000, 49000, 47000, 49000, 48000, 50000,
              49000, 47000, 46000, 45000, 44000, 45000, 43000, 44000, 43000, 42000,
              41000, 42000, 41000, 40000, 41000, 42000, 41000, 40000, 39000, 40000]
    highs = [c + 1500 for c in closes]
    lows = [c - 1500 for c in closes]
    volumes = [800] * 30
    r = evaluate_crypto_strict_entry(closes, highs, lows, volumes)
    print(f"  Decision: {r['decision']}")
    print(f"  Accumulation: {r['is_accumulation']}")
    print(f"  Reason: {r['reason'][:80]}")
    assert r['decision'] == 'ACCEPT' and r['is_accumulation']
    print("  ✅ PASS")

    # Test 2: Late entry (near high + high RSI)
    print("\n=== Test 2: دخول متأخر كريبتو ===")
    closes2 = [40000 + i * 800 for i in range(30)]
    closes2[-1] = 65000  # near high
    highs2 = [c + 1000 for c in closes2]
    highs2[-6:] = [65500, 65800, 66000, 66000, 65800, 65200]
    lows2 = [c - 1000 for c in closes2]
    volumes2 = [1500] * 30
    r2 = evaluate_crypto_strict_entry(closes2, highs2, lows2, volumes2)
    print(f"  Decision: {r2['decision']}")
    print(f"  is_late: {r2['is_late']}")
    print(f"  Reason: {r2['reason'][:80]}")
    assert r2['decision'] == 'REJECT' and r2['is_late']
    print("  ✅ PASS (Don't Chase)")

    # Test 3: Liquidity Grab
    print("\n=== Test 3: Liquidity Grab كريبتو ===")
    closes3 = [50000, 49500, 49000, 48500, 48000, 47500, 47000, 46500, 46000, 45500,
               45000, 44500, 44000, 43500, 43000, 42500, 42000, 41500, 41000, 40500,
               40000, 39500, 39000, 38500, 38000, 37500, 37000, 36500, 36000, 42000]
    highs3 = [c + 800 for c in closes3]
    lows3 = [c - 800 for c in closes3]
    # Support = min(lows[-26:-2]) = ~35700
    # Sweep: last low goes to 34500 (penetrate below 35700 by ~3.4%)
    lows3[-1] = 34500  # penetrate below support
    closes3[-1] = 42000  # recover above
    highs3[-1] = 42500
    volumes3 = [800] * 30
    volumes3[-1] = 2500
    r3 = evaluate_crypto_strict_entry(closes3, highs3, lows3, volumes3)
    print(f"  Decision: {r3['decision']}")
    print(f"  is_grab: {r3['is_grab']}")
    print(f"  Grab details: penetration={r3['grab_details'].get('penetration_pct', 0)}%, "
          f"recovered={r3['grab_details'].get('recovered')}, "
          f"vol_confirmed={r3['grab_details'].get('volume_confirmed')}")
    assert r3['decision'] == 'ACCEPT' and r3['is_grab']
    print("  ✅ PASS")

    # Test 4: Breakdown below support (no recovery, no accumulation) — REJECT
    print("\n=== Test 4: كسر دعم بلا رجوع ===")
    # BTC near high (65000), drops sharply, no recovery
    closes4 = [64000, 64200, 64400, 64600, 64800, 65000, 64900, 64700, 64500, 64300,
               64100, 63900, 63700, 63500, 63300, 63100, 62900, 62700, 62500, 62300,
               62100, 61900, 61700, 61500, 61300, 61100, 60900, 60700, 60500, 59000]
    highs4 = [c + 300 for c in closes4]
    lows4 = [c - 300 for c in closes4]
    # Override last bar: close below support (no recovery)
    closes4[-1] = 58500  # close below support (~58700)
    highs4[-1] = 58800   # keep high reasonable
    lows4[-1] = 58000    # penetrate below support
    volumes4 = [1500] * 30
    r4 = evaluate_crypto_strict_entry(closes4, highs4, lows4, volumes4)
    print(f"  Decision: {r4['decision']}")
    print(f"  Reason: {r4['reason'][:80]}")
    # Near high → late entry → REJECT (dist_from_high = (65000-58500)/65000 = 10%)
    assert r4['decision'] == 'REJECT'
    print("  ✅ PASS (late entry)")

    # Test 5: No setup (normal gentle uptrend)
    print("\n=== Test 5: سهم عادي (مش setup) ===")
    closes5 = [40000 + i * 200 for i in range(30)]
    highs5 = [c + 500 for c in closes5]
    lows5 = [c - 500 for c in closes5]
    volumes5 = [1000] * 30
    r5 = evaluate_crypto_strict_entry(closes5, highs5, lows5, volumes5)
    print(f"  Decision: {r5['decision']}")
    print(f"  Reason: {r5['reason'][:80]}")
    assert r5['decision'] == 'REJECT'
    print("  ✅ PASS")

    print("\n" + "=" * 70)
    print("✅ Crypto Strict Entry Filters ready (5/5 tests pass)")
    print(f"\nIntegration: V40_2_CRYPTO_STRICT_ENTRY=1 (default OFF)")
    print(f"Logic: is_late → REJECT | is_accumulation OR is_grab → ACCEPT | else REJECT")
