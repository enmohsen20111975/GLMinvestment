"""
entry_gate.py — Entry Gate الشامل لتنظيف منطق الدخول (EGX-STRATEGY-FINAL)
============================================================================
EGX-STRATEGY-FINAL (2026-08-30): فلتر دخول شامل بيرفض الإشارات الضعيفة.

المطلوب من المالك:
  "شروط الدخول الإلزامية (كلها مع بعض):
   - evidence_count ≥ 3
   - السعر فوق SMA50 أو قريب جدًا مع تأكيد قوة
   - Relative Strength (RS) > 1.0
   - مش في Deep Correction
   - مش ممتد (Don't Chase)
   - R/R ≥ 1.8
   - السيولة مقبولة
   - السهم مصري فقط (EGX Gate موجود)
  فلتر السياق:
   - لو السوق العام هابط بوضوح → ارفض
   - لو القطاع بارد → ارفض"

المنطق:
  check_entry_gate(prediction_data) → {passed, reasons_passed, reasons_failed, score}

  كل شرط بيرجع:
    - 'passed': True/False
    - 'reason': وصف
    - 'weight': أهمية (1-3)

  الـ gate بـ يـ pass لو كل الشروط الإلزامية passed.

الاستخدام:
  from utils.entry_gate import check_entry_gate

  result = check_entry_gate({
      'ticker': 'COMI',
      'entry_price': 100,
      'target_price': 112,
      'stop_price': 94,
      'evidence_count': 4,
      'proofs': {'benchmark': '✅', 'sector': '✅', 'trend': '✅'},
      'closes': [95, 96, 97, 98, 99, 100],
      'volumes': [1000, 1100, 1200, 1300, 1400, 1500],
      'market_regime_trend': 'bull',
  })
  if not result['passed']:
      continue  # skip
"""
from __future__ import annotations
from typing import Dict, Any, Optional, List
import re


# ─── العتبات ────────────────────────────────────────────────────────────────
MIN_EVIDENCE_COUNT = 3
MIN_RR_RATIO = 1.8
MIN_RS = 1.0  # Relative Strength (stock_roc - benchmark_change)
DEEP_CORRECTION_DROP_PCT = 12.0
EXTENDED_CHASE_3D_PCT = 12.0
EXTENDED_CHASE_5D_PCT = 15.0
MIN_VOLUME = 1000  # minimum volume (zero-volume guard)
MIN_TURNOVER_EGP = 50_000  # minimum turnover (liquidity)
SMA50_PROXIMITY_PCT = 2.0  # within 2% below SMA50 = "قريب جدًا"


def _safe_float(val, default=0.0):
    if val is None:
        return default
    try:
        f = float(val)
        return f if f == f else default
    except (TypeError, ValueError):
        return default


def _check_evidence_count(evidence_count: int) -> Dict[str, Any]:
    """شرط 1: evidence_count ≥ 3."""
    ev = int(evidence_count or 0)
    passed = ev >= MIN_EVIDENCE_COUNT
    return {
        'name': 'evidence_count',
        'passed': passed,
        'reason': f'evidence={ev}/6 (مطلوب ≥ {MIN_EVIDENCE_COUNT})',
        'weight': 3,
    }


def _check_rr(entry_price: float, target_price: float, stop_price: float) -> Dict[str, Any]:
    """شرط 2: R/R ≥ 1.8."""
    if entry_price <= 0 or stop_price <= 0 or target_price <= 0:
        return {'name': 'rr_ratio', 'passed': False, 'reason': 'مدخلات غير صالحة', 'weight': 3}
    if stop_price >= entry_price or target_price <= entry_price:
        return {'name': 'rr_ratio', 'passed': False, 'reason': 'هندسة معكوسة', 'weight': 3}
    risk = entry_price - stop_price
    reward = target_price - entry_price
    rr = reward / risk if risk > 0 else 0
    passed = rr >= MIN_RR_RATIO
    return {
        'name': 'rr_ratio',
        'passed': passed,
        'reason': f'R:R={rr:.2f} (مطلوب ≥ {MIN_RR_RATIO})',
        'weight': 3,
    }


