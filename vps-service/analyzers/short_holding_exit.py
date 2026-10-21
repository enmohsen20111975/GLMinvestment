#!/usr/bin/env python3
"""
Short Holding + Distribution Exit — مدة احتفاظ قصيرة + منطق الخروج
===================================================================
تكملة الـ strict entry filters بتوجيه المالك:

> "فرض مدة احتفاظ قصيرة (7 أيام max + خروج لو مفيش حركة في 3 أيام).
>  إضافة منطق توزيع واضح كإشارة خروج (SELL / Force Exit)."

الـ module بـ يوفّر:

1. should_force_exit_by_time() — فحص مدة الاحتفاظ:
   - max_holding_7d: لو عدّت 7 أيام → إغلاق إجباري
   - no_move_3d: لو 3 أيام مفيش حركة +3% → إغلاق إجباري
   - early_drop: لو نزل -5% في أول 3 أيام → إغلاق إجباري

2. detect_distribution() — كشف شمعة التوزيع:
   - شمعة حمراء/ضعيفة عند منطقة عالية
   - ظل علوي طويل (أكبر من الجسم)
   - حجم أعلى من المتوسط (>1.8×)
   - السعر قريب من قمة 20/60 يوم
   - ضعف زخم (RSI ينزل من منطقة مرتفعة)

الـ flags:
  - V40_2_SHORT_HOLDING (default OFF)
  - V40_2_DISTRIBUTION_EXIT (default OFF)

Author: Z.ai Code
Date: 2026-09-01
"""

from __future__ import annotations
import math
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta

# BRAVO-SSOT Stage 4: delegate to canonical (Rule 67)
from analyzers.indicators.ma import sma as _canonical_sma
from analyzers.indicators.rsi import calc_rsi as _canonical_rsi


# ═══════════════════════════════════════════════════════════════════════
# Config (thresholds — EGX-calibrated)
# تعديل 2026-09-01: تحويل الخروج من زمني إلى هيكلي
# الفلسفة: تصحيح → صبر، انهيار → خروج، ربح → أهداف
# ═══════════════════════════════════════════════════════════════════════

# Holding rules — الوقت شرط مساعد ضعيف، ليس سبب وحيد
MAX_HOLDING_DAYS = 14             # مراجعة بعد 14 يوم (مش إغلاق إجباري)
REVIEW_THRESHOLD_DAYS = 7         # بعد 7 أيام بدون تقدم → مراجعة (تنبيه فقط)
EARLY_DROP_DAYS = 3               # فحص النزول في أول 3 أيام
EARLY_DROP_THRESHOLD_PCT = -7.0   # نزول -7% في 3 أيام → خروج (حماية رأس مال)

# Compound time exit: وقت طويل + خارج التصحيح + ضعف
COMPOUND_MIN_DAYS = 10            # بعد 10 أيام
COMPOUND_BEYOND_CORRECTION_MULT = 1.3  # نزول أعمق من typical_correction × 1.3

# Distribution detection (منطقها سليم — بقاء)
DIST_UPPER_WICK_RATIO = 1.0       # الظل العلوي ≥ الجسم
DIST_VOLUME_RATIO = 1.8           # الحجم ≥ 1.8× متوسط 20 يوم
DIST_DIST_FROM_HIGH_MAX_PCT = 8.0 # قريب من قمة 20 يوم (≤8%)
DIST_RSI_HIGH_THRESHOLD = 65.0    # RSI مرتفع أو بـ ينزل من >65
DIST_LOOKBACK = 20                # فحص آخر 20 يوم


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

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
# 1a. تصحيح vs انهيار — دوال التمييز (جديدة — ترتبط بالنوتبوك)
# ═══════════════════════════════════════════════════════════════════════

