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


# ═══════════════════════════════════════════════════════════════════════
# Config (thresholds — EGX-calibrated)
# ═══════════════════════════════════════════════════════════════════════

# Holding rules
MAX_HOLDING_DAYS = 7              # الحد الأقصى للاحتفاظ
NO_MOVE_DAYS = 3                  # فحص الحركة في أول 3 أيام
NO_MOVE_THRESHOLD_PCT = 3.0       # لو متحركش +3% في 3 أيام → خروج
EARLY_DROP_DAYS = 3               # فحص النزول في أول 3 أيام
EARLY_DROP_THRESHOLD_PCT = -5.0   # لو نزل -5% في 3 أيام → خروج

# Distribution detection
DIST_UPPER_WICK_RATIO = 1.0       # الظل العلوي ≥ الجسم
DIST_VOLUME_RATIO = 1.8           # الحجم ≥ 1.8× متوسط 20 يوم
DIST_DIST_FROM_HIGH_MAX_PCT = 8.0 # قريب من قمة 20 يوم (≤8%)
DIST_RSI_HIGH_THRESHOLD = 65.0    # RSI مرتفع أو بـ ينزل من >65
DIST_LOOKBACK = 20                # فحص آخر 20 يوم


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
# 1. should_force_exit_by_time() — فحص مدة الاحتفاظ
# ═══════════════════════════════════════════════════════════════════════

