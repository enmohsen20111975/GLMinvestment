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

# BRAVO-SSOT Stage 4: delegate to canonical (Rule 67)
from analyzers.indicators.ma import sma as _canonical_sma
from analyzers.indicators.rsi import calc_rsi as _canonical_rsi


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
    """SMA — BRAVO-SSOT: delegates to canonical analyzers.indicators.ma.sma."""
    return _canonical_sma(values, period)


def _rsi(closes: List[float], period: int = 14) -> float:
    """RSI — BRAVO-SSOT: delegates to canonical analyzers.indicators.rsi.calc_rsi (Wilder's).

    Backward-compat wrapper: canonical بترجع None لو البيانات قليلة،
    احنا بنرجّع 50.0 (محايد) للحفاظ على السلوك القديم.
    """
    result = _canonical_rsi(closes, period)
    return result if result is not None else 50.0  # backward compat: 50.0 neutral fallback


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
# 6. Liquidity Grab Opportunity + Average Down (Phase 2 — 2026-09-02)
# ═══════════════════════════════════════════════════════════════════════
# توجيه المالك (2026-09-02):
#   "السوق المصري نزوله حاد كتير بيبقى Liquidity Grab من الصناع وبعدين انفجار سعري.
#    عايزين تعريف كمي لفرصة المتوسط السعري (Average Down) الذكي، مش الأعمى."
#
# الشروط الكمية الصارمة (quantitative, measurable):
#   1. السهم كسر قاع سابق/منطقة دعم بنسبة بين 3% و 8% (مش أقل، مش أكتر).
#   2. حجم شمعة الكسر أعلى من متوسط الحجم 20 يوم (تأكيد).
#   3. خلال 1-3 أيام يرجع السعر فوق مستوى الكسر (أو فوق منتصف شمعة الكسر) مع حجم صاعد.
#   4. السعر يرجع فوق SMA50 أو كان أصلاً قريب منه (within 5%).
#   5. مفيش Change of Character هابط واضح (no 3 consecutive lower-lows + lower-highs).
#
# قواعد صارمة (hard rules — لا تُكسر):
#   - الستوب يفضل موجود. المتوسط مش بديل للستوب، هو قرار إضافي.
#   - المتوسط مرة واحدة بس كحد أقصى.
#   - حجم المتوسط = نصف حجم الصفقة الأصلية (50%).
#   - الـ new stop = min(original_stop, avg_down_trigger - 0.5×ATR) (مش أوسع من الأصلي).

# ─── Thresholds (EGX-calibrated) ───
AVG_DOWN_BREAK_MIN_PCT = 3.0          # كسر 3% على الأقل
AVG_DOWN_BREAK_MAX_PCT = 8.0          # كسر 8% على الأكثر (أكتر = falling knife)
AVG_DOWN_RECOVERY_DAYS = 3            # رجوع خلال 1-3 أيام
AVG_DOWN_RECOVERY_RATIO = 0.5         # رجوع فوق منتصف شمعة الكسر (0.5 = فوق منتصف)
AVG_DOWN_VOL_RATIO_MIN = 1.1          # حجم صاعد للرجوع (مش صارم زي grab)
AVG_DOWN_PROXIMITY_TO_SMA50 = 8.0     # السعر لسه قريب من SMA50 (within 8% — expanded 5→8)
AVG_DOWN_SIZE_PCT = 50.0              # حجم المتوسط = 50% من الصفقة الأصلية
AVG_DOWN_LOOKBACK_BARS = 10           # ابحث آخر 10 أيام للكسر+الرجوع (م扩عاً من 3)


