#!/usr/bin/env python3
"""
Verify Learning Improvement
=============================
سكريبت التحقق اللي المالك بـ يجريه عشان يتأكد إن الإنتاج بـ يتطور بعد ما
يـ deploy الـ RL system.

الـ سكريبت ده بـ:
  1. يـ shapshot الـ win-lessons الموجودة في learned_lessons دلوقتي (BEFORE)
  2. يشغّل الـ multi-target backtest على البيانات التاريخية
  3. يحسب الـ win-side bias (target_raise + holdthrough) لو الـ lessons اتـ filled
  4. يـ simulate الـ backtest تاني WITH الـ bias (AFTER)
  5. يطبع جدول BEFORE vs AFTER واضح
  6. يخرج 0 لو فيه improvement، 1 لو regression

Usage:
  python3 scripts/verify_learning_improvement.py
  # exit code 0 = improvement detected, 1 = regression or no change

الـ owner لازم يـ run ده:
  - قبل الـ deploy (baseline)
  - بعد أسبوع من الـ deploy (بعد ما الـ daily_closer يـ record win-lessons)
  - النتيجة: قبل → bias=0 (مفيش lessons). بعد → bias>0 + improvement في الـ metrics
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path

_VPS_ROOT = Path(__file__).resolve().parent.parent
_PROJECT_ROOT = _VPS_ROOT.parent
if str(_VPS_ROOT) not in sys.path:
    sys.path.insert(0, str(_VPS_ROOT))

from scripts.multi_target_backtest import (  # noqa: E402
    run_backtest,
    print_report,
    DEFAULT_PREDICTIONS_DB,
    DEFAULT_PRICE_HISTORY_DB,
)
from utils.win_lesson_store import (  # noqa: E402
    compute_bounded_target_raise,
    compute_t1_holdthrough_bias,
    get_win_code_counts,
    ALL_WIN_CODES,
)

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

DEFAULT_OUTPUT = str(_VPS_ROOT / 'backtest_results' / f'verify_learning_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json')


def snapshot_win_lessons_state() -> Dict:
    """صوّر حالة الـ win-lessons دلوقتي (counts per persona)."""
    state = {'timestamp': datetime.now().isoformat(), 'personas': {}}
    for persona in ['gambler', 'balanced', 'conservative']:
        counts = get_win_code_counts(persona, days=90)
        state['personas'][persona] = {
            'counts': counts,
            'total_wins': sum(counts.values()),
            'target_raise_r': compute_bounded_target_raise(persona),
            'holdthrough_bias': compute_t1_holdthrough_bias(persona),
        }
    state['any_bias_active'] = any(
        p['target_raise_r'] > 0 or p['holdthrough_bias'] > 0
        for p in state['personas'].values()
    )
    return state


def print_before_after_table(before: Dict, after: Dict) -> None:
    """اطبع جدول BEFORE vs AFTER."""
    print("\n" + "=" * 80)
    print("  VERIFY LEARNING IMPROVEMENT — BEFORE vs AFTER")
    print("=" * 80)

    print("\n  ── Win-Lessons State (from learned_lessons table) ──")
    print(f"  Timestamp: {before['timestamp']}")
    print(f"  Any RL bias active: {before['any_bias_active']}")
    for persona in ['gambler', 'balanced', 'conservative']:
        p = before['personas'][persona]
        print(f"  {persona:>12s}: wins={p['total_wins']}  raise_R={p['target_raise_r']:.2f}  hold_bias={p['holdthrough_bias']:.1f}")

    print("\n  ── Backtest Metrics ──")
    print(f"  {'Metric':<20s} {'A) Production':>16s} {'B) Multi-Target':>18s} {'C) MT+Dynamic+RL':>18s}")
    print("  " + "-" * 76)
    for metric_key in ['n', 'win_rate', 'avg_return', 'profit_factor', 'avg_win', 'avg_loss', 'total_return_pct']:
        a = after['metrics']['A_production'].get(metric_key, 0)
        b = after['metrics']['B_multi_target'].get(metric_key, 0)
        c = after['metrics']['C_multi_target_dynamic'].get(metric_key, 0)
        label = {
            'n': 'Trades', 'win_rate': 'Win rate %', 'avg_return': 'Avg return %',
            'profit_factor': 'Profit factor', 'avg_win': 'Avg win %',
            'avg_loss': 'Avg loss %', 'total_return_pct': 'Total return %',
        }.get(metric_key, metric_key)
        print(f"  {label:<20s} {str(a):>16s} {str(b):>18s} {str(c):>18s}")

    imp = after['improvement']
    print(f"\n  IMPROVEMENT (C vs A baseline):")
    print(f"    avg return:      {imp['C_vs_A_avg_return']:+.2f}pp")
    print(f"    profit factor:   {imp['C_vs_A_profit_factor']:+.2f}")
    print(f"    RL bias active:  {before['any_bias_active']}")

    # 🔥 honest verdict (مطابق للـ exit code logic في السطر 143):
    #    improvement = avg return تحسّن بس. PF improvement لوحده مع avg return
    #    أسوأ بـ يكون misleading (زي حالة +0.02 PF مع -35.59pp avg return).
    #    الـ comment الأصلي في السطر 138-141 بـ says نفس الكلام.
    verdict = 'IMPROVEMENT' if imp['C_vs_A_avg_return'] > 0 else 'NO_IMPROVEMENT'
    print(f"\n  VERDICT: {verdict}")
    print("=" * 80 + "\n")


def main():
    parser = argparse.ArgumentParser(description='Verify Learning Improvement')
    parser.add_argument('--predictions-db', default=DEFAULT_PREDICTIONS_DB)
    parser.add_argument('--price-history-db', default=DEFAULT_PRICE_HISTORY_DB)
    parser.add_argument('--output', default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    # 1. snapshot الـ win-lessons state (BEFORE)
    logger.info("Step 1: Snapshotting win-lessons state (BEFORE)...")
    before = snapshot_win_lessons_state()

    # 2. شغّل الـ backtest (الـ backtest نفسه بـ read الـ win-lessons في Policy C)
    logger.info("Step 2: Running multi-target backtest on historical data...")
    backtest_report = run_backtest(args.predictions_db, args.price_history_db)

    if 'error' in backtest_report:
        print(f"\nERROR: {backtest_report['error']}")
        sys.exit(2)

    # 3. اطبع الجدول
    print_before_after_table(before, backtest_report)

    # 4. حدّد الـ verdict
    # 🔥 honest verdict: improvement = avg return improved (the clearest signal).
    # PF improvement alone with worse avg return is misleading. RL bias active
    # is a bonus signal (shows the loop is learning, even if metrics haven't
    # moved yet).
    imp = backtest_report['improvement']
    improvement_detected = (imp['C_vs_A_avg_return'] > 0)

    # 5. احفظ الـ report
    final_report = {
        'timestamp': datetime.now().isoformat(),
        'before_state': before,
        'backtest': backtest_report,
        'verdict': 'IMPROVEMENT' if improvement_detected else 'NO_IMPROVEMENT',
        'exit_code': 0 if improvement_detected else 1,
    }
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, 'w', encoding='utf-8') as f:
        json.dump(final_report, f, indent=2, ensure_ascii=False, default=str)
    logger.info(f"Full report saved to {args.output}")

    print(f"\n  Exit code: {final_report['exit_code']} ({'IMPROVEMENT' if improvement_detected else 'NO_IMPROVEMENT'})")
    print(f"  Report: {args.output}")
    print()

    sys.exit(final_report['exit_code'])


if __name__ == '__main__':
    main()
