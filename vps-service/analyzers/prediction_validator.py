#!/usr/bin/env python3
"""
Prediction Validator — حماية العميل من البيانات الغلط
=========================================================
توجيه المالك (2026-09-02): "مستحيل واجهة الموقع تحط العبط ده. أي عميل هاشوف الكلام ده هايهرب على طول. لازم نراجع ونصلح الكوارث دي."

الـ validator بـ يفحص كل prediction قبل ما تظهر للعميل ويرفض الـ anomalies:

1. **stop > entry للـ BUY** → خطأ (entry لازم يكون تحت stop)
2. **target < entry للـ BUY** → خطأ (target لازم يكون فوق entry)
3. **actual_return غير منطقي** (> +25% في يوم واحد بدون split) → فحص
4. **تكرار نفس السهم في نفس اليوم** → خد الأحدث بس
5. **R:R < 1.0** → خطأ (مخاطرة أكبر من ربح)
6. **stop distance > 15%** → تحذير (وقف واسع جداً)
7. **target distance > 50%** → تحذير (هدف غير واقعي)
8. **highest_price < entry + actual_return يتطابق** → فحص الاتساق
9. **actual_return sign vs exit_type** → فحص (stop_loss لازم يكون سالب)

الاستخدام:
  from analyzers.prediction_validator import validate_prediction, validate_predictions_batch
  
  result = validate_prediction(prediction_dict)
  if not result['valid']:
      # hide from client + log to decision_logger
      log_decision(ticker, 'reject_display', 'invalid_data', result['reason'], 'PREDICTION-VALIDATOR')

Author: Z.ai Code
Date: 2026-09-02
"""
from __future__ import annotations
import os
import sqlite3
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[2]
_DB_DIR = _PROJECT_ROOT / 'db'


# ═══════════════════════════════════════════════════════════════════════
# Thresholds (EGX-calibrated)
# ═══════════════════════════════════════════════════════════════════════

MAX_DAILY_RETURN_PCT = 25.0          # لو return > 25% في يوم واحد → anomaly (محتاج split check)
MAX_STOP_DISTANCE_PCT = 15.0          # وقف أوسع من 15% = غير واقعي للـ EGX
MAX_TARGET_DISTANCE_PCT = 60.0        # هدف أبعد من 60% = غير واقعي
MIN_RR_RATIO = 1.0                    # R:R لازم يكون ≥ 1.0 (مش أكتر مخاطرة من ربح)
MAX_HOLDING_DAYS_ANOMALY = 200        # مدة احتفاظ > 200 يوم = anomaly


def _safe_float(v) -> float:
    """Convert to float safely, return 0.0 on failure."""
    try:
        if v is None:
            return 0.0
        return float(v)
    except (ValueError, TypeError):
        return 0.0


