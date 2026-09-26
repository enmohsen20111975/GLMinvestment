#!/usr/bin/env python3
"""
Comparative Backtest — باك-تست مقارن للطبقات الجديدة
=====================================================
يقيس أثر كل طبقة (Strict Entry, Disclosure, Notebook, Short Holding, Distribution)
على نفس البيانات ونفس الفترة ونفس الكون.

النسخ:
  B0: كل flags OFF (Baseline)
  B1: STRICT_ENTRY + DISCLOSURE_IMPACT
  B2: B1 + NOTEBOOK_CONTEXT
  B4: B2 + SHORT_HOLDING + DISTRIBUTION_EXIT

الفترة: 2026-02-01 → 2026-08-14 (6 شهور)
الكون: أسهم EGX (محدودة لـ 50 سهم للأداء)

Usage:
  python3 scripts/comparative_backtest.py
  python3 scripts/comparative_backtest.py --max-tickers 30
"""

import sys
import os
import json
import time
import subprocess
import sqlite3
import shutil
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
V40_2_SCRIPT = PROJECT_ROOT / 'vps-service' / 'jobs' / 'v40_2_daily_generator.py'
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'
TEMP_DIR = PROJECT_ROOT / 'data' / 'comparative_temp'
RESULTS_DIR = PROJECT_ROOT / 'data' / 'comparative_results'
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR.mkdir(parents=True, exist_ok=True)

START_DATE = '2026-02-01'
END_DATE = '2026-08-14'
MAX_TICKERS = '50'
PYTHON = sys.executable


# ═══════════════════════════════════════════════════════════════════════
# Run configurations
# ═══════════════════════════════════════════════════════════════════════

RUNS = [
    {
        'label': 'B0_baseline',
        'env': {
            'V40_2_STRICT_ENTRY': '0',
            'V40_2_DISCLOSURE_IMPACT': '0',
            'V40_2_NOTEBOOK_CONTEXT': '0',
            'V40_2_SHORT_HOLDING': '0',
            'V40_2_DISTRIBUTION_EXIT': '0',
            'V40_2_NEWS_IMPACT': '0',
            'V40_2_BACKTEST_MODE': '1',
            'V40_2_SKIP_NEWS': '1',
            'BYPASS_PRED_CAP': '1',
        },
    },
    {
        'label': 'B1_strict_disclosure',
        'env': {
            'V40_2_STRICT_ENTRY': '1',
            'V40_2_DISCLOSURE_IMPACT': '1',
            'V40_2_NOTEBOOK_CONTEXT': '0',
            'V40_2_SHORT_HOLDING': '0',
            'V40_2_DISTRIBUTION_EXIT': '0',
            'V40_2_BACKTEST_MODE': '1',
            'V40_2_SKIP_NEWS': '1',
            'BYPASS_PRED_CAP': '1',
        },
    },
    {
        'label': 'B2_notebook',
        'env': {
            'V40_2_STRICT_ENTRY': '1',
            'V40_2_DISCLOSURE_IMPACT': '1',
            'V40_2_NOTEBOOK_CONTEXT': '1',
            'V40_2_SHORT_HOLDING': '0',
            'V40_2_DISTRIBUTION_EXIT': '0',
            'V40_2_BACKTEST_MODE': '1',
            'V40_2_SKIP_NEWS': '1',
            'BYPASS_PRED_CAP': '1',
        },
    },
    {
        'label': 'B4_full_stack',
        'env': {
            'V40_2_STRICT_ENTRY': '1',
            'V40_2_DISCLOSURE_IMPACT': '1',
            'V40_2_NOTEBOOK_CONTEXT': '1',
            'V40_2_SHORT_HOLDING': '1',
            'V40_2_DISTRIBUTION_EXIT': '1',
            'V40_2_BACKTEST_MODE': '1',
            'V40_2_SKIP_NEWS': '1',
            'BYPASS_PRED_CAP': '1',
        },
    },
]


