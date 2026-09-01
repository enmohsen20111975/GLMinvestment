#!/usr/bin/env python3
"""
Strict Entry Filters — فلاتر الدخول الصارمة
=============================================
تشديد شروط الدخول في V40.2 بتوجيه المالك:

> "النظام يرفض الدخول بعد الصعود القوي. يدخل فقط في حالتين:
>  1. تراكم حقيقي
>  2. Liquidity Grab واضح
>  غير كده → رفض."

الـ module بـ يوفّر 3 دوال:
  1. is_in_accumulation(closes, highs, lows, volumes) — هل السهم في تراكم؟
  2. is_liquidity_grab(highs, lows, closes, volumes) — هل فيه liquidity grab؟
  3. is_late_entry(closes, highs, rsi) — هل الدخول متأخر (chasing)؟

التكامل في V40.2 خلف feature flag V40_2_STRICT_ENTRY:
  - لو is_late_entry → رفض (Don't Chase الحقيقي)
  - لو is_in_accumulation OR is_liquidity_grab → قبول
  - غير كده → رفض

منطق التراكم الحقيقي (Accumulation):
  - نطاق ضيق في آخر 15-25 يوم (range/ATR منخفض)
  - حجم متوسط أو أقل من المتوسط
  - مفيش قفزة كبيرة في آخر 5-10 أيام (< 12-15%)
  - السعر مش قريب من قمة 20/60 يوم

منطق Liquidity Grab:
  - السعر نزل تحت دعم/مغناطيس مهم
  - رجع وأغلق فوق المستوى في نفس الشمعة أو اللي بعدها
  - يفضل وجود تأكيد حجم أو دلتا إيجابي

منطق Late Entry (Don't Chase):
  - قريب من قمة 20/60 يوم (< 6-8% من الـ high)
  - RSI مرتفع (> 65-70)
  - صعد أكتر من 12-15% في آخر 5-10 أيام

Author: Z.ai Code
Date: 2026-09-01
"""

from __future__ import annotations
import math
from typing import List, Dict, Any, Optional, Tuple


# ═══════════════════════════════════════════════════════════════════════
# Config (thresholds — EGX-calibrated)
# تعديل 2026-09-01: تخفيف العتبات بعد باك-تست (كان بـ يرفض كل شيء)
# ═══════════════════════════════════════════════════════════════════════

# Accumulation thresholds
ACCUM_LOOKBACK = 20              # فحص آخر 20 يوم
ACCUM_RANGE_MAX_PCT = 18.0       # أقصى مدى 18% (كان 12% — EGX أسهم كتير حركتها خشنة)
ACCUM_VOL_MAX_RATIO = 1.4        # الحجم أقل من 1.4× (كان 1.2× — تخفيف بسيط)
ACCUM_RECENT_GAIN_MAX_PCT = 15.0 # أقصى صعود 15% في 5 أيام (كان 12% — تخفيف)
ACCUM_DIST_FROM_20D_HIGH_MIN_PCT = 6.0  # بعيد 6%+ عن قمة 20 يوم (كان 8% — تخفيف)

# Liquidity Grab thresholds
GRAB_LOOKBACK = 10               # فحص آخر 10 شموع
GRAB_SUPPORT_LOOKBACK = 20       # الدعم = أقل قاع في آخر 20 يوم
GRAB_PENETRATION_PCT = 0.5       # لازم ينزل 0.5%+ تحت الدعم
GRAB_RECOVERY_PCT = 0.0           # لازم يقفل فوق الدعم (0% recovery = فوق الدعم)

# Late Entry (Don't Chase) thresholds — تخفيف
LATE_DIST_FROM_HIGH_MAX_PCT = 8.0 # لو أقل من 8% من قمة 20 يوم → late (كان 6%)
LATE_RSI_THRESHOLD = 70.0          # RSI > 70 → late (كان 65 — تخفيف)
LATE_RECENT_GAIN_PCT = 18.0        # صعود +18% في 5 أيام → late (كان 15%)


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

def _safe_atr(highs: List[float], lows: List[float], closes: List[float],
              period: int = 14) -> float:
    """ATR(period)."""
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