def _check_above_sma50(closes: List[float]) -> Dict[str, Any]:
    """شرط 3: السعر فوق SMA50 أو قريب جدًا مع تأكيد قوة."""
    if not closes or len(closes) < 50:
        return {'name': 'sma50', 'passed': False, 'reason': 'بيانات غير كافية لـ SMA50', 'weight': 2}
    sma50 = sum(closes[-50:]) / 50
    price = closes[-1]
    if price > sma50:
        return {'name': 'sma50', 'passed': True, 'reason': f'فوق SMA50 ({price:.2f} > {sma50:.2f})', 'weight': 2}
    # قريب جدًا (within 2% below)
    dist_pct = ((sma50 - price) / sma50) * 100
    if dist_pct <= SMA50_PROXIMITY_PCT:
        # تأكيد قوة: آخر 3 شموع صاعدة
        if len(closes) >= 4 and closes[-1] > closes[-2] > closes[-3]:
            return {'name': 'sma50', 'passed': True, 'reason': f'قريب من SMA50 ({dist_pct:.1f}%) + 3 شموع صاعدة', 'weight': 2}
        return {'name': 'sma50', 'passed': False, 'reason': f'قريب من SMA50 بس مفيش تأكيد قوة', 'weight': 2}
    return {'name': 'sma50', 'passed': False, 'reason': f'تحت SMA50 بـ {dist_pct:.1f}%', 'weight': 2}


def _check_relative_strength(proofs: Dict, stock_roc: float = 0, benchmark_change: float = 0) -> Dict[str, Any]:
    """شرط 4: RS > 1.0."""
    # لو في proofs.benchmark string
    benchmark_str = str(proofs.get('benchmark', '')).lower() if isinstance(proofs, dict) else ''
    if 'أقوى' in benchmark_str or 'outperform' in benchmark_str or '✅' in str(proofs.get('benchmark', '')):
        rs = stock_roc - benchmark_change
        return {'name': 'rs', 'passed': True, 'reason': f'RS={rs:+.2f}% (أقوى من السوق)', 'weight': 3}
    elif 'أضعف' in benchmark_str or 'underperform' in benchmark_str:
        rs = stock_roc - benchmark_change
        return {'name': 'rs', 'passed': False, 'reason': f'RS={rs:+.2f}% (أضعف من السوق)', 'weight': 3}
    else:
        # fallback: numeric check
        rs = stock_roc - benchmark_change
        passed = rs > MIN_RS
        return {'name': 'rs', 'passed': passed, 'reason': f'RS={rs:+.2f}% (مطلوب > {MIN_RS})', 'weight': 3}


def _check_deep_correction(closes: List[float]) -> Dict[str, Any]:
    """شرط 5: مش في Deep Correction (نزول > 12% من القمة + قيعان جديدة)."""
    if not closes or len(closes) < 40:
        return {'name': 'deep_correction', 'passed': True, 'reason': 'بيانات غير كافية', 'weight': 2}
    # أعلى قمة في آخر 40 يوم
    high_40 = max(closes[-40:])
    last = closes[-1]
    if high_40 <= 0:
        return {'name': 'deep_correction', 'passed': True, 'reason': 'بيانات غير صالحة', 'weight': 2}
    drop_pct = ((high_40 - last) / high_40) * 100
    # قيعان جديدة: آخر 3 شموع نازلة
    making_new_lows = len(closes) >= 4 and closes[-1] < closes[-2] < closes[-3]
    if drop_pct >= DEEP_CORRECTION_DROP_PCT and making_new_lows:
        return {'name': 'deep_correction', 'passed': False, 'reason': f'نزل {drop_pct:.1f}% + قيعان جديدة', 'weight': 2}
    return {'name': 'deep_correction', 'passed': True, 'reason': f'نزل {drop_pct:.1f}% (تحت {DEEP_CORRECTION_DROP_PCT}%)', 'weight': 2}


def _check_dont_chase(closes: List[float]) -> Dict[str, Any]:
    """شرط 6: Don't Chase (مش ممتد)."""
    if not closes or len(closes) < 6:
        return {'name': 'dont_chase', 'passed': True, 'reason': 'بيانات غير كافية', 'weight': 2}
    # ROC3
    if len(closes) >= 4 and closes[-4] > 0:
        roc3 = ((closes[-1] - closes[-4]) / closes[-4]) * 100
        if roc3 >= EXTENDED_CHASE_3D_PCT:
            return {'name': 'dont_chase', 'passed': False, 'reason': f'طلع {roc3:.1f}% في 3 أيام (مطاردة)', 'weight': 2}
    # ROC5
    if len(closes) >= 6 and closes[-6] > 0:
        roc5 = ((closes[-1] - closes[-6]) / closes[-6]) * 100
        if roc5 >= EXTENDED_CHASE_5D_PCT:
            return {'name': 'dont_chase', 'passed': False, 'reason': f'طلع {roc5:.1f}% في 5 أيام (مطاردة)', 'weight': 2}
    return {'name': 'dont_chase', 'passed': True, 'reason': 'مش ممتد', 'weight': 2}