def run_backtest(label: str, env_overrides: dict, max_tickers: int = 50) -> dict:
    """Run V40.2 with specific flags + temp DB."""
    temp_db = TEMP_DIR / f'pred_{label}_{int(time.time())}.db'
    if temp_db.exists():
        temp_db.unlink()

    # Copy schema from real predictions.db
    if PREDICTIONS_DB.exists():
        src = os.path.realpath(str(PREDICTIONS_DB))
        shutil.copy(src, str(temp_db))
        conn = sqlite3.connect(str(temp_db))
        try:
            conn.execute('DELETE FROM predictions')
            conn.commit()
        except Exception:
            pass
        conn.close()

    env = os.environ.copy()
    # Turn all flags OFF first
    for flag in ['V40_2_STRICT_ENTRY', 'V40_2_DISCLOSURE_IMPACT', 'V40_2_NOTEBOOK_CONTEXT',
                 'V40_2_SHORT_HOLDING', 'V40_2_DISTRIBUTION_EXIT', 'V40_2_NEWS_IMPACT']:
        env[flag] = '0'
    env['V40_2_BACKTEST_MODE'] = '1'
    env['V40_2_SKIP_NEWS'] = '1'
    env['BYPASS_PRED_CAP'] = '1'
    env.update(env_overrides)
    env['V40_2_PREDICTIONS_DB'] = str(temp_db)

    cmd = [
        PYTHON, str(V40_2_SCRIPT),
        '--start', START_DATE,
        '--end', END_DATE,
        '--scan-interval', '1',
        '--max-picks', '5',
        '--max-tickers', str(max_tickers),
        '--force',
    ]

    print(f"\n{'='*70}")
    print(f"🧪 COMPARATIVE BACKTEST: {label}")
    print(f"   Flags: {env_overrides}")
    print(f"{'='*70}", flush=True)

    start_time = time.time()
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=600,
            env=env, cwd=str(PROJECT_ROOT)
        )
        elapsed = time.time() - start_time
    except subprocess.TimeoutExpired:
        return {'label': label, 'error': 'timeout', 'elapsed': 600}
    except Exception as e:
        return {'label': label, 'error': str(e)}

    stdout = result.stdout or ''
    stderr = result.stderr or ''

    # Parse metrics from temp DB
    metrics = read_metrics_from_db(temp_db, label, env_overrides, elapsed)
    metrics['exit_code'] = result.returncode

    # Count triggers from stdout
    triggers = {}
    for line in stdout.split('\n'):
        for tag in ['STRICT-ENTRY-REJECT', 'NOTEBOOK-REJECT', 'DISCLOSURE-VETO',
                     'NEWS-VETO', 'NOTEBOOK', 'SECTOR', 'MAKER',
                     'EXPLOSIVE-UNCAP', 'V76-', 'V68-', 'V72-', 'V73-']:
            if tag in line:
                triggers[tag] = triggers.get(tag, 0) + 1
    metrics['triggers'] = triggers

    # Save stdout for qualitative analysis
    audit_file = RESULTS_DIR / f'{label}_stdout.log'
    audit_file.write_text(stdout[-8000:] if len(stdout) > 8000 else stdout)

    return metrics


def read_metrics_from_db(db_path: Path, label: str, env_overrides: dict, elapsed: float) -> dict:
    """Read predictions.db and compute WR, PF, Return, exit reasons."""
    if not db_path.exists():
        return {'label': label, 'error': 'temp DB not created', 'trades': 0}

    try:
        conn = sqlite3.connect(str(db_path))
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='predictions'"
        ).fetchall()
        if not tables:
            conn.close()
            return {'label': label, 'trades': 0, 'elapsed': round(elapsed, 1)}

        rows = conn.execute('''
            SELECT ticker, signal, entry_price, target_price, stop_loss,
                   actual_return, is_correct, hit_target, hit_stop,
                   status, exit_type, holding_days, kill_filter_result
            FROM predictions
            WHERE actual_return IS NOT NULL
              AND (actual_return IS NULL OR ABS(actual_return) <= 50)
        ''').fetchall()
        conn.close()

        if not rows:
            return {'label': label, 'trades': 0, 'elapsed': round(elapsed, 1),
                    'env': env_overrides}

        trades = len(rows)
        wins = [r for r in rows if r[6]]  # is_correct
        losses = [r for r in rows if not r[6]]
        win_rate = (len(wins) / trades * 100) if trades > 0 else 0

        profits = [float(r[5] or 0) for r in rows if float(r[5] or 0) > 0]
        losses_amt = [abs(float(r[5] or 0)) for r in rows if float(r[5] or 0) < 0]
        gross_profit = sum(profits)
        gross_loss = sum(losses_amt)
        pf = (gross_profit / gross_loss) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0)

        total_return = sum(float(r[5] or 0) for r in rows)
        avg_return = total_return / trades if trades > 0 else 0

        avg_win = sum(profits) / len(profits) if profits else 0
        avg_loss = -sum(losses_amt) / len(losses_amt) if losses_amt else 0

        holding_days = [r[11] for r in rows if r[11] and r[11] > 0]
        avg_holding = sum(holding_days) / len(holding_days) if holding_days else 0

        # Exit reasons
        exit_reasons = {}
        for r in rows:
            et = r[10] or 'unknown'
            exit_reasons[et] = exit_reasons.get(et, 0) + 1

        # Captured tickers
        captured = list(set(r[0] for r in rows if r[6]))

        return {
            'label': label,
            'env': env_overrides,
            'trades': trades,
            'wins': len(wins),
            'losses': len(losses),
            'win_rate': round(win_rate, 1),
            'profit_factor': round(pf, 2) if pf < 999 else 999.0,
            'total_return': round(total_return, 2),
            'avg_return': round(avg_return, 2),
            'avg_win': round(avg_win, 2),
            'avg_loss': round(avg_loss, 2),
            'avg_holding_days': round(avg_holding, 1),
            'exit_reasons': exit_reasons,
            'captured_tickers': captured[:15],
            'elapsed': round(elapsed, 1),
        }
    except Exception as e:
        return {'label': label, 'error': str(e), 'trades': 0}


