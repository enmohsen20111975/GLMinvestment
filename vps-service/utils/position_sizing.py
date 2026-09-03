"""
position_sizing.py — Risk-Based Position Sizing (EGX-STRATEGY)
=================================================================
EGX-STRATEGY (2026-08-30): حساب حجم المركز بناءً على مسافة الوقف (risk-based).

المطلوب من المالك:
  "المخاطرة في الصفقة الواحدة = 1% إلى 1.5% من رأس المال (احسب حجم المركز
   من مسافة الوقف)."

المنطق:
  risk_amount = capital × risk_per_trade_pct
  stop_distance_pct = (entry - stop) / entry × 100
  position_value = risk_amount / (stop_distance_pct / 100)
  position_size_pct = position_value / capital × 100

مثال:
  capital = 100,000 EGP
  risk_per_trade = 1.2% (وسط بين 1% و 1.5%)
  entry = 100, stop = 94 → stop_distance = 6%
  risk_amount = 100,000 × 0.012 = 1,200 EGP
  position_value = 1,200 / 0.06 = 20,000 EGP
  position_size_pct = 20,000 / 100,000 × 100 = 20% من رأس المال
  shares = 20,000 / 100 = 200 سهم

القواعد:
  - risk_per_trade_pct: 1.0% (default) — قابل للتعديل من engine_settings.
  - max_position_pct: 25% (حد أقصى — ما يفتحش مركز أكبر من 25% من رأس المال).
  - min_position_pct: 5% (حد أدنى — ما يفتحش مركز أصغر من 5%).
  - لو stop_distance < 1% → skip (وقف قريب جداً).
  - لو stop_distance > 15% → skip (وقف بعيد جداً).

الاستخدام:
  from utils.position_sizing import calculate_risk_based_position

  pos = calculate_risk_based_position(
      capital=100000, entry_price=100, stop_price=94, confidence=0.8
  )
  if pos['action'] == 'enter':
      shares = pos['shares']
      position_value = pos['position_value']
"""
from __future__ import annotations
from typing import Dict, Any, Optional


# ─── العتبات (settings-driven مع fallback صريح) ─────────────────────────────
DEFAULT_RISK_PER_TRADE_PCT = 1.2   # 1.2% (وسط بين 1% و 1.5%)
MAX_RISK_PER_TRADE_PCT = 1.5       # أقصى مخاطرة 1.5%
MIN_RISK_PER_TRADE_PCT = 1.0       # أدنى مخاطرة 1.0%
MAX_POSITION_PCT = 25.0            # أقصى حجم مركز 25% من رأس المال
MIN_POSITION_PCT = 5.0             # أدنى حجم مركز 5% من رأس المال
MIN_STOP_DISTANCE_PCT = 1.0        # أدنى مسافة وقف 1%
MAX_STOP_DISTANCE_PCT = 15.0       # أقصى مسافة وقف 15%


def _get_setting(key: str, default: float) -> float:
    """احصل على setting من engine_settings (مع fallback)."""
    try:
        from analyzers.engine_settings import get_setting
        return float(get_setting(key, default=default))
    except Exception:
        return default


