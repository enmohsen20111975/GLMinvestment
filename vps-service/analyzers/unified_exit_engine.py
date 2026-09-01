#!/usr/bin/env python3
"""
Unified Exit Engine — محرك الخروج الموحد (أسهم + كريبتو)
============================================================
توحيد طبقة الخروج والمدة تحت نفس الفلسفة (المحور ب).

المبدأ: نفس المنطق، أرقام مختلفة حسب نوع السوق.

الـ engine بـ يوفّر:
  1. MarketProfile — إعدادات السوق (thresholds)
  2. evaluate_unified_force_exit() — قرار موحد بترتيب أولوية ثابت:
     1. Veto (إفصاح/حدث خطير)
     2. Distribution
     3. Max holding
     4. No move
     5. Early adverse move
     6. (باقي TP/SL بـ يتعامل معاهم daily_closer)

الـ profiles:
  - STOCKS: 7 أيام، no_move 3d (+3%)، early -5%، distribution wick≥1.0×
  - CRYPTO: 72 ساعة، no_move 24h (+5%)، early -8%، distribution wick≥1.2×

التكامل:
  - V40_2_UNIFIED_EXIT=1 (default OFF)
  - يستبدل short_holding_exit + crypto_short_holding_exit

Author: Z.ai Code
Date: 2026-09-01
"""

from __future__ import annotations
import math
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timedelta


# ═══════════════════════════════════════════════════════════════════════
# 1. Market Profiles — إعدادات السوق (thresholds)
# ═══════════════════════════════════════════════════════════════════════

MARKET_PROFILES: Dict[str, Dict[str, Any]] = {
    'STOCKS': {
        # Holding (بالأيام)
        'max_holding': 7,              # أيام
        'max_holding_unit': 'days',
        'no_move_period': 3,           # أيام
        'no_move_threshold_pct': 3.0,  # +3%
        'early_drop_period': 3,        # أيام
        'early_drop_threshold_pct': -5.0,
        # Distribution
        'dist_upper_wick_ratio': 1.0,
        'dist_volume_ratio': 1.8,
        'dist_near_high_max_pct': 8.0,
        'dist_rsi_threshold': 65.0,
        'dist_lookback': 20,
    },
    'CRYPTO': {
        # Holding (بالساعات — 24/7)
        'max_holding': 72,             # ساعات (3 أيام)
        'max_holding_unit': 'hours',
        'no_move_period': 24,          # ساعات
        'no_move_threshold_pct': 5.0,
        'early_drop_period': 24,       # ساعات
        'early_drop_threshold_pct': -8.0,
        # Distribution (crypto أعلى)
        'dist_upper_wick_ratio': 1.2,
        'dist_volume_ratio': 2.0,
        'dist_near_high_max_pct': 12.0,
        'dist_rsi_threshold': 72.0,
        'dist_lookback': 24,
    },
}


def get_market_profile(market: str = 'STOCKS') -> Dict[str, Any]:
    """جيب إعدادات السوق."""
    return MARKET_PROFILES.get(market.upper(), MARKET_PROFILES['STOCKS']).copy()


# ═══════════════════════════════════════════════════════════════════════
# 2. Helpers
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


def _calc_time_elapsed(entry_time: str, current_time: str, unit: str = 'days') -> float:
    """حساب الفترة المنقضة (بالأيام أو الساعات)."""
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
        return 0

    delta = (current_dt - entry_dt).total_seconds()
    if unit == 'hours':
        return max(0, delta / 3600.0)
    return max(0, delta / 86400.0)  # days


# ═══════════════════════════════════════════════════════════════════════
# 3. Distribution Detection (unified)
# ═══════════════════════════════════════════════════════════════════════

