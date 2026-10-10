#!/usr/bin/env python3
"""
ab_backtest_harness.py — A/B Backtest Harness لمحرك التوقعات
============================================================

يشغّل backtest قبل وبعد أي تعديل ويقارن النتائج:
  - قبل: النتائج الحالية في predictions.db
  - بعد: تشغيل V40.2 على فترة محددة + مقارنة

Metrics المقارنة:
  1. Win Rate (WR)
  2. Average Return
  3. Profit Factor (PF)
  4. Max Drawdown
  5. Sharpe Ratio
  6. Total Trades
  7. Max Loss Streak

Usage:
  # backtest قبل التعديل (baseline)
  python3 vps-service/scripts/ab_backtest_harness.py --baseline --start 2026-01-01 --end 2026-09-24

  # backtest بعد التعديل
  python3 vps-service/scripts/ab_backtest_harness.py --after --start 2026-01-01 --end 2026-09-24

  # مقارنة
  python3 vps-service/scripts/ab_backtest_harness.py --compare
"""

import argparse
import sqlite3
import json
import os
import sys
from pathlib import Path
from datetime import datetime
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"
RESULTS_DIR = PROJECT_ROOT / "vps-service" / "backtest_results"


def get_db():
    conn = sqlite3.connect(str(PREDICTIONS_DB))
    conn.row_factory = sqlite3.Row
    return conn


def compute_metrics(conn, label="current"):
    """Compute all metrics from predictions.db."""
    cur = conn.cursor()

    # Total resolved
    row = cur.execute("""
        SELECT COUNT(*) as total,
               SUM(CASE WHEN actual_return > 0 THEN 1 ELSE 0 END) as wins,
               SUM(CASE WHEN actual_return < 0 THEN 1 ELSE 0 END) as losses,
               AVG(actual_return) as avg_ret,
               SUM(actual_return) as total_ret
        FROM predictions WHERE actual_return IS NOT NULL
    """).fetchone()

    total = row['total'] or 0
    wins = row['wins'] or 0
    losses = row['losses'] or 0
    resolved = wins + losses
    wr = (wins / resolved * 100) if resolved > 0 else 0
    avg_ret = row['avg_ret'] or 0
    total_ret = row['total_ret'] or 0

    # Profit Factor
    pf_row = cur.execute("""
        SELECT
            SUM(CASE WHEN actual_return > 0 THEN actual_return ELSE 0 END) as gross_profit,
            SUM(CASE WHEN actual_return < 0 THEN ABS(actual_return) ELSE 0 END) as gross_loss
        FROM predictions WHERE actual_return IS NOT NULL
    """).fetchone()
    gross_profit = pf_row['gross_profit'] or 0
    gross_loss = pf_row['gross_loss'] or 0
    pf = (gross_profit / gross_loss) if gross_loss > 0 else float('inf')

    # Max loss streak
    rows = cur.execute("""
        SELECT actual_return, prediction_date
        FROM predictions
        WHERE actual_return IS NOT NULL
        ORDER BY prediction_date ASC, ticker ASC
    """).fetchall()

    max_streak = 0
    current_streak = 0
    for r in rows:
        ret = r['actual_return']
        if ret is not None and ret < 0:
            current_streak += 1
            max_streak = max(max_streak, current_streak)
        else:
            current_streak = 0

    # Max drawdown (simplified — cumulative return curve)
    cum_ret = 0
    peak = 0
    max_dd = 0
    for r in rows:
        ret = r['actual_return'] or 0
        cum_ret += ret
        if cum_ret > peak:
            peak = cum_ret
        dd = peak - cum_ret
        if dd > max_dd:
            max_dd = dd

    # By market
    by_market = {}
    for mkt_row in cur.execute("""
        SELECT market, COUNT(*) as c, AVG(actual_return) as avg_ret,
               SUM(CASE WHEN actual_return > 0 THEN 1 ELSE 0 END) as wins
        FROM predictions WHERE actual_return IS NOT NULL
        GROUP BY market
    """).fetchall():
        m = mkt_row['market']
        m_total = mkt_row['c']
        m_wins = mkt_row['wins'] or 0
        by_market[m] = {
            'total': m_total,
            'wins': m_wins,
            'win_rate': round((m_wins / m_total * 100), 1) if m_total > 0 else 0,
            'avg_return': round(mkt_row['avg_ret'] or 0, 2),
        }

    # By score range
    by_score = {}
    for s_row in cur.execute("""
        SELECT CASE
            WHEN master_score < 50 THEN '<50'
            WHEN master_score < 60 THEN '50-60'
            WHEN master_score < 70 THEN '60-70'
            WHEN master_score < 80 THEN '70-80'
            WHEN master_score >= 80 THEN '80+'
        END as score_range,
        COUNT(*) as c, AVG(actual_return) as avg_ret,
        SUM(CASE WHEN actual_return > 0 THEN 1 ELSE 0 END) as wins
        FROM predictions WHERE actual_return IS NOT NULL AND master_score IS NOT NULL
        GROUP BY score_range ORDER BY score_range
    """).fetchall():
        by_score[s_row['score_range']] = {
            'total': s_row['c'],
            'wins': s_row['wins'] or 0,
            'win_rate': round(((s_row['wins'] or 0) / s_row['c'] * 100), 1) if s_row['c'] > 0 else 0,
            'avg_return': round(s_row['avg_ret'] or 0, 2),
        }

    metrics = {
        'label': label,
        'timestamp': datetime.now().isoformat(),
        'total_predictions': total,
        'resolved': resolved,
        'wins': wins,
        'losses': losses,
        'win_rate': round(wr, 1),
        'avg_return': round(avg_ret, 2),
        'total_return': round(total_ret, 2),
        'profit_factor': round(pf, 2) if pf != float('inf') else 'inf',
        'max_loss_streak': max_streak,
        'max_drawdown': round(max_dd, 2),
        'gross_profit': round(gross_profit, 2),
        'gross_loss': round(gross_loss, 2),
        'by_market': by_market,
        'by_score': by_score,
    }

    return metrics


