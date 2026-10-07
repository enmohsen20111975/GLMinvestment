#!/usr/bin/env python3
"""
Crypto Short Holding + Distribution Exit — للعملات الرقمية
============================================================
تطبيق القواعد 38 + 39 على الكريبتو بـ thresholds مكيّفة لـ 24/7.

الفرق عن الأسهم:
  - مدة الاحتفاظ بالساعات (24/7 — مش أيام bounded بجلسة)
  - التقلب أعلى → no_move threshold أعلى
  - distribution candle: ظل علوي أطول (crypto أكثر تقلباً)

Thresholds (Crypto-calibrated):
  - max_holding_hours = 72 (3 أيام — vs 7 أيام stocks)
  - no_move_hours = 24 (يوم كامل بدون +5%)
  - early_drop_hours = 24 (نزول -8% في 24 ساعة — vs -5%)
  - distribution: upper_wick ≥ 1.2× body, vol ≥ 2.0×, near_high ≤ 12%, RSI ≥ 72

Author: Z.ai Code
Date: 2026-09-01
"""

from __future__ import annotations
import math
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta


# ═══════════════════════════════════════════════════════════════════════
# Config (Crypto-calibrated — 24/7 + تقلب أعلى)
# ═══════════════════════════════════════════════════════════════════════

MAX_HOLDING_HOURS = 72
NO_MOVE_HOURS = 24
NO_MOVE_THRESHOLD_PCT = 5.0
EARLY_DROP_HOURS = 24
EARLY_DROP_THRESHOLD_PCT = -8.0

DIST_UPPER_WICK_RATIO = 1.2
DIST_VOLUME_RATIO = 2.0
DIST_DIST_FROM_HIGH_MAX_PCT = 12.0
DIST_RSI_HIGH_THRESHOLD = 72.0
DIST_LOOKBACK = 24


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

def _sma(values: List[float], period: int) -> float:
    if len(values) < period:
        return sum(values) / len(values) if values else 0.0
    return sum(values[-period:]) / period


def _rsi(closes: List[float], period: int = 14) -> float:
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


def _no_exit(reason: str) -> Dict[str, Any]:
    return {
        'should_exit': False,
        'reason': reason,
        'exit_code': '',
        'hours_held': 0,
        'return_pct': 0,
    }


# ═══════════════════════════════════════════════════════════════════════
# 1. should_force_exit_by_time() — مدة الاحتفاظ (بالساعات)
# ═══════════════════════════════════════════════════════════════════════

def should_force_exit_by_time(
    entry_time: str,
    current_time: str,
    entry_price: float,
    current_price: float,
    price_history: Optional[List[Dict[str, float]]] = None,
) -> Dict[str, Any]:
    """
    فحص هل لازم إغلاق إجباري بناءً على مدة الاحتفاظ (بالساعات).

    Args:
        entry_time: YYYY-MM-DD HH:MM or YYYY-MM-DD
        current_time: نفس الصيغة
        entry_price, current_price: الأسعار
        price_history: قائمة آخر N شمعة [{'close': ...}]
    """
    try:
        try:
            entry_dt = datetime.strptime(entry_time[:16], '%Y-%m-%d %H:%M')
        except ValueError:
            entry_dt = datetime.strptime(entry_time[:10], '%Y-%m-%d')
        try:
            current_dt = datetime.strptime(current_time[:16], '%Y-%m-%d %H:%M')
        except ValueError:
            current_dt = datetime.strptime(current_time[:10], '%Y-%m-%d')
    except (ValueError, TypeError):
        return _no_exit('تواريخ غير صالحة')

    hours_held = (current_dt - entry_dt).total_seconds() / 3600.0
    if hours_held < 0:
        hours_held = 0

    return_pct = ((current_price - entry_price) / entry_price * 100) if entry_price > 0 else 0

    # 1. Max holding 72 hours
    if hours_held >= MAX_HOLDING_HOURS:
        return {
            'should_exit': True,
            'reason': f'تجاوز الحد الأقصى للاحتفاظ ({hours_held:.1f}h ≥ {MAX_HOLDING_HOURS}h)',
            'exit_code': 'max_holding_hours',
            'hours_held': round(hours_held, 1),
            'return_pct': round(return_pct, 2),
        }

    # 2. Early drop (first 24 hours, -8%)
    if hours_held <= EARLY_DROP_HOURS and return_pct <= EARLY_DROP_THRESHOLD_PCT:
        return {
            'should_exit': True,
            'reason': f'نزول مبكر {return_pct:+.2f}% في {hours_held:.1f}h (≤ {EARLY_DROP_THRESHOLD_PCT}%)',
            'exit_code': 'early_drop',
            'hours_held': round(hours_held, 1),
            'return_pct': round(return_pct, 2),
        }

    # 3. No move (24 hours, < +5%)
    if hours_held >= NO_MOVE_HOURS and price_history:
        recent = price_history[-NO_MOVE_HOURS:] if len(price_history) >= NO_MOVE_HOURS else price_history
        recent_closes = [float(d.get('close', 0) or 0) for d in recent if float(d.get('close', 0) or 0) > 0]
        if len(recent_closes) >= 6:
            max_close = max(recent_closes)
            max_gain_pct = ((max_close - entry_price) / entry_price * 100) if entry_price > 0 else 0
            if max_gain_pct < NO_MOVE_THRESHOLD_PCT:
                return {
                    'should_exit': True,
                    'reason': f'لا حركة: أقصى ارتفاع {max_gain_pct:+.2f}% في {NO_MOVE_HOURS}h (< {NO_MOVE_THRESHOLD_PCT}%)',
                    'exit_code': 'no_move_hours',
                    'hours_held': round(hours_held, 1),
                    'return_pct': round(return_pct, 2),
                }

    return _no_exit(f'{hours_held:.1f}h, return={return_pct:+.2f}%')


