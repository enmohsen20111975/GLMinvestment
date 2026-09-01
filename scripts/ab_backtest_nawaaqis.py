#!/usr/bin/env python3
"""
A/B Backtest: Sector Tracking + Maker Flow + Explosive Uncap
=============================================================
اختبار الـ 3 ميزات الناقصة بـ منهجية علمية صارمة.

المنهجية:
  1. Baseline: كل الميزات OFF → temp DB → اقرأ WR/PF/Return
  2. +Sector: sector tracking ON فقط → temp DB → اقرأ
  3. +Maker: maker flow ON فقط → temp DB → اقرأ
  4. +Explosive: explosive_uncap ON فقط → temp DB → اقرأ
  5. +All: كل الميزات ON (combo) → temp DB → اقرأ

القاعدة: النتائج هي اللي تقرر — KEEP الكويس، KILL الوحش.
كل run: 50 tickers × 6 شهور (Feb-Aug 2026) — بيانات حية من price_history.db.

Usage:
  python3 scripts/ab_backtest_nawaaqis.py              # full (5 runs)
  python3 scripts/ab_backtest_nawaaqis.py --quick       # quick (20 tickers)
  python3 scripts/ab_backtest_nawaaqis.py --run baseline  # single run
"""
import subprocess
import sys
import os
import json
import time
import sqlite3
import shutil
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
V40_2_SCRIPT = PROJECT_ROOT / 'vps-service' / 'jobs' / 'v40_2_daily_generator.py'
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'
RESULTS_DIR = PROJECT_ROOT / 'data' / 'ab_nawaaqis_results'
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DB_DIR = PROJECT_ROOT / 'data' / 'ab_nawaaqis_temp'
TEMP_DB_DIR.mkdir(parents=True, exist_ok=True)

# Backtest window (Feb-Aug 2026 = 6 months)
START_DATE = '2026-02-01'
END_DATE = '2026-08-14'  # حد price_history.db المتاح
SCAN_INTERVAL = '1'  # daily scan (matches V40.2-TUNED proven results)
MAX_PICKS = '5'

# Python interpreter (venv)
PYTHON = sys.executable


# ═══════════════════════════════════════════════════════════════════════
# Run config
# ═══════════════════════════════════════════════════════════════════════

RUNS = [
    {
        'label': 'baseline',
        'env': {
            'V76_SECTOR_INTRADAY': '0',      # sector tracking OFF
            'V40_2_EXPLOSIVE_UNCAP': '0',   # explosive OFF
            # maker flow هو جزء من V76_SECTOR_INTRADAY (نفس الـ toggle)
            'V40_2_SKIP_NEWS': '1',          # skip news agent (slow)
            'V40_2_BACKTEST_MODE': '1',
        },
        'desc': 'كل الميزات OFF — الأساس',
    },
    {
        'label': 'sector_on',
        'env': {
            'V76_SECTOR_INTRADAY': '1',      # sector ON (maker flow معه)
            'V40_2_EXPLOSIVE_UNCAP': '0',   # explosive OFF
            'V40_2_SKIP_NEWS': '1',
            'V40_2_BACKTEST_MODE': '1',
        },
        'desc': '+Sector tracking + Maker flow ON',
    },
    {
        'label': 'explosive_on',
        'env': {
            'V76_SECTOR_INTRADAY': '0',      # sector OFF
            'V40_2_EXPLOSIVE_UNCAP': '1',   # explosive ON
            'V40_2_SKIP_NEWS': '1',
            'V40_2_BACKTEST_MODE': '1',
        },
        'desc': '+Explosive Uncap ON (stop=8.5% target=5×ATR)',
    },
    {
        'label': 'all_on',
        'env': {
            'V76_SECTOR_INTRADAY': '1',      # sector + maker ON
            'V40_2_EXPLOSIVE_UNCAP': '1',   # explosive ON
            'V40_2_SKIP_NEWS': '1',
            'V40_2_BACKTEST_MODE': '1',
        },
        'desc': 'كل الميزات ON (combo)',
    },
]