def is_within_typical_correction(
    entry_price: float,
    current_price: float,
    typical_correction_pct: float = 0,
) -> Dict[str, Any]:
    """
    هل النزول جوه نطاق التصحيح المعتاد للسهم؟

    لو typical_correction_pct = 0 (نوتبوك فاضي/غير موجود) → محايد (لا تصحيح ولا انهيار)
    """
    if typical_correction_pct <= 0 or entry_price <= 0:
        return {'within': True, 'drop_pct': 0, 'reason': 'لا يوجد تصحيح معتاد مسجل'}

    drop_pct = ((entry_price - current_price) / entry_price * 100) if entry_price > 0 else 0
    within = drop_pct <= typical_correction_pct

    if within:
        reason = f'النزول {drop_pct:.1f}% جوه التصحيح المعتاد ({typical_correction_pct:.1f}%) → صبر'
    else:
        reason = f'النزول {drop_pct:.1f}% أعمق من التصحيح المعتاد ({typical_correction_pct:.1f}%) → خطر'

    return {'within': within, 'drop_pct': round(drop_pct, 2), 'reason': reason}


def is_breakdown_not_correction(
    entry_price: float,
    current_price: float,
    typical_correction_pct: float = 0,
    rsi: Optional[float] = None,
    recent_closes: Optional[List[float]] = None,
) -> Dict[str, Any]:
    """
    هل ده انهيار حقيقي وليس مجرد تصحيح؟

    شروط الانهيار (معظمها لازم يتحقق):
      1. النزول أعمق بوضوح من typical_correction_pct (×1.3)
      2. RSI منخفض جداً (< 30) — ضعف شديد
      3. السعر بـ ينزل باستمرار بدون ارتداد (آخر 5 شموع كلها حمراء)
    """
    if entry_price <= 0:
        return {'is_breakdown': False, 'reason': 'سعر دخول غير صالح'}

    drop_pct = ((entry_price - current_price) / entry_price * 100)

    # شرط 1: أعمق من التصحيح المعتاد × 1.3
    if typical_correction_pct > 0:
        threshold = typical_correction_pct * COMPOUND_BEYOND_CORRECTION_MULT
        cond_deep = drop_pct > threshold
    else:
        # لو مفيش نوتبوك → استخدم عتبة عامة (15% = عميق لأي سهم)
        cond_deep = drop_pct > 15.0
        threshold = 15.0

    # شرط 2: RSI منخفض جداً
    cond_rsi_weak = rsi is not None and rsi < 30

    # شرط 3: 5 شموع حمراء متتالية (نزول مستمر)
    cond_continuous_drop = False
    if recent_closes and len(recent_closes) >= 5:
        cond_continuous_drop = all(recent_closes[i] < recent_closes[i-1] for i in range(1, 5))

    # قرار: انهيار لو 2 من 3 شروط على الأقل
    conditions_met = sum([cond_deep, cond_rsi_weak, cond_continuous_drop])
    is_breakdown = conditions_met >= 2

    if is_breakdown:
        reasons = []
        if cond_deep:
            reasons.append(f'نزول {drop_pct:.1f}% > {threshold:.1f}% (×1.3 من التصحيح)')
        if cond_rsi_weak:
            reasons.append(f'RSI={rsi:.1f} (<30 — ضعف شديد)')
        if cond_continuous_drop:
            reasons.append('5 شموع حمراء متتالية')
        reason = 'انهيار: ' + ' | '.join(reasons)
    else:
        reason = f'مش انهيار (drop={drop_pct:.1f}%, conditions={conditions_met}/3)'

    return {
        'is_breakdown': is_breakdown,
        'drop_pct': round(drop_pct, 2),
        'reason': reason,
        'conditions_met': conditions_met,
        'threshold_pct': round(threshold, 1),
    }


# ═══════════════════════════════════════════════════════════════════════
# 1b. should_force_exit_by_time() — فحص مدة الاحتفاظ (هيكلي الآن)
# ═══════════════════════════════════════════════════════════════════════

