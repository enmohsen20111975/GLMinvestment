"""
analyzers/indicators/adx.py — Canonical ADX / DMI (Directional Movement Index)
=============================================================================
**Rule 67 — CALCULATION-CANONICAL**: ده المصدر الوحيد لحساب ADX/DMI في المشروع.

الصيغة (Wilder's):
  +DM[i] = (high[i] - high[i-1]) لو > (low[i-1] - low[i]) و > 0، غير كده 0
  -DM[i] = (low[i-1] - low[i]) لو > (high[i] - high[i-1]) و > 0، غير كده 0
  TR[i] = max(high-low, |high-close_prev|, |low-close_prev|)
  smoothed +DM = Wilder's smoothing (+DM, period)
  smoothed -DM = Wilder's smoothing (-DM, period)
  smoothed TR = Wilder's smoothing (TR, period)
  +DI = 100 × smoothed(+DM) / smoothed(TR)
  -DI = 100 × smoothed(-DM) / smoothed(TR)
  DX = 100 × |+DI - -DI| / (+DI + -DI)
  ADX = Wilder's smoothing (DX, period)

السبب: كان فيه 8 implementations مختلفة (engine/historical_backfill_engine.py +
glminvestment_engines/core/indicators.py + scripts/production_backtest_tf.py +
engines/market_regime.py + analyzers/enhanced_indicators.py + analyzers/technical.py
+ analyzers/regime_detector.py + analyzers/prediction_optimizer.py). كل واحدة بـ
تحسب ADX بطريقة مختلفة (بعضها Wilder's، بعضها SMA، بعضها EMA). ده كارثة في
تحديد قوة الترند.

المرجعية:
  - Rule 67 (00-CONSTITUTION.md)
  - J. Welles Wilder Jr. (1978) — New Concepts in Technical Trading Systems

الاستخدام:
  from analyzers.indicators import calc_adx
  adx = calc_adx(highs, lows, closes, period=14)
  if adx:
      print(adx['adx'], adx['plus_di'], adx['minus_di'])
"""
from __future__ import annotations
from typing import Optional, List, Dict


def _wilder_smooth(values: List[float], period: int) -> List[float]:
    """Wilder's smoothing لقائمة قيم (canonical helper)."""
    if len(values) < period:
        return []
    smoothed = [sum(values[:period])]  # initial = sum (مش avg — Wilder's convention)
    for i in range(period, len(values)):
        smoothed.append(smoothed[-1] - smoothed[-1] / period + values[i])
    return smoothed


def calc_adx(highs: List[float], lows: List[float], closes: List[float],
             period: int = 14) -> Optional[Dict[str, float]]:
    """حساب ADX + DI+ + DI- (canonical) — Wilder's smoothing.

    Args:
        highs: قمم الأسعار (آخرها في النهاية)
        lows: قيعان الأسعار (آخرها في النهاية)
        closes: إغلاقات الأسعار (آخرها في النهاية)
        period: فترة ADX (default: 14 — Wilder's standard)

    Returns:
        dict: {adx, plus_di, minus_di} أو None لو البيانات غير كافية.
        - adx: قوة الترند (0-100). > 25 = ترند قوي، < 20 = ضعيف/ranging
        - plus_di: Directional Indicator موجب (قوة الشراء)
        - minus_di: Directional Indicator سالب (قوة البيع)
        القيم rounded لـ 2 أرقام عشرية.

    Notes:
        - Wilder's smoothing (مش SMA/EMA) — ده الصيغة الأصلية.
        - لو len(data) < 2 × period → بـ يرجّع None (محتاج period للـ DM smoothing + period للـ ADX smoothing).
        - لو +DI + -DI == 0 → DX = 0 (neutral).
    """
    if not closes or len(closes) < 2 * period:
        return None
    if not highs or not lows:
        return None

    min_len = min(len(highs), len(lows), len(closes))
    highs = highs[-min_len:]
    lows = lows[-min_len:]
    closes = closes[-min_len:]

    if len(closes) < 2 * period:
        return None

    # 1) True Range + Directional Movement
    trs: List[float] = []
    plus_dms: List[float] = []
    minus_dms: List[float] = []
    for i in range(1, len(closes)):
        up_move = highs[i] - highs[i - 1]
        down_move = lows[i - 1] - lows[i]
        plus_dm = up_move if (up_move > down_move and up_move > 0) else 0.0
        minus_dm = down_move if (down_move > up_move and down_move > 0) else 0.0
        plus_dms.append(plus_dm)
        minus_dms.append(minus_dm)
        tr = max(
            highs[i] - lows[i],
            abs(highs[i] - closes[i - 1]),
            abs(lows[i] - closes[i - 1]),
        )
        trs.append(tr)

    # 2) Wilder's smoothing
    tr_smoothed = _wilder_smooth(trs, period)
    plus_dm_smoothed = _wilder_smooth(plus_dms, period)
    minus_dm_smoothed = _wilder_smooth(minus_dms, period)

    if not tr_smoothed or not plus_dm_smoothed or not minus_dm_smoothed:
        return None

    # 3) +DI / -DI
    dxs: List[float] = []
    plus_di = 0.0
    minus_di = 0.0
    for i in range(len(tr_smoothed)):
        if tr_smoothed[i] == 0:
            continue
        pdi = 100 * plus_dm_smoothed[i] / tr_smoothed[i]
        mdi = 100 * minus_dm_smoothed[i] / tr_smoothed[i]
        plus_di = pdi
        minus_di = mdi
        if (pdi + mdi) > 0:
            dx = 100 * abs(pdi - mdi) / (pdi + mdi)
        else:
            dx = 0.0
        dxs.append(dx)

    if not dxs:
        return None

    # 4) ADX = Wilder's smoothing of DX
    if len(dxs) < period:
        adx_val = sum(dxs) / len(dxs)
    else:
        adx_smoothed = _wilder_smooth(dxs, period)
        if not adx_smoothed:
            return None
        adx_val = adx_smoothed[-1] / period  # Wilder's convention: final value / period

    return {
        "adx": round(adx_val, 2),
        "plus_di": round(plus_di, 2),
        "minus_di": round(minus_di, 2),
    }