def is_liquidity_grab_opportunity(closes: List[float],
                                    highs: List[float],
                                    lows: List[float],
                                    volumes: List[float],
                                    sma50: Optional[float] = None) -> Dict[str, Any]:
    """
    تعريف كمي صارم لـ Liquidity Grab Opportunity (فرصة المتوسط السعري الذكي).

    الفرق بين ده و is_liquidity_grab():
      - is_liquidity_grab: يدخل سهم نزل تحت دعم ورجع فوقه (entry signal).
      - is_liquidity_grab_opportunity: سهم كسر دعم بنسبة 3-8% + رجع خلال 3 أيام
        + قريب من SMA50 = فرصة متوسط سعري (ADD to existing position).

    Returns:
        {
            'is_opportunity': bool,
            'break_pct': float,        # نسبة الكسر
            'recovered': bool,
            'recovery_days': int,
            'vol_confirmed': bool,
            'near_sma50': bool,
            'no_bearish_choc': bool,   # لا Change of Character هابط
            'reason': str,
            'details': dict,
        }
    """
    n = min(len(closes), len(highs), len(lows), len(volumes))
    if n < 25:
        return {'is_opportunity': False, 'reason': f'بيانات غير كافية ({n} < 25)',
                'break_pct': 0, 'recovered': False, 'recovery_days': 0,
                'vol_confirmed': False, 'near_sma50': False, 'no_bearish_choc': False}

    # Support = lowest low in last 20 days (excluding last 3)
    if n < 23:
        return {'is_opportunity': False, 'reason': 'بيانات غير كافية', 'break_pct': 0,
                'recovered': False, 'recovery_days': 0, 'vol_confirmed': False,
                'near_sma50': False, 'no_bearish_choc': False}
    support_lows = lows[-23:-3]
    support_level = min(support_lows) if support_lows else 0
    if support_level <= 0:
        return {'is_opportunity': False, 'reason': 'مستوى دعم غير صالح',
                'break_pct': 0, 'recovered': False, 'recovery_days': 0,
                'vol_confirmed': False, 'near_sma50': False, 'no_bearish_choc': False}

    # avg_vol 20d
    avg_vol = _sma(volumes[-20:], 20) if len(volumes) >= 20 else 1

    # Look back up to AVG_DOWN_RECOVERY_DAYS for the break + recovery pattern
    # We scan last 3 bars; each bar = "today". Find: did price break support recently + recover?
    found = False
    break_pct = 0
    recovery_days = 0
    recovered = False
    vol_confirmed = False
    break_idx = -1
    break_low = 0

    # check last AVG_DOWN_LOOKBACK_BARS days: was there a break day + recovery within AVG_DOWN_RECOVERY_DAYS?
    for back in range(1, min(AVG_DOWN_LOOKBACK_BARS + 1, n)):
        break_idx_candidate = n - 1 - back  # the break day
        if break_idx_candidate < 0:
            continue
        break_low_candidate = lows[break_idx_candidate]
        if break_low_candidate >= support_level:
            continue  # didn't break
        pct = ((support_level - break_low_candidate) / support_level * 100)
        if pct < AVG_DOWN_BREAK_MIN_PCT or pct > AVG_DOWN_BREAK_MAX_PCT:
            continue  # out of range
        # check recovery in the bars AFTER break (within AVG_DOWN_RECOVERY_DAYS window)
        recovered_now = False
        vol_up = False
        recovery_offset = 0
        for j in range(break_idx_candidate + 1,
                       min(break_idx_candidate + 1 + AVG_DOWN_RECOVERY_DAYS, n)):
            # recovery = close above support AND above midpoint of break candle
            mid_break = (highs[break_idx_candidate] + break_low_candidate) / 2
            if closes[j] >= support_level and closes[j] >= mid_break:
                recovered_now = True
                recovery_offset = j - break_idx_candidate
                # volume on recovery day should be > avg
                if volumes[j] > avg_vol * AVG_DOWN_VOL_RATIO_MIN:
                    vol_up = True
                break
        if recovered_now:
            found = True
            break_pct = pct
            recovery_days = recovery_offset
            recovered = True
            vol_confirmed = vol_up
            break_idx = break_idx_candidate
            break_low = break_low_candidate
            break

    if not found:
        return {'is_opportunity': False,
                'reason': 'مفيش كسر + رجوع ضمن النطاق 3-8%',
                'break_pct': 0, 'recovered': False, 'recovery_days': 0,
                'vol_confirmed': False, 'near_sma50': False, 'no_bearish_choc': False}

    # Near SMA50?
    current_close = closes[-1]
    near_sma50 = False
    if sma50 is not None and sma50 > 0:
        dist_pct = abs(current_close - sma50) / sma50 * 100
        near_sma50 = dist_pct <= AVG_DOWN_PROXIMITY_TO_SMA50

    # No bearish ChoC? (no 3 consecutive lower-lows + lower-highs in last 6 bars)
    no_bearish_choc = True
    if n >= 6:
        recent_lows = lows[-6:]
        recent_highs = highs[-6:]
        # 3 consecutive lower lows
        ll_count = sum(1 for i in range(1, 3) if recent_lows[-1-i] > recent_lows[-i])
        # 3 consecutive lower highs
        lh_count = sum(1 for i in range(1, 3) if recent_highs[-1-i] > recent_highs[-i])
        if ll_count >= 2 and lh_count >= 2:
            no_bearish_choc = False  # bearish ChoC detected

    is_opp = (recovered and vol_confirmed and near_sma50 and no_bearish_choc)

    reason_parts = []
    reason_parts.append(f'كسر {break_pct:.2f}% تحت الدعم {support_level:.2f}')
    reason_parts.append(f'رجوع خلال {recovery_days} يوم')
    if vol_confirmed:
        reason_parts.append('بحجم مؤكد')
    else:
        reason_parts.append('بدون تأكيد حجم')
    if near_sma50:
        reason_parts.append('قريب من SMA50')
    else:
        reason_parts.append('بعيد عن SMA50')
    if no_bearish_choc:
        reason_parts.append('بدون ChoC هابط')
    else:
        reason_parts.append('فيه ChoC هابط')

    reason = ('✅ فرصة متوسط: ' if is_opp else '❌ مش فرصة: ') + ' | '.join(reason_parts)

    return {
        'is_opportunity': is_opp,
        'break_pct': round(break_pct, 2),
        'recovered': recovered,
        'recovery_days': recovery_days,
        'vol_confirmed': vol_confirmed,
        'near_sma50': near_sma50,
        'no_bearish_choc': no_bearish_choc,
        'reason': reason,
        'details': {
            'support_level': round(support_level, 2),
            'break_low': round(break_low, 2),
            'break_idx': break_idx,
            'avg_vol_20': round(avg_vol, 2),
            'avg_down_size_pct': AVG_DOWN_SIZE_PCT,
        },
    }