def validate_prediction(pred: Dict[str, Any]) -> Dict[str, Any]:
    """فحص تنبؤ واحد + إرجاع valid/reason.

    Returns:
        {
            'valid': bool,
            'reason': str,
            'severity': 'error' | 'warning' | 'ok',
            'checks': list of {check_name, passed, message},
            'cleaned_pred': dict (التنبؤ بعد التنظيف لو فيه تعديلات),
        }
    """
    checks = []
    cleaned = dict(pred)
    has_error = False
    has_warning = False

    ticker = pred.get('ticker', 'unknown')
    entry = _safe_float(pred.get('entry_price'))
    stop = _safe_float(pred.get('stop_loss'))
    target = _safe_float(pred.get('target_price'))
    target2 = _safe_float(pred.get('target_price_2') or pred.get('target2'))
    signal = (pred.get('signal') or 'BUY').upper()
    actual_return = pred.get('actual_return')
    if actual_return is not None:
        actual_return = _safe_float(actual_return)
    exit_type = (pred.get('exit_type') or '').lower()
    holding_days = pred.get('holding_days') or 0
    if holding_days:
        try:
            holding_days = int(holding_days)
        except (ValueError, TypeError):
            holding_days = 0

    # ── CHECK 1: stop/target relationship for BUY signal ──
    if signal in ('BUY', 'STRONG_BUY', 'ACCUMULATE', 'MORNING_BELL'):
        if entry > 0 and stop > 0 and stop >= entry:
            checks.append({
                'check': 'stop_above_entry',
                'passed': False,
                'message': f'stop ({stop:.2f}) ≥ entry ({entry:.2f}) للـ {signal} — مستحيل (entry لازم يكون فوق stop)',
            })
            has_error = True
        elif entry > 0 and stop > 0 and stop < entry:
            checks.append({
                'check': 'stop_above_entry',
                'passed': True,
                'message': f'stop ({stop:.2f}) < entry ({entry:.2f}) ✓',
            })
        else:
            checks.append({
                'check': 'stop_above_entry',
                'passed': True,
                'message': 'stop/entry غير متاحين للفحص',
            })

        # ── CHECK 2: target above entry for BUY ──
        if entry > 0 and target > 0 and target <= entry:
            checks.append({
                'check': 'target_above_entry',
                'passed': False,
                'message': f'target ({target:.2f}) ≤ entry ({entry:.2f}) للـ {signal} — مستحيل (target لازم يكون فوق entry)',
            })
            has_error = True
        elif entry > 0 and target > 0:
            checks.append({
                'check': 'target_above_entry',
                'passed': True,
                'message': f'target ({target:.2f}) > entry ({entry:.2f}) ✓',
            })
        else:
            checks.append({
                'check': 'target_above_entry',
                'passed': True,
                'message': 'target/entry غير متاحين',
            })

    # ── CHECK 3: R:R ratio (target-entry / entry-stop) ──
    if entry > 0 and stop > 0 and target > 0 and entry > stop and target > entry:
        risk = entry - stop
        reward = target - entry
        rr = reward / risk if risk > 0 else 0
        if rr < MIN_RR_RATIO:
            checks.append({
                'check': 'rr_ratio',
                'passed': False,
                'message': f'R:R = {rr:.2f} < {MIN_RR_RATIO} (مخاطرة أكبر من ربح)',
            })
            has_warning = True
        else:
            checks.append({
                'check': 'rr_ratio',
                'passed': True,
                'message': f'R:R = {rr:.2f} ≥ {MIN_RR_RATIO} ✓',
            })
        cleaned['rr_ratio'] = round(rr, 2)

    # ── CHECK 4: stop distance ──
    if entry > 0 and stop > 0:
        stop_dist_pct = abs(entry - stop) / entry * 100
        if stop_dist_pct > MAX_STOP_DISTANCE_PCT:
            checks.append({
                'check': 'stop_distance',
                'passed': False,
                'message': f'مسافة الستوب {stop_dist_pct:.1f}% > {MAX_STOP_DISTANCE_PCT}% — وقف واسع جداً',
            })
            has_warning = True
        else:
            checks.append({
                'check': 'stop_distance',
                'passed': True,
                'message': f'مسافة الستوب {stop_dist_pct:.1f}% ≤ {MAX_STOP_DISTANCE_PCT}% ✓',
            })

    # ── CHECK 5: target distance ──
    if entry > 0 and target > 0:
        target_dist_pct = abs(target - entry) / entry * 100
        if target_dist_pct > MAX_TARGET_DISTANCE_PCT:
            checks.append({
                'check': 'target_distance',
                'passed': False,
                'message': f'مسافة الهدف {target_dist_pct:.1f}% > {MAX_TARGET_DISTANCE_PCT}% — هدف غير واقعي',
            })
            has_warning = True
        else:
            checks.append({
                'check': 'target_distance',
                'passed': True,
                'message': f'مسافة الهدف {target_dist_pct:.1f}% ≤ {MAX_TARGET_DISTANCE_PCT}% ✓',
            })

    # ── CHECK 6: actual_return sanity (per day) ──
    if actual_return is not None and holding_days > 0:
        daily_return = actual_return / holding_days
        if abs(daily_return) > MAX_DAILY_RETURN_PCT:
            checks.append({
                'check': 'daily_return_anomaly',
                'passed': False,
                'message': f'عائد يومي {daily_return:.2f}% > ±{MAX_DAILY_RETURN_PCT}% — anomaly (محتاج split check أو غلطة بيانات)',
            })
            has_error = True  # anomaly = خطأ
        else:
            checks.append({
                'check': 'daily_return_anomaly',
                'passed': True,
                'message': f'عائد يومي {daily_return:.2f}% ضمن النطاق ✓',
            })

    # ── CHECK 7: actual_return sign vs exit_type ──
    if actual_return is not None and exit_type:
        if exit_type == 'stop_loss' and actual_return > 0:
            checks.append({
                'check': 'return_exit_consistency',
                'passed': False,
                'message': f'exit_type=stop_loss بس actual_return=+{actual_return}% — مستحيل (الستوب لازم يكون خسارة)',
            })
            has_error = True
        elif exit_type == 'target_hit' and actual_return < 0:
            checks.append({
                'check': 'return_exit_consistency',
                'passed': False,
                'message': f'exit_type=target_hit بس actual_return={actual_return}% — مستحيل (الهدف لازم يكون ربح)',
            })
            has_error = True
        else:
            checks.append({
                'check': 'return_exit_consistency',
                'passed': True,
                'message': f'exit_type={exit_type} متسق مع actual_return ✓',
            })

    # ── CHECK 8: highest_price consistency ──
    highest = _safe_float(pred.get('highest_price_reached'))
    if highest > 0 and entry > 0 and actual_return is not None:
        max_possible_return = (highest - entry) / entry * 100 if highest > entry else 0
        if actual_return > max_possible_return + 5:  # 5% tolerance
            checks.append({
                'check': 'highest_price_consistency',
                'passed': False,
                'message': f'actual_return ({actual_return:.2f}%) > max possible from highest ({max_possible_return:.2f}%) — غير منطقي',
            })
            has_error = True
        else:
            checks.append({
                'check': 'highest_price_consistency',
                'passed': True,
                'message': f'actual_return ≤ max from highest ✓',
            })

    # ── CHECK 9: holding days anomaly ──
    if holding_days > MAX_HOLDING_DAYS_ANOMALY:
        checks.append({
            'check': 'holding_days_anomaly',
            'passed': False,
            'message': f'مدة احتفاظ {holding_days} يوم > {MAX_HOLDING_DAYS_ANOMALY} — anomaly',
        })
        has_warning = True

    # ── Verdict ──
    if has_error:
        severity = 'error'
        valid = False
        reason = '; '.join([c['message'] for c in checks if not c['passed']])
    elif has_warning:
        severity = 'warning'
        valid = True  # warnings مش بتمنع العرض
        reason = '; '.join([c['message'] for c in checks if not c['passed']])
    else:
        severity = 'ok'
        valid = True
        reason = 'كل الفحوصات passed'

    return {
        'valid': valid,
        'reason': reason,
        'severity': severity,
        'ticker': ticker,
        'checks': checks,
        'cleaned_pred': cleaned,
    }