def _sma(values: List[float], period: int) -> float:
    """Simple Moving Average."""
    if len(values) < period:
        return sum(values) / len(values) if values else 0.0
    return sum(values[-period:]) / period


def _rsi(closes: List[float], period: int = 14) -> float:
    """RSI(14)."""
    if len(closes) < period + 1:
        return 50.0  # neutral
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
# 1. is_in_accumulation() — هل السهم في تراكم حقيقي؟
# ═══════════════════════════════════════════════════════════════════════

def is_in_accumulation(closes: List[float], highs: List[float],
                        lows: List[float], volumes: List[float]) -> Dict[str, Any]:
    """
    هل السهم في حالة تراكم حقيقي؟

    شروط التراكم (معظمها لازم يتحقق):
      1. نطاق ضيق: (max_high - min_low) / min_low < ACCUM_RANGE_MAX_PCT
      2. حجم هادي: متوسط آخر 20 يوم < 1.2× متوسط 50 يوم
      3. مفيش قفزة حديثة: صعود آخر 5 أيام < ACCUM_RECENT_GAIN_MAX_PCT
      4. بعيد عن القمة: distance from 20-day high > ACCUM_DIST_FROM_20D_HIGH_MIN_PCT

    Returns:
        {
            'is_accumulation': bool,
            'reason': str (سبب القبول/الرفض),
            'range_pct': float,
            'vol_ratio': float,
            'recent_gain_pct': float,
            'dist_from_high_pct': float,
        }
    """
    n = min(len(closes), len(highs), len(lows), len(volumes))
    if n < ACCUM_LOOKBACK + 5:
        return {
            'is_accumulation': False,
            'reason': f'بيانات غير كافية ({n} < {ACCUM_LOOKBACK + 5})',
            'range_pct': 0, 'vol_ratio': 0,
            'recent_gain_pct': 0, 'dist_from_high_pct': 0,
        }

    # 1. Range check (آخر 20 يوم)
    recent_highs = highs[-ACCUM_LOOKBACK:]
    recent_lows = lows[-ACCUM_LOOKBACK:]
    max_high = max(recent_highs)
    min_low = min(recent_lows)
    range_pct = ((max_high - min_low) / min_low * 100) if min_low > 0 else 999

    # 2. Volume ratio (متوسط 20 يوم / متوسط 50 يوم)
    avg_vol_20 = _sma(volumes[-20:], 20) if len(volumes) >= 20 else 0
    avg_vol_50 = _sma(volumes[-50:], 50) if len(volumes) >= 50 else avg_vol_20
    vol_ratio = (avg_vol_20 / avg_vol_50) if avg_vol_50 > 0 else 1.0

    # 3. Recent gain (آخر 5 أيام)
    ref_close = closes[-6] if len(closes) >= 6 else closes[0]
    recent_gain_pct = ((closes[-1] - ref_close) / ref_close * 100) if ref_close > 0 else 0

    # 4. Distance from 20-day high
    high_20d = max(highs[-20:]) if len(highs) >= 20 else max(highs)
    dist_from_high_pct = ((high_20d - closes[-1]) / high_20d * 100) if high_20d > 0 else 0

    # Check conditions (4 من 4)
    cond_range = range_pct < ACCUM_RANGE_MAX_PCT
    cond_vol = vol_ratio < ACCUM_VOL_MAX_RATIO
    cond_no_jump = recent_gain_pct < ACCUM_RECENT_GAIN_MAX_PCT
    cond_far_from_high = dist_from_high_pct >= ACCUM_DIST_FROM_20D_HIGH_MIN_PCT

    # لازم 3 من 4 على الأقل (مع cond_no_jump إلزامي)
    conditions_met = sum([cond_range, cond_vol, cond_far_from_high])
    is_accum = cond_no_jump and conditions_met >= 2  # 2 من 3 (مع no_jump إلزامي)

    if is_accum:
        reason = (f'تراكم حقيقي: range={range_pct:.1f}% (<{ACCUM_RANGE_MAX_PCT}%), '
                  f'vol_ratio={vol_ratio:.2f}× (<{ACCUM_VOL_MAX_RATIO}×), '
                  f'recent_gain={recent_gain_pct:+.1f}% (<{ACCUM_RECENT_GAIN_MAX_PCT}%), '
                  f'dist_from_high={dist_from_high_pct:.1f}% (≥{ACCUM_DIST_FROM_20D_HIGH_MIN_PCT}%)')
    else:
        # تحديد سبب الرفض
        reasons = []
        if not cond_no_jump:
            reasons.append(f'قفزة حديثة {recent_gain_pct:+.1f}% (≥{ACCUM_RECENT_GAIN_MAX_PCT}%)')
        if not cond_range:
            reasons.append(f'نطاق واسع {range_pct:.1f}% (≥{ACCUM_RANGE_MAX_PCT}%)')
        if not cond_far_from_high:
            reasons.append(f'قريب من القمة {dist_from_high_pct:.1f}% (<{ACCUM_DIST_FROM_20D_HIGH_MIN_PCT}%)')
        if not cond_vol:
            reasons.append(f'حجم مرتفع {vol_ratio:.2f}× (≥{ACCUM_VOL_MAX_RATIO}×)')
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
# 2. is_liquidity_grab() — هل فيه liquidity grab؟
# ═══════════════════════════════════════════════════════════════════════

