#!/usr/bin/env python3
"""
garch_exit_engine.py — GARCH Volatility Forecasting Exit Engine
================================================================
Task IMPROVEMENT-15-2026-10-07 (Rule 71 — Quantitative Layer 3)

المصدر: Asymmetric Exits via Volatility Forecasting Blueprint من المالك
الهدف: خروج ذكي قبل الـ whipsaw باستخدام GARCH(1,1)

المنطق:
  - لو GARCH بيتنبأ إن التقلب هيزيد 2× بكرة → تفعيل trailing stop صارم
  - بدل انتظار الهدف → خروج كامل فوري
  - بيحمي من الـ Whipsaws (طلع 3% ثم غلق أحمر -2%)

المكتبة: arch (مثبتة ✅)
البيانات: price_history.db (آخر 100 يوم)

CLI:
  python3 vps-service/analyzers/garch_exit_engine.py
"""
from __future__ import annotations

import sqlite3
import sys
import logging
import numpy as np
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

logger = logging.getLogger(__name__)

_DEFAULT_DB = str(PROJECT_ROOT / "db" / "price_history.db")


def forecast_volatility(
    closes: list,
    ticker: str = '',
    forecast_horizon: int = 1,
    lookback: int = 100,
) -> Dict[str, Any]:
    """التنبؤ بالتقلب المستقبلي باستخدام GARCH(1,1).

    Args:
        closes: قائمة أسعار الإغلاق
        ticker: اسم السهم (للـ log)
        forecast_horizon: عدد أيام التنبؤ (default 1)
        lookback: عدد الأيام السابقة للتدريب (default 100)

    Returns:
        dict فيه:
          - 'volatility_forecast': التقلب المتوقع (daily std)
          - 'volatility_ratio': نسبة التقلب المتوقع للتقلب الحالي
          - 'is_volatility_spike': True لو التقلب هيزيد 2×
          - 'recommendation': 'EXIT' / 'TRAILING_STOP' / 'HOLD'
          - 'confidence': 0-100
    """
    result = {
        'volatility_forecast': 0.0,
        'volatility_ratio': 1.0,
        'is_volatility_spike': False,
        'recommendation': 'HOLD',
        'confidence': 0,
    }

    if len(closes) < 30:
        return result

    try:
        from arch import arch_model

        # Calculate daily returns
        closes_arr = np.array(closes[-lookback:], dtype=float)
        returns = np.diff(np.log(closes_arr)) * 100  # log returns × 100

        if len(returns) < 20:
            return result

        # Replace NaN/Inf
        returns = np.nan_to_num(returns, nan=0.0, posinf=0.0, neginf=0.0)

        # Current volatility (last 20 days)
        current_vol = np.std(returns[-20:]) if len(returns) >= 20 else np.std(returns)

        # Fit GARCH(1,1)
        am = arch_model(returns, vol='Garch', p=1, q=1, mean='Zero', rescale=False)
        res = am.fit(disp='off', show_warning=False)

        # Forecast
        forecast = res.forecast(horizon=forecast_horizon, reindex=False)
        forecast_vol = np.sqrt(forecast.variance.values[-1, 0])

        # Ratio
        if current_vol > 0:
            vol_ratio = forecast_vol / current_vol
        else:
            vol_ratio = 1.0

        # Volatility spike: لو التقلب المتوقع > 2× الحالي
        is_spike = vol_ratio >= 2.0

        # Recommendation
        if is_spike:
            recommendation = 'EXIT'  # خروج كامل
            confidence = 85
        elif vol_ratio >= 1.5:
            recommendation = 'TRAILING_STOP'  # trailing صارم
            confidence = 70
        else:
            recommendation = 'HOLD'  # امسك
            confidence = 50

        result.update({
            'volatility_forecast': float(forecast_vol),
            'volatility_ratio': float(vol_ratio),
            'is_volatility_spike': bool(is_spike),
            'recommendation': recommendation,
            'confidence': confidence,
            'current_volatility': float(current_vol),
        })

        logger.info(f"GARCH {ticker}: forecast_vol={forecast_vol:.4f}, current_vol={current_vol:.4f}, ratio={vol_ratio:.2f}, rec={recommendation}")

    except Exception as e:
        logger.debug(f"GARCH failed for {ticker}: {e}")
        # safe fallback
        result['recommendation'] = 'HOLD'
        result['confidence'] = 0

    return result