def run_backtest(label: str, env_overrides: dict, max_tickers: int = 50) -> dict:
    """Run V40.2 with temp DB, then read WR/PF/Return."""
    temp_db = TEMP_DB_DIR / f'pred_{label}_{int(time.time())}.db'
    if temp_db.exists():
        temp_db.unlink()

    # Copy schema from real predictions.db
    if PREDICTIONS_DB.exists():
        # Resolve symlink first (shutil.copy may not follow symlinks correctly in all cases)
        import os as _os
        src_real = _os.path.realpath(str(PREDICTIONS_DB))
        shutil.copy(src_real, str(temp_db))
        conn = sqlite3.connect(str(temp_db))
        try:
            # Verify predictions table exists
            tabs = [r[0] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
            if 'predictions' not in tabs:
                print(f"⚠️ predictions table missing in temp DB! tables={tabs[:5]}", flush=True)
            else:
                conn.execute('DELETE FROM predictions')
                conn.commit()
        except Exception as e:
            print(f"⚠️ temp DB setup error: {e}", flush=True)
        conn.close()
    else:
        print(f"❌ PREDICTIONS_DB not found: {PREDICTIONS_DB}", flush=True)

    env = os.environ.copy()
    env.update(env_overrides)
    env['V40_2_PREDICTIONS_DB'] = str(temp_db)

    cmd = [
        PYTHON, str(V40_2_SCRIPT),
        '--start', START_DATE,
        '--end', END_DATE,
        '--scan-interval', SCAN_INTERVAL,
        '--max-picks', MAX_PICKS,
        '--max-tickers', str(max_tickers),
        '--force',
    ]

    print(f"\n{'='*70}")
    print(f"🧪 A/B TEST: {label}")
    print(f"   {env_overrides}")
    print(f"   Max tickers: {max_tickers} | Period: {START_DATE} → {END_DATE}")
    print(f"{'='*70}", flush=True)

    start_time = time.time()
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=900,
            env=env, cwd=str(PROJECT_ROOT)
        )
        elapsed = time.time() - start_time
    except subprocess.TimeoutExpired:
        print(f"❌ TIMEOUT after 900s", flush=True)
        return {'label': label, 'error': 'timeout', 'env': env_overrides}
    except Exception as e:
        print(f"❌ ERROR: {e}", flush=True)
        return {'label': label, 'error': str(e), 'env': env_overrides}

    stdout = result.stdout or ''
    stderr = result.stderr or ''

    # Parse metrics from temp DB
    metrics = read_metrics_from_db(temp_db, label, env_overrides, elapsed)
    metrics['exit_code'] = result.returncode

    # Count triggers from stdout
    triggers = {}
    for line in stdout.split('\n'):
        for tag in ['EXPLOSIVE-UNCAP', 'SECTOR-COLD', 'SECTOR-HOT',
                    'MAKER-BUYING', 'MAKER-SELLING',
                    'V76-PUMP-FROM-DESERT', 'V76-GOLDEN-RETEST']:
            if tag in line:
                triggers[tag] = triggers.get(tag, 0) + 1
    metrics['triggers'] = triggers

    print(f"\n📊 {label}: {metrics.get('trades', 0)} trades | "
          f"WR={metrics.get('win_rate', 0):.1f}% | "
          f"PF={metrics.get('profit_factor', 0):.2f} | "
          f"Return={metrics.get('total_return', 0):+.1f}% "
          f"({elapsed:.0f}s)", flush=True)
    if triggers:
        print(f"   Triggers: {triggers}", flush=True)

    # Save stdout for audit
    audit_file = RESULTS_DIR / f'{label}_stdout.log'
    audit_file.write_text(stdout[-5000:] if len(stdout) > 5000 else stdout)

    return metrics