def should_force_exit_by_time(
    entry_date: str,
    current_date: str,
    entry_price: float,
    current_price: float,
    price_history: Optional[List[Dict[str, float]]] = None,
) -> Dict[str, Any]:
    """
    فحص هل لازم إغلاق إجباري بناءً على مدة الاحتفاظ.

    Args:
        entry_date: تاريخ الدخول (YYYY-MM-DD)
        current_date: التاريخ الحالي (YYYY-MM-DD)
        entry_price: سعر الدخول
        current_price: السعر الحالي
        price_history: قائمة أيام الأسعار [{date, high, low, close, open, volume}]
                       (آخر N يوم — للـ no_move check)

    Returns:
        {
            'should_exit': bool,
            'reason': str (سبب الخروج أو "no exit needed"),
            'exit_code': str ('max_holding_7d' | 'no_move_3d' | 'early_drop' | ''),
            'days_held': int,
            'return_pct': float,
        }
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

    # 1. Max holding 7 days
    if days_held >= MAX_HOLDING_DAYS:
        return {
            'should_exit': True,
            'reason': f'تجاوز الحد الأقصى للاحتفاظ ({days_held} ≥ {MAX_HOLDING_DAYS} يوم)',
            'exit_code': 'max_holding_7d',
            'days_held': days_held,
            'return_pct': round(return_pct, 2),
        }

    # 2. Early drop (first 3 days, -5%)
    if days_held <= EARLY_DROP_DAYS and return_pct <= EARLY_DROP_THRESHOLD_PCT:
        return {
            'should_exit': True,
            'reason': f'نزول مبكر {return_pct:+.2f}% في {days_held} يوم (≤ {EARLY_DROP_THRESHOLD_PCT}%)',
            'exit_code': 'early_drop',
            'days_held': days_held,
            'return_pct': round(return_pct, 2),
        }

    # 3. No move (3 days, < +3%)
    if days_held >= NO_MOVE_DAYS and price_history and len(price_history) >= NO_MOVE_DAYS:
        # Get the closes of the last NO_MOVE_DAYS days
        recent_closes = [float(d.get('close', 0) or 0) for d in price_history[-NO_MOVE_DAYS:]]
        if len(recent_closes) >= NO_MOVE_DAYS and all(c > 0 for c in recent_closes):
            # Check max gain from entry in these days
            max_close = max(recent_closes)
            max_gain_pct = ((max_close - entry_price) / entry_price * 100) if entry_price > 0 else 0
            if max_gain_pct < NO_MOVE_THRESHOLD_PCT:
                return {
                    'should_exit': True,
                    'reason': f'لا حركة: أقصى ارتفاع {max_gain_pct:+.2f}% في {NO_MOVE_DAYS} أيام (< {NO_MOVE_THRESHOLD_PCT}%)',
                    'exit_code': 'no_move_3d',
                    'days_held': days_held,
                    'return_pct': round(return_pct, 2),
                }

    # No exit needed
    return {
        'should_exit': False,
        'reason': f'لا حاجة للإغلاق ({days_held} يوم، return={return_pct:+.2f}%)',
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
) -> Dict[str, Any]:
    """
    تقييم شامل للإغلاق الإجباري بترتيب الأولوية:

    1. Distribution مكتشف → distribution_exit
    2. Max Holding 7 أيام → max_holding_7d
    3. No Move 3 أيام → no_move_3d
    4. Early Drop → early_drop

    (Disclosure VETO بـ يتعامل معاه في V40.2 قبل ما نوصل هنا)

    Returns:
        {
            'should_exit': bool,
            'exit_code': str,
            'reason': str,
            'priority': int,  # 1=distribution, 2=max_holding, 3=no_move, 4=early_drop
        }
    """
    # 1. Distribution (highest priority — الميكرز بـ يفرغ)
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

    # 2-4. Holding rules (max_holding + no_move + early_drop)
    if enable_holding:
        holding = should_force_exit_by_time(
            entry_date, current_date, entry_price, current_price, price_history
        )
        if holding['should_exit']:
            priority = {
                'max_holding_7d': 2,
                'no_move_3d': 3,
                'early_drop': 4,
            }.get(holding['exit_code'], 5)
            return {
                'should_exit': True,
                'exit_code': holding['exit_code'],
                'reason': f'⏰ {holding["reason"]}',
                'priority': priority,
                'details': holding,
            }

    # No exit needed
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
    print("🧪 Short Holding + Distribution Exit — Self Test")
    print("=" * 70)
    print(f"Thresholds:")
    print(f"  Holding: max={MAX_HOLDING_DAYS}d, no_move={NO_MOVE_DAYS}d (≤{NO_MOVE_THRESHOLD_PCT}%), "
          f"early_drop={EARLY_DROP_DAYS}d (≤{EARLY_DROP_THRESHOLD_PCT}%)")
    print(f"  Distribution: upper_wick≥{DIST_UPPER_WICK_RATIO}×body, vol≥{DIST_VOLUME_RATIO}×, "
          f"near_high≤{DIST_DIST_FROM_HIGH_MAX_PCT}%, RSI≥{DIST_RSI_HIGH_THRESHOLD}")
    print()

    # ===== Holding Tests =====
    print("━━━ Phase 1: Holding Rules ━━━")

    # Test 1: 8 days → force exit (max_holding_7d)
    print("\n=== Test 1: صفقة عمرها 8 أيام → force exit ===")
    r = should_force_exit_by_time('2026-08-01', '2026-08-09', 100, 101)
    print(f"  should_exit: {r['should_exit']} | code: {r['exit_code']}")
    print(f"  reason: {r['reason']}")
    assert r['should_exit'] and r['exit_code'] == 'max_holding_7d'
    print("  ✅ PASS")

    # Test 2: 4 days + no move → force exit (no_move_3d)
    print("\n=== Test 2: 4 أيام + مفيش حركة → force exit ===")
    price_history = [
        {'date': '2026-08-02', 'close': 100.5},
        {'date': '2026-08-03', 'close': 101},
        {'date': '2026-08-04', 'close': 100.8},
        {'date': '2026-08-05', 'close': 101},  # max gain +1% (< 3%)
    ]
    r = should_force_exit_by_time('2026-08-01', '2026-08-05', 100, 101, price_history)
    print(f"  should_exit: {r['should_exit']} | code: {r['exit_code']}")
    print(f"  reason: {r['reason']}")
    assert r['should_exit'] and r['exit_code'] == 'no_move_3d'
    print("  ✅ PASS")

    # Test 3: 2 days + strong move → keep open
    print("\n=== Test 3: 2 يوم + حركة قوية → تفضل مفتوحة ===")
    price_history2 = [
        {'date': '2026-08-02', 'close': 105},
        {'date': '2026-08-03', 'close': 108},
    ]
    r = should_force_exit_by_time('2026-08-01', '2026-08-03', 100, 108, price_history2)
    print(f"  should_exit: {r['should_exit']} | reason: {r['reason']}")
    assert not r['should_exit']
    print("  ✅ PASS (لا زال مفتوح)")

    # Test 4: 2 days + -6% → force exit (early_drop)
    print("\n=== Test 4: نزل -6% في يومين → force exit ===")
    r = should_force_exit_by_time('2026-08-01', '2026-08-03', 100, 94)
    print(f"  should_exit: {r['should_exit']} | code: {r['exit_code']}")
    print(f"  reason: {r['reason']}")
    assert r['should_exit'] and r['exit_code'] == 'early_drop'
    print("  ✅ PASS")

    # Test 5: 5 days + small gain but not enough → no_move
    print("\n=== Test 5: 5 أيام + حركة +2% بس → no_move ===")
    price_history3 = [
        {'date': '2026-08-02', 'close': 100.5},
        {'date': '2026-08-03', 'close': 101},
        {'date': '2026-08-04', 'close': 101.5},
        {'date': '2026-08-05', 'close': 102},
        {'date': '2026-08-06', 'close': 102},  # max +2% (< 3%)
    ]
    r = should_force_exit_by_time('2026-08-01', '2026-08-06', 100, 102, price_history3)
    print(f"  should_exit: {r['should_exit']} | code: {r['exit_code']}")
    print(f"  reason: {r['reason']}")
    assert r['should_exit'] and r['exit_code'] == 'no_move_3d'
    print("  ✅ PASS")

    # ===== Distribution Tests =====
    print("\n━━━ Phase 2: Distribution Detection ━━━")

    # Test 6: Distribution candle (red + upper wick + high volume + near high)
    print("\n=== Test 6: شمعة توزيع واضحة (ظل علوي + حجم عالي + قرب قمة) ===")
    # Build 21 days: gentle uptrend to 120, then distribution candle
    opens_d = [100 + i * 0.8 for i in range(20)] + [120]
    highs_d = [100 + i * 0.8 + 0.5 for i in range(20)] + [125]  # upper wick to 125
    lows_d = [100 + i * 0.8 - 0.5 for i in range(20)] + [116]   # low at 116
    closes_d = [100 + i * 0.8 for i in range(20)] + [117]  # red candle, close below open
    volumes_d = [1000] * 20 + [2500]  # volume spike 2.5×
    r = detect_distribution(opens_d, highs_d, lows_d, closes_d, volumes_d)
    print(f"  is_distribution: {r['is_distribution']}")
    print(f"  upper_wick_ratio: {r['upper_wick_ratio']}× | volume_ratio: {r['volume_ratio']}×")
    print(f"  dist_from_high: {r['dist_from_high_pct']}% | RSI: {r['rsi']}")
    print(f"  reason: {r['reason']}")
    assert r['is_distribution']
    print("  ✅ PASS")

    # Test 7: Normal red candle (no upper wick, no volume) — NOT distribution
    print("\n=== Test 7: شمعة حمراء عادية (مش توزيع) ===")
    opens7 = [100 + i * 0.5 for i in range(20)] + [110]
    highs7 = [100 + i * 0.5 + 0.3 for i in range(20)] + [110.5]  # small wick
    lows7 = [100 + i * 0.5 - 0.3 for i in range(20)] + [107]
    closes7 = [100 + i * 0.5 for i in range(20)] + [108]  # red
    volumes7 = [1000] * 21  # normal volume
    r = detect_distribution(opens7, highs7, lows7, closes7, volumes7)
    print(f"  is_distribution: {r['is_distribution']}")
    print(f"  upper_wick_ratio: {r['upper_wick_ratio']}× | volume_ratio: {r['volume_ratio']}×")
    print(f"  reason: {r['reason']}")
    assert not r['is_distribution']
    print("  ✅ PASS (مش توزيع)")

    # Test 8: Strong green candle — NOT distribution
    print("\n=== Test 8: شمعة خضراء قوية (مش توزيع) ===")
    opens8 = [100 + i * 0.5 for i in range(20)] + [110]
    highs8 = [100 + i * 0.5 + 0.5 for i in range(20)] + [115]
    lows8 = [100 + i * 0.5 - 0.3 for i in range(20)] + [109.5]
    closes8 = [100 + i * 0.5 for i in range(20)] + [114]  # strong green
    volumes8 = [1000] * 20 + [2500]  # even with high volume
    r = detect_distribution(opens8, highs8, lows8, closes8, volumes8)
    print(f"  is_distribution: {r['is_distribution']}")
    print(f"  is_red: {r['is_red_candle']} | reason: {r['reason'][:60]}...")
    assert not r['is_distribution']
    print("  ✅ PASS (شمعة خضراء قوية)")

    # Test 9: evaluate_force_exit — distribution priority
    print("\n=== Test 9: Distribution أولوية على max_holding ===")
    # 8 days (max_holding) + distribution candle
    opens9 = [100 + i * 0.5 for i in range(20)] + [110]
    highs9 = [100 + i * 0.5 + 0.5 for i in range(20)] + [115]
    lows9 = [100 + i * 0.5 - 0.3 for i in range(20)] + [108]
    closes9 = [100 + i * 0.5 for i in range(20)] + [109]
    volumes9 = [1000] * 20 + [2200]
    r = evaluate_force_exit(
        entry_date='2026-08-01',
        current_date='2026-08-09',  # 8 days
        entry_price=100,
        current_price=109,
        price_history=[{'close': c} for c in closes9[-5:]],
        opens=opens9, highs=highs9, lows=lows9, closes=closes9, volumes=volumes9,
    )
    print(f"  should_exit: {r['should_exit']} | code: {r['exit_code']} | priority: {r['priority']}")
    print(f"  reason: {r['reason'][:80]}...")
    assert r['should_exit'] and r['exit_code'] == 'distribution_exit' and r['priority'] == 1
    print("  ✅ PASS (distribution wins over max_holding)")

    # Test 10: max_holding priority over no_move
    print("\n=== Test 10: max_holding أولوية على no_move ===")
    price_history10 = [{'close': 100.5}, {'close': 101}, {'close': 100.8}, {'close': 101}]
    r = evaluate_force_exit(
        entry_date='2026-08-01',
        current_date='2026-08-09',  # 8 days
        entry_price=100,
        current_price=101,
        price_history=price_history10,
        enable_distribution=False,  # skip distribution
    )
    print(f"  should_exit: {r['should_exit']} | code: {r['exit_code']} | priority: {r['priority']}")
    print(f"  reason: {r['reason']}")
    assert r['should_exit'] and r['exit_code'] == 'max_holding_7d'
    print("  ✅ PASS (max_holding wins over no_move)")

    # Test 11: No exit needed (healthy trade)
    print("\n=== Test 11: صفقة صحية (لا إغلاق) ===")
    price_history11 = [{'close': 103}, {'close': 105}]
    r = evaluate_force_exit(
        entry_date='2026-08-01',
        current_date='2026-08-03',  # 2 days
        entry_price=100,
        current_price=105,
        price_history=price_history11,
        enable_distribution=False,
    )
    print(f"  should_exit: {r['should_exit']} | reason: {r['reason']}")
    assert not r['should_exit']
    print("  ✅ PASS (صفقة صحية)")

    # Test 12: Insufficient data
    print("\n=== Test 12: بيانات غير كافية ===")
    r = evaluate_force_exit(
        entry_date='2026-08-01',
        current_date='2026-08-02',
        entry_price=100,
        current_price=101,
        price_history=[{'close': 101}],
        enable_distribution=False,
    )
    print(f"  should_exit: {r['should_exit']} | reason: {r['reason']}")
    assert not r['should_exit']
    print("  ✅ PASS")

    print("\n" + "=" * 70)
    print("✅ Short Holding + Distribution Exit ready (12/12 tests pass)")
    print(f"\nIntegration in V40.2/daily_closer:")
    print(f"  V40_2_SHORT_HOLDING=1 → max_holding_7d + no_move_3d + early_drop")
    print(f"  V40_2_DISTRIBUTION_EXIT=1 → distribution_exit")
    print(f"\nExit priority: 1=distribution > 2=max_holding > 3=no_move > 4=early_drop")