def _check_liquidity(volumes: List[float], closes: List[float]) -> Dict[str, Any]:
    """شرط 7: السيولة مقبولة."""
    if not volumes or len(volumes) < 5:
        return {'name': 'liquidity', 'passed': False, 'reason': 'بيانات حجم غير كافية', 'weight': 1}
    last_vol = volumes[-1]
    if last_vol < MIN_VOLUME:
        return {'name': 'liquidity', 'passed': False, 'reason': f'volume={last_vol} < {MIN_VOLUME} (zero/ضعيف)', 'weight': 1}
    # turnover = volume × price
    last_price = closes[-1] if closes else 0
    turnover = last_vol * last_price
    if turnover < MIN_TURNOVER_EGP:
        return {'name': 'liquidity', 'passed': False, 'reason': f'turnover={turnover:.0f} EGP < {MIN_TURNOVER_EGP}', 'weight': 1}
    return {'name': 'liquidity', 'passed': True, 'reason': f'volume={last_vol} turnover={turnover:.0f} EGP', 'weight': 1}


def _check_market_context(market_regime: str, proofs: Dict) -> Dict[str, Any]:
    """شرط 8: فلتر السياق — السوق العام + القطاع."""
    regime = (market_regime or '').lower()
    sector_str = str(proofs.get('sector', '')).lower() if isinstance(proofs, dict) else ''

    # لو السوق هابط بوضوح → ارفض
    if regime in ('bear', 'strong_bear', 'distribution'):
        return {'name': 'market_context', 'passed': False, 'reason': f'السوق هابط ({regime})', 'weight': 3}
    # لو القطاع بارد
    if 'أحمر' in sector_str or 'بارد' in sector_str or 'ميت' in sector_str or 'dead' in sector_str:
        return {'name': 'market_context', 'passed': False, 'reason': f'القطاع بارد ({sector_str})', 'weight': 2}
    return {'name': 'market_context', 'passed': True, 'reason': f'السوق {regime} + القطاع OK', 'weight': 2}


def check_entry_gate(data: Dict[str, Any]) -> Dict[str, Any]:
    """فحص شامل لكل شروط الدخول.

    Args:
        data: dict فيه:
            - entry_price, target_price, stop_price
            - evidence_count
            - proofs (dict)
            - closes (list of float)
            - volumes (list of float)
            - market_regime_trend (str)
            - stock_roc (float, optional)
            - benchmark_change (float, optional)

    Returns:
        {
            'passed': bool,
            'reasons_passed': List[str],
            'reasons_failed': List[str],
            'checks': List[Dict],
            'score': int (عدد الشروط اللي passed),
            'total_checks': int,
        }
    """
    entry_price = _safe_float(data.get('entry_price'))
    target_price = _safe_float(data.get('target_price'))
    stop_price = _safe_float(data.get('stop_price'))
    evidence_count = int(data.get('evidence_count') or 0)
    proofs = data.get('proofs', {})
    closes = data.get('closes', [])
    volumes = data.get('volumes', [])
    market_regime = data.get('market_regime_trend', '')
    stock_roc = _safe_float(data.get('stock_roc'))
    benchmark_change = _safe_float(data.get('benchmark_change'))

    # تنفيذ كل الفحوصات
    checks = [
        _check_evidence_count(evidence_count),
        _check_rr(entry_price, target_price, stop_price),
        _check_above_sma50(closes),
        _check_relative_strength(proofs, stock_roc, benchmark_change),
        _check_deep_correction(closes),
        _check_dont_chase(closes),
        _check_liquidity(volumes, closes),
        _check_market_context(market_regime, proofs),
    ]

    # تجميع النتائج
    reasons_passed = [c['reason'] for c in checks if c['passed']]
    reasons_failed = [c['reason'] for c in checks if not c['passed']]
    score = sum(1 for c in checks if c['passed'])
    total = len(checks)

    # الـ gate بـ pass لو كل الشروط passed
    passed = len(reasons_failed) == 0

    return {
        'passed': passed,
        'reasons_passed': reasons_passed,
        'reasons_failed': reasons_failed,
        'checks': checks,
        'score': score,
        'total_checks': total,
    }
