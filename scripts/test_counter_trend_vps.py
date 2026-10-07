#!/usr/bin/env python3
"""
TEST COUNTER-TREND MODE — للـ VPS الإنتاجي
=============================================
ده script بيـ test الـ counter-trend logic بـ scenarios واضحة.
أنت اللي بـ runه وتشوف النتيجة بنفسك — مش محتاج تصدقني.

Usage:
    cd /root/GLMinvestment
    python3 scripts/test_counter_trend_vps.py

الـ script بـ يعمل:
1. ملف رادار وهمي (بـ سهم TESTACC في A_pre_surge)
2. يـ run 4 scenarios على الـ counter-trend logic
3. يطبع النتيجة: PASS / FAIL لكل سيناريو
4. ينظف وراه (يمسح الملف الوهمي)
"""
import sys
import json
import shutil
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))
sys.path.insert(0, str(PROJECT_ROOT))

from analyzers.institutional_decision_engine import (
    _compute_signal_final,
    _count_strong_evidences,
)
from analyzers.radar_integration import clear_cache


# ═════════════════════════════════════════════════════════════════
# Setup: ملف رادار وهمي للسهم TESTACC (A_pre_surge)
# ═════════════════════════════════════════════════════════════════
def setup_fake_radar():
    today = datetime.now().strftime("%Y%m%d")
    radar_path = PROJECT_ROOT / 'scripts' / 'output' / f'maker_radar_EGX_{today}.json'
    backup_path = radar_path.with_suffix('.json.bak')

    # احفظ الـ file الحقيقي لو موجود
    if radar_path.exists():
        shutil.copy2(radar_path, backup_path)
        print(f'[setup] تم عمل backup للرادار الحقيقي: {backup_path.name}')

    fake_radar = {
        'generated_at': datetime.now().isoformat(),
        'market': 'EGX',
        'under_microscope': [
            {'ticker': 'TESTACC', 'path': 'A_pre_surge', 'current_price': 85.0},
        ],
        'quiet_list': [],
        'pre_surge_list': [{'ticker': 'TESTACC', 'path': 'A_pre_surge'}],
        'explosive_list': [],
        'early_break_list': [],
    }
    radar_path.parent.mkdir(parents=True, exist_ok=True)
    with open(radar_path, 'w', encoding='utf-8') as f:
        json.dump(fake_radar, f, ensure_ascii=False, indent=2)
    print(f'[setup] تم إنشاء رادار وهمي: {radar_path.name}')
    return radar_path, backup_path


def cleanup(radar_path, backup_path):
    if backup_path and backup_path.exists():
        shutil.move(str(backup_path), str(radar_path))
        print(f'[cleanup] تم استرجاع الرادار الحقيقي')
    elif radar_path.exists():
        radar_path.unlink()
        print(f'[cleanup] تم حذف الرادار الوهمي')
    clear_cache()


# ═════════════════════════════════════════════════════════════════
# Scenarios
# ═════════════════════════════════════════════════════════════════
def build_proofs(benchmark_passed=False):
    """6 proofs — 4 strong + 2 weak."""
    return [
        {'name': 'trend', 'passed': False, 'detail': 'تحت SMA200'},
        {'name': 'maker_absorption', 'passed': True, 'detail': 'تجميع مؤسسي قوي'},
        {'name': 'dna_bullish', 'passed': True, 'detail': 'DNA صاعد'},
        {'name': 'fundamentals', 'passed': True, 'detail': 'أساسيات ≥ 60'},
        {'name': 'sector', 'passed': True, 'detail': 'القطاع إيجابي'},
        {'name': 'benchmark', 'passed': benchmark_passed, 'detail': f'RS {"إيجابي" if benchmark_passed else "سلبي"}'},
    ]