def read_metrics_from_db(db_path: Path, label: str, env_overrides: dict, elapsed: float) -> dict:
    """Read predictions.db and compute WR, PF, total return."""
    if not db_path.exists():
        return {'label': label, 'env': env_overrides, 'elapsed_sec': round(elapsed, 1),
                'error': 'temp DB not created', 'trades': 0}

    try:
        conn = sqlite3.connect(str(db_path))
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='predictions'"
        ).fetchall()
        if not tables:
            conn.close()
            return {'label': label, 'env': env_overrides, 'elapsed_sec': round(elapsed, 1),
                    'error': 'predictions table missing', 'trades': 0}

        # Read all predictions with outcome (HARD cap on toxic returns: |return| <= 50)
        rows = conn.execute('''
            SELECT ticker, signal, entry_price, target_price, stop_loss,
                   actual_return, is_correct, hit_target, hit_stop,
                   status, prediction_date, exit_price, holding_days,
                   kill_filter_result, explosive_score
            FROM predictions
            WHERE actual_return IS NOT NULL
              AND (actual_return IS NULL OR ABS(actual_return) <= 50)
        ''').fetchall()
        conn.close()

        if not rows:
            return {'label': label, 'env': env_overrides, 'elapsed_sec': round(elapsed, 1),
                    'trades': 0, 'win_rate': 0, 'profit_factor': 0, 'total_return': 0,
                    'avg_return': 0, 'explosive_count': 0}

        trades = len(rows)
        wins = sum(1 for r in rows if r[6])  # is_correct
        losses = trades - wins
        win_rate = (wins / trades * 100) if trades > 0 else 0

        # Profit Factor = gross profit / gross loss
        profits = [float(r[5] or 0) for r in rows if float(r[5] or 0) > 0]
        losses_amt = [abs(float(r[5] or 0)) for r in rows if float(r[5] or 0) < 0]
        gross_profit = sum(profits)
        gross_loss = sum(losses_amt)
        profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else (
            float('inf') if gross_profit > 0 else 0)

        # Total return = sum of returns (compounded would be better but sum is simpler)
        total_return = sum(float(r[5] or 0) for r in rows)
        avg_return = total_return / trades if trades > 0 else 0

        # Count explosive-uncap trades (by proof in kill_filter_result or signal)
        explosive_count = sum(1 for r in rows if r[13] and 'explosive' in str(r[13]).lower())
        # Also count by explosive_score column
        if not explosive_count and rows[0][14] is not None:
            explosive_count = sum(1 for r in rows if r[14] and float(r[14] or 0) > 0)

        # Captured tickers (winners)
        captured = [r[0] for r in rows if r[6]]  # ticker of winners

        return {
            'label': label, 'env': env_overrides,
            'elapsed_sec': round(elapsed, 1),
            'trades': trades, 'wins': wins, 'losses': losses,
            'win_rate': round(win_rate, 1),
            'profit_factor': round(profit_factor, 2) if profit_factor != float('inf') else 999.0,
            'total_return': round(total_return, 2),
            'avg_return': round(avg_return, 2),
            'explosive_count': explosive_count,
            'captured_tickers': captured[:10],
            'max_win': round(max(profits) if profits else 0, 2),
            'max_loss': round(-max(losses_amt) if losses_amt else 0, 2),
        }
    except Exception as e:
        return {'label': label, 'env': env_overrides, 'elapsed_sec': round(elapsed, 1),
                'error': str(e), 'trades': 0}


def print_comparison(results: list):
    """Print comparison table."""
    print(f"\n{'='*90}")
    print("📊 A/B BACKTEST RESULTS — مقارنة الـ 3 نواقص")
    print(f"{'='*90}")
    print(f"{'Run':<18} {'Trades':>7} {'WR%':>7} {'PF':>6} {'Return%':>9} "
          f"{'AvgR%':>7} {'Expl':>5} {'Time':>6}")
    print("-" * 90)
    for r in results:
        if r.get('error'):
            print(f"{r['label']:<18} ❌ {r['error']}")
            continue
        print(f"{r['label']:<18} {r.get('trades',0):>7} "
              f"{r.get('win_rate',0):>6.1f}% "
              f"{r.get('profit_factor',0):>6.2f} "
              f"{r.get('total_return',0):>+8.1f}% "
              f"{r.get('avg_return',0):>+6.2f}% "
              f"{r.get('explosive_count',0):>5} "
              f"{r.get('elapsed_sec',0):>5.0f}s")
    print("-" * 90)

    # Winner determination
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
            print(f"  {r['label']}: {', '.join(r['captured_tickers'])}")


def main():
    import argparse
    parser = argparse.ArgumentParser(description='A/B Backtest for Nawaaqis (sector + maker + explosive)')
    parser.add_argument('--quick', action='store_true', help='Quick mode (20 tickers)')
    parser.add_argument('--max-tickers', type=int, default=None, help='Override max tickers')
    parser.add_argument('--run', default=None, help='Single run label (baseline/sector_on/explosive_on/all_on)')
    args = parser.parse_args()

    max_tickers = args.max_tickers or (20 if args.quick else 50)
    runs = RUNS if args.run is None else [r for r in RUNS if r['label'] == args.run]

    print(f"🚀 A/B Backtest — {len(runs)} runs × {max_tickers} tickers × {START_DATE}→{END_DATE}")
    print(f"   Period: {(6)} months | Scan interval: every {SCAN_INTERVAL} days")

    results = []
    for run in runs:
        result = run_backtest(run['label'], run['env'], max_tickers)
        results.append(result)
        # Save intermediate results
        (RESULTS_DIR / f'{run["label"]}_result.json').write_text(
            json.dumps(result, indent=2, default=str)
        )

    print_comparison(results)

    # Save final results
    final = {
        'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
        'period': f'{START_DATE} → {END_DATE}',
        'max_tickers': max_tickers,
        'results': results,
    }
    (RESULTS_DIR / 'final_results.json').write_text(json.dumps(final, indent=2, default=str))
    print(f"\n💾 Results saved to: {RESULTS_DIR}")


if __name__ == '__main__':
    main()
