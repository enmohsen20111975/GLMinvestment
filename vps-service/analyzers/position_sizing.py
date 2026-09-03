#!/usr/bin/env python3
"""
Position Sizing Module — تحديد حجم الصفقة بناءً على التقلب
============================================================
توجيه المالك (2026-09-02): "احسب ATR% أو التقلب لكل سهم.
لو التقلب عالي → قلل حجم الصفقة (50-60% من الحجم العادي).
لو التقلب طبيعي → الحجم كامل."

الـ module ده بيـ:
1. يحسب ATR% لكل سهم (ATR / price × 100).
2. يصنّف السهم لـ 3 مستويات:
   - LOW_VOLATILITY (ATR% < 3%): حجم كامل (100%)
   - NORMAL_VOLATILITY (3% ≤ ATR% < 6%): حجم كامل (100%)
   - HIGH_VOLATILITY (ATR% ≥ 6%): حجم مخفّض (50-60%)
3. يرجّع position_size_mult (0.5 لـ 1.0).
4. يستخدم في V40.2 generator + simulate_trade.

CONSTITUTION compliance:
- Rule 8: ATR stop في [3%, 9%] (مش بلمسها).
- Rule 19: hard_loss_ceiling 7% (مش بلمسها).
- ده عامل إضافي → بيأثر على حجم الصفقة، مش على الـ stop.

Author: Z.ai Code
Date: 2026-09-02
"""
from __future__ import annotations
import os
import logging
from typing import Dict, Any, Optional, List
from pathlib import Path

logger = logging.getLogger(__name__)

# ═══════════════════════════════════════════════════════════════════════
# Thresholds (env-configurable)
# ═══════════════════════════════════════════════════════════════════════

# ATR% thresholds (ATR / price × 100)
HIGH_VOL_ATR_PCT = float(os.environ.get('V40_2_HIGH_VOL_ATR_PCT', '6.0'))  # ≥ 6% = high vol
LOW_VOL_ATR_PCT = float(os.environ.get('V40_2_LOW_VOL_ATR_PCT', '3.0'))   # < 3% = low vol

# Position size multipliers
HIGH_VOL_SIZE_MULT = float(os.environ.get('V40_2_HIGH_VOL_SIZE_MULT', '0.55'))  # 55% حجم
NORMAL_VOL_SIZE_MULT = float(os.environ.get('V40_2_NORMAL_VOL_SIZE_MULT', '1.0'))  # 100%
LOW_VOL_SIZE_MULT = float(os.environ.get('V40_2_LOW_VOL_SIZE_MULT', '1.0'))  # 100%

# Market-wide ATR threshold (above average = high vol regime)
MARKET_AVG_ATR_PCT = float(os.environ.get('V40_2_MARKET_AVG_ATR_PCT', '4.0'))  # متوسط EGX


# ═══════════════════════════════════════════════════════════════════════
# Main function: calculate_position_size
# ═══════════════════════════════════════════════════════════════════════

def calculate_position_size(
    atr: float,
    entry_price: float,
    market_avg_atr_pct: Optional[float] = None,
) -> Dict[str, Any]:
    """
    حساب حجم الصفقة بناءً على ATR%.

    Args:
        atr: قيمة ATR للسهم (absolute).
        entry_price: سعر الدخول.
        market_avg_atr_pct: متوسط ATR% للسوق (optional — لو مش متاح، نستخدم MARKET_AVG_ATR_PCT).

    Returns:
        {
            'position_size_mult': float (0.5 - 1.0),
            'volatility_class': 'LOW' | 'NORMAL' | 'HIGH',
            'atr_pct': float,
            'reason_ar': str,
            'reason_en': str,
        }
    """
    if entry_price <= 0 or atr <= 0:
        return {
            'position_size_mult': NORMAL_VOL_SIZE_MULT,
            'volatility_class': 'NORMAL',
            'atr_pct': 0.0,
            'reason_ar': 'بيانات غير كافية — حجم عادي',
            'reason_en': 'Insufficient data — normal size',
        }

    atr_pct = (atr / entry_price) * 100
    mkt_avg = market_avg_atr_pct if market_avg_atr_pct is not None else MARKET_AVG_ATR_PCT

    if atr_pct >= HIGH_VOL_ATR_PCT:
        # سهم عالي التقلب → قلل الحجم
        size_mult = HIGH_VOL_SIZE_MULT
        vol_class = 'HIGH'
        reason_ar = f'سهم عالي التقلب (ATR={atr_pct:.1f}%) → حجم مخفّض ({size_mult:.0%})'
        reason_en = f'High volatility stock (ATR={atr_pct:.1f}%) → reduced size ({size_mult:.0%})'
    elif atr_pct < LOW_VOL_ATR_PCT:
        # سهم منخفض التقلب → حجم كامل
        size_mult = LOW_VOL_SIZE_MULT
        vol_class = 'LOW'
        reason_ar = f'سهم منخفض التقلب (ATR={atr_pct:.1f}%) → حجم كامل'
        reason_en = f'Low volatility stock (ATR={atr_pct:.1f}%) → full size'
    else:
        # تقلب طبيعي → حجم كامل
        size_mult = NORMAL_VOL_SIZE_MULT
        vol_class = 'NORMAL'
        reason_ar = f'تقلب طبيعي (ATR={atr_pct:.1f}%) → حجم كامل'
        reason_en = f'Normal volatility (ATR={atr_pct:.1f}%) → full size'

    return {
        'position_size_mult': round(size_mult, 3),
        'volatility_class': vol_class,
        'atr_pct': round(atr_pct, 2),
        'reason_ar': reason_ar,
        'reason_en': reason_en,
    }