# ═══════════════════════════════════════════════════════════════════════
# 2. detect_crypto_distribution() — كشف شمعة التوزيع
# ═══════════════════════════════════════════════════════════════════════

def detect_crypto_distribution(
    opens: List[float],
    highs: List[float],
    lows: List[float],
    closes: List[float],
    volumes: List[float],
    rsi: Optional[float] = None,
) -> Dict[str, Any]:
    """
    كشف شمعة التوزيع في الكريبتو (crypto-calibrated).

    الشروط:
      1. شمعة حمراء/ضعيفة (close < open أو جسم صغير)
      2. ظل علوي طويل (upper_wick ≥ 1.2× body)
      3. حجم عالي (≥ 2.0× متوسط 24 ساعة)
      4. قريب من قمة 24 ساعة (≤12%)
      5. RSI مرتفع (>72)
    """
    n = min(len(opens), len(highs), len(lows), len(closes), len(volumes))
    if n < DIST_LOOKBACK + 1:
        return {
            'is_distribution': False,
            'reason': f'بيانات غير كافية ({n} < {DIST_LOOKBACK + 1})',
            'upper_wick_ratio': 0, 'volume_ratio': 0,
            'dist_from_high_pct': 0, 'rsi': 0, 'is_red_candle': False,
        }

    o, h, l, c, v = opens[-1], highs[-1], lows[-1], closes[-1], volumes[-1]
    candle_range = h - l
    body = abs(c - o)
    upper_wick = h - max(c, o)

    is_red = c < o
    is_small_body = body < (candle_range * 0.3) if candle_range > 0 else False
    cond_candle = is_red or is_small_body

    upper_wick_ratio = (upper_wick / body) if body > 0 else (upper_wick / candle_range) if candle_range > 0 else 0
    cond_upper_wick = upper_wick >= (body * DIST_UPPER_WICK_RATIO) and upper_wick > 0

    avg_vol_24 = _sma(volumes[-24:], 24) if len(volumes) >= 24 else (sum(volumes[-24:]) / len(volumes[-24:]) if len(volumes) >= 24 else 1)
    volume_ratio = (v / avg_vol_24) if avg_vol_24 > 0 else 0
    cond_volume = volume_ratio >= DIST_VOLUME_RATIO

    high_24d = max(highs[-24:]) if len(highs) >= 24 else max(highs)
    dist_from_high_pct = ((high_24d - c) / high_24d * 100) if high_24d > 0 else 0
    cond_near_high = dist_from_high_pct <= DIST_DIST_FROM_HIGH_MAX_PCT

    if rsi is None:
        rsi = _rsi(closes, 14)
    cond_rsi_high = rsi >= DIST_RSI_HIGH_THRESHOLD

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
            reasons.append(f'حجم عالي ({volume_ratio:.2f}×)')
        if cond_near_high:
            reasons.append(f'قريب من القمة ({dist_from_high_pct:.1f}%)')
        if cond_rsi_high:
            reasons.append(f'RSI مرتفع ({rsi:.1f})')
        reason = 'توزيع كريبتو: ' + ' | '.join(reasons)
    else:
        reasons = []
        if not cond_candle:
            reasons.append('شمعة قوية')
        if not cond_upper_wick:
            reasons.append(f'مفيش ظل علوي واضح ({upper_wick_ratio:.2f}×)')
        if not cond_volume:
            reasons.append(f'حجم عادي ({volume_ratio:.2f}×)')
        if not cond_near_high:
            reasons.append(f'بعيد عن القمة ({dist_from_high_pct:.1f}%)')
        reason = 'مش توزيع: ' + ' | '.join(reasons)

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
# 3. evaluate_crypto_force_exit() — القرار النهائي
# ═══════════════════════════════════════════════════════════════════════