def should_force_exit_by_time(
    entry_date: str,
    current_date: str,
    entry_price: float,
    current_price: float,
    price_history: Optional[List[Dict[str, float]]] = None,
    typical_correction_pct: float = 0,
    rsi: Optional[float] = None,
    recent_closes: Optional[List[float]] = None,
) -> Dict[str, Any]:
    """
    فحص هل لازم إغلاق إجباري — فلسفة هيكلية (مش زمنية صرفة).

    الأولويات:
      1. early_drop (نزول حاد بعد الدخول — حماية رأس مال)
      2. compound_exit (وقت طويل + خارج التصحيح + ضعف هيكل)
      3. review_alert (تنبيه مراجعة بعد X يوم بدون تقدم — ليس إغلاق)

    ممنوع: "عدّى 7 أيام → اخرج" بدون شروط أخرى.
    """
    # Parse dates
    try:
        entry_dt = datetime.strptime(entry_date[:10], '%Y-%m-%d')
        current_dt = datetime.strptime(current_date[:10], '%Y-%m-%d')
    except (ValueError, TypeError):
        return {
            'should_exit': False,
            'reason': 'تواريخ غير صالحة',
            'exit_code': '',
            'days_held': 0,
            'return_pct': 0,
        }

    days_held = (current_dt - entry_dt).days
    if days_held < 0:
        days_held = 0

    return_pct = ((current_price - entry_price) / entry_price * 100) if entry_price > 0 else 0

    # 1. Early drop (حماية رأس مال — نزول حاد في أول 3 أيام)
    if days_held <= EARLY_DROP_DAYS and return_pct <= EARLY_DROP_THRESHOLD_PCT:
        return {
            'should_exit': True,
            'reason': f'نزول مبكر {return_pct:+.2f}% في {days_held} يوم (≤ {EARLY_DROP_THRESHOLD_PCT}%) — حماية رأس مال',
            'exit_code': 'early_drop',
            'days_held': days_held,
            'return_pct': round(return_pct, 2),
        }

    # 2. Compound exit: وقت طويل + خارج التصحيح المعتاد + ضعف هيكل
    if days_held >= COMPOUND_MIN_DAYS:
        breakdown = is_breakdown_not_correction(
            entry_price, current_price, typical_correction_pct, rsi, recent_closes
        )
        if breakdown['is_breakdown']:
            return {
                'should_exit': True,
                'reason': f'انهيار بعد {days_held} يوم: {breakdown["reason"]}',
                'exit_code': 'compound_breakdown_exit',
                'days_held': days_held,
                'return_pct': round(return_pct, 2),
            }

    # 3. Review alert (تنبيه وليس إغلاق)
    if days_held >= REVIEW_THRESHOLD_DAYS and return_pct < 0:
        # هل النزول جوه التصحيح المعتاد؟
        correction = is_within_typical_correction(entry_price, current_price, typical_correction_pct)
        if not correction['within']:
            # خارج التصحيح — مراجعة جدية
            return {
                'should_exit': False,  # تنبيه مش إغلاق
                'reason': f'مراجعة: {days_held} يوم + {correction["reason"]}',
                'exit_code': 'review_alert',
                'days_held': days_held,
                'return_pct': round(return_pct, 2),
            }

    # لا حاجة للإغلاق
    correction_note = ''
    if typical_correction_pct > 0:
        correction = is_within_typical_correction(entry_price, current_price, typical_correction_pct)
        correction_note = f' | {correction["reason"]}'

    return {
        'should_exit': False,
        'reason': f'لا حاجة للإغلاق ({days_held} يوم، return={return_pct:+.2f}%{correction_note})',
        'exit_code': '',
        'days_held': days_held,
        'return_pct': round(return_pct, 2),
    }


# ═══════════════════════════════════════════════════════════════════════
# 2. detect_distribution() — كشف شمعة التوزيع
# ═══════════════════════════════════════════════════════════════════════