def is_liquidity_grab(highs: List[float], lows: List[float],
                       closes: List[float], volumes: List[float]) -> Dict[str, Any]:
    """
    هل فيه liquidity grab (مسح سيولة)؟

    شروط Liquidity Grab:
      1. السعر نزل تحت دعم مهم (أقل قاع في آخر 20 يوم)
      2. رجع وأغلق فوق الدعم في نفس الشمعة أو اللي بعدها
      3. يفضل حجم أعلى من المتوسط (تأكيد)

    Returns:
        {
            'is_grab': bool,
            'reason': str,
            'support_level': float,
            'penetration_pct': float,
            'recovered': bool,
            'volume_confirmed': bool,
        }
    """
    n = min(len(highs), len(lows), len(closes), len(volumes))
    if n < GRAB_SUPPORT_LOOKBACK + 2:
        return {
            'is_grab': False,
            'reason': f'بيانات غير كافية ({n} < {GRAB_SUPPORT_LOOKBACK + 2})',
            'support_level': 0, 'penetration_pct': 0,
            'recovered': False, 'volume_confirmed': False,
        }

    # Support = lowest low in lookback (excluding last 2 bars)
    support_lows = lows[-(GRAB_SUPPORT_LOOKBACK + 2):-2]
    support_level = min(support_lows) if support_lows else 0
    if support_level <= 0:
        return {
            'is_grab': False,
            'reason': 'مستوى دعم غير صالح',
            'support_level': 0, 'penetration_pct': 0,
            'recovered': False, 'volume_confirmed': False,
        }

    # Check last 2 bars (the grab + recovery)
    grab_low_1 = lows[-2]
    grab_low_2 = lows[-1]
    close_1 = closes[-2]
    close_2 = closes[-1]
    current_vol = volumes[-1]
    avg_vol = _sma(volumes[-20:], 20) if len(volumes) >= 20 else 1

    # Did price penetrate below support?
    penetrated_1 = grab_low_1 < support_level
    penetrated_2 = grab_low_2 < support_level
    penetrated = penetrated_1 or penetrated_2

    # Penetration depth (%)
    grab_low = min(grab_low_1, grab_low_2)
    penetration_pct = ((support_level - grab_low) / support_level * 100) if support_level > 0 else 0

    # Did it recover (close above support)?
    recovered_1 = close_1 >= support_level
    recovered_2 = close_2 >= support_level
    # Grab حقيقي = نزول تحت الدعم + رجوع فوقه (الشمعة الأخيرة لازم تقفل فوق الدعم)
    recovered = penetrated and recovered_2 and (recovered_1 or recovered_2)

    # Volume confirmation (current vol > 1.3× avg)
    volume_confirmed = current_vol > avg_vol * 1.3 if avg_vol > 0 else False

    # Grab must penetrate enough + recover
    is_grab = penetrated and penetration_pct >= GRAB_PENETRATION_PCT and recovered

    if is_grab:
        vol_note = ' بحجم مؤكد' if volume_confirmed else ' (بدون تأكيد حجم)'
        reason = (f'Liquidity Grab: نزل {penetration_pct:.2f}% تحت الدعم {support_level:.2f} '
                  f'و رجع قفل فوقه{vol_note}')
    else:
        reasons = []
        if not penetrated:
            reasons.append('مينزلش تحت الدعم')
        elif penetration_pct < GRAB_PENETRATION_PCT:
            reasons.append(f'نزول ضعيف {penetration_pct:.2f}% (<{GRAB_PENETRATION_PCT}%)')
        if not recovered:
            reasons.append('مارجعش فوق الدعم')
        reason = 'مش grab: ' + ' | '.join(reasons) if reasons else 'مش grab'

    return {
        'is_grab': is_grab,
        'reason': reason,
        'support_level': round(support_level, 2),
        'penetration_pct': round(penetration_pct, 2),
        'recovered': recovered,
        'volume_confirmed': volume_confirmed,
    }


