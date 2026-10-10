#!/usr/bin/env python3
"""
RADAR GATE QUICK TEST
=====================
Owner: اختبار سريع للـ radar HARD GATE على 3 أسهم معروفين بدون
تشغيل الـ daily_predictor.py كامل (اللي بياخد وقت طويل).

Usage:
    python3 scripts/test_radar_gate.py
    python3 scripts/test_radar_gate.py AMOC COMI HRHO
"""
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))
sys.path.insert(0, str(PROJECT_ROOT))


def main():
    from analyzers.radar_integration import (
        radar_data_available,
        is_radar_strong_accumulation,
        get_radar_state,
        get_radar_boost,
        check_exit_radar_conflict,
        clear_cache,
    )

    # Default test tickers (known radar states from previous test)
    tickers = sys.argv[1:] if len(sys.argv) > 1 else ['AMOC', 'COMI', 'EKRS', 'EFID', 'HRHO']

    clear_cache()
    print('=' * 78)
    print('🛰️ RADAR HARD GATE — Quick Test')
    print('=' * 78)
    avail = radar_data_available('EGX')
    print(f'radar_data_available(EGX): {avail}')
    if not avail:
        print('⚠️  الرادار مش متاح — الـ gate هيـ skip (safe-by-design)')
        return

    print()
    print(f'{"Ticker":<10} {"Radar State":<32} {"Strong?":<10} {"Boost":<7} {"Exit Radar":<15} {"Gate Verdict":<20}')
    print('-' * 78)

    pass_count = 0
    reject_count = 0
    for ticker in tickers:
        clear_cache()
        state = get_radar_state(ticker, 'EGX') or '—'
        is_strong = is_radar_strong_accumulation(ticker, 'EGX')
        boost = get_radar_boost(ticker, 'EGX')
        exit_info = check_exit_radar_conflict(ticker)
        exit_str = exit_info['path'] or 'clean'

        if exit_info['blocked']:
            verdict = '🚫 EXIT-BLOCK'
        elif is_strong:
            verdict = '✅ PASS'
            pass_count += 1
        else:
            verdict = '❌ REJECT'
            reject_count += 1

        strong_str = 'YES' if is_strong else 'no'
        print(f'{ticker:<10} {state:<32} {strong_str:<10} {boost:<7} {exit_str:<15} {verdict}')

    print()
    print('=' * 78)
    print(f'📊 SUMMARY: {pass_count} PASS, {reject_count} REJECT, {len(tickers)} total')
    print('=' * 78)

    if pass_count > 0:
        print()
        print('✅ الأسهم اللي هتدخل التوقعات (عدّت الـ radar HARD GATE):')
        for ticker in tickers:
            clear_cache()
            if is_radar_strong_accumulation(ticker, 'EGX'):
                state = get_radar_state(ticker, 'EGX')
                boost = get_radar_boost(ticker, 'EGX')
                print(f'   • {ticker}: {state} (+{boost} score boost)')


if __name__ == '__main__':
    main()