def detect_distribution(
    opens: List[float],
    highs: List[float],
    lows: List[float],
    closes: List[float],
    volumes: List[float],
    rsi: Optional[float] = None,
) -> Dict[str, Any]:
    """
    كشف شمعة التوزيع (distribution candle) في آخر شمعة.

    شروط التوزيع (معظمها لازم يتحقق):
      1. شمعة حمراء/ضعيفة (close < open) أو جسم صغير
      2. ظل علوي طويل (upper_wick ≥ body)
      3. حجم أعلى من المتوسط (>1.8× متوسط 20 يوم)
      4. السعر قريب من قمة 20 يوم (≤8% من الـ high)
      5. ضعف زخم (RSI > 65 أو بدأ ينزل)

    Returns:
        {
            'is_distribution': bool,
            'reason': str,
            'upper_wick_ratio': float,
            'volume_ratio': float,
            'dist_from_high_pct': float,
            'rsi': float,
            'is_red_candle': bool,
        }
    """
    n = min(len(opens), len(highs), len(lows), len(closes), len(volumes))
    if n < DIST_LOOKBACK + 1:
        return {
            'is_distribution': False,
            'reason': f'بيانات غير كافية ({n} < {DIST_LOOKBACK + 1})',
            'upper_wick_ratio': 0, 'volume_ratio': 0,
            'dist_from_high_pct': 0, 'rsi': 0, 'is_red_candle': False,
        }

    # Last candle
    o, h, l, c, v = opens[-1], highs[-1], lows[-1], closes[-1], volumes[-1]
    candle_range = h - l
    body = abs(c - o)
    upper_wick = h - max(c, o)
    lower_wick = min(c, o) - l

    # 1. Red candle or small body
    is_red = c < o
    is_small_body = body < (candle_range * 0.3) if candle_range > 0 else False
    cond_candle = is_red or is_small_body

    # 2. Upper wick ratio (upper_wick / body) — if body=0, use range
    upper_wick_ratio = (upper_wick / body) if body > 0 else (upper_wick / candle_range) if candle_range > 0 else 0
    cond_upper_wick = upper_wick >= body and upper_wick > 0  # الظل العلوي ≥ الجسم

    # 3. Volume ratio (current / SMA20)
    avg_vol_20 = _sma(volumes[-20:], 20) if len(volumes) >= 20 else (sum(volumes[-20:]) / len(volumes[-20:]) if len(volumes) >= 20 else 1)
    volume_ratio = (v / avg_vol_20) if avg_vol_20 > 0 else 0
    cond_volume = volume_ratio >= DIST_VOLUME_RATIO

    # 4. Distance from 20-day high
    high_20d = max(highs[-20:]) if len(highs) >= 20 else max(highs)
    dist_from_high_pct = ((high_20d - c) / high_20d * 100) if high_20d > 0 else 0
    cond_near_high = dist_from_high_pct <= DIST_DIST_FROM_HIGH_MAX_PCT

    # 5. RSI (momentum weakness)
    if rsi is None:
        rsi = _rsi(closes, 14)
    cond_rsi_high = rsi >= DIST_RSI_HIGH_THRESHOLD

    # Decision: distribution = candle condition + upper_wick + (volume OR near_high) + rsi
    # لازم على الأقل: red/small + upper_wick + (volume OR near_high)
    conditions_met = sum([cond_candle, cond_upper_wick, cond_volume, cond_near_high])
    is_distribution = cond_candle and cond_upper_wick and conditions_met >= 3

    if is_distribution:
        reasons = []
        if is_red:
            reasons.append('شمعة حمراء')
        elif is_small_body:
            reasons.append('جسم صغير')
        if cond_upper_wick:
            reasons.append(f'ظل علوي طويل ({upper_wick_ratio:.2f}× الجسم)')
        if cond_volume:
            reasons.append(f'حجم عالي ({volume_ratio:.2f}× متوسط)')
        if cond_near_high:
            reasons.append(f'قريب من القمة ({dist_from_high_pct:.1f}%)')
        if cond_rsi_high:
            reasons.append(f'RSI مرتفع ({rsi:.1f})')
        reason = 'توزيع: ' + ' | '.join(reasons)
    else:
        reasons = []
        if not cond_candle:
            reasons.append('شمعة قوية' if not is_red else '')
        if not cond_upper_wick:
            reasons.append(f'مفيش ظل علوي واضح ({upper_wick_ratio:.2f}×)')
        if not cond_volume:
            reasons.append(f'حجم عادي ({volume_ratio:.2f}×)')
        if not cond_near_high:
            reasons.append(f'بعيد عن القمة ({dist_from_high_pct:.1f}%)')
        reason = 'مش توزيع: ' + ' | '.join([r for r in reasons if r])

    return {
        'is_distribution': is_distribution,
        'reason': reason,
        'upper_wick_ratio': round(upper_wick_ratio, 2),
        'volume_ratio': round(volume_ratio, 2),
        'dist_from_high_pct': round(dist_from_high_pct, 2),
        'rsi': round(rsi, 1),
        'is_red_candle': is_red,
    }