def run_scenario(name, closes, sma20, benchmark_change, breadth_pct,
                 entry_zone_pct, rr_ratio, rsi, stock_roc,
                 expected_signal_keyword, expected_description):
    """Run one scenario and print PASS/FAIL."""
    print(f'\n{"=" * 78}')
    print(f'SCENARIO: {name}')
    print(f'{"=" * 78}')

    # Pre-compute debug info
    lookback = min(len(closes), 252)
    low = min(closes[-lookback:]) if len(closes) >= 10 else None
    price = closes[-1]
    dist_from_low = ((price - low) / low * 100.0) if low and low > 0 else None
    rs = stock_roc - benchmark_change if stock_roc is not None else None

    print(f'  السعر الحالي: {price:.2f}')
    print(f'  SMA20: {sma20:.2f}  ({"فوق" if price > sma20 else "تحت"})')
    print(f'  low (lookback {lookback}d): {low:.2f}  ({dist_from_low:.2f}% من الـ low)' if low else '  low: —')
    print(f'  stock_roc (14d): {stock_roc:.2f}%')
    print(f'  benchmark_change: {benchmark_change:.2f}%')
    print(f'  RS = stock_roc - benchmark = {rs:.2f}%')
    print(f'  entry_zone_pct: {entry_zone_pct}')
    print(f'  R/R: {rr_ratio}')
    print(f'  breadth_pct: {breadth_pct}')

    proofs = build_proofs(benchmark_passed=(rs > 0))
    evidence = _count_strong_evidences(proofs)
    print(f'  strong_count: {evidence["strong_count"]}')
    print(f'  benchmark_passed: {evidence["benchmark_passed"]}')

    clear_cache()
    result = _compute_signal_final(
        tech_score=78,
        maker_state={'state': 'absorption'},
        flight_state={'state': 'coiling'},
        dynamic_thresh=75.0,
        market_regime={'regime': 'bear', 'confidence': 0.8, 'max_picks_per_day': 2},
        proofs=proofs,
        kill_filter_result={'passed': True},
        benchmark_change=benchmark_change,
        breadth_pct=breadth_pct,
        ticker='TESTACC',
        closes=closes,
        sma20=sma20,
        rsi=rsi,
        entry_zone_pct=entry_zone_pct,
        rr_ratio=rr_ratio,
        stock_roc=stock_roc,
    )

    signal, path, color = result
    print(f'\n  النتيجة:')
    print(f'    Signal: {signal}')
    print(f'    Path:   {path[:150]}')
    print(f'\n  المتوقع: {expected_description}')
    print(f'    keyword="{expected_signal_keyword}"')

    if expected_signal_keyword in signal:
        print(f'\n  ✅ PASS')
        return True
    else:
        print(f'\n  ❌ FAIL — النتيجة غلط!')
        return False