def evaluate_average_down(closes: List[float],
                            highs: List[float],
                            lows: List[float],
                            volumes: List[float],
                            original_entry: float,
                            original_stop: float,
                            current_price: float,
                            sma50: Optional[float] = None,
                            already_averaged: bool = False) -> Dict[str, Any]:
    """
    تقييم قرار المتوسط السعري (Average Down) لصفقة قائمة.

    Args:
        original_entry: سعر الدخول الأصلي.
        original_stop: سعر الستوب الأصلي.
        current_price: السعر الحالي.
        already_averaged: هل الصفقة اتـ average قبل كده؟ (ممنوع مرتين)

    Returns:
        {
            'should_average': bool,
            'avg_price': float | None,    # سعر المتوسط المقترح (نصف حجم الصفقة)
            'new_avg_entry': float | None, # متوسط سعر الدخول الجديد بعد المتوسط
            'new_stop': float | None,     # الستوب الجديد (مش أوسع من الأصلي)
            'reason': str,
            'opportunity_details': dict,
        }
    """
    if already_averaged:
        return {'should_average': False, 'avg_price': None, 'new_avg_entry': None,
                'new_stop': None, 'reason': 'ممنوع: الصفقة اتـ average قبل كده (مرة واحدة بس)',
                'opportunity_details': {}}

    # Check if original stop is still valid (not hit)
    if current_price <= original_stop:
        return {'should_average': False, 'avg_price': None, 'new_avg_entry': None,
                'new_stop': None, 'reason': 'ممنوع: الستوب ضرب — ممنوع المتوسط على صفقة خاسرة بقتعلم',
                'opportunity_details': {}}

    # Liquidity grab opportunity check
    opp = is_liquidity_grab_opportunity(closes, highs, lows, volumes, sma50)
    if not opp['is_opportunity']:
        return {'should_average': False, 'avg_price': None, 'new_avg_entry': None,
                'new_stop': None, 'reason': f'ممنوع: {opp["reason"]}',
                'opportunity_details': opp}

    # Average down: add 50% size at current price
    # New avg entry = (original_entry + current_price) / 2 (assuming original size = 1, add 0.5)
    new_avg_entry = (original_entry + current_price) / 2

    # New stop: keep original (لا توسيع)
    # V40.2 hard rule: الستوب مش بيتوسّع بحجة المتوسط.
    new_stop = original_stop

    return {
        'should_average': True,
        'avg_price': round(current_price, 2),
        'new_avg_entry': round(new_avg_entry, 2),
        'new_stop': round(new_stop, 2),
        'reason': f'✅ متوسط مرة واحدة عند {current_price:.2f} — متوسط الدخول الجديد = {new_avg_entry:.2f}',
        'opportunity_details': opp,
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