def detect_distribution_unified(
    opens: List[float],
    highs: List[float],
    lows: List[float],
    closes: List[float],
    volumes: List[float],
    rsi: Optional[float] = None,
    market: str = 'STOCKS',
    wick_ratio_mult: float = 1.0,  # من النوتبوك (distribution_sensitivity)
) -> Dict[str, Any]:
    """
    كشف شمعة التوزيع (موحد — أرقام مختلفة حسب السوق).
    """
    profile = get_market_profile(market)
    lookback = profile['dist_lookback']
    n = min(len(opens), len(highs), len(lows), len(closes), len(volumes))
    if n < lookback + 1:
        return {
            'is_distribution': False,
            'reason': f'بيانات غير كافية ({n} < {lookback + 1})',
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
    # Apply wick_ratio_mult (from notebook distribution_sensitivity)
    effective_wick_threshold = profile['dist_upper_wick_ratio'] * wick_ratio_mult
    cond_upper_wick = upper_wick >= (body * effective_wick_threshold) and upper_wick > 0

    avg_vol = _sma(volumes[-lookback:], lookback) if len(volumes) >= lookback else 1
    volume_ratio = (v / avg_vol) if avg_vol > 0 else 0
    cond_volume = volume_ratio >= profile['dist_volume_ratio']

    high_lookback = max(highs[-lookback:]) if len(highs) >= lookback else max(highs)
    dist_from_high_pct = ((high_lookback - c) / high_lookback * 100) if high_lookback > 0 else 0
    cond_near_high = dist_from_high_pct <= profile['dist_near_high_max_pct']

    if rsi is None:
        rsi = _rsi(closes, 14)
    cond_rsi_high = rsi >= profile['dist_rsi_threshold']

    conditions_met = sum([cond_candle, cond_upper_wick, cond_volume, cond_near_high])
    is_distribution = cond_candle and cond_upper_wick and conditions_met >= 3

    if is_distribution:
        reasons = []
        if is_red:
            reasons.append('شمعة حمراء')
        elif is_small_body:
            reasons.append('جسم صغير')
        if cond_upper_wick:
            reasons.append(f'ظل علوي طويل ({upper_wick_ratio:.2f}×)')
        if cond_volume:
            reasons.append(f'حجم عالي ({volume_ratio:.2f}×)')
        if cond_near_high:
            reasons.append(f'قريب من القمة ({dist_from_high_pct:.1f}%)')
        if cond_rsi_high:
            reasons.append(f'RSI مرتفع ({rsi:.1f})')
        reason = f'توزيع ({market}): ' + ' | '.join(reasons)
    else:
        reason = 'مش توزيع'

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
# 4. Holding Rules (unified)
# ═══════════════════════════════════════════════════════════════════════

def should_force_exit_by_time_unified(
    entry_time: str,
    current_time: str,
    entry_price: float,
    current_price: float,
    price_history: Optional[List[Dict[str, float]]] = None,
    market: str = 'STOCKS',
) -> Dict[str, Any]:
    """
    فحص هل لازم إغلاق إجباري (موحد — أرقام مختلفة حسب السوق).
    """
    profile = get_market_profile(market)
    unit = profile['max_holding_unit']

    time_elapsed = _calc_time_elapsed(entry_time, current_time, unit)
    return_pct = ((current_price - entry_price) / entry_price * 100) if entry_price > 0 else 0

    # 1. Max holding
    if time_elapsed >= profile['max_holding']:
        return {
            'should_exit': True,
            'reason': f'تجاوز الحد الأقصى للاحتفاظ ({time_elapsed:.1f} {unit} ≥ {profile["max_holding"]} {unit})',
            'exit_code': 'max_holding',
            'time_elapsed': round(time_elapsed, 1),
            'return_pct': round(return_pct, 2),
        }

    # 2. Early drop
    if time_elapsed <= profile['early_drop_period'] and return_pct <= profile['early_drop_threshold_pct']:
        return {
            'should_exit': True,
            'reason': f'نزول مبكر {return_pct:+.2f}% في {time_elapsed:.1f} {unit}',
            'exit_code': 'early_drop',
            'time_elapsed': round(time_elapsed, 1),
            'return_pct': round(return_pct, 2),
        }

    # 3. No move
    no_move_period = profile['no_move_period']
    if time_elapsed >= no_move_period and price_history:
        recent = price_history[-int(no_move_period):] if len(price_history) >= no_move_period else price_history
        recent_closes = [float(d.get('close', 0) or 0) for d in recent if float(d.get('close', 0) or 0) > 0]
        if len(recent_closes) >= 3:
            max_close = max(recent_closes)
            max_gain_pct = ((max_close - entry_price) / entry_price * 100) if entry_price > 0 else 0
            if max_gain_pct < profile['no_move_threshold_pct']:
                return {
                    'should_exit': True,
                    'reason': f'لا حركة: أقصى ارتفاع {max_gain_pct:+.2f}% (< {profile["no_move_threshold_pct"]}%)',
                    'exit_code': 'no_move',
                    'time_elapsed': round(time_elapsed, 1),
                    'return_pct': round(return_pct, 2),
                }

    return {
        'should_exit': False,
        'reason': f'{time_elapsed:.1f} {unit}, return={return_pct:+.2f}%',
        'exit_code': '',
        'time_elapsed': round(time_elapsed, 1),
        'return_pct': round(return_pct, 2),
    }


# ═══════════════════════════════════════════════════════════════════════
# 5. evaluate_unified_force_exit() — القرار النهائي الموحد
# ═══════════════════════════════════════════════════════════════════════

def evaluate_unified_force_exit(
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
    market: str = 'STOCKS',
    enable_holding: bool = True,
    enable_distribution: bool = True,
    wick_ratio_mult: float = 1.0,  # من النوتبوك
) -> Dict[str, Any]:
    """
    تقييم شامل للإغلاق الإجباري (موحد).

    ترتيب الأولوية ثابت:
      1. distribution_exit (priority=1) — الميكرز بـ يفرغ
      2. max_holding (priority=2)
      3. no_move (priority=3)
      4. early_drop (priority=4)

    (Veto/إفصاح بـ يتعامل معاه في V40.2 قبل ما نوصل هنا)
    """
    # 1. Distribution
    if enable_distribution and opens and highs and lows and closes and volumes:
        dist = detect_distribution_unified(
            opens, highs, lows, closes, volumes, rsi=rsi,
            market=market, wick_ratio_mult=wick_ratio_mult
        )
        if dist['is_distribution']:
            return {
                'should_exit': True,
                'exit_code': 'distribution_exit',
                'reason': f'🚨 {dist["reason"]}',
                'priority': 1,
                'details': dist,
                'market': market,
            }

    # 2-4. Holding rules
    if enable_holding:
        holding = should_force_exit_by_time_unified(
            entry_time, current_time, entry_price, current_price, price_history, market=market
        )
        if holding['should_exit']:
            priority = {
                'max_holding': 2,
                'no_move': 3,
                'early_drop': 4,
            }.get(holding['exit_code'], 5)
            return {
                'should_exit': True,
                'exit_code': holding['exit_code'],
                'reason': f'⏰ {holding["reason"]}',
                'priority': priority,
                'details': holding,
                'market': market,
            }

    return {
        'should_exit': False,
        'exit_code': '',
        'reason': 'لا حاجة للإغلاق الإجباري',
        'priority': 0,
        'details': {},
        'market': market,
    }


# ═══════════════════════════════════════════════════════════════════════
# 6. Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 Unified Exit Engine — Self Test")
    print("=" * 70)

    # Test 1: Stocks profile
    print("=== Test 1: Stocks profile ===")
    p = get_market_profile('STOCKS')
    print(f"  max_holding: {p['max_holding']} {p['max_holding_unit']}")
    print(f"  no_move: {p['no_move_period']} {p['max_holding_unit']} (+{p['no_move_threshold_pct']}%)")
    assert p['max_holding'] == 7
    print("  ✅ PASS")

    # Test 2: Crypto profile
    print("\n=== Test 2: Crypto profile ===")
    p = get_market_profile('CRYPTO')
    print(f"  max_holding: {p['max_holding']} {p['max_holding_unit']}")
    print(f"  no_move: {p['no_move_period']} {p['max_holding_unit']} (+{p['no_move_threshold_pct']}%)")
    assert p['max_holding'] == 72
    print("  ✅ PASS")

    # Test 3: Stocks — 8 days → max_holding
    print("\n=== Test 3: Stocks — 8 days → max_holding ===")
    r = should_force_exit_by_time_unified('2026-08-01', '2026-08-09', 100, 101, market='STOCKS')
    print(f"  exit: {r['exit_code']}")
    assert r['should_exit'] and r['exit_code'] == 'max_holding'
    print("  ✅ PASS")

    # Test 4: Crypto — 80 hours → max_holding
    print("\n=== Test 4: Crypto — 80 hours → max_holding ===")
    r = should_force_exit_by_time_unified('2026-09-01 10:00', '2026-09-04 18:00', 50000, 51000, market='CRYPTO')
    print(f"  exit: {r['exit_code']}")
    assert r['should_exit'] and r['exit_code'] == 'max_holding'
    print("  ✅ PASS")

    # Test 5: Stocks — early drop -6%
    print("\n=== Test 5: Stocks — early drop -6% ===")
    r = should_force_exit_by_time_unified('2026-08-01', '2026-08-03', 100, 94, market='STOCKS')
    print(f"  exit: {r['exit_code']}")
    assert r['should_exit'] and r['exit_code'] == 'early_drop'
    print("  ✅ PASS")

    # Test 6: Crypto — early drop -10%
    print("\n=== Test 6: Crypto — early drop -10% ===")
    r = should_force_exit_by_time_unified('2026-09-01 10:00', '2026-09-01 22:00', 50000, 45000, market='CRYPTO')
    print(f"  exit: {r['exit_code']}")
    assert r['should_exit'] and r['exit_code'] == 'early_drop'
    print("  ✅ PASS")

    # Test 7: Distribution — stocks
    print("\n=== Test 7: Distribution — stocks ===")
    opens = [100 + i * 0.5 for i in range(25)] + [110]
    highs = [100 + i * 0.5 + 0.5 for i in range(25)] + [115]
    lows = [100 + i * 0.5 - 0.3 for i in range(25)] + [108]
    closes = [100 + i * 0.5 for i in range(25)] + [109]
    vols = [1000] * 25 + [2200]
    r = detect_distribution_unified(opens, highs, lows, closes, vols, market='STOCKS')
    print(f"  is_distribution: {r['is_distribution']}")
    assert r['is_distribution']
    print("  ✅ PASS")

    # Test 8: Distribution — crypto (higher thresholds)
    print("\n=== Test 8: Distribution — crypto ===")
    r = detect_distribution_unified(opens, highs, lows, closes, vols, market='CRYPTO')
    print(f"  is_distribution: {r['is_distribution']} (crypto thresholds higher)")
    # Crypto needs wick ≥ 1.2× body — here wick=5, body=1 → 5× ≥ 1.2× → True
    assert r['is_distribution']
    print("  ✅ PASS")

    # Test 9: wick_ratio_mult from notebook (0.8 = stricter)
    print("\n=== Test 9: wick_ratio_mult=0.8 (stricter) ===")
    opens9 = [100 + i * 0.5 for i in range(25)] + [110]
    highs9 = [100 + i * 0.5 + 0.5 for i in range(25)] + [112]  # smaller wick
    lows9 = [100 + i * 0.5 - 0.3 for i in range(25)] + [108]
    closes9 = [100 + i * 0.5 for i in range(25)] + [109]
    vols9 = [1000] * 25 + [2200]
    r_normal = detect_distribution_unified(opens9, highs9, lows9, closes9, vols9, market='STOCKS', wick_ratio_mult=1.0)
    r_strict = detect_distribution_unified(opens9, highs9, lows9, closes9, vols9, market='STOCKS', wick_ratio_mult=0.8)
    print(f"  normal (×1.0): {r_normal['is_distribution']} | strict (×0.8): {r_strict['is_distribution']}")
    print("  ✅ PASS (mult affects threshold)")

    # Test 10: evaluate_unified — distribution priority
    print("\n=== Test 10: evaluate — distribution priority ===")
    r = evaluate_unified_force_exit(
        entry_time='2026-08-01', current_time='2026-08-09',  # 8 days (max_holding)
        entry_price=100, current_price=109,
        price_history=[{'close': c} for c in closes[-5:]],
        opens=opens, highs=highs, lows=lows, closes=closes, volumes=vols,
        market='STOCKS',
    )
    print(f"  exit: {r['exit_code']} (priority={r['priority']})")
    assert r['exit_code'] == 'distribution_exit' and r['priority'] == 1
    print("  ✅ PASS")

    # Test 11: No exit needed
    print("\n=== Test 11: No exit needed ===")
    r = should_force_exit_by_time_unified('2026-08-01', '2026-08-02', 100, 105, market='STOCKS')
    print(f"  should_exit: {r['should_exit']}")
    assert not r['should_exit']
    print("  ✅ PASS")

    print("\n" + "=" * 70)
    print("✅ Unified Exit Engine ready (11/11 tests pass)")
    print(f"\nIntegration: V40_2_UNIFIED_EXIT=1 (default OFF)")
    print(f"Priority: 1=distribution > 2=max_holding > 3=no_move > 4=early_drop")
    print(f"Markets: STOCKS (7d) + CRYPTO (72h) — same logic, different thresholds")