def main():
    print('=' * 78)
    print('🧪 TEST COUNTER-TREND MODE — للـ VPS الإنتاجي')
    print('الـ script ده بيـ test الـ counter-trend logic بـ scenarios واضحة')
    print('أنت اللي بـ runه وتشوف النتيجة بنفسك')
    print('=' * 78)

    radar_path, backup_path = setup_fake_radar()

    results = []

    # ─────────────────────────────────────────────────────────────
    # Scenario 1: PASS — فرصة شراء حقيقية
    # سهم نزل من 88 لـ 80 (low)، بعدها ارتد لـ 85 (قرب الدعم)
    # stock_roc = -1.73%, benchmark = -1.5% → RS = -0.23% (ضمن -3%)
    # السعر تحت SMA20 بس قرب low_52w → فرصة buy-the-dip
    # ─────────────────────────────────────────────────────────────
    closes_1 = [88, 87.5, 87, 86.5, 86, 85.5, 85, 84.5, 84, 83, 82, 81, 80, 81, 82, 83, 84, 85]
    stock_roc_1 = (closes_1[-1] - closes_1[-15]) / closes_1[-15] * 100
    r1 = run_scenario(
        name='1. PASS — فرصة شراء حقيقية (buy-the-dip)',
        closes=closes_1,
        sma20=87.0,           # السعر تحته (85 < 87)
        benchmark_change=-1.5, # السوق نزل 1.5%
        breadth_pct=35.0,     # bear market
        entry_zone_pct=15.0,  # NEAR_BOTTOM
        rr_ratio=3.0,
        rsi=42.0,
        stock_roc=stock_roc_1,
        expected_signal_keyword='شراء',
        expected_description='🟢 شراء (فرصة في سوق هابط) — السهم قرب دعم + تجميع مؤكد',
    )
    results.append(('1', r1))

    # ─────────────────────────────────────────────────────────────
    # Scenario 2: WAIT — RS سلبي جداً (أضعف من المؤشر بـ أكتر من 3%)
    # نفس السهم بس السوق صاعد 2% → RS = -3.73% (أكتر من -3%)
    # ─────────────────────────────────────────────────────────────
    r2 = run_scenario(
        name='2. WAIT — RS سلبي جداً (أضعف من المؤشر بـ أكتر من 3%)',
        closes=closes_1,
        sma20=87.0,
        benchmark_change=2.0,  # السوق صاعد 2% بس السهم نازل → RS ضعيف جداً
        breadth_pct=35.0,
        entry_zone_pct=15.0,
        rr_ratio=3.0,
        rsi=42.0,
        stock_roc=stock_roc_1,
        expected_signal_keyword='انتظر',
        expected_description='🟡 انتظر — السهم أضعف من المؤشر بـ أكتر من 3%',
    )
    results.append(('2', r2))

    # ─────────────────────────────────────────────────────────────
    # Scenario 3: WAIT — سهم بعيد عن أي دعم (في نص الـ range)
    # ─────────────────────────────────────────────────────────────
    closes_3 = [100, 99, 98, 97, 96, 95, 94, 93, 92, 91, 90, 89, 88, 87, 86, 85]
    stock_roc_3 = (closes_3[-1] - closes_3[-15]) / closes_3[-15] * 100
    r3 = run_scenario(
        name='3. WAIT — سهم بعيد عن أي دعم',
        closes=closes_3,
        sma20=90.0,
        benchmark_change=-1.5,
        breadth_pct=35.0,
        entry_zone_pct=50.0,  # MIDDLE — بعيد عن الـ low
        rr_ratio=3.0,
        rsi=42.0,
        stock_roc=stock_roc_3,
        expected_signal_keyword='انتظر',
        expected_description='🟡 انتظر — السعر تحت SMA20 وبعيد عن دعم 52w',
    )
    results.append(('3', r3))

    # ─────────────────────────────────────────────────────────────
    # Scenario 4: WAIT — NEAR_TOP (سهم عند 85% من مدى 52 أسبوع)
    # ─────────────────────────────────────────────────────────────
    r4 = run_scenario(
        name='4. WAIT — NEAR_TOP (سهم عند 85% من مدى 52 أسبوع)',
        closes=closes_1,
        sma20=87.0,
        benchmark_change=-1.5,
        breadth_pct=35.0,
        entry_zone_pct=85.0,  # NEAR_TOP
        rr_ratio=3.0,
        rsi=42.0,
        stock_roc=stock_roc_1,
        expected_signal_keyword='انتظر',
        expected_description='🟡 انتظر — السهم عند NEAR_TOP (85%)',
    )
    results.append(('4', r4))

    # ─────────────────────────────────────────────────────────────
    # Summary
    # ─────────────────────────────────────────────────────────────
    print('\n')
    print('=' * 78)
    print('📋 SUMMARY')
    print('=' * 78)
    passed = 0
    failed = 0
    for sid, ok in results:
        status = '✅ PASS' if ok else '❌ FAIL'
        print(f'  Scenario {sid}: {status}')
        if ok:
            passed += 1
        else:
            failed += 1
    print()
    print(f'  Total: {passed} passed, {failed} failed')
    print()
    if failed == 0:
        print('  🎉 كل الـ scenarios عدّت — الـ counter-trend mode شغّال صح')
    else:
        print(f'  ⚠️  فيه {failed} scenario فشل — فيه bug محتاج fix')
    print('=' * 78)

    cleanup(radar_path, backup_path)
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