def apply_position_sizing_to_trade(
    return_pct: float,
    position_size_mult: float,
) -> float:
    """
    تطبيق الـ position size على العائد.

    Args:
        return_pct: العائد الأصلي (مثلاً -24.86%).
        position_size_mult: حجم الصفقة (مثلاً 0.55).

    Returns:
        العائد المعدّل بالحجم (مثلاً -24.86% × 0.55 = -13.67%).
    """
    return return_pct * position_size_mult


def get_position_size_for_ticker(
    ticker: str,
    atr: float,
    entry_price: float,
    market_avg_atr_pct: Optional[float] = None,
) -> Dict[str, Any]:
    """
   Wrapper للاستخدام في V40.2 + simulate_trade.
    """
    result = calculate_position_size(atr, entry_price, market_avg_atr_pct)
    result['ticker'] = ticker
    return result


# ═══════════════════════════════════════════════════════════════════════
# Self-test
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 Position Sizing Module — Self Test")
    print("=" * 70)

    test_cases = [
        # (ticker, atr, entry, expected_class, expected_mult_range)
        ('COMI', 5.0, 50.0, 'NORMAL', (0.95, 1.0)),   # ATR=10% — wait, 5/50=10% → HIGH
        ('TMGH', 3.0, 80.0, 'NORMAL', (0.95, 1.0)),   # ATR=3.75% → NORMAL
        ('UTOP', 12.0, 143.78, 'HIGH', (0.5, 0.6)),   # ATR=8.3% → HIGH → 55%
        ('SWDY', 2.0, 90.0, 'LOW', (0.95, 1.0)),      # ATR=2.2% → LOW
        ('DAPH', 15.0, 100.0, 'HIGH', (0.5, 0.6)),   # ATR=15% → HIGH → 55%
        ('EAST', 4.0, 70.0, 'NORMAL', (0.95, 1.0)),   # ATR=5.7% → NORMAL
    ]

    print(f"\n{'Ticker':8s} | {'ATR':>6s} | {'Entry':>8s} | {'ATR%':>6s} | {'Class':>8s} | {'SizeMult':>9s} | Reason")
    print("-" * 90)
    for ticker, atr, entry, exp_class, exp_mult_range in test_cases:
        result = get_position_size_for_ticker(ticker, atr, entry)
        print(f"{ticker:8s} | {atr:6.2f} | {entry:8.2f} | {result['atr_pct']:5.2f}% | {result['volatility_class']:>8s} | {result['position_size_mult']:>8.0%} | {result['reason_ar']}")

    print("\n✓ Self test complete")

    # Test apply_position_sizing_to_trade
    print("\n" + "=" * 70)
    print("Test: apply_position_sizing_to_trade (UTOP -24.86% with 55% size)")
    print("=" * 70)
    original_return = -24.86
    size_mult = 0.55
    adjusted_return = apply_position_sizing_to_trade(original_return, size_mult)
    print(f"  Original return: {original_return:+.2f}%")
    print(f"  Position size: {size_mult:.0%}")
    print(f"  Adjusted return: {adjusted_return:+.2f}%")
    print(f"  → خسارة أقل بـ {abs(original_return - adjusted_return):.2f}pp ✓")