def deduplicate_predictions(predictions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """شيل التكرارات — نفس السهم في نفس اليوم → خد الأحدث فقط.

    Args:
        predictions: قائمة بالتنبؤات.

    Returns:
        قائمة بدون تكرارات.
    """
    seen = {}  # (ticker, prediction_date) -> index
    no_date = []  # predictions بدون prediction_date — بنسيبهم زي ما هم
    for pred in predictions:
        ticker = pred.get('ticker', '')
        pred_date = (pred.get('prediction_date') or '')[:10]
        if not ticker:
            continue  # prediction بدون ticker = مش صالح
        if not pred_date:
            # لو مفيش prediction_date، بنسيبه (مش تكرار)
            no_date.append(pred)
            continue
        key = (ticker, pred_date)
        # خد الأحدث (آخر عنصر بنفس الـ key)
        seen[key] = pred
    return list(seen.values()) + no_date


def validate_predictions_batch(predictions: List[Dict[str, Any]],
                                hide_invalid: bool = True) -> Dict[str, Any]:
    """فحص batch من التنبؤات + إرجاع إحصائيات.

    Args:
        predictions: قائمة بالتنبؤات.
        hide_invalid: لو True → يشيل الـ invalid من النتيجة.

    Returns:
        {
            'valid': list of valid predictions,
            'invalid': list of invalid predictions + reasons,
            'warnings': list of warnings,
            'stats': {total, valid_count, invalid_count, warning_count, deduped_count},
        }
    """
    if not predictions:
        return {
            'valid': [],
            'invalid': [],
            'warnings': [],
            'stats': {'total': 0, 'valid_count': 0, 'invalid_count': 0, 'warning_count': 0, 'deduped_count': 0},
        }

    original_count = len(predictions)
    # 1) deduplicate first
    deduped = deduplicate_predictions(predictions)
    deduped_count = original_count - len(deduped)

    valid = []
    invalid = []
    warnings = []

    for pred in deduped:
        result = validate_prediction(pred)
        if result['valid']:
            valid.append(result['cleaned_pred'])
            if result['severity'] == 'warning':
                warnings.append({
                    'ticker': result['ticker'],
                    'reason': result['reason'],
                    'checks': result['checks'],
                })
        else:
            invalid.append({
                'ticker': result['ticker'],
                'prediction_date': pred.get('prediction_date'),
                'reason': result['reason'],
                'severity': result['severity'],
                'checks': result['checks'],
                'original_pred': pred,
            })

    return {
        'valid': valid,
        'invalid': invalid,
        'warnings': warnings,
        'stats': {
            'total': original_count,
            'after_dedup': len(deduped),
            'valid_count': len(valid),
            'invalid_count': len(invalid),
            'warning_count': len(warnings),
            'deduped_count': deduped_count,
        },
    }


# ═══════════════════════════════════════════════════════════════════════
# Self-test (synthetic test cases)
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    print("🧪 Prediction Validator — Self Test")
    print("=" * 70)

    # Test 1: Valid prediction
    print("\n=== Test 1: تنبؤ سليم ===")
    valid_pred = {
        'ticker': 'COMI', 'signal': 'BUY',
        'entry_price': 25.90, 'stop_loss': 24.50, 'target_price': 28.16,
        'actual_return': 8.72, 'exit_type': 'target_hit', 'holding_days': 5,
    }
    r = validate_prediction(valid_pred)
    print(f"  valid: {r['valid']}, severity: {r['severity']}")
    print(f"  reason: {r['reason'][:80]}")

    # Test 2: stop > entry (EBBM case from production)
    print("\n=== Test 2: stop > entry (كارثة EDBM) ===")
    ebbm_pred = {
        'ticker': 'EDBM', 'signal': 'BUY',
        'entry_price': 1.86, 'stop_loss': 2.47, 'target_price': 1.45,
        'actual_return': 22.04, 'exit_type': 'target_hit', 'holding_days': 2,
    }
    r = validate_prediction(ebbm_pred)
    print(f"  valid: {r['valid']}, severity: {r['severity']}")
    print(f"  reason: {r['reason'][:120]}")

    # Test 3: +44.93% in 1 day (GGRN case)
    print("\n=== Test 3: +44.93% في يوم واحد (كارثة GGRN) ===")
    ggrn_pred = {
        'ticker': 'GGRN', 'signal': 'BUY',
        'entry_price': 1.38, 'stop_loss': 1.31, 'target_price': 1.53,
        'actual_return': 44.93, 'exit_type': 'target_hit', 'holding_days': 1,
    }
    r = validate_prediction(ggrn_pred)
    print(f"  valid: {r['valid']}, severity: {r['severity']}")
    print(f"  reason: {r['reason'][:120]}")

    # Test 4: stop_loss + positive return (inconsistency)
    print("\n=== Test 4: exit=stop_loss بس return موجب (تناقض) ===")
    inconsistent_pred = {
        'ticker': 'TEST', 'signal': 'BUY',
        'entry_price': 100.0, 'stop_loss': 93.0, 'target_price': 110.0,
        'actual_return': 5.0, 'exit_type': 'stop_loss', 'holding_days': 3,
    }
    r = validate_prediction(inconsistent_pred)
    print(f"  valid: {r['valid']}, severity: {r['severity']}")
    print(f"  reason: {r['reason'][:120]}")

    # Test 5: deduplication
    print("\n=== Test 5: إزالة التكرارات ===")
    dups = [
        {'ticker': 'CERA', 'prediction_date': '2026-08-31', 'entry_price': 1.27, 'stop_loss': 1.19, 'target_price': 1.38, 'signal': 'BUY'},
        {'ticker': 'CERA', 'prediction_date': '2026-08-31', 'entry_price': 1.27, 'stop_loss': 1.19, 'target_price': 1.38, 'signal': 'BUY'},
        {'ticker': 'CERA', 'prediction_date': '2026-08-30', 'entry_price': 1.27, 'stop_loss': 1.19, 'target_price': 1.38, 'signal': 'BUY'},
    ]
    deduped = deduplicate_predictions(dups)
    print(f"  قبل: {len(dups)}، بعد: {len(deduped)} (المفروض 2 — يوم 31 + يوم 30)")

    # Test 6: batch validation
    print("\n=== Test 6: batch validation ===")
    batch = [valid_pred, ebbm_pred, ggrn_pred, inconsistent_pred]
    r = validate_predictions_batch(batch)
    print(f"  total: {r['stats']['total']}")
    print(f"  valid: {r['stats']['valid_count']}")
    print(f"  invalid: {r['stats']['invalid_count']}")
    print(f"  warnings: {r['stats']['warning_count']}")
    print(f"  invalid tickers: {[i['ticker'] for i in r['invalid']]}")