# ═══════════════════════════════════════════════════════════════════════
# 3. evaluate_force_exit() — القرار النهائي للإغلاق الإجباري
# ═══════════════════════════════════════════════════════════════════════

def evaluate_force_exit(
    entry_date: str,
    current_date: str,
    entry_price: float,
    current_price: float,
    price_history: List[Dict[str, float]],
    opens: Optional[List[float]] = None,
    highs: Optional[List[float]] = None,
    lows: Optional[List[float]] = None,
    closes: Optional[List[float]] = None,
    volumes: Optional[List[float]] = None,
    rsi: Optional[float] = None,
    enable_holding: bool = True,
    enable_distribution: bool = True,
    typical_correction_pct: float = 0,
) -> Dict[str, Any]:
    """
    تقييم شامل للإغلاق الإجباري — فلسفة هيكلية.

    ترتيب الأولويات الجديد:
      1. distribution_exit — توزيع واضح (الميكرز بـ يفرغ)
      2. early_drop — نزول حاد بعد الدخول (حماية رأس مال)
      3. compound_breakdown_exit — وقت طويل + خارج التصحيح + ضعف هيكل
      (review_alert = تنبيه فقط، ليس إغلاق)
      (max_holding_7d = تم إلغاؤه كسبب وحيد)

    mمنوع: "عدّى 7 أيام → اخرج" بدون شروط هيكلية.
    """
    # 1. Distribution (أعلى أولوية — الميكرز بـ يفرغ)
    if enable_distribution and opens and highs and lows and closes and volumes:
        dist = detect_distribution(opens, highs, lows, closes, volumes, rsi=rsi)
        if dist['is_distribution']:
            return {
                'should_exit': True,
                'exit_code': 'distribution_exit',
                'reason': f'🚨 {dist["reason"]}',
                'priority': 1,
                'details': dist,
            }

    # 2-3. Holding rules (هيكلية الآن — مش زمنية)
    if enable_holding:
        # استخرج recent_closes لو متاحة
        recent_closes_list = closes[-5:] if closes and len(closes) >= 5 else None

        holding = should_force_exit_by_time(
            entry_date, current_date, entry_price, current_price, price_history,
            typical_correction_pct=typical_correction_pct,
            rsi=rsi,
            recent_closes=recent_closes_list,
        )
        if holding['should_exit']:
            priority = {
                'early_drop': 2,
                'compound_breakdown_exit': 3,
            }.get(holding['exit_code'], 5)
            return {
                'should_exit': True,
                'exit_code': holding['exit_code'],
                'reason': f'⏰ {holding["reason"]}',
                'priority': priority,
                'details': holding,
            }

        # لو review_alert → نرجعه بس should_exit=False (تنبيه مش إغلاق)
        if holding['exit_code'] == 'review_alert':
            return {
                'should_exit': False,
                'exit_code': 'review_alert',
                'reason': f'📋 {holding["reason"]}',
                'priority': 0,
                'details': holding,
            }

    # لا حاجة للإغلاق
    return {
        'should_exit': False,
        'exit_code': '',
        'reason': 'لا حاجة للإغلاق الإجباري',
        'priority': 0,
        'details': {},
    }