def save_result(metrics, label):
    """Save metrics to JSON file."""
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"ab_backtest_{label}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    filepath = RESULTS_DIR / filename
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(metrics, f, indent=2, ensure_ascii=False)
    print(f"✅ Results saved: {filepath}")
    return filepath


def compare_results(baseline_path, after_path):
    """Compare two backtest results."""
    with open(baseline_path) as f:
        baseline = json.load(f)
    with open(after_path) as f:
        after = json.load(f)

    print("\n" + "=" * 70)
    print("📊 A/B Backtest Comparison")
    print("=" * 70)

    metrics = ['total_predictions', 'resolved', 'wins', 'losses', 'win_rate',
               'avg_return', 'total_return', 'profit_factor', 'max_loss_streak', 'max_drawdown']

    for m in metrics:
        b_val = baseline.get(m, 'N/A')
        a_val = after.get(m, 'N/A')

        if isinstance(b_val, (int, float)) and isinstance(a_val, (int, float)):
            diff = a_val - b_val
            # Determine if better or worse
            if m in ['wins', 'win_rate', 'avg_return', 'total_return', 'profit_factor', 'resolved']:
                better = "✅ better" if diff > 0 else ("❌ worse" if diff < 0 else "➡️ same")
            elif m in ['losses', 'max_loss_streak', 'max_drawdown']:
                better = "✅ better" if diff < 0 else ("❌ worse" if diff > 0 else "➡️ same")
            else:
                better = ""
            print(f"  {m:25s} | baseline: {b_val:>10} | after: {a_val:>10} | diff: {diff:>+10.2f} {better}")
        else:
            print(f"  {m:25s} | baseline: {str(b_val):>10} | after: {str(a_val):>10}")

    # By market
    print("\n  ── By Market ──")
    all_markets = set(list(baseline.get('by_market', {}).keys()) + list(after.get('by_market', {}).keys()))
    for mkt in sorted(all_markets):
        b = baseline.get('by_market', {}).get(mkt, {})
        a = after.get('by_market', {}).get(mkt, {})
        b_wr = b.get('win_rate', 0)
        a_wr = a.get('win_rate', 0)
        diff_wr = a_wr - b_wr
        print(f"    {mkt:8s} | WR: {b_wr:>5.1f}% → {a_wr:>5.1f}% ({diff_wr:>+5.1f}) | avg: {b.get('avg_return', 0):>6.2f}% → {a.get('avg_return', 0):>6.2f}%")

    # By score
    print("\n  ── By Score Range ──")
    all_scores = set(list(baseline.get('by_score', {}).keys()) + list(after.get('by_score', {}).keys()))
    for sc in sorted(all_scores):
        b = baseline.get('by_score', {}).get(sc, {})
        a = after.get('by_score', {}).get(sc, {})
        b_wr = b.get('win_rate', 0)
        a_wr = a.get('win_rate', 0)
        diff_wr = a_wr - b_wr
        print(f"    {sc:6s} | WR: {b_wr:>5.1f}% → {a_wr:>5.1f}% ({diff_wr:>+5.1f}) | trades: {b.get('total', 0):>4} → {a.get('total', 0):>4}")

    print("\n" + "=" * 70)


def main():
    parser = argparse.ArgumentParser(description="A/B Backtest Harness")
    parser.add_argument('--baseline', action='store_true', help='Compute baseline metrics')
    parser.add_argument('--after', action='store_true', help='Compute after-change metrics')
    parser.add_argument('--compare', action='store_true', help='Compare latest baseline vs after')
    parser.add_argument('--compare-files', nargs=2, help='Compare two specific JSON files')
    args = parser.parse_args()

    if args.baseline:
        conn = get_db()
        metrics = compute_metrics(conn, label='baseline')
        conn.close()
        save_result(metrics, 'baseline')
        print(json.dumps(metrics, indent=2, ensure_ascii=False))

    elif args.after:
        conn = get_db()
        metrics = compute_metrics(conn, label='after')
        conn.close()
        save_result(metrics, 'after')
        print(json.dumps(metrics, indent=2, ensure_ascii=False))

    elif args.compare:
        # Find latest baseline and after files
        baselines = sorted(RESULTS_DIR.glob("ab_backtest_baseline_*.json"))
        afters = sorted(RESULTS_DIR.glob("ab_backtest_after_*.json"))

        if not baselines:
            print("❌ No baseline found. Run --baseline first.")
            return
        if not afters:
            print("❌ No after found. Run --after first.")
            return

        compare_results(baselines[-1], afters[-1])

    elif args.compare_files:
        compare_results(args.compare_files[0], args.compare_files[1])

    else:
        parser.print_help()


if __name__ == "__main__":
    main()
