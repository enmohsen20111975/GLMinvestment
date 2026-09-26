#!/usr/bin/env python3
"""
Baseline Backtest — قياس الدقة الحالية للتوقعات
==================================================
يقيس أداء التوقعات المغلقة في stocks.db + predictions.db.
النتيجة = baseline نقيس عليه التحسينات المستقبلية.

Usage:
    python3 scripts/baseline_backtest.py
"""

import sqlite3
import os
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')


def analyze_predictions(db_path: str, label: str) -> dict:
    """تحليل التوقعات المغلقة في قاعدة بيانات معينة."""
    print(f"\n{'='*60}")
    print(f"📊 {label}")
    print(f"   Path: {db_path}")
    print(f"{'='*60}")

    if not os.path.exists(db_path):
        print(f"   ⚠ Database not found")
        return {}

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row

    # Total predictions
    total = conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
    print(f"\n   إجمالي التوقعات: {total}")

    # Closed predictions (have outcome_date + actual_return)
    closed = conn.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE outcome_date IS NOT NULL AND actual_return IS NOT NULL
    """).fetchone()[0]
    print(f"   التوقعات المغلقة: {closed}")

    if closed == 0:
        print("   ⚠ لا توجد توقعات مغلقة — لا يمكن قياس الدقة")
        conn.close()
        return {'total': total, 'closed': 0}

    # Get all closed predictions
    rows = conn.execute("""
        SELECT ticker, signal, signal_type, prediction_date, entry_price,
               target_price, stop_loss, master_score, outcome_date,
               exit_price, actual_return, hit_target, hit_stop, is_correct,
               holding_days
        FROM predictions
        WHERE outcome_date IS NOT NULL AND actual_return IS NOT NULL
    """).fetchall()

    # Win rate (is_correct = 1 or actual_return > 0)
    wins = sum(1 for r in rows if r['is_correct'] == 1 or (r['actual_return'] or 0) > 0)
    losses = closed - wins
    win_rate = (wins / closed * 100) if closed > 0 else 0

    # Average return
    returns = [r['actual_return'] or 0 for r in rows]
    avg_return = sum(returns) / len(returns) if returns else 0

    # Average win / loss
    win_returns = [r for r in returns if r > 0]
    loss_returns = [r for r in returns if r < 0]
    avg_win = sum(win_returns) / len(win_returns) if win_returns else 0
    avg_loss = sum(loss_returns) / len(loss_returns) if loss_returns else 0

    # Profit factor
    gross_profit = sum(win_returns) if win_returns else 0
    gross_loss = abs(sum(loss_returns)) if loss_returns else 0
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf')

    # Holding days
    holding_days = [r['holding_days'] or 0 for r in rows if r['holding_days']]
    avg_holding = sum(holding_days) / len(holding_days) if holding_days else 0

    # Hit target / stop
    hit_target = sum(1 for r in rows if r['hit_target'] == 1)
    hit_stop = sum(1 for r in rows if r['hit_stop'] == 1)

    print(f"\n   📈 النتائج:")
    print(f"   ├── Win Rate: {win_rate:.1f}% ({wins} wins / {losses} losses)")
    print(f"   ├── Avg Return: {avg_return:.2f}%")
    print(f"   ├── Avg Win: +{avg_win:.2f}%")
    print(f"   ├── Avg Loss: {avg_loss:.2f}%")
    print(f"   ├── Profit Factor: {profit_factor:.2f}")
    print(f"   ├── Avg Holding: {avg_holding:.1f} days")
    print(f"   ├── Hit Target: {hit_target} ({hit_target/closed*100:.1f}%)")
    print(f"   └── Hit Stop: {hit_stop} ({hit_stop/closed*100:.1f}%)")

    # Breakdown by signal type
    print(f"\n   📊 حسب نوع الإشارة:")
    signal_types = {}
    for r in rows:
        st = r['signal_type'] or r['signal'] or 'UNKNOWN'
        if st not in signal_types:
            signal_types[st] = {'count': 0, 'wins': 0, 'returns': []}
        signal_types[st]['count'] += 1
        if (r['is_correct'] == 1 or (r['actual_return'] or 0) > 0):
            signal_types[st]['wins'] += 1
        signal_types[st]['returns'].append(r['actual_return'] or 0)

    for st, data in sorted(signal_types.items(), key=lambda x: -x[1]['count']):
        wr = data['wins'] / data['count'] * 100 if data['count'] > 0 else 0
        avg_r = sum(data['returns']) / len(data['returns']) if data['returns'] else 0
        print(f"   ├── {st}: {data['count']} predictions | WR: {wr:.1f}% | Avg: {avg_r:.2f}%")

    # Breakdown by score range
    print(f"\n   📊 حسب مدى Score:")
    score_ranges = [(0, 25), (25, 35), (35, 45), (45, 50), (50, 55), (55, 100)]
    for lo, hi in score_ranges:
        subset = [r for r in rows if r['master_score'] is not None and lo <= r['master_score'] < hi]
        if subset:
            sw = sum(1 for r in subset if r['is_correct'] == 1 or (r['actual_return'] or 0) > 0)
            sr = sum(r['actual_return'] or 0 for r in subset) / len(subset)
            print(f"   ├── Score {lo}-{hi}: {len(subset)} preds | WR: {sw/len(subset)*100:.1f}% | Avg: {sr:.2f}%")

    # Top/bottom tickers
    ticker_perf = {}
    for r in rows:
        t = r['ticker']
        if t not in ticker_perf:
            ticker_perf[t] = {'count': 0, 'wins': 0, 'returns': []}
        ticker_perf[t]['count'] += 1
        if r['is_correct'] == 1 or (r['actual_return'] or 0) > 0:
            ticker_perf[t]['wins'] += 1
        ticker_perf[t]['returns'].append(r['actual_return'] or 0)

    # Top 5 tickers (by win rate, min 3 predictions)
    top = [(t, d) for t, d in ticker_perf.items() if d['count'] >= 3]
    top.sort(key=lambda x: -(x[1]['wins'] / x[1]['count']))
    print(f"\n   🏆 أفضل 5 أسهم (min 3 predictions):")
    for t, d in top[:5]:
        wr = d['wins'] / d['count'] * 100
        avg_r = sum(d['returns']) / len(d['returns'])
        print(f"   ├── {t}: {d['count']} preds | WR: {wr:.1f}% | Avg: {avg_r:.2f}%")

    # Bottom 5
    top.sort(key=lambda x: (x[1]['wins'] / x[1]['count']))
    print(f"\n   ⚠ أسوأ 5 أسهم (min 3 predictions):")
    for t, d in top[:5]:
        wr = d['wins'] / d['count'] * 100
        avg_r = sum(d['returns']) / len(d['returns'])
        print(f"   ├── {t}: {d['count']} preds | WR: {wr:.1f}% | Avg: {avg_r:.2f}%")

    conn.close()

    return {
        'total': total,
        'closed': closed,
        'win_rate': win_rate,
        'avg_return': avg_return,
        'avg_win': avg_win,
        'avg_loss': avg_loss,
        'profit_factor': profit_factor,
        'avg_holding': avg_holding,
    }


def main():
    print(f"\n{'#'*60}")
    print(f"# 📊 Baseline Backtest — قياس الدقة الحالية")
    print(f"# التاريخ: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"{'#'*60}")

    # Analyze both DBs
    stocks_results = analyze_predictions(STOCKS_DB, "stocks.db (4172 predictions)")
    pred_results = analyze_predictions(PREDICTIONS_DB, "predictions.db (382 predictions — trend-following)")

    # Summary
    print(f"\n\n{'='*60}")
    print(f"📋 الملخص النهائي (Baseline)")
    print(f"{'='*60}")

    if stocks_results.get('closed', 0) > 0:
        print(f"\nstocks.db:")
        print(f"  Win Rate: {stocks_results['win_rate']:.1f}%")
        print(f"  Avg Return: {stocks_results['avg_return']:.2f}%")
        print(f"  Profit Factor: {stocks_results['profit_factor']:.2f}")

    if pred_results.get('closed', 0) > 0:
        print(f"\npredictions.db:")
        print(f"  Win Rate: {pred_results['win_rate']:.1f}%")
        print(f"  Avg Return: {pred_results['avg_return']:.2f}%")
        print(f"  Profit Factor: {pred_results['profit_factor']:.2f}")

    print(f"\n💡 هذا هو الـ baseline. بعد تطبيق المسار 2 (enhance engines) + المسار 3 (adaptive weights)،")
    print(f"   سنقيس مرة أخرى ونقارن.")


if __name__ == '__main__':
    main()