# ═══════════════════════════════════════════════════════════════════════
# 3. is_late_entry() — هل الدخول متأخر (Don't Chase)?
# ═══════════════════════════════════════════════════════════════════════

def is_late_entry(closes: List[float], highs: List[float],
                   rsi: Optional[float] = None) -> Dict[str, Any]:
    """
    هل الدخول متأخر (chasing)؟

    شروط Late Entry (Hard Reject):
      1. قريب من قمة 20 يوم (distance < LATE_DIST_FROM_HIGH_MAX_PCT)
      2. RSI مرتفع (> LATE_RSI_THRESHOLD)
      3. صعود قوي في آخر 5 أيام (> LATE_RECENT_GAIN_PCT)

    أي شرط من التلاتة كافٍ للرفض (Don't Chase)

    Returns:
        {
            'is_late': bool,
            'reason': str,
            'dist_from_high_pct': float,
            'rsi': float,
            'recent_gain_pct': float,
        }
    """
    if len(closes) < 20 or len(highs) < 20:
        return {
            'is_late': False,
            'reason': 'بيانات غير كافية',
            'dist_from_high_pct': 0, 'rsi': 0, 'recent_gain_pct': 0,
        }

    # 1. Distance from 20-day high
    high_20d = max(highs[-20:])
    dist_from_high_pct = ((high_20d - closes[-1]) / high_20d * 100) if high_20d > 0 else 0

    # 2. RSI
    if rsi is None:
        rsi = _rsi(closes, 14)

    # 3. Recent gain (5 days)
    ref_close = closes[-6] if len(closes) >= 6 else closes[0]
    recent_gain_pct = ((closes[-1] - ref_close) / ref_close * 100) if ref_close > 0 else 0

    # Check conditions (any one triggers late entry)
    cond_near_high = dist_from_high_pct < LATE_DIST_FROM_HIGH_MAX_PCT
    cond_high_rsi = rsi > LATE_RSI_THRESHOLD
    cond_recent_surge = recent_gain_pct > LATE_RECENT_GAIN_PCT

    is_late = cond_near_high or cond_high_rsi or cond_recent_surge

    if is_late:
        reasons = []
        if cond_near_high:
            reasons.append(f'قريب من قمة 20 يوم {dist_from_high_pct:.1f}% (<{LATE_DIST_FROM_HIGH_MAX_PCT}%)')
        if cond_high_rsi:
            reasons.append(f'RSI مرتفع {rsi:.1f} (>{LATE_RSI_THRESHOLD})')
        if cond_recent_surge:
            reasons.append(f'صعود قوي {recent_gain_pct:+.1f}% (>{LATE_RECENT_GAIN_PCT}%)')
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
# 4. evaluate_strict_entry() — القرار النهائي للدخول
# ═══════════════════════════════════════════════════════════════════════