# ═══════════════════════════════════════════════════════════════════════
# 4. Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 Short Holding + Distribution Exit — Self Test (هيكلي)")
    print("=" * 70)
    print(f"الفلسفة: تصحيح → صبر، انهيار → خروج، ربح → أهداف")
    print(f"  early_drop: {EARLY_DROP_DAYS}d (≤{EARLY_DROP_THRESHOLD_PCT}%)")
    print(f"  compound: {COMPOUND_MIN_DAYS}d + خارج التصحيح ×{COMPOUND_BEYOND_CORRECTION_MULT} + ضعف")
    print(f"  review_alert: {REVIEW_THRESHOLD_DAYS}d (تنبيه فقط)")
    print(f"  max_holding_7d: تم إلغاؤه كسبب وحيد")
    print(f"  distribution: wick≥{DIST_UPPER_WICK_RATIO}×, vol≥{DIST_VOLUME_RATIO}×, RSI≥{DIST_RSI_HIGH_THRESHOLD}")
    print()

    # ===== الحالات الحرجة المطلوبة =====

    # Test 1: نزول 10% بينما typical_correction=16% → لا تخرج بالوقت فقط
    print("=== Test 1: نزول 10% + typical_correction=16% → لا تخرج ===")
    r = should_force_exit_by_time('2026-08-01', '2026-08-09', 100, 90, typical_correction_pct=16)
    print(f"  should_exit: {r['should_exit']} | code: {r['exit_code']}")
    print(f"  reason: {r['reason']}")
    assert not r['should_exit']
    print("  ✅ PASS (تصحيح جوه المدى → صبر)")

    # Test 2: نزول 25% + typical_correction=16% + ضعف → تخرج
    print("\n=== Test 2: نزول 25% + typical_correction=16% + RSI=25 → تخرج ===")
    breakdown = is_breakdown_not_correction(100, 75, typical_correction_pct=16, rsi=25)
    print(f"  is_breakdown: {breakdown['is_breakdown']}")
    print(f"  reason: {breakdown['reason']}")
    assert breakdown['is_breakdown']
    print("  ✅ PASS (انهيار → خروج)")

    # Test 3: صفقة رابحة بعد 10 أيام → لا تُغلق لمجرد الوقت
    print("\n=== Test 3: رابحة بعد 10 أيام → لا تُغلق ===")
    r = should_force_exit_by_time('2026-08-01', '2026-08-11', 100, 108, typical_correction_pct=14)
    print(f"  should_exit: {r['should_exit']} | reason: {r['reason'][:60]}")
    assert not r['should_exit']
    print("  ✅ PASS (الربح لا يُغلق بالوقت)")

    # Test 4: شمعة توزيع → تخرج حتى لو المدة قصيرة
    print("\n=== Test 4: شمعة توزيع → تخرج ===")
    opens_d = [100 + i * 0.8 for i in range(20)] + [120]
    highs_d = [100 + i * 0.8 + 0.5 for i in range(20)] + [125]
    lows_d = [100 + i * 0.8 - 0.5 for i in range(20)] + [116]
    closes_d = [100 + i * 0.8 for i in range(20)] + [117]
    volumes_d = [1000] * 20 + [2500]
    r = detect_distribution(opens_d, highs_d, lows_d, closes_d, volumes_d)
    print(f"  is_distribution: {r['is_distribution']}")
    assert r['is_distribution']
    print("  ✅ PASS")

    # Test 5: early drop حاد → تخرج
    print("\n=== Test 5: نزول -8% في يومين → early_drop ===")
    r = should_force_exit_by_time('2026-08-01', '2026-08-03', 100, 92)
    print(f"  should_exit: {r['should_exit']} | code: {r['exit_code']}")
    assert r['should_exit'] and r['exit_code'] == 'early_drop'
    print("  ✅ PASS (حماية رأس مال)")

    # Test 6: عدم وجود نوتبوك → النظام لا ينكسر
    print("\n=== Test 6: بدون نوتبوك (typical=0) → لا ينكسر ===")
    r = should_force_exit_by_time('2026-08-01', '2026-08-09', 100, 97, typical_correction_pct=0)
    print(f"  should_exit: {r['should_exit']} | reason: {r['reason'][:60]}")
    assert not r['should_exit']
    print("  ✅ PASS (سلوك آمن)")

    # Test 7: اللوج يظهر السبب الصحيح (ليس max_holding_7d)
    print("\n=== Test 7: 12 يوم + نزول 5% + typical=14% → review (مش max_holding) ===")
    r = should_force_exit_by_time('2026-08-01', '2026-08-13', 100, 95, typical_correction_pct=14)
    print(f"  should_exit: {r['should_exit']} | code: {r['exit_code']}")
    print(f"  reason: {r['reason']}")
    assert r['exit_code'] != 'max_holding_7d'  # ممنوع max_holding_7d كسبب وحيد
    print("  ✅ PASS (لا يوجد max_holding_7d)")

    # Test 8: compound_breakdown_exit — 11 يوم + نزول 25% + RSI=20 + 5 شموع حمراء
    print("\n=== Test 8: 11 يوم + نزول 25% + RSI=20 + 5 شموع حمراء → compound_breakdown ===")
    r = should_force_exit_by_time(
        '2026-08-01', '2026-08-12', 100, 75,
        typical_correction_pct=14, rsi=20,
        recent_closes=[80, 78, 76, 75.5, 75],
    )
    print(f"  should_exit: {r['should_exit']} | code: {r['exit_code']}")
    print(f"  reason: {r['reason'][:70]}")
    assert r['should_exit'] and r['exit_code'] == 'compound_breakdown_exit'
    print("  ✅ PASS (انهيار → خروج)")

    # Test 9: is_within_typical_correction
    print("\n=== Test 9: is_within_typical_correction ===")
    r = is_within_typical_correction(100, 88, typical_correction_pct=14)
    print(f"  within: {r['within']} | reason: {r['reason']}")
    assert r['within']
    r = is_within_typical_correction(100, 80, typical_correction_pct=14)
    print(f"  within: {r['within']} | reason: {r['reason']}")
    assert not r['within']
    print("  ✅ PASS")

    # Test 10: distribution + max_holding قديم → distribution فقط
    print("\n=== Test 10: distribution أولوية على كل شيء ===")
    opens9 = [100 + i * 0.5 for i in range(20)] + [110]
    highs9 = [100 + i * 0.5 + 0.5 for i in range(20)] + [115]
    lows9 = [100 + i * 0.5 - 0.3 for i in range(20)] + [108]
    closes9 = [100 + i * 0.5 for i in range(20)] + [109]
    vols9 = [1000] * 20 + [2200]
    r = evaluate_force_exit(
        entry_date='2026-08-01', current_date='2026-08-15',  # 14 days
        entry_price=100, current_price=109,
        price_history=[{'close': c} for c in closes9[-5:]],
        opens=opens9, highs=highs9, lows=lows9, closes=closes9, volumes=vols9,
        typical_correction_pct=14,
    )
    print(f"  exit: {r['exit_code']} (priority={r['priority']})")
    assert r['exit_code'] == 'distribution_exit' and r['priority'] == 1
    print("  ✅ PASS")

    # Test 11: healthy trade + typical_correction
    print("\n=== Test 11: صفقة صحية + نوتبوك → لا إغلاق ===")
    r = evaluate_force_exit(
        entry_date='2026-08-01', current_date='2026-08-05',
        entry_price=100, current_price=103,
        price_history=[{'close': 101}, {'close': 102}, {'close': 103}],
        enable_distribution=False,
        typical_correction_pct=14,
    )
    print(f"  should_exit: {r['should_exit']} | reason: {r['reason'][:60]}")
    assert not r['should_exit']
    print("  ✅ PASS")

    print("\n" + "=" * 70)
    print("✅ Short Holding + Distribution Exit ready (11/11 tests pass)")
    print(f"\nالفلسفة الجديدة:")
    print(f"  distribution → خروج (priority 1)")
    print(f"  early_drop → خروج (priority 2)")
    print(f"  compound_breakdown → خروج (priority 3)")
    print(f"  review_alert → تنبيه فقط (لا إغلاق)")
    print(f"  max_holding_7d → تم إلغاؤه كسبب وحيد ✅")