def calculate_risk_based_position(
    capital: float,
    entry_price: float,
    stop_price: float,
    confidence: float = 1.0,
    risk_per_trade_pct: Optional[float] = None,
) -> Dict[str, Any]:
    """احسب حجم المركز بناءً على مسافة الوقف (risk-based).

    Args:
        capital: رأس المال الكلي (EGP).
        entry_price: سعر الدخول.
        stop_price: سعر الوقف.
        confidence: درجة الثقة (0-1). لو < 0.5 → تقليل المخاطرة لـ 1%.
        risk_per_trade_pct: نسبة المخاطرة (لو None، بـ يقرأ من settings).

    Returns:
        {
            'action': 'enter' | 'skip',
            'reason': str,
            'shares': int,
            'position_value': float,
            'position_pct': float,
            'risk_amount': float,
            'risk_per_trade_pct': float,
            'stop_distance_pct': float,
        }
    """
    # التحقق من المدخلات
    if capital <= 0 or entry_price <= 0 or stop_price <= 0:
        return {
            'action': 'skip',
            'reason': 'مدخلات غير صالحة (capital/entry/stop ≤ 0)',
            'shares': 0, 'position_value': 0, 'position_pct': 0,
            'risk_amount': 0, 'risk_per_trade_pct': 0, 'stop_distance_pct': 0,
        }

    if stop_price >= entry_price:
        return {
            'action': 'skip',
            'reason': 'وقف ≥ دخول (هندسة معكوسة)',
            'shares': 0, 'position_value': 0, 'position_pct': 0,
            'risk_amount': 0, 'risk_per_trade_pct': 0, 'stop_distance_pct': 0,
        }

    # حساب مسافة الوقف
    stop_distance_pct = ((entry_price - stop_price) / entry_price) * 100

    # فحص مسافة الوقف
    if stop_distance_pct < MIN_STOP_DISTANCE_PCT:
        return {
            'action': 'skip',
            'reason': f'مسافة الوقف {stop_distance_pct:.2f}% < {MIN_STOP_DISTANCE_PCT}% (قريب جداً)',
            'shares': 0, 'position_value': 0, 'position_pct': 0,
            'risk_amount': 0, 'risk_per_trade_pct': 0,
            'stop_distance_pct': round(stop_distance_pct, 2),
        }
    if stop_distance_pct > MAX_STOP_DISTANCE_PCT:
        return {
            'action': 'skip',
            'reason': f'مسافة الوقف {stop_distance_pct:.2f}% > {MAX_STOP_DISTANCE_PCT}% (بعيد جداً)',
            'shares': 0, 'position_value': 0, 'position_pct': 0,
            'risk_amount': 0, 'risk_per_trade_pct': 0,
            'stop_distance_pct': round(stop_distance_pct, 2),
        }

    # نسبة المخاطرة
    if risk_per_trade_pct is None:
        risk_per_trade_pct = _get_setting('risk_per_trade_pct', DEFAULT_RISK_PER_TRADE_PCT)

    # تعديل المخاطرة حسب الثقة
    if confidence < 0.5:
        risk_per_trade_pct = MIN_RISK_PER_TRADE_PCT  # ثقة منخفضة → 1%
    elif confidence >= 0.8:
        risk_per_trade_pct = min(risk_per_trade_pct, MAX_RISK_PER_TRADE_PCT)  # ثقة عالية → لحد 1.5%
    else:
        risk_per_trade_pct = DEFAULT_RISK_PER_TRADE_PCT  # ثقة وسط → 1.2%

    # clamp المخاطرة
    risk_per_trade_pct = max(MIN_RISK_PER_TRADE_PCT, min(MAX_RISK_PER_TRADE_PCT, risk_per_trade_pct))

    # حساب المبلغ المعرض للخطر
    risk_amount = capital * (risk_per_trade_pct / 100)

    # حساب حجم المركز
    position_value = risk_amount / (stop_distance_pct / 100)
    position_pct = (position_value / capital) * 100

    # clamp حجم المركز
    clamped = False
    if position_pct > MAX_POSITION_PCT:
        position_pct = MAX_POSITION_PCT
        position_value = capital * (MAX_POSITION_PCT / 100)
        clamped = True
    elif position_pct < MIN_POSITION_PCT:
        position_pct = MIN_POSITION_PCT
        position_value = capital * (MIN_POSITION_PCT / 100)
        clamped = True

    # عدد الأسهم
    shares = int(position_value / entry_price)

    reason = f'risk={risk_per_trade_pct:.1f}% stop_dist={stop_distance_pct:.2f}% → pos={position_pct:.1f}%'
    if clamped:
        reason += ' (clamped)'

    return {
        'action': 'enter' if shares > 0 else 'skip',
        'reason': reason,
        'shares': shares,
        'position_value': round(position_value, 2),
        'position_pct': round(position_pct, 2),
        'risk_amount': round(risk_amount, 2),
        'risk_per_trade_pct': round(risk_per_trade_pct, 2),
        'stop_distance_pct': round(stop_distance_pct, 2),
    }


def calculate_position_size_for_prediction(
    entry_price: float,
    stop_price: float,
    confidence: float = 1.0,
    capital: Optional[float] = None,
) -> Dict[str, Any]:
    """احسب حجم المركز لتوقع معين (wrapper مناسب للـ predictions).

    Args:
        entry_price: سعر الدخول من الـ prediction.
        stop_price: سعر الوقف من الـ prediction.
        confidence: درجة الثقة (0-1).
        capital: رأس المال (لو None، بـ يقرأ من settings أو default 100,000).

    Returns:
        نفس output calculate_risk_based_position + capital_used.
    """
    if capital is None:
        capital = _get_setting('default_capital', 100000.0)

    result = calculate_risk_based_position(
        capital=capital,
        entry_price=entry_price,
        stop_price=stop_price,
        confidence=confidence,
    )
    result['capital_used'] = capital
    return result