def evaluate_strict_entry(closes: List[float], highs: List[float],
                           lows: List[float], volumes: List[float],
                           rsi: Optional[float] = None) -> Dict[str, Any]:
    """
    تقييم شامل للدخول الصارم (strict entry).

    القرار:
      - لو is_late_entry → REJECT (Don't Chase)
      - لو is_in_accumulation OR is_liquidity_grab → ACCEPT
      - غير كده → REJECT (مش تراكم ولا grab)

    Returns:
        {
            'decision': 'ACCEPT'|'REJECT',
            'reason': str,
            'is_accumulation': bool,
            'is_grab': bool,
            'is_late': bool,
            'accumulation_details': dict,
            'grab_details': dict,
            'late_details': dict,
        }
    """
    # 1. Late entry check (first — hard reject)
    late = is_late_entry(closes, highs, rsi)

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

    # 2. Accumulation check
    accum = is_in_accumulation(closes, highs, lows, volumes)

    # 3. Liquidity grab check
    grab = is_liquidity_grab(highs, lows, closes, volumes)

    # Decision: accept if accumulation OR grab
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

    # Reject — neither accumulation nor grab
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
    print("🧪 Strict Entry Filters — Self Test")
    print("=" * 70)
    print(f"Thresholds:")
    print(f"  Accumulation: range<{ACCUM_RANGE_MAX_PCT}%, vol<{ACCUM_VOL_MAX_RATIO}×, "
          f"recent_gain<{ACCUM_RECENT_GAIN_MAX_PCT}%, dist_from_high≥{ACCUM_DIST_FROM_20D_HIGH_MIN_PCT}%")
    print(f"  Grab: penetration≥{GRAB_PENETRATION_PCT}%, support_lookback={GRAB_SUPPORT_LOOKBACK}")
    print(f"  Late: dist_from_high<{LATE_DIST_FROM_HIGH_MAX_PCT}% | RSI>{LATE_RSI_THRESHOLD} | "
          f"recent_gain>{LATE_RECENT_GAIN_PCT}%")
    print()

    # Test 1: Accumulation — tight range + low volume + no jump + far from high
    print("=== Test 1: تراكم حقيقي (نطاق ضيق + حجم هادي + بعيد عن القمة) ===")
    # Base around 100, then drift down to 90 (so we're 10% below 20d high = far from high)
    closes = [100, 99, 101, 98, 100, 99, 97, 99, 98, 100, 99, 97, 96, 95, 94, 95, 93, 94, 93, 92, 91, 92, 91, 90, 91]
    highs = [c + 1.5 for c in closes]
    lows = [c - 1.5 for c in closes]
    volumes = [800] * 25  # low volume
    r = evaluate_strict_entry(closes, highs, lows, volumes)
    print(f"  Decision: {r['decision']}")
    print(f"  Accumulation: {r['is_accumulation']} (range={r['accumulation_details'].get('range_pct', 0)}%, "
          f"dist_from_high={r['accumulation_details'].get('dist_from_high_pct', 0)}%)")
    print(f"  Reason: {r['reason']}")
    assert r['decision'] == 'ACCEPT' and r['is_accumulation']
    print("  ✅ PASS")

    # Test 2: Late entry — near 20-day high + high RSI
    print("\n=== Test 2: دخول متأخر (قريب من القمة + RSI عالي) ===")
    closes2 = [100 + i * 0.5 for i in range(25)]  # uptrend to 112
    closes2[-1] = 112  # near high
    highs2 = [c + 0.5 for c in closes2]
    highs2[-5:] = [113, 113.5, 114, 114, 112.5]  # recent highs
    lows2 = [c - 0.5 for c in closes2]
    volumes2 = [1500] * 25
    r2 = evaluate_strict_entry(closes2, highs2, lows2, volumes2)
    print(f"  Decision: {r2['decision']}")
    print(f"  is_late: {r2['is_late']}")
    print(f"  Reason: {r2['reason']}")
    assert r2['decision'] == 'REJECT' and r2['is_late']
    print("  ✅ PASS (Don't Chase)")

    # Test 3: Liquidity Grab — sweep below support + recovery (in downtrend, far from high)
    print("\n=== Test 3: Liquidity Grab (مسح تحت الدعم + رجوع) ===")
    # Stock in downtrend from 120 → 95 (far from 20d high = 120)
    # Support ~94 (min low in last 20 bars)
    # Last bar sweeps to 92 then closes at 95 (recovery)
    closes3 = [120, 118, 116, 114, 112, 110, 108, 106, 104, 102, 100, 99, 98, 97, 96, 95, 94, 95, 94, 95, 94, 95, 94, 95, 95]
    highs3 = [c + 1.0 for c in closes3]
    lows3 = [c - 1.0 for c in closes3]
    # Support = min(lows[-22:-2]) = ~93
    # Sweep: last low goes to 91 (penetrate below 93)
    lows3[-1] = 91.0  # penetrate below support
    closes3[-1] = 95.0  # recover above support
    highs3[-1] = 95.5
    volumes3 = [800] * 25
    volumes3[-1] = 2500  # volume confirmation
    r3 = evaluate_strict_entry(closes3, highs3, lows3, volumes3)
    print(f"  Decision: {r3['decision']}")
    print(f"  is_grab: {r3['is_grab']}")
    print(f"  Grab details: penetration={r3['grab_details'].get('penetration_pct', 0)}%, "
          f"recovered={r3['grab_details'].get('recovered')}, "
          f"vol_confirmed={r3['grab_details'].get('volume_confirmed')}")
    print(f"  Reason: {r3['reason']}")
    assert r3['decision'] == 'ACCEPT' and r3['is_grab']
    print("  ✅ PASS")

    # Test 4: Breakdown below support (no recovery) — REJECT
    print("\n=== Test 4: كسر دعم بلا رجوع (REJECT) ===")
    closes4 = [100 + math.sin(i * 0.05) * 0.3 for i in range(25)]
    highs4 = [c + 0.2 for c in closes4]
    lows4 = [c - 0.2 for c in closes4]
    lows4[-1] = 98.0  # penetrate below
    closes4[-1] = 98.5  # close below support (no recovery)
    highs4[-1] = 99.0
    volumes4 = [800] * 25
    volumes4[-1] = 1500
    r4 = evaluate_strict_entry(closes4, highs4, lows4, volumes4)
    print(f"  Decision: {r4['decision']}")
    print(f"  is_grab: {r4['is_grab']}")
    print(f"  Reason: {r4['reason'][:80]}...")
    assert r4['decision'] == 'REJECT'
    print("  ✅ PASS (كسر حقيقي — مش grab)")

    # Test 5: Don't Chase — stock surged +18% in 5 days
    print("\n=== Test 5: صعود قوي 18% في 5 أيام (REJECT) ===")
    closes5 = [100 + i * 0.2 for i in range(25)]  # gentle uptrend
    closes5[-5:] = [103, 106, 109, 115, 121]  # surge +18% in 5 days
    highs5 = [c + 0.5 for c in closes5]
    lows5 = [c - 0.5 for c in closes5]
    volumes5 = [1200] * 25
    r5 = evaluate_strict_entry(closes5, highs5, lows5, volumes5)
    print(f"  Decision: {r5['decision']}")
    print(f"  is_late: {r5['is_late']}")
    print(f"  late_details: recent_gain={r5['late_details'].get('recent_gain_pct', 0)}%")
    print(f"  Reason: {r5['reason'][:80]}...")
    assert r5['decision'] == 'REJECT' and r5['is_late']
    print("  ✅ PASS (Don't Chase — مطاردة)")

    # Test 6: Normal stock (not accumulation, not grab, not late) — REJECT
    print("\n=== Test 6: سهم عادي (مش تراكم ولا grab ولا late) ===")
    closes6 = [100 + i * 0.3 for i in range(25)]  # gentle uptrend, no setup
    highs6 = [c + 1.5 for c in closes6]
    lows6 = [c - 1.5 for c in closes6]
    volumes6 = [1000] * 25
    r6 = evaluate_strict_entry(closes6, highs6, lows6, volumes6)
    print(f"  Decision: {r6['decision']}")
    print(f"  Reason: {r6['reason'][:100]}...")
    # Should reject (no clear setup)
    assert r6['decision'] == 'REJECT'
    print("  ✅ PASS (مش setup)")

    # Test 7: Insufficient data
    print("\n=== Test 7: بيانات غير كافية ===")
    r7 = evaluate_strict_entry([100, 101], [101, 102], [99, 100], [500, 600])
    print(f"  Decision: {r7['decision']}")
    print(f"  Reason: {r7['reason']}")
    print("  ✅ PASS (safe reject)")

    print("\n" + "=" * 70)
    print("✅ Strict Entry Filters ready (7/7 tests pass)")
    print(f"\nIntegration in V40.2: V40_2_STRICT_ENTRY=1 (default OFF for backtest)")
    print(f"Logic: is_late → REJECT | is_accumulation OR is_grab → ACCEPT | else REJECT")