def print_comparison(results: list):
    """Print comparison table."""
    print(f"\n{'='*90}")
    print("📊 COMPARATIVE BACKTEST — مقارنة الطبقات الجديدة")
    print(f"{'='*90}")
    print(f"{'Run':<25} {'Trades':>7} {'WR%':>7} {'PF':>6} {'Return%':>9} {'AvgW%':>7} {'AvgL%':>7} {'Hold':>5} {'Time':>5}")
    print("-" * 90)
    for r in results:
        if r.get('error'):
            print(f"{r['label']:<25} ❌ {r['error']}")
            continue
        print(f"{r['label']:<25} {r.get('trades',0):>7} "
              f"{r.get('win_rate',0):>6.1f}% "
              f"{r.get('profit_factor',0):>6.2f} "
              f"{r.get('total_return',0):>+8.1f}% "
              f"{r.get('avg_win',0):>+6.2f}% "
              f"{r.get('avg_loss',0):>+6.2f}% "
              f"{r.get('avg_holding_days',0):>4.1f}d "
              f"{r.get('elapsed',0):>4.0f}s")
    print("-" * 90)

    # Exit reasons
    print(f"\n{'='*90}")
    print("🚪 Exit Reasons Breakdown")
    print(f"{'='*90}")
    all_reasons = set()
    for r in results:
        if r.get('exit_reasons'):
            all_reasons.update(r['exit_reasons'].keys())

    if all_reasons:
        print(f"{'Run':<25}", end='')
        for reason in sorted(all_reasons):
            print(f" {reason[:15]:>15}", end='')
        print()
        print("-" * 90)
        for r in results:
            print(f"{r['label']:<25}", end='')
            for reason in sorted(all_reasons):
                count = r.get('exit_reasons', {}).get(reason, 0)
                print(f" {count:>15}", end='')
            print()

    # Triggers
    print(f"\n{'='*90}")
    print("🔧 Triggers (from stdout)")
    print(f"{'='*90}")
    for r in results:
        if r.get('triggers'):
            print(f"  {r['label']}: {r['triggers']}")

    # Winner
    valid = [r for r in results if not r.get('error') and r.get('trades', 0) > 0]
    if valid:
        best_return = max(valid, key=lambda x: x.get('total_return', -999))
        best_wr = max(valid, key=lambda x: x.get('win_rate', 0))
        best_pf = max(valid, key=lambda x: x.get('profit_factor', 0))
        print(f"\n🏆 Best Return: {best_return['label']} ({best_return.get('total_return',0):+.1f}%)")
        print(f"🏆 Best Win Rate: {best_wr['label']} ({best_wr.get('win_rate',0):.1f}%)")
        print(f"🏆 Best Profit Factor: {best_pf['label']} ({best_pf.get('profit_factor',0):.2f})")

    # Captured tickers
    print(f"\n🎯 Captured tickers (winners):")
    for r in results:
        if r.get('captured_tickers'):
            print(f"  {r['label']}: {', '.join(r['captured_tickers'][:10])}")


def main():
    import argparse
    parser = argparse.ArgumentParser(description='Comparative Backtest')
    parser.add_argument('--max-tickers', type=int, default=50, help='Max tickers (default 50)')
    args = parser.parse_args()

    print(f"🚀 Comparative Backtest — {len(RUNS)} runs × {args.max_tickers} tickers × {START_DATE}→{END_DATE}")

    results = []
    for run in RUNS:
        result = run_backtest(run['label'], run['env'], max_tickers=args.max_tickers)
        results.append(result)
        (RESULTS_DIR / f'{run["label"]}_result.json').write_text(
            json.dumps(result, indent=2, default=str)
        )

    print_comparison(results)

    # Save final
    final = {
        'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
        'period': f'{START_DATE} → {END_DATE}',
        'max_tickers': args.max_tickers,
        'results': results,
    }
    (RESULTS_DIR / 'final_comparison.json').write_text(json.dumps(final, indent=2, default=str))
    print(f"\n💾 Results saved to: {RESULTS_DIR}")


if __name__ == '__main__':
    main()