def should_force_exit(
    closes: list,
    ticker: str = '',
    current_price: float = 0,
    entry_price: float = 0,
    target_price: float = 0,
    stop_loss: float = 0,
) -> Dict[str, Any]:
    """قرار خروج ذكي بناءً على GARCH + الوضع الحالي.

    Args:
        closes: أسعار الإغلاق التاريخية
        ticker: اسم السهم
        current_price: السعر الحالي
        entry_price: سعر الدخول
        target_price: الهدف
        stop_loss: الستوب

    Returns:
        dict فيه:
          - 'force_exit': True لو لازم خروج فوري
          - 'reason': سبب الخروج
          - 'new_stop': الستوب الجديد (لو trailing)
          - 'garch_data': كل بيانات GARCH
    """
    result = {
        'force_exit': False,
        'reason': '',
        'new_stop': None,
        'garch_data': {},
    }

    # احسب GARCH
    garch = forecast_volatility(closes, ticker)
    result['garch_data'] = garch

    # لو التقلب هيزيد 2× → خروج كامل فوري
    if garch['recommendation'] == 'EXIT':
        result['force_exit'] = True
        result['reason'] = f"🚨 GARCH: تقلب متوقع {garch['volatility_ratio']:.1f}× (خروج طارئ)"
        return result

    # لو التقلب هيزيد 1.5× → تفعيل trailing stop صارم
    if garch['recommendation'] == 'TRAILING_STOP' and current_price > 0 and entry_price > 0:
        # لو السعر فوق الدخول → ضع trailing عند entry (breakeven)
        if current_price > entry_price:
            result['new_stop'] = entry_price  # breakeven
            result['reason'] = f"⚠️ GARCH: تقلب متوقع {garch['volatility_ratio']:.1f}× → trailing عند breakeven"
        # لو السعر تحت الدخول → ضع الستوب أقرب
        elif stop_loss > 0:
            new_stop = current_price * 0.98  # 2% تحت السعر الحالي
            if new_stop > stop_loss:
                result['new_stop'] = new_stop
                result['reason'] = f"⚠️ GARCH: تقلب متوقع {garch['volatility_ratio']:.1f}× → tighten stop لـ {new_stop:.2f}"

    return result


if __name__ == '__main__':
    print('═══ GARCH Exit Engine — Volatility Forecasting ═══')
    print(f'Time: {datetime.now().isoformat()}')
    print()

    # Test with COMI data
    conn = sqlite3.connect(_DEFAULT_DB)
    conn.row_factory = sqlite3.Row
    rows = conn.execute('''
        SELECT close_price FROM price_history
        WHERE ticker = 'COMI' AND close_price IS NOT NULL AND close_price > 0
        ORDER BY date DESC LIMIT 100
    ''').fetchall()
    conn.close()

    closes = [float(r['close_price']) for r in reversed(rows)]
    print(f'COMI: {len(closes)} data points')
    print(f'Last close: {closes[-1]:.2f}')
    print()

    result = forecast_volatility(closes, 'COMI')
    print('=== GARCH Forecast ===')
    print(f'  Current volatility: {result.get("current_volatility", 0):.4f}')
    print(f'  Forecast volatility: {result["volatility_forecast"]:.4f}')
    print(f'  Volatility ratio: {result["volatility_ratio"]:.2f}×')
    print(f'  Is spike: {result["is_volatility_spike"]}')
    print(f'  Recommendation: {result["recommendation"]}')
    print(f'  Confidence: {result["confidence"]}%')
    print()

    # Test force exit
    exit_result = should_force_exit(
        closes, 'COMI',
        current_price=closes[-1],
        entry_price=closes[-1] * 0.98,
        target_price=closes[-1] * 1.10,
        stop_loss=closes[-1] * 0.95,
    )
    print('=== Exit Decision ===')
    print(f'  Force exit: {exit_result["force_exit"]}')
    print(f'  Reason: {exit_result["reason"] or "HOLD"}')
    print(f'  New stop: {exit_result["new_stop"]}')