def evaluate_crypto_force_exit(
    entry_time: str,
    current_time: str,
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
) -> Dict[str, Any]:
    """
    تقييم شامل للإغلاق الإجباري بترتيب الأولوية:
      1. distribution_exit (priority=1) — الميكرز بـ يفرغ
      2. max_holding_hours (priority=2) — تجاوز 72 ساعة
      3. no_move_hours (priority=3) — السهم نام
      4. early_drop (priority=4) — نزول بدري
    """
    # 1. Distribution (highest priority)
    if enable_distribution and opens and highs and lows and closes and volumes:
        dist = detect_crypto_distribution(opens, highs, lows, closes, volumes, rsi=rsi)
        if dist['is_distribution']:
            return {
                'should_exit': True,
                'exit_code': 'distribution_exit',
                'reason': f'🚨 {dist["reason"]}',
                'priority': 1,
                'details': dist,
            }

    # 2-4. Holding rules
    if enable_holding:
        holding = should_force_exit_by_time(
            entry_time, current_time, entry_price, current_price, price_history
        )
        if holding['should_exit']:
            priority = {
                'max_holding_hours': 2,
                'no_move_hours': 3,
                'early_drop': 4,
            }.get(holding['exit_code'], 5)
            return {
                'should_exit': True,
                'exit_code': holding['exit_code'],
                'reason': f'⏰ {holding["reason"]}',
                'priority': priority,
                'details': holding,
            }

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
    print("🧪 Crypto Short Holding + Distribution Exit — Self Test")
    print("=" * 70)
    print(f"Thresholds (Crypto 24/7):")
    print(f"  Holding: max={MAX_HOLDING_HOURS}h, no_move={NO_MOVE_HOURS}h (≤{NO_MOVE_THRESHOLD_PCT}%), "
          f"early_drop={EARLY_DROP_HOURS}h (≤{EARLY_DROP_THRESHOLD_PCT}%)")
    print(f"  Distribution: upper_wick≥{DIST_UPPER_WICK_RATIO}×body, vol≥{DIST_VOLUME_RATIO}×, "
          f"near_high≤{DIST_DIST_FROM_HIGH_MAX_PCT}%, RSI≥{DIST_RSI_HIGH_THRESHOLD}")
    print()

    # Test 1: 80 hours → max_holding_hours
    print("=== Test 1: 80 ساعة → force exit ===")
    r = should_force_exit_by_time('2026-09-01 10:00', '2026-09-04 18:00', 50000, 51000)
    print(f"  should_exit: {r['should_exit']} | code: {r['exit_code']}")
    print(f"  reason: {r['reason']}")
    assert r['should_exit'] and r['exit_code'] == 'max_holding_hours'
    print("  ✅ PASS")

    # Test 2: 30 hours + no move → no_move_hours
    print("\n=== Test 2: 30 ساعة + مفيش حركة → force exit ===")
    price_history = [{'close': 50500}, {'close': 51000}, {'close': 50800},
                     {'close': 51000}, {'close': 50900}, {'close': 51000}] * 5
    r = should_force_exit_by_time('2026-09-01 10:00', '2026-09-02 16:00', 50000, 51000, price_history)
    print(f"  should_exit: {r['should_exit']} | code: {r['exit_code']}")
    print(f"  reason: {r['reason']}")
    assert r['should_exit'] and r['exit_code'] == 'no_move_hours'
    print("  ✅ PASS")

    # Test 3: 12 hours + -10% → early_drop
    print("\n=== Test 3: نزل -10% في 12 ساعة → early_drop ===")
    r = should_force_exit_by_time('2026-09-01 10:00', '2026-09-01 22:00', 50000, 45000)
    print(f"  should_exit: {r['should_exit']} | code: {r['exit_code']}")
    print(f"  reason: {r['reason']}")
    assert r['should_exit'] and r['exit_code'] == 'early_drop'
    print("  ✅ PASS")

    # Test 4: 10 hours + strong move → keep open
    print("\n=== Test 4: 10 ساعات + حركة قوية → تفضل مفتوحة ===")
    r = should_force_exit_by_time('2026-09-01 10:00', '2026-09-01 20:00', 50000, 56000)
    print(f"  should_exit: {r['should_exit']} | reason: {r['reason']}")
    assert not r['should_exit']
    print("  ✅ PASS")

    # Test 5: Distribution candle
    print("\n=== Test 5: شمعة توزيع كريبتو ===")
    opens_d = [50000 + i * 200 for i in range(25)] + [55000]
    highs_d = [50000 + i * 200 + 100 for i in range(25)] + [58000]
    lows_d = [50000 + i * 200 - 100 for i in range(25)] + [54000]
    closes_d = [50000 + i * 200 for i in range(25)] + [54500]
    volumes_d = [1000] * 25 + [3000]
    r = detect_crypto_distribution(opens_d, highs_d, lows_d, closes_d, volumes_d)
    print(f"  is_distribution: {r['is_distribution']}")
    print(f"  upper_wick_ratio: {r['upper_wick_ratio']}× | volume_ratio: {r['volume_ratio']}×")
    print(f"  reason: {r['reason']}")
    assert r['is_distribution']
    print("  ✅ PASS")

    # Test 6: Strong green candle — NOT distribution
    print("\n=== Test 6: شمعة خضراء قوية ===")
    opens6 = [50000 + i * 200 for i in range(25)] + [55000]
    highs6 = [50000 + i * 200 + 100 for i in range(25)] + [57000]
    lows6 = [50000 + i * 200 - 100 for i in range(25)] + [54900]
    closes6 = [50000 + i * 200 for i in range(25)] + [56500]
    volumes6 = [1000] * 26
    r6 = detect_crypto_distribution(opens6, highs6, lows6, closes6, volumes6)
    print(f"  is_distribution: {r6['is_distribution']} | is_red: {r6['is_red_candle']}")
    assert not r6['is_distribution']
    print("  ✅ PASS")

    # Test 7: evaluate — distribution priority
    print("\n=== Test 7: distribution أولوية على max_holding ===")
    closes7 = [50000 + i * 200 for i in range(25)] + [54500]
    opens7 = [50000 + i * 200 for i in range(25)] + [55000]
    highs7 = [50000 + i * 200 + 100 for i in range(25)] + [58000]
    lows7 = [50000 + i * 200 - 100 for i in range(25)] + [54000]
    vols7 = [1000] * 26
    r7 = evaluate_crypto_force_exit(
        entry_time='2026-09-01 10:00',
        current_time='2026-09-04 18:00',
        entry_price=50000, current_price=54500,
        price_history=[{'close': c} for c in closes7[-10:]],
        opens=opens7, highs=highs7, lows=lows7, closes=closes7, volumes=vols7,
    )
    print(f"  Exit: {r7['exit_code']} (priority={r7['priority']})")
    assert r7['exit_code'] == 'distribution_exit' and r7['priority'] == 1
    print("  ✅ PASS")

    print("\n" + "=" * 70)
    print("✅ Crypto Short Holding + Distribution Exit ready (7/7 tests pass)")
